"""The conversion-rate proxy, its cache, and the instance-wide symbol
table (spec/features/rate-lookup.md).

It exists so requests get cached and so no browser individually leaks
its update timing to a third party. The proposal it serves is advice,
never authority: the value that lands in the price timeline is whatever
the user accepted.

Nothing about the outbound request is client-influenced. Hosts and URL
templates are the constants below, `symbol` is checked against the
server's own table before use, redirects are off and egress is capped,
because this proxy runs where other services on the host's network are
reachable.
"""
from __future__ import annotations

import http.client
import json
import logging
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal, NamedTuple, Optional

from flask import Blueprint, abort, current_app, g, jsonify, request
from pydantic import Field

from . import ratelimit
from .db import get_db, now, utcnow, write_transaction
from .validation import Payload, parse

bp = Blueprint("rates", __name__)

# The canonical form (rate-lookup.md, Seeded symbols): an upper-case code
# and an optional lower-case unit, so `usd` cannot sit beside `USD`.
SYMBOL_PATTERN = re.compile(r"^(?=.{1,16}$)[A-Z0-9][A-Z0-9._]*(-[a-z]+)?$")

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

# Constants, not settings: nothing names a provider, and the nightly
# source check imports these names (rate-lookup.md, SSRF and egress
# hardening).
FX_URL = "https://api.frankfurter.dev/v1/{date}?base={quote}"
NBP_URL = "https://api.nbp.pl/api/cenyzlota/{start}/{end}?format=json"
# The window the NBP range query covers, which satisfies the prior-close
# rule in one request with no retry loop.
NBP_WINDOW = timedelta(days=14)

# NBP publishes from 2013-01-02 and Frankfurter from 1999-01-04, except
# the currencies in `_FX_LATER_START`. A single global floor would either
# reject valid FX dates or wave through dates the provider has no data
# for.
_FX_FLOOR = date(1999, 1, 4)
_FX_LATER_START = {
    code: date(2000, 1, 13) for code in ("BRL", "CNY", "ILS", "INR")
}
_GOLD_FLOOR = date(2013, 1, 2)

# NBP prices one gram of fine gold. XAU-g takes the figure directly and
# XAU-ozt is the one conversion, composed at full precision.
_GRAMS_PER_TROY_OUNCE = Decimal("31.1034768")

# rate-lookup.md, Providers: a proposal keeps 10 significant digits,
# never past the vault's scale of 12 places, and is below the bound a
# source figure has.
_SIGNIFICANT = 10
_PLACES = 12
_CEILING = Decimal(10) ** 20

# rate-lookup.md, Caching: an entry fetched once its date has settled is
# kept until the next start. Any other expires an hour after it was fetched,
# because it may hold the prior close of a day not yet published.
_UNSETTLED_TTL = timedelta(hours=1)
_SETTLES_AFTER = timedelta(days=2)

EGRESS_TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 1 * 1024 * 1024

# At most this many proxy requests send at once, so lookups waiting on a
# slow provider never hold every request thread (architecture.md, WSGI
# server). One more sends nothing and answers from what needs no source.
LOOKUP_CONCURRENCY = 4
_lookup_slots = threading.BoundedSemaphore(LOOKUP_CONCURRENCY)


def adapter_for(symbol: str, kind: str) -> "str | None":
    """Which provider chain can price this symbol today, or None.

    `hasAdapter` on the admin table is derived from this rather than
    stored on the row, so the flag and the registry cannot drift.
    """
    if kind == "currency" and symbol in _CURRENCIES:
        return "frankfurter"
    if symbol in ("XAU-ozt", "XAU-g"):
        return "nbp"
    return None


