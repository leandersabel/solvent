from __future__ import annotations

import pytest

from tests.helpers import register


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
    monkeypatch.setattr(crypto, "_DECOY_VERIFIER", None)
