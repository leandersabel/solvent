# Update values

## Purpose

The sweep: every account you could update, on one screen, for one date.
This is how a user actually sits down and does their monthly or
quarterly update, and it is the highest-value screen in the product
after the dashboard.

Exercises: `spec/features/record-snapshot.md`, and the proposal half of
`spec/features/rate-lookup.md`.

<!-- Replaces the staleness warning, which was a dashboard chip with a
configurable threshold. Owner's call 2026-08-01: a per-account "last
updated about a year ago" shown at the moment you can act on it is more
useful than a global threshold that flags slow-moving assets forever
until the user learns to ignore it. -->

## Why this exists instead of a staleness warning

A single threshold cannot be right for a product built on sparse,
uneven updates. A current account moves monthly, gold yearly, unlisted
property every few years. At any fixed number the slow assets are
permanently flagged, and a warning that is always on for the same three
rows is one the user stops reading — at which point it fails for the
account that genuinely went quiet.

So there is **no threshold, no chip, and no warning color**. Each row
here states its own age in plain language, next to the control that
fixes it.

## Layout

Standard app shell, content max-width 900px. Reached from a global
"Update values" action in the shell, and from the dashboard hero.

At the top, **one date for the whole sweep**, defaulting to today.
Changing it re-evaluates every row. One date, not one per row: this
screen exists for "it's the end of the month, let me do my update", and
per-row dates would make that a puzzle. Odd dates are what the
single-account modal is for (`snapshot-entry.md`).

Then one row per active account. Archived accounts do not appear.

### A row

Name · unit · what it is worth now · age · the control.

- **The current figure** and, beside it, its provenance in words:
  - *Recorded* — a real snapshot on some date: "12 450.00 USD ·
    recorded 3 weeks ago". ink-primary.
  - *Carried forward* — no snapshot since, so the dashboard is showing
    the last known value: "12 450.00 USD · last updated about a year
    ago". ink-secondary, with the same marker the chart uses for
    inferred stretches. Everything after an account's last snapshot is
    carried, not measured (`net-worth-view.md`), and this is where a
    user finds out.
- **Age in plain language** — "3 weeks ago", "about a year ago", "never
  valued". Relative, not a date: the question here is *how long has this
  been sitting*, and a raw date makes the reader do the arithmetic.
- **Value field**, in the account's native unit, `inputmode="decimal"`,
  empty by default. Empty means no change and writes nothing.
- **Confirm** — one action writing a snapshot at the sweep date with
  **the same native value and a freshly fetched rate**.

### Confirm is not a shortcut for retyping

It is the main action for anything whose quantity does not change. You
still own 12.5 troy ounces; what moved is the gold price. Confirm writes
`value` unchanged and `rate` fetched for the sweep date, so net worth
updates correctly with one click and no typing.

It also converts an inferred stretch into recorded data, which is what
the chart's "Show what's estimated" toggle is asking about
(`net-worth-view.md`).

- The refreshed rate follows the ordinary rules: proposed where the unit
  is a listed symbol, manual where it is free text, `rateSource` set
  accordingly (`record-snapshot.md`). Confirm never reuses the previous
  snapshot's rate — that would record today's date against a stale
  price, which is worse than not recording at all.
- Confirm is **disabled for an account with no snapshots**. There is no
  previous value to confirm; the row asks for one.
- **There is no "confirm all".** Confirming asserts that you checked,
  and a button that asserts it for fifteen accounts at once makes that a
  lie. The estimated-data toggle exists precisely so inference stays
  visible rather than being laundered into recorded values.

## Writes

Each row saves **independently, as it is committed** — one
`PUT /api/records/<uuid>` per account, exactly as the single-account
modal does. Nothing batches:

- No transaction spans multiple records in this API (`record-api.md`),
  so a batch would fail partway with no defined result.
- The user can stop halfway and keep what they entered.
- A failing row shows its own error and leaves every other row alone.

**No record shape changes for this screen.** A confirmed snapshot is an
ordinary snapshot; the sweep is a different way to reach the same write.

## States

- **Loading**: none. Everything comes from the in-memory model.
- **Empty — no accounts**: "Add an account first", linking to the
  account form.
- **Row — account already has a snapshot on the sweep date**: the row
  shows that value as recorded today and the control becomes a replace,
  following the ordinary upsert confirm (`record-snapshot.md`). The
  sweep gets no private path around one-snapshot-per-date.
- **Row — never valued**: age reads "never valued", the value field is
  the only control, and confirm is disabled.
- **Row — rate proposal in flight**: an inline skeleton on the rate, and
  **the value field stays usable** — the user types while the rate
  loads.
- **Row — proposal unavailable**: falls back to manual with the
  ink-secondary notice from `snapshot-entry.md`. Never an error color;
  saving is never blocked by the proxy.
- **Row — saved**: a quiet inline confirmation on the row, the figure
  and age updating in place. The row does not disappear — vanishing rows
  make a list jump under the cursor.
- **Row — save failed**: inline on the row, input preserved, other rows
  unaffected.
- **Populated**: as above.

## Rules

- `value` and `rate` are decimal strings end to end; no float touches
  them.
- No value is sent anywhere before it is encrypted, and no value appears
  in any rate request in any field or encoding
  (`architecture.md`, Base-amount rule).
- Recorded and carried-forward figures are distinguished by **marker and
  wording, not color alone** (`design-system.md`, Accessibility).
- The date is a calendar date — no time, no timezone.
- Rows render decrypted names with `x-text`.
