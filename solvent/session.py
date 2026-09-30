"""Server-side session rows and the cookie that points at one
(spec/architecture.md, Application hardening).

The cookie carries a signed opaque token and nothing else: no key
material, no principal id. The server looks the session up by the
token's hash, so a valid signature alone is not a session. Kind is read
through `principal_id` rather than stored on the row, so a session can
never disagree with the account it belongs to.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import flask
from flask import current_app, g, request
from itsdangerous import BadSignature, Signer

from .db import get_db, utcnow

COOKIE_NAME = "solvent_session"
_SIGNING_SALT = "solvent-session-cookie"

# architecture.md, Application hardening: 12 hours after issue,
# absolute, not sliding. Both kinds.
SESSION_LIFETIME = timedelta(hours=12)


def _signer() -> Signer:
    return Signer(current_app.config["SECRET_KEY"], salt=_SIGNING_SALT)


def hash_token(raw_token: str) -> str:
    """The value stored in `sessions.token_hash`. The server looks a
    session up by this hash, never by the raw token."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def sign_token(raw_token: str) -> str:
    return _signer().sign(raw_token.encode("utf-8")).decode("utf-8")


def issue(principal_id: str) -> str:
    """Write a session row and return the raw token for its cookie.

    Called on a successful login and on registration. The caller sets
    the cookie, which is the only place the token is handed out.
    """
    raw_token = secrets.token_urlsafe(32)
    now = utcnow()
    get_db().execute(
        "INSERT INTO sessions "
        "(id, token_hash, principal_id, issued_at, last_active_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (secrets.token_hex(16), hash_token(raw_token), principal_id, now, now),
    )
    return raw_token


def set_cookie(response: flask.Response, raw_token: str) -> None:
    """Set the session cookie with its pinned flags: HttpOnly, Secure,
    SameSite=Lax, carrying only the signed opaque token."""
    response.set_cookie(
        COOKIE_NAME,
        sign_token(raw_token),
        httponly=True,
        secure=True,
        samesite="Lax",
    )


def clear_cookie(response: flask.Response) -> None:
    response.delete_cookie(COOKIE_NAME, httponly=True, secure=True, samesite="Lax")


def revoke_current() -> None:
    if g.get("session"):
        get_db().execute("DELETE FROM sessions WHERE id = ?", (g.session["id"],))


def load_into_g() -> bool:
    """Resolve the request's cookie to a session and its principal.

    On success populates `flask.g.session` and `flask.g.principal` and
    returns True. Returns False, leaving both None, for a missing
    cookie, a bad signature, a token matching no row, or a session past
    the absolute lifetime. Those four are handled identically on
    purpose: app-shell.md's CSRF rule requires the response to a
    header-less request to be the same whichever one holds.
    """
    g.session = None
    g.principal = None

    raw_cookie = request.cookies.get(COOKIE_NAME)
    if not raw_cookie:
        return False

    try:
        raw_token = _signer().unsign(raw_cookie).decode("utf-8")
    except BadSignature:
        return False

    row = (
        get_db()
        .execute(
            "SELECT sessions.id AS session_id, sessions.issued_at, "
            "       principals.id AS principal_id, principals.username, "
            "       principals.kind "
            "FROM sessions JOIN principals "
            "  ON principals.id = sessions.principal_id "
            "WHERE sessions.token_hash = ?",
            (hash_token(raw_token),),
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

    g.session = {"id": row["session_id"]}
    g.principal = {
        "id": row["principal_id"],
        "username": row["username"],
        "kind": row["kind"],
    }
    return True


def touch() -> None:
    """`last_active_at` is written on every authenticated request, not
    only read: it is what `GET /api/sessions` reports."""
    get_db().execute(
        "UPDATE sessions SET last_active_at = ? WHERE id = ?",
        (utcnow(), g.session["id"]),
    )
