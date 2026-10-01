"""`principals.last_login_at`: written by every session start and by
nothing else (spec/features/login.md, The session a sign-in issues;
register.md, What registration writes; app-shell.md, Database).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from solvent import create_app
from tests.helpers import CSRF, b64, connect, mint_invite, register, rows, sign_in
from tests.test_admin import run_cli


def last_login(app, username):
    return rows(app, "SELECT last_login_at FROM principals WHERE username = ?", (username,))[0][
        "last_login_at"
    ]


@pytest.fixture
def clock(monkeypatch):
    """The server clock as a session start reads it, moved by hand."""
    state = {"now": datetime.now(timezone.utc)}
    monkeypatch.setattr(
        "solvent.session.utcnow", lambda: state["now"].isoformat(timespec="seconds")
    )

    def move(**delta):
        state["now"] += timedelta(**delta)
        return state["now"].isoformat(timespec="seconds")

    return move


# ---- Registration is the first sign-in ---------------------------------


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
def test_registration_writes_last_login_at_from_the_same_reading_as_created_at(app, kind):
    token = mint_invite(app, kind)
    register(app, "someone", kind=kind, invite_token=token)

    principal = rows(app, "SELECT created_at, last_login_at FROM principals")[0]
    used_at = rows(app, "SELECT used_at FROM invites")[0]["used_at"]
    assert principal["last_login_at"] is not None
    assert principal["last_login_at"] == principal["created_at"] == used_at


def test_an_administrator_invite_from_the_cli_registers_with_last_login_at_set(app):
    token = run_cli(app, "--kind", "administrator").stdout.strip().split("=")[-1]
    register(app, "root", kind="administrator", invite_token=token)

    principal = rows(app, "SELECT created_at, last_login_at FROM principals")[0]
    used_at = rows(app, "SELECT used_at FROM invites")[0]["used_at"]
    assert principal["last_login_at"] is not None
    assert principal["last_login_at"] == principal["created_at"] == used_at


def listed_accounts(client):
    rows_ = client.get("/api/admin/accounts", headers=CSRF).get_json()
    return {row["username"]: row for row in rows_}


def test_the_admin_account_list_never_shows_a_null_last_sign_in(app, clock):
    token = run_cli(app, "--kind", "administrator").stdout.strip().split("=")[-1]
    root, root_key = register(app, "root", kind="administrator", invite_token=token)
    for kind, username in (("vault_owner", "sarah"), ("administrator", "second")):
        invite = root.post("/api/admin/invites", json={"kind": kind}, headers=CSRF).get_json()
        _, key = register(app, username, kind=kind, invite_token=invite["token"])
        if username == "sarah":
            sarah_key = key

    listed = listed_accounts(root)
    assert set(listed) == {"root", "sarah", "second"}
    assert all(row["lastLoginAt"] == row["createdAt"] for row in listed.values())

    # A later sign-in moves that account's row and no other.
    clock(hours=1)
    sign_in(app, "sarah", sarah_key)
    after = listed_accounts(root)
    assert after["sarah"]["lastLoginAt"] > after["sarah"]["createdAt"]
    for username in ("root", "second"):
        assert after[username] == listed[username]


def test_a_backfilled_null_comes_back_as_created_at_through_the_admin_list(app):
    _, root_key = register(app, "root", kind="administrator")
    register(app, "sarah")
    set_last_login(app, "sarah", None)

    restarted = create_app({"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True})
    root, _ = sign_in(restarted, "root", root_key)
    sarah = listed_accounts(root)["sarah"]
    assert sarah["lastLoginAt"] == sarah["createdAt"]


# ---- Sign-in and unlock move it ----------------------------------------


@pytest.mark.parametrize("kind", ["vault_owner", "administrator"])
def test_a_sign_in_and_an_unlock_set_last_login_at_and_an_unlock_leaves_issued_at(
    app, clock, kind
):
    client, auth_key = register(app, "someone", kind=kind)
    issued_at = rows(app, "SELECT issued_at FROM sessions")[0]["issued_at"]

    signed_in = clock(hours=1)
    sign_in(app, "someone", auth_key)
    assert last_login(app, "someone") == signed_in

    unlocked = clock(hours=1)
    response = client.post(
        "/api/auth/login", json={"username": "someone", "authKey": auth_key}, headers=CSRF
    )
    assert response.status_code == 200
    assert last_login(app, "someone") == unlocked
    assert [r["issued_at"] for r in rows(app, "SELECT issued_at FROM sessions")][0] == issued_at


# ---- Refused attempts leave it -----------------------------------------


def test_a_wrong_auth_key_leaves_last_login_at(app, clock):
    _, auth_key = register(app, "owner")
    before = last_login(app, "owner")
    clock(hours=1)
    client = app.test_client()
    assert client.post(
        "/api/auth/login", json={"username": "owner", "authKey": b64()}, headers=CSRF
    ).status_code == 401
    assert last_login(app, "owner") == before


@pytest.mark.parametrize(
    "limits",
    [
        {"LOGIN_ATTEMPTS_PER_ACCOUNT": 2, "LOGIN_LOCKOUT_THRESHOLD": 10**9},
        {"LOGIN_ATTEMPTS_PER_ACCOUNT": 10**9, "LOGIN_LOCKOUT_THRESHOLD": 2},
    ],
    ids=["rate limited", "locked out"],
)
def test_a_rate_limited_or_locked_out_attempt_leaves_last_login_at(app, clock, limits):
    app.config.update(limits)
    _, auth_key = register(app, "owner")
    before = last_login(app, "owner")
    clock(hours=1)
    client = app.test_client()
    for _ in range(2):
        client.post("/api/auth/login", json={"username": "owner", "authKey": b64()}, headers=CSRF)

    # Refused even with the right Auth Key.
    assert client.post(
        "/api/auth/login", json={"username": "owner", "authKey": auth_key}, headers=CSRF
    ).status_code == 429
    assert last_login(app, "owner") == before


# ---- Start-up backfill -------------------------------------------------


def set_last_login(app, username, value):
    conn = connect(app)
    conn.execute("UPDATE principals SET last_login_at = ? WHERE username = ?", (value, username))
    conn.commit()
    conn.close()


def test_starting_the_app_fills_null_last_login_at_with_created_at_and_only_those(app):
    register(app, "nulled")
    register(app, "kept")
    set_last_login(app, "nulled", None)
    set_last_login(app, "kept", "2030-01-01T00:00:00+00:00")
    version = rows(app, "PRAGMA user_version")[0]["user_version"]

    def state():
        return rows(
            app, "SELECT username, created_at, last_login_at FROM principals ORDER BY username"
        )

    config = {"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True}
    create_app(config)
    after = {row["username"]: row for row in state()}
    assert after["nulled"]["last_login_at"] == after["nulled"]["created_at"]
    assert after["kept"]["last_login_at"] == "2030-01-01T00:00:00+00:00"
    assert rows(app, "PRAGMA user_version")[0]["user_version"] == version

    create_app(config)
    assert {row["username"]: row for row in state()} == after
