"""The suite's own conftest, run apart from the real tests."""
from __future__ import annotations

import os
import subprocess
import sys

from tests.helpers import REPO_ROOT

STAND_IN_CONFTEST = """
import pytest


@pytest.fixture
def python_image():
    return "stand-in"
"""
NESTED_RUN = """
import subprocess
import sys


def test_starts_a_second_run(python_image, tmp_path):
    (tmp_path / "test_inner.py").write_text("def test_inner():\\n    pass\\n")
    inner = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "tests.conftest", "-n", "0",
         "--rootdir", str(tmp_path), str(tmp_path / "test_inner.py")],
        capture_output=True, text=True, timeout=30,
    )
    assert inner.returncode == 0, inner.stdout + inner.stderr
"""


def test_a_serial_run_holding_the_network_lock_does_not_block_a_second_run(tmp_path):
    """Issue 552: a Docker module run serially holds the network lock
    exclusive, and a pytest it starts takes a lock of its own."""
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "conftest.py").write_text(STAND_IN_CONFTEST)
    (suite / "test_nested.py").write_text(NESTED_RUN)
    env = dict(os.environ, PYTHONPATH=str(REPO_ROOT), PYTEST_DEBUG_TEMPROOT=str(tmp_path))
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "tests.conftest", "-n", "0", str(suite)],
        cwd=suite, env=env, capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stdout + done.stderr
