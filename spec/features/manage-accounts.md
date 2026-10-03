# Manage holdings

## What it does

Create, edit, archive, and delete holdings: name, native unit,
dimension assignments, and a note. All content is encrypted
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

- `unit` is what the holding is measured in — **and is also its rate
  symbol.** Either a symbol from the operator's table (`USD`,
  `XAU-ozt`, `XAU-g`) or free text for a holding with no market price
  (`m²`, `bottles`). A brokerage depot is a currency holding in the
  depot's reporting currency; there is no share or ticker unit, by
  design (architecture.md, Non-goals).

  **There is no separate rate-symbol field.** A second field could
  disagree with the unit: a holding measured in `XAU-g` but priced with
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
  - Formatting follows the reader's settings, not the unit
    (account-settings.md, Dates and numbers), so the `account` record
    carries no `kind`.
- `dims` maps **dimension id → value id**, both opaque ids from the
  profile's dimension config (`account-settings.md`). It carries no
  display text: renaming "Cash" to "Bargeld" rewrites the profile and
  not one `account` record.
- `note` is free text, optional, `null` when unset, so what a user
  wants to jot about a holding is not forced into a taxonomy.
- **There is no server-side dimension entity**: a server-side list would
  leak the classification graph. Everything the UI shows is derived
  client-side from the decrypted profile and holdings.
- `archivedAt` is `null` for an active holding, otherwise the ISO date
  the holding was archived.

## Dimensions

A dimension is a named axis whose values partition the holdings —
"Liquidity" with values "Cash", "Retirement", and so on. A holding's
`dims` entry for a dimension puts it in exactly one band of that
dimension.

- **At most one value per dimension, structurally.** `dims` is a map
  keyed by dimension id, so a second value for one dimension cannot be
  written — not by the form, not by an import, not by a hand-edited
  export. A JSON object cannot carry the same key twice. Making the
  fault unrepresentable beats detecting it.
- **Ids, never labels.** Both halves of an entry are short opaque ids
  (`account-settings.md`, Dimensions). Two consequences carry the
  point:
  - Labels are free text in any script, and renaming one is a
    single-record write to the profile. There is no multi-record
    rewrite anywhere in this feature.
  - An id cannot collide with anything the user typed. A label-derived
    key could: a holding already carrying a `bank:ubs`-style string
    would silently acquire an assignment the moment a dimension keyed
    `bank` appeared.
- **A holding need not carry every dimension.** A missing entry is a
  real state, rendered as "Unassigned" — not an error, and not hidden.
  Readers treat an absent key as unassigned, because a dimension created
  later predates every holding that existed before it. Nothing is
  backfilled at dimension-creation time; a backfill would be a
  multi-record re-encryption that can partially fail, and the read-time
  fallback makes it unnecessary.
- **A value id that names no configured value** — because the value or
  its dimension was archived — also renders as "Unassigned". The entry
  stays on the holding untouched, so restoring the value restores every
  assignment exactly (`account-settings.md`).

The **list of dimensions, their display labels, and their value order**
are user configuration, not derivable from the holdings: the holdings
yield which value ids are in use, but never their labels or their
intended order, and order is load-bearing for a stacked chart. They live
in the encrypted profile record (`account-settings.md`).

## Inputs / outputs

- In: the holding's name, unit, one value per configured dimension,
  optional note.
- Out: `PUT /api/records/<uuid>` with the encrypted blob; the holding
  appears in lists of holdings and is selectable when recording a
  snapshot.

## Delete: the user chooses

Deleting a holding that has snapshots is a user decision at delete
time, not a fixed policy, because both options are legitimate:

- **Archive** (default, preselected). Writes the holding's zero on the
  day the archive is made, then sets `archivedAt` (Archiving). The
  holding leaves active lists and the current total and takes no new
  snapshots. Every snapshot before that day stays as it was.
  Reversible.
- **Delete permanently.** Removes the `account` record and cascades to
  every snapshot carrying that `account_id`. **It deletes no price
  entry.** A price belongs to a symbol, another holding may be measured
  in the same one, and the server could not find them anyway: the symbol
  is inside the ciphertext (`record-rate.md`). Requires typing the
  holding's name to confirm. The dialog must state plainly that **past
  net-worth figures will change**, because the history is going away.
  Irreversible.

A holding with no snapshots skips the dialog and is deleted outright.

Cascade is executed **server-side** — the server can see `account_id` on
snapshot rows (architecture.md, Record storage API), so it can delete
the set atomically without the client enumerating ids. That is also the
whole reach of the cascade: no other record type carries an
`account_id`, so nothing else can be swept up by it. Endpoint:
`DELETE /api/accounts/<account_id>?mode=purge`.