def looks_up(row) -> bool:
    """Whether `lookup` reads true: the stored flag and an adapter,
    because a row an administrator added for a code no provider serves
    would otherwise send requests that can only fail."""
    return bool(row["lookup"]) and adapter_for(row["symbol"], row["kind"]) is not None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirects are disabled rather than followed to a validated
    target: a provider stubbed to reply 302 toward an internal address
    must produce no request to that address."""

    def redirect_request(self, *_args, **_kwargs):
        return None


# The sockets the read on this thread opens, for `_fetch_within` to shut
# down at its deadline.
_watch = threading.local()


def _shut(sock: socket.socket) -> None:
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


def _hand_over(sock: socket.socket) -> None:
    sockets = getattr(_watch, "sockets", None)
    if sockets is not None:
        sockets.append(sock)
        if _watch.expired.is_set():
            _shut(sock)


def _watched(connection_class):
    """`connection_class`, handing each socket it opens to the read
    running on its thread: the plain one as it opens, so a slow TLS
    handshake can be ended, and the one it reads once connected, since
    TLS moves the connection to a new socket. One handed over after the
    deadline is shut at once."""

    class Watched(connection_class):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            create = self._create_connection

            def watched_create(*args, **kwargs):
                sock = create(*args, **kwargs)
                _hand_over(sock)
                return sock

            self._create_connection = watched_create

        def connect(self):
            super().connect()
            _hand_over(self.sock)

    return Watched


class _HTTPS(urllib.request.HTTPSHandler):
    connection = _watched(http.client.HTTPSConnection)

    def https_open(self, req):
        return self.do_open(self.connection, req, context=self._context)


class _HTTP(urllib.request.HTTPHandler):
    connection = _watched(http.client.HTTPConnection)

    def http_open(self, req):
        return self.do_open(self.connection, req)


_opener = urllib.request.build_opener(_NoRedirect, _HTTPS, _HTTP)

# Named outbound requests. Both providers front their public instance
# with a CDN that refuses urllib's default agent outright, so an
# unnamed request is a 403 and no rate ever resolves.
USER_AGENT = "Solvent/1.0 (self-hosted net worth tracker)"


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )


class _Breaker:
    """Opens after N consecutive failures of one provider and fails its
    requests without sending them for the cool-off, instead of retrying
    per request."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.failures = 0
        # Every failure ever counted, which a cool-off never resets.
        self.counted = 0
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
            self.counted += 1
            if self.failures >= threshold:
                self.opened_at = datetime.now(timezone.utc)

    def record_success(self, counted: "int | None" = None) -> None:
        """Reset the count, unless a failure was counted after `counted`:
        a reply read late must not wipe a failure that came after it."""
        with self.lock:
            if counted is not None and counted != self.counted:
                return
            self.failures = 0
            self.opened_at = None


# One per provider: a shared one would let an outage of either silence
# the other, and the other's successes keep resetting the count.
breakers = {"frankfurter": _Breaker(), "nbp": _Breaker()}


class _Egress(NamedTuple):
    """What an outbound request needs from the request that asked, as
    values: the worker threads that send it have no Flask context."""

    deadline: float
    cooloff: timedelta
    failures: int
    log: logging.Logger
    counted: "dict[str, int]"


def _egress() -> _Egress:
    """One deadline for the whole proxy request, shared by every
    provider it asks, and each breaker's failures counted as it began,
    so a success of the request resets no failure counted since."""
    config = current_app.config
    return _Egress(
        time.monotonic() + EGRESS_TIMEOUT_SECONDS,
        timedelta(minutes=config["RATE_BREAKER_COOLOFF_MINUTES"]),
        config["RATE_BREAKER_FAILURES"],
        current_app.logger,
        {provider: breaker.counted for provider, breaker in breakers.items()},
    )


