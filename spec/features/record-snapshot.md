# Record snapshot

## What it does

Enter a point-in-time quantity for one holding: a date and a value in
the holding's native unit. That is the whole of a snapshot.

**A snapshot carries no rate.** Quantities and prices are two separate
timelines (architecture.md, Data model), one price series per symbol
(`record-rate.md`).

**Recording a quantity refreshes every price**, which is the other half
of the same design and is specified in `record-rate.md`, The refresh.
This file owns only the quantity.

## Record shape

`record_type: "snapshot"`, plaintext `account_id` set to the owning
holding. Decrypted payload:

```json
{
  "date": "2026-07-31",
  "value": "12450.00",
  "note": null
}
```

- **`value` is a decimal string, never a JSON number.** Money
  must not drift, so every quantity in the product is parsed into a
  **`BigInt` at a fixed scale of 12 decimal places**, computed on as an
  integer, and formatted back to a string. No IEEE-754 float touches a
  value, a rate, or a total at any point, and no decimal library is
  pulled in.
  - **One scale for every quantity.** Scale 12 covers a rate at eight
    significant decimals, a holding in troy ounces or m², and a currency
    amount at two. "Integer minor units" is a money-only idea with no
    meaning for a rate or for 12.5 troy ounces. Carrying a scale factor
    per quantity instead would be a decimal library, written here and
    worse.
  - **Multiplication rescales once**: the integer product of two
    scale-12 values is scale 24, divided back by 10¹² with
    **round-half-even**. Addition and subtraction need no rescale, which
    is why a sum of snapshots is exact by construction.
  - **Division** happens in two places only — the percentage view and
    per-holding interpolation (`net-worth-view.md`) — and rounds
    half-even at scale 12 as well. Rounding for *display* is a separate,
    later step applied to a figure already exact at scale 12.
  - A decimal library was rejected on the same grounds as a charting
    library (`net-worth-view.md`): what it supplies is rescaling and a
    rounding mode — the helpers above — against one more file to
    self-host, pin, hash, and re-verify on every bump, inside a page
    that handles the password (architecture.md, Supply chain).
- **`value` keeps the fraction digits it was typed with**, in canonical
  form: `-?(0|[1-9][0-9]*)(\.[0-9]{1,12})?`, and a zero carries no
  sign. Typed `12.50` is stored `"12.50"`, `007` is `"7"`, `.5` is
  `"0.5"`, `12.` is `"12"` and `-0.00` is `"0.00"`. The digits typed
  are the precision the person measured, and the display shows them
  back (`account-settings.md`, Dates and numbers). Arithmetic reads the
  same string at scale 12 and does not care. Reading never rewrites a
  value: a stored string stays as stored until the person changes it.
- `date` is a calendar date (`YYYY-MM-DD`), no time, no timezone — a
  snapshot is "what it was worth that day."
- `note` is free text, optional, `null` when unset.

Contribution to net worth = `value` times the price of the holding's
unit, which `net-worth-view.md` selects from the price timeline.

## Flow

1. User picks a holding and a date (defaults to today).
2. User enters the value. The client shows the converted main-currency
   figure live, using the price it already holds or the proposal for
   that date (`record-rate.md`).
3. Client encrypts and `PUT`s the record.
4. On success, the recording date's price entries are written
   (`record-rate.md`, The write path).

The value field is never sent anywhere before it is encrypted — in
particular, it must not be part of, or trigger, any rate request.

## Same holding, same date: upsert

**One snapshot per (holding, date).** Entering a value for a date that
already has one prompts "You already recorded 12 450.00 USD for 31 July.
Replace it?" — the previously recorded value, in the holding's native
unit — and, on confirm, updates the existing record in place
(same `record_id`, `version` + 1, fresh nonce).

Duplicate detection is client-side — the client already decrypts every
snapshot for the holding, and the server cannot see dates. Record ids
stay random UUIDv4; deriving them from the date would let the server
brute-force which dates a user holds data for.

