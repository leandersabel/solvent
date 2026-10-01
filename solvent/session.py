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


def is_live(issued_at: str) -> bool:
    """Not past the absolute expiry, which counts from `issued_at`."""
    issued = datetime.fromisoformat(issued_at)
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - issued <= SESSION_LIFETIME


def start(conn, principal_id: str, now: str | None = None) -> str:
    """Start the session a successful sign-in, unlock or registration
    holds and return the raw token for its cookie, which is new every
    time (spec/features/login.md, The session a sign-in issues).

    This is the one writer of `principals.last_login_at`. A caller that
    already holds a clock reading for the same event passes it as `now`.

    A live session of the same account keeps its row, `id` and
    `issued_at`, so an unlock adds nothing and does not slide the expiry.
    A live session of another account is deleted. The account's expired
    rows go in every case. Call it only once the credential has been
    verified, inside the caller's transaction.
    """
    now = now or utcnow()
    conn.execute(
        "UPDATE principals SET last_login_at = ? WHERE id = ?", (now, principal_id)
    )
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_token(raw_token)

    for row in conn.execute(
        "SELECT id, issued_at FROM sessions WHERE principal_id = ?", (principal_id,)
    ).fetchall():
        if not is_live(row["issued_at"]):
            conn.execute("DELETE FROM sessions WHERE id = ?", (row["id"],))

    carried = g.session
    if carried and g.principal["id"] == principal_id:
        # The row may have expired or been revoked since the request began.
        if conn.execute(
            "UPDATE sessions SET token_hash = ? WHERE id = ?", (token_hash, carried["id"])
        ).rowcount:
            return raw_token
    elif carried:
        conn.execute("DELETE FROM sessions WHERE id = ?", (carried["id"],))

    conn.execute(
        "INSERT INTO sessions "
        "(id, token_hash, principal_id, issued_at, last_active_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (secrets.token_hex(16), token_hash, principal_id, now, now),
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

    if not is_live(row["issued_at"]):
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
