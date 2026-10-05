"""A page whose Master Key predates a password change or KDF upgrade
made elsewhere writes no wrapper and no credential
(spec/architecture.md, Credentials and vault key wrappers).
"""
from __future__ import annotations

import pytest

from tests.helpers import CSRF, b64, credential, params_of, register, rows
from tests.test_vault_epoch import everything, import_payload, restore, two_pages  # noqa: F401

CHANGED = {"refused": "credential-changed"}
KDF = {"alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1}
ROUTES = ("/api/import", "/api/auth/upgrade-kdf", "/api/auth/change-password")


def rotation(**fields):
    return {"salt": b64(16), "kdf": KDF, "authKey": b64(), "wrappedDek": b64(48), "dekNonce": b64(12), **fields}


def change_password(client, current_auth_key, **fields):
    new_auth_key = b64()
    response = client.post(
        "/api/auth/change-password",
        json=rotation(currentAuthKey=current_auth_key, authKey=new_auth_key, **fields),
        headers=CSRF,
    )
    return response, new_auth_key


@pytest.fixture
def stale(app, two_pages):  # noqa: F811
    """`second` holds the salt from before `first` changed the password."""
    first, second, auth_key = two_pages
    salt = params_of(credential(app, "owner"))["salt"]
    response, _ = change_password(first, auth_key)
    assert response.status_code == 200, response.get_data(as_text=True)
    return first, second, salt


def test_an_import_after_a_password_change_elsewhere_writes_nothing(app, stale):
    _, second, salt = stale
    before = everything(app)
    response = second.post("/api/import", json={**import_payload(), "currentSalt": salt}, headers=CSRF)
    assert (response.status_code, response.get_json()) == (409, CHANGED)
    assert everything(app) == before


def test_an_import_after_a_kdf_upgrade_elsewhere_writes_nothing(app, two_pages):  # noqa: F811
    first, second, _ = two_pages
    salt = params_of(credential(app, "owner"))["salt"]
    assert first.post("/api/auth/upgrade-kdf", json=rotation(), headers=CSRF).status_code == 200
    before = everything(app)
    response = second.post("/api/import", json={**import_payload(), "currentSalt": salt}, headers=CSRF)
    assert (response.status_code, response.get_json()) == (409, CHANGED)
    assert everything(app) == before


def test_an_upgrade_after_a_password_change_elsewhere_writes_nothing(app, stale):
    _, second, salt = stale
    before = everything(app)
    response = second.post("/api/auth/upgrade-kdf", json=rotation(currentSalt=salt), headers=CSRF)
    assert (response.status_code, response.get_json()) == (409, CHANGED)
    assert everything(app) == before


def test_a_password_change_on_a_superseded_salt_writes_nothing_and_counts_no_failure(app, stale):
    _, second, salt = stale
    before = everything(app)
    response, _ = change_password(second, b64(), currentSalt=salt)
    assert (response.status_code, response.get_json()) == (409, CHANGED)
    assert everything(app) == before


def test_an_administrator_on_a_superseded_salt_changes_nothing(app):
    admin, auth_key = register(app, "root", kind="administrator")
    salt = params_of(credential(app, "root"))["salt"]
    response = admin.post(
        "/api/auth/change-password",
        json={"currentAuthKey": auth_key, "salt": b64(16), "kdf": KDF, "authKey": b64()},
        headers=CSRF,
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    before = everything(app)
    response = admin.post(
        "/api/auth/change-password",
        json={"currentAuthKey": b64(), "currentSalt": salt, "salt": b64(16), "kdf": KDF, "authKey": b64()},
        headers=CSRF,
    )
    assert (response.status_code, response.get_json()) == (409, CHANGED)
    assert everything(app) == before


@pytest.mark.parametrize("route", ROUTES)
def test_a_request_without_the_current_salt_is_a_bad_request(app, route):
    owner, auth_key = register(app, "owner")
    body = import_payload() if route == "/api/import" else rotation(currentAuthKey=auth_key)
    before = everything(app)
    response = owner.post(route, json={**body, "currentSalt": None}, headers=CSRF)
    assert response.status_code == 400
    assert everything(app) == before


def test_a_replaced_vault_is_named_before_a_changed_credential(app, stale):
    first, second, salt = stale
    restore(first)
    response = second.post("/api/import", json={**import_payload(), "currentSalt": salt}, headers=CSRF)
    assert response.get_json() == {"refused": "vault-replaced"}


def test_the_page_that_changed_the_password_still_restores(app, two_pages):  # noqa: F811
    first, _, auth_key = two_pages
    response, _ = change_password(first, auth_key)
    assert response.status_code == 200
    restore(first)
    assert len(rows(app, "SELECT * FROM dek_wrappers")) == 1
