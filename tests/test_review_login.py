"""Reviewer's tests: an Auth Key that becomes a verifier is 32 bytes of
strict base64, an Auth Key that is only verified gets no shape check,
and the browser splits the Argon2id output as the spec says
(spec/features/login.md, Stale-KDF upgrade, criterion 79;
spec/architecture.md, Key management, The split and An Auth Key that
becomes a verifier).

Written from the spec alone.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from argon2.low_level import Type, hash_secret_raw

from solvent.config import DEFAULT_KDF_ENVELOPE
from tests.helpers import CSRF, b64, connect, register, sign_in
from tests.test_review_register import BAD_KEYS

SPLIT = Path(__file__).resolve().parent / "client" / "review-split.mjs"

TABLES = {
    "principals": "*",
    "credentials": "*",
    "dek_wrappers": "*",
    "vault_epochs": "*",
    "records": "*",
    "sessions": "id, token_hash, principal_id, issued_at",
    "invites": "*",
    "attempts": "rowid, bucket, outcome, at",
}


def snapshot(app):
    conn = connect(app)
    try:
        return {
            table: sorted(tuple(row) for row in conn.execute(f"SELECT {columns} FROM {table}"))
            for table, columns in TABLES.items()
        }
    finally:
        conn.close()


def make_stale(app, username):
    """The stored envelope one step below the server's default."""
    conn = connect(app)
    try:
        (params,) = conn.execute(
            "SELECT params FROM credentials WHERE principal_id = "
            "(SELECT id FROM principals WHERE username = ?)",
            (username,),
        ).fetchone()
        params = json.loads(params)
        params["kdf"]["m"] = DEFAULT_KDF_ENVELOPE["m"] // 2
        conn.execute(
            "UPDATE credentials SET params = ? WHERE principal_id = "
            "(SELECT id FROM principals WHERE username = ?)",
            (json.dumps(params), username),
        )
        conn.commit()
    finally:
        conn.close()


def wrapper(kind):
    return {"wrappedDek": b64(48), "dekNonce": b64(12)} if kind == "vault_owner" else {}


def rotation(kind, auth_key):
    return {"salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": auth_key, **wrapper(kind)}


KINDS = ["vault_owner", "administrator"]


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("key", BAD_KEYS.values(), ids=BAD_KEYS.keys())
def test_an_upgrade_to_an_auth_key_that_is_not_thirty_two_bytes_changes_nothing(app, kind, key):
    if kind == "administrator":
        register(app, "root", kind="administrator")
    _, old_key = register(app, "someone", kind=kind)
    make_stale(app, "someone")
    client, body = sign_in(app, "someone", old_key)
    assert body["kdfStale"] is True

    before = snapshot(app)
    response = client.post("/api/auth/upgrade-kdf", json=rotation(kind, key), headers=CSRF)
    assert response.status_code == 400, response.get_data(as_text=True)
    assert snapshot(app) == before

    # The account still signs in with the key it had, and still upgrades.
    again, body = sign_in(app, "someone", old_key)
    assert body["kdfStale"] is True
    assert again.post("/api/auth/upgrade-kdf", json=rotation(kind, b64()), headers=CSRF).status_code == 200


def observed(response):
    return (
        response.status_code,
        response.get_data(),
        sorted((k, v) for k, v in response.headers if k != "Date"),
    )


def new_attempts(app, before):
    conn = connect(app)
    try:
        return [tuple(row) for row in conn.execute(
            "SELECT bucket, outcome FROM attempts WHERE rowid > ? ORDER BY rowid", (before,)
        )]
    finally:
        conn.close()


def last_attempt(app):
    conn = connect(app)
    try:
        return conn.execute("SELECT COALESCE(MAX(rowid), 0) FROM attempts").fetchone()[0]
    finally:
        conn.close()


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("key", [BAD_KEYS["3 bytes"], BAD_KEYS["not base64"], BAD_KEYS["unpadded"]],
                         ids=["3 bytes", "not base64", "unpadded"])
def test_a_sign_in_answers_a_malformed_auth_key_as_any_wrong_one(app, client, kind, key):
    """An Auth Key that is only verified gets no shape check, so a
    sign-in has one answer for every wrong key."""
    if kind == "administrator":
        register(app, "root", kind="administrator")
    register(app, "someone", kind=kind)

    mark = last_attempt(app)
    wrong = client.post("/api/auth/login", json={"username": "someone", "authKey": b64()}, headers=CSRF)
    counted_wrong = new_attempts(app, mark)

    mark = last_attempt(app)
    malformed = client.post("/api/auth/login", json={"username": "someone", "authKey": key}, headers=CSRF)
    counted_malformed = new_attempts(app, mark)

    assert wrong.status_code == 401
    assert observed(malformed) == observed(wrong)
    assert counted_malformed == counted_wrong


def hkdf_half(raw: bytes, info: bytes) -> bytes:
    """RFC 5869 with an empty salt (a key of zeros) and one block of
    output, which is the 32 bytes the split asks for."""
    prk = hmac.new(bytes(32), raw, hashlib.sha256).digest()
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_browser_splits_the_argon2id_output_with_hkdf_sha256():
    password = "a reviewer's password"
    salt = bytes(range(16))
    kdf = {"alg": "argon2id", "v": 19, "m": 64, "t": 1, "p": 1}
    result = subprocess.run(
        ["node", str(SPLIT), password, base64.b64encode(salt).decode(), json.dumps(kdf)],
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr
    derived = json.loads(result.stdout)

    raw = hash_secret_raw(
        password.encode(), salt, time_cost=kdf["t"], memory_cost=kdf["m"],
        parallelism=kdf["p"], hash_len=32, type=Type.ID, version=kdf["v"],
    )
    expected_auth = base64.b64encode(hkdf_half(raw, b"solvent/auth-key")).decode()
    expected_master = base64.b64encode(hkdf_half(raw, b"solvent/master-key")).decode()

    # Padded base64 of 32 bytes is 44 characters ending in one "=".
    assert len(derived["authKey"]) == 44 and derived["authKey"].endswith("=")
    assert derived["authKey"] == expected_auth
    assert derived["masterKey"] == expected_master
