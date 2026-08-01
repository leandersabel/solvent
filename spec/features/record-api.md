# Record API

<!-- Added because architecture.md (Record storage API) defines the
endpoint every other feature reads and writes through, without any
feature file owning its implementation. Without this, nine contracts
assume an API no contract builds. -->

## What it does

One generic, type-agnostic store for every encrypted record a user
owns: accounts, snapshots, and the profile. The server has no per-type
logic because it cannot read any type — it moves opaque blobs in and
out of rows keyed by plaintext columns it is allowed to see.

**No screen.** This is infrastructure; `manage-accounts.md`,
`record-snapshot.md`, `net-worth-view.md`, `account-settings.md`, and
`export-import.md` all depend on it. Build it first.

## Row shape

Exactly the table in architecture.md, Record storage API: `user_id`,
`record_id`, `record_type`, `account_id`, `schema_version`, `version`,
`nonce`, `ciphertext`, `updated_at`.

- `record_type` ∈ `account` | `snapshot` | `profile`. Unknown values are
  rejected — the server cannot read the payload, but it can hold the
  type vocabulary closed.
- `account_id` is required and non-empty exactly for `snapshot`, and
  empty for `account` and `profile`. Enforced server-side; it is a
  plaintext column.
- `version` starts at 1 and increments by exactly 1 per write.
- `nonce` is 96 bits, and must differ from the row's previous nonce on
  every write (architecture.md, Nonce strategy).
- Primary key is `(user_id, record_id)`. A `record_id` is a
  client-generated UUIDv4 and is only ever unique within a user.

## The AAD encoding

Every blob's GCM Additional Authenticated Data is the first six columns
(architecture.md, Key management). Because AAD is byte-exact, the order
and encoding are pinned here rather than left to each implementation —
two implementations that disagree produce a vault that never decrypts.

- **Field order** is the one written in Key management:
  `user_id ‖ account_id ‖ record_type ‖ record_id ‖ schema_version ‖
  version`. This differs from the column order in the storage table;
  Key management wins.
- **Encoding**: each field as UTF-8 text, joined with a single `0x1f`
  (ASCII unit separator) byte. A separator is required, not cosmetic —
  bare concatenation leaves field boundaries ambiguous, so two different
  tuples could produce identical AAD.
- `account_id` empty is the empty string, not the literal `null`, and
  still contributes its separator.
- `schema_version` and `version` are their decimal representations
  without padding.

The client builds this string; the server independently builds the same
string from the row's own columns and compares before storing. A
mismatch is a 400 — the server cannot decrypt, but it can refuse to
store a blob whose claimed slot disagrees with the slot it is going
into.

## Schema migration

`schema_version` is bumped when a record type's **plaintext** shape
changes. The server cannot migrate anything — it cannot read the
payload — so migration is entirely client-side and **lazy**:

1. On read, the client decrypts a record and, if its `schema_version` is
   below the client's current version for that type, runs it through an
   ordered chain of pure migration functions in memory.
2. The migrated record is used immediately. **Nothing is written back.**
3. The record is persisted in the new shape on its next legitimate save,
   which bumps `version` and `schema_version` together like any other
   write.

Consequences that make this the right shape, and that must not be
"fixed" later by a well-meaning bulk rewrite:

- **No migration event.** There is no moment where a vault is
  half-migrated, and no long-running rewrite that can fail partway.
- **The AAD only changes when a record legitimately changes.** A bulk
  rewrite would re-encrypt every record with a new nonce and a bumped
  `version` for no user-visible reason, destroying the property that
  `version` counts real edits.
- **A record never read is never migrated**, and that is fine — it is
  migrated the first time anything reads it, which is the only time its
  shape matters.
- Migrations are **pure functions on decrypted plaintext**, so they are
  unit-testable without any crypto, and the same chain is reused by
  Import to migrate an older `formatVersion` file (`export-import.md`).

A client encountering a `schema_version` **higher** than it knows treats
that record as unreadable — it is skipped, counted, and surfaced by the
same warning as a decryption failure (`net-worth-view.md`). Guessing at
a future shape is how data gets silently corrupted.

## Endpoints

All session-authenticated. All writes CSRF-protected (architecture.md,
Application hardening). All request and response bodies are
Pydantic-validated.

- **`GET /api/records?type=<t>`** → every record of that type belonging
  to the session user, as
  `{ recordId, recordType, accountId, schemaVersion, version, nonce,
  ciphertext }`. One type per request; a client needing all three issues
  three requests (`net-worth-view.md`, Data flow). `type` is required
  and must be a known value.
