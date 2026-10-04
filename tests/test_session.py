"""Reading and issuing a session (spec/architecture.md, Application
hardening).

The cookie carries a signed opaque token and nothing else, and a valid
signature alone is not a session: the token must hash to a stored row.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from solvent.config import DEFAULT_KDF_ENVELOPE
from solvent.session import COOKIE_NAME, sign_token
from tests.helpers import CSRF, b64, connect, mint_invite, register, register_body, rows


def cookie_of(client):
    return next(c.value for c in client._cookies.values() if c.key == COOKIE_NAME)


def test_the_cookie_carries_no_key_material_and_no_principal_id(app):
    owner, _ = register(app, "owner")
    raw = cookie_of(owner)
    stored = rows(app, "SELECT * FROM sessions")[0]
    principal = rows(app, "SELECT * FROM principals")[0]

    assert principal["id"] not in raw
    assert stored["token_hash"] not in raw
    for column in ("wrapped_dek", "dek_nonce"):
        for wrapper in rows(app, "SELECT * FROM dek_wrappers"):
            assert wrapper[column] not in raw


def test_the_stored_token_is_a_hash_of_the_cookie_value(app):
    owner, _ = register(app, "owner")
    raw_token = cookie_of(owner).rsplit(".", 1)[0]
    stored = rows(app, "SELECT token_hash FROM sessions")[0]["token_hash"]
    assert raw_token not in stored


def test_absent_tampered_expired_and_unsigned_cookies_are_all_refused(app):
    owner, _ = register(app, "owner")
    valid = cookie_of(owner)
    # Edit the token, not the signature: itsdangerous base64url-decodes
    # the signature, and the last character of that encoding carries
    # unused padding bits, so changing it can decode to the same bytes.
    tampered = ("A" if valid[0] != "A" else "B") + valid[1:]

    with app.app_context():
        unknown = sign_token("a-token-no-row-holds")

    for case, cookie in (
        ("absent", None),
        ("tampered", tampered),
        ("unsigned", "not-even-signed"),
        ("unknown", unknown),
    ):
        client = app.test_client()
        if cookie is not None:
            client.set_cookie(COOKIE_NAME, cookie)
        response = client.get("/api/records?type=account", headers=CSRF)
        assert response.status_code == 401, case


def issued_long_ago_and_busy_since(app):
    """Issued past the absolute lifetime, and active a moment ago, so
    only the issue time can be what ends it."""
    now = datetime.now(timezone.utc)
    conn = connect(app)
    try:
        conn.execute(
            "UPDATE sessions SET issued_at = ?, last_active_at = ?",
            ((now - timedelta(hours=12, minutes=1)).isoformat(), now.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def test_a_session_past_the_absolute_lifetime_is_refused(app):
    owner, _ = register(app, "owner")
    assert owner.get("/api/records?type=account", headers=CSRF).status_code == 200
    issued_long_ago_and_busy_since(app)
    assert owner.get("/api/records?type=account", headers=CSRF).status_code == 401


def test_the_absolute_expiry_binds_an_administrator_the_same_way(app):
    admin, _ = register(app, "root", kind="administrator")
    assert admin.get("/api/admin/invites", headers=CSRF).status_code == 200
    issued_long_ago_and_busy_since(app)
    assert admin.get("/api/admin/invites", headers=CSRF).status_code == 401


def test_last_active_at_is_written_on_every_authenticated_request(app):
    owner, _ = register(app, "owner")
    before = rows(app, "SELECT last_active_at FROM sessions")[0]["last_active_at"]
    conn = connect(app)
    try:
        conn.execute("UPDATE sessions SET last_active_at = '2000-01-01T00:00:00+00:00'")
        conn.commit()
    finally:
        conn.close()
    owner.get("/api/records?type=account", headers=CSRF)
    after = rows(app, "SELECT last_active_at FROM sessions")[0]["last_active_at"]
    assert after != "2000-01-01T00:00:00+00:00"
    assert after >= before[:4]


def test_last_active_at_is_written_on_a_request_the_route_refuses(app):
    owner, _ = register(app, "owner")
    conn = connect(app)
    try:
        conn.execute("UPDATE sessions SET last_active_at = '2000-01-01T00:00:00+00:00'")
        conn.commit()
    finally:
        conn.close()
    refused = owner.post(
        "/api/auth/upgrade-kdf",
        json={"salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64()},
        headers=CSRF,
    )
    after = rows(app, "SELECT last_active_at FROM sessions")[0]["last_active_at"]
    assert refused.status_code == 400
    assert after != "2000-01-01T00:00:00+00:00"


def test_the_session_row_carries_no_kind_column(app):
    register(app, "owner")
    columns = set(rows(app, "SELECT * FROM sessions")[0])
    assert columns == {"id", "token_hash", "principal_id", "issued_at", "last_active_at"}


def test_the_cookie_carries_its_pinned_flags(app):
    import uuid

    client = app.test_client()
    response = client.post(
        "/api/register",
        json={
            "inviteToken": mint_invite(app),
            "username": "flags",
            "authKey": b64(),
            "salt": b64(16),
            "kdf": {"alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1},
            "wrappedDek": b64(48),
            "dekNonce": b64(12),
            "profileRecordId": str(uuid.uuid4()),
            "profileSchemaVersion": 1,
            "profileCiphertext": b64(64),
            "profileNonce": b64(12),
        },
        headers=CSRF,
    )
    header = response.headers["Set-Cookie"]
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "SameSite=Lax" in header


# The session a sign-in issues (spec/features/login.md).

LOGIN = "/api/auth/login"


def log_in(client, username, auth_key):
    return client.post(
        LOGIN, json={"username": username, "authKey": auth_key}, headers=CSRF
    )


def alive(cookie_holder_app, cookie) -> bool:
    client = cookie_holder_app.test_client()
    client.set_cookie(COOKIE_NAME, cookie)
    # Any well-formed epoch: a live session answers Conflict to it, and a
    # dead one answers Unauthorized, which is the difference asked for.
    headers = {**CSRF, "X-Solvent-Vault": "0" * 32}
    return client.get("/api/sessions", headers=headers).status_code != 401


def age_session(app, session_id, **ago):
    conn = connect(app)
    try:
        conn.execute(
            "UPDATE sessions SET issued_at = ? WHERE id = ?",
            ((datetime.now(timezone.utc) - timedelta(**ago)).isoformat(), session_id),
        )
        conn.commit()
    finally:
        conn.close()


def test_repeated_sign_ins_from_one_client_keep_one_row_and_a_failed_one_changes_nothing(app):
    client, auth_key = register(app, "owner")
    first = rows(app, "SELECT * FROM sessions")
    assert len(first) == 1
    replaced = [cookie_of(client)]

    assert log_in(client, "owner", auth_key).status_code == 200
    replaced.append(cookie_of(client))
    assert log_in(client, "owner", b64()).status_code == 401
    carried_into_failure = cookie_of(client)
    assert log_in(client, "owner", auth_key).status_code == 200

    after = rows(app, "SELECT * FROM sessions")
    assert len(after) == 1
    assert (after[0]["id"], after[0]["issued_at"]) == (first[0]["id"], first[0]["issued_at"])
    assert after[0]["token_hash"] != first[0]["token_hash"]
    assert len(set(replaced + [carried_into_failure, cookie_of(client)])) == 3
    for old in replaced:
        assert not alive(app, old)
    assert alive(app, cookie_of(client))


def test_a_failed_sign_in_leaves_the_carried_session_working(app):
    client, _ = register(app, "owner")
    carried = cookie_of(client)
    before = rows(app, "SELECT * FROM sessions")

    assert log_in(client, "owner", b64()).status_code == 401

    assert cookie_of(client) == carried
    assert rows(app, "SELECT id, token_hash, issued_at FROM sessions") == [
        {k: before[0][k] for k in ("id", "token_hash", "issued_at")}
    ]
    assert alive(app, carried)


def test_unlocking_does_not_move_issued_at_so_the_expiry_counts_from_sign_in(app):
    client, auth_key = register(app, "owner")
    session_id = rows(app, "SELECT id FROM sessions")[0]["id"]

    # Eleven hours after sign-in the owner unlocks.
    age_session(app, session_id, hours=11)
    signed_in_at = rows(app, "SELECT issued_at FROM sessions")[0]["issued_at"]
    assert log_in(client, "owner", auth_key).status_code == 200
    assert client.get("/api/sessions", headers=CSRF).status_code == 200
    assert rows(app, "SELECT issued_at FROM sessions")[0]["issued_at"] == signed_in_at

    # An hour on, the stored sign-in time is twelve hours old.
    age_session(app, session_id, hours=12, minutes=1)
    assert client.get("/api/sessions", headers=CSRF).status_code == 401


def test_a_sign_in_on_an_expired_row_deletes_it_and_creates_a_new_one(app):
    client, auth_key = register(app, "owner")
    expired = rows(app, "SELECT id FROM sessions")[0]["id"]
    age_session(app, expired, hours=12, minutes=1)

    assert log_in(client, "owner", auth_key).status_code == 200

    after = rows(app, "SELECT id FROM sessions")
    assert len(after) == 1 and after[0]["id"] != expired
    assert client.get("/api/sessions", headers=CSRF).status_code == 200


def test_a_sign_in_deletes_the_signing_in_accounts_expired_rows_and_only_those(app):
    _, auth_key = register(app, "owner")
    register(app, "other")
    # A second live row of the owner, then an expired row of each account.
    log_in_new(app, "owner", auth_key)
    ids = {
        row["id"]: row["principal_id"] for row in rows(app, "SELECT * FROM sessions")
    }
    assert len(ids) == 3
    owner_id = rows(app, "SELECT id FROM principals WHERE username = 'owner'")[0]["id"]
    owner_rows = [i for i, p in ids.items() if p == owner_id]
    other_row = next(i for i, p in ids.items() if p != owner_id)
    stale_owner = owner_rows[1]
    age_session(app, stale_owner, hours=13)
    age_session(app, other_row, hours=13)

    fresh = app.test_client()
    assert log_in(fresh, "owner", auth_key).status_code == 200

    left = {row["id"] for row in rows(app, "SELECT id FROM sessions")}
    assert stale_owner not in left
    assert other_row in left
    assert owner_rows[0] in left
    assert len(left) == 3


def log_in_new(app, username, auth_key):
    client = app.test_client()
    assert log_in(client, username, auth_key).status_code == 200
    return client


def test_a_sign_in_with_no_cookie_leaves_the_accounts_other_live_rows_alone(app):
    client, auth_key = register(app, "owner")
    before = rows(app, "SELECT * FROM sessions")

    log_in_new(app, "owner", auth_key)

    after = rows(app, "SELECT * FROM sessions")
    assert len(after) == 2
    assert before[0] in after
    assert alive(app, cookie_of(client))


def test_a_sign_in_over_another_accounts_live_session_replaces_that_row(app):
    owner, _ = register(app, "owner")
    _, other_key = register(app, "other")
    carried = cookie_of(owner)
    owner_row = rows(app, "SELECT * FROM sessions WHERE principal_id = ?", (principal(app, "owner"),))[0]

    assert log_in(owner, "other", other_key).status_code == 200

    sessions = rows(app, "SELECT * FROM sessions")
    assert owner_row["id"] not in {s["id"] for s in sessions}
    assert len([s for s in sessions if s["principal_id"] == principal(app, "other")]) == 2
    assert not alive(app, carried)
    assert alive(app, cookie_of(owner))


def principal(app, username):
    return rows(app, "SELECT id FROM principals WHERE username = ?", (username,))[0]["id"]


def test_the_session_list_leaves_off_an_expired_row_still_in_the_table(app):
    client, auth_key = register(app, "owner")
    stale = log_in_new(app, "owner", auth_key)
    live_id = rows(app, "SELECT id FROM sessions ORDER BY issued_at")[0]["id"]
    stale_id = next(r["id"] for r in rows(app, "SELECT id FROM sessions") if r["id"] != live_id)
    age_session(app, stale_id, hours=12, minutes=1)

    listed = client.get("/api/sessions", headers=CSRF).get_json()

    assert [entry["id"] for entry in listed] == [live_id]
    assert len(rows(app, "SELECT id FROM sessions")) == 2
    assert stale.get("/api/sessions", headers=CSRF).status_code == 401


def test_registration_replaces_another_accounts_live_session_and_a_failed_one_does_not(app):
    owner, _ = register(app, "owner")
    carried = cookie_of(owner)
    owner_row = rows(app, "SELECT id FROM sessions")[0]["id"]

    failed = owner.post(
        "/api/register", json=register_body(app, inviteToken="nope", username="new"), headers=CSRF
    )
    assert failed.status_code == 400
    assert cookie_of(owner) == carried and alive(app, carried)

    ok = owner.post(
        "/api/register", json=register_body(app, username="new"), headers=CSRF
    )
    assert ok.status_code == 200
    sessions = rows(app, "SELECT * FROM sessions")
    assert owner_row not in {s["id"] for s in sessions}
    assert [s["principal_id"] for s in sessions] == [principal(app, "new")]
    assert not alive(app, carried)
    assert alive(app, cookie_of(owner))
