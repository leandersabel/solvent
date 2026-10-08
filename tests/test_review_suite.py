"""The reviewer's own check that the suite holds under its own parallel
run, written without reading how it is kept so. A container's network
interface coming or going fails Chrome's requests in flight with
net::ERR_NETWORK_CHANGED, so no Chrome a test opens may be running
while another test changes the host's interfaces.
"""
from __future__ import annotations

import json
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


# Stand-in suites run under the real conftest. Their tests start neither
# Docker nor Chrome: each logs when it would have one running, and a
# fixture named as the real one marks a test as one that starts Docker.
SPANS = """
import json
import os
import time
from contextlib import contextmanager


def note(kind, where, start, end):
    entry = {"kind": kind, "where": where, "worker": os.environ["PYTEST_XDIST_WORKER"], "start": start, "end": end}
    with open(os.environ["REVIEW_SPAN_LOG"], "a") as log:
        log.write(json.dumps(entry) + "\\n")


@contextmanager
def span(kind, where):
    start = time.monotonic()
    yield
    note(kind, where, start, time.monotonic())
"""
STAND_IN_CONFTEST = """
import os
import time

import pytest

from spans import note


def pytest_runtest_logstart(nodeid, location):
    if "PYTEST_XDIST_WORKER" in os.environ:
        note("asked", nodeid.split(".py")[0], time.monotonic(), None)


@pytest.fixture
def python_image():
    return "stand-in"
"""
DOCKER_MODULE = """
import time

from spans import span


def test_a_browser_runs_first():
    with span("chrome", __name__):
        time.sleep(1.5)


def test_docker_first(python_image):
    with span("docker", __name__):
        time.sleep(0.3)


def test_docker_second(python_image):
    with span("docker", __name__):
        time.sleep(0.3)
"""
OPEN_FOR_ITS_LIFETIME = """
import time

import pytest

from spans import span


@pytest.fixture(scope="module")
def browser():
    with span("chrome", __name__):
        time.sleep(0.2)
        yield


@pytest.mark.parametrize("n", range(10))
def test_uses_the_open_browser(browser, n):
    time.sleep(0.1)
"""
MIXED_MODULE = """
import time

import pytest

from spans import span


@pytest.fixture(scope="module")
def dashboards():
    with span("chrome", __name__):
        time.sleep(0.5)


@pytest.mark.parametrize("n", range(5))
def test_reads_the_dashboards(dashboards, n):
    time.sleep(0.05)


def test_docker_beside_a_module_fixture(python_image):
    with span("docker", __name__):
        time.sleep(0.3)
"""
SESSION_MODULE = """
import time

import pytest

from spans import span


@pytest.fixture(scope="session")
def shared_browser():
    with span("chrome", __name__):
        time.sleep(2)


@pytest.mark.parametrize("n", range(5))
def test_uses_the_session_browser(shared_browser, n):
    time.sleep(0.05)
"""
BROWSER_MODULE = """
import time

import pytest

from spans import span


@pytest.mark.parametrize("n", range(30))
def test_opens_a_browser(n):
    with span("chrome", __name__):
        time.sleep(0.1)
"""
LONG_DOCKER_MODULE = """
import time

from spans import span


def test_docker(python_image):
    with span("docker", __name__):
        time.sleep(3)
"""
# Seconds of its own work a module does before its first Docker test.
OWN_WORK = {"test_a_docker": 1.5, "test_c_mixed": 0.75}


def stand_in_run(tmp_path: Path, modules: dict[str, str], workers: int) -> list[dict]:
    suite = tmp_path / "suite"
    suite.mkdir()
    for name, source in {"spans.py": SPANS, "conftest.py": STAND_IN_CONFTEST, **modules}.items():
        (suite / name).write_text(source)
    log = tmp_path / "spans.jsonl"
    env = dict(os.environ, PYTHONPATH=str(REPO_ROOT), REVIEW_SPAN_LOG=str(log))
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "tests.conftest",
         "-n", str(workers), "--dist", "worksteal", "--basetemp", str(tmp_path / "base"), str(suite)],
        cwd=suite, env=env, capture_output=True, text=True, timeout=300,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    return [json.loads(line) for line in log.read_text().splitlines()]


def clashes(spans: list[dict]) -> list[tuple[dict, dict]]:
    docker = [s for s in spans if s["kind"] == "docker"]
    chrome = [s for s in spans if s["kind"] == "chrome"]
    assert docker and chrome, spans
    return [
        (d, c) for d in docker for c in chrome
        if c["worker"] != d["worker"] and c["start"] < d["end"] and d["start"] < c["end"]
    ]


def test_no_docker_test_overlaps_a_browser_on_another_worker_and_none_waits_out_the_readers(tmp_path):
    """The lock's own rule, apart from the real suite: no Docker test
    runs while a test or a module fixture on another worker has Chrome
    open, the run ends without a deadlock, and a Docker test
    does not wait out every browser test still to come."""
    modules = {
        "test_a_docker.py": DOCKER_MODULE,
        "test_b_lifetime.py": OPEN_FOR_ITS_LIFETIME,
        "test_c_mixed.py": MIXED_MODULE,
    }
    modules.update({f"test_e_browser_{n}.py": BROWSER_MODULE for n in range(12)})
    spans = stand_in_run(tmp_path, modules, workers=4)
    assert not clashes(spans), f"a Docker test ran while another worker had Chrome open: {clashes(spans)}"
    for where, own in OWN_WORK.items():
        first_docker = min((s for s in spans if s["kind"] == "docker" and s["where"] == where), key=lambda s: s["start"])
        asked = min(
            s["start"] for s in spans
            if s["kind"] == "asked" and s["where"] == where and s["worker"] == first_docker["worker"]
        )
        waited = first_docker["start"] - asked - own
        assert waited < 3, f"{where} waited {waited:.1f}s for its Docker test while browser tests kept starting"


def test_a_session_fixture_opening_chrome_never_overlaps_a_docker_test(tmp_path):
    """A test whose session-scoped fixture opens Chrome has Chrome in
    flight as much as one that opens it in its body."""
    modules = {"test_a_docker.py": LONG_DOCKER_MODULE, "test_d_session.py": SESSION_MODULE}
    spans = stand_in_run(tmp_path, modules, workers=2)
    assert not clashes(spans), f"a Docker test ran while another worker had Chrome open: {clashes(spans)}"
