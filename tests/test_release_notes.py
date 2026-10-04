"""tools/release-notes.py: one line per pull request, naming who asked for every issue it closes."""
import importlib.util
import sys

import pytest

from tests.helpers import REPO_ROOT


def release_notes(monkeypatch, capsys, pulls: "list[dict]") -> str:
    """tools/release-notes.py on pull requests and issues stubbed in place
    of `gh` and `git`."""
    spec = importlib.util.spec_from_file_location("release_notes", REPO_ROOT / "tools" / "release-notes.py")
    notes = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(notes)
    issues = {
        10: {"author": {"login": "leandersabel"}, "labels": []},
        11: {"author": {"login": "someone"}, "labels": [{"name": "bug"}]},
        12: {"author": {"login": "app/github-actions"}, "labels": [{"name": "bug"}]},
    }

    def gh(*args):
        if args[:2] == ("issue", "view"):
            return issues[int(args[2])]
        if "--head" in args:
            return [{"number": 99}] if args[args.index("--head") + 1] == "claude/spec-10" else []
        fields = args[args.index("--json") + 1].split(",")
        return [{field: pr[field] for field in fields} for pr in pulls]

    monkeypatch.setattr(notes, "gh", gh)
    monkeypatch.setattr(notes, "git", lambda *args: "2026-10-03T00:00:00+00:00")
    monkeypatch.setattr(sys, "argv", ["release-notes.py", "", "HEAD"])
    notes.main()
    return capsys.readouterr().out


def pull(number: int, head: str, closing: "list[int]") -> dict:
    return {
        "number": number, "title": f"Title {number}", "author": {"login": "app/claude"}, "headRefName": head,
        "closingIssuesReferences": [{"number": n} for n in closing],
    }


def test_a_pull_request_closing_several_issues_is_one_line_its_own_issue_first(monkeypatch, capsys):
    out = release_notes(monkeypatch, capsys, [pull(20, "claude/issue-11", [12, 11, 10])])
    assert out == (
        "## Changes and fixes\n\n"
        "- Title 20. Reported by @someone in #11, accepted by @leandersabel"
        "; Requested by @leandersabel in #10, spec approved by @leandersabel in #99"
        "; Opened by @github-actions[bot] in #12, implemented by @claude[bot] in #20.\n\n"
    )


@pytest.mark.parametrize("closing", [[], [10]])
def test_a_single_issue_line_is_unchanged(monkeypatch, capsys, closing):
    out = release_notes(monkeypatch, capsys, [pull(21, "claude/issue-10", closing)])
    assert out == (
        "## Changes and fixes\n\n"
        "- Title 21. Requested by @leandersabel in #10, spec approved by @leandersabel in #99"
        ", implemented by @claude[bot] in #21.\n\n"
    )
