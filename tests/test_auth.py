"""Registration, sign-in, the stale-KDF upgrade, changing a password
and deleting an account (spec/features/register.md,
spec/features/login.md, spec/features/account-settings.md).
"""
from __future__ import annotations

import json
import uuid

import pytest

from solvent.config import DEFAULT_KDF_ENVELOPE
from tests.helpers import (
    CSRF,
    b64,
    connect,
    credential,
    mint_invite,
    params_of,
    register,
    rows,
    sign_in,
)


def payload(app, kind="vault_owner", **overrides):
    body = {
        "inviteToken": mint_invite(app, kind),
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


# ---- Registration -----------------------------------------------------


def test_registering_a_vault_owner_writes_three_tables(app, client):
    body = payload(app)
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 200

    principal = rows(app, "SELECT * FROM principals")[0]
    assert principal["kind"] == "vault_owner"

    stored = credential(app, "someone")
    assert stored["method"] == "password"
    assert params_of(stored) == {"salt": body["salt"], "kdf": body["kdf"]}
    # An Auth Key hash, never the Auth Key.
    assert body["authKey"] not in stored["verifier"]
    assert stored["verifier"].startswith("$argon2id$")

    wrappers = rows(app, "SELECT * FROM dek_wrappers")
    assert len(wrappers) == 1
    assert wrappers[0]["wrapped_dek"] == body["wrappedDek"]


def test_registering_an_administrator_leaves_zero_wrappers_and_zero_records(app, client):
    body = payload(app, "administrator", username="root")
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 200

    assert rows(app, "SELECT * FROM principals")[0]["kind"] == "administrator"
    assert len(rows(app, "SELECT * FROM credentials")) == 1
    assert rows(app, "SELECT * FROM dek_wrappers") == []
    assert rows(app, "SELECT * FROM records") == []


@pytest.mark.parametrize(
    "extra",
    [
        {"wrappedDek": None, "dekNonce": None},
        {"profileCiphertext": None},
    ],
)
def test_a_vault_owner_invite_needs_the_wrapper_and_the_profile(app, client, extra):
    body = payload(app, **extra)
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 400
    assert rows(app, "SELECT * FROM principals") == []
    assert rows(app, "SELECT status FROM invites")[0]["status"] == "pending"


@pytest.mark.parametrize(
    "extra",
    [
        {"wrappedDek": b64(48), "dekNonce": b64(12)},
        {"profileRecordId": str(uuid.uuid4()), "profileSchemaVersion": 1,
         "profileCiphertext": b64(64), "profileNonce": b64(12)},
    ],
)
def test_an_administrator_invite_refuses_a_wrapper_or_a_profile(app, client, extra):
    body = payload(app, "administrator", username="root", **extra)
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 400
    assert rows(app, "SELECT * FROM principals") == []
    assert rows(app, "SELECT status FROM invites")[0]["status"] == "pending"


@pytest.mark.parametrize("field", ["kind", "method", "principalId"])
def test_a_payload_naming_kind_or_method_is_rejected(app, client, field):
    body = payload(app)
    body[field] = "vault_owner"
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 400


def test_the_stored_kind_always_equals_the_invites(app, client):
    """Asserted by registering through an administrator invite while
    sending kind: vault_owner, which the extra-field rule refuses
    outright."""
    body = payload(app, "administrator", username="root")
    body["kind"] = "vault_owner"
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 400

    del body["kind"]
    client.post("/api/register", json=body, headers=CSRF)
    assert rows(app, "SELECT kind FROM principals")[0]["kind"] == "administrator"


def test_a_kdf_envelope_below_the_server_minimum_is_refused(app, client):
    weak = dict(DEFAULT_KDF_ENVELOPE, m=8192)
    assert client.post(
        "/api/register", json=payload(app, kdf=weak), headers=CSRF
    ).status_code == 400
    assert rows(app, "SELECT * FROM principals") == []


def test_a_salt_that_is_not_sixteen_bytes_is_refused(app, client):
    assert client.post(
        "/api/register", json=payload(app, salt=b64(8)), headers=CSRF
    ).status_code == 400


@pytest.mark.parametrize("username", ["ab", "x" * 33, "Has Spaces", "no/slash", "system:bootstrap"])
def test_a_username_outside_the_rule_is_refused(app, client, username):
    assert client.post(
        "/api/register", json=payload(app, username=username), headers=CSRF
    ).status_code == 400


def test_a_username_is_normalized_before_storage(app, client):
    client.post("/api/register", json=payload(app, username="  MiXeD  "), headers=CSRF)
    assert rows(app, "SELECT username FROM principals")[0]["username"] == "mixed"


def test_a_username_held_by_the_other_kind_is_refused_the_same_way(app, client):
    client.post("/api/register", json=payload(app, "administrator", username="shared"), headers=CSRF)
    same_kind = client.post(
        "/api/register", json=payload(app, "administrator", username="shared"), headers=CSRF
    )
    other_kind = client.post(
        "/api/register", json=payload(app, "vault_owner", username="shared"), headers=CSRF
    )
    assert same_kind.status_code == other_kind.status_code == 409
    assert same_kind.get_data() == other_kind.get_data()


def test_the_invite_is_consumed_and_a_second_use_fails(app, client):
    body = payload(app)
    client.post("/api/register", json=body, headers=CSRF)
    assert rows(app, "SELECT status FROM invites")[0]["status"] == "used"

    again = dict(body, username="another")
    assert client.post("/api/register", json=again, headers=CSRF).status_code == 400


@pytest.mark.parametrize(
    "columns",
    [
        {"status": "used"},
        {"status": "revoked"},
        {"expires_at": "2000-01-01T00:00:00+00:00"},
    ],
)
def test_used_revoked_and_expired_invites_produce_identical_errors(app, client, columns):
    """All four render an identical message so a probe learns nothing
    about which state applies."""
    unknown = client.post(
        "/api/register", json=payload(app, inviteToken="no-such-token"), headers=CSRF
    )
    token = mint_invite(app, **columns)
    broken = client.post(
        "/api/register", json=payload(app, inviteToken=token), headers=CSRF
    )
    assert unknown.status_code == broken.status_code == 400
    assert unknown.get_data() == broken.get_data()


def test_the_register_page_renders_one_message_for_every_bad_invite(app, client):
    bodies = set()
    for columns in ({"status": "used"}, {"status": "revoked"}, {"expires_at": "2000-01-01T00:00:00+00:00"}):
        token = mint_invite(app, **columns)
        bodies.add(client.get(f"/register?invite={token}").get_data())
    bodies.add(client.get("/register?invite=nope").get_data())
    assert len(bodies) == 1


def test_the_register_page_offers_the_currency_list_only_for_a_vault_owner(app, client):
    owner_page = client.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)
    admin_page = client.get(
        f"/register?invite={mint_invite(app, 'administrator')}"
    ).get_data(as_text=True)
    assert "CHF" in owner_page
    assert "CHF" not in admin_page


