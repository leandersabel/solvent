"""The generator of the nightly's prepared data, in a real browser
(spec/features/nightly-harness.md, fixtures.mjs and Dating back).

One fresh instance, prepared by prices.py and written by fixtures.mjs
through the app's own modules in Chrome, then dated back by patch.py.
Skipped where Chrome or Node is absent, like tests/test_browser.py.
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import pytest

from tests.helpers import CSRF, REPO_ROOT, flask, serve

TOOLS = REPO_ROOT / "tools" / "nightly"
CHROME = Path(os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not CHROME.exists(), reason="needs Node and a local Chrome"
)


def epoch_of(database: Path, username: str) -> str:
    """The vault epoch a page holding that account's vault sends."""
    conn = sqlite3.connect(database)
    try:
        return conn.execute(
            "SELECT epoch FROM vault_epochs JOIN principals ON principals.id = principal_id WHERE username = ?",
            (username,),
        ).fetchone()[0]
    finally:
        conn.close()


def status_with(base: str, cookie: dict, epoch: str) -> int:
    request = urllib.request.Request(
        f"{base}/api/records?type=profile",
        headers={**CSRF, "X-Solvent-Vault": epoch, "Cookie": f"{cookie['name']}={cookie['value']}"},
    )
    try:
        return urllib.request.urlopen(request, timeout=30).status
    except urllib.error.HTTPError as error:
        return error.code


def tables(path: Path) -> "dict[str, list]":
    conn = sqlite3.connect(path)
    try:
        names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]
        return {n: conn.execute(f"SELECT * FROM {n} ORDER BY rowid").fetchall() for n in names}
    finally:
        conn.close()


