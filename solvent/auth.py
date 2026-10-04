"""One sign-in flow for both kinds of account, and everything else that
touches a credential (spec/features/login.md,
spec/features/account-settings.md).

The browser fetches the salt and KDF parameters, derives the Master Key
and Auth Key, and sends only the Auth Key. Nothing before a verified
credential branches on kind: the salt response, the client derivation,
the Auth Key on the wire, the server-side Argon2id over it, the
rate-limit keying and the lockout response are the same operations in
the same order for both kinds, and there must not become a point in the
flow where that stops being true.
"""
from __future__ import annotations

import json
from typing import Optional

from flask import Blueprint, abort, g, jsonify, request

from . import crypto, ratelimit
from . import session as sessions
from .config import DEFAULT_KDF_ENVELOPE
from .db import get_db, utcnow, write_transaction
from .guard import public, verify_epoch
from .records import NONCE_BYTES
from .validation import (
    Payload,
    decode_b64,
    envelope_is_stale,
    kdf_envelope_ok,
    normalize_username,
    parse,
)

bp = Blueprint("auth", __name__)

SALT_BYTES = 16


class SaltRequest(Payload):
    username: str


class LoginRequest(Payload):
    username: str
    authKey: str


class CredentialRotation(Payload):
    """The shape shared by the stale-KDF upgrade and a password change.

    `currentAuthKey` is what separates them: the upgrade runs against a
    session that just authenticated, a password change proves the
    current password again.
    """

    salt: str
    kdf: dict
    authKey: str
    wrappedDek: Optional[str] = None
    dekNonce: Optional[str] = None


class ChangePassword(CredentialRotation):
    currentAuthKey: str


class DeleteAccount(Payload):
    authKey: str
    confirmUsername: str


def credential_for(principal_id: str):
    return get_db().execute(
        "SELECT * FROM credentials WHERE principal_id = ? AND method = 'password'",
        (principal_id,),
    ).fetchone()


def _principal_by_username(username: str):
    return get_db().execute(
        "SELECT * FROM principals WHERE username = ?", (username,)
    ).fetchone()


@bp.post("/api/auth/salt")
@public
def salt():
    """`{ salt, kdf }`, which is the password credential's `params` and
    nothing else.

    An unknown username gets a deterministic decoy plus the server's
    current default envelope, identically shaped. The response carries
    no field naming, implying, or derivable into the account's kind:
    this endpoint answers an unauthenticated caller, which is why
    `params` holds nothing secret and the verifier is a separate
    column.
    """
    body = parse(SaltRequest, request.get_json(silent=True))
    username = normalize_username(body.username) or body.username.strip().lower()
    ratelimit.guard_auth(username)

    row = _principal_by_username(username)
    # The credential lookup runs for an unknown username too, against no
    # id: the limiter no longer writes a row on every salt fetch, so the
    # one query a known username costs extra would otherwise be the
    # largest difference left in the response time.
    credential = credential_for(row["id"] if row is not None else "")
    if credential is not None:
        params = json.loads(credential["params"])
        return jsonify({"salt": params["salt"], "kdf": params["kdf"]})

    return jsonify(
        {"salt": crypto.decoy_salt(username), "kdf": DEFAULT_KDF_ENVELOPE}
    )


@bp.post("/api/auth/login")
@public
def login():
    """On success sets the session cookie, writes `last_login_at`, and
    returns `kind` and `kdfStale`, plus the one wrapper belonging to the
    credential that just authenticated for a vault owner.

    An unknown username still runs a full Argon2id verification against
    a fixed decoy hash and discards the result. Without it the endpoint
    answers in microseconds for accounts that do not exist and in tens
    of milliseconds for ones that do, which reveals existence by timing
    and throws away the work the decoy salt did one step earlier.
    """
    body = parse(LoginRequest, request.get_json(silent=True))
    username = normalize_username(body.username) or body.username.strip().lower()
    ratelimit.guard_auth(username)

    row = _principal_by_username(username)
    credential = credential_for(row["id"]) if row is not None else None
    verifier = credential["verifier"] if credential else crypto.decoy_verifier()

    if not crypto.verify_auth_key(verifier, body.authKey) or credential is None:
        ratelimit.record_auth_failure(username)
        abort(401)

    ratelimit.clear_auth_failures(username)

    params = json.loads(credential["params"])
    response_body = {
        "kind": row["kind"],
        "kdfStale": envelope_is_stale(params.get("kdf")),
    }
    if response_body["kdfStale"]:
        response_body["kdf"] = DEFAULT_KDF_ENVELOPE

    # The wrapper and the epoch are read in the transaction that writes
    # the session, so an import cannot land between them.
    with write_transaction() as conn:
        if row["kind"] == "vault_owner":
            wrapper = conn.execute(
                "SELECT * FROM dek_wrappers WHERE credential_id = ?", (credential["id"],)
            ).fetchone()
            if wrapper is None:
                # A vault owner with no wrapper has nothing to unlock, and
                # saying so would be a different answer than a wrong
                # password gets.
                abort(401)
            response_body["wrappedDek"] = wrapper["wrapped_dek"]
            response_body["dekNonce"] = wrapper["dek_nonce"]
            response_body["vaultEpoch"] = conn.execute(
                "SELECT epoch FROM vault_epochs WHERE principal_id = ?", (row["id"],)
            ).fetchone()["epoch"]
        raw_token = sessions.start(conn, row["id"])
    response = jsonify(response_body)
    sessions.set_cookie(response, raw_token)
    return response


