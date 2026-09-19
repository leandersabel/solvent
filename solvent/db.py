"""SQLite bootstrap: the one place that opens the DB file and creates
its schema (spec/features/app-shell.md, Database).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import flask

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def init_app(app: flask.Flask) -> None:
    app.teardown_appcontext(_close_db)


def init_db(app: flask.Flask) -> None:
    """Create every table this schema owns, if it doesn't exist yet.

    Idempotent -- safe to call on every process start, since each
    statement in schema.sql is `CREATE TABLE IF NOT EXISTS`.
    """
    db_path = Path(app.config["DATABASE_PATH"])
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA_PATH.read_text())
        conn.commit()
    finally:
        conn.close()


def get_db() -> sqlite3.Connection:
    """A request-scoped connection, opened once per request and closed
    in the teardown handler below."""
    if "db" not in flask.g:
        conn = sqlite3.connect(flask.current_app.config["DATABASE_PATH"])
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        flask.g.db = conn
    return flask.g.db


def _close_db(_exception: BaseException | None = None) -> None:
    db = flask.g.pop("db", None)
    if db is not None:
        db.close()
