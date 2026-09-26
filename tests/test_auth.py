"""Registration, sign-in, the stale-KDF upgrade, changing a password
and deleting an account (spec/features/register.md,
spec/features/login.md, spec/features/account-settings.md).
"""
from __future__ import annotations

import base64
import json
import threading
import time
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
    put_record,
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
    signed_in, body = sign_in(app, "root2", auth_key)
    assert body["kind"] == "administrator"
    assert "wrappedDek" not in body
    assert "dekNonce" not in body
    # The session that login issued is the one that reaches the admin
    # area, page and API alike.
    assert signed_in.get("/").headers["Location"] == "/admin"
    assert signed_in.get("/admin").status_code == 200
    assert signed_in.get("/api/admin/invites", headers=CSRF).status_code == 200


def shape_of(value):
    """The structure of a JSON value with every leaf replaced by its
    type, so two bodies compare on their full field set at every
    depth and not on their top-level keys alone."""
    if isinstance(value, dict):
        return {key: shape_of(item) for key, item in value.items()}
    if isinstance(value, list):
        return [shape_of(item) for item in value]
    return type(value).__name__


def test_the_salt_response_is_identically_shaped_for_both_kinds_and_a_stranger(app, client):
    """Three ways, over the status, the header names and the full body
    shape, so a field added later for one case breaks it."""
    register(app, "owner")
    register(app, "root", kind="administrator")
    seen = {}
    for username in ("owner", "root", "nobody-at-all"):
        response = client.post("/api/auth/salt", json={"username": username}, headers=CSRF)
        body = response.get_json()
        seen[username] = (
            response.status_code,
            sorted(name for name, _ in response.headers if name != "Date"),
            response.headers["Content-Length"],
            json.dumps(shape_of(body), sort_keys=True),
            len(base64.b64decode(body["salt"])),
            json.dumps(body["kdf"], sort_keys=True),
        )
    assert len(set(map(repr, seen.values()))) == 1, seen


def test_no_field_of_the_salt_response_names_or_implies_a_kind(app, client):
    register(app, "owner")
    register(app, "root", kind="administrator")
    for username in ("owner", "root", "nobody-at-all"):
        body = client.post("/api/auth/salt", json={"username": username}, headers=CSRF).get_json()
        # The full shape, pinned: an added field anywhere fails here.
        assert shape_of(body) == {
            "salt": "str",
            "kdf": {"alg": "str", "v": "int", "m": "int", "t": "int", "p": "int"},
        }
        assert body["kdf"] == DEFAULT_KDF_ENVELOPE
        # The salt is random bytes and may spell anything, so it is
        # the one value left out of the word check.
        words = json.dumps(dict(body, salt="")).lower()
        for word in ("administrator", "vault", "owner", "admin", "wrapper", "kind"):
            assert word not in words


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


def answers(response):
    """What a caller can observe of one response."""
    return (
        response.status_code,
        response.get_data(),
        sorted((k, v) for k, v in response.headers if k != "Date"),
    )


