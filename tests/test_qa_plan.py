"""The QA plan: which feature pages a hunt covers
(.github/actions/qa-plan/plan.py)."""
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


def plan(cwd, base=None, full=False):
    """The features plan.py prints, run in `cwd` as the workflow runs it."""
    env = {"FULL": "true" if full else "", "BASE": base or "", "PATH": "/usr/bin:/bin"}
    result = subprocess.run([sys.executable, str(PLAN)], cwd=cwd, env=env, capture_output=True, text=True, check=True)
    key, value = result.stdout.strip().split("=", 1)
    assert key == "features"
    return json.loads(value)


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


def head(repo):
    return git(repo, "rev-parse", "HEAD")


def test_without_a_base_every_client_facing_page_is_hunted_longest_first(repo):
    assert plan(repo) == ["dashboard", "login", "export"]


def test_a_changed_page_is_hunted(repo):
    base = head(repo)
    commit(repo, {"spec/features/export.md": "# export\n\n## What the client gets\n\nchanged\n"})
    assert plan(repo, base) == ["export"]


def test_changed_code_hunts_the_features_it_names(repo):
    base = head(repo)
    commit(repo, {"solvent/auth.py": "# Signing in (spec/features/login.md), changed.\n"})
    assert plan(repo, base) == ["login"]


def test_a_deleted_file_hunts_the_features_it_named(repo):
    base = head(repo)
    commit(repo, {"solvent/auth.py": None})
    assert plan(repo, base) == ["login"]


@pytest.mark.parametrize("path", ["solvent/helpers.py", "solvent/store.py", "requirements.txt", "tools/nightly/relay.py"])
def test_changed_code_naming_no_hunted_feature_hunts_every_one(repo, path):
    base = head(repo)
    commit(repo, {path: "changed\n"})
    assert plan(repo, base) == ["dashboard", "login", "export"]


@pytest.mark.parametrize("path", ["tests/test_login.py", ".github/workflows/x.yml", "README.md", "spec/requirements.md", "tools/vendor-argon2id.py"])
def test_a_file_outside_the_image_and_the_harness_hunts_nothing(repo, path):
    base = head(repo)
    commit(repo, {path: "changed\n"})
    assert plan(repo, base) == []


def test_full_hunts_every_feature(repo):
    assert plan(repo, head(repo), full=True) == ["dashboard", "login", "export"]


@pytest.mark.parametrize("base", ["0" * 40, "--output=x"])
def test_an_unknown_base_hunts_every_feature(repo, base):
    assert plan(repo, base) == ["dashboard", "login", "export"]
    assert not (repo / "x").exists()


def test_a_page_without_what_the_client_gets_is_never_hunted(repo):
    assert "store" not in plan(repo)


def test_the_real_repository_plans(tmp_path):
    shutil.copytree(REPO_ROOT / "spec", tmp_path / "spec")
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "qa@example.com")
    git(tmp_path, "config", "user.name", "qa")
    commit(tmp_path, {})
    pages = {path.stem for path in (tmp_path / "spec" / "features").glob("*.md")}
    out = plan(tmp_path)
    assert out and set(out) <= pages
