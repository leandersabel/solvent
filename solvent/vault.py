"""The two vault operations the server performs on more than one record
at a time: purging a holding, and replacing the whole vault from an
export file (spec/features/manage-accounts.md, Delete: the user
chooses; spec/features/export-import.md).

Both exist here rather than in records.py because both are deliberately
type-aware, which the generic store is not. Purge is possible at all
only because `account_id` is a plaintext column, and its reach is
exactly that column: no other record type carries one, so nothing else
can be swept up by it.
"""
from __future__ import annotations

import json

from flask import Blueprint, abort, g, jsonify, request

from . import ratelimit
from .auth import credential_for
from .db import get_db, utcnow, write_transaction
from .records import (
    MAX_BYTES_PER_USER,
    MAX_RECORDS_PER_VAULT,
    RecordWrite,
    fetch_all,
    store,
)
from .validation import Payload, decode_b64, is_uuid4, parse

bp = Blueprint("vault", __name__)

EXPORT_FORMAT = "solvent-vault"
EXPORT_FORMAT_VERSION = 1

NONCE_BYTES = 12


@bp.delete("/api/accounts/<account_id>")
def purge_account(account_id: str):
    """Delete an `account` record and every snapshot carrying its id,
    atomically, without the client enumerating ids.

    It deletes no price entry. A price belongs to a symbol, another
    holding may be measured in the same one, and the server could not
    find them anyway: the symbol is inside the ciphertext.
    """
    if request.args.get("mode") != "purge" or set(request.args) != {"mode"}:
        abort(400)
    if not is_uuid4(account_id):
        abort(400)

    with write_transaction() as conn:
        owned = conn.execute(
            "SELECT 1 FROM records WHERE principal_id = ? AND record_id = ? "
            "AND record_type = 'account'",
            (g.principal["id"], account_id),
        ).fetchone()
        if owned is None:
            # Another user's account_id is Not Found, never Forbidden.
            abort(404)
        conn.execute(
            "DELETE FROM records WHERE principal_id = ? "
            "AND (record_id = ? OR account_id = ?)",
            (g.principal["id"], account_id, account_id),
        )
    return "", 204


@bp.get("/api/export")
def export_vault():
    """The whole vault plus what opens it, as one attachment.

    The filename carries no user identifier, for the same reason the
    contents carry none: a file found on a lost machine must not say
    whose vault it is. Two vaults exported on one day collide in a
    downloads folder, and the browser's own numbering answers that.

    It requires the CSRF header despite being a GET, so it is not
    reachable by navigation: the client fetches it and saves the
    response through a blob URL.
    """
    ratelimit.guard_export(g.principal["id"])

    credential = credential_for(g.principal["id"])
    wrapper = get_db().execute(
        "SELECT * FROM dek_wrappers WHERE credential_id = ?", (credential["id"],)
    ).fetchone()
    params = json.loads(credential["params"])

    payload = {
        "format": EXPORT_FORMAT,
        "formatVersion": EXPORT_FORMAT_VERSION,
        "exportedAt": utcnow(),
        "salt": params["salt"],
        "kdf": params["kdf"],
        "wrappedDek": wrapper["wrapped_dek"],
        "dekNonce": wrapper["dek_nonce"],
        "records": [
            {
                "recordId": row["record_id"],
                "recordType": row["record_type"],
                "accountId": row["account_id"] or None,
                "schemaVersion": row["schema_version"],
                "version": row["version"],
                "nonce": row["nonce"],
                "ciphertext": row["ciphertext"],
            }
            for row in fetch_all(g.principal["id"])
        ],
    }
    response = jsonify(payload)
    response.headers["Content-Disposition"] = (
        f'attachment; filename="solvent-vault-{utcnow()[:10]}.json"'
    )
    return response


class ImportRecord(RecordWrite):
    """The record shape `PUT /api/records` validates, plus the id the
    route would otherwise carry in its path, so an import and a single
    write are held to one set of field rules."""

    recordId: str


class ImportRequest(Payload):
    wrappedDek: str
    dekNonce: str
    records: list[ImportRecord]


@bp.post("/api/import")
def import_vault():
    """Replace the vault entirely, in one transaction.

    The server assigns `principal_id` from the session on every
    imported record and reads none from the payload, so one account's
    import can never write into another's vault. Every record goes
    through the same per-record validator `PUT /api/records` runs,
    which is also what enforces `version: 1` rather than trusting the
    client to have reset it.
    """
    body = parse(ImportRequest, request.get_json(silent=True))
    if len(body.records) > MAX_RECORDS_PER_VAULT:
        abort(413)
    if decode_b64(body.dekNonce, exact_bytes=NONCE_BYTES) is None:
        abort(400)
    if decode_b64(body.wrappedDek) is None:
        abort(400)
    total = sum(len(record.ciphertext) for record in body.records)
    if total > MAX_BYTES_PER_USER:
        abort(413)
    if any(record.version != 1 for record in body.records):
        abort(400)

    credential = credential_for(g.principal["id"])

    with write_transaction() as conn:
        conn.execute(
            "DELETE FROM records WHERE principal_id = ?", (g.principal["id"],)
        )
        # `account` records first, so a snapshot's accountId resolves
        # against the same payload rather than against what was there
        # before.
        ordered = sorted(body.records, key=lambda r: r.recordType != "account")
        for record in ordered:
            store(conn, g.principal["id"], record.recordId, record)
        # Import is the one flow that changes the DEK, so it is the one
        # bound by the rewrite-every-wrapper rule. In v1 the password
        # method is the only one and the importing session holds its
        # Master Key by definition.
        conn.execute(
            "UPDATE dek_wrappers SET wrapped_dek = ?, dek_nonce = ?, created_at = ? "
            "WHERE credential_id = ?",
            (body.wrappedDek, body.dekNonce, utcnow(), credential["id"]),
        )
        # A second session still holds the old DEK, and a create it
        # sends afterwards would store ciphertext under a key no longer
        # in the envelope.
        conn.execute(
            "DELETE FROM sessions WHERE principal_id = ? AND id != ?",
            (g.principal["id"], g.session["id"]),
        )
    return jsonify({"records": len(body.records)})
