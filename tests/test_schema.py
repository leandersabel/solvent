"""The two administrator triggers (spec/features/app-shell.md,
Database).

Asserted with a direct SQL insert rather than through an endpoint: an
endpoint that happens to refuse the insert for its own reasons hides
whether the schema refuses it at all.
"""
from __future__ import annotations

import sqlite3
import uuid

import pytest

from tests.helpers import connect, register


def test_the_schema_refuses_a_records_row_for_an_administrator(app):
    register(app, "root", kind="administrator")
    principal = connect(app).execute("SELECT id FROM principals").fetchone()["id"]

    conn = connect(app)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="administrator has no vault"):
            conn.execute(
                "INSERT INTO records (principal_id, record_id, record_type, "
                "account_id, schema_version, version, nonce, ciphertext, "
                "updated_at) VALUES (?, ?, 'account', '', 1, 1, 'n', 'c', 'now')",
                (principal, str(uuid.uuid4())),
            )
    finally:
        conn.close()


def test_the_schema_refuses_a_dek_wrapper_for_an_administrator(app):
    register(app, "root", kind="administrator")
    conn = connect(app)
    try:
        credential = conn.execute("SELECT id FROM credentials").fetchone()["id"]
        with pytest.raises(sqlite3.IntegrityError, match="administrator has no vault"):
            conn.execute(
                "INSERT INTO dek_wrappers (credential_id, wrapped_dek, dek_nonce, "
                "created_at) VALUES (?, 'w', 'n', 'now')",
                (credential,),
            )
    finally:
        conn.close()


def test_the_same_inserts_succeed_for_a_vault_owner(app):
    """The triggers refuse an administrator and nothing else, which a
    test asserting only the refusal cannot show."""
    register(app, "owner")
    conn = connect(app)
    try:
        principal = conn.execute("SELECT id FROM principals").fetchone()["id"]
        conn.execute(
            "INSERT INTO records (principal_id, record_id, record_type, "
            "account_id, schema_version, version, nonce, ciphertext, updated_at) "
            "VALUES (?, ?, 'account', '', 1, 1, 'n', 'c', 'now')",
            (principal, str(uuid.uuid4())),
        )
        conn.commit()
    finally:
        conn.close()


def test_a_second_password_credential_cannot_be_inserted(app):
    register(app, "owner")
    conn = connect(app)
    try:
        principal = conn.execute("SELECT id FROM principals").fetchone()["id"]
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO credentials (id, principal_id, method, params, "
                "verifier, created_at) VALUES (?, ?, 'password', '{}', 'v', 'now')",
                (uuid.uuid4().hex, principal),
            )
    finally:
        conn.close()


def test_principals_carries_no_key_material_column(app):
    """Asserted against the table's full column set, so the test fails
    if one is added back."""
    register(app, "owner")
    conn = connect(app)
    try:
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(principals)")
        }
    finally:
        conn.close()
    assert columns == {"id", "username", "kind", "created_at", "last_login_at"}


def test_deleting_a_principal_cascades_to_everything_it_owns(app):
    owner, _ = register(app, "owner")
    conn = connect(app)
    try:
        conn.execute("DELETE FROM principals")
        conn.commit()
        for table in ("credentials", "dek_wrappers", "records", "sessions"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    finally:
        conn.close()
