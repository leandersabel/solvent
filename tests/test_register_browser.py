"""The registration forms in a real browser, against stubbed answers
(spec/features/register.md, Register and In the browser)."""
from __future__ import annotations

import os
import secrets
import subprocess

import pytest

from solvent.crypto import ZXCVBN_SRI, ZXCVBN_VERSION
from tests.helpers import REPO_ROOT, flask, serve
from tests.test_browser import needs_browser

RUNNER = REPO_ROOT / "tests" / "browser" / "register.mjs"


@pytest.fixture(scope="module")
def instance(tmp_path_factory):
    directory = tmp_path_factory.mktemp("register")
    env = dict(os.environ, SECRET_KEY=secrets.token_hex(32), DATABASE_PATH=str(directory / "solvent.db"))

    def mint(kind):
        minted = flask("create-invite", "--kind", kind, "--expires-days", "1", env=env)
        assert minted.returncode == 0, minted.stderr
        return minted.stdout.strip().split("invite=")[-1]

    invites = {"vault": mint("vault-owner"), "admin": mint("administrator")}
    with serve(env, directory / "server.log") as base:
        yield base, invites, env


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