@pytest.mark.parametrize(
    "limits",
    [
        # The per-account attempt limit.
        {"LOGIN_ATTEMPTS_PER_ACCOUNT": 3, "LOGIN_LOCKOUT_THRESHOLD": 10**9},
        # The lockout once enough fail within the longer window.
        {"LOGIN_ATTEMPTS_PER_ACCOUNT": 10**9, "LOGIN_LOCKOUT_THRESHOLD": 3},
    ],
    ids=["attempt limit", "lockout"],
)
def test_exceeding_the_account_limit_locks_it_the_same_way_for_a_stranger(app, limits, caplog):
    """Asserted at whatever the configured value is, never at a count:
    the limit engages, it holds against the right Auth Key too, and
    the throttled answer is the same for either kind and for a
    username nobody has."""
    app.config.update(limits)
    _, owner_key = register(app, "owner")
    _, admin_key = register(app, "root", kind="administrator")
    ceiling = min(limits.values())
    client = app.test_client()

    for username in ("owner", "root", "nobody-at-all"):
        for _ in range(ceiling):
            assert client.post(
                "/api/auth/login", json={"username": username, "authKey": b64()}, headers=CSRF
            ).status_code == 401

    with caplog.at_level("WARNING"):
        seen = {
            (endpoint, username): answers(
                client.post(endpoint, json={"username": username, "authKey": key}, headers=CSRF)
                if endpoint.endswith("login")
                else client.post(endpoint, json={"username": username}, headers=CSRF)
            )
            for endpoint in ("/api/auth/login", "/api/auth/salt")
            for username, key in (
                ("owner", owner_key),
                ("root", admin_key),
                ("nobody-at-all", b64()),
            )
        }
    # The right Auth Key is refused while the account is locked.
    assert {answer[0] for answer in seen.values()} == {429}
    for endpoint in ("/api/auth/login", "/api/auth/salt"):
        same = {repr(answer) for (path, _), answer in seen.items() if path == endpoint}
        assert len(same) == 1, endpoint

    if limits["LOGIN_LOCKOUT_THRESHOLD"] == ceiling:
        # Alerting is a structured log line with a stable name, the
        # account and the window.
        events = [r.getMessage() for r in caplog.records if r.getMessage().startswith("auth.lockout ")]
        assert "auth.lockout account=owner window_minutes=15" in events
        assert "auth.lockout account=nobody-at-all window_minutes=15" in events


def test_a_login_cookie_carries_its_flags_and_no_key_material(app):
    _, auth_key = register(app, "owner")
    client = app.test_client()
    response = client.post(
        "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
    )
    header = response.headers["Set-Cookie"]
    for flag in ("HttpOnly", "Secure", "SameSite=Lax"):
        assert flag in header
    body = response.get_json()
    for value in (auth_key, body["wrappedDek"], body["dekNonce"], rows(app, "SELECT id FROM principals")[0]["id"]):
        assert value not in header


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


KEY_TABLES = ("principals", "credentials", "dek_wrappers")
EVERY_TABLE = KEY_TABLES + ("records", "sessions", "invites")


def snapshot(app, tables=KEY_TABLES):
    """Every row of each table, keyed by its primary key, so a
    comparison names exactly which rows a request changed."""
    keys = {
        "principals": ("id",),
        "credentials": ("id",),
        "dek_wrappers": ("credential_id",),
        "records": ("principal_id", "record_id"),
        "sessions": ("id",),
        "invites": ("id",),
    }
    return {
        table: {
            tuple(row[column] for column in keys[table]): row
            for row in rows(app, f"SELECT * FROM {table}")
        }
        for table in tables
    }


def changed_rows(before, after):
    """(table, key) for every row added, removed or altered."""
    changed = set()
    for table in before:
        for key in set(before[table]) | set(after[table]):
            if before[table].get(key) != after[table].get(key):
                changed.add((table, key))
    return changed


