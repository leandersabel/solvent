"""The request gate: the header for an API request, authentication, the
refusal a caller learns nothing from, and the surface split
(spec/features/app-shell.md, The request gate and The two surfaces).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from solvent.guard import ADMINISTRATION, SHARED, UNPLACED, VAULT, surface_of
from solvent.session import COOKIE_NAME
from tests.helpers import CSRF, connect, register


def fingerprint(response):
    """What a caller can observe. If the check really precedes
    authentication and routing, these are byte-identical across every
    session state and every path."""
    return (
        response.status_code,
        response.get_data(),
        tuple(sorted((k, v) for k, v in response.headers if k != "Date")),
    )


@pytest.fixture
def sessions(app):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    return {"owner": owner, "admin": admin}


def expired_client(app):
    owner, _ = register(app, "stale")
    conn = connect(app)
    try:
        conn.execute(
            "UPDATE sessions SET issued_at = ?",
            ((datetime.now(timezone.utc) - timedelta(hours=13)).isoformat(),),
        )
        conn.commit()
    finally:
        conn.close()
    return owner


def test_header_present_and_no_session_is_unauthorized(client):
    assert client.get("/api/records?type=account", headers=CSRF).status_code == 401


def test_shell_pages_load_without_the_header(sessions):
    assert sessions["owner"].get("/dashboard").status_code == 200


def test_export_requires_the_header_despite_being_a_get(sessions):
    """With SameSite=Lax a top-level navigation sends the cookie, so a
    hostile link would otherwise drop the victim's whole encrypted
    vault into their own Downloads."""
    assert sessions["owner"].get("/api/export").status_code == 403
    assert sessions["owner"].get("/api/export", headers=CSRF).status_code == 200


def test_static_assets_need_no_header_and_no_session(client):
    for path in (
        "/static/css/tokens.css",
        "/static/js/shell.js",
        "/static/vendor/alpinejs-csp/3.15.12/cdn.min.js",
    ):
        response = client.get(path)
        assert response.status_code == 200, path
        assert "Content-Security-Policy" in response.headers


def test_an_exemption_is_a_named_route_not_a_prefix(sessions):
    """/settings is exempt and /api/sessions is not, so a pattern-based
    implementation passes the first half and fails here."""
    assert sessions["owner"].get("/settings").status_code == 302
    assert sessions["owner"].get("/api/sessions").status_code == 403


def test_every_registered_route_is_placed_in_a_surface(app):
    unplaced = [
        rule.rule
        for rule in app.url_map.iter_rules()
        if surface_of(str(rule)) == UNPLACED
    ]
    assert unplaced == []


def test_each_kind_gets_not_found_from_the_other_surface(app, sessions):
    """Enumerated at test time rather than from a fixed list, so a
    route added later is covered by this test instead of exempt from
    it."""
    checked = 0
    for rule in app.url_map.iter_rules():
        surface = surface_of(str(rule))
        if surface == SHARED or "<" in rule.rule:
            continue
        wrong = sessions["admin"] if surface == VAULT else sessions["owner"]
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            response = wrong.open(rule.rule, method=method, headers=CSRF, json={})
            assert response.status_code == 404, (rule.rule, method, response.status_code)
            checked += 1
    assert checked


def test_an_administrator_gets_not_found_from_records_not_an_empty_list(sessions):
    """An empty list is the plausible wrong answer and it passes any
    test that only checks no other vault's rows came back."""
    response = sessions["admin"].get("/api/records?type=account", headers=CSRF)
    assert response.status_code == 404
    assert response.get_json() != []


def test_an_administrator_reaches_change_password_and_not_settings(sessions):
    assert sessions["admin"].get("/settings").status_code == 404
    assert sessions["admin"].get("/settings/export-import").status_code == 404
    assert sessions["admin"].get("/api/sessions", headers=CSRF).status_code == 404
    assert sessions["admin"].post("/api/auth/logout-all", json={}, headers=CSRF).status_code == 404
    # Reached, and refused on its body rather than on the surface.
    assert sessions["admin"].post(
        "/api/auth/change-password", json={}, headers=CSRF
    ).status_code == 400


def test_the_root_path_resolves_by_kind(sessions):
    assert sessions["owner"].get("/").headers["Location"] == "/dashboard"
    assert sessions["admin"].get("/").headers["Location"] == "/admin"


def test_the_admin_surface_is_a_prefix_not_a_list():
    assert surface_of("/api/admin/something-nobody-has-written-yet") == ADMINISTRATION
    assert surface_of("/api/auth/logout") == SHARED
    assert surface_of("/api/auth/logout-all") == VAULT