@pytest.fixture(scope="module")
def generated(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("nightly")
    out = tmp / "out"
    env = dict(
        os.environ,
        SECRET_KEY=secrets.token_hex(32),
        DATABASE_PATH=str(tmp / "solvent.db"),
        LOGIN_FAILURES_PER_ADDRESS="100000",
    )
    minted = flask("create-invite", "--kind", "administrator", "--expires-days", "1", env=env)
    assert minted.returncode == 0, minted.stderr
    invite = minted.stdout.strip()
    plan = TOOLS / "fixtures" / "plan.json"
    prepared = subprocess.run(
        [sys.executable, str(TOOLS / "prices.py"), "prepare", str(plan), str(out)], capture_output=True, text=True
    )
    assert prepared.returncode == 0, prepared.stderr
    with serve(env, tmp / "server.log") as base:
        ran = subprocess.run(
            ["node", str(TOOLS / "fixtures.mjs"), "--base", base, "--invite", invite, "--plan", str(plan), "--out", str(out)],
            cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=900,
        )
        assert ran.returncode == 0, ran.stdout + ran.stderr
        manifest = json.loads((out / "manifest.json").read_text())
        yield SimpleNamespace(base=base, out=out, env=env, manifest=manifest, log=tmp / "server.log", database=tmp / "solvent.db")


@pytest.fixture(scope="module")
def patched(generated):
    cookie = json.loads((generated.out / "storage-state.json").read_text())["cookies"][0]
    before = tables(generated.database)
    epoch = epoch_of(generated.database, generated.manifest["browserSession"]["username"])
    session_works = status_with(generated.base, cookie, epoch)
    done = subprocess.run(
        [sys.executable, str(TOOLS / "patch.py"), str(generated.database), str(generated.out / "patches.json")],
        capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stderr
    return SimpleNamespace(cookie=cookie, epoch=epoch, before=before, after=tables(generated.database), session_works=session_works)


def test_the_generator_writes_every_output_and_the_manifest_covers_every_name(generated):
    for name in ("manifest.json", "patches.json", "storage-state.json", "script.json", "expected.json", "backup-history.owner.json"):
        assert (generated.out / name).is_file(), name
    manifest = generated.manifest
    assert list(manifest) == ["app", "today", "accounts", "invites", "browserSession", "backups", "expected"]
    covered = {
        *(c for a in manifest["accounts"] for c in a["covers"]),
        *(c for i in manifest["invites"] for c in i["covers"]),
        *manifest["browserSession"]["covers"],
        *(c for b in manifest["backups"] for c in b["covers"]),
    }
    names = json.loads((generated.out / "script.json").read_text())["coverage"]
    assert set(names) <= covered
    assert manifest["invites"][0]["path"].startswith("/register?invite=")
    current, older = manifest["backups"]
    assert (current["file"], older["file"]) == (
        "tools/nightly/fixtures/out/backup-history.owner.json", "tools/nightly/fixtures/backup-format-1.json"
    )
    assert json.loads((generated.out / "backup-history.owner.json").read_text())["formatVersion"] == 1
    assert set(manifest["expected"]) >= {a["username"] for a in manifest["accounts"] if a["kind"] == "vault_owner"} | {
        current["file"], older["file"]
    }
    state = json.loads((generated.out / "storage-state.json").read_text())
    assert state["origins"] == [] and [sorted(c) for c in state["cookies"]] == [
        ["domain", "expires", "httpOnly", "name", "path", "sameSite", "secure", "value"]
    ]


def test_the_generator_sends_no_request_to_the_rate_lookup(generated):
    log = generated.log.read_text()
    assert "PUT /api/records/" in log, "the log holds no write to check"
    assert "/api/rates?" not in log


def test_patch_changes_only_the_rows_it_names_and_the_aged_session_is_refused(generated, patched):
    assert patched.session_works == 200
    assert {t for t in patched.before if patched.before[t] != patched.after[t]} == {"sessions", "invites", "credentials"}
    assert status_with(generated.base, patched.cookie, patched.epoch) == 401
    token = generated.manifest["invites"][0]["path"]
    request = urllib.request.Request(f"{generated.base}{token}")
    with pytest.raises(urllib.error.HTTPError) as refused:
        urllib.request.urlopen(request, timeout=30)
    assert refused.value.code == 400
    conn = sqlite3.connect(generated.database)
    memory = conn.execute(
        "SELECT json_extract(c.params, '$.kdf.m') FROM credentials c JOIN principals p ON p.id = c.principal_id WHERE p.username = 'old.owner'"
    ).fetchone()[0]
    assert memory == 32768
    conn.close()


@pytest.fixture(scope="module")
def dashboards(generated, patched):
    shown = subprocess.run(
        ["node", str(REPO_ROOT / "tests" / "browser" / "nightly.mjs")],
        cwd=REPO_ROOT,
        env=dict(os.environ, SOLVENT_BASE=generated.base, NIGHTLY_MANIFEST=str(generated.out / "manifest.json")),
        capture_output=True, text=True, timeout=900,
    )
    assert shown.returncode == 0, shown.stdout + shown.stderr
    return json.loads(shown.stdout.strip().splitlines()[-1])


def test_each_dashboard_shows_the_manifests_totals_under_both_modes_and_the_damaged_record_is_unreadable(generated, dashboards):
    vaults = [a["username"] for a in generated.manifest["accounts"] if a["kind"] == "vault_owner"]
    assert sorted(dashboards) == sorted(vaults)
    for username in vaults:
        expected = generated.manifest["expected"][username]
        if username == "empty.owner":
            assert dashboards[username]["latest"]["total"] is None
            continue
        for mode in ("latest", "asRecorded"):
            # A total of None is a vault with nothing valued, whose hero reads "—".
            wanted = {key: expected[mode][key] and expected[mode][key]["display"] for key in ("total", "assets", "debts")}
            assert dashboards[username][mode] == wanted, (username, mode)
        assert dashboards[username]["unreadable"] == (1 if username == "mixed.owner" else 0), username
    mixed = generated.manifest["expected"]["mixed.owner"]
    assert mixed["latest"]["total"] != mixed["asRecorded"]["total"]


def test_the_out_of_range_idle_lock_is_stored_as_zero_and_shown_as_five_minutes(generated, dashboards):
    owner = next(a["username"] for a in generated.manifest["accounts"] if "idle-lock-out-of-range" in a["covers"])
    assert (dashboards[owner]["storedIdleLock"], dashboards[owner]["shownIdleLock"]) == (0, "5")
    assert [u for u, entry in dashboards.items() if "storedIdleLock" in entry] == [owner]
