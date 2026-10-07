"""Reviewer's tests: the image serves from one gthread process with more
request threads than lookups can hold, so requests held open as long
as every lookup slot can be leave the instance answering
(spec/features/app-shell.md, criteria 78 and 79; spec/architecture.md,
Tech stack, WSGI server). A start empties the rate cache and keeps the
schema version and everything else (Database, criterion 80). A request
gunicorn cannot read gets Solvent's Not Found card and headers, and no
log line keeps its address, its peer or gunicorn's reason (Error pages,
Requests Flask never sees, criteria 27, 77, 85 and 86; spec/
architecture.md, Storage & data handling). The factory starts one daemon
thread that prunes, on a connection that overwrites what it deletes,
and no test app's thread logs into a later test (Database, criteria 69
and 70).

Written from the spec alone. gunicorn runs with the Dockerfile's own
arguments, on loopback.
"""
from __future__ import annotations

import http.client
import logging
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from contextlib import ExitStack, contextmanager

import pytest
from gunicorn.config import Config

import solvent.rates as rates
from solvent.guard import navigation
from tests.helpers import CSRF, connect, register, rows
from tests.test_deployment import REPO_ROOT, image_command


def parsed(argv: "list[str]") -> Config:
    """gunicorn's own reading of the arguments, so a flag's spelling or a
    default cannot pass where the server would run otherwise."""
    config = Config()
    for name, value in vars(config.parser().parse_args(argv)).items():
        if value is not None and name != "args":
            config.set(name.lower(), value)
    return config


