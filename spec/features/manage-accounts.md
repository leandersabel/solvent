# Manage accounts

## What it does

Create, edit, archive, and delete accounts (holdings): name, native
unit, dimension assignments, and a note. All content is encrypted
client-side and stored through the generic record API (architecture.md,
Record storage API).

## Record shape

`record_type: "account"`, plaintext `account_id` empty. Decrypted
payload:

```json
{
  "name": "UBS dollar account",
  "unit": "USD",
  "dims": { "d7f3a1b2": "9c4e0f11", "a4b8c2d1": "3e7f9a02" },
  "note": "joint with M",
  "archivedAt": null,
  "createdAt": "2026-08-01T09:14:00Z"
}
```

- `unit` is what the account is measured in — **and is also its rate
  symbol.** Either a symbol from the operator's table (`USD`,
  `XAU-ozt`, `XAU-g`) or free text for a holding with no market price
  (`m²`, `bottles`). A brokerage depot is a currency account in the
  depot's reporting currency; there is no share or ticker unit, by
  design (architecture.md, Non-goals).

  **There is no separate rate-symbol field.** A second field could
  disagree with the unit: an account measured in `XAU-g` but priced with
  `XAU-ozt` reports a net worth wrong by a factor of 31.1034768,
  silently, with nothing on any screen to reveal it. The two are never
  legitimately different — a depot's unit *is* its reporting currency,
  gold in grams *is* `XAU-g`. One field cannot disagree with itself.

  Consequences:
  - The unit names the **base asset only**. The quote currency is the
    user's main currency and travels as a separate `quote` parameter to
    the proxy, so a pair like `USDCHF` is never a unit
    (`rate-lookup.md`).
  - A unit **in** the symbol table gets rate proposals; a unit that is
    free text gets none, and its rates are entered by hand. That is the
    whole of the rule — no flag, no checkbox, no `null` case to
    special-case.
  - Formatting precision comes from the symbol table's `kind`
    (`currency` or `metal`), and from a sensible default for free text.
    An explicit `kind` on the account would be a third copy of the same
    fact.
- `dims` maps **dimension id → value id**, both opaque ids from the
  profile's dimension config (`account-settings.md`). It carries no
  display text: renaming "Cash" to "Bargeld" rewrites the profile and
  not one account record.
- `note` is free text, optional, `null` when unset. It exists so that
  what a user wants to jot about a holding — "joint with M", "sold half
  in 2024" — has an honest home instead of being forced into a
  taxonomy.
- **There is no server-side dimension entity**: a server-side list would
  leak the classification graph. Everything the UI shows is derived
  client-side from the decrypted profile and accounts.
- `archivedAt` is `null` for active accounts, otherwise the ISO date the
  account was archived.

## Dimensions

A dimension is a named axis whose values partition the accounts —
"Liquidity" with values "Cash", "Retirement", and so on. An account's
`dims` entry for a dimension puts it in exactly one band of that
dimension.

- **At most one value per dimension, structurally.** `dims` is a map
  keyed by dimension id, so a second value for one dimension cannot be
  written — not by the form, not by an import, not by a hand-edited
  export. A JSON object cannot carry the same key twice. Making the
  fault unrepresentable beats detecting it.
- **Ids, never labels.** Both halves of an entry are short opaque ids
  (8 characters of `[a-z0-9]`, generated client-side at creation). Two
  consequences carry the point:
  - Labels are free text in any script, and renaming one is a
    single-record write to the profile. There is no multi-record
    rewrite anywhere in this feature.
  - An id cannot collide with anything the user typed. A label-derived
    key could: an account already carrying a `bank:ubs`-style string
    would silently acquire an assignment the moment a dimension keyed
    `bank` appeared.
