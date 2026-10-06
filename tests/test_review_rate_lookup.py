"""Reviewer's tests: egress has one deadline for connect and the whole
read across a proxy request, and a provider sending its answer slowly
has failed once it passes (spec/features/rate-lookup.md, SSRF and egress
hardening, Rate limiting and failure, criteria 17 to 20 and 60). A
figure that is not a usable price, or in an unexpected currency, is no
proposal for the symbols built from it (Edge cases, criteria 61 and 62).
An answer in a changed shape is a failure of its provider, and one bad
rate in a usable table is not (Rate limiting and failure, criteria 61,
63, 64 and 68). A failed fetch logs its source and status and nothing
of the request, and no output carries a provider key (criteria 41 and
66). A date not
written as `date.isoformat()` writes it, or in the future, is a Bad
Request that reaches no provider (SSRF and egress hardening, criteria
43 and 67). With every lookup slot sending, a lookup sends nothing,
answers what needs no source and leaves the breakers alone, and the
next one after a slot frees sends (Rate limiting and failure,
criterion 69). Gold quoted in anything but PLN is priced at the gold
day, the latest day on or before `date` both sources published, and
both its halves are that day's (Providers, Gold, Edge cases, criteria
7, 22, 23, 29, 47, 48, 56 and 70 to 72). A currency no source serves
is never a main currency on offer and, as a quote, asks nothing, and
Not Found is neither a failure nor a success (The symbol table, Rate
limiting and failure, criteria 40 and 73 to 75). An entry for D is kept
for good only once fetched at or after 00:00 UTC on D+2, and any other
for an hour, whatever its `asOf` (Caching, criteria 13, 14, 76 and 77).
Every proposal is the pinned composition rounded once, half to even, to
10 significant digits but never past the twelfth place (Providers, What
the client gets, criteria 57, 78 and 79). A success resets its
provider's count unless that provider counted a failure after the
proxy request began (Rate limiting and failure, criteria 24, 25, 27
and 29). A retired symbol keeps its row but for the flag, and both forms
of the lookup price it, a retired main currency included, while
registration no longer offers it (The symbol table, Maintaining the
table, criterion 35). A metal names its weight: adding one that does
not is refused, a stored one is retired at every start and cannot be
restored, and a code with a trailing newline is refused everywhere
(Seeded symbols, SSRF and egress hardening, criteria 81 and 82).

Written from the spec alone. Each provider is reached on a loopback HTTP
server through the app's own opener, so the app's real socket timeout
and read path apply, and the server decides how fast each byte goes.
"""
from __future__ import annotations

import json
import logging
import re
import socket
import ssl
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_EVEN, Decimal

import pytest

import solvent.rates as rates
from tests.helpers import CSRF, connect, mint_invite, register, rows, sign_in

PAST = "2026-07-31"
# How late a receive may start after the deadline, for scheduling alone.
SLACK = 0.3
# Well inside any socket timeout the app could set below its deadline.
TRICKLE = 0.8


def round_proposal(figure: Decimal) -> str:
    """Providers: rounded once, half to even, to 10 significant digits
    but never past the twelfth decimal place, written plain with no
    trailing zeros and no exponent."""
    step = Decimal(1).scaleb(max(figure.adjusted() - 9, -12))
    return format(figure.quantize(step, ROUND_HALF_EVEN).normalize(), "f")


def _frankfurter(url: str) -> bytes:
    on = url.split("/v1/")[1][:10]
    base = url.rsplit("base=", 1)[1]
    return json.dumps(
        {"amount": 1, "base": base, "date": on, "rates": {"PLN": 4.2537, "USD": 1.0876}}
    ).encode()


def _nbp(url: str, lag_days: int = 0) -> bytes:
    end = date.fromisoformat(url.split("?")[0].rsplit("/", 1)[1])
    return json.dumps(
        [{"data": (end - timedelta(days=lag_days)).isoformat(), "cena": 251.37}]
    ).encode()


def _provider(url: str) -> str:
    return "nbp" if "nbp.pl" in url else "frankfurter"


def head(status: int, headers: dict) -> bytes:
    lines = [f"HTTP/1.1 {status} X", "Connection: close"]
    lines += [f"{name}: {value}" for name, value in headers.items()]
    return ("\r\n".join(lines) + "\r\n\r\n").encode()


def answer(body: bytes, status: int = 200, headers: dict | None = None) -> bytes:
    return head(status, {"Content-Length": len(body), **(headers or {})}) + body


def at_once(body_of, status=200, headers=None):
    """A plan sending the whole answer at once."""
    return lambda url: ([answer(body_of(url), status, headers)], 0)


def trickle(body_of, pieces=None, interval=TRICKLE):
    """A plan sending the head at once, then the body one byte at a
    time, or in `pieces`."""

    def plan(url):
        body = body_of(url)
        size = -(-len(body) // (pieces or len(body)))
        parts = [body[i:i + size] for i in range(0, len(body), size)]
        return [head(200, {"Content-Length": len(body)}), *parts], interval

    return plan


def every_byte(raw_of, interval=TRICKLE):
    """A plan sending the whole answer, its head too, a byte at a time."""
    return lambda url: ([bytes([b]) for b in raw_of(url)], interval)


def chunked(body: bytes) -> bytes:
    """A body in chunked transfer encoding, one chunk per byte, so most
    of what goes out is chunk-size lines."""
    framed = b"".join(b"1\r\n" + bytes([b]) + b"\r\n" for b in body)
    return head(200, {"Transfer-Encoding": "chunked"}) + framed + b"0\r\n\r\n"


class Sources:
    """A loopback server answering as both providers. `plans` maps a
    provider to a function of the URL the app asked for, returning
    `(pieces, interval)`: the first piece goes out at once and each
    next one `interval` seconds later. `opened` records each
    connection's provider and time, and `receives` the start time of
    every receive the app makes on a connection to this server."""

    def __init__(self, tls: ssl.SSLContext | None = None):
        self.tls = tls
        self.plans = {
            "frankfurter": at_once(_frankfurter),
            "nbp": at_once(_nbp),
        }
        self.opened: list[tuple[str, float]] = []
        self.receives: list[float] = []
        self._pending: dict[str, tuple] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self.listener = socket.create_server(("127.0.0.1", 0))
        self.listener.settimeout(0.05)
        self.port = self.listener.getsockname()[1]
        acceptor = threading.Thread(target=self._accept, daemon=True)
        acceptor.start()
        self._threads.append(acceptor)

    def route(self, request: urllib.request.Request) -> urllib.request.Request:
        url = request.full_url
        provider = _provider(url)
        token = f"{len(self.opened)}-{time.monotonic_ns()}"
        with self._lock:
            self.opened.append((provider, time.monotonic()))
            self._pending[token] = self.plans[provider](url)
        scheme = "https" if self.tls else "http"
        return urllib.request.Request(
            f"{scheme}://127.0.0.1:{self.port}/{token}", headers=request.headers
        )

    def _accept(self):
        while not self._stop.is_set():
            try:
                connection, _ = self.listener.accept()
            except (TimeoutError, OSError):
                continue
            worker = threading.Thread(target=self._serve, args=(connection,), daemon=True)
            worker.start()
            self._threads.append(worker)

    def _serve(self, connection: socket.socket):
        connection.settimeout(5)
        if self.tls:
            try:
                connection = self.tls.wrap_socket(connection, server_side=True)
            except OSError:
                connection.close()
                return
        with connection:
            head = b""
            try:
                while b"\r\n\r\n" not in head:
                    chunk = connection.recv(4096)
                    if not chunk:
                        return
                    head += chunk
            except OSError:
                return
            token = head.split(b" ", 2)[1].decode().lstrip("/")
            with self._lock:
                pieces, interval = self._pending.pop(token)
            try:
                connection.sendall(pieces[0])
                for piece in pieces[1:]:
                    if self._stop.wait(interval):
                        return
                    connection.sendall(piece)
            except OSError:
                return

    def close(self):
        self._stop.set()
        self.listener.close()
        for thread in self._threads:
            thread.join(timeout=2)


@pytest.fixture
def sources(monkeypatch):
    yield from _serving(monkeypatch, Sources())


def _self_signed(tmp_path) -> tuple[ssl.SSLContext, str]:
    """A server context with a certificate made for the test, and the
    certificate's path."""
    key, cert = tmp_path / "key.pem", tmp_path / "cert.pem"
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
            "-nodes", "-keyout", str(key), "-out", str(cert), "-days", "1",
            "-subj", "/CN=127.0.0.1",
            "-addext", "subjectAltName=IP:127.0.0.1",
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,digitalSignature,keyCertSign",
        ],
        check=True,
        capture_output=True,
    )
    served = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    served.load_cert_chain(cert, key)
    return served, str(cert)


@pytest.fixture
def secure_sources(monkeypatch, tmp_path):
    """`sources` over HTTPS, so the read goes through the opener's own
    HTTPS connection, the one every real provider is reached on. The
    opener's HTTPS handler is handed a context trusting the test's
    certificate and nothing else changed."""
    served, cert = _self_signed(tmp_path)
    (handler,) = [h for h in rates._opener.handlers if isinstance(h, urllib.request.HTTPSHandler)]
    monkeypatch.setattr(handler, "_context", ssl.create_default_context(cafile=cert))
    yield from _serving(monkeypatch, Sources(tls=served))


def _serving(monkeypatch, server):
    real_open = rates._opener.open

    def open_(request, timeout=None):
        return real_open(server.route(request), timeout=timeout)

    monkeypatch.setattr(rates._opener, "open", open_)

    real_recv_into = socket.socket.recv_into

    def recv_into(sock, *args, **kwargs):
        try:
            peer = sock.getpeername()
        except OSError:
            peer = None
        if peer == ("127.0.0.1", server.port):
            server.receives.append(time.monotonic())
        return real_recv_into(sock, *args, **kwargs)

    monkeypatch.setattr(socket.socket, "recv_into", recv_into)
    real_tls_recv_into = ssl.SSLSocket.recv_into

    def tls_recv_into(sock, *args, **kwargs):
        try:
            peer = sock.getpeername()
        except OSError:
            peer = None
        if peer == ("127.0.0.1", server.port):
            server.receives.append(time.monotonic())
        return real_tls_recv_into(sock, *args, **kwargs)

    monkeypatch.setattr(ssl.SSLSocket, "recv_into", tls_recv_into)
    yield server
    server.close()


def lookup(owner, url):
    started = time.monotonic()
    response = owner.get(url, headers=CSRF)
    return response, started, time.monotonic() - started


BOUND = rates.EGRESS_TIMEOUT_SECONDS + 1


def test_both_providers_trickling_give_no_content_within_the_bound(owner, sources):
    """Criterion 60."""
    sources.plans["frankfurter"] = trickle(_frankfurter)
    sources.plans["nbp"] = trickle(_nbp)

    response, _, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF")

    assert response.status_code == 204
    assert took < BOUND
    assert sorted(p for p, _ in sources.opened) == ["frankfurter", "nbp"]
    (_, first), (_, second) = sources.opened
    assert abs(first - second) < 1


def test_a_trickling_answer_gets_no_receive_started_past_the_deadline(owner, sources):
    """SSRF and egress hardening: the reading thread starts no receive
    past the deadline, observed on the socket rather than on the
    response."""
    sources.plans["frankfurter"] = trickle(_frankfurter)
    sources.plans["nbp"] = trickle(_nbp)

    _, started, _ = lookup(owner, f"/api/rates?date={PAST}&quote=CHF")
    time.sleep(3 * TRICKLE)

    assert sources.receives
    late = [t - started for t in sources.receives if t > started + rates.EGRESS_TIMEOUT_SECONDS + SLACK]
    assert late == []


@pytest.mark.parametrize(
    "plan",
    [
        pytest.param(lambda: every_byte(lambda url: answer(_frankfurter(url))), id="head-a-byte-at-a-time"),
        pytest.param(lambda: every_byte(lambda url: chunked(_frankfurter(url))), id="chunked-a-byte-at-a-time"),
    ],
)
def test_no_receive_starts_past_the_deadline_however_the_answer_is_framed(owner, sources, plan):
    """SSRF and egress hardening: "that thread starts no receive past
    it" holds while the status line and headers trickle in, and while
    chunk-size lines do, not only for the bytes of a sized body."""
    sources.plans["frankfurter"] = plan()

    response, started, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF&symbol=USD")
    time.sleep(3 * TRICKLE)

    assert response.status_code == 204
    assert took < BOUND
    assert sources.receives
    late = [t - started for t in sources.receives if t > started + rates.EGRESS_TIMEOUT_SECONDS + SLACK]
    assert late == []


def test_a_trickling_single_symbol_answer_is_no_content_within_the_bound(owner, sources):
    sources.plans["frankfurter"] = trickle(_frankfurter)

    response, _, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF&symbol=USD")

    assert response.status_code == 204
    assert took < BOUND


def test_frankfurter_trickling_leaves_the_gold_symbols_in_a_pln_table(owner, sources):
    """Criterion 19, with a provider that answers slowly rather than
    not at all."""
    sources.plans["frankfurter"] = trickle(_frankfurter)

    response, _, took = lookup(owner, f"/api/rates?date={PAST}&quote=PLN")

    assert response.status_code == 200
    assert set(response.get_json()["rates"]) == {"XAU-g", "XAU-ozt"}
    assert took < BOUND


def test_nbp_trickling_leaves_the_currency_rates(owner, sources):
    """Criterion 20, with a provider that answers slowly rather than
    not at all."""
    sources.plans["nbp"] = trickle(_nbp)

    response, _, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF")

    assert response.status_code == 200
    symbols = set(response.get_json()["rates"])
    assert {"USD", "PLN"} <= symbols
    assert not symbols & {"XAU-g", "XAU-ozt"}
    assert took < BOUND


def test_slow_providers_finishing_inside_the_shared_deadline_both_answer(owner, sources):
    """Rate limiting and failure: a slow provider that answers within the
    whole deadline has not failed, and both are waited for at once."""
    spread = rates.EGRESS_TIMEOUT_SECONDS * 0.6
    sources.plans["frankfurter"] = trickle(_frankfurter, pieces=6, interval=spread / 6)
    sources.plans["nbp"] = trickle(_nbp, pieces=6, interval=spread / 6)

    response, _, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF")

    assert response.status_code == 200
    symbols = set(response.get_json()["rates"])
    assert {"USD", "PLN", "XAU-g", "XAU-ozt"} <= symbols
    assert took < BOUND


def test_the_quote_leg_gets_only_what_is_left_of_the_deadline(owner, sources):
    """Rate limiting and failure: the quote leg goes out once NBP has
    answered, with what is left of the one deadline. NBP publishes the
    day before, so the leg is a request of its own. Each takes most of
    the deadline, so a deadline per request would answer."""
    spread = rates.EGRESS_TIMEOUT_SECONDS * 0.6
    sources.plans["nbp"] = trickle(lambda url: _nbp(url, lag_days=1), pieces=6, interval=spread / 6)
    sources.plans["frankfurter"] = trickle(_frankfurter, pieces=6, interval=spread / 6)

    response, _, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g")

    assert response.status_code == 204
    assert took < BOUND
    assert [p for p, _ in sources.opened] == ["nbp", "frankfurter"]


