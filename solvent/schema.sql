-- Solvent schema. One place creates every table's schema and opens the
-- SQLite file on its writable volume (spec/features/app-shell.md,
-- Database); each table's own columns are stated by the feature that
-- owns it.

-- Users: full column set (salt, KDF envelope, Auth Key hash, wrapped
-- DEK, timestamps, ...) is owned by register.md, not yet implemented.
-- Only the columns the shell itself needs -- to resolve a session to a
-- user and to decide which nav entries to render -- are created here.
-- See spec/questions.md, "app-shell: minimal users table" -- register.md's
-- implementation is expected to extend this table with its own columns
-- via migration rather than replace it.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    is_admin INTEGER NOT NULL DEFAULT 0
);

-- Sessions: pinned by spec/architecture.md, Application hardening --
-- server-side rows, not self-contained signed cookies. Issuing a
-- session (generating its token, rotating it on login, the 12-hour
-- absolute expiry as an *enforced* write-side concern) belongs to
-- login.md; this feature only reads this table to decide whether a
-- request is authenticated, so it never writes a row itself outside of
-- tests.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    issued_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL
);
