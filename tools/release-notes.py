"""Release notes from the pull requests merged between two refs.

    python3 tools/release-notes.py <since tag, or "" for the start> <until ref>

Written from the pull requests and issues alone, without a model, so
the notes say exactly what merged and who did what (CLAUDE.md, The
loop, Nightly and stable). Needs `gh` signed in to the repository.
"""
import json
import re
import subprocess
import sys

CLIENT = "leandersabel"


def gh(*args):
    return json.loads(subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout)


def login(user):
    """A GitHub App shows as `app/<name>` here and as `<name>[bot]` on
    GitHub."""
    name = user["login"]
    return f"{name[4:]}[bot]" if name.startswith("app/") else name


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def issue_line(issue_number):
    issue = gh("issue", "view", str(issue_number), "--json", "author,labels")
    author = login(issue["author"])
    if author == CLIENT:
        origin = f"Requested by @{author} in #{issue_number}"
    elif author == "github-actions[bot]":
        origin = f"Opened by @{author} in #{issue_number}"
    else:
        origin = f"Reported by @{author} in #{issue_number}, accepted by @{CLIENT}"
    # The spec may have merged in an earlier version than its code.
    spec = gh("pr", "list", "--state", "merged", "--head", f"claude/spec-{issue_number}", "--json", "number")
    if spec:
        origin += f", spec approved by @{CLIENT} in #{spec[0]['number']}"
    labels = {label["name"] for label in issue["labels"]}
    group = "Found by QA" if "qa" in labels else "Maintenance" if "maintenance" in labels else "Changes and fixes"
    return origin, group


def main():
    since, until = sys.argv[1], sys.argv[2]
    # Both ends by commit date, so a pull request lands in exactly one
    # version's notes.
    search = f"is:merged base:master merged:<={git('log', '-1', '--format=%cI', until)}"
    if since:
        search += f" merged:>{git('log', '-1', '--format=%cI', since)}"
    merged = gh("pr", "list", "--state", "merged", "--limit", "500", "--search", search,
                "--json", "number,title,author,headRefName")

    groups = {"Changes and fixes": [], "Found by QA": [], "Maintenance": []}
    for pr in sorted(merged, key=lambda pr: pr["number"]):
        author = login(pr["author"])
        found = re.fullmatch(r"claude/issue-(\d+)", pr["headRefName"])
        if found:
            origin, group = issue_line(int(found.group(1)))
            groups[group].append(f"- {pr['title']}. {origin}, implemented by @{author} in #{pr['number']}.")
        elif not pr["headRefName"].startswith("claude/spec-"):
            groups["Maintenance"].append(f"- {pr['title']}, by @{author} in #{pr['number']}.")

    for heading, lines in groups.items():
        if lines:
            print(f"## {heading}\n")
            print("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
