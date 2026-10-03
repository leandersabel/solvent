"""Fixtures that build real accounts through the real endpoints.

The Auth Key is an opaque string to the server, so a test can supply
one without running Argon2id in a browser: what the server does with
it is hash it and compare hashes, which is exactly what these exercise.
"""
from __future__ import annotations

import base64
import contextlib
import json
import re
import secrets
import sqlite3
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

from solvent.config import DEFAULT_KDF_ENVELOPE

REPO_ROOT = Path(__file__).resolve().parent.parent

CSRF = {"X-Solvent-Request": "1"}


def b64(length: int = 32) -> str:
    return base64.b64encode(secrets.token_bytes(length)).decode()


def connect(app) -> sqlite3.Connection:
    conn = sqlite3.connect(app.config["DATABASE_PATH"])
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def mint_invite(app, kind: str = "vault_owner", **columns) -> str:
    """An invite row written straight to the table, returning its
    token. Used where a test needs an invite without an administrator
    session to mint one from."""
    from solvent.crypto import hash_invite_token
    from solvent.db import utcnow

    token = secrets.token_urlsafe(32)
    row = {
        "id": uuid.uuid4().hex,
        "token_hash": hash_invite_token(token),
        "kind": kind,
        "created_by": "system:bootstrap",
        "created_at": utcnow(),
        "expires_at": "2099-01-01T00:00:00+00:00",
        "status": "pending",
        "label": "",
        **columns,
    }
    conn = connect(app)
    try:
        conn.execute(
            "INSERT INTO invites (id, token_hash, kind, created_by, created_at, "
            "expires_at, status, label) VALUES (:id, :token_hash, :kind, "
            ":created_by, :created_at, :expires_at, :status, :label)",
            row,
        )
        conn.commit()
    finally:
        conn.close()
    return token


def register_body(app, kind: str = "vault_owner", **overrides) -> dict:
    """A POST /api/register body for a fresh invite of that kind, unless
    `inviteToken` names one."""
    body = {
        "inviteToken": overrides.pop("inviteToken", None) or mint_invite(app, kind),
        "username": "someone",
        "authKey": b64(),
        "salt": b64(16),
        "kdf": dict(DEFAULT_KDF_ENVELOPE),
    }
    if kind == "vault_owner":
        body.update(
            wrappedDek=b64(48),
            dekNonce=b64(12),
            profileRecordId=str(uuid.uuid4()),
            profileSchemaVersion=1,
            profileCiphertext=b64(64),
            profileNonce=b64(12),
        )
    body.update(overrides)
    return body


def register(app, username: str, *, kind: str = "vault_owner", auth_key=None, **overrides):
    """Register through POST /api/register and return a client bound to
    the resulting session, plus the Auth Key it used."""
    body = register_body(
        app,
        kind,
        inviteToken=overrides.pop("invite_token", None),
        username=username,
        authKey=auth_key or b64(),
        **overrides,
    )
    client = app.test_client()
    response = client.post("/api/register", json=body, headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    return client, body["authKey"]


def sign_in(app, username: str, auth_key: str):
    client = app.test_client()
    response = client.post(
        "/api/auth/login", json={"username": username, "authKey": auth_key}, headers=CSRF
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return client, response.get_json()


def principal_id(app, username: str) -> str:
    conn = connect(app)
    try:
        return conn.execute(
            "SELECT id FROM principals WHERE username = ?", (username,)
        ).fetchone()["id"]
    finally:
        conn.close()


def credential(app, username: str):
    conn = connect(app)
    try:
        return conn.execute(
            "SELECT credentials.* FROM credentials JOIN principals "
            "ON principals.id = credentials.principal_id WHERE principals.username = ?",
            (username,),
        ).fetchone()
    finally:
        conn.close()


def rows(app, sql: str, args=()):
    conn = connect(app)
    try:
        return [dict(row) for row in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


def record_body(record_type="account", **overrides):
    body = {
        "recordType": record_type,
        "accountId": None,
        "schemaVersion": 1,
        "version": 1,
        "nonce": b64(12),
        "ciphertext": b64(64),
    }
    body.update(overrides)
    return body


def put_record(client, record_id=None, **overrides):
    record_id = record_id or str(uuid.uuid4())
    return record_id, client.put(
        f"/api/records/{record_id}", json=record_body(**overrides), headers=CSRF
    )


def params_of(credential_row) -> dict:
    return json.loads(credential_row["params"])


def flask(*args, env):
    """The app's own command line, run the way an operator's shell would."""
    return subprocess.run(
        [sys.executable, "-m", "flask", "--app", "app", *args],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=120,
    )


@contextlib.contextmanager
def serve(env, log_path):
    """A real server on a throwaway database, bound to the loopback
    address Chrome resolves `localhost` to first. It asks the system for
    a port and reads the one it got from its own log, so servers started
    side by side never race for one. Yields the address a browser uses."""
    with open(log_path, "w") as log:
        server = subprocess.Popen(
            [sys.executable, "-m", "flask", "--app", "app", "run", "--host", "::1", "--port", "0"],
            cwd=REPO_ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 60
            while True:
                found = re.search(r"Running on http://\[::1\]:(\d+)", Path(log_path).read_text())
                if found:
                    break
                if server.poll() is not None or time.monotonic() > deadline:
                    pytest.fail("the server did not come up:\n" + Path(log_path).read_text())
                time.sleep(0.05)
            yield f"http://localhost:{found.group(1)}"
        finally:
            server.terminate()
            server.wait(timeout=10)