def test_a_trickling_answer_counts_as_a_failure_for_its_breaker(app, owner, sources):
    """Rate limiting and failure: a request that times out is a failure,
    and the breaker opens on the configured count."""
    app.config["RATE_BREAKER_FAILURES"] = 2
    sources.plans["frankfurter"] = trickle(_frankfurter)

    for offset in range(3):
        day = (date.fromisoformat(PAST) - timedelta(days=offset)).isoformat()
        response = owner.get(f"/api/rates?date={day}&quote=CHF&symbol=USD", headers=CSRF)
        assert response.status_code == 204

    assert [p for p, _ in sources.opened] == ["frankfurter", "frankfurter"]
    assert rates.breakers["nbp"].failures == 0


def test_a_body_over_the_cap_fails_rather_than_being_cut_short(owner, sources):
    """SSRF and egress hardening: the response cap holds on the read
    path the deadline runs on."""

    def oversized(url):
        body = _frankfurter(url)
        return body[:-1] + b" " * (rates.MAX_RESPONSE_BYTES + 1 - len(body)) + b"}"

    sources.plans["frankfurter"] = at_once(oversized)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)

    assert response.status_code == 204


def test_a_body_just_under_the_cap_is_read_whole(owner, sources):
    def padded(url):
        body = _frankfurter(url)
        return body[:-1] + b" " * (rates.MAX_RESPONSE_BYTES - len(body)) + b"}"

    sources.plans["frankfurter"] = at_once(padded)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)

    assert response.status_code == 200
    assert response.get_json()["rate"]


def test_a_redirect_toward_an_internal_address_is_not_followed(owner, sources):
    """Criterion 17, asserted on the requests sent: the address the
    redirect names never gets a connection."""
    internal = socket.create_server(("127.0.0.1", 0))
    internal.settimeout(0.05)
    target = f"http://127.0.0.1:{internal.getsockname()[1]}/admin"
    reached = []
    done = threading.Event()

    def watch():
        while not done.is_set():
            try:
                reached.append(internal.accept()[0])
            except (TimeoutError, OSError):
                continue

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    sources.plans["frankfurter"] = at_once(lambda url: b"", 302, {"Location": target})
    try:
        response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
        time.sleep(0.5)
    finally:
        done.set()
        watcher.join()
        internal.close()
        for connection in reached:
            connection.close()

    assert response.status_code == 204
    assert reached == []
    assert [p for p, _ in sources.opened] == ["frankfurter"]


@pytest.mark.parametrize(
    "plan",
    [
        pytest.param(lambda: trickle(_frankfurter), id="sized-body-a-byte-at-a-time"),
        pytest.param(lambda: every_byte(lambda url: answer(_frankfurter(url))), id="head-a-byte-at-a-time"),
        pytest.param(lambda: every_byte(lambda url: chunked(_frankfurter(url))), id="chunked-a-byte-at-a-time"),
    ],
)
def test_over_https_no_receive_starts_past_the_deadline(owner, secure_sources, plan):
    """SSRF and egress hardening, on the connection a provider is
    actually reached on: the sockets the read opened are shut at the
    deadline, so it receives nothing past it, however the answer is
    framed."""
    secure_sources.plans["frankfurter"] = plan()

    response, started, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF&symbol=USD")
    time.sleep(3 * TRICKLE)

    assert response.status_code == 204
    assert took < BOUND
    assert secure_sources.receives
    late = [t - started for t in secure_sources.receives if t > started + rates.EGRESS_TIMEOUT_SECONDS + SLACK]
    assert late == []


def test_over_https_an_answer_sent_at_once_is_read(owner, secure_sources):
    """The test certificate is trusted, so a failure above is the
    deadline's and not the handshake's."""
    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)

    assert response.status_code == 200
    assert secure_sources.opened == [("frankfurter", secure_sources.opened[0][1])]


# A figure that is not a usable price, and a rate in an unexpected
# currency (Edge cases, criteria 61 and 62).

NOT_USABLE = [0, -1, "1.0876", True, False, float("nan"), float("inf"), float("-inf"), 1e300, 1e-25]
GOLD = {"XAU-g", "XAU-ozt"}


def fx_table(base=None, **figures):
    """Frankfurter's table for the URL asked, with `figures` replacing
    or adding rates, and `base` replacing the base it was asked for."""

    def body_of(url):
        on = url.split("/v1/")[1][:10]
        return json.dumps(
            {
                "amount": 1,
                "base": base or url.rsplit("base=", 1)[1],
                "date": on,
                "rates": {"PLN": 4.2537, "USD": 1.0876, **figures},
            }
        ).encode()

    return body_of


def gold_price(cena, lag_days=0):
    def body_of(url):
        end = date.fromisoformat(url.split("?")[0].rsplit("/", 1)[1])
        on = (end - timedelta(days=lag_days)).isoformat()
        return json.dumps([{"data": on, "cena": cena}]).encode()

    return body_of


def day(offset: int) -> str:
    return (date.fromisoformat(PAST) - timedelta(days=offset)).isoformat()


def table(owner, quote="CHF", on=PAST):
    response = owner.get(f"/api/rates?date={on}&quote={quote}", headers=CSRF)
    assert response.status_code in (200, 204), response.get_data(as_text=True)
    return response.get_json()["rates"] if response.status_code == 200 else {}


def failures() -> dict[str, int]:
    return {name: breaker.failures for name, breaker in rates.breakers.items()}


NONE_FAILED = {"frankfurter": 0, "nbp": 0}


@pytest.mark.parametrize("figure", NOT_USABLE, ids=repr)
def test_a_currency_rate_that_is_not_a_usable_price_is_no_proposal(owner, sources, figure):
    """Criterion 61: no proposal for that symbol, never an error or a 0,
    and the rest of the table stands."""
    sources.plans["frankfurter"] = at_once(fx_table(USD=figure))

    priced = table(owner)

    assert "USD" not in priced
    assert {"PLN", *GOLD} <= set(priced)
    assert failures() == NONE_FAILED
    single = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert single.status_code == 204


@pytest.mark.parametrize("figure", NOT_USABLE, ids=repr)
def test_a_gold_price_that_is_not_usable_drops_both_gold_symbols_alone(owner, sources, figure):
    """Criterion 61: a bad NBP price drops both gold symbols, the
    currencies stand, and it counts one NBP failure, except `1e-25`, a
    usable price whose proposal rounds to 0."""
    sources.plans["nbp"] = at_once(gold_price(figure))

    priced = table(owner)

    assert not GOLD & set(priced)
    assert {"USD", "PLN"} <= set(priced)
    assert failures() == {"frankfurter": 0, "nbp": 0 if figure == 1e-25 else 1}
    assert owner.get(f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF).status_code == 204


@pytest.mark.parametrize("lag_days", [0, 1], ids=["one table", "a quote leg of its own"])
@pytest.mark.parametrize("figure", NOT_USABLE, ids=repr)
def test_a_pln_rate_that_is_not_usable_drops_gold_quoted_elsewhere(owner, sources, figure, lag_days):
    """Criterion 61: a bad PLN rate drops gold quoted in anything but
    PLN, and with it PLN itself, while the other currencies stand. It is
    one bad rate in a usable table, so it adds no breaker failure,
    whether the quote leg reuses the requested day's table or has its
    own."""
    sources.plans["frankfurter"] = at_once(fx_table(PLN=figure))
    sources.plans["nbp"] = at_once(gold_price(251.37, lag_days=lag_days))

    priced = table(owner)

    assert not ({"PLN"} | GOLD) & set(priced)
    assert priced["USD"]["rate"] == "0.9194556822"
    assert failures() == NONE_FAILED


@pytest.mark.parametrize(
    ("figure", "served"),
    [
        (1.9e12, "0.000000000001"),  # 5.26e-13 rounds up to the twelfth place
        (2e12, None),  # exactly 5e-13, half to even rounds to 0
        (1e-20, None),  # exactly 10^20, not below it
        (1.0000000001e-20, "99999999990000000000"),  # 10 digits below 10^20
        (1.00000000001e-20, None),  # rounds to 10 digits as 10^20 itself
    ],
    ids=repr,
)
def test_a_proposal_is_served_only_when_rounded_it_is_above_0_and_below_10_to_the_20(
    owner, sources, figure, served
):
    """Edge cases: the bounds apply to the rounded proposal."""
    sources.plans["frankfurter"] = at_once(fx_table(USD=figure))

    priced = table(owner)

    if served is None:
        assert "USD" not in priced
    else:
        assert priced["USD"]["rate"] == served


def test_the_bounds_apply_to_each_gold_symbol_on_its_own(owner, sources):
    """A usable price can still make one symbol's proposal fall outside
    the bounds: grams round to 0 where ounces do not, and ounces pass
    10^20 where grams do not."""
    sources.plans["nbp"] = at_once(gold_price(1e-13))
    priced = table(owner, quote="PLN", on=day(0))
    assert "XAU-g" not in priced
    assert priced["XAU-ozt"]["rate"] == "0.000000000003"

    sources.plans["nbp"] = at_once(gold_price(1e19))
    priced = table(owner, quote="PLN", on=day(1))
    assert priced["XAU-g"]["rate"] == "10000000000000000000"
    assert "XAU-ozt" not in priced


@pytest.mark.parametrize(
    "bad",
    [at_once(fx_table(USD=0)), at_once(fx_table(PLN=0)), at_once(fx_table(SEK="1.5"))],
    ids=["the rate asked for", "the PLN rate", "another rate"],
)
def test_one_bad_rate_in_a_usable_table_counts_as_a_success(app, owner, sources, bad):
    """Rate limiting and failure: the table holds a usable rate, so one
    bad code resets Frankfurter's count rather than opening its breaker.
    Counted as a failure, the breaker opens on the third request and the
    sixth is never sent."""
    app.config["RATE_BREAKER_FAILURES"] = 3
    failing = at_once(lambda _: b"{}", 500)

    for offset, plan in enumerate([failing, failing, bad, failing, failing, bad]):
        sources.plans["frankfurter"] = plan
        owner.get(f"/api/rates?date={day(offset)}&quote=CHF&symbol=USD", headers=CSRF)

    assert [p for p, _ in sources.opened] == ["frankfurter"] * 6


def test_a_table_in_another_currency_is_no_proposal(owner, sources):
    """Edge cases, a rate in an unexpected currency: a table based on
    another currency than the quote prices nothing, gold included."""
    sources.plans["frankfurter"] = at_once(fx_table(base="EUR"))

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    assert response.status_code == 204


def test_a_quote_leg_in_another_currency_drops_only_gold(owner, sources):
    """NBP publishes the day before, so the quote leg is a table of its
    own. Based on the wrong currency, it gives gold no proposal and
    leaves the currencies of the requested day."""
    asked = date.fromisoformat(PAST)
    right, wrong = fx_table(), fx_table(base="EUR")
    sources.plans["nbp"] = at_once(gold_price(251.37, lag_days=1))
    sources.plans["frankfurter"] = at_once(
        lambda url: (right if f"/v1/{PAST}" in url else wrong)(url)
    )

    priced = table(owner, on=asked.isoformat())

    assert {"USD", "PLN"} <= set(priced)
    assert not GOLD & set(priced)


def plant(app, symbol, quote, on, rate, source):
    from solvent.db import utcnow

    with connect(app) as conn:
        conn.execute(
            "INSERT INTO rate_cache (symbol, quote, date, rate, as_of, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (symbol, quote, on, rate, on, source, utcnow()),
        )
    conn.close()


def cached(app, symbol, quote, on):
    return rows(
        app, "SELECT rate FROM rate_cache WHERE symbol = ? AND quote = ? AND date = ?", (symbol, quote, on)
    )


def test_a_cached_zero_is_fetched_again_and_replaced(app, owner, sources):
    """Criterion 62, for a single symbol: the provider is asked, and the
    zero is gone from the cache, so the repeat is a hit."""
    plant(app, "USD", "CHF", PAST, "0", "frankfurter")

    first = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()
    again = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()

    assert (first["rate"], first["cached"]) == ("0.9194556822", False)
    assert (again["rate"], again["cached"]) == ("0.9194556822", True)
    assert cached(app, "USD", "CHF", PAST) == [{"rate": "0.9194556822"}]
    assert [p for p, _ in sources.opened] == ["frankfurter"]


def test_a_cached_zero_is_a_miss_in_the_whole_table(app, owner, sources):
    plant(app, "USD", "CHF", PAST, "0", "frankfurter")
    plant(app, "XAU-g", "PLN", PAST, "0", "nbp")

    assert table(owner)["USD"]["rate"] == "0.9194556822"
    assert table(owner, quote="PLN")["XAU-g"]["rate"] == "251.37"
    assert cached(app, "XAU-g", "PLN", PAST) == [{"rate": "251.37"}]


def test_a_rate_with_more_digits_than_python_converts_is_no_proposal(owner, sources):
    """A JSON number of 5000 digits is still a JSON number, finite and
    above 0, whose proposal rounds to 0. Edge cases: no proposal for
    that symbol, the rest of the table stands, and the source answered,
    so its breaker counts a success."""

    def body_of(url):
        opening = fx_table()(url)[:-2]
        return opening + b', "SEK": 1' + b"0" * 5000 + b"}}"

    sources.plans["frankfurter"] = at_once(body_of)

    priced = table(owner)

    assert rates.breakers["frankfurter"].failures == 0
    assert "SEK" not in priced
    assert {"USD", "PLN", *GOLD} <= set(priced)


def test_a_gold_price_whose_ounce_figure_passes_any_decimal_is_no_proposal(owner, sources):
    """A gold price of a million digits fits under the response cap, is a
    JSON number, finite and above 0. Edge cases: both gold proposals are
    out of bounds, so neither is served, never an error, and the
    currencies stand."""
    sources.plans["nbp"] = at_once(
        lambda url: b'[{"data": "' + url.split("?")[0].rsplit("/", 1)[1].encode()
        + b'", "cena": 1' + b"0" * 1_000_000 + b"}]"
    )

    response = owner.get(f"/api/rates?date={PAST}&quote=PLN", headers=CSRF)

    assert response.status_code == 200
    priced = response.get_json()["rates"]
    assert not GOLD & set(priced)
    assert "USD" in priced


# A publication date that is not usable (Edge cases, criteria 63 to 65).

class _Missing:
    """A key the source left out of its answer."""

    def __repr__(self):
        return "missing"


