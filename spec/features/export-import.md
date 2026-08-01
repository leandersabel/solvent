# Export / import

## What it does

Export writes the whole vault — every ciphertext record plus the salt,
KDF envelope, and wrapped DEK needed to open it — to a single local
file. The file is fully encrypted; without the password it reveals
nothing but record counts and types.

It serves two jobs: a **user-held backup** independent of the NAS's ZFS
snapshots, and the **migration path across data-model upgrades**. It is
explicitly *not* a password-recovery mechanism (architecture.md, No
password recovery) and not a sync mechanism.

## Export

`GET /api/export` returns a JSON file, `Content-Disposition: attachment`,
named `solvent-vault-<username>-<YYYY-MM-DD>.json`:

```json
{
  "format": "solvent-vault",
  "formatVersion": 1,
  "exportedAt": "2026-08-01T09:14:00Z",
  "userId": "…",
  "salt": "…",
  "kdf": { "alg": "argon2id", "v": 19, "m": 262144, "t": 3, "p": 1 },
  "wrappedDek": "…", "dekNonce": "…",
  "records": [
    { "recordId": "…", "recordType": "account", "accountId": null,
      "schemaVersion": 1, "version": 3,
      "nonce": "…", "ciphertext": "…" }
  ]
}
```

`userId` is included because it is part of every record's AAD — without
it the ciphertext cannot be authenticated on import. It is an opaque
identifier, not a name.

The export screen must state, in plain language and before the download
starts, that **this file is exactly as sensitive as the password** —
anyone holding both owns the vault — and that losing the password makes
the file permanently unreadable.

## Import: replace-only

Import **replaces the vault entirely**. There is no merge. The purpose
is restore and migration, both of which mean "make this vault be what
the file says," and a merge would need conflict rules that would be
mostly untested and quietly wrong.

If the target vault already holds records, the user must type `ERASE` to
confirm, against a dialog stating exactly how many records will be
destroyed.

### The re-encryption step

Records are re-encrypted client-side during import rather than copied
across verbatim. This is not optional: every record's AAD binds
`user_id`, so a blob exported from one user id will fail to decrypt
under another — a verbatim restore into a fresh instance, or into a
re-provisioned account, would produce a vault that opens and then
decrypts nothing.

1. User, logged in as the target account, selects the file and enters
   **the password that vault was exported under** (which may differ from
   their current one).
2. Client derives `MK_file` from the file's salt + KDF envelope and
   unwraps `DEK_file`.
3. Client decrypts every record using `DEK_file` and the record's
   **original** AAD, built from the file's `userId` and per-record
   fields. Any failure aborts the whole import before anything is sent.
4. Client re-encrypts each record under the same `DEK_file` with a fresh
   nonce and a **new** AAD carrying the current session's `user_id`;
   `version` resets to 1.
5. Client wraps `DEK_file` under the **current session's Master Key** —
   so the user's existing login password keeps working after the import.
6. `POST /api/import` with the new wrapped DEK and the re-encrypted
   records. The server, in one transaction, deletes every record
   belonging to the session user, replaces their wrapped DEK, and
   inserts the new set.
7. Client swaps its in-memory DEK to `DEK_file` and reloads the view.

Consequences worth stating outright: the user's **password does not
change** across an import, but their **DEK does**. Salt, KDF envelope,
and Auth Key are untouched.

## Rules

- The server assigns `user_id` from the session on every imported
  record. It never reads a user id from the uploaded payload — one
  user's import can never write into another's vault (architecture.md,
  Import authorization).
- Strict server-side validation before any write: total payload size
  cap, per-record ciphertext size cap, record count cap, known
  `recordType` values, well-formed UUIDs, base64 decodes cleanly,
  `accountId` present exactly for `snapshot` records and referencing an
  account in the same import.
- Client-side validation mirrors this so a bad file fails fast without
  a large upload.
- The import is one transaction. A failure at any point leaves the
  existing vault exactly as it was — never half-erased.
- Export is rate-limited per user; it is a full vault read.

## Edge cases

- **Import into a vault that already has data** → typed `ERASE`
  confirmation naming the record count to be destroyed. No merge option
  is offered.
- **Wrong password for the export file** → DEK unwrap fails; abort with
  "That password does not open this file." Nothing is uploaded, the
  existing vault is untouched.
- **One record fails to decrypt** → abort the entire import and report
  which record. A partial restore is worse than none.
- **Malformed JSON, wrong `format`, or unknown `formatVersion`
  (newer)** → reject with a clear message. A newer file in an older app
  is not something to guess at.
- **Older `formatVersion`** → migrate the plaintext shape client-side
  after decryption, before re-encrypting, reusing the same per-type
  migration chain the client already applies lazily on read
  (`record-api.md`, Schema migration). This is the whole point of the
  feature; each supported old version needs an explicit migration path
  and a test with a real fixture file. There is exactly one set of
  migration functions in the product — a second, import-only copy would
  drift.
- **Oversized file** → rejected client-side by size before parse, and
  server-side before write.
- **Import of a vault exported by a different user** → works, by
  construction, because of the re-encryption step. It is a vault
  transfer, and it requires that vault's password.
- **Export of an empty vault** → valid; produces a file with an empty
  `records` array.
- **Browser tab closed mid-import** → the transaction either committed
  or it did not; there is no partial state to recover from.
- **KDF envelope in the file is below the server minimum** → the import
  still succeeds (the file's envelope is only used to open the file; the
  vault's own envelope is the current account's, unchanged).

## Acceptance criteria

- Export → wipe the vault → import round-trips to an identical set of
  decrypted records: same ids, types, account links, and plaintext
  payloads.
- The exported file contains no plaintext account name, tag, value,
  rate, or currency, verified by scanning the file for known values.
- After importing, the user logs in with their **unchanged** password
  and can read every restored record.
- Importing a file exported under a *different* user id succeeds, and
  every record decrypts afterwards — the regression test for the AAD
  rebinding.
- A file with one record's ciphertext altered by a single byte aborts
  the import, uploads nothing, and leaves the pre-existing vault intact.
- Importing with the wrong password aborts before any request is sent.
- A `POST /api/import` payload with a `userId` field naming another user
  writes nothing into that user's vault; the records land under the
  session user.
- Importing into a non-empty vault without the typed `ERASE`
  confirmation is refused.
- Simulating a DB failure mid-import leaves the original vault fully
  intact and readable.
- Payloads over the size cap, over the record-count cap, or with an
  unknown `recordType` are rejected before any write.
- A fixture file at `formatVersion: 1` still imports after the format
  advances to 2.
- The export screen shows the sensitivity warning before the download is
  triggered, not after.
