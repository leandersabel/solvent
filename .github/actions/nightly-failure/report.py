"""Leaves an issue for a failed nightly or candidate (CLAUDE.md, The
loop, Nightly and stable): a `bug` named after the stage and the cause,
or a comment on the open one. A new issue starts the loop at once.
Needs `gh` signed in to the repository.
"""
import json
import os
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
    "fix": "the image is not a verified nightly",
    "build": "the image did not build or could not be verified",
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
title = f"The {STAGE} failed: {cause}"
found = json.loads(gh("issue", "list", "--state", "open", "--author", "app/github-actions",
                      "--search", f'in:title "{title}"', "--json", "number,title"))
found = [issue["number"] for issue in found if issue["title"] == title]
if found:
    gh("issue", "comment", str(found[0]), "--body-file", "-", body=f"Failed again on {TODAY}: {RUN}")
else:
    create(title, f"The {STAGE} {TODAY} failed: {cause}. {RUN}", ["bug"])