- **An account need not carry every dimension.** A missing entry is a
  real state, rendered as "Unassigned" — not an error, and not hidden.
  Readers treat an absent key as unassigned, because a dimension created
  later predates every account that existed before it. Nothing is
  backfilled at dimension-creation time; a backfill would be a
  multi-record re-encryption that can partially fail, and the read-time
  fallback makes it unnecessary.
- **A value id that names no configured value** — because the value or
  its dimension was archived — also renders as "Unassigned". The entry
  stays on the account untouched, so restoring the value restores every
  assignment exactly (`account-settings.md`).

The **list of dimensions, their display labels, and their value order**
are user configuration, not derivable from the accounts: the accounts
yield which value ids are in use, but never their labels or their
intended order, and order is load-bearing for a stacked chart. They live
in the encrypted profile record (`account-settings.md`).

## Inputs / outputs

- In: account name, unit, one value per configured dimension, optional
  note.
- Out: `PUT /api/records/<uuid>` with the encrypted blob; the account
  appears in account lists and is selectable when recording a snapshot.

## Delete: the user chooses

Deleting an account that has snapshots presents **two explicit options**
— this is a user decision at delete time, not a fixed policy, because
both are legitimate:

- **Archive** (default, preselected). Sets `archivedAt` and re-writes
  the account record. The account disappears from active lists and can
  take no new snapshots, but every snapshot stays. Historical net worth
  remains truthful. Reversible — an archived account can be unarchived.

  The dialog also offers a **closing snapshot** dated `archivedAt`,
  prefilled with `0` and editable — the closing value if the position
  was liquidated at a figure, `0` if it simply ended. This is the
  expected path, not a nicety: with it, the account's band reaches its
  closing value as recorded data, and the trend chart interpolates into
  that value like any other snapshot (net-worth-view.md). The user may
  skip it, and then the band drops by the last known value on
  `archivedAt` with nothing recorded to explain it — an artifact of a
  flag rather than data the user entered. Either way the date carries an
  archive annotation, so the drop is never mistaken for a bad snapshot.
- **Delete permanently.** Removes the account record and cascades to
  every snapshot carrying that `account_id`. Requires typing the account
  name to confirm. The dialog must state plainly that **past net-worth
  figures will change**, because the history is going away. Irreversible.

An account with no snapshots skips the dialog and is deleted outright.

Cascade is executed **server-side** — the server can see `account_id` on
snapshot rows (architecture.md, Record storage API), so it can delete
the set atomically without the client enumerating ids. Endpoint:
`DELETE /api/accounts/<account_id>?mode=purge`.

## Rules

- Account names are not required to be unique; two accounts may share a
  name. The `record_id` is identity.
- Editing an account never touches its snapshots. Changing the unit of
  an account that already has snapshots is **blocked** — the existing
  values and stored rates are denominated in the old unit, and silently
  reinterpreting them would corrupt history. The user must archive and
  create a new account instead. (Renaming, re-classifying, and editing
  the note are always allowed.) Like the password policy (register.md),
  this is **client-enforced by construction**: `unit` lives inside the
  ciphertext, so the server cannot validate it and this spec does not
  pretend it is a server-side control.
- Every write re-encrypts the whole record with a fresh nonce and
  increments `version` (architecture.md, Nonce strategy).
- Decrypted names, notes, and dimension labels are rendered with
  `x-text` / `textContent` only, never `x-html` (architecture.md,
  Application hardening). Dimension labels are user-authored strings
  like any other.

## Edge cases

- **Account with no public price source** (unlisted real estate,
  collectibles) → a free-text unit. Valid and expected; rate proposals
  are simply unavailable and snapshots take a manual rate. Note that a
  private loan denominated in EUR is *not* this case: its unit is `EUR`
  and it prices through ordinary FX like any other foreign-currency
  holding.
- **Brokerage depot** → an ordinary currency account whose unit is the
  depot's reporting currency, and whose snapshot value is the broker's
  reported total. A depot reporting in the user's main currency needs no
  rate at all, per the next case.
