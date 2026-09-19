# Record rate

## What it does

The price timeline. One entry per (symbol, date), giving what one unit
of that symbol was worth in the vault's main currency on that date.

Quantities and prices are **two separate timelines**
(`record-snapshot.md`). The prices run as their own series, one per
symbol, shared by every holding measured in it.

**No screen of its own.** `record-snapshot.md` owns the action that
refreshes this timeline, `net-worth-view.md` reads it for the total and
the chart, `rate-lookup.md` supplies the proposals, and
`export-import.md` carries it. The product features that depend on it
are Record a value and the net worth view.

## Where it lives: inside the vault

`record_type: "rate"`, AES-256-GCM under the vault DEK like every other
record, plaintext `account_id` empty.

A price for a symbol on a date is public reference data, so storing it
as server-side plaintext looks free. It is not.

- **Which symbols a person holds is not public.** A durable table of
  (principal, symbol, date, rate) rows *is* that list, in every
  database dump, every backup, and every filesystem snapshot, for as
  long as any of them are kept. The record columns deliberately carry
  no name, value, date, or unit (architecture.md, Record storage API),
  and a plaintext rate table would hand over the unit and the date
  directly.
- **The accepted proxy leak does not cover it.** The proxy observes a
  query while answering it. A stored table is readable off the disk
  afterward, including from a backup of a vault whose owner has since
  been deleted. Same fact, different persistence, different actors.
- **Not every rate is reference data.** The person may overwrite any
  proposal, and for a free-text unit or a `lookup: false` symbol there
  is no proposal at all: what they believe their flat is worth per m²
  is a valuation of their own holding, as sensitive as the quantity
  beside it, and it has no business leaving the browser in the clear.
- **Export carries it either way.** Export is the product's only backup
  and its only migration path (architecture.md, Components), and the
  file must carry both timelines or a restore silently reprices the
  entire history. A server-side table would enter the export as
  plaintext, turning a file that "reveals nothing but record counts and
  types" (`export-import.md`) into a plaintext list of every symbol a
  person holds and every date they recorded. As a vault record it rides
  along with no format change.
- **Server-side deletability buys nothing.** The providers rejected on
  retention terms (`rate-lookup.md`) fail against the indefinite proxy
  cache as much as against the copy in user ciphertext, which moving
  this timeline to the server leaves exactly as it is.

**The symbol is inside the ciphertext, and there is no plaintext symbol
column.** A plaintext column would buy here what `account_id` buys for
a snapshot, a server-side cascade, and there is no cascade to run:
deleting an account never deletes a rate entry (another account may be
measured in the same symbol, and the chart's history stays truthful
either way), and a symbol is never deleted, only retired
(`rate-lookup.md`). It would cost the one fact this whole section is
keeping.

**There is no plaintext date column either**, for the reason snapshot
dates have none.

**`record_id` is a random UUIDv4.** Deriving it from the symbol and the
date would let the server compute the id for every symbol in its own
table and match, which reaches the same leak by another route. Same
rule and same reason as a snapshot's id (`record-snapshot.md`).

## Record shape

```json
{
  "symbol": "USD",
  "date": "2026-07-31",
  "rate": "0.9312",
  "rateTarget": "CHF",
  "rateSource": "proposed",
  "rateAsOf": "2026-07-31",
  "proposedRate": null
}
```

- `symbol` is the account unit this prices (`manage-accounts.md`):
  either a row of the operator's symbol table or the free text a person
  typed. It is the only key to the series, because an account's unit
  *is* its rate symbol and the two can never disagree.
- `date` is a calendar date, `YYYY-MM-DD`, no time and no timezone. It
  is the date the price applies to, which is the date the entry was
  recorded at, not the date the entry was written.
- `rate` converts one unit of `symbol` into `rateTarget`. Decimal
  string at scale 12, parsed and computed as `BigInt` exactly as every
  other quantity in the product (`record-snapshot.md`, Record shape).
  No IEEE-754 float touches it.
- `rateTarget` is the ISO 4217 code `rate` converts into: the main
  currency as of entry time. Written for the same reason the account's
  unit is written into its own record, so no historical figure becomes
  ambiguous if a changeable main currency ever arrives.
- `rateSource` is `proposed` (taken from the lookup proxy unedited),
  `edited` (proposed, then changed by the person), or `manual` (typed,
  with no proposal available).
- `rateAsOf` is the date the provider's figure actually applies to,
  which may lag `date` across a weekend, a holiday, or the provider's
  own publication lag (`rate-lookup.md`). `null` when `manual`. For
  `edited` it keeps the proposal's date, since that is the quote the
  person departed from.
