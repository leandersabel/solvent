"""Leaves an issue for a failed nightly or candidate (CLAUDE.md, The
loop, Nightly and stable): unless open rated problems already say why,
a `bug` named after the stage and the cause, or a comment on the open
one. A new issue starts the
loop at once. Needs `gh` signed in to the repository.
"""
import json
import os
import re
import subprocess

STEPS = json.loads(os.environ["STEPS"])
# The earlier jobs, by id.
NEEDS = json.loads(os.environ["NEEDS"])
STAGE = os.environ.get("STAGE", "nightly")
TODAY = os.environ["TODAY"]
RUN = os.environ["RUN"]
# The stage's jobs and steps in order, by id, and what it means when one
# fails.
CAUSES = {
    "decide": "it could not tell what to build",
    "fix": "the image to walk is not a verified nightly",
    "build": "the image did not build or could not be verified",
    "walk": "QA did not finish",
    "walked": "QA did not finish",
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
failed.update(job for job, result in NEEDS.items() if result.get("result") in ("failure", "cancelled"))
failed = next((step for step in CAUSES if step in failed), None)
cause = CAUSES.get(failed, "the run failed")
detail = ""
if failed == "gate" and os.path.exists("release-blocked.txt"):
    with open("release-blocked.txt") as file:
        detail = file.read()
    if all(re.fullmatch(r"- #\d+", line) for line in detail.splitlines()):
        print("Held back by open rated problems:\n" + detail)
        raise SystemExit
    cause = "a closed problem or a security alert holds it back"
elif failed == "gate" and os.path.exists("release-gate.err"):
    # The traceback's last line names the read that failed.
    with open("release-gate.err") as file:
        detail = "It could not read:\n\n" + (file.read().strip().splitlines() or [""])[-1]

title = f"The {STAGE} failed: {cause}"
found = json.loads(gh("issue", "list", "--state", "open", "--author", "app/github-actions",
                      "--search", f'in:title "{title}"', "--json", "number,title"))
found = [issue["number"] for issue in found if issue["title"] == title]
if found:
    gh("issue", "comment", str(found[0]), "--body-file", "-", body=f"Failed again on {TODAY}: {RUN}\n\n{detail}")
else:
    create(title, f"The {STAGE} {TODAY} failed: {cause}. {RUN}\n\n{detail}", ["bug"])
