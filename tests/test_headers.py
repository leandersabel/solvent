"""Header-parity: every response shape carries the same CSP/HSTS, and no
separate X-Frame-Options is served (spec/features/app-shell.md, Response
headers; Acceptance criteria).

Fixture routes cover all four response shapes the acceptance criterion
names -- a shell page, a JSON endpoint, a 404, and a 500 -- so this
can't be faked by asserting one happy-path route alone
(spec/.compiled/app-shell.json, verify.focus).
"""
from __future__ import annotations

import pytest

from solvent.csrf import HEADER_NAME, csrf_exempt
from solvent.headers import CSP
from tests.helpers import seed_session, seed_user


@pytest.fixture
def wired_app(app):
    @app.route("/__test/shell-page")
    @csrf_exempt
    def shell_page():
        return "<html><body>shell page</body></html>", 200

    @app.route("/__test/json")
    def json_endpoint():
        return {"ok": True}, 200

    @app.route("/__test/boom")
    def boom():
        raise RuntimeError("stubbed unhandled failure")

    return app


def _auth_headers():
    return {HEADER_NAME: "1"}


def _assert_security_headers(response):
    assert response.headers.get("Content-Security-Policy") == CSP
    hsts = response.headers.get("Strict-Transport-Security")
    assert hsts is not None
    assert "includeSubDomains" in hsts
    assert "X-Frame-Options" not in response.headers


def test_shell_page_carries_csp_and_hsts(wired_app):
    client = wired_app.test_client()
    resp = client.get("/__test/shell-page")
    assert resp.status_code == 200
    _assert_security_headers(resp)


def test_json_endpoint_carries_csp_and_hsts(wired_app):
    user_id = seed_user(wired_app, "alice")
    cookie = seed_session(wired_app, user_id)

    client = wired_app.test_client()
    client.set_cookie("solvent_session", cookie)
    resp = client.get("/__test/json", headers=_auth_headers())

    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}
    _assert_security_headers(resp)


def test_unknown_path_carries_csp_and_hsts(wired_app):
    client = wired_app.test_client()
    resp = client.get("/__test/this-route-does-not-exist")
    assert resp.status_code == 404
    _assert_security_headers(resp)


def test_server_error_carries_csp_and_hsts(wired_app):
    user_id = seed_user(wired_app, "bob")
    cookie = seed_session(wired_app, user_id)

    client = wired_app.test_client()
    client.set_cookie("solvent_session", cookie)
    resp = client.get("/__test/boom", headers=_auth_headers())

    assert resp.status_code == 500
    # Never leaks the exception's message/traceback into the body.
    assert b"RuntimeError" not in resp.data
    assert b"stubbed unhandled failure" not in resp.data
    _assert_security_headers(resp)
