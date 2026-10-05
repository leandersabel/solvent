from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from tests.helpers import EpochClient, register


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
