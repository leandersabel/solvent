"""Throttling for the endpoints an attacker can script
(spec/architecture.md, Rate limiting).

The expensive Argon2id derivation runs client-side, so an attacker
hitting the API directly pays nothing per guess: this is the only thing
standing between them and unlimited ones. Every limit here is operator
config with the default the spec names, and the tests assert the
behaviour at whatever the configured value is rather than a count.

A refused request writes no row, in any limiter here. A lock therefore
runs from the failure that tripped it, and retrying during one never
lengthens it.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import threading
import time
from datetime import timedelta
from urllib.parse import quote

from flask import abort, current_app, request

from . import db
from .crypto import hkdf_sha256
from .db import get_db, utcnow, write_transaction

#: Seconds between a serving process's passes over the table.
PRUNE_INTERVAL_SECONDS = 60


def _since(minutes: int) -> str:
    return (db.now() - timedelta(minutes=minutes)).isoformat(timespec="seconds")


def record(bucket: str, outcome: str = "request") -> None:
    get_db().execute(
        "INSERT INTO attempts (bucket, outcome, at) VALUES (?, ?, ?)",
        (bucket, outcome, utcnow()),
    )


def _count(bucket: str, outcome: str, minutes: int) -> int:
    return get_db().execute(
        "SELECT COUNT(*) FROM attempts "
        "WHERE bucket = ? AND outcome = ? AND at >= ?",
        (bucket, outcome, _since(minutes)),
    ).fetchone()[0]


def canonical_address(raw: "str | None") -> str:
    """One key per subscriber: a whole /64 is one holder's, so guessing
    from a fresh IPv6 address each time buys nothing."""
    try:
        address = ipaddress.ip_address(raw or "")
    except ValueError:
        return "invalid"
    if address.version == 4:
        return str(address)
    if address.ipv4_mapped:
        return str(address.ipv4_mapped)
    return str(ipaddress.IPv6Network((int(address), 64), strict=False))


def address_key() -> str:
    """The client address as it is kept: keyed, because an unkeyed hash
    of a 32-bit space reverses in seconds, and under a subkey so this
    use stays apart from the decoy salt's HMAC under the same secret."""
    subkey = hkdf_sha256(
        ikm=current_app.config["SECRET_KEY"].encode("utf-8"),
        salt=bytes(32),
        info=b"solvent attempts address v1",
        length=32,
    )
    canonical = canonical_address(request.remote_addr).encode("ascii")
    return hmac.new(subkey, canonical, hashlib.sha256).digest()[:16].hex()


def guard_auth(username: str) -> None:
    """The per-username and per-address limits on every endpoint that
    checks a password, checked before it does any work.

    A lockout response is the same shape whether or not the account
    exists, which is what keeps the limiter from becoming the
    enumeration oracle the decoy salt closes. Nothing is written here.
    """
    config = current_app.config
    account = f"login:{username}"
    address = address_key()
    if (
        _count(f"address-lock:{address}", "failure", config["LOGIN_ADDRESS_LOCK_MINUTES"]) > 0
        or _count(f"login-lock:{username}", "failure", config["LOGIN_LOCKOUT_MINUTES"]) > 0
        or _count(account, "failure", config["LOGIN_ACCOUNT_WINDOW_MINUTES"])
        >= config["LOGIN_ATTEMPTS_PER_ACCOUNT"]
    ):
        abort(429)


def record_auth_failure(username: str) -> None:
    """One row against the username and one against the address, and a
    lock row for each lock this failure trips, all in one transaction.
    A lock is its row, so it runs its full length from the failure that
    tripped it however the earlier failures age. It logs once, here,
    when it trips."""
    config = current_app.config
    account = f"login:{username}"
    key = address_key()
    with write_transaction():
        record(account, "failure")
        record(f"address:{key}", "failure")
        address_locked = (
            _count(f"address:{key}", "failure", config["LOGIN_ADDRESS_WINDOW_MINUTES"])
            >= config["LOGIN_FAILURES_PER_ADDRESS"]
        )
        if address_locked:
            record(f"address-lock:{key}", "failure")
        username_locked = (
            _count(account, "failure", config["LOGIN_LOCKOUT_WINDOW_MINUTES"])
            >= config["LOGIN_LOCKOUT_THRESHOLD"]
        )
        if username_locked:
            record(f"login-lock:{username}", "failure")
    if username_locked:
        current_app.logger.warning(
            "auth.lockout scope=username username=%s lock_minutes=%s",
            json.dumps(username),
            config["LOGIN_LOCKOUT_MINUTES"],
        )
    if address_locked:
        current_app.logger.warning(
            "auth.lockout scope=address lock_minutes=%s",
            config["LOGIN_ADDRESS_LOCK_MINUTES"],
        )


