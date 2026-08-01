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
2. If the account has a `rateSymbol`, the client requests a proposal
   from the rate-lookup proxy for that symbol and date (rate-lookup.md).
   The request carries **a fixed base unit, never the value being
   entered** (architecture.md, Base-amount rule).
3. User enters the value; the rate field is pre-filled and editable.
4. The client shows the computed main-currency figure live.
5. Client encrypts and `PUT`s the record.

The value field is never sent anywhere before it is encrypted — in
particular, it must not be part of, or trigger, any rate request.

## Same account, same date: upsert

**One snapshot per (account, date).** Entering a value for a date that
already has one prompts "You already recorded 12 450.00 CHF for 31 July.
Replace it?" and, on confirm, updates the existing record in place
(same `record_id`, `version` + 1, fresh nonce).

Duplicate detection is client-side — the client already decrypts every
snapshot for the account, and the server cannot see dates. Record ids
stay random UUIDv4; deriving them from the date would let the server
brute-force which dates a user holds data for.

## Inputs / outputs

- In: account, date, value, rate (proposed, edited, or manual),
  optional note.
- Out: encrypted snapshot record via `PUT /api/records/<uuid>`; net
  worth view and trend chart reflect it immediately from local state,
  without a refetch.

## Edge cases

- **Account has no rate source** (`rateSymbol: null`) → no proposal is
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
  The AAD's `monotonic_version` means the server cannot roll a snapshot
  back to a previous version undetected (architecture.md, AAD binding).
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
- An account with `rateSymbol: null` triggers zero rate-lookup requests.
- Attempting to record against an archived account is blocked, except
  for the closing snapshot written by the archive flow itself.
- Every stored snapshot carries a `rateTarget` equal to the main
  currency in the profile record at entry time.
- Editing a snapshot from a second tab with a stale `version` returns
  409 and does not overwrite.
