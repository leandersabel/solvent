# Account detail

## Purpose

Everything about one holding: what it is, what it is worth, and its own
list of values, every figure ever recorded against it. This is where a
wrong figure gets found, and where the date it belongs to is one click
away.

Exercises: `spec/features/record-snapshot.md` (the editing and deleting
half), `spec/features/manage-accounts.md` (archive lifecycle).

## Layout

Standard app shell, content max-width 900px. Reached by clicking a
holding's row on the dashboard.

### Header

- The holding's name, 20px/600. Beneath it, one chip per dimension assignment
  (`Liquidity: Cash`) and the note if there is one.
- The current value: native unit and, beside it, the main-currency
  figure at **the latest price for this holding's unit**, which is a
  price on its own timeline and not something the entry carries
  (`record-rate.md`). Then "as of 31 Jul" and its age in words, "3
  weeks ago", at any age and with no warning attached: there is no
  staleness threshold anywhere in the product (`net-worth-view.md`).
  - **The dashboard's rates control does not reach this screen**
    (`dashboard.md`). That control is a comparison, and this screen
    answers what one holding is worth now, with nothing beside it to
    compare against.
  - **Two dates, and the second one is stated once.** The as of date is
    the quantity's, the only age that belongs to the person. The
    price's date is stated beside the converted figure, plainly, and
    never as a per-row column, because it is the same for every figure
    on this screen and nobody can act on it.
- A holding with no snapshots shows "Not yet valued", not 0.
- A holding whose unit has no price at all shows **"Not priced"** in
  place of the converted figure, with that as the stated reason, and it
  is excluded from the total rather than counted at its bare quantity
  (`net-worth-view.md`).
- Actions: **Record a value** (primary, opening `snapshot-entry.md` at
  this holding), **Edit** (opens `account-form.md`), **Archive** or
  **Unarchive**, **Delete**. The archive and delete dialogs are
  specified in `account-form.md` and launched from here.
- An archived holding shows an "Archived" chip and its `archivedAt`
  date, and offers no "Record a value". The one exception is the
  closing snapshot the archive flow itself writes
  (`record-snapshot.md`).

### The holding's own list of values

A table, **newest first**. Columns: Date · Value (native unit) · In
main currency · (row actions).

- Value and In main currency are figure columns, and each figure shows
  as `design-system.md`, Typography, sets it.
- **The date is a link**, opening the recording it belongs to
  (`recording-detail.md`). That is where the rest of that evening is,
  where the price that values this row can be corrected, and it is how
  a typo from eight months ago gets put right.
- **In main currency** converts at the price for **that row's own
  date**, which is what the holding was worth that day. Where the unit
  had no price at or before that date, the cell reads "not priced"
  rather than repeating the quantity.
- **There is no Rate column and no Source column.** An entry carries
  no rate at all: a quantity and a price are two separate timelines,
  and a price belongs to a unit rather than to a holding
  (`record-rate.md`, `update-values.md`). Where a price came from is
  shown on the recording that captured it, which each date here links
  to (`recording-detail.md`).
- A note on an entry shows as an icon that expands the row; notes are
  not truncated into the table.
- **No pagination.** A decade of entries scrolls. Paginating would add
  a control that solves nothing.
- Row actions: **Edit** (reopens `snapshot-entry.md` pre-filled, which
  is also where the entry's date is moved) and **Delete**.

### Deleting a snapshot

Single confirm, naming the consequence rather than asking abstractly:

> Delete the snapshot of 12 450.00 USD for 31 July? Your net worth for
> the period around this date will change.

If it is the holding's only snapshot, the copy says so instead: the
holding returns to "Not yet valued" and leaves the current total —
which is not the same as being worth 0 (`net-worth-view.md`).

**Deleting a value deletes no price.** A price belongs to a unit, not
to the holding that happened to prompt it, so the date keeps its
prices, the recording stands, and every other holding measured in
those units is untouched (`record-snapshot.md`). The copy does not
mention prices, because none of them move. Destroying a date, prices
and all, is a different act on a different screen
(`recording-detail.md`).

## States

- **Loading**: none.
- **Empty — no snapshots**: the history table is replaced by one
  sentence and the primary action: "No snapshots yet. Record what this
  holding is worth."
- **Populated — one snapshot**: a table with one row. No special case.
- **Error, duplicate date**: two entries share one date, reachable
  when a date move's `DELETE` failed and when two sittings crossed
  (`record-snapshot.md`). Both rows render flagged, with a line naming
  the fault and a **Keep this one** action on each, and the chart
  excludes that date from its interpolated series until it is
  answered. The same pair is shown the same way on that date's
  recording (`recording-detail.md`, which owns the fault's
  presentation), and answering it in either place answers it.
- **Populated, a figure whose unit is unpriced at its date**: the row
  renders with its native value and "not priced" in place of the
  converted figure. One row in this state does not affect the others.
- **Error, Conflict on a snapshot write**: "This snapshot was changed
  in another tab." The row reloads from the current record.
- **Error — delete failed**: inline on the row, row unchanged.

## Rules

- No request is issued by opening this screen, sorting it, or
  expanding a note. No price is ever looked up from here, at any age.
  Every figure comes from the in-memory model.
- `net-worth-view.md`, Rules applies unchanged.
- **A converted figure on this screen can move without this holding
  being touched.** Correcting a price in some recording moves every
  holding measured in that unit on that date, this one included. That
  is the correction working, and the screen states no caveat about it:
  the figure it shows is always the quantity recorded times the price
  recorded, both read live from the model.
- The table is this holding's own values only, and it never reaches
  across holdings. A cross-holding price audit ("every price I typed
  by hand") is deliberately **not** here: it is a different question
  with a different shape.
