"""Creating an account from an invite (spec/features/register.md).

The invite decides which kind. The client is told the kind by the page,
and the server takes it from the invite row and never from the request:
a payload carrying a wrapper against an administrator invite is a Bad
Request, and one omitting it against a vault owner invite is too.
Nothing in the request names a kind, so a client can neither mint
itself an administrator account by leaving fields out nor attach a
vault to one by putting them in.

Registration is one transaction. Splitting it would mean a request that
burns a single-use invite and leaves a logged-in user holding a vault
with no main currency.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from flask import Blueprint, abort, jsonify, make_response, render_template, request

from . import crypto
from . import session as sessions
from .auth import SALT_BYTES
from .db import get_db, new_epoch, utcnow, write_transaction
from .guard import navigation, public
from .pages import vault_page
from .rates import table_rows
from .records import NONCE_BYTES, RecordWrite, store
from .validation import Payload, decode_b64, kdf_envelope_ok, normalize_username, parse

bp = Blueprint("register", __name__)

# All four invalid invite states render the same message, so a probe
# learns nothing about which one applies.
INVALID_INVITE = "This invite link is not valid."


class RegisterRequest(Payload):
    inviteToken: str
    username: str
    authKey: str
    salt: str
    kdf: dict
    wrappedDek: Optional[str] = None
    dekNonce: Optional[str] = None
    profileRecordId: Optional[str] = None
    profileSchemaVersion: Optional[int] = None
    profileCiphertext: Optional[str] = None
    profileNonce: Optional[str] = None


def refuse(reason: str):
    """A Bad Request naming its reason, for the two the contract pins
    (architecture.md, Status codes). Raised, so the transaction around
    it rolls back."""
    abort(make_response(jsonify(refused=reason), 400))


def usable_invite(conn, token: str):
    """The invite row a registration may consume, or None.

    Looked up by the hash of the presented token, never by scanning and
    comparing plaintext. `expired` is derived here rather than stored.
    """
    row = conn.execute(
        "SELECT * FROM invites WHERE token_hash = ?",
        (crypto.hash_invite_token(token),),
    ).fetchone()
    if row is None or row["status"] != "pending":
        return None
    if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
        return None
    return row


@bp.get("/register")
@navigation
@public
def register_page():
    """Server-rendered, carrying the current default KDF envelope and,
    for a vault owner invite, the currency half of the symbol table.

    Both are needed before the user has a session, which is why they
    ride on the page rather than on an API the page cannot call.
    """
    response = make_response(_register_page())
    # The token rides in this page's URL, so it is this page's outbound
    # requests that could carry it in a Referer header. Said in the
    # header as well as the page's own meta, which only applies to what
    # follows it, and on the error page too, whose address holds the
    # token that was just refused (admin-invites.md, Rules).
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _register_page():
    token = request.args.get("invite", "")
    row = usable_invite(get_db(), token) if token else None
    if row is None:
        return render_template("register.html", error=INVALID_INVITE), 400

    currencies = (
        [
            {"symbol": s["symbol"], "label": s["label"]}
            for s in table_rows()
            if s["kind"] == "currency"
        ]
        if row["kind"] == "vault_owner"
        else []
    )
    if row["kind"] == "vault_owner":
        # The vault shell page in the outside frame, so the keys this
        # derivation produces are in the memory of the document that
        # draws the vault. A page load afterwards would arrive without
        # them and ask for the password just chosen (register.md, Flow).
        return vault_page(
            outside=True,
            title="Create your Solvent account",
            no_referrer=True,
            registration={"kind": row["kind"], "token": token, "currencies": currencies},
        )
    return render_template(
        "register.html",
        error=None,
        invite_kind=row["kind"],
        invite_token=token,
        currencies=currencies,
    )


@bp.post("/api/register")
@public
def register():
    body = parse(RegisterRequest, request.get_json(silent=True))

    username = normalize_username(body.username)
    if username is None:
        refuse("username")
    if decode_b64(body.salt, exact_bytes=SALT_BYTES) is None:
        abort(400)
    if not kdf_envelope_ok(body.kdf):
        abort(400)
    if body.dekNonce is not None and decode_b64(body.dekNonce, exact_bytes=NONCE_BYTES) is None:
        abort(400)
    if body.wrappedDek is not None and decode_b64(body.wrappedDek) is None:
        abort(400)

    vault_fields = (
        body.wrappedDek,
        body.dekNonce,
        body.profileRecordId,
        body.profileSchemaVersion,
        body.profileCiphertext,
        body.profileNonce,
    )

    epoch = new_epoch()
    with write_transaction() as conn:
        invite = usable_invite(conn, body.inviteToken)
        if invite is None:
            refuse("invite")

        wants_vault = invite["kind"] == "vault_owner"
        if wants_vault != all(field is not None for field in vault_fields):
            abort(400)
        if not wants_vault and any(field is not None for field in vault_fields):
            abort(400)

        taken = conn.execute(
            "SELECT 1 FROM principals WHERE username = ?", (username,)
        ).fetchone()
        if taken:
            # Enumeration here is accepted rather than defended: the
            # endpoint is invite-gated and the audience is a small
            # trusted household. The refusal is the same whichever kind
            # holds the name, so it reveals existence but not kind.
            abort(409)

        principal_id = uuid.uuid4().hex
        credential_id = uuid.uuid4().hex
        now = utcnow()
        conn.execute(
            "INSERT INTO principals (id, username, kind, created_at) "
            "VALUES (?, ?, ?, ?)",
            (principal_id, username, invite["kind"], now),
        )
        conn.execute(
            "INSERT INTO credentials "
            "(id, principal_id, method, params, verifier, created_at) "
            "VALUES (?, ?, 'password', ?, ?, ?)",
            (
                credential_id,
                principal_id,
                json.dumps({"salt": body.salt, "kdf": body.kdf}),
                crypto.hash_auth_key(body.authKey),
                now,
            ),
        )

        if wants_vault:
            conn.execute(
                "INSERT INTO dek_wrappers "
                "(credential_id, wrapped_dek, dek_nonce, created_at) "
                "VALUES (?, ?, ?, ?)",
                (credential_id, body.wrappedDek, body.dekNonce, now),
            )
            conn.execute(
                "INSERT INTO vault_epochs (principal_id, epoch) VALUES (?, ?)",
                (principal_id, epoch),
            )
            # Through the same validator that backs PUT /api/records, so
            # the profile registration writes is indistinguishable from
            # one written through the API.
            store(
                conn,
                principal_id,
                body.profileRecordId,
                RecordWrite(
                    recordType="profile",
                    accountId=None,
                    schemaVersion=body.profileSchemaVersion,
                    version=1,
                    nonce=body.profileNonce,
                    ciphertext=body.profileCiphertext,
                ),
            )

        conn.execute(
            "UPDATE invites SET status = 'used', used_at = ?, used_by = ? "
            "WHERE id = ? AND status = 'pending'",
            (now, username, invite["id"]),
        )

        raw_token = sessions.start(conn, principal_id, now)

    answer = {"kind": invite["kind"]}
    if wants_vault:
        answer["vaultEpoch"] = epoch
    response = jsonify(answer)
    sessions.set_cookie(response, raw_token)
    return response
