"""Reviewer's tests: an Auth Key that becomes a verifier is 32 bytes of
strict base64, an Auth Key that is only verified gets no shape check,
the browser splits the Argon2id output as the spec says, and an unknown
username is verified against a decoy that exists before the first
request (spec/features/login.md, Stale-KDF upgrade and Flow step 3,
criteria 10, 11, 79 and 80; spec/architecture.md, Key management, The
split and An Auth Key that becomes a verifier, and Login enumeration).

Written from the spec alone.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

import pytest
from argon2 import PasswordHasher, extract_parameters
from argon2.low_level import Type, hash_secret_raw

from solvent.config import DEFAULT_KDF_ENVELOPE, SERVER_VERIFY_PARAMS
from tests.helpers import CSRF, b64, connect, credential, register, sign_in
from tests.test_review_register import BAD_KEYS

ROOT = Path(__file__).resolve().parent.parent
SPLIT = ROOT / "tests" / "client" / "review-split.mjs"

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


@pytest.fixture
def argon2_calls(monkeypatch):
    """Every Argon2id hash and verification the app runs, in order, with
    the hash each verification checks against."""
    calls = []
    real_hash, real_verify = PasswordHasher.hash, PasswordHasher.verify

    def counted_hash(self, password, *args, **kwargs):
        calls.append(("hash", None))
        return real_hash(self, password, *args, **kwargs)

    def counted_verify(self, hash, password):
        calls.append(("verify", hash))
        return real_verify(self, hash, password)

    monkeypatch.setattr(PasswordHasher, "hash", counted_hash)
    monkeypatch.setattr(PasswordHasher, "verify", counted_verify)
    return calls


def stranger_login(client, username="nobody"):
    return client.post("/api/auth/login", json={"username": username, "authKey": b64()}, headers=CSRF)


def test_the_first_unknown_username_after_a_start_runs_one_verification_and_no_hash(argon2_calls, app, client):
    argon2_calls.clear()
    assert stranger_login(client).status_code == 401
    assert [kind for kind, _ in argon2_calls] == ["verify"]


def test_every_unknown_username_is_verified_against_one_decoy_shaped_as_a_fresh_verifier(argon2_calls, app, client):
    argon2_calls.clear()
    for username in ("nobody", "nobody-else", "nobody"):
        assert stranger_login(client, username).status_code == 401
    assert [kind for kind, _ in argon2_calls] == ["verify"] * 3
    decoys = {hash for _, hash in argon2_calls}
    assert len(decoys) == 1

    register(app, "someone")
    (decoy,) = decoys
    assert extract_parameters(decoy) == extract_parameters(credential(app, "someone")["verifier"])


def timed(request):
    start = time.perf_counter()
    response = request()
    elapsed = time.perf_counter() - start
    assert response.status_code == 401
    return elapsed


def shape(hash):
    parameters = extract_parameters(hash)
    return [getattr(parameters, field) for field in
            ("memory_cost", "time_cost", "parallelism", "type", "version", "salt_len", "hash_len")]


def first_start(database_path):
    """Run in a fresh interpreter, which is what a start is: the app is
    created as production creates it, its one-time request costs are paid
    on a wrong Auth Key, and then the first unknown username is timed
    against wrong Auth Keys. Prints the ratio, and the parameters of the
    decoy and of a fresh verifier."""
    from solvent import create_app

    app = create_app(config_overrides={"DATABASE_PATH": database_path, "TESTING": True})
    register(app, "someone")
    client = app.test_client()

    def wrong():
        return client.post("/api/auth/login", json={"username": "someone", "authKey": b64()}, headers=CSRF)

    timed(wrong)
    first_stranger = timed(lambda: stranger_login(client))
    wrong_key = statistics.median(timed(wrong) for _ in range(5))

    checked = []
    real_verify = PasswordHasher.verify

    def recorded_verify(self, hash, password):
        checked.append(hash)
        return real_verify(self, hash, password)

    PasswordHasher.verify = recorded_verify
    stranger_login(client)
    (decoy,) = checked
    fresh = credential(app, "someone")["verifier"]
    print(json.dumps(
        {"ratio": first_stranger / wrong_key, "decoy": shape(decoy), "fresh": shape(fresh)}, default=str
    ))


def test_the_first_unknown_username_after_a_start_takes_no_longer_than_a_wrong_auth_key(tmp_path):
    """Building the decoy on the first unknown username costs a second
    Argon2id at production cost, about twice a wrong Auth Key."""
    ratios = []
    for start in range(3):
        result = subprocess.run(
            [sys.executable, "-c", "import sys; from tests.test_review_login import first_start; first_start(sys.argv[1])",
             str(tmp_path / f"start-{start}.db")],
            capture_output=True, text=True, timeout=120, cwd=ROOT,
            env={**os.environ, "SECRET_KEY": secrets.token_urlsafe(32)},
        )
        assert result.returncode == 0, result.stderr
        measured = json.loads(result.stdout.splitlines()[-1])
        assert measured["decoy"] == measured["fresh"]
        assert measured["fresh"][:3] == [SERVER_VERIFY_PARAMS[k] for k in ("m", "t", "p")]
        ratios.append(measured["ratio"])

    assert statistics.median(ratios) < 1.5, ratios


# ---- A credential changed elsewhere (criteria 81 and 82) -----------------
#
# login.md, Stale-KDF upgrade step 4 and A credential changed elsewhere;
# architecture.md, Credentials and vault key wrappers.

from tests import test_review_export_import as elsewhere  # noqa: E402


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
def test_an_upgrade_after_a_password_change_on_another_page_writes_nothing(app, kind):
    here, key = elsewhere.open_vault(app, "someone", kind)
    elsewhere.make_stale(app, "someone")
    assert here.sign_in("someone", key)["kdfStale"] is True
    assert here.another().change(key)[0].status_code == 200

    before = elsewhere.everything(app)
    response, _ = here.upgrade()
    assert elsewhere.refused(response, elsewhere.CHANGED), response.get_data(as_text=True)
    assert elsewhere.everything(app) == before


def test_a_password_change_landing_between_the_gate_and_the_upgrade_refuses_it(app, monkeypatch):
    """Held after the gate and before the upgrade's transaction, where a
    salt compared outside it would undo the change with a credential
    made from the old password."""
    import solvent.auth as auth_module

    here, key = elsewhere.open_vault(app)
    elsewhere.make_stale(app, "owner")
    here.sign_in("owner", key)
    there = here.another()
    real = auth_module.write_transaction

    def after_a_change(*args, **kwargs):
        monkeypatch.setattr(auth_module, "write_transaction", real)
        assert there.change(key)[0].status_code == 200
        return real(*args, **kwargs)

    monkeypatch.setattr(auth_module, "write_transaction", after_a_change)
    response, _ = here.upgrade()
    assert elsewhere.refused(response, elsewhere.CHANGED), response.get_data(as_text=True)
    assert elsewhere.salt_of(app, "owner") == there.salt


def test_an_upgrade_with_a_replaced_epoch_and_a_superseded_salt_names_the_vault(app):
    here, key = elsewhere.open_vault(app)
    elsewhere.make_stale(app, "owner")
    here.sign_in("owner", key)
    there = here.another()
    assert there.change(key)[0].status_code == 200
    assert there.restore().status_code == 200

    before = elsewhere.everything(app)
    response, _ = here.upgrade()
    assert elsewhere.refused(response, elsewhere.REPLACED), response.get_data(as_text=True)
    assert elsewhere.everything(app) == before


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
@pytest.mark.parametrize("path", [elsewhere.UPGRADE, elsewhere.CHANGE, elsewhere.IMPORT])
def test_a_request_without_the_current_salt_is_a_bad_request_and_writes_nothing(app, kind, path):
    if kind == "administrator" and path == elsewhere.IMPORT:
        pytest.skip("an administrator reaches no import")
    page, key = elsewhere.open_vault(app, "someone", kind)
    elsewhere.make_stale(app, "someone")
    page.sign_in("someone", key)
    if path == elsewhere.CHANGE:
        body = page.change_body(key, b64(), page.salt)
    elif path == elsewhere.UPGRADE:
        body = {"currentSalt": page.salt, "salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64(),
                **page.wrapper()}
    else:
        body = {"currentSalt": page.salt, "records": [], **page.wrapper()}
    del body["currentSalt"]

    before = elsewhere.everything(app)
    response = page.post(path, body)
    assert response.status_code == 400, response.get_data(as_text=True)
    assert elsewhere.everything(app) == before
