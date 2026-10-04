# Snapshot entry

## Purpose

One holding, one date. The small form for everything the sweep is not
for: an odd date, a March figure being added now that the statement has
turned up, ten years of old statements being backfilled.

Updating several holdings in one sitting is `update-values.md`, which
is the primary route for a routine update and where the age of each
figure is shown. This form is the other door, and the two write the
same thing.

Exercises: `spec/features/record-snapshot.md`, and the refresh half of
`spec/features/record-rate.md`.

## Layout

An ordinary Dialog (`design-system.md`, Components), reachable from
any holding's row on the dashboard and from the holding's own screen.
The same modal, pre-filled, is what edits an existing entry
(`account-detail.md`).

- **Holding** — preselected when opened from a row; otherwise a select.
  Static when editing: an entry does not move between holdings, since
  its value is denominated in one holding's unit.
- **Date**, the Date field (`design-system.md`, Components) — defaults
  to today. Its upper limit is today, with the field's default reason.
  For an archived holding's entry the limit is the day before the
  archive date and the reason is the archive (Editing an existing
  entry). Editable when correcting an existing entry. Moving it onto a
  date the holding already holds prompts before destroying the record
  already there (see below).
- **Value**, the quantity field (`design-system.md`, Components), the
  largest thing on the form. Its live result converts at the price for
  **the date on the form**, which is the date's own price where one
  exists and the proposal for that date otherwise. With neither, it is
  the price at that date (`record-rate.md`, Reading): "not priced" for
  a unit with a rate source, and for a unit with none its newest
  earlier price, with the price date line beneath the converted figure
  (`design-system.md`, Components).
- **Note** — optional, collapsed behind "Add a note".
- **The prices line**, folded, below. See next section.
- Primary "Save".

**There is no rate field on this form.** A price belongs to a unit,
not to a holding (`record-rate.md`, `update-values.md`). The prices
this save writes are on their own line, which is about the date rather
than about this holding.

## The prices line

Recording something writes that date's prices, exactly as the sweep
does (`record-rate.md`, The refresh), so the form says what it is about
to write rather than doing it silently. One folded line, ink-secondary,
which opens into the same rate lines the sweep carries at its foot
(`update-values.md`):

- **A date holding no recording yet**: "Prices for 31 July will be
  recorded with this", opening to the proposals. A figure dated 2019
  takes 2019's prices, which is what makes a backfilled entry worth
  anything at all. Changing a line here is the same act as changing one
  on the sweep and carries the same announcement of what it moves.
- **A date that already holds a recording**: "31 July already holds
  prices. This figure joins them." It opens to that recording's stored
  prices, read only, with a link to that recording
  (`recording-detail.md`), where they are changed. **No stored price is
  looked up or rewritten**, because the figure being added is joining a
  sitting that already priced its date.
  - **A unit that date is missing is filled in**, the same way whether
    the figure is added here or on the sweep (`record-rate.md`, The
    refresh). Its line is looked up and offered like a line on a date
    with no recording, and the save writes it behind the figure. The
    lookup happens only when a unit the date needs has no price there,
    so a date whose prices are complete asks the source nothing. The
    folded line then adds: "The prices it is missing will be recorded
    with this."
- **A holding measured in the main currency** still writes the date's
  prices for every other unit in the vault. That is the case the whole
  split exists for, and the line says so rather than being absent.

Opened, the rate lines always stack, because the Dialog's content box
is 416px, below the 720px they need to keep the sweep's columns
(`update-values.md`, The rates, at the foot of the sweep).

## Editing an existing entry

The same modal, pre-filled with the stored value, date and note.

- **Changing the value or the note touches no price.** It issues no
  price request and writes no price record, and the prices line reads,
  unfolded or not, as the date's stored prices, read only.
- **Changing the date records the figure at its new date**
  (`record-snapshot.md`, Editing an existing snapshot). The prices line
  follows the date the moment it changes, in the same states as for a
  new figure (The prices line): proposals fetched for a date holding no
  recording, the missing lines filled for a date holding some, and the
  stored prices read only where nothing is missing. Picking the entry's
  own date again shows its stored prices and fetches nothing.
