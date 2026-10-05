"""The conversion-rate proxy and the symbol table
(spec/features/rate-lookup.md).

Every test stubs the provider: nothing here reaches the network, which
is also what lets the SSRF assertions be about requests that were
never made.
"""
from __future__ import annotations

import json
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

import pytest
from flask import has_app_context

import solvent.rates as rates
from tests.helpers import CSRF, connect, mint_invite, register, rows


@pytest.fixture
def provider(monkeypatch):
    """A stubbed provider recording every URL the proxy would fetch,
    its answers read by the adapter as the real fetch reads them."""
    calls = []
    answers = {}

    def fetch(_provider, url, _egress, read):
        calls.append(url)
        for fragment, payload in answers.items():
            if fragment in url:
                return read(payload(url) if callable(payload) else payload)
        return None

    monkeypatch.setattr(rates, "_fetch_json", fetch)
    return type("Provider", (), {"calls": calls, "answers": answers})()


@pytest.fixture
def hang_open(monkeypatch):
    """The app's own opener sent to a loopback server that accepts the
    connection and sends nothing, so the wait ends at the app's own
    socket timeout. Returns a replacement for `_opener.open` that
    reaches that server in place of the URL it was given."""
    real_open = rates._opener.open
    listener = socket.create_server(("127.0.0.1", 0))
    listener.settimeout(0.05)
    port = listener.getsockname()[1]
    held = []
    stop = threading.Event()

    def accept():
        while not stop.is_set():
            try:
                held.append(listener.accept()[0])
            except (TimeoutError, OSError):
                pass

    acceptor = threading.Thread(target=accept)
    acceptor.start()

    def open_(request, timeout=None):
        silent = urllib.request.Request(f"http://127.0.0.1:{port}/", headers=request.headers)
        return real_open(silent, timeout=timeout)

    yield open_
    stop.set()
    acceptor.join()
    listener.close()
    for connection in held:
        connection.close()


@pytest.fixture
def trickle_open():
    """Like `hang_open`, but the loopback server answers 200 at once
    and then sends its body one byte every 0.2 seconds, so no single
    receive ever waits long enough to time out."""
    real_open = rates._opener.open
    listener = socket.create_server(("127.0.0.1", 0))
    listener.settimeout(0.05)
    port = listener.getsockname()[1]
    stop = threading.Event()

    def serve(connection):
        with connection:
            connection.recv(65536)
            connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 4096\r\n\r\n")
            while not stop.wait(0.2):
                try:
                    connection.sendall(b" ")
                except OSError:
                    return

    def accept():
        while not stop.is_set():
            try:
                threading.Thread(target=serve, args=(listener.accept()[0],)).start()
            except (TimeoutError, OSError):
                pass

    acceptor = threading.Thread(target=accept)
    acceptor.start()

    def open_(request, timeout=None):
        slow = urllib.request.Request(f"http://127.0.0.1:{port}/", headers=request.headers)
        return real_open(slow, timeout=timeout)

    yield open_
    stop.set()
    acceptor.join()
    listener.close()


def fx(on: str, table: dict) -> dict:
    return {"amount": 1, "base": "CHF", "date": on, "rates": table}


PAST = "2026-07-31"


# ---- The endpoint's accepted parameters -------------------------------


def test_the_accepted_parameter_set_is_exactly_symbol_date_and_quote(owner):
    """A test enumerating the set, so there is no field an amount
    could travel in even by mistake."""
    base = f"/api/rates?date={PAST}&quote=CHF"
    assert owner.get(base, headers=CSRF).status_code in (200, 204)
    assert owner.get(base + "&symbol=USD", headers=CSRF).status_code in (200, 204)
    for extra in ("amount=100", "value=1", "quantity=3", "base=1"):
        assert owner.get(f"{base}&{extra}", headers=CSRF).status_code == 400, extra


def test_a_future_date_is_a_bad_request(owner):
    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    assert owner.get(
        f"/api/rates?date={tomorrow}&quote=CHF", headers=CSRF
    ).status_code == 400


@pytest.mark.parametrize("spelling", ["20260731", "2026-W31-5", "2026W315"])
def test_a_date_not_written_yyyy_mm_dd_is_a_bad_request(owner, provider, spelling):
    """Each is a spelling of 2026-07-31 that date.fromisoformat accepts."""
    response = owner.get(f"/api/rates?date={spelling}&quote=CHF", headers=CSRF)
    assert response.status_code == 400
    assert provider.calls == []


def test_a_quote_the_provider_cannot_serve_is_refused(owner):
    """Asserted with a valid ISO 4217 code absent from the symbol
    table, since that is the case a plain ISO check waves through."""
    assert owner.get(f"/api/rates?date={PAST}&quote=KWD", headers=CSRF).status_code == 400


@pytest.mark.parametrize(
    "symbol", ["http://192.168.1.1/", "../../etc/passwd", "NOTASYMBOL"]
)
def test_an_unknown_or_malformed_symbol_makes_no_outbound_request(owner, provider, symbol):
    response = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol={symbol}", headers=CSRF
    )
    assert response.status_code == 400
    assert provider.calls == []


def test_symbol_equals_quote_answers_one_with_no_outbound_request(owner, provider):
    body = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=CHF", headers=CSRF
    ).get_json()
    assert body["rate"] == "1"
    assert body["source"] == "identity"
    assert body["cached"] is False
    assert provider.calls == []


def test_a_lookup_false_symbol_answers_no_content_with_no_outbound_request(owner, provider):
    response = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=XAG-ozt", headers=CSRF
    )
    assert response.status_code == 204
    assert provider.calls == []


def test_a_gold_date_before_the_floor_is_a_bad_request(owner, provider):
    response = owner.get(
        "/api/rates?date=2012-12-31&quote=CHF&symbol=XAU-ozt", headers=CSRF
    )
    assert response.status_code == 400
    assert provider.calls == []


def test_an_unauthenticated_request_makes_no_outbound_request(client, provider):
    assert client.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF).status_code == 401
    assert provider.calls == []


# ---- Proposals and the cache ------------------------------------------


def test_a_supported_symbol_resolves_and_then_serves_from_cache(owner, provider):
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8})

    first = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF
    ).get_json()
    assert first["rate"] == "1.25"
    assert first["cached"] is False
    calls = len(provider.calls)

    second = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF
    ).get_json()
    assert second["cached"] is True
    assert len(provider.calls) == calls


def test_the_whole_table_and_a_single_symbol_share_one_cache(owner, provider):
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8, "EUR": 0.95})
    provider.answers["cenyzlota"] = [{"data": PAST, "cena": 300.0}]

    owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    calls = len(provider.calls)
    single = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF
    ).get_json()
    assert single["cached"] is True
    assert len(provider.calls) == calls


