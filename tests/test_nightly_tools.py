"""The nightly harness's pure parts (spec/features/nightly-harness.md,
Acceptance criteria): the certificate authority, the stand-in and its
request list, the known prices, the relay, the source checks, the
dating-back patch and the harness tools.

What needs Docker's networks stays with the nightly itself: the probe's
missing route out and the trust store's mount at /etc/ssl/certs.
tests/test_nightly_browser.py runs the generator in a real browser.
"""
from __future__ import annotations

import ast
import contextlib
import io
import json
import os
import re
import shutil
import signal
import socket
import sqlite3
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from tests.helpers import CSRF, REPO_ROOT, mint_invite, register

TOOLS = REPO_ROOT / "tools" / "nightly"
FIXTURES = TOOLS / "fixtures"
sys.path.insert(0, str(TOOLS))

import mcp  # noqa: E402
import patch  # noqa: E402
import prices  # noqa: E402
import relay  # noqa: E402
import sources  # noqa: E402
import standin  # noqa: E402

import solvent.rates as rates  # noqa: E402

needs_openssl = pytest.mark.skipif(shutil.which("openssl") is None, reason="needs the openssl command line")


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def openssl(*args: str) -> str:
    return subprocess.run(["openssl", *args], capture_output=True, text=True, check=True).stdout


# ---- The certificate authority -----------------------------------------


@pytest.fixture(scope="module")
def pki(tmp_path_factory):
    out = tmp_path_factory.mktemp("pki") / "tls"
    scratch = tmp_path_factory.mktemp("scratch")
    done = subprocess.run(
        [sys.executable, str(TOOLS / "ca.py"), str(out)],
        env=dict(os.environ, TMPDIR=str(scratch)), capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 0, done.stderr
    return out, scratch


def text_of(path: Path) -> str:
    return openssl("x509", "-in", str(path), "-noout", "-text")


@needs_openssl
def test_the_ca_writes_exactly_its_outputs_and_no_other_private_key(pki):
    out, scratch = pki
    files = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())
    digest = openssl("x509", "-in", str(out / "ca.pem"), "-noout", "-subject_hash").strip()
    assert files == sorted(["ca.pem", "leaf.pem", "leaf.key", "trust/ca-certificates.crt", f"trust/{digest}.0"])
    assert (out / "leaf.key").stat().st_mode & 0o777 == 0o600
    for name in ("ca-certificates.crt", f"{digest}.0"):
        assert (out / "trust" / name).read_bytes() == (out / "ca.pem").read_bytes()
    # No private key anywhere but leaf.key, in the output or in the
    # temporary directory the script was given.
    keys = [
        path for root in (out, scratch) for path in root.rglob("*")
        if path.is_file() and b"PRIVATE KEY" in path.read_bytes()
    ]
    assert keys == [out / "leaf.key"]
    assert not list(scratch.iterdir())


@needs_openssl
def test_every_certificate_field_reads_back_as_the_table_says(pki):
    out, _ = pki
    ca_text, leaf_text = text_of(out / "ca.pem"), text_of(out / "leaf.pem")
    for certificate in (ca_text, leaf_text):
        assert "Signature Algorithm: ecdsa-with-SHA256" in certificate
        assert "Public-Key: (256 bit)" in certificate and "prime256v1" in certificate
        assert "Issuer: CN = Solvent nightly CA" in certificate
    assert "Subject: CN = Solvent nightly CA" in ca_text
    assert "Subject: CN = api.frankfurter.dev" in leaf_text

    for name in ("ca.pem", "leaf.pem"):
        path = str(out / name)
        serial = openssl("x509", "-in", path, "-noout", "-serial").strip().split("=")[1]
        assert len(serial) == 32 and int(serial, 16) >= 1 << 120
        dates = dict(
            line.split("=", 1) for line in openssl("x509", "-in", path, "-noout", "-dates").split("\n") if line
        )
        stamp = lambda text: datetime.strptime(text, "%b %d %H:%M:%S %Y %Z")  # noqa: E731
        assert stamp(dates["notAfter"]) - stamp(dates["notBefore"]) <= timedelta(days=1)

    # Constraints are read apart from the table's other lines.
    assert re.search(r"Basic Constraints: critical\s+CA:TRUE, pathlen:0", ca_text)
    assert re.search(r"Key Usage: critical\s+Certificate Sign, CRL Sign", ca_text)
    assert "Extended Key Usage" not in ca_text and "Subject Alternative Name" not in ca_text
    assert "Subject Key Identifier" in ca_text and "Authority Key Identifier" not in ca_text
    assert re.search(
        r"Name Constraints: critical\s+Permitted:\s+DNS:api.frankfurter.dev\s+DNS:api.nbp.pl\s+"
        r"Excluded:\s+IP:0.0.0.0/0.0.0.0\s+IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0",
        ca_text,
    )
    assert re.search(r"Basic Constraints: critical\s+CA:FALSE", leaf_text)
    assert re.search(r"Key Usage: critical\s+Digital Signature", leaf_text)
    assert re.search(r"Extended Key Usage:\s+TLS Web Server Authentication", leaf_text)
    assert re.search(r"Subject Alternative Name:\s+DNS:api.frankfurter.dev, DNS:api.nbp.pl", leaf_text)
    assert "Subject Key Identifier" in leaf_text and "Authority Key Identifier" in leaf_text
    assert "Name Constraints" not in leaf_text


@needs_openssl
def test_a_failed_signing_leaves_no_key_and_no_output(tmp_path):
    """The key must be gone when signing fails, not only when it works."""
    shim = tmp_path / "bin"
    shim.mkdir()
    real = shutil.which("openssl")
    (shim / "openssl").write_text(
        f'#!/bin/sh\ncase "$*" in *-CAkey*) exit 1;; esac\nexec {real} "$@"\n'
    )
    (shim / "openssl").chmod(0o755)
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    out = tmp_path / "tls"
    done = subprocess.run(
        [sys.executable, str(TOOLS / "ca.py"), str(out)],
        env=dict(os.environ, PATH=f"{shim}:{os.environ['PATH']}", TMPDIR=str(scratch)),
        capture_output=True, text=True, timeout=120,
    )
    assert done.returncode == 1
    assert not list(scratch.rglob("*")) and not out.exists()


