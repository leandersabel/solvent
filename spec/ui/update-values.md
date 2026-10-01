# Update values

## Purpose

The sweep: one date, every holding you could record against, on one
screen. This is how a user sits down and does their monthly or
quarterly update, and it is the highest-value screen in the product
after the dashboard.

It is also the editor for a recording that already exists. Editing is
not a screen of its own: Update on a recording's own screen
(`recording-detail.md`) lands here, at that date, with the same rows in
the same order and the same rate lines at the foot. That is what keeps
correcting a figure from four years ago cheap.

Exercises: `spec/features/record-snapshot.md`,
`spec/features/record-rate.md`, and the proposal half of
`spec/features/rate-lookup.md`.

## Which recording you are in

Three routes land here, all arriving at one date:

- The top bar's **Update values**, which goes straight into editing
  today (`design-system.md`, App shell).
- The dashboard's **New recording**, on a date holding nothing
  (`dashboard.md`). The sweep starts one there.
- **Update** on a recording's own screen (`recording-detail.md`), on a
  date holding something. The rows arrive holding what was recorded.

**The date sits at the top as the heading, and it is not a control.**
It is which recording you are in. Changing your mind about the date is
the New recording button again, not a field on this screen. A date
picker here would make starting a recording and editing an existing one
the same gesture, and they are different acts with different outcomes
(`record-snapshot.md`).

**Delete is not on this screen.** A recording is destroyed from its own
screen and nowhere else, so an edit can never slip into a deletion
(`recording-detail.md`).

## Nothing counts what you left alone

A partial update is the ordinary case. Updating four holdings this
month and the other eleven in March is one normal pair of sittings, and
this screen treats it as one: it counts nothing, scores nothing, marks
no row as outstanding, and never comes back to the rows that were left.
There is no progress indicator, no "4 of 15", and no summary afterwards
naming what was skipped.

There is no staleness threshold anywhere in the product
(`net-worth-view.md`, Current net worth). This is the screen that
carries the alternative: each row states its own age in plain language,
next to the control that acts on it. No chip, no warning color.

## Layout

Standard app shell (`design-system.md`, App shell), content max-width
900px.

Top to bottom: the date as the heading, one row per active holding,
then the rate block. Archived holdings do not appear.

The date is the screen heading, with a section label above it. The
rows share one Card, divided by hairline rules. The rate block follows
under its own section heading, in a Card of its own.

### A row

Name, unit, what the holding holds now, its age, the value field, and
one control.

Three columns. The name holds the fluid left column with the row's
sentence and age beneath it. The quantity field takes a 260px column,
its unit as the suffix and the converted figure right-aligned beneath
it. The control fills a 112px column at the right, so every row's
control lines up whatever it reads.

**Every row states in words whether this date already holds a figure
for it.** That sentence, not the contents of the field, is what tells a
reader where they stand, and the two row states differ in wording and
in ink weight, never in color alone (`design-system.md`,
Accessibility):

- **Nothing recorded for this date.** The field carries the holding's
  last recorded figure as a starting point, in ink-secondary, with that
  figure's own date beside it. The control reads **Confirm** while the
  field is untouched and **Record** as soon as it is edited.
- **Recorded for this date.** The field carries the figure stored at
  this date, in ink-primary. The control reads **Save** and is inert
  until something changes. Clearing the field and saving deletes that
  entry, and only this row state can delete anything, because only here
  is a record standing behind the field.

**A figure showing in a field is not a figure in your history.** The
field holding a number writes nothing whatsoever. Only the row's
control writes, and pressing nothing writes nothing: scroll past a row
with last March's figure sitting in it and that holding has no entry
for this date, on this date or ever. The row's own sentence is the
answer to "is this recorded", so nobody has to infer it from a field.

A row can be answered by typing, by Confirm, or by doing nothing:

- **Type the new number**, in the quantity field (`design-system.md`,
  Components).
- **Confirm.** One click, meaning the quantity has not moved. It
  records the same quantity again at this date.
- **Leave it alone.** No control to press. The holding gets no entry
  for this date and keeps exactly the history it has.

### Confirm is one click, always

Confirm asserts the quantity and only the quantity
(`record-snapshot.md`). You still own the same 12.5 troy ounces. What
moved is the gold price, which belongs to the unit and is handled at
the foot of this screen.

So it has no cases. One click for a franc holding, for a dollar
holding, for gold and for the flat, and **still one click with the
price provider down**, because nothing about it waits on a price
resolving.

- **Disabled where the holding has never been valued.** There is
  nothing to confirm. The age reads "never valued" and the field is the
  only control on that row.
- **On a reopened recording, for a holding that was silent that date**,
  Confirm records the figure the holding carried into that date,
  meaning its last figure before then rather than the newest one in its
  history (`record-snapshot.md`). The row names that figure and its
  date, because "still the same" has to say what the same is.
- **There is no "confirm all".** Confirming asserts that you checked,
  and a button asserting it for fifteen holdings at once makes that a
  lie. A holding nobody looked up needs no action at all, so there is
  nothing for such a button to do.

### Age, in plain language

