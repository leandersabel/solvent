"""The reviewer's own check that the suite holds under its own parallel
run, written without reading how it is kept so. A container's network
interface coming or going fails Chrome's requests in flight with
net::ERR_NETWORK_CHANGED, so no Chrome a test opens may be running
while another test changes the host's interfaces.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from tests.helpers import REPO_ROOT
from tests.test_browser import CHROME, needs_browser
from tests.test_review_nightly_harness import python_image  # noqa: F401

NET = Path("/sys/class/net")
DOCKER_TEST = (
    "tests/test_review_nightly_harness.py::"
    "test_the_probe_finds_no_route_out_on_an_internal_network_and_one_on_a_bridge"
)
# One test of each file that opens Chrome, in a test body or a fixture.
CHROME_TESTS = [
    "tests/test_browser.py::test_the_workflows_hold_in_a_browser[update-values-review-unquoted]",
    "tests/test_register_browser.py::test_the_registration_forms_answer_each_refusal_in_its_own_words",
    "tests/test_nightly_browser.py::test_the_generator_writes_every_output_and_the_manifest_covers_every_name",
    "tests/test_review_nightly_harness.py::test_every_dashboard_shows_the_manifest_figures_and_a_null_total_as_a_dash",
]


def descends_from(pid: str, ancestor: int) -> bool:
    while pid not in ("0", "1"):
        if pid == str(ancestor):
            return True
        try:
            stat = (Path("/proc") / pid / "stat").read_text()
        except OSError:
            return False
        pid = stat.rsplit(")", 1)[1].split()[1]
    return False


def chrome_open_under(ancestor: int) -> bool:
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            command = (entry / "cmdline").read_bytes().split(b"\0", 1)[0]
        except OSError:
            continue
        if command == bytes(CHROME) and descends_from(entry.name, ancestor):
            return True
    return False


@pytest.mark.skipif(not NET.is_dir(), reason="needs Linux")
@needs_browser
@pytest.mark.parametrize("chrome_test", CHROME_TESTS, ids=lambda t: t.split("::")[1])
def test_no_chrome_is_open_while_the_suite_changes_the_hosts_interfaces(chrome_test, python_image):
    """The Docker test and one that opens Chrome, run by the suite's own
    configuration, which starts them at once. The host's interfaces are
    sampled throughout, and every change is checked against any Chrome
    the run has open. Asking for the Docker test's image also skips
    where Docker is absent, and runs this alone in the suite around it,
    since the Docker test it starts changes the interfaces too."""
    run = subprocess.Popen(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-rs", DOCKER_TEST, chrome_test],
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    seen = set(os.listdir(NET))
    changes, clashes = 0, []
    deadline = time.monotonic() + 900
    while run.poll() is None and time.monotonic() < deadline:
        now = set(os.listdir(NET))
        if now != seen:
            changes += 1
            if chrome_open_under(run.pid):
                clashes.append(sorted(now ^ seen))
            seen = now
        time.sleep(0.02)
    if run.poll() is None:
        run.kill()
    output = run.communicate()[0]
    assert run.returncode == 0, output
    assert "2 passed" in output and "skipped" not in output, output
    assert changes, "the Docker test changed no interface, so nothing was checked"
    assert not clashes, f"interfaces changed while Chrome was open: {clashes}"