MISSING = _Missing()
WINDOW_START = day(14)
NOT_A_USABLE_DAY = [
    "31.07.2026",
    "2026-13-01",
    "20260731",
    "2026-W31-5",
    "2026-07-31T00:00:00",
    "2026-07-31 ",
    20260731,
    None,
    True,
    ["2026-07-31"],
    MISSING,
]
LATER = (date.fromisoformat(PAST) + timedelta(days=1)).isoformat()


def dated(entry: dict, key: str, on):
    if on is not MISSING:
        entry[key] = on
    return entry


def gold_on(on, cena=251.37):
    return lambda url: json.dumps([dated({"cena": cena}, "data", on)]).encode()


def fx_on(on_for):
    """Frankfurter's table whose `date` is `on_for(day asked)`."""

    def body_of(url):
        asked = url.split("/v1/")[1][:10]
        body = {"amount": 1, "base": url.rsplit("base=", 1)[1], "rates": {"PLN": 4.2537, "USD": 1.0876}}
        return json.dumps(dated(body, "date", on_for(asked))).encode()

    return body_of


def asked_urls(sources) -> list[str]:
    urls = []
    route = sources.route

    def recording(request):
        urls.append(request.full_url)
        return route(request)

    sources.route = recording
    return urls


@pytest.mark.parametrize("quote", ["CHF", "PLN"])
@pytest.mark.parametrize("on", [*NOT_A_USABLE_DAY, LATER, day(15)], ids=repr)
def test_a_gold_date_that_is_not_usable_drops_only_gold(owner, sources, on, quote):
    """Criterion 63: a changed shape, so only NBP's breaker counts it."""
    sources.plans["nbp"] = at_once(gold_on(on))

    response = owner.get(f"/api/rates?date={PAST}&quote={quote}", headers=CSRF)

    assert response.status_code == 200
    priced = response.get_json()["rates"]
    assert not GOLD & set(priced)
    assert "USD" in priced
    assert failures() == {"frankfurter": 0, "nbp": 1}
    for symbol in sorted(GOLD):
        single = owner.get(f"/api/rates?date={PAST}&quote={quote}&symbol={symbol}", headers=CSRF)
        assert single.status_code == 204


@pytest.mark.parametrize("on", [WINDOW_START, PAST])
def test_a_gold_date_at_either_end_of_the_window_is_its_as_of(owner, sources, on):
    """Edge cases: the window's first day and the requested date are both
    usable, and the quote leg is fetched at that day (criterion 47)."""
    sources.plans["nbp"] = at_once(gold_on(on))
    urls = asked_urls(sources)

    chf = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF)
    pln = owner.get(f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF)

    assert (chf.status_code, chf.get_json()["asOf"]) == (200, on)
    assert (pln.status_code, pln.get_json()["asOf"]) == (200, on)
    assert rates.FX_URL.format(date=on, quote="CHF") in urls


@pytest.mark.parametrize(
    "on", ["2026-07-30?base=EUR#", "../2026-07-30", "2026-07-30/../../latest", "20260730", "2026-W31-4"]
)
def test_a_gold_date_that_is_not_usable_never_reaches_the_quote_legs_url(owner, sources, on):
    """Criterion 56 and Edge cases: NBP's `data` fills the quote leg's
    date only once it is a canonical day, so no other text reaches an
    outbound URL, and no leg goes out for a date that is no answer."""
    sources.plans["nbp"] = at_once(gold_on(on))
    urls = asked_urls(sources)

    owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    assert urls
    assert set(u for u in urls if "frankfurter" in u) == {rates.FX_URL.format(date=PAST, quote="CHF")}


@pytest.mark.parametrize(
    ("provider", "url", "bad"),
    [
        ("nbp", "quote=PLN&symbol=XAU-g", at_once(gold_on("not a day"))),
        ("nbp", "quote=PLN&symbol=XAU-g", at_once(gold_price("251.37"))),
        ("frankfurter", "quote=CHF&symbol=USD", at_once(fx_on(lambda asked: "not a day"))),
        ("frankfurter", "quote=CHF&symbol=USD", at_once(fx_table(base="EUR"))),
        ("frankfurter", "quote=CHF&symbol=USD", at_once(fx_table(USD=0, PLN=-1))),
    ],
    ids=["nbp date", "nbp price", "frankfurter date", "frankfurter base", "frankfurter no usable rate"],
)
def test_a_changed_shape_opens_its_breaker_like_an_outage(app, owner, sources, provider, url, bad):
    """Rate limiting and failure: a changed shape is a failure, so mixed
    with outages it opens the breaker on the configured count, and the
    next request sends nothing within the cool-off."""
    app.config["RATE_BREAKER_FAILURES"] = 3
    failing = at_once(lambda _: b"{}", 500)

    for offset, plan in enumerate([failing, bad, failing]):
        sources.plans[provider] = plan
        response = owner.get(f"/api/rates?date={day(offset)}&{url}", headers=CSRF)
        assert response.status_code == 204
    sources.plans = {"frankfurter": at_once(_frankfurter), "nbp": at_once(_nbp)}
    response = owner.get(f"/api/rates?date={day(3)}&{url}", headers=CSRF)

    assert response.status_code == 204
    assert [p for p, _ in sources.opened] == [provider] * 3


@pytest.mark.parametrize("on", [*NOT_A_USABLE_DAY, LATER], ids=repr)
def test_a_currency_date_that_is_not_usable_drops_what_its_table_prices(owner, sources, on):
    """Criterion 64: each request counts one Frankfurter failure and
    none for NBP."""
    sources.plans["frankfurter"] = at_once(fx_on(lambda asked: on))
    counts = []

    pln = owner.get(f"/api/rates?date={PAST}&quote=PLN", headers=CSRF)
    counts.append(failures())
    chf = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)
    counts.append(failures())
    usd = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    counts.append(failures())

    assert pln.status_code == 200
    assert set(pln.get_json()["rates"]) == GOLD
    assert chf.status_code == 204
    assert usd.status_code == 204
    assert counts == [{"frankfurter": n, "nbp": 0} for n in (1, 2, 3)]


def test_an_earlier_currency_date_is_its_as_of(owner, sources):
    """Edge cases: Frankfurter's `date` before the requested one is the
    prior close, not a bad date."""
    sources.plans["frankfurter"] = at_once(fx_on(lambda asked: day(2)))

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)

    assert (response.status_code, response.get_json()["asOf"]) == (200, day(2))


def test_a_quote_leg_with_a_bad_date_drops_only_gold(owner, sources):
    """Edge cases: NBP publishes the day before, so the quote leg is a
    table of its own. Its bad date drops gold quoted in CHF and leaves
    the currencies of the requested day."""
    sources.plans["nbp"] = at_once(gold_on(day(1)))
    sources.plans["frankfurter"] = at_once(fx_on(lambda asked: asked if asked == PAST else "not a day"))

    priced = table(owner)

    assert {"USD", "PLN"} <= set(priced)
    assert not GOLD & set(priced)


def plant_as_of(app, symbol, quote, on, as_of, rate, source):
    from solvent.db import utcnow

    with connect(app) as conn:
        conn.execute(
            "INSERT INTO rate_cache (symbol, quote, date, rate, as_of, source, fetched_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (symbol, quote, on, rate, as_of, source, utcnow()),
        )
    conn.close()


def cached_as_of(app, symbol, quote, on):
    return rows(
        app,
        "SELECT rate, as_of FROM rate_cache WHERE symbol = ? AND quote = ? AND date = ?",
        (symbol, quote, on),
    )


@pytest.mark.parametrize("as_of", ["not a day", "2026-13-01", "20260731", "2026-W31-5", LATER], ids=repr)
def test_a_cached_rate_with_an_unusable_date_is_fetched_again(app, owner, sources, as_of):
    """Criterion 65, for a single symbol and the whole table: the
    provider is asked, the row is replaced, and the repeat is a hit."""
    plant_as_of(app, "USD", "CHF", PAST, as_of, "0.9", "frankfurter")
    plant_as_of(app, "XAU-g", "PLN", PAST, as_of, "250", "nbp")

    first = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()
    again = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()
    gold = table(owner, quote="PLN")["XAU-g"]

    assert (first["rate"], first["asOf"], first["cached"]) == ("0.9194556822", PAST, False)
    assert again["cached"] is True
    assert (gold["rate"], gold["asOf"], gold["cached"]) == ("251.37", PAST, False)
    assert cached_as_of(app, "USD", "CHF", PAST) == [{"rate": "0.9194556822", "as_of": PAST}]
    assert cached_as_of(app, "XAU-g", "PLN", PAST) == [{"rate": "251.37", "as_of": PAST}]


def test_a_cached_gold_rate_dated_before_its_window_is_fetched_again(app, owner, sources):
    """Edge cases: a cached row's `asOf` is held to the same test as a
    fresh one, which for NBP includes the 14-day window."""
    plant_as_of(app, "XAU-g", "PLN", PAST, day(15), "250", "nbp")

    response = owner.get(f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF).get_json()

    assert (response["rate"], response["asOf"], response["cached"]) == ("251.37", PAST, False)
    assert [p for p, _ in sources.opened] == ["nbp"]


@pytest.mark.parametrize(("symbol", "quote", "as_of", "source"), [
    ("USD", "CHF", day(3), "frankfurter"),
    ("XAU-g", "PLN", WINDOW_START, "nbp"),
])
def test_a_cached_rate_with_a_usable_earlier_date_is_a_hit(app, owner, sources, symbol, quote, as_of, source):
    """The miss is for a date that is not usable, not for any prior
    close."""
    plant_as_of(app, symbol, quote, PAST, as_of, "1.5", source)

    response = owner.get(f"/api/rates?date={PAST}&quote={quote}&symbol={symbol}", headers=CSRF).get_json()

    assert (response["rate"], response["asOf"], response["cached"]) == ("1.5", as_of, True)
    assert sources.opened == []


# A failed fetch's log line (Rate limiting and failure, criteria 41 and 66).

LINE = re.compile(
    r"rates\.provider source=(frankfurter|nbp) status=(\d{3}|shape|timeout|tls|network|body|other)"
)
FETCH = {
    "frankfurter": f"/api/rates?date={PAST}&quote=CHF&symbol=USD",
    "nbp": f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g",
}
# What a lookup asks for, where it goes and what came back, none of
# which a line may carry.
LEAKS = [
    "api.frankfurter.dev", "api.nbp.pl", "cenyzlota", "127.0.0.1", "http", "base=",
    "format=", "?", PAST, day(1), "CHF", "PLN", "USD", "Leaky", "leaky", "rror",
]


def raw(data: bytes):
    """A plan sending `data` as the whole answer, as it is."""
    return lambda url: ([data], 0)


def silent(url):
    """A plan accepting the request and never answering."""
    return [b"", b""], 60


ANSWERS = {
    "503": (raw(b"HTTP/1.1 503 Leaky Reason\r\nConnection: close\r\n"
                b"Content-Length: 11\r\n\r\nleaky body!"), {"503"}),
    "429": (at_once(lambda url: b"leaky slow down", status=429), {"429"}),
    "302": (raw(head(302, {"Location": "http://169.254.169.254/leaky", "Content-Length": 0})),
            {"302"}),
    "not json": (at_once(lambda url: b"<html>leaky</html>"), {"body"}),
    "over the cap": (at_once(lambda url: b"[" + b" " * rates.MAX_RESPONSE_BYTES + b"1]"),
                     {"body", "other"}),
    "silent": (silent, {"timeout"}),
}


def provider_lines(caplog) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.getMessage().startswith("rates.provider")]


def assert_lines(caplog, expected: list[tuple[str, set]]):
    """The provider lines are exactly one per `(source, statuses)`, each
    a bare warning in the exact shape."""
    lines = provider_lines(caplog)
    shapes = [LINE.fullmatch(r.getMessage()) for r in lines]
    assert all(shapes), [r.getMessage() for r in lines]
    found = sorted(shape.groups() for shape in shapes)
    expected = sorted(expected, key=lambda e: e[0])
    assert len(found) == len(expected), found
    for (source, status), (wanted, statuses) in zip(found, expected):
        assert source == wanted and status in statuses, (source, status, statuses)
    for line in lines:
        assert line.levelno == logging.WARNING
        assert line.exc_info is None and line.stack_info is None


def assert_nothing_of_the_request(caplog, capsys, port):
    """No line the app wrote, in the records or on stderr where its
    handler prints them, carries what the request held."""
    messages = [r.getMessage() for r in caplog.records if r.name != "tests"]
    printed = capsys.readouterr().err
    for leak in LEAKS:
        assert not [m for m in messages if leak in m], (leak, messages)
        assert not [m for m in printed.splitlines() if "rates" in m and leak in m], (leak, printed)
    assert not [m for m in messages if str(port) in m], messages


@pytest.fixture
def logged(caplog):
    caplog.set_level(logging.DEBUG)
    return caplog


@pytest.mark.parametrize("provider", FETCH)
@pytest.mark.parametrize("answer", ANSWERS)
def test_a_failed_answer_logs_its_source_and_status_alone(owner, sources, logged, capsys, provider, answer):
    """Criterion 66: the status of an answer that was not 200, `body`
    for one that is not JSON, `timeout` for none."""
    sources.plans[provider], statuses = ANSWERS[answer]

    response = owner.get(FETCH[provider], headers=CSRF)

    assert response.status_code == 204, response.get_data(as_text=True)
    assert_lines(logged, [(provider, statuses)])
    assert_nothing_of_the_request(logged, capsys, sources.port)


@pytest.fixture
def untrusted_sources(monkeypatch, tmp_path):
    """`sources` over HTTPS with a certificate nothing trusts."""
    served, _ = _self_signed(tmp_path)
    yield from _serving(monkeypatch, Sources(tls=served))


@pytest.mark.parametrize("provider", FETCH)
def test_an_untrusted_certificate_logs_tls(owner, untrusted_sources, logged, capsys, provider):
    """Criterion 66."""
    response = owner.get(FETCH[provider], headers=CSRF)

    assert response.status_code == 204
    assert_lines(logged, [(provider, {"tls"})])
    assert_nothing_of_the_request(logged, capsys, untrusted_sources.port)


def rerouted(sources, url_of):
    """Every request goes where `url_of(port)` says instead."""

    def route(request):
        return urllib.request.Request(url_of(sources.port), headers=request.headers)

    sources.route = route


@pytest.fixture
def plain_listener():
    """A loopback server that answers plain HTTP the moment a
    connection opens, before any TLS handshake can start."""
    listener = socket.create_server(("127.0.0.1", 0))
    listener.settimeout(0.05)
    stop = threading.Event()

    def accept():
        while not stop.is_set():
            try:
                connection, _ = listener.accept()
            except (TimeoutError, OSError):
                continue
            with connection:
                connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]")

    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    yield listener.getsockname()[1]
    stop.set()
    thread.join(timeout=2)
    listener.close()


