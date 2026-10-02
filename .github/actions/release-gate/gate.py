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

QUERY = """
query($owner: String!, $name: String!, $states: [IssueState!], $since: DateTime, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(states: $states, filterBy: {since: $since}, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        timelineItems(itemTypes: [LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT], last: 100) {
          nodes {
            __typename
            ... on LabeledEvent { actor { login } label { name } }
            ... on UnlabeledEvent { actor { login } label { name } }
            ... on ClosedEvent { actor { login } closer { ... on PullRequest { mergeCommit { oid } } } }
          }
        }
      }
    }
  }
}"""


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def issues(state, since=""):
    variables = {"query": QUERY, "owner": OWNER, "name": NAME, "states": state, "since": since}
    while True:
        args = ["gh", "api", "graphql"]
        for key, value in variables.items():
            if value:
                args += ["-f", f"{key}={value}"]
        page = json.loads(run(*args))["data"]["repository"]["issues"]
        for issue in page["nodes"]:
            yield issue["number"], issue["timelineItems"]["nodes"]
        if not page["pageInfo"]["hasNextPage"]:
            return
        variables["after"] = page["pageInfo"]["endCursor"]


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


def fixed(events):
    """Closed by the client, or by a merged pull request the version holds."""
    closed = [event for event in events if event["__typename"] == "ClosedEvent"][-1]
    if actor(closed) == OWNER:
        return True
    merge = ((closed["closer"] or {}).get("mergeCommit") or {}).get("oid")
    return bool(merge) and subprocess.run(["git", "merge-base", "--is-ancestor", merge, COMMIT]).returncode == 0


since = os.environ["SINCE"] and run("git", "log", "-1", "--format=%cI", os.environ["SINCE"]).strip()
blocked = [f"- #{number}" for number, events in issues("OPEN") if rated_high(events)]
blocked += [
    f"- #{number} was closed without its fix in this version"
    for number, events in issues("CLOSED", since)
    if rated_high(events) and not fixed(events)
]
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
