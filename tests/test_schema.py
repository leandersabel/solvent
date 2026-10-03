"""The two administrator triggers (spec/features/app-shell.md,
Database).

Asserted with a direct SQL insert rather than through an endpoint: an
endpoint that happens to refuse the insert for its own reasons hides
whether the schema refuses it at all.
"""
from __future__ import annotations

import dataclasses
import sqlite3
import uuid

import pytest

from solvent import db
from solvent.config import load_config
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


def test_a_fresh_file_is_stamped_with_the_schema_version(app):
    conn = connect(app)
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION
    finally:
        conn.close()


def test_a_database_from_another_schema_version_refuses_to_start(tmp_path, monkeypatch):
    """The failure this catches is silent otherwise: every statement in
    schema.sql is `IF NOT EXISTS`, so a table an older build wrote
    survives the run and the first write to it raises mid-request."""
    monkeypatch.setenv("SECRET_KEY", "test-only-secret-key-do-not-use-in-prod")
    stale = tmp_path / "stale.db"
    conn = sqlite3.connect(stale)
    conn.executescript(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);"
        "PRAGMA user_version = 0;"
    )
    conn.close()

    from solvent import create_app

    with pytest.raises(db.SchemaMismatch, match="schema version 0"):
        create_app(config_overrides={"DATABASE_PATH": str(stale), "TESTING": True})

    columns = sqlite3.connect(stale).execute("PRAGMA table_info(sessions)").fetchall()
    assert [row[1] for row in columns] == ["id", "user_id"]


def test_two_processes_starting_on_an_empty_file_both_start(tmp_path, monkeypatch):
    """Two gunicorn workers run `init_db` at the same moment on a fresh
    volume. The first is held after its first table exists; the second
    starts meanwhile. The second must wait for the first's transaction
    and then find a finished schema, not a half-built one at version 0.

    The hold is deterministic, a trace callback that blocks the first
    initialization at its second CREATE TABLE, so the test does not
    depend on which worker wins a race.
    """
    import re
    import threading

    import flask

    path = tmp_path / "race.db"
    hold = threading.Event()
    release = threading.Event()
    second_started = threading.Event()
    creates = []
    results: dict[str, BaseException | None] = {}
    real_connect = sqlite3.connect

    def connect_for(role):
        def connect(*args, **kwargs):
            conn = real_connect(*args, **kwargs)

            def trace(statement):
                if role == "first":
                    # sqlite hands over a statement with its leading
                    # comments attached, so a prefix match would miss.
                    if re.search(r"^CREATE TABLE", statement, re.M | re.I):
                        creates.append(statement)
                        if len(creates) == 2:
                            hold.set()
                            assert release.wait(30)
                else:
                    second_started.set()

            conn.set_trace_callback(trace)
            return conn

        return connect

    def run(role):
        app = flask.Flask(role)
        app.config.update(
            {k.upper(): v for k, v in dataclasses.asdict(load_config({"SECRET_KEY": "k"})).items()},
            DATABASE_PATH=str(path),
        )
        try:
            db.init_db(app)
            results[role] = None
        except BaseException as exc:  # noqa: BLE001 - reported by the assert
            results[role] = exc

    # `db.sqlite3` is the module both threads share, so the patch is
    # switched per thread rather than per call.
    local = threading.local()

    def dispatch(*args, **kwargs):
        return connect_for(local.role)(*args, **kwargs)

    monkeypatch.setattr(db.sqlite3, "connect", dispatch)

    def thread_main(role):
        local.role = role
        run(role)

    first = threading.Thread(target=thread_main, args=("first",))
    second = threading.Thread(target=thread_main, args=("second",))
    first.start()
    try:
        assert hold.wait(30), "the first initialization never reached a second table"
        second.start()
        assert second_started.wait(30)
        # Unfixed, the second finishes here, against the half-built file.
        # Fixed, it is blocked on the first's transaction until release.
        second.join(timeout=1)
    finally:
        release.set()
        first.join(30)
        second.join(30)

    assert results == {"first": None, "second": None}

    conn = real_connect(path)
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION
        from solvent.rates import SEEDED_SYMBOLS

        symbols = [row[0] for row in conn.execute("SELECT symbol FROM symbols")]
    finally:
        conn.close()
    assert sorted(symbols) == sorted(s["symbol"] for s in SEEDED_SYMBOLS)
