"""Reviewer's tests for issue #219, written from
spec/features/admin-invites.md (Accounts, `GET /api/admin/accounts`,
criteria 16, 17, 21 and 48) and the admin boundary, blind to the
change."""
from __future__ import annotations

import json
import uuid

import pytest

from tests.helpers import CSRF, b64, mint_invite, put_record, register, rows

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
