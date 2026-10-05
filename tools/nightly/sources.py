"""Checks of the price sources (spec/features/nightly-harness.md, The
source checks).

Runs in the app's image with PYTHONPATH=/app, so it requests exactly
what the app requests: the same URLs, headers, default TLS context, no
redirects, timeout and size cap.

    python sources.py check   # the real sources, once a day
    python sources.py probe   # the stand-in, per shard
"""
from __future__ import annotations

import http.client
import json
import math
import re
import socket
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

from solvent.rates import (
    EGRESS_TIMEOUT_SECONDS,
    FX_URL,
    MAX_RESPONSE_BYTES,
    NBP_URL,
    NBP_WINDOW,
    SEEDED_SYMBOLS,
    USER_AGENT,
)

QUOTE = "CHF"
CODE = re.compile(r"^[A-Z]{3}$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NO_ROUTE_PROBE = ("1.1.1.1", 443)
NO_ROUTE_SECONDS = 3
SEEDED_CURRENCIES = {row["symbol"] for row in SEEDED_SYMBOLS if row["kind"] == "currency"}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


OPENER = urllib.request.build_opener(_NoRedirect)


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def _within(text: object, first: date, last: date) -> bool:
    try:
        return isinstance(text, str) and bool(ISO_DATE.match(text)) and first <= date.fromisoformat(text) <= last
    except ValueError:
        return False


def frankfurter_violation(body: object, day: date) -> "str | None":
    if not isinstance(body, dict):
        return "body is not an object"
    if body.get("base") != QUOTE:
        return "base is not the quote"
    if not _within(body.get("date"), day - timedelta(days=7), day):
        return "date outside the window"
    rates = body.get("rates")
    if not isinstance(rates, dict):
        return "rates is not an object"
    for code, rate in rates.items():
        if not CODE.match(code):
            return "rates holds a malformed code"
        if not _number(rate):
            return "rates holds a rate that is not a number above zero"
    if SEEDED_CURRENCIES - {QUOTE} - rates.keys():
        return "rates lacks a seeded currency"
    return None


def nbp_violation(body: object, day: date) -> "str | None":
    if not isinstance(body, list) or not body:
        return "body is not a non-empty array"
    previous = ""
    for entry in body:
        if not isinstance(entry, dict):
            return "an entry is not an object"
        if not _within(entry.get("data"), day - NBP_WINDOW, day):
            return "data outside the window"
        if entry["data"] < previous:
            return "entries are not ascending"
        previous = entry["data"]
        if not _number(entry.get("cena")):
            return "cena is not a number above zero"
    return None


def classify(source: str, status: int, body: "bytes | None", day: date) -> "tuple[str, str]":
    """The outcome and its reason for an answer. The reason never holds
    the body."""
    if status == 429 or status >= 500:
        return "no-answer", f"status {status}"
    if status != 200:
        return "changed", f"status {status}"
    if body is None or len(body) > MAX_RESPONSE_BYTES:
        return "changed", "body over the size cap"
    try:
        parsed = json.loads(body)
    except ValueError:
        return "changed", "body is not JSON"
    violation = (frankfurter_violation if source == "frankfurter" else nbp_violation)(parsed, day)
    return ("changed", violation) if violation else ("ok", "200")


def request_for(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})


def check_source(source: str, url: str, day: date, opener=OPENER) -> "tuple[str, str]":
    try:
        with opener.open(request_for(url), timeout=EGRESS_TIMEOUT_SECONDS) as response:
            status, body = response.status, response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        status, body = error.code, None
    except (OSError, http.client.HTTPException) as error:
        cause = error.reason if isinstance(error, urllib.error.URLError) else error
        return "no-answer", type(cause).__name__
    return classify(source, status, body, day)


def check_all(today: date, opener=OPENER) -> "list[tuple[str, str, str]]":
    day = today - timedelta(days=7)
    urls = {
        "frankfurter": FX_URL.format(date=day.isoformat(), quote=QUOTE),
        "nbp": NBP_URL.format(start=(day - NBP_WINDOW).isoformat(), end=day.isoformat()),
    }
    return [(source, *check_source(source, url, day, opener)) for source, url in urls.items()]


def route_out() -> bool:
    """Whether a connection to a public address opens."""
    try:
        socket.create_connection(NO_ROUTE_PROBE, timeout=NO_ROUTE_SECONDS).close()
    except OSError:
        return False
    return True


def main(argv: "list[str]", today: "date | None" = None) -> int:
    if len(argv) != 2 or argv[1] not in ("check", "probe"):
        print("usage: sources.py check|probe", file=sys.stderr)
        return 2
    results = check_all(today or datetime.now(timezone.utc).date(), OPENER)
    for source, outcome, reason in results:
        print(f"{source} {outcome} {reason}", flush=True)
    if argv[1] == "check":
        return 1 if any(outcome == "changed" for _, outcome, _ in results) else 0
    if route_out():
        print("a connection to a public address opened", file=sys.stderr)
        return 1
    return 0 if all(outcome == "ok" for _, outcome, _ in results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
