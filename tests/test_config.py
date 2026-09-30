"""SECRET_KEY startup rule (spec/features/app-shell.md, Configuration,
Edge cases, Acceptance criteria).

The compiled contract calls for a process-launch harness here, not a
unit test of the config-loading function in isolation
(spec/.compiled/app-shell.json, verify.focus): a unit test could pass
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