This is the path where the date is chosen blind. **The prompt fires
only where the stored figure is not already displayed in the field
being edited.** It therefore does not fire in a reopened recording
(Reopening and editing a recording), nor in the archive dialog's
closing-snapshot field, which prefills with the stored figure and
carries a confirm of its own (`manage-accounts.md`).

## Confirming a previous value

A snapshot can be written by **confirming** a holding's last recorded
quantity at a new date rather than typing it (`ui/update-values.md`). It
writes an ordinary snapshot: new `date`, new `record_id`, and the
stored `value` string character for character, never the field's text
parsed again, so a confirmed figure is never rounded or reformatted. No
new field and nothing for the record shape to learn.

**Unchanged is decided on stored forms.** A field counts as untouched
while its text equals its prefill (`account-settings.md`, Dates and
numbers), which keeps a sweep row on Confirm and a recorded row's Save
inert. An edited field is parsed and compared with the stored `value`
as strings, not as numbers, so `12.50` typed over a stored `"12.5"` is
an edit and writes `"12.50"`.

**Confirming asserts the quantity, and only the quantity.** You still
own 12.5 troy ounces. What gold has done since is the price timeline's
business, and it is refreshed by the act of recording whether or not
anything was confirmed (`record-rate.md`). That is why confirming has no
cases: it is one click for a franc holding, for a dollar holding, for
gold, and for the flat, and it stays one click when the provider is
down, because nothing about it depends on a price resolving.

Confirming is unavailable for a holding with no snapshots. There is
nothing to confirm.

## A recording is a date

The person's unit of work is a **recording**: one date, and everything
recorded at it. Reopening 31 March means every record of theirs bearing
that date, the quantities and the prices together, on one screen, where
each of them can be changed, added, or cleared and saved as one act.

**Nothing stores a recording.** There is no fifth record type and no
grouping record. A recording is a client-side index over the model
already in memory (`net-worth-view.md`, Data flow): snapshots and rate
entries grouped by their own `date` field.

- Every fact a grouping record could hold is already on its members.
  The date is on each of them, and the uniqueness rules, one snapshot
  per (holding, date) and one entry per (symbol, date), already pin the
  identity such a record would be asserting.
- **It could disagree with what it claims to group.** A member deleted
  from the holding's own page, written by a second session, or whose
  date moved would leave it naming records that are not there. A
  derived index cannot be wrong about its own contents.
- It would carry a `version` of its own, so two sessions recording the
  same date would lose a concurrency check on a record neither of them
  cares about while both of their real writes succeeded.
- It would have to be deleted when its last member goes, and that
  cascade cannot run server-side, because the server cannot see a date.

Consequences:

- **A recording exists exactly as long as a record carries its date.**
  This is what lets it have contents and still be one thing. Clear
  every quantity and the rates captured that day still carry the date,
  so the recording is still there, holding what it still holds. Delete
  every record at the date and it is gone with them, needing no
  tombstone and nothing tidied up.
- **A recording has no version and cannot conflict as a whole.**
  Concurrency stays per record, under the one rule in `record-api.md`.
- **A recording has no author, no wall-clock time, and no note of its
  own.** Two sittings on one day are one recording, because the date is
  the identity.
- Export carries recordings by carrying their members
  (`export-import.md`), with no format change and no second section.

## Reopening and editing a recording

Opening a recording and saving it is one act covering these changes, in
any combination:

1. **Changing a quantity** already recorded at that date. An ordinary
   versioned update of that snapshot, same `record_id`.
2. **Adding a quantity** for a holding that has none at that date. An
   ordinary create at a fresh UUIDv4 and `version: 1`. A holding
   skipped at a date is a holding with no record there, so nothing
   distinguishes adding one now from having recorded it then.
3. **Changing a rate** captured at that date (`record-rate.md`, Editing
   a captured rate).

Each is saved by its own control, a row's for a quantity and the rate
lines' for the rates, and no save spans them. The write order inside
each, and what the person is told when part of a save fails, is
`record-rate.md`, Saving an edited recording.

**Opening a recording writes nothing and fetches nothing.** Not a
version bump, not a nonce, not a rate request. Reading your own history
is a read, and a path where merely looking at March can reprice March
is the one thing this screen must not have.