- `proposedRate` is the figure the provider offered, kept when the
  person overrode it. Set exactly when `rateSource` is `edited`, `null`
  otherwise, and it records the **original** proposal, so editing an
  `edited` rate a second time leaves it alone. The provider's number
  did not change, only the person's did.

**One entry per (symbol, date), and one record per entry.** Not one
record per symbol holding its whole series, and not one record per date
holding every symbol. Either shape puts two independent facts in one
blob, so two clients writing different symbols on the same date, or the
same symbol on different dates, would have to merge, and nothing in
this system merges (`record-api.md`). A per-symbol series would also
rewrite a decade of prices on every append and grow toward the
per-blob cap.

## The refresh

**Recording anything at all refreshes the price of every holding that
needs one.** Record a single franc account and the dollar rate and the
gold price still get entries.

**Prices are written by default and quantities are not**: a quantity
must be looked up on a statement, so the app never writes one nobody
gathered, while nobody gathers a price, so the person sees a proposal
and doing nothing accepts and writes it.

- **The recording date is the date of the entry being written**, the
  sweep's date or the single-holding form's date, and not today. A
  March figure entered in September writes its quantity at March and
  refreshes prices **at March**, so the chart's March is priced with
  March's prices. A backfill therefore inserts price knots into the
  past, and the chart's entry marks already say that stretch was drawn
  rather than recorded.
- **Which symbols.** The distinct `unit` of every **active** account,
  minus any unit equal to the profile's `mainCurrency`, whose rate is
  `"1"` by definition and is stored nowhere and requested from nobody.
  An archived account's symbol is not refreshed, except in the archive
  flow's own closing snapshot (`manage-accounts.md`), which is a
  recording action taken while the account is still active.
- **At most one refresh per recording date.** The entries for a date
  are ensured once for the whole sitting, not once per row, so a
  fifteen-row sweep writes one set of prices and issues one rate
  request (`rate-lookup.md`).
- **Recording a quantity refreshes. Reopening a recording does not.**
  The refresh is an ensure over the recording date: it writes where the
  date has no entry for a symbol and leaves every entry that is there
  alone, so running it twice at one date is a no-op the second time.
  Adding a value for a holding skipped at a past date is recording a
  quantity, so it ensures that date's prices and can fill a symbol that
  had none. Changing a figure, changing a rate, or clearing one is not
  recording a quantity and ensures nothing.
- **A rate request is issued only when a symbol the date needs has no
  entry at it.** A date whose prices are complete asks the proxy
  nothing, which is why opening an old recording is silent
  (`record-snapshot.md`, Reopening and editing a recording). Somebody
  who wants a missing line filled without recording any quantity asks
  for it on that line, and that action, not the act of opening, is what
  issues the request.
- Per symbol, at that date:
  - **A proposal came back** and the person left it alone, or changed
    it, and either way it is written.
  - **No proposal came back** (provider down, circuit breaker open, No
    Content for that date) and the symbol has a previous entry, so
    **nothing is written**. The previous entry stays the symbol's
    latest. Degraded, not wrong.
  - **No rate source at all** (free text, or a `lookup: false` symbol)
    and a previous entry exists, so **nothing is written unless the
    person edits it**. The previous entry stays the latest, at its own
    date, and the age of the person's estimate stays visible on screen
    ("estimated 14 months ago", `ui/update-values.md`). Re-dating an
    unreviewed estimate to the recording date would launder a guess
    into a fresh figure, which is the quantity rule applied to the one
    number the person is the sole source of.
  - **No entry exists yet and no proposal is available**, so the
    recording row asks for the price and the holding stays unpriced
    until one exists (`net-worth-view.md`). The row asks. It does not
    require. The quantity saves with the line left empty
    (`record-snapshot.md`, Edge cases).
- **An edited rate never leaves the browser except as ciphertext.** It
  is not part of, and does not trigger, any request to `/api/rates`, in
  any field, in any encoding. Same rule and same reason as the
  base-amount rule for quantities (architecture.md).

## The write path

**The quantity goes first, then the prices.** They are separate
requests because no transaction spans two records (`record-api.md`),
and the order is the whole of the guarantee.

1. `PUT` the quantity record. Its result is the result of the row: the
   person's figure is saved, or it is not, and the row says which.
2. On success, `PUT` the recording date's price entries, one request
   each, starting with the symbol of the row just written.

- **A price write cannot fail a quantity write.** It is issued after,
  on its own request, in its own transaction, and nothing about its
  outcome changes the row's saved state.
