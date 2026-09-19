# Record snapshot

## What it does

Enter a point-in-time quantity for one account: a date and a value in
the account's native unit. That is the whole of a snapshot.

**A snapshot carries no rate.** Quantities and prices are two separate
timelines (architecture.md, Data model): a holding's own history holds
only the quantities the person recorded, and the prices that turn them
into the main currency live in their own series, one per symbol
(`record-rate.md`). A holding priced from its own last entry would join
today's total at the price of the day it was last touched, and with
partial updates as the normal case that is most holdings most of the
time.

**Recording a quantity refreshes every price**, which is the other half
of the same design and is specified in `record-rate.md`, The refresh.
This file owns only the quantity.

## Record shape

`record_type: "snapshot"`, plaintext `account_id` set to the owning
account. Decrypted payload:

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
    meaning for a rate or for 12.5 troy ounces; carrying a scale factor
    per quantity instead would be a decimal library, written here and
    worse.
  - **Multiplication rescales once**: the integer product of two
    scale-12 values is scale 24, divided back by 10¹² with
    **round-half-even**. Addition and subtraction need no rescale, which
    is why a sum of snapshots is exact by construction.
  - **Division** happens in two places only — the percentage view and
    per-account interpolation (`net-worth-view.md`) — and rounds
    half-even at scale 12 as well. Rounding for *display* is a separate,
    later step applied to a figure already exact at scale 12.
  - A decimal library was rejected on the same grounds as a charting
    library (`net-worth-view.md`): what it supplies is rescaling and a
    rounding mode — the helpers above — against one more file to
    self-host, pin, hash, and re-verify on every bump, inside a page
    that handles the password (architecture.md, Supply chain).
- `date` is a calendar date (`YYYY-MM-DD`), no time, no timezone — a
  snapshot is "what it was worth that day."
- `note` is free text, optional, `null` when unset.

Contribution to net worth = `value` times the price of the account's
unit, which `net-worth-view.md` selects from the price timeline.

## Flow

1. User picks an account and a date (defaults to today).
2. User enters the value. The client shows the converted main-currency
   figure live, using the price it already holds or the proposal for
   that date (`record-rate.md`).
3. Client encrypts and `PUT`s the record.
4. On success, the recording date's price entries are written
   (`record-rate.md`, The write path).

The value field is never sent anywhere before it is encrypted — in
particular, it must not be part of, or trigger, any rate request.

## Same account, same date: upsert

**One snapshot per (account, date).** Entering a value for a date that
already has one prompts "You already recorded 12 450.00 USD for 31 July.
Replace it?" — the previously recorded value, in the account's native
unit — and, on confirm, updates the existing record in place
(same `record_id`, `version` + 1, fresh nonce).

Duplicate detection is client-side — the client already decrypts every
snapshot for the account, and the server cannot see dates. Record ids
stay random UUIDv4; deriving them from the date would let the server
brute-force which dates a user holds data for.

## Confirming a previous value

A snapshot can be written by **confirming** an account's last recorded
quantity at a new date rather than typing it (`ui/update-values.md`). It
writes an ordinary snapshot: same `value`, new `date`, new `record_id`.
No new field and nothing for the record shape to learn.

**Confirming asserts the quantity, and only the quantity.** You still
own 12.5 troy ounces. What gold has done since is the price timeline's
business, and it is refreshed by the act of recording whether or not
anything was confirmed (`record-rate.md`). That is why confirming has no
cases: it is one click for a franc account, for a dollar account, for
gold, and for the flat, and it stays one click when the provider is
down, because nothing about it depends on a price resolving.

Confirming is unavailable for an account with no snapshots. There is
nothing to confirm.

## Editing an existing snapshot

Value, note, and **date** are all editable (`ui/account-detail.md` is
where a past snapshot is found). Editing is an ordinary versioned write,
except when the date moves onto a date the account already holds.

**No edit here touches a price.** Correcting a typo in a value, or
moving an entry from 30 July to 31 July, changes which price the holding
is valued at only because the price for a date is looked up by date. The
prices themselves are untouched, none is fetched, and there is no
proposal to accept or decline. Fixing a price is a separate act on a
separate record (`record-rate.md`, Editing a past price).

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