**A recording's date does not move.** The date is the recording's
identity, so changing it is not an edit of it, and a whole-date move
onto an occupied date would have to resolve a collision per holding.
Moving one entry between dates stays what it is, an edit of that
snapshot from the holding's own page (Moving the date onto an occupied
date).

**The replace prompt does not fire here** (Same holding, same date).
The stored figure is on screen in the field being edited, so the prompt
would fire on every ordinary correction and tell the person what they
are already looking at.

**Two doors reach one snapshot.** The holding's own page edits one
entry across that holding's whole history and can move its date
(`ui/account-detail.md`). A recording edits one date across every
holding and cannot. Both are the same record and the same versioned
write, so neither door needs to know the other was used.

### Creating and reopening are distinct acts

A recording is **created** at a date holding none of the person's
records, or **reopened** at a date that holds some. **A create never
becomes an update behind the person's back.**

**Which of the two happens is routing, decided before anything is
typed.** Asking for a new recording and picking a date the model
already holds records for opens that recording's own screen
(`ui/recording-detail.md`), there and then, with no request and nothing
created. Editing it is one Update away. No create is attempted, so none
can fail and nothing is lost.
The refusal below is for the case where that choice turns out to have
been stale: a date that became occupied after the client read its own
model, which only another session can do.

**The routing needs nothing from the server.** Every record is fetched
on unlock and kept in memory (`net-worth-view.md`, Data flow), so which
dates hold a recording is the same index a recording is defined by, and
a date picker over it costs no request. The one gap is a record that
cannot be decrypted: it carries no readable date, so it belongs to no
recording and no date picker can show it. It is counted in the
decryption warning rather than silently shaping the list.

- **A create at a date another session has since recorded fails.** It
  does not become an update, does not merge, and is not retried. The
  person is told the date was recorded elsewhere and reaches it through
  the reopen flow, which is the only way an existing figure changes.
- **Inside a reopened recording, a create whose slot another session
  filled fails the same way.** The holding was not silent after all.
- **The replace prompt is a different case** (Same holding, same date).
  There the stored figure is put in front of the person and they choose
  to replace it, before anything is written. That is consent, not a
  collision discovered at write time.
- **The check runs against freshly reloaded records, never against the
  model in memory.** Before the first record a sitting creates at a
  date, the client reloads the types it will create in
  (`GET /api/records?type=snapshot` and `type=rate`, the reload
  `record-api.md` already prescribes) and re-checks. A session open
  since this morning is exactly the session whose model says the date
  is free.
- **A sitting that creates nothing runs no reload.** Reopening a date
  and changing what is there is updates alone, each under the version
  rule in `record-api.md`, which is the check that catches another
  session on exactly those records. The reload buys nothing there,
  because there is no slot to claim. Adding a holding that has no
  record at the date is a create, and it brings the reload with it.
- **The reload runs once per sitting, not once per row.** After it, the
  date belongs to this session: another session's attempt to create a
  recording there is refused by its own reload, so the rows that follow
  need no further check. A fifteen-row sweep costs one extra `GET`, not
  fifteen.
- **A save is refused whole** when the reload finds the date recorded
  elsewhere, or finds any slot the save would create already taken.
  Nothing is written, not even into slots that are still free. The
  person is looking at a screen that no longer describes the vault, and
  writing half of it against a date they have not seen is worse than
  writing none of it.
- **What they typed is lost, and that is accepted.** There is no draft
  buffer, no merge, and no re-apply against the reloaded date. The
  screen reloads to the recording as it now stands and the figures are
  entered again. Two sessions recording one date is rare in a
  single-owner vault, and retyping is cheap next to any machinery that
  would avoid it.
- The server cannot make this check. It cannot see a date, and record
  ids are random by design (above), so one per slot is a client rule
  and the reload is what enforces it.

### Clearing a figure

A quantity cleared in a reopened recording **deletes that snapshot**.
Reopening exists to fix what should not be in the record, and a figure
that should never have been recorded is the case with nowhere else to
go.