- **`PUT /api/records/<record_id>`** — create or update. Body carries
  `recordType`, `accountId`, `schemaVersion`, `version`, `nonce`,
  `ciphertext`. `version` is the version **being written**:
  - Create: `version` must be 1, and no row may already exist.
  - Update: `version` must be exactly the stored version + 1.
  - Anything else → **409**, and nothing is written. This is what stops
    a stale tab silently clobbering a newer write.
  - `recordType` is immutable once set; a `PUT` changing it is a 400.
- **`DELETE /api/records/<record_id>`** — delete one record. Deleting a
  record that does not exist, or belongs to another user, is a **404**.

`DELETE /api/accounts/<account_id>?mode=purge` is the one deliberately
type-aware exception to this API, because cascading a delete across a
snapshot set must be atomic and the server can see `account_id`. It is
specified and owned by `manage-accounts.md`, not here.

## Rules

- **`user_id` always comes from the session, never from the client** —
  in the path, the body, a header, or a query parameter. A payload
  carrying a `userId` field is rejected outright rather than ignored,
  so the mistake surfaces in a test instead of in production.
- Every query is scoped to the session user. A record belonging to
  another user is **404, not 403** — the same rule purge follows
  (`manage-accounts.md`), so an attacker cannot map which ids exist.
- Limits are enforced before the row reaches the DB (architecture.md,
  Blob and quota limits): max ciphertext size per record, max records
  per vault, and a total per-user byte quota. Over any limit → 413,
  nothing written.
- `updated_at` is the server clock, set server-side, never accepted
  from the client.
- The server never inspects, parses, or logs `ciphertext`.
- Writes are transactional per request: a rejected write leaves the
  stored row byte-identical.

## Edge cases

- **`PUT` with a `record_id` that is not a well-formed UUIDv4** → 400.
  The id is client-generated, so it is validated as a shape, not
  trusted as an identity.
- **`PUT` for `snapshot` with an empty `accountId`**, or for `account`
  / `profile` with one set → 400.
- **`PUT` whose `accountId` names an account row that does not exist
  for this user** → 400. The server can check this: `account_id` is
  plaintext.
- **Two tabs write the same record concurrently** → the second sees 409
  and reloads; no merge is attempted anywhere in the system.
- **A second `profile` record** → allowed by the schema, and a client
  bug. The API does not enforce a singleton, since it would be the only
  per-type rule in a deliberately type-agnostic store; clients treat the
  highest `version` as authoritative.
- **Quota exhausted mid-session** → 413 on write; reads keep working, so
  the vault is never locked away by its own size.
- **Request body over the size cap** → rejected at the framework layer
  before parse, not after.

## Acceptance criteria

- A `PUT` at `version: 1` creates a row; the same `PUT` repeated returns
  409 and does not increment anything.
- A `PUT` at stored `version + 1` succeeds; at the stored version, at
  `+2`, or at 1 for an existing row, all return 409 and leave the row
  byte-identical.
- `GET /api/records?type=account` returns only the session user's
  records, only of that type. With two users holding records, neither
  sees a single row of the other's.
- A `PUT`, `GET`, or `DELETE` naming another user's `record_id` returns
  404 and changes nothing.
- A request body containing a `userId` field naming another user is
  rejected; no row is written under either user.
- An unauthenticated request to any of the three endpoints returns 401.
- A write without the CSRF token or required custom header is rejected.
- Two successive writes to one record produce different nonces.
- A blob whose client-supplied AAD tuple disagrees with the row it is
  being stored into is rejected with 400.
- The AAD string for a known tuple matches a fixture byte-for-byte,
  including separators and the empty `account_id` — the regression test
  that keeps two implementations from drifting into an unreadable vault.
- A `snapshot` `PUT` with an empty `accountId`, and an `account` `PUT`
  with one set, are both 400.
- A ciphertext over the per-record cap, a vault over the record-count
  cap, and a user over the byte quota each return 413 with nothing
  written.
- A `record_id` that is not a valid UUIDv4 is rejected.
- A record stored at an older `schema_version` is readable, and reading
  it writes nothing — `version`, `nonce`, and `ciphertext` are
  byte-identical afterwards.
- That record persists in the new shape only on its next save, at which
  point `schema_version` and `version` both advance.
- A record at a `schema_version` higher than the client knows is skipped
  and counted in the same warning as an undecryptable record, never
  guessed at.
- Each migration function is unit-tested on decrypted plaintext with no
  crypto involved.
- No log line contains any `ciphertext` value.
