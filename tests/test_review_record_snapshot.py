"""Reviewer's checks of record-snapshot.md, written from its acceptance
criteria alone. The browser half is tests/browser/parts/update-values-review.mjs."""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from tests.helpers import REPO_ROOT

DECIMAL = (REPO_ROOT / "solvent" / "static" / "js" / "decimal.js").as_uri()

# Each case multiplies two scale-12 values whose exact product sits on the
# midpoint between two twelfth-decimal neighbours, so only half-even
# rounding yields every expected value. The module's address reaches the
# script as an argument.
MULTIPLY = """
const decimal = await import(process.argv[1]);
const cases = JSON.parse(process.argv[2]);
console.log(JSON.stringify(cases.map(([a, b]) => decimal.format(decimal.multiply(decimal.parse(a), decimal.parse(b))))));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_multiplying_rounds_half_even_at_the_twelfth_decimal():
    """Criterion 5: half-even on an exact midpoint, rounding down to an
    even digit and up to one, for either sign."""
    cases = {
        ("0.000000000005", "0.5"): "0.000000000002",
        ("0.000000000007", "0.5"): "0.000000000004",
        ("-0.000000000005", "0.5"): "-0.000000000002",
        ("-0.000000000007", "0.5"): "-0.000000000004",
        ("1.000000000005", "0.5"): "0.500000000002",
        ("1.000000000003", "0.5"): "0.500000000002",
    }
    result = subprocess.run(
        ["node", "--input-type=module", "-e", MULTIPLY, DECIMAL, json.dumps(list(cases))],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == list(cases.values())


ROUND_TRIP = """
const decimal = await import(process.argv[1]);
const rates = JSON.parse(process.argv[2]);
const holding = decimal.parse(process.argv[3]);
console.log(JSON.stringify(rates.map((rate) => [
  decimal.format(decimal.parse(rate)),
  decimal.format(decimal.multiply(holding, decimal.parse(rate))),
])));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_scale_12_holds_every_digit_a_proposal_carries():
    """Record shape, One scale for every quantity: a proposal at ten
    significant digits or twelve places reads back whole, and ten billion
    of a holding priced at it is the exact product."""
    proposals = ["0.000056640216", "0.9194556822", "0.000000000001", "142857142900", "3142.751234"]
    result = subprocess.run(
        ["node", "--input-type=module", "-e", ROUND_TRIP, DECIMAL, json.dumps(proposals), "10000000000"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == [
        ["0.000056640216", "566402.16"],
        ["0.9194556822", "9194556822"],
        ["0.000000000001", "0.01"],
        ["142857142900", "1428571429000000000000"],
        ["3142.751234", "31427512340000"],
    ]


DATES = REPO_ROOT / "tests" / "client" / "review-dates.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_only_a_recorded_day_is_written_or_counted():
    """Criteria 98, 99 and 100, and rate-lookup.md's `date` bullet: a
    figure or price at a date that does not exist or is still to come is
    refused before anything is encrypted or sent, a stored one counts
    toward nothing and its recording still opens, and today is the
    device's calendar day in any zone."""
    result = subprocess.run(["node", str(DATES), "records"], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, result.stdout + result.stderr