- **Only a field backed by a record at that date can be cleared.**
  Emptying a field filled from the holding's last figure at some other
  date deletes nothing, because there is nothing at this date to
  delete. What the screen chose to prefill never decides whether a
  record dies. The stored record does.
- An empty field that was already empty is what it has always been: no
  change, and nothing written.
- **Clearing a quantity clears no rate**, for the reason deleting a
  snapshot deletes none (Edge cases).
- **Clearing every quantity leaves a recording with no values and its
  rates intact**, which is an ordinary state and not a degenerate one.
  The prices captured that day are what the app went and got, they are
  still true of that day, and they still price the dates around them
  (`net-worth-view.md`). The recording reopens, shows its rate lines,
  and takes a value again whenever one turns up.
- **Clearing is an ordinary edit and costs what one costs.** It
  destroys no date, so it carries no more confirmation than any other
  save. Destroying a date is its own action, below.
- **A `DELETE` answering Not Found counts as done.** The record is
  gone, which is what was asked, and another session having got there
  first is not a failure the person can act on.

### Deleting a recording

A separate action on the recording removes **every record bearing that
date**, the snapshots and the rate entries together. It is the only
thing that removes a date, and it is never a consequence of clearing
fields.

- **One confirmation, stating that this is destructive and cannot be
  restored.** There is no undo and no server-side copy: an exported
  file is the only way back, and only if one was made.
- It is a set of ordinary `DELETE` requests, one per record, with no
  transaction spanning them, exactly like the deletions in a save
  (`record-rate.md`, Saving an edited recording). Quantities go first
  and rates after, so a run that stops partway leaves the date priced
  rather than leaving quantities nothing can value.
- **A partial delete leaves a recording, not a broken one.** The
  records that went are gone, the rest are still there and still read
  normally, and the screen names what is left and offers the action
  again. Nothing is rolled back, and nothing marks the date as
  half-deleted.
- **The date is free afterwards** and is recorded again as though it
  never had been (Creating and reopening are distinct acts). This is
  the only way a date becomes free.
- **It moves the chart further than clearing values does.** Removing
  the date's rate entries reprices every holding measured in those
  symbols across the stretches those entries anchored, which is every
  band in those units and not only the holdings recorded that day. The
  confirmation says so, and `net-worth-view.md` bounds the stretch.

## Editing an existing snapshot

Value, note, and **date** are all editable (`ui/account-detail.md` is
where a past snapshot is found). Editing is an ordinary versioned write,
except when the date moves onto a date the holding already holds.

**No edit here touches a price.** Correcting a typo in a value, or
moving an entry from 30 July to 31 July, changes which price the holding
is valued at only because the price for a date is looked up by date. The
prices themselves are untouched, none is fetched, and there is no
proposal to accept or decline. Fixing a price is a separate record,
edited in the recording for its date (`record-rate.md`, Editing a
captured rate).

### Moving the date onto an occupied date

That case destroys a record, unlike the upsert above, which only
replaces the one being written. It must read differently:

> 30 July already holds a snapshot of 12 100.00 USD. Moving this entry
> there will delete it.

**Order the two operations write-then-delete.** The move is a `PUT`
(this record, new date) plus a `DELETE` (the record being displaced),
and no transaction spans two records in this API. Delete-first risks
losing the displaced record while the `PUT` fails, leaving a hole with
nothing to show for it. Write-first risks a moment where two snapshots
claim one date — harmless server-side, since one-per-date is a
client-side rule, and visible to the client afterwards.

**Two snapshots on one date is a reachable state, and must be surfaced,
never silently resolved.** Two paths reach it, and no third one does:

- **A date move whose `DELETE` failed**, above.
- **Two sittings whose first creates cross inside the reload window.**
  The pre-create reload (Creating and reopening are distinct acts)
  refuses a create at a date taken before it ran, which is every
  collision older than one round trip. Two creates that cross inside
  that round trip each carry a fresh UUIDv4 at `version: 1`, so neither
  loses a version check, and the server, which cannot see a date, has
  nothing to refuse.

