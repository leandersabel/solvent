"""The request gate: the CSRF header before authentication and before
routing, and the surface split after it (spec/features/app-shell.md,
CSRF and The two surfaces).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from solvent.guard import ADMINISTRATION, SHARED, UNPLACED, VAULT, surface_of
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


def test_missing_header_is_forbidden_across_every_session_state(app, sessions):
    """Asserted across a valid, an expired and an absent session,
    since the point of ordering the check first is that the three are
    indistinguishable."""
    seen = {
        name: fingerprint(client.get("/api/records?type=account"))
        for name, client in (
            ("valid", sessions["owner"]),
            ("expired", expired_client(app)),
            ("absent", app.test_client()),
        )
    }
    assert seen["valid"][0] == 403
    assert len(set(seen.values())) == 1, seen


def test_missing_header_is_forbidden_for_a_path_that_does_not_exist(app, sessions):
    """The same comparison across an existing and a non-existent path,
    which is what shows the check also precedes routing."""
    existing = fingerprint(sessions["owner"].get("/api/records?type=account"))
    missing = fingerprint(sessions["owner"].get("/api/no-such-route"))
    assert existing == missing


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
    assert sessions["owner"].get("/settings").status_code == 200
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
