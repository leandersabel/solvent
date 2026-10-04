"""The QA plan: which feature pages tonight's walk covers, and how it
splits them into shards (.github/actions/qa-plan/plan.py)."""
import json
import shutil
import subprocess
import sys

import pytest

from tests.helpers import REPO_ROOT

PLAN = REPO_ROOT / ".github" / "actions" / "qa-plan" / "plan.py"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def commit(cwd, files):
    for path, text in files.items():
        if text is None:
            (cwd / path).unlink()
        else:
            (cwd / path).parent.mkdir(parents=True, exist_ok=True)
            (cwd / path).write_text(text)
    git(cwd, "add", "-A")
    git(cwd, "commit", "-qm", "change")
    return git(cwd, "rev-parse", "HEAD")


def plan(cwd, record=None, full=False):
    """What plan.py prints, run in `cwd` as the workflow runs it."""
    if record is not None:
        (cwd / "qa-walked.json").write_text(json.dumps(record))
    env = {"FULL": "true" if full else "", "TODAY": "2026-10-04", "PATH": "/usr/bin:/bin"}
    result = subprocess.run([sys.executable, str(PLAN)], cwd=cwd, env=env, capture_output=True, text=True, check=True)
    return {key: json.loads(value) for key, value in (line.split("=", 1) for line in result.stdout.splitlines())}


def walked(out):
    return sorted(name for shard in out["shards"] for name in shard["features"])


@pytest.fixture
def repo(tmp_path):
    """Feature pages a client sees, one they do not, and code naming them."""
    for name, lines in (("login", 40), ("dashboard", 90), ("export", 20)):
        body = "\n".join(f"line {i}" for i in range(lines))
        (tmp_path / "spec" / "features").mkdir(parents=True, exist_ok=True)
        (tmp_path / "spec" / "features" / f"{name}.md").write_text(f"# {name}\n\n## What the client gets\n\n{body}\n")
    (tmp_path / "spec" / "features" / "store.md").write_text("# store\n\n## How it works\n\nNothing a client sees.\n")
    (tmp_path / "solvent").mkdir()
    (tmp_path / "solvent" / "auth.py").write_text("# Signing in (spec/features/login.md).\n")
    (tmp_path / "solvent" / "store.py").write_text("# Storage (spec/features/store.md).\n")
    (tmp_path / "solvent" / "helpers.py").write_text("# Names no feature.\n")
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "qa@example.com")
    git(tmp_path, "config", "user.name", "qa")
    commit(tmp_path, {})
    return tmp_path


def last_walk(repo, **days):
    return {"commit": git(repo, "rev-parse", "HEAD"), "walked": days}


def test_without_a_record_every_client_facing_page_is_walked(repo):
    out = plan(repo)
    assert walked(out) == ["dashboard", "export", "login"]
    assert out["record"]["every"] is True


def test_a_changed_page_is_walked_with_the_one_walked_longest_ago(repo):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20", export="2026-09-25")
    commit(repo, {"spec/features/export.md": "# export\n\n## What the client gets\n\nchanged\n"})
    out = plan(repo, record)
    assert walked(out) == ["dashboard", "export"]
    assert out["record"]["every"] is False


def test_a_feature_never_walked_comes_first_in_rotation(repo):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20")
    commit(repo, {"solvent/auth.py": "# Signing in (spec/features/login.md), changed.\n"})
    assert walked(plan(repo, record)) == ["export", "login"]


def test_changed_code_walks_the_features_it_names(repo):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20", export="2026-09-25")
    commit(repo, {"solvent/auth.py": "# Signing in (spec/features/login.md), changed.\n"})
    assert walked(plan(repo, record)) == ["dashboard", "login"]


def test_a_deleted_file_walks_the_features_it_named(repo):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20", export="2026-09-25")
    commit(repo, {"solvent/auth.py": None})
    assert walked(plan(repo, record)) == ["dashboard", "login"]


@pytest.mark.parametrize("path", ["solvent/helpers.py", "solvent/store.py", "requirements.txt", "tools/nightly/relay.py"])
def test_changed_code_naming_no_walked_feature_walks_every_one(repo, path):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20", export="2026-09-25")
    commit(repo, {path: "changed\n"})
    assert plan(repo, record)["record"]["every"] is True


@pytest.mark.parametrize("path", ["tests/test_login.py", ".github/workflows/x.yml", "README.md", "spec/requirements.md", "tools/release-notes.py"])
def test_a_file_outside_the_image_and_the_harness_walks_only_the_rotation(repo, path):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20", export="2026-09-25")
    commit(repo, {path: "changed\n"})
    assert walked(plan(repo, record)) == ["dashboard"]


def test_full_walks_every_feature(repo):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20", export="2026-09-25")
    assert plan(repo, record, full=True)["record"]["every"] is True


@pytest.mark.parametrize("commit", ["0" * 40, "--output=x", None])
def test_an_unknown_last_commit_walks_every_feature(repo, commit):
    assert plan(repo, {"commit": commit, "walked": {}})["record"]["every"] is True
    assert not (repo / "x").exists()


def test_the_record_carries_tonight_forward(repo):
    record = last_walk(repo, login="2026-10-01", dashboard="2026-09-20", export="2026-09-25", gone="2026-01-01")
    out = plan(repo, record)
    assert out["record"] == {
        "commit": git(repo, "rev-parse", "HEAD"),
        "every": False,
        "walked": {"login": "2026-10-01", "dashboard": "2026-10-04", "export": "2026-09-25"},
    }


def test_a_page_without_what_the_client_gets_is_never_walked(repo):
    assert "store" not in walked(plan(repo))


def test_no_more_shards_than_features_walked(repo):
    assert [shard["features"] for shard in plan(repo)["shards"]] == [["dashboard"], ["login"], ["export"]]


def test_the_real_repository_plans(tmp_path):
    shutil.copytree(REPO_ROOT / "spec", tmp_path / "spec")
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "qa@example.com")
    git(tmp_path, "config", "user.name", "qa")
    commit(tmp_path, {})
    pages = {path.stem for path in (tmp_path / "spec" / "features").glob("*.md")}
    out = plan(tmp_path)
    assert walked(out) and set(walked(out)) <= pages
