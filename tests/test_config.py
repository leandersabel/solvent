"""SECRET_KEY startup rule (spec/features/app-shell.md, Configuration,
Edge cases, Acceptance criteria).

The criterion is blind (spec/features/app-shell.md, Acceptance
criteria) and needs a process-launch harness, not a unit test of the
config-loading function in isolation: a unit test could pass
while `create_app`/`app.py` still swallowed the error and started
anyway. The `load_config` tests check the message, and the subprocess
tests are the ones that exercise "the app does not start".
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from solvent.config import ConfigurationError, load_config

REPO_ROOT = Path(__file__).resolve().parent.parent

# Distinctive enough that finding it in process output means the app
# echoed the key, not that the string occurred by chance.
_SENTINEL_KEY = "sentinel-key-must-never-be-echoed-42"


def test_load_config_raises_naming_the_variable_with_no_value():
    with pytest.raises(ConfigurationError) as excinfo:
        load_config(env={})
    message = str(excinfo.value)
    assert "SECRET_KEY" in message


def test_load_config_raises_on_empty_string():
    with pytest.raises(ConfigurationError):
        load_config(env={"SECRET_KEY": ""})


def _run_app(overrides: dict, *, unset: "tuple[str, ...]" = ()) -> subprocess.CompletedProcess:
    full_env = dict(os.environ)
    for key in unset:
        full_env.pop(key, None)
    full_env.update(overrides)
    return subprocess.run(
        [sys.executable, "-c", "import app"],
        cwd=REPO_ROOT,
        env=full_env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_process_fails_to_start_with_secret_key_unset():
    result = _run_app({}, unset=("SECRET_KEY",))

    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "SECRET_KEY" in output


def test_process_fails_to_start_with_secret_key_empty(tmp_path):
    result = _run_app(
        {"SECRET_KEY": "", "DATABASE_PATH": str(tmp_path / "solvent.db")}
    )

    assert result.returncode != 0
    output = result.stdout + result.stderr
    assert "SECRET_KEY" in output


def test_process_starts_with_secret_key_set(tmp_path):
    result = _run_app(
        {
            "SECRET_KEY": _SENTINEL_KEY,
            "DATABASE_PATH": str(tmp_path / "solvent.db"),
        }
    )

    assert result.returncode == 0, result.stdout + result.stderr


def test_no_key_material_reaches_process_output(tmp_path):
    """A clean start prints no value (app-shell.md, Acceptance
    criteria)."""
    started = _run_app(
        {
            "SECRET_KEY": _SENTINEL_KEY,
            "DATABASE_PATH": str(tmp_path / "started.db"),
        }
    )
    assert _SENTINEL_KEY not in started.stdout + started.stderr


# ---- The limits and the proxy count (app-shell.md, Configuration) ------

_ADDRESS_VARIABLES = (
    "LOGIN_FAILURES_PER_ADDRESS",
    "LOGIN_ADDRESS_WINDOW_MINUTES",
    "LOGIN_ADDRESS_LOCK_MINUTES",
)
_LIMIT_VARIABLES = (
    "LOGIN_ATTEMPTS_PER_ACCOUNT",
    "LOGIN_ACCOUNT_WINDOW_MINUTES",
    "LOGIN_LOCKOUT_THRESHOLD",
    "LOGIN_LOCKOUT_WINDOW_MINUTES",
    "LOGIN_LOCKOUT_MINUTES",
    *_ADDRESS_VARIABLES,
    "VERIFY_CONCURRENCY",
    "VERIFY_WAIT_SECONDS",
    "RATE_REQUESTS_PER_HOUR",
    "RATE_BREAKER_FAILURES",
    "RATE_BREAKER_COOLOFF_MINUTES",
    "EXPORTS_PER_USER_HOUR",
)


def _start(tmp_path, **env):
    return _run_app({"SECRET_KEY": _SENTINEL_KEY, "DATABASE_PATH": str(tmp_path / "s.db"), **env})


@pytest.mark.parametrize("value", ["60", ""])
def test_the_removed_per_ip_limit_refuses_to_start_whenever_it_is_set(tmp_path, value):
    result = _start(tmp_path, LOGIN_REQUESTS_PER_IP_HOUR=value)
    assert result.returncode != 0
    output = result.stdout + result.stderr
    for name in ("LOGIN_REQUESTS_PER_IP_HOUR", *_ADDRESS_VARIABLES):
        assert name in output


@pytest.mark.parametrize(
    "name, value",
    [(name, value) for name in _LIMIT_VARIABLES for value in ("0", "ten")]
    + [("TRUSTED_PROXY_HOPS", "-1"), ("TRUSTED_PROXY_HOPS", "ten")],
)
def test_a_limit_below_its_minimum_or_not_a_number_refuses_to_start(tmp_path, name, value):
    result = _start(tmp_path, **{name: value})
    assert result.returncode != 0
    assert name in result.stdout + result.stderr


def test_a_refused_value_is_never_echoed(tmp_path):
    result = _start(tmp_path, LOGIN_LOCKOUT_MINUTES="banana-17")
    assert result.returncode != 0
    assert "LOGIN_LOCKOUT_MINUTES" in result.stderr
    assert "banana-17" not in result.stdout + result.stderr


def test_the_proxy_count_defaults_to_none_and_the_address_limit_to_the_spec():
    config = load_config({"SECRET_KEY": "k"})
    assert config.trusted_proxy_hops == 0
    assert (
        config.login_failures_per_address,
        config.login_address_window_minutes,
        config.login_address_lock_minutes,
    ) == (30, 15, 15)