def rotation(**extra):
    return {"salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64(), **extra}


def test_the_upgrade_replaces_the_credential_and_its_one_wrapper(app):
    owner, auth_key = register(app, "owner")
    register(app, "other")
    register(app, "root", kind="administrator")
    stale(app, "owner")
    client, _ = sign_in(app, "owner", auth_key)
    own = credential(app, "owner")

    before = snapshot(app)
    new_key = b64()
    response = client.post(
        "/api/auth/upgrade-kdf",
        json=rotation(authKey=new_key, wrappedDek=b64(48), dekNonce=b64(12)),
        headers=CSRF,
    )
    assert response.status_code == 200
    after = snapshot(app)

    # The password credential row and its one wrapper, and nothing else
    # in principals, credentials or dek_wrappers.
    assert changed_rows(before, after) == {
        ("credentials", (own["id"],)),
        ("dek_wrappers", (own["id"],)),
    }
    old_row, new_row = before["credentials"][(own["id"],)], after["credentials"][(own["id"],)]
    old_params, new_params = json.loads(old_row["params"]), json.loads(new_row["params"])
    assert new_params["salt"] != old_params["salt"]
    assert new_params["kdf"] == DEFAULT_KDF_ENVELOPE != old_params["kdf"]
    assert new_row["verifier"] != old_row["verifier"]
    old_wrapper, new_wrapper = before["dek_wrappers"][(own["id"],)], after["dek_wrappers"][(own["id"],)]
    assert new_wrapper["wrapped_dek"] != old_wrapper["wrapped_dek"]
    assert new_wrapper["dek_nonce"] != old_wrapper["dek_nonce"]

    # The new Auth Key signs in and the old one does not.
    _, body = sign_in(app, "owner", new_key)
    assert body["kdfStale"] is False
    assert app.test_client().post(
        "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
    ).status_code == 401


def test_an_administrator_upgrade_creates_no_wrapper(app):
    register(app, "root", kind="administrator")
    register(app, "owner")
    admin, auth_key = register(app, "root2", kind="administrator")
    stale(app, "root2")
    client, _ = sign_in(app, "root2", auth_key)
    own = credential(app, "root2")

    before = snapshot(app)
    new_key = b64()
    assert client.post(
        "/api/auth/upgrade-kdf", json=rotation(authKey=new_key), headers=CSRF
    ).status_code == 200
    after = snapshot(app)

    assert changed_rows(before, after) == {("credentials", (own["id"],))}
    old_row, new_row = before["credentials"][(own["id"],)], after["credentials"][(own["id"],)]
    assert json.loads(new_row["params"])["salt"] != json.loads(old_row["params"])["salt"]
    assert json.loads(new_row["params"])["kdf"] == DEFAULT_KDF_ENVELOPE
    assert new_row["verifier"] != old_row["verifier"]
    assert not any(key == (own["id"],) for key in after["dek_wrappers"])

    # The upgraded credential still signs them in, to the admin area.
    signed_in, body = sign_in(app, "root2", new_key)
    assert body == {"kind": "administrator", "kdfStale": False}
    assert signed_in.get("/admin").status_code == 200


def test_raising_the_server_default_upgrades_an_account_at_the_old_one(app, monkeypatch):
    """The operator raises the default memory parameter, and the next
    sign-in is told to upgrade to it: the parameter has a live upgrade
    path rather than a documented one."""
    owner, auth_key = register(app, "owner")
    admin, admin_key = register(app, "root", kind="administrator")
    records_before = rows(app, "SELECT * FROM records")
    raised = DEFAULT_KDF_ENVELOPE["m"] * 2
    monkeypatch.setitem(DEFAULT_KDF_ENVELOPE, "m", raised)

    for username, key, wrapper in (
        ("owner", auth_key, {"wrappedDek": b64(48), "dekNonce": b64(12)}),
        ("root", admin_key, {}),
    ):
        client, body = sign_in(app, username, key)
        assert body["kdfStale"] is True, username
        assert body["kdf"]["m"] == raised
        new_key = b64()
        assert client.post(
            "/api/auth/upgrade-kdf",
            json=rotation(kdf=dict(body["kdf"]), authKey=new_key, **wrapper),
            headers=CSRF,
        ).status_code == 200
        assert params_of(credential(app, username))["kdf"]["m"] == raised
        _, again = sign_in(app, username, new_key)
        assert again["kdfStale"] is False, username

    # No record is re-encrypted by either upgrade.
    assert rows(app, "SELECT * FROM records") == records_before


def test_the_server_discriminates_on_kind_not_on_which_fields_arrived(app):
    register(app, "root", kind="administrator")
    admin, admin_key = register(app, "root2", kind="administrator")
    owner, owner_key = register(app, "owner")

    admin_client, _ = sign_in(app, "root2", admin_key)
    owner_client, _ = sign_in(app, "owner", owner_key)
    before = snapshot(app, EVERY_TABLE)
    with_wrapper = admin_client.post(
        "/api/auth/upgrade-kdf",
        json={
            "salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64(),
            "wrappedDek": b64(48), "dekNonce": b64(12),
        },
        headers=CSRF,
    )
    without_wrapper = owner_client.post(
        "/api/auth/upgrade-kdf",
        json={"salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64()},
        headers=CSRF,
    )
    assert with_wrapper.status_code == 400
    assert without_wrapper.status_code == 400
    # Nothing written by either, in any table.
    assert snapshot(app, EVERY_TABLE) == before


# ---- Change password and delete ---------------------------------------


def test_changing_a_password_rewrites_the_credential_and_the_wrapper_only(app):
    owner, auth_key = register(app, "owner")
    other, _ = register(app, "other")
    register(app, "root", kind="administrator")
    for client in (owner, other):
        for record_type in ("account", "rate"):
            put_record(client, record_type=record_type)
    own = credential(app, "owner")
    new_key = b64()

    before = snapshot(app, EVERY_TABLE)
    response = owner.post(
        "/api/auth/change-password",
        json=rotation(currentAuthKey=auth_key, authKey=new_key, wrappedDek=b64(48), dekNonce=b64(12)),
        headers=CSRF,
    )
    assert response.status_code == 200
    after = snapshot(app, EVERY_TABLE)

    # The password credential row and its wrapper, and no other row.
    # Sessions are the one other table a password change writes, and
    # only by ending this account's other sessions (asserted below).
    assert {(t, k) for t, k in changed_rows(before, after) if t != "sessions"} == {
        ("credentials", (own["id"],)),
        ("dek_wrappers", (own["id"],)),
    }
    old_row, new_row = before["credentials"][(own["id"],)], after["credentials"][(own["id"],)]
    assert json.loads(new_row["params"])["salt"] != json.loads(old_row["params"])["salt"]
    assert new_row["verifier"] != old_row["verifier"]
    assert (
        after["dek_wrappers"][(own["id"],)]["wrapped_dek"]
        != before["dek_wrappers"][(own["id"],)]["wrapped_dek"]
    )
    # Every record's ciphertext is byte-identical, this vault's included.
    assert after["records"] == before["records"]

    sign_in(app, "owner", new_key)
    assert app.test_client().post(
        "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
    ).status_code == 401


def test_a_password_change_on_old_parameters_lands_on_the_current_default(app):
    owner, auth_key = register(app, "owner")
    stale(app, "owner")
    assert owner.post(
        "/api/auth/change-password",
        json=rotation(currentAuthKey=auth_key, wrappedDek=b64(48), dekNonce=b64(12)),
        headers=CSRF,
    ).status_code == 200
    assert params_of(credential(app, "owner"))["kdf"] == DEFAULT_KDF_ENVELOPE


def test_an_administrator_changes_their_password_without_a_wrapper(app):
    register(app, "root", kind="administrator")
    register(app, "owner")
    admin, auth_key = register(app, "root2", kind="administrator")
    own = credential(app, "root2")
    new_key = b64()

    before = snapshot(app)
    assert admin.post(
        "/api/auth/change-password",
        json=rotation(currentAuthKey=auth_key, authKey=new_key),
        headers=CSRF,
    ).status_code == 200
    after = snapshot(app)

    assert changed_rows(before, after) == {("credentials", (own["id"],))}
    assert (own["id"],) not in after["dek_wrappers"]
    signed_in, body = sign_in(app, "root2", new_key)
    assert body["kind"] == "administrator"
    assert app.test_client().post(
        "/api/auth/login", json={"username": "root2", "authKey": auth_key}, headers=CSRF
    ).status_code == 401


def test_the_change_password_wrapper_follows_the_session_kind(app):
    """An administrator carrying a wrapper, and a vault owner without
    one, are each a Bad Request that writes nothing."""
    register(app, "root", kind="administrator")
    admin, admin_key = register(app, "root2", kind="administrator")
    owner, owner_key = register(app, "owner")

    before = snapshot(app, EVERY_TABLE)
    assert admin.post(
        "/api/auth/change-password",
        json=rotation(currentAuthKey=admin_key, wrappedDek=b64(48), dekNonce=b64(12)),
        headers=CSRF,
    ).status_code == 400
    assert owner.post(
        "/api/auth/change-password",
        json=rotation(currentAuthKey=owner_key),
        headers=CSRF,
    ).status_code == 400
    assert snapshot(app, EVERY_TABLE) == before


def test_a_wrong_current_auth_key_is_refused_server_side(app):
    """Called directly, with no client-side unwrap in front of it."""
    owner, auth_key = register(app, "owner")
    sign_in(app, "owner", auth_key)
    before = snapshot(app, EVERY_TABLE)
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
    assert snapshot(app, EVERY_TABLE) == before


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
    from solvent.session import COOKIE_NAME

    owner, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    body = owner.get("/api/sessions", headers=CSRF).get_json()
    # The full shape of every entry, so an added field fails here.
    assert len(body) == 2
    for entry in body:
        assert shape_of(entry) == {"id": "str", "issuedAt": "str", "lastActiveAt": "str", "current": "bool"}
    assert [entry["current"] for entry in body].count(True) == 1

    # No cookie value and no stored token hash, for either session.
    cookies = {
        c.value for client in (owner, second) for c in client._cookies.values() if c.key == COOKIE_NAME
    }
    hashes = {row["token_hash"] for row in rows(app, "SELECT token_hash FROM sessions")}
    listed = json.dumps(body)
    for secret in cookies | hashes | {c.rsplit(".", 1)[0] for c in cookies}:
        assert secret not in listed


def test_sessions_list_only_the_callers_own(app):
    owner, owner_key = register(app, "owner")
    other, other_key = register(app, "other")
    sign_in(app, "other", other_key)
    own_ids = {row["id"] for row in rows(
        app,
        "SELECT sessions.id FROM sessions JOIN principals ON principals.id = sessions.principal_id "
        "WHERE principals.username = 'owner'",
    )}
    listed = {entry["id"] for entry in owner.get("/api/sessions", headers=CSRF).get_json()}
    assert listed == own_ids


def test_log_out_everywhere_ends_the_current_session_too(app):
    owner, auth_key = register(app, "owner")
    sign_in(app, "owner", auth_key)
    owner.post("/api/auth/logout-all", json={}, headers=CSRF)
    assert rows(app, "SELECT * FROM sessions") == []


def test_logout_ends_only_the_calling_session(app):
    from solvent.session import COOKIE_NAME

    owner, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    calling = next(c.value for c in owner._cookies.values() if c.key == COOKIE_NAME)
    owner.post("/api/auth/logout", json={}, headers=CSRF)
    assert second.get("/api/sessions", headers=CSRF).status_code == 200
    # The calling session is gone on the server, not only its cookie.
    replay = app.test_client()
    replay.set_cookie(COOKIE_NAME, calling)
    assert replay.get("/api/sessions", headers=CSRF).status_code == 401


def test_deleting_an_account_needs_the_auth_key_and_the_typed_username(app):
    """Called directly, since a client bypassing the dialog is the case
    that matters."""
    owner, auth_key = register(app, "owner")
    put_record(owner)
    register(app, "other")
    before = snapshot(app, EVERY_TABLE)
    for body in (
        {"authKey": b64(), "confirmUsername": "owner"},
        {"authKey": auth_key, "confirmUsername": "someone-else"},
        {"authKey": auth_key, "confirmUsername": "other"},
    ):
        assert owner.delete("/api/auth/account", json=body, headers=CSRF).status_code == 400
        assert snapshot(app, EVERY_TABLE) == before, body

    own_id = rows(app, "SELECT id FROM principals WHERE username = 'owner'")[0]["id"]
    assert owner.delete(
        "/api/auth/account",
        json={"authKey": auth_key, "confirmUsername": "owner"},
        headers=CSRF,
    ).status_code == 200
    for table, column in (
        ("principals", "id"),
        ("credentials", "principal_id"),
        ("records", "principal_id"),
        ("sessions", "principal_id"),
    ):
        assert rows(app, f"SELECT * FROM {table} WHERE {column} = ?", (own_id,)) == [], table
    assert len(rows(app, "SELECT * FROM dek_wrappers")) == 1
    # The other vault is untouched.
    assert rows(app, "SELECT username FROM principals") == [{"username": "other"}]

    # The same credentials no longer sign in, and the old session is dead.
    assert app.test_client().post(
        "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
    ).status_code == 401
    assert owner.get("/api/sessions", headers=CSRF).status_code == 401


def test_an_administrator_cannot_delete_through_the_vault_owners_path(app):
    """Not Found and nothing deleted, including when they are not the
    last administrator."""
    register(app, "root", kind="administrator")
    register(app, "root2", kind="administrator")
    admin, auth_key = register(app, "root3", kind="administrator")
    register(app, "owner")
    before = snapshot(app, EVERY_TABLE)
    response = admin.delete(
        "/api/auth/account",
        json={"authKey": auth_key, "confirmUsername": "root3"},
        headers=CSRF,
    )
    assert response.status_code == 404
    assert snapshot(app, EVERY_TABLE) == before


@pytest.mark.parametrize(
    "method, path",
    [
        ("POST", "/api/auth/change-password"),
        ("GET", "/api/sessions"),
        ("POST", "/api/auth/logout-all"),
        ("DELETE", "/api/auth/account"),
    ],
)
def test_the_settings_endpoints_need_a_session(client, method, path):
    assert client.open(path, method=method, json={}, headers=CSRF).status_code == 401


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("POST", "/api/auth/change-password", "rotation"),
        ("POST", "/api/auth/logout", {}),
        ("POST", "/api/auth/logout-all", {}),
        ("DELETE", "/api/auth/account", "delete"),
    ],
)
def test_the_settings_writes_need_the_request_header(app, method, path, body):
    owner, auth_key = register(app, "owner")
    if body == "rotation":
        body = rotation(currentAuthKey=auth_key, wrappedDek=b64(48), dekNonce=b64(12))
    elif body == "delete":
        body = {"authKey": auth_key, "confirmUsername": "owner"}
    before = snapshot(app, EVERY_TABLE)
    assert owner.open(path, method=method, json=body).status_code == 403
    assert snapshot(app, EVERY_TABLE) == before


