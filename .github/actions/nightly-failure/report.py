"""Leaves an issue for a failed night (CLAUDE.md, The loop, Nightly and
stable): files what QA could not, then, unless open rated problems
already say why, a `bug` named after the cause, or a comment on the
open one. Each new issue starts the loop at once. Needs `gh` signed in
to the repository.
"""
import glob
import json
import os
import re
import subprocess

STEPS = json.loads(os.environ["STEPS"])
TODAY = os.environ["TODAY"]
RUN = os.environ["RUN"]
RATINGS = {f"severity: {rating}" for rating in ("low", "medium", "high", "critical")}
# The nightly's steps in order, by id, and what it means when one fails.
CAUSES = {
    "suite": "the test suite failed",
    "app": "the image did not build or start",
    "qa": "QA did not finish",
    "qa-done": "QA did not finish or could not file what it found",
    "gate": "the release check could not run",
    "publish": "publishing failed",
}


def gh(*args, body=None):
    return subprocess.run(["gh", *args], input=body, check=True, capture_output=True, text=True).stdout.strip()


def create(title, body, labels):
    flags = []
    for label in labels:
        flags += ["--label", label]
    url = gh("issue", "create", "--title", title, "--body-file", "-", *flags, body=body)
    gh("workflow", "run", "agent.yml", "--ref", "master", "-f", f"issue={url.rsplit('/', 1)[1]}")


# QA's own words, so only its title and body pass, as data, with the
# labels it may set.
for path in sorted(glob.glob("qa-unfiled/*.json")):
    with open(path) as file:
        issue = json.load(file)
    labels = [label for label in issue.get("labels", []) if label in RATINGS | {"bug", "qa", "accepted"}]
    for label in RATINGS.intersection(labels):
        subprocess.run(["gh", "label", "create", label], capture_output=True)
    create(str(issue["title"]), str(issue["body"]), labels)

failed = next((step for step in CAUSES if STEPS.get(step, {}).get("outcome") in ("failure", "cancelled")), None)
cause = CAUSES.get(failed, "the run failed before its tests")
detail = ""
if failed == "gate" and os.path.exists("release-blocked.txt"):
    with open("release-blocked.txt") as file:
        detail = file.read()
    if all(re.fullmatch(r"- #\d+", line) for line in detail.splitlines()):
        print("Held back by open rated problems:\n" + detail)
        raise SystemExit
    cause = "a closed problem or a security alert holds it back"

title = f"The nightly failed: {cause}"
found = json.loads(gh("issue", "list", "--state", "open", "--author", "app/github-actions",
                      "--search", f'in:title "{title}"', "--json", "number,title"))
found = [issue["number"] for issue in found if issue["title"] == title]
if found:
    gh("issue", "comment", str(found[0]), "--body-file", "-", body=f"Failed again on {TODAY}: {RUN}\n\n{detail}")
else:
    create(title, f"The {TODAY} nightly failed: {cause}. {RUN}\n\n{detail}", ["bug"])
