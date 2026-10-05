"""Reviewer's tests: the image serves from one gthread process with more
request threads than lookups can hold, so requests held open as long
as every lookup slot can be leave the instance answering
(spec/features/app-shell.md, criteria 78 and 79; spec/architecture.md,
Tech stack, WSGI server).

Written from the spec alone. gunicorn runs with the Dockerfile's own
arguments, on loopback.
"""
from __future__ import annotations

import http.client
import os
import socket
import subprocess
import sys
import time
from contextlib import ExitStack, contextmanager

from gunicorn.config import Config

import solvent.rates as rates
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