def test_a_whole_table_request_omits_symbols_the_proxy_cannot_price(owner, provider):
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8})
    body = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF).get_json()
    assert "XAG-ozt" not in body["rates"]
    assert "USD" in body["rates"]
    # Absent from the map, never present with a null.
    assert all(entry is not None for entry in body["rates"].values())


def test_a_whole_table_request_where_every_symbol_fails_is_no_content(owner, provider):
    response = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    assert response.status_code == 204


def test_gold_converts_through_fx_at_the_as_of_date_not_the_requested_one(owner, provider):
    """Asserted against a stub that would return a different rate for
    each: pairing a rate with FX from a different day misprices it."""
    published = "2026-07-29"
    provider.answers["cenyzlota"] = [{"data": published, "cena": 300.0}]
    provider.answers["frankfurter"] = lambda url: (
        fx(published, {"PLN": 4.0}) if published in url else fx(PAST, {"PLN": 8.0})
    )

    body = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF
    ).get_json()
    assert body["asOf"] == published
    assert body["source"] == "nbp+frankfurter"
    # 300 PLN per gram at 1 PLN = 1/4 CHF.
    assert body["rate"] == "75"


GOOD_FRIDAY = "2026-04-03"


def test_gold_on_a_day_without_a_currency_table_is_priced_at_the_day_before(
    owner, provider
):
    """NBP publishes on Good Friday and the ECB does not, so Frankfurter
    answers its Thursday table: both figures are Thursday's."""
    provider.answers["cenyzlota"] = [
        {"data": "2026-04-02", "cena": 290.0},
        {"data": GOOD_FRIDAY, "cena": 300.0},
    ]
    provider.answers["frankfurter"] = fx("2026-04-02", {"PLN": 4.0})

    body = owner.get(
        f"/api/rates?date={GOOD_FRIDAY}&quote=CHF&symbol=XAU-g", headers=CSRF
    ).get_json()
    assert body["asOf"] == "2026-04-02"
    assert body["rate"] == "72.5"
    assert len(provider.calls) == 2


def test_gold_steps_back_to_a_day_both_sources_published(owner, provider):
    """Frankfurter's table is for a day NBP skipped, so the leg asks
    again for NBP's last day before it."""
    provider.answers["cenyzlota"] = [
        {"data": "2026-04-01", "cena": 280.0},
        {"data": GOOD_FRIDAY, "cena": 300.0},
    ]
    provider.answers["frankfurter"] = lambda url: (
        fx("2026-04-01", {"PLN": 4.0}) if "2026-04-01" in url else fx("2026-04-02", {"PLN": 8.0})
    )

    body = owner.get(
        f"/api/rates?date={GOOD_FRIDAY}&quote=CHF&symbol=XAU-g", headers=CSRF
    ).get_json()
    assert body["asOf"] == "2026-04-01"
    assert body["rate"] == "70"
    assert len(provider.calls) == 3


def test_gold_with_no_day_both_sources_published_is_no_content(owner, provider):
    provider.answers["cenyzlota"] = [{"data": GOOD_FRIDAY, "cena": 300.0}]
    provider.answers["frankfurter"] = fx("2026-04-02", {"PLN": 4.0})

    assert owner.get(
        f"/api/rates?date={GOOD_FRIDAY}&quote=CHF&symbol=XAU-g", headers=CSRF
    ).status_code == 204


def test_gold_in_grams_and_troy_ounces_differ_by_exactly_the_conversion(owner, provider):
    provider.answers["cenyzlota"] = [{"data": PAST, "cena": 300.0}]
    body = owner.get(f"/api/rates?date={PAST}&quote=PLN", headers=CSRF).get_json()
    from decimal import Decimal

    gram = Decimal(body["rates"]["XAU-g"]["rate"])
    ounce = Decimal(body["rates"]["XAU-ozt"]["rate"])
    assert (ounce / gram).quantize(Decimal("0.0000001")) == Decimal("31.1034768")


def test_the_nbp_range_query_takes_the_last_published_day_on_or_before(owner, provider):
    """With nothing published for a requested Saturday, the proposal
    returns the preceding published day with asOf set to it."""
    provider.answers["cenyzlota"] = [
        {"data": "2026-07-29", "cena": 290.0},
        {"data": "2026-07-30", "cena": 300.0},
    ]
    body = owner.get(
        f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF
    ).get_json()
    assert body["asOf"] == "2026-07-30"
    assert body["rate"] == "300"


def test_nothing_published_in_the_window_is_no_content(owner, provider):
    provider.answers["cenyzlota"] = []
    assert owner.get(
        f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF
    ).status_code == 204


def test_a_failed_fx_leg_never_returns_a_pln_figure_under_another_label(owner, provider):
    provider.answers["cenyzlota"] = [{"data": PAST, "cena": 300.0}]
    response = owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF
    )
    assert response.status_code == 204


# Each is what `json.loads` makes of a figure a source could send:
# `NaN`, `Infinity` and `1e400` parse to floats that are not finite,
# `1e300` inverts to a price that rounds to 0, and `1e-25` to one too
# large to round to 8 places.
NOT_A_PRICE = [
    0, -1, "not-a-number", "0.8", True,
    float("nan"), float("inf"), float("-inf"), 1e300, 1e-25,
]


@pytest.mark.parametrize("bad", NOT_A_PRICE)
def test_a_rate_that_is_not_a_usable_price_is_no_proposal(owner, provider, bad):
    provider.answers["frankfurter"] = fx(PAST, {"USD": bad, "EUR": 0.95})
    assert owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF
    ).status_code == 204
    table = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    assert table.status_code == 200
    assert "USD" not in table.get_json()["rates"]
    assert table.get_json()["rates"]["EUR"]["rate"] == "1.05263158"


@pytest.mark.parametrize("bad", NOT_A_PRICE)
@pytest.mark.parametrize("leg", ["cena", "pln"])
def test_a_gold_figure_that_is_not_a_usable_price_drops_only_gold(owner, opener, bad, leg):
    """A bad NBP price or a bad PLN rate drops the gold symbols built
    from it and leaves the rest of the table. A bad PLN rate is one
    entry of a usable table, a bad NBP price a changed shape."""
    _publish(opener, **{leg: bad})
    response = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    assert response.status_code == 200
    body = response.get_json()["rates"]
    assert "XAU-g" not in body and "XAU-ozt" not in body
    assert body["USD"]["rate"] == "0.91945568"
    # `1e-25` is a usable NBP price whose proposal rounds to 0.
    shape = leg == "cena" and bad != 1e-25
    assert failures() == {"frankfurter": 0, "nbp": int(shape)}


