from __future__ import annotations

import fcntl
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest

from tests.helpers import EpochClient, register


@contextmanager
def network_held(request, exclusive: bool):
    """Holds the network lock across workers, shared or exclusive. An
    exclusive waiter holds the gate, which keeps new shared holders out,
    so a stream of them cannot starve it."""
    base = request.getfixturevalue("tmp_path_factory").getbasetemp().parent
    with (base / "network.gate").open("a") as gate, (base / "network.lock").open("a") as held:
        fcntl.flock(gate, fcntl.LOCK_EX)
        if exclusive:
            fcntl.flock(held, fcntl.LOCK_EX)
        else:
            fcntl.flock(held, fcntl.LOCK_SH)
            fcntl.flock(gate, fcntl.LOCK_UN)
        yield


def module_wide(request) -> bool:
    """Whether the module has a fixture outliving a test, which may start
    Chrome, so the lock has to span the module."""
    return any(
        definition.scope != "function"
        for item in request.session.items
        if item.module is request.module
        for name, definitions in item._fixtureinfo.name2fixturedefs.items()
        if name not in ("network_lock", "tmp_path_factory")
        for definition in definitions
    )


@pytest.fixture(scope="module", autouse=True)
def network_lock(request):
    """A test that starts Docker containers runs while no other test
    does, across workers. Each container adds and removes a network
    interface, and Chrome fails every request in flight when one comes
    or goes. A Docker module holds the lock exclusive for the whole
    module, because its module-scoped fixtures start Chrome too. Another
    module holds it shared, for the whole module only where a fixture
    outlives a test, and per test otherwise (network_lock_per_test), so
    a Docker module waits for the tests in flight rather than for whole
    modules."""
    docker = any(item.module is request.module and "python_image" in item.fixturenames for item in request.session.items)
    if docker or module_wide(request):
        with network_held(request, docker):
            yield False
    else:
        yield True


@pytest.fixture(autouse=True)
def network_lock_per_test(request, network_lock):
    if network_lock:
        with network_held(request, False):
            yield
    else:
        yield


@pytest.fixture
def app(tmp_path, monkeypatch):
    """A real app instance, wired the same way create_app always wires
    it, pointed at a throwaway SQLite file per test."""
    monkeypatch.setenv("SECRET_KEY", "test-only-secret-key-do-not-use-in-prod")

    from solvent import create_app

    return create_app(
        config_overrides={
            "DATABASE_PATH": str(tmp_path / "solvent-test.db"),
            "TESTING": True,
        }
    )


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def owner(app):
    client, _ = register(app, "owner")
    return client


@pytest.fixture
def admin(app):
    client, _ = register(app, "root", kind="administrator")
    return client


@pytest.fixture
def frozen_clock(monkeypatch):
    """Timestamps written through `solvent.db.utcnow` read one instant,
    so a request cannot change `sessions.last_active_at` by crossing a
    second boundary. Session expiry reads its own clock and is
    unaffected."""
    now = datetime.now().astimezone()

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz)

    monkeypatch.setattr("solvent.db.datetime", Frozen)


@pytest.fixture
def clock(monkeypatch):
    """The server clock, stopped until a test moves it. Everything
    stamped through `solvent.db` and every window the limiters read
    follow it."""

    class Clock:
        now = datetime.now(timezone.utc).replace(microsecond=0)

        def advance(self, seconds):
            self.now += timedelta(seconds=seconds)

    stopped = Clock()

    class Stopped(datetime):
        @classmethod
        def now(cls, tz=None):
            return stopped.now.astimezone(tz)

    monkeypatch.setattr("solvent.db.datetime", Stopped)
    return stopped


def pytest_configure(config):
    config.addinivalue_line("markers", "real_pruner: the app's pruning thread runs its real body")


@pytest.fixture(autouse=True)
def idle_pruner(request, monkeypatch):
    """Every app a test builds starts its pruning thread, which would
    outlive the test and log a failed pass into a later test once its
    database is removed. Here the thread waits out its test and ends
    without a pass, and a test that prunes calls `prune_pass`. A test
    marked `real_pruner` keeps the real body and must not let it run
    past the test."""
    import solvent.ratelimit as ratelimit

    if request.node.get_closest_marker("real_pruner"):
        yield
        return
    ended = threading.Event()
    monkeypatch.setattr(ratelimit, "_prune_forever", lambda app: ended.wait())
    yield
    ended.set()


@pytest.fixture(autouse=True)
def closed_breakers():
    """The provider breakers live in process memory, so one test's
    outage must not open them for the next."""
    import solvent.rates as rates

    for breaker in rates.breakers.values():
        breaker.record_success()
    yield
    for breaker in rates.breakers.values():
        breaker.record_success()


@pytest.fixture(autouse=True)
def cheap_argon2(monkeypatch):
    """Server-side Argon2id at 64 MiB is defense in depth, not the work
    factor, and paying it in every test would cost minutes. The shape
    of what is stored and compared is unchanged."""
    from argon2 import PasswordHasher, Type

    import solvent.crypto as crypto

    monkeypatch.setattr(
        crypto,
        "_hasher",
        PasswordHasher(memory_cost=64, time_cost=1, parallelism=1, type=Type.ID),
    )


@pytest.fixture(autouse=True)
def epoch_clients(monkeypatch):
    """Every app a test builds hands out clients that carry the vault
    epoch, as a page does."""
    import solvent

    monkeypatch.setattr(solvent._Flask, "test_client_class", EpochClient)
