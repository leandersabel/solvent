"""Reviewer's tests: `schemaVersion` and `version` are integers from 1 to
2^53 - 1, and anything else is a Bad Request (spec/features/record-api.md,
Endpoints, criterion 32; spec/features/export-import.md, the per-record
validator import shares).

Written from the spec alone.
"""
from __future__ import annotations

import uuid

import pytest

from tests.helpers import CSRF, b64, connect, put_record, rows

LARGEST = 2**53 - 1
PAST = {"2^53": 2**53, "2^63": 2**63, "10^30": 10**30}
NOT_IN_RANGE = {**PAST, "0": 0, "-1": -1, "a string": "1", "a fraction": 1.5, "true": True, "null": None}


def set_version(app, record_id, version):
    conn = connect(app)
    try:
        conn.execute("UPDATE records SET version = ? WHERE record_id = ?", (version, record_id))
        conn.commit()
    finally:
        conn.close()


@pytest.mark.parametrize("field", ["schemaVersion", "version"])
@pytest.mark.parametrize("value", NOT_IN_RANGE.values(), ids=NOT_IN_RANGE.keys())
def test_a_create_outside_the_range_is_a_bad_request_that_writes_nothing(app, owner, field, value):
    before = rows(app, "SELECT * FROM records")
    _, response = put_record(owner, **{field: value})
    assert response.status_code == 400, response.get_data(as_text=True)
    assert rows(app, "SELECT * FROM records") == before


@pytest.mark.parametrize("value", PAST.values(), ids=PAST.keys())
def test_an_update_past_the_largest_is_a_bad_request_not_a_conflict(app, owner, value):
    """Stored at 2^53 - 1, the next version is 2^53: the range refuses
    it before the version check could call it the right next one."""
    record_id, created = put_record(owner)
    assert created.status_code == 200
    set_version(app, record_id, LARGEST if value == 2**53 else 1)
    before = rows(app, "SELECT * FROM records")

    _, response = put_record(owner, record_id, version=value)
    assert response.status_code == 400, response.get_data(as_text=True)
    assert rows(app, "SELECT * FROM records") == before


def test_the_largest_schema_version_and_version_are_stored_and_read_back_exactly(app, owner):
    record_id, created = put_record(owner, schemaVersion=LARGEST)
    assert created.status_code == 200
    set_version(app, record_id, LARGEST - 1)

    _, updated = put_record(owner, record_id, schemaVersion=LARGEST, version=LARGEST)
    assert updated.status_code == 200, updated.get_data(as_text=True)

    listed = owner.get("/api/records?type=account", headers=CSRF).get_json()
    mine = [record for record in listed if record["recordId"] == record_id]
    assert [(r["schemaVersion"], r["version"]) for r in mine] == [(LARGEST, LARGEST)]


@pytest.mark.parametrize("value", PAST.values(), ids=PAST.keys())
def test_an_import_with_a_schema_version_past_the_largest_is_refused_whole(app, owner, value):
    before = rows(app, "SELECT * FROM records")
    record = {
        "recordId": str(uuid.uuid4()),
        "recordType": "account",
        "accountId": None,
        "schemaVersion": value,
        "version": 1,
        "nonce": b64(12),
        "ciphertext": b64(64),
    }
    response = owner.post(
        "/api/import",
        json={"wrappedDek": b64(48), "dekNonce": b64(12), "records": [record]},
        headers=CSRF,
    )
    assert response.status_code == 400, response.get_data(as_text=True)
    assert rows(app, "SELECT * FROM records") == before
