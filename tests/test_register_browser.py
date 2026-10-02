"""The registration forms in a real browser, against stubbed answers
(spec/ui/register.md, spec/features/register.md, In the browser)."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time

import pytest

from solvent.crypto import ZXCVBN_SRI, ZXCVBN_VERSION
from tests.test_browser import REPO_ROOT, free_port, needs_browser

RUNNER = REPO_ROOT / "tests" / "browser" / "register.mjs"


@pytest.fixture(scope="module")
def instance(tmp_path_factory):
    env = dict(
        os.environ,
        SECRET_KEY="browser-test-key",
        DATABASE_PATH=str(tmp_path_factory.mktemp("register") / "solvent.db"),
    )

    def mint(kind):
        minted = subprocess.run(
            [sys.executable, "-m", "flask", "--app", "app", "create-invite", "--kind", kind, "--expires-days", "1"],
            cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=120,
        )
        assert minted.returncode == 0, minted.stderr
        return minted.stdout.strip().split("invite=")[-1]

    invites = {"vault": mint("vault-owner"), "admin": mint("administrator")}
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "flask", "--app", "app", "run", "--host", "::1", "--port", str(port)],
        cwd=REPO_ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
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
        yield f"http://localhost:{port}", invites, env
    finally:
        server.terminate()
        server.wait(timeout=10)


@needs_browser
def test_the_registration_forms_answer_each_refusal_in_its_own_words(instance):
    base, invites, env = instance
    result = subprocess.run(
        ["node", str(RUNNER)],
        cwd=REPO_ROOT,
        env=dict(env, SOLVENT_BASE=base, SOLVENT_VAULT_INVITE=invites["vault"], SOLVENT_ADMIN_INVITE=invites["admin"]),
        capture_output=True, text=True, timeout=600,
    )
    print(result.stdout)
    assert result.returncode == 0, result.stdout + result.stderr


@needs_browser
def test_the_gauge_loads_only_the_pinned_zxcvbn_whatever_the_page_plants(instance):
    base, invites, env = instance
    result = subprocess.run(
        ["node", str(REPO_ROOT / "tests" / "browser" / "zxcvbn.mjs")],
        cwd=REPO_ROOT,
        env=dict(
            env,
            SOLVENT_BASE=base,
            SOLVENT_VAULT_INVITE=invites["vault"],
            PINNED_PATH=f"/static/vendor/zxcvbn/{ZXCVBN_VERSION}/zxcvbn.js",
            PINNED_SRI=ZXCVBN_SRI,
            PLANTED_PATH="/static/planted-zxcvbn.js",
        ),
        capture_output=True, text=True, timeout=600,
    )
    print(result.stdout)
    assert result.returncode == 0, result.stdout + result.stderr