**Two snapshots on one date is therefore a reachable state, and must be
surfaced, never silently resolved.** A client that finds one takes no
guess at which is authoritative — not the highest `version`, not the
latest `updated_at`. It renders both in the account's history, flagged,
with an action to keep one; and it excludes that date from
interpolation until resolved, because there is no correct curve through
two values. Same family as a decryption failure: a visible fault beats a
quiet wrong number.

## Inputs / outputs

- In: account, date, value, optional note.
- Out: encrypted snapshot record via `PUT /api/records/<uuid>`, and the
  recording date's price entries behind it (`record-rate.md`). Net worth
  view and trend chart reflect both immediately from local state,
  without a refetch.

## Edge cases

- **Provider is down, rate-limited, or has no data for that symbol** →
  the quantity saves regardless. Recording is never blocked by the proxy
  being unavailable, and the price half degrades on its own terms
  (`record-rate.md`).
- **Account's unit has never been priced** → the quantity still saves,
  and the account is listed as not priced rather than counted wrong
  (`net-worth-view.md`).
- **Date is in the future** → blocked. A snapshot describes what was.
- **Date precedes the account's `createdAt`** → allowed; backfilling
  history is a normal use.
- **Editing a past snapshot** → allowed, versioned like any other write.
  The AAD's `monotonic_version` binds each ciphertext to the version it
  was written at, so the server cannot pass an old blob off as the
  current one. It does **not** prevent a rollback: re-serving the intact
  `(ciphertext, version)` pair from an earlier write is self-consistent
  and decrypts cleanly, because the client holds no record that a later
  version existed. Catching that needs the DEK-authenticated manifest
  deferred in architecture.md (Data integrity) — do not write a test
  asserting rollback is detected today.
- **Deleting a snapshot** → allowed, single confirm. Deleting the only
  snapshot for an account leaves the account with no current value; it
  is excluded from the total rather than counted as zero. No price entry
  is deleted with it: a price belongs to a symbol, not to the holding
  that happened to prompt it.
- **Value of zero** → valid and meaningful (a closed-out position). Not
  the same as having no snapshot.
- **Negative value** → valid. Mortgages and loans are accounts with
  negative balances; net worth is a signed sum.
- **Non-numeric or malformed value** → inline validation, no
  submission.
- **Snapshot recorded against an archived account** → blocked; archived
  accounts take no new snapshots. The one exception is the **closing
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
- Re-entering a date that already has a snapshot prompts to replace and,
  on confirm, results in **one** record for that (account, date) with
  `version` incremented and a different nonce.
- Declining the replace prompt leaves the original record untouched.
- A negative value and a zero value both round-trip and are included in
  the total; an account with no snapshots is excluded from the total.
- No request issued during the flow contains the entered value, in any
  field, in any encoding.
- With the rate proxy stubbed to 503, the snapshot still saves, and the
  screen reports that prices were not updated rather than blocking.
- A future-dated snapshot is rejected.
- Attempting to record against an archived account is blocked, except
  for the closing snapshot written by the archive flow itself.
- Editing a snapshot from a second tab with a stale `version` returns
  Conflict and does not overwrite.
- Editing a snapshot's value, note, or date issues no request to
  `/api/rates` and writes no `rate` record.
- Confirming writes a snapshot whose `value` equals the account's last
  recorded one at the new date, for an account in the main currency, one
  with a live rate source, and one with none, with no branch between the
  three.
- Confirming stays available and stays one click with the rate proxy
  stubbed to No Content.
- Confirming an account with no snapshots is not offered, and the
  equivalent request is rejected client-side.
- Moving a snapshot's date onto an occupied date prompts with copy
  naming the deletion, and on confirm leaves exactly one record for that
  date.
- The move issues the `PUT` before the `DELETE`: with the `DELETE`
  stubbed to fail, both records still exist afterwards and neither is
  lost.
- With two snapshots present for one (account, date), the history view
  shows both flagged, the client picks neither, and that date is
  excluded from the interpolated series until resolved.
- Deleting a snapshot deletes no `rate` record, asserted by count.
