"""Reviewer's tests: egress has one deadline for connect and the whole
read across a proxy request, and a provider sending its answer slowly
has failed once it passes (spec/features/rate-lookup.md, SSRF and egress
hardening, Rate limiting and failure, criteria 17 to 20 and 60). A
figure that is not a usable price, or in an unexpected currency, is no
proposal for the symbols built from it (Edge cases, criteria 61 and 62).

Written from the spec alone. Each provider is reached on a loopback HTTP
server through the app's own opener, so the app's real socket timeout
and read path apply, and the server decides how fast each byte goes.
"""
from __future__ import annotations

import json
import socket
import ssl
import subprocess
import threading
import time
import urllib.request
from datetime import date, timedelta

import pytest

import solvent.rates as rates
from tests.helpers import CSRF, connect, rows

PAST = "2026-07-31"
# How late a receive may start after the deadline, for scheduling alone.
SLACK = 0.3
# Well inside any socket timeout the app could set below its deadline.
TRICKLE = 0.8


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


@pytest.fixture
def secure_sources(monkeypatch, tmp_path):
    """`sources` over HTTPS, so the read goes through the opener's own
    HTTPS connection, the one every real provider is reached on. The
    certificate is made for the test, and the opener's HTTPS handler is
    handed a context trusting it and nothing else changed."""
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
    (handler,) = [h for h in rates._opener.handlers if isinstance(h, urllib.request.HTTPSHandler)]
    monkeypatch.setattr(handler, "_context", ssl.create_default_context(cafile=str(cert)))
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


@pytest.mark.parametrize("figure", NOT_USABLE, ids=repr)
def test_a_currency_rate_that_is_not_a_usable_price_is_no_proposal(owner, sources, figure):
    """Criterion 61: no proposal for that symbol, never an error or a 0,
    and the rest of the table stands."""
    sources.plans["frankfurter"] = at_once(fx_table(USD=figure))

    priced = table(owner)

    assert "USD" not in priced
    assert {"PLN", *GOLD} <= set(priced)
    single = owner.get(f"/api/rates?date={PAST}&quote=CHF&symbol=USD", headers=CSRF)
    assert single.status_code == 204


@pytest.mark.parametrize("figure", NOT_USABLE, ids=repr)
def test_a_gold_price_that_is_not_usable_drops_both_gold_symbols_alone(owner, sources, figure):
    """Edge cases: a bad NBP price drops both gold symbols, and the
    currencies stand."""
    sources.plans["nbp"] = at_once(gold_price(figure))

    priced = table(owner)

    assert not GOLD & set(priced)
    assert {"USD", "PLN"} <= set(priced)
    assert owner.get(f"/api/rates?date={PAST}&quote=PLN&symbol=XAU-g", headers=CSRF).status_code == 204


@pytest.mark.parametrize("figure", NOT_USABLE, ids=repr)
def test_a_pln_rate_that_is_not_usable_drops_gold_quoted_elsewhere(owner, sources, figure):
    """Edge cases: a bad PLN rate drops gold quoted in anything but PLN,
    and with it PLN itself, while the other currencies stand."""
    sources.plans["frankfurter"] = at_once(fx_table(PLN=figure))

    priced = table(owner)

    assert not ({"PLN"} | GOLD) & set(priced)
    assert priced["USD"]["rate"] == "0.91945568"


@pytest.mark.parametrize(
    ("figure", "served"),
    [
        (1.9e8, "0.00000001"),  # 5.26e-9 rounds up to the last place
        (2e8, None),  # exactly 5e-9, half to even rounds to 0
        (1e-20, None),  # exactly 10^20, not below it
        (1.0000001e-20, True),  # just below 10^20
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
    elif served is True:
        assert 0 < float(priced["USD"]["rate"]) < 1e20
    else:
        assert priced["USD"]["rate"] == served


def test_the_bounds_apply_to_each_gold_symbol_on_its_own(owner, sources):
    """A usable price can still make one symbol's proposal fall outside
    the bounds: grams round to 0 where ounces do not, and ounces pass
    10^20 where grams do not."""
    sources.plans["nbp"] = at_once(gold_price(1e-9))
    priced = table(owner, quote="PLN", on=day(0))
    assert "XAU-g" not in priced
    assert priced["XAU-ozt"]["rate"] == "0.00000003"

    sources.plans["nbp"] = at_once(gold_price(1e19))
    priced = table(owner, quote="PLN", on=day(1))
    assert priced["XAU-g"]["rate"] == "10000000000000000000"
    assert "XAU-ozt" not in priced


@pytest.mark.parametrize(
    ("provider", "url", "bad"),
    [
        ("frankfurter", "quote=CHF&symbol=USD", at_once(fx_table(USD=0))),
        ("nbp", "quote=PLN&symbol=XAU-g", at_once(gold_price("251.37"))),
    ],
)
def test_a_bad_figure_counts_as_a_success_for_its_breaker(app, owner, sources, provider, url, bad):
    """Edge cases: the source answered, so a bad figure resets its
    breaker's count. Counted as a failure, the breaker opens on the
    third request. Left uncounted, it opens on the fifth."""
    app.config["RATE_BREAKER_FAILURES"] = 3
    failing = at_once(lambda _: b"{}", 500)

    for offset, plan in enumerate([failing, failing, bad, failing, failing, bad]):
        sources.plans[provider] = plan
        response = owner.get(f"/api/rates?date={day(offset)}&{url}", headers=CSRF)
        assert response.status_code == 204

    assert [p for p, _ in sources.opened] == [provider] * 6


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

    assert (first["rate"], first["cached"]) == ("0.91945568", False)
    assert (again["rate"], again["cached"]) == ("0.91945568", True)
    assert cached(app, "USD", "CHF", PAST) == [{"rate": "0.91945568"}]
    assert [p for p, _ in sources.opened] == ["frankfurter"]


def test_a_cached_zero_is_a_miss_in_the_whole_table(app, owner, sources):
    plant(app, "USD", "CHF", PAST, "0", "frankfurter")
    plant(app, "XAU-g", "PLN", PAST, "0", "nbp")

    assert table(owner)["USD"]["rate"] == "0.91945568"
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
