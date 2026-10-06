"""Reviewer's checks of net-worth-view.md, written from its acceptance
criteria alone. The browser half is tests/browser/parts/dashboard-review-*.mjs."""
from __future__ import annotations

import shutil
import subprocess

import pytest

from tests.helpers import REPO_ROOT

CHART_END = REPO_ROOT / "tests" / "client" / "review-chart-end.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_chart_ends_today_and_every_range_counts_back_from_it():
    """Ranges and modes, a one-day history, and criteria 48, 49 and 76:
    the chart's last day is the device's today or a later archive, each
    range counts back from it to no earlier than the oldest snapshot,
    and the last figure runs level to the end."""
    result = subprocess.run(["node", str(CHART_END)], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAIL" not in result.stdout, result.stdout
