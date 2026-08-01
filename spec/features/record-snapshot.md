# Record snapshot

## What it does

Enter a point-in-time value for one account: date, value in the
account's native unit, and the conversion rate to the user's main
currency. The rate is pre-filled from the lookup proxy where available,
always editable, and **stored on the snapshot permanently** — never
recomputed later, or the trend chart would rewrite the past every time
today's rate moves (architecture.md, Data model).

## Record shape

`record_type: "snapshot"`, plaintext `account_id` set to the owning
account. Decrypted payload:

```json
{
  "date": "2026-07-31",
  "value": "12450.00",
  "rate": "0.9312",
  "rateTarget": "CHF",
  "rateSource": "proposed",
  "rateAsOf": "2026-07-31",
  "note": null
}
```

- **`value` and `rate` are decimal strings, never JSON numbers.** All
  arithmetic uses a decimal type (client-side: a small decimal library
  or integer minor units — not IEEE-754 floats). Money must not drift.
- `date` is a calendar date (`YYYY-MM-DD`), no time, no timezone — a
  snapshot is "what it was worth that day."
- `rate` converts one unit of the account's native unit into the user's
  main currency. For an account already in the main currency it is
  exactly `"1"`.
- `rateTarget` is the ISO 4217 code `rate` converts *into* — the main
  currency as of entry time. Redundant while the main currency is
  immutable (account-settings.md), and written anyway: it is three
  characters per record, and without it every historical rate becomes
  ambiguous the moment a changeable main currency is introduced. Cheap
  now, a migration over undecipherable data later.
- `rateSource` is `proposed` (accepted from the lookup proxy unedited),
  `edited` (proposed then changed), or `manual` (typed, no proposal
  available). Recorded so the UI can show provenance and so a user can
  audit which figures were guessed.
- `rateAsOf` is the date the provider's rate actually applies to, which
  may lag `date` for a weekend or holiday. `null` when manual.

Contribution to net worth = `value × rate`, in the main currency.

## Flow

1. User picks an account and a date (defaults to today).
2. If the account's unit is a symbol in the operator's table, the client
   requests a proposal from the rate-lookup proxy for that unit and date
   (rate-lookup.md). The request carries **a fixed base unit, never the
   value being entered** (architecture.md, Base-amount rule).
3. User enters the value; the rate field is pre-filled and editable.
4. The client shows the computed main-currency figure live.
5. Client encrypts and `PUT`s the record.

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

A snapshot can be written by **confirming** an account's last known
value at a new date rather than typing it (`ui/update-values.md`). It
writes an ordinary snapshot — no new field, no new `rateSource` value,
nothing for the record shape to learn.

**Confirming asserts that the whole figure is unchanged**, not merely
the quantity. What that means for the rate depends on whether anything
can contradict the user:

- **Unit is a listed symbol** → the rate is **fetched fresh** for the
  new date and the previous one is never copied. For a non-currency
  holding the quantity is what stays constant and the price is what
  moves: you still own 12.5 troy ounces, and gold has done something
  since. Copying the old rate would stamp a new date onto a price a
  known source disagrees with — worse than recording nothing, because
  it looks like a measurement. The user is asserting the quantity; the
  provider supplies the rest.
- **Unit is free text** (`m²`, `bottles`) → **the previous rate
  carries**, and the user is asserting the valuation too. There is no
  source to contradict them, so their last estimate is the best figure
  available, and refusing to carry it would leave the sweep unable to
  help with exactly the holdings most likely to have sat untouched for a
  year. The carried rate is shown before saving, never applied
  invisibly, and `rateSource` stays `manual` — so the audit trail on
  `ui/account-detail.md` records it as the hand-held figure it is.

Confirming is unavailable for an account with no snapshots: there is
nothing to confirm.

## Editing an existing snapshot

Value, rate, note, and **date** are all editable (`ui/account-detail.md`
is where a past snapshot is found). Editing is an ordinary versioned
write, except when the date moves onto a date the account already holds.

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

- In: account, date, value, rate (proposed, edited, or manual),
  optional note.
- Out: encrypted snapshot record via `PUT /api/records/<uuid>`; net
  worth view and trend chart reflect it immediately from local state,
  without a refetch.

## Edge cases

- **Account has no rate source** (a free-text unit) → no proposal is
  requested at all; both value and rate are manual, and the form says so
  rather than showing an empty rate field with no explanation.
- **Account's native unit is the main currency** → rate is fixed at `1`,
  the field is hidden, `rateSource` is `manual`.
- **Provider is down, rate-limited, or has no data for that symbol** →
  the form falls back to manual entry with an inline notice. Recording a
  snapshot must never be blocked by the proxy being unavailable.
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
  is excluded from the total rather than counted as zero.
- **Value of zero** → valid and meaningful (a closed-out position). Not
  the same as having no snapshot.
- **Negative value** → valid. Mortgages and loans are accounts with
  negative balances; net worth is a signed sum.
- **Non-numeric or malformed value/rate** → inline validation, no
  submission.
- **Snapshot recorded against an archived account** → blocked; archived
  accounts take no new snapshots. The one exception is the **closing
  snapshot written as part of archiving** (manage-accounts.md), dated
  `archivedAt` and written in the same flow that sets it.

## Acceptance criteria

- Recording a snapshot stores one `snapshot` record whose plaintext
  columns carry `account_id` but no date, value, or rate.
- The stored `rate` is the one shown at entry time; a later change in
  the provider's rate does not alter it, and the trend chart for that
  date is unchanged after such a change.
- Re-entering a date that already has a snapshot prompts to replace and,
  on confirm, results in **one** record for that (account, date) with
  `version` incremented and a different nonce.
- Declining the replace prompt leaves the original record untouched.
- `value` and `rate` survive a round-trip as exact decimal strings —
  `"0.1"` plus `"0.2"` in a total yields `"0.3"`, not `0.30000000000000004`.
- A negative value and a zero value both round-trip and are included in
  the total; an account with no snapshots is excluded from the total.
- No rate-lookup request issued during the flow contains the entered
  value, in any field, in any encoding.
- With the rate proxy stubbed to 503, the snapshot can still be saved
  with a manual rate.
- A future-dated snapshot is rejected.
- An account with a free-text unit triggers zero rate-lookup requests.
- The rate proposed for an account is always for one unit of *that
  account's* unit — asserted for an account measured in `XAU-g` against
  one measured in `XAU-ozt`, whose proposals differ by 31.1034768.
- Attempting to record against an archived account is blocked, except
  for the closing snapshot written by the archive flow itself.
- Every stored snapshot carries a `rateTarget` equal to the main
  currency in the profile record at entry time.
- Editing a snapshot from a second tab with a stale `version` returns
  409 and does not overwrite.
- Moving a snapshot's date onto an occupied date prompts with copy
  naming the deletion, and on confirm leaves exactly one record for that
  date.
- The move issues the `PUT` before the `DELETE`: with the `DELETE`
  stubbed to fail, both records still exist afterwards and neither is
  lost.
- With two snapshots present for one (account, date), the history view
  shows both flagged, the client picks neither, and that date is
  excluded from the interpolated series until resolved.
- Confirming a previous value on a **listed-unit** account writes a
  snapshot whose `value` equals the previous one and whose `rate` was
  fetched for the **new** date — with the proxy stubbed to return a
  different rate, the stored rate is the new one, never the old
  snapshot's.
- Confirming on a **free-text-unit** account carries the previous rate
  forward, stores `rateSource: manual`, and issues no rate request.
- Confirming an account with no snapshots is not offered, and the
  equivalent request is rejected client-side.
