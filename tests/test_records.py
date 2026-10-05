"""The generic record store (spec/features/record-api.md)."""
from __future__ import annotations

import uuid

import pytest

from solvent.records import MAX_CIPHERTEXT_BYTES, aad
from tests.helpers import CSRF, b64, put_record, record_body, register, rows


def account_of(client):
    record_id, response = put_record(client)
    assert response.status_code == 200
    return record_id


def stored(app, record_id):
    return rows(app, "SELECT * FROM records WHERE record_id = ?", (record_id,))[0]


# ---- The AAD encoding -------------------------------------------------

# Checked in as bytes rather than recomputed by the test: a test that
# rebuilds the AAD with the same helper it is testing asserts nothing.
AAD_FIXTURE = (
    b"\x1fsnapshot\x1f8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11\x1f1\x1f3"
)
AAD_FIXTURE_WITH_ACCOUNT = (
    b"3f0d1b2a-0000-4000-8000-000000000001\x1fsnapshot"
    b"\x1f8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11\x1f1\x1f3"
)


def test_the_aad_matches_the_stored_fixture_byte_for_byte():
    assert (
        aad(None, "snapshot", "8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11", 1, 3)
        == AAD_FIXTURE
    )
    assert (
        aad(
            "3f0d1b2a-0000-4000-8000-000000000001",
            "snapshot",
            "8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11",
            1,
            3,
        )
        == AAD_FIXTURE_WITH_ACCOUNT
    )


def test_an_empty_account_id_is_the_empty_string_and_still_contributes_a_separator():
    assert AAD_FIXTURE.startswith(b"\x1f")
    assert AAD_FIXTURE.count(b"\x1f") == 4
    assert b"null" not in AAD_FIXTURE


def test_the_rate_type_moves_no_byte_of_the_encoding():
    """rate carries the empty account_id that account and profile
    carry, and record_type is already a field whose value varies."""
    as_rate = aad(None, "rate", "8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11", 1, 3)
    assert as_rate == AAD_FIXTURE.replace(b"snapshot", b"rate")
    assert as_rate.count(b"\x1f") == AAD_FIXTURE.count(b"\x1f")


def test_the_aad_contains_no_user_identifier(app, owner):
    account_id = account_of(owner)
    principal = rows(app, "SELECT id FROM principals")[0]["id"]
    built = aad(None, "account", account_id, 1, 1)
    assert principal.encode() not in built


# ---- Versioning -------------------------------------------------------


def test_a_create_at_version_one_stores_a_row_and_a_repeat_conflicts(app, owner):
    record_id, first = put_record(owner)
    assert first.status_code == 200
    _, again = put_record(owner, record_id)
    assert again.status_code == 409
    assert stored(app, record_id)["version"] == 1


@pytest.mark.parametrize("version", [1, 2, 4])
def test_only_stored_version_plus_one_is_accepted(app, owner, version):
    record_id = account_of(owner)
    before = stored(app, record_id)
    response = owner.put(
        f"/api/records/{record_id}",
        json=record_body(version=version),
        headers=CSRF,
    )
    if version == 2:
        assert response.status_code == 200
        assert stored(app, record_id)["version"] == 2
    else:
        assert response.status_code == 409
        assert stored(app, record_id) == before


@pytest.mark.parametrize("field", ["schemaVersion", "version"])
def test_a_version_past_two_to_the_fifty_three_is_a_bad_request(app, owner, field):
    """Past it a browser rounds the number, and the AAD it builds no
    longer matches the one the record was sealed under."""
    _, response = put_record(owner, **{field: 2**53})
    assert response.status_code == 400
    _, response = put_record(owner, schemaVersion=2**53 - 1)
    assert response.status_code == 200


def test_two_successive_writes_produce_different_nonces(app, owner):
    record_id = account_of(owner)
    first = stored(app, record_id)["nonce"]
    owner.put(f"/api/records/{record_id}", json=record_body(version=2), headers=CSRF)
    assert stored(app, record_id)["nonce"] != first


def test_reusing_the_previous_nonce_is_refused(app, owner):
    record_id = account_of(owner)
    previous = stored(app, record_id)["nonce"]
    response = owner.put(
        f"/api/records/{record_id}",
        json=record_body(version=2, nonce=previous),
        headers=CSRF,
    )
    assert response.status_code == 400


# ---- Field consistency ------------------------------------------------


def test_an_immutable_column_cannot_change(app, owner):
    record_id = account_of(owner)
    before = stored(app, record_id)
    response = owner.put(
        f"/api/records/{record_id}",
        json=record_body("profile", version=2),
        headers=CSRF,
    )
    assert response.status_code == 400
    assert stored(app, record_id) == before


def test_account_id_is_required_exactly_for_snapshot(owner):
    account_id = account_of(owner)
    _, missing = put_record(owner, record_type="snapshot", accountId=None)
    assert missing.status_code == 400
    _, present = put_record(owner, record_type="account", accountId=account_id)
    assert present.status_code == 400
    _, rate = put_record(owner, record_type="rate", accountId=account_id)
    assert rate.status_code == 400
    _, ok = put_record(owner, record_type="snapshot", accountId=account_id)
    assert ok.status_code == 200


