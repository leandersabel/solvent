"""Dates back what a promise needs time for
(spec/features/nightly-harness.md, Dating back).

Run in a one-off container with no network and the app's volume, with
the app stopped:

    python patch.py <database> <patches.json>

Times count back from this script's own clock. Three statements, every
value bound as a parameter, in one transaction, and nothing else is
touched.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SESSION = "UPDATE sessions SET issued_at = ?, last_active_at = ? WHERE principal_id = (SELECT id FROM principals WHERE username = ?)"
INVITE = "UPDATE invites SET created_at = ?, expires_at = ? WHERE label = ? AND status = 'pending'"
CREDENTIAL = (
    "UPDATE credentials SET params = json_set(params, '$.kdf.m', ?) "
    "WHERE principal_id = (SELECT id FROM principals WHERE username = ?) AND method = 'password'"
)

SHAPES = {
    "sessions": {"username": str, "issuedMinutesAgo": int, "lastActiveMinutesAgo": int},
    "invites": {"label": str, "createdMinutesAgo": int, "expiresMinutesAgo": int},
    "credentials": {"username": str, "kdfMemory": int},
}
# The server's default is 65536 and the floor is what it still accepts.
KDF_MEMORY = range(8192, 65536)


class Refused(Exception):
    """A usage error, found before anything is opened."""


def validate(patches: object) -> None:
    if not isinstance(patches, dict) or set(patches) - set(SHAPES):
        raise Refused("unknown key at the top level")
    for table, entries in patches.items():
        if not isinstance(entries, list):
            raise Refused(f"{table} is not a list")
        for entry in entries:
            if not isinstance(entry, dict) or entry.keys() != SHAPES[table].keys():
                raise Refused(f"unknown or missing key in {table}")
            for key, kind in SHAPES[table].items():
                value = entry[key]
                if not isinstance(value, kind) or isinstance(value, bool) or (kind is int and value < 0):
                    raise Refused(f"{table}.{key} is the wrong type")


def stamp(now: datetime, minutes: int) -> str:
    """As the app writes a time."""
    return (now - timedelta(minutes=minutes)).isoformat(timespec="seconds")


def statements(patches: dict, now: datetime) -> "list[tuple[str, tuple]]":
    work = []
    for entry in patches.get("sessions", []):
        work.append((SESSION, (stamp(now, entry["issuedMinutesAgo"]), stamp(now, entry["lastActiveMinutesAgo"]), entry["username"])))
    for entry in patches.get("invites", []):
        work.append((INVITE, (stamp(now, entry["createdMinutesAgo"]), stamp(now, entry["expiresMinutesAgo"]), entry["label"])))
    for entry in patches.get("credentials", []):
        work.append((CREDENTIAL, (entry["kdfMemory"], entry["username"])))
    return work


def apply(database: Path, patches: dict, now: datetime) -> bool:
    """Whether every statement changed a row. Otherwise nothing was
    committed."""
    # Opened read-write only: a path that is not a database is never
    # created by this script.
    conn = sqlite3.connect(f"{database.resolve().as_uri()}?mode=rw", uri=True, isolation_level=None)
    try:
        conn.execute("PRAGMA secure_delete = ON")
        conn.execute("BEGIN IMMEDIATE")
        for sql, values in statements(patches, now):
            outside = sql is CREDENTIAL and values[0] not in KDF_MEMORY
            if outside or conn.execute(sql, values).rowcount == 0:
                conn.execute("ROLLBACK")
                return False
        conn.execute("COMMIT")
        return True
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def main(argv: "list[str]") -> int:
    if len(argv) != 3:
        print("usage: patch.py <database> <patches.json>", file=sys.stderr)
        return 2
    database = Path(argv[1])
    try:
        patches = json.loads(Path(argv[2]).read_text())
        validate(patches)
    except (OSError, ValueError, Refused) as error:
        print(f"patch refused: {error}", file=sys.stderr)
        return 2
    if not database.is_file():
        print("patch refused: no such database", file=sys.stderr)
        return 2
    if not apply(database, patches, datetime.now(timezone.utc)):
        print("patch failed: a statement changed no row, or a value is out of range", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
