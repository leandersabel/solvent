# Export / import

## What it does

Export writes the whole vault — every ciphertext record plus the salt,
KDF envelope, and wrapped DEK needed to open it — to a single local
file. The file is fully encrypted; without the password it reveals
nothing but record counts and types.

**It carries both timelines.** Quantities and prices are separate
records (`record-rate.md`) and both are ordinary vault records, so both
ride in the same `records` array with no format change and no second
section. A file missing the price entries would restore a vault whose
whole history reprices itself, which is the failure storing a price
permanently exists to prevent.

**The file carries exactly one wrapper: the password credential's**
(architecture.md, Credentials and vault key wrappers). Not a list, and never
a wrapper belonging to another method, because a wrapper bound to an
authenticator does not travel: a file restored on another machine, or
after the authenticator is lost, could not use it, and its credential
id in a file the user may hand to someone else is a device correlator
sitting in a backup for no benefit. This is the reason the password
method is mandatory and permanent (`account-settings.md`): it is what
makes a vault exportable at all.

It serves two jobs: a **user-held backup** independent of the NAS's ZFS
snapshots, and the **migration path across data-model upgrades**. It is
explicitly *not* a password-recovery mechanism (architecture.md, No
password recovery) and not a sync mechanism.

## Export

`GET /api/export` returns a JSON file, `Content-Disposition: attachment`,
named `solvent-vault-<YYYY-MM-DD>.json`. The name carries no user
identifier, for the same reason the contents carry none: a file found
on a lost machine or a shared drive must not say whose vault it is.
Two vaults exported on one day collide in a downloads folder, and the
browser's own numbering is the answer to that.

It **requires the `X-Solvent-Request` header** despite being a GET
(architecture.md, CSRF), so it is not reachable by navigation: the
client fetches it and saves the response through a blob URL rather than
pointing an `<a href>` at it. Following the URL directly is a Forbidden.

```json
{
  "format": "solvent-vault",
  "formatVersion": 1,
  "exportedAt": "2026-08-01T09:14:00Z",
  "salt": "…",
  "kdf": { "alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1 },
  "wrappedDek": "…", "dekNonce": "…",
  "records": [
    { "recordId": "…", "recordType": "account", "accountId": null,
      "schemaVersion": 1, "version": 3,
      "nonce": "…", "ciphertext": "…" }
  ]
}
```

The file carries **no user identifier**. It does not need one: a
record's AAD is built from the record's own fields (record-api.md), so
the ciphertext authenticates without knowing who exported it. This is
also why the file is portable between accounts at all.

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

### The re-key step

Records are decrypted and re-encrypted client-side under a **freshly
generated DEK** rather than restored verbatim under the file's key.

A vault transfer leaves two accounts holding the same DEK: the exporter
keeps their vault and keeps writing to it, and the importer now holds a
key that opens those writes. A malicious or compromised server could
then inject the exporter's *later* records into the importer's vault,
where they would decrypt cleanly — data the exporter never handed over.
Re-keying makes the two vaults share no key material at all, so the
injection fails at the cryptography rather than at a check.

1. User, logged in as the target account, selects the file and enters
   **the password that vault was exported under** (which may differ from
   their current one).
2. Client derives `MK_file` from the file's salt + KDF envelope and
   unwraps `DEK_file`.
3. Client decrypts every record using `DEK_file` and the record's own
   AAD, built from its per-record fields. Any failure aborts the whole
   import before anything is sent.
4. Client generates a **new random 256-bit `DEK_new`**, and re-encrypts
   each record under it with a fresh nonce. `version` resets to 1, and
   the AAD is rebuilt for that version.
5. Client wraps `DEK_new` under the **current session's Master Key** —
   so the user's existing login password keeps working after the import.
6. `POST /api/import` with the new wrapped DEK and the re-encrypted
   records. The server, in one transaction, deletes every record
   belonging to the session user, replaces their `password`
   credential's wrapper, inserts the new set, and **invalidates every
   other session for the user**, keeping the importing one.
7. Client swaps its in-memory DEK to `DEK_new` and reloads the view.

**Import is the one flow that changes the DEK, so it is the one flow
bound by the rewrite-every-wrapper rule** (architecture.md, One key, N
wrappers). Every credential the vault holds must end this
transaction wrapping `DEK_new`, and any method the importing session
cannot re-wrap is **deleted in that same transaction**, never left
behind. A stale wrapper is worse than a missing one: it unwraps
cleanly to the old DEK, so the method authenticates and then every
record fails to decrypt, which reads as a corrupt vault rather than a
missing unlock option. In v1 this costs nothing, because the password
method is the only one and the importing session is holding its Master
Key by definition.

**The profile record is replaced along with everything else**, so the
main currency, dimensions, and idle-lock setting all become the file's.
That is the one sanctioned way the main currency changes
(`account-settings.md`, Main currency): import replaces the history
too, so every price entry's `rateTarget` matches the profile it
arrived with. The import review step names the change when the file's
main currency differs from the current one, because arriving at a
vault denominated in another currency without being told is a bad
surprise even when it is correct.

Consequences: the user's **password does not change** across an import,
but their **DEK does** — and it is a key that has never existed anywhere
before, not the file's. Salt, KDF envelope, and Auth Key are untouched.
The exported file keeps opening with `DEK_file` and its own password;
re-keying the live vault does not reach backwards into files already
written.

## Rules

