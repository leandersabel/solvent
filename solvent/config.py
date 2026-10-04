"""Environment and secret loading (spec/features/app-shell.md,
Configuration; spec/architecture.md, Tech stack, Container hardening).

Every operator-tunable number lives here with the default the spec
names. What the spec fixes instead of leaving to the operator -- the
storage caps, the KDF envelope -- is a constant instead, because a
boundary that moves per deployment is one the acceptance tests cannot
state (architecture.md, Storage & data handling).
"""
from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigurationError(RuntimeError):
    """Raised when the process cannot start safely.

    The message names the offending variable, never its value
    (app-shell.md, Configuration).
    """


@dataclass(frozen=True)
class Config:
    secret_key: str
    database_path: str
    hsts_preload: bool
    hsts_max_age: int
    login_attempts_per_account: int
    login_account_window_minutes: int
    login_lockout_threshold: int
    login_lockout_window_minutes: int
    login_lockout_minutes: int
    login_failures_per_address: int
    login_address_window_minutes: int
    login_address_lock_minutes: int
    trusted_proxy_hops: int
    verify_concurrency: int
    verify_wait_seconds: int
    rate_requests_per_hour: int
    rate_breaker_failures: int
    rate_breaker_cooloff_minutes: int
    exports_per_user_hour: int


# The client's key derivation, embedded in every server-rendered page so
# a flow needing *current* parameters reads it from the page it is on
# (architecture.md, Key management). Public input to a derivation, not a
# secret.
#
# The field names are pinned rather than descriptive: the envelope
# travels verbatim into credentials.params and from there into the
# export file, so renaming a key here rewrites a stored format. `v` is
# Argon2's own version number, 19 (0x13).
DEFAULT_KDF_ENVELOPE = {
    "alg": "argon2id",
    "v": 19,
    "m": 65536,
    "t": 3,
    "p": 1,
}

# What a client may register itself at. A weaker envelope is a Bad
# Request even though the UI would never send one (register.md).
MIN_KDF_ENVELOPE = dict(DEFAULT_KDF_ENVELOPE)

# Server-side Argon2id over the already-high-entropy Auth Key: defense
# in depth, not the work factor (login.md, Rules).
SERVER_VERIFY_PARAMS = {"m": 65536, "t": 2, "p": 1}

# Two years, the conventional HSTS max-age. The spec does not pin it.
_DEFAULT_HSTS_MAX_AGE = 63072000

_TRUTHY = ("1", "true", "yes")


def _flag(env: "dict[str, str]", name: str) -> bool:
    return env.get(name, "false").strip().lower() in _TRUTHY


def _number(env: "dict[str, str]", name: str, default: int, minimum: int = 1) -> int:
    raw = env.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        value = None
    if value is None or value < minimum:
        raise ConfigurationError(
            f"{name} must be a whole number of at least {minimum}. Fix it "
            "in the deployment's environment before starting the app."
        )
    return value


def load_config(env: "dict[str, str] | None" = None) -> Config:
    """Read configuration from the environment.

    Raises ConfigurationError when SECRET_KEY is missing or empty.
    create_app lets it propagate, so the process exits rather than
    serving a request.
    """
    env = os.environ if env is None else env

    secret_key = env.get("SECRET_KEY", "")
    if not secret_key:
        raise ConfigurationError(
            "SECRET_KEY environment variable is required and must not "
            "be empty. Set it in the deployment's environment before "
            "starting the app."
        )

    if "LOGIN_REQUESTS_PER_IP_HOUR" in env:
        raise ConfigurationError(
            "LOGIN_REQUESTS_PER_IP_HOUR no longer sets a limit, and ignoring "
            "it would leave a limit you rely on missing. Remove it, and set "
            "LOGIN_FAILURES_PER_ADDRESS, LOGIN_ADDRESS_WINDOW_MINUTES and "
            "LOGIN_ADDRESS_LOCK_MINUTES instead."
        )

    return Config(
        secret_key=secret_key,
        database_path=env.get("DATABASE_PATH", "instance/solvent.db"),
        hsts_preload=_flag(env, "HSTS_PRELOAD"),
        hsts_max_age=_number(env, "HSTS_MAX_AGE", _DEFAULT_HSTS_MAX_AGE, minimum=0),
        # architecture.md, Rate limiting: per account, 10 attempts per 15
        # minutes, then a 15-minute lockout once 20 fail within an hour.
        login_attempts_per_account=_number(env, "LOGIN_ATTEMPTS_PER_ACCOUNT", 10),
        login_account_window_minutes=_number(env, "LOGIN_ACCOUNT_WINDOW_MINUTES", 15),
        login_lockout_threshold=_number(env, "LOGIN_LOCKOUT_THRESHOLD", 20),
        login_lockout_window_minutes=_number(env, "LOGIN_LOCKOUT_WINDOW_MINUTES", 60),
        login_lockout_minutes=_number(env, "LOGIN_LOCKOUT_MINUTES", 15),
        # Per client address: 30 failed sign-ins within 15 minutes lock
        # it for 15 minutes.
        login_failures_per_address=_number(env, "LOGIN_FAILURES_PER_ADDRESS", 30),
        login_address_window_minutes=_number(env, "LOGIN_ADDRESS_WINDOW_MINUTES", 15),
        login_address_lock_minutes=_number(env, "LOGIN_ADDRESS_LOCK_MINUTES", 15),
        # architecture.md, Network & transport: how many proxies append
        # to X-Forwarded-For. Too low locks everyone behind the proxy out
        # together, too high lets a client pick its own address.
        trusted_proxy_hops=_number(env, "TRUSTED_PROXY_HOPS", 0, minimum=0),
        # architecture.md, Concurrency cap: 4 parallel verifications, so
        # peak Argon2id memory stays near 256 MiB.
        verify_concurrency=_number(env, "VERIFY_CONCURRENCY", 4),
        # How long a verification waits for a slot before it is
        # throttled like any other attempt over a limit.
        verify_wait_seconds=_number(env, "VERIFY_WAIT_SECONDS", 10),
        # rate-lookup.md, Rate limiting and failure.
        rate_requests_per_hour=_number(env, "RATE_REQUESTS_PER_HOUR", 120),
        rate_breaker_failures=_number(env, "RATE_BREAKER_FAILURES", 5),
        rate_breaker_cooloff_minutes=_number(env, "RATE_BREAKER_COOLOFF_MINUTES", 5),
        # export-import.md, Rules: a full vault read, and nobody backs up
        # five times an hour.
        exports_per_user_hour=_number(env, "EXPORTS_PER_USER_HOUR", 5),
    )
