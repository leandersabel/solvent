"""Reviewer's tests for issue #219, written from
spec/features/admin-invites.md (Accounts, `GET /api/admin/accounts`,
criteria 16, 17, 21 and 48) and the admin boundary, blind to the
change."""
from __future__ import annotations

import json
import uuid

import pytest

from tests.helpers import CSRF, b64, connect, mint_invite, put_record, register, rows

ADMIN_KEYS = {"username", "kind", "createdAt", "lastLoginAt"}
OWNER_KEYS = ADMIN_KEYS | {"itemCount"}


def accounts(admin) -> dict:
    response = admin.get("/api/admin/accounts", headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    return {row["username"]: row for row in response.get_json()}


def fill(owner, *types):
    """One record of each type named, a snapshot hanging off the first
    account record. Returns the record ids."""
    ids, holding = [], None
    for record_type in types:
        account_id = holding if record_type == "snapshot" else None
        if record_type == "snapshot" and holding is None:
            holding, response = put_record(owner, record_type="account")
            assert response.status_code == 200, response.get_data(as_text=True)
            ids.append(holding)
            account_id = holding
        record_id, response = put_record(owner, record_type=record_type, accountId=account_id)
        assert response.status_code == 200, response.get_data(as_text=True)
        ids.append(record_id)
        if record_type == "account" and holding is None:
            holding = record_id
    return ids


def test_review_a_freshly_registered_vault_reads_zero(app, admin):
    register(app, "fresh")
    row = accounts(admin)["fresh"]
    assert row["itemCount"] == 0 and type(row["itemCount"]) is int, row


def test_review_items_count_account_snapshot_and_rate_and_never_a_profile(app, admin):
    owner, _ = register(app, "counted")
    fill(owner, "account", "snapshot", "rate", "profile")
    assert accounts(admin)["counted"]["itemCount"] == 3


def test_review_items_are_per_vault_and_follow_a_delete(app, admin):
    first, _ = register(app, "first")
    second, _ = register(app, "second")
    ids = fill(first, "account", "snapshot", "rate")
    fill(second, "account", "account")
    listed = accounts(admin)
    assert (listed["first"]["itemCount"], listed["second"]["itemCount"]) == (3, 2)

    rate_id = ids[-1]
    assert first.delete(f"/api/records/{rate_id}", headers=CSRF).status_code in (200, 204)
    listed = accounts(admin)
    assert (listed["first"]["itemCount"], listed["second"]["itemCount"]) == (2, 2)


def test_review_the_list_carries_both_kinds_and_item_count_only_for_a_vault_owner(app, admin):
    register(app, "second.admin", kind="administrator")
    owner, _ = register(app, "holder")
    fill(owner, "account")
    listed = accounts(admin)
    assert {name: row["kind"] for name, row in listed.items()} == {
        "root": "administrator", "second.admin": "administrator", "holder": "vault_owner",
    }
    for row in listed.values():
        assert set(row) == (OWNER_KEYS if row["kind"] == "vault_owner" else ADMIN_KEYS), row


# ---- The admin boundary, over every route enumerated at test time ----


def admin_routes(app):
    for rule in app.url_map.iter_rules():
        if rule.rule.startswith("/api/admin/"):
            for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
                yield method, rule


def concrete(rule, values):
    path = rule.rule
    for name in rule.arguments:
        path = path.replace(f"<{name}>", values[name])
    return path


def secrets_in_db(app) -> set:
    found = set()
    for row in rows(app, "SELECT params, verifier FROM credentials"):
        params = json.loads(row["params"])
        found |= {row["verifier"], row["params"], params["salt"]}
    for row in rows(app, "SELECT wrapped_dek, dek_nonce FROM dek_wrappers"):
        found |= set(row.values())
    for row in rows(app, "SELECT nonce, ciphertext FROM records"):
        found |= set(row.values())
    for row in rows(app, "SELECT token_hash FROM invites"):
        found |= set(row.values())
    return {value for value in found if value}


def test_review_no_admin_route_answers_with_a_credential_field_a_wrapper_or_a_ciphertext(app, admin):
    owner, _ = register(app, "victim")
    fill(owner, "account", "snapshot", "rate", "profile")
    invite = admin.post(
        "/api/admin/invites", json={"expiresInDays": 7, "label": "x", "kind": "vault_owner"}, headers=CSRF
    ).get_json()
    values = {"username": "nobody.here", "invite_id": invite["id"], "symbol": "CHF"}
    needles = secrets_in_db(app)
    assert needles
    bodies = ({}, {"kind": "vault_owner", "confirmUsername": "nobody.here"})
    seen = []
    for method, rule in admin_routes(app):
        for body in bodies:
            response = admin.open(concrete(rule, values), method=method, json=body, headers=CSRF)
            text = response.get_data(as_text=True)
            seen.append((method, rule.rule, response.status_code))
            leaked = [needle for needle in needles if needle in text]
            assert not leaked, (method, rule.rule, leaked)
    assert ("GET", "/api/admin/accounts", 200) in seen
    assert rows(app, "SELECT username FROM principals WHERE username = 'victim'")


@pytest.mark.parametrize("as_kind", ["vault_owner", "administrator"])
def test_review_no_route_changes_an_existing_accounts_kind(app, as_kind):
    owner, _ = register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    other_admin, _ = register(app, "peer", kind="administrator")
    caller = owner if as_kind == "vault_owner" else admin
    before = {row["username"]: row["kind"] for row in rows(app, "SELECT username, kind FROM principals")}
    values = {
        "account_id": str(uuid.uuid4()), "record_id": str(uuid.uuid4()), "username": "nobody.here",
        "invite_id": uuid.uuid4().hex, "symbol": "CHF", "filename": "x",
    }
    attempts = [
        {"kind": "administrator"}, {"kind": "vault_owner"},
        {"username": "owner", "kind": "administrator"}, {"username": "peer", "kind": "vault_owner"},
        {"inviteToken": mint_invite(app, "administrator"), "username": "owner", "authKey": b64(),
         "salt": b64(16), "kind": "administrator"},
    ]
    for rule in app.url_map.iter_rules():
        if rule.endpoint == "static":
            continue
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            for body in attempts:
                caller.open(concrete(rule, values), method=method, json=body, headers=CSRF)
    after = {row["username"]: row["kind"] for row in rows(app, "SELECT username, kind FROM principals")}
    assert {name: after.get(name, kind) for name, kind in before.items()} == before


# ---- Issue #113: a used invite stops naming a removed account ----
# Written from admin-invites.md (Admin, Invites; Invite lifecycle,
# `used_by`; Endpoints; criteria 9 and 50), app-shell.md (Database) and
# account-settings.md (Delete my account), blind to the change.


def issue(admin, label) -> tuple[str, str]:
    """An invite handed out in the app: its id and its token."""
    response = admin.post(
        "/api/admin/invites", json={"expiresInDays": 7, "label": label, "kind": "vault_owner"}, headers=CSRF
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    created = response.get_json()
    return created["id"], created["token"]


def listed_invites(admin) -> dict:
    response = admin.get("/api/admin/invites", headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    return {row["id"]: row for row in response.get_json()}


def invite_row(app, invite_id) -> dict:
    return rows(app, "SELECT status, used_at, used_by FROM invites WHERE id = ?", (invite_id,))[0]


def remove_by_admin(admin, username):
    return admin.delete(f"/api/admin/accounts/{username}", json={"confirmUsername": username}, headers=CSRF)


def remove_by_owner(owner, username, auth_key):
    return owner.delete(
        "/api/auth/account", json={"authKey": auth_key, "confirmUsername": username}, headers=CSRF
    )


def registered(app, admin, username, **kwargs):
    invite_id, token = issue(admin, f"for {username}")
    client, auth_key = register(app, username, invite_token=token, **kwargs)
    return invite_id, client, auth_key


@pytest.mark.parametrize("path", ["administrator", "owner"])
def test_review_either_deletion_path_clears_the_name_and_keeps_the_invite_used(app, admin, path):
    invite_id, sarah, auth_key = registered(app, admin, "sarah")
    kept_id, _, _ = registered(app, admin, "kept")
    before = invite_row(app, invite_id)
    assert before["status"] == "used" and before["used_by"] == "sarah" and before["used_at"]

    if path == "administrator":
        response = remove_by_admin(admin, "sarah")
    else:
        response = remove_by_owner(sarah, "sarah", auth_key)
    assert response.status_code in (200, 204), response.get_data(as_text=True)

    assert invite_row(app, invite_id) == {**before, "used_by": None}
    assert invite_row(app, kept_id)["used_by"] == "kept"
    listed = listed_invites(admin)
    assert listed[invite_id]["status"] == "used" and listed[invite_id]["usedBy"] is None
    assert listed[invite_id]["usedAt"]
    assert listed[kept_id]["usedBy"] == "kept"


def test_review_an_administrator_account_removed_clears_its_invite_too(app, admin):
    response = admin.post(
        "/api/admin/invites", json={"expiresInDays": 7, "label": "ops", "kind": "administrator"}, headers=CSRF
    ).get_json()
    invite_id, token = response["id"], response["token"]
    register(app, "peer", kind="administrator", invite_token=token)
    assert remove_by_admin(admin, "peer").status_code in (200, 204)
    row = invite_row(app, invite_id)
    assert row["status"] == "used" and row["used_by"] is None and row["used_at"]


def test_review_a_freed_name_registered_again_is_not_credited_with_the_old_link(app, admin):
    old_id, _, _ = registered(app, admin, "sarah")
    assert remove_by_admin(admin, "sarah").status_code in (200, 204)
    new_id, _, _ = registered(app, admin, "sarah")
    listed = listed_invites(admin)
    assert listed[old_id]["usedBy"] is None
    assert listed[new_id]["usedBy"] == "sarah"


def test_review_a_mixed_case_registration_is_still_cleared(app, admin):
    """The username is normalized before it is stored, so what the
    invite names must be what the deletion matches."""
    invite_id, _, _ = registered(app, admin, "  Sarah.Mixed ")
    assert invite_row(app, invite_id)["used_by"] == "sarah.mixed"
    assert remove_by_admin(admin, "sarah.mixed").status_code in (200, 204)
    assert invite_row(app, invite_id)["used_by"] is None


def test_review_a_refused_deletion_leaves_the_name(app, admin):
    invite_id, sarah, auth_key = registered(app, admin, "sarah")
    assert admin.delete(
        "/api/admin/accounts/sarah", json={"confirmUsername": "someone"}, headers=CSRF
    ).status_code == 400
    assert remove_by_owner(sarah, "sarah", b64()).status_code == 400
    assert remove_by_owner(sarah, "other", auth_key).status_code == 400
    assert remove_by_admin(admin, "root").status_code == 409
    assert invite_row(app, invite_id)["used_by"] == "sarah"
    assert listed_invites(admin)[invite_id]["usedBy"] == "sarah"


def test_review_revoking_a_used_invite_whose_account_is_gone_is_still_a_conflict(app, admin):
    invite_id, _, _ = registered(app, admin, "sarah")
    assert remove_by_admin(admin, "sarah").status_code in (200, 204)
    before = invite_row(app, invite_id)
    assert admin.post(f"/api/admin/invites/{invite_id}/revoke", headers=CSRF).status_code == 409
    assert invite_row(app, invite_id) == before


def test_review_a_start_up_clears_a_stale_name_and_only_that(app, admin):
    from solvent import create_app

    kept_id, _, _ = registered(app, admin, "kept")
    stale_id = uuid.uuid4().hex
    conn = connect(app)
    try:
        # A file an earlier build wrote: the account went, the name stayed.
        for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'principals'"):
            conn.execute(f'DROP TRIGGER "{name}"')
        conn.execute(
            "INSERT INTO invites (id, token_hash, kind, created_by, created_at, expires_at, status, "
            "used_at, used_by, label) VALUES (?, ?, 'vault_owner', 'root', '2024-01-01T00:00:00+00:00', "
            "'2024-01-08T00:00:00+00:00', 'used', '2024-01-02T00:00:00+00:00', 'ghost', '')",
            (stale_id, uuid.uuid4().hex),
        )
        conn.commit()
        version = conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()

    restarted = create_app({"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True})
    assert invite_row(restarted, stale_id) == {
        "status": "used", "used_at": "2024-01-02T00:00:00+00:00", "used_by": None,
    }
    assert invite_row(restarted, kept_id)["used_by"] == "kept"
    conn = connect(restarted)
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == version
    finally:
        conn.close()
    assert listed_invites(admin)[stale_id]["usedBy"] is None


def test_review_the_trigger_is_in_the_schema_after_a_start_up(app, admin):
    """A start-up restores what a fresh schema has, so a file an
    earlier build wrote gets the trigger too."""
    from solvent import create_app

    conn = connect(app)
    try:
        for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'principals'"):
            conn.execute(f'DROP TRIGGER "{name}"')
        conn.commit()
    finally:
        conn.close()
    restarted = create_app({"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True})
    invite_id, _, _ = registered(restarted, admin, "sarah")
    assert remove_by_admin(admin, "sarah").status_code in (200, 204)
    assert invite_row(restarted, invite_id)["used_by"] is None