@pytest.mark.parametrize("provider", FETCH)
def test_a_server_that_does_not_speak_tls_logs_tls(owner, sources, plain_listener, logged, capsys, provider):
    """Criterion 66: a handshake that fails is `tls` before `network`."""
    rerouted(sources, lambda _: f"https://127.0.0.1:{plain_listener}/leaky")

    response = owner.get(FETCH[provider], headers=CSRF)

    assert response.status_code == 204
    assert_lines(logged, [(provider, {"tls"})])
    assert_nothing_of_the_request(logged, capsys, plain_listener)


@pytest.mark.parametrize("provider", FETCH)
def test_a_refused_connection_logs_network(owner, sources, logged, capsys, provider):
    """Criterion 66."""
    closed = socket.create_server(("127.0.0.1", 0))
    port = closed.getsockname()[1]
    closed.close()
    rerouted(sources, lambda _: f"http://127.0.0.1:{port}/leaky")

    response = owner.get(FETCH[provider], headers=CSRF)

    assert response.status_code == 204
    assert_lines(logged, [(provider, {"network"})])
    assert_nothing_of_the_request(logged, capsys, port)


@pytest.mark.parametrize("provider", FETCH)
def test_an_answer_that_is_not_http_logs_a_status_of_the_list(owner, sources, logged, capsys, provider):
    """Criterion 66: a status line that is no status is no HTTP status,
    so it is one of the named kinds. The page does not say which."""
    sources.plans[provider] = raw(b"LEAKY NONSENSE\r\n\r\n")

    response = owner.get(FETCH[provider], headers=CSRF)

    assert response.status_code == 204
    assert_lines(logged, [(provider, {"network", "other"})])
    assert_nothing_of_the_request(logged, capsys, sources.port)


def test_both_providers_failing_log_one_line_each(owner, sources, logged, capsys):
    """Criterion 66, for the whole table: one line per failed fetch."""
    sources.plans["frankfurter"] = ANSWERS["503"][0]
    sources.plans["nbp"] = ANSWERS["not json"][0]

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    assert response.status_code == 204
    assert_lines(logged, [("frankfurter", {"503"}), ("nbp", {"body"})])
    assert_nothing_of_the_request(logged, capsys, sources.port)


def test_a_failed_quote_leg_logs_its_line_without_its_date(owner, sources, logged, capsys):
    """Criterion 66: the quote leg goes out at NBP's earlier `asOf`,
    which its line does not name either."""
    urls = asked_urls(sources)
    sources.plans["nbp"] = at_once(lambda url: _nbp(url, lag_days=1))
    sources.plans["frankfurter"] = ANSWERS["503"][0]

    owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    legs = [u for u in urls if "frankfurter" in u]
    assert any(day(1) in u for u in legs), urls
    assert_lines(logged, [("frankfurter", {"503"})] * len(legs))
    assert_nothing_of_the_request(logged, capsys, sources.port)


def test_a_fetch_the_open_breaker_skips_logs_nothing(app, owner, sources, logged):
    """Rate limiting and failure: only a fetch that went out and failed
    logs."""
    sources.plans["frankfurter"] = ANSWERS["503"][0]
    for _ in range(app.config["RATE_BREAKER_FAILURES"]):
        owner.get(FETCH["frankfurter"], headers=CSRF)
    sent = len(sources.opened)
    logged.clear()

    response = owner.get(FETCH["frankfurter"], headers=CSRF)

    assert response.status_code == 204
    assert len(sources.opened) == sent
    assert provider_lines(logged) == []


def frankfurter_answer(change):
    """Frankfurter's answer for the URL asked, as `change(body, day,
    quote)` returns it."""

    def body_of(url):
        on, quote = url.split("/v1/")[1][:10], url.rsplit("base=", 1)[1]
        body = {"amount": 1, "base": quote, "date": on, "rates": {"PLN": 4.2537, "USD": 1.0876}}
        return json.dumps(change(body, on, quote)).encode()

    return at_once(body_of)


def nbp_answer(change):
    """NBP's answer for the URL asked, as `change(entry, day)` returns
    it, `entry` being the one published day."""

    def body_of(url):
        on = url.split("?")[0].rsplit("/", 1)[1]
        return json.dumps(change({"data": on, "cena": 251.37}, on)).encode()

    return at_once(body_of)


def without(entry, key):
    return {k: v for k, v in entry.items() if k != key}


# Each answer is 200 and JSON, and carries "leaky" where a line that
# quoted the body would show it.
CHANGED_SHAPES = {
    "frankfurter": {
        "a list": frankfurter_answer(lambda b, on, q: [b, "leaky"]),
        "null": frankfurter_answer(lambda b, on, q: None),
        "a string": frankfurter_answer(lambda b, on, q: "leaky"),
        "rates a list": frankfurter_answer(lambda b, on, q: {**b, "rates": [["USD", 1.0876], "leaky"]}),
        "rates missing": frankfurter_answer(lambda b, on, q: {**without(b, "rates"), "leaky": 1}),
        "rates empty": frankfurter_answer(lambda b, on, q: {**b, "rates": {}}),
        "no usable rate": frankfurter_answer(
            lambda b, on, q: {**b, "rates": {"USD": "leaky", "PLN": 0, "SEK": None, "NOK": [1.2]}}
        ),
        "base other than quote": frankfurter_answer(lambda b, on, q: {**b, "base": "EUR"}),
        "base lower case": frankfurter_answer(lambda b, on, q: {**b, "base": q.lower()}),
        "base missing": frankfurter_answer(lambda b, on, q: without(b, "base")),
        "date not a day": frankfurter_answer(lambda b, on, q: {**b, "date": "leaky"}),
        "date missing": frankfurter_answer(lambda b, on, q: without(b, "date")),
        "date after the day asked": frankfurter_answer(lambda b, on, q: {**b, "date": LATER}),
    },
    "nbp": {
        "an object": nbp_answer(lambda e, on: {**e, "leaky": 1}),
        "null": nbp_answer(lambda e, on: None),
        "an empty array": nbp_answer(lambda e, on: []),
        "last entry not an object": nbp_answer(lambda e, on: [e, "leaky"]),
        "last entry a list": nbp_answer(lambda e, on: [e, [on, 251.37]]),
        "cena missing": nbp_answer(lambda e, on: [without(e, "cena")]),
        "cena a string": nbp_answer(lambda e, on: [{**e, "cena": "leaky"}]),
        "cena 0": nbp_answer(lambda e, on: [{**e, "cena": 0}]),
        "data missing": nbp_answer(lambda e, on: [without(e, "data")]),
        "data not a day": nbp_answer(lambda e, on: [{**e, "data": "leaky"}]),
        "data before the window": nbp_answer(lambda e, on: [{**e, "data": day(15)}]),
        "data after the day asked": nbp_answer(lambda e, on: [{**e, "data": LATER}]),
    },
}
# A table quoted in each provider's own terms, and what is left of it
# when that provider's answer is a changed shape.
SHAPE_TABLES = {
    "frankfurter": ("PLN", lambda priced: set(priced) == GOLD),
    "nbp": ("CHF", lambda priced: "USD" in priced and not GOLD & set(priced)),
}
OTHER = {"frankfurter": "nbp", "nbp": "frankfurter"}


@pytest.mark.parametrize(
    ("provider", "shape"), [(p, s) for p, shapes in CHANGED_SHAPES.items() for s in shapes]
)
def test_a_changed_shape_logs_shape_and_counts_against_its_breaker_alone(
    owner, sources, logged, capsys, provider, shape
):
    """Criteria 66 and 68: in a whole table, that provider's symbols get
    no proposal and the rest stands, one `status=shape` line is logged
    with nothing of the request or the answer, and one failure counts
    against that provider alone."""
    sources.plans[provider] = CHANGED_SHAPES[provider][shape]
    quote, left = SHAPE_TABLES[provider]

    response = owner.get(f"/api/rates?date={PAST}&quote={quote}", headers=CSRF)

    assert response.status_code == 200, response.get_data(as_text=True)
    assert left(response.get_json()["rates"]), response.get_json()
    assert_lines(logged, [(provider, {"shape"})])
    assert failures() == {provider: 1, OTHER[provider]: 0}
    assert_nothing_of_the_request(logged, capsys, sources.port)


@pytest.mark.parametrize("provider", FETCH)
def test_a_changed_shape_for_one_symbol_is_no_content_and_logs_shape(owner, sources, logged, capsys, provider):
    """Criteria 66 and 68, for the single-symbol form."""
    sources.plans[provider] = CHANGED_SHAPES[provider]["null"]

    response = owner.get(FETCH[provider], headers=CSRF)

    assert response.status_code == 204
    assert_lines(logged, [(provider, {"shape"})])
    assert failures() == {provider: 1, OTHER[provider]: 0}
    assert_nothing_of_the_request(logged, capsys, sources.port)


def test_a_quote_leg_in_a_changed_shape_logs_shape_against_frankfurter(owner, sources, logged, capsys):
    """Criterion 68: the quote leg is a Frankfurter request, so its
    changed shape counts against Frankfurter. Gold quoted in CHF has no
    proposal, and the requested day's currencies stand."""
    sources.plans["nbp"] = at_once(gold_price(251.37, lag_days=1))
    sources.plans["frankfurter"] = at_once(
        lambda url: (fx_table() if f"/v1/{PAST}" in url else fx_table(base="EUR"))(url)
    )

    priced = table(owner)

    assert {"USD", "PLN"} <= set(priced)
    assert not GOLD & set(priced)
    assert_lines(logged, [("frankfurter", {"shape"})])
    assert failures() == {"frankfurter": 1, "nbp": 0}
    assert_nothing_of_the_request(logged, capsys, sources.port)


@pytest.mark.parametrize(
    ("rates_sent", "priced_as"),
    [
        ({"USD": 1.0876, "PLN": "4.25", "SEK": 0, "NOK": None, "DKK": -1}, {"USD"}),
        ({"USD": 1e-25, "PLN": "4.25"}, set()),
        ({"ZZZ": 1.5, "USD": False, "PLN": float("inf")}, set()),
    ],
    ids=["one priced rate", "one usable rate out of bounds once inverted", "one usable rate of no symbol"],
)
def test_one_usable_rate_among_bad_ones_logs_nothing_and_counts_no_failure(
    owner, sources, logged, rates_sent, priced_as
):
    """Criterion 68: a table holding a usable rate is a success, whatever
    else it holds and whether that rate becomes a proposal. Usable is a
    JSON number above 0 and below 10^20 (Edge cases)."""

    def body_of(url):
        on, quote = url.split("/v1/")[1][:10], url.rsplit("base=", 1)[1]
        text = json.dumps({"amount": 1, "base": quote, "date": on, "rates": rates_sent})
        return text.replace("Infinity", "1e999").encode()

    sources.plans["frankfurter"] = at_once(body_of)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    priced = response.get_json()["rates"] if response.status_code == 200 else {}
    assert set(priced) - GOLD == priced_as
    assert provider_lines(logged) == []
    assert failures() == NONE_FAILED


def test_an_earlier_entry_nbp_sends_badly_is_not_a_changed_shape(owner, sources, logged):
    """Rate limiting and failure: NBP's shape turns on its last entry
    alone."""
    sources.plans["nbp"] = nbp_answer(lambda e, on: ["junk", {"cena": "x"}, e])

    priced = table(owner, quote="PLN")

    assert priced["XAU-g"]["rate"] == "251.37"
    assert provider_lines(logged) == []
    assert failures() == NONE_FAILED


def test_a_successful_fetch_logs_no_provider_line(owner, sources, logged):
    response = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    assert response.status_code == 200
    assert provider_lines(logged) == []


KEYS = re.compile(r"api[_-]?key|access[_-]?key|app[_-]?id|token|secret|apikey", re.IGNORECASE)


def test_no_output_of_a_lookup_carries_a_provider_key(owner, sources, logged, capsys):
    """Criterion 41, against what a lookup really prints and answers,
    succeeding, failing and refused: no provider has a key, so no
    key-shaped name or provider address appears anywhere."""
    bodies = [
        owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF),
        owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=NOPE", headers=CSRF),
        owner.get("/api/rates?date=nonsense&quote=CHF", headers=CSRF),
    ]
    sources.plans["frankfurter"] = ANSWERS["503"][0]
    sources.plans["nbp"] = silent
    bodies.append(owner.get(f"/api/rates?date={day(2)}&quote=CHF", headers=CSRF))

    assert [r.status_code for r in bodies] == [200, 400, 400, 204]
    output = [r.get_data(as_text=True) for r in bodies]
    output += [r.getMessage() for r in logged.records]
    output += capsys.readouterr().err.splitlines()
    for text in output:
        assert not KEYS.search(text), text
        assert "api.frankfurter.dev" not in text and "api.nbp.pl" not in text, text


# Forms `date.fromisoformat` reads as a day but `date.isoformat()` never
# writes, forms a looser parser reads, and days no calendar has.
NOT_YYYY_MM_DD = [
    "20260731", "2026-W31-5", "2026W315", "2026-W31", "2026W31",
    "2026-7-31", "2026-07-1", "26-07-31", "2026/07/31", "2026-07-31T00:00",
    " 2026-07-31", "2026-07-31 ", "2026-07-31\n", "+2026-07-31",
    "２０２６-07-31", "2026-02-30", "2026-13-01", "",
]
WHOLE_AND_SINGLE = ["", "&symbol=USD", "&symbol=XAU-ozt"]


@pytest.mark.parametrize("form", WHOLE_AND_SINGLE)
@pytest.mark.parametrize("on", NOT_YYYY_MM_DD, ids=repr)
def test_a_date_not_written_as_isoformat_writes_it_reaches_no_provider(owner, sources, on, form):
    """Criterion 67 and SSRF and egress hardening, `date`."""
    response = owner.get(
        "/api/rates", query_string=f"date={urllib.parse.quote(on)}&quote=CHF{form}", headers=CSRF
    )

    assert response.status_code == 400
    assert sources.opened == []


@pytest.mark.parametrize("form", WHOLE_AND_SINGLE)
def test_the_same_day_written_yyyy_mm_dd_is_priced(owner, sources, form):
    """Criterion 67's other side: the refusal is of the form, not the day."""
    response = owner.get(f"/api/rates?date={PAST}&quote=CHF{form}", headers=CSRF)

    assert response.status_code == 200
    assert sources.opened


# The spec names no time zone for "today", so these are today's date at
# the ends of the zones in use: any later day is future everywhere, and
# the earlier one is future nowhere.
def latest_today() -> date:
    return (datetime.now(timezone.utc) + timedelta(hours=14)).date()


def earliest_today() -> date:
    return (datetime.now(timezone.utc) - timedelta(hours=12)).date()


@pytest.mark.parametrize("form", WHOLE_AND_SINGLE)
@pytest.mark.parametrize("ahead", [1, 400])
def test_a_future_date_reaches_no_provider(owner, sources, ahead, form):
    """Criterion 43."""
    on = (latest_today() + timedelta(days=ahead)).isoformat()

    response = owner.get(f"/api/rates?date={on}&quote=CHF{form}", headers=CSRF)

    assert response.status_code == 400
    assert sources.opened == []


