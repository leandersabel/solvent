"""The sign-in limits and what the `attempts` table holds
(spec/architecture.md, Rate limiting; spec/features/login.md,
Acceptance criteria; spec/features/app-shell.md, Database).

Every limit is set through config and asserted at the configured value,
never at a count. The clock is stopped and moved by the test, so a lock
that ends "on time" is measured to the second.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import threading
from datetime import timedelta
from pathlib import Path

import pytest
from werkzeug.middleware.proxy_fix import ProxyFix

from solvent import db, ratelimit
from solvent.config import DEFAULT_KDF_ENVELOPE
from solvent.crypto import hkdf_sha256
from solvent.validation import normalize_username
from tests.helpers import CSRF, b64, connect, register, rows

LOGIN = "/api/auth/login"
SALT = "/api/auth/salt"
OUT_OF_REACH = 10**9
USERNAME_LIMITS_OUT_OF_REACH = {
    "LOGIN_ATTEMPTS_PER_ACCOUNT": OUT_OF_REACH,
    "LOGIN_LOCKOUT_THRESHOLD": OUT_OF_REACH,
}
ADDRESS_LIMIT_OUT_OF_REACH = {"LOGIN_FAILURES_PER_ADDRESS": OUT_OF_REACH}


def post(client, endpoint, username, key=None, address=None, headers=None):
    body = {"username": username}
    if endpoint == LOGIN:
        body["authKey"] = key or b64()
    return client.post(
        endpoint,
        json=body,
        headers={**CSRF, **(headers or {})},
        environ_overrides={"REMOTE_ADDR": address} if address else {},
    )


def answers(response):
    return (
        response.status_code,
        response.get_data(),
        sorted((k, v) for k, v in response.headers if k != "Date"),
    )


def attempts(app):
    return rows(app, "SELECT rowid, bucket, outcome, at FROM attempts ORDER BY rowid")


def expected_key(secret, canonical):
    """The address key as architecture.md, Rate limiting, derives it,
    written out here rather than imported."""
    prk = hmac.new(bytes(32), secret.encode("utf-8"), hashlib.sha256).digest()
    subkey = hmac.new(prk, b"solvent attempts address v1\x01", hashlib.sha256).digest()
    return hmac.new(subkey, canonical.encode("ascii"), hashlib.sha256).digest()[:16].hex()


def make_app(tmp_path, monkeypatch, **env):
    monkeypatch.setenv("SECRET_KEY", "test-only-secret-key-do-not-use-in-prod")
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    from solvent import create_app

    return create_app(
        config_overrides={"DATABASE_PATH": str(tmp_path / "other.db"), "TESTING": True}
    )


# ---- The reported bug -------------------------------------------------


def test_an_administrator_signs_in_when_the_lock_ends_despite_retries_during_it(app, clock):
    """A lock ran from its last refused retry, so a client that kept
    trying was locked out for good, and a refused request left its
    address in the table."""
    app.config.update(USERNAME_LIMITS_OUT_OF_REACH, LOGIN_FAILURES_PER_ADDRESS=3)
    _, admin_key = register(app, "root", kind="administrator")
    client = app.test_client()
    for n in range(3):
        assert post(client, LOGIN, f"nobody{n}").status_code == 401
    tripped = clock.now
    before = attempts(app)

    lock_minutes = app.config["LOGIN_ADDRESS_LOCK_MINUTES"]
    for _ in range(lock_minutes - 1):
        clock.advance(60)
        assert post(client, SALT, "root").status_code == 429
        assert post(client, LOGIN, "root").status_code == 429
        assert post(client, LOGIN, "root", admin_key).status_code == 429
    assert attempts(app) == before

    clock.advance((tripped - clock.now).total_seconds() + lock_minutes * 60 + 1)
    assert post(client, LOGIN, "root", admin_key).status_code == 200


# ---- Per username -----------------------------------------------------


def test_a_username_lock_ends_on_time_despite_retries(app, clock):
    app.config.update(
        ADDRESS_LIMIT_OUT_OF_REACH,
        LOGIN_ATTEMPTS_PER_ACCOUNT=OUT_OF_REACH,
        LOGIN_LOCKOUT_THRESHOLD=3,
    )
    _, admin_key = register(app, "root", kind="administrator")
    client = app.test_client()
    for _ in range(3):
        assert post(client, LOGIN, "root").status_code == 401
    tripped = clock.now
    before = attempts(app)

    lock_minutes = app.config["LOGIN_LOCKOUT_MINUTES"]
    for _ in range(lock_minutes - 1):
        clock.advance(60)
        assert post(client, SALT, "root").status_code == 429
        assert post(client, LOGIN, "root", admin_key).status_code == 429
    assert attempts(app) == before

    clock.advance((tripped - clock.now).total_seconds() + lock_minutes * 60 + 1)
    assert post(client, LOGIN, "root", admin_key).status_code == 200


def test_a_failure_while_the_window_still_holds_the_threshold_trips_a_fresh_lock(app, clock, caplog):
    app.config.update(
        ADDRESS_LIMIT_OUT_OF_REACH,
        LOGIN_ATTEMPTS_PER_ACCOUNT=OUT_OF_REACH,
        LOGIN_LOCKOUT_THRESHOLD=2,
        LOGIN_LOCKOUT_WINDOW_MINUTES=60,
        LOGIN_LOCKOUT_MINUTES=5,
    )
    client = app.test_client()
    for _ in range(2):
        post(client, LOGIN, "someone")
    clock.advance(5 * 60 + 1)
    assert post(client, SALT, "someone").status_code == 200
    caplog.clear()
    with caplog.at_level("WARNING"):
        assert post(client, LOGIN, "someone").status_code == 401
    assert post(client, SALT, "someone").status_code == 429
    assert len([r for r in caplog.records if r.getMessage().startswith("auth.lockout ")]) == 1


@pytest.mark.parametrize(
    "limits",
    [
        {"LOGIN_ATTEMPTS_PER_ACCOUNT": 3, "LOGIN_LOCKOUT_THRESHOLD": OUT_OF_REACH},
        {"LOGIN_ATTEMPTS_PER_ACCOUNT": OUT_OF_REACH, "LOGIN_LOCKOUT_THRESHOLD": 3},
        {**ADDRESS_LIMIT_OUT_OF_REACH, "LOGIN_FAILURES_PER_ADDRESS": 3},
    ],
    ids=["throttle", "username lock", "address lock"],
)
def test_every_refusal_is_byte_identical_to_the_one_for_a_username_nobody_has(app, limits):
    app.config.update({**USERNAME_LIMITS_OUT_OF_REACH, **ADDRESS_LIMIT_OUT_OF_REACH, **limits})
    _, owner_key = register(app, "owner")
    _, admin_key = register(app, "root", kind="administrator")
    client = app.test_client()
    for username in ("owner", "root", "ghost"):
        for _ in range(3):
            post(client, LOGIN, username)

    for endpoint in (LOGIN, SALT):
        refusals = {
            username: answers(post(client, endpoint, username, key))
            for username, key in (("owner", owner_key), ("root", admin_key), ("ghost", None))
        }
        assert {a[0] for a in refusals.values()} == {429}
        assert len({repr(a) for a in refusals.values()}) == 1


def test_a_username_lock_runs_its_full_length_on_the_schedule_that_ages_failures_out(app, clock):
    """10 failures at 0:00, 9 at 15:01 and the 20th at 59:00: a lock
    derived from the failures in its window would lift at 60:01, when
    the first ten age out."""
    app.config.update(ADDRESS_LIMIT_OUT_OF_REACH)
    _, owner_key = register(app, "owner")
    client = app.test_client()
    start = clock.now

    def at(minutes, seconds=0):
        clock.now = start + timedelta(minutes=minutes, seconds=seconds)

    for _ in range(10):
        assert post(client, LOGIN, "owner").status_code == 401
    at(15, 1)
    for _ in range(9):
        assert post(client, LOGIN, "owner").status_code == 401
    at(59)
    assert post(client, LOGIN, "owner").status_code == 401  # the 20th trips the lock
    at(60, 1)
    assert post(client, LOGIN, "owner", owner_key).status_code == 429
    at(74)
    assert post(client, LOGIN, "owner", owner_key).status_code == 429
    assert post(client, SALT, "owner").status_code == 429
    at(74, 1)
    assert post(client, LOGIN, "owner", owner_key).status_code == 200


def test_a_failure_writes_a_lock_row_only_when_it_trips_the_lock(app):
    app.config.update(LOGIN_ATTEMPTS_PER_ACCOUNT=OUT_OF_REACH, LOGIN_LOCKOUT_THRESHOLD=3, LOGIN_FAILURES_PER_ADDRESS=4)
    client = app.test_client()
    locks = lambda: sorted(r["bucket"].split(":")[0] for r in attempts(app) if "lock" in r["bucket"])

    for name in ("a", "a"):
        post(client, LOGIN, name)
        assert locks() == []
    post(client, LOGIN, "a")  # the third failure for "a" trips the username lock
    assert locks() == ["login-lock"]
    for _ in range(3):  # refused, so nothing is written
        post(client, LOGIN, "a")
        post(client, SALT, "a")
    assert locks() == ["login-lock"]
    post(client, LOGIN, "b")  # the fourth failure from the address trips its lock
    assert locks() == ["address-lock", "login-lock"]


def test_a_success_deletes_the_username_lock_row_and_leaves_the_address_rows(app, clock):
    app.config.update(LOGIN_ATTEMPTS_PER_ACCOUNT=OUT_OF_REACH, LOGIN_LOCKOUT_THRESHOLD=2, LOGIN_FAILURES_PER_ADDRESS=2)
    _, owner_key = register(app, "owner")
    client = app.test_client()
    for _ in range(2):
        post(client, LOGIN, "owner")
    buckets = sorted(r["bucket"].split(":")[0] for r in attempts(app))
    assert "login-lock" in buckets and "address-lock" in buckets

    clock.advance(app.config["LOGIN_ADDRESS_LOCK_MINUTES"] * 60 + 1)
    assert post(client, LOGIN, "owner", owner_key).status_code == 200
    remaining = {r["bucket"].split(":")[0] for r in attempts(app)}
    assert remaining == {"address", "address-lock"}


# ---- Per address ------------------------------------------------------


def test_an_address_lock_refuses_every_username_and_spares_other_addresses(app):
    app.config.update(USERNAME_LIMITS_OUT_OF_REACH, LOGIN_FAILURES_PER_ADDRESS=4)
    _, owner_key = register(app, "owner")
    _, admin_key = register(app, "root", kind="administrator")
    client = app.test_client()
    for n in range(4):
        assert post(client, LOGIN, f"nobody{n}").status_code == 401

    for endpoint in (SALT, LOGIN):
        refused = [
            answers(post(client, endpoint, username, key))
            for username, key in (("root", admin_key), ("owner", owner_key), ("ghost", b64()))
        ]
        assert {a[0] for a in refused} == {429}
        assert len({repr(a) for a in refused}) == 1

    elsewhere = app.test_client()
    assert post(elsewhere, LOGIN, "root", admin_key, address="203.0.113.99").status_code == 200


def test_salt_fetches_and_successes_never_count_towards_the_address(app):
    app.config.update(USERNAME_LIMITS_OUT_OF_REACH, LOGIN_FAILURES_PER_ADDRESS=2)
    _, owner_key = register(app, "owner")
    client = app.test_client()
    for _ in range(5):
        assert post(client, SALT, "owner").status_code == 200
        assert post(client, LOGIN, "owner", owner_key).status_code == 200
    assert attempts(app) == []


# ---- Forms that check the password ------------------------------------


def change_password(client, auth_key, kind):
    body = {"currentAuthKey": auth_key, "salt": b64(16), "kdf": dict(DEFAULT_KDF_ENVELOPE), "authKey": b64()}
    if kind == "vault_owner":
        body.update(wrappedDek=b64(48), dekNonce=b64(12))
    return client.post("/api/auth/change-password", json=body, headers=CSRF)


def delete_account(client, auth_key, kind):
    return client.delete(
        "/api/auth/account", json={"authKey": auth_key, "confirmUsername": "someone"}, headers=CSRF
    )


@pytest.mark.parametrize(
    "form, kind",
    [
        (change_password, "vault_owner"),
        (change_password, "administrator"),
        (delete_account, "vault_owner"),
    ],
    ids=["change password", "change password, administrator", "delete my vault"],
)
def test_a_wrong_password_on_a_settings_form_is_a_failed_sign_in(app, form, kind):
    """A stolen session could guess the password there without limit."""
    app.config.update(ADDRESS_LIMIT_OUT_OF_REACH, LOGIN_ATTEMPTS_PER_ACCOUNT=OUT_OF_REACH, LOGIN_LOCKOUT_THRESHOLD=3)
    session, auth_key = register(app, "someone", kind=kind)
    key = expected_key(app.config["SECRET_KEY"], "127.0.0.1")
    for _ in range(3):
        assert form(session, b64(), kind).status_code == 400
    assert sorted(r["bucket"] for r in attempts(app)) == sorted(
        [f"address:{key}"] * 3 + ["login:someone"] * 3 + ["login-lock:someone"]
    )
    before = attempts(app)

    assert form(session, auth_key, kind).status_code == 429
    assert post(app.test_client(), LOGIN, "someone", auth_key).status_code == 429
    assert attempts(app) == before


# ---- What is written --------------------------------------------------


def test_a_failure_writes_one_row_per_bucket_and_a_success_clears_only_the_username(app):
    app.config.update({**USERNAME_LIMITS_OUT_OF_REACH, **ADDRESS_LIMIT_OUT_OF_REACH})
    _, owner_key = register(app, "owner")
    client = app.test_client()
    key = expected_key(app.config["SECRET_KEY"], "127.0.0.1")

    post(client, LOGIN, "owner")
    post(client, LOGIN, "ghost")
    seen = [(r["bucket"], r["outcome"]) for r in attempts(app)]
    assert sorted(seen) == sorted(
        [
            ("login:owner", "failure"),
            ("login:ghost", "failure"),
            (f"address:{key}", "failure"),
            (f"address:{key}", "failure"),
        ]
    )

    assert post(client, LOGIN, "owner", owner_key).status_code == 200
    assert sorted(r["bucket"] for r in attempts(app)) == sorted(
        ["login:ghost", f"address:{key}", f"address:{key}"]
    )


def test_a_request_that_is_not_a_failure_or_is_refused_leaves_the_table_as_it_was(app):
    app.config.update(VERIFY_CONCURRENCY=1, VERIFY_WAIT_SECONDS=0.1, LOGIN_ATTEMPTS_PER_ACCOUNT=2)
    _, owner_key = register(app, "owner")
    client = app.test_client()
    post(client, LOGIN, "owner")
    post(client, LOGIN, "owner")
    before = attempts(app)

    # Refused by the throttle, on both endpoints.
    assert post(client, LOGIN, "owner", owner_key).status_code == 429
    assert post(client, SALT, "owner").status_code == 429
    # A salt fetch that answers OK, and Bad Requests.
    assert post(client, SALT, "other").status_code == 200
    assert client.post(LOGIN, json={"username": "other"}, headers=CSRF).status_code == 400
    assert client.post(SALT, json={}, headers=CSRF).status_code == 400
    assert attempts(app) == before

    # A sign-in the concurrency cap turned away: no verification ran, so
    # nothing failed.
    from solvent.crypto import _slot

    with app.test_request_context():
        with _slot():
            pass
    gate = app.extensions["solvent.verify_gate"]
    assert gate.acquire(timeout=1)
    try:
        assert post(client, LOGIN, "other").status_code == 429
    finally:
        gate.release()
    assert attempts(app) == before


def test_a_vault_owner_whose_credential_verifies_with_no_wrapper_is_no_failure(app):
    _, owner_key = register(app, "owner")
    conn = connect(app)
    try:
        conn.execute("DELETE FROM dek_wrappers")
        conn.commit()
    finally:
        conn.close()
    assert post(app.test_client(), LOGIN, "owner", owner_key).status_code == 401
    assert attempts(app) == []


# ---- No address is kept -----------------------------------------------


def test_the_address_key_is_keyed_canonical_and_follows_the_secret(app):
    app.config.update({**USERNAME_LIMITS_OUT_OF_REACH, **ADDRESS_LIMIT_OUT_OF_REACH})
    client = app.test_client()
    secret = app.config["SECRET_KEY"]

    def key_after(address):
        db_rows = attempts(app)
        post(client, LOGIN, "someone", address=address)
        new = [r for r in attempts(app) if r["rowid"] not in {o["rowid"] for o in db_rows}]
        (key,) = {r["bucket"] for r in new if r["bucket"].startswith("address:")}
        return key.removeprefix("address:")

    first = key_after("2001:db8:1:2::5")
    assert first == expected_key(secret, "2001:db8:1:2::/64")
    assert key_after("2001:db8:1:2::6") == first
    assert key_after("2001:db8:1:3::5") == expected_key(secret, "2001:db8:1:3::/64") != first
    assert key_after("203.0.113.7") == expected_key(secret, "203.0.113.7")
    assert key_after("::ffff:203.0.113.7") == expected_key(secret, "203.0.113.7")
    assert key_after("not an address") == key_after("999.1.1.1") == expected_key(secret, "invalid")

    app.config["SECRET_KEY"] = "another-secret"
    assert key_after("203.0.113.7") == expected_key("another-secret", "203.0.113.7")
    assert expected_key("another-secret", "203.0.113.7") != expected_key(secret, "203.0.113.7")


def test_hkdf_returns_rfc_5869_test_case_1():
    okm = hkdf_sha256(
        ikm=bytes.fromhex("0b" * 22),
        salt=bytes(range(13)),
        info=bytes.fromhex("f0f1f2f3f4f5f6f7f8f9"),
        length=42,
    )
    assert okm.hex() == (
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
        "34007208d5b887185865"
    )


def test_no_plaintext_address_is_kept_in_a_table_the_file_or_a_log(app, clock, caplog):
    app.config.update(USERNAME_LIMITS_OUT_OF_REACH, LOGIN_FAILURES_PER_ADDRESS=2)
    forms = ("203.0.113.7", "2001:db8:1:2::5", "2001:db8:1:2::/64", "2001:db8:1:2::")
    client = app.test_client()

    def scan():
        conn = connect(app)
        try:
            tables = [
                r[0]
                for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            ]
            text = " ".join(
                str(value)
                for table in tables
                for row in conn.execute(f"SELECT * FROM {table}").fetchall()
                for value in tuple(row)
            )
        finally:
            conn.close()
        raw = Path(app.config["DATABASE_PATH"]).read_bytes()
        for form in forms:
            assert form not in text, form
            assert form.encode() not in raw, form
            assert form not in caplog.text, form

    with caplog.at_level("DEBUG"):
        for address in ("203.0.113.7", "2001:db8:1:2::5"):
            for n in range(3):
                post(client, LOGIN, f"nobody{n}", address=address)
        assert attempts(app)
        scan()

        # Deleting the rows must overwrite them, not leave them in a free page.
        clock.advance(24 * 3600)
        conn = db.connect(app.config["DATABASE_PATH"], isolation_level=None)
        try:
            ratelimit.prune(conn, app.config, db.now())
        finally:
            conn.close()
        assert attempts(app) == []
        scan()


# ---- Where the client address comes from -------------------------------


def test_without_trusted_proxies_a_forwarded_header_changes_nothing_and_is_logged_once(
    tmp_path, monkeypatch, caplog
):
    app = make_app(tmp_path, monkeypatch)
    app.config.update(USERNAME_LIMITS_OUT_OF_REACH, LOGIN_FAILURES_PER_ADDRESS=3)
    assert not isinstance(app.wsgi_app, ProxyFix)
    client = app.test_client()
    with caplog.at_level("WARNING"):
        post(client, SALT, "someone")
        for n in range(3):
            response = post(client, LOGIN, "someone", headers={"X-Forwarded-For": f"198.51.100.{n}"})
            assert response.status_code == 401
        assert post(client, LOGIN, "someone", headers={"X-Forwarded-For": "198.51.100.9"}).status_code == 429
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("config.proxy_header_ignored")]
    assert len(lines) == 1
    assert "TRUSTED_PROXY_HOPS" in lines[0]
    assert "198.51.100" not in caplog.text


def test_with_one_trusted_proxy_the_last_forwarded_entry_is_the_client(tmp_path, monkeypatch, caplog):
    app = make_app(tmp_path, monkeypatch, TRUSTED_PROXY_HOPS="1")
    app.config.update(USERNAME_LIMITS_OUT_OF_REACH, LOGIN_FAILURES_PER_ADDRESS=2)
    client = app.test_client()

    def fail(forwarded):
        return post(client, LOGIN, "someone", address="10.0.0.1", headers={"X-Forwarded-For": forwarded}).status_code

    with caplog.at_level("WARNING"):
        assert fail("198.51.100.1") == 401
        assert fail("198.51.100.2") == 401  # counted apart from the first
        assert fail("6.6.6.6, 198.51.100.3") == 401
        assert fail("7.7.7.7, 198.51.100.3") == 401  # same client behind the proxy
        assert fail("8.8.8.8, 198.51.100.3") == 429
        assert fail("198.51.100.2") == 401  # a third client is untouched
    assert "config.proxy_header_ignored" not in caplog.text


def test_trusted_proxy_hops_wraps_only_the_client_address(tmp_path, monkeypatch):
    app = make_app(tmp_path, monkeypatch, TRUSTED_PROXY_HOPS="2")
    wrapped = app.wsgi_app
    assert isinstance(wrapped, ProxyFix)
    assert (wrapped.x_for, wrapped.x_proto, wrapped.x_host, wrapped.x_port, wrapped.x_prefix) == (2, 0, 0, 0, 0)


# ---- The alert --------------------------------------------------------


def test_a_lock_logs_one_line_when_it_trips_and_the_requests_it_refuses_none(app, caplog):
    app.config.update(
        ADDRESS_LIMIT_OUT_OF_REACH, LOGIN_ATTEMPTS_PER_ACCOUNT=OUT_OF_REACH, LOGIN_LOCKOUT_THRESHOLD=3
    )
    name = 'bad\nname"x'
    client = app.test_client()
    with caplog.at_level("WARNING"):
        for _ in range(3):
            post(client, LOGIN, name)
        for _ in range(3):
            post(client, SALT, name)
            post(client, LOGIN, name)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("auth.lockout")]
    shown = normalize_username(name) or name.strip().lower()
    assert lines == [f"auth.lockout scope=username username={json.dumps(shown)} lock_minutes=15"]


def test_an_address_lock_logs_one_line_with_no_address(app, caplog):
    app.config.update(USERNAME_LIMITS_OUT_OF_REACH, LOGIN_FAILURES_PER_ADDRESS=3)
    client = app.test_client()
    with caplog.at_level("WARNING"):
        for n in range(3):
            post(client, LOGIN, f"nobody{n}", address="203.0.113.7")
        for n in range(3):
            post(client, LOGIN, f"nobody{n}", address="203.0.113.7")
            post(client, SALT, f"nobody{n}", address="203.0.113.7")
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("auth.lockout")]
    assert lines == ["auth.lockout scope=address lock_minutes=15"]
    assert "203.0.113.7" not in caplog.text


# ---- Keeping the table short ------------------------------------------


def _insert(app, bucket, at, outcome="failure"):
    conn = connect(app)
    try:
        conn.execute("INSERT INTO attempts (bucket, outcome, at) VALUES (?, ?, ?)", (bucket, outcome, at))
        conn.commit()
    finally:
        conn.close()


def test_each_bucket_is_kept_for_its_own_longest_window_to_the_second(app, clock):
    app.config.update(
        LOGIN_ACCOUNT_WINDOW_MINUTES=7,
        LOGIN_LOCKOUT_WINDOW_MINUTES=11,
        LOGIN_LOCKOUT_MINUTES=13,
        LOGIN_ADDRESS_WINDOW_MINUTES=17,
        LOGIN_ADDRESS_LOCK_MINUTES=19,
    )
    path = app.config["DATABASE_PATH"]
    retention = {
        "login:someone": ("failure", 11),
        "login-lock:someone": ("failure", 13),
        "address:abc": ("failure", 17),
        "address-lock:abc": ("failure", 19),
        "rates:someone": ("request", 60),
        "export:someone": ("request", 60),
    }
    stamped = db.utcnow()
    for bucket, (outcome, minutes) in retention.items():
        _insert(app, bucket, stamped, outcome)
        conn = db.connect(path, isolation_level=None)
        try:
            at = db.now()
            ratelimit.prune(conn, app.config, at + timedelta(minutes=minutes))
            assert [r["bucket"] for r in attempts(app)] == [bucket], bucket
            ratelimit.prune(conn, app.config, at + timedelta(minutes=minutes, seconds=1))
            assert attempts(app) == [], bucket
        finally:
            conn.close()


def test_starting_the_app_deletes_ip_rows_and_expired_rows_and_overwrites_them(app, clock):
    path = app.config["DATABASE_PATH"]
    old, fresh = "2000-01-01T00:00:00+00:00", db.utcnow()
    buckets = ("login:a", "login-lock:a", "address:a", "address-lock:a", "rates:a", "export:a")
    _insert(app, "ip:198.51.100.77", fresh, "request")
    for bucket in buckets:
        outcome = "request" if bucket.startswith(("rates", "export")) else "failure"
        _insert(app, bucket, old, outcome)
        _insert(app, bucket, fresh, outcome)
    assert b"198.51.100.77" in Path(path).read_bytes()

    from solvent import create_app

    create_app(config_overrides={"DATABASE_PATH": path, "TESTING": True})

    assert sorted((r["bucket"], r["at"]) for r in attempts(app)) == sorted((b, fresh) for b in buckets)
    assert b"198.51.100.77" not in Path(path).read_bytes()


def test_the_factory_starts_one_daemon_pruner_and_a_failed_pass_only_logs(
    tmp_path, monkeypatch, caplog
):
    before = {t for t in threading.enumerate() if t.name == "attempts-pruner"}
    app = make_app(tmp_path, monkeypatch)
    started = {t for t in threading.enumerate() if t.name == "attempts-pruner"} - before
    assert len(started) == 1
    assert next(iter(started)).daemon

    path = Path(app.config["DATABASE_PATH"])
    path.unlink()
    with caplog.at_level("WARNING"):
        ratelimit.prune_pass(app)
    assert [r.getMessage() for r in caplog.records if "prune_failed" in r.getMessage()] == [
        "attempts.prune_failed OperationalError"
    ]
    assert not path.exists()


def test_the_pruner_of_an_app_a_test_builds_runs_no_pass(tmp_path, monkeypatch):
    """A pass from a test's thread would outlive the test and log into
    whichever test runs when its database is gone."""
    passes = []
    monkeypatch.setattr(ratelimit, "PRUNE_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(ratelimit, "prune_pass", passes.append)
    make_app(tmp_path, monkeypatch)
    threading.Event().wait(0.2)
    assert passes == []


def test_a_pass_deletes_what_has_expired(app, clock):
    _insert(app, "address:a", db.utcnow())
    clock.advance(24 * 3600)
    ratelimit.prune_pass(app)
    assert attempts(app) == []


def test_every_connection_the_app_opens_sets_secure_delete(tmp_path, monkeypatch):
    opened = []
    real = db.connect

    def watch(*args, **kwargs):
        conn = real(*args, **kwargs)
        opened.append(conn.execute("PRAGMA secure_delete").fetchone()[0])
        return conn

    monkeypatch.setattr(db, "connect", watch)
    monkeypatch.setenv("SECRET_KEY", "k")
    from solvent import create_app

    other = create_app(config_overrides={"DATABASE_PATH": str(tmp_path / "x.db"), "TESTING": True})
    other.test_client().post(SALT, json={"username": "a"}, headers=CSRF)
    ratelimit.prune_pass(other)
    assert len(opened) >= 3
    assert set(opened) == {1}
