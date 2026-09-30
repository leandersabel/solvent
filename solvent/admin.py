"""Provisioning: single-use invite links, the account list, and account
removal (spec/features/admin-invites.md).

The whole surface is administrator-only, and guard.py answers a vault
owner Not Found before any handler here runs. No endpoint under
`/api/admin/` returns any field of any account's credential row, any
wrapper, or any record ciphertext. That is the admin boundary, and it
is what a new administrator task is judged against rather than against
the tasks that came before it.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from flask import Blueprint, abort, g, jsonify, request

from . import crypto
from .db import get_db, utcnow, write_transaction
from .validation import Payload, normalize_username, parse
from pydantic import Field

bp = Blueprint("admin", __name__)

DEFAULT_EXPIRY_DAYS = 7


class InviteCreate(Payload):
    # Required and without a default, because the two outcomes are
    # different kinds of account rather than one with an extra power,
    # and a caller that does not say which it wants has not said enough.
    kind: Literal["vault_owner", "administrator"]
    expiresInDays: int = Field(default=DEFAULT_EXPIRY_DAYS, ge=1, le=30)
    label: str = Field(default="", max_length=120)


class AccountDelete(Payload):
    confirmUsername: str


def mint_invite(conn, kind: str, expires_in_days: int, label: str, created_by: str):
    """Write an invite row and return it with its one-time token.

    256 bits from `secrets.token_urlsafe`. The plaintext is returned
    here and nowhere else, ever.
    """
    token = secrets.token_urlsafe(32)
    invite_id = uuid.uuid4().hex
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=expires_in_days)
    ).isoformat(timespec="seconds")
    conn.execute(
        "INSERT INTO invites (id, token_hash, kind, created_by, created_at, "
        "expires_at, status, label) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
        (
            invite_id,
            crypto.hash_invite_token(token),
            kind,
            created_by,
            utcnow(),
            expires_at,
            label,
        ),
    )
    return {"id": invite_id, "token": token, "expiresAt": expires_at, "kind": kind}


def _status_of(row) -> str:
    """`expired` is derived from `expires_at` rather than stored, so it
    cannot drift."""
    if row["status"] == "pending" and datetime.fromisoformat(
        row["expires_at"]
    ) <= datetime.now(timezone.utc):
        return "expired"
    return row["status"]


@bp.post("/api/admin/invites")
def create_invite():
    body = parse(InviteCreate, request.get_json(silent=True))
    with write_transaction() as conn:
        invite = mint_invite(
            conn, body.kind, body.expiresInDays, body.label, g.principal["username"]
        )
    invite["url"] = request.host_url.rstrip("/") + "/register?invite=" + invite["token"]
    return jsonify(invite), 201


@bp.get("/api/admin/invites")
def list_invites():
    """Never the token or its hash, and never `created_by`: every
    administrator can do everything any other can, so naming one on a
    row sorts the rows by a distinction that changes nothing."""
    rows = get_db().execute(
        "SELECT * FROM invites ORDER BY created_at DESC"
    ).fetchall()
    return jsonify(
        [
            {
                "id": row["id"],
                "label": row["label"],
                "kind": row["kind"],
                "createdAt": row["created_at"],
                "expiresAt": row["expires_at"],
                "status": _status_of(row),
                "usedAt": row["used_at"],
                "usedBy": row["used_by"],
            }
            for row in rows
        ]
    )


@bp.post("/api/admin/invites/<invite_id>/revoke")
def revoke_invite(invite_id: str):
    """Idempotent on an already-revoked invite; refused on a used one,
    where deleting the resulting account is the remedy."""
    with write_transaction() as conn:
        row = conn.execute(
            "SELECT * FROM invites WHERE id = ?", (invite_id,)
        ).fetchone()
        if row is None:
            abort(404)
        if row["status"] == "used":
            abort(409)
        conn.execute(
            "UPDATE invites SET status = 'revoked' WHERE id = ?", (invite_id,)
        )
    return jsonify({"id": invite_id, "status": "revoked"})


@bp.get("/api/admin/accounts")
def list_accounts():
    """Both kinds, because an administrator needs to see the other
    administrators to know whether they are the last one.

    `recordCount` is absent for an administrator rather than zero: zero
    and "has no vault" are different statements, and a zero invites the
    reader to think the vault is empty when the point is that there is
    none.
    """
    rows = get_db().execute(
        "SELECT principals.*, "
        "  (SELECT COUNT(*) FROM records "
        "   WHERE records.principal_id = principals.id) AS record_count "
        "FROM principals ORDER BY principals.username"
    ).fetchall()
    accounts = []
    for row in rows:
        account = {
            "username": row["username"],
            "kind": row["kind"],
            "createdAt": row["created_at"],
            "lastLoginAt": row["last_login_at"],
        }
        if row["kind"] == "vault_owner":
            account["recordCount"] = row["record_count"]
        accounts.append(account)
    return jsonify(accounts)


@bp.delete("/api/admin/accounts/<username>")
def delete_account(username: str):
    """Removing a vault owner destroys that vault rather than opening
    it. Removing an administrator destroys no data at all.

    The guard and the delete are one transaction. Counting the
    remaining administrators and then deleting in two statements
    outside a write transaction lets two administrators remove each
    other concurrently, each counting two and each deleting one,
    leaving zero.
    """
    body = parse(AccountDelete, request.get_json(silent=True))
    target = normalize_username(username)
    if target is None or normalize_username(body.confirmUsername) != target:
        abort(400)

    with write_transaction() as conn:
        row = conn.execute(
            "SELECT * FROM principals WHERE username = ?", (target,)
        ).fetchone()
        if row is None:
            abort(404)
        if row["kind"] == "administrator":
            remaining = conn.execute(
                "SELECT COUNT(*) FROM principals WHERE kind = 'administrator'"
            ).fetchone()[0]
            if remaining <= 1:
                # Without the rule the instance could never provision
                # an account again without shell access to the host.
                abort(409)
        conn.execute("DELETE FROM principals WHERE id = ?", (row["id"],))
    return jsonify({"username": target, "deleted": True})