- **A price write failure is never silent.** The row reads as recorded
  with the price not updated. When the person edited that price, the
  message names the symbol, because they typed that number and are
  entitled to know it did not land.
- **The order is not interchangeable.** Prices first with the quantity
  then failing is the bad case: the total moves, because every holding
  in those symbols reprices, while the number the person went and
  looked up is gone. The expensive half goes first.
- **A price the person edited without recording any quantity is written
  on its own.** Editing a price is an act in its own right, so it does
  not wait for a quantity that is never coming, and it writes only that
  symbol's entry rather than triggering the refresh.

Against the optimistic-concurrency rule in `record-api.md`:

- A price entry is an ordinary versioned record. The refresh only ever
  **creates**, at `version: 1`, because it writes exactly where the
  date has no entry. Somebody editing a stored entry **updates** it, at
  stored `version` + 1.
- **A Conflict is surfaced, never retried.** It reaches an update
  alone, since a create carries a fresh UUIDv4 no row can already hold,
  and it means another session changed that entry. The line reloads to
  what is stored and the message names the symbol. Writing the person's
  figure over it at the reloaded version would clobber a number
  somebody else typed, and nothing in this system merges
  (`record-api.md`).
- **A slot another session took is refused before the write, not by a
  Conflict.** One entry per (symbol, date) is a client rule the server
  cannot enforce, so it is enforced by the pre-create reload in
  `record-snapshot.md`, Creating and reopening are distinct acts, which
  covers the rate type as well as the snapshot type.
- Content Too Large is surfaced like any other write failure. The
  refresh spends vault quota nobody asked to spend, which is what the
  headroom on the caps is for (architecture.md, Blob and quota limits).

### Saving an edited recording

One save of a reopened recording (`record-snapshot.md`) may touch
several records: snapshots updated, snapshots created, rates updated or
created, and records deleted. Each is its own request under its own
version check, and nothing spans two of them. The order is fixed:

0. If the save creates anything, the pre-create reload. Any slot taken
   refuses the whole save before a single write.
1. Quantity writes, creates and updates alike.
2. Rate writes.
3. Deletions, quantities first and rates after.

A phase's requests may be issued together, and the next phase begins
when every request in the previous one has answered.

- **Quantities before prices**, for the reason a fresh recording has
  (The write path).
- **A rate the person typed does not wait on a quantity.** The gate
  holding the refresh behind a successful quantity write exists because
  the refresh writes figures nobody asked for. An entry the person
  typed is their own act, and it is written whether or not the quantity
  beside it landed. A refreshed entry is still gated, exactly as above.
- **Deletions run last**, after every write in the save has been
  attempted, so a save that fails partway has destroyed nothing and the
  person still holds everything the screen offered to remove.
- **No step is skipped because an earlier one failed.** Each record is
  independent, and abandoning the rest would turn one failed write into
  several unattempted ones.

**An edit is half-applied more visibly than a first recording is.** Its
figures are already in the chart, so a save that lands four changes of
six moves the total to a number nobody asked for. That is reported,
never hidden and never rolled back:

- The screen **stays open**, and every change keeps its own state:
  saved, or not saved with what the person typed still in front of
  them.
- The message **names both halves**: how many changes were saved, and
  which ones were not, by holding name and by symbol. A count alone
  leaves the person's vault in a state they cannot see.
- Retrying reissues **only what failed**, at whatever version each
  record now holds.
- The in-memory model advances **per write, as each one succeeds**, so
  the total and the chart on screen are always what the vault holds and
  never what the save intended.
- **Nothing in the vault records that a save was partial.** No pending
  flag and no dirty marker: it would be another thing to keep
  consistent, it would outlive the tab that could resolve it, and the
  unsaved half exists only in the open screen. Closing with changes
  unsaved says so and names them.

## Two entries on one date

One entry per (symbol, date) is enforced the way one snapshot per
(account, date) is: a create is refused when a fresh reload finds the
slot taken, and a save whose reload finds the date taken is refused
whole (`record-snapshot.md`, Creating and reopening are distinct acts).
The server can enforce neither, because there is no plaintext symbol
and no plaintext date to enforce it on.

One path is left. Two sittings whose first creates cross inside that
reload window each mint a fresh UUIDv4 at `version: 1`, so neither
loses a version check and two entries for one (symbol, date) exist.

- **Two entries whose decrypted payloads are byte-identical in every
  field** are pure duplication, and the client deletes one, because
  nothing can be lost. This is the likely pair by far: two sittings
  recording one date both write the provider's figure for that day.