## Archiving

D is the day the archive is made. The dialog shows it and does not
offer a choice.

**The zero is what archiving means.** The person choosing to archive
gives it, so it is a figure they gave (requirements.md, Recording
values). There is no closing value to edit and no way to archive
without the zero: a closed position is worth nothing, and a band ending
at any other figure drops at D with nothing recorded to explain it.

The zero is an ordinary `snapshot`, `{ "date": D, "value": "0",
"note": null }`, with the holding's plaintext `account_id`. Nothing in
it marks it as the archive's. **The archive's zero is the zero-valued
snapshot at a holding's `archivedAt` while `archivedAt` is set**, so
the record shape, export and import learn nothing new.

### Writes

**The zero is a recording.** It joins the recording at D, or starts one,
and refreshes D's prices like any recorded quantity (`record-rate.md`,
The refresh).

Before its first create, the archive runs the pre-create reload of
`type=snapshot` and `type=rate`, once, and decides every step below
from what the reload returned (`record-snapshot.md`, Creating and
reopening are distinct acts, which names the archive's narrower
refusal). An archive that creates nothing runs no reload.

In this order:

1. **The zero at D**, by what D holds for this holding:
   - **Nothing** → a create at a fresh UUIDv4 and `version: 1`. The
     archive is refused only when the reload finds this holding's slot
     at D taken. Other holdings' records at D are the recording the
     zero joins, not a collision. A refused archive writes nothing, and
     the dialog reopens on what D now holds.
   - **A non-zero figure** → the dialog states, before its confirm,
     that the zero replaces that figure, named in the holding's unit.
     On confirm the record is updated in place: same `record_id`,
     `version` + 1, fresh nonce, `value` `"0"`, `note` kept. The
     dialog's statement is the consent, so the replace prompt does not
     also fire (`record-snapshot.md`, Same holding, same date).
   - **A zero**, in any canonical form (`"0"`, `"0.00"`) → nothing is
     written and the dialog states no replacement, because nothing is
     replaced. This is the retry path after a failed flag write, and a
     stored `"0.00"` keeps the digits it was typed with.
2. **D's price entries**, ensured over the units of the active holdings
   as they stand at this moment, this holding still among them. Ensured
   means created only where D has no entry for a symbol: a date that
   already holds a recording keeps every rate it holds, and a retry
   rewrites none it already wrote. A date whose prices are complete
   issues no request to `/api/rates`, and a unit the proxy returns no
   proposal for gets no entry (The refresh, per symbol).
3. **The `account` record**, with `archivedAt: D`, at `version` + 1.

A holding with no snapshots archives the same way, so the zero is its
only figure. It appears on no chart date (`net-worth-view.md`, Edge
cases), and unarchived it reads zero like any other holding. **The zero
is a recorded figure, so from then on its unit is fixed** (Rules),
archived or not.

**The order is load-bearing.**

- **The zero before the prices** is the write path's own order
  (`record-rate.md`, The write path): prices written with the quantity
  then failing would move every holding in those units for a figure
  that is not there.
- **The prices before the flag**, because the refresh covers active
  holdings only. Setting the flag first would drop this holding's unit
  out of the set, and D would go unpriced for every other holding
  measured in it.
- **The flag last**, because each earlier step alone leaves a true
  state. With the zero written and the flag failed, the holding is
  active and worth zero at D, and archiving again finds the zero,
  writes only the prices still missing, and writes the flag. Flag first with the zero
  failing would leave an archived holding stepping off its last figure,
  unable to take the snapshot that would repair it.

Failures:

- **The zero did not save** → no price and no `account` write. The
  holding is untouched and the dialog stays open saying so.
- **Conflict on the replacement** → surfaced, never retried. The dialog
  reloads that record and states the replacement again with the figure
  now stored.
- **A price did not save** → the archive still goes through, because a
  price write cannot fail a quantity write (`record-rate.md`, The write
  path). The message names the units whose prices were not written, and
  nothing is rolled back.
- **The flag did not save** → the zero and the prices written stay at D
  and the holding stays active at zero. Both halves are stated, and the
  archive is offered again.

### While archived

- **No new snapshot**, at any date (`record-snapshot.md`, Edge cases).
- **The archive's zero is read-only.** It cannot be edited, cleared or
  deleted, from the holding's page or from the recording for D. An
  archived value has no reason to be anything but zero, and unarchiving
  is how it becomes editable.
