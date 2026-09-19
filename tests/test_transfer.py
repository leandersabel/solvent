"""Purge, export and import (spec/features/manage-accounts.md, Delete;
spec/features/export-import.md).
"""
from __future__ import annotations

import uuid

import pytest

from tests.helpers import CSRF, b64, put_record, record_body, register, rows


@pytest.fixture
def owner(app):
    client, _ = register(app, "owner")
    return client


def holding_with_snapshots(client, count=2):
    account_id, response = put_record(client)
    assert response.status_code == 200
    for _ in range(count):
        _, snapshot = put_record(client, record_type="snapshot", accountId=account_id)
        assert snapshot.status_code == 200
    return account_id


# ---- Purge ------------------------------------------------------------


def test_purge_removes_the_holding_and_every_snapshot_carrying_its_id(app, owner):
    account_id = holding_with_snapshots(owner)
    other = holding_with_snapshots(owner)
    _, rate = put_record(owner, record_type="rate")
    assert rate.status_code == 200

    assert owner.delete(
        f"/api/accounts/{account_id}?mode=purge", headers=CSRF
    ).status_code == 204

    remaining = rows(app, "SELECT record_id, record_type, account_id FROM records")
    assert all(row["record_id"] != account_id for row in remaining)
    assert all(row["account_id"] != account_id for row in remaining)
    # It deletes no price entry: a price belongs to a symbol, and
    # another holding may be measured in the same one.
    assert any(row["record_type"] == "rate" for row in remaining)
    assert any(row["record_id"] == other for row in remaining)


def test_purge_cannot_reach_another_users_records(app):
    first, _ = register(app, "first")
    second, _ = register(app, "second")
    account_id = holding_with_snapshots(first)

    assert second.delete(
        f"/api/accounts/{account_id}?mode=purge", headers=CSRF
    ).status_code == 404
    assert rows(app, "SELECT * FROM records WHERE record_id = ?", (account_id,))


def test_purge_requires_the_mode_parameter(owner):
    account_id = holding_with_snapshots(owner)
    assert owner.delete(f"/api/accounts/{account_id}", headers=CSRF).status_code == 400
    assert owner.delete(
        f"/api/accounts/{account_id}?mode=archive", headers=CSRF
    ).status_code == 400


# ---- Export -----------------------------------------------------------


def test_the_export_carries_both_timelines_and_one_wrapper(owner):
    account_id = holding_with_snapshots(owner)
    put_record(owner, record_type="rate")

    body = owner.get("/api/export", headers=CSRF).get_json()
    assert body["format"] == "solvent-vault"
    assert body["formatVersion"] == 1
    kinds = {record["recordType"] for record in body["records"]}
    assert kinds == {"profile", "account", "snapshot", "rate"}
    assert isinstance(body["wrappedDek"], str)
    assert not any("credential" in key.lower() for key in body)


def test_the_export_filename_is_dated_and_names_nobody(owner):
    header = owner.get("/api/export", headers=CSRF).headers["Content-Disposition"]
    assert header.startswith("attachment; ")
    assert "owner" not in header
    assert "solvent-vault-" in header


def test_the_exported_file_carries_no_user_identifier(app, owner):
    holding_with_snapshots(owner)
    body = owner.get("/api/export", headers=CSRF).get_data(as_text=True)
    principal = rows(app, "SELECT id FROM principals")[0]["id"]
    assert principal not in body
    assert "owner" not in body


def test_an_empty_vault_exports_a_file_with_only_its_profile(app):
    owner, _ = register(app, "empty")
    body = owner.get("/api/export", headers=CSRF).get_json()
    assert [record["recordType"] for record in body["records"]] == ["profile"]


def test_export_is_rate_limited_per_user(owner):
    codes = [owner.get("/api/export", headers=CSRF).status_code for _ in range(8)]
    assert 429 in codes


# ---- Import -----------------------------------------------------------


def import_payload(records):
    return {"wrappedDek": b64(48), "dekNonce": b64(12), "records": records}


def exported_records(client):
    return client.get("/api/export", headers=CSRF).get_json()["records"]