def test_today_is_not_a_future_date(owner, sources):
    """Criterion 43's other side."""
    response = owner.get(f"/api/rates?date={earliest_today().isoformat()}&quote=CHF", headers=CSRF)

    assert response.status_code != 400
    assert sources.opened


def breaker_states():
    return {name: (b.failures, b.opened_at) for name, b in rates.breakers.items()}


def test_with_every_slot_sending_a_lookup_sends_nothing_and_answers_only_what_needs_no_source(app, sources):
    """Criterion 69. The held lookups each come from a session of their
    own, as from separate people, and each asks for a date of its own."""
    owner, key = register(app, "holder")
    cached_day = "2026-07-01"
    assert owner.get(f"/api/rates?date={cached_day}&quote=CHF&symbol=USD", headers=CSRF).status_code == 200
    sources.plans["frankfurter"] = trickle(_frankfurter, interval=60)
    sent_before = len(sources.opened)

    slots = rates.LOOKUP_CONCURRENCY
    held = [sign_in(app, "holder", key)[0] for _ in range(slots)]
    answers = []

    def hold(client, day):
        answers.append(client.get(f"/api/rates?date=2026-07-{day:02d}&quote=CHF&symbol=USD", headers=CSRF))

    holders = [threading.Thread(target=hold, args=(c, 2 + n)) for n, c in enumerate(held)]
    for holder in holders:
        holder.start()
    deadline = time.monotonic() + rates.EGRESS_TIMEOUT_SECONDS / 2
    while len(sources.opened) < sent_before + slots and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(sources.opened) == sent_before + slots
    breakers_before = breaker_states()

    pending = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    identity = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=CHF", headers=CSRF)
    cached = owner.get(f"/api/rates?date={cached_day}&quote=CHF&symbol=USD", headers=CSRF)
    gold = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-ozt", headers=CSRF)
    table = owner.get(f"/api/rates?date={PAST}&quote=CHF", headers=CSRF)

    assert len(sources.opened) == sent_before + slots
    assert breaker_states() == breakers_before
    assert pending.status_code == 204
    assert gold.status_code == 204
    assert identity.status_code == 200
    assert identity.get_json()["rate"] == "1"
    assert identity.get_json()["source"] == "identity"
    assert cached.status_code == 200
    assert cached.get_json()["cached"] is True
    assert table.status_code == 204

    for holder in holders:
        holder.join()
    assert [a.status_code for a in answers] == [204] * slots

    sources.plans["frankfurter"] = at_once(_frankfurter)
    freed = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert freed.status_code == 200
    assert len(sources.opened) == sent_before + slots + 1



# The gold day: gold quoted in anything but PLN is priced at the latest
# day on or before `date` on which NBP published a price and Frankfurter
# a table, both halves that day's (Providers, Gold, Rate limiting and
# failure, Edge cases, criteria 7, 22, 23, 29, 47, 48, 56 and 70 to 72).

GOOD_FRIDAY = "2026-04-03"


def cena_on(on: str) -> float:
    """A gold price of NBP's own for each day, so a figure from the wrong
    day shows."""
    return round(250 + date.fromisoformat(on).toordinal() % 97 / 100, 2)


def pln_on(on: str) -> float:
    """Frankfurter's PLN rate of each day, distinct per day."""
    return round(4.2 + date.fromisoformat(on).toordinal() % 89 / 1000, 4)


def nbp_publishing(*days: str):
    """NBP's range query: every day of `days` in the window asked,
    ascending, each at its own price, and Not Found for an empty one."""

    def plan(url):
        start, end = url.split("?")[0].rsplit("/", 2)[1:]
        entries = [{"data": d, "cena": cena_on(d)} for d in sorted(days) if start <= d <= end]
        return [answer(json.dumps(entries).encode(), 200 if entries else 404)], 0

    return plan


def fx_publishing(*days: str):
    """Frankfurter's table for the day asked: the last of `days` on or
    before it, dated that day, at that day's rates."""

    def plan(url):
        asked = url.split("/v1/")[1][:10]
        on = max(d for d in days if d <= asked)
        body = {"amount": 1, "base": url.rsplit("base=", 1)[1], "date": on,
                "rates": {"PLN": pln_on(on), "USD": 1.0876}}
        return [answer(json.dumps(body).encode())], 0

    return plan


def composed(on: str, symbol: str) -> str:
    """The pinned composition (Providers, Gold) of `on`'s price and PLN
    rate."""
    figure = Decimal(str(cena_on(on))) * (1 / Decimal(str(pln_on(on))))
    if symbol == "XAU-ozt":
        figure *= Decimal("31.1034768")
    return round_proposal(figure)


def fx_days_asked(urls: list[str]) -> list[str]:
    return [u.split("/v1/")[1][:10] for u in urls if "frankfurter" in u]


def offset(on: str, days: int) -> str:
    return (date.fromisoformat(on) - timedelta(days=days)).isoformat()


@pytest.mark.parametrize("symbol", sorted(GOLD))
def test_gold_quoted_elsewhere_takes_both_halves_from_nbps_last_day(owner, sources, symbol):
    """Criterion 47: NBP's last day is the day before, both sources
    published it, each day has its own figures. Two requests, the leg at
    NBP's last day, and the proposal that day's price at that day's PLN
    rate."""
    before = offset(PAST, 1)
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 2), before)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 2), before, PAST)
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol={symbol}", headers=CSRF)

    assert response.status_code == 200
    body = response.get_json()
    assert (body["asOf"], body["rate"], body["source"]) == (before, composed(before, symbol), "nbp+frankfurter")
    assert len(urls) == 2
    assert fx_days_asked(urls) == [before]


@pytest.mark.parametrize("symbol", sorted(GOLD))
def test_gold_on_good_friday_is_priced_at_the_day_before(owner, sources, symbol):
    """Criterion 70 and Edge cases: NBP published Good Friday and the day
    before, Frankfurter answers Good Friday with the day before's table.
    Two requests, `asOf` the day before, and both halves that day's,
    never Good Friday's price at Thursday's rate."""
    thursday = offset(GOOD_FRIDAY, 1)
    sources.plans["nbp"] = nbp_publishing(offset(GOOD_FRIDAY, 2), thursday, GOOD_FRIDAY)
    sources.plans["frankfurter"] = fx_publishing(offset(GOOD_FRIDAY, 2), thursday)
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={GOOD_FRIDAY}&quote=CHF&symbol={symbol}", headers=CSRF)

    assert response.status_code == 200
    body = response.get_json()
    assert (body["asOf"], body["rate"]) == (thursday, composed(thursday, symbol))
    assert len(urls) == 2


def test_the_whole_table_on_good_friday_prices_gold_at_the_day_before_from_the_one_table(owner, sources):
    """Criteria 23 and 70: with a currency pending, the leg reuses the
    table in flight for Good Friday, which is Thursday's, and gold is
    Thursday's on both halves."""
    thursday = offset(GOOD_FRIDAY, 1)
    sources.plans["nbp"] = nbp_publishing(thursday, GOOD_FRIDAY)
    sources.plans["frankfurter"] = fx_publishing(thursday)
    urls = asked_urls(sources)

    priced = table(owner, on=GOOD_FRIDAY)

    for symbol in sorted(GOLD):
        assert (priced[symbol]["asOf"], priced[symbol]["rate"]) == (thursday, composed(thursday, symbol))
    assert priced["USD"]["asOf"] == thursday
    assert len(urls) == 2
    assert fx_days_asked(urls) == [GOOD_FRIDAY]


@pytest.mark.parametrize("symbol", sorted(GOLD))
def test_gold_steps_back_to_the_last_day_both_published(owner, sources, symbol):
    """Criterion 71: Frankfurter's table for NBP's last day is of a day
    NBP skipped, so the leg asks again for NBP's last day before it. Three
    requests, priced at that day."""
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 2), PAST)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 2), offset(PAST, 1))
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol={symbol}", headers=CSRF)

    assert response.status_code == 200
    body = response.get_json()
    assert (body["asOf"], body["rate"]) == (offset(PAST, 2), composed(offset(PAST, 2), symbol))
    assert len(urls) == 3
    assert fx_days_asked(urls) == [PAST, offset(PAST, 2)]


def test_gold_steps_back_as_often_as_the_sources_disagree(owner, sources):
    """The gold day's definition and Rate limiting and failure: each
    further request goes out after the one before has answered, until a
    day both published. Here only the fifth day back is one."""
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 4), offset(PAST, 2), PAST)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 4), offset(PAST, 3), offset(PAST, 1))
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF)

    assert response.status_code == 200
    assert (response.get_json()["asOf"], response.get_json()["rate"]) == (
        offset(PAST, 4), composed(offset(PAST, 4), "XAU-g"))
    assert fx_days_asked(urls) == [PAST, offset(PAST, 2), offset(PAST, 4)]
    assert failures() == NONE_FAILED


def test_the_whole_table_steps_back_for_gold_and_keeps_the_currencies_at_their_own_day(owner, sources):
    """Criterion 71 in the whole-table form: the currencies keep the
    table for `date`, and gold alone steps back."""
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 2), PAST)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 2), offset(PAST, 1))
    urls = asked_urls(sources)

    priced = table(owner)

    assert priced["USD"]["asOf"] == offset(PAST, 1)
    for symbol in sorted(GOLD):
        assert (priced[symbol]["asOf"], priced[symbol]["rate"]) == (
            offset(PAST, 2), composed(offset(PAST, 2), symbol))
    assert fx_days_asked(urls) == [PAST, offset(PAST, 2)]


@pytest.mark.parametrize("form", ["&symbol=XAU-ozt", ""], ids=["single", "whole table"])
def test_gold_with_no_day_both_published_in_the_window_is_no_proposal(owner, sources, form):
    """Criterion 72: NBP published only `date` in its window, and
    Frankfurter's table for it is the day before's. No proposal, and
    neither source failed, so no breaker counts it."""
    sources.plans["nbp"] = nbp_publishing(PAST)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 1))

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF{form}", headers=CSRF)

    if form:
        assert response.status_code == 204
    else:
        assert response.status_code == 200
        assert not GOLD & set(response.get_json()["rates"])
        assert "USD" in response.get_json()["rates"]
    assert failures() == NONE_FAILED


def test_a_frankfurter_day_before_nbps_window_is_no_proposal(owner, sources):
    """Criterion 72 at the window's edge: NBP's days are all after
    Frankfurter's table, so no day before it is in the window."""
    sources.plans["nbp"] = nbp_publishing(WINDOW_START, PAST)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 20))
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF)

    assert response.status_code == 204
    assert fx_days_asked(urls) == [PAST]


def test_gold_quoted_in_pln_ignores_frankfurters_days(owner, sources):
    """Criterion 22 and Quoted in PLN: `asOf` is NBP's last day and one
    request goes out, to NBP, whatever Frankfurter would publish."""
    sources.plans["nbp"] = nbp_publishing(offset(GOOD_FRIDAY, 1), GOOD_FRIDAY)
    sources.plans["frankfurter"] = fx_publishing(offset(GOOD_FRIDAY, 1))
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={GOOD_FRIDAY}&quote=PLN&symbol=XAU-g", headers=CSRF)

    assert response.status_code == 200
    body = response.get_json()
    assert (body["asOf"], body["rate"], body["source"]) == (GOOD_FRIDAY, str(cena_on(GOOD_FRIDAY)), "nbp")
    assert [_provider(u) for u in urls] == ["nbp"]


def test_a_saturday_quoted_elsewhere_is_priced_at_fridays_both_halves(owner, sources):
    """Criterion 7 quoted in CHF: NBP's last day is Friday, and the leg
    asks Frankfurter for Friday, not Saturday."""
    saturday = "2026-08-01"
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 1), PAST)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 1), PAST)
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={saturday}&quote=CHF&symbol=XAU-ozt", headers=CSRF)

    assert response.status_code == 200
    assert (response.get_json()["asOf"], response.get_json()["rate"]) == (PAST, composed(PAST, "XAU-ozt"))
    assert fx_days_asked(urls) == [PAST]


def test_a_failing_step_back_is_no_proposal_and_counts_against_frankfurter(owner, sources):
    """Criteria 29 and 48 on a further leg: either leg failing is No
    Content, never a half-composed rate or the PLN figure, and the failure
    is Frankfurter's alone."""
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 2), PAST)
    first = fx_publishing(offset(PAST, 2), offset(PAST, 1))

    def plan(url):
        if url.split("/v1/")[1][:10] == PAST:
            return first(url)
        return [answer(b"{}", 500)], 0

    sources.plans["frankfurter"] = plan

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF)

    assert response.status_code == 204
    assert failures() == {"frankfurter": 1, "nbp": 0}


def test_every_step_back_shares_the_one_deadline(owner, sources):
    """Rate limiting and failure: each further request goes out within the
    same deadline. Every answer takes 40% of it, so three requests in a
    row outlast it."""
    spread = rates.EGRESS_TIMEOUT_SECONDS * 0.4
    nbp = nbp_publishing(offset(PAST, 2), PAST)
    fx = fx_publishing(offset(PAST, 2), offset(PAST, 1))

    def slow(plan):
        def slowed(url):
            (raw,), _ = plan(url)
            cut = raw.index(b"\r\n\r\n") + 4
            return [raw[:cut], raw[cut:]], spread

        return slowed

    sources.plans["nbp"] = slow(nbp)
    sources.plans["frankfurter"] = slow(fx)

    response, _, took = lookup(owner, f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g")

    assert response.status_code == 204
    assert took < BOUND


def test_an_earlier_nbp_day_that_is_not_canonical_never_reaches_a_url(owner, sources):
    """Criterion 56 and Edge cases on the step back: an earlier entry whose
    `data` is not a usable day is dropped, so its text fills no outbound
    URL, and the step back finds the usable day before it."""
    good = offset(PAST, 4)
    entries = [
        {"data": good, "cena": cena_on(good)},
        {"data": f"{offset(PAST, 3)}?base=EUR#", "cena": 250.0},
        {"data": PAST, "cena": cena_on(PAST)},
    ]
    sources.plans["nbp"] = lambda url: ([answer(json.dumps(entries).encode())], 0)
    sources.plans["frankfurter"] = fx_publishing(good, offset(PAST, 2))
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF)

    assert response.status_code == 200
    assert (response.get_json()["asOf"], response.get_json()["rate"]) == (good, composed(good, "XAU-g"))
    template = re.escape(rates.FX_URL).replace(re.escape("{date}"), r"\d{4}-\d{2}-\d{2}").replace(
        re.escape("{quote}"), "CHF")
    assert all(re.fullmatch(template, u) for u in urls if _provider(u) == "frankfurter")
    assert fx_days_asked(urls) == [PAST, good]


