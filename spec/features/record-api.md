# Record API

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

Every blob's GCM Additional Authenticated Data is five of the plaintext
columns (architecture.md, Key management). Because AAD is byte-exact,
the order and encoding are pinned here rather than left to each
implementation — two implementations that disagree produce a vault that
never decrypts.

- **Field order** is the one written in Key management:
  `account_id ‖ record_type ‖ record_id ‖ schema_version ‖ version`.
  This differs from the column order in the storage table; Key
  management wins.
- **`user_id` is not included**, deliberately (architecture.md, Key
  management). The DEK boundary already makes a blob undecryptable in
  another user's vault, so the client can build a record's AAD entirely
  from values it chose or already holds — which is what lets a vault be
  encrypted before the server has assigned the user an identity
  (register.md).
- **Encoding**: each field as UTF-8 text, joined with a single `0x1f`
  (ASCII unit separator) byte. A separator is required, not cosmetic —
  bare concatenation leaves field boundaries ambiguous, so two different
  tuples could produce identical AAD.
- `account_id` empty is the empty string, not the literal `null`, and
  still contributes its separator. This is the **AAD byte rule only** —
  on the wire the same absence is `null`; see below.
- `schema_version` and `version` are their decimal representations
  without padding.

**No request or response carries an `aad` field.** The AAD is a byte
string both sides derive; sending it would invite a server that trusts
the client's copy of values it already holds. The server also cannot
verify the AAD actually used at encryption time — a wrong AAD surfaces
only when the client fails to decrypt, which is exactly the tripwire it
is there to be.

What the server does enforce is **field consistency**, before storing:
the body's `recordType`, `accountId`, `schemaVersion`, and `version`
against the path's `record_id`, and against the stored row's immutable
columns (`recordType` never changes; `accountId` never changes). A
mismatch is a Bad Request — the server cannot decrypt, but it can refuse
to store a blob whose claimed slot disagrees with the slot it is going
into. `POST /api/import` runs every record through this same validator
(`export-import.md`).

## `accountId` on the wire

`null` when absent, everywhere: the `PUT` body, the `GET` response, and
the export file's records. One representation, so import has one case to
map rather than three, and an empty string is a Bad Request rather
than quietly accepted as a second spelling of absent.

The AAD is where that `null` becomes `""` — the one conversion, done
when building the byte string, on both sides.

## Schema migration

`schema_version` is bumped when a record type's **plaintext** shape
changes. **Version 1 is the current shape and there is nothing below
it**, so no migration chain reaches back past it. The server cannot
migrate anything — it cannot read the payload — so migration is entirely
client-side and **lazy**:

1. On read, the client decrypts a record and, if its `schema_version` is
   below the client's current version for that type, runs it through an
   ordered chain of pure migration functions in memory.
2. The migrated record is used immediately. **Nothing is written back.**
3. The record is persisted in the new shape on its next legitimate save,
   which bumps `version` and `schema_version` together like any other
   write.

Consequences of that shape — not defects for a later bulk rewrite to
"fix":

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

There is deliberately **no single-record `GET`.** The client fetches
every record once per session and keeps the model in memory
(`net-worth-view.md`, Data flow), so a stale-version reload after a
Conflict refetches that record's whole type — three requests at most, on
data already sized for one fetch. A by-id endpoint would also hand the
server a per-record access pattern it currently cannot see. Where a
screen spec says it "reloads the current record", this is what that
means.

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
  - Anything else → **Conflict**, and nothing is written. This is what
    stops a stale tab silently clobbering a newer write.
  - `recordType` is immutable once set; a `PUT` changing it is a Bad
    Request.
- **`DELETE /api/records/<record_id>`** — delete one record. Deleting a
  record that does not exist, or belongs to another user, is a **Not
  Found**.

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
  another user is **Not Found, not Forbidden** — the same rule purge
  follows (`manage-accounts.md`), so an attacker cannot map which ids
  exist.
- Limits are enforced before the row reaches the DB (architecture.md,
  Blob and quota limits): max ciphertext size per record, max records
  per vault, and a total per-user byte quota. Over any limit → Content
  Too Large, nothing written.
- `updated_at` is the server clock, set server-side, never accepted
  from the client.
- The server never inspects, parses, or logs `ciphertext`.
- Writes are transactional per request: a rejected write leaves the
  stored row byte-identical.

## Edge cases

- **`PUT` with a `record_id` that is not a well-formed UUIDv4** → Bad
  Request. The id is client-generated, so it is validated as a shape,
  not trusted as an identity.
- **`PUT` for `snapshot` with `accountId: null`**, or for `account` /
  `profile` with one set → Bad Request. So is an `accountId` of `""` on
  any type — absence has one spelling.
- **`PUT` whose `accountId` names an account row that does not exist for
  this user** → Bad Request. The server can check this: `account_id` is
  plaintext.
- **Two tabs write the same record concurrently** → the second sees
  Conflict and reloads; no merge is attempted anywhere in the system.
- **A second `profile` record** → allowed by the schema, and a client
  bug. The API does not enforce a singleton, since it would be the only
  per-type rule in a deliberately type-agnostic store; clients treat the
  highest `version` as authoritative.
- **Quota exhausted mid-session** → Content Too Large on write; reads
  keep working, so the vault is never locked away by its own size.
- **Request body over the size cap** → rejected at the framework layer
  before parse, not after.

## Acceptance criteria

- A `PUT` at `version: 1` creates a row; the same `PUT` repeated returns
  Conflict and does not increment anything.
- A `PUT` at stored `version + 1` succeeds; at the stored version, at
  `+2`, or at 1 for an existing row, all return Conflict and leave the
  row byte-identical.
- `GET /api/records?type=account` returns only the session user's
  records, only of that type. With two users holding records, neither
  sees a single row of the other's.
- A `PUT`, `GET`, or `DELETE` naming another user's `record_id` returns
  Not Found and changes nothing.
- A request body containing a `userId` field naming another user is
  rejected; no row is written under either user.
- An unauthenticated request to any of the three endpoints returns
  Unauthorized.
- A write without the `X-Solvent-Request` header returns Forbidden,
  and a
  cross-origin attempt to send it never reaches the endpoint because the
  preflight fails.
- Two successive writes to one record produce different nonces.
- A `PUT` whose body tuple disagrees with the path `record_id` or with
  the stored row's immutable columns is rejected with Bad Request, and
  the row is byte-identical afterwards.
- The AAD string for a known tuple matches a fixture byte-for-byte,
  including separators and the empty `account_id` — the regression test
  that keeps two implementations from drifting into an unreadable vault.
- The AAD contains no user identifier in any form, asserted against the
  fixture. A record encrypted by one user and inserted directly into
  another user's rows still fails to decrypt under that user's DEK —
  the DEK boundary carries that property, not the AAD.
- A `snapshot` `PUT` with `accountId: null`, and an `account` `PUT` with
  one set, are both Bad Request; so is either with `accountId: ""`.
- `accountId` is `null`, never `""`, in a `GET /api/records` response
  and in an exported file — asserted against both, since the two are
  written by different code paths.
- A request body carrying an `aad` field is rejected rather than
  ignored: the server builds the AAD it compares against from the row.
- A ciphertext over the per-record cap, a vault over the record-count
  cap, and a user over the byte quota each return Content Too Large with
  nothing written.
- A `record_id` that is not a valid UUIDv4 is a Bad Request.
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
