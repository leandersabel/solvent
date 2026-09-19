"""Throttling for the endpoints an attacker can script
(spec/architecture.md, Rate limiting).

The expensive Argon2id derivation runs client-side, so an attacker
hitting the API directly pays nothing per guess: this is the only thing
standing between them and unlimited ones. Every limit here is operator
config with the default the spec names, and the tests assert the
behaviour at whatever the configured value is rather than a count.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from flask import abort, current_app, request

from .db import get_db, utcnow


def _since(minutes: int) -> str:
    return (
        datetime.now(timezone.utc) - timedelta(minutes=minutes)
    ).isoformat(timespec="seconds")


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


def client_ip() -> str:
    return request.remote_addr or "unknown"


def guard_auth(username: str) -> None:
    """The per-account and per-IP limits on the salt and login
    endpoints, checked before either does any work.

    The IP budget is spent across both endpoints together, because
    splitting it lets an attacker spend twice. A lockout response is
    the same shape whether or not the account exists, which is what
    keeps the limiter from becoming the enumeration oracle the decoy
    salt closes.
    """
    config = current_app.config
    ip_bucket = f"ip:{client_ip()}"
    record(ip_bucket)
    if _count(ip_bucket, "request", 60) > config["LOGIN_REQUESTS_PER_IP_HOUR"]:
        abort(429)

    account = f"login:{username}"
    if (
        _count(account, "failure", config["LOGIN_LOCKOUT_WINDOW_MINUTES"])
        >= config["LOGIN_LOCKOUT_THRESHOLD"]
        and _count(account, "failure", config["LOGIN_LOCKOUT_MINUTES"]) > 0
    ):
        current_app.logger.warning(
            "auth.lockout account=%s window_minutes=%s",
            username,
            config["LOGIN_LOCKOUT_MINUTES"],
        )
        abort(429)

    if (
        _count(account, "failure", config["LOGIN_ACCOUNT_WINDOW_MINUTES"])
        >= config["LOGIN_ATTEMPTS_PER_ACCOUNT"]
    ):
        abort(429)


def record_auth_failure(username: str) -> None:
    record(f"login:{username}", "failure")


def clear_auth_failures(username: str) -> None:
    get_db().execute(
        "DELETE FROM attempts WHERE bucket = ? AND outcome = 'failure'",
        (f"login:{username}",),
    )


def guard_rates(principal_id: str) -> None:
    """Per-user, independent of the login limiter: a compromised
    session must not be usable to hammer the provider."""
    bucket = f"rates:{principal_id}"
    record(bucket)
    if _count(bucket, "request", 60) > current_app.config["RATE_REQUESTS_PER_HOUR"]:
        abort(429)