def _fetch_within(url: str, seconds: float) -> bytes:
    """The body of a 200 answer to `url`, or an error once `seconds`
    have passed. A socket timeout bounds each receive on its own, so a
    source sending a byte now and then would outlast it: the read runs
    on a daemon thread, and at the deadline the sockets it opened are
    shut down, which ends the receive it is in and every later one."""
    outcome: list = []
    sockets: list = []
    expired = threading.Event()

    def read() -> None:
        _watch.sockets, _watch.expired = sockets, expired
        try:
            with _opener.open(_request(url), timeout=seconds) as response:
                if response.status != 200:
                    raise urllib.error.HTTPError(
                        url, response.status, "not 200", response.headers, None
                    )
                body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ValueError("body over the size cap")
            outcome.append(body)
        except Exception as error:
            outcome.append(error)

    worker = threading.Thread(target=read, daemon=True)
    worker.start()
    worker.join(seconds)
    if not outcome:
        expired.set()
        for sock in list(sockets):
            _shut(sock)
        raise TimeoutError("no answer within the deadline")
    if isinstance(outcome[0], Exception):
        raise outcome[0]
    return outcome[0]


def _failure(error: Exception) -> str:
    """How a fetch failed, for its log line: the status of an answer
    that was not 200, else the kind of failure. Never the URL or the
    error's text, which hold the date and quote asked for."""
    if isinstance(error, urllib.error.HTTPError):
        return str(error.code)
    if isinstance(error, urllib.error.URLError) and isinstance(error.reason, Exception):
        error = error.reason
    for kind, types in (
        ("timeout", TimeoutError),
        ("tls", ssl.SSLError),
        ("network", (OSError, http.client.HTTPException)),
        ("body", ValueError),
    ):
        if isinstance(error, types):
            return kind
    return "other"


def _fetch_json(provider: str, url: str, egress: _Egress, read):
    """What `read` makes of the provider's answer to `url`, or None.

    `read` returns None for an answer in a shape it cannot read, which
    counts as a failure like any other: a source that keeps answering
    in a changed shape opens its breaker and leaves a line in the log.
    """
    breaker = breakers[provider]
    if breaker.is_open(egress.cooloff):
        return None
    remaining = egress.deadline - time.monotonic()
    if remaining <= 0:
        return None
    try:
        # Integers as Decimal, which takes any length: an int over
        # Python's digit limit would fail the whole answer for one figure.
        result = read(json.loads(_fetch_within(url, remaining), parse_int=Decimal))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            # What the source does not publish, such as a currency
            # before its series starts, leaves the breaker alone: one
            # vault asking it must not stop lookups for every other.
            return None
        status = _failure(error)
    except Exception as error:
        status = _failure(error)
    else:
        if result is not None:
            breaker.record_success(egress.counted[provider])
            return result
        status = "shape"
    egress.log.warning("rates.provider source=%s status=%s", provider, status)
    breaker.record_failure(egress.failures)
    return None


def _positive(value: object) -> "Decimal | None":
    """A figure is usable only as a JSON number above 0 and below the
    ceiling. Anything else is no proposal rather than an error or a
    price of 0. Past the ceiling no figure is a real price, and one of
    a million digits would overflow the context once composed."""
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    number = Decimal(str(value))
    return number if number.is_finite() and 0 < number < _CEILING else None


def _published(value: object, on: date, since: date = date.min) -> "str | None":
    """A source's publication date, usable as `asOf` only as an ISO date
    in its canonical form from `since` to `on`. Anything else means the
    source gave no answer, never an error or a proposal dated a day it
    is not for."""
    if not isinstance(value, str):
        return None
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return None
    return value if day.isoformat() == value and since <= day <= on else None