- **Anything else is surfaced, never resolved.** Both are rendered in
  the recording for that date, flagged, with an action to keep one, and
  the pair drops out of the symbol's series until then, its neighbors
  interpolating across the date (`net-worth-view.md`). Same treatment
  as two quantities on one date, for the same reason: with the race
  refused at the door, a pair that still lands is an anomaly, and there
  is one way to show an anomaly at a date.

**There is no provenance ranking and no automatic winner.** A rule
picking `edited` over `proposed` and falling through to a version or an
id would pick silently between two figures the person typed, which is
what the quantity rule exists to refuse. It could not even be stable:
import resets every record to `version: 1` (`export-import.md`), so a
ranking consulting the version would read one entry before an export
and the other after, drawing a different chart from the same vault.

## Reading

The client holds `symbol -> entries sorted by date` in the same
in-memory model as everything else (`net-worth-view.md`, Data flow).
Three definitions, used everywhere:

- **The latest price** for a symbol is the entry with the greatest
  `date`, never the most recently written.
- **The price as recorded** for an account is the entry with the
  greatest `date` at or before the date of that account's latest
  quantity entry. This is what the holding was priced at when its
  quantity was last recorded.
- **A unit equal to `mainCurrency`** prices at exactly `"1"`, from no
  entry. It is not an unpriced holding.

A symbol with quantities and no entry at all leaves those accounts
**unpriced**, which `net-worth-view.md` owns.

## Editing a captured rate

A stored price is history. It is editable like any other record, as an
ordinary versioned write, **inside the recording for its date**
(`record-snapshot.md`, Reopening and editing a recording): one date,
one line per symbol, beside the quantities that date prices.

**There is no price-editing screen.** Not a per-symbol timeline, and no
editable rate on a holding's row or a holding's page. A price is one
fact about one symbol on one day, and the date is the only place where
that fact has exactly one field. A screen listing holdings shows one
symbol's price on as many rows as hold it, where two rows could be
typed with two different figures for one day and one of them would have
to win silently.

- `rate`, `rateSource`, and `rateAsOf` open on the stored values, never
  on a fresh proposal, and opening a recording fetches no proposal at
  all (The refresh). Reading an old figure must not restamp it, and a
  provider that has since revised its published figure for that day
  must not reach a stored entry by way of somebody looking at it.
- **Editing the rate by hand** moves `rateSource` from `proposed` to
  `edited` and captures the replaced figure as `proposedRate`. It
  leaves both alone otherwise: `edited` already holds the original
  proposal, and `manual` has no proposal to have departed from.
  `rateAsOf` is unchanged, since it still names the quote that was
  departed from.
- **Editing one entry changes every holding measured in that symbol on
  that date.** That is what one price for one symbol on one day means,
  and the confirmation says so, naming how many holdings are affected.
  The client can count them: it holds every account record. A save
  changing several rates confirms once, naming each symbol and its
  count, rather than queueing a dialog per line.
- **Deleting an entry** is allowed, by clearing its line
  (`record-snapshot.md`, Clearing a figure), and every entry at a date
  goes together when the recording itself is deleted. The symbol then
  prices from the neighboring entries, which for the newest entry
  means the total falls back to the one before it. The confirmation
  says that figures around that date will change, and, when the entry
  is the symbol's only one, that every holding measured in it becomes
  unpriced and leaves the total (`net-worth-view.md`).

## Inputs / outputs

- In: symbol, recording date, a proposal from `rate-lookup.md` where
  one exists, and whatever the person left or typed in its place.
- Out: encrypted `rate` records via `PUT /api/records/<uuid>`. The
  total and the chart reflect them immediately from local state, with
  no refetch.

## Edge cases

- **The person records twice on the same date.** The second recording
  finds entries already there for that date and writes none. The
  prices for a date are ensured, not appended.
- **The person edits a price and then records again on the same date.**
  Nothing overwrites the edit: the refresh writes only where the date
  has no entry for that symbol.
- **A recording is reopened and only a quantity is changed.** No rate
  record is written, no `version` moves, and no request reaches the
  proxy. The date keeps the prices it was recorded at.
- **A date whose only records are rates**, because every quantity at
  it was cleared or none was ever entered, is still a recording and
  still reopens. Nothing tidies it away, the entries keep pricing the
  dates around them, and the only thing that removes them is deleting
  the recording (`record-snapshot.md`, Deleting a recording).
- **A symbol the recording date never priced**, because the provider
  was down that day or the account did not exist yet. The line is empty
  and says so. Recording a quantity at that date fills it, and somebody
  who only wants the line filled asks for the lookup on the line
  itself.
