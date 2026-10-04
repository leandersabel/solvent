"""Files what nightly QA recorded in qa-unfiled/ (CLAUDE.md, The loop,
Nightly and stable): a comment on the open `qa` issue a record repeats,
or else a new issue. A rated finding is filed in line, with `queued`
(CLAUDE.md, The loop, Findings). Each record is deleted once filed, so a
rerun files nothing twice. With DISPATCH set, each new issue without a
rating starts the loop, and so does the queue, because what the
workflow's token does starts no workflow by itself. Needs `gh` signed in
to the repository.
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


# QA's own words, so only its title, body and comment pass, as data,
# with the labels it may set.
for path in sorted(glob.glob("qa-unfiled/*.json")):
    with open(path) as file:
        record = json.load(file)
    repeats = record.get("repeats")
    if type(repeats) is int and open_qa(repeats):
        gh("issue", "comment", str(repeats), "--body-file", "-", body=str(record["comment"]))
    else:
        labels = [label for label in record.get("labels", []) if label in RATINGS | {"bug", "qa", "accepted"}]
        rated = RATINGS.intersection(labels)
        for label in rated:
            subprocess.run(["gh", "label", "create", label], capture_output=True)
        if rated:
            labels.append("queued")
        flags = []
        for label in labels:
            flags += ["--label", label]
        url = gh("issue", "create", "--title", str(record["title"]), "--body-file", "-", *flags, body=str(record["body"]))
        if not rated and os.environ.get("DISPATCH"):
            gh("workflow", "run", "agent.yml", "--ref", "master", "-f", f"issue={url.rsplit('/', 1)[1]}")
    os.remove(path)

# A queue that could not be started is looked at again after the next
# run, so it never fails the night.
if os.environ.get("DISPATCH"):
    subprocess.run(["gh", "workflow", "run", "agent.yml", "--ref", "master", "-f", "issue=queue"])

if os.path.isdir("qa-unfiled") and not os.listdir("qa-unfiled"):
    os.rmdir("qa-unfiled")
