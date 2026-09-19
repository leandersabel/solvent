"""The client-side rules, run in Node so one `pytest` covers both
halves of the product.

What is asserted here is what two implementations would otherwise
drift on: the AAD bytes, the decimal rounding mode, and the key
derivation.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

RUNNER = Path(__file__).resolve().parent / "client" / "run.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_client_side_rules_hold():
    result = subprocess.run(
        ["node", str(RUNNER)], capture_output=True, text=True, timeout=180
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAIL" not in result.stdout, result.stdout
