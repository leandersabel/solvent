"""The price stand-in (spec/features/nightly-harness.md, The stand-in).

Answers as the two price sources under their real names, over TLS, from
the known prices in prices.py. Every request is recorded before it is
answered, and a source can be set down through <state>/modes.json.

    python standin.py --cert <leaf.pem> --key <leaf.key> --state <dir> [--port 443]
"""
from __future__ import annotations

import argparse
import json
import re
import signal
import io
import ssl
import sys
import threading
import time
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

import prices

BODY_LOG_BYTES = 64 * 1024
BODY_READ_BYTES = 1024 * 1024
LINE_BYTES = 64 * 1024
NBP_MAX_SPAN = timedelta(days=93)
JSON_TYPE = "application/json; charset=utf-8"
TEXT_TYPE = "text/plain; charset=utf-8"

FX_PATH = re.compile(r"^/v1/(\d{4}-\d{2}-\d{2})$")
NBP_PATH = re.compile(r"^/api/cenyzlota/(\d{4}-\d{2}-\d{2})/(\d{4}-\d{2}-\d{2})$")
HOSTS = {"api.frankfurter.dev": "frankfurter", "api.nbp.pl": "nbp"}


def parse_day(text: str) -> "date | None":
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


class State:
    """The state directory: the modes in force and the request list."""

    def __init__(self, directory: Path) -> None:
        self.modes_file = directory / "modes.json"
        self.requests_file = directory / "requests.jsonl"
        self.lock = threading.Lock()
        self.seq = 0
        if self.requests_file.exists():
            with self.requests_file.open("rb") as existing:
                self.seq = sum(1 for _ in existing)

    def modes(self) -> "dict[str, str]":
        """Absent, unreadable or malformed, both sources are up."""
        try:
            raw = json.loads(self.modes_file.read_text())
            if not isinstance(raw, dict):
                raise ValueError
        except (OSError, ValueError):
            raw = {}
        return {source: "down" if raw.get(source) == "down" else "up" for source in ("frankfurter", "nbp")}

    def record(self, entry: dict) -> None:
        with self.lock:
            self.seq += 1
            line = json.dumps({"seq": self.seq, **entry}, ensure_ascii=True)
            with self.requests_file.open("a") as out:
                out.write(line + "\n")


def answer(host: str, method: str, target: str, today: "date | None" = None) -> "tuple[int, str, bytes]":
    """The status, content type and body for a request to a source that
    is up, from the routing table of the spec."""
    source = HOSTS[host]
    split = urlsplit(target)
    query = parse_qsl(split.query, keep_blank_values=True)
    if source == "frankfurter":
        found = FX_PATH.match(split.path) if method == "GET" else None
        day = parse_day(found.group(1)) if found else None
        if day and len(query) == 1 and query[0][0] == "base" and query[0][1] in prices.REF and day >= prices.FRANKFURTER_START:
            published = prices.last_publication_day("frankfurter", day, today)
            rates = prices.frankfurter_rates(published, query[0][1])
            body = {
                "amount": 1.0,
                "base": query[0][1],
                "date": published.isoformat(),
                "rates": {code: prices.json_number(rate) for code, rate in rates.items()},
            }
            return 200, JSON_TYPE, json.dumps(body).encode()
        return 404, JSON_TYPE, json.dumps({"message": "not found"}).encode()

    found = NBP_PATH.match(split.path) if method == "GET" else None
    first, last = (parse_day(found.group(1)), parse_day(found.group(2))) if found else (None, None)
    if first and last and query == [("format", "json")]:
        if first > last or last - first > NBP_MAX_SPAN:
            return 400, TEXT_TYPE, b"Bad Request"
        days = prices.publication_days("nbp", first, last, today)
        if not days:
            return 404, TEXT_TYPE, b"Not Found - Brak danych"
        body = [{"data": day.isoformat(), "cena": prices.json_number(prices.nbp_cena(day))} for day in days]
        return 200, JSON_TYPE, json.dumps(body).encode()
    return 404, TEXT_TYPE, b"Not Found"


class HeaderList:
    """The few things the handler asks of a header block, for one that
    was only partly read."""

    def __init__(self, pairs: "list[list[str]]") -> None:
        self.pairs = pairs

    def get(self, name: str, default=None):
        return next((value for key, value in self.pairs if key.lower() == name.lower()), default)

    def items(self):
        return self.pairs


