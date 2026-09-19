"""CSRF-before-auth (spec/features/app-shell.md, CSRF, Edge cases,
Acceptance criteria).

The header check runs before authentication, so a request missing it
must be indistinguishable across a valid, an expired, and an absent
session -- observable only by comparing all three, not by testing one
session state in isolation (spec/.compiled/app-shell.json, verify.focus).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from solvent.csrf import HEADER_NAME, csrf_exempt
from tests.helpers import seed_session, seed_user


@pytest.fixture
def wired_app(app):
    @app.route("/__test/api/state-changing", methods=["POST"])
    def state_changing():
        return {"changed": True}, 200

    @app.route("/api/export", methods=["GET"])
    def export_stand_in():
        # A stand-in for the real GET /api/export (export-import.md),
        # to exercise app-shell's "GET /api/export without the header
        # returns Forbidden" criterion at this layer, ahead of that
        # feature existing.
        return {"exported": True}, 200

    @app.route("/__test/shell/page")
    @csrf_exempt
    def shell_page():
        return "<html>shell page</html>", 200

    @app.route("/__test/shell/action", methods=["POST"])
    def shell_prefix_non_exempt():
        # Same URL prefix as the exempt page above, but not itself
        # named exempt -- an exemption is a named route, never a path
        # pattern, so this must still reject.
        return {"changed": True}, 200

    return app


def test_state_changing_request_without_header_is_forbidden(wired_app):
    client = wired_app.test_client()
    resp = client.post("/__test/api/state-changing")
    assert resp.status_code == 403


def test_get_api_export_without_header_is_forbidden(wired_app):
    client = wired_app.test_client()
    resp = client.get("/api/export")
    assert resp.status_code == 403


def test_shell_navigation_route_loads_without_header(wired_app):
    client = wired_app.test_client()
    resp = client.get("/__test/shell/page")
    assert resp.status_code == 200


def test_non_exempt_route_under_same_prefix_still_rejects(wired_app):
    client = wired_app.test_client()
    resp = client.post("/__test/shell/action")
    assert resp.status_code == 403


def test_static_assets_load_with_no_header_and_no_session(wired_app):
    """No browser attaches a custom header to a subresource request, so
    a shell page could not load its own stylesheet or scripts
    (app-shell.md, CSRF)."""
    client = wired_app.test_client()
    for asset in (
        "/static/css/tokens.css",
        "/static/js/shell.js",
        "/static/vendor/alpinejs-csp/3.15.12/cdn.min.js",
    ):
        assert client.get(asset).status_code == 200, asset


def test_header_less_request_does_not_reveal_whether_a_route_exists(
    wired_app,
):
    """The check runs before routing, so Forbidden is the answer either
    way and a probe cannot map the route table (app-shell.md, CSRF)."""
    client = wired_app.test_client()
    existing = client.post("/__test/api/state-changing")
    unknown = client.post("/__test/api/no-such-endpoint")

    assert existing.status_code == unknown.status_code == 403
    assert existing.data == unknown.data


def test_present_header_but_no_session_is_unauthorized(wired_app):
    client = wired_app.test_client()
    resp = client.post(
        "/__test/api/state-changing", headers={HEADER_NAME: "1"}
    )
    assert resp.status_code == 401


def test_missing_header_is_byte_identical_across_session_states(wired_app):
    user_id = seed_user(wired_app, "carol")
    valid_cookie = seed_session(wired_app, user_id)
    expired_cookie = seed_session(
        wired_app,
        user_id,
        issued_at=datetime.now(timezone.utc) - timedelta(hours=13),
    )

    client_absent = wired_app.test_client()
    resp_absent = client_absent.post("/__test/api/state-changing")

    client_valid = wired_app.test_client()
    client_valid.set_cookie("solvent_session", valid_cookie)
    resp_valid = client_valid.post("/__test/api/state-changing")

    client_expired = wired_app.test_client()
    client_expired.set_cookie("solvent_session", expired_cookie)
    resp_expired = client_expired.post("/__test/api/state-changing")

    responses = (resp_absent, resp_valid, resp_expired)
    assert all(r.status_code == 403 for r in responses)
    assert len({r.data for r in responses}) == 1

    def comparable_headers(resp):
        # Date legitimately varies per response; everything else must
        # not, since the caller learns nothing about session state.
        return {k: v for k, v in resp.headers.items() if k != "Date"}

    header_sets = [comparable_headers(r) for r in responses]
    assert header_sets[0] == header_sets[1] == header_sets[2]


def test_valid_header_still_distinguishes_session_states_afterwards(wired_app):
    """The indistinguishability rule is specifically about the missing-
    header case (app-shell.md, CSRF). Once the header is present,
    valid/expired/absent sessions diverge again: 200/401/401."""
    user_id = seed_user(wired_app, "dana")
    valid_cookie = seed_session(wired_app, user_id)
    expired_cookie = seed_session(
        wired_app,
        user_id,
        issued_at=datetime.now(timezone.utc) - timedelta(hours=13),
    )

    client_valid = wired_app.test_client()
    client_valid.set_cookie("solvent_session", valid_cookie)
    resp_valid = client_valid.post(
        "/__test/api/state-changing", headers={HEADER_NAME: "1"}
    )
    assert resp_valid.status_code == 200

    client_expired = wired_app.test_client()
    client_expired.set_cookie("solvent_session", expired_cookie)
    resp_expired = client_expired.post(
        "/__test/api/state-changing", headers={HEADER_NAME: "1"}
    )
    assert resp_expired.status_code == 401

    client_absent = wired_app.test_client()
    resp_absent = client_absent.post(
        "/__test/api/state-changing", headers={HEADER_NAME: "1"}
    )
    assert resp_absent.status_code == 401
