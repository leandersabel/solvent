"""Purge, export and import (spec/features/manage-accounts.md, Delete;
spec/features/export-import.md).
"""
from __future__ import annotations

import uuid

import pytest

from tests.helpers import (
    CSRF,
    b64,
    connect,
    credential,
    principal_id,
    put_record,
    record_body,
    register,
    rows,
    sign_in,
)


def holding_with_snapshots(client, count=2):
    account_id, response = put_record(client)
    assert response.status_code == 200
    for _ in range(count):
        _, snapshot = put_record(client, record_type="snapshot", accountId=account_id)
        assert snapshot.status_code == 200
    return account_id


# ---- Purge ------------------------------------------------------------


def install_fault(app, sql: str) -> None:
    """A real trigger in the database file, so the fault fires inside
    the server's own transaction rather than in a patched function."""
    conn = connect(app)
    try:
        conn.execute(sql)
        conn.commit()
    finally:
        conn.close()


def drop_fault(app) -> None:
    install_fault(app, "DROP TRIGGER IF EXISTS injected_fault")


def all_rows(app):
    return rows(app, "SELECT * FROM records ORDER BY principal_id, record_id")


def test_purge_removes_the_holding_and_every_snapshot_carrying_its_id(app, owner):
    account_id = holding_with_snapshots(owner)
    other = holding_with_snapshots(owner)
    for _ in range(2):
        _, rate = put_record(owner, record_type="rate")
        assert rate.status_code == 200
    rates_before = rows(app, "SELECT * FROM records WHERE record_type = 'rate'")

    assert owner.delete(
        f"/api/accounts/{account_id}?mode=purge", headers=CSRF
    ).status_code == 204

    remaining = rows(app, "SELECT record_id, record_type, account_id FROM records")
    assert all(row["record_id"] != account_id for row in remaining)
    assert all(row["account_id"] != account_id for row in remaining)
    # It deletes no price entry: a price belongs to a symbol, and
    # another holding may be measured in the same one. Compared row by
    # row, because a repriced history is the only later symptom.
    assert rows(app, "SELECT * FROM records WHERE record_type = 'rate'") == rates_before
    assert any(row["record_id"] == other for row in remaining)


def test_a_fault_mid_purge_leaves_the_holding_and_its_snapshots_whole(app, owner):
    account_id = holding_with_snapshots(owner, count=3)
    before = all_rows(app)
    install_fault(
        app,
        "CREATE TRIGGER injected_fault BEFORE DELETE ON records "
        "WHEN OLD.record_type = 'snapshot' "
        "BEGIN SELECT RAISE(ABORT, 'injected fault'); END",
    )
    try:
        response = owner.delete(f"/api/accounts/{account_id}?mode=purge", headers=CSRF)
    finally:
        drop_fault(app)

    assert response.status_code == 500
    assert all_rows(app) == before


def test_purge_cannot_reach_another_users_records(app):
    first, _ = register(app, "first")
    second, _ = register(app, "second")
    account_id = holding_with_snapshots(first)

    holding_with_snapshots(second)
    before = all_rows(app)

    assert second.delete(
        f"/api/accounts/{account_id}?mode=purge", headers=CSRF
    ).status_code == 404
    assert all_rows(app) == before


def test_purge_requires_the_mode_parameter(owner):
    account_id = holding_with_snapshots(owner)
    assert owner.delete(f"/api/accounts/{account_id}", headers=CSRF).status_code == 400
    assert owner.delete(
        f"/api/accounts/{account_id}?mode=archive", headers=CSRF
    ).status_code == 400


# ---- Export -----------------------------------------------------------


def test_the_export_carries_both_timelines_and_one_wrapper(owner):
    holding_with_snapshots(owner)
    put_record(owner, record_type="rate")

    body = owner.get("/api/export", headers=CSRF).get_json()
    assert body["format"] == "solvent-vault"
    assert body["formatVersion"] == 1
    kinds = {record["recordType"] for record in body["records"]}
    assert kinds == {"profile", "account", "snapshot", "rate"}
    assert isinstance(body["wrappedDek"], str)
    assert not any("credential" in key.lower() for key in body)


