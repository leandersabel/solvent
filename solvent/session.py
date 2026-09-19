"""Reading the session cookie (spec/architecture.md, Application
hardening; spec/features/app-shell.md, Database).

Sessions are server-side rows; the cookie carries only a signed opaque
token, never key material or a user id. Issuing a session -- minting its
token, setting the cookie after a successful Auth Key check, rotating
the id on login, enforcing the 12-hour lifetime as a write-side concern
-- belongs to login.md. This module builds only what the shell needs to
*read* one back: verify the cookie's signature, look its hash up, and
treat a session past the absolute lifetime as though it were absent.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import flask
from flask import current_app, g, request
from itsdangerous import BadSignature, Signer

from .db import get_db

COOKIE_NAME = "solvent_session"
_SIGNING_SALT = "solvent-session-cookie"

# Architecture.md, Application hardening: the absolute 12-hour expiry.
# Renewing/expiring the row itself belongs to login.md; the shell only
# needs the duration to tell a valid session from an expired one on read.
SESSION_LIFETIME = timedelta(hours=12)


def _signer() -> Signer:
    return Signer(current_app.config["SECRET_KEY"], salt=_SIGNING_SALT)


def hash_token(raw_token: str) -> str:
    """The value stored in `sessions.token_hash` -- the server looks a
    session up by this hash, never by the raw token (architecture.md,
    Application hardening)."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def sign_token(raw_token: str) -> str:
    """Sign a raw session token for use as the cookie's value.

    Exposed so login.md's implementation (and this feature's own tests,
    which stand in for it) build a cookie the way `load_into_g` expects
    to read one back.
    """
    return _signer().sign(raw_token.encode("utf-8")).decode("utf-8")


def set_session_cookie(response: flask.Response, raw_token: str) -> None:
    """Set the session cookie with its pinned flags
    (architecture.md, Application hardening): HttpOnly, Secure,
    SameSite=Lax, carrying only the signed opaque token."""
    response.set_cookie(
        COOKIE_NAME,
        sign_token(raw_token),
        httponly=True,
        secure=True,
        samesite="Lax",
    )


def load_into_g() -> bool:
    """Resolve the request's cookie to a session + user, if valid.

    On success, populates `flask.g.session` (`{"id", "user_id"}`) and
    `flask.g.user` (`{"username", "is_admin"}`) and returns True.

    Returns False -- leaving both None -- for a missing cookie, a bad
    signature, a token whose hash matches no row, or a session past the
    absolute lifetime. These four are handled identically on purpose:
    app-shell.md's CSRF rule requires the response to a request missing
    the CSRF header to be indistinguishable regardless of which of these
    is true.
    """
    g.session = None
    g.user = None

    raw_cookie = request.cookies.get(COOKIE_NAME)
    if not raw_cookie:
        return False

    try:
        raw_token = _signer().unsign(raw_cookie).decode("utf-8")
    except BadSignature:
        return False

    token_hash = hash_token(raw_token)
    row = (
        get_db()
        .execute(
            "SELECT sessions.id AS session_id, sessions.issued_at,"
            "       users.id AS user_id, users.username, users.is_admin "
            "FROM sessions JOIN users ON users.id = sessions.user_id "
            "WHERE sessions.token_hash = ?",
            (token_hash,),
        )
        .fetchone()
    )
    if row is None:
        return False

    issued_at = datetime.fromisoformat(row["issued_at"])
    if issued_at.tzinfo is None:
        issued_at = issued_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - issued_at > SESSION_LIFETIME:
        return False

    g.session = {"id": row["session_id"], "user_id": row["user_id"]}
    g.user = {"username": row["username"], "is_admin": bool(row["is_admin"])}
    return True