def test_a_vault_page_carries_its_own_sign_in_card(client):
    """The one derivation that buys a session buys the keys with it.
    Bouncing through a separate address would cost that wait twice, on
    the screen the wait defines."""
    response = client.get("/dashboard")
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    # No chrome, because there is no kind to draw one for.
    assert "Update values" not in body
    assert "Sign out" not in body
    assert 'id="app"' in body

    assert client.get("/").headers["Location"] == "/dashboard"


def test_the_vault_surface_is_one_page(client):
    """Settings and the screens reached from it are views of the
    dashboard, not pages of their own: the keys live in one page's memory, and a second page
    would charge the derivation again."""
    for path, target in (
        ("/settings", "/dashboard#/settings"),
        ("/settings/dimensions", "/dashboard#/settings/dimensions"),
        ("/settings/export-import", "/dashboard#/settings/export-import"),
    ):
        response = client.get(path)
        assert response.status_code == 302, path
        assert response.headers["Location"] == target


def test_the_admin_area_is_not_confirmed_to_anyone_who_may_not_reach_it(app, client):
    """A caller past the header gets the answer an unknown path gives,
    whether they hold a vault owner's session or none at all. The
    vault pages carry a sign-in card instead, because those are the
    ones a person is meant to be able to navigate to."""
    owner, _ = register(app, "owner")
    unknown = client.get("/nope", headers=CSRF)
    for caller in (client, owner):
        answer = caller.get("/admin", headers=CSRF)
        assert answer.status_code == unknown.status_code == 404
        assert answer.get_data() == unknown.get_data()


def test_every_json_endpoint_still_answers_unauthorized(app, client):
    """Which is what the client branches on, so the redirect above
    must not reach one."""
    checked = 0
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/") or "<" in rule.rule:
            continue
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            response = client.open(rule.rule, method=method, headers=CSRF, json={})
            # The pre-authentication endpoints are the exception, by
            # definition: they exist to get a session.
            if surface_of(str(rule)) == SHARED and response.status_code != 401:
                continue
            assert response.status_code == 401, (rule.rule, method, response.status_code)
            checked += 1
    assert checked


# ---- The refusal fingerprint matrix (app-shell.md, The request gate) ----

NO_VALID_SESSION = ("absent", "expired")
REFUSED = (401, 403, 404)
# Named by the spec's Public list, not derived from the gate under test.
PUBLIC_API = {
    "/api/register",
    "/api/auth/salt",
    "/api/auth/login",
    "/api/auth/logout",
}
PAGE_PROBES = (
    ("GET", "/some-invented-page"),
    ("GET", "//admin"),
    ("GET", "/admin/"),
    ("GET", "/favicon.ico"),
    ("POST", "/login"),
    ("PUT", "/dashboard"),
    ("OPTIONS", "/login"),
)
API_PROBES = (
    ("GET", "/api/invented"),
    ("GET", "/api/admin/invented"),
    ("GET", "/api/auth/login"),
    ("DELETE", "/api/auth/salt"),
    ("OPTIONS", "/api/auth/login"),
    ("OPTIONS", "/api/admin/invites"),
)
# Nothing a route sets for itself, and nothing that names the route.
ABSENT_FROM_A_REFUSAL = ("Set-Cookie", "Allow", "Location", "Cache-Control", "Referrer-Policy")


class Matrix:
    """Every request made from the same database, with the session
    carried as a bare cookie, so a request that signs out or deletes
    an account changes nothing for the next."""

    def __init__(self, app, cookies):
        self.app = app
        self.cookies = cookies
        self.snapshot = Path(app.config["DATABASE_PATH"]).read_bytes()

    def send(self, state, method, path, header):
        Path(self.app.config["DATABASE_PATH"]).write_bytes(self.snapshot)
        headers = dict(CSRF) if header else {}
        if self.cookies[state]:
            headers["Cookie"] = f"{COOKIE_NAME}={self.cookies[state]}"
        client = self.app.test_client(use_cookies=False)
        # The test client reads a leading `//` as a host, so the path
        # the server is handed is set on the environ instead.
        if path.startswith("//"):
            return client.open("/", method=method, headers=headers, json={},
                               environ_overrides={"PATH_INFO": path})
        return client.open(path, method=method, headers=headers, json={})


@pytest.fixture
def matrix(app):
    # The expired session is made first: the update below ages every
    # session that exists.
    stale, _ = register(app, "stale")
    conn = connect(app)
    try:
        conn.execute(
            "UPDATE sessions SET issued_at = ?",
            ((datetime.now(timezone.utc) - timedelta(hours=13)).isoformat(),),
        )
        conn.commit()
    finally:
        conn.close()
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    return Matrix(app, {
        "absent": None,
        "expired": stale.get_cookie(COOKIE_NAME).value,
        "owner": owner.get_cookie(COOKIE_NAME).value,
        "admin": admin.get_cookie(COOKIE_NAME).value,
    })