def test_an_earlier_nbp_price_that_is_not_usable_is_never_composed(owner, sources):
    """Edge cases: an earlier entry with an unusable `cena` is dropped,
    not a changed shape, and never priced. The step back passes over it to
    a day both published."""
    good = offset(PAST, 3)
    entries = [
        {"data": good, "cena": cena_on(good)},
        {"data": offset(PAST, 1), "cena": "251.37"},
        {"data": PAST, "cena": cena_on(PAST)},
    ]
    sources.plans["nbp"] = lambda url: ([answer(json.dumps(entries).encode())], 0)
    sources.plans["frankfurter"] = fx_publishing(good, offset(PAST, 1))

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF)

    assert response.status_code == 200
    assert (response.get_json()["asOf"], response.get_json()["rate"]) == (good, composed(good, "XAU-g"))
    assert failures() == NONE_FAILED


def test_a_stepped_back_gold_rate_is_cached_under_the_requested_date(owner, sources):
    """Caching: the stepped-back proposal is the answer for `date`, so a
    repeat sends nothing and carries the same gold day."""
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 2), PAST)
    sources.plans["frankfurter"] = fx_publishing(offset(PAST, 2), offset(PAST, 1))
    url = f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g"
    first = owner.get(url, headers=CSRF).get_json()
    sent = len(sources.opened)

    again = owner.get(url, headers=CSRF).get_json()

    assert len(sources.opened) == sent
    assert again["cached"] is True
    assert (again["asOf"], again["rate"]) == (first["asOf"], first["rate"])


# A quote no source serves, and Not Found as what a source does not
# publish (The symbol table, Rate limiting and failure, Edge cases,
# criteria 40 and 73 to 75).

UNSERVED = "ARS"
STORED = {"off": 0, "on": 1}


@pytest.fixture(params=STORED, ids=lambda flag: f"stored-{flag}")
def unserved(request, app, admin):
    """A currency an administrator added, which Frankfurter does not
    serve, with its `lookup` flag stored as the parameter says. The
    server refuses the flag on, so a row stored that way is written as
    an operator's shell would."""
    response = admin.post(
        "/api/admin/symbols",
        json={"symbol": UNSERVED, "label": "Argentine Peso", "kind": "currency", "lookup": False},
        headers=CSRF,
    )
    assert response.status_code in (200, 201), response.get_data(as_text=True)
    conn = connect(app)
    try:
        conn.execute("UPDATE symbols SET lookup = ? WHERE symbol = ?", (STORED[request.param], UNSERVED))
        conn.commit()
    finally:
        conn.close()
    return UNSERVED


def row_of(table: list[dict], symbol: str) -> dict:
    (found,) = [row for row in table if row["symbol"] == symbol]
    return found


def test_a_currency_no_source_serves_reads_lookup_false_with_no_since_on_both_routes(owner, admin, unserved):
    """Criterion 73."""
    offered = row_of(owner.get("/api/rates/symbols", headers=CSRF).get_json(), unserved)
    managed = row_of(admin.get("/api/admin/symbols", headers=CSRF).get_json(), unserved)

    assert offered["kind"] == "currency"
    assert offered["lookup"] is False
    assert offered["since"] is None
    assert managed["lookup"] is False
    assert managed["hasAdapter"] is False


def offered_currencies(page: str) -> set[str]:
    return set(re.findall(r'"symbol":\s*"([A-Z]{3})"', page))


def test_a_currency_no_source_serves_is_not_offered_at_registration(app, client, unserved):
    """Criterion 40 and register.md, Rules: the list is the currency rows
    with an adapter, whatever the flag stored on a row without one."""
    page = client.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)

    offered = offered_currencies(page)
    assert {"CHF", "USD", "EUR"} <= offered
    assert unserved not in offered


def test_the_registration_list_is_exactly_the_currencies_the_registry_serves(app, client, admin):
    """register.md, Rules: "exactly the provider-quotable currency set",
    asserted against what the symbol routes say has an adapter."""
    admin.post(
        "/api/admin/symbols",
        json={"symbol": UNSERVED, "label": "Argentine Peso", "kind": "currency", "lookup": False},
        headers=CSRF,
    )
    served = {
        row["symbol"] for row in admin.get("/api/admin/symbols", headers=CSRF).get_json()
        if row["kind"] == "currency" and row["hasAdapter"] and not row["retired"]
    }
    page = client.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)

    assert offered_currencies(page) == served


def test_a_quote_no_source_serves_answers_no_content_and_asks_nothing(owner, sources, unserved):
    """Criterion 74 and Edge cases, A quote with no adapter: whatever the
    symbol and date, with each breaker's count where it was."""
    for breaker in rates.breakers.values():
        breaker.record_failure(100)
        breaker.record_failure(100)
    before = failures()
    symbols = [row["symbol"] for row in owner.get("/api/rates/symbols", headers=CSRF).get_json()]
    assert {"USD", "XAU-g", "XAU-ozt", "XAG-ozt", unserved} <= set(symbols)

    answers = {}
    for on in (PAST, "2012-12-31", "1998-12-31"):
        answers[on, None] = owner.get(f"/api/rates?date={on}&quote={unserved}", headers=CSRF).status_code
        for symbol in symbols:
            answers[on, symbol] = owner.get(
                f"/api/rates?date={on}&quote={unserved}&symbol={symbol}", headers=CSRF
            ).status_code

    assert {asked: status for asked, status in answers.items() if status != 204} == {}
    assert sources.opened == []
    assert failures() == before == {"frankfurter": 2, "nbp": 2}


def not_found(url):
    return [answer(b'{"message": "not found"}', 404)], 0


NOT_FOUND_CASES = {
    "frankfurter table": ("&quote=CHF&symbol=USD", {"frankfurter": not_found}, ["frankfurter"]),
    "nbp range": ("&quote=PLN&symbol=XAU-g", {"nbp": not_found}, ["nbp"]),
    "gold quote leg": ("&quote=CHF&symbol=XAU-ozt", {"frankfurter": not_found}, ["nbp", "frankfurter"]),
    "whole table": ("&quote=CHF", {"frankfurter": not_found, "nbp": not_found}, ["frankfurter", "nbp"]),
}


@pytest.mark.parametrize("case", NOT_FOUND_CASES)
def test_a_not_found_answer_past_the_count_leaves_the_breakers_alone(app, owner, sources, logged, case):
    """Criterion 75: Not Found is neither a failure nor a success, logs
    no provider line, and every request still goes out."""
    query, plans, asked = NOT_FOUND_CASES[case]
    app.config["RATE_BREAKER_FAILURES"] = 2
    sources.plans.update(plans)
    tries = 5

    statuses = [
        owner.get(f"/api/rates?date={day(n)}{query}", headers=CSRF).status_code for n in range(tries)
    ]

    assert statuses == [204] * tries
    assert sorted(p for p, _ in sources.opened) == sorted(asked * tries)
    assert failures() == NONE_FAILED
    assert provider_lines(logged) == []


def test_a_not_found_step_back_is_no_proposal_and_no_failure(owner, sources, logged):
    """Criteria 72 and 75 on a further leg of the gold day: the table
    for NBP's last day before Frankfurter's answers Not Found."""
    sources.plans["nbp"] = nbp_publishing(offset(PAST, 2), PAST)
    first = fx_publishing(offset(PAST, 2), offset(PAST, 1))

    def plan(url):
        if url.split("/v1/")[1][:10] == PAST:
            return first(url)
        return not_found(url)

    sources.plans["frankfurter"] = plan
    urls = asked_urls(sources)

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XAU-g", headers=CSRF)

    assert response.status_code == 204
    assert fx_days_asked(urls) == [PAST, offset(PAST, 2)]
    assert failures() == NONE_FAILED
    assert provider_lines(logged) == []


def test_a_not_found_answer_neither_counts_nor_resets_a_failure_run(app, owner, sources):
    """Rate limiting and failure: Not Found is "neither a failure nor a
    success", so failures either side of it still add up to the count."""
    app.config["RATE_BREAKER_FAILURES"] = 3
    answers = iter([500, 500, 404, 500])
    sources.plans["frankfurter"] = lambda url: ([answer(b"{}", next(answers))], 0)

    for n in range(5):
        owner.get(f"/api/rates?date={day(n)}&quote=CHF&symbol=USD", headers=CSRF)

    assert [p for p, _ in sources.opened] == ["frankfurter"] * 4


def test_a_currency_no_source_serves_as_a_symbol_asks_nothing_at_any_date(owner, sources, unserved):
    """Edge cases, Symbol with `lookup: false`: one with no adapter is
    No Content with no outbound request at every date, whatever flag its
    row was stored with, and the whole table leaves it out."""
    statuses = {
        on: owner.get(f"/api/rates?date={on}&quote=CHF&symbol={unserved}", headers=CSRF).status_code
        for on in (PAST, "2012-12-31", "1998-12-31")
    }
    sources.plans["frankfurter"] = at_once(fx_table(**{unserved: 1234.5}))

    whole = table(owner)

    assert statuses == {PAST: 204, "2012-12-31": 204, "1998-12-31": 204}
    assert unserved not in whole and "USD" in whole
    assert sorted(p for p, _ in sources.opened) == ["frankfurter", "nbp"]


# When a cached price is final (Caching, criteria 13, 14, 76 and 77).
# The server clock is `clock`, and both sources publish the days in
# `published`, which a test adds to as the sources would.

TUESDAY = "2026-08-04"
SATURDAY = "2026-08-08"
HOUR = 3600


def usd_on(on: str) -> float:
    """Frankfurter's USD rate of each day, distinct per day."""
    return round(1.05 + date.fromisoformat(on).toordinal() % 83 / 1000, 4)


def usd_proposal(on: str) -> str:
    return round_proposal(1 / Decimal(str(usd_on(on))))


def at(on: str, days: int = 0, seconds: int = 0) -> datetime:
    """`days` after 00:00 UTC on `on`, plus `seconds`."""
    return datetime.fromisoformat(on).replace(tzinfo=timezone.utc) + timedelta(days=days, seconds=seconds)


@pytest.fixture
def published(sources):
    """The days both sources have published, which the stubs read on
    every request."""
    days: set[str] = set()

    def nbp(url):
        start, end = url.split("?")[0].rsplit("/", 2)[1:]
        entries = [{"data": d, "cena": cena_on(d)} for d in sorted(days) if start <= d <= end]
        return [answer(json.dumps(entries).encode(), 200 if entries else 404)], 0

    def fx(url):
        asked = url.split("/v1/")[1][:10]
        on = max(d for d in days if d <= asked)
        body = {"amount": 1, "base": url.rsplit("base=", 1)[1], "date": on,
                "rates": {"PLN": pln_on(on), "USD": usd_on(on)}}
        return [answer(json.dumps(body).encode())], 0

    sources.plans.update(nbp=nbp, frankfurter=fx)
    return days


def publish_up_to(published: set, on: str):
    """Every weekday up to and including `on`, from three weeks before."""
    last = date.fromisoformat(on)
    for back in range(21):
        d = last - timedelta(days=back)
        if d.weekday() < 5:
            published.add(d.isoformat())


PRICES = {
    "USD-CHF": ("USD", "CHF", usd_proposal),
    "XAU-g-PLN": ("XAU-g", "PLN", lambda on: format(Decimal(str(cena_on(on))).normalize(), "f")),
    "XAU-ozt-CHF": ("XAU-ozt", "CHF", lambda on: composed(on, "XAU-ozt")),
}


