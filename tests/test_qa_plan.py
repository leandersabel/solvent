"""The QA plan: which feature pages tonight's walk covers, and how it
splits them into shards (.github/actions/qa-plan/plan.py)."""
import json
import shutil
import subprocess
import sys

import pytest

from tests.helpers import REPO_ROOT

PLAN = REPO_ROOT / ".github" / "actions" / "qa-plan" / "plan.py"


def plan(cwd, last="", full=None):
    """The shards plan.py prints, run in `cwd` as the workflow runs it."""
    if full is not None:
        (cwd / "qa-full.txt").write_text("\n".join(full) + "\n")
    result = subprocess.run(
        [sys.executable, str(PLAN)], cwd=cwd, env={"LAST": last}, capture_output=True, text=True
    )
    if result.returncode:
        return result.stderr
    assert result.stdout.startswith("shards=")
    return json.loads(result.stdout.removeprefix("shards="))


def walked(shards, mode):
    return sorted(name for shard in shards for name in shard[mode])


@pytest.fixture
def spec(tmp_path):
    """Feature pages a client sees, and one they do not."""
    pages = tmp_path / "spec" / "features"
    pages.mkdir(parents=True)
    for name, lines in (("login", 40), ("dashboard", 90), ("export", 20)):
        body = "\n".join(f"line {i}" for i in range(lines))
        (pages / f"{name}.md").write_text(f"# {name}\n\n## What the client gets\n\n{body}\n")
    (pages / "store.md").write_text("# store\n\n## How it works\n\nNothing a client sees.\n")
    return tmp_path


def test_a_first_night_walks_every_client_facing_page_in_full(spec):
    shards = plan(spec)
    assert walked(shards, "full") == ["dashboard", "export", "login"]
    assert walked(shards, "smoke") == []


def test_a_page_without_what_the_client_gets_is_never_walked(spec):
    assert "store" not in walked(plan(spec), "full")
    assert "store" in plan(spec, last="v1", full=["store"])


def test_a_later_night_walks_the_named_pages_in_full_and_smokes_the_rest(spec):
    shards = plan(spec, last="v1", full=["login"])
    assert walked(shards, "full") == ["login"]
    assert walked(shards, "smoke") == ["dashboard", "export"]
    assert len(shards) == 1


def test_an_unknown_name_stops_the_plan(spec):
    assert "Not a feature: nowhere" in plan(spec, last="v1", full=["nowhere"])


def test_no_more_shards_than_pages_walked_in_full(spec):
    shards = plan(spec)
    assert [shard["full"] for shard in shards] == [["dashboard"], ["login"], ["export"]]


def test_the_real_spec_plans(tmp_path):
    shutil.copytree(REPO_ROOT / "spec", tmp_path / "spec")
    pages = {path.stem for path in (tmp_path / "spec" / "features").glob("*.md")}
    shards = plan(tmp_path)
    assert walked(shards, "full")
    assert set(walked(shards, "full")) <= pages
