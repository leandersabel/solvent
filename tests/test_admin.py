"""Provisioning and the admin boundary (spec/features/admin-invites.md)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from solvent.guard import ADMINISTRATION, surface_of
from tests.helpers import CSRF, b64, connect, mint_invite, register, rows
from tests.test_guard import fingerprint

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_creating_an_invite_returns_the_token_exactly_once(app, admin):
    created = admin.post(
        "/api/admin/invites", json={"kind": "vault_owner", "label": "Sarah"}, headers=CSRF
    ).get_json()
    assert created["token"]
    assert created["url"].endswith("/register?invite=" + created["token"])

    listed = admin.get("/api/admin/invites", headers=CSRF).get_json()
    assert set(listed[0]) == {
        "id", "label", "kind", "createdAt", "expiresAt", "status", "usedAt", "usedBy",
    }
    assert created["token"] not in json.dumps(listed)


def test_the_db_stores_only_the_token_hash(app, admin):
    created = admin.post(
        "/api/admin/invites", json={"kind": "vault_owner"}, headers=CSRF
    ).get_json()
    conn = connect(app)
    try:
        dump = "\n".join(conn.iterdump())
    finally:
        conn.close()
    assert created["token"] not in dump


def test_created_by_is_stored_and_never_returned(app, admin):
    created = admin.post(
        "/api/admin/invites", json={"kind": "vault_owner"}, headers=CSRF
    ).get_json()
    stored = rows(app, "SELECT created_by FROM invites WHERE id = ?", (created["id"],))
    assert stored[0]["created_by"] == "root"
    listed = admin.get("/api/admin/invites", headers=CSRF).get_json()
    assert all("createdBy" not in row for row in listed)


def test_kind_is_required_and_has_no_default(admin):
    assert admin.post("/api/admin/invites", json={}, headers=CSRF).status_code == 400
    assert admin.post(
        "/api/admin/invites", json={"kind": "superuser"}, headers=CSRF
    ).status_code == 400


def test_an_invite_kind_decides_the_accounts_kind(app, admin):
    for kind, username in (("administrator", "second"), ("vault_owner", "sarah")):
        token = admin.post(
            "/api/admin/invites", json={"kind": kind}, headers=CSRF
        ).get_json()["token"]
        register(app, username, kind=kind, invite_token=token)

    principals = {row["username"]: row["kind"] for row in rows(app, "SELECT * FROM principals")}
    assert principals == {"root": "administrator", "second": "administrator", "sarah": "vault_owner"}
    assert len(rows(app, "SELECT * FROM dek_wrappers")) == 1


def test_revoking_is_idempotent_and_refused_on_a_used_invite(app, admin):
    created = admin.post(
        "/api/admin/invites", json={"kind": "vault_owner"}, headers=CSRF
    ).get_json()
    assert admin.post(f"/api/admin/invites/{created['id']}/revoke", json={}, headers=CSRF).status_code == 200
    assert admin.post(f"/api/admin/invites/{created['id']}/revoke", json={}, headers=CSRF).status_code == 200

    used = admin.post("/api/admin/invites", json={"kind": "vault_owner"}, headers=CSRF).get_json()
    register(app, "sarah", invite_token=used["token"])
    response = admin.post(f"/api/admin/invites/{used['id']}/revoke", json={}, headers=CSRF)
    assert response.status_code == 409
    assert rows(app, "SELECT status FROM invites WHERE id = ?", (used["id"],))[0]["status"] == "used"


def test_expired_is_derived_and_not_stored(app, admin):
    token = mint_invite(app, expires_at="2000-01-01T00:00:00+00:00")
    from solvent.crypto import hash_invite_token

    stored = rows(
        app, "SELECT * FROM invites WHERE token_hash = ?", (hash_invite_token(token),)
    )[0]
    listed = admin.get("/api/admin/invites", headers=CSRF).get_json()
    reported = next(row for row in listed if row["id"] == stored["id"])
    assert reported["status"] == "expired"
    assert stored["status"] == "pending"


def test_the_account_list_carries_no_record_count_for_an_administrator(app, admin):
    register(app, "sarah")
    listed = {row["username"]: row for row in admin.get("/api/admin/accounts", headers=CSRF).get_json()}
    assert "recordCount" not in listed["root"]
    assert listed["sarah"]["recordCount"] == 1
    assert listed["root"]["lastLoginAt"] is None


def test_no_admin_route_returns_a_credential_field_a_wrapper_or_a_ciphertext(app, admin):
    """The executable form of the admin boundary, enumerated at test
    time so an endpoint added later is covered automatically."""
    register(app, "sarah")
    secrets_in_db = set()
    for row in rows(app, "SELECT * FROM credentials"):
        secrets_in_db.update({row["verifier"], row["params"]})
    for row in rows(app, "SELECT * FROM dek_wrappers"):
        secrets_in_db.update({row["wrapped_dek"], row["dek_nonce"]})
    for row in rows(app, "SELECT * FROM records"):
        secrets_in_db.add(row["ciphertext"])

    checked = 0
    for rule in app.url_map.iter_rules():
        if surface_of(str(rule)) != ADMINISTRATION or "<" in rule.rule:
            continue
        if "GET" not in rule.methods:
            continue
        body = admin.get(rule.rule, headers=CSRF).get_data(as_text=True)
        for secret in secrets_in_db:
            assert secret not in body, rule.rule
        for banned in ("verifier", "wrappedDek", "ciphertext", "salt"):
            assert banned not in body, (rule.rule, banned)
        checked += 1
    assert checked


def test_a_vault_owner_gets_not_found_from_every_admin_route(app):
    owner, _ = register(app, "owner")
    before = rows(app, "SELECT * FROM invites")
    for path, method in (
        ("/api/admin/invites", "GET"),
        ("/api/admin/invites", "POST"),
        ("/api/admin/accounts", "GET"),
        ("/api/admin/symbols", "GET"),
        ("/api/admin/accounts/owner", "DELETE"),
    ):
        response = owner.open(path, method=method, json={"kind": "administrator"}, headers=CSRF)
        assert response.status_code == 404, (path, method)
    assert rows(app, "SELECT * FROM invites") == before


def test_every_admin_route_is_refused_as_an_invented_api_path_is(app, client):
    """Enumerated at test time, under every method each route answers.
    Without the header the answer is Forbidden and with it Unauthorized,
    for a caller with no session and for a vault owner alike, so a
    probe cannot tell /api/admin/invites from /api/admin/invented."""
    owner, _ = register(app, "owner")
    routes = [
        (re.sub(r"<[^>]+>", "x", rule.rule), method)
        for rule in app.url_map.iter_rules()
        if surface_of(str(rule)) == ADMINISTRATION and rule.rule.startswith("/api/admin/")
        for method in sorted(rule.methods - {"HEAD"})
    ]
    assert routes
    for caller, header, status in (
        (client, {}, 403),
        (owner, {}, 403),
        (client, CSRF, 401),
        (owner, CSRF, 404),
    ):
        invented = caller.get("/api/admin/invented", headers=header)
        assert invented.status_code == status
        for path, method in routes:
            response = caller.open(path, method=method, headers=header, json={})
            assert fingerprint(response) == fingerprint(invented), (path, method, status)


def test_no_route_anywhere_changes_an_existing_accounts_kind(app, admin):
    """Enumerated at test time and attempted through each, so a route
    added later is covered rather than exempt."""
    register(app, "sarah")
    before = {row["username"]: row["kind"] for row in rows(app, "SELECT * FROM principals")}

    for rule in app.url_map.iter_rules():
        if "static" in rule.rule:
            continue
        path = rule.rule.replace("<username>", "sarah").replace("<invite_id>", "x")
        path = re.sub(r"<[^>]+>", "x", path)
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            admin.open(
                path,
                method=method,
                json={"kind": "administrator", "username": "sarah", "confirmUsername": "nope"},
                headers=CSRF,
            )

    after = {row["username"]: row["kind"] for row in rows(app, "SELECT * FROM principals")}
    assert after == before


# ---- Removing accounts ------------------------------------------------


def test_the_last_administrator_cannot_remove_their_own_account(app, admin):
    response = admin.delete(
        "/api/admin/accounts/root", json={"confirmUsername": "root"}, headers=CSRF
    )
    assert response.status_code == 409
    assert rows(app, "SELECT * FROM principals")


def test_an_administrator_removes_another_while_a_third_remains(app, admin):
    register(app, "second", kind="administrator")
    third, third_key = register(app, "third", kind="administrator")

    assert admin.delete(
        "/api/admin/accounts/second", json={"confirmUsername": "second"}, headers=CSRF
    ).status_code == 200
    assert app.test_client().post(
        "/api/auth/login", json={"username": "second", "authKey": "x"}, headers=CSRF
    ).status_code == 401


def test_a_mismatched_confirm_username_deletes_nothing(app, admin):
    register(app, "sarah")
    assert admin.delete(
        "/api/admin/accounts/sarah", json={"confirmUsername": "sara"}, headers=CSRF
    ).status_code == 400
    assert len(rows(app, "SELECT * FROM principals")) == 2


def test_removing_an_account_takes_its_vault_and_leaves_every_other_alone(app, admin):
    sarah, _ = register(app, "sarah")
    other, _ = register(app, "other")
    before_other = rows(app, "SELECT * FROM records WHERE principal_id = "
                        "(SELECT id FROM principals WHERE username = 'other')")

    admin.delete("/api/admin/accounts/sarah", json={"confirmUsername": "sarah"}, headers=CSRF)

    assert rows(app, "SELECT * FROM principals WHERE username = 'sarah'") == []
    assert rows(app, "SELECT * FROM records WHERE principal_id = "
                "(SELECT id FROM principals WHERE username = 'other')") == before_other
    assert sarah.get("/api/records?type=account", headers=CSRF).status_code == 401


def test_removing_a_username_that_does_not_exist_is_not_found(admin):
    assert admin.delete(
        "/api/admin/accounts/ghost", json={"confirmUsername": "ghost"}, headers=CSRF
    ).status_code == 404


def test_the_guard_and_the_delete_are_one_transaction(app, admin):
    """Two administrators removing each other concurrently leave
    exactly one: the serial case passes either way and is not the
    bug."""
    import threading

    second, second_key = register(app, "second", kind="administrator")

    results = []
    barrier = threading.Barrier(2)

    def remove(client, target):
        barrier.wait()
        results.append(
            client.delete(
                f"/api/admin/accounts/{target}",
                json={"confirmUsername": target},
                headers=CSRF,
            ).status_code
        )

    threads = [
        threading.Thread(target=remove, args=(admin, "second")),
        threading.Thread(target=remove, args=(second, "root")),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    remaining = rows(app, "SELECT * FROM principals WHERE kind = 'administrator'")
    assert len(remaining) == 1, results

    # One wins. The other is refused by the guard, or finds its own
    # session already gone with the account it belonged to, which is
    # the same edge case reached from the losing side.
    assert sorted(results)[0] == 200, results
    assert sorted(results)[1] in (401, 409), results


# ---- The bootstrap CLI ------------------------------------------------


def run_cli(app, *args):
    import os

    env = dict(os.environ)
    env.update(SECRET_KEY="cli-test-key", DATABASE_PATH=app.config["DATABASE_PATH"])
    return subprocess.run(
        [sys.executable, "-m", "flask", "--app", "app", "create-invite", *args],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_the_cli_mints_an_administrator_invite_on_a_fresh_instance(app):
    result = run_cli(app, "--kind", "administrator")
    assert result.returncode == 0, result.stderr
    token = result.stdout.strip().split("=")[-1]

    register(app, "root", kind="administrator", invite_token=token)
    assert rows(app, "SELECT kind FROM principals")[0]["kind"] == "administrator"
    assert rows(app, "SELECT * FROM dek_wrappers") == []


def test_the_cli_creates_an_invite_and_never_an_account(app):
    run_cli(app, "--kind", "administrator")
    assert rows(app, "SELECT * FROM principals") == []
    assert len(rows(app, "SELECT * FROM invites")) == 1


def test_the_cli_records_the_bootstrap_sentinel_and_refuses_it_as_a_username(app):
    run_cli(app, "--kind", "administrator")
    assert rows(app, "SELECT created_by FROM invites")[0]["created_by"] == "system:bootstrap"

    body = {
        "inviteToken": mint_invite(app, "administrator"),
        "username": "system:bootstrap",
        "authKey": b64(),
        "salt": b64(16),
        "kdf": {"alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1},
    }
    assert app.test_client().post("/api/register", json=body, headers=CSRF).status_code == 400


def test_the_cli_without_kind_exits_non_zero_and_creates_nothing(app):
    result = run_cli(app)
    assert result.returncode != 0
    assert rows(app, "SELECT * FROM invites") == []


def test_the_cli_refuses_without_force_once_an_administrator_exists(app):
    register(app, "root", kind="administrator")
    before = len(rows(app, "SELECT * FROM invites"))

    refused = run_cli(app, "--kind", "administrator")
    assert refused.returncode != 0
    assert "administrators: 1" in refused.stderr
    assert "--force" in refused.stderr
    assert len(rows(app, "SELECT * FROM invites")) == before

    forced = run_cli(app, "--kind", "administrator", "--force")
    assert forced.returncode == 0
    assert len(rows(app, "SELECT * FROM invites")) == before + 1


def test_the_invite_token_does_not_appear_in_the_applications_log(app, admin, caplog):
    with caplog.at_level(0):
        created = admin.post(
            "/api/admin/invites", json={"kind": "vault_owner"}, headers=CSRF
        ).get_json()
        app.test_client().get(f"/register?invite={created['token']}")
    assert created["token"] not in caplog.text
