from __future__ import annotations

import pytest


@pytest.fixture
def app(tmp_path, monkeypatch):
    """A real app instance, wired the same way create_app always wires
    it, pointed at a throwaway SQLite file per test."""
    monkeypatch.setenv("SECRET_KEY", "test-only-secret-key-do-not-use-in-prod")

    from solvent import create_app

    application = create_app(
        config_overrides={
            "DATABASE_PATH": str(tmp_path / "solvent-test.db"),
            "TESTING": True,
        }
    )
    return application


@pytest.fixture
def client(app):
    return app.test_client()
