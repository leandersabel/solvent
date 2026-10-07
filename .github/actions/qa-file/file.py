"""Files what a QA hunt recorded in qa-unfiled/ (CLAUDE.md, The loop,
Nightly and stable): a comment on the open `qa` issue a record repeats,
or else a new issue in line with `queued`, which no run clarifies
(CLAUDE.md, The loop, Findings). A finding is filed as a `bug` only with
the steps that reproduce it. Each record is deleted once handled, so a
rerun files nothing twice. With DISPATCH set, the queue starts, because
what the workflow's token does starts no workflow by itself. Needs `gh`
signed in to the repository.
"""
import glob
import json
import os
import subprocess

RATINGS = {f"severity: {rating}" for rating in ("low", "medium", "high", "critical")}


def gh(*args, body=None):
    return subprocess.run(["gh", *args], input=body, check=True, capture_output=True, text=True).stdout.strip()


def open_qa(number):
    try:
        issue = json.loads(gh("issue", "view", str(number), "--json", "state,labels"))
    except subprocess.CalledProcessError:
        return False
    return issue["state"] == "OPEN" and "qa" in {label["name"] for label in issue["labels"]}


def rate(rated):
    for label in rated:
        subprocess.run(["gh", "label", "create", label], capture_output=True)


def create(record, body, labels):
    rate(RATINGS.intersection(labels))
    flags = []
    for label in labels:
        flags += ["--label", label]
    gh("issue", "create", "--title", str(record["title"]), "--body-file", "-", *flags, body=body)


# QA's own words, so only its title, body, steps and comment pass, as
# data, with the labels it may set.
for path in sorted(glob.glob("qa-unfiled/*.json")):
    with open(path) as file:
        record = json.load(file)
    labels = record.get("labels") if type(record.get("labels")) is list else []
    rated = sorted(RATINGS.intersection(label for label in labels if type(label) is str))
    repeats = record.get("repeats")
    steps = record.get("steps")
    if type(repeats) is int and open_qa(repeats):
        # A repeat is recorded only when it rates the issue higher.
        rate(rated)
        for label in rated:
            gh("issue", "edit", str(repeats), "--add-label", label)
        gh("issue", "comment", str(repeats), "--body-file", "-", body=str(record["comment"]))
    elif type(steps) is list and steps and all(type(step) is str and step.strip() for step in steps):
        listed = "\n".join(f"{n}. {step}" for n, step in enumerate(steps, 1))
        create(record, f"{record['body']}\n\nSteps to reproduce:\n\n{listed}", ["bug", "qa", "queued", *rated])
    else:
        print(f"Not filed, no steps to reproduce it: {record.get('title')}")
    os.remove(path)

# A queue that could not be started is looked at again after the next
# run, so it never fails the hunt.
if os.environ.get("DISPATCH"):
    subprocess.run(["gh", "workflow", "run", "agent.yml", "--ref", "master", "-f", "issue=queue"])

if os.path.isdir("qa-unfiled") and not os.listdir("qa-unfiled"):
    os.rmdir("qa-unfiled")
