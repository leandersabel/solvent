"""The release gate: what holds back a version, read from stubbed `gh` and `git`."""
import importlib.util
import json
import subprocess
from types import SimpleNamespace

import pytest

from tests.helpers import REPO_ROOT

HIGH = "severity: high"
MERGED = "merged-sha"


def label(name, by="owner", added=True):
    return {"__typename": "LabeledEvent" if added else "UnlabeledEvent", "actor": {"login": by}, "label": {"name": name}}


def closing(by="claude", merge=None):
    closer = {"mergeCommit": {"oid": merge}} if merge else None
    return {"__typename": "ClosedEvent", "actor": {"login": by}, "closer": closer}


def gate_blocked(monkeypatch, tmp_path, open_=None, closed_=None, alerts=(), fail=None):
    """release-blocked.txt after the gate runs, or None when it passes. Issues
    map a number to its timeline, a list of pages of events. Only MERGED
    is an ancestor of the commit."""
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/solvent")
    monkeypatch.setenv("COMMIT", "head-sha")
    monkeypatch.setenv("SINCE", "")
    monkeypatch.chdir(tmp_path)
    spec = importlib.util.spec_from_file_location("gate", REPO_ROOT / ".github/actions/release-gate/gate.py")
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    states = {"OPEN": open_ or {}, "CLOSED": closed_ or {}}

    def run(*args):
        if fail and fail in " ".join(args):
            raise subprocess.CalledProcessError(1, args)
        if "--paginate" in args:
            url = args[-1]
            assert all(part in url for part in ("state=open", "scope=runtime", "severity=high,critical"))
            return json.dumps([alerts])
        given = dict(arg.split("=", 1) for arg in args if "=" in arg)
        if given["query"] == gate.ISSUES:
            return graphql("issues", [{"number": number} for number in states[given["states"]]])
        pages = next(timeline for issues in states.values() for number, timeline in issues.items() if str(number) == given["number"])
        index = int(given.get("after", 0))
        last = index == len(pages) - 1
        return graphql("issue", pages[index], last, None if last else index + 1)

    def graphql(key, nodes, last=True, cursor=None):
        connection = {"pageInfo": {"hasNextPage": not last, "endCursor": str(cursor)}, "nodes": nodes}
        return json.dumps({"data": {"repository": {key: {"timelineItems": connection} if key == "issue" else connection}}})

    monkeypatch.setattr(gate, "run", run)
    monkeypatch.setattr(
        gate.subprocess, "run", lambda *args, **kw: SimpleNamespace(returncode=0 if args[0][-2:] == [MERGED, "head-sha"] else 1)
    )
    try:
        gate.main()
    except SystemExit:
        return (tmp_path / "release-blocked.txt").read_text()
    assert not (tmp_path / "release-blocked.txt").exists()
    return None


def test_a_closed_high_issue_without_a_closing_event_holds_back_the_version(monkeypatch, tmp_path):
    out = gate_blocked(monkeypatch, tmp_path, closed_={7: [[label(HIGH)]]})
    assert out == "- #7 was closed, but its closing could not be read\n"


@pytest.mark.parametrize(
    "second_page, blocked",
    [([label("severity: low", "claude")], True), ([label(HIGH, "owner", added=False)], False)],
)
def test_a_timeline_over_two_pages_is_read_whole(monkeypatch, tmp_path, second_page, blocked):
    out = gate_blocked(monkeypatch, tmp_path, open_={5: [[label(HIGH)], second_page]})
    assert out == ("- #5\n" if blocked else None)


@pytest.mark.parametrize("rater", ["owner", "claude", "github-actions"])
def test_a_rating_by_a_rater_counts(monkeypatch, tmp_path, rater):
    assert gate_blocked(monkeypatch, tmp_path, open_={5: [[label(HIGH, rater)]]}) == "- #5\n"


def test_a_critical_rating_holds_back_the_version_too(monkeypatch, tmp_path):
    assert gate_blocked(monkeypatch, tmp_path, open_={5: [[label("severity: critical")]]}) == "- #5\n"


def test_a_rating_added_or_removed_by_anyone_else_changes_nothing(monkeypatch, tmp_path):
    out = gate_blocked(
        monkeypatch,
        tmp_path,
        open_={5: [[label(HIGH, "stranger")]], 6: [[label(HIGH), label(HIGH, "stranger", added=False)]]},
    )
    assert out == "- #6\n"


@pytest.mark.parametrize(
    "event, blocked",
    [
        (closing("owner"), False),
        (closing(merge=MERGED), False),
        (closing(merge="elsewhere"), True),
        (closing(), True),
    ],
)
def test_a_closed_high_issue_needs_the_owner_or_a_fix_in_the_version(monkeypatch, tmp_path, event, blocked):
    out = gate_blocked(monkeypatch, tmp_path, closed_={8: [[label(HIGH), event]]})
    assert out == ("- #8 was closed without its fix in this version\n" if blocked else None)


def test_an_open_high_dependabot_alert_holds_back_the_version(monkeypatch, tmp_path):
    alerts = [{"number": 3, "security_advisory": {"summary": "Bad thing"}}]
    assert gate_blocked(monkeypatch, tmp_path, alerts=alerts) == "- Dependabot alert 3: Bad thing\n"


@pytest.mark.parametrize("fail", ["graphql", "dependabot"])
def test_a_gh_failure_propagates_instead_of_passing(monkeypatch, tmp_path, fail):
    with pytest.raises(subprocess.CalledProcessError):
        gate_blocked(monkeypatch, tmp_path, open_={5: [[label("severity: low")]]}, fail=fail)


def test_nothing_blocking_passes_and_writes_no_file(monkeypatch, tmp_path):
    out = gate_blocked(
        monkeypatch,
        tmp_path,
        open_={5: [[label("severity: low")]]},
        closed_={8: [[label("severity: medium"), closing()]]},
    )
    assert out is None
