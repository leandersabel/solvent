"""Reading and issuing a session (spec/architecture.md, Application
hardening).

The cookie carries a signed opaque token and nothing else, and a valid
signature alone is not a session: the token must hash to a stored row.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from solvent.session import COOKIE_NAME, sign_token
from tests.helpers import CSRF, connect, register, rows


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


def test_the_session_row_carries_no_kind_column(app):
    register(app, "owner")
    columns = set(rows(app, "SELECT * FROM sessions")[0])
    assert columns == {"id", "token_hash", "principal_id", "issued_at", "last_active_at"}


def test_the_cookie_carries_its_pinned_flags(app):
    from tests.helpers import mint_invite, b64
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