def failures() -> dict:
    return {name: breaker.failures for name, breaker in rates.breakers.items()}


# Each is a publication date no source may stamp a proposal with:
# unreadable, not in the canonical form, not a string, after the
# requested day, or before the 14-day window the gold query covers.
NOT_A_DATE = [
    "31.07.2026", "20260730", "2026-7-30", "", 20260730, None,
    "2026-08-01", "2026-07-16",
]


@pytest.mark.parametrize("bad", NOT_A_DATE)
@pytest.mark.parametrize("quote", ["CHF", "PLN"])
def test_a_gold_date_that_is_not_usable_drops_only_gold(owner, opener, bad, quote):
    _publish(opener)
    opener.answers["nbp"] = lambda url: [{"data": bad, "cena": 251.37}]
    response = owner.get(f"/api/rates?date={PAST}&quote={quote}", headers=CSRF)
    assert response.status_code == 200
    body = response.get_json()["rates"]
    assert "XAU-g" not in body and "XAU-ozt" not in body
    assert "USD" in body
    assert failures() == {"frankfurter": 0, "nbp": 1}


@pytest.mark.parametrize("bad", NOT_A_DATE[:-1])
def test_a_currency_date_that_is_not_usable_drops_only_what_its_table_prices(
    owner, opener, bad
):
    _publish(opener)
    fx_answer = opener.answers["fx"]
    opener.answers["fx"] = lambda url: {**fx_answer(url), "date": bad}
    response = owner.get(f"/api/rates?date={PAST}&quote=PLN", headers=CSRF)
    assert response.status_code == 200
    assert set(response.get_json()["rates"]) == {"XAU-g", "XAU-ozt"}
    assert owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF).status_code == 204
    assert failures() == {"frankfurter": 2, "nbp": 0}


@pytest.mark.parametrize("bad", ["31.07.2026", "2026-08-01"])
def test_a_cached_rate_with_an_unusable_date_is_fetched_again(app, owner, provider, bad):
    conn = connect(app)
    with conn:
        conn.execute(
            "INSERT INTO rate_cache (symbol, quote, date, rate, as_of, source, fetched_at) "
            "VALUES ('USD', 'CHF', ?, '2', ?, 'frankfurter', ?)",
            (PAST, bad, datetime.now(timezone.utc).isoformat()),
        )
    conn.close()
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8})
    body = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()
    assert body == {
        "rate": "1.25", "base": "1 USD", "quote": "CHF", "asOf": PAST,
        "source": "frankfurter", "cached": False,
    }


def test_a_cached_rate_of_zero_is_fetched_again(app, owner, provider):
    conn = connect(app)
    with conn:
        conn.execute(
            "INSERT INTO rate_cache (symbol, quote, date, rate, as_of, source, fetched_at) "
            "VALUES ('USD', 'CHF', ?, '0', ?, 'frankfurter', ?)",
            (PAST, PAST, datetime.now(timezone.utc).isoformat()),
        )
    conn.close()
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8})
    body = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()
    assert body["rate"] == "1.25"
    assert body["cached"] is False
    assert rows(app, "SELECT rate FROM rate_cache WHERE symbol = 'USD'") == [{"rate": "1.25"}]


def test_a_rate_in_an_unexpected_currency_is_rejected(owner, provider):
    provider.answers["frankfurter"] = {"base": "EUR", "date": PAST, "rates": {"USD": 0.8}}
    assert owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF
    ).status_code == 204


def test_exceeding_the_per_user_limit_is_too_many_requests(app, owner, provider):
    app.config["RATE_REQUESTS_PER_HOUR"] = 2
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8})
    codes = [
        owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).status_code
        for _ in range(4)
    ]
    assert 429 in codes


def test_a_refused_lookup_writes_no_row_and_the_limit_lifts_an_hour_after_the_oldest(
    app, owner, provider, clock
):
    app.config["RATE_REQUESTS_PER_HOUR"] = 2
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8})
    url = f"/api/rates?date={PAST}&quote=CHF&symbol=USD"
    assert [owner.get(url, headers=CSRF).status_code for _ in range(2)] == [200, 200]
    before = rows(app, "SELECT * FROM attempts")
    assert len(before) == 2

    for _ in range(59):
        clock.advance(60)
        assert owner.get(url, headers=CSRF).status_code == 429
    assert rows(app, "SELECT * FROM attempts") == before

    clock.advance(61)
    assert owner.get(url, headers=CSRF).status_code == 200


def test_the_circuit_breaker_opens_and_closes(app, owner, monkeypatch):
    app.config["RATE_BREAKER_FAILURES"] = 2
    attempts = []

    def failing(url, timeout=None):
        attempts.append(url)
        raise OSError("provider down")

    monkeypatch.setattr(rates._opener, "open", failing)

    for _ in range(4):
        owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    opened = len(attempts)
    owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert len(attempts) == opened

    rates.breakers["frankfurter"].record_success()
    owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert len(attempts) > opened


def test_a_whole_table_request_holding_gold_stays_within_one_egress_timeout(
    owner, monkeypatch, hang_open
):
    """The deadline is per proxy request, not per outbound call: gold
    makes several in series, and a provider that hangs must not stack
    their timeouts."""
    monkeypatch.setattr(rates, "EGRESS_TIMEOUT_SECONDS", 0.4)
    monkeypatch.setattr(rates._opener, "open", hang_open)

    started = time.monotonic()
    response = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    elapsed = time.monotonic() - started

    assert response.status_code == 204
    assert elapsed < 0.4 + 0.15


def test_the_fx_table_is_fetched_once_when_gold_is_published_on_the_requested_date(
    owner, provider
):
    provider.answers["frankfurter"] = fx(PAST, {"PLN": 4.0, "USD": 0.8})
    provider.answers["cenyzlota"] = [{"data": PAST, "cena": 300.0}]

    owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    assert sum("frankfurter" in url for url in provider.calls) == 1


def test_redirects_are_disabled_rather_than_followed():
    handler = rates._NoRedirect()
    assert handler.redirect_request(None, None, 302, "Found", {}, "http://10.0.0.1/") is None


# ---- The symbol table -------------------------------------------------


def test_the_seeded_table_holds_all_eight_metals_with_lookup_on_gold_alone(owner):
    table = {row["symbol"]: row for row in owner.get("/api/rates/symbols", headers=CSRF).get_json()}
    metals = {symbol for symbol, row in table.items() if row["kind"] == "metal"}
    assert metals == {
        "XAU-ozt", "XAU-g", "XAG-ozt", "XAG-g",
        "XPT-ozt", "XPT-g", "XPD-ozt", "XPD-g",
    }
    with_lookup = {symbol for symbol in metals if table[symbol]["lookup"]}
    assert with_lookup == {"XAU-ozt", "XAU-g"}