@bp.post("/api/auth/logout")
@public
def logout():
    sessions.revoke_current()
    response = jsonify({"ok": True})
    sessions.clear_cookie(response)
    return response


@bp.post("/api/auth/logout-all")
def logout_all():
    """Every session for the user, the current one included. There is
    no all-except-this-one variant."""
    get_db().execute(
        "DELETE FROM sessions WHERE principal_id = ?", (g.principal["id"],)
    )
    response = jsonify({"ok": True})
    sessions.clear_cookie(response)
    return response


@bp.get("/api/sessions")
def list_sessions():
    """Live sessions only: an expired row can no longer act, whether or
    not a sign-in has deleted it yet. No IP and no user-agent, because
    none is recorded. `id` is an opaque handle, never the cookie's
    value."""
    rows = get_db().execute(
        "SELECT id, issued_at, last_active_at FROM sessions "
        "WHERE principal_id = ? ORDER BY issued_at",
        (g.principal["id"],),
    ).fetchall()
    return jsonify(
        [
            {
                "id": row["id"],
                "issuedAt": row["issued_at"],
                "lastActiveAt": row["last_active_at"],
                "current": row["id"] == g.session["id"],
            }
            for row in rows
            if sessions.is_live(row["issued_at"])
        ]
    )


def _rotate_credential(conn, body: CredentialRotation) -> None:
    """Replace the password credential's `params` and `verifier`, and
    for a vault owner that credential's one wrapper.

    The kind is read from the session rather than inferred from which
    fields arrived. Letting the payload decide would let a client
    silently skip re-wrapping a real vault and leave its wrapper
    opening under a superseded Master Key.
    """
    if decode_b64(body.salt, exact_bytes=SALT_BYTES) is None:
        abort(400)
    if not kdf_envelope_ok(body.kdf):
        abort(400)

    is_owner = g.principal["kind"] == "vault_owner"
    has_wrapper = body.wrappedDek is not None or body.dekNonce is not None
    if is_owner != has_wrapper:
        abort(400)
    if is_owner and decode_b64(body.dekNonce, exact_bytes=NONCE_BYTES) is None:
        abort(400)
    if is_owner and decode_b64(body.wrappedDek) is None:
        abort(400)

    if is_owner:
        # After the lock is taken and before any write: a page holding a
        # DEK an import replaced would wrap the old key.
        verify_epoch(conn)

    credential = credential_for(g.principal["id"])
    conn.execute(
        "UPDATE credentials SET params = ?, verifier = ?, created_at = ? WHERE id = ?",
        (
            json.dumps({"salt": body.salt, "kdf": body.kdf}),
            crypto.hash_auth_key(body.authKey),
            utcnow(),
            credential["id"],
        ),
    )
    if is_owner:
        conn.execute(
            "UPDATE dek_wrappers SET wrapped_dek = ?, dek_nonce = ?, created_at = ? "
            "WHERE credential_id = ?",
            (body.wrappedDek, body.dekNonce, utcnow(), credential["id"]),
        )


@bp.post("/api/auth/upgrade-kdf")
def upgrade_kdf():
    """The only path by which an account's KDF parameters are raised.

    The operator raises the server's default envelope and every vault
    follows on its owner's next login, re-encrypting no record. The DEK
    is the same key afterwards, so every other wrapper still opens it
    and nothing else is written.
    """
    body = parse(CredentialRotation, request.get_json(silent=True))
    with write_transaction() as conn:
        _rotate_credential(conn, body)
    return jsonify({"ok": True})


@bp.post("/api/auth/change-password")
def change_password():
    """The one section of settings both kinds reach. An administrator
    sends no wrapper, because there is no DEK to unwrap and none to
    re-wrap."""
    body = parse(ChangePassword, request.get_json(silent=True))
    ratelimit.guard_auth(g.principal["username"])
    credential = credential_for(g.principal["id"])
    if not crypto.verify_auth_key(credential["verifier"], body.currentAuthKey):
        ratelimit.record_auth_failure(g.principal["username"])
        abort(400)

    with write_transaction() as conn:
        _rotate_credential(conn, body)
        # Every other session goes; the initiating one survives, which
        # is also an administrator's "sign out everywhere".
        conn.execute(
            "DELETE FROM sessions WHERE principal_id = ? AND id != ?",
            (g.principal["id"], g.session["id"]),
        )
    return jsonify({"ok": True})


@bp.delete("/api/auth/account")
def delete_account():
    """A vault owner's own account. The typed username is a deliberate
    second factor of intent, so it is verified here and not left as a
    UI formality.

    No last-administrator check: a vault owner is never an
    administrator, so removing one can never leave the instance
    unadministered.
    """
    body = parse(DeleteAccount, request.get_json(silent=True))
    ratelimit.guard_auth(g.principal["username"])
    if normalize_username(body.confirmUsername) != g.principal["username"]:
        abort(400)
    credential = credential_for(g.principal["id"])
    if not crypto.verify_auth_key(credential["verifier"], body.authKey):
        ratelimit.record_auth_failure(g.principal["username"])
        abort(400)

    with write_transaction() as conn:
        verify_epoch(conn)
        # Credentials, wrappers, the vault epoch, records and sessions
        # all cascade from the principal row.
        conn.execute("DELETE FROM principals WHERE id = ?", (g.principal["id"],))
    response = jsonify({"ok": True})
    sessions.clear_cookie(response)
    return response
