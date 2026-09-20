"""The workflows, end to end, in a real browser.

Every screen past the sign-in card is client-rendered from decrypted
records over WebCrypto and WebAssembly, so a real engine is the only
place their acceptance criteria can be checked at all. The runner is
tests/browser/workflow.mjs; this starts a server on a throwaway
database, mints the bootstrap invite, and reports what it found.

Skipped where Chrome or Node is absent, so the rest of the suite stays
runnable anywhere.
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNNER = REPO_ROOT / "tests" / "browser" / "workflow.mjs"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

needs_browser = pytest.mark.skipif(
    shutil.which("node") is None or not CHROME.exists(),
    reason="needs Node and a local Chrome",
)


def free_port() -> int:
    with socket.socket(socket.AF_INET6) as sock:
        sock.bind(("::1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def instance(tmp_path_factory):
    """A real server on a throwaway database, bound to the loopback
    address Chrome resolves `localhost` to first."""
    database = tmp_path_factory.mktemp("browser") / "solvent.db"
    env = dict(os.environ, SECRET_KEY="browser-test-key", DATABASE_PATH=str(database))
    port = free_port()

    minted = subprocess.run(
        [sys.executable, "-m", "flask", "--app", "app", "create-invite",
         "--kind", "administrator", "--expires-days", "1"],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=120,
    )
    assert minted.returncode == 0, minted.stderr
    invite = minted.stdout.strip().split("invite=")[-1]

    server = subprocess.Popen(
        [sys.executable, "-m", "flask", "--app", "app", "run",
         "--host", "::1", "--port", str(port)],
        cwd=REPO_ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    base = f"http://localhost:{port}"
    for _ in range(80):
        try:
            with socket.create_connection(("::1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.25)
    else:
        server.kill()
        pytest.fail("the server did not come up")

    try:
        yield base, invite, env
    finally:
        server.terminate()
        server.wait(timeout=10)


@needs_browser
def test_the_workflows_hold_in_a_browser(instance):
    base, invite, env = instance
    result = subprocess.run(
        ["node", str(RUNNER)],
        cwd=REPO_ROOT,
        env=dict(
            env,
            SOLVENT_BASE=base,
            SOLVENT_INVITE=invite,
            # A date both providers publish for, so the backdated
            # figure exercises the proposal path rather than the
            # outage path.
            SOLVENT_BACKDATE=(date.today() - timedelta(days=45)).isoformat(),
        ),
        capture_output=True,
        text=True,
        timeout=900,
    )
    print(result.stdout)
    assert result.returncode == 0, result.stdout + result.stderr
