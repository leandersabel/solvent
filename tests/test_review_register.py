"""Reviewer's tests: registration refuses an Auth Key that is not 32
bytes of strict base64 and a profile schema version past 2^53 - 1
(spec/features/register.md, Rules, Checks and their answers, criteria
24, 25, 47 and 48; spec/architecture.md, Key management).

Written from the spec alone.
"""
from __future__ import annotations

import base64
import secrets

import pytest

from tests.helpers import CSRF, b64, connect, mint_invite, register, register_body, rows

LARGEST = 2**53 - 1


def bad_auth_keys():
    """Every way an Auth Key can miss 32 bytes of padded, standard
    base64, each named for the test id."""
    key = base64.b64encode(secrets.token_bytes(32)).decode()
    # A key whose text holds a "+" or "/", so the URL-safe alphabet differs.
    while "+" not in key and "/" not in key:
        key = base64.b64encode(secrets.token_bytes(32)).decode()
    return {
        "3 bytes": b64(3),
        "31 bytes": b64(31),
        "33 bytes": b64(33),
        "64 bytes": b64(64),
        "empty": "",
        "not base64": "not base64 at all!",
        "unpadded": key.rstrip("="),
        "url-safe alphabet": key.replace("+", "-").replace("/", "_"),
        "a newline inside": key[:20] + "\n" + key[20:],
        "padding inside": key[:4] + "=" + key[4:],
        "data after the padding": key + "AAAA",
    }


BAD_KEYS = bad_auth_keys()


def invite_status(app, token):
    from solvent.crypto import hash_invite_token

    return rows(app, "SELECT status FROM invites WHERE token_hash = ?", (hash_invite_token(token),))[0]["status"]


def written(app):
    """Every row a registration could leave, table by table."""
    conn = connect(app)
    try:
        return {
            table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("principals", "credentials", "dek_wrappers", "vault_epochs", "records", "sessions")
        }
    finally:
        conn.close()


def assert_refused_writing_nothing(app, response, token):
    assert response.status_code == 400, response.get_data(as_text=True)
    assert "refused" not in (response.get_json(silent=True) or {})
    assert set(written(app).values()) == {0}
    assert invite_status(app, token) == "pending"


# ---- Criterion 47 ------------------------------------------------------


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
@pytest.mark.parametrize("key", BAD_KEYS.values(), ids=BAD_KEYS.keys())
def test_an_auth_key_that_is_not_thirty_two_bytes_of_strict_base64_is_refused(app, client, kind, key):
    body = register_body(app, kind, authKey=key)
    response = client.post("/api/register", json=body, headers=CSRF)
    assert_refused_writing_nothing(app, response, body["inviteToken"])

    # The same link then registers with a well-formed key.
    body["authKey"] = b64()
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 200
    assert invite_status(app, body["inviteToken"]) == "used"


@pytest.mark.parametrize("key", [BAD_KEYS["3 bytes"], BAD_KEYS["not base64"]], ids=["3 bytes", "not base64"])
def test_the_auth_key_is_checked_after_the_username_and_before_the_invite(app, client, key):
    """Checks and their answers: the username is step 2, the Auth Key
    step 3, the invite step 4 and the taken username step 6."""
    register(app, "taken")

    bad_name = client.post(
        "/api/register", json=register_body(app, username="no spaces allowed", authKey=key), headers=CSRF
    )
    assert bad_name.status_code == 400
    assert bad_name.get_json() == {"refused": "username"}

    unknown_invite = client.post(
        "/api/register", json=register_body(app, inviteToken="unknown-token", authKey=key), headers=CSRF
    )
    assert unknown_invite.status_code == 400
    assert "refused" not in (unknown_invite.get_json(silent=True) or {})

    token = mint_invite(app)
    taken = client.post(
        "/api/register", json=register_body(app, inviteToken=token, username="taken", authKey=key), headers=CSRF
    )
    assert taken.status_code == 400
    assert "refused" not in (taken.get_json(silent=True) or {})
    assert invite_status(app, token) == "pending"


def test_a_thirty_two_byte_auth_key_registers_and_signs_in(app, client):
    key = b64(32)
    register(app, "someone", auth_key=key)
    assert client.post(
        "/api/auth/login", json={"username": "someone", "authKey": key}, headers=CSRF
    ).status_code == 200


# ---- Criterion 48 ------------------------------------------------------


@pytest.mark.parametrize("version", [2**53, 2**63, 10**30], ids=["2^53", "2^63", "10^30"])
def test_a_profile_schema_version_past_the_largest_is_refused_writing_nothing(app, client, version):
    body = register_body(app, profileSchemaVersion=version)
    response = client.post("/api/register", json=body, headers=CSRF)
    assert_refused_writing_nothing(app, response, body["inviteToken"])


def test_a_profile_schema_version_of_the_largest_is_stored(app, client):
    body = register_body(app, profileSchemaVersion=LARGEST)
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 200
    stored = rows(app, "SELECT schema_version FROM records WHERE record_id = ?", (body["profileRecordId"],))
    assert stored == [{"schema_version": LARGEST}]


@pytest.mark.parametrize("version", ["1", True, 1.5], ids=["a string", "true", "a fraction"])
def test_a_profile_schema_version_that_is_not_an_integer_is_refused_writing_nothing(app, client, version):
    """It goes through the record validator, where `schemaVersion` is an
    integer and anything else is a Bad Request (record-api.md, Endpoints)."""
    body = register_body(app, profileSchemaVersion=version)
    response = client.post("/api/register", json=body, headers=CSRF)
    assert_refused_writing_nothing(app, response, body["inviteToken"])
