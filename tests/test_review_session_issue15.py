"""Reviewer's tests for bug #15, written from login.md, The session a
sign-in issues, account-settings.md and register.md."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from solvent.session import COOKIE_NAME
from tests.helpers import CSRF, b64, connect, register, register_body, rows, session_status

LOGIN = "/api/auth/login"


def cookie(client):
    return client.get_cookie(COOKIE_NAME).value


def works(app, value):
    return session_status(app, value) == 200


def sql(app, statement, args=()):
    conn = connect(app)
    try:
        conn.execute(statement, args)
        conn.commit()
    finally:
        conn.close()


def age(app, session_id, **ago):
    sql(
        app,
        "UPDATE sessions SET issued_at = ? WHERE id = ?",
        ((datetime.now(timezone.utc) - timedelta(**ago)).isoformat(), session_id),
    )


def test_rate_limited_login_writes_no_row_and_keeps_carried_session(app):
    app.config["LOGIN_ATTEMPTS_PER_ACCOUNT"] = 1
    client, key = register(app, "owner")
    carried = cookie(client)
    before = rows(app, "SELECT id, token_hash, issued_at FROM sessions")
    assert client.post(LOGIN, json={"username": "owner", "authKey": b64()}, headers=CSRF).status_code == 401
    assert client.post(LOGIN, json={"username": "owner", "authKey": key}, headers=CSRF).status_code == 429
    assert rows(app, "SELECT id, token_hash, issued_at FROM sessions") == before
    assert works(app, carried)


def test_admin_unlock_does_not_slide_expiry(app):
    client, key = register(app, "root", kind="administrator")
    sid = rows(app, "SELECT id FROM sessions")[0]["id"]
    age(app, sid, hours=11)
    assert client.post(LOGIN, json={"username": "root", "authKey": key}, headers=CSRF).status_code == 200
    assert client.get("/api/admin/invites", headers=CSRF).status_code == 200
    age(app, sid, hours=12, minutes=1)
    assert client.get("/api/admin/invites", headers=CSRF).status_code == 401


def test_lock_unlock_leaves_session_list_identical(app):
    client, key = register(app, "owner")
    before = client.get("/api/sessions", headers=CSRF).get_json()
    for _ in range(3):
        assert client.post(LOGIN, json={"username": "owner", "authKey": key}, headers=CSRF).status_code == 200
    after = client.get("/api/sessions", headers=CSRF).get_json()
    strip = lambda l: [(e["id"], e["issuedAt"], e["current"], sorted(e)) for e in l]
    assert strip(after) == strip(before)


def test_failed_registration_partway_keeps_carried_session(app):
    owner, _ = register(app, "owner")
    carried = cookie(owner)
    # Username taken: fails inside the transaction, after the invite check.
    resp = owner.post("/api/register", json=register_body(app, username="owner"), headers=CSRF)
    assert resp.status_code == 409
    assert works(app, carried)
    assert len(rows(app, "SELECT id FROM sessions")) == 1


def test_carried_row_gone_by_the_time_login_writes_still_yields_a_working_session(app, monkeypatch):
    """The carried row is resolved at the gate and acted on after the
    Argon2id verification. If logout-all from another device deletes it
    in between, the request carries "a token matching no row" and the
    contract says a new row is created."""
    client, key = register(app, "owner")
    sid = rows(app, "SELECT id FROM sessions")[0]["id"]

    import solvent.crypto as crypto

    real = crypto.verify_auth_key

    def verify_then_logout_all_elsewhere(verifier, auth_key):
        ok = real(verifier, auth_key)
        sql(app, "DELETE FROM sessions WHERE id = ?", (sid,))
        return ok

    monkeypatch.setattr(crypto, "verify_auth_key", verify_then_logout_all_elsewhere)
    resp = client.post(LOGIN, json={"username": "owner", "authKey": key}, headers=CSRF)
    monkeypatch.setattr(crypto, "verify_auth_key", real)

    assert resp.status_code == 200
    assert works(app, cookie(client)), "sign-in answered 200 but its cookie matches no row"
