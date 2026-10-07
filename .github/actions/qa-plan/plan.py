"""Chooses tonight's QA walk and splits it into shards that run at once
(CLAUDE.md, The loop, Nightly and stable). Prints for the workflow
`shards=<json>` and `record=<json>`, which a night whose walk completes
keeps as qa-walked.json, for the next night and for promotion.

A feature is a `spec/features/` page with a "What the client gets"
section. Tonight walks each feature whose page changed since the commit
the last completed walk covered, each one a changed file names by its
page's path, and the one walked longest ago. Only the files the image
or the harness holds count. One that names none, no record of a last
walk, or FULL=true walks every feature.
"""
import datetime
import json
import os
import pathlib
import re
import subprocess

CLIENT_FACING = "\n## What the client gets\n"
NAMES = re.compile(r"spec/features/([a-z0-9-]+)\.md")
CODE = re.compile(r"(app\.py|requirements\.txt|Dockerfile|\.dockerignore)$|(solvent|tools/nightly)/")


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True, errors="replace").stdout


pages = {path.stem: path.read_text() for path in pathlib.Path("spec/features").glob("*.md")}
features = {name: len(text.splitlines()) for name, text in pages.items() if CLIENT_FACING in text}
saved = pathlib.Path("qa-walked.json")
record = json.loads(saved.read_text()) if saved.exists() else {}
if not re.fullmatch(r"[0-9a-f]{40}", str(record.get("commit"))):
    record = {}
walked = {name: day for name, day in record.get("walked", {}).items() if name in features}


def touched():
    """The features changed since the last walk, or None for every one."""
    try:
        paths = git("diff", "--name-only", "--no-renames", record["commit"], "HEAD").splitlines()
    except (KeyError, subprocess.CalledProcessError):
        return None
    found = set()
    for path in paths:
        if path.startswith("spec/features/"):
            found |= {pathlib.Path(path).stem} & features.keys()
        elif CODE.match(path):
            # A deleted file names its features in the commit walked last.
            commit = "HEAD" if pathlib.Path(path).exists() else record["commit"]
            named = set(NAMES.findall(git("show", f"{commit}:{path}"))) & features.keys()
            if not named:
                return None
            found |= named
    return found


changed = None if os.environ.get("FULL") == "true" else touched()
if changed is None:
    walk = set(features)
else:
    rest = sorted(features.keys() - changed, key=lambda name: (walked.get(name, ""), name))
    walk = changed | set(rest[:1])

# Each feature is a shard of its own, so it has the QA step's whole time
# limit to itself. The longest page starts first, should runners be short.
shards = sorted(walk, key=lambda name: (-features[name], name))
today = os.environ.get("TODAY") or datetime.date.today().isoformat()
print("shards=" + json.dumps([{"id": i, "features": [name]} for i, name in enumerate(shards, 1)]))
record = {"commit": git("rev-parse", "HEAD").strip(), "every": walk == features.keys(), "walked": walked | dict.fromkeys(walk, today)}
print("record=" + json.dumps(record))
