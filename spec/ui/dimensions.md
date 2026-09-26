# Dimensions

## Purpose

Configure the axes holdings are classified along — the bands of the
stacked chart and the grouping of the dashboard's breakdown. This is the
only screen where dimensions and their values are created, renamed,
reordered, archived, and restored.

Exercises: `spec/features/account-settings.md` (Dimensions).

## Layout

Standard app shell, content max-width 720px. Reached from Settings,
beside Export / import, and from the dashboard's "Group by" control when
no dimension exists yet.

One card per dimension, in the profile's configured order — which is
also the order of the dashboard's "Group by" select, so moving a card
reorders that too.

Each card carries:

- The dimension's **label**, editable in place. Renaming is free and
  instant: it writes the profile record and no account record
  (`account-settings.md`).
- Its **coverage**, the same figure the dashboard shows: "7 of 10
  holdings assigned", the unassigned count linking to a filtered list
  of holdings. A dimension covering a third of the holdings draws a
  chart that is correct and useless, and this is where that gets
  noticed — at the point of configuration, not after a confusing chart.
  - Coverage counts **active holdings**, the same set the dashboard
    table holds. An archived holding is a closed position and has no
    say in whether a dimension is worth charting.
  - It is stated in ink-secondary and carries **no status color and no
    icon**. Low coverage is a fact about a setting, not a fault, and a
    vault where nothing is filed is a complete vault
    (`manage-accounts.md`).
- Its **values**, in band order, each with a reorder control, an
  editable label, and an archive action. Order here is the stacking
  order in the chart and must never be sorted by size
  (`net-worth-view.md`).
- `+ Add value`, and an overflow menu holding **Archive dimension**.

Beneath the cards: `+ Create a dimension`, and a collapsed **Archived**
section when anything is archived.

Every label on this screen is decrypted user text and renders through
`x-text` / `textContent` only, in the card, in the dialogs, and in the
Archived section (`design-system.md`, Accessibility).

## The >4 note

Once a dimension holds a fifth value, an inline note appears under its
list. It is not a warning, and not a cap:

> The chart shows the first four values and folds the rest into "Other".
> All of them are still tracked.

The copy counts nothing past the four the chart shows, so it stays true
however many values the dimension holds.

The list is not capped: four is a rendering constraint from the
validated chart palette (`design-system.md`), not a limit on the data
(`account-settings.md`).

## Creating

- **A dimension** asks for a label and a first value, because a
  dimension with no values classifies nothing and would render as an
  empty select on the account form.
- **A flag** is offered as a second option in the same dialog: a
  dimension with exactly one value, which the account form renders as a
  checkbox rather than a select. This is the shape that replaces a
  yes/no tag ("Emergency fund"), and it must be as fast to make as
  typing a tag once was — one field, one button.
- Ids are generated, never asked for. The user never sees one.

## Editing a label

An inline rename (`design-system.md`, Components): Edit reveals the
field, Save or Enter commits it, Cancel or Escape abandons it with the
stored label still shown. Clicking away leaves the field open and
writes nothing. One write, the profile.

- A label may not be blank or whitespace alone. The field refuses the
  commit inline and keeps what was typed, because a nameless band is
  unreadable in a chart and unpickable on the account form.
- **Two dimensions, or two values, may carry the same label.** Identity
  is the id, the labels are display text, and a screen that refused a
  duplicate would be refusing something the record shape allows and an
  import can hold. Nothing on this screen deduplicates or renumbers
  them.

## Reordering

Value order is the chart's band order and dimension order is the "Group
by" order. Both are real data, so both use the reorder control
(`design-system.md`, Components) and neither is drag-only.

A move writes the profile once, on drop or on the key press. There is no
save button and no reorder mode.

## Archiving and restoring

"Delete" is called **Archive**, and the dialog says why in one line:

> Archiving keeps your holdings' assignments. Restore it and every
> holding returns to the band it was in.

- Archiving a **dimension** hides it from the account form, the "Group
  by" select, and the breakdown. Its holdings render as "Unassigned"
  for it — which is to say, it simply stops appearing.
- Archiving a **value** moves its holdings to "Unassigned" in that
  dimension.
- **Archiving the last active value of a dimension is allowed.** The
  dimension stays, reads as covering nothing, and every holding shows
  "Unassigned" for it, which is exactly how it read before anything was
  filed. Refusing would invent a rule the record shape does not hold,
  and somebody who wants the dimension gone has the action for that one
  menu away.
- **Restoring either brings every assignment back exactly**, because
  nothing was ever removed from an account record.
- There is no permanent delete and **no "remove from all holdings"
  option**. Stripping entries from N account records is a destructive
  multi-record write offered to reclaim a few bytes inside ciphertext
  nobody reads (`account-settings.md`). The screen must not offer one;
  an archived definition is one line in the profile.

The **Archived** section lists archived dimensions and, inside each
live card, archived values, each with a restore action and no other
control. An archived label is not editable and not reorderable: it is
out of the chart, and its only question is whether it comes back.

## At phone width

The cards stack and each one keeps every control it has on a wide
screen. The coverage line wraps under the label instead of sitting
beside it, and its unassigned link stays a tap target of its own.

## States

- **Loading**: none. Dimensions come from the in-memory profile.
- **Empty, no dimensions**: the most important state on this screen,
  because "dimension" is the least self-explanatory word in the product.
  One card explaining it concretely, with one primary action:

  > Dimensions are how your net worth splits up. Give one a name,
  > "Liquidity", and values like Cash, Investments, Retirement. Each
  > holding gets one value, so the bands of your chart add up to
  > exactly your net worth.
  >
  > [ Create a dimension ]

  No nagging elsewhere in the app; a vault with no dimensions is fully
  usable and charts as a single "Total" band.
- **Empty, no holdings yet**: the cards render normally and coverage
  reads "0 of 0 holdings assigned". A dimension configured before the
  first holding is a normal order of work, and nothing on the screen
  treats it as premature.
- **Saving**: the change is shown at once from local state, with the
  control disabled until the write answers. No spinner for a write this
  small (`design-system.md`, States).
- **Error, save failed**: inline on the card, the edit preserved, and
  the previous value still shown as current. Every write here is a
  single record, so a failure changes nothing.
- **Error, Conflict stale profile**: "Your settings were changed in
  another tab." The screen reloads the profile.
- **Populated**: as above.

## What it deliberately does not show

- **No holding names.** Coverage is a count with a link out to the
  filtered list. Listing holdings inside a configuration screen would
  make it a second, thinner list of holdings.
- **No ids**, anywhere, in any state. They are what `dims` stores and
  they are never anybody's business.
- **No value totals and no chart preview.** What a band is worth
  belongs to the dashboard, which is one click away, and a figure here
  would be a second place for the same number to be right or wrong.
- **No permanent delete and no "remove from all holdings".**
- **No cap on values**, only the note above.

## Rules

- Every operation here writes at most one record, the profile
  (`account-settings.md`, Dimensions). Assert it in tests rather than
  assuming it.
- Nothing on this screen reads or writes an account record, so no
  operation can fail partway across several of them.
