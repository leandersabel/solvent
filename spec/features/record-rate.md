# Record rate

The price timeline: one entry per (symbol, date), what one unit of that
symbol was worth in the vault's main currency on that date. Prices run
as their own series, one per symbol, shared by every holding measured in
it (architecture.md, Data model).

It has no screen. Prices are proposed, edited and read on
`record-snapshot.md` (Update values, Recording detail, Snapshot entry)
and `manage-accounts.md` (Account detail). `rate-lookup.md` supplies the
proposals, `net-worth-view.md` reads the series, and `export-import.md`
carries it.

## How it works

### Where it lives: inside the vault

`record_type: "rate"`, AES-256-GCM under the DEK like every record, with
an empty `account_id`. A price is public reference data, so a plaintext
server table looks free. It is not:

- **Which symbols a person holds is not public.** A durable table of
  (principal, symbol, date, rate) rows is that list, in every dump,
  backup and snapshot for as long as they are kept. The record columns
  carry no name, value, date or unit (architecture.md, Record storage
  API).
- **The accepted proxy leak does not cover it.** The proxy observes a
  query while answering it. A stored table is readable off the disk
  afterward, even from a backup of a deleted vault.
- **Not every rate is reference data.** Any proposal may be overwritten,
  and a free-text unit or a `lookup: false` symbol has none. What a
  person believes their flat is worth per m² is as sensitive as the
  quantity beside it.
- **Export carries it either way.** The file must carry both timelines
  or a restore reprices the whole history (architecture.md, Components).
  A server table would enter the export as plaintext, turning a file
  that reveals only record counts and types into a list of every symbol
  held and every date recorded. As a vault record it rides along with no
  format change.
- **Server-side deletability buys nothing.** The providers rejected on
  retention terms (`rate-lookup.md`) fail against the indefinite proxy
  cache as much as against user ciphertext, and moving this timeline
  leaves that cache as it is.

**There is no plaintext symbol column.** It would buy a server-side
cascade, and there is none to run: deleting a holding never deletes a
rate entry, because another holding may share the symbol and the
chart's history stays truthful. A symbol is only retired, never deleted
(`rate-lookup.md`). **There is no plaintext date column either**, for
the reason a snapshot has none.

**`record_id` is a random UUIDv4**, as a snapshot's is. One derived from
symbol and date would let the server compute every symbol's id from its
own table and match.

### Record shape

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

- `symbol` is the holding's unit (`manage-accounts.md`), a symbol table
  row or free text. It is the only key to the series, so unit and rate
  symbol can never disagree.
- `date` is `YYYY-MM-DD`, no time and no timezone: the date the price
  applies to, which is the recording's date, not the date of the write.
- `rate` converts one unit of `symbol` into `rateTarget`. A decimal
  string at scale 12, computed as `BigInt` (`record-snapshot.md`, Record
  shape), never an IEEE-754 float. More than twelve decimal places is
  rejected at input, never truncated.
- `rateTarget` is the ISO 4217 main currency at entry time, written so no
  historical figure turns ambiguous if a changeable main currency
  arrives.
