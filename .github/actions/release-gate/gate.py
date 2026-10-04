"""Fails while something holds back the version at COMMIT (CLAUDE.md,
The loop, Severity, and Nightly and stable), and lists it in
release-blocked.txt. Issues closed since the SINCE tag, or ever when it
is empty, are checked for a fix in the version. Needs `gh` signed in to
the repository and the history of COMMIT.
"""
import json
import os
import subprocess
import sys

OWNER, NAME = os.environ["GITHUB_REPOSITORY"].split("/")
COMMIT = os.environ["COMMIT"]
# A rating label anyone else adds or removes changes nothing.
RATERS = {OWNER, "claude", "github-actions"}
BLOCKING = {"severity: high", "severity: critical"}

# GitHub returns timelines nested in an issue list incomplete, so each
# issue's timeline is read with a query of its own.
ISSUES = """
query($owner: String!, $name: String!, $states: [IssueState!], $since: DateTime, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(states: $states, filterBy: {since: $since}, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { number }
    }
  }
}"""
TIMELINE = """
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      timelineItems(itemTypes: [LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT], first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on LabeledEvent { actor { login } label { name } }
          ... on UnlabeledEvent { actor { login } label { name } }
          ... on ClosedEvent { actor { login } closer { ... on PullRequest { mergeCommit { oid } } } }
        }
      }
    }
  }
}"""


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def pages(query, path, **variables):
    """The nodes of every page of the connection at `path`, in order."""
    variables.update(query=query, owner=OWNER, name=NAME)
    while True:
        args = ["gh", "api", "graphql"]
        for key, value in variables.items():
            if value:
                args += ["-F" if isinstance(value, int) else "-f", f"{key}={value}"]
        page = json.loads(run(*args))["data"]["repository"]
        for key in path:
            page = page[key]
        yield from page["nodes"]
        if not page["pageInfo"]["hasNextPage"]:
            return
        variables["after"] = page["pageInfo"]["endCursor"]


def issues(state, since=""):
    for issue in pages(ISSUES, ["issues"], states=state, since=since):
        yield issue["number"], list(pages(TIMELINE, ["issue", "timelineItems"], number=issue["number"]))


def actor(event):
    return (event["actor"] or {}).get("login")


def rated_high(events):
    held = set()
    for event in events:
        label = (event.get("label") or {}).get("name", "")
        if label.startswith("severity: ") and actor(event) in RATERS:
            if event["__typename"] == "LabeledEvent":
                held.add(label)
            else:
                held.discard(label)
    return bool(held & BLOCKING)


def closed(events):
    """The issue's last closing, or None when its timeline holds none."""
    return next((event for event in reversed(events) if event["__typename"] == "ClosedEvent"), None)


def fixed(closing):
    """Closed by the client, or by a merged pull request the version holds."""
    if actor(closing) == OWNER:
        return True
    merge = ((closing["closer"] or {}).get("mergeCommit") or {}).get("oid")
    return bool(merge) and subprocess.run(["git", "merge-base", "--is-ancestor", merge, COMMIT]).returncode == 0


def main():
    since = os.environ["SINCE"] and run("git", "log", "-1", "--format=%cI", os.environ["SINCE"]).strip()
    blocked = [f"- #{number}" for number, events in issues("OPEN") if rated_high(events)]
    for number, events in issues("CLOSED", since):
        if not rated_high(events):
            continue
        closing = closed(events)
        if closing is None:
            blocked.append(f"- #{number} was closed, but its closing could not be read")
        elif not fixed(closing):
            blocked.append(f"- #{number} was closed without its fix in this version")
    alerts = json.loads(run(
        "gh", "api", "--paginate", "--slurp",
        f"repos/{OWNER}/{NAME}/dependabot/alerts?state=open&scope=runtime&severity=high,critical&per_page=100",
    ))
    blocked += [
        f"- Dependabot alert {alert['number']}: {alert['security_advisory']['summary']}"
        for page in alerts for alert in page
    ]

    if blocked:
        with open("release-blocked.txt", "w") as out:
            out.write("\n".join(blocked) + "\n")
        sys.exit("Held back by:\n" + "\n".join(blocked))


if __name__ == "__main__":
    main()
