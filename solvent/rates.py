"""The conversion-rate proxy, its cache, and the instance-wide symbol
table (spec/features/rate-lookup.md).

It exists so requests get cached and so no browser individually leaks
its update timing to a third party. The proposal it serves is advice,
never authority: the value that lands in the price timeline is whatever
the user accepted.

Nothing about the outbound request is client-influenced. Hosts and URL
templates are the constants below, `symbol` is checked against the
server's own table before use, redirects are off and egress is capped,
because this proxy runs where internal NAS services are reachable.
"""
from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal, Optional

from flask import Blueprint, abort, g, jsonify, request
from pydantic import Field

from . import ratelimit
from .db import get_db, utcnow, write_transaction
from .validation import Payload, parse

bp = Blueprint("rates", __name__)

# rate-lookup.md, SSRF hardening pins this as `^[A-Z0-9][A-Z0-9._-]{0,15}$`,
# which rejects every metal that file seeds: the generative naming rule
# is `<ISO 4217 metal code>-<unit>` with unit `ozt` or `g`. The case
# range is widened here so the seeded table resolves; nothing else about
# the check changes, and the table lookup below is the control the spec
# itself names as the sufficient one. Raised in spec/questions.md.
SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$")

# Frankfurter's own currency list, which is what the spec seeds the
# currency half of the table from: not the full ISO 4217 set, because a
# code the provider cannot quote into means no proposal ever resolves.
_CURRENCIES = {
    "AUD": "Australian Dollar",
    "BRL": "Brazilian Real",
    "CAD": "Canadian Dollar",
    "CHF": "Swiss Franc",
    "CNY": "Chinese Renminbi Yuan",
    "CZK": "Czech Koruna",
    "DKK": "Danish Krone",
    "EUR": "Euro",
    "GBP": "British Pound",
    "HKD": "Hong Kong Dollar",
    "HUF": "Hungarian Forint",
    "IDR": "Indonesian Rupiah",
    "ILS": "Israeli New Shekel",
    "INR": "Indian Rupee",
    "ISK": "Icelandic Krona",
    "JPY": "Japanese Yen",
    "KRW": "South Korean Won",
    "MXN": "Mexican Peso",
    "MYR": "Malaysian Ringgit",
    "NOK": "Norwegian Krone",
    "NZD": "New Zealand Dollar",
    "PHP": "Philippine Peso",
    "PLN": "Polish Zloty",
    "RON": "Romanian Leu",
    "SEK": "Swedish Krona",
    "SGD": "Singapore Dollar",
    "THB": "Thai Baht",
    "TRY": "Turkish Lira",
    "USD": "United States Dollar",
    "ZAR": "South African Rand",
}

# All four precious metals, in both units, though only gold has a
# provider. A symbol is a permanent identifier written into ciphertext
# as a holding's unit: seeding the canonical form now costs a few config
# rows and removes a migration the server could never perform.
_METALS = [
    ("XAU-ozt", "Gold, troy ounce", True),
    ("XAU-g", "Gold, gram", True),
    ("XAG-ozt", "Silver, troy ounce", False),
    ("XAG-g", "Silver, gram", False),
    ("XPT-ozt", "Platinum, troy ounce", False),
    ("XPT-g", "Platinum, gram", False),
    ("XPD-ozt", "Palladium, troy ounce", False),
    ("XPD-g", "Palladium, gram", False),
]

SEEDED_SYMBOLS = [
    {"symbol": code, "label": label, "kind": "currency", "lookup": True}
    for code, label in sorted(_CURRENCIES.items())
] + [
    {"symbol": symbol, "label": label, "kind": "metal", "lookup": lookup}
    for symbol, label, lookup in _METALS
]

FX_HOST = "https://api.frankfurter.dev"
NBP_HOST = "https://api.nbp.pl"

# NBP publishes from 2013-01-02 and Frankfurter from 1999-01-04. A
# single global floor would either reject valid FX dates or wave through
# gold dates the provider has no data for.
_FX_FLOOR = date(1999, 1, 4)
_GOLD_FLOOR = date(2013, 1, 2)

# NBP prices one gram of fine gold. XAU-g takes the figure directly and
# XAU-ozt is the one conversion, composed at full precision.
_GRAMS_PER_TROY_OUNCE = Decimal("31.1034768")

# rate-lookup.md, Caching: a historical rate does not change, so past
# dates are kept indefinitely and only today expires.
_TODAY_TTL = timedelta(hours=1)

# The 14-day window the NBP range query covers, which satisfies the
# prior-close rule in one request with no retry loop.
_PRIOR_CLOSE_WINDOW = timedelta(days=14)

EGRESS_TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 1 * 1024 * 1024