def test_an_already_authenticated_caller_at_login_is_sent_to_the_root(app):
    owner, _ = register(app, "owner")
    assert owner.get("/login").headers["Location"] == "/"


def verify_gate(app):
    """The app's one verification gate, made the way the first
    verification makes it."""
    from solvent.crypto import _slot

    with app.test_request_context():
        with _slot():
            pass
    return app.extensions["solvent.verify_gate"]


def test_a_verification_over_the_cap_waits_for_a_slot(app):
    """architecture.md, Concurrency cap: a request over the cap queues,
    and a slot freed inside the wait is taken."""
    app.config.update(VERIFY_CONCURRENCY=1, VERIFY_WAIT_SECONDS=5)
    _, auth_key = register(app, "owner")
    gate = verify_gate(app)
    assert gate.acquire(timeout=1)
    freed = threading.Timer(0.2, gate.release)
    freed.start()
    try:
        response = app.test_client().post(
            "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
        )
    finally:
        freed.join()
    assert response.status_code == 200


def test_a_verification_that_waits_past_the_bound_is_throttled(app):
    """A request that finds every slot taken for the whole wait answers
    with the ordinary throttle response rather than waiting on, and
    the next one takes the slot once it is free."""
    app.config.update(VERIFY_CONCURRENCY=1, VERIFY_WAIT_SECONDS=0.3)
    _, auth_key = register(app, "owner")
    gate = verify_gate(app)
    client = app.test_client()
    login = {"username": "owner", "authKey": auth_key}

    assert gate.acquire(timeout=1)
    try:
        started = time.monotonic()
        waited = client.post("/api/auth/login", json=login, headers=CSRF)
        elapsed = time.monotonic() - started
    finally:
        gate.release()
    assert waited.status_code == 429
    assert elapsed >= 0.3

    assert client.post("/api/auth/login", json=login, headers=CSRF).status_code == 200

    # The same answer the rate limiter gives.
    app.config.update(LOGIN_REQUESTS_PER_IP_HOUR=0)
    limited = client.post("/api/auth/login", json=login, headers=CSRF)
    assert answers(waited) == answers(limited)


def test_logout_without_a_session_answers_ok(client):
    """account-settings.md, Session and lock: signing out of nothing is
    harmless, and asking twice is the same as asking once."""
    for _ in range(2):
        response = client.post("/api/auth/logout", json={}, headers=CSRF)
        assert response.status_code == 200
