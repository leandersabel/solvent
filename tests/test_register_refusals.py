"""What POST /api/register answers to each way of being wrong, and in
which order (spec/features/register.md, Checks and their answers)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from solvent.config import DEFAULT_KDF_ENVELOPE
from solvent.validation import normalize_username
from tests.helpers import CSRF, b64, mint_invite, register, register_body as payload, rows

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "usernames.json").read_text("utf-8"))


def post(client, body):
    return client.post("/api/register", json=body, headers=CSRF)


def refused(response):
    parsed = response.get_json(silent=True)
    return parsed.get("refused") if isinstance(parsed, dict) else None


def assert_nothing_written(app, token_hash_status="pending"):
    assert rows(app, "SELECT 1 FROM principals") == []
    assert {r["status"] for r in rows(app, "SELECT status FROM invites")} <= {token_hash_status}


@pytest.mark.parametrize("case", FIXTURE["accept"], ids=lambda c: repr(c["raw"]))
def test_the_server_accepts_what_the_fixture_accepts(case):
    assert normalize_username(case["raw"]) == case["normalized"]


@pytest.mark.parametrize("raw", FIXTURE["refuse"], ids=repr)
def test_the_server_refuses_what_the_fixture_refuses(raw):
    assert normalize_username(raw) is None


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
@pytest.mark.parametrize("raw", ["Bo b!", "ab", "system:bootstrap"])
def test_a_username_outside_the_rule_is_refused_by_name_with_a_usable_invite(app, client, kind, raw):
    response = post(client, payload(app, kind, username=raw))
    assert response.status_code == 400
    assert response.get_json() == {"refused": "username"}
    assert_nothing_written(app)


def test_a_username_outside_the_rule_is_refused_by_name_with_an_unusable_invite(app, client):
    response = post(client, payload(app, inviteToken="no-such-token", username="Bo b!"))
    assert response.status_code == 400
    assert response.get_json() == {"refused": "username"}


def test_an_unusable_invite_is_refused_before_a_taken_username(app, client):
    register(app, "taken")
    response = post(client, payload(app, inviteToken="no-such-token", username="taken"))
    assert response.status_code == 400
    assert response.get_json() == {"refused": "invite"}


@pytest.mark.parametrize(
    "columns",
    [{"status": "used"}, {"status": "revoked"}, {"expires_at": "2000-01-01T00:00:00+00:00"}],
)
def test_the_five_bad_tokens_answer_the_same_bytes(app, client, columns):
    def raw(response):
        return response.status_code, sorted(response.headers.items()), response.get_data()

    unknown = post(client, payload(app, inviteToken="no-such-token"))
    empty = post(client, {**payload(app), "inviteToken": ""})
    broken = post(client, payload(app, inviteToken=mint_invite(app, **columns)))
    assert raw(unknown) == raw(empty) == raw(broken)
    assert unknown.status_code == 400
    assert unknown.get_json() == {"refused": "invite"}


@pytest.mark.parametrize(
    "build",
    [
        lambda app: {**payload(app), "kind": "x"},
        lambda app: {**payload(app), "method": "password"},
        lambda app: {**payload(app), "extra": 1},
        lambda app: payload(app, salt=b64(8)),
        lambda app: payload(app, kdf={**DEFAULT_KDF_ENVELOPE, "m": 8}),
        lambda app: payload(app, dekNonce="not base64!"),
        lambda app: payload(app, dekNonce=b64(8)),
        lambda app: payload(app, wrappedDek="not base64!"),
        lambda app: payload(app, "administrator", wrappedDek=b64(48)),
        lambda app: {k: v for k, v in payload(app).items() if k != "wrappedDek"},
    ],
    ids=["kind", "method", "unknown", "salt", "kdf", "nonce-chars", "nonce-size",
         "wrapped-chars", "wrapper-on-admin", "wrapper-missing"],
)
def test_every_other_bad_request_names_no_reason_and_writes_nothing(app, client, build):
    response = post(client, build(app))
    assert response.status_code == 400
    assert refused(response) is None
    assert_nothing_written(app)


def test_a_taken_username_is_a_conflict_that_writes_nothing_and_leaves_the_invite(app, client):
    register(app, "taken")
    response = post(client, payload(app, username="Taken"))
    assert response.status_code == 409
    assert refused(response) is None
    assert len(rows(app, "SELECT 1 FROM principals")) == 1
    assert [r["status"] for r in rows(app, "SELECT status FROM invites ORDER BY created_at")][-1] == "pending"


def test_a_profile_record_the_validator_refuses_leaves_the_invite_pending(app, client):
    response = post(client, payload(app, profileRecordId="not-a-uuid"))
    assert response.status_code == 400
    assert refused(response) is None
    assert_nothing_written(app)


@pytest.mark.parametrize("auth_key", ["AAAA", 31, 33, "not base64!"])
@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
def test_an_auth_key_that_is_not_thirty_two_bytes_is_refused(app, client, kind, auth_key):
    if isinstance(auth_key, int):
        auth_key = b64(auth_key)
    response = post(client, payload(app, kind, authKey=auth_key))
    assert response.status_code == 400
    assert refused(response) is None
    assert "Set-Cookie" not in response.headers
    assert_nothing_written(app)


def test_a_profile_schema_version_past_two_to_the_fifty_three_is_a_bad_request(app, client):
    response = post(client, payload(app, profileSchemaVersion=2**53))
    assert response.status_code == 400
    assert refused(response) is None
    assert_nothing_written(app)
