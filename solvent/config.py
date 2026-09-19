"""Environment and secret loading (spec/features/app-shell.md,
Configuration; spec/architecture.md, Tech stack, Container hardening).
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


# Embedded in every server-rendered page, so a client-side flow needing
# *current* parameters reads it from the page it is on (architecture.md,
# Key management). Public input to a derivation, not a secret.
# `memoryKib` matches the unit most Argon2id bindings expect natively.
DEFAULT_KDF_ENVELOPE = {
    "algorithm": "argon2id",
    "version": 1,
    "memoryKib": 256 * 1024,
    "iterations": 3,
    "parallelism": 1,
}

# Two years, the conventional HSTS max-age. The spec does not pin it,
# unlike the CSP string and the header names.
_DEFAULT_HSTS_MAX_AGE = 63072000


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

    database_path = env.get("DATABASE_PATH", "instance/solvent.db")

    hsts_preload = env.get("HSTS_PRELOAD", "false").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    hsts_max_age = int(env.get("HSTS_MAX_AGE", str(_DEFAULT_HSTS_MAX_AGE)))

    return Config(
        secret_key=secret_key,
        database_path=database_path,
        hsts_preload=hsts_preload,
        hsts_max_age=hsts_max_age,
    )