def test_every_symbol_the_table_offers_is_accepted_by_the_rate_endpoint(owner, provider):
    """Asserted by querying every returned symbol and getting no Bad
    Request, so the two can never drift."""
    table = owner.get("/api/rates/symbols", headers=CSRF).get_json()
    for row in table:
        response = owner.get(
            f"/api/rates?date={PAST}&quote=CHF&symbol={row['symbol']}", headers=CSRF
        )
        assert response.status_code in (200, 204), row["symbol"]
        if not row["lookup"]:
            assert response.status_code == 204, row["symbol"]


def test_the_symbol_table_requires_a_session_and_makes_no_outbound_request(client, provider):
    assert client.get("/api/rates/symbols", headers=CSRF).status_code == 401
    assert provider.calls == []


def test_the_symbol_table_answers_an_administrator_not_found(app):
    admin, _ = register(app, "root", kind="administrator")
    assert admin.get("/api/rates/symbols", headers=CSRF).status_code == 404


# ---- Maintaining the table --------------------------------------------


def test_has_adapter_is_derived_from_the_registry(admin):
    table = admin.get("/api/admin/symbols", headers=CSRF).get_json()
    for row in table:
        expected = rates.adapter_for(row["symbol"], row["kind"]) is not None
        assert row["hasAdapter"] is expected, row["symbol"]
        if row["lookup"]:
            assert row["hasAdapter"] is True, row["symbol"]


def test_symbol_and_kind_are_immutable_and_there_is_no_delete(app, admin):
    for field, value in (("symbol", "XXX"), ("kind", "currency")):
        assert admin.patch(
            "/api/admin/symbols/XAU-ozt", json={field: value}, headers=CSRF
        ).status_code == 400
    deleting = [
        rule.rule
        for rule in app.url_map.iter_rules()
        if "symbols" in rule.rule and "DELETE" in rule.methods
    ]
    assert deleting == []


def test_has_adapter_is_read_only(admin):
    assert admin.patch(
        "/api/admin/symbols/XAU-ozt", json={"hasAdapter": True}, headers=CSRF
    ).status_code == 400
    assert admin.post(
        "/api/admin/symbols",
        json={"symbol": "XXX", "label": "X", "kind": "metal", "lookup": False, "hasAdapter": True},
        headers=CSRF,
    ).status_code == 400


def test_a_symbol_has_one_spelling(admin):
    for symbol in ("usd", "xau-ozt", "XAU-OZT", "XAU-ozt-g", "-XAU", "X" * 17):
        assert admin.post(
            "/api/admin/symbols",
            json={"symbol": symbol, "label": "X", "kind": "metal", "lookup": False},
            headers=CSRF,
        ).status_code == 400, symbol
    assert admin.post(
        "/api/admin/symbols",
        json={"symbol": "XRH-ozt", "label": "Rhodium", "kind": "metal", "lookup": False},
        headers=CSRF,
    ).status_code in (200, 201)


def test_lookup_cannot_promise_a_proposal_the_proxy_cannot_serve(admin):
    assert admin.patch(
        "/api/admin/symbols/XAG-ozt", json={"lookup": True}, headers=CSRF
    ).status_code == 400
    assert admin.post(
        "/api/admin/symbols",
        json={"symbol": "XRH-ozt", "label": "Rhodium", "kind": "metal", "lookup": True},
        headers=CSRF,
    ).status_code == 400


def test_retiring_removes_a_symbol_from_the_picker_and_leaves_pricing_alone(app, admin, provider):
    owner, _ = register(app, "owner")
    provider.answers["frankfurter"] = fx(PAST, {"USD": 0.8})

    admin.patch("/api/admin/symbols/USD", json={"retired": True}, headers=CSRF)
    offered = [row["symbol"] for row in owner.get("/api/rates/symbols", headers=CSRF).get_json()]
    assert "USD" not in offered
    assert owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF
    ).status_code == 200

    admin.patch("/api/admin/symbols/USD", json={"retired": False}, headers=CSRF)
    restored = [row["symbol"] for row in owner.get("/api/rates/symbols", headers=CSRF).get_json()]
    assert "USD" in restored


def test_a_label_changes_freely(admin):
    assert admin.patch(
        "/api/admin/symbols/USD", json={"label": "Dollar"}, headers=CSRF
    ).status_code == 200
    row = next(
        r for r in admin.get("/api/admin/symbols", headers=CSRF).get_json()
        if r["symbol"] == "USD"
    )
    assert row["label"] == "Dollar"


def test_no_admin_symbol_response_counts_which_holdings_use_one(admin):
    body = admin.get("/api/admin/symbols", headers=CSRF).get_data(as_text=True)
    for row in json.loads(body):
        assert set(row) == {"symbol", "label", "kind", "lookup", "retired", "hasAdapter"}


def test_an_administrator_adding_a_currency_reaches_the_next_registration(app, admin):
    admin.post(
        "/api/admin/symbols",
        json={"symbol": "ZZZ", "label": "Testland Dollar", "kind": "currency", "lookup": False},
        headers=CSRF,
    )
    page = app.test_client().get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)
    assert "Testland Dollar" in page


def test_every_outbound_request_is_named(monkeypatch):
    """Both providers front their public instance with a CDN that
    refuses urllib's default agent outright, so an unnamed request is
    a 403 and no rate ever resolves."""
    seen = []

    class Response:
        status = 200
        body = b"{}"

        def read(self, _size=None):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    monkeypatch.setattr(
        rates._opener, "open", lambda request, timeout=None: (seen.append(request), Response())[1]
    )
    from flask import Flask

    scratch = Flask(__name__)
    scratch.config.update(RATE_BREAKER_COOLOFF_MINUTES=5, RATE_BREAKER_FAILURES=5)
    with scratch.app_context():
        rates._fetch_json(
            "frankfurter",
            "https://api.frankfurter.dev/v1/2026-01-01?base=CHF",
            rates._egress(),
            lambda payload: payload,
        )

    assert seen[0].get_header("User-agent") == rates.USER_AGENT



class _Answer:
    def __init__(self, status=200, body=b"{}"):
        self.status, self.body, self.headers = status, body, {}

    def read(self, _size=None):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _raise(error):
    raise error