"3 weeks ago", "about a year ago", "never valued". Relative, not a raw
date: the question on this screen is how long this has been sitting,
and a date makes the reader do the arithmetic. The age is the only
mark a row carries (`design-system.md`, The estimated marker).

## The rates, at the foot of the sweep

Below the rows, one line per unit anything in the vault is measured in,
for this date. It is not a second sheet of work: in the ordinary case
it is read, it is right, and the sitting is over.

**No holding's row ever carries a rate.** One price belongs to a unit
and is shared by every holding measured in it, so putting it on a row
would show one fact on as many rows as hold that unit, where two of
them could be typed with two different figures for one day and one
would have to win silently (`record-rate.md`).

**The main currency has no line.** There is nothing to convert.

Each line carries the unit, the figure, and where it came from. The
provenance wording is one vocabulary across the product and is owned by
`recording-detail.md`.

On this screen the lines keep the rows' columns: the unit at the left,
the figure in the field column, and the provenance chip in the control
column. That column widens for a long chip on every line at once, so no
field falls out of line with the others. Inside the snapshot entry
Dialog the lines stack instead (`snapshot-entry.md`, The prices line).

Line states:

- **A unit somebody publishes, with a proposal.** Arrives filled in.
  Where the provider's figure is for an earlier day, a weekend or a
  holiday or a publication lag, the line says which day it is actually
  for: "rate as of 29 Jul" (`rate-lookup.md`). It is written whether or
  not it was touched, and leaving it alone accepts it.
- **A unit somebody publishes whose source did not answer.** The line
  stays empty and says so, in ink-secondary and never in an error
  color: "No market rate came back for USD. Nothing will be recorded
  for it for this date." The copy names the date rather than today,
  because a backdated sweep asks about a past date. Nothing is written
  for that unit, the total carries on at the most recent rate it has,
  and the line comes back filled in as soon as the source does. Nobody
  is ever asked to type a dollar rate in order to record a franc
  holding.
- **A unit only its owner can price**, free text or a symbol the proxy
  has no provider for. The line shows the last figure and when it was
  set, "estimated 14 months ago", and writes nothing unless it is
  changed. An estimate of the flat does not get newer because a bank
  balance was recorded. The copy names why, and never borrows the
  outage wording, which would say something is broken when nothing is.
  A symbol with no provider yet names the thing: "No market price for
  silver yet. This one is yours to set." A free-text unit, which
  nobody publishes a price for at all, says that: "Nobody publishes a
  price for m2. This one is yours to set." With an earlier figure the
  sentence follows its age, "Estimated 14 months ago. Nobody publishes
  a price for m2. This one is yours to set.", and with none it follows
  "No price for m2 yet."
- **A unit with no rate at all, where this sitting is recording a
  quantity in it.** The one time a price is asked for rather than
  offered, because twelve troy ounces with no gold price is not a
  figure. The line moves to the head of the block and asks for the
  number: "What is 1 PAINT worth in CHF? Nothing prices PAINT yet. The
  figure records either way, and until a price exists the holding is
  listed as not priced." **It never blocks the row.** The quantity
  records either way, and until a price exists the holding is listed
  as not priced rather than counted at its bare quantity
  (`net-worth-view.md`). Blocking
  would make a provider outage stop somebody recording what they went
  and looked up, which is the one thing this screen may not do.

### Rate lines on a reopened recording

- The lines open on **the rates this recording wrote**, with their
  stored provenance, never on a fresh proposal. **Opening a recording
  asks the source about nothing it already holds a rate for**, because
  the figure there may be one the person chose, and a provider that has
  since revised its published figure must not reach a stored entry by
  way of somebody looking at it (`record-rate.md`).
- **A line that went in empty** says so, "No rate was recorded for
  XAU-ozt on this date.", and **carries its own Look it up action**,
  since the outage that emptied it is the reason for coming back.
  Opening the recording fetches nothing. Pressing that action is what
  issues the request, and what comes back is labeled with the day it
  is actually for like any proposal, to be taken, changed or left
  empty.
- **A rate line on a reopened recording saves by itself.** On a new
  sweep the rates ride in with the first row recorded, because until
  then there is nothing for them to belong to. On a recording that
  already exists there is, so filling in the rate that was missing is a
  complete act and needs no holding touched alongside it.

### Changing or clearing a rate says what it moves

A price is corrected here because here the holdings it moves are the
rows on the screen. One confirmation per save, before anything goes
through, naming each unit and how many holdings move, rather than a
dialog per line:

> Changing the USD rate for 31 July moves 3 holdings measured in USD
> on that date. Your net worth on that day changes with them.

Clearing a line is the same act with a different consequence and says
so, and where the entry is that unit's only one it says that too:

> Clearing the XAU-ozt price for 31 July leaves that date with no price
> for it. 2 holdings measured in XAU-ozt move on that date.

> This is the only price recorded for XAU-ozt. Clearing it leaves every
> holding measured in it with no price at all, and they leave the
> total until one exists.

**The count is of holdings whose value on that date actually
changes**: holdings measured in that unit, not archived before the
date, and holding a figure at or before it. A holding archived earlier
or first valued later is worth nothing that day whatever the price, so
counting it would overstate what the change moves.