@needs_openssl
@pytest.mark.parametrize("name", ["SIGTERM", "SIGINT"])
def test_a_signal_during_signing_still_deletes_the_keys(tmp_path, name):
    shim = tmp_path / "bin"
    shim.mkdir()
    marker = tmp_path / "signing"
    real = shutil.which("openssl")
    (shim / "openssl").write_text(
        f'#!/bin/sh\ncase "$*" in *-CAkey*) touch {marker}; exec sleep 60;; esac\nexec {real} "$@"\n'
    )
    (shim / "openssl").chmod(0o755)
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    out = tmp_path / "tls"
    process = subprocess.Popen(
        [sys.executable, str(TOOLS / "ca.py"), str(out)],
        env=dict(os.environ, PATH=f"{shim}:{os.environ['PATH']}", TMPDIR=str(scratch)),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(300):
        if marker.exists():
            break
        time.sleep(0.1)
    assert marker.exists() and list(scratch.rglob("*.key")), "never reached signing with keys on disk"
    process.send_signal(getattr(signal, name))
    assert process.wait(timeout=30) != 0
    assert not list(scratch.rglob("*")) and not out.exists()


def test_the_ca_refuses_a_directory_that_is_not_empty(tmp_path):
    (tmp_path / "something").write_text("x")
    done = subprocess.run([sys.executable, str(TOOLS / "ca.py"), str(tmp_path)], capture_output=True, text=True)
    assert done.returncode == 2


# ---- The stand-in -------------------------------------------------------


class Standin:
    def __init__(self, pki_dir: Path, state: Path) -> None:
        self.pki, self.state, self.port = pki_dir, state, free_port()
        self.process = None
        self.context = ssl.create_default_context(cafile=str(pki_dir / "ca.pem"))
        self.context.minimum_version = ssl.TLSVersion.TLSv1_2

    def start(self) -> None:
        self.process = subprocess.Popen(
            [
                sys.executable, str(TOOLS / "standin.py"), "--cert", str(self.pki / "leaf.pem"),
                "--key", str(self.pki / "leaf.key"), "--state", str(self.state), "--port", str(self.port),
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for _ in range(200):
            with contextlib.suppress(OSError):
                socket.create_connection(("127.0.0.1", self.port), timeout=1).close()
                return
            time.sleep(0.05)
        raise AssertionError("the stand-in did not come up")

    def stop(self) -> None:
        self.process.terminate()
        self.process.wait(timeout=10)

    def connect(self, name: str) -> ssl.SSLSocket:
        raw = socket.create_connection(("127.0.0.1", self.port), timeout=10)
        return self.context.wrap_socket(raw, server_hostname=name)

    def send(self, raw: bytes, sni: str = "api.nbp.pl") -> "tuple[int, dict, bytes]":
        with self.connect(sni) as tls:
            tls.sendall(raw)
            data = b""
            with contextlib.suppress(OSError):
                while chunk := tls.recv(65536):
                    data += chunk
        head, _, body = data.partition(b"\r\n\r\n")
        lines = head.decode("latin-1").split("\r\n")
        headers = dict(line.split(": ", 1) for line in lines[1:])
        return int(lines[0].split()[1]), headers, body

    def get(self, host: str, target: str, method: str = "GET"):
        return self.send(f"{method} {target} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode(), host if host in standin.HOSTS else "api.nbp.pl")

    def requests(self) -> "list[dict]":
        return [json.loads(line) for line in (self.state / "requests.jsonl").read_text().splitlines()]


@pytest.fixture
def server(pki, tmp_path):
    running = Standin(pki[0], tmp_path)
    running.start()
    yield running
    if running.process.poll() is None:
        running.stop()


@needs_openssl
@pytest.mark.parametrize("name", ["api.frankfurter.dev", "api.nbp.pl"])
def test_a_default_python_context_trusts_the_stand_in_under_both_names(server, name):
    with server.connect(name) as tls:
        assert tls.version() in ("TLSv1.2", "TLSv1.3")


@needs_openssl
@pytest.mark.parametrize("name", ["example.com", "localhost", "api.nbp.pl.evil.test", "frankfurter.dev"])
def test_the_handshake_fails_under_any_other_name(server, name):
    with pytest.raises(ssl.SSLCertVerificationError):
        server.connect(name)


@needs_openssl
def test_the_stand_in_answers_every_row_of_the_table(server):
    # A weekend request is answered at the preceding Friday.
    status, headers, body = server.get("api.frankfurter.dev", "/v1/2026-07-25?base=CHF")
    answer = json.loads(body)
    assert status == 200 and headers["Content-Type"] == "application/json; charset=utf-8"
    assert answer["date"] == "2026-07-24" and answer["base"] == "CHF" and answer["amount"] == 1.0
    assert set(answer["rates"]) == set(prices.CURRENCIES) - {"CHF"}
    assert answer["rates"] == {
        code: prices.json_number(rate) for code, rate in prices.frankfurter_rates("2026-07-24", "CHF").items()
    }
    # A table lists a currency from its own first day, and a base before its
    # own first day is Not Found.
    answer = json.loads(server.get("api.frankfurter.dev", "/v1/1999-06-30?base=CHF")[2])
    assert "USD" in answer["rates"] and not {"BRL", "CNY", "ILS", "INR"} & set(answer["rates"])
    assert server.get("api.frankfurter.dev", "/v1/2000-01-12?base=BRL")[0] == 404
    assert "USD" in json.loads(server.get("api.frankfurter.dev", "/v1/2000-01-13?base=BRL")[2])["rates"]
    for target in ("/v1/1998-12-31?base=CHF", "/v1/2026-07-24?base=XXX", "/v1/2026-07-24", "/v2/2026-07-24?base=CHF",
                   "/v1/2026-07-24?base=CHF&x=1", "/v1/2026-13-45?base=CHF"):
        status, headers, body = server.get("api.frankfurter.dev", target)
        assert (status, json.loads(body)) == (404, {"message": "not found"}), target
        assert headers["Content-Type"] == "application/json; charset=utf-8"

    status, headers, body = server.get("api.nbp.pl", "/api/cenyzlota/2026-07-20/2026-07-27?format=json")
    assert status == 200 and headers["Content-Type"] == "application/json; charset=utf-8"
    assert [row["data"] for row in json.loads(body)] == [
        "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-27"
    ]
    assert json.loads(body)[0]["cena"] == prices.json_number(prices.nbp_cena("2026-07-20"))
    # No weekday in range, a reversed range and one over 93 days.
    status, headers, body = server.get("api.nbp.pl", "/api/cenyzlota/2026-07-25/2026-07-26?format=json")
    assert (status, body, headers["Content-Type"].split(";")[0]) == (404, b"Not Found - Brak danych", "text/plain")
    status, _, body = server.get("api.nbp.pl", "/api/cenyzlota/2026-07-27/2026-07-20?format=json")
    assert (status, body) == (400, b"Bad Request")
    assert server.get("api.nbp.pl", "/api/cenyzlota/2026-01-01/2026-04-05?format=json")[0] == 400
    assert server.get("api.nbp.pl", "/api/cenyzlota/2026-01-01/2026-04-04?format=json")[0] == 200
    for target in ("/api/cenyzlota/2026-07-20/2026-07-27", "/api/cenyzlota/2026-07-20?format=json", "/x"):
        status, _, body = server.get("api.nbp.pl", target)
        assert (status, body) == (404, b"Not Found"), target
    assert server.get("api.nbp.pl", "/api/cenyzlota/2026-07-20/2026-07-27?format=json", "POST")[0] == 404
    # Whatever the method, Frankfurter's refusal is its own JSON.
    status, headers, body = server.get("api.frankfurter.dev", "/v1/2026-07-24?base=CHF", "POST")
    assert (status, json.loads(body), headers["Content-Type"]) == (404, {"message": "not found"}, "application/json; charset=utf-8")
    # Any other host, whatever name the handshake used.
    status, _, body = server.get("example.org", "/v1/2026-07-24?base=CHF")
    assert (status, body) == (421, b"")


@needs_openssl
def test_a_source_that_is_down_answers_503_and_is_still_recorded(server):
    (server.state / "modes.json").write_text(json.dumps({"frankfurter": "down", "nbp": "up"}))
    status, _, body = server.get("api.frankfurter.dev", "/v1/2026-07-24?base=CHF")
    assert (status, body) == (503, b"")
    assert server.get("api.nbp.pl", "/api/cenyzlota/2026-07-20/2026-07-27?format=json")[0] == 200
    down, up = server.requests()
    assert (down["mode"], down["status"]) == ("down", 503)
    assert (up["mode"], up["status"]) == ("up", 200)

    (server.state / "modes.json").write_text(json.dumps({"nbp": "down"}))
    assert server.get("api.frankfurter.dev", "/v1/2026-07-24?base=CHF")[0] == 200
    assert server.get("api.nbp.pl", "/api/cenyzlota/2026-07-20/2026-07-27?format=json")[0] == 503


@needs_openssl
@pytest.mark.parametrize("content", [None, "{not json", "[]", '"down"', '{"nbp": "sideways"}'])
def test_modes_that_are_absent_or_malformed_leave_both_sources_up(server, content):
    if content is not None:
        (server.state / "modes.json").write_text(content)
    assert server.get("api.frankfurter.dev", "/v1/2026-07-24?base=CHF")[0] == 200
    assert server.get("api.nbp.pl", "/api/cenyzlota/2026-07-20/2026-07-27?format=json")[0] == 200


@needs_openssl
def test_every_request_is_a_line_with_every_field_and_seq_continues_across_a_restart(server):
    body = bytes(range(256))
    server.send(
        b"POST /v1/2026-07-24?base=CHF HTTP/1.1\r\nHost: api.frankfurter.dev\r\nX-Twice: a\r\n"
        b"user-agent: Probe\r\nX-Twice: b\r\nContent-Length: 256\r\nConnection: close\r\n\r\n" + body,
        "api.frankfurter.dev",
    )
    # What cannot be parsed is still a request.
    server.send(b"NOT A REQUEST\r\n\r\n")
    server.send(b"GET / HTTP/9.9\r\nHost: api.nbp.pl\r\n\r\n")
    server.stop()
    server.start()
    server.get("api.nbp.pl", "/api/cenyzlota/2026-07-20/2026-07-27?format=json")

    lines = server.requests()
    assert [line["seq"] for line in lines] == [1, 2, 3, 4]
    for line in lines:
        assert set(line) == {"seq", "at", "sni", "host", "method", "target", "headers", "body", "mode", "status"}
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00", line["at"])
    first = lines[0]
    assert (first["sni"], first["host"], first["method"], first["target"]) == (
        "api.frankfurter.dev", "api.frankfurter.dev", "POST", "/v1/2026-07-24?base=CHF"
    )
    assert first["headers"] == [
        ["Host", "api.frankfurter.dev"], ["X-Twice", "a"], ["user-agent", "Probe"], ["X-Twice", "b"],
        ["Content-Length", "256"], ["Connection", "close"],
    ]
    assert first["body"].encode("latin-1") == body
    assert [line["status"] for line in lines[1:3]] == [400, 505]
    assert lines[1]["method"] == "NOT" and lines[2]["method"] == "GET"
    assert (lines[3]["sni"], lines[3]["status"]) == ("api.nbp.pl", 200)


@needs_openssl
def test_a_request_that_stalls_is_still_recorded_with_what_was_read(pki, tmp_path, monkeypatch):
    monkeypatch.setattr(standin.Handler, "timeout", 1)
    running = standin.Standin(("127.0.0.1", 0), standin.make_context(str(pki[0] / "leaf.pem"), str(pki[0] / "leaf.key")), standin.State(tmp_path))
    threading.Thread(target=running.serve_forever, daemon=True).start()
    context = ssl.create_default_context(cafile=str(pki[0] / "ca.pem"))
    context.minimum_version = ssl.TLSVersion.TLSv1_2

    def stalled(raw: bytes) -> bytes:
        with socket.create_connection(("127.0.0.1", running.server_address[1]), timeout=10) as raw_socket:
            with context.wrap_socket(raw_socket, server_hostname="api.nbp.pl") as tls:
                tls.sendall(raw)
                answer = b""
                with contextlib.suppress(OSError):
                    while chunk := tls.recv(4096):
                        answer += chunk
                return answer

    try:
        assert stalled(b"GET /v1/2026-07-24?base=CHF HTTP/1.1\r\nHost: api.frankfurter.dev\r\nX-A: 1\r\n").startswith(b"HTTP/1.1 408")
        assert stalled(b"POST /x HTTP/1.1\r\nHost: api.nbp.pl\r\nContent-Length: 10\r\n\r\nabc").startswith(b"HTTP/1.1 408")
        assert stalled(b"") == b""
    finally:
        running.shutdown()
    head, short = [json.loads(line) for line in (tmp_path / "requests.jsonl").read_text().splitlines()]
    assert (head["seq"], head["status"], head["method"], head["target"], head["body"]) == (1, 408, "GET", "/v1/2026-07-24?base=CHF", "")
    assert head["headers"] == [["Host", "api.frankfurter.dev"], ["X-A", "1"]] and head["host"] == "api.frankfurter.dev"
    assert (short["status"], short["method"], short["body"], short["sni"]) == (408, "POST", "abc", "api.nbp.pl")
    assert set(head) == set(short)


# ---- Known prices -------------------------------------------------------


def test_the_currency_list_is_the_seeded_currencies():
    seeded = sorted(row["symbol"] for row in rates.SEEDED_SYMBOLS if row["kind"] == "currency")
    assert prices.CURRENCIES == seeded
    assert prices.REF["EUR"] == 1


def test_the_gold_window_is_the_apps():
    assert prices.NBP_WINDOW == rates.NBP_WINDOW


def test_publication_days_are_weekdays_from_each_sources_first_day_to_today():
    today = date(2026, 7, 31)
    assert prices.last_publication_day("frankfurter", "2026-07-26", today) == date(2026, 7, 24)
    assert prices.last_publication_day("frankfurter", "2027-01-01", today) == today
    assert prices.last_publication_day("frankfurter", "1999-01-03", today) is None
    assert prices.last_publication_day("nbp", "2013-01-01", today) is None
    assert prices.last_publication_day("nbp", "2013-01-05", today) == date(2013, 1, 4)
    assert [d.isoformat() for d in prices.publication_days("nbp", "2012-12-28", "2013-01-04", today)] == [
        "2013-01-02", "2013-01-03", "2013-01-04"
    ]


def test_prices_follow_their_formulas_in_decimal():
    day = date(2026, 7, 31)
    factor = 1 + Decimal((day.toordinal() % 101) - 50) / 2000
    usd = prices.frankfurter_rates(day, "CHF")["USD"]
    assert usd == Decimal(format(prices.REF["USD"] / prices.REF["CHF"] * factor, ".5g"))
    assert len(usd.as_tuple().digits) <= 5
    cena = 250 * (1 + Decimal((day.toordinal() % 89) - 44) / 1000)
    assert prices.nbp_cena(day) == cena.quantize(Decimal("0.01"))


@pytest.mark.parametrize("day", ["1999-01-04", "2012-12-31", "2026-07-24"])
def test_a_price_written_as_json_is_read_back_as_the_same_decimal(day):
    """The app reads a body through float and str."""
    for quote in ("CHF", "EUR", "JPY", "IDR"):
        for code, rate in prices.frankfurter_rates(day, quote).items():
            assert Decimal(str(json.loads(json.dumps(prices.json_number(rate))))) == rate
    assert Decimal(str(json.loads(json.dumps(prices.json_number(prices.nbp_cena(day)))))) == prices.nbp_cena(day)


class AppResponse:
    status = 200

    def __init__(self, body: bytes) -> None:
        self.body = body

    def read(self, _size=None):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture
def from_standin(monkeypatch):
    """The app's opener, answering from the stand-in's own routing."""

    def open_(request, timeout=None):
        url = urlsplit(request.full_url)
        target = url.path + (f"?{url.query}" if url.query else "")
        status, _, body = standin.answer(url.hostname, "GET", target)
        if status != 200:
            raise urllib.error.HTTPError(request.full_url, status, "", {}, io.BytesIO(body))
        return AppResponse(body)

    monkeypatch.setattr(rates._opener, "open", open_)


def test_known_table_is_what_the_app_answers_for_the_whole_table(owner, from_standin):
    today = datetime.now(timezone.utc).date().isoformat()
    # A weekday, a weekend, the day before 2013-01-02, a day before four
    # currencies start, and today.
    for day in ("2026-07-29", "2026-07-25", "2013-01-01", "1999-06-30", today):
        for quote in ("CHF", "EUR", "PLN", "BRL"):
            response = owner.get(f"/api/rates?date={day}&quote={quote}", headers=CSRF)
            expected = prices.known_table(day, quote)
            if not expected:
                assert response.status_code == 204, (day, quote)
                continue
            table = {symbol: {k: v for k, v in entry.items() if k != "cached"} for symbol, entry in response.get_json()["rates"].items()}
            assert table == expected, (day, quote)
    assert "XAU-g" not in prices.known_table("2013-01-01", "CHF")
    assert prices.known_table("2026-07-25", "PLN")["XAU-g"]["source"] == "nbp"
    assert prices.known_table("2026-07-25", "CHF")["XAU-g"]["asOf"] == "2026-07-24"
    assert not {"BRL", "CNY", "ILS", "INR"} & set(prices.known_table("1999-06-30", "CHF"))
    assert "USD" in prices.known_table("1999-06-30", "CHF")
    assert prices.known_table("1999-06-30", "BRL") == {}


def test_each_currencys_start_is_the_real_series_and_the_apps_since_agrees(owner):
    assert set(prices.START) == set(prices.CURRENCIES)
    assert {c for c, d in prices.START.items() if d != prices.FRANKFURTER_START} == {"BRL", "CNY", "ILS", "INR"}
    table = {row["symbol"]: row["since"] for row in owner.get("/api/rates/symbols", headers=CSRF).get_json()}
    for code in prices.CURRENCIES:
        assert table[code] == prices.START[code].isoformat(), code
    assert table["XAU-g"] == prices.NBP_START.isoformat()


def hand_vault():
    holdings = {
        "Cash": {"unit": "CHF", "archived": False},
        "Dollars": {"unit": "USD", "archived": False},
        "Mortgage": {"unit": "CHF", "archived": False},
        "Old gold": {"unit": "XAU-g", "archived": False},
        "Closed": {"unit": "CHF", "archived": True},
        "Flat": {"unit": "m²", "archived": False},
        "Empty": {"unit": "CHF", "archived": False},
        "Old flat": {"unit": "m²", "archived": True},
        "Shut": {"unit": "CHF", "archived": True},
    }
    snapshots = {
        "Cash": [("2026-01-31", Decimal("100.005")), ("2026-02-28", Decimal("200.125"))],
        "Dollars": [("2026-01-31", Decimal("10")), ("2026-02-28", Decimal("30.5"))],
        "Mortgage": [("2026-02-28", Decimal("-1000"))],
        "Old gold": [("2019-03-29", Decimal("2"))],
        "Closed": [("2026-01-31", Decimal("5")), ("2026-02-01", Decimal("0"))],
        "Flat": [("2026-02-28", Decimal("90"))],
        "Old flat": [("2026-02-28", Decimal("40"))],
    }
    # USD: an edited figure on the date of the gold's quantity.
    series = {"USD": [("2019-03-29", Decimal("0.9")), ("2026-01-31", Decimal("0.85")), ("2026-02-28", Decimal("0.875"))],
              "XAU-g": [("2019-03-29", Decimal("50.12345678"))]}
    return holdings, snapshots, series


def test_expected_figures_match_a_hand_computed_vault_under_both_modes():
    result = prices.expected("CHF", *hand_vault())
    latest, recorded = result["latest"], result["asRecorded"]
    # Dollars: 30.5 x 0.875 = 26.6875, rounded half to even to whole units.
    assert latest["holdings"] == {
        "Cash": {"exact": "200.125", "display": "200"},
        "Dollars": {"exact": "26.6875", "display": "27"},
        "Mortgage": {"exact": "-1000", "display": "-1000"},
        "Old gold": {"exact": "100.24691356", "display": "100"},
    }
    # An archived holding is listed as archived whether or not it is also
    # unpriced ("Old flat") or has no quantity ("Shut").
    excluded = {
        "Closed": "archived",
        "Flat": "no price",
        "Empty": "no quantity",
        "Old flat": "archived",
        "Shut": "archived",
    }
    assert latest["excluded"] == excluded
    assert recorded["excluded"] == excluded
    assert latest["total"] == {"exact": "-672.94058644", "display": "-673"}
    assert latest["assets"] == {"exact": "327.05941356", "display": "327"}
    assert latest["debts"] == {"exact": "-1000", "display": "-1000"}
    # As recorded, the gold stays at its own date's price and the dollars
    # at the price of their own latest quantity.
    assert recorded["holdings"] == latest["holdings"]
    series = hand_vault()[2]
    series["USD"].append(("2026-03-31", Decimal("0.5")))
    later = prices.expected("CHF", *hand_vault()[:2], series)
    assert later["latest"]["holdings"]["Dollars"]["display"] == "15"
    assert later["asRecorded"]["holdings"]["Dollars"]["display"] == "27"


def test_a_date_carrying_two_snapshots_is_dropped_from_a_holdings_series():
    snapshots = {"Cash": [("2026-01-31", Decimal(1)), ("2026-02-28", Decimal(2)), ("2026-02-28", Decimal(3))]}
    assert prices.usable_latest(snapshots["Cash"]) == ("2026-01-31", Decimal(1))


# ---- prepare ------------------------------------------------------------


def full_plan() -> dict:
    return json.loads((FIXTURES / "plan.json").read_text())


@pytest.mark.parametrize("name", prices.COVERAGE)
def test_prepare_refuses_a_plan_that_leaves_a_coverage_name_out(name, tmp_path):
    plan = full_plan()
    for group in ("accounts", "invites", "backups"):
        for item in plan[group]:
            item["covers"] = [c for c in item["covers"] if c != name]
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(plan))
    done = subprocess.run(
        [sys.executable, str(TOOLS / "prices.py"), "prepare", str(path), str(tmp_path / "out")],
        capture_output=True, text=True, cwd=FIXTURES,
    )
    assert done.returncode == 1 and name in done.stderr
    assert not (tmp_path / "out").exists()


def test_no_plan_is_exempt_from_the_coverage_check():
    legacy = json.loads((FIXTURES / "backup-format-1.plan.json").read_text())
    assert "partial" not in legacy
    with pytest.raises(prices.PlanError, match="covers nothing for"):
        prices.prepare(legacy, date.today(), FIXTURES)


def mixed(plan: dict) -> dict:
    return next(a for a in plan["accounts"] if a["username"] == "mixed.owner")


@pytest.mark.parametrize(
    "change, words",
    [
        ({"damaged": {"holding": "Cash account", "date": {"daysAgo": 5}, "value": "1.00"}}, "latest quantity"),
        ({"damaged": {"holding": "Cash account", "date": {"daysAgo": 15}, "value": "1.00"}}, "latest quantity"),
        ({"pair": {"holding": "Cash account", "date": {"daysAgo": 15}, "value": "1.00", "other": "2.00"}}, "latest quantity"),
        ({"damaged": {"holding": "Closed account", "date": "2024-06-28", "value": "1.00"}}, "archive date"),
        ({"pair": {"holding": "Closed account", "date": "2024-06-28", "value": "1.00", "other": "2.00"}}, "archive date"),
    ],
)
def test_prepare_refuses_a_damaged_record_or_pair_that_leaves_two_correct_totals(change, words):
    plan = full_plan()
    steps = mixed(plan)["steps"]
    steps.append(change)
    with pytest.raises(prices.PlanError, match=words):
        prices.prepare(plan, date.today(), FIXTURES)


def test_prepare_refuses_an_archive_that_would_look_a_price_up():
    plan = full_plan()
    steps = mixed(plan)["steps"]
    steps.insert(-1, {"archive": {"holding": "Cash account", "date": "2025-02-28"}})
    with pytest.raises(prices.PlanError, match="would look up"):
        prices.prepare(plan, date.today(), FIXTURES)


def chart(plan: dict) -> dict:
    return next(a for a in plan["accounts"] if a["username"] == "chart.owner")


def test_clear_and_delete_write_their_ops_and_leave_the_expected_figures():
    script, _ = prices.prepare(full_plan(), date.today(), FIXTURES)
    ops = next(a for a in script["accounts"] if a["username"] == "chart.owner")["ops"]
    assert [op for op in ops if op["op"] in ("clear", "deleteRecording")] == [
        {"op": "clear", "date": "2017-09-29"}, {"op": "deleteRecording", "date": "2019-03-29"},
    ]
    account = chart(full_plan())
    _, kept = prices.build_vault({**account, "steps": account["steps"][:-1]}, date.today())
    _, whole = prices.build_vault({**account, "steps": account["steps"][:-2]}, date.today())
    assert kept == whole


@pytest.mark.parametrize(
    "step, words",
    [
        ({"clear": {"date": "2016-03-31"}}, "between two recordings"),
        ({"deleteRecording": {"date": {"daysAgo": 10}}}, "between two recordings"),
        ({"clear": {"date": "2018-06-29"}}, "no recording there"),
    ],
)
def test_prepare_refuses_a_cleared_or_deleted_date_that_bends_nothing(step, words):
    plan = full_plan()
    chart(plan)["steps"].append(step)
    with pytest.raises(prices.PlanError, match=words):
        prices.prepare(plan, date.today(), FIXTURES)


def test_prepare_refuses_a_cleared_date_whose_prices_lie_on_the_line():
    account = {
        "username": "line", "password": "x", "kind": "vault_owner", "mainCurrency": "CHF",
        "holdings": [{"name": "Land", "unit": "acre"}],
        "steps": [
            {"recording": {"date": d, "figures": {"Land": "1"}, "prices": {"acre": {"manual": r}}}}
            for d, r in (("2020-01-01", "10"), ("2020-01-11", "11"), ("2020-01-21", "12"))
        ] + [{"clear": {"date": "2020-01-11"}}],
    }
    with pytest.raises(prices.PlanError, match="off its neighbors' line"):
        prices.build_vault(account, date.today())


def test_with_nothing_valued_the_total_and_the_sides_are_none():
    holdings = {"Savings": {"unit": "CHF", "archived": True}}
    result = prices.figures("CHF", holdings, {"Savings": [("2026-01-31", Decimal(5))]}, {}, "latest")
    assert result["total"] is result["assets"] is result["debts"] is None
    assert result["excluded"] == {"Savings": "archived"}


def test_prepare_writes_a_script_and_figures_for_every_vault(tmp_path):
    done = subprocess.run(
        [sys.executable, str(TOOLS / "prices.py"), "prepare", str(FIXTURES / "plan.json"), str(tmp_path)],
        capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stderr
    script = json.loads((tmp_path / "script.json").read_text())
    expected = json.loads((tmp_path / "expected.json").read_text())
    assert script["today"] == datetime.now(timezone.utc).date().isoformat()
    owners = [a["username"] for a in script["accounts"] if a["kind"] == "vault_owner"]
    assert set(owners) <= set(expected)
    # Each proposal in the script is the known price at its date.
    for account in script["accounts"]:
        for op in account["ops"]:
            if op["op"] == "recording":
                table = prices.known_table(op["date"], account["mainCurrency"])
                assert all(table[unit] == proposal for unit, proposal in op["proposals"].items())
    mixed_figures = expected["mixed.owner"]
    assert mixed_figures["latest"]["excluded"] == {"Closed account": "archived"}
    assert mixed_figures["latest"]["total"]["exact"] != mixed_figures["asRecorded"]["total"]["exact"]
    assert not (tmp_path / "script.json").read_text().count("fixtures/out")


def test_the_long_history_vault_prices_a_unit_by_hand_before_its_published_prices(tmp_path):
    script, expected = prices.prepare(full_plan(), date.today(), FIXTURES)
    ops = next(a for a in script["accounts"] if "long-history" in a["covers"])["ops"]
    recordings = {op["date"]: op for op in ops if op["op"] == "recording"}
    dates = sorted(recordings)
    assert dates[0] == "1998-12-31" and dates[1] == "2011-01-31"
    first = recordings["1998-12-31"]
    assert first["proposals"] == {} and set(first["manual"]) == {"USD", "XAU-g"}
    for stamp, op in recordings.items():
        if stamp < "2013-01-02":
            assert "XAU-g" in op["manual"] and "XAU-g" not in op["proposals"], stamp
        elif stamp > "1999-01-04":
            assert "XAU-g" in op["proposals"] and "USD" in op["proposals"], stamp


def test_the_plan_covers_what_the_spec_names_and_its_unreadable_record_is_never_the_latest():
    prices.prepare(full_plan(), date.today(), FIXTURES)
    covered = {c for group in ("accounts", "invites", "backups") for item in full_plan()[group] for c in item["covers"]}
    assert covered >= set(prices.COVERAGE)


def test_the_out_of_range_idle_lock_is_written_as_zero_by_one_vault_that_covers_nothing_else(tmp_path):
    accounts = full_plan()["accounts"]
    covering = [a for a in accounts if "idle-lock-out-of-range" in a.get("covers", [])]
    assert [a["covers"] for a in covering] == [["idle-lock-out-of-range"]]
    assert covering[0]["profile"]["idleLockMinutes"] == 0
    assert [a["username"] for a in accounts if "idleLockMinutes" in a.get("profile", {})] == [covering[0]["username"]]
    script, _ = prices.prepare(full_plan(), date.today(), FIXTURES)
    ops = next(a for a in script["accounts"] if a["username"] == covering[0]["username"])["ops"]
    assert ops[0] == {"op": "profile", "patch": covering[0]["profile"]}


def test_the_older_backup_and_its_plan_and_figures_are_committed(monkeypatch):
    backup = json.loads((FIXTURES / "backup-format-1.json").read_text())
    assert backup["formatVersion"] == 1
    assert backup["kdf"] == {"alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1}
    plan = json.loads((FIXTURES / "backup-format-1.plan.json").read_text())
    expected = json.loads((FIXTURES / "backup-format-1.expected.json").read_text())
    owner = next(a for a in plan["accounts"] if a["kind"] == "vault_owner")
    assert set(expected) == {"latest", "asRecorded"}
    assert full_plan()["backups"][0]["password"] == owner["password"]
    # Every date in the plan is absolute, so the file is never remade.
    assert "daysAgo" not in json.dumps(plan) and "monthEnds" not in json.dumps(plan)
    counts = {kind: sum(r["recordType"] == kind for r in backup["records"]) for kind in ("account", "snapshot", "rate", "profile")}
    assert counts["account"] == len(owner["holdings"]) and counts["profile"] == 1
    # The figures kept with it are what the plan's vault works out to. The
    # plan is no full nightly plan, so it is built, not prepared, under
    # the 8-place rounding of the build that made the file.
    monkeypatch.setattr(
        prices,
        "_proposal",
        lambda value: format(value.quantize(Decimal("0.00000001"), ROUND_HALF_EVEN).normalize(), "f"),
    )
    assert prices.build_vault(owner, date(2026, 10, 3))[1] == expected


# ---- The relay ----------------------------------------------------------


def test_the_relay_carries_bytes_both_ways_and_closes_both_sides():
    request, response = bytes(range(256)) * 300, bytes(reversed(range(256))) * 500
    target = socket.create_server(("127.0.0.1", 0))
    listener = socket.create_server(("127.0.0.1", 0))
    threading.Thread(target=relay.relay, args=(listener, ("127.0.0.1", target.getsockname()[1])), daemon=True).start()
    try:
        client = socket.create_connection(listener.getsockname(), timeout=10)
        upstream, _ = target.accept()
        upstream.settimeout(10)
        client.sendall(request)
        got = b""
        while len(got) < len(request):
            got += upstream.recv(65536)
        assert got == request
        upstream.sendall(response)
        back = b""
        while len(back) < len(response):
            back += client.recv(65536)
        assert back == response
        # Either side closing closes the other.
        client.close()
        assert upstream.recv(1) == b""
        again = socket.create_connection(listener.getsockname(), timeout=10)
        second, _ = target.accept()
        second.settimeout(10)
        second.close()
        assert again.recv(1) == b""
        again.close()
        upstream.close()
    finally:
        listener.close()
        target.close()


# ---- The source checks --------------------------------------------------

DAY = date(2026, 7, 24)


def real_frankfurter(**changes) -> dict:
    body = {
        "amount": 1.0, "base": "CHF", "date": "2026-07-24",
        "rates": {code: 1.5 for code in sources.SEEDED_CURRENCIES - {"CHF"}},
    }
    body.update(changes)
    return body


REAL_NBP = [{"data": "2026-07-22", "cena": 480.3}, {"data": "2026-07-24", "cena": 481.01}]


def classify(source: str, status: int, body, day: date = DAY):
    raw = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    return sources.classify(source, status, raw, day)[0]


def test_the_real_providers_documented_shapes_are_ok():
    assert classify("frankfurter", 200, real_frankfurter()) == "ok"
    assert classify("nbp", 200, REAL_NBP) == "ok"


@pytest.mark.parametrize("status", [429, 500, 503, 504])
def test_a_throttled_or_failing_source_is_no_answer(status):
    assert classify("nbp", status, None) == "no-answer"


@pytest.mark.parametrize("status", [301, 302, 308, 400, 403, 404])
def test_any_other_status_is_changed_redirects_included(status):
    assert classify("frankfurter", status, None) == "changed"


def test_a_200_that_is_off_the_shape_is_changed():
    rates_without = {k: v for k, v in real_frankfurter()["rates"].items() if k != "PLN"}
    one_missing = real_frankfurter(rates=rates_without)
    boolean = real_frankfurter(rates={**real_frankfurter()["rates"], "USD": True})
    cases = [
        ("frankfurter", b"<html>"), ("frankfurter", b"x" * (sources.MAX_RESPONSE_BYTES + 1)),
        ("frankfurter", one_missing), ("frankfurter", boolean),
        ("frankfurter", real_frankfurter(base="EUR")), ("frankfurter", real_frankfurter(date="2026-07-01")),
        ("frankfurter", real_frankfurter(date="20260724")), ("frankfurter", []),
        ("frankfurter", real_frankfurter(rates={**real_frankfurter()["rates"], "USD": 0})),
        ("nbp", []), ("nbp", [{"data": "2026-07-01", "cena": 1.0}]), ("nbp", [{"data": "2026-07-24", "cena": True}]),
        ("nbp", list(reversed(REAL_NBP))), ("nbp", {"data": "2026-07-24"}), ("nbp", b"nope"),
    ]
    for source, body in cases:
        assert classify(source, 200, body) == "changed", (source, str(body)[:60])


class FakeOpener:
    def __init__(self, answers: dict) -> None:
        self.answers, self.requests = answers, []

    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        answer = self.answers["nbp" if "nbp.pl" in request.full_url else "frankfurter"]
        if isinstance(answer, BaseException):
            raise answer
        if isinstance(answer, int):
            raise urllib.error.HTTPError(request.full_url, answer, "", {}, io.BytesIO(b"<body>"))
        return AppResponse(json.dumps(answer).encode())


@pytest.mark.parametrize(
    "answer, outcome",
    [
        (TimeoutError("timed out"), "no-answer"),
        (urllib.error.URLError(ConnectionRefusedError()), "no-answer"),
        (urllib.error.URLError(ssl.SSLCertVerificationError()), "no-answer"),
        (429, "no-answer"), (503, "no-answer"), (301, "changed"), (404, "changed"),
    ],
)
def test_the_requests_failures_are_classified(answer, outcome):
    opener = FakeOpener({"frankfurter": answer, "nbp": REAL_NBP})
    (source, got, reason), _ = sources.check_all(DAY + timedelta(days=7), opener)
    assert (source, got) == ("frankfurter", outcome)
    assert "<body>" not in reason


def test_the_check_requests_what_the_app_requests_for_the_day_a_week_back():
    opener = FakeOpener({"frankfurter": real_frankfurter(), "nbp": REAL_NBP})
    assert [r[:2] for r in sources.check_all(DAY + timedelta(days=7), opener)] == [("frankfurter", "ok"), ("nbp", "ok")]
    (fx, fx_timeout), (nbp, _) = opener.requests
    assert fx.full_url == rates.FX_URL.format(date="2026-07-24", quote="CHF")
    assert nbp.full_url == rates.NBP_URL.format(start="2026-07-10", end="2026-07-24")
    assert dict(fx.header_items()) == {"User-agent": rates.USER_AGENT, "Accept": "application/json"}
    assert fx_timeout == rates.EGRESS_TIMEOUT_SECONDS


@pytest.mark.parametrize("bad, code", [(False, 0), (True, 1)])
def test_check_exits_1_exactly_when_a_line_is_changed_and_probe_needs_everything_ok(monkeypatch, capsys, bad, code):
    body = real_frankfurter(base="EUR") if bad else real_frankfurter()
    monkeypatch.setattr(sources, "OPENER", FakeOpener({"frankfurter": body, "nbp": 503}))
    assert sources.main(["sources.py", "check"], DAY + timedelta(days=7)) == code
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("frankfurter " + ("changed" if bad else "ok"))
    assert lines[1] == "nbp no-answer status 503"
    monkeypatch.setattr(sources, "OPENER", FakeOpener({"frankfurter": real_frankfurter(), "nbp": REAL_NBP}))
    monkeypatch.setattr(sources, "route_out", lambda: False)
    assert sources.main(["sources.py", "probe"], DAY + timedelta(days=7)) == 0
    monkeypatch.setattr(sources, "route_out", lambda: True)
    assert sources.main(["sources.py", "probe"], DAY + timedelta(days=7)) == 1
    assert sources.main(["sources.py", "other"]) == 2


# ---- Dating back --------------------------------------------------------


def dump(path: Path) -> "dict[str, list]":
    conn = sqlite3.connect(path)
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]
        return {t: conn.execute(f"SELECT * FROM {t} ORDER BY rowid").fetchall() for t in tables}
    finally:
        conn.close()


def run_patch(database: Path, patches: dict, tmp_path: Path) -> int:
    file = tmp_path / "patches.json"
    file.write_text(json.dumps(patches))
    return subprocess.run([sys.executable, str(TOOLS / "patch.py"), str(database), str(file)], capture_output=True).returncode


@pytest.fixture
def prepared(app, tmp_path):
    register(app, "aged")
    register(app, "older")
    register(app, "bystander")
    mint_invite(app, label="expired-one")
    mint_invite(app, label="other-invite")
    return Path(app.config["DATABASE_PATH"]), tmp_path


def test_patch_changes_exactly_the_rows_it_names(prepared):
    database, tmp_path = prepared
    before = dump(database)
    patches = {
        "sessions": [{"username": "aged", "issuedMinutesAgo": 725, "lastActiveMinutesAgo": 1}],
        "invites": [{"label": "expired-one", "createdMinutesAgo": 11520, "expiresMinutesAgo": 1440}],
        "credentials": [{"username": "older", "kdfMemory": 32768}],
    }
    started = datetime.now(timezone.utc)
    assert run_patch(database, patches, tmp_path) == 0
    after = dump(database)
    assert {t for t in before if before[t] != after[t]} == {"sessions", "invites", "credentials"}

    conn = connect_to(database)
    session = conn.execute("SELECT s.* FROM sessions s JOIN principals p ON p.id = s.principal_id WHERE p.username = 'aged'").fetchone()
    for column, minutes in (("issued_at", 725), ("last_active_at", 1)):
        stamped = datetime.fromisoformat(session[column])
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00", session[column])
        assert abs((started - timedelta(minutes=minutes)) - stamped) < timedelta(seconds=30)
    expired = conn.execute("SELECT * FROM invites WHERE label = 'expired-one'").fetchone()
    assert datetime.fromisoformat(expired["expires_at"]) < started - timedelta(hours=23)
    assert conn.execute("SELECT status FROM invites WHERE label = 'expired-one'").fetchone()[0] == "pending"
    params = lambda who: json.loads(conn.execute(  # noqa: E731
        "SELECT c.params FROM credentials c JOIN principals p ON p.id = c.principal_id WHERE p.username = ?", (who,)
    ).fetchone()[0])
    assert params("older")["kdf"]["m"] == 32768
    assert {k: v for k, v in params("older")["kdf"].items() if k != "m"} == {k: v for k, v in params("bystander")["kdf"].items() if k != "m"}
    assert params("bystander")["kdf"]["m"] == 65536
    # Rows it did not name are byte for byte what they were.
    for table in ("sessions", "invites", "credentials"):
        named = {tuple(r) for r in after[table]} - {tuple(r) for r in before[table]}
        assert len(named) == 1
    assert conn.execute("SELECT count(*) FROM invites WHERE label = 'other-invite'").fetchone()[0] == 1
    conn.close()


def connect_to(database: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(database)
    conn.row_factory = sqlite3.Row
    return conn


@pytest.mark.parametrize(
    "patches, code",
    [
        ({"sessions": [{"username": "nobody", "issuedMinutesAgo": 1, "lastActiveMinutesAgo": 1}]}, 1),
        ({"invites": [{"label": "no such label", "createdMinutesAgo": 2, "expiresMinutesAgo": 1}]}, 1),
        ({"credentials": [{"username": "older", "kdfMemory": 65536}]}, 1),
        ({"credentials": [{"username": "older", "kdfMemory": 8191}]}, 1),
        ({"credentials": [{"username": "older", "kdfMemory": 32768}, {"username": "nobody", "kdfMemory": 32768}]}, 1),
        ({"tokens": []}, 2),
        ({"sessions": [{"username": "aged", "issuedMinutesAgo": 1, "lastActiveMinutesAgo": 1, "extra": 1}]}, 2),
        ({"sessions": [{"username": "aged", "issuedMinutesAgo": "1", "lastActiveMinutesAgo": 1}]}, 2),
    ],
)
def test_a_patch_that_cannot_apply_changes_nothing(prepared, patches, code):
    database, tmp_path = prepared
    before = dump(database)
    assert run_patch(database, patches, tmp_path) == code
    assert dump(database) == before


def test_patch_never_creates_a_database(tmp_path):
    assert run_patch(tmp_path / "missing.db", {}, tmp_path) == 2
    assert not (tmp_path / "missing.db").exists()


def test_patch_runs_only_its_three_statements_and_binds_every_value():
    assert [s.split()[1] for s in (patch.SESSION, patch.INVITE, patch.CREDENTIAL)] == ["sessions", "invites", "credentials"]
    assert "'" not in patch.SESSION.replace("'$.kdf.m'", "").replace("'password'", "")
    assert patch.SESSION.count("?") == 3 and patch.INVITE.count("?") == 3 and patch.CREDENTIAL.count("?") == 2


# ---- The harness tools --------------------------------------------------


class Tools:
    """mcp.py over stdio, as the walk step starts it, with a stand-in
    docker first on PATH."""

    def __init__(self, tmp_path: Path, started: "list[str] | None" = None, parent_env: "dict | None" = None) -> None:
        self.state = tmp_path / "state"
        self.state.mkdir()
        if started is not None:
            (self.state / "requests.jsonl").write_text("".join(started))
        self.log = tmp_path / "docker.log"
        shim = tmp_path / "bin"
        shim.mkdir()
        (shim / "docker").write_text(
            f"#!/bin/sh\necho \"$*\" >> '{self.log}'\n"
            "if [ \"$1\" = logs ]; then seq 1 700 | sed 's/^/line /'; echo problem >&2; fi\n"
        )
        (shim / "docker").chmod(0o755)
        self.web = threading.Thread(target=self.serve_login, daemon=True)
        self.listener = socket.create_server(("127.0.0.1", 0))
        self.web.start()
        url = f"http://127.0.0.1:{self.listener.getsockname()[1]}"
        self.process = subprocess.Popen(
            ["env", "-i", f"PATH={shim}:/usr/bin:/bin", sys.executable, str(TOOLS / "mcp.py"),
             "--container", "solvent", "--state", str(self.state), "--url", url],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=parent_env,
        )
        self.next = 0

    def serve_login(self) -> None:
        while True:
            try:
                connection, _ = self.listener.accept()
            except OSError:
                return
            with connection:
                connection.recv(4096)
                connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")

    def rpc(self, method: str, params: "dict | None" = None) -> dict:
        self.next += 1
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.next, "method": method, "params": params or {}}) + "\n")
        self.process.stdin.flush()
        return json.loads(self.process.stdout.readline())

    def call(self, name: str, arguments: "dict | None" = None) -> "tuple[dict, bool]":
        answer = self.rpc("tools/call", {"name": name, "arguments": arguments or {}})["result"]
        assert len(answer["content"]) == 1 and answer["content"][0]["type"] == "text"
        return json.loads(answer["content"][0]["text"]), answer.get("isError", False)

    def docker_calls(self) -> "list[str]":
        return self.log.read_text().splitlines() if self.log.exists() else []

    def close(self) -> None:
        self.process.stdin.close()
        self.process.wait(timeout=10)
        self.listener.close()


@pytest.fixture
def tools(tmp_path):
    started = [json.dumps({"seq": n}) + "\n" for n in (1, 2, 3)]
    running = Tools(tmp_path, started)
    yield running
    running.close()


def test_the_protocol_lists_exactly_the_tools_and_answers_as_specified(tools):
    answer = tools.rpc("initialize", {"protocolVersion": "2031-01-01"})["result"]
    assert answer["protocolVersion"] == "2031-01-01" and answer["capabilities"] == {"tools": {}}
    assert answer["serverInfo"]["name"] == "harness"
    listed = tools.rpc("tools/list")["result"]["tools"]
    assert [t["name"] for t in listed] == ["server_log", "price_requests", "price_source", "known_prices", "app_stop", "app_start"]
    assert all(t["inputSchema"]["additionalProperties"] is False for t in listed)
    by_name = {t["name"]: t["inputSchema"]["properties"] for t in listed}
    assert by_name["price_source"] == {"source": {"enum": ["frankfurter", "nbp"]}, "state": {"enum": ["up", "down"]}}
    assert by_name["server_log"] == {"since": {"type": "integer", "minimum": 0, "default": 0}} == by_name["price_requests"]
    assert by_name["app_stop"] == by_name["app_start"] == {}
    assert tools.rpc("ping")["result"] == {}
    assert tools.rpc("resources/list")["error"]["code"] == -32601
    # A notification gets no reply: the next line read is the ping's.
    tools.process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    assert tools.rpc("ping")["id"] == tools.next


@pytest.mark.parametrize(
    "name, arguments",
    [
        ("server_log", {"since": 0, "container": "other"}),
        ("server_log", {"since": -1}),
        ("server_log", {"since": True}),
        ("price_source", {"source": "ecb", "state": "down"}),
        ("price_source", {"source": "nbp", "state": "sideways"}),
        ("price_source", {"source": "nbp"}),
        ("known_prices", {"date": "2026-7-1", "quote": "CHF"}),
        ("known_prices", {"date": "2026-02-30", "quote": "CHF"}),
        ("known_prices", {"date": "2999-01-01", "quote": "CHF"}),
        ("known_prices", {"date": "2026-07-01", "quote": "XXX"}),
        ("known_prices", {"date": "2026-07-01", "quote": "CHF", "path": "/etc/passwd"}),
        ("app_stop", {"time": 0}),
        ("app_start", {"url": "http://example.com"}),
    ],
)
def test_an_argument_outside_the_schema_is_refused_by_name_and_runs_nothing(tools, name, arguments):
    answer, error = tools.call(name, arguments)
    assert error and answer["argument"] in answer["error"]
    assert tools.docker_calls() == [] and not (tools.state / "modes.json").exists()


def test_a_docker_that_hangs_is_an_error_result_and_the_server_keeps_serving(tmp_path, monkeypatch):
    shim = tmp_path / "bin"
    shim.mkdir()
    (shim / "docker").write_text("#!/bin/sh\nexec sleep 30\n")
    (shim / "docker").chmod(0o755)
    monkeypatch.setenv("PATH", f"{shim}:{os.environ['PATH']}")
    monkeypatch.setattr(mcp, "DOCKER_SECONDS", 1)
    harness = mcp.Harness("solvent", tmp_path, "http://127.0.0.1:1")
    messages = [
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "server_log", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "app_stop", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 3, "method": "ping"},
    ]
    sink = io.StringIO()
    mcp.serve(harness, io.StringIO("".join(json.dumps(m) + "\n" for m in messages)), sink)
    first, second, third = [json.loads(line) for line in sink.getvalue().splitlines()]
    for answer in (first, second):
        assert answer["result"]["isError"] and "in time" in answer["result"]["content"][0]["text"]
    assert third == {"jsonrpc": "2.0", "id": 3, "result": {}}


def test_the_tools_run_docker_with_exactly_these_argument_lists(tools):
    log, error = tools.call("server_log")
    assert not error and log["lines"][:2] == ["line 1", "line 2"] and log["next"] == 500
    assert "problem" in tools.call("server_log", {"since": 500})[0]["lines"]
    page = tools.call("server_log", {"since": 500})[0]
    assert len(page["lines"]) == 201 and page["next"] == 701
    assert tools.call("app_stop")[0] == {"state": "stopped"}
    assert tools.call("app_start")[0] == {"state": "running"}
    assert tools.docker_calls() == ["logs solvent", "logs solvent", "logs solvent", "stop --time 10 solvent", "start solvent"]


def test_an_app_that_does_not_answer_is_reported(tmp_path, monkeypatch):
    monkeypatch.setattr(mcp, "START_WAIT_SECONDS", 1)
    harness = mcp.Harness("solvent", tmp_path, "http://127.0.0.1:1")
    monkeypatch.setattr(harness, "docker", lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, b""))
    answer = harness.call("app_start", {})
    assert answer["isError"] and json.loads(answer["content"][0]["text"]) == {"state": "not answering"}


