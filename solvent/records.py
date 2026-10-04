"""One generic, type-agnostic store for every encrypted vault record
(spec/features/record-api.md).

The server has no per-type logic because it cannot read any type: it
moves opaque blobs in and out of rows keyed by plaintext columns it is
allowed to see. What it does enforce is the shape of those columns, the
version sequence, and the storage caps.

Every route here is on the vault surface, so an administrator session
never reaches one: guard.py answers Not Found before any handler runs.
"""
from __future__ import annotations

from typing import Literal, Optional

from flask import Blueprint, abort, g, jsonify, request
from pydantic import Field

from .db import get_db, read_transaction, utcnow, write_transaction
from .guard import verify_epoch
from .validation import Payload, decode_b64, is_uuid4, parse

bp = Blueprint("records", __name__)

RECORD_TYPES = ("account", "snapshot", "rate", "profile")

# architecture.md, Storage & data handling. Fixed by the spec, not
# operator config: the Content Too Large tests assert exact behaviour
# at a boundary, and a boundary that moves per deployment is one the
# spec cannot state.
MAX_CIPHERTEXT_BYTES = 64 * 1024
MAX_RECORDS_PER_VAULT = 50_000
MAX_BYTES_PER_USER = 32 * 1024 * 1024

NONCE_BYTES = 12

# record-api.md, The AAD encoding. Field order is Key management's, not
# the storage table's, and the separator is required rather than
# cosmetic: bare concatenation leaves field boundaries ambiguous, so two
# different tuples could produce identical AAD.
AAD_SEPARATOR = b"\x1f"


def aad(
    account_id: "str | None",
    record_type: str,
    record_id: str,
    schema_version: int,
    version: int,
) -> bytes:
    """The byte string both sides derive and neither sends.

    `principal_id` is deliberately absent: the DEK boundary already
    makes a blob undecryptable in another vault, which is what lets a
    vault be encrypted before the server has assigned an identity.
    """
    fields = (
        account_id or "",
        record_type,
        record_id,
        str(schema_version),
        str(version),
    )
    return AAD_SEPARATOR.join(field.encode("utf-8") for field in fields)


class RecordWrite(Payload):
    recordType: Literal["account", "snapshot", "rate", "profile"]
    accountId: Optional[str]
    schemaVersion: int = Field(ge=1)
    version: int = Field(ge=1)
    nonce: str
    ciphertext: str


def _row_json(row) -> dict:
    """`accountId` is null and never the empty string on the wire. The
    empty column is the storage spelling, `null` is the only one a
    client ever sees."""
    return {
        "recordId": row["record_id"],
        "recordType": row["record_type"],
        "accountId": row["account_id"] or None,
        "schemaVersion": row["schema_version"],
        "version": row["version"],
        "nonce": row["nonce"],
        "ciphertext": row["ciphertext"],
    }


def fetch_all(principal_id: str, record_type: "str | None" = None) -> list:
    sql = "SELECT * FROM records WHERE principal_id = ?"
    args: list = [principal_id]
    if record_type is not None:
        sql += " AND record_type = ?"
        args.append(record_type)
    return get_db().execute(sql + " ORDER BY record_id", args).fetchall()


def store(conn, principal_id: str, record_id: str, body: RecordWrite) -> None:
    """Validate one record against its slot and write it.

    Registration and import both call this rather than reimplementing
    it, so there is one set of rules with three callers rather than
    three record writers (register.md, export-import.md).
    """
    if not is_uuid4(record_id):
        abort(400)

    account_id = body.accountId
    if account_id == "":
        # Absence has one spelling, and it is null.
        abort(400)
    if (body.recordType == "snapshot") != (account_id is not None):
        abort(400)

    if decode_b64(body.nonce, exact_bytes=NONCE_BYTES) is None:
        abort(400)
    blob = decode_b64(body.ciphertext)
    if blob is None:
        abort(400)
    if len(blob) > MAX_CIPHERTEXT_BYTES:
        abort(413)

    if account_id is not None:
        owner = conn.execute(
            "SELECT 1 FROM records WHERE principal_id = ? AND record_id = ? "
            "AND record_type = 'account'",
            (principal_id, account_id),
        ).fetchone()
        if owner is None:
            abort(400)

    stored = conn.execute(
        "SELECT * FROM records WHERE principal_id = ? AND record_id = ?",
        (principal_id, record_id),
    ).fetchone()

    if stored is None:
        if body.version != 1:
            abort(409)
        _check_quota(conn, principal_id, len(blob))
        conn.execute(
            "INSERT INTO records (principal_id, record_id, record_type, "
            "account_id, schema_version, version, nonce, ciphertext, "
            "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                principal_id,
                record_id,
                body.recordType,
                account_id or "",
                body.schemaVersion,
                body.version,
                body.nonce,
                body.ciphertext,
                utcnow(),
            ),
        )
        return

    # recordType and accountId never change. A blob whose claimed slot
    # disagrees with the slot it is going into is refused, even though
    # the server cannot decrypt either one.
    if body.recordType != stored["record_type"]:
        abort(400)
    if (account_id or "") != stored["account_id"]:
        abort(400)
    if body.version != stored["version"] + 1:
        abort(409)
    if body.nonce == stored["nonce"]:
        # architecture.md, Nonce strategy: fresh per encryption,
        # including re-encrypting an existing record on edit.
        abort(400)

    _check_quota(conn, principal_id, len(blob) - len(decode_b64(stored["ciphertext"])))
    conn.execute(
        "UPDATE records SET schema_version = ?, version = ?, nonce = ?, "
        "ciphertext = ?, updated_at = ? "
        "WHERE principal_id = ? AND record_id = ?",
        (
            body.schemaVersion,
            body.version,
            body.nonce,
            body.ciphertext,
            utcnow(),
            principal_id,
            record_id,
        ),
    )


def _check_quota(conn, principal_id: str, added_bytes: int) -> None:
    """Enforced before the row reaches the DB. Over any limit is
    Content Too Large with nothing written."""
    row = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes "
        "FROM records WHERE principal_id = ?",
        (principal_id,),
    ).fetchone()
    if added_bytes > 0 and row["n"] + 1 > MAX_RECORDS_PER_VAULT:
        abort(413)
    if row["bytes"] + added_bytes > MAX_BYTES_PER_USER:
        abort(413)


@bp.get("/api/records")
def list_records():
    record_type = request.args.get("type")
    if record_type not in RECORD_TYPES or set(request.args) != {"type"}:
        abort(400)
    with read_transaction() as conn:
        verify_epoch(conn)
        rows = fetch_all(g.principal["id"], record_type)
    return jsonify([_row_json(row) for row in rows])


@bp.put("/api/records/<record_id>")
def put_record(record_id: str):
    body = parse(RecordWrite, request.get_json(silent=True))
    with write_transaction() as conn:
        verify_epoch(conn)
        store(conn, g.principal["id"], record_id, body)
    return jsonify({"recordId": record_id, "version": body.version})


@bp.delete("/api/records/<record_id>")
def delete_record(record_id: str):
    if not is_uuid4(record_id):
        abort(400)
    with write_transaction() as conn:
        verify_epoch(conn)
        deleted = conn.execute(
            "DELETE FROM records WHERE principal_id = ? AND record_id = ?",
            (g.principal["id"], record_id),
        ).rowcount
    # A record belonging to another vault is Not Found, never Forbidden,
    # so an attacker cannot map which ids exist.
    if not deleted:
        abort(404)
    return "", 204
