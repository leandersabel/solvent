"""The workflows, end to end, in a real browser.

Every screen past the sign-in card is client-rendered from decrypted
records over WebCrypto and WebAssembly, so a real engine is the only
place their acceptance criteria can be checked at all. One part of it
per screen lives in tests/browser/parts/, each run as its own test
against a server and a database of its own, so the parts share nothing
and run at the same time, one per core. One part on its own, serially:

    pytest -n 0 "tests/test_browser.py::test_the_workflows_hold_in_a_browser[unlock]"

Skipped where Chrome or Node is absent, so the rest of the suite stays
runnable anywhere.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pytest
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError
from argon2.low_level import hash_secret_raw

from tests.helpers import REPO_ROOT, flask, serve

BROWSER = REPO_ROOT / "tests" / "browser"
PARTS = sorted((BROWSER / "parts").glob("*.mjs"))
SCREENS = sorted(path.stem for path in (REPO_ROOT / "spec" / "ui").glob("*.md") if path.stem != "design-system")
CHROME = Path(os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))

# The passwords the parts sign in with, handed to them here so the
# verifiers they leave behind can be checked against them below.
PASSWORDS = {
    "ops.leander": "orchard lantern quiet ribbon",
    "leander": "harbour crescent tundra oblige",
}

needs_browser = pytest.mark.skipif(
    shutil.which("node") is None or not CHROME.exists(),
    reason="needs Node and a local Chrome",
)


def belongs_to(part: str, screen: str) -> bool:
    """A part is a screen's, or one aspect of it when the screen is too
    long to run in one."""
    return part == screen or part.startswith(screen + "-")


def test_every_screen_has_a_part_and_every_part_a_screen():
    assert not [s for s in SCREENS if not any(belongs_to(p.stem, s) for p in PARTS)], "a screen with no part"
    assert not [p.stem for p in PARTS if not any(belongs_to(p.stem, s) for s in SCREENS)], "a part of no screen"


def test_no_part_pauses_for_a_fixed_time():
    """A check waits for what it reads to happen. A pause that was long
    enough on one machine is a flake on a slower one."""
    pauses = [
        str(path.relative_to(REPO_ROOT))
        for path in BROWSER.rglob("*.mjs")
        if ".settle(" in path.read_text()
    ]
    assert not pauses, pauses


@pytest.fixture
def instance(tmp_path):
    """A real server and a database of its own for one part, with the
    bootstrap invite minted the way an operator's shell would."""
    env = dict(
        os.environ,
        # A key for this server alone.
        SECRET_KEY=secrets.token_hex(32),
        DATABASE_PATH=str(tmp_path / "solvent.db"),
        # The sampled wrong passwords all fail from one address. The
        # limiter still runs on every request.
        LOGIN_FAILURES_PER_ADDRESS="100000",
    )
    minted = flask("create-invite", "--kind", "administrator", "--expires-days", "1", env=env)
    assert minted.returncode == 0, minted.stderr
    invite = minted.stdout.strip().split("invite=")[-1]
    with serve(env, tmp_path / "server.log") as base:
        yield base, invite, env


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
         f"const {{ launch }} = await import({json.dumps((BROWSER / 'cdp.mjs').as_uri())});"
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
@pytest.mark.parametrize("part", PARTS, ids=lambda part: part.stem)
def test_the_workflows_hold_in_a_browser(instance, part):
    base, invite, env = instance
    result = subprocess.run(
        ["node", str(part)],
        cwd=REPO_ROOT,
        env=dict(
            env,
            SOLVENT_BASE=base,
            SOLVENT_INVITE=invite,
            # For the invites a check mints for itself, the way an
            # operator's shell would.
            SOLVENT_PYTHON=sys.executable,
            # Past today, so the backdated figure is a second
            # recording. The page's rate proxy is stubbed, so the date
            # needs no provider data.
            SOLVENT_BACKDATE=(date.today() - timedelta(days=45)).isoformat(),
            SOLVENT_ADMIN_PASSWORD=PASSWORDS["ops.leander"],
            SOLVENT_VAULT_PASSWORD=PASSWORDS["leander"],
        ),
        capture_output=True,
        text=True,
        timeout=600,
    )
    print(result.stdout)
    assert result.returncode == 0, result.stdout + result.stderr

    # login.md: an administrator's stored verifier is a hash over the
    # Auth Key from the same HKDF split a vault owner's is, and not over
    # the raw Argon2id output. Both would sign in, so only deriving both
    # here, independently of the client, and asking which one the
    # stored hash accepts tells them apart. Checked for the accounts
    # this part made.
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
        if username not in stored:
            continue
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