def adapter_for(symbol: str, kind: str) -> "str | None":
    """Which provider chain can price this symbol today, or None.

    `hasAdapter` on the admin table is derived from this rather than
    stored on the row, so the flag and the registry cannot drift.
    """
    if kind == "currency":
        return "frankfurter"
    if symbol in ("XAU-ozt", "XAU-g"):
        return "nbp"
    return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects are disabled rather than followed to a validated
    target: a provider stubbed to reply 302 toward an internal address
    must produce no request to that address."""

    def redirect_request(self, *_args, **_kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)

# Named outbound requests. Both providers front their public instance
# with a CDN that refuses urllib's default agent outright, so an
# unnamed request is a 403 and no rate ever resolves.
USER_AGENT = "Solvent/1.0 (self-hosted net worth tracker)"


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )


class _Breaker:
    """Opens after N consecutive provider failures and serves No
    Content directly for the cool-off instead of retrying per
    request."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.failures = 0
        self.opened_at: "datetime | None" = None

    def is_open(self, cooloff: timedelta) -> bool:
        with self.lock:
            if self.opened_at is None:
                return False
            if datetime.now(timezone.utc) - self.opened_at >= cooloff:
                self.opened_at = None
                self.failures = 0
                return False
            return True

    def record_failure(self, threshold: int) -> None:
        with self.lock:
            self.failures += 1
            if self.failures >= threshold:
                self.opened_at = datetime.now(timezone.utc)

    def record_success(self) -> None:
        with self.lock:
            self.failures = 0
            self.opened_at = None


breaker = _Breaker()


