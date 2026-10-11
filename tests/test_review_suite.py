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


def stand_in_run(tmp_path: Path, modules: dict[str, str], workers: int, basetemp: bool = True) -> tuple[str, list[dict]]:
    suite = tmp_path / "suite"
    suite.mkdir()
    for name, source in {"spans.py": SPANS, "conftest.py": STAND_IN_CONFTEST, **modules}.items():
        (suite / name).write_text(source)
    log = tmp_path / "spans.jsonl"
    env = dict(os.environ, PYTHONPATH=str(REPO_ROOT), REVIEW_SPAN_LOG=str(log))
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "tests.conftest",
         "-n", str(workers), "--dist", "worksteal", *(["--basetemp", str(tmp_path / "base")] if basetemp else []), str(suite)],
        cwd=suite, env=env, capture_output=True, text=True, timeout=300,
    )
    spans = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    return done.stdout + done.stderr, spans


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
    output, spans = stand_in_run(tmp_path, modules, workers=4)
    assert "passed" in output and "failed" not in output and "error" not in output, output
    assert not clashes(spans), f"a Docker test ran while another worker had Chrome open: {clashes(spans)}"
    for where, own in OWN_WORK.items():
        first_docker = min((s for s in spans if s["kind"] == "docker" and s["where"] == where), key=lambda s: s["start"])
        asked = min(
            s["start"] for s in spans
            if s["kind"] == "asked" and s["where"] == where and s["worker"] == first_docker["worker"]
        )
        waited = first_docker["start"] - asked - own
        assert waited < 3, f"{where} waited {waited:.1f}s for its Docker test while browser tests kept starting"


def test_no_docker_test_overlaps_a_browser_under_the_default_temporary_directory(tmp_path):
    """Issue 552: a parallel run in pytest's own temporary directory, as
    the suite runs by default, keeps Docker tests and browser tests on
    other workers apart."""
    modules = {"test_a_docker.py": DOCKER_MODULE}
    modules.update({f"test_e_browser_{n}.py": BROWSER_MODULE for n in range(4)})
    output, spans = stand_in_run(tmp_path, modules, workers=4, basetemp=False)
    assert "passed" in output and "failed" not in output and "error" not in output, output
    assert len({s["worker"] for s in spans if s["kind"] == "chrome"}) > 1, spans
    assert not clashes(spans), f"a Docker test ran while another worker had Chrome open: {clashes(spans)}"


STARTS_A_SERIAL_PYTEST = """
import subprocess
import sys


def test_docker_starts_a_serial_pytest(python_image, tmp_path):
    inner = tmp_path / "test_inner.py"
    inner.write_text("def test_inner():\\n    pass\\n")
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "tests.conftest",
         "-n", "0", "-o", "addopts=", "--rootdir", str(tmp_path), str(inner)],
        cwd=tmp_path, capture_output=True, text=True, timeout=60,
    )
    assert done.returncode == 0, done.stdout + done.stderr
"""


def test_a_serial_pytest_started_inside_a_serial_docker_test_finishes(tmp_path):
    """Issue 552: a serial run, in pytest's own temporary directory,
    whose Docker test holds the lock starts a second serial pytest under
    the suite's conftest, which finishes rather than waiting on it."""
    output, _ = stand_in_run(tmp_path, {"test_a_nesting.py": STARTS_A_SERIAL_PYTEST}, workers=0, basetemp=False)
    assert "1 passed" in output and "failed" not in output, output


def test_a_session_fixture_is_refused_before_it_opens_chrome(tmp_path):
    """A session-scoped fixture is set up before its module's lock and
    lives past it, so a test using one fails before the fixture starts,
    and its Chrome never opens beside a Docker test."""
    modules = {"test_a_docker.py": LONG_DOCKER_MODULE, "test_d_session.py": SESSION_MODULE}
    output, spans = stand_in_run(tmp_path, modules, workers=2)
    assert "1 passed, 5 errors" in output, output
    assert "shared_browser outlives its module's network lock" in output, output
    assert [s["kind"] for s in spans if s["kind"] != "asked"] == ["docker"], spans