def test_the_profile_registration_writes_is_an_ordinary_record(app, client):
    body = payload(app)
    client.post("/api/register", json=body, headers=CSRF)
    record = rows(app, "SELECT * FROM records")[0]
    assert record["record_type"] == "profile"
    assert record["account_id"] == ""
    assert record["version"] == 1
    assert record["ciphertext"] == body["profileCiphertext"]


def test_the_main_currency_appears_in_plaintext_nowhere(app, client):
    client.post("/api/register", json=payload(app), headers=CSRF)
    conn = connect(app)
    try:
        dump = "\n".join(conn.iterdump())
    finally:
        conn.close()
    assert "mainCurrency" not in dump


# ---- Sign-in ----------------------------------------------------------


def test_a_vault_owner_login_returns_the_one_wrapper_and_the_kind(app):
    owner, auth_key = register(app, "owner")
    _, body = sign_in(app, "owner", auth_key)
    assert body["kind"] == "vault_owner"
    assert body["wrappedDek"]
    assert body["kdfStale"] is False
    assert set(body) == {"kind", "kdfStale", "wrappedDek", "dekNonce"}


def test_an_administrator_login_carries_no_wrapper(app):
    register(app, "root", kind="administrator")
    admin, auth_key = register(app, "root2", kind="administrator")
    _, body = sign_in(app, "root2", auth_key)
    assert body["kind"] == "administrator"
    assert "wrappedDek" not in body
    assert "dekNonce" not in body


def test_the_salt_response_is_identically_shaped_for_both_kinds_and_a_stranger(app, client):
    register(app, "owner")
    register(app, "root", kind="administrator")
    shapes = set()
    for username in ("owner", "root", "nobody-at-all"):
        body = client.post("/api/auth/salt", json={"username": username}, headers=CSRF).get_json()
        shapes.add(json.dumps(sorted(body)))
        assert sorted(body["kdf"]) == sorted(DEFAULT_KDF_ENVELOPE)
    assert len(shapes) == 1