@pytest.mark.parametrize(
    "answer, status",
    [
        (lambda url: _raise(urllib.error.HTTPError(url, 503, "secret-text", {}, None)), "503"),
        (lambda url: _Answer(status=204), "204"),
        (lambda url: _raise(TimeoutError("secret-text")), "timeout"),
        (lambda url: _raise(urllib.error.URLError(ssl.SSLCertVerificationError("secret-text"))), "tls"),
        (lambda url: _raise(urllib.error.URLError(ConnectionRefusedError("secret-text"))), "network"),
        (lambda url: _Answer(body=b"<html>secret-text"), "body"),
        (lambda url: _Answer(body=b" " * (rates.MAX_RESPONSE_BYTES + 1)), "body"),
        (lambda url: _raise(RuntimeError("secret-text")), "other"),
        (lambda url: _Answer(body=b'{"secret-text": 1}'), "shape"),
    ],
)
def test_a_failed_fetch_logs_its_source_and_status_and_nothing_of_the_request(
    app, monkeypatch, caplog, answer, status
):
    monkeypatch.setattr(rates._opener, "open", lambda request, timeout=None: answer(request.full_url))
    url = rates.FX_URL.format(date=PAST, quote="CHF")

    with app.app_context(), caplog.at_level("WARNING"):
        # A reader that finds no figure in any answer, as in a changed shape.
        assert rates._fetch_json("frankfurter", url, rates._egress(), lambda _: None) is None

    assert [r.getMessage() for r in caplog.records] == [
        f"rates.provider source=frankfurter status={status}"
    ]
    for leak in (PAST, "CHF", "frankfurter.dev", "secret-text"):
        assert leak not in caplog.text


# ---- The outbound request, composition, floors and settings ----------


@pytest.fixture
def opener(monkeypatch):
    """The app's opener, stubbed to answer by URL and record every
    request, so the assertions are about what would have gone out."""
    requests = []
    answers = {"fx": lambda url: None, "nbp": lambda url: None}

    class Response:
        status = 200

        def __init__(self, payload):
            self.payload = json.dumps(payload).encode()

        def read(self, _size=None):
            return self.payload

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def open_(request, timeout=None):
        requests.append(request)
        kind = "nbp" if "nbp.pl" in request.full_url else "fx"
        return Response(answers[kind](request.full_url))

    monkeypatch.setattr(rates._opener, "open", open_)
    return type("Opener", (), {"requests": requests, "answers": answers})()


def _publish(opener, *, pln=4.2537, usd=1.0876, cena=251.37, data=PAST):
    opener.answers["fx"] = lambda url: {
        "amount": 1,
        "base": url.rsplit("base=", 1)[1],
        "date": data,
        "rates": {"PLN": pln, "USD": usd},
    }
    opener.answers["nbp"] = lambda url: [{"data": data, "cena": cena}]


def test_the_module_constants_the_source_check_imports_are_exactly_named():
    assert rates.FX_URL == "https://api.frankfurter.dev/v1/{date}?base={quote}"
    assert rates.NBP_URL == "https://api.nbp.pl/api/cenyzlota/{start}/{end}?format=json"
    assert rates.USER_AGENT == "Solvent/1.0 (self-hosted net worth tracker)"
    assert rates.EGRESS_TIMEOUT_SECONDS == 5
    assert rates.MAX_RESPONSE_BYTES == 1024 * 1024
    assert {row["symbol"] for row in rates.SEEDED_SYMBOLS} >= {"CHF", "XAU-g"}
    assert not hasattr(rates, "FX_HOST") and not hasattr(rates, "NBP_HOST")


@pytest.mark.parametrize(
    "symbol, quote, expected",
    [
        ("USD", "CHF", [rates.FX_URL.format(date=PAST, quote="CHF")]),
        (
            "XAU-g",
            "PLN",
            [rates.NBP_URL.format(start="2026-07-17", end=PAST)],
        ),
        (
            "XAU-g",
            "CHF",
            [
                rates.FX_URL.format(date=PAST, quote="CHF"),
                rates.NBP_URL.format(start="2026-07-17", end=PAST),
            ],
        ),
    ],
)
def test_every_outbound_request_is_a_template_with_only_its_placeholders_filled(
    owner, opener, symbol, quote, expected
):
    _publish(opener)
    response = owner.get(
        f"/api/rates?date={PAST}&quote={quote}&symbol={symbol}", headers=CSRF
    )
    assert response.status_code == 200
    assert sorted(r.full_url for r in opener.requests) == sorted(expected)
    for request in opener.requests:
        assert dict(request.header_items()) == {
            "User-agent": "Solvent/1.0 (self-hosted net worth tracker)",
            "Accept": "application/json",
        }


def test_a_proposal_equals_the_pinned_composition_digit_for_digit(owner, opener):
    from decimal import ROUND_HALF_EVEN, Decimal

    _publish(opener)
    body = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF).get_json()["rates"]

    def eight(value):
        return format(value.quantize(Decimal("0.00000001"), ROUND_HALF_EVEN).normalize(), "f")

    gram = Decimal("251.37") * (Decimal(1) / Decimal("4.2537"))
    assert body["USD"]["rate"] == "0.91945568" == eight(Decimal(1) / Decimal("1.0876"))
    assert body["XAU-g"]["rate"] == eight(gram)
    assert body["XAU-ozt"]["rate"] == eight(gram * Decimal("31.1034768"))


@pytest.mark.parametrize(
    "symbol, day, status",
    [
        ("USD", "1998-12-31", 400),
        ("USD", "1999-01-04", 200),
        ("XAU-g", "2012-12-31", 400),
        ("XAU-g", "2013-01-02", 200),
    ],
)
def test_each_class_has_its_own_floor_on_both_sides(owner, opener, symbol, day, status):
    _publish(opener, data=day)
    response = owner.get(
        f"/api/rates?date={day}&quote=CHF&symbol={symbol}", headers=CSRF
    )
    assert response.status_code == status
    assert bool(opener.requests) == (status == 200)


def test_the_symbol_table_carries_each_symbols_since(owner):
    table = {
        row["symbol"]: row["since"]
        for row in owner.get("/api/rates/symbols", headers=CSRF).get_json()
    }
    assert table["USD"] == "1999-01-04"
    assert table["BRL"] == "2000-01-13"
    assert table["XAU-g"] == table["XAU-ozt"] == "2013-01-02"
    assert table["XAG-ozt"] is None


def test_the_floor_and_since_cannot_drift_over_the_whole_table(owner, opener):
    """Every row with a `since`, quoted in EUR, is refused the day
    before it and asked for on it."""
    table = owner.get("/api/rates/symbols", headers=CSRF).get_json()
    for row in table:
        if row["symbol"] == "EUR" or row["since"] is None:
            continue
        since = date.fromisoformat(row["since"])
        _publish(opener, data=row["since"])
        before = len(opener.requests)
        refused = owner.get(
            f"/api/rates?date={since - timedelta(days=1)}&quote=EUR&symbol={row['symbol']}",
            headers=CSRF,
        )
        assert refused.status_code == 400, row["symbol"]
        assert len(opener.requests) == before
        owner.get(
            f"/api/rates?date={since}&quote=EUR&symbol={row['symbol']}", headers=CSRF
        )
        assert len(opener.requests) > before, row["symbol"]