- **A free-text unit that later becomes a listed symbol** → the account
  starts receiving proposals with no migration, because the unit string
  was already the symbol. This is the seeded-symbol argument
  (`rate-lookup.md`) working as intended, and it is why the unit picker
  offers canonical symbols before it offers free text.
- **Account whose native unit is the user's main currency** → the rate
  is fixed at 1 and the rate field is hidden when recording snapshots.
- **Archiving an account that already has a snapshot on the archive
  date** → the closing-snapshot field follows the ordinary upsert rule
  (`record-snapshot.md`): it prefills with the existing value rather
  than `0`, and saving replaces that record in place after the same
  confirm. The archive dialog does not get a private path around
  one-snapshot-per-date.
- **Archiving an account that is the last active one** → allowed; the
  net worth view shows its empty state.
- **Unarchiving** → clears `archivedAt`; the account rejoins active
  lists and the current total.
- **Concurrent edit from two tabs** → the second `PUT` fails with
  Conflict on the version check; the UI reloads and asks the user to
  redo the edit.
- **An account carrying a `dims` entry for a dimension that no longer
  exists** → the entry is left alone and the account renders as
  "Unassigned" for it. Stripping the entry would be a destructive
  multi-record write to tidy up a display setting, and it would break
  restoring the dimension.
- **No dimensions configured at all** → `dims` is `{}` and the account
  form shows no classification block. A vault is fully usable this way;
  dimensions cost nothing until used.

## Acceptance criteria

- Creating an account stores exactly one `account` record; the name,
  unit, note, and dimension assignments appear nowhere in plaintext in
  the DB.
- The account is readable after a fresh login (round-trips through
  encryption correctly).
- Editing name, note, or a dimension assignment increments `version`
  and writes a different nonce than the previous version.
- A `PUT` sent with a stale `version` is rejected with Conflict and does
  not modify the stored record.
- Deleting an account that has snapshots shows a dialog offering both
  archive and permanent delete, with archive preselected.
- **Archive**: the account record gains `archivedAt`, no snapshot record
  is deleted, and the trend chart for dates before the archive is
  unchanged.
- Archiving with the offered closing snapshot accepted writes one
  snapshot dated `archivedAt`; the account's band runs into that value
  and ends there, instead of dropping by the last known value.
- Archiving with the closing snapshot skipped still archives; the drop
  at `archivedAt` is unexplained, and that is the user's choice. Both
  paths annotate the date as an archive.
- An account saved with a dimension set to one value and then re-saved
  with another carries exactly one entry for that dimension id
  afterwards — true by construction of the map, so the test guards the
  shape itself.
- **Purge**: the account record and every snapshot with that
  `account_id` are gone, in one transaction — a mid-delete failure
  leaves neither partially deleted.
- Purge cannot delete another user's records: a `DELETE` naming an
  `account_id` belonging to a different user returns Not Found, not
  Forbidden, and deletes nothing.
- Attempting to change the unit of an account with ≥1 snapshot is
  blocked client-side. The test asserts the UI refuses it — not that an
  API call is rejected, which the server cannot do.
- No account record contains a rate symbol distinct from its unit,
  asserted against the record shape: no such field exists, so the 31×
  mismatch has nowhere to live.
- An account whose unit is free text triggers zero rate-lookup
  requests; an account whose unit is a listed symbol triggers exactly
  one per snapshot entry.
- Unarchiving restores the account to active lists and to the current
  total.
- The dimension list offered in the UI is derived client-side from the
  decrypted profile; no request returns dimensions, labels, or values.
- Renaming a dimension's label writes exactly one record — the profile —
  and leaves every account record byte-identical.
- An account whose `dims` names an archived dimension renders under
  "Unassigned"; restoring the dimension restores the assignment without
  any account record being written.
- An account name or note containing `<img src=x onerror=alert(1)>`
  renders as literal text everywhere it appears, as does a dimension
  label containing it.
