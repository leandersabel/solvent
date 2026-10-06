"""Reviewer's tests: a write made under a page's Master Key names the
salt that key came from, and a page holding a superseded salt stores
nothing (spec/architecture.md, Credentials and vault key wrappers, and
Status codes; spec/features/export-import.md, The re-key step, Edge
cases, criteria 49 to 51).

Written from the spec alone. Every request is sent by a plain Flask
client with its headers and body spelled out, so nothing a shared test
helper adds to a request can stand in for what a page sends.
"""
from __future__ import annotations

import json

from flask.testing import FlaskClient

import solvent.vault as vault_module
from solvent.config import DEFAULT_KDF_ENVELOPE
from tests.helpers import CSRF, b64, connect, put_record, register, register_body, rows

CHANGED = {"refused": "credential-changed"}
REPLACED = {"refused": "vault-replaced"}
LOGIN = "/api/auth/login"
CHANGE = "/api/auth/change-password"
UPGRADE = "/api/auth/upgrade-kdf"
IMPORT = "/api/import"


class Page:
    """One page of a browser. Pages of one browser share its cookie jar,
    and each holds its own vault epoch and the salt its Master Key came
    from (login.md, A credential changed elsewhere)."""

    def __init__(self, browser, epoch, salt, kind="vault_owner"):
        self.browser, self.epoch, self.salt, self.kind = browser, epoch, salt, kind

    def another(self):
        return Page(self.browser, self.epoch, self.salt, self.kind)

    def post(self, path, body):
        headers = dict(CSRF)
        if self.epoch:
            headers["X-Solvent-Vault"] = self.epoch
        return self.browser.post(path, json=body, headers=headers)

    def wrapper(self):
        return {"wrappedDek": b64(48), "dekNonce": b64(12)} if self.kind == "vault_owner" else {}

    def change_body(self, current_key, new_key, current_salt):
        return {
            "currentAuthKey": current_key, "currentSalt": current_salt, "salt": b64(16),
            "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": new_key, **self.wrapper(),
        }

    def change(self, current_key, new_key=None, current_salt=None):
        """Change the password, naming the held salt unless told
        otherwise. On OK the page holds the salt it sent."""
        body = self.change_body(current_key, new_key or b64(), current_salt or self.salt)
        response = self.post(CHANGE, body)
        if response.status_code == 200:
            self.salt = body["salt"]
        return response, body["authKey"]

    def upgrade(self, new_key=None, current_salt=None):
        body = {
            "currentSalt": current_salt or self.salt, "salt": b64(16),
            "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": new_key or b64(), **self.wrapper(),
        }
        response = self.post(UPGRADE, body)
        if response.status_code == 200:
            self.salt = body["salt"]
        return response, body["authKey"]

    def restore(self, current_salt=None):
        body = {"currentSalt": current_salt or self.salt, "records": [], **self.wrapper()}
        response = self.post(IMPORT, body)
        if response.status_code == 200:
            self.epoch = response.get_json()["vaultEpoch"]
        return response

    def sign_in(self, username, auth_key):
        """An unlock on this page, on the browser's live session."""
        response = self.post(LOGIN, {"username": username, "authKey": auth_key})
        assert response.status_code == 200, response.get_data(as_text=True)
        answered = response.get_json()
        self.epoch = answered.get("vaultEpoch")
        self.salt = salt_of(self.browser.application, username)
        return answered


def browser(app):
    return FlaskClient(app, app.response_class, use_cookies=True)


