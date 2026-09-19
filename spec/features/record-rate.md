# Record rate

## What it does

The price timeline. One entry per (symbol, date), giving what one unit
of that symbol was worth in the vault's main currency on that date.

Quantities and prices are **two separate timelines**. A holding's own
history carries only the quantities the person recorded
(`record-snapshot.md`). The prices that turn those quantities into the
main currency run alongside as their own series, one per symbol, shared
by every holding measured in it.

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
  (principal, symbol, date, rate) rows *is* that list, on the server,
  in every database dump, every backup, and every filesystem snapshot,
  for as long as any of them are kept. The threat model defends the
  host operator's passive observation and the offline attacker with a
  dump by the zero-knowledge model, and the record columns deliberately
  carry no name, value, date, or unit (architecture.md, Record storage
  API). A plaintext rate table would hand over the unit and the date
  directly.
- **The accepted proxy leak is a different leak.** The proxy observes a
  query while answering it, so it is available to whoever is watching
  the process at that moment. A stored table is available to whoever
  reads the disk afterward, including from a backup of a vault whose
  owner has since been deleted. Same fact, different persistence,
  different set of actors. The accepted one does not cover the other.
- **Not every rate is reference data.** The person may overwrite any
  proposal, and for a free-text unit or a `lookup: false` symbol there
  is no proposal at all, so the number is entirely theirs: what they
  believe their flat is worth per m². That is a valuation of their own
  holding, as sensitive as the quantity beside it, and it has no
  business leaving the browser in the clear.
- **Export settles it on its own.** Export is the product's only backup
  and its only migration path (architecture.md, Components), and the
  file must carry both timelines or a restore silently reprices the
  entire history. A server-side table would have to be written into the
  export as plaintext, and a file that today "reveals nothing but record
  counts and types" (`export-import.md`) would become a plaintext list
  of every symbol a person holds and every date they recorded. As a
  vault record it rides along with no format change at all.
- **Server-side deletability is not the prize it looks like.** The
  providers rejected on retention terms (`rate-lookup.md`) fail against
  the indefinite proxy cache as much as against the copy in user
  ciphertext. Moving this timeline to the server leaves that cache
  exactly as it is, so it satisfies no licence term that is not already
  unsatisfiable.

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

This is the asymmetry that makes the split work, and it is deliberate.
**Prices are written by default and quantities are not**: a quantity
must be looked up on a statement, so the app never writes one nobody
gathered, while nobody gathers a price, so the person sees a proposal
and doing nothing accepts and writes it.

- **The recording date is the date of the entry being written**, the
  sweep's date or the single-holding form's date, and not today. A
  March figure entered in September writes its quantity at March and
  refreshes prices **at March**, so the chart's March is priced with
  March's prices. A backfill therefore inserts price knots
  into the past, which is more real data rather than less, and the
  chart's estimated marker already said that stretch was inferred.
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
    until one exists (`net-worth-view.md`).
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

- A price entry is an ordinary versioned record. Create at `version: 1`
  when the client's model holds no entry for that (symbol, date),
  update at stored `version` + 1 when it does.
- **A Conflict on a `proposed` write is dropped, not retried.** Conflict
  means another client already wrote an entry for that (symbol, date),
  and that entry is exactly as good as this one, because both are the
  same provider figure for the same day. Reload the type and adopt what
  is there.
- **A Conflict on an `edited` or `manual` write is retried once**
  against the reloaded version, because the person typed that number
  and it should land. A second Conflict is surfaced rather than
  retried again.
- Content Too Large is surfaced like any other write failure. The
  refresh spends vault quota nobody asked to spend, which is what the
  headroom on the caps is for (architecture.md, Blob and quota limits).

## Two entries on one date

Two clients recording the same date each generate a fresh UUIDv4, so
two entries for one (symbol, date) is a reachable state, as two
snapshots for one (account, date) is (`record-snapshot.md`).

**A duplicate price is resolved, and a duplicate quantity is not.** The
quantity rule exists because two figures the person gathered are two
assertions and no algorithm may choose between them. Nobody gathered a
price. Asking someone to adjudicate between two dollar rates they never
typed is asking them to answer for a race inside the app.

Resolution, computed from decrypted content alone so two devices reach
the same answer without talking to each other:

1. `manual` or `edited` outranks `proposed`. A price the person touched
   beats one written on their behalf.
2. Then the greater `version`.
3. Then the lexicographically smaller `record_id`.

The loser is left in place and simply never read. The one exception:
when both are `proposed` and their `rate` strings are byte-identical,
the client deletes one, because nothing can be lost and the pair is
pure duplication.

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

## Editing a past price

A stored price is history. It is editable like any other record, from
the holding's own page where the figure it priced is found
(`ui/account-detail.md`), and it is an ordinary versioned write.

- `rate`, `rateSource`, and `rateAsOf` open on the stored values, never
  on a fresh proposal. Opening the page to read a figure must not
  restamp anything.
- **Editing the rate by hand** moves `rateSource` from `proposed` to
  `edited` and captures the replaced figure as `proposedRate`. It
  leaves both alone otherwise: `edited` already holds the original
  proposal, and `manual` has no proposal to have departed from.
  `rateAsOf` is unchanged, since it still names the quote that was
  departed from.
- **Editing one entry changes every holding measured in that symbol on
  that date.** That is what one price for one symbol on one day means,
  and the confirmation says so, naming how many holdings are affected.
  The client can count them: it holds every account record.
- **Deleting an entry** is allowed. The symbol then prices from the
  neighboring entries, which for the newest entry means the total falls
  back to the one before it. The confirmation says that figures around
  that date will change.

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
- **A symbol whose only holdings are archived** is not refreshed, and
  its existing entries stay. Historical points still price correctly.
- **An account is created in a symbol nobody holds yet.** Its first
  recording is what creates the symbol's first entry. Between the
  account existing and that recording, the account has no quantity
  either, so it is "not yet valued" rather than unpriced.
- **A free-text unit whose price the person has never entered** leaves
  the holding unpriced until they do, and the recording row asks for
  the number rather than saving a quantity that cannot be valued.
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
- With one price `PUT` stubbed to Conflict and `rateSource: proposed`,
  no error is surfaced and the client ends holding the other write's
  entry.
- With the same stub and a price the person edited, the write is
  retried once against the reloaded version and succeeds. A second
  Conflict surfaces a message naming the symbol.
- No request to `/api/rates` contains an edited rate, a quantity, or
  any account identifier, asserted over the full request including
  headers.
- Two entries planted for one (symbol, date) with different provenance
  resolve to the `edited` one, and two `proposed` ones with different
  rates resolve to the smaller `record_id`, identically on two clients
  given the same records in different order.
- Two `proposed` entries for one (symbol, date) with byte-identical
  `rate` strings leave exactly one record afterwards.
- A symbol with no rate source and an existing entry writes no new
  entry on a recording, and the holding's price age on screen grows.
  Asserted for free text and for a `lookup: false` symbol, since the
  second one looks listed.
- With the proxy stubbed to No Content, a recording writes no price
  entry for that symbol and the previous entry stays the latest.
- Editing a price entry from a second tab with a stale `version`
  returns Conflict and overwrites nothing.
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