A client that finds a pair takes no guess at which is authoritative,
not the highest `version` and not the latest `updated_at`. It renders
both in the holding's history and in the recording for that date, both
flagged, with an action to keep one, and it excludes that date from
interpolation until resolved, because there is no correct curve through
two values. Same family as a decryption failure: a visible fault beats
a quiet wrong number.

## Inputs / outputs

- In: holding, date, value, optional note.
- Out: encrypted snapshot record via `PUT /api/records/<uuid>`, and the
  recording date's price entries behind it (`record-rate.md`). Net worth
  view and trend chart reflect both immediately from local state,
  without a refetch.

## Edge cases

- **No price is available for the unit**, because the provider is down,
  rate-limited or has no data for that date, because the unit is free
  text nobody has priced, or because the person left the rate line
  empty → **the quantity saves regardless**. **Nothing in the price half
  ever blocks a quantity**, in any form: no disabled save, no required
  rate field, no warning to dismiss first. The price half degrades on
  its own terms (`record-rate.md`, The refresh),
  the rate line says quietly that nothing was written for that unit, and
  the holding is listed as **not priced** rather than counted wrong,
  which `net-worth-view.md` owns.
- **Date is in the future** → blocked. A snapshot describes what was.
- **Date precedes the holding's `createdAt`** → allowed; backfilling
  history is a normal use.
- **Editing a past snapshot** → allowed, versioned like any other write.
  The AAD's `version` binds each ciphertext to the version it
  was written at, so the server cannot pass an old blob off as the
  current one. It does **not** prevent a rollback: re-serving the intact
  `(ciphertext, version)` pair from an earlier write is self-consistent
  and decrypts cleanly, because the client holds no record that a later
  version existed. Catching that needs the DEK-authenticated manifest
  deferred in architecture.md (Data integrity) — do not write a test
  asserting rollback is detected today.
- **Deleting a snapshot** → allowed, single confirm, from the holding's
  page or by clearing its figure in the recording for its date.
  Deleting the only snapshot for a holding leaves the holding with no
  current value, and it is excluded from the total rather than counted
  as zero. No price entry is deleted with it: a price belongs to a
  symbol, not to the holding that happened to prompt it.
- **A recording with no quantities**, whether they were cleared or
  never entered, keeps its rate entries, is still a recording, reopens
  like any other, and keeps pricing the dates around it (Clearing a
  figure).
- **A recording deleted outright** → every snapshot and every rate
  entry at that date goes, the recording appears in no list, and the
  date is available to be recorded again as though it never had been.
- **Value of zero** → valid and meaningful (a closed-out position). Not
  the same as having no snapshot.
- **Negative value** → valid. Mortgages and loans are holdings with
  negative balances; net worth is a signed sum.
- **Non-numeric or malformed value** → inline validation, no
  submission.
- **Snapshot recorded against an archived holding** → blocked; archived
  holdings take no new snapshots. The one exception is the **closing
  snapshot written as part of archiving** (manage-accounts.md), dated
  `archivedAt` and written in the same flow that sets it.

## Acceptance criteria

- Recording a snapshot stores one `snapshot` record whose plaintext
  columns carry `account_id` but no date or value, and whose decrypted
  payload carries no rate field of any kind.
- `value` survives a round-trip as an exact decimal string,
  `"0.1"` plus `"0.2"` in a total yields `"0.3"`, not `0.30000000000000004`.
- Multiplying two scale-12 values rounds half-even at the twelfth
  decimal, asserted on a case that sits exactly on the midpoint in both
  directions — the rounding mode is what two implementations would
  otherwise drift on.
- A value with more than twelve decimal places is rejected at input
  rather than silently truncated.
- Typed `12.50`, `007`, `.5`, `12.` and `-0.00` store `value` as
  `"12.50"`, `"7"`, `"0.5"`, `"12"` and `"0.00"`, and every stored
  `value` matches `^-?(0|[1-9][0-9]*)(\.[0-9]{1,12})?$` with no zero
  carrying `-`.
- A snapshot stored as `"12.5"` reads `12.5`, and displaying it,
  opening its recording and confirming it at a new date leave its own
  record byte-identical.