def open_vault(app, username="owner", kind="vault_owner"):
    """A registered account with its vault open in one page. Returns
    the page and the Auth Key."""
    body = register_body(app, kind, username=username)
    client = browser(app)
    response = client.post("/api/register", json=body, headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    return Page(client, response.get_json().get("vaultEpoch"), body["salt"], kind), body["authKey"]


def salt_of(app, username):
    conn = connect(app)
    try:
        params = conn.execute(
            "SELECT params FROM credentials JOIN principals ON principals.id = credentials.principal_id "
            "WHERE principals.username = ?",
            (username,),
        ).fetchone()["params"]
    finally:
        conn.close()
    return json.loads(params)["salt"]


def make_stale(app, username):
    """The credential at an envelope below the server default, as one
    registered before the default was raised."""
    conn = connect(app)
    try:
        conn.execute(
            "UPDATE credentials SET params = json_set(params, '$.kdf.m', 32768) WHERE principal_id = "
            "(SELECT id FROM principals WHERE username = ?)",
            (username,),
        )
        conn.commit()
    finally:
        conn.close()


def everything(app):
    """Every table row for row, but for `sessions.last_active_at`, which
    the request gate writes on a request a handler then refuses."""
    conn = connect(app)
    try:
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        state = {}
        for table in tables:
            columns = [
                c[1] for c in conn.execute(f"PRAGMA table_info({table})")
                if (table, c[1]) != ("sessions", "last_active_at")
            ]
            state[table] = sorted(
                tuple(row) for row in conn.execute(f"SELECT {', '.join(columns)} FROM {table}")
            )
        return state
    finally:
        conn.close()


def refused(response, reason):
    return (response.status_code, response.get_json(silent=True)) == (409, reason)


# ---- Criterion 49 ---------------------------------------------------------


def test_an_import_after_a_password_change_on_another_page_writes_nothing(app):
    here, key = open_vault(app)
    there = here.another()
    changed, _ = there.change(key)
    assert changed.status_code == 200

    before = everything(app)
    response = here.restore()
    assert refused(response, CHANGED), response.get_data(as_text=True)
    assert everything(app) == before


def test_an_import_after_a_kdf_upgrade_on_another_page_writes_nothing(app):
    here, key = open_vault(app)
    make_stale(app, "owner")
    there = here.another()
    assert there.sign_in("owner", key)["kdfStale"] is True
    upgraded, _ = there.upgrade()
    assert upgraded.status_code == 200

    before = everything(app)
    response = here.restore()
    assert refused(response, CHANGED), response.get_data(as_text=True)
    assert everything(app) == before


def test_a_password_change_landing_between_the_gate_and_the_import_refuses_it(app, monkeypatch):
    """The import is held after the request gate has passed it and before
    its transaction begins, which is where a salt compared outside the
    transaction would let a wrapper under the old Master Key through."""
    here, key = open_vault(app)
    there = here.another()
    real = vault_module.write_transaction

    def after_a_change(*args, **kwargs):
        monkeypatch.setattr(vault_module, "write_transaction", real)
        assert there.change(key)[0].status_code == 200
        return real(*args, **kwargs)

    monkeypatch.setattr(vault_module, "write_transaction", after_a_change)
    response = here.restore()
    assert refused(response, CHANGED), response.get_data(as_text=True)
    assert salt_of(app, "owner") == there.salt


# ---- Criterion 50 ---------------------------------------------------------


def test_a_replaced_vault_is_named_before_a_changed_credential(app):
    here, key = open_vault(app)
    there = here.another()
    assert there.change(key)[0].status_code == 200
    assert there.restore().status_code == 200

    before = everything(app)
    response = here.restore()
    assert refused(response, REPLACED), response.get_data(as_text=True)
    assert everything(app) == before


def test_inside_the_transaction_the_epoch_is_compared_before_the_salt(app, monkeypatch):
    """Both land after the gate let the import through, so only the
    handler's own comparisons, in their order, decide the reason."""
    here, key = open_vault(app)
    there = here.another()
    real = vault_module.write_transaction

    def after_a_change_and_a_restore(*args, **kwargs):
        monkeypatch.setattr(vault_module, "write_transaction", real)
        assert there.change(key)[0].status_code == 200
        assert there.restore().status_code == 200
        return real(*args, **kwargs)

    monkeypatch.setattr(vault_module, "write_transaction", after_a_change_and_a_restore)
    response = here.restore()
    assert refused(response, REPLACED), response.get_data(as_text=True)


# ---- Criterion 51 ---------------------------------------------------------


def test_the_page_that_changed_the_password_restores_without_unlocking(app):
    page, key = open_vault(app)
    assert page.change(key)[0].status_code == 200
    credential = everything(app)["credentials"]

    response = page.restore()
    assert response.status_code == 200, response.get_data(as_text=True)
    # The import replaces the wrapper and leaves the credential the
    # change wrote.
    assert everything(app)["credentials"] == credential
    assert salt_of(app, "owner") == page.salt


def test_an_import_naming_the_current_salt_goes_through_after_an_upgrade_elsewhere(app):
    """Once the page has unlocked again it holds the current salt, and
    the restore it was refused goes through (login.md, A credential
    changed elsewhere)."""
    here, key = open_vault(app)
    make_stale(app, "owner")
    there = here.another()
    there.sign_in("owner", key)
    _, upgraded_key = there.upgrade()
    assert refused(here.restore(), CHANGED)

    here.sign_in("owner", upgraded_key)
    assert here.restore().status_code == 200


# ---- Criterion 3 ----------------------------------------------------------


def test_the_export_read_carries_every_kind_in_one_records_array_beside_what_opens_it(app):
    """The read the browser seals: the vault's records of every kind in
    one `records` array, beside the timestamp, the password credential's
    salt and KDF envelope, and its wrapper (export-import.md, Export)."""
    client, _ = register(app, "owner")
    account, answered = put_record(client, record_type="account")
    assert answered.status_code == 200, answered.get_data(as_text=True)
    for kind, owner in (("snapshot", account), ("rate", None)):
        _, answered = put_record(client, record_type=kind, accountId=owner)
        assert answered.status_code == 200, answered.get_data(as_text=True)

    response = client.get("/api/export", headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    read = response.get_json()
    assert set(read) == {"exportedAt", "salt", "kdf", "wrappedDek", "dekNonce", "records"}
    assert sorted(r["recordType"] for r in read["records"]) == ["account", "profile", "rate", "snapshot"]
    assert all(
        set(r) == {"recordId", "recordType", "accountId", "schemaVersion", "version", "nonce", "ciphertext"}
        for r in read["records"]
    )
    params = json.loads(rows(app, "SELECT params FROM credentials")[0]["params"])
    assert (read["salt"], read["kdf"]) == (params["salt"], params["kdf"])