def priced(owner, symbol, quote, on):
    response = owner.get(f"/api/rates?date={on}&quote={quote}&symbol={symbol}", headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    return body["rate"], body["asOf"], body["cached"]


@pytest.mark.parametrize("price", PRICES)
def test_a_price_looked_up_on_its_day_before_publication_is_looked_up_again_after_midnight(
    owner, clock, sources, published, price
):
    """Criterion 76 and What the client gets: on D the sources still
    hold D-1, so the proposal is D-1's. At 00:30 UTC on D+1 they have
    published D, and the lookup goes out again and proposes D's own
    price, which the next lookup then serves from cache."""
    symbol, quote, proposal = PRICES[price]
    before = offset(TUESDAY, 1)
    publish_up_to(published, before)
    clock.now = at(TUESDAY, seconds=15 * HOUR)

    early = priced(owner, symbol, quote, TUESDAY)
    asked_on_d = len(sources.opened)
    published.add(TUESDAY)
    clock.now = at(TUESDAY, days=1, seconds=HOUR // 2)
    late = priced(owner, symbol, quote, TUESDAY)
    again = priced(owner, symbol, quote, TUESDAY)

    assert early == (proposal(before), before, False)
    assert late == (proposal(TUESDAY), TUESDAY, False)
    assert again == (proposal(TUESDAY), TUESDAY, True)
    assert asked_on_d > 0 and len(sources.opened) == 2 * asked_on_d


def test_the_whole_table_looked_up_before_publication_is_looked_up_again_after_midnight(
    owner, clock, sources, published
):
    """Criterion 76 for the whole table: every symbol of it moves to D."""
    before = offset(TUESDAY, 1)
    publish_up_to(published, before)
    clock.now = at(TUESDAY, seconds=15 * HOUR)
    early = table(owner, on=TUESDAY)
    published.add(TUESDAY)
    clock.now = at(TUESDAY, days=1, seconds=HOUR // 2)

    late = table(owner, on=TUESDAY)

    assert {early[s]["asOf"] for s in ("USD", "XAU-g", "XAU-ozt")} == {before}
    assert {late[s]["asOf"] for s in ("USD", "XAU-g", "XAU-ozt")} == {TUESDAY}
    assert (late["USD"]["rate"], late["XAU-g"]["rate"]) == (usd_proposal(TUESDAY), composed(TUESDAY, "XAU-g"))
    assert not any(entry["cached"] for entry in late.values())


@pytest.mark.parametrize(
    ("on", "fetched"),
    [
        pytest.param(TUESDAY, at(TUESDAY, seconds=15 * HOUR), id="on-d"),
        pytest.param(TUESDAY, at(TUESDAY, days=2, seconds=-HOUR // 2), id="half-an-hour-before-settling"),
        pytest.param(TUESDAY, at(TUESDAY, days=40), id="settled"),
    ],
)
@pytest.mark.parametrize("price", PRICES)
def test_a_price_looked_up_under_an_hour_ago_is_served_from_cache_whatever_its_date(
    owner, clock, sources, published, price, on, fetched
):
    """Criterion 14: under an hour after the fetch, a lookup is a hit
    whether or not the entry has settled, the hour running across
    00:00 UTC on D+2 too."""
    symbol, quote, _ = PRICES[price]
    publish_up_to(published, on)
    clock.now = fetched
    first = priced(owner, symbol, quote, on)
    asked = len(sources.opened)
    clock.now = fetched + timedelta(seconds=HOUR - 1)

    again = priced(owner, symbol, quote, on)

    assert again == (*first[:2], True)
    assert len(sources.opened) == asked


@pytest.mark.parametrize(
    ("on", "fetched"),
    [
        pytest.param(TUESDAY, at(TUESDAY, seconds=15 * HOUR), id="on-d"),
        pytest.param(TUESDAY, at(TUESDAY, days=1, seconds=10 * HOUR), id="on-d-plus-1"),
        pytest.param(TUESDAY, at(TUESDAY, days=2, seconds=-1), id="a-second-before-settling"),
        pytest.param(SATURDAY, at(SATURDAY, days=1, seconds=10 * HOUR), id="saturday-on-sunday"),
    ],
)
@pytest.mark.parametrize("price", PRICES)
def test_a_price_looked_up_before_d_plus_2_is_looked_up_again_after_an_hour(
    owner, clock, sources, published, price, on, fetched
):
    """Caching: every entry not fetched at or after 00:00 UTC on D+2 is
    cached for an hour, then fetched again, whatever its `asOf`. On
    D+1 both sources have published D, so `asOf` is D and still does
    not settle it."""
    symbol, quote, _ = PRICES[price]
    publish_up_to(published, (fetched.date() - timedelta(days=1)).isoformat())
    if on == TUESDAY and fetched.date() > date.fromisoformat(on):
        published.add(on)
    clock.now = fetched
    priced(owner, symbol, quote, on)
    asked = len(sources.opened)
    clock.now = fetched + timedelta(seconds=HOUR + 1)

    again = priced(owner, symbol, quote, on)

    assert again[2] is False
    assert len(sources.opened) == 2 * asked


@pytest.mark.parametrize(
    "on",
    [pytest.param(TUESDAY, id="weekday"), pytest.param(SATURDAY, id="saturday")],
)
@pytest.mark.parametrize("price", PRICES)
def test_a_price_looked_up_at_00_utc_on_d_plus_2_is_served_from_cache_a_month_later(
    owner, clock, sources, published, price, on
):
    """Criterion 77, at the boundary itself: "at or after" 00:00 UTC on
    D+2. A Saturday's entry carries Friday as `asOf` and settles alike."""
    symbol, quote, proposal = PRICES[price]
    publish_up_to(published, offset(on, -1))
    clock.now = at(on, days=2)
    first = priced(owner, symbol, quote, on)
    asked = len(sources.opened)
    clock.now = at(on, days=32)

    again = priced(owner, symbol, quote, on)

    friday = offset(SATURDAY, 1)
    assert first[:2] == ((proposal(on), on) if on == TUESDAY else (proposal(friday), friday))
    assert again == (*first[:2], True)
    assert len(sources.opened) == asked


def test_the_whole_table_and_a_single_symbol_share_one_unsettled_entry(owner, clock, sources, published):
    """Criterion 13 while the entry is unsettled: the single symbol is a
    hit inside the hour, and once the hour is out it goes out again."""
    publish_up_to(published, offset(TUESDAY, 1))
    clock.now = at(TUESDAY, seconds=15 * HOUR)
    table(owner, on=TUESDAY)
    asked = len(sources.opened)
    clock.now += timedelta(minutes=30)

    hit = priced(owner, "USD", "CHF", TUESDAY)
    hits = len(sources.opened)
    clock.now += timedelta(minutes=31)
    miss = priced(owner, "USD", "CHF", TUESDAY)

    assert hit[2] is True and hits == asked
    assert miss[2] is False and len(sources.opened) == asked + 1


# The prior close (Edge cases, Weekend, holiday or a day not yet
# published, criteria 6 and 7): a currency takes the prior close
# Frankfurter answers with, however far back, and gold the last day of
# NBP's fixed 14-day range, with an empty range No Content.


@pytest.mark.parametrize("price", PRICES)
def test_a_saturday_takes_fridays_close_for_every_class(owner, sources, published, price):
    """A weekend is the normal path: `asOf` is Friday and the rate is
    Friday's, never the Saturday asked."""
    symbol, quote, proposal = PRICES[price]
    friday = offset(SATURDAY, 1)
    publish_up_to(published, friday)

    assert priced(owner, symbol, quote, SATURDAY) == (proposal(friday), friday, False)


@pytest.mark.parametrize("gap", [1, 14, 15, 40])
def test_a_currency_takes_frankfurters_prior_close_however_far_back(owner, sources, published, logged, gap):
    """A currency has no window of its own, so a close `gap` days back
    is its proposal at any gap, from one request for the day asked.
    Gold has NBP's 14 days, past which it is absent, with no failure."""
    close = offset(PAST, gap)
    published.add(close)
    urls = asked_urls(sources)

    whole = table(owner)
    usd = priced(owner, "USD", "CHF", PAST)
    gold = owner.get(f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF)

    assert (whole["USD"]["asOf"], whole["USD"]["rate"]) == (close, usd_proposal(close))
    assert usd == (usd_proposal(close), close, True)
    assert fx_days_asked(urls)[0] == PAST
    if gap <= 14:
        assert {whole[s]["asOf"] for s in GOLD} == {close}
        assert (gold.status_code, gold.get_json()["asOf"]) == (200, close)
    else:
        assert not GOLD & set(whole)
        assert gold.status_code == 204
    assert failures() == NONE_FAILED
    assert provider_lines(logged) == []


@pytest.mark.parametrize("on", [PAST, "2026-01-05", "2024-03-10", "2013-01-02"])
def test_gold_asks_nbp_for_the_14_days_up_to_the_date(owner, sources, on):
    """Providers, Gold: one range query from 14 days before `date` to
    `date`, across a month, a year and a leap day alike."""
    start = (date.fromisoformat(on) - timedelta(days=14)).isoformat()
    urls = asked_urls(sources)

    owner.get(f"/api/rates?date={on}&quote=PLN&symbol=XAU-g", headers=CSRF)

    assert urls == [f"https://api.nbp.pl/api/cenyzlota/{start}/{on}?format=json"]


@pytest.mark.parametrize("form", ["&symbol=XAU-g", "&symbol=XAU-ozt", ""], ids=["XAU-g", "XAU-ozt", "whole table"])
def test_an_empty_gold_range_quoted_in_pln_is_no_content(owner, sources, published, form):
    """Criterion 7: nothing published in the 14 days is No Content, never
    an OK with an empty map or a figure from before the range."""
    published.add(offset(PAST, 15))
    sources.plans["frankfurter"] = not_found

    response = owner.get(f"/api/rates?date={PAST}&quote=PLN{form}", headers=CSRF)

    assert response.status_code == 204
    assert failures() == NONE_FAILED


@pytest.mark.parametrize("days", [7, 30])
def test_gold_asks_nbp_for_the_window_solvent_rates_exposes(owner, sources, monkeypatch, days):
    """Providers, Gold and SSRF and egress hardening: the range starts
    `NBP_WINDOW` before `date`, the constant the nightly source check
    imports to request exactly what the app does, so the app's request
    moves with it."""
    monkeypatch.setattr(rates, "NBP_WINDOW", timedelta(days=days))
    start = (date.fromisoformat(PAST) - timedelta(days=days)).isoformat()
    urls = asked_urls(sources)

    owner.get(f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF)

    assert urls == [f"https://api.nbp.pl/api/cenyzlota/{start}/{PAST}?format=json"]


# The one rounding (Providers; What the client gets; criteria 57, 78, 79).
CENA, PLN_RATE = Decimal("251.37"), Decimal("4.2537")
OUNCE = Decimal("31.1034768")


def test_a_proposal_is_the_pinned_composition_rounded_once():
    """The oracle itself, against the page's own figures, so a slip in
    it cannot pass the tests that lean on it."""
    assert round_proposal(1 / Decimal("1.0876")) == "0.9194556822"
    assert round_proposal(1 / Decimal("17655.3")) == "0.000056640216"


def test_each_proposal_equals_the_pinned_composition_digit_for_digit(owner, sources):
    """Criterion 57: in `Decimal` at 28 digits, the PLN leg before the
    ounce factor, then rounded once."""
    sources.plans["nbp"] = at_once(gold_price(float(CENA)))

    priced = table(owner)

    grams = CENA * (1 / PLN_RATE)
    assert priced["USD"]["rate"] == "0.9194556822"
    assert priced["XAU-g"]["rate"] == round_proposal(grams)
    assert priced["XAU-ozt"]["rate"] == round_proposal(grams * OUNCE)


def test_a_currency_worth_very_little_keeps_the_digits_its_source_published(owner, sources):
    """Criterion 78 and What the client gets: the inverse reads the
    published 17655.3 again, so a holding of ten billion rupiah comes to
    the euro cent its source implies."""
    sources.plans["frankfurter"] = at_once(fx_table(IDR=17655.3))

    rate = Decimal(table(owner, quote="EUR")["IDR"]["rate"])

    assert str(rate) == "0.000056640216"
    assert round(1 / rate, 1) == Decimal("17655.3")
    holding = Decimal(10_000_000_000)
    assert (holding * rate).quantize(Decimal("0.01")) == (holding / Decimal("17655.3")).quantize(Decimal("0.01"))


SWEEP = {
    "AUD": 7e-12, "MXN": 3.3e-11, "CAD": 1.234567890123e-9, "CZK": 6.02e-7, "DKK": 0.000123,
    "GBP": 0.0314159, "HKD": 0.9876543210987, "HUF": 4.2537, "IDR": 17655.3, "ISK": 123456.789,
    "JPY": 9999999.99, "KRW": 1e7, "NOK": 3.0, "SEK": 7.0, "THB": 0.7,
}


def significant(rate: str) -> int:
    return len(Decimal(rate).normalize().as_tuple().digits)


def places(rate: str) -> int:
    return len(rate.partition(".")[2])


def test_no_currency_proposal_has_more_than_twelve_places_or_ten_significant_digits(owner, sources):
    """Criterion 79, from a rate of 7e-12 to one of 10^7, each the
    composition rounded once and written plain."""
    sources.plans["frankfurter"] = at_once(fx_table(**SWEEP))

    priced = table(owner)

    for code, figure in SWEEP.items():
        rate = priced[code]["rate"]
        assert rate == round_proposal(1 / Decimal(str(figure))), code
        assert places(rate) <= 12 and significant(rate) <= 10, (code, rate)
        assert "e" not in rate.lower() and not (places(rate) and rate.endswith("0")), (code, rate)


@pytest.mark.parametrize("cena", [7e-12, 1.2345e-9, 251.37, 251.3712345678901, 9999999.99, 1e7], ids=repr)
def test_no_gold_proposal_has_more_than_twelve_places_or_ten_significant_digits(owner, sources, cena):
    """Criterion 79 for gold, in PLN and in CHF, each rounded once."""
    sources.plans["nbp"] = at_once(gold_price(cena))
    exact = Decimal(str(cena))

    in_pln, in_chf = table(owner, quote="PLN"), table(owner)

    for symbol, factor in (("XAU-g", 1), ("XAU-ozt", OUNCE)):
        assert in_pln[symbol]["rate"] == round_proposal(exact * factor), symbol
        assert in_chf[symbol]["rate"] == round_proposal(exact * (1 / PLN_RATE) * factor), symbol
        for rate in (in_pln[symbol]["rate"], in_chf[symbol]["rate"]):
            assert places(rate) <= 12 and significant(rate) <= 10, (symbol, rate)


@pytest.mark.parametrize(
    ("cena", "proposed"),
    [
        (251.37000005, "251.37"),  # a tie at the tenth digit goes to the even one below
        (251.37000015, "251.3700002"),  # and to the even one above
        (1.2345e-9, "0.000000001234"),  # a tie at the twelfth place, short of ten digits
        (1.2355e-9, "0.000000001236"),
        (1.5e-12, "0.000000000002"),
        (5e-13, None),  # half to even rounds it to 0
    ],
    ids=repr,
)
def test_the_rounding_is_half_to_even_at_ten_digits_or_twelve_places(owner, sources, cena, proposed):
    """Providers: half to even, to 10 significant digits but never past
    the twelfth place, on `XAU-g` in PLN, which is `cena` itself."""
    sources.plans["nbp"] = at_once(gold_price(cena))

    priced = table(owner, quote="PLN")

    assert priced.get("XAU-g", {}).get("rate") == proposed
    assert failures() == NONE_FAILED


def restarted(app):
    """A second start of the app on the same database file."""
    from solvent import create_app

    return create_app(config_overrides={"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True})


def test_a_settled_entry_is_kept_until_the_app_next_starts(app, sources):
    """Caching and criterion 77: a settled entry is a hit with no
    request, until a start empties the cache and the next lookup goes
    out again."""
    owner, key = register(app, "keeper")
    first = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()
    again = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()
    asked = len(sources.opened)

    later = restarted(app)
    signed_in, _ = sign_in(later, "keeper", key)
    after = signed_in.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF).get_json()

    assert (first["cached"], again["cached"], asked) == (False, True, 1)
    assert (after["rate"], after["cached"]) == ("0.9194556822", False)
    assert len(sources.opened) == 2


# A success resets its provider's count unless that provider counted a
# failure after the proxy request began (Rate limiting and failure,
# criteria 24, 25, 27, 29 and 68). Each order is forced by holding an
# answer back, so no assertion turns on thread scheduling.

HELD = 1.0


def held(body_of, status=200):
    """A plan holding the whole answer back for `HELD` seconds."""
    return lambda url: ([b"", answer(body_of(url), status)], HELD)


def by_day(plans: dict, otherwise):
    """A Frankfurter plan choosing by the day asked for."""
    return lambda url: plans.get(url.split("/v1/")[1][:10], otherwise)(url)


FX_SHAPE = at_once(fx_table(base="EUR"))
FX_DOWN = at_once(lambda url: b"down", status=503)


@pytest.mark.parametrize(
    "late", ["table", "leg"], ids=["table read after the leg failed", "leg failing after the table"]
)
def test_a_quote_legs_failure_counts_one_whichever_answer_is_read_last(owner, sources, logged, late):
    """Criteria 24 and 68: the requested day's table succeeds and the
    gold quote leg, for NBP's day before, answers in a changed shape.
    Frankfurter's count is one, in either order."""
    sources.plans["nbp"] = at_once(gold_price(251.37, lag_days=1))
    table_plan = held(fx_table()) if late == "table" else at_once(fx_table())
    leg_plan = FX_SHAPE if late == "table" else held(fx_table(base="EUR"))
    sources.plans["frankfurter"] = by_day({PAST: table_plan}, leg_plan)

    priced = table(owner)

    assert {"USD", "PLN"} <= set(priced)
    assert not GOLD & set(priced)
    assert_lines(logged, [("frankfurter", {"shape"})])
    assert failures() == {"frankfurter": 1, "nbp": 0}


def test_a_late_table_never_saves_a_failing_quote_leg_from_opening_the_breaker(app, owner, sources):
    """Criteria 25 and 29: each request's table succeeds after its quote
    leg failed, so the leg failures are consecutive. The breaker opens on
    exactly the configured one, and the next request within the cool-off
    sends nothing to Frankfurter while NBP is still asked."""
    app.config["RATE_BREAKER_FAILURES"] = 3
    sources.plans["nbp"] = at_once(gold_price(251.37, lag_days=1))
    asked = [day(n) for n in range(0, 8, 2)]
    sources.plans["frankfurter"] = by_day({on: held(fx_table()) for on in asked}, FX_SHAPE)

    counts = []
    for on in asked[:3]:
        table(owner, on=on)
        counts.append(failures()["frankfurter"])
    sent = len(sources.opened)
    last = table(owner, on=asked[3])

    assert counts == [1, 2, 3]
    assert [p for p, _ in sources.opened[sent:]] == ["nbp"]
    assert last == {}


def test_a_quote_legs_success_never_wipes_the_tables_failure(owner, sources):
    """Criterion 24, the other way round: the requested day's table
    fails at once and the quote leg answers late. The leg's success
    prices gold at its day, and Frankfurter's count stays one."""
    sources.plans["nbp"] = at_once(gold_price(251.37, lag_days=1))
    sources.plans["frankfurter"] = by_day({PAST: FX_DOWN}, held(fx_table()))

    priced = table(owner)

    assert set(priced) == GOLD
    assert {entry["asOf"] for entry in priced.values()} == {day(1)}
    assert failures() == {"frankfurter": 1, "nbp": 0}


def test_another_requests_failure_during_this_one_keeps_the_count(app, owner, sources):
    """Rate limiting and failure: a success resets nothing when its
    provider counted a failure after the proxy request began, whichever
    request counted it. A starts and its table answers late. B, from
    another session, fails Frankfurter meanwhile."""
    _, key = register(app, "other")
    other, _ = sign_in(app, "other", key)
    sources.plans["frankfurter"] = by_day({PAST: held(fx_table())}, FX_DOWN)
    answers = {}

    def ask(name, client, on):
        answers[name] = client.get(f"/api/rates?date={on}&quote=CHF&symbol=USD", headers=CSRF)

    first = threading.Thread(target=ask, args=("a", owner, PAST))
    first.start()
    deadline = time.monotonic() + HELD / 2
    while not sources.opened and time.monotonic() < deadline:
        time.sleep(0.01)
    assert sources.opened, "A's table never went out"
    ask("b", other, day(1))
    first.join()

    assert answers["a"].status_code == 200
    assert answers["b"].status_code == 204
    assert failures() == {"frankfurter": 1, "nbp": 0}


def test_a_success_resets_its_own_count_from_before_the_request_whatever_the_other_did(app, owner, sources):
    """Criteria 25 and 27: failures counted before the request began are
    reset by its success, and an NBP failure within it neither keeps
    Frankfurter's count nor is reset by Frankfurter's success."""
    app.config["RATE_BREAKER_FAILURES"] = 5
    sources.plans["frankfurter"] = FX_DOWN
    for n in range(1, 4):
        owner.get(f"/api/rates?date={day(n)}&quote=CHF&symbol=USD", headers=CSRF)
    assert failures() == {"frankfurter": 3, "nbp": 0}
    sources.plans["frankfurter"] = held(fx_table())
    sources.plans["nbp"] = at_once(lambda url: b"down", status=503)

    priced = table(owner)

    assert "USD" in priced and not GOLD & set(priced)
    assert failures() == {"frankfurter": 0, "nbp": 1}


# ---- Retiring a symbol (The symbol table, Maintaining the table,
# criterion 35; record-rate.md, Reading) -----------------------------------


def symbol_rows(owner) -> dict[str, dict]:
    return {row["symbol"]: row for row in owner.get("/api/rates/symbols", headers=CSRF).get_json()}


def set_retired(admin, symbol: str, retired: bool):
    response = admin.patch(f"/api/admin/symbols/{symbol}", json={"retired": retired}, headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)


@pytest.mark.parametrize("symbol", ["XAU-ozt", "XAG-ozt", "USD", "CHF"])
def test_retiring_changes_only_the_flag_and_unretiring_restores_the_row_exactly(owner, admin, symbol):
    """Criterion 35: the row stays in the table, alike but for `retired`,
    and unretiring gives back the row it was."""
    before = symbol_rows(owner)[symbol]
    assert before["retired"] is False

    set_retired(admin, symbol, True)
    assert symbol_rows(owner)[symbol] == {**before, "retired": True}

    set_retired(admin, symbol, False)
    assert symbol_rows(owner)[symbol] == before


def test_a_retired_symbol_is_priced_by_both_forms_as_before(owner, admin, sources):
    """Criterion 35 and Maintaining the table: both forms of
    `/api/rates` still price a retired currency and a retired metal with
    a source, at the figures they had before."""
    priced = {symbol: table(owner)[symbol]["rate"] for symbol in ("USD", "XAU-ozt", "XAU-g")}
    for symbol in priced:
        set_retired(admin, symbol, True)

    whole = table(owner, on=day(1))
    for symbol, rate in priced.items():
        assert whole[symbol]["rate"] == rate
        single = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol={symbol}", headers=CSRF)
        assert single.status_code == 200, single.get_data(as_text=True)
        assert single.get_json()["rate"] == rate


def test_a_retired_main_currency_still_quotes_and_keeps_its_since(owner, admin, sources):
    """record-rate.md, Reading: a main currency is a currency row with a
    `since`, retired or not, so a vault totalling in it keeps its rate
    sources, and the proxy still quotes into it."""
    set_retired(admin, "CHF", True)

    row = symbol_rows(owner)["CHF"]
    assert row["kind"] == "currency" and row["since"] == "1999-01-04" and row["retired"] is True
    whole = table(owner)
    assert {"USD", "XAU-ozt", "XAU-g"} <= set(whole)
    single = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert single.status_code == 200, single.get_data(as_text=True)


def test_a_retired_currency_is_not_offered_at_registration(app, client, admin):
    """The symbol table, `retired`: the main-currency list at
    registration leaves a retired row out."""
    set_retired(admin, "USD", True)
    page = client.get(f"/register?invite={mint_invite(app)}").get_data(as_text=True)

    offered = offered_currencies(page)
    assert "CHF" in offered and "USD" not in offered


def test_retiring_without_the_csrf_header_changes_nothing(owner, admin):
    """architecture.md, Application hardening: a mutating endpoint
    refuses a request without the CSRF header."""
    before = symbol_rows(owner)["XAU-ozt"]

    response = admin.patch("/api/admin/symbols/XAU-ozt", json={"retired": True})

    assert response.status_code == 403
    assert symbol_rows(owner)["XAU-ozt"] == before


# ---- A metal names its weight (Maintaining the table, Seeded symbols,
# SSRF and egress hardening, criteria 81 and 82) ------------------------


def admin_table(admin) -> list[dict]:
    response = admin.get("/api/admin/symbols", headers=CSRF)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def add(admin, symbol: str, kind: str, headers=CSRF):
    return admin.post(
        "/api/admin/symbols",
        json={"symbol": symbol, "label": "Added", "kind": kind, "lookup": False},
        headers=headers,
    )


def store(app, symbol: str, kind: str, retired: int = 0):
    """A row as an older version, or an operator's shell, left it."""
    with connect(app) as conn:
        conn.execute(
            "INSERT INTO symbols (symbol, label, kind, lookup, retired) VALUES (?, ?, ?, 0, ?)",
            (symbol, f"Stored {symbol}", kind, retired),
        )


def restart(app):
    from solvent import create_app

    return create_app({"DATABASE_PATH": app.config["DATABASE_PATH"], "TESTING": True})


def retired_of(app, symbol: str) -> int:
    return rows(app, "SELECT retired FROM symbols WHERE symbol = ?", (symbol,))[0]["retired"]


WEIGHTLESS = [
    "XRH", "XRH-kg", "XRH-oz", "XRH-OZT", "XRH-G", "xrh-ozt", "XRHozt", "XRH_ozt",
    "XRH-g-ozt", "XRH-ozt2", "-ozt", "ABCDEFGHIJKLM-ozt",
    "XRH-ozt\n", "XRH-g\n", "XRH-ozt\r\n", "XRH-ozt ", " XRH-ozt",
]


@pytest.mark.parametrize("symbol", WEIGHTLESS)
def test_adding_a_metal_that_names_no_weight_is_refused_and_adds_nothing(app, admin, symbol):
    """Criterion 81 and Seeded symbols: a metal fully matches
    `^(?=.{1,16}$)[A-Z0-9][A-Z0-9._]*-(ozt|g)$`, or `POST` is a Bad
    Request that adds no row."""
    before = admin_table(admin)
    stored = rows(app, "SELECT COUNT(*) AS n FROM symbols")[0]["n"]

    response = add(admin, symbol, "metal")

    assert response.status_code == 400, response.get_data(as_text=True)
    assert admin_table(admin) == before
    assert rows(app, "SELECT COUNT(*) AS n FROM symbols")[0]["n"] == stored


@pytest.mark.parametrize("symbol", ["XRH-ozt", "XRH-g", "ABCDEFGHIJKL-ozt", "X.1_A-g", "9-g"])
def test_a_metal_in_its_weighed_form_is_added(owner, admin, symbol):
    """Maintaining the table: a metal in its weighed form that does not
    exist yet is added, and both symbol routes list it."""
    response = add(admin, symbol, "metal")

    assert response.status_code < 300, response.get_data(as_text=True)
    added = {row["symbol"]: row for row in admin_table(admin)}[symbol]
    assert (added["kind"], added["retired"], added["lookup"]) == ("metal", False, False)
    assert symbol_rows(owner)[symbol]["retired"] is False


@pytest.mark.parametrize("symbol", ["XYZ", "XYZ1", "A.B_C"])
def test_a_currency_needs_no_weight(admin, symbol):
    """Criterion 81: a currency needs no weight."""
    response = add(admin, symbol, "currency")

    assert response.status_code < 300, response.get_data(as_text=True)
    assert symbol in {row["symbol"] for row in admin_table(admin)}


@pytest.mark.parametrize("symbol", ["XYZ\n", "XYZ\r\n", "XYZ ", "xyz", "ABCDEFGHIJKLMNOPQ"])
def test_a_currency_off_the_canonical_form_is_refused_and_adds_nothing(admin, symbol):
    """Criterion 81 and SSRF and egress hardening: any code with a
    trailing newline, or otherwise off the full canonical form, is a Bad
    Request that adds nothing."""
    before = admin_table(admin)

    response = add(admin, symbol, "currency")

    assert response.status_code == 400, response.get_data(as_text=True)
    assert admin_table(admin) == before


def test_adding_a_unit_without_the_csrf_header_adds_nothing(admin):
    """architecture.md, Application hardening: a mutating endpoint
    refuses a request without the CSRF header."""
    before = admin_table(admin)

    response = add(admin, "XRH-g", "metal", headers={})

    assert response.status_code == 403
    assert admin_table(admin) == before


@pytest.mark.parametrize("symbol", ["XAU-ozt%0A", "XAU-ozt%0D%0A", "XAU-ozt%20", "USD%0A"])
def test_a_symbol_with_a_trailing_newline_reaches_no_provider(owner, monkeypatch, symbol):
    """SSRF and egress hardening: `symbol` must fully match, because `$`
    alone admits a trailing newline."""
    sent = []
    monkeypatch.setattr(rates._opener, "open", lambda request, timeout=None: sent.append(request))

    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol={symbol}", headers=CSRF)

    assert response.status_code == 400
    assert sent == []


def test_a_stored_weightless_metal_is_retired_at_every_start(app, admin):
    """Criterion 82 and Seeded symbols: a stored metal row that fails
    the weighed form is retired at every start. A weighed metal and a
    currency without a weight are left as they were."""
    weightless = ["XYZ", "XRH-kg", "xrh-ozt", "Gold-g"]
    for symbol in weightless:
        store(app, symbol, "metal")
    store(app, "XRH-g", "metal")
    store(app, "XYZC", "currency")
    seeded_before = {row["symbol"]: row["retired"] for row in admin_table(admin)}

    restart(app)

    assert [retired_of(app, s) for s in weightless] == [1, 1, 1, 1]
    assert retired_of(app, "XRH-g") == 0 and retired_of(app, "XYZC") == 0
    after = {row["symbol"]: row["retired"] for row in admin_table(admin)}
    assert {s: r for s, r in after.items() if s not in weightless} == {
        s: r for s, r in seeded_before.items() if s not in weightless
    }

    with connect(app) as conn:
        conn.execute("UPDATE symbols SET retired = 0 WHERE symbol = 'XYZ'")
    restart(app)
    assert retired_of(app, "XYZ") == 1


def test_a_weightless_metal_cannot_be_restored_but_can_be_renamed(app, admin):
    """Criterion 82: `PATCH` with `retired: false` on a weightless metal
    is a Bad Request and changes nothing, while a rename still saves."""
    store(app, "XYZ", "metal", retired=1)

    refused = admin.patch("/api/admin/symbols/XYZ", json={"retired": False}, headers=CSRF)
    assert refused.status_code == 400, refused.get_data(as_text=True)
    assert retired_of(app, "XYZ") == 1

    both = admin.patch("/api/admin/symbols/XYZ", json={"retired": False, "label": "Both"}, headers=CSRF)
    assert both.status_code == 400, both.get_data(as_text=True)
    assert rows(app, "SELECT label, retired FROM symbols WHERE symbol = 'XYZ'") == [{"label": "Stored XYZ", "retired": 1}]

    renamed = admin.patch("/api/admin/symbols/XYZ", json={"label": "Renamed"}, headers=CSRF)
    assert renamed.status_code == 200, renamed.get_data(as_text=True)
    assert rows(app, "SELECT label, retired FROM symbols WHERE symbol = 'XYZ'") == [{"label": "Renamed", "retired": 1}]


@pytest.mark.parametrize("symbol", ["XAG-g", "USD"])
def test_a_retired_weighed_metal_and_a_retired_currency_are_restored(owner, admin, symbol):
    """admin-invites.md, criterion 55, on the server: a retired `XAG-g`
    and a retired currency can be restored."""
    before = symbol_rows(owner)[symbol]
    set_retired(admin, symbol, True)

    set_retired(admin, symbol, False)

    assert symbol_rows(owner)[symbol] == before


def test_a_retired_weightless_metal_keeps_its_unit_and_prices(app, owner, monkeypatch):
    """Seeded symbols: its holdings keep their unit and their prices as
    any retired unit's do. It stays in the table under its own label,
    retired, and the proxy still accepts it, answering No Content with
    no outbound request since nothing prices it."""
    store(app, "XYZ", "metal")
    restart(app)
    sent = []
    monkeypatch.setattr(rates._opener, "open", lambda request, timeout=None: sent.append(request))

    row = symbol_rows(owner)["XYZ"]
    response = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=XYZ", headers=CSRF)

    assert (row["label"], row["kind"], row["retired"], row["lookup"]) == ("Stored XYZ", "metal", True, False)
    assert response.status_code == 204, response.get_data(as_text=True)
    assert sent == []