def test_a_symbol_with_no_adapter_answers_no_content_at_any_date(owner, opener):
    for day in ("2012-12-31", "1998-12-31"):
        response = owner.get(
            f"/api/rates?date={day}&quote=CHF&symbol=XAG-ozt", headers=CSRF
        )
        assert response.status_code == 204
    assert opener.requests == []


def test_the_whole_table_before_gold_asks_no_gold_source(owner, opener):
    _publish(opener, data="2012-12-31")
    body = owner.get("/api/rates?date=2012-12-31&quote=CHF", headers=CSRF).get_json()
    assert [r.full_url for r in opener.requests] == [
        rates.FX_URL.format(date="2012-12-31", quote="CHF")
    ]
    assert "USD" in body["rates"]
    assert not {"XAU-g", "XAU-ozt"} & set(body["rates"])


def test_the_whole_table_leaves_out_currencies_not_yet_published(owner, opener):
    _publish(opener, data="1999-06-30")
    body = owner.get("/api/rates?date=1999-06-30&quote=CHF", headers=CSRF).get_json()
    assert "USD" in body["rates"]
    assert not {"BRL", "CNY", "ILS", "INR"} & set(body["rates"])


def test_a_quote_before_its_own_start_asks_nothing_and_spares_the_breaker(owner, opener):
    rates.breakers["frankfurter"].failures = 0
    response = owner.get("/api/rates?date=1999-06-30&quote=BRL", headers=CSRF)
    assert response.status_code == 204
    assert opener.requests == []
    assert rates.breakers["frankfurter"].failures == 0


_CONFIG_VARIABLES = {
    "DATABASE_PATH": None,
    "HSTS_PRELOAD": "1",
    "HSTS_MAX_AGE": "60",
    "TRUSTED_PROXY_HOPS": "1",
    "LOGIN_ATTEMPTS_PER_ACCOUNT": "7",
    "LOGIN_ACCOUNT_WINDOW_MINUTES": "7",
    "LOGIN_LOCKOUT_THRESHOLD": "7",
    "LOGIN_LOCKOUT_WINDOW_MINUTES": "7",
    "LOGIN_LOCKOUT_MINUTES": "7",
    "LOGIN_FAILURES_PER_ADDRESS": "7",
    "LOGIN_ADDRESS_WINDOW_MINUTES": "7",
    "LOGIN_ADDRESS_LOCK_MINUTES": "7",
    "VERIFY_CONCURRENCY": "2",
    "VERIFY_WAIT_SECONDS": "7",
    "RATE_REQUESTS_PER_HOUR": "99",
    "RATE_BREAKER_FAILURES": "3",
    "RATE_BREAKER_COOLOFF_MINUTES": "3",
    "EXPORTS_PER_USER_HOUR": "3",
}
_PROXY_VARIABLES = {"http_proxy", "https_proxy", "no_proxy", "all_proxy", "ftp_proxy"}


class _RecordingEnviron(dict):
    """Records each name the app's own code reads. A whole-environment
    iteration by anything but urllib, which reads the `*_proxy` names
    that way, is recorded as `*`."""

    reads: set

    def _caller(self):
        import sys

        frame = sys._getframe(3)
        while frame.f_globals["__name__"] in ("os", "collections.abc", "_collections_abc"):
            frame = frame.f_back
        return frame.f_globals["__name__"]

    def _note(self, name):
        if self._caller().startswith("solvent"):
            self.reads.add(name)

    def get(self, name, default=None):
        self._note(name)
        return super().get(name, default)

    def __getitem__(self, name):
        self._note(name)
        return super().__getitem__(name)

    def __contains__(self, name):
        self._note(name)
        return super().__contains__(name)

    def __iter__(self):
        self._note("*")
        return super().__iter__()

    def items(self):
        self._note("*")
        return super().items()

    def keys(self):
        self._note("*")
        return super().keys()


def test_the_only_environment_the_app_reads_is_its_configuration_and_none_of_it_names_a_provider(
    tmp_path, monkeypatch, opener
):
    import os

    environ = _RecordingEnviron(os.environ)
    environ.reads = set()
    for name, value in _CONFIG_VARIABLES.items():
        environ[name] = value or str(tmp_path / "env.db")
    for name in _PROXY_VARIABLES:
        environ[name] = "http://proxy.invalid:3128"
    environ["SECRET_KEY"] = "test-only-secret-key-do-not-use-in-prod"
    monkeypatch.setattr(os, "environ", environ)

    from solvent import create_app

    app = create_app({"TESTING": True})
    client, _ = register(app, "owner")
    _publish(opener)
    assert client.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF).status_code == 200

    # LOGIN_REQUESTS_PER_IP_HOUR is read only to refuse it (app-shell.md,
    # Configuration).
    named = set(_CONFIG_VARIABLES) | {"SECRET_KEY", "LOGIN_REQUESTS_PER_IP_HOUR"}
    assert environ.reads <= named | _PROXY_VARIABLES
    assert {"SECRET_KEY", *_CONFIG_VARIABLES} <= environ.reads
    assert sorted(r.full_url for r in opener.requests) == sorted(
        [
            rates.FX_URL.format(date=PAST, quote="CHF"),
            rates.NBP_URL.format(start="2026-07-17", end=PAST),
        ]
    )
    # The opener's context verifies the certificate against the
    # provider's own name, and no setting changed that.
    https = [h for h in rates._opener.handlers if isinstance(h, urllib.request.HTTPSHandler)]
    assert [(h._context.verify_mode, h._context.check_hostname) for h in https] == [
        (ssl.CERT_REQUIRED, True)
    ]


@pytest.mark.parametrize(
    "source, answer",
    [
        ("frankfurter", lambda url: {"base": "CHF", "date": PAST, "rates": [1.0876]}),
        ("frankfurter", lambda url: {"base": "EUR", "date": PAST, "rates": {"USD": 1.0876}}),
        ("frankfurter", lambda url: {"base": "CHF", "date": PAST, "rates": {"USD": "1.0876"}}),
        ("frankfurter", lambda url: {"base": "CHF", "date": PAST, "rates": {}}),
        ("nbp", lambda url: {"data": PAST, "cena": 251.37}),
        ("nbp", lambda url: []),
        ("nbp", lambda url: [[PAST, 251.37]]),
    ],
)
def test_a_changed_shape_logs_shape_and_counts_against_its_breaker(
    owner, opener, caplog, source, answer
):
    _publish(opener)
    opener.answers["fx" if source == "frankfurter" else "nbp"] = answer
    symbol = "USD" if source == "frankfurter" else "XAU-g"
    with caplog.at_level("WARNING"):
        response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol={symbol}", headers=CSRF)
    assert response.status_code == 204
    assert [r.getMessage() for r in caplog.records if r.getMessage().startswith("rates.")] == [
        f"rates.provider source={source} status=shape"
    ]
    assert failures() == {name: int(name == source) for name in rates.breakers}