def _fx_table(
    on: date, quote: str, egress: _Egress
) -> "dict[str, tuple[Decimal, str]] | None":
    """Every currency's price in `quote`, from one outbound request.

    Frankfurter quotes a base against many symbols, so asking with
    `base=quote` gives quote-to-symbol and each rate is inverted. A date
    the provider does not publish resolves to its prior close, which is
    what the `date` field in the response carries.
    """

    def read(payload: object) -> "dict[str, tuple[Decimal, str]] | None":
        # A rate in an unexpected currency is a changed shape rather
        # than silently mislabelled.
        if not isinstance(payload, dict) or payload.get("base") != quote:
            return None
        as_of = _published(payload.get("date"), on)
        rates = payload.get("rates")
        if as_of is None or not isinstance(rates, dict):
            return None
        # An unusable entry is dropped and the rest stands, so one bad
        # code cannot open the breaker on every currency.
        table = {
            code: (Decimal(1) / inverse, as_of)
            for code, value in rates.items()
            if (inverse := _positive(value)) is not None
        }
        return {quote: (Decimal(1), as_of), **table} if table else None

    return _fetch_json(
        "frankfurter", FX_URL.format(date=on.isoformat(), quote=quote), egress, read
    )


def _gold_pln(on: date, egress: _Egress) -> "dict[str, Decimal] | None":
    """PLN per gram of fine gold, by each day NBP published in the window
    up to `on`, the last entry's day being the latest.

    A range query rather than a single date: NBP answers Not Found on
    every weekend and Polish holiday, so the range satisfies the
    prior-close rule in one request. It answers an empty window Not
    Found too, so an empty list is a changed shape. An unusable earlier
    entry is dropped, since only the last one decides the shape.
    """
    start = on - NBP_WINDOW

    def read(payload: object) -> "dict[str, Decimal] | None":
        if not isinstance(payload, list) or not payload:
            return None
        last = payload[-1]
        if not isinstance(last, dict):
            return None
        price = _positive(last.get("cena"))
        as_of = _published(last.get("data"), on, start)
        if price is None or as_of is None:
            return None
        days = {
            day: cena
            for entry in payload[:-1]
            if isinstance(entry, dict)
            and (cena := _positive(entry.get("cena"))) is not None
            and (day := _published(entry.get("data"), on, start)) is not None
            and day < as_of
        }
        return {**days, as_of: price}

    url = NBP_URL.format(start=start.isoformat(), end=on.isoformat())
    return _fetch_json("nbp", url, egress, read)


def _round(value: Decimal) -> "str | None":
    """Composed at full precision and rounded once, at the end, or None
    when the result is no price: 0 once rounded, or at the ceiling.

    Formatted with `f` rather than `str`, because `normalize` renders a
    round figure in scientific notation ("3E+2") and the client parses
    a plain decimal string.
    """
    places = min(_PLACES, _SIGNIFICANT - 1 - value.adjusted())
    rounded = value.quantize(Decimal(1).scaleb(-places))
    if not rounded or rounded >= _CEILING:
        return None
    return format(rounded.normalize(), "f")


def _cache_get(symbol: str, quote: str, on: str) -> "dict | None":
    row = get_db().execute(
        "SELECT * FROM rate_cache WHERE symbol = ? AND quote = ? AND date = ?",
        (symbol, quote, on),
    ).fetchone()
    day = date.fromisoformat(on)
    since = day - NBP_WINDOW if symbol.startswith("XAU-") else date.min
    if (
        row is None
        or not Decimal(row["rate"])
        or _published(row["as_of"], day, since) is None
    ):
        # A "0" or a bad `asOf` stored before either was checked is a
        # miss, so it is fetched again and replaced.
        return None
    fetched = datetime.fromisoformat(row["fetched_at"])
    settled = datetime.fromisoformat(on).replace(tzinfo=timezone.utc) + _SETTLES_AFTER
    if fetched < settled and now() - fetched >= _UNSETTLED_TTL:
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
    wanted = [row for row in symbols if looks_up(row)]
    egress = _egress()

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

    if not pending or not _lookup_slots.acquire(blocking=False):
        return resolved
    try:
        _send(pending, quote, on, egress, resolved)
    finally:
        _lookup_slots.release()
    return resolved