- **A move rewrites no stored price.** The date the entry leaves keeps
  every one of its prices, and a price already at the new date stands.
- Correcting a price is a different act, done in the recording for its
  date (`recording-detail.md`), where the holdings it moves are on the
  screen.
- **An archived holding's entry moves only to a date before its archive
  date.** Onto the archive date the move would displace the archive's
  zero, and after it the entry would be a figure after the archive
  (`manage-accounts.md`, While archived).
  - The grid disables every day from the archive date on.
  - A typed date on or after the archive date is refused, after today
    included, on the date field's message line:

    > Archived on 12 March 2026. Enter an earlier date.

  - From the moment the dialog opens, the message line carries the
    hint "Archived on 12 March 2026." in ink-secondary.
  - The date follows Settings (`settings.md`, Dates and numbers) and
    always carries its year.
  - Value and note stay editable. The archive's zero itself never
    opens here (`account-detail.md`).

  An entry on a holding that is not archived has no hint, and its
  message line stays reserved, so a refusal never shifts the form.

## States

- **Loading (proposals in flight)**: the folded prices line shows an
  inline skeleton, and the value field is **immediately usable**. The
  user should be typing the value while prices resolve, and saving is
  never gated on them.
- **Error, a price source is unavailable**: the affected line inside
  the fold says so in ink-secondary, never an error color, and nothing
  is written for that unit. **Saving is never blocked by the proxy
  being unavailable** (`update-values.md`, which owns the line states).
- **Error, prices did not save**: the entry is saved and the message
  says the prices were not updated, naming any unit the person typed
  themselves. The entry is never rolled back for it.
- **Error, a move whose prices did not save**: the entry has moved, and
  the dialog stays open on it with the message above Save, critical
  with its icon, naming every unit whose price did not save:

  > Moved to 10 April 2026. The prices for USD and XAU-ozt on that date
  > did not save.

  One button, **Open the recording**, goes to that date's own screen
  (`recording-detail.md`), where the empty lines are filled after
  Update. Save is inert until something changes. The units are
  computed, not written into the copy, and a single unit reads "The
  price for USD on that date did not save."
- **Error, duplicate date, entering**: on save, a confirm rather than a
  rejection: "You already recorded 12 450.00 USD for 31 July. Replace
  it?", naming the previously recorded value in the holding's native
  unit. Confirming updates the existing record in place. Declining
  leaves the original untouched and returns to the form. This prompt
  exists because the date here is chosen blind, and it is deliberately
  absent from the sweep, where the stored figure is already in the
  field being edited (`record-snapshot.md`).
- **Error, duplicate date, moving**: editing an existing entry onto an
  occupied date is a different act and gets different copy, because a
  second record dies: "30 July already holds a snapshot of 12 100.00
  USD. Moving this entry there will delete it." Destructive styling on
  the confirm. The client writes the move before deleting the displaced
  record, so a failure leaves two entries on one date rather than none,
  a visible fault the holding's screen and that date's recording both
  surface, not silent loss (`record-snapshot.md`).
- **Error, the date became taken while you were working**: the save is
  refused whole and nothing is written. The wording names the date and
  not the person, and one button opens that recording
  (`update-values.md`, which owns the copy).
- **Error, validation**: the quantity field's own rules, and the Date
  field's (`design-system.md`, Components). Every date refusal sits on
  the date field's message line. The line above Save carries only the
  outcomes of a save.
- **Error, archived holding**: the entry point does not exist for
  archived holdings, at any date (`manage-accounts.md`, While
  archived).
- **Populated**: saved; the modal closes and the dashboard updates from
  local state with no refetch.

## Rules

`record-snapshot.md` applies unchanged: decimal strings end to end, a
calendar date, and a value that is encrypted before it leaves the
browser and appears in no price request, in any field or any encoding.
