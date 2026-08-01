# Dimensions

## Purpose

Configure the axes accounts are classified along — the bands of the
stacked chart and the grouping of the dashboard's breakdown. This is the
only screen where dimensions and their values are created, renamed,
reordered, archived, and restored.

Exercises: `spec/features/account-settings.md` (Dimensions).

<!-- Added because account-settings.md specified the whole feature —
ordered values, labels, archiving, the >4 fold — and no screen built it.
Since dimensions replaced freeform tags entirely, this is now the only
way a user organizes their accounts at all. -->

## Layout

Standard app shell, content max-width 720px. Reached from Settings,
beside Export / import, and from the dashboard's "Group by" control when
no dimension exists yet.

One card per dimension, in the profile's configured order — which is
also the order of the dashboard's "Group by" select, so dragging a card
reorders that too.

Each card carries:

- The dimension's **label**, editable in place. Renaming is free and
  instant: it writes the profile record and no account record
  (`account-settings.md`).
- Its **coverage**, the same figure the dashboard shows: "7 of 10
  accounts assigned", the unassigned count linking to a filtered account
  list. A dimension covering a third of the accounts draws a chart that
  is correct and useless, and this is where that gets noticed — at the
  point of configuration, not after a confusing chart.
- Its **values**, in band order, each with a drag handle, an editable
  label, and an archive action. Order here is the stacking order in the
  chart and must never be sorted by size (`net-worth-view.md`).
- `+ Add value`, and an overflow menu holding **Archive dimension**.

Beneath the cards: `+ Create a dimension`, and a collapsed **Archived**
section when anything is archived.

## The >4 note

Once a dimension holds a fifth value, an inline note appears under its
list — not a warning, and not a cap:

> The chart shows the first four values and folds the rest into "Other".
> All five are still tracked.

`account-settings.md` is explicit that the list is not capped: four is a
rendering constraint from the validated chart palette
(`design-system.md`), not a limit on the data.

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

## Archiving and restoring

"Delete" is called **Archive**, and the dialog says why in one line:

> Archiving keeps your accounts' assignments. Restore it and every
> account returns to the band it was in.

- Archiving a **dimension** hides it from the account form, the "Group
  by" select, and the breakdown. Its accounts render as "Unassigned"
  for it — which is to say, it simply stops appearing.
- Archiving a **value** moves its accounts to "Unassigned" in that
  dimension.
- **Restoring either brings every assignment back exactly**, because
  nothing was ever removed from an account record.
- There is no permanent delete and **no "remove from all accounts"
  option**. Stripping entries from N account records is a destructive
  multi-record write offered to reclaim a few bytes inside ciphertext
  nobody reads (`account-settings.md`). The screen must not offer one;
  an archived definition is one line in the profile.

## States

- **Loading**: none. Dimensions come from the in-memory profile.
- **Empty — no dimensions**: the most important state on this screen,
  because "dimension" is the least self-explanatory word in the product.
  One card explaining it concretely, with one primary action:

  > Dimensions are how your net worth splits up. Give one a name —
  > "Liquidity" — and values like Cash, Investments, Retirement. Each
  > account gets one value, so the bands of your chart add up to exactly
  > your net worth.
  >
  > [ Create a dimension ]

  No nagging elsewhere in the app; a vault with no dimensions is fully
  usable and charts as a single "Total" band.
- **Error — save failed**: inline on the card, the edit preserved, and
  the previous value still shown as current. Every write here is a
  single record, so a failure changes nothing.
- **Error — 409 stale profile**: "Your settings were changed in another
  tab." The screen reloads the profile and asks the user to redo the
  edit rather than merging.
- **Populated**: as above.

## Rules

- Every operation on this screen writes **at most one record** — the
  profile. Creating, renaming, reordering, archiving, and restoring all
  touch no account record. This is the property that opaque ids buy
  (`account-settings.md`), and it is worth asserting in tests rather
  than assuming.
- Labels are free text in any script and render with `x-text`
  everywhere, including in the chart legend and every tooltip.
- Reordering is keyboard-operable, not drag-only: each handle exposes
  move-up and move-down, since band order is load-bearing and a
  drag-only control would make it unreachable
  (`design-system.md`, Accessibility).
