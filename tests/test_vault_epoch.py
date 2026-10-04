"""The vault epoch: a page holding a DEK an import replaced neither
writes nor reads (spec/architecture.md, Vault epoch; spec/features/
export-import.md; spec/features/app-shell.md, The request gate).
"""
from __future__ import annotations

import re
import uuid

import pytest

import solvent.records as records_module
import solvent.vault as vault_module
from solvent import create_app
from solvent.guard import ADMINISTRATION, SHARED, VAULT, surface_of
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

REPLACED = {"refused": "vault-replaced"}
HEX32 = re.compile(r"[0-9a-f]{32}")


def import_payload(records=()):
    return {"wrappedDek": b64(48), "dekNonce": b64(12), "records": list(records)}


def epoch_of(app, username):
    found = rows(
        app,
        "SELECT epoch FROM vault_epochs WHERE principal_id = ?",
        (principal_id(app, username),),
    )
    return found[0]["epoch"] if found else None


def everything(app):
    """Every table row for row, but for `sessions.last_active_at`, which
    each authenticated request writes."""
    conn = connect(app)
    try:
        tables = [
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        state = {}
        for table in tables:
            columns = [
                c["name"]
                for c in conn.execute(f"PRAGMA table_info({table})")
                if (table, c["name"]) != ("sessions", "last_active_at")
            ]
            state[table] = [
                tuple(row)
                for row in conn.execute(f"SELECT {', '.join(columns)} FROM {table} ORDER BY 1, 2")
            ]
        return state
    finally:
        conn.close()


@pytest.fixture
def two_pages(app):
    """One vault open in two pages of one browser: one session, one
    cookie jar, one epoch. `first` restores a file, after which `second`
    still holds the epoch from before."""
    first, auth_key = register(app, "owner")
    second = app.test_client()
    second.set_cookie(
        "solvent_session", first.get_cookie("solvent_session").value, domain="localhost"
    )
    second.epoch = first.epoch
    return first, second, auth_key


def restore(client, records=()):
    response = client.post("/api/import", json=import_payload(records), headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


# ---- What registration and sign-in hand over -----------------------------


def test_a_vault_owner_registers_with_one_epoch_and_is_told_it(app):
    client, _ = register(app, "owner")
    stored = rows(app, "SELECT * FROM vault_epochs")
    assert len(stored) == 1
    assert HEX32.fullmatch(stored[0]["epoch"])
    assert client.epoch == stored[0]["epoch"]


def test_an_administrator_has_no_epoch_and_is_told_none(app):
    admin, _ = register(app, "root", kind="administrator")
    assert rows(app, "SELECT * FROM vault_epochs") == []
    assert admin.epoch is None


def test_a_vault_owner_login_carries_the_epoch_and_an_administrators_none(app):
    _, owner_key = register(app, "owner")
    _, admin_key = register(app, "root", kind="administrator")
    assert sign_in(app, "owner", owner_key)[1]["vaultEpoch"] == epoch_of(app, "owner")
    assert "vaultEpoch" not in sign_in(app, "root", admin_key)[1]


def test_the_next_sign_in_after_an_import_carries_the_new_epoch(app):
    owner, auth_key = register(app, "owner")
    before = epoch_of(app, "owner")
    answer = restore(owner)
    assert HEX32.fullmatch(answer["vaultEpoch"])
    assert answer["vaultEpoch"] != before
    assert answer["vaultEpoch"] == epoch_of(app, "owner")
    assert sign_in(app, "owner", auth_key)[1]["vaultEpoch"] == answer["vaultEpoch"]


def test_an_administrator_cannot_be_given_an_epoch(app):
    register(app, "root", kind="administrator")
    conn = connect(app)
    try:
        with pytest.raises(Exception, match="an administrator has no vault"):
            conn.execute(
                "INSERT INTO vault_epochs (principal_id, epoch) VALUES (?, ?)",
                (principal_id(app, "root"), "0" * 32),
            )
    finally:
        conn.close()


def test_deleting_the_account_leaves_no_epoch_row(app):
    owner, auth_key = register(app, "owner")
    response = owner.delete(
        "/api/auth/account",
        json={"authKey": auth_key, "confirmUsername": "owner"},
        headers=CSRF,
    )
    assert response.status_code == 200
    assert rows(app, "SELECT * FROM vault_epochs") == []


# ---- Start fills the rows an earlier build did not write -----------------


def test_a_start_gives_each_vault_owner_without_an_epoch_a_fresh_one(app):
    register(app, "kept")
    register(app, "bare")
    register(app, "bare-too")
    register(app, "root", kind="administrator")
    conn = connect(app)
    try:
        conn.execute(
            "DELETE FROM vault_epochs WHERE principal_id IN "
            "(SELECT id FROM principals WHERE username IN ('bare', 'bare-too'))"
        )
        conn.commit()
    finally:
        conn.close()
    kept = epoch_of(app, "kept")
    version = rows(app, "PRAGMA user_version")

    config = {"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True}
    create_app(config)
    stored = rows(app, "SELECT principals.username, epoch FROM vault_epochs JOIN principals ON principals.id = principal_id")
    assert {row["username"] for row in stored} == {"kept", "bare", "bare-too"}
    assert all(HEX32.fullmatch(row["epoch"]) for row in stored)
    assert len({row["epoch"] for row in stored}) == 3
    assert epoch_of(app, "kept") == kept
    assert rows(app, "PRAGMA user_version") == version

    again = rows(app, "SELECT * FROM vault_epochs ORDER BY principal_id")
    create_app(config)
    assert rows(app, "SELECT * FROM vault_epochs ORDER BY principal_id") == again


# ---- The gate -------------------------------------------------------------


def api_routes(app):
    """Every API route a vault owner reaches outside Public, each with
    the methods it answers and a path with its parameters filled in."""
    found = []
    for rule in app.url_map.iter_rules():
        view = app.view_functions[rule.endpoint]
        if not rule.rule.startswith("/api/") or getattr(view, "public", False):
            continue
        if surface_of(str(rule)) not in (SHARED, VAULT):
            continue
        path = re.sub(r"<[^>]+>", str(uuid.uuid4()), rule.rule)
        found.append((path, sorted(rule.methods - {"HEAD", "OPTIONS"})))
    return found


BAD_HEADERS = ["", "0" * 31, "0" * 33, "A" * 32, "g" * 32]


def test_a_malformed_or_missing_epoch_is_a_bad_request_with_no_reason(app):
    owner, _ = register(app, "owner")
    before = everything(app)
    routes = api_routes(app)
    assert routes
    for path, methods in routes:
        for method in methods:
            sent = [{**CSRF, "X-Solvent-Vault": value} for value in BAD_HEADERS]
            for headers in sent:
                response = owner.open(path, method=method, headers=headers, json={})
                assert response.status_code == 400, (path, method, headers)
                assert "refused" not in (response.get_json(silent=True) or {})
            owner.epoch = None
            response = owner.open(path, method=method, headers=CSRF, json={})
            assert response.status_code == 400, (path, method)
            assert "refused" not in (response.get_json(silent=True) or {})
            owner.epoch = epoch_of(app, "owner")
    assert everything(app) == before


def test_another_vaults_epoch_and_a_replaced_one_are_a_conflict_on_every_route(app):
    owner, _ = register(app, "owner")
    other, _ = register(app, "other")
    old = owner.epoch
    restore(owner)
    before = everything(app)
    for stale in (old, other.epoch):
        for path, methods in api_routes(app):
            for method in methods:
                response = owner.open(
                    path, method=method, headers={**CSRF, "X-Solvent-Vault": stale}, json={}
                )
                assert response.status_code == 409, (path, method)
                assert response.get_json() == REPLACED, (path, method)
    assert everything(app) == before


def test_an_administrator_and_a_public_route_ignore_the_header(app):
    admin, _ = register(app, "root", kind="administrator")
    for value in (None, "", "x", "0" * 32):
        headers = dict(CSRF) if value is None else {**CSRF, "X-Solvent-Vault": value}
        assert admin.get("/api/admin/accounts", headers=headers).status_code == 200
        assert admin.post(
            "/api/auth/change-password", json={}, headers=headers
        ).status_code == 400
        assert admin.post("/api/auth/salt", json={"username": "x"}, headers=headers).status_code == 200


def test_a_refusal_before_the_epoch_step_is_the_same_with_and_without_the_header(app):
    """Step 7 runs only on what steps 1 to 6 let through, so it teaches
    nothing about paths or kinds."""
    owner, _ = register(app, "owner")
    epoch = epoch_of(app, "owner")
    refused = [("/api/invented", "GET"), ("/api/admin/invented", "GET"), ("//admin", "GET")]
    for rule in app.url_map.iter_rules():
        if surface_of(str(rule)) == ADMINISTRATION and "<" not in rule.rule:
            refused += [(rule.rule, method) for method in sorted(rule.methods - {"HEAD", "OPTIONS"})]
    refused += [("/api/records", "PATCH"), ("/api/export", "DELETE")]
    for path, method in refused:
        owner.epoch = epoch
        with_header = owner.open(path, method=method, headers=CSRF, json={})
        owner.epoch = None
        without = owner.open(path, method=method, headers=CSRF, json={})
        assert (with_header.status_code, with_header.get_data()) == (
            without.status_code,
            without.get_data(),
        ), (path, method)


def test_a_registration_that_fails_leaves_no_epoch(app):
    from tests.helpers import register_body

    body = register_body(app, "vault_owner", username="someone", profileCiphertext="not base64!")
    client = app.test_client()
    assert client.post("/api/register", json=body, headers=CSRF).status_code == 400
    assert rows(app, "SELECT * FROM vault_epochs") == []


def test_an_administrator_removing_a_vault_owner_removes_the_epoch_and_compares_none(app):
    register(app, "owner")
    admin, _ = register(app, "root", kind="administrator")
    assert len(rows(app, "SELECT * FROM vault_epochs")) == 1
    response = admin.delete(
        "/api/admin/accounts/owner", json={"confirmUsername": "owner"}, headers=CSRF
    )
    assert response.status_code == 200
    assert rows(app, "SELECT * FROM vault_epochs") == []


# ---- The two pages of one browser ----------------------------------------


def test_a_page_holding_the_replaced_key_never_reaches_the_vault(app, two_pages):
    first, second, _ = two_pages
    holding, response = put_record(first)
    assert response.status_code == 200
    restore(first)
    restored = rows(app, "SELECT * FROM records ORDER BY record_id")

    created, refused = put_record(second)
    assert (refused.status_code, refused.get_json()) == (409, REPLACED)
    updated = second.put(
        f"/api/records/{holding}",
        json=record_body(version=2),
        headers=CSRF,
    )
    assert (updated.status_code, updated.get_json()) == (409, REPLACED)
    deleted = second.delete(f"/api/records/{holding}", headers=CSRF)
    assert (deleted.status_code, deleted.get_json()) == (409, REPLACED)
    purged = second.delete(f"/api/accounts/{holding}?mode=purge", headers=CSRF)
    assert (purged.status_code, purged.get_json()) == (409, REPLACED)
    listed = second.get("/api/records?type=account", headers=CSRF)
    assert (listed.status_code, listed.get_json()) == (409, REPLACED)

    assert rows(app, "SELECT * FROM records ORDER BY record_id") == restored
    assert rows(app, "SELECT * FROM records WHERE record_id = ?", (created,)) == []


def test_the_restoring_page_keeps_working_and_no_session_is_revoked(app, two_pages):
    first, second, _ = two_pages
    other, _ = sign_in(app, "owner", two_pages[2])
    sessions = rows(app, "SELECT id, token_hash FROM sessions ORDER BY id")
    restore(first)

    assert rows(app, "SELECT id, token_hash FROM sessions ORDER BY id") == sessions
    assert put_record(first)[1].status_code == 200
    # The other browser's session still exists, and is told why.
    answer = other.get("/api/sessions", headers=CSRF)
    assert answer.status_code == 409
    assert second.get("/api/sessions", headers=CSRF).get_json() == REPLACED


def test_a_second_session_with_the_old_epoch_writes_nothing(app):
    first, auth_key = register(app, "owner")
    second, _ = sign_in(app, "owner", auth_key)
    restore(first, [dict(record_body("account"), recordId=str(uuid.uuid4()))])
    imported = rows(app, "SELECT * FROM records ORDER BY record_id")
    assert len(imported) == 1

    for response in (
        put_record(second)[1],
        second.delete(f"/api/records/{imported[0]['record_id']}", headers=CSRF),
    ):
        assert (response.status_code, response.get_json()) == (409, REPLACED)
    assert rows(app, "SELECT * FROM records ORDER BY record_id") == imported


# ---- Import ---------------------------------------------------------------


def test_an_import_with_a_replaced_epoch_writes_nothing(app, two_pages):
    first, second, _ = two_pages
    restore(first)
    before = everything(app)
    response = second.post("/api/import", json=import_payload(), headers=CSRF)
    assert (response.status_code, response.get_json()) == (409, REPLACED)
    assert everything(app) == before


def test_of_two_imports_with_one_epoch_exactly_one_commits(app, two_pages):
    first, second, _ = two_pages
    codes = [
        client.post("/api/import", json=import_payload(), headers=CSRF).status_code
        for client in (first, second)
    ]
    assert codes == [200, 409]


def test_an_import_refused_for_another_reason_leaves_the_epoch(app):
    owner, _ = register(app, "owner")
    before = epoch_of(app, "owner")
    orphan = dict(record_body("snapshot", accountId=str(uuid.uuid4())), recordId=str(uuid.uuid4()))
    assert owner.post("/api/import", json=import_payload([orphan]), headers=CSRF).status_code == 400
    assert epoch_of(app, "owner") == before


def test_a_fault_mid_import_leaves_the_epoch(app):
    owner, _ = register(app, "owner")
    before = epoch_of(app, "owner")
    conn = connect(app)
    try:
        conn.execute(
            "CREATE TRIGGER injected_fault BEFORE UPDATE ON vault_epochs "
            "BEGIN SELECT RAISE(ABORT, 'injected fault'); END"
        )
        conn.commit()
    finally:
        conn.close()
    assert owner.post("/api/import", json=import_payload(), headers=CSRF).status_code == 500
    assert epoch_of(app, "owner") == before


# ---- Export, and the handlers that compare again --------------------------


def test_an_export_with_a_replaced_epoch_is_refused_and_writes_no_attempt(app, two_pages):
    first, second, _ = two_pages
    restore(first)
    before = rows(app, "SELECT * FROM attempts")
    response = second.get("/api/export", headers=CSRF)
    assert (response.status_code, response.get_json()) == (409, REPLACED)
    assert rows(app, "SELECT * FROM attempts") == before


def test_change_password_with_a_replaced_epoch_changes_nothing(app, two_pages):
    first, second, auth_key = two_pages
    restore(first)
    before = everything(app)
    response = second.post(
        "/api/auth/change-password",
        json={
            "currentAuthKey": auth_key,
            "salt": b64(16),
            "kdf": {"alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1},
            "authKey": b64(),
            "wrappedDek": b64(48),
            "dekNonce": b64(12),
        },
        headers=CSRF,
    )
    assert (response.status_code, response.get_json()) == (409, REPLACED)
    assert everything(app) == before


def test_the_stale_kdf_upgrade_with_a_replaced_epoch_changes_nothing(app, two_pages):
    first, second, _ = two_pages
    restore(first)
    before = credential(app, "owner")
    wrapper = rows(app, "SELECT * FROM dek_wrappers")
    response = second.post(
        "/api/auth/upgrade-kdf",
        json={
            "salt": b64(16),
            "kdf": {"alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1},
            "authKey": b64(),
            "wrappedDek": b64(48),
            "dekNonce": b64(12),
        },
        headers=CSRF,
    )
    assert (response.status_code, response.get_json()) == (409, REPLACED)
    assert dict(credential(app, "owner")) == dict(before)
    assert rows(app, "SELECT * FROM dek_wrappers") == wrapper


def test_deleting_the_account_with_a_replaced_epoch_deletes_nothing(app, two_pages):
    first, second, auth_key = two_pages
    restore(first)
    before = everything(app)
    response = second.delete(
        "/api/auth/account",
        json={"authKey": auth_key, "confirmUsername": "owner"},
        headers=CSRF,
    )
    assert (response.status_code, response.get_json()) == (409, REPLACED)
    assert everything(app) == before


# ---- A request racing an import -------------------------------------------


@pytest.mark.parametrize(
    ("module", "act"),
    [
        (records_module, lambda client, holding: client.put(
            f"/api/records/{uuid.uuid4()}", json=record_body(), headers=CSRF)),
        (records_module, lambda client, holding: client.delete(
            f"/api/records/{holding}", headers=CSRF)),
        (vault_module, lambda client, holding: client.delete(
            f"/api/accounts/{holding}?mode=purge", headers=CSRF)),
    ],
    ids=["create", "delete", "purge"],
)
def test_an_import_between_the_gate_and_the_transaction_makes_the_write_answer_replaced(
    app, two_pages, monkeypatch, module, act
):
    """The handler is held after the gate has passed it and before its
    transaction begins, which is where a check made only at the gate
    would let the write through. Import keeps record ids, so the holding
    the stale page deletes is one the restore holds."""
    first, second, _ = two_pages
    holding, _ = put_record(first)
    real = module.write_transaction

    def after_an_import(*args, **kwargs):
        monkeypatch.setattr(module, "write_transaction", real)
        restore(first, [dict(record_body("account"), recordId=holding)])
        return real(*args, **kwargs)

    monkeypatch.setattr(module, "write_transaction", after_an_import)
    response = act(second, holding)
    assert (response.status_code, response.get_json()) == (409, REPLACED)
    assert [r["record_id"] for r in rows(app, "SELECT record_id FROM records")] == [holding]