def test_no_field_of_the_salt_response_names_or_implies_a_kind(app, client):
    register(app, "root", kind="administrator")
    body = client.post("/api/auth/salt", json={"username": "root"}, headers=CSRF).get_json()
    assert set(body) == {"salt", "kdf"}
    assert "administrator" not in json.dumps(body)


def test_the_decoy_salt_for_a_username_is_stable_across_calls(client):
    first = client.post("/api/auth/salt", json={"username": "ghost"}, headers=CSRF).get_json()
    second = client.post("/api/auth/salt", json={"username": "ghost"}, headers=CSRF).get_json()
    assert first == second


def test_a_wrong_auth_key_against_either_kind_and_a_stranger_is_byte_identical(app, client):
    register(app, "owner")
    register(app, "root", kind="administrator")
    answers = {
        username: client.post(
            "/api/auth/login", json={"username": username, "authKey": b64()}, headers=CSRF
        )
        for username in ("owner", "root", "nobody-at-all")
    }
    assert {r.status_code for r in answers.values()} == {401}
    assert len({r.get_data() for r in answers.values()}) == 1


def test_login_writes_last_login_at_and_rotates_the_session(app):
    owner, auth_key = register(app, "owner")
    before = rows(app, "SELECT last_login_at FROM principals")[0]["last_login_at"]
    assert before is None
    sign_in(app, "owner", auth_key)
    assert rows(app, "SELECT last_login_at FROM principals")[0]["last_login_at"]
    assert len(rows(app, "SELECT * FROM sessions")) == 2


def test_the_login_body_carries_no_field_describing_another_credential(app):
    owner, auth_key = register(app, "owner")
    _, body = sign_in(app, "owner", auth_key)
    assert not any("credential" in key.lower() for key in body)


# ---- Stale-KDF upgrade ------------------------------------------------


def stale(app, username):
    conn = connect(app)
    try:
        stored = json.loads(
            conn.execute(
                "SELECT credentials.params FROM credentials JOIN principals "
                "ON principals.id = credentials.principal_id "
                "WHERE principals.username = ?",
                (username,),
            ).fetchone()[0]
        )
        stored["kdf"]["m"] = 32768
        conn.execute(
            "UPDATE credentials SET params = ? WHERE principal_id = "
            "(SELECT id FROM principals WHERE username = ?)",
            (json.dumps(stored), username),
        )
        conn.commit()
    finally:
        conn.close()


def test_a_stale_envelope_is_reported_with_the_target(app):
    owner, auth_key = register(app, "owner")
    stale(app, "owner")
    _, body = sign_in(app, "owner", auth_key)
    assert body["kdfStale"] is True
    assert body["kdf"] == DEFAULT_KDF_ENVELOPE


def test_the_upgrade_replaces_the_credential_and_its_one_wrapper(app):
    owner, auth_key = register(app, "owner")
    other, _ = register(app, "other")
    stale(app, "owner")
    client, _ = sign_in(app, "owner", auth_key)

    before_other = rows(app, "SELECT * FROM credentials WHERE principal_id = "
                        "(SELECT id FROM principals WHERE username = 'other')")
    new_key = b64()
    response = client.post(
        "/api/auth/upgrade-kdf",
        json={
            "salt": b64(16),
            "kdf": dict(DEFAULT_KDF_ENVELOPE),
            "authKey": new_key,
            "wrappedDek": b64(48),
            "dekNonce": b64(12),
        },
        headers=CSRF,
    )
    assert response.status_code == 200
    assert params_of(credential(app, "owner"))["kdf"] == DEFAULT_KDF_ENVELOPE
    # No other row changed.
    assert rows(app, "SELECT * FROM credentials WHERE principal_id = "
                "(SELECT id FROM principals WHERE username = 'other')") == before_other
    # The new Auth Key signs in and the old one does not.
    sign_in(app, "owner", new_key)
    assert app.test_client().post(
        "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
    ).status_code == 401