def _send(pending: list, quote: str, on: date, egress: _Egress, resolved: dict) -> None:
    """Fetch what `pending` needs from the providers and add each symbol
    they price to `resolved`, caching it."""
    on_str = on.isoformat()
    # Outbound requests run on worker threads that touch neither the
    # database nor Flask; caching and composing stay on this thread.
    # The table and NBP's query go out at once, so a provider that hangs
    # cannot use up the deadline before the other is asked. The quote leg
    # needs NBP's days, so it waits for NBP.
    gold_pending = any(row["symbol"].startswith("XAU-") for row in pending)
    with ThreadPoolExecutor(max_workers=2) as pool:
        table = None
        if any(row["kind"] == "currency" for row in pending):
            table = pool.submit(_fx_table, on, quote, egress)
        gold = None
        if gold_pending:
            days = pool.submit(_gold_pln, on, egress).result()
            if days is not None:
                gold = _gold_day(days, quote, on_str, table, pool, egress)
        fx = table.result() if table else None

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
        elif symbol.startswith("XAU-") and gold is not None:
            per_gram, as_of, source = gold
            if symbol == "XAU-ozt":
                per_gram *= _GRAMS_PER_TROY_OUNCE
            entry = {
                "rate": _round(per_gram),
                "base": f"1 {symbol}",
                "asOf": as_of,
                "source": source,
                "cached": False,
            }
        if entry is not None and entry["rate"] is not None:
            resolved[symbol] = entry
            _cache_put(symbol, quote, on_str, entry)


def _gold_day(
    days: "dict[str, Decimal]", quote: str, on_str: str, table, pool, egress: _Egress
) -> "tuple[Decimal, str, str] | None":
    """A gram of gold in `quote`, the gold day and the source chain.

    Both halves are for one day, the latest on which NBP published a
    price and Frankfurter a table, because pairing a price with FX from
    a different day misprices it. The leg asks Frankfurter for NBP's
    last day, reusing `table`, the one in flight for the requested
    date, when that is it. A table for an earlier day NBP skipped means
    asking again for NBP's last day before it. Either leg failing
    yields no proposal, because a half-composed rate is never returned.
    """
    day = max(days)
    if quote == "PLN":
        return days[day], day, "nbp"
    while True:
        if table is None or day != on_str:
            table = pool.submit(_fx_table, date.fromisoformat(day), quote, egress)
        leg = table.result()
        if not leg or "PLN" not in leg:
            return None
        pln, published = leg["PLN"]
        if published in days:
            return days[published] * pln, published, "nbp+frankfurter"
        earlier = [d for d in days if d < published]
        if not earlier:
            return None
        day = max(earlier)


def _since(row) -> "date | None":
    """The first date the provider publishes this symbol, derived from
    the adapter registry like `hasAdapter`, or None with no adapter."""
    provider = adapter_for(row["symbol"], row["kind"])
    if provider == "nbp":
        return _GOLD_FLOOR
    if provider == "frankfurter":
        return _FX_LATER_START.get(row["symbol"], _FX_FLOOR)
    return None


def _floor_for(row, quote_row) -> "date | None":
    """The date a rate source applies from: the later of the symbol's
    floor and the quote's, because Frankfurter answers Not Found for a
    base before its start."""
    since = _since(row)
    return None if since is None else max(since, _since(quote_row))


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
    # fromisoformat also takes 20260731 and 2026-W31-5. Only the
    # promised YYYY-MM-DD is accepted.
    if on.isoformat() != raw_date or on > _today():
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
        if _since(quote_row) is None:
            return "", 204
        rows = [
            row
            for row in table_rows()
            if looks_up(row)
            and row["symbol"] != quote
            and on >= (_floor_for(row, quote_row) or on)
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
    if _since(quote_row) is None:
        # No source quotes into it, so nothing is asked of any.
        return "", 204
    floor = _floor_for(row, quote_row)
    if floor is not None and on < floor:
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
                "lookup": looks_up(row),
                "since": since.isoformat() if (since := _since(row)) else None,
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
                "lookup": looks_up(row),
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