Editing a filled line flips its provenance the moment it changes, to
"Edited from 0.9312", naming the figure that was replaced
(`recording-detail.md`). The proposed badge is never silently kept.

## At phone width

A row stacks into one column: the name with its sentence and age, then
the quantity field with the converted figure beneath it at the left,
then the control at full width. A rate line stacks the same way: the
unit with its sentence, then the rate field at full width, then the
provenance chip at its own width at the left.

## Writes

Rows record **one at a time as they are finished**. One
`PUT /api/records/<uuid>` per holding, nothing batched, because no
transaction spans two records in this API (`record-api.md`), so a batch
would fail partway with no defined result. A row that fails says so on
itself and leaves the others alone, and the sitting can stop anywhere
and keep every row already acted on.

**The rates go in with the first row recorded**, once for the whole
sitting rather than once per row, so stopping halfway still leaves the
date priced (`record-rate.md`, The refresh). A fifteen-row sweep writes
one set of prices and asks the proxy once.

**Open the sweep, act on no row and leave, and nothing is written
anywhere**, the rate lines included. That holds whether the date was
empty or already held a recording, and it holds for a proposal sitting
on a line nobody touched. The refresh rides along with a recording. It
is not something the screen does on arrival.

**A price write can never fail a quantity write.** The quantity goes
first and the prices after, on their own requests. A price that did not
land is reported and never swallowed: the row reads as recorded with
the price not updated, and where the person typed that price the
message names the unit, because they typed that number and are entitled
to know it did not land.

**Saving a reopened recording** is one control at a time
(`record-rate.md`, Saving an edited recording). A row's control saves
that holding's figure, and clearing its field deletes that one entry.
The rate lines' own save writes every changed line, with the pre-create
reload first if any line creates an entry and the cleared lines deleted
last, so a save that fails partway has destroyed nothing. No save spans
a quantity, rates and deletions at once.

**No record shape changes for this screen.** A confirmed figure is an
ordinary entry, and the sweep is a different way to reach the same
write.

## States

- **Loading**: none. Everything comes from the in-memory model.
- **Empty, no holdings**: "Add a holding first", linking to the
  account form. No rate block: there are no units to price.
- **Empty, an empty recording reopened**: every row reads as nothing
  recorded for this date, and the rate lines show the prices that kept
  the date alive. This is an ordinary state, and the screen says
  nothing about tidying it up.
- **Row, never valued**: age reads "never valued", the field is the
  only control, Confirm is disabled.
- **Row, rate block still resolving**: an inline skeleton on the rate
  lines, and **every value field stays usable**. Typing never waits on
  a price.
- **Row, saved**: a quiet inline confirmation, the figure, the age and
  the row's sentence updating in place. The row does not disappear.
  Vanishing rows make a list jump under the cursor.
- **Row, invalid value**: the quantity field's own rules
  (`design-system.md`, Components), inline on the row.
- **Row, save failed**: inline on the row, critical, the typed input
  preserved, every other row unaffected.
- **Row, Conflict**: "This figure was changed in another window." The
  row reloads to the stored record (`record-api.md`).
- **The date became taken while you were working**: the save is refused
  whole, before anything is written, and nothing on screen claims
  otherwise. The wording is not an accusation:

  > 31 July already has a recording. Another window got there first.

  One button, **Open the recording**, going to that date's own screen.
  What was typed into the refused attempt is gone and is typed again
  there. The screen does not offer to carry it across, because a rescue
  that works only sometimes is worse than none.
- **A rate-lines save that landed in part**: the screen **stays open**
  and every line keeps its own state, saved or not saved with what was
  typed still in front of the person. The message names both halves,
  the changes that landed and the ones that did not, by unit. A count
  alone leaves somebody's vault in a state they cannot see. Retrying
  reissues only what failed. Nothing is rolled back, and the total on
  screen is always what the vault holds rather than what the save
  intended.
- **Closing with changes unsaved**: nothing blocks leaving. There is no
  confirmation and no prompt to stay, because what was typed and not
  saved is the person's to abandon. The screen they land on carries a
  critical notice at its head naming what was left unsaved, by holding
  name and by unit:

  > You left the recording for 31 July 2026 with changes that were not
  > saved: Current account, the USD rate.

  Nothing in the vault records that a save was partial, so the notice
  is the whole of it and does not come back.
- **Two entries on one date**: a holding or a unit with two entries at
  this date is rendered flagged, both of them, with **Keep this one**
  on each. The client picks neither (`recording-detail.md`, which owns
  the fault's presentation).
- **Populated**: as above.

## Rules

- `record-snapshot.md` and `record-rate.md` apply unchanged.
- Recorded and carried-forward figures are distinguished by **wording
  and marker, not color alone** (`design-system.md`, Accessibility).
- Nothing typed into a value field is ever part of, or triggers, a
  price request, in any field or any encoding (`architecture.md`,
  Base-amount rule). Neither is a price the person typed.
- Locking mid-sweep keeps what is typed and unsaved, and throws away
  everything else (`app-shell.md`).
