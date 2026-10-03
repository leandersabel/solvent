"""The harness tools, as an MCP server over stdio
(spec/features/nightly-harness.md, The harness tools).

`qa` reaches the server through these and nothing else. Every tool has
a fixed name and argument shape, and no argument names a command, path,
container or URL: those come from this process's own arguments.

    env -i PATH=/usr/bin:/bin python3 mcp.py --container solvent --state <dir> --url http://localhost:8000
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

import prices

LOG_PAGE = 500
REQUEST_PAGE = 200
DOCKER_SECONDS = 60
START_WAIT_SECONDS = 60
SOURCES = ("frankfurter", "nbp")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PROTOCOL_FALLBACK = "2025-06-18"


def schema(properties: dict, required: "list[str] | None" = None) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


SINCE = {"type": "integer", "minimum": 0, "default": 0}

TOOLS = {
    "server_log": (
        "The app container's log, stdout and stderr merged: at most 500 lines from line `since`. Returns the lines and the `next` line to ask for.",
        schema({"since": SINCE}),
    ),
    "price_requests": (
        "Every request the price stand-in received since the walk began, in order: at most 200 with `seq` above `since`. Returns the requests and the `next` seq to ask for.",
        schema({"since": SINCE}),
    ),
    "price_source": (
        "Sets a price source up or down. A source that is down answers every request 503. Returns the modes now in force.",
        schema(
            {"source": {"enum": list(SOURCES)}, "state": {"enum": ["up", "down"]}},
            ["source", "state"],
        ),
    ),
    "known_prices": (
        "The prices the stand-in publishes: what the rate lookup must propose for a date and quote, whatever the sources' modes.",
        schema(
            {
                "date": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
                "quote": {"enum": prices.CURRENCIES},
            },
            ["date", "quote"],
        ),
    ),
    "app_stop": (
        "Stops the app. Its circuit breaker, which lives in memory, is reset by the next start.",
        schema({}),
    ),
    "app_start": (
        "Starts the app and waits until it answers.",
        schema({}),
    ),
}


class Refused(Exception):
    """An argument outside its schema, named."""

    def __init__(self, argument: str, reason: str) -> None:
        super().__init__(reason)
        self.argument = argument
        self.reason = reason


def check_arguments(name: str, arguments: object) -> dict:
    """Every argument checked before anything runs."""
    properties = TOOLS[name][1]["properties"]
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        raise Refused("arguments", "must be an object")
    for key in arguments:
        if key not in properties:
            raise Refused(key, "is not an argument of this tool")
    for key in TOOLS[name][1]["required"]:
        if key not in arguments:
            raise Refused(key, "is required")
    checked = {}
    for key, value in arguments.items():
        wanted = properties[key]
        if "enum" in wanted:
            if not isinstance(value, str) or value not in wanted["enum"]:
                raise Refused(key, "is not one of the allowed values")
        elif wanted["type"] == "integer":
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise Refused(key, "must be an integer of at least 0")
        else:
            checked_date(key, value)
        checked[key] = value
    return checked


def checked_date(key: str, value: object) -> None:
    try:
        if not isinstance(value, str) or not ISO_DATE.match(value):
            raise ValueError
        if date.fromisoformat(value) > datetime.now(timezone.utc).date():
            raise Refused(key, "is in the future")
    except ValueError:
        raise Refused(key, "must be a date, YYYY-MM-DD") from None


def text(document: object, error: bool = False) -> dict:
    result = {"content": [{"type": "text", "text": json.dumps(document)}]}
    if error:
        result["isError"] = True
    return result


class Harness:
    def __init__(self, container: str, state: Path, url: str) -> None:
        self.container = container
        self.state = state
        self.url = url
        self.requests_file = state / "requests.jsonl"
        self.modes_file = state / "modes.json"
        # What was there before the walk began is the probe's and the
        # setup's, and never reaches `qa`.
        self.start_count = len(self._request_lines())

    def docker(self, *args: str, merge: bool = False) -> subprocess.CompletedProcess:
        """An argument list, never a shell."""
        return subprocess.run(
            ["docker", *args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT if merge else subprocess.DEVNULL,
            timeout=DOCKER_SECONDS,
            check=False,
        )

    def _request_lines(self) -> "list[str]":
        try:
            return self.requests_file.read_text().splitlines()
        except OSError:
            return []

    def call(self, name: str, arguments: object) -> dict:
        try:
            checked = check_arguments(name, arguments)
        except Refused as refusal:
            return text({"error": f"{refusal.argument} {refusal.reason}", "argument": refusal.argument}, True)
        try:
            return getattr(self, f"tool_{name}")(**checked)
        except subprocess.TimeoutExpired:
            return text({"error": "docker did not answer in time"}, True)
        except OSError:
            return text({"error": "docker could not be run"}, True)

    def tool_server_log(self, since: int = 0) -> dict:
        done = self.docker("logs", self.container, merge=True)
        if done.returncode != 0:
            return text({"error": f"docker exited {done.returncode}"}, True)
        lines = done.stdout.decode("utf-8", "replace").splitlines()
        page = lines[since:since + LOG_PAGE]
        return text({"lines": page, "next": min(since, len(lines)) + len(page)})

    def tool_price_requests(self, since: int = 0) -> dict:
        floor = max(since, self.start_count)
        found = []
        for line in self._request_lines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if isinstance(entry, dict) and isinstance(entry.get("seq"), int) and entry["seq"] > floor:
                found.append(entry)
        page = found[:REQUEST_PAGE]
        return text({"requests": page, "next": page[-1]["seq"] if page else floor})

    def modes(self) -> "dict[str, str]":
        try:
            raw = json.loads(self.modes_file.read_text())
        except (OSError, ValueError):
            raw = {}
        raw = raw if isinstance(raw, dict) else {}
        return {source: "down" if raw.get(source) == "down" else "up" for source in SOURCES}

    def tool_price_source(self, source: str, state: str) -> dict:
        modes = {**self.modes(), source: state}
        descriptor, temporary = tempfile.mkstemp(dir=self.state, prefix=".modes-")
        with os.fdopen(descriptor, "w") as out:
            json.dump(modes, out)
        # The stand-in runs as another user's process in its container.
        os.chmod(temporary, 0o644)
        os.replace(temporary, self.modes_file)
        return text(modes)

    def tool_known_prices(self, date: str, quote: str) -> dict:
        return text({"date": date, "quote": quote, "rates": prices.known_table(date, quote)})

    def tool_app_stop(self) -> dict:
        done = self.docker("stop", "--time", "10", self.container)
        if done.returncode != 0:
            return text({"error": f"docker exited {done.returncode}"}, True)
        return text({"state": "stopped"})

    def tool_app_start(self) -> dict:
        done = self.docker("start", self.container)
        if done.returncode != 0:
            return text({"error": f"docker exited {done.returncode}"}, True)
        deadline = time.monotonic() + START_WAIT_SECONDS
        while time.monotonic() < deadline:
            if self.answers():
                return text({"state": "running"})
            time.sleep(1)
        return text({"state": "not answering"}, True)

    def answers(self) -> bool:
        try:
            with urllib.request.urlopen(f"{self.url}/login", timeout=3) as response:
                return response.status == 200
        except (OSError, ValueError):
            return False


def reply(harness: Harness, message: object) -> "dict | None":
    """The answer to one message, or None for a notification."""
    if not isinstance(message, dict) or not isinstance(message.get("method"), str):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request"}}
    if "id" not in message:
        return None
    ident, method = message["id"], message["method"]
    params = message.get("params")
    params = params if isinstance(params, dict) else {}

    def done(result: dict) -> dict:
        return {"jsonrpc": "2.0", "id": ident, "result": result}

    def failed(code: int, words: str) -> dict:
        return {"jsonrpc": "2.0", "id": ident, "error": {"code": code, "message": words}}

    if method == "initialize":
        version = params.get("protocolVersion")
        return done({
            "protocolVersion": version if isinstance(version, str) else PROTOCOL_FALLBACK,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "harness", "version": "1"},
        })
    if method == "ping":
        return done({})
    if method == "tools/list":
        return done({"tools": [
            {"name": name, "description": words, "inputSchema": shape}
            for name, (words, shape) in TOOLS.items()
        ]})
    if method == "tools/call":
        name = params.get("name")
        if name not in TOOLS:
            return failed(-32602, "unknown tool")
        return done(harness.call(name, params.get("arguments")))
    return failed(-32601, "method not found")


def serve(harness: Harness, source, sink) -> None:
    for line in source:
        if not line.strip():
            continue
        try:
            answer = reply(harness, json.loads(line))
        except ValueError:
            answer = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        if answer is not None:
            sink.write(json.dumps(answer) + "\n")
            sink.flush()


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(prog="mcp.py")
    parser.add_argument("--container", required=True)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--url", required=True)
    try:
        args = parser.parse_args(argv[1:])
    except SystemExit:
        return 2
    serve(Harness(args.container, args.state, args.url.rstrip("/")), sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
