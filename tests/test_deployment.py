"""The container hardening the image itself has to carry
(spec/architecture.md, Tech stack).

Running the image is what proves it serves; these lock the
properties that would otherwise regress silently in the Dockerfile,
since nothing about a working build tells you the base drifted or the
process went back to root.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCKERFILE = (REPO_ROOT / "Dockerfile").read_text()
REQUIREMENTS = (REPO_ROOT / "requirements.txt").read_text()


def test_base_image_is_pinned_by_digest():
    from_line = next(
        line for line in DOCKERFILE.splitlines() if line.startswith("FROM ")
    )
    assert re.fullmatch(r"FROM python:\d+\.\d+-slim@sha256:[0-9a-f]{64}", from_line)


def test_the_image_does_not_run_as_root():
    users = re.findall(r"^USER (.+)$", DOCKERFILE, re.MULTILINE)
    assert users, "no USER instruction, so the image runs as root"
    assert users[-1].strip() not in ("root", "0")


def test_every_runtime_dependency_is_pinned():
    for line in REQUIREMENTS.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            assert "==" in line, f"unpinned runtime dependency: {line}"