def test_import_replaces_the_vault_entirely(app, owner):
    holding_with_snapshots(owner)
    original = exported_records(owner)

    fresh, _ = register(app, "fresh")
    reset = [dict(record, version=1, nonce=b64(12)) for record in original]
    response = fresh.post("/api/import", json=import_payload(reset), headers=CSRF)
    assert response.status_code == 200

    restored = exported_records(fresh)
    assert {r["recordId"] for r in restored} == {r["recordId"] for r in original}
    assert all(record["version"] == 1 for record in restored)


def test_import_replaces_the_wrapper_and_leaves_the_credential_untouched(app, owner):
    from tests.helpers import credential

    before = credential(app, "owner")
    wrapper = import_payload([])
    owner.post("/api/import", json=wrapper, headers=CSRF)

    after = credential(app, "owner")
    assert after["params"] == before["params"]
    assert after["verifier"] == before["verifier"]
    assert rows(app, "SELECT * FROM dek_wrappers")[0]["wrapped_dek"] == wrapper["wrappedDek"]


def test_a_record_at_any_version_but_one_is_rejected_whole(app, owner):
    holding_with_snapshots(owner)
    before = rows(app, "SELECT * FROM records")
    records = [dict(record, version=1) for record in exported_records(owner)]
    records[1]["version"] = 2

    assert owner.post(
        "/api/import", json=import_payload(records), headers=CSRF
    ).status_code == 400
    assert rows(app, "SELECT * FROM records") == before


def test_a_snapshot_naming_no_account_in_the_same_payload_is_rejected_whole(app, owner):
    before = rows(app, "SELECT * FROM records")
    orphan = record_body("snapshot", accountId=str(uuid.uuid4()))
    orphan["recordId"] = str(uuid.uuid4())

    assert owner.post(
        "/api/import", json=import_payload([orphan]), headers=CSRF
    ).status_code == 400
    assert rows(app, "SELECT * FROM records") == before


def test_an_unknown_record_type_is_rejected_before_any_write(app, owner):
    before = rows(app, "SELECT * FROM records")
    bad = record_body("account")
    bad["recordType"] = "invoice"
    bad["recordId"] = str(uuid.uuid4())

    assert owner.post(
        "/api/import", json=import_payload([bad]), headers=CSRF
    ).status_code == 400
    assert rows(app, "SELECT * FROM records") == before


def test_a_principal_id_in_the_payload_writes_nothing_into_another_vault(app, owner):
    other, _ = register(app, "other")
    before = rows(app, "SELECT * FROM records WHERE principal_id = "
                  "(SELECT id FROM principals WHERE username = 'other')")
    payload = import_payload([])
    payload["principalId"] = "someone-else"

    assert owner.post("/api/import", json=payload, headers=CSRF).status_code == 400
    assert rows(app, "SELECT * FROM records WHERE principal_id = "
                "(SELECT id FROM principals WHERE username = 'other')") == before


def test_import_invalidates_every_other_session_and_keeps_this_one(app):
    from tests.helpers import sign_in

    owner, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    assert len(rows(app, "SELECT * FROM sessions")) == 2

    owner.post("/api/import", json=import_payload([]), headers=CSRF)
    assert len(rows(app, "SELECT * FROM sessions")) == 1
    assert second.get("/api/records?type=account", headers=CSRF).status_code == 401
    assert owner.get("/api/records?type=account", headers=CSRF).status_code == 200


def test_an_administrator_reaches_neither_export_nor_import(app):
    admin, _ = register(app, "root", kind="administrator")
    assert admin.get("/api/export", headers=CSRF).status_code == 404
    assert admin.post("/api/import", json=import_payload([]), headers=CSRF).status_code == 404


def test_a_payload_over_the_record_count_cap_is_refused(app, owner, monkeypatch):
    import solvent.vault as vault_module

    monkeypatch.setattr(vault_module, "MAX_RECORDS_PER_VAULT", 1)
    before = rows(app, "SELECT * FROM records")
    records = [record_body("account", recordId=str(uuid.uuid4())) for _ in range(2)]
    for record in records:
        record["recordId"] = str(uuid.uuid4())

    assert owner.post(
        "/api/import", json=import_payload(records), headers=CSRF
    ).status_code == 413
    assert rows(app, "SELECT * FROM records") == before
