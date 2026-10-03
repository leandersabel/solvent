"""The container hardening the image itself has to carry
(spec/architecture.md, Tech stack).

Running the image is what proves it serves; these lock the
properties that would otherwise regress silently in the Dockerfile,
since nothing about a working build tells you the base drifted or the
process went back to root.
"""
from __future__ import annotations

import http.client
import json
import os
import re
import socket
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tests.helpers import CSRF, register_body

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


def test_the_image_holds_the_app_and_nothing_of_the_tests_or_tools():
    """Both files are read: a COPY of the whole context would pass the
    ignore list until the list changed, and the list alone would pass a
    COPY of the whole context."""
    sources = [
        line.split()[1:-1]
        for line in DOCKERFILE.splitlines()
        if line.startswith("COPY ")
    ]
    assert sorted(sum(sources, [])) == ["app.py", "requirements.txt", "solvent"]
    ignored = (REPO_ROOT / ".dockerignore").read_text().splitlines()
    assert {"tests", "tools"} <= set(ignored)


def test_every_runtime_dependency_is_pinned():
    for line in REQUIREMENTS.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            assert "==" in line, f"unpinned runtime dependency: {line}"


def image_command() -> "list[str]":
    """The argument vector of the image's CMD."""
    cmd = re.search(r"^CMD (\[.*?\])$", DOCKERFILE.replace("\\\n", ""), re.MULTILINE)
    return json.loads(cmd.group(1))


def test_gunicorn_logs_no_address_agent_referrer_or_query_and_only_errors():
    command = image_command()
    assert command[command.index("--access-logformat") + 1] == (
        '%(t)s "%(m)s %(U)s" %(s)s %(b)s %(M)s'
    )
    assert command[command.index("--log-level") + 1] == "error"


PEER = "127.0.0.2"


def serve_and_provoke(tmp_path, *, log_level: "str | None" = None) -> str:
    """Run gunicorn with the image's arguments on loopback, send it
    requests it cannot parse and a wrong Auth Key from PEER, and return
    everything it printed."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    argv = image_command()[1:]
    argv[argv.index("--bind") + 1] = f"127.0.0.1:{port}"
    if log_level:
        argv[argv.index("--log-level") + 1] = log_level
    env = dict(
        os.environ,
        SECRET_KEY="deployment-test-key",
        DATABASE_PATH=str(tmp_path / "solvent.db"),
    )
    server = subprocess.Popen(
        [sys.executable, "-m", "gunicorn", *argv],
        cwd=REPO_ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )

    def send(raw: bytes) -> None:
        with socket.socket() as client:
            client.bind((PEER, 0))
            client.settimeout(10)
            client.connect(("127.0.0.1", port))
            client.sendall(raw)
            try:
                while client.recv(4096):
                    pass
            except OSError:
                pass

    try:
        for _ in range(200):
            try:
                send(b"GET /login HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
                break
            except OSError:
                time.sleep(0.1)
        body = json.dumps({"username": "nobody", "authKey": "AAAA"}).encode()
        send(b"NOT A REQUEST\r\n\r\n")
        send(b"GET / HTTP/1.1\r\nBad Header: x\r\n\r\n")
        send(b"GET /" + b"a" * 9000 + b" HTTP/1.1\r\n\r\n")
        send(
            b"POST /api/auth/login HTTP/1.1\r\nHost: x\r\nConnection: close\r\n"
            b"Content-Type: application/json\r\nX-Solvent-Request: 1\r\n"
            + f"Content-Length: {len(body)}\r\n\r\n".encode() + body
        )
    finally:
        server.terminate()
        out, err = server.communicate(timeout=60)
    return out + err


def test_no_server_log_line_carries_the_peer_address(tmp_path):
    """The control keeps the test honest: at warning gunicorn prints the
    peer on a request it cannot parse, so a clean run at the image's
    level shows the flag and not a request that never arrived."""
    assert f"ip={PEER}" in serve_and_provoke(tmp_path, log_level="warning")
    assert PEER not in serve_and_provoke(tmp_path)


def test_no_invite_token_reaches_the_containers_standard_output_or_error(tmp_path):
    """The real gunicorn, started with the image's arguments, over both
    ways to make an invite and every state /register can answer. Read
    only after it stops, so a late line is still a line."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    argv = image_command()[1:]
    argv[argv.index("--bind") + 1] = f"127.0.0.1:{port}"
    database = str(tmp_path / "solvent.db")
    env = dict(os.environ, SECRET_KEY="deployment-test-key", DATABASE_PATH=database)

    def cli(*args: str) -> str:
        done = subprocess.run(
            [sys.executable, "-m", "flask", "--app", "app", "create-invite", *args],
            cwd=REPO_ROOT, env=env, capture_output=True, text=True, timeout=60, check=True,
        )
        return done.stdout.strip().split("invite=")[-1]

    def call(method: str, path: str, body=None, cookie: "str | None" = None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        headers = dict(CSRF, **({"Cookie": cookie} if cookie else {}))
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = connection.getresponse()
        data = response.read()
        set_cookie = response.getheader("Set-Cookie")
        connection.close()
        return response.status, data, set_cookie.split(";")[0] if set_cookie else cookie

    def register_with(token: str, username: str, kind: str = "vault_owner"):
        body = register_body(None, kind, inviteToken=token, username=username)
        status, _, cookie = call("POST", "/api/register", body)
        assert status == 200
        return cookie

    first = cli("--kind", "administrator")
    server = subprocess.Popen(
        [sys.executable, "-m", "gunicorn", *argv],
        cwd=REPO_ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        for _ in range(200):
            try:
                call("GET", "/login")
                break
            except OSError:
                time.sleep(0.1)
        admin_cookie = register_with(first, "root", "administrator")

        def create() -> dict:
            status, data, _ = call(
                "POST", "/api/admin/invites", {"kind": "vault_owner"}, admin_cookie
            )
            assert status == 201
            return json.loads(data)

        valid, used, expired, revoked = (create() for _ in range(4))
        from_cli = cli("--kind", "vault-owner", "--force")
        register_with(used["token"], "used")
        assert call("POST", f"/api/admin/invites/{revoked['id']}/revoke", None, admin_cookie)[0] == 200
        connection = sqlite3.connect(database)
        connection.execute(
            "UPDATE invites SET expires_at = ? WHERE id = ?",
            ((datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds"), expired["id"]),
        )
        connection.commit()
        connection.close()

        tokens = [first, from_cli, *(i["token"] for i in (valid, used, expired, revoked))]
        for token in (valid["token"], used["token"], expired["token"], revoked["token"], "unknown-token"):
            call("GET", f"/register?invite={token}")
        register_with(valid["token"], "valid")
    finally:
        server.terminate()
        out, err = server.communicate(timeout=60)

    assert 'GET /register' in out, "the access log held no /register line to inspect"
    for token in tokens:
        assert token not in out + err