- **An entry's date moves only to a date before D.** Onto D it would
  displace the zero (`record-snapshot.md`, Moving the date onto an
  occupied date), and after D it would be a new figure after the
  archive.
- **Every other snapshot stays editable and deletable** as any snapshot
  is (`record-snapshot.md`, Editing an existing snapshot), including a
  non-zero figure at D. Edited to zero, that figure becomes the
  archive's zero.
- **Deleting the recording at D keeps the zero.** Every other record at
  D goes as usual, and the date stays a recording holding the zero. The
  confirmation says the archive's zero stays. Refusing the delete would
  leave unarchive, delete and archive again as the only route, and
  archiving again dates the archive to that day, moving D.
- **Purge still takes the zero** with every other snapshot. Read-only
  guards the zero against edits, not against deleting the holding.

All of this is client-enforced by construction, like the unit rule
(Rules): the server sees neither a date nor `archivedAt`. A session
whose model predates the archive can still write a figure for the
holding at D or later. No such figure reaches a total, because the
chart counts an archived holding on no date from D on and draws
whatever D holds as the step (`net-worth-view.md`, Archived holdings).

### Unarchiving

Clears `archivedAt` at `version` + 1 and writes nothing else. The zero
stays a figure like any other, so the holding rejoins active lists and
the current total at zero until a new figure is recorded, and the zero
becomes editable. Its unit rejoins the set the next recording refreshes
(`record-rate.md`, The refresh).

### A holding archived without a zero at D

A holding archived on D whose figure at D is not zero, or which has no
figure at D, keeps its history as it is. Nothing migrates it, because
writing a zero into that history would be a figure nobody gave. The
chart draws its step at D (`net-worth-view.md`, Archived holdings).
Unarchiving it and archiving it again writes the zero at the new D.

## Rules

- A holding's name is not required to be unique; two holdings may share
  one. The `record_id` is identity.
- Editing a holding never touches its snapshots. Changing the unit of
  a holding that already has snapshots is **blocked** — the existing
  quantities are counted in the old unit, and a new unit would also
  price the whole history off a different symbol's series
  (`record-rate.md`). Silently reinterpreting either would corrupt
  history. The user must archive and create a new holding instead.
  (Renaming, re-classifying, and editing the note are always allowed.)
  Like the password policy (`register.md`),
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

- **A holding with no public price source** (unlisted real estate,
  collectibles) → a free-text unit. Valid and expected; rate proposals
  are unavailable and snapshots take a manual rate. Note that a
  private loan denominated in EUR is *not* this case: its unit is `EUR`
  and it prices through ordinary FX like any other foreign-currency
  holding.
- **Brokerage depot** → an ordinary currency holding whose unit is the
  depot's reporting currency, and whose snapshot value is the broker's
  reported total. A depot reporting in the user's main currency needs no
  rate at all, per the main-currency case below.
- **A free-text unit that later becomes a listed symbol** → the holding
  starts receiving proposals with no migration, because the unit string
  was already the symbol. This is the seeded-symbol argument
  (`rate-lookup.md`) working as intended, and it is why the unit picker
  offers canonical symbols before it offers free text.
- **A holding whose native unit is the user's main currency** → the rate
  is fixed at 1 and the rate field is hidden when recording snapshots.
- **Archiving a holding that is the last active one** → allowed; the
  net worth view shows its all-archived state, total "—" with the
  history still drawn (`net-worth-view.md`, Edge cases).
- **Archiving the last active holding measured in a unit** → that unit
  stops being refreshed and keeps its entries (`record-rate.md`, Edge
  cases).
- **Concurrent edit from two tabs** → the second `PUT` fails with
  Conflict on the version check; the UI reloads and asks the user to
  redo the edit.
- **A holding carrying a `dims` entry for a dimension that no longer
  exists** → the entry is left alone and the holding renders as
  "Unassigned" for it. Stripping the entry would be a destructive
  multi-record write to tidy up a display setting, and it would break
  restoring the dimension.
- **No dimensions configured at all** → `dims` is `{}` and the account
  form shows no classification block. A vault is fully usable this way;
  dimensions cost nothing until used.

## Acceptance criteria

- Creating a holding stores exactly one `account` record; the name,
  unit, note, and dimension assignments appear nowhere in plaintext in
  the DB.
- The holding is readable after a fresh login (round-trips through
  encryption correctly).
- Editing name, note, or a dimension assignment increments `version`
  and writes a different nonce than the previous version.
- A `PUT` sent with a stale `version` is rejected with Conflict and does
  not modify the stored record.
- Deleting a holding that has snapshots shows a dialog offering both
  archive and permanent delete, with archive preselected.
