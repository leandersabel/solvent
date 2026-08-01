# Account detail

## Purpose

Everything about one holding: what it is, what it is worth, and every
snapshot ever recorded against it. This is where a wrong figure gets
found and corrected, and the only screen that shows where a rate came
from after the moment it was entered.

Exercises: `spec/features/record-snapshot.md` (the editing and deleting
half), `spec/features/manage-accounts.md` (archive lifecycle).

<!-- Added because record-snapshot.md specifies editing and deleting a
past snapshot, and rateSource exists so "a user can audit which figures
were guessed" — none of which had a screen. The upsert prompt let a user
overwrite a date they already remembered; nothing let them look. -->

## Layout

Standard app shell, content max-width 900px. Reached by clicking an
account row on the dashboard.

### Header

- Account name, 20px/600. Beneath it, one chip per dimension assignment
  (`Liquidity: Cash`) and the note if there is one.
- The current value: native unit and, beside it, the main-currency
  figure at the latest snapshot's stored rate. Then "as of 31 Jul" and
  its age in words — "3 weeks ago" — with no warning attached at any
  age, matching `update-values.md`. There is no staleness threshold
  anywhere in the product (`net-worth-view.md`).
- An account with no snapshots shows "Not yet valued", not 0.
- Actions: **Record snapshot** (primary), **Edit** (opens
  `account-form.md`), **Archive** or **Unarchive**, **Delete**. The
  archive and delete dialogs are the ones specified in
  `account-form.md`; this screen is where they are launched from.
- An archived account shows an "Archived" chip and its `archivedAt`
  date, and offers no "Record snapshot" — the one exception being the
  closing snapshot the archive flow itself writes
  (`record-snapshot.md`).

### Snapshot history

A table, **newest first**. Columns: Date · Value (native unit) · Rate ·
In main currency · Source · (row actions).

- Money columns right-aligned, `tabular-nums`. Rate keeps its own
  precision, not the currency's.
- **Source** carries the provenance chips from `snapshot-entry.md`:
  "Market rate · 31 Jul" for `proposed`, "Edited from 0.9312" for
  `edited`, and nothing at all for `manual`. This column is the whole
  reason `rateSource` is stored (`record-snapshot.md`) — without it the
  field is written and never read.
- A note on a snapshot shows as an icon that expands the row; notes are
  not truncated into the table.
- Rate is hidden as a column when the account's unit is the main
  currency, where it is always `1` and says nothing.
- **No pagination.** A decade of monthly entries is 120 rows; a decade
  of weekly is 520. Both scroll. Paginating this would add a control
  that solves nothing.
- Row actions: **Edit** (reopens `snapshot-entry.md` pre-filled) and
  **Delete**.

### Deleting a snapshot

Single confirm, naming the consequence rather than asking abstractly:

> Delete the snapshot of 12 450.00 USD for 31 July? Your net worth for
> the period around this date will change.

If it is the account's only snapshot, the copy says so instead: the
account returns to "Not yet valued" and leaves the current total —
which is not the same as being worth 0 (`net-worth-view.md`).

## States

- **Loading**: none. Everything comes from the in-memory model
  (`net-worth-view.md`, Data flow), so the screen renders instantly.
- **Empty — no snapshots**: the history table is replaced by one
  sentence and the primary action: "No snapshots yet. Record what this
  account is worth."
- **Populated — one snapshot**: a table with one row. No special case.
- **Error — duplicate date**: two snapshots share one date, reachable
  only when a date move's `DELETE` failed (`record-snapshot.md`). Both
  rows render, flagged critical, with a line naming the fault and a
  **Keep this one** action on each. The client picks neither, and the
  chart excludes that date from its interpolated series until it is
  resolved. This is a visible fault by design — silently preferring the
  higher `version` would put a wrong number in the chart with nothing
  on screen to explain it.
- **Error — 409 on a snapshot write**: "This snapshot was changed in
  another tab." The row reloads from the current record; no merge.
- **Error — delete failed**: inline on the row, row unchanged.

## Rules

- Every figure is computed client-side from decrypted records; no
  request is issued by opening this screen, sorting it, or expanding a
  note.
- Account name, note, dimension labels, and snapshot notes render with
  `x-text` (`architecture.md`, Application hardening).
- Money arithmetic in decimal, rounded only for display.
- The history table is the account's own snapshots only — it never
  reaches across accounts. A cross-account rate audit ("every rate I
  typed by hand") is deliberately **not** here: it is a different
  question with a different shape, and its absence is a decision rather
  than an oversight.