def test_one_usable_rate_among_bad_ones_is_a_success(owner, opener, caplog):
    opener.answers["fx"] = lambda url: {
        "base": "CHF", "date": PAST, "rates": {"USD": 0, "EUR": "0.95", "GBP": 0.8},
    }
    rates.breakers["frankfurter"].failures = 1
    with caplog.at_level("WARNING"):
        response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=GBP", headers=CSRF)
    assert response.get_json()["rate"] == "1.25"
    assert not [r for r in caplog.records if r.getMessage().startswith("rates.")]
    assert failures() == {name: 0 for name in rates.breakers}


# ---- One breaker per provider ------------------------------------------

FAILURE_KINDS = ["connect", "timeout", "non-200", "non-json"]


@pytest.fixture
def providers(monkeypatch, hang_open):
    """The app's opener, with Frankfurter and NBP each healthy or failing
    in one of the ways a breaker counts. `requests` records the provider
    of every request that went out, `lag_days` makes NBP publish that
    many days before the date asked. A provider in `hang` is reached on a
    loopback server that sends nothing, so the app's own timeout ends
    the wait, and one in `delay` answers that many
    seconds late. `sent` holds each request's provider, send time and
    whether it ran off the request's thread without a Flask context."""

    main = threading.current_thread()

    class Response:
        def __init__(self, body, status=200):
            self.body, self.status = body, status

        def read(self, _size=None):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    state = type(
        "Providers",
        (),
        {"requests": [], "fail": {}, "lag_days": 0, "hang": set(), "delay": {}, "sent": []},
    )()

    def open_(request, timeout=None):
        url = request.full_url
        provider = "nbp" if "nbp.pl" in url else "frankfurter"
        state.requests.append(provider)
        isolated = threading.current_thread() is not main and not has_app_context()
        state.sent.append((provider, time.monotonic(), isolated))
        if provider in state.hang:
            return hang_open(request, timeout)
        time.sleep(state.delay.get(provider, 0))
        kind = state.fail.get(provider)
        if kind == "connect":
            raise ConnectionRefusedError("refused")
        if kind == "timeout":
            raise TimeoutError("timed out")
        if kind == "non-200":
            return Response(b"{}", status=503)
        if kind == "non-json":
            return Response(b"<html>")
        if provider == "nbp":
            end = date.fromisoformat(url.split("?")[0].rsplit("/", 1)[1])
            published = (end - timedelta(days=state.lag_days)).isoformat()
            return Response(json.dumps([{"data": published, "cena": 251.37}]).encode())
        body = {
            "base": url.rsplit("base=", 1)[1],
            "date": url.split("/v1/")[1][:10],
            "rates": {"PLN": 4.2537, "USD": 1.0876},
        }
        return Response(json.dumps(body).encode())

    monkeypatch.setattr(rates._opener, "open", open_)
    return state


def _day(offset: int) -> str:
    """A different date per request, so no cache entry answers in place
    of a provider."""
    return (date.fromisoformat(PAST) - timedelta(days=offset)).isoformat()


@pytest.mark.parametrize("kind", FAILURE_KINDS)
def test_frankfurter_failing_opens_its_breaker_while_nbp_keeps_answering(
    app, owner, providers, kind
):
    """Each request is for a new date, quoted in PLN, so gold needs no
    Frankfurter leg. NBP's successes between Frankfurter's failures must
    not reset Frankfurter's count."""
    app.config["RATE_BREAKER_FAILURES"] = 3
    providers.fail["frankfurter"] = kind

    for offset in range(6):
        response = owner.get(f"/api/rates?date={_day(offset)}&quote=PLN", headers=CSRF)
        assert response.status_code == 200
        assert set(response.get_json()["rates"]) == {"XAU-g", "XAU-ozt"}

    assert providers.requests.count("frankfurter") == 3
    assert providers.requests.count("nbp") == 6


@pytest.mark.parametrize("kind", FAILURE_KINDS)
def test_nbp_failing_past_the_count_stops_only_the_gold_symbols(app, owner, providers, kind):
    app.config["RATE_BREAKER_FAILURES"] = 3
    providers.fail["nbp"] = kind

    for offset in range(6):
        response = owner.get(f"/api/rates?date={_day(offset)}&quote=CHF", headers=CSRF)
        assert response.status_code == 200
        symbols = set(response.get_json()["rates"])
        assert {"USD", "PLN"} <= symbols
        assert not symbols & {"XAU-g", "XAU-ozt"}

    assert providers.requests.count("frankfurter") == 6
    assert providers.requests.count("nbp") == 3


def test_a_failing_fx_leg_of_gold_counts_against_frankfurter_not_nbp(app, owner, providers):
    """NBP publishes the day before each date asked, so every gold
    request needs a Frankfurter request, for the day NBP published:
    the currency leg."""
    app.config["RATE_BREAKER_FAILURES"] = 3
    providers.fail["frankfurter"] = "non-200"
    providers.lag_days = 1

    for offset in range(4):
        url = f"/api/rates?date={_day(offset)}&quote=CHF&symbol=XAU-g"
        assert owner.get(url, headers=CSRF).status_code == 204

    # One failure per request, so the third opens the breaker and the
    # leg of the fourth is not sent.
    assert providers.requests.count("frankfurter") == 3
    assert providers.requests.count("nbp") == 4
    assert rates.breakers["nbp"].failures == 0
    assert rates.breakers["frankfurter"].opened_at is not None


@pytest.fixture
def server_clock(monkeypatch):
    """The clock the breakers read, stopped until a test moves it."""
    now = [datetime.now(timezone.utc)]

    class Stopped(datetime):
        @classmethod
        def now(cls, tz=None):
            return now[0].astimezone(tz)

    monkeypatch.setattr(rates, "datetime", Stopped)
    return lambda seconds: now.__setitem__(0, now[0] + timedelta(seconds=seconds))


