"""SQLite bootstrap: the one place that opens the DB file, creates its
schema, and seeds the platform's symbol table
(spec/features/app-shell.md, Database).
"""
from __future__ import annotations

import contextlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import flask

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def utcnow() -> str:
    """The server clock, in the one format every timestamp column
    holds. Set server-side, never accepted from a client."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_app(app: flask.Flask) -> None:
    app.teardown_appcontext(_close_db)


def init_db(app: flask.Flask) -> None:
    """Create every table, index and trigger this schema owns, then
    seed the symbol table.

    Idempotent, so it is safe on every process start: each statement in
    schema.sql is `IF NOT EXISTS`, and the seed inserts only rows that
    are absent.
    """
    db_path = Path(app.config["DATABASE_PATH"])
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA_PATH.read_text())
        _seed_symbols(conn)
        conn.commit()
    finally:
        conn.close()


def _seed_symbols(conn: sqlite3.Connection) -> None:
    from .rates import SEEDED_SYMBOLS

    conn.executemany(
        "INSERT OR IGNORE INTO symbols (symbol, label, kind, lookup) "
        "VALUES (?, ?, ?, ?)",
        [(s["symbol"], s["label"], s["kind"], int(s["lookup"])) for s in SEEDED_SYMBOLS],
    )


def get_db() -> sqlite3.Connection:
    """A request-scoped connection, opened once per request and closed
    in the teardown handler below.

    `isolation_level=None` leaves transaction control here rather than
    in sqlite3's implicit-commit heuristics, which decide by statement
    keyword and cannot see a `BEGIN IMMEDIATE` a caller needs
    (admin-invites.md, the last-administrator guard).
    """
    if "db" not in flask.g:
        conn = sqlite3.connect(
            flask.current_app.config["DATABASE_PATH"], isolation_level=None
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        flask.g.db = conn
    return flask.g.db


@contextlib.contextmanager
def write_transaction():
    """One `BEGIN IMMEDIATE` around a write, committed on a clean exit
    and rolled back on any exception.

    IMMEDIATE rather than DEFERRED because several writes here read a
    row and then decide on it: counting the remaining administrators
    before deleting one, checking a record's stored version before
    bumping it. A deferred transaction takes its write lock only at the
    first write, so two of those can interleave between the read and
    the decision.
    """
    conn = get_db()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def _close_db(_exception: BaseException | None = None) -> None:
    db = flask.g.pop("db", None)
    if db is not None:
        db.close()
