# Snapshot entry

## Purpose

Record what one account was worth on one date. The highest-frequency
screen in the product — everything else is setup, this is the recurring
act — so it optimizes for speed and for not lying about where the rate
came from.

Exercises: `spec/features/record-snapshot.md`, and the proposal half of
`spec/features/rate-lookup.md`.

## Layout

Modal, max-width 460px, reachable from any account row and from the
account's detail screen. The same modal, pre-filled, is what edits an
existing snapshot (`account-detail.md`).

This is the **single-account** path: one holding, one date, including
odd dates and backfilled history. Updating several accounts in one
sitting is `update-values.md`, which is the primary entry point for a
routine update and where the age of each figure is shown.

- **Account** — preselected when opened from a row; otherwise a select.
  Static when editing: a snapshot does not move between accounts, since
  its value is denominated in one account's unit.
- **Date** — defaults to today. Future dates blocked. Editable when
  correcting an existing snapshot; moving it onto a date the account
  already holds prompts before destroying the record already there (see
  below).
- **Value** — the big field, in the account's native unit, unit shown as
  a suffix inside the input. `inputmode="decimal"`.
- **Rate** — pre-filled from the proposal where available, always
  editable. Labelled with both units: "1 XAU-ozt = ___ CHF".
- **Live result** — beneath, ink-secondary, updating as you type:
  "= 41 230.00 CHF". This is the number the user is actually reasoning
  about and it should never require a save to see.
- **Note** — optional, collapsed behind "Add a note".
- Primary "Save snapshot".

## Rate provenance

The rate's origin is shown, not hidden, because a user auditing old
figures needs to know which were guesses (`record-snapshot.md`,
`rateSource`):

- **proposed** — a small brass chip "Market rate · 31 Jul" beside the
  field.
- **edited** — the chip changes to "Edited from 0.9312" the moment the
  user changes the value, naming the rate stored as `proposedRate`
  (`record-snapshot.md`), so the same chip renders identically a year
  later on `account-detail.md`. Never silently keep the proposed badge.
- **manual** — no chip; the label reads "Enter the rate".

## The four rate situations

1. **Account unit = main currency** → the rate field is **hidden
   entirely**, rate fixed at `1`, `rateSource: manual`. Showing a
   disabled "1" field is noise.
2. **Account's unit is a symbol with `lookup: true`** → proposal
   requested for that unit and date. The request carries **a fixed base
   unit, never the value being entered** — enforce this in the client,
   and never let the value field participate in or trigger a rate
   request. The rate is always per one of *this account's* unit, which
   is guaranteed rather than checked: the unit is the symbol
   (`manage-accounts.md`).
3. **The unit is free text** → no request is made at all. The form says
   "This account has no price source — enter the rate yourself" rather
   than presenting an empty field with no explanation.
4. **The unit is a symbol with `lookup: false`** (silver, platinum,
   palladium in v1) → **no request is made** either; the client knows from
   the symbol table that none is coming, and a round-trip to be told
   `204` only delays the form. Copy names the metal — "No market rate
   for silver yet — enter it yourself" — and must not reuse the outage
   notice below, which tells the user something is broken when nothing
   is.

## Editing an existing snapshot

The same modal, pre-filled — including the rate, which comes from the
stored record and not from a fresh proposal (`record-snapshot.md`, The
rate when editing). The chip shows the stored `rateSource`, so a
snapshot saved as "Market rate · 31 Jul" still reads that way when
reopened a year later.

- Changing the **value** or the note touches no rate field and issues no
  request.
- Changing the **rate** flips a `proposed` chip to "Edited from …" as it
  does at entry; a `manual` one stays chipless.
- Changing the **date** fetches a proposal for the new date and offers
  it as a one-click "Use the rate for 12 Aug" beside the field. It is
  never applied on its own — declining keeps the stored rate, which is
  the right outcome for the common case of a mistyped date. If no
  proposal comes back, no offer appears and nothing is blocked.

## States

- **Loading (proposal in flight)**: the rate field shows an inline
  skeleton, not a spinner, and the value field is **immediately usable**
  — the user should be typing the value while the rate loads.
- **Error — provider down, rate-limited, or no data**: the field falls
  back to manual with an inline ink-secondary notice: "Market rate
  unavailable — enter it yourself." Not an error color. **Saving a
  snapshot must never be blocked by the proxy being unavailable.**
- **Error — duplicate date, entering**: on save, a confirm rather than a
  rejection: "You already recorded 12 450.00 USD for 31 July. Replace
  it?" — the previously recorded value, in the account's native unit.
  Confirming updates the existing record in place; declining leaves
  the original untouched and returns to the form.
- **Error — duplicate date, moving**: editing an existing snapshot onto
  an occupied date is a different act and gets different copy, because a
  second record dies: "30 July already holds a snapshot of 12 100.00
  USD. Moving this entry there will delete it." Destructive styling on
  the confirm. The client writes the move before deleting the displaced
  record, so a failure leaves two snapshots on one date rather than none
  — a visible fault the detail screen surfaces, not silent loss
  (`record-snapshot.md`).
- **Error — validation**: non-numeric or malformed value/rate, inline,
  no submission. Future date, inline. Zero and negative values are
  **valid** and must not be blocked — zero is a closed-out position,
  negative is a mortgage.
- **Error — archived account**: the entry point does not exist for
  archived accounts; the only exception is the closing snapshot written
  by the archive flow (`account-form.md`).
- **Populated**: saved; the modal closes and the dashboard updates from
  local state with no refetch.

## Rules

- `value` and `rate` are decimal strings end to end. No float ever
  touches them.
- The value is encrypted before it leaves the browser and appears in no
  rate request in any field or encoding.
- Date is a calendar date — no time, no timezone.