- The server assigns `principal_id` from the session on every imported
  record. It never reads an `accountId` from the uploaded payload — one
  account's import can never write into another's vault
  (architecture.md, Import authorization). Export and import are both
  on the vault surface, so an administrator session receives Not Found
  from either (`app-shell.md`, The two surfaces).
- Strict server-side validation before any write: total payload size
  cap, per-record ciphertext size cap, record count cap, known
  `recordType` values, well-formed UUIDs, base64 decodes cleanly,
  `accountId` present exactly for `snapshot` records and `null` for
  every other type, never `""` (record-api.md), and referencing an
  `account` record in the same import.
- **Every record goes through the same per-record validator as
  `PUT /api/records`** (record-api.md), field-consistency check
  included, so there is one set of rules with two callers. That
  validator also enforces `version: 1` on every imported record rather
  than trusting the client to have reset it at step 4 — a record
  arriving at any other version is a Bad Request for the whole payload.
- Client-side validation mirrors this so a bad file fails fast without
  a large upload.
- The import is one transaction. A failure at any point leaves the
  existing vault exactly as it was — never half-erased.
- **Every other session is invalidated by the import**, in that same
  transaction. A second session still holds `DEK_old` and the old
  model: its updates to existing records fail the version check, but a
  *create* — new UUID, `version: 1` — is accepted and stores ciphertext
  under a key no longer in the envelope, producing a permanently
  unreadable record whose only symptom is the decryption-failure
  banner.
- Export is rate-limited per user — **default 5 per hour**, operator
  config (architecture.md, Rate limiting). It is a full vault read, and
  nobody backs up five times an hour.

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
- **There is no `formatVersion` below 1.** There is no older format to
  migrate from.
- **Older `formatVersion`** → migrate the plaintext shape client-side
  after decryption, before re-encrypting, reusing the same per-type
  migration chain the client already applies lazily on read
  (`record-api.md`, Schema migration). Each supported old version needs
  an explicit migration path and a test with a real fixture file. There
  is exactly one set of migration functions in the product, and a
  second, import-only copy would drift.
- **Oversized file** → rejected client-side by size before parse, and
  server-side before write.
- **Import of a vault exported by a different user** → works. It is a
  vault transfer, and it requires that vault's password. After it, the
  two vaults share no key material, so the source's later writes cannot
  be injected into the destination.
- **Export of an empty vault** → valid; produces a file with an empty
  `records` array.
- **Browser tab closed mid-import** → the transaction either committed
  or it did not; there is no partial state to recover from.
- **KDF envelope in the file is below the server minimum** → the import
  still succeeds (the file's envelope is only used to open the file; the
  vault's own envelope is the current account's, unchanged).

## Acceptance criteria

- Export → wipe the vault → import round-trips to an identical set of
  decrypted records: same ids, types, `account_id` links, and plaintext
  payloads, for quantities and prices alike.
- A vault exported and reimported draws a byte-identical chart and the
  same total in both pricing modes (`net-worth-view.md`), which is the
  test that fails if either timeline is dropped.
- The exported file contains no plaintext holding name, note, dimension
  label, value, rate, symbol, date, or currency, verified by scanning
  the file for known values.
- After importing, the user logs in with their **unchanged** password
  and can read every restored record.
- Importing a file exported by a *different* user succeeds, and every
  record decrypts afterwards.
- After an import, the vault's wrapped DEK unwraps to a key that is not
  the file's `DEK_file` — asserted directly, since a verbatim restore
  would now pass every other test in this list.
- A record taken from the *source* vault after the export, and inserted
  directly into the destination's rows, fails to decrypt. This is the
  regression test for the re-key: it passes only because the two vaults
  hold different DEKs.
- The exported file still opens with its original password after the
  source vault has been re-keyed by an unrelated import.
- No exported file contains a user identifier in any field.
- An exported file carries exactly one wrapper, and no field that
  names, counts, or describes a credential.
- An import replaces `wrapped_dek` and `dek_nonce` on the `password`
  credential's `dek_wrappers` row and leaves that credential's `params`
  and `verifier` byte-identical: the salt, the KDF envelope, and the
  Auth Key hash all survive an import, and the user logs in afterwards
  with the unchanged password.
- A file with one record's ciphertext altered by a single byte aborts
  the import, uploads nothing, and leaves the pre-existing vault intact.
- Importing with the wrong password aborts before any request is sent.
- A `POST /api/import` payload with a `principalId` field naming another user
  writes nothing into that user's vault; the records land under the
  session user.
- Importing into a non-empty vault without the typed `ERASE`
  confirmation is refused.
- Simulating a DB failure mid-import leaves the original vault fully
  intact and readable.
- Payloads over the size cap, over the record-count cap, or with an
  unknown `recordType` are rejected before any write.
- A payload with one record at `version: 2`, or one `snapshot` whose
  `accountId` names no `account` record in the same payload, is
  rejected whole —
  the same validator `PUT /api/records` runs.
- Every record in the vault reads `version: 1` after an import.
- A second session belonging to the importing user is invalidated: its
  next API call returns Unauthorized, and a record it attempts to create
  after the import never reaches the vault.
- A fixture file at `formatVersion: 1` still imports after the format
  advances to 2.
- The export screen shows the sensitivity warning before the download is
  triggered, not after.
- `GET /api/export` as a plain top-level navigation returns Forbidden
  and writes no file, with a valid session cookie present — the
  regression test for the header requirement.