EXPORT_KEYS = {
    "format", "formatVersion", "exportedAt", "salt", "kdf", "wrappedDek", "dekNonce", "records",
}
RECORD_KEYS = {
    "recordId", "recordType", "accountId", "schemaVersion", "version", "nonce", "ciphertext",
}


def test_the_export_carries_exactly_one_wrapper_and_nothing_describing_a_credential(app, owner):
    holding_with_snapshots(owner)
    put_record(owner, record_type="rate")
    response = owner.get("/api/export", headers=CSRF)
    body = response.get_json()
    raw = response.get_data(as_text=True)

    assert set(body) == EXPORT_KEYS
    assert all(set(record) == RECORD_KEYS for record in body["records"])
    # One wrapper: a single pair of strings, never a list of them.
    assert isinstance(body["wrappedDek"], str) and isinstance(body["dekNonce"], str)
    assert [key for key, value in body.items() if isinstance(value, list)] == ["records"]
    assert set(body["kdf"]) == {"alg", "v", "m", "t", "p"}

    stored = credential(app, "owner")
    wrapper = rows(app, "SELECT * FROM dek_wrappers")[0]
    assert (body["wrappedDek"], body["dekNonce"]) == (wrapper["wrapped_dek"], wrapper["dek_nonce"])
    # Nothing names, counts or describes the credential: not its id,
    # not its method, not its verifier.
    for secret in (stored["id"], stored["verifier"], wrapper["credential_id"]):
        assert secret not in raw
    assert "password" not in raw.lower()
    assert "method" not in raw.lower()


def test_the_export_filename_is_dated_and_names_nobody(owner):
    header = owner.get("/api/export", headers=CSRF).headers["Content-Disposition"]
    assert header.startswith("attachment; ")
    assert "owner" not in header
    assert "solvent-vault-" in header


def test_the_exported_file_carries_no_user_identifier(app, owner):
    holding_with_snapshots(owner)
    body = owner.get("/api/export", headers=CSRF).get_data(as_text=True)
    assert principal_id(app, "owner") not in body
    assert "owner" not in body


def test_an_empty_vault_exports_a_file_with_only_its_profile(app):
    owner, _ = register(app, "empty")
    body = owner.get("/api/export", headers=CSRF).get_json()
    assert [record["recordType"] for record in body["records"]] == ["profile"]


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


def test_import_replaces_the_wrapper_and_leaves_the_credential_untouched(app):
    owner, auth_key = register(app, "owner")
    before = credential(app, "owner")
    wrapper_before = rows(app, "SELECT * FROM dek_wrappers")[0]
    wrapper = import_payload([])
    assert owner.post("/api/import", json=wrapper, headers=CSRF).status_code == 200

    after = credential(app, "owner")
    for field in before.keys():
        assert after[field] == before[field], field
    stored = rows(app, "SELECT * FROM dek_wrappers")[0]
    assert stored["credential_id"] == wrapper_before["credential_id"] == before["id"]
    assert stored["wrapped_dek"] == wrapper["wrappedDek"] != wrapper_before["wrapped_dek"]
    assert stored["dek_nonce"] == wrapper["dekNonce"] != wrapper_before["dek_nonce"]

    # The unchanged password still signs in, and the login hands back
    # the new wrapper.
    _, login = sign_in(app, "owner", auth_key)
    assert (login["wrappedDek"], login["dekNonce"]) == (wrapper["wrappedDek"], wrapper["dekNonce"])


