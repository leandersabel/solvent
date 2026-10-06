"""SQLite bootstrap: the one place that opens the DB file, creates its
schema, and seeds the platform's symbol table
(spec/features/app-shell.md, Database).
"""
from __future__ import annotations

import contextlib
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import flask

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

#: The version schema.sql stamps into `PRAGMA user_version`.
SCHEMA_VERSION = 1

#: Seconds a starting process waits for another's initialization to
#: commit, which covers the slowest start on the smallest host.
_INIT_TIMEOUT = 30


class SchemaMismatch(RuntimeError):
    """A database file this build cannot serve."""


def now() -> datetime:
    return datetime.now(timezone.utc)


def utcnow() -> str:
    """The server clock, in the one format every timestamp column
    holds. Set server-side, never accepted from a client."""
    return now().isoformat(timespec="seconds")


def new_epoch() -> str:
    """A vault epoch: 16 random bytes as 32 lowercase hex characters
    (architecture.md, Vault epoch)."""
    return secrets.token_bytes(16).hex()


def connect(target, **kwargs) -> sqlite3.Connection:
    """The one way the app opens the file, so every connection
    overwrites what it deletes: a deleted `attempts` row would
    otherwise leave its bytes in a free page (architecture.md,
    Storage & data handling)."""
    conn = sqlite3.connect(target, **kwargs)
    conn.execute("PRAGMA secure_delete = ON")
    return conn


def init_app(app: flask.Flask) -> None:
    app.teardown_appcontext(_close_db)


def init_db(app: flask.Flask) -> None:
    """Create every table, index and trigger this schema owns, then
    seed the symbol table.

    Idempotent, so it is safe on every process start: each statement in
    schema.sql is `IF NOT EXISTS`, and the seed inserts only rows that
    are absent.

    The one transaction is what makes it safe when several processes
    start at once, as gunicorn's workers do on a fresh volume. Without
    it, schema.sql commits statement by statement and stamps the version
    last, so a second process sees tables at version 0 and refuses to
    start. `BEGIN IMMEDIATE` makes it wait instead, for the first one's
    commit, and then find a finished schema at the current version.

    That idempotence is also why an existing file is checked first.
    `IF NOT EXISTS` leaves a table written by another version of this
    schema exactly as it found it, so the process would start against a
    database it cannot write and fail at the first request instead.
    """
    db_path = Path(app.config["DATABASE_PATH"])
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # `autocommit=True` leaves transaction control here, and keeps
    # `executescript` from committing the transaction it runs in.
    conn = connect(db_path, timeout=_INIT_TIMEOUT, autocommit=True)
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            _check_version(conn, db_path)
            conn.executescript(SCHEMA_PATH.read_text())
            _seed_symbols(conn)
            _prune_attempts(conn, app)
            _fill_epochs(conn)
            # app-shell.md, Database: an entry may hold a proposal an
            # earlier build rounded otherwise.
            conn.execute("DELETE FROM rate_cache")
            conn.execute(
                "UPDATE principals SET last_login_at = created_at "
                "WHERE last_login_at IS NULL"
            )
            conn.execute(
                "UPDATE invites SET used_by = NULL "
                "WHERE used_by NOT IN (SELECT username FROM principals)"
            )
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
    finally:
        conn.close()


def _check_version(conn: sqlite3.Connection, db_path: Path) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version == SCHEMA_VERSION:
        return
    empty = (
        conn.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' "
            "AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0]
        == 0
    )
    if empty:
        return
    raise SchemaMismatch(
        f"{db_path} holds schema version {version}, and this build serves "
        f"version {SCHEMA_VERSION}. Point DATABASE_PATH at a new file, or "
        f"export the vaults from a build that serves version {version} and "
        f"import them into a fresh one."
    )


def _prune_attempts(conn: sqlite3.Connection, app: flask.Flask) -> None:
    from .ratelimit import prune

    prune(conn, app.config, now())


def _fill_epochs(conn: sqlite3.Connection) -> None:
    """A fresh epoch for each vault owner an earlier build left without
    one, so every vault owner has one wherever a request can read it. A
    row that exists is never rewritten: a page already holds it."""
    for (principal_id,) in conn.execute(
        "SELECT id FROM principals WHERE kind = 'vault_owner' AND id NOT IN "
        "(SELECT principal_id FROM vault_epochs)"
    ).fetchall():
        conn.execute(
            "INSERT INTO vault_epochs (principal_id, epoch) VALUES (?, ?)",
            (principal_id, new_epoch()),
        )


def _seed_symbols(conn: sqlite3.Connection) -> None:
    from .rates import SEEDED_SYMBOLS

    conn.executemany(
        "INSERT OR IGNORE INTO symbols (symbol, label, kind, lookup) "
        "VALUES (?, ?, ?, ?)",
        [(s["symbol"], s["label"], s["kind"], int(s["lookup"])) for s in SEEDED_SYMBOLS],
    )
    # A metal that names no weight leaves the picker (rate-lookup.md,
    # Seeded symbols), and holdings already in it keep working.
    conn.execute(
        "UPDATE symbols SET retired = 1 WHERE kind = 'metal' "
        "AND symbol NOT GLOB '*-ozt' AND symbol NOT GLOB '*-g'"
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
        conn = connect(
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


@contextlib.contextmanager
def read_transaction():
    """One snapshot around a read, so everything a handler returns
    comes from the same moment as the check it made first."""
    conn = get_db()
    conn.execute("BEGIN")
    try:
        yield conn
    finally:
        conn.execute("ROLLBACK")


def _close_db(_exception: BaseException | None = None) -> None:
    db = flask.g.pop("db", None)
    if db is not None:
        db.close()
