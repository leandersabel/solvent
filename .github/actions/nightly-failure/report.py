"""Leaves an issue for a failed night (CLAUDE.md, The loop, Nightly and
stable): unless open rated problems already say why, a `bug` named
after the cause, or a comment on the open one. A new issue starts the
loop at once. Needs `gh` signed in to the repository.
"""
import json
import os
import re
import subprocess

STEPS = json.loads(os.environ["STEPS"])
# The earlier jobs, each with its failed steps' ids as output `failed`.
NEEDS = json.loads(os.environ["NEEDS"])
TODAY = os.environ["TODAY"]
RUN = os.environ["RUN"]
# The nightly's steps in order, by id, and what it means when one fails.
CAUSES = {
    "suite": "the test suite failed",
    "sources": "a real price source answers in a changed shape",
    "app": "the image did not build or start",
    "plan": "QA could not plan its walk",
    "image": "the image QA got is not the one built",
    "harness": "the harness did not start",
    "qa": "QA did not finish",
    "qa-done": "QA did not finish",
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


failed = {step for step, result in STEPS.items() if result.get("outcome") in ("failure", "cancelled")}
for job in NEEDS.values():
    failed.update(job.get("outputs", {}).get("failed", "").split())
failed = next((step for step in CAUSES if step in failed), None)
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
