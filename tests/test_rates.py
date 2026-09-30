"""The conversion-rate proxy and the symbol table
(spec/features/rate-lookup.md).

Every test stubs the provider: nothing here reaches the network, which
is also what lets the SSRF assertions be about requests that were
never made.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

import solvent.rates as rates
from tests.helpers import CSRF, mint_invite, register


@pytest.fixture
def provider(monkeypatch):
    """A stubbed provider recording every URL the proxy would fetch."""
    calls = []
    answers = {}

    def fetch(url):
        calls.append(url)
        for fragment, payload in answers.items():
            if fragment in url:
                return payload(url) if callable(payload) else payload
        return None

    monkeypatch.setattr(rates, "_fetch_json", fetch)
    rates.breaker.record_success()
    return type("Provider", (), {"calls": calls, "answers": answers})()


def fx(on: str, table: dict) -> dict:
    return {"amount": 1, "base": "CHF", "date": on, "rates": table}


TODAY = date.today().isoformat()
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
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert owner.get(
        f"/api/rates?date={tomorrow}&quote=CHF", headers=CSRF
    ).status_code == 400


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


@pytest.mark.parametrize("bad", [0, -1, "not-a-number"])
def test_a_zero_negative_or_non_numeric_rate_is_no_proposal(owner, provider, bad):
    provider.answers["frankfurter"] = fx(PAST, {"USD": bad})
    assert owner.get(
        f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF
    ).status_code == 204


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


def test_the_circuit_breaker_opens_and_closes(app, owner, monkeypatch):
    app.config["RATE_BREAKER_FAILURES"] = 2
    attempts = []

    def failing(url, timeout=None):
        attempts.append(url)
        raise OSError("provider down")

    monkeypatch.setattr(rates._opener, "open", failing)
    rates.breaker.record_success()

    for _ in range(4):
        owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    opened = len(attempts)
    owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert len(attempts) == opened

    rates.breaker.record_success()
    owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert len(attempts) > opened


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

        def read(self, _size=None):
            return b"{}"

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
    rates.breaker.record_success()
    with scratch.app_context():
        rates._fetch_json("https://api.frankfurter.dev/v1/2026-01-01?base=CHF")

    assert seen[0].get_header("User-agent") == rates.USER_AGENT