# Loaded into a run of the real tests that start gunicorn. Each launch
# is checked at the moment it starts: an address gunicorn binds itself
# is a port any other worker could take first, and a socket handed down
# must already hold its port in the test's own process.
PORT_AUDIT = """
import json
import os
import socket
import subprocess

OPTIONS = ("--bind", "-b")


def binds(args):
    found = []
    for i, token in enumerate(args):
        if token in OPTIONS and i + 1 < len(args):
            found.append(args[i + 1])
        elif token.startswith("--bind="):
            found.append(token.split("=", 1)[1])
        elif token.startswith("-b") and len(token) > 2 and not token.startswith("--"):
            found.append(token[2:])
    return found


def taken(family, host, port, reuse):
    other = socket.socket(family, socket.SOCK_STREAM)
    try:
        if reuse:
            other.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        other.bind((host, port))
    except OSError:
        return True
    finally:
        other.close()
    return False


def problem(args, pass_fds, env):
    if "bind" in (env or {}).get("GUNICORN_CMD_ARGS", ""):
        return "binds through GUNICORN_CMD_ARGS"
    addresses = binds(args)
    if not addresses:
        return "no bind, so gunicorn takes its fixed default port"
    for address in addresses:
        if address.startswith("unix:"):
            continue
        if not address.startswith("fd://"):
            host, _, port = address.rpartition(":")
            if not taken(socket.AF_INET, host.strip("[]") or "0.0.0.0", int(port), reuse=False):
                return f"{address} was free when gunicorn started, so another worker could take it"
            continue
        fd = int(address[len("fd://"):])
        if fd not in pass_fds:
            return f"{address} is not handed to the child"
        held = socket.socket(fileno=os.dup(fd))
        try:
            if held.type != socket.SOCK_STREAM or held.family not in (socket.AF_INET, socket.AF_INET6):
                return f"{address} is not a TCP socket"
            host, port = held.getsockname()[:2]
            if not port:
                return f"{address} holds no port"
            for reuse in (False, True):
                if not taken(held.family, host, port, reuse):
                    return f"{address} holds port {port} loosely: another socket bound it (SO_REUSEADDR {reuse})"
        finally:
            held.close()
    return None


class Audited(subprocess.Popen):
    def __init__(self, args, *rest, **kwargs):
        listed = [str(a) for a in args] if isinstance(args, (list, tuple)) else [str(args)]
        if any("gunicorn" in a for a in listed):
            entry = {
                "test": os.environ.get("PYTEST_CURRENT_TEST", ""),
                "problem": problem(listed, tuple(kwargs.get("pass_fds", ())), kwargs.get("env")),
            }
            with open(os.environ["REVIEW_PORT_LOG"], "a") as log:
                log.write(json.dumps(entry) + "\\n")
        super().__init__(args, *rest, **kwargs)


subprocess.Popen = Audited
"""


def gunicorn_test_files() -> list[str]:
    """Every test file that starts gunicorn, itself or through another
    file's helper."""
    return sorted(
        str(path.relative_to(REPO_ROOT)) for path in (REPO_ROOT / "tests").glob("test_*.py")
        if path.name != Path(__file__).name
        and "gunicorn" in (source := path.read_text())
        and ("subprocess" in source or "from tests.test_review_app_shell import" in source)
    )


def test_no_test_that_starts_gunicorn_can_lose_its_port_to_another_worker(tmp_path):
    """Issue 550: the real tests that start gunicorn, run in parallel,
    with every launch checked as it starts. A port the test only named,
    or a socket another bind could still share, fails the launch."""
    files = gunicorn_test_files()
    assert {"tests/test_deployment.py", "tests/test_review_app_shell.py"} <= set(files), files
    (tmp_path / "port_audit.py").write_text(PORT_AUDIT)
    log = tmp_path / "ports.jsonl"
    env = dict(
        os.environ,
        PYTHONPATH=os.pathsep.join([str(tmp_path), str(REPO_ROOT)]),
        REVIEW_PORT_LOG=str(log),
    )
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "port_audit",
         "-n", "2", "--basetemp", str(tmp_path / "base"), *files],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=600,
    )
    launches = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    assert launches, f"no gunicorn launch was seen:\n{done.stdout[-3000:]}"
    failing = [launch for launch in launches if launch["problem"]]
    assert not failing, failing
    assert done.returncode == 0, done.stdout[-5000:] + done.stderr[-2000:]