def test_the_image_runs_one_gthread_process_with_more_threads_than_lookups():
    """Criterion 78, read through gunicorn's parser."""
    config = parsed(image_command()[1:])

    assert config.worker_class_str == "gthread"
    assert config.workers == 1
    assert config.threads > rates.LOOKUP_CONCURRENCY


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def gunicorn(tmp_path, launcher: "list[str] | None" = None):
    """The image's gunicorn on a free loopback port, booted. Yields the
    port and the process, and leaves everything it printed on
    `process.output` once stopped."""
    port = free_port()
    argv = image_command()[1:]
    argv[argv.index("--bind") + 1] = f"127.0.0.1:{port}"
    env = dict(
        os.environ,
        SECRET_KEY="review-app-shell-key",
        DATABASE_PATH=str(tmp_path / "solvent.db"),
    )
    process = subprocess.Popen(
        [sys.executable, *(launcher or ["-m", "gunicorn"]), *argv],
        cwd=REPO_ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        for _ in range(300):
            try:
                assert sign_in_page(port, timeout=5) == 200
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError("gunicorn never served")
        yield port, process
    finally:
        process.terminate()
        out, err = process.communicate(timeout=60)
        process.output = out + err


def sign_in_page(port: int, timeout: float, headers: "dict | None" = None) -> int:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        connection.request("GET", "/login", headers=headers or {})
        return connection.getresponse().status
    finally:
        connection.close()


def stalled(port: int) -> socket.socket:
    """A sign-in request whose headers arrived and whose body stops
    halfway, which holds the request thread reading it."""
    body = b'{"username": "someone", "authKey": "' + b"A" * 200 + b'"}'
    connection = socket.create_connection(("127.0.0.1", port))
    connection.sendall(
        b"POST /api/auth/login HTTP/1.1\r\nHost: x\r\n"
        b"Content-Type: application/json\r\nX-Solvent-Request: 1\r\n"
        + f"Content-Length: {len(body)}\r\n\r\n".encode()
        + body[: len(body) // 2]
    )
    return connection


def worker_processes(master: int) -> "list[str]":
    found = subprocess.run(
        ["ps", "-o", "pid=", "--ppid", str(master)], capture_output=True, text=True
    )
    return found.stdout.split()


def test_the_image_starts_exactly_one_worker_process(tmp_path):
    """Criterion 78, observed on the running server: one process holds
    every in-memory bound."""
    with gunicorn(tmp_path) as (_, process):
        time.sleep(1)
        assert len(worker_processes(process.pid)) == 1


def test_requests_held_open_as_long_as_every_lookup_slot_leave_the_sign_in_page_answering(tmp_path):
    """Criterion 79."""
    with gunicorn(tmp_path) as (port, _), ExitStack() as held:
        for _ in range(rates.LOOKUP_CONCURRENCY):
            held.enter_context(stalled(port))
        time.sleep(1)

        assert sign_in_page(port, timeout=3) == 200


def test_the_control_holding_every_thread_does_stop_the_sign_in_page(tmp_path):
    """The control keeps criterion 79's test honest: a stalled body does
    hold a request thread, so holding every one stops the page, and
    letting them go serves it again."""
    threads = parsed(image_command()[1:]).threads
    with gunicorn(tmp_path) as (port, _):
        with ExitStack() as held:
            for _ in range(threads):
                held.enter_context(stalled(port))
            time.sleep(1)
            try:
                status = sign_in_page(port, timeout=3)
            except TimeoutError:
                status = None
            assert status is None
        assert sign_in_page(port, timeout=10) == 200


def started_again(app):
    from solvent import create_app

    return create_app(config_overrides={"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True})


def test_a_start_empties_the_rate_cache_and_keeps_everything_else(app):
    """Criterion 80: an entry an earlier build settled, at the rounding
    it used then, is gone after a start, while the schema version, the
    accounts and their sessions stay, and a second start changes
    nothing more."""
    register(app, "owner")
    conn = connect(app)
    with conn:
        conn.execute(
            "INSERT INTO rate_cache (symbol, quote, date, rate, as_of, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("USD", "CHF", "2026-07-31", "0.91945568", "2026-07-31", "frankfurter", "2026-08-02T00:00:00+00:00"),
        )
    conn.close()
    kept = ["PRAGMA user_version", "SELECT * FROM principals", "SELECT * FROM sessions", "SELECT * FROM vault_epochs"]
    before = [rows(app, sql) for sql in kept]

    for _ in range(2):
        started_again(app)
        assert rows(app, "SELECT * FROM rate_cache") == []
        assert [rows(app, sql) for sql in kept] == before


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_only_the_route_table_names_a_screen_inside_the_vault():
    """Criterion 83, against routes.js in Node: the table's addresses
    open, nothing else does, and a sweep only at a recorded day."""
    script = REPO_ROOT / "tests" / "client" / "review-dates.mjs"
    result = subprocess.run(["node", str(script), "addresses"], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr


PEER = "127.0.0.2"
TOKEN = "Q7reviewInviteToken"

# Each request gunicorn cannot read, named by what is wrong with it. The
# first six are criterion 85's. The rest are shapes gunicorn refuses on
# its own, which "an address of any length or shape that reaches Solvent
# is answered by Solvent" covers.
UNREADABLE = {
    "request line over the limit": b"GET /?a=" + TOKEN.encode() * 500 + b" HTTP/1.1\r\nHost: x\r\n\r\n",
    "invite address over the limit": (
        b"GET /register?invite=" + (TOKEN.encode() * 300)[:5000] + b" HTTP/1.1\r\nHost: x\r\n\r\n"
    ),
    "header over the limit": b"GET / HTTP/1.1\r\nHost: x\r\nX-Long: " + b"v" * 9000 + b"\r\n\r\n",
    "too many headers": b"GET / HTTP/1.1\r\nHost: x\r\n" + b"".join(
        b"X-H%d: v\r\n" % n for n in range(150)
    ) + b"\r\n",
    "invalid request line": b"NOT A REQUEST\r\n\r\n",
    "invalid header name": f"GET /register?invite={TOKEN} HTTP/1.1\r\nHost: x\r\nBad Header: v\r\n\r\n".encode(),
    "invalid HTTP version": f"GET /register?invite={TOKEN} HTTP/9.9\r\nHost: x\r\n\r\n".encode(),
    "invalid method": f"g@t /register?invite={TOKEN} HTTP/1.1\r\nHost: x\r\n\r\n".encode(),
    "invalid content length": b"POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ten\r\n\r\n",
    "obsolete line folding": b"GET / HTTP/1.1\r\nHost: x\r\nX-A: one\r\n two\r\n\r\n",
    "unsupported transfer coding": b"POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: rot13\r\n\r\n",
    "unmet expectation": b"GET / HTTP/1.1\r\nHost: x\r\nExpect: the-unexpected\r\n\r\n",
}

# Words of gunicorn's own reasons, any of which in the server's output
# shows its handler, or its message, still ran.
GUNICORN_REASONS = ("Invalid", "too large", "limit request", "Request Line", "Error handling", "Traceback")


def exchange(port: int, raw: bytes) -> http.client.HTTPResponse:
    """Send raw bytes from PEER and read the answer whole."""
    with socket.socket() as client:
        client.bind((PEER, 0))
        client.settimeout(10)
        client.connect(("127.0.0.1", port))
        client.sendall(raw)
        response = http.client.HTTPResponse(client)
        response.begin()
        response.body = response.read()
        return response


def comparable(response: http.client.HTTPResponse) -> dict:
    """The headers every response carries: all but the date, the
    connection's and gunicorn's own."""
    return {
        name: value
        for name, value in response.getheaders()
        if name.lower() not in ("date", "connection", "server")
    }


def test_an_unreadable_request_gets_the_not_found_card_and_every_header(tmp_path):
    """Criterion 85 and the Edge case: each request gunicorn cannot read
    is a Bad Request carrying exactly what an invented path's Not Found
    carries, and nothing of it reaches the output."""
    with gunicorn(tmp_path) as (port, process):
        not_found = exchange(port, b"GET /no/such/page HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
        answers = {shape: exchange(port, raw) for shape, raw in UNREADABLE.items()}
    assert not_found.status == 404
    assert not_found.getheader("Content-Security-Policy")
    assert not_found.getheader("Strict-Transport-Security")

    for shape, answer in answers.items():
        assert (shape, answer.status) == (shape, 400)
        assert answer.getheader("Connection") == "close", shape
        assert answer.getheader("Set-Cookie") is None, shape
        assert comparable(answer) == comparable(not_found), shape
        assert answer.body == not_found.body, shape

    for word in (TOKEN, PEER, *GUNICORN_REASONS):
        assert word not in process.output


def without_config(argv: "list[str]") -> "list[str]":
    at = argv.index("--config")
    return argv[:at] + argv[at + 2 :]


@pytest.mark.parametrize("level", ["error", "warning"])
def test_no_log_line_carries_the_peer_at_either_level(tmp_path, level):
    """Criterion 77: unreadable requests and a wrong Auth Key from PEER
    leave no trace of PEER, at the image's level and at warning."""
    argv = image_command()[1:]
    argv[argv.index("--log-level") + 1] = level
    output = provoke(tmp_path, argv)

    assert PEER not in output
    assert TOKEN not in output


def test_the_control_without_solvents_handler_does_log_the_peer(tmp_path):
    """Criterion 77's control: gunicorn's own handler, at warning, prints
    the peer, so the clean runs above saw the requests arrive."""
    argv = without_config(image_command()[1:])
    argv[argv.index("--log-level") + 1] = "warning"

    assert f"ip={PEER}" in provoke(tmp_path, argv)


def test_the_image_hands_gunicorn_solvents_server_config():
    """How it works, Requests Flask never sees: the image runs gunicorn
    with --config python:solvent.server."""
    assert parsed(image_command()[1:]).config == "python:solvent.server"


def provoke(tmp_path, argv: "list[str]") -> str:
    """Run gunicorn with argv on loopback, send it every unreadable
    request and a wrong Auth Key from PEER, and return all it printed."""
    port = free_port()
    argv[argv.index("--bind") + 1] = f"127.0.0.1:{port}"
    process = subprocess.Popen(
        [sys.executable, "-m", "gunicorn", *argv],
        cwd=REPO_ROOT,
        env=dict(os.environ, SECRET_KEY="review-app-shell-key", DATABASE_PATH=str(tmp_path / "solvent.db")),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    body = b'{"username": "nobody", "authKey": "AAAA"}'
    try:
        for _ in range(300):
            try:
                assert sign_in_page(port, timeout=5) == 200
                break
            except OSError:
                time.sleep(0.1)
        for raw in UNREADABLE.values():
            try:
                exchange(port, raw)
            except (OSError, http.client.HTTPException):
                pass
        exchange(
            port,
            b"POST /api/auth/login HTTP/1.1\r\nHost: x\r\nConnection: close\r\n"
            b"Content-Type: application/json\r\nX-Solvent-Request: 1\r\n"
            + b"Content-Length: %d\r\n\r\n" % len(body) + body,
        )
    finally:
        process.terminate()
        out, err = process.communicate(timeout=60)
    return out + err


@pytest.fixture
def server_error_body(app):
    """The body of a Server Error the app itself answers."""

    @app.route("/dashboard/__review_failure")
    @navigation
    def failure():
        raise RuntimeError("review failure")

    owner, _ = register(app, "owner")
    response = owner.get("/dashboard/__review_failure")
    assert response.status_code == 500
    return response.data


def test_a_failure_before_the_app_answers_is_the_failure_card_and_logs_only_its_class(
    app, server_error_body, tmp_path, monkeypatch, capfd
):
    """Criterion 86: a worker set up as the image sets it up, through
    solvent.server's post_worker_init, answers a failure outside the
    parser with a Server Error carrying the failure body and every
    header, and the log names the class and nothing of the request."""
    import solvent.server
    from gunicorn.config import Config
    from gunicorn.glogging import Logger
    from gunicorn.http.parser import RequestParser
    from gunicorn.workers.gthread import ThreadWorker

    monkeypatch.setenv("DATABASE_PATH", app.config["DATABASE_PATH"])
    config = parsed(image_command()[1:])
    config.set("worker_tmp_dir", str(tmp_path))
    log = Logger(config)
    worker = ThreadWorker(0, os.getpid(), [], None, 30, config, log)
    worker.wsgi = app
    solvent.server.post_worker_init(worker)
    seen = []
    catcher = logging.Handler()
    catcher.emit = lambda record: seen.append(logging.Formatter().format(record))
    for name in ("", "gunicorn.error", app.logger.name):
        logging.getLogger(name).addHandler(catcher)

    raw = f"GET /register?invite={TOKEN} HTTP/1.1\r\nHost: x\r\n\r\n".encode()
    request = next(RequestParser(config, [raw], ("203.0.113.9", 4711)))
    server_side, client_side = socket.socketpair()
    try:
        with client_side, server_side:
            try:
                raise LookupError(f"failure naming {TOKEN}")
            except LookupError as failure:
                worker.handle_error(request, server_side, ("203.0.113.9", 4711), failure)
            server_side.shutdown(socket.SHUT_WR)
            answer = http.client.HTTPResponse(client_side)
            answer.begin()
            body = answer.read()
    finally:
        for name in ("", "gunicorn.error", app.logger.name):
            logging.getLogger(name).removeHandler(catcher)

    flask_answer = app.test_client().get("/api/no-such-route", headers=CSRF)
    assert answer.status == 500
    assert body == server_error_body
    assert answer.getheader("Connection") == "close"
    assert answer.getheader("Set-Cookie") is None
    for header in ("Content-Security-Policy", "Strict-Transport-Security"):
        assert answer.getheader(header) == flask_answer.headers[header]
    printed = "\n".join(seen) + "".join(capfd.readouterr())
    assert "LookupError" in printed
    for leak in (TOKEN, "203.0.113.9", "failure naming", "Traceback"):
        assert leak not in printed


def test_every_response_shape_carries_one_csp_and_one_hsts(app):
    """Criterion 27: a shell page, a JSON endpoint, a Not Found and a
    Server Error carry the same CSP and the same HSTS, compared with
    each other rather than with the module's constant."""

    @app.route("/dashboard/__review_boom")
    @navigation
    def boom():
        raise RuntimeError("review boom")

    owner, _ = register(app, "owner")
    shapes = [
        owner.get("/dashboard"),
        owner.get("/api/records?type=account", headers=CSRF),
        owner.get("/no/such/page"),
        owner.get("/dashboard/__review_boom"),
    ]
    assert [r.status_code for r in shapes] == [200, 200, 404, 500]
    assert len({r.headers["Content-Security-Policy"] for r in shapes}) == 1
    assert len({r.headers["Strict-Transport-Security"] for r in shapes}) == 1
    assert "frame-ancestors 'none'" in shapes[0].headers["Content-Security-Policy"]
    assert "max-age=" in shapes[0].headers["Strict-Transport-Security"]


class Started(threading.Thread):
    """A thread the factory starts, kept rather than run, so its body
    runs only when a test calls it and never outlives the test."""

    kept: "list[Started]" = []

    def start(self):
        Started.kept.append(self)


class Stop(Exception):
    pass


def test_the_factory_starts_one_daemon_thread_whose_failed_pass_only_logs(
    tmp_path, monkeypatch, caplog
):
    """Criterion 69: create_app starts exactly one daemon thread. Its
    body, run with the minute between passes cut short, logs
    `attempts.prune_failed` and the exception's type alone on a vanished
    file, raises nothing out of the pass and creates no file."""
    import solvent.ratelimit as ratelimit
    from solvent import create_app

    monkeypatch.setenv("SECRET_KEY", secrets.token_hex(32))
    real_thread = threading.Thread
    monkeypatch.setattr(threading, "Thread", Started)
    monkeypatch.setattr(Started, "kept", [])
    database = tmp_path / "pruned.db"
    create_app({"DATABASE_PATH": str(database), "TESTING": True})
    assert len(Started.kept) == 1
    assert Started.kept[0].daemon

    database.unlink()
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) > 1:
            raise Stop

    monkeypatch.setattr(ratelimit.time, "sleep", sleep)
    ended = []

    def body():
        try:
            Started.kept[0].run()
        except Stop:
            ended.append(True)

    with caplog.at_level(logging.WARNING):
        runner = real_thread(target=body, daemon=True)
        runner.start()
        runner.join(5)
    assert ended, "the factory's thread made no pass within five seconds"
    assert sleeps[0] == 60
    failures = [r.getMessage() for r in caplog.records if "attempts.prune_failed" in r.getMessage()]
    assert failures == ["attempts.prune_failed OperationalError"]
    assert list(tmp_path.iterdir()) == []


def test_the_pruners_connection_deletes_with_secure_delete_on(app, monkeypatch):
    """Criterion 70: the pruner's own connection reads `PRAGMA
    secure_delete` as 1 when it deletes."""
    import sqlite3

    import solvent.ratelimit as ratelimit

    seen = []

    class Watched(sqlite3.Connection):
        def execute(self, sql, *args):
            if sql.lstrip().upper().startswith("DELETE"):
                seen.append(super().execute("PRAGMA secure_delete").fetchone()[0])
            return super().execute(sql, *args)

    real = sqlite3.connect
    monkeypatch.setattr(sqlite3, "connect", lambda *a, **k: real(*a, factory=Watched, **k))
    ratelimit.prune_pass(app)
    assert seen and set(seen) == {1}


LATER_TEST = '''
import os
import time

import solvent.ratelimit as ratelimit

# The minute between passes, compressed so the suite's own run fits.
ratelimit.PRUNE_INTERVAL_SECONDS = 0.05


def test_an_app_whose_file_goes_away(app):
    os.remove(app.config["DATABASE_PATH"])


def test_a_later_test_hears_nothing_of_it(caplog):
    time.sleep(1)
    assert "attempts.prune_failed" not in caplog.text
'''


def test_a_test_apps_pruner_never_logs_into_a_later_test(tmp_path):
    """Issue 429: the suite's `app` fixture leaves nothing behind that
    prunes, or logs, once its test has ended. Two tests run in order in
    one process under the suite's own conftest."""
    module = tmp_path / "test_later.py"
    module.write_text(LATER_TEST)
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "tests.conftest", "-n", "0", "-o", "addopts=",
         "-p", "no:cacheprovider", "--rootdir", str(tmp_path), str(module)],
        cwd=REPO_ROOT,
        env={**os.environ, "PYTHONPATH": str(REPO_ROOT)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