def clear_auth_failures(username: str) -> None:
    """The username's failures and lock only: one valid account must not
    reset its address's budget between guesses."""
    get_db().execute(
        "DELETE FROM attempts WHERE bucket IN (?, ?)",
        (f"login:{username}", f"login-lock:{username}"),
    )


def _admit_hourly(bucket: str, limit: int) -> None:
    """Count the hour and record one request, inside the caller's write
    transaction."""
    if _count(bucket, "request", 60) >= limit:
        abort(429)
    record(bucket)


def _guard_hourly(bucket: str, limit: int) -> None:
    with write_transaction():
        _admit_hourly(bucket, limit)


def guard_rates(principal_id: str) -> None:
    """Per-user, independent of the login limiter: a compromised
    session must not be usable to hammer the provider."""
    _guard_hourly(f"rates:{principal_id}", current_app.config["RATE_REQUESTS_PER_HOUR"])


def admit_export(principal_id: str) -> None:
    """Per-user, because an export is a full vault read
    (export-import.md, Rules). Called inside the export's own write
    transaction, so a refusal for any reason writes no row."""
    _admit_hourly(f"export:{principal_id}", current_app.config["EXPORTS_PER_USER_HOUR"])


def prune(conn, config, now) -> None:
    """Delete every row older than the longest window its bucket is
    read over, and every `ip:` row, which holds a plaintext address that
    no code writes any more. A row stays until a second past its window
    (app-shell.md, Database)."""
    conn.execute("DELETE FROM attempts WHERE bucket LIKE 'ip:%'")
    retention = (
        (
            "login:",
            max(
                config["LOGIN_ACCOUNT_WINDOW_MINUTES"],
                config["LOGIN_LOCKOUT_WINDOW_MINUTES"],
            ),
        ),
        ("login-lock:", config["LOGIN_LOCKOUT_MINUTES"]),
        ("address:", config["LOGIN_ADDRESS_WINDOW_MINUTES"]),
        ("address-lock:", config["LOGIN_ADDRESS_LOCK_MINUTES"]),
        ("rates:", 60),
        ("export:", 60),
    )
    for prefix, minutes in retention:
        cutoff = (now - timedelta(minutes=minutes)).isoformat(timespec="seconds")
        conn.execute(
            "DELETE FROM attempts WHERE bucket LIKE ? AND at < ?", (prefix + "%", cutoff)
        )


def prune_pass(app) -> None:
    """One pass on its own connection, which never creates a file: a
    database removed under a running process stays removed."""
    target = "file:" + quote(os.path.abspath(app.config["DATABASE_PATH"])) + "?mode=rw"
    try:
        conn = db.connect(target, uri=True, isolation_level=None)
        try:
            conn.execute("BEGIN IMMEDIATE")
            prune(conn, app.config, db.now())
            conn.execute("COMMIT")
        finally:
            conn.close()
    except Exception as error:
        app.logger.warning("attempts.prune_failed %s", type(error).__name__)


def _prune_forever(app) -> None:
    while True:
        time.sleep(PRUNE_INTERVAL_SECONDS)
        prune_pass(app)


def init_app(app) -> None:
    """The pruning thread of this serving process, and the one-time
    notice that a forwarded header is not being read."""
    threading.Thread(
        target=_prune_forever, args=(app,), name="attempts-pruner", daemon=True
    ).start()

    if app.config["TRUSTED_PROXY_HOPS"]:
        return
    # Taken by the first request that carries the header and never
    # released, so of request threads arriving at once only one logs.
    noticed = threading.Lock()

    @app.before_request
    def _note_ignored_proxy_header():
        if "X-Forwarded-For" in request.headers and noticed.acquire(blocking=False):
            app.logger.warning(
                "config.proxy_header_ignored X-Forwarded-For is ignored while "
                "TRUSTED_PROXY_HOPS is 0. Set it to the number of proxies in "
                "front of the app if there are any."
            )
