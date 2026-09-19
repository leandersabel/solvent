"""Reading and writing the session cookie (spec/architecture.md,
Application hardening).

`set_session_cookie` is what login.md will call. Its flags are a hard
requirement rather than a convention, so they are asserted here even
though no route sets a cookie yet.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import flask

from solvent.session import COOKIE_NAME, load_into_g, set_session_cookie
from tests.helpers import seed_session, seed_user


def test_session_cookie_carries_its_pinned_flags(app):
    with app.test_request_context():
        response = flask.Response()
        set_session_cookie(response, "a-raw-session-token")

    header = response.headers["Set-Cookie"]
    assert header.startswith(f"{COOKIE_NAME}=")
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "SameSite=Lax" in header
    # The cookie carries a signed token and nothing else: no key
    # material of any kind rides in it.
    assert app.config["SECRET_KEY"] not in header


def test_a_valid_cookie_resolves_to_its_user(app):
    user_id = seed_user(app, "alice", is_admin=True)
    cookie = seed_session(app, user_id)

    with app.test_request_context(headers={"Cookie": f"{COOKIE_NAME}={cookie}"}):
        assert load_into_g() is True
        assert flask.g.user == {"username": "alice", "is_admin": True}
        assert flask.g.session["user_id"] == user_id


def test_absent_tampered_and_expired_cookies_are_all_refused(app):
    """The CSRF rule needs these indistinguishable, so `load_into_g`
    answers the same way for every one (session.py, load_into_g)."""
    user_id = seed_user(app, "bob")
    valid = seed_session(app, user_id)
    expired = seed_session(
        app,
        user_id,
        issued_at=datetime.now(timezone.utc) - timedelta(hours=13),
    )
    tampered = valid[:-1] + ("A" if valid[-1] != "A" else "B")

    for cookie in (None, tampered, expired, "not-even-signed"):
        headers = {} if cookie is None else {"Cookie": f"{COOKIE_NAME}={cookie}"}
        with app.test_request_context(headers=headers):
            assert load_into_g() is False
            assert flask.g.user is None
            assert flask.g.session is None