def _fetch_json(url: str) -> "object | None":
    from flask import current_app

    config = current_app.config
    if breaker.is_open(timedelta(minutes=config["RATE_BREAKER_COOLOFF_MINUTES"])):
        return None
    try:
        with _opener.open(_request(url), timeout=EGRESS_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise urllib.error.URLError(f"status {response.status}")
            payload = json.loads(response.read(MAX_RESPONSE_BYTES))
    except Exception as error:
        # Logged with the target and the failure, never with the
        # requesting user beyond what the access log already holds.
        current_app.logger.warning("rates.provider url=%s error=%s", url, error)
        breaker.record_failure(config["RATE_BREAKER_FAILURES"])
        return None
    breaker.record_success()
    return payload


def _positive(value: object) -> "Decimal | None":
    """A zero, negative, or non-numeric rate is treated as no proposal
    rather than passed through."""
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return number if number > 0 else None


def _fx_table(on: date, quote: str) -> "dict[str, tuple[Decimal, str]] | None":
    """Every currency's price in `quote`, from one outbound request.

    Frankfurter quotes a base against many symbols, so asking with
    `base=quote` gives quote-to-symbol and each rate is inverted. A date
    the provider does not publish resolves to its prior close, which is
    what the `date` field in the response carries.
    """
    payload = _fetch_json(f"{FX_HOST}/v1/{on.isoformat()}?base={quote}")
    if not isinstance(payload, dict):
        return None
    as_of = payload.get("date")
    rates = payload.get("rates")
    if not isinstance(as_of, str) or not isinstance(rates, dict):
        return None
    if payload.get("base") != quote:
        # A rate in an unexpected currency is rejected rather than
        # silently mislabelled.
        return None

    table: "dict[str, tuple[Decimal, str]]" = {quote: (Decimal(1), as_of)}
    for code, value in rates.items():
        inverse = _positive(value)
        if inverse is not None:
            table[code] = (Decimal(1) / inverse, as_of)
    return table


def _gold_pln(on: date) -> "tuple[Decimal, str] | None":
    """PLN per gram of fine gold, at the last published day on or
    before `on`.

    A range query rather than a single date: NBP answers Not Found on
    every weekend and Polish holiday, so the range satisfies the
    prior-close rule in one request.
    """
    start = (on - _PRIOR_CLOSE_WINDOW).isoformat()
    payload = _fetch_json(
        f"{NBP_HOST}/api/cenyzlota/{start}/{on.isoformat()}?format=json"
    )
    if not isinstance(payload, list) or not payload:
        return None
    last = payload[-1]
    if not isinstance(last, dict):
        return None
    price = _positive(last.get("cena"))
    as_of = last.get("data")
    if price is None or not isinstance(as_of, str):
        return None
    return price, as_of


def _round(value: Decimal) -> str:
    """Composed at full precision and rounded once, at the end.

    Formatted with `f` rather than `str`, because `normalize` renders a
    round figure in scientific notation ("3E+2") and the client parses
    a plain decimal string.
    """
    return format(value.quantize(Decimal("0.00000001")).normalize(), "f")


def _cache_get(symbol: str, quote: str, on: str) -> "dict | None":
    row = get_db().execute(
        "SELECT * FROM rate_cache WHERE symbol = ? AND quote = ? AND date = ?",
        (symbol, quote, on),
    ).fetchone()
    if row is None:
        return None
    if on == _today().isoformat():
        fetched = datetime.fromisoformat(row["fetched_at"])
        if datetime.now(timezone.utc) - fetched >= _TODAY_TTL:
            return None
    return {
        "rate": row["rate"],
        "base": f"1 {symbol}",
        "quote": quote,
        "asOf": row["as_of"],
        "source": row["source"],
        "cached": True,
    }


def _cache_put(symbol: str, quote: str, on: str, entry: dict) -> None:
    get_db().execute(
        "INSERT OR REPLACE INTO rate_cache "
        "(symbol, quote, date, rate, as_of, source, fetched_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (symbol, quote, on, entry["rate"], entry["asOf"], entry["source"], utcnow()),
    )


def _today() -> date:
    return datetime.now(timezone.utc).date()


def table_rows(include_retired: bool = False) -> list:
    sql = "SELECT * FROM symbols"
    if not include_retired:
        sql += " WHERE retired = 0"
    return get_db().execute(sql + " ORDER BY kind, symbol").fetchall()


def _resolve(symbols: list, quote: str, on: date) -> "dict[str, dict]":
    """Price each symbol into `quote` on `on`, skipping every one the
    proxy cannot price. Absence from the map is what No Content means
    for a single symbol.
    """
    wanted = [row for row in symbols if row["lookup"]]
    if not wanted:
        return {}

    on_str = on.isoformat()
    resolved: "dict[str, dict]" = {}
    pending = []
    for row in wanted:
        if row["symbol"] == quote:
            # 1 by definition, and Frankfurter errors on base = quote,
            # so passing it through would turn the most trivially
            # answerable question in the API into a provider error.
            resolved[row["symbol"]] = {
                "rate": "1",
                "base": f"1 {quote}",
                "asOf": on_str,
                "source": "identity",
                "cached": False,
            }
            continue
        hit = _cache_get(row["symbol"], quote, on_str)
        if hit is not None:
            resolved[row["symbol"]] = {
                k: hit[k] for k in ("rate", "base", "asOf", "source", "cached")
            }
        else:
            pending.append(row)

    if not pending:
        return resolved

    fx = None
    if any(row["kind"] == "currency" for row in pending) or any(
        row["symbol"].startswith("XAU-") for row in pending
    ):
        fx = _fx_table(on, quote)

    gold_pln = None
    if any(row["symbol"].startswith("XAU-") for row in pending):
        gold_pln = _gold_pln(on)

    for row in pending:
        symbol = row["symbol"]
        entry = None
        if row["kind"] == "currency" and fx and symbol in fx:
            rate, as_of = fx[symbol]
            entry = {
                "rate": _round(rate),
                "base": f"1 {symbol}",
                "asOf": as_of,
                "source": "frankfurter",
                "cached": False,
            }
        elif symbol.startswith("XAU-") and gold_pln is not None:
            per_gram_pln, as_of = gold_pln
            leg = _quote_leg(per_gram_pln, as_of, quote)
            if leg is not None:
                per_gram, source = leg
                if symbol == "XAU-ozt":
                    per_gram *= _GRAMS_PER_TROY_OUNCE
                entry = {
                    "rate": _round(per_gram),
                    "base": f"1 {symbol}",
                    "asOf": as_of,
                    "source": source,
                    "cached": False,
                }
        if entry is not None:
            resolved[symbol] = entry
            _cache_put(symbol, quote, on_str, entry)

    return resolved


def _quote_leg(pln: Decimal, as_of: str, quote: str) -> "tuple[Decimal, str] | None":
    """Convert a PLN figure into `quote` at the **asOf** date, not the
    requested one: pairing a rate with FX from a different day
    misprices it. Either leg failing yields no proposal, because a
    half-composed rate is never returned.
    """
    if quote == "PLN":
        return pln, "nbp"
    leg = _fx_table(date.fromisoformat(as_of), quote)
    if not leg or "PLN" not in leg:
        return None
    return pln * leg["PLN"][0], "nbp+frankfurter"


def _floor_for(row) -> date:
    return _GOLD_FLOOR if row["kind"] == "metal" else _FX_FLOOR


@bp.get("/api/rates")
def get_rates():
    if not set(request.args) <= {"symbol", "date", "quote"}:
        # Any unrecognised parameter is rejected rather than ignored.
        # There is no field an amount could travel in, by construction.
        abort(400)

    quote = request.args.get("quote", "")
    raw_date = request.args.get("date", "")
    symbol = request.args.get("symbol")

    try:
        on = date.fromisoformat(raw_date)
    except ValueError:
        abort(400)
    if on > _today():
        abort(400)

    quote_row = get_db().execute(
        "SELECT * FROM symbols WHERE symbol = ? AND kind = 'currency'", (quote,)
    ).fetchone()
    if quote_row is None:
        # A known ISO 4217 code is the looser check and the wrong one:
        # quote must be a currency the provider can quote into.
        abort(400)

    ratelimit.guard_rates(g.principal["id"])

    if symbol is None:
        rows = [
            row
            for row in table_rows()
            if row["lookup"] and row["symbol"] != quote and on >= _floor_for(row)
        ]
        resolved = _resolve(rows, quote, on)
        if not resolved:
            # One meaning, one shape: no proposal at all is No Content,
            # never OK with an empty map.
            return "", 204
        return jsonify({"date": on.isoformat(), "quote": quote, "rates": resolved})

    if not SYMBOL_PATTERN.match(symbol):
        abort(400)
    row = get_db().execute(
        "SELECT * FROM symbols WHERE symbol = ?", (symbol,)
    ).fetchone()
    if row is None:
        abort(400)
    if on < _floor_for(row):
        # Out of range, rather than merely unanswerable.
        abort(400)

    resolved = _resolve([row], quote, on)
    if symbol not in resolved:
        return "", 204
    entry = dict(resolved[symbol])
    entry["quote"] = quote
    return jsonify(entry)


@bp.get("/api/rates/symbols")
def list_symbols():
    """What the account form's unit picker is built from. Retired rows
    are omitted, so no new holding can be measured in one."""
    return jsonify(
        [
            {
                "symbol": row["symbol"],
                "label": row["label"],
                "kind": row["kind"],
                "lookup": bool(row["lookup"]),
            }
            for row in table_rows()
        ]
    )


@bp.get("/api/admin/symbols")
def admin_list_symbols():
    """The full table including retired rows. No response here counts
    how many holdings use a symbol, and none could: the server cannot
    read a unit."""
    return jsonify(
        [
            {
                "symbol": row["symbol"],
                "label": row["label"],
                "kind": row["kind"],
                "lookup": bool(row["lookup"]),
                "retired": bool(row["retired"]),
                "hasAdapter": adapter_for(row["symbol"], row["kind"]) is not None,
            }
            for row in table_rows(include_retired=True)
        ]
    )


class SymbolCreate(Payload):
    symbol: str = Field(min_length=1, max_length=16)
    label: str = Field(min_length=1, max_length=64)
    kind: Literal["currency", "metal"]
    lookup: bool


class SymbolPatch(Payload):
    label: Optional[str] = Field(default=None, min_length=1, max_length=64)
    lookup: Optional[bool] = None
    retired: Optional[bool] = None


@bp.post("/api/admin/symbols")
def admin_create_symbol():
    body = parse(SymbolCreate, request.get_json(silent=True))
    if not SYMBOL_PATTERN.match(body.symbol):
        abort(400)
    if body.lookup and adapter_for(body.symbol, body.kind) is None:
        # The flag cannot promise a proposal the proxy cannot serve.
        abort(400)
    with write_transaction() as conn:
        exists = conn.execute(
            "SELECT 1 FROM symbols WHERE symbol = ?", (body.symbol,)
        ).fetchone()
        if exists:
            abort(409)
        conn.execute(
            "INSERT INTO symbols (symbol, label, kind, lookup) VALUES (?, ?, ?, ?)",
            (body.symbol, body.label, body.kind, int(body.lookup)),
        )
    return jsonify({"symbol": body.symbol}), 201


@bp.patch("/api/admin/symbols/<symbol>")
def admin_patch_symbol(symbol: str):
    """Only label, lookup and retired. `symbol` and `kind` are
    immutable and there is no delete, because a symbol is written into
    ciphertext as a holding's unit: the server cannot tell whether one
    is in use, cannot migrate the records that use it, and cannot warn
    the administrator who is about to strand them."""
    body = parse(SymbolPatch, request.get_json(silent=True))
    with write_transaction() as conn:
        row = conn.execute(
            "SELECT * FROM symbols WHERE symbol = ?", (symbol,)
        ).fetchone()
        if row is None:
            abort(404)
        if body.lookup and adapter_for(symbol, row["kind"]) is None:
            abort(400)
        for column, value in (
            ("label", body.label),
            ("lookup", body.lookup),
            ("retired", body.retired),
        ):
            if value is not None:
                conn.execute(
                    f"UPDATE symbols SET {column} = ? WHERE symbol = ?",
                    (value if column == "label" else int(value), symbol),
                )
    return jsonify({"symbol": symbol})