def test_an_empty_string_account_id_is_a_bad_request_on_any_type(owner):
    for record_type in ("account", "snapshot", "rate", "profile"):
        _, response = put_record(owner, record_type=record_type, accountId="")
        assert response.status_code == 400, record_type


def test_an_account_id_naming_no_account_row_is_a_bad_request(owner):
    _, response = put_record(
        owner, record_type="snapshot", accountId=str(uuid.uuid4())
    )
    assert response.status_code == 400


def test_account_id_is_null_and_never_empty_in_a_get_response(owner):
    account_of(owner)
    body = owner.get("/api/records?type=account", headers=CSRF).get_json()
    assert body[0]["accountId"] is None


def test_account_id_is_null_and_never_empty_in_an_exported_file(owner):
    account_of(owner)
    body = owner.get("/api/export", headers=CSRF).get_json()
    account = next(r for r in body["records"] if r["recordType"] == "account")
    assert account["accountId"] is None


def test_a_principal_id_or_aad_field_is_rejected_outright(app, owner):
    for field in ("principalId", "aad"):
        _, response = put_record(owner, **{field: "anything"})
        assert response.status_code == 400, field
    assert rows(app, "SELECT * FROM records WHERE record_type = 'account'") == []


def test_a_malformed_record_id_is_a_bad_request(owner):
    assert owner.put(
        "/api/records/not-a-uuid", json=record_body(), headers=CSRF
    ).status_code == 400
    # A v1 UUID is well formed and still not a UUIDv4.
    assert owner.put(
        "/api/records/2c1b814e-a8f0-11ee-be56-0242ac120002",
        json=record_body(),
        headers=CSRF,
    ).status_code == 400


def test_an_unknown_record_type_is_refused(owner):
    _, response = put_record(owner, record_type="invoice")
    assert response.status_code == 400


# ---- Isolation --------------------------------------------------------


def test_neither_of_two_vaults_sees_a_row_of_the_others(app):
    first, _ = register(app, "first")
    second, _ = register(app, "second")
    mine = account_of(first)
    account_of(second)

    listed = second.get("/api/records?type=account", headers=CSRF).get_json()
    assert [row["recordId"] for row in listed] != [mine]
    assert all(row["recordId"] != mine for row in listed)


def test_reaching_another_vaults_record_is_not_found_never_forbidden(app):
    first, _ = register(app, "first")
    second, _ = register(app, "second")
    mine = account_of(first)

    assert second.delete(f"/api/records/{mine}", headers=CSRF).status_code == 404
    # A PUT at that id creates a row in the caller's own vault rather
    # than touching the other's, which the primary key makes true.
    second.put(f"/api/records/{mine}", json=record_body(), headers=CSRF)
    owners = rows(app, "SELECT principal_id FROM records WHERE record_id = ?", (mine,))
    assert len({row["principal_id"] for row in owners}) == 2


def test_the_type_parameter_is_required_and_closed(owner):
    assert owner.get("/api/records", headers=CSRF).status_code == 400
    assert owner.get("/api/records?type=invoice", headers=CSRF).status_code == 400


# ---- Caps -------------------------------------------------------------


def test_a_ciphertext_over_the_per_record_cap_is_content_too_large(app, owner):
    _, response = put_record(owner, ciphertext=b64(MAX_CIPHERTEXT_BYTES + 1))
    assert response.status_code == 413
    assert rows(app, "SELECT * FROM records WHERE record_type = 'account'") == []


def test_a_ciphertext_at_the_cap_boundary_is_accepted(owner):
    _, response = put_record(owner, ciphertext=b64(MAX_CIPHERTEXT_BYTES))
    assert response.status_code == 200


def test_the_byte_quota_is_enforced_before_the_row_reaches_the_db(app, owner, monkeypatch):
    import solvent.records as records

    monkeypatch.setattr(records, "MAX_BYTES_PER_USER", 1024)
    _, response = put_record(owner, ciphertext=b64(2048))
    assert response.status_code == 413
    assert rows(app, "SELECT * FROM records WHERE record_type = 'account'") == []


def test_the_record_count_cap_is_enforced(app, owner, monkeypatch):
    import solvent.records as records

    account_of(owner)
    monkeypatch.setattr(records, "MAX_RECORDS_PER_VAULT", 2)
    _, response = put_record(owner)
    assert response.status_code == 413


# ---- Deletes and logging ----------------------------------------------


def test_deleting_a_record_that_does_not_exist_is_not_found(owner):
    assert owner.delete(
        f"/api/records/{uuid.uuid4()}", headers=CSRF
    ).status_code == 404


def test_no_log_line_contains_a_ciphertext_value(app, owner, caplog):
    """Needs the captured log output of a real write, not a grep of
    the source."""
    with caplog.at_level(0):
        record_id, response = put_record(owner)
    assert response.status_code == 200
    blob = stored(app, record_id)["ciphertext"]
    assert blob not in caplog.text


def test_reading_a_record_at_an_older_schema_version_writes_nothing(app, owner):
    record_id, _ = put_record(owner, schemaVersion=1)
    before = stored(app, record_id)
    owner.get("/api/records?type=account", headers=CSRF)
    assert stored(app, record_id) == before
