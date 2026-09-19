-- Solvent schema. One place creates every table and opens the SQLite
-- file on its writable volume (spec/features/app-shell.md, Database);
-- each table's columns are stated by the feature that owns it.

-- Identity and kind, and nothing else (spec/architecture.md, Accounts
-- on this instance). No salt, no envelope, no verifier, no wrapper: a
-- key column here is what the credentials/dek_wrappers split exists to
-- refuse. Owned by register.md.
CREATE TABLE IF NOT EXISTS principals (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('vault_owner', 'administrator')),
    created_at TEXT NOT NULL,
    last_login_at TEXT
);

-- What authenticates a principal. Every principal has exactly one,
-- administrators included. `params` is public and `verifier` is secret,
-- which is the line between the two columns (architecture.md,
-- Credentials and vault key wrappers). Owned by register.md.
CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('password')),
    params TEXT NOT NULL,
    verifier TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Exactly one password credential per principal, always. A second one
-- is unrepresentable rather than refused in application code.
CREATE UNIQUE INDEX IF NOT EXISTS credentials_one_password_per_principal
    ON credentials (principal_id) WHERE method = 'password';

-- The vault's DEK under one credential's wrapping key. Only a vault
-- owner has a row, and its absence is what says an administrator has no
-- vault (architecture.md, Credentials and vault key wrappers).
CREATE TABLE IF NOT EXISTS dek_wrappers (
    credential_id TEXT PRIMARY KEY
        REFERENCES credentials (id) ON DELETE CASCADE,
    wrapped_dek TEXT NOT NULL,
    dek_nonce TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- One generic store for every encrypted record (record-api.md). The
-- five columns after principal_id are exactly the AAD, in storage order
-- rather than AAD order.
CREATE TABLE IF NOT EXISTS records (
    principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
    record_id TEXT NOT NULL,
    record_type TEXT NOT NULL
        CHECK (record_type IN ('account', 'snapshot', 'rate', 'profile')),
    account_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    version INTEGER NOT NULL,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (principal_id, record_id)
);

-- Server-side session rows, not self-contained signed cookies
-- (architecture.md, Application hardening). No kind column: kind is
-- read through principal_id, so a session cannot disagree with the
-- account it belongs to.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    principal_id TEXT NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
    issued_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL
);

-- Single-use, time-limited invites, each naming the kind of account it
-- creates (admin-invites.md). `expired` is derived from expires_at
-- rather than stored, so it cannot drift.
CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('vault_owner', 'administrator')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'used', 'revoked')),
    used_at TEXT,
    used_by TEXT,
    label TEXT NOT NULL DEFAULT ''
);

-- The instance-wide unit and symbol table (rate-lookup.md). Platform
-- configuration, identical for every account: no row of it is anyone's
-- data. `symbol` and `kind` are immutable and there is no delete,
-- because a symbol is written into ciphertext the server cannot read.
CREATE TABLE IF NOT EXISTS symbols (
    symbol TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('currency', 'metal')),
    lookup INTEGER NOT NULL CHECK (lookup IN (0, 1)),
    retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1))
);

-- Public reference data keyed by (symbol, quote, date), holding nothing
-- about who asked (rate-lookup.md, Caching).
CREATE TABLE IF NOT EXISTS rate_cache (
    symbol TEXT NOT NULL,
    quote TEXT NOT NULL,
    date TEXT NOT NULL,
    rate TEXT NOT NULL,
    as_of TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (symbol, quote, date)
);

-- Throttling (architecture.md, Rate limiting; rate-lookup.md, Rate
-- limiting and failure). One row per counted event, in SQLite rather
-- than process memory so several gunicorn workers share one budget and
-- a restart does not hand an attacker a fresh one. A lockout is derived
-- from the rows in its window rather than stored, so it cannot drift.
CREATE TABLE IF NOT EXISTS attempts (
    bucket TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('request', 'failure')),
    at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS attempts_by_bucket ON attempts (bucket, at);

-- The storage-layer half of "an administrator has no vault"
-- (app-shell.md, Database). A SQLite CHECK cannot reach another table,
-- which is why these are triggers. Nothing in the application is
-- expected to hit them; they exist so that a future feature that would
-- has to be written deliberately.
CREATE TRIGGER IF NOT EXISTS records_refuse_administrator
BEFORE INSERT ON records
WHEN (SELECT kind FROM principals WHERE id = NEW.principal_id) = 'administrator'
BEGIN
    SELECT RAISE(ABORT, 'an administrator has no vault');
END;

CREATE TRIGGER IF NOT EXISTS dek_wrappers_refuse_administrator
BEFORE INSERT ON dek_wrappers
WHEN (
    SELECT principals.kind FROM principals
    JOIN credentials ON credentials.principal_id = principals.id
    WHERE credentials.id = NEW.credential_id
) = 'administrator'
BEGIN
    SELECT RAISE(ABORT, 'an administrator has no vault');
END;
