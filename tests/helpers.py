"""Test-only fixtures for rows that login.md/register.md will own once
built. The shell only ever *reads* a session, so its own tests seed
users and sessions directly rather than depending on unbuilt features.
"""
from __future__ import annotations

import secrets
import sqlite3
from datetime import datetime, timezone

import flask

from solvent.session import hash_token, sign_token


def _connect(app: flask.Flask) -> sqlite3.Connection:
    return sqlite3.connect(app.config["DATABASE_PATH"])


def seed_user(app: flask.Flask, username: str, *, is_admin: bool = False) -> int:
    conn = _connect(app)
    try:
        cur = conn.execute(
            "INSERT INTO users (username, is_admin) VALUES (?, ?)",
            (username, int(is_admin)),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def seed_session(
    app: flask.Flask,
    user_id: int,
    *,
    issued_at: "datetime | None" = None,
) -> str:
    """Insert a session row and return the signed cookie value a real
    login would have set for it."""
    raw_token = secrets.token_urlsafe(32)
    issued_at = issued_at or datetime.now(timezone.utc)

    conn = _connect(app)
    try:
        conn.execute(
            "INSERT INTO sessions "
            "(id, token_hash, user_id, issued_at, last_active_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                secrets.token_hex(16),
                hash_token(raw_token),
                user_id,
                issued_at.isoformat(),
                issued_at.isoformat(),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    with app.app_context():
        return sign_token(raw_token)
