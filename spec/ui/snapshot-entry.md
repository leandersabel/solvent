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
- **Date** — defaults to today. Future dates blocked. Editable when
  correcting an existing entry. Moving it onto a date the holding
  already holds prompts before destroying the record already there (see
  below).
- **Value**, the quantity field (`design-system.md`, Components), the
  largest thing on the form. Its live result converts at the price for
  **the date on the form**, which is the date's own price where one
  exists and the proposal for that date otherwise (`record-rate.md`).
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

- **No edit here touches a price.** Changing the value, the note, or
  the date issues no price request and writes no price record. Moving
  an entry from 30 July to 31 July changes which price values it, only
  because a price is looked up by date, and the prices themselves are
  untouched (`record-snapshot.md`).
- Correcting a price is a different act, done in the recording for its
  date (`recording-detail.md`), where the holdings it moves are on the
  screen.
- The prices line reads, unfolded or not, as the date's stored prices,
  read only.

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
- **Error, validation**: the quantity field's own rules
  (`design-system.md`, Components), and a future date refused inline.
- **Error, archived holding**: the entry point does not exist for
  archived holdings. The only exception is the closing value written by
  the archive flow (`account-form.md`).
- **Populated**: saved; the modal closes and the dashboard updates from
  local state with no refetch.

## Rules

`record-snapshot.md` applies unchanged: decimal strings end to end, a
calendar date, and a value that is encrypted before it leaves the
browser and appears in no price request, in any field or any encoding.