def test_price_source_leaves_the_new_state_and_known_prices_is_the_table(tools):
    assert tools.call("price_source", {"source": "nbp", "state": "down"})[0] == {"frankfurter": "up", "nbp": "down"}
    assert json.loads((tools.state / "modes.json").read_text()) == {"frankfurter": "up", "nbp": "down"}
    assert tools.call("price_source", {"source": "frankfurter", "state": "down"})[0] == {"frankfurter": "down", "nbp": "down"}
    assert [p.name for p in tools.state.iterdir() if p.name.startswith(".modes")] == []
    table = tools.call("known_prices", {"date": "2026-07-24", "quote": "CHF"})[0]
    assert table == {"date": "2026-07-24", "quote": "CHF", "rates": prices.known_table("2026-07-24", "CHF")}


def test_price_requests_omit_what_was_there_at_start(tools):
    assert tools.call("price_requests")[0] == {"requests": [], "next": 3}
    with (tools.state / "requests.jsonl").open("a") as out:
        for seq in (4, 5, 6):
            out.write(json.dumps({"seq": seq}) + "\n")
    answer = tools.call("price_requests")[0]
    assert [r["seq"] for r in answer["requests"]] == [4, 5, 6] and answer["next"] == 6
    assert [r["seq"] for r in tools.call("price_requests", {"since": 5})[0]["requests"]] == [6]
    assert tools.call("price_requests", {"since": 1})[0]["requests"][0]["seq"] == 4