def a_refusal(response):
    return response.status_code in REFUSED and response.mimetype == "text/html"


def concrete(rule):
    return re.sub(r"<[^>]+>", "x", rule.rule)


def answered_methods(rule):
    return sorted(rule.methods - {"HEAD"})


def test_a_page_probe_is_refused_identically_in_every_cell(matrix):
    """The same Not Found for an invented path, a path the router would
    redirect, a method no route answers and OPTIONS, with or without
    the header, whatever the session. This is the cell that leaked: a
    browser navigation to /admin read as 404 and an invented path as
    403."""
    seen = {
        (state, header, method, path): fingerprint(matrix.send(state, method, path, header))
        for state in matrix.cookies
        for header in (False, True)
        for method, path in PAGE_PROBES
    }
    assert {key: fp[0] for key, fp in seen.items()} == {key: 404 for key in seen}
    assert len(set(seen.values())) == 1


def test_an_api_probe_is_refused_by_header_then_session(matrix):
    cells = {}
    for state in matrix.cookies:
        for header in (False, True):
            for method, path in API_PROBES:
                cells[(state, header, method, path)] = fingerprint(
                    matrix.send(state, method, path, header)
                )

    def of(*, header, states):
        return {fp for (state, h, *_), fp in cells.items() if h is header and state in states}

    forbidden = of(header=False, states=matrix.cookies)
    unauthorized = of(header=True, states=NO_VALID_SESSION)
    not_found = of(header=True, states=("owner", "admin"))
    assert [len(group) for group in (forbidden, unauthorized, not_found)] == [1, 1, 1]
    assert [next(iter(g))[0] for g in (forbidden, unauthorized, not_found)] == [403, 401, 404]

    # A page and an API route answer the same Not Found, so a probe
    # cannot tell which namespace it reached by its body.
    page_missing = fingerprint(matrix.send("owner", "GET", "/some-invented-page", True))
    assert not_found == {page_missing}


def test_a_refusal_carries_nothing_a_route_sets_for_itself(matrix):
    for state in matrix.cookies:
        for header in (False, True):
            for method, path in PAGE_PROBES + API_PROBES:
                response = matrix.send(state, method, path, header)
                assert response.status_code in REFUSED, (state, header, method, path)
                for name in ABSENT_FROM_A_REFUSAL:
                    assert name not in response.headers, (state, header, method, path, name)


def test_every_registered_route_is_refused_like_every_other(app, matrix):
    """The route map is read at test time, so a route added later joins
    the matrix instead of being exempt from it. Whatever is refused,
    under a given status, is one response."""
    refusals: "dict[int, set]" = {}
    for rule in app.url_map.iter_rules():
        for method in answered_methods(rule):
            for state in matrix.cookies:
                for header in (False, True):
                    response = matrix.send(state, method, concrete(rule), header)
                    assert response.status_code != 405, (rule.rule, method, state, header)
                    assert "Allow" not in response.headers, (rule.rule, method)
                    if a_refusal(response):
                        refusals.setdefault(response.status_code, set()).add(fingerprint(response))
    assert set(refusals) == set(REFUSED)
    assert [len(group) for group in refusals.values()] == [1, 1, 1]


def test_every_api_route_is_forbidden_without_the_header_and_unauthorized_without_a_session(app, matrix):
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/"):
            continue
        for method in answered_methods(rule):
            path = concrete(rule)
            for state in matrix.cookies:
                assert matrix.send(state, method, path, False).status_code == 403, (rule.rule, method, state)
            if rule.rule in PUBLIC_API:
                continue
            for state in NO_VALID_SESSION:
                assert matrix.send(state, method, path, True).status_code == 401, (rule.rule, method, state)


def test_the_namespace_invariant_holds_over_the_route_map(app, matrix):
    """Every route that needs the header is under /api/, every other
    route is exempt and answers only GET and HEAD, and no route answers
    OPTIONS."""
    for rule in app.url_map.iter_rules():
        path = concrete(rule)
        assert "OPTIONS" not in rule.methods, rule.rule
        if rule.rule.startswith("/api/"):
            continue
        assert rule.methods <= {"GET", "HEAD"}, rule.rule
        # Exempt: without the header and without a session it is never
        # Forbidden.
        assert matrix.send("absent", "GET", path, False).status_code != 403, rule.rule
    for rule in app.url_map.iter_rules():
        for state in matrix.cookies:
            for header in (False, True):
                response = matrix.send(state, "OPTIONS", concrete(rule), header)
                assert response.status_code in REFUSED, (rule.rule, state, header)


def test_the_router_does_not_merge_slashes(app):
    assert app.url_map.merge_slashes is False
