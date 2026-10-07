"""Chooses the features a QA hunt covers (CLAUDE.md, The loop, Nightly
and stable). Prints for the workflow `features=<json>`, longest page
first.

A feature is a `spec/features/` page with a "What the client gets"
section. A hunt covers each feature whose page changed since BASE, the
commit of the last dev version, and each one a changed file names by its
page's path. Only the files the image or the harness holds count. One
that names none, no BASE, or FULL=true covers every feature.
"""
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
base = os.environ.get("BASE", "")


def touched():
    """The features changed since BASE, or None for every one."""
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        return None
    try:
        paths = git("diff", "--name-only", "--no-renames", base, "HEAD").splitlines()
    except subprocess.CalledProcessError:
        return None
    found = set()
    for path in paths:
        if path.startswith("spec/features/"):
            found |= {pathlib.Path(path).stem} & features.keys()
        elif CODE.match(path):
            # A deleted file names its features at BASE.
            commit = "HEAD" if pathlib.Path(path).exists() else base
            named = set(NAMES.findall(git("show", f"{commit}:{path}"))) & features.keys()
            if not named:
                return None
            found |= named
    return found


changed = None if os.environ.get("FULL") == "true" else touched()
hunt = set(features) if changed is None else changed
print("features=" + json.dumps(sorted(hunt, key=lambda name: (-features[name], name))))