- Re-entering a date that already has a snapshot prompts to replace and,
  on confirm, results in **one** record for that (holding, date) with
  `version` incremented and a different nonce.
- Declining the replace prompt leaves the original record untouched.
- A negative value and a zero value both round-trip and are included in
  the total; a holding with no snapshots is excluded from the total.
- No request issued during the flow contains the entered value, in any
  field, in any encoding.
- With the rate proxy stubbed to 503, the snapshot still saves, and the
  screen reports that prices were not updated rather than blocking.
- A quantity in a unit with no price entry at all, and none typed,
  saves: the save control is live throughout, one `snapshot` record is
  written, and the holding is listed as not priced. Asserted for a
  free-text unit and for a symbol whose lookup returned nothing.
- A future-dated snapshot is rejected.
- Attempting to record against an archived holding is blocked, except
  for the closing snapshot written by the archive flow itself.
- Editing a snapshot from a second tab with a stale `version` returns
  Conflict and does not overwrite.
- Editing a snapshot's value, note, or date issues no request to
  `/api/rates` and writes no `rate` record.
- Confirming writes a snapshot whose `value` is the holding's last
  recorded string character for character at the new date, for a
  holding in the main currency, one with a live rate source, and one
  with none, with no branch between them. Under `moneyPlaces` `0`,
  confirming an `XAU-ozt` holding stored as `"12.125"` writes
  `"12.125"` and a `USD` holding stored as `"1000.40"` writes
  `"1000.40"`.
- A sweep row prefilled from `"12.5"` offers Confirm, offers Record once
  edited, offers Confirm again when the prefill is typed back, and with
  `12.50` typed writes `"12.50"`.
- Confirming stays available and stays one click with the rate proxy
  stubbed to No Content.
- Confirming a holding with no snapshots is not offered, and the
  equivalent request is rejected client-side.
- Moving a snapshot's date onto an occupied date prompts with copy
  naming the deletion, and on confirm leaves exactly one record for that
  date.
- The move issues the `PUT` before the `DELETE`: with the `DELETE`
  stubbed to fail, both records still exist afterwards and neither is
  lost.
- With two snapshots present for one (holding, date), the history view
  shows both flagged, the client picks neither, and that date is
  excluded from the interpolated series until resolved.
- Deleting a snapshot deletes no `rate` record, asserted by count.
- Opening a recording of any age issues no `PUT`, no `DELETE`, and no
  request to `/api/rates`, and every record at that date is
  byte-identical afterwards.
- Adding a value for a holding with no record at a reopened date
  creates one `snapshot` at `version: 1` and changes no other snapshot
  at that date.
- Clearing a figure backed by a record at that date deletes exactly
  that record. Clearing a field prefilled from the holding's figure at
  another date deletes nothing and writes nothing.
- Clearing every quantity at a date leaves that date's rate entries
  byte-identical, the recording reopens with its rate lines, and the
  symbols still price the dates around it.
- Deleting a recording removes every snapshot and every rate entry
  bearing that date, and the date is offered as a fresh recording
  afterwards.
- A delete whose third `DELETE` is stubbed to fail leaves the remaining
  records readable, rolls nothing back, and reports what is still
  there.
- A `DELETE` answering Not Found during a save is reported as saved,
  not as a failure.
- A second session whose model predates the first session's recording
  is refused when it creates at that date: the reload runs, nothing is
  written, and the message names the date. Asserted for a whole fresh
  recording and for one holding added inside a reopened one.
- A fifteen-row sweep at a new date issues exactly one extra type
  reload, before the first row is written, and none after it.
- Editing inside a reopened recording never shows the replace prompt,
  while the single-holding form at an occupied date still does.
- Asking for a new recording and picking a date that already holds
  records opens that recording's own screen, issues no request while
  doing so, and attempts no create.
- A sitting that only changes and clears existing records issues no
  type reload, and its writes are updates at stored `version` + 1.
- A recording offers no way to change its own date, and moving one
  snapshot's date from the holding's page still works.
- A Conflict on a snapshot inside a recording save reloads that row to
  the stored record, retries nothing, and leaves the stored record
  byte-identical.