- **A symbol whose only holdings are archived** is not refreshed, and
  its existing entries stay. Historical points still price correctly.
- **An account is created in a symbol nobody holds yet.** Its first
  recording is what creates the symbol's first entry. Between the
  account existing and that recording, the account has no quantity
  either, so it is "not yet valued" rather than unpriced.
- **A free-text unit whose price the person has never entered** leaves
  the holding unpriced until they do. The recording row asks for the
  number and says why it is theirs to set, and the quantity saves
  whether or not one is given: a missing price never blocks a quantity
  (`record-snapshot.md`, Edge cases, which owns that rule).
- **The provider revises a figure it already published.** Nothing
  rewrites a stored entry. The revision reaches the vault only if the
  person records at that date again, which finds an entry and writes
  nothing, or edits the entry by hand.
- **Two symbols for the same metal** (`XAU-g` and `XAU-ozt`) are two
  series. They are priced independently and never derived from one
  another client-side, because the conversion belongs to the proxy
  where it is exact and tested (`rate-lookup.md`).
- **Decryption fails for a rate record** → it is skipped and counted in
  the same warning as any other unreadable record
  (`net-worth-view.md`). The holdings it priced fall back to the next
  entry down the series rather than disappearing.

## Acceptance criteria

- Recording a quantity for one holding writes a `rate` record for every
  distinct active unit that is not the main currency, at the recording
  date, and none for the main currency.
- Recording for a holding measured in the main currency still writes
  those price entries. The franc account is the case the whole split
  exists for.
- A `rate` record's plaintext columns carry no symbol, date, or account
  link: `account_id` is `null` on the wire and empty in the AAD, and
  the only other plaintext is the type, the ids, and the versions.
- A vault with two accounts measured in `USD` holds one `rate` record
  per date, not two.
- Recording at a past date writes price entries at that past date, and
  the latest entry for each symbol is unchanged when a later one
  already exists.
- A fifteen-row sweep at one date issues exactly one request to
  `/api/rates` and writes one set of price entries.
- With the quantity `PUT` stubbed to fail, no price entry is written
  and the total is unchanged.
- With every price `PUT` stubbed to fail, the quantity record exists,
  reads back exactly, and the screen reports that prices were not
  updated. Nothing about the row is rolled back.
- With a rate update stubbed to Conflict, nothing is retried, the line
  reloads to the stored entry, and the message names the symbol.
- A save whose pre-create reload finds the date recorded elsewhere
  writes nothing at all, rates included, and reports the date rather
  than updating any entry.
- No request to `/api/rates` contains an edited rate, a quantity, or
  any account identifier, asserted over the full request including
  headers.
- Two entries planted for one (symbol, date) with different `rate`
  strings are both flagged, neither is read, and the symbol prices that
  date from its neighboring entries. Identically on two clients given
  the records in either order, and identically before and after an
  export and import round trip.
- Two entries for one (symbol, date) whose decrypted payloads are
  byte-identical in every field leave exactly one record afterwards.
- A symbol with no rate source and an existing entry writes no new
  entry on a recording, and the holding's price age on screen grows.
  Asserted for free text and for a `lookup: false` symbol, since the
  second one looks listed.
- With the proxy stubbed to No Content, a recording writes no price
  entry for that symbol and the previous entry stays the latest.
- Editing a price entry from a second tab with a stale `version`
  returns Conflict and overwrites nothing.
- Opening a recording of any age issues no request to `/api/rates` and
  writes no record, asserted over the whole flow including the request
  the provider has since revised its figure for.
- Adding a value for a holding skipped at a past date leaves every rate
  entry at that date byte-identical, and writes an entry only for a
  symbol that had none.
- A save changing one quantity and two rates issues the quantity `PUT`
  before either rate `PUT`, and any `DELETE` in the same save after all
  three.
- With the second rate `PUT` stubbed to fail, the quantity and the
  first rate are stored, nothing is rolled back, the deletions in the
  same save still run, and the message names the symbol that did not
  land.
- Editing a `proposed` entry's rate stores `edited`, keeps `rateAsOf`,
  and stores the replaced figure as `proposedRate`. Editing an `edited`
  one a second time leaves `proposedRate` at the original proposal.
- Editing one entry changes the converted figure of every holding
  measured in that symbol at that date, and the confirmation names how
  many holdings that is.
- `rate` survives a round-trip as an exact decimal string, and a rate
  with more than twelve decimal places is rejected at input rather than
  truncated.
- Every stored entry carries a `rateTarget` equal to the main currency
  in the profile record at entry time.