@pytest.mark.parametrize("down, other", [("frankfurter", "nbp"), ("nbp", "frankfurter")])
def test_each_provider_is_asked_again_after_its_own_cooloff(
    app, owner, providers, server_clock, down, other
):
    app.config["RATE_BREAKER_FAILURES"] = 2
    app.config["RATE_BREAKER_COOLOFF_MINUTES"] = 5
    providers.fail[down] = "connect"

    def lookup(offset):
        before = list(providers.requests)
        owner.get(f"/api/rates?date={_day(offset)}&quote=CHF", headers=CSRF)
        # The two providers are asked at once, so their order is not fixed.
        return sorted(providers.requests[len(before):])

    assert lookup(0) == ["frankfurter", "nbp"]
    assert lookup(1) == ["frankfurter", "nbp"]
    assert lookup(2) == [other]
    server_clock(5 * 60 - 1)
    assert lookup(3) == [other]
    server_clock(1)
    # The count starts again from zero, so it takes two more failures.
    assert lookup(4) == ["frankfurter", "nbp"]
    assert lookup(5) == ["frankfurter", "nbp"]
    assert lookup(6) == [other]


# ---- Both providers share one deadline, and are asked at once ----------

HANG_BOUND = 1


@pytest.fixture
def short_timeout(monkeypatch):
    monkeypatch.setattr(rates, "EGRESS_TIMEOUT_SECONDS", 0.5)
    return 0.5


def _timed(owner, url):
    started = time.monotonic()
    response = owner.get(url, headers=CSRF)
    return response, time.monotonic() - started


def test_both_providers_hanging_gives_no_content_within_the_bound_and_both_are_asked_at_once(
    owner, providers, short_timeout
):
    providers.hang = {"frankfurter", "nbp"}
    response, elapsed = _timed(owner, f"/api/rates?date={PAST}&quote=PLN")

    assert response.status_code == 204
    assert elapsed < short_timeout + HANG_BOUND
    first = {provider: at for provider, at, _ in reversed(providers.sent)}
    assert set(first) == {"frankfurter", "nbp"}
    assert abs(first["frankfurter"] - first["nbp"]) < short_timeout / 2


def test_frankfurter_hanging_leaves_the_gold_symbols_in_a_pln_table(
    owner, providers, short_timeout
):
    providers.hang = {"frankfurter"}
    response, elapsed = _timed(owner, f"/api/rates?date={PAST}&quote=PLN")

    assert response.status_code == 200
    assert set(response.get_json()["rates"]) == {"XAU-g", "XAU-ozt"}
    assert elapsed < short_timeout + HANG_BOUND


def test_nbp_hanging_leaves_the_currency_rates(owner, providers, short_timeout):
    providers.hang = {"nbp"}
    response, elapsed = _timed(owner, f"/api/rates?date={PAST}&quote=CHF")

    assert response.status_code == 200
    symbols = set(response.get_json()["rates"])
    assert {"USD", "PLN"} <= symbols
    assert not symbols & {"XAU-g", "XAU-ozt"}
    assert elapsed < short_timeout + HANG_BOUND


def test_providers_sending_their_answer_slowly_give_no_content_within_the_bound(
    owner, monkeypatch, short_timeout, trickle_open
):
    """The deadline bounds the whole read: a byte every 0.2 seconds
    keeps each receive under the socket timeout."""
    monkeypatch.setattr(rates._opener, "open", trickle_open)
    response, elapsed = _timed(owner, f"/api/rates?date={PAST}&quote=CHF")

    assert response.status_code == 204
    assert elapsed < short_timeout + HANG_BOUND


def _only(app, kind):
    """The symbol table with only `kind` left to look up, so a whole
    table has only those symbols pending."""
    conn = connect(app)
    conn.execute("UPDATE symbols SET lookup = 0 WHERE kind != ?", (kind,))
    conn.commit()
    conn.close()


@pytest.mark.parametrize(
    "kind, quote, sent",
    [
        ("currency", "CHF", ["frankfurter"]),
        ("metal", "PLN", ["nbp"]),
        ("metal", "CHF", ["frankfurter", "nbp"]),
    ],
)
def test_a_request_sends_only_what_its_pending_symbols_need(
    app, owner, providers, kind, quote, sent
):
    _only(app, kind)
    response = owner.get(f"/api/rates?date={PAST}&quote={quote}", headers=CSRF)

    assert response.status_code == 200
    assert sorted(providers.requests) == sent


def test_a_gold_request_quoted_in_pln_makes_exactly_one_request_to_nbp(owner, providers):
    owner.get(f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF)
    assert providers.requests == ["nbp"]


def test_the_quote_leg_reuses_the_table_in_flight_when_asof_is_the_requested_date(
    owner, providers
):
    owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    assert sorted(providers.requests) == ["frankfurter", "nbp"]


def test_the_quote_leg_waits_for_nbp_and_gets_only_a_table_for_its_own_asof(
    owner, providers
):
    providers.lag_days = 1
    providers.delay = {"nbp": 0.2}
    owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    assert sorted(providers.requests) == ["frankfurter", "frankfurter", "nbp"]
    nbp = next(at for provider, at, _ in providers.sent if provider == "nbp")
    table, leg = [at for provider, at, _ in providers.sent if provider == "frankfurter"]
    assert table < nbp + 0.1
    assert leg >= nbp + 0.2


def test_outbound_requests_run_on_threads_with_no_flask_context(owner, providers, monkeypatch):
    main = threading.current_thread()
    callers = []
    get_db = rates.get_db

    def spy():
        callers.append(threading.current_thread())
        return get_db()

    monkeypatch.setattr(rates, "get_db", spy)
    owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    assert providers.sent
    assert all(isolated for _, _, isolated in providers.sent)
    # Caching and composing ran, and only on the request's thread.
    assert callers
    assert all(caller is main for caller in callers)


def test_a_breaker_count_changed_from_many_threads_loses_no_update():
    breaker = rates._Breaker()

    def fail():
        for _ in range(2000):
            breaker.record_failure(10**9)

    threads = [threading.Thread(target=fail) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert breaker.failures == 8 * 2000


def test_a_lookup_finding_every_slot_taken_sends_nothing_and_answers_what_needs_no_source(
    owner, provider, monkeypatch
):
    slots = threading.BoundedSemaphore(rates.LOOKUP_CONCURRENCY)
    monkeypatch.setattr(rates, "_lookup_slots", slots)
    provider.answers["frankfurter"] = fx(PAST, {"USD": 1.0876})
    for _ in range(rates.LOOKUP_CONCURRENCY):
        slots.acquire()

    single = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    identity = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=CHF", headers=CSRF)
    assert single.status_code == 204
    assert identity.get_json()["rate"] == "1"
    assert provider.calls == []
    assert rates.breakers["frankfurter"].failures == 0

    slots.release()
    assert owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).status_code == 200
    assert provider.calls