- **Archive** on a D holding no records writes, in this order: one
  `snapshot` with that `account_id`, `date` D, `value` `"0"`, `note`
  `null` and `version: 1`; one `rate` entry at D for every unit of the
  active holdings other than the main currency, this holding's unit
  included, for which the proxy returned a proposal; then the
  `account` record with `archivedAt` D at `version` + 1. Every other
  snapshot of the holding is byte-identical afterwards and none is
  deleted.
- Archiving onto a D that already holds a rate entry for every unit
  issues no request to `/api/rates`, writes no `rate` record, and
  leaves every rate entry at D byte-identical.
- The archive dialog offers no value field and no way to archive
  without the zero.
- The archive runs one reload of `type=snapshot` and `type=rate` before
  its first create, and none when it creates nothing.
- Archiving onto a D where the holding has a non-zero snapshot names
  that figure as replaced before the confirm, shows no replace prompt,
  and leaves exactly one snapshot for that (holding, D): same
  `record_id`, `version` + 1, a different nonce, `value` `"0"`, the
  `note` unchanged.
- Archiving onto a D where the holding's snapshot is `"0.00"` states no
  replacement, writes no snapshot, and leaves that record
  byte-identical.
- With the `account` write stubbed to fail, the zero and the rate
  entries stay at D, the holding stays active and counts at zero.
  Archiving again issues no snapshot write, no `rate` write and exactly
  one `account` `PUT`.
- With one rate write stubbed to fail, the archive goes through, the
  message names that unit, and archiving is not rolled back. With the
  flag also failed, archiving again writes that unit's entry, rewrites
  no other, and writes the flag.
- With the zero's write stubbed to fail, no `rate` and no `account`
  write is issued and the holding is byte-identical.
- With the rate proxy stubbed to 503, the archive still goes through.
- After archiving a holding with no snapshots and unarchiving it,
  changing its unit is refused.
- With a second session having recorded this holding at D after the
  first read its model, the first session's archive is refused after
  the reload and writes nothing. A second session that recorded only
  other holdings at D does not refuse it.
- Archiving a holding with no snapshots writes its zero at D at
  `version: 1`, then the `account` record. Unarchived, it reads zero,
  not "not yet valued".
- While archived, the holding offers no way to record a figure at any
  date. Its zero at D offers no edit, clear or delete on the holding's
  page or in the recording for D. An earlier entry's date cannot be
  moved to D or later, and an earlier entry's value can still be
  edited.
- Deleting the recording at D deletes every other record bearing D and
  leaves the archive's zero byte-identical. The recording still opens,
  holding the zero.
- Purging an archived holding deletes its zero with every other
  snapshot.
- Unarchiving writes only the `account` record, with `archivedAt`
  `null`, and leaves the zero byte-identical. The holding rejoins the
  active list and the total at zero, a figure can be recorded for it,
  and the zero can be edited.
- A holding archived on D with no snapshot at D, or a non-zero one,
  gains no snapshot on unlock, on any read or on any write elsewhere.
  Unarchiving and archiving it again writes the zero at the new D.
- A holding saved with a dimension set to one value and then re-saved
  with another carries exactly one entry for that dimension id
  afterwards — true by construction of the map, so the test guards the
  shape itself.
- **Purge**: the `account` record and every snapshot with that
  `account_id` are gone, in one transaction — a mid-delete failure
  leaves neither partially deleted.
- Purge cannot delete another user's records: a `DELETE` naming an
  `account_id` belonging to a different user returns Not Found, not
  Forbidden, and deletes nothing.
- Attempting to change the unit of a holding with ≥1 snapshot is
  blocked client-side. The test asserts the UI refuses it — not that an
  API call is rejected, which the server cannot do.
- No `account` record contains a rate symbol distinct from its unit,
  asserted against the record shape: no such field exists, so the 31×
  mismatch has nowhere to live.
- No rate-lookup request names any symbol, free text or listed.
  Recording across holdings in several symbols issues one whole-table
  request for the recording date (`rate-lookup.md`, The client never
  names a symbol).
- The dimension list offered in the UI is derived client-side from the
  decrypted profile; no request returns dimensions, labels, or values.
- Renaming a dimension's label writes exactly one record — the profile —
  and leaves every `account` record byte-identical.
- A holding whose `dims` names an archived dimension renders under
  "Unassigned"; restoring the dimension restores the assignment without
  any `account` record being written.
- A holding's name or note containing `<img src=x onerror=alert(1)>`
  renders as literal text everywhere it appears, as does a dimension
  label containing it.