def test_an_administrator_upgrade_creates_no_wrapper(app):
    register(app, "root", kind="administrator")
    admin, auth_key = register(app, "root2", kind="administrator")
    stale(app, "root2")
    client, _ = sign_in(app, "root2", auth_key)

    assert client.post(
        "/api/auth/upgrade-kdf",
        json={"salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64()},
        headers=CSRF,
    ).status_code == 200
    assert rows(app, "SELECT * FROM dek_wrappers") == []


def test_the_server_discriminates_on_kind_not_on_which_fields_arrived(app):
    register(app, "root", kind="administrator")
    admin, admin_key = register(app, "root2", kind="administrator")
    owner, owner_key = register(app, "owner")

    admin_client, _ = sign_in(app, "root2", admin_key)
    with_wrapper = admin_client.post(
        "/api/auth/upgrade-kdf",
        json={
            "salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64(),
            "wrappedDek": b64(48), "dekNonce": b64(12),
        },
        headers=CSRF,
    )
    owner_client, _ = sign_in(app, "owner", owner_key)
    without_wrapper = owner_client.post(
        "/api/auth/upgrade-kdf",
        json={"salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64()},
        headers=CSRF,
    )
    assert with_wrapper.status_code == 400
    assert without_wrapper.status_code == 400
    # Nothing written by either.
    assert params_of(credential(app, "root2"))["kdf"] == DEFAULT_KDF_ENVELOPE


# ---- Change password and delete ---------------------------------------


def test_changing_a_password_rewrites_the_credential_and_the_wrapper_only(app):
    owner, auth_key = register(app, "owner")
    record = rows(app, "SELECT * FROM records")[0]
    new_key = b64()

    response = owner.post(
        "/api/auth/change-password",
        json={
            "currentAuthKey": auth_key,
            "salt": b64(16),
            "kdf": dict(DEFAULT_KDF_ENVELOPE),
            "authKey": new_key,
            "wrappedDek": b64(48),
            "dekNonce": b64(12),
        },
        headers=CSRF,
    )
    assert response.status_code == 200
    # Every record's ciphertext is byte-identical.
    assert rows(app, "SELECT * FROM records")[0] == record
    sign_in(app, "owner", new_key)
    assert app.test_client().post(
        "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
    ).status_code == 401


def test_a_wrong_current_auth_key_is_refused_server_side(app):
    owner, auth_key = register(app, "owner")
    before = credential(app, "owner")["verifier"]
    assert owner.post(
        "/api/auth/change-password",
        json={
            "currentAuthKey": b64(),
            "salt": b64(16),
            "kdf": dict(DEFAULT_KDF_ENVELOPE),
            "authKey": b64(),
            "wrappedDek": b64(48),
            "dekNonce": b64(12),
        },
        headers=CSRF,
    ).status_code == 400
    assert credential(app, "owner")["verifier"] == before


def test_a_password_change_ends_every_other_session_and_keeps_this_one(app):
    owner, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    assert len(rows(app, "SELECT * FROM sessions")) == 2

    owner.post(
        "/api/auth/change-password",
        json={
            "currentAuthKey": auth_key,
            "salt": b64(16),
            "kdf": dict(DEFAULT_KDF_ENVELOPE),
            "authKey": b64(),
            "wrappedDek": b64(48),
            "dekNonce": b64(12),
        },
        headers=CSRF,
    )
    assert len(rows(app, "SELECT * FROM sessions")) == 1
    assert owner.get("/api/sessions", headers=CSRF).status_code == 200
    assert second.get("/api/sessions", headers=CSRF).status_code == 401


def test_sessions_report_no_ip_and_no_user_agent(app):
    owner, _ = register(app, "owner")
    body = owner.get("/api/sessions", headers=CSRF).get_json()
    assert set(body[0]) == {"id", "issuedAt", "lastActiveAt", "current"}
    assert body[0]["current"] is True


def test_log_out_everywhere_ends_the_current_session_too(app):
    owner, auth_key = register(app, "owner")
    sign_in(app, "owner", auth_key)
    owner.post("/api/auth/logout-all", json={}, headers=CSRF)
    assert rows(app, "SELECT * FROM sessions") == []


def test_logout_ends_only_the_calling_session(app):
    owner, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    owner.post("/api/auth/logout", json={}, headers=CSRF)
    assert second.get("/api/sessions", headers=CSRF).status_code == 200


def test_deleting_an_account_needs_the_auth_key_and_the_typed_username(app):
    owner, auth_key = register(app, "owner")
    for body in (
        {"authKey": b64(), "confirmUsername": "owner"},
        {"authKey": auth_key, "confirmUsername": "someone-else"},
    ):
        assert owner.delete("/api/auth/account", json=body, headers=CSRF).status_code == 400
    assert rows(app, "SELECT * FROM principals")

    assert owner.delete(
        "/api/auth/account",
        json={"authKey": auth_key, "confirmUsername": "owner"},
        headers=CSRF,
    ).status_code == 200
    for table in ("principals", "credentials", "dek_wrappers", "records", "sessions"):
        assert rows(app, f"SELECT * FROM {table}") == [], table


def test_an_already_authenticated_caller_at_login_is_sent_to_the_root(app):
    owner, _ = register(app, "owner")
    assert owner.get("/login").headers["Location"] == "/"