@pytest.mark.parametrize(
    "fault",
    [
        # After the delete has run and a first record is back in.
        "CREATE TRIGGER injected_fault BEFORE INSERT ON records "
        "WHEN (SELECT COUNT(*) FROM records WHERE principal_id = NEW.principal_id) >= 1 "
        "BEGIN SELECT RAISE(ABORT, 'injected fault'); END",
        # After every record is in, at the wrapper.
        "CREATE TRIGGER injected_fault BEFORE UPDATE ON dek_wrappers "
        "BEGIN SELECT RAISE(ABORT, 'injected fault'); END",
    ],
    ids=["mid-insert", "at-the-wrapper"],
)
def test_a_fault_mid_import_leaves_the_original_vault_intact(app, fault):
    owner, auth_key = register(app, "owner")
    sign_in(app, "owner", auth_key)
    holding_with_snapshots(owner)
    records = [dict(record, version=1, nonce=b64(12)) for record in exported_records(owner)]
    # Not last_active_at: each request between the reads writes it.
    sessions = "SELECT id, token_hash, principal_id, issued_at FROM sessions ORDER BY id"
    before = (
        all_rows(app),
        rows(app, "SELECT * FROM dek_wrappers"),
        rows(app, sessions),
    )
    listed = owner.get("/api/records?type=snapshot", headers=CSRF).get_json()

    install_fault(app, fault)
    try:
        response = owner.post("/api/import", json=import_payload(records), headers=CSRF)
    finally:
        drop_fault(app)

    assert response.status_code == 500
    assert (
        all_rows(app),
        rows(app, "SELECT * FROM dek_wrappers"),
        rows(app, sessions),
    ) == before
    assert owner.get("/api/records?type=snapshot", headers=CSRF).get_json() == listed


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


@pytest.mark.parametrize("where", ["top-level", "on-a-record"])
def test_a_principal_id_in_the_payload_is_refused_whole_and_neither_vault_changes(app, owner, where):
    other, _ = register(app, "other")
    holding_with_snapshots(other)
    victim = principal_id(app, "other")
    records = [dict(record, version=1, nonce=b64(12)) for record in exported_records(owner)]
    payload = import_payload(records)
    if where == "top-level":
        payload["principalId"] = victim
    else:
        records[0]["principalId"] = victim
    before = all_rows(app)

    assert owner.post("/api/import", json=payload, headers=CSRF).status_code == 400
    assert all_rows(app) == before


def test_imported_records_land_under_the_session_user(app, owner):
    other, _ = register(app, "other")
    holding_with_snapshots(owner)
    theirs = rows(app, "SELECT * FROM records WHERE principal_id = ?", (principal_id(app, "other"),))
    records = [dict(record, version=1, nonce=b64(12)) for record in exported_records(owner)]

    assert owner.post("/api/import", json=import_payload(records), headers=CSRF).status_code == 200
    landed = rows(app, "SELECT principal_id, version FROM records WHERE record_id IN "
                  f"({','.join('?' for _ in records)})", [r["recordId"] for r in records])
    assert len(landed) == len(records)
    assert {row["principal_id"] for row in landed} == {principal_id(app, "owner")}
    assert {row["version"] for row in landed} == {1}
    assert rows(app, "SELECT * FROM records WHERE principal_id = ?", (principal_id(app, "other"),)) == theirs


def test_import_invalidates_every_other_session_and_keeps_this_one(app):
    owner, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    assert len(rows(app, "SELECT * FROM sessions")) == 2

    owner.post("/api/import", json=import_payload([]), headers=CSRF)
    assert len(rows(app, "SELECT * FROM sessions")) == 1
    assert second.get("/api/records?type=account", headers=CSRF).status_code == 401
    assert owner.get("/api/records?type=account", headers=CSRF).status_code == 200


def test_a_create_from_a_session_the_import_ended_never_reaches_the_vault(app):
    """The second session still holds the old DEK. Its create is the
    write that would store ciphertext under a key no longer in the
    envelope, so the write path is what is asserted, not only a read."""
    owner, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    assert owner.post("/api/import", json=import_payload([]), headers=CSRF).status_code == 200

    record_id, response = put_record(second)
    assert response.status_code == 401
    assert rows(app, "SELECT * FROM records WHERE record_id = ?", (record_id,)) == []


