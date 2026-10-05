"""Reviewer's tests: a wrong password on Change password or Delete my
account is a failed sign-in, and a new Auth Key that is not 32 bytes
changes nothing (spec/features/account-settings.md, criteria 11, 43, 77
and 79; spec/architecture.md, Security, Rate limiting and Key
management).

Written from the spec alone. Every limit is set through config and
asserted at the configured value.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from solvent.config import DEFAULT_KDF_ENVELOPE
from tests.helpers import CSRF, b64, connect, register, sign_in
from tests.test_review_register import BAD_KEYS

LOGIN = "/api/auth/login"
CHANGE = "/api/auth/change-password"
ACCOUNT = "/api/auth/account"
OUT_OF_REACH = 10**9
ADDRESS = "203.0.113.7"
OTHER_ADDRESS = "198.51.100.9"

# The tables a request could write, each with the columns that identify
# a row. Session rows leave out last_active_at, which the request gate
# writes on a request refused after it (architecture.md, Application
# hardening).
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


def attempts(app):
    conn = connect(app)
    try:
        return [tuple(row) for row in conn.execute("SELECT bucket, outcome FROM attempts ORDER BY rowid")]
    finally:
        conn.close()


def at(address):
    return {"REMOTE_ADDR": address}


def change(client, current, *, administrator=False, address=ADDRESS):
    body = {"currentAuthKey": current, "salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64()}
    if not administrator:
        body.update(wrappedDek=b64(48), dekNonce=b64(12))
    return client.post(CHANGE, json=body, headers=CSRF, environ_overrides=at(address))


def delete(client, key, confirm="owner", address=ADDRESS):
    return client.delete(
        ACCOUNT,
        json={"authKey": key, "confirmUsername": confirm},
        headers=CSRF,
        environ_overrides=at(address),
    )


def login(app, username, key, address=ADDRESS):
    return app.test_client().post(
        LOGIN,
        json={"username": username, "authKey": key},
        headers=CSRF,
        environ_overrides=at(address),
    )


def limits(app, *, per_username=OUT_OF_REACH, lock=OUT_OF_REACH, per_address=OUT_OF_REACH):
    app.config.update(
        LOGIN_ATTEMPTS_PER_ACCOUNT=per_username,
        LOGIN_LOCKOUT_THRESHOLD=lock,
        LOGIN_FAILURES_PER_ADDRESS=per_address,
    )


def without_attempts(snap):
    return {table: rows for table, rows in snap.items() if table != "attempts"}


@pytest.fixture
def account(app):
    """A vault owner and an administrator, each with a live session and
    the Auth Key that is their password server-side."""
    owner, owner_key = register(app, "owner")
    admin, admin_key = register(app, "root", kind="administrator")
    return {"owner": (owner, owner_key), "root": (admin, admin_key)}


# ---- What counts ------------------------------------------------------


@pytest.mark.parametrize("username", ["owner", "root"])
def test_a_wrong_current_password_is_one_failed_sign_in_and_writes_nothing_else(app, clock, account, username):
    """Criteria 11 and 77: Bad Request with no `refused` member, one
    failure for the session's username and one for its address, and no
    other row."""
    client, _ = account[username]
    before = snapshot(app)
    response = change(client, b64(), administrator=username == "root")
    assert response.status_code == 400
    assert "refused" not in (response.get_json(silent=True) or {})
    after = snapshot(app)
    assert without_attempts(after) == without_attempts(before)
    new = [row[1:3] for row in after["attempts"] if row not in before["attempts"]]
    buckets = sorted(bucket for bucket, _ in new)
    assert len(new) == 2, new
    assert {outcome for _, outcome in new} == {"failure"}
    assert buckets[1] == f"login:{username}"
    assert buckets[0].startswith("address:")
    assert ADDRESS not in buckets[0]


def test_a_wrong_password_at_delete_is_one_failed_sign_in_and_deletes_nothing(app, clock, account):
    """Criteria 43 and 77."""
    client, _ = account["owner"]
    before = snapshot(app)
    assert delete(client, b64()).status_code == 400
    after = snapshot(app)
    assert without_attempts(after) == without_attempts(before)
    new = sorted(row[1] for row in after["attempts"] if row not in before["attempts"])
    assert len(new) == 2 and new[1] == "login:owner" and new[0].startswith("address:"), new


def test_a_wrong_password_with_a_wrong_typed_username_still_counts(app, clock, account):
    """A wrong `authKey` counts as a failed sign-in, whatever the typed
    username (account-settings.md, Delete my account)."""
    client, _ = account["owner"]
    delete(client, b64(), confirm="someone-else")
    assert ("login:owner", "failure") in attempts(app)


def test_the_right_password_with_a_wrong_typed_username_is_no_failed_sign_in(app, clock, account):
    """Only a password check that did not match counts (architecture.md,
    Rate limiting, A failed sign-in)."""
    client, key = account["owner"]
    before = snapshot(app)
    assert delete(client, key, confirm="someone-else").status_code == 400
    assert snapshot(app) == before


@pytest.mark.parametrize("endpoint", ["change", "delete"])
def test_a_malformed_request_is_no_failed_sign_in(app, clock, account, endpoint):
    """A Bad Request for its shape verifies nothing and counts nothing."""
    client, _ = account["owner"]
    before = snapshot(app)
    if endpoint == "change":
        response = client.post(CHANGE, json={"currentAuthKey": b64()}, headers=CSRF)
    else:
        response = client.delete(ACCOUNT, json={"confirmUsername": "owner"}, headers=CSRF)
    assert response.status_code == 400
    assert snapshot(app) == before


# ---- Once a limit engages ----------------------------------------------


def assert_every_door_refuses_the_right_password(app, account, address=ADDRESS):
    """Sign-in, change-password from both kinds of session and account
    deletion refuse the right password with Too Many Requests and write
    nothing."""
    before = snapshot(app)
    owner, owner_key = account["owner"]
    admin, admin_key = account["root"]
    assert login(app, "owner", owner_key, address).status_code == 429
    assert login(app, "root", admin_key, address).status_code == 429
    assert change(owner, owner_key, address=address).status_code == 429
    assert change(admin, admin_key, administrator=True, address=address).status_code == 429
    assert delete(owner, owner_key, address=address).status_code == 429
    assert snapshot(app) == before


def test_wrong_passwords_at_change_password_throttle_the_username(app, clock, account):
    limits(app, per_username=3)
    owner, _ = account["owner"]
    admin, _ = account["root"]
    for _ in range(3):
        assert change(owner, b64()).status_code == 400
        assert change(admin, b64(), administrator=True).status_code == 400
    assert_every_door_refuses_the_right_password(app, account)


def test_wrong_passwords_at_delete_throttle_the_username(app, clock, account):
    limits(app, per_username=3)
    owner, owner_key = account["owner"]
    for _ in range(3):
        assert delete(owner, b64()).status_code == 400
    before = snapshot(app)
    assert login(app, "owner", owner_key).status_code == 429
    assert change(owner, owner_key).status_code == 429
    assert delete(owner, owner_key).status_code == 429
    assert snapshot(app) == before


def test_a_mix_of_settings_and_sign_in_failures_shares_one_budget(app, clock, account):
    limits(app, per_username=3)
    owner, owner_key = account["owner"]
    assert login(app, "owner", b64()).status_code == 401
    assert change(owner, b64()).status_code == 400
    assert delete(owner, b64()).status_code == 400
    assert change(owner, owner_key).status_code == 429


def test_failed_sign_ins_at_login_close_the_settings_endpoints(app, clock, account):
    limits(app, per_username=3)
    owner, owner_key = account["owner"]
    admin, admin_key = account["root"]
    for _ in range(3):
        assert login(app, "owner", b64(), OTHER_ADDRESS).status_code == 401
        assert login(app, "root", b64(), OTHER_ADDRESS).status_code == 401
    before = snapshot(app)
    assert change(owner, owner_key).status_code == 429
    assert change(admin, admin_key, administrator=True).status_code == 429
    assert delete(owner, owner_key).status_code == 429
    assert snapshot(app) == before


def test_settings_failures_trip_the_username_lock_and_log_it(app, clock, account, caplog):
    limits(app, lock=3)
    owner, owner_key = account["owner"]
    with caplog.at_level("WARNING"):
        for _ in range(3):
            assert change(owner, b64()).status_code == 400
    assert ("login-lock:owner", "failure") in attempts(app)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("auth.lockout ")]
    assert lines == [f'auth.lockout scope=username username="owner" lock_minutes={app.config["LOGIN_LOCKOUT_MINUTES"]}']
    before = snapshot(app)
    assert change(owner, owner_key).status_code == 429

    clock.advance(app.config["LOGIN_LOCKOUT_MINUTES"] * 60 + 1)
    assert snapshot(app)["attempts"] == before["attempts"]
    assert change(owner, owner_key).status_code == 200


def test_settings_failures_lock_the_address_for_every_username(app, clock, account):
    limits(app, per_address=3)
    owner, _ = account["owner"]
    admin, _ = account["root"]
    assert change(owner, b64()).status_code == 400
    assert change(admin, b64(), administrator=True).status_code == 400
    assert delete(owner, b64()).status_code == 400
    assert any(bucket.startswith("address-lock:") for bucket, _ in attempts(app))
    assert_every_door_refuses_the_right_password(app, account)

    owner_key = account["owner"][1]
    assert change(owner, owner_key, address=OTHER_ADDRESS).status_code == 200


def test_an_address_lock_from_sign_ins_closes_the_settings_endpoints(app, clock, account):
    limits(app, per_address=3)
    for n in range(3):
        assert login(app, f"nobody{n}", b64()).status_code == 401
    assert_every_door_refuses_the_right_password(app, account)


def test_a_wrong_password_during_a_lock_writes_nothing(app, clock, account):
    limits(app, per_username=3)
    owner, _ = account["owner"]
    for _ in range(3):
        change(owner, b64())
    before = snapshot(app)
    assert change(owner, b64()).status_code == 429
    assert delete(owner, b64()).status_code == 429
    assert snapshot(app) == before


def test_the_refusal_matches_sign_in_s_refusal(app, clock, account):
    """One Too Many Requests body and header set on every guarded
    endpoint (architecture.md, Rate limiting)."""
    limits(app, per_username=1)
    owner, owner_key = account["owner"]
    change(owner, b64())

    def answer(response):
        headers = sorted((k, v) for k, v in response.headers if k not in ("Date", "Set-Cookie"))
        return response.status_code, response.get_data(), headers

    refused = answer(login(app, "owner", owner_key))
    assert refused[0] == 429
    assert answer(change(owner, owner_key)) == refused
    assert answer(delete(owner, owner_key)) == refused


def test_the_throttle_lifts_and_the_right_password_then_works(app, clock, account):
    limits(app, per_username=2)
    owner, owner_key = account["owner"]
    change(owner, b64())
    delete(owner, b64())
    assert delete(owner, owner_key).status_code == 429
    clock.advance(app.config["LOGIN_ACCOUNT_WINDOW_MINUTES"] * 60 + 1)
    assert change(owner, owner_key).status_code == 200


# ---- Criterion 79: the new Auth Key is 32 bytes of strict base64 ----


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
@pytest.mark.parametrize("key", BAD_KEYS.values(), ids=BAD_KEYS.keys())
def test_a_password_change_to_an_auth_key_that_is_not_thirty_two_bytes_changes_nothing(app, kind, key):
    if kind == "administrator":
        register(app, "root", kind="administrator")
    client, old_key = register(app, "someone", kind=kind)

    body = {"currentAuthKey": old_key, "salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": key}
    if kind == "vault_owner":
        body.update(wrappedDek=b64(48), dekNonce=b64(12))

    before = snapshot(app)
    response = client.post(CHANGE, json=body, headers=CSRF)
    assert response.status_code == 400, response.get_data(as_text=True)
    assert "refused" not in (response.get_json(silent=True) or {})
    assert snapshot(app) == before
    sign_in(app, "someone", old_key)


# ---- A credential changed elsewhere (criteria 9, 80 and 81) --------------
#
# account-settings.md, Change password steps 2, 5 and 6, and Edge
# cases; architecture.md, Credentials and vault key wrappers.

from tests import test_review_export_import as elsewhere  # noqa: E402


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
@pytest.mark.parametrize("sent", ["the old key", "the current key", "a wrong key"])
def test_a_change_on_a_superseded_salt_writes_nothing_and_counts_no_failure(app, kind, sent):
    """Whatever Auth Key it carries, a change naming a salt that is no
    longer the credential's is refused for the salt, before the key is
    checked, and is no failed sign-in."""
    here, key = elsewhere.open_vault(app, "someone", kind)
    there = here.another()
    changed, current_key = there.change(key)
    assert changed.status_code == 200
    carried = {"the old key": key, "the current key": current_key, "a wrong key": b64()}[sent]

    before = elsewhere.everything(app)
    response, _ = here.change(carried)
    assert elsewhere.refused(response, elsewhere.CHANGED), response.get_data(as_text=True)
    assert elsewhere.everything(app) == before


def test_conflicts_over_the_failure_limit_never_lock_the_account(app):
    """No failed sign-in is counted, so a page that keeps meeting the
    Conflict still changes the password with the current salt."""
    limits(app, lock=2, per_address=2)
    here, key = elsewhere.open_vault(app)
    _, current_key = here.another().change(key)
    for _ in range(5):
        assert elsewhere.refused(here.change(key)[0], elsewhere.CHANGED)
    here.salt = elsewhere.salt_of(app, "owner")
    assert here.change(current_key)[0].status_code == 200


def test_the_resend_with_the_fresh_salt_and_the_current_key_goes_through(app):
    """Criterion 9's server half: after an upgrade made elsewhere, the
    resend differing only in currentAuthKey and currentSalt changes the
    password."""
    here, key = elsewhere.open_vault(app)
    elsewhere.make_stale(app, "owner")
    there = here.another()
    there.sign_in("owner", key)
    _, upgraded_key = there.upgrade()

    body = here.change_body(key, b64(), here.salt)
    assert elsewhere.refused(here.post(elsewhere.CHANGE, body), elsewhere.CHANGED)
    body.update(currentAuthKey=upgraded_key, currentSalt=elsewhere.salt_of(app, "owner"))
    assert here.post(elsewhere.CHANGE, body).status_code == 200
    assert elsewhere.salt_of(app, "owner") == body["salt"]


def test_a_change_landing_between_the_gate_and_another_change_refuses_the_second(app, monkeypatch):
    """The Auth Key is verified before the transaction begins, so the
    salt is compared again inside it: a change committed in that gap
    leaves the second refused, and the first standing."""
    import solvent.auth as auth_module

    here, key = elsewhere.open_vault(app)
    there = here.another()
    real = auth_module.write_transaction

    def after_a_change(*args, **kwargs):
        monkeypatch.setattr(auth_module, "write_transaction", real)
        assert there.change(key)[0].status_code == 200
        return real(*args, **kwargs)

    monkeypatch.setattr(auth_module, "write_transaction", after_a_change)
    response, _ = here.change(key)
    assert elsewhere.refused(response, elsewhere.CHANGED), response.get_data(as_text=True)
    assert elsewhere.salt_of(app, "owner") == there.salt


CREDENTIAL_CHECKS = Path(__file__).resolve().parent / "client" / "review-credential.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_page_names_the_salt_it_holds_and_recovers_once_from_a_changed_one():
    """Criteria 7, 9 and 80 here and login.md criterion 83, in the
    page's own session module against a server answering as the spec
    says."""
    result = subprocess.run(
        ["node", str(CREDENTIAL_CHECKS)], capture_output=True, text=True, timeout=300
    )
    assert result.returncode == 0, result.stdout + result.stderr