class Handler(BaseHTTPRequestHandler):
    server: "Standin"
    protocol_version = "HTTP/1.1"
    timeout = 10

    def setup(self) -> None:
        # The handshake runs here, in the connection's own thread, so a
        # client that stalls in it stalls nobody else.
        self.request.settimeout(self.timeout)
        self.request = self.server.context.wrap_socket(self.request, server_side=True)
        super().setup()

    def handle_one_request(self) -> None:
        self.close_connection = True
        deadline = time.monotonic() + self.timeout
        buffer, complete = self._read(b"", b"\r\n\r\n", deadline, LINE_BYTES)
        if not buffer:
            return
        if not complete:
            # Stalled or over the limit: what was read is still a request.
            self._record_partial(buffer, 431 if len(buffer) >= LINE_BYTES else 408)
            return
        head, _, rest = buffer.partition(b"\r\n\r\n")
        first, _, fields = head.partition(b"\r\n")
        self.raw_requestline = first + b"\r\n"
        self.rfile = io.BytesIO(fields + b"\r\n\r\n")
        if len(first) >= LINE_BYTES:
            self.send_error(414)
            return
        if not self.parse_request():
            return
        try:
            length = max(0, int(self.headers.get("Content-Length") or 0))
        except ValueError:
            length = 0
        body, whole = self._read(rest, None, deadline, min(length, BODY_READ_BYTES))
        if not whole:
            self._send(408, TEXT_TYPE, b"", "up", body)
            return
        self.respond(body)

    def _read(self, buffer: bytes, marker: "bytes | None", deadline: float, limit: int) -> "tuple[bytes, bool]":
        """Reads until `marker` is in the buffer, or `limit` bytes are,
        or the deadline passes. Whether it got what it waited for."""
        while True:
            if marker is not None and marker in buffer:
                return buffer, True
            if marker is None and len(buffer) >= limit:
                return buffer[:limit], True
            if len(buffer) >= limit:
                return buffer, False
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return buffer, False
            try:
                self.request.settimeout(remaining)
                chunk = self.request.recv(65536)
            except OSError:
                return buffer, False
            if not chunk:
                return buffer, False
            buffer += chunk

    def _record_partial(self, buffer: bytes, status: int) -> None:
        """A request whose head never finished: the lines that did."""
        lines = buffer.decode("latin-1").split("\r\n")
        words = lines[0].split()
        fields = [[name, value.strip()] for name, colon, value in (line.partition(":") for line in lines[1:]) if colon]
        self.raw_requestline = lines[0].encode("latin-1")
        self.request_version = self.protocol_version
        self.headers = HeaderList(fields)
        self.command = words[0] if words else ""
        self.path = words[1] if len(words) > 1 else ""
        self._send(status, TEXT_TYPE, b"", "up", b"")

    def respond(self, body: bytes) -> None:
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        source = HOSTS.get(host)
        mode = self.server.state.modes()[source] if source else "up"
        if source is None:
            status, kind, payload = 421, TEXT_TYPE, b""
        elif mode == "down":
            status, kind, payload = 503, TEXT_TYPE, b""
        else:
            status, kind, payload = answer(host, self.command, self.path)
        self._send(status, kind, payload, mode, body)

    def send_error(self, code, message=None, explain=None) -> None:
        """What could not be parsed is still a request, recorded with
        what could be read and the status as sent."""
        self._send(code, TEXT_TYPE, b"", "up", b"")

    def _send(self, status: int, kind: str, payload: bytes, mode: str, body: bytes) -> None:
        self.close_connection = True
        words = (getattr(self, "raw_requestline", b"") or b"").decode("latin-1").split()
        headers = getattr(self, "headers", None)
        self.server.state.record({
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sni": getattr(self.request, "sni", None),
            "host": (headers.get("Host") or "") if headers else "",
            "method": getattr(self, "command", None) or (words[0] if words else ""),
            "target": getattr(self, "path", None) or (words[1] if len(words) > 1 else ""),
            "headers": [list(pair) for pair in headers.items()] if headers else [],
            "body": body[:BODY_LOG_BYTES].decode("latin-1"),
            "mode": mode,
            "status": status,
        })
        try:
            self.request.settimeout(self.timeout)
            self.send_response_only(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)
        except OSError:
            # The client went away, and the line is already written.
            pass

    def log_message(self, *_args) -> None:
        """The request list is the log."""


class Standin(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, context: ssl.SSLContext, state: State) -> None:
        self.context = context
        self.state = state
        super().__init__(address, Handler)

    def handle_error(self, request, client_address) -> None:
        """A failed handshake or a dropped connection is no request."""


def make_context(cert: str, key: str) -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(cert, key)

    def remember(socket, name, _context) -> None:
        socket.sni = name

    context.sni_callback = remember
    return context


def main(argv: "list[str]") -> int:
    parser = argparse.ArgumentParser(prog="standin.py")
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--port", type=int, default=443)
    try:
        args = parser.parse_args(argv[1:])
    except SystemExit:
        return 2
    server = Standin(("0.0.0.0", args.port), make_context(args.cert, args.key), State(Path(args.state)))
    # PID 1 in a container ignores SIGTERM unless it has a handler.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print(f"standin listening on {server.server_address[1]}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