- `rateSource` is `proposed` (the proxy's figure unedited), `edited`
  (proposed, then changed) or `manual` (typed, no proposal available).
- `rateAsOf` is the date the provider's figure applies to, which may lag
  `date` over a weekend, a holiday or a publication lag
  (`rate-lookup.md`). `null` when `manual`. An `edited` entry keeps the
  proposal's date, the quote departed from.
- `proposedRate` is set exactly when `rateSource` is `edited`, `null`
  otherwise, and holds the **original** proposal. A second edit leaves
  it alone, because the provider's number did not change.

**One record per (symbol, date).** Not one per symbol holding its
series, and not one per date holding every symbol. Either puts two
independent facts in one blob that two clients would have to merge, and
nothing in this system merges (`record-api.md`). A per-symbol series
would also rewrite a decade of prices on every append and grow toward
the per-blob cap.

### The refresh

**Recording anything refreshes the price of every holding that needs
one** (architecture.md, Data model). The person sees a proposal, and
doing nothing accepts and writes it.

- **The date is the date of the entry being written**: the sweep's, the
  single-holding form's, or the date a moved entry lands on. Never
  today. A March figure entered in September is priced with March's
  prices, and the backfilled price knots fall in a stretch the chart's
  entry marks already show as drawn.
- **Which symbols**: the distinct `unit` of every **active** holding,
  minus the profile's `mainCurrency`, whose rate is `"1"`, stored nowhere
  and requested from nobody. An archived holding's symbol is not
  refreshed. **Archiving is recording**: its zero is written while the
  holding is still active, so its unit is among them (`manage-accounts.md`,
  Archiving). **A moved entry's own unit always is**, so an archived
  holding's entry moved earlier (`manage-accounts.md`, While archived)
  is priced there.
- **One refresh per date per sitting**, not per row: a fifteen-row sweep
  writes one set of prices from one rate request (`rate-lookup.md`).
- **It is an ensure.** It writes only where the date has no entry for a
  symbol and leaves every entry alone, so a second run is a no-op.
- **Recording a quantity refreshes. Reopening does not.** Recording means
  a quantity arriving at a date it was not at: a new figure, a figure
  for a holding skipped at a past date, or an entry moved onto another
  date (`record-snapshot.md`, Editing an existing snapshot). Changing a
  figure or note in place, changing a rate, or clearing a figure ensures
  nothing.
- **A rate request is issued only for a symbol with no entry at the date
  and a rate source there** (Reading). So opening an old recording is
  silent (`record-snapshot.md`, Reopening and editing a recording).
  Look it up on a line fills and saves a missing price without a
  quantity, and that press, not opening, issues the request (Saving an
  edited recording).
- Per symbol, at that date:
  - **A proposal came back.** Left alone or changed, it is written.
  - **No proposal** (provider down, breaker open, No Content) and a
    previous entry exists. **Nothing is written** and the previous entry
    stays the latest. A figure at the date reads not priced (Reading)
    until an entry is written there.
  - **No rate source at the date** (free text, `lookup: false`, before
    the symbol's `since`, or a main currency no source quotes into) and a previous entry exists. **Nothing is
    written unless the person edits it.** The estimate's age stays on
    screen ("estimated 14 months ago", `record-snapshot.md`, Update
    values). Re-dating an unreviewed estimate would launder a guess into
    a fresh figure.
  - **No entry and no proposal.** The row asks for the price, says why it
    is the person's to set, and the holding stays unpriced
    (`net-worth-view.md`). It asks and does not require: the quantity
    saves with the line empty (`record-snapshot.md`, Edge cases).
- **An edited rate leaves the browser only as ciphertext.** It is in no
  request to `/api/rates` and triggers none (`rate-lookup.md`, Endpoint).

### The write path

**The quantity first, then the prices.** No transaction spans two
records (`record-api.md`), so the order is the whole guarantee.

1. `PUT` the quantity. Its result is the row's result.
2. On success, `PUT` the date's price entries, one request each,
   starting with the symbol of the row just written.

- **A price write cannot fail a quantity write.** It runs after, on its
  own request, and never changes the row's saved state.
- **A price write failure is never silent.** The row reads as recorded
  with the price not updated, and names the symbol when the person typed
  that price. A line whose write failed keeps what it showed, typed
  figure included, for the lines' own save to retry.
- **The order is not interchangeable.** Prices first and the quantity
  failing would reprice every holding in those symbols while losing the
  number the person went and looked up. The expensive half goes first.
- **A typed price is written only at a date that holds a recording.**
  - **At a date holding a record**, the rate-lines save writes it alone
    and triggers no refresh (Saving at a date that holds a recording).
    The refresh waits on a quantity because it writes figures nobody
    asked for, and a typed price is the person's own act.
  - **At a date holding none**, nothing is written until the first
    quantity is. Its success writes the refresh and every typed price,
    each in its proposal's place with the `rateSource` Record shape
    gives it. From then the date holds a recording and the rate-lines
    save is offered, however the sweep was entered. Leaving first writes
    nothing (`record-snapshot.md`, Update values, States).
  - **The sweep offers no rate-lines save at a date holding no record**,
    and the client's rate-lines write refuses there too, against the
    model in memory, before any request. Two checks, because a missing
    control is not a refusal. A typed price alone never creates a
    recording, so an empty recording is always one the person emptied.
  - **A rate-lines save that creates an entry runs the pre-create
    reload every time**, even at a date the sitting claimed
    (`record-snapshot.md`, Creating and reopening are distinct acts),
    because the model still holds the sitting's own records and cannot
    tell a date deleted elsewhere from a held one. A reloaded date with
    no snapshot and no rate refuses the whole save before any write, the
    model takes the reloaded records, and the typed prices stay on
    screen for the first quantity (`record-snapshot.md`, Update values,
    States).

Against the concurrency rule in `record-api.md`:

- A price entry is an ordinary versioned record. The refresh only
  **creates**, at `version: 1`. An edit **updates** at stored `version`
  + 1.
- **A Conflict is surfaced, never retried.** Only an update meets one,
  since a create carries a fresh UUIDv4, and a taken slot is refused
  before the write (Two entries on one date). The line reloads to what is
  stored and the message names the symbol, because writing at the
  reloaded version would clobber a number somebody else typed.
- Content Too Large is surfaced like any write failure. The refresh
  spends quota nobody asked to spend, which the caps' headroom is for
  (architecture.md, Storage & data handling).

#### Saving at a date that holds a recording

A date that holds a recording, reopened or reached by a sweep's first
row, is saved one control at a time (`record-snapshot.md`, Update
values). **No save spans a quantity, rates and deletions at once.**
Each record is its own request under its own version check.

- **A row's save** writes that holding's quantity alone: an update in
  place, which ensures no price, a create for a holding silent at the
  date, preceded by the pre-create reload when the sitting has not
  claimed the date and followed by the refresh, or a deletion when the
  figure is cleared.
- **Look it up** issues one rate request for the date. For every line
  with no entry, no typed text and a rate source there that the answer
  covers, it shows the proposal and creates its entry at `version: 1`,
  as `proposed`, with no confirmation, because a missing price filled in
  changes no price. Before the creates it reloads both types, which the
  model then holds. A date found holding no record writes nothing,
  since a price alone never makes a recording. A unit found priced
  there meanwhile is left as stored and named. A create that fails
  keeps the proposal on its line, unsaved and named, for the rate-lines
  save to retry. An answer arriving after the screen was left or the
  vault locked writes nothing.
- **The rate-lines save** writes every changed line. One confirmation
  names what each update or clear moves, and a save that only creates
  entries asks nothing. It needs no holding touched and
  runs only at a date holding a record. Its order is fixed:
  0. If any line creates an entry, the pre-create reload. A slot taken,
     or the date found empty, refuses the whole save before any write.
  1. Rate writes, creates and updates alike.
  2. Deletions, for the cleared lines.

  A phase's requests may go together, and the next phase starts once
  every one has answered. **Deletions run last**, so a save failing
  partway has destroyed nothing. **No step is skipped because an
  earlier one failed**, since that turns one failed write into several
  unattempted ones.

**A half-applied edit is reported, never hidden and never rolled back.**
Its figures are already in the chart, so landing four changes of six
moves the total to a number nobody asked for.

- The screen **stays open** and every change keeps its own state, saved
  or unsaved with what was typed.
- The message **names both halves by symbol**, because a count alone
  leaves the vault in a state nobody can see. A row reports on itself.
- Retrying reissues **only what failed**, at each record's current
  version.
- The model advances **per write, as each succeeds**, so the total and
  chart show what the vault holds, never what the save intended.
- **Nothing in the vault marks a save as partial.** No pending flag, no
  dirty marker: it would need keeping consistent, would outlive the tab
  that could resolve it, and the unsaved half exists only on screen.

### Two entries on one date

The pre-create reload refuses a create whose slot is taken, and a save
whose date is taken whole (`record-snapshot.md`, Creating and reopening
are distinct acts). The server can enforce neither,
having no plaintext symbol or date. One path is left: two sittings whose
first creates cross inside the reload window each mint a fresh UUIDv4 at
`version: 1`, and two entries for one (symbol, date) exist.

- **Byte-identical decrypted payloads** are pure duplication, and the
  client deletes one, since nothing can be lost. This is by far the
  likely pair: two sittings both writing the provider's figure.
- **Anything else is surfaced, never resolved.** Both show in that
  date's recording, flagged, with an action to keep one, and the pair
  drops out of the series until then, its neighbors interpolating
  across the date (`net-worth-view.md`). Two quantities on one date are
  treated the same, because a pair that lands past the reload is an
  anomaly and there is one way to show an anomaly at a date.

**There is no provenance ranking and no automatic winner.** Picking
`edited` over `proposed` and falling through to a version or id would
choose silently between two figures the person typed. It could not even
be stable: import resets every record to `version: 1`
(`export-import.md`), so it would pick one entry before an export and
the other after.

### Reading

The client holds `symbol -> entries sorted by date` in the in-memory
model (`net-worth-view.md`, Data flow). No screen picks a price any
other way than these:

- **The latest price** is the entry with the greatest `date`, never the
  most recently written.
- **A symbol has a rate source at a date** when its symbol table row has
  `lookup: true` and the date is on or after the later of its `since`
  and the main currency's row's `since` (`rate-lookup.md`, The symbol
  table). Free text, a `lookup: false` symbol and any symbol before that
  date have none. A main currency is a `kind: currency` row with a
  `since` whatever its `lookup` (`register.md`). One whose row carries
  `since: null` has no source quoting into it, so no symbol in that
  vault has a rate source at any date. The client computes
  this from its table with no request. This one test decides the price
  at a date, whether a recording asks the proxy (The refresh), and
  whether a line offers Look it up.
  - A main currency retired since registration is absent from the
    client's table and bounds nothing there. The server still applies
    its floor, so before 1999-01-04, or 2000-01-13 for the currencies
    starting then, that vault's lines read as a source that did not
    answer. Accepted, because retiring a currency vaults total in is an
    administrator's act, told what it means (`rate-lookup.md`,
    Maintaining the table).
- **The price at a date** values a figure shown at its own date: a
  recording's figures (`record-snapshot.md`, Recording detail), a
  holding's list of values (`manage-accounts.md`, Account detail), and
  the converted figure on the sweep and single-holding form wherever the
  unit's line for that date is empty.
  - **With a rate source**, the entry at exactly that date, or **not
    priced**. A published price exists and was not captured, so an
    earlier entry would show a 2026 dollar figure at a 2010 rate with
    nothing to say so.
  - **Without one**, the entry with the greatest `date` at or before it,
    because the owner's estimate stands until changed. When that entry
    is older than the figure, **the figure carries the entry's date**,
    so the estimate's age is never hidden. None at or before it, not
    priced. Before a symbol's `since` its entries are estimates too: a
    2012 gold figure takes the last gold price at or before it, with
    that price's date.
  - A flagged pair (Two entries on one date) is no entry at its date.
- **The price as recorded** for a holding is the entry with the greatest
  `date` at or before its latest quantity's date, whatever the symbol.
  It values the dashboard's rates as of each figure, where a not priced
  holding would leave the total (`net-worth-view.md`, Current net worth,
  which owns that figure's date).
- **A unit equal to `mainCurrency`** prices at exactly `"1"`, from no
  entry and with no date. It is never unpriced.

A symbol with quantities and no entry at all leaves its holdings
**unpriced**, which `net-worth-view.md` owns.

### Editing a captured rate

A stored price is edited as an ordinary versioned write **inside the
recording for its date** (`record-snapshot.md`, Reopening and editing a
recording): one line per symbol, beside the quantities it prices.

**There is no price-editing screen**: no per-symbol timeline, and no
editable rate on a holding's row or page. A price is one fact about one
symbol on one day, and the date is the only place that fact has exactly
one field. A list of holdings shows one price on as many rows as hold
the symbol, where two could be typed differently and one would win
silently.

- `rate`, `rateSource` and `rateAsOf` open on the stored values, and
  opening fetches no proposal (The refresh). Reading an old figure must
  not restamp it, and a provider's later revision must not reach a
  stored entry by somebody looking at it.
- **Editing the rate by hand** moves `proposed` to `edited` and stores
  the replaced figure as `proposedRate`. It changes neither on an
  `edited` entry, which holds the original proposal, or a `manual` one,
  which has none. `rateAsOf` is unchanged. How an untouched line is told
  from an edited one is `account-settings.md`'s (Dates and numbers).
- **Editing one entry changes every holding in that symbol on that
  date**, which is what one price per symbol per day means. The
  confirmation says so with the count of holdings (`record-snapshot.md`,
  Update values, says which count), which the client knows from the
  records it holds. Several changed rates confirm once, naming each
  symbol and its count.
- **Deleting an entry** is clearing its line (`record-snapshot.md`,
  Clearing a figure), and deleting the recording removes every entry at
  its date. The symbol then prices from its neighbors, so deleting the
  newest falls back to the one before. The confirmation says figures
  around the date will change and, for a symbol's only entry, that every
  holding in it becomes unpriced and leaves the total
  (`net-worth-view.md`).

### Inputs / outputs

- In: symbol, recording date, a proposal from `rate-lookup.md` where one
  exists, and whatever the person left or typed.
- Out: encrypted `rate` records via `PUT /api/records/<uuid>`. The total
  and chart reflect them at once from local state, with no refetch.

## Edge cases

- **Recording twice on one date**, an edit then another recording there,
  or a reopened recording where only a quantity changed: the ensure
  writes no rate and moves no `version`.
- **A date whose only records are rates**, because every quantity at it
  was cleared, deleted or moved away, is still a recording and reopens.
  Nothing tidies it away, its entries keep pricing the dates around it,
  and only deleting the recording removes them (`record-snapshot.md`,
  Deleting a recording).
- **A date the provider never priced**, being down or the holding not
  existing yet: the line is empty and says so. Recording a quantity
  there fills it, and so does Look it up.
- **A date before a symbol's `since`**, gold in 2012, behaves as a
  free-text unit's line: it starts from the newest earlier entry, writes
  only when changed, as `manual`, offers no Look it up, and never
  carries a failed source's wording (`record-snapshot.md`, Update
  values).
- **A symbol whose only holdings are archived** keeps its entries, so
  history still prices.
- **A holding in a symbol nobody holds yet** gets the symbol's first
  entry from its first recording. Until then it has no quantity either,
  so it reads "not yet valued", not unpriced.
- **A provider revises a published figure.** Nothing rewrites a stored
  entry. Only a hand edit brings the revision in.
- **A symbol's `lookup` flag changes**: the flag is read as it stands
  (`rate-lookup.md`). Once `true`, a past figure between two hand-set
  entries reads not priced until its date has an entry, which Look it
  up fills. No stored entry changes.
- **Two symbols for one metal** (`XAU-g`, `XAU-ozt`) are two series,
  never derived client-side from each other, because the conversion is
  the proxy's, where it is exact and tested (`rate-lookup.md`).
- **A rate record fails to decrypt.** It is skipped and counted in the
  unreadable-records warning (`net-worth-view.md`), and its holdings
  price from the next entry down the series.

## Acceptance criteria

1. Recording a quantity for one holding writes a `rate` record for every
   distinct active unit that is not the main currency, at the recording
   date, and none for the main currency. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`,
   `tests/browser/parts/update-values.mjs`.
2. (blind) Recording only a holding measured in the main currency still
   writes those price entries. The franc holding is the case the split
   exists for, and the one a naive refresh skips. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`,
   `tests/browser/parts/update-values.mjs`.
3. A `rate` record's plaintext columns carry no symbol, date or
   `account_id`: `accountId` is `null` on the wire and empty in the AAD,
   and the only other plaintext is the type, the ids and the versions.
   Test: `tests/test_client.py::test_the_client_side_rules_hold`.
4. A vault with two holdings measured in `USD` holds one `rate` record
   per date, not two. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
5. Recording at a past date writes price entries at that past date, and
   each symbol's latest entry is unchanged when a later one exists.
   Test: `tests/test_client.py::test_the_client_side_rules_hold`,
   `tests/browser/parts/update-values.mjs`.
6. (blind) A fifteen-row sweep at one date issues exactly one request to
   `/api/rates` and writes one set of price entries, asserted on the
   request count, not only on the entries. Test:
   `tests/browser/parts/update-values.mjs`.
7. With the quantity `PUT` stubbed to fail, no price entry is written
   and the total is unchanged. Test:
   `tests/browser/parts/update-values.mjs`.
8. With every price `PUT` stubbed to fail, the quantity record exists,
   reads back exactly, and the screen says the prices were not updated.
   Nothing about the row is rolled back, and a price typed on the sweep
   stays in its line. Test:
   `tests/browser/parts/update-values.mjs`.
9. With a rate update stubbed to Conflict, nothing is retried, the line
   reloads to the stored entry, and the message names the symbol. Test:
   `tests/browser/parts/update-values.mjs`,
   `tests/test_client.py::test_the_client_side_rules_hold`.
10. A save whose pre-create reload finds the date recorded elsewhere
    writes nothing at all, rates included, and reports the date rather
    than updating any entry. Test:
    `tests/browser/parts/update-values.mjs`.
11. (blind) No request to `/api/rates` contains an edited rate, a
    quantity or any holding identifier, asserted over the full request
    as sent, query string and headers included. Test:
    `tests/browser/parts/update-values.mjs`.
12. (blind) Two entries planted for one (symbol, date) with different
    `rate` strings are both flagged, neither is read, and the symbol
    prices that date from its neighbors, identically on two clients
    given the records in either order and before and after an export
    and import round trip. Test: `tests/browser/parts/dashboard.mjs`.
13. Two entries for one (symbol, date) whose decrypted payloads are
    byte-identical in every field leave exactly one record. Test:
    `tests/browser/parts/dashboard.mjs`.
14. (blind) A symbol with no rate source and an existing entry gets no
    new entry from a recording, and the holding's price age on screen
    grows. Asserted separately for free text, for a `lookup: false`
    symbol, since it looks listed, and for `XAU-g` at 2012-12-31, since
    it has a source on later dates. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/update-values.mjs`.
15. With the proxy stubbed to No Content, a recording writes no price
    entry for that symbol and the previous entry stays the latest. Test:
    `tests/browser/parts/update-values.mjs`.
16. Editing a price entry from a second tab with a stale `version`
    returns Conflict and overwrites nothing. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
17. (blind) Opening a recording of any age, including one with an empty
    rate line, issues no request to `/api/rates` and no `PUT` or
    `DELETE`, over a date whose provider figure has since been revised.
    Test: `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/recording-detail.mjs`.
18. (blind) On a reopened recording, Look it up is offered on a line
    with no entry at the date whose symbol has a rate source there, and
    on no other line: not on a line holding an entry, not on free text,
    not on a `lookup: false` symbol, not on `XAU-g` at 2012-12-31.
    Opening asks nothing. Pressing it issues exactly one request to
    `/api/rates`, for that date, then creates one `proposed` entry
    carrying its `rateAsOf` for each line with no entry, no typed text
    and a rate source that the answer covers, and writes nothing else.
    Test: `tests/browser/parts/update-values.mjs`.
19. Adding a value for a holding skipped at a past date leaves every rate
    entry at that date byte-identical, and writes an entry only for a
    symbol that had none. Test: `tests/browser/parts/update-values.mjs`.
20. (blind) With `USD` entries at 2010-03-31 only, the price at a date
    for `USD` at 2026-04-10 is none, never the earlier entry, and a
    `USD` figure at that date reads not priced on its recording and in
    its holding's list of values. With an entry added at 2026-04-10, it
    is that entry's `rate`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/recording-detail.mjs`.
21. (blind) With a free-text unit's only entry at 2024-01-15, the price
    at a date at 2026-04-10 is that entry and carries 2024-01-15, at
    2024-01-15 it carries no date, and at 2024-01-14 it is none. The
    same for a `lookup: false` symbol. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/recording-detail.mjs`.
22. (blind) With `XAU-g` entries at 2011-06-30, typed, and 2013-01-02
    only, the price at a date for `XAU-g` at 2012-12-31 is the
    2011-06-30 entry carrying 2011-06-30, at 2011-06-29 it is none, and
    at 2013-01-03 it is none. An `XAU-g` figure at 2012-12-31 reads at
    that price, with that date, on its recording and in its holding's
    list of values. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
23. (blind) With the main currency `BRL`, `USD` has a rate source at
    2000-01-13 and none at 2000-01-12, and a `USD` figure at 2000-01-12
    takes the newest `USD` entry at or before it. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
24. (blind) A sweep at 2012-12-31 whose only unit without an entry there
    is `XAU-g` issues no request to `/api/rates`. Its `XAU-g` line shows
    the newest entry before that date, never the wording of a source
    that did not answer, and recording a row writes no `XAU-g` entry
    unless the line was changed, in which case it writes one as
    `manual`. Asserted on request counts and record sets. Test:
    `tests/browser/parts/update-values.mjs`.
25. With no `XAU-g` entry at or before 2012-12-31, recording an `XAU-g`
    row on that sweep makes the line ask for a price, and the `snapshot`
    is written whether or not one is given. Test:
    `tests/browser/parts/update-values.mjs`.
26. The main currency prices at `"1"` at any date, carrying no date.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
27. A flagged pair at a date gives a symbol with a rate source no price
    at that date. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
28. The price as recorded for a `USD` holding whose latest quantity is
    at 2026-04-10, with `USD` entries at 2010-03-31 only, is the
    2010-03-31 entry. Test: no test.
29. (blind) On a sweep at a date holding no record, typing a price on a
    rate line shows no rate-lines save control. Typing it and leaving
    the sweep with no row recorded issue no `PUT` and no `DELETE`, and
    the screen landed on names that unit as left unsaved. Test:
    `tests/browser/parts/update-values.mjs`.
30. (blind) On that sweep, with `USD` proposed and a price typed on a
    free-text unit's line, recording the first row writes its
    `snapshot` first, then a `rate` entry for the free-text unit
    carrying the typed `rate` as `manual` and a `USD` entry as
    `proposed`, both at the sweep's date. The rate-lines save control
    shows from then on. Test: `tests/browser/parts/update-values.mjs`.
31. (blind) The client's rate-lines write, called directly at a date
    holding no record, issues no request and writes nothing. Hiding the
    control is not this check. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/update-values.mjs`.
32. (blind) With a sweep open on a recording and a second session then
    deleting every record at that date, a rate-lines save that creates a
    price issues its reload and no `PUT` or `DELETE`. Every typed price
    stays on its line, the rows read as nothing recorded, no rate-lines
    save control shows, the Callout saying another window deleted the
    recording shows under the date heading with the critical icon, and
    recording the first row then writes the typed price. Test:
    `tests/browser/parts/update-values.mjs`.
33. (blind) With a sweep open on a recording, a rate-lines save that
    created a price, and a second session then deleting every record at
    that date, a second rate-lines save that creates a price issues its
    reload and no `PUT` or `DELETE`, and the vault holds no record at
    that date. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
34. (blind) A rate-lines save changing two rates and clearing a third
    issues both rate `PUT`s before the `DELETE`, asserted on the wire.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
35. With the second rate `PUT` of that save stubbed to fail, the first
    rate is stored, nothing is rolled back, the deletion still runs, and
    the message names the symbol that did not land. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/update-values.mjs`.
36. (blind) After that half-failed save, no stored record carries a
    pending flag or dirty marker, asserted on the stored records rather
    than the message. Test: no test.
37. (blind) Editing a `proposed` entry's rate stores `edited`, keeps
    `rateAsOf`, and stores the replaced figure as `proposedRate`.
    Editing an `edited` one a second time leaves `proposedRate` at the
    original proposal, not the figure on screen. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/update-values.mjs`.
38. (blind) With locale `de-DE` and `groupSeparator` `apostrophe`, an
    `edited` entry whose `proposedRate` is `"1234.56789"` reads `Edited
    from 1’234,567890` on its rate line and in its recording's price
    column, and one whose `proposedRate` is `"0.12345678"` reads `Edited
    from 0,12345678`, never rounded to six places. A figure typed over a
    proposal of `"1234.56789"`, before any save, reads `Edited from
    1’234,567890` on its line, and so does a stored `proposed` entry at
    that rate once its line is changed. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/update-values.mjs`.
39. (blind) Editing one entry changes the converted figure of every
    holding measured in that symbol at that date, and the confirmation
    names how many holdings that is, leaving out a holding at zero that
    day and one archived before it. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
40. `rate` survives a round trip as an exact decimal string, and a rate
    with more than twelve decimal places is rejected at input rather
    than truncated. Test: `tests/browser/parts/update-values.mjs`.
41. Every stored entry carries a `rateTarget` equal to the main currency
    in the profile record at entry time. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/update-values.mjs`.
42. In a vault whose main currency's row carries `since: null`, no unit
    has a rate source at any date and a recording asks the proxy
    nothing. Test: `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/update-values-review-unquoted.mjs`.
