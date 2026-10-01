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

import base64
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import socket
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pytest
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError
from argon2.low_level import hash_secret_raw

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNNER = REPO_ROOT / "tests" / "browser" / "workflow.mjs"
CHROME = Path(os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))

# The passwords the workflow signs in with, handed to it here so the
# verifiers it leaves behind can be checked against them below.
PASSWORDS = {
    "ops.leander": "orchard lantern quiet ribbon",
    "leander": "harbour crescent tundra oblige",
}

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
    env = dict(
        os.environ,
        SECRET_KEY="browser-test-key",
        DATABASE_PATH=str(database),
        # The sampled sign-ins spend one salt request each from the
        # per-IP budget. The limiter still runs on every request.
        LOGIN_REQUESTS_PER_IP_HOUR="100000",
    )
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
        # Nothing reads the request log, and a pipe nobody drains stalls
        # the server once its buffer fills.
        cwd=REPO_ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
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


@pytest.mark.skipif(shutil.which("node") is None, reason="needs Node")
def test_a_chrome_that_dies_at_launch_fails_fast_with_its_stderr(tmp_path):
    """launch() reports a browser that exits before it is ready at once,
    with what it wrote to stderr, instead of polling to a timeout. The
    stand-in below is not Chrome, so this runs anywhere Node does."""
    stub = tmp_path / "chrome"
    stub.write_text("#!/bin/sh\necho 'stub chrome: no display available' >&2\nexit 1\n")
    stub.chmod(0o755)
    started = time.monotonic()
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         f"const {{ launch }} = await import({json.dumps((REPO_ROOT / 'tests' / 'browser' / 'cdp.mjs').as_uri())});"
         "try { await launch(); } catch (error) { console.error(error.message); process.exit(3); }"],
        cwd=REPO_ROOT,
        env=dict(os.environ, CHROME=str(stub)),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert time.monotonic() - started < 10
    assert result.returncode == 3, result.stdout + result.stderr
    assert "stub chrome: no display available" in result.stderr
    assert "code 1" in result.stderr


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
            SOLVENT_ADMIN_PASSWORD=PASSWORDS["ops.leander"],
            SOLVENT_VAULT_PASSWORD=PASSWORDS["leander"],
        ),
        capture_output=True,
        text=True,
        timeout=900,
    )
    print(result.stdout)
    assert result.returncode == 0, result.stdout + result.stderr

    # login.md: an administrator's stored verifier is a hash over the
    # Auth Key from the same HKDF split a vault owner's is, and not over
    # the raw Argon2id output. Both would sign in, so only deriving both
    # here, independently of the client, and asking which one the
    # stored hash accepts tells them apart.
    conn = sqlite3.connect(env["DATABASE_PATH"])
    try:
        stored = {
            username: (params, verifier)
            for username, params, verifier in conn.execute(
                "SELECT principals.username, credentials.params, credentials.verifier "
                "FROM credentials JOIN principals ON principals.id = credentials.principal_id"
            )
        }
    finally:
        conn.close()
    for username, password in PASSWORDS.items():
        params, verifier = stored[username]
        raw, auth_key = derive(password, json.loads(params))
        assert verifies(verifier, auth_key), username
        assert not verifies(verifier, raw), username


def derive(password: str, params: dict) -> "tuple[str, str]":
    """The raw Argon2id output and the Auth Key HKDF-SHA256 splits from
    it (architecture.md, Key management), both as the base64 the client
    would send."""
    kdf = params["kdf"]
    raw = hash_secret_raw(
        password.encode(),
        base64.b64decode(params["salt"]),
        time_cost=kdf["t"],
        memory_cost=kdf["m"],
        parallelism=kdf["p"],
        hash_len=32,
        type=Type.ID,
        version=kdf["v"],
    )
    # HKDF with an empty salt, which RFC 5869 makes a key of zeros.
    prk = hmac.new(bytes(32), raw, hashlib.sha256).digest()
    auth = hmac.new(prk, b"solvent/auth-key\x01", hashlib.sha256).digest()
    return base64.b64encode(raw).decode(), base64.b64encode(auth).decode()


def verifies(verifier: str, candidate: str) -> bool:
    try:
        return PasswordHasher().verify(verifier, candidate)
    except VerificationError:
        return False