@pytest.mark.skipif(not Path("/proc/self/environ").exists(), reason="needs /proc")
def test_the_server_holds_neither_token_in_its_environment(tmp_path):
    parent = dict(os.environ, GH_TOKEN="gh-secret", CLAUDE_CODE_OAUTH_TOKEN="oauth-secret")
    running = Tools(tmp_path, parent_env=parent)
    try:
        running.rpc("ping")
        environment = Path(f"/proc/{running.process.pid}/environ").read_bytes().split(b"\0")
        names = {entry.split(b"=")[0] for entry in environment if entry}
        assert b"GH_TOKEN" not in names and b"CLAUDE_CODE_OAUTH_TOKEN" not in names
        assert names <= {b"PATH"}
    finally:
        running.close()


# ---- What every file under tools/nightly imports ------------------------


def python_imports(path: Path) -> "list[tuple[str, tuple]]":
    """Absolute imports; a relative one stays inside its own package."""
    found = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found += [(alias.name, ()) for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            found.append((node.module, tuple(sorted(alias.name for alias in node.names))))
    return found


def test_the_harness_scripts_import_nothing_relatively():
    for path in TOOLS.glob("*.py"):
        assert not [n for n in ast.walk(ast.parse(path.read_text())) if isinstance(n, ast.ImportFrom) and n.level], path


def test_every_python_file_imports_the_standard_library_and_only_what_the_spec_lists():
    allowed = {
        "standin.py": {"prices"},
        "mcp.py": {"prices"},
        "prices.py": set(),
        "sources.py": {"solvent.rates"},
    }
    files = sorted(TOOLS.glob("*.py"))
    assert [f.name for f in files] == ["ca.py", "mcp.py", "patch.py", "prices.py", "relay.py", "sources.py", "standin.py"]
    for path in files:
        for module, names in python_imports(path):
            root = module.split(".")[0]
            if root in sys.stdlib_module_names:
                continue
            assert module in allowed.get(path.name, set()), f"{path.name} imports {module}"
            if module == "solvent.rates":
                assert set(names) == {"EGRESS_TIMEOUT_SECONDS", "FX_URL", "MAX_RESPONSE_BYTES", "NBP_URL", "NBP_WINDOW", "SEEDED_SYMBOLS", "USER_AGENT"}


def test_the_generator_imports_node_builtins_and_the_chrome_driver_alone():
    source = (TOOLS / "fixtures.mjs").read_text()
    imported = re.findall(r"""(?:from|import\s*\()\s*['"]([^'"]+)['"]""", source)
    # The /static/js modules are imported inside the page, where the app's
    # own code is served from.
    served = {"session", "writes", "crypto", "api", "decimal", "model"}
    for name in imported:
        assert (
            name.startswith("node:")
            or name == "../../tests/browser/cdp.mjs"
            or (name.startswith("/static/js/") and name[len("/static/js/"):-len(".js")] in served)
        ), name
    assert "../../tests/browser/cdp.mjs" in imported
    assert [p.name for p in TOOLS.glob("*.mjs")] == ["fixtures.mjs"]


@pytest.mark.skipif(shutil.which("node") is None, reason="needs Node")
@pytest.mark.parametrize("invite", ["abc", "invite=abc", "https://example.com/register?invite=abc", ""])
def test_the_generator_takes_the_invite_as_the_path_the_cli_prints_and_nothing_else(invite, tmp_path):
    done = subprocess.run(
        ["node", str(TOOLS / "fixtures.mjs"), "--base", "http://localhost:1", "--invite", invite,
         "--plan", str(tmp_path / "p"), "--out", str(tmp_path)],
        capture_output=True, text=True, timeout=60,
    )
    assert done.returncode == 2 and "usage" in done.stderr


def test_the_generator_writes_no_record_by_its_own_crypto():
    """A request log cannot show it, so the source does: records are
    encrypted in one place, the planting of the two the client's rules
    would never write."""
    source = (TOOLS / "fixtures.mjs").read_text()
    assert "crypto.subtle" not in source and source.count("encryptRecord(") == 1
    assert source.index("encryptRecord(") > source.index("const plant = ")
    assert source.index("encryptRecord(") < source.index("if (op.op === 'profile')")
    assert re.findall(r"\bplant\(", source) == ["plant(", "plant("]
    for name in ("saveProfile", "saveHolding", "saveSnapshot", "refreshPrices", "saveRate", "editedRatePayload", "archiveHolding"):
        assert f"writes.{name}(" in source, name
    assert "/api/rates" not in source.replace("/api/rates\\?", "")


def test_nothing_in_the_app_imports_from_tools():
    for path in (REPO_ROOT / "solvent").rglob("*.py"):
        for module, _ in python_imports(path):
            assert module.split(".")[0] != "tools", path
