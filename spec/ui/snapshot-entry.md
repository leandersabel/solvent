# Snapshot entry

## Purpose

Record what one account was worth on one date. The highest-frequency
screen in the product — everything else is setup, this is the recurring
act — so it optimizes for speed and for not lying about where the rate
came from.

Exercises: `spec/features/record-snapshot.md`, and the proposal half of
`spec/features/rate-lookup.md`.

## Layout

Modal, max-width 460px, reachable from any account row and from a global
"Record snapshot" action.

- **Account** — preselected when opened from a row; otherwise a select.
- **Date** — defaults to today. Future dates blocked.
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
  user changes the value. Never silently keep the proposed badge.
- **manual** — no chip; the label reads "Enter the rate".

## The three rate situations

1. **Account unit = main currency** → the rate field is **hidden
   entirely**, rate fixed at `1`, `rateSource: manual`. Showing a
   disabled "1" field is noise.
2. **Account has a `rateSymbol`** → proposal requested for the symbol
   and date. The request carries **a fixed base unit, never the value
   being entered** — enforce this in the client, and never let the value
   field participate in or trigger a rate request.
3. **`rateSymbol` is null** → no request is made at all. The form says
   "This account has no price source — enter the rate yourself" rather
   than presenting an empty field with no explanation.

## States

- **Loading (proposal in flight)**: the rate field shows an inline
  skeleton, not a spinner, and the value field is **immediately usable**
  — the user should be typing the value while the rate loads.
- **Error — provider down, rate-limited, or no data**: the field falls
  back to manual with an inline ink-secondary notice: "Market rate
  unavailable — enter it yourself." Not an error color. **Saving a
  snapshot must never be blocked by the proxy being unavailable.**
- **Error — duplicate date**: on save, a confirm rather than a
  rejection: "You already recorded 12 450.00 USD for 31 July. Replace
  it?" — the previously recorded value, in the account's native unit.
  Confirming updates the existing record in place; declining leaves
  the original untouched and returns to the form.
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