def test_an_administrator_reaches_neither_export_nor_import(app):
    admin, _ = register(app, "root", kind="administrator")
    assert admin.get("/api/export", headers=CSRF).status_code == 404
    assert admin.post("/api/import", json=import_payload([]), headers=CSRF).status_code == 404


def test_a_payload_over_the_record_count_cap_is_refused(app, owner, monkeypatch):
    import solvent.vault as vault_module

    monkeypatch.setattr(vault_module, "MAX_RECORDS_PER_VAULT", 1)
    before = rows(app, "SELECT * FROM records")
    records = [record_body("account", recordId=str(uuid.uuid4())) for _ in range(2)]

    assert owner.post(
        "/api/import", json=import_payload(records), headers=CSRF
    ).status_code == 413
    assert rows(app, "SELECT * FROM records") == before


def test_a_payload_over_the_total_size_cap_is_refused_before_any_write(app, owner, monkeypatch):
    import solvent.vault as vault_module

    holding_with_snapshots(owner)
    monkeypatch.setattr(vault_module, "MAX_BYTES_PER_USER", 256)
    records = [record_body("account", ciphertext=b64(200)) for _ in range(2)]
    for record in records:
        record["recordId"] = str(uuid.uuid4())
    before = all_rows(app)

    assert owner.post(
        "/api/import", json=import_payload(records), headers=CSRF
    ).status_code == 413
    assert all_rows(app) == before


def test_a_record_over_the_ciphertext_cap_is_refused_before_any_write(app, owner, monkeypatch):
    import solvent.records as records_module

    holding_with_snapshots(owner)
    monkeypatch.setattr(records_module, "MAX_CIPHERTEXT_BYTES", 128)
    records = [record_body("account", ciphertext=b64(64)), record_body("account", ciphertext=b64(129))]
    for record in records:
        record["recordId"] = str(uuid.uuid4())
    before = all_rows(app)

    assert owner.post(
        "/api/import", json=import_payload(records), headers=CSRF
    ).status_code == 413
    assert all_rows(app) == before


def test_a_record_below_schema_version_one_is_a_bad_request_for_the_whole_payload(app, owner):
    holding_with_snapshots(owner)
    records = [dict(record, version=1, nonce=b64(12)) for record in exported_records(owner)]
    records[0]["schemaVersion"] = 0
    before = all_rows(app)

    assert owner.post(
        "/api/import", json=import_payload(records), headers=CSRF
    ).status_code == 400
    assert all_rows(app) == before


# ---- The export ceiling -------------------------------------------------


def test_the_export_ceiling_defaults_to_five_an_hour(owner):
    codes = [owner.get("/api/export", headers=CSRF).status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]


def test_exports_older_than_the_hour_do_not_count(app, owner):
    """An export row from two hours ago is outside the window, whatever
    the calendar day."""
    from datetime import datetime, timedelta, timezone

    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
    conn = connect(app)
    try:
        conn.executemany(
            "INSERT INTO attempts (bucket, outcome, at) VALUES (?, 'request', ?)",
            [(f"export:{principal_id(app, 'owner')}", old)] * 5,
        )
        conn.commit()
    finally:
        conn.close()
    assert owner.get("/api/export", headers=CSRF).status_code == 200


def test_the_export_ceiling_is_operator_config(tmp_path, monkeypatch):
    from solvent import create_app
    from solvent.config import load_config

    assert load_config({"SECRET_KEY": "k"}).exports_per_user_hour == 5
    assert load_config({"SECRET_KEY": "k", "EXPORTS_PER_USER_HOUR": "2"}).exports_per_user_hour == 2

    monkeypatch.setenv("SECRET_KEY", "test-only-secret-key-do-not-use-in-prod")
    monkeypatch.setenv("EXPORTS_PER_USER_HOUR", "2")
    configured = create_app(
        config_overrides={"DATABASE_PATH": str(tmp_path / "ceiling.db"), "TESTING": True}
    )
    client, _ = register(configured, "owner")
    codes = [client.get("/api/export", headers=CSRF).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
