# Record a value

A snapshot is what one holding held on one date: a date and a quantity
in the holding's own unit, and nothing else. A recording is every
record bearing one date. Recording a quantity also refreshes that
date's prices, which `record-rate.md` owns. This page owns the
quantity, the recording, and the screens both are made on.

## What the client gets

Recording a value is the recurring act in Solvent. Everything else is
setup. It is for you at the end of a month or a quarter, with the
online banking of several banks open, wanting to be done in a few
minutes. What you gathered that evening is what gets recorded, and
nothing else does.

The number you type never leaves your browser in readable form and is
never part of a price lookup. The app can ask what a troy ounce of gold
was worth on 31 July without anyone learning that you hold twelve of
them.

**How much you hold and what a unit is worth are kept apart.** A
holding's own list of values holds only the quantities you recorded.
Each unit has its own run of prices, shared by every holding measured
in it. A holding's worth on a date is its quantity on that date at the
price on that date, and either side can have moved since you last
looked.

- A unit somebody publishes never borrows another day's price. Its
  figure reads "not priced" on a date until that date has a price.
- A unit only you can price is valued at the last price you set before
  that date, with that price's date beside it, because your estimate of
  the flat holds until you change it. Before a unit's published prices
  begin (gold before 2013), it is a unit only you can price.
- Nothing is recalculated behind you. What your dollars were worth in
  2019 is what 2019's price says. A chart that changes its own past is
  not a record of anything. Only you change a past price, by opening the
  recording that wrote it.
- Each price says where it came from, and still says it a year later:
  proposed by the app, changed by you (with the proposal still shown),
  or typed by you because nothing was available.

**Recording anything refreshes every price.** Record your franc holding
alone, and the dollar and gold prices get an entry for the same date
too, so your total is never built from a price nobody has looked at
since March. You see every price about to be written and can change
any of them. Leaving one alone accepts it.

A quantity is written only if you act. A price is written unless you
act. It is one test applied twice: a quantity has to be looked up on a
statement, so the app never writes one you did not gather. Nobody
gathers an exchange rate, so refusing to write one buys nothing and
costs a stale total. A price only you can supply (your flat per square
meter) follows the quantity rule, so its age stays honest.

- Recording nothing writes nothing, prices included.
- Prices are written for the date being recorded, not for today. A
  March figure from a statement you just found writes March's prices.
- A date that already carries prices keeps them.

**A recording is a thing you can reopen**, identified by its date
alone. Two sittings on one day are one recording. A wrong figure, a
skipped holding and a price you disagree with are all put right the
same way: open the recording, edit, save. A price is changed only
there, where it was captured, whether today or four years ago.

Saving an edited recording moves nothing outside that date. A changed,
added or cleared figure bends, adds or removes that holding's point
there, and the runs either side follow. Your total changes only if that
date is the holding's newest figure. A changed price moves every
holding measured in that unit on that date, and every total that used
it. The app names those holdings first, and they are the rows in front
of you. On a screen listing only prices the same edit would move
figures you were not looking at.

**What it deliberately does not do:**

- **No transactions.** One figure per holding per date. Spending and
  budgeting are another product.
- **No more than one value per holding per day**, and one price per
  unit per day. Intraday movement is not what this measures.
- **No price attached to a value**, to disagree with the unit's own.
- **No price refresh on a timer.** Nothing updates while you are away,
  and a screen you are only reading never contacts a source.
- **No future dates.** An entry describes what was.
- **No button that records every holding at once** (Update values,
  Confirm is one click, always).
- **No value carried into your history.** A holding without an entry
  for a date has none. What the chart and total do across a gap is
  `net-worth-view.md`'s.
- **No automatic price for things without a market**: your flat, the
  wine, a private loan.
- **No rescue for a refused recording.** Figures typed into an attempt
  that lost to another window are not kept, offered back or merged.
- **No screen of nothing but prices, no list of recordings, and no
  audit view across holdings.** The provenance of each price is on the
  holding's page.

## Screens

Every route to a recording arrives at one date. There is no list of
recordings, because the dates are already on screen:

- **New recording** on the dashboard opens a date picker set to today,
  with every date holding a recording marked, empty ones included
  (`net-worth-view.md`, Dashboard). A marked date opens its Recording
  detail with nothing to confirm. An unmarked date goes straight to
  Update values, starting a recording there.
- **A date in a holding's own list of values** opens that date's
  Recording detail (`manage-accounts.md`, Account detail). This is
  where a typo from eight months ago is found.
- **A marked date on the chart** opens that date's Recording detail.
- **Update values** in the top bar goes straight into editing today
  (`app-shell.md`, The chrome). It is the fast path for the monthly
  act, and a page in front of it would add a step to what the product
  exists to make cheap.

**A converted figure** on every screen here is the figure on the unit's
rate line for its date where that line holds one, else the price at
its date (`record-rate.md`, Reading). Where that price is from an
earlier day, a price date line sits beneath, "priced 15 Jan 2024"
(`design-system.md`, Components). A unit with a rate source at the date
and no entry there, or without one and no price at or before the date,
reads **not priced**, never converted at another day's price and never
shown as the bare quantity.

### Update values

The sweep: one date, every holding that can be recorded against, on
one screen. It is how a routine update is done, and the highest-value
screen after the dashboard. It is also the editor for an existing
recording: Update on Recording detail lands here at that date, with
the same rows, order and rate lines, which keeps correcting a
four-year-old figure cheap.

#### Which recording you are in

**The date is the heading, never a control.** Changing the date is the
New recording button again. A date picker here would make starting a
recording and editing one the same gesture, and they are different acts
(Creating and reopening are distinct acts). **Delete is not on this
screen**, so an edit can never slip into a deletion.

**Arriving at the sweep from another screen begins a sitting**, by
Update, New recording or its address alike, so the sweep reads the date
as the vault holds it then. A date recorded since the last visit opens
as a reopened recording, never with what an earlier sitting there
showed. A redraw of the sweep on screen, and its return after a lock,
continue the sitting.

#### Nothing counts what is left alone

A partial update is the ordinary case. Four holdings this month and the
rest in March is a normal pair of sittings. The screen counts nothing,
scores nothing, marks no row as outstanding and never comes back to
rows that were left: no progress indicator, no "4 of 15", no summary of
what was skipped. There is no staleness threshold anywhere in the
product (`net-worth-view.md`, Current net worth). Each row states its
own age in words next to its control, with no chip and no warning
color.

#### Layout

Standard app shell, content max-width 900px. Top to bottom: the date as
the screen heading with a section label above it, one row per active
holding in one Card divided by hairline rules, then the rate block
under its own section heading in a Card of its own. Archived holdings
appear only on a reopened recording where one holds a figure at that
date.

**A row** carries the name, unit, what the holding holds now, its age,
the value field and one control, in three columns. The name holds the
fluid left column with the row's sentence and age beneath it. The
quantity field (`design-system.md`, Components) takes a 260px column,
its unit as the suffix and the converted figure right-aligned beneath.
The control fills a 112px column at the right, so every row's control
lines up whatever it reads. The converted figure uses this date's rate
line, whatever it holds: proposed, stored or typed (Screens).

**Every row states in words whether this date already holds a figure
for it.** The sentence, not the field, says where the reader stands.
The two states differ in wording and ink weight, never in color alone
(`design-system.md`, Accessibility):

- **Nothing recorded for this date.** The field carries the holding's
  last recorded figure as a starting point, in ink-secondary, with that
  figure's date beside it. The control reads **Confirm** while the
  field is untouched and **Record** once it is edited.
- **Recorded for this date.** The field carries the figure stored at
  this date, in ink-primary. The control reads **Save** and is inert
  until something changes. Clearing the field and saving deletes that
  entry. Only this state can delete, because only here does a record
  stand behind the field.

**A figure showing in a field is not a figure in the history.** Only
the row's control writes. A row is answered by typing a new number, by
**Confirm** (one click, "this is still the same", recording the same
quantity again at this date), or by leaving it alone (no entry, history unchanged). No row
ever asks about a price.

#### Confirm is one click, always

Confirm asserts the quantity only (Confirming a previous value), so it
is one click for a franc holding, a dollar holding, gold and the flat,
and still one click with the price provider down.

- **Disabled where the holding has never been valued.** The age reads
  "never valued" and the field is the row's only control.
- **On a reopened recording, for a holding silent that date**, Confirm
  records the figure the holding carried into that date, its last
  figure before then, not its newest. The row names that figure and its
  date, because "still the same" has to say what the same is.
- **There is no "confirm all".** Confirming asserts that someone
  checked, and asserting it for every holding at once makes that a lie.
  A holding nobody looked up needs no action, so such a button has
  nothing to do.

#### Archived holdings on a reopened recording

An archived holding has a row only where the recording holds a figure
for it, always in the recorded state, edited or cleared like any other
(Clearing a figure). **The archive's zero has no control**: it shows as
text in the field column, the control column stays empty, and the
row's sentence reads "Archived at zero on this date." It is read-only
until the holding is unarchived (`manage-accounts.md`, While archived).

#### Age, in plain language

"3 weeks ago", "about a year ago", "never valued". Relative, not a raw
date, because the question is how long the figure has been sitting, and
a date makes the reader do arithmetic. The age is the only mark a row
carries (`net-worth-view.md`, Dashboard, The estimated marker).

#### The rates, at the foot of the sweep

Below the rows, one line per unit anything in the vault is measured in,
for this date. In the ordinary case it is read, it is right, and the
sitting is over. **No row carries a price**, because a price belongs to
a unit and two rows could be typed differently for one day
(`record-rate.md`, Editing a captured rate). **The main currency has no
line.** There is nothing to convert.

Each line carries the unit's name with its pair, the figure, and its
provenance chip (Recording detail). While the block is at least 720px
wide the lines keep the rows' columns: the unit at the left, the figure
in the field column, the chip in the control column. That column
widens for a long chip on every line at once, so no field falls out of
line. Below 720px the lines stack: the unit's name with its pair, then
the field at full width, then the chip beneath in full.

Line states:

- **A published unit, with a proposal.** Arrives filled in. Where the
  provider's figure is for an earlier day (a weekend, a holiday, a
  publication lag), the line says which: "rate as of 29 Jul"
  (`rate-lookup.md`). It is written whether or not it was touched.
- **A published unit whose source did not answer.** The line stays
  empty and says so in ink-secondary, never an error color: "No market
  rate came back for USD. Nothing will be recorded for it for this
  date." The copy names the date, not today, because a backdated sweep
  asks about a past date. Every row in that unit reads not priced, and
  the dashboard's total carries on at the most recent price it has
  (`net-worth-view.md`, Current net worth). The line fills in as soon as
  the source answers. Nobody is asked to type a dollar price to record a
  franc holding. The last price is not written again under this date,
  because that would put a figure nobody published into the history
  under a date it was not published for, invisibly.
- **A unit only its owner can price** (free text, or a symbol the proxy
  has no provider for). Shows the last figure and when it was set,
  "estimated 14 months ago", and writes nothing unless changed
  (`record-rate.md`, The refresh). The copy names why and never borrows
  the outage wording. A symbol with no provider yet: "No market price
  for Silver, troy ounce yet. This one is yours to set." A free-text unit: "Nobody
  publishes a price for m2. This one is yours to set." A sourced unit in
  a vault whose main currency no source quotes into (`record-rate.md`,
  Reading): "No price source quotes in ARS, your main currency. This
  one is yours to set." With an earlier
  figure the sentence follows its age, "Estimated 14 months ago. Nobody
  publishes a price for m2. This one is yours to set.", and with none it
  follows "No price for m2 yet."
- **A published unit, on a date before its published prices begin**
  (gold in 2012). It has no rate source at this date, so it behaves as
  an owner-priced unit, and a typed figure is "Typed by you". No source
  is asked, so it never shows the resolving skeleton and never the
  outage wording. The copy names when published prices begin (the later
  of the unit's first published date and the main currency's), as
  Settings writes dates (`account-settings.md`, Dates and numbers) and
  always with its year: "Published prices for Gold, gram begin on 2
  January 2013. This one is yours to set." Where its starting price is from an
  earlier day: "Set on 30 June 2011. Published prices for Gold, gram
  begin on 2 January 2013. This one is yours to set." With no price at or
  before this date the line asks, in its own words: "What was 1 gram
  worth in CHF on 31 December 2012? Published prices for Gold, gram
  begin on 2 January 2013. The figure records either way, and until a price
  exists the holding is listed as not priced."
- **A unit with no price at all, where this sitting records a quantity
  in it.** A price is asked for, because twelve troy ounces with no gold
  price is not a figure. The line moves to the head of the block: "What
  is 1 PAINT worth in CHF? Nothing prices PAINT yet. The figure records
  either way, and until a price exists the holding is listed as not
  priced." A sourced unit in a vault whose main currency no source
  quotes into names that reason in place of "Nothing prices PAINT
  yet.": "What is 1 CHF worth in ARS? No price source quotes in ARS,
  your main currency. The figure records either way, and until a price
  exists the holding is listed as not priced." **It never blocks the
  row.** Blocking would let a provider
  outage stop somebody recording what they looked up, which this screen
  may never do.

Units, dates and the main currency in all copy are computed, never
written in.

**The rate lines have a save control only while this date holds a
recording.** At a date holding none, a typed price waits for the first
row recorded (`record-rate.md`, The write path), and from that row on
the save is offered. Leaving before then writes nothing, and the next
screen names the unit whose price was left (States).

#### Rate lines on a reopened recording

- The lines open on **the prices this recording wrote**, with their
  stored provenance, never a fresh proposal, and **opening asks the
  source about nothing it already holds a price for**
  (`record-rate.md`, Editing a captured rate).
- **A line that went in empty, for a unit with a rate source at this
  date**, says "No rate was recorded for Gold, troy ounce on this date." and
  carries its own **Look it up**. Opening fetches nothing. Pressing it
  issues the request and **saves what comes back at once**, with no
  further press and no confirmation, into this line and every other
  empty line of a published unit the answer covers. A line holding an
  entry or typed text is never touched. Each saved line reads as stored,
  labeled with the day its price is for. One the answer left out stays
  empty with its Look it up. One that did not save keeps the answer,
  is named in the banner, and the lines' own save retries it.
- **A line with no entry, dated before its unit's published prices
  begin**, reads as on a new sweep, offers no Look it up and never reads
  as an outage.
- **A rate line on a reopened recording saves by itself**, through Look
  it up or the lines' own save. Filling in a missing price needs no
  holding touched.
- **A price another window filled in meanwhile** is left as stored, and
  the banner says: "The USD rate was filled in another window, and the
  line shows what is stored now."

#### Changing or clearing a rate says what it moves

One confirmation per save that changes or clears a stored price, before
anything goes through, naming each such unit and how many holdings move.
Filling in a missing price asks nothing and is never called changing
one:

> Changing the USD rate for 31 July moves 3 holdings measured in USD
> on that date. Your net worth on that day changes with them.

Clearing says its own consequence, and where the entry is the unit's
only one, says that too:

> Clearing the Gold, troy ounce price for 31 July leaves that date with
> no price for it. 2 holdings measured in Gold, troy ounce move on that
> date.

> This is the only price recorded for Gold, troy ounce. Clearing it
> leaves every holding measured in it with no price at all, and they
> leave the total until one exists.

**The count is of holdings whose value on that date changes**: measured
in that unit, not archived before the date, holding a figure at or
before it, and not at zero that day. A holding archived earlier, first
valued later, or at zero (the archive's zero included) is worth nothing
that day whatever the price (`net-worth-view.md`, Archived holdings).

An edited line's provenance flips the moment it changes, to "Edited
from 0.931200", naming the figure it overrides. The proposed badge is
never silently kept.

#### At phone width

On a phone this screen changes shape rather than only narrowing. A
phone may walk through one holding at a time: the same sweep, not a
cut-down one (`app-shell.md`, What the client gets), because every
question it asks belongs to one holding or one unit. A row stacks into
one column: the name with its sentence and age, then the quantity field
with the converted figure and any price date line beneath it at the
left, then the control at full width. The rate lines stack by their own
rule.

#### Writes

- **Rows record one at a time as they are finished.** One
  `PUT /api/records/<uuid>` per holding, nothing batched, because no
  transaction spans two records (`record-api.md`). A failed row says so
  on itself and leaves the others alone, and the sitting can stop
  anywhere and keep every row acted on.
- **The prices go in with the first row recorded**, once per sitting,
  so stopping halfway still leaves the date priced. A sweep writes one
  set of prices and asks the proxy once, however many rows it records.
  The order, and a price write never failing a quantity write, are
  `record-rate.md`'s (The write path).
- **Open the sweep, act on no row and leave, and nothing is written**,
  rate lines included, whether the date was empty or held a recording,
  and even with a proposal on an untouched line.
- **A reopened recording saves one control at a time**, and no save
  spans a quantity, prices and deletions (`record-rate.md`, Saving at
  a date that holds a recording).
- No record shape changes for this screen. A confirmed figure is an
  ordinary entry.

#### States

- **Loading**: none. Everything comes from the in-memory model.
- **Empty, no holdings**: "Add a holding first", linking to the account
  form. No rate block.
- **Empty, an emptied recording reopened**: every row reads as nothing
  recorded, and the rate lines show the prices that keep the date. An
  ordinary state. Nothing suggests tidying it up.
- **Rate block still resolving**: an inline skeleton on the rate lines.
  Every value field stays usable, and typing never waits on a price.
- **Row, saved**: a quiet inline confirmation, and the figure, age and
  sentence update in place. The row does not disappear, because
  vanishing rows make a list jump under the cursor.
- **Row, invalid value**: the quantity field's own rules, inline.
- **Row, save failed**: inline, critical, the typed input kept, other
  rows unaffected.
- **Row, Conflict**: "This figure was changed in another window." The
  row reloads to the stored record and nothing is retried.
- **The holding was archived or deleted in another window**: the row
  saves nothing and leaves the screen, as it would from a sweep drawn
  now, and the banner says, critical:

  > Fund 2 was archived in another window. Nothing was saved.

  "deleted" for a holding that is gone (Creating and reopening are
  distinct acts).
- **The date became taken while you were working**: the save is refused
  whole and nothing is written (Creating and reopening are distinct
  acts). The wording is not an accusation:

  > 31 July already has a recording. Another window got there first.

  One button, **Open the recording**, to that date's Recording detail.
  What was typed is gone and is typed again there. No offer to carry it
  across, because a rescue that works only sometimes is worse than
  none.
- **The date was emptied while you were working**: another window
  deleted this recording before a rate-lines save. Nothing is written,
  and the screen reloads to a date holding nothing, with no rate-lines
  save. What was typed stays, on the lines and in the rows. A Callout
  under the date heading, with the critical icon:

  > Another window deleted the recording for 31 July. Your prices were
  > not saved. They are still here and are saved with the first holding
  > you record for this date.
- **A rate-lines save that landed in part**: the screen stays open,
  every line keeps its own state with what was typed still there, and
  the message names by unit what landed and what did not. Retrying
  reissues only what failed (`record-rate.md`, Saving at a date that
  holds a recording).
- **Closing with changes unsaved**: nothing blocks leaving, and there
  is no prompt to stay, because unsaved typing is the person's to
  abandon. The next screen carries a critical notice at its head naming
  what was left, by holding and by unit:

  > You left the recording for 31 July 2026 with changes that were not
  > saved: Current account, the USD rate.

  Nothing in the vault records a partial save, so the notice is the
  whole of it and does not come back.
- **Two entries on one date**: a holding or unit with two entries here
  shows both flagged, each with **Keep this one** (Recording detail,
  States).

#### Rules

- Nothing typed into a value field, and no price the person typed, is
  ever part of or triggers a price request, in any field or encoding
  (`rate-lookup.md`, Endpoint).
- Locking mid-sweep keeps what is typed and unsaved and discards
  everything else (`login.md`, Rules).

### Recording detail

One date and everything recorded at it: the figures entered and the
prices captured alongside. It is for looking. It answers "what did I put
in that day" and "where did that price come from", and it is the way
back into a sitting from years ago. Every route to an existing
recording lands here except the top bar's Update values. Starting a
recording never comes through here, because a date holding nothing has
nothing to look at.

#### Layout

Standard app shell, content max-width 900px.

- **The date is the heading**, the recording's name. Nothing beside it:
  no time of day, no author, no note of its own.
- **The figures**, one line each: the holding, the figure in its own
  unit, and the same figure converted (Screens). Both figures form
  columns, shown as `design-system.md`, Typography, sets them.
  - **The holding's name is the link**, opening that holding
    (`manage-accounts.md`, Account detail), because "which holding was
    that" is the question this screen provokes.
  - **An archive's zero is listed like any other figure**, and while
    its holding is archived Update offers no control for it.
  - **Holdings silent that day are not here.** Nothing counts or names
    them. Filling one in is an edit, after Update.
- **The prices**, one line each: the unit's name (`design-system.md`,
  Units), the price, and where it came
  from. **This screen owns the provenance vocabulary**, used wherever a
  price's origin is shown, the sweep's rate block included. Each is a
  chip (`design-system.md`, Components) beside the figure:

  | Stored as | Chip | Meaning |
  |---|---|---|
  | `proposed` | "Market rate", or "Market rate as of 29 Jul" where the provider's figure is for an earlier day | the app proposed it and nobody changed it |
  | `edited` | "Edited from 0.931200", naming the proposed figure, written as a price is (`design-system.md`, Figures) | the app proposed it and the person changed it |
  | `manual` | "Typed by you" | nothing was available, so the person supplied it |

  Provenance is stored (`record-rate.md`, Record shape), so a price says
  where it came from a year later exactly as on the evening it was
  written.
- **Update**, primary, opens the sweep for this date holding what was
  recorded. Everything possible on the evening is possible again.
- **Delete**, destructive (Delete).

**Nothing on this screen contacts a price source**, however old the
date. A screen that repriced March by being opened is the one thing it
must not be.

#### At phone width

Up to 900px wide, the figures and the prices become lists. A line
holds the holding or the unit first, wrapping anywhere it must, then its own figure at the left
and the converted figure or the provenance chip at the right, then any
fault with Keep this one on a line of its own. The two figures share a
line when they fit and otherwise each takes one, never broken inside a
figure. Every control in the lists is a 44px target, and nothing on the
screen pans sideways.

#### Delete

**Delete lives here and nowhere else**, so the screen somebody types
into holds no button that destroys a date (Deleting a recording). One
confirmation, naming what makes it destructive, with the confirm button
filled critical inside the Dialog, no ladder and no typed word:

> **Delete the recording for 31 July?**
>
> Every figure recorded that day goes, and so does every price captured
> with it. 9 holdings measured in USD and Gold, troy ounce move on
> that date, including ones you recorded nothing for. This cannot be
> undone.

Where the date holds the zero of a holding archived on it, that zero
stays and the confirmation adds:

> The zero recorded when you archived Savings account stays, and so
> does this recording, holding it.

The count, units and archived holdings' names are computed. The
sentence naming units is dropped where the date carries no prices. The
first sentence follows what the date holds:

- **No figures**: "It holds no figures, and the prices captured that
  day go with it."
- **Archives' zeros and nothing else among its figures** (as an archive
  that started the recording leaves it): "Only the prices captured that
  day go." The zero sentence follows.

A date holding archives' zeros and no prices offers no Delete, because
there is nothing it could remove. Afterwards the date is gone from every
holding's list and every unit's prices. A date keeping an archive's zero
stays a recording holding it, and this screen reloads to it.

#### States

- **Loading**: none.
- **Empty recording**: the figures section is replaced by "No figures
  recorded on this date", and the prices are listed as always, because
  they are why the date is still here. Update and Delete both work. It
  reads as an ordinary recording. Nothing calls it incomplete, offers
  to tidy it, or suggests deleting it.
- **No prices at this date**: the prices section says so in one
  sentence. A vault holding only the main currency reaches this on
  every recording, and it is not a fault. Where a unit has no price
  because the source did not answer that day, the section names the
  unit and says its line is empty, to be filled after Update.
- **Error, two entries at this date**: two figures for one holding, or
  two differing prices for one unit (Moving the date onto an occupied
  date, `record-rate.md`, Two entries on one date). Both are rendered,
  flagged critical, with a line naming the fault and **Keep this one**
  on each. The app picks neither, and the chart leaves that date out
  of its interpolated series until answered.
- **Error, delete landed in part**: nothing is rolled back and nothing
  marks the date half deleted. The screen reloads to what is left,
  names it, and offers Delete again.
- **Error, delete failed outright**: inline, critical, the recording
  unchanged.
- **Error, the recording is gone**: another window deleted this date.
  The screen says the date holds no recording and offers the date
  picker. It never renders a shell of a recording that is gone.

#### What it deliberately does not show

- **No price lookup**, at any age, by any control.
- **No way to change the recording's date.** Moving one entry is an
  edit of that entry, from the holding's own page.
- **No editing in place.** Every change happens after Update, where the
  holdings a price moves are the rows on screen.
- **No price timeline**, here or anywhere (`record-rate.md`, Editing a
  captured rate).

#### Rules

- Opening this screen issues no write and no price request, and every
  record at the date is byte-identical afterwards.

### Snapshot entry

One holding, one date: the small form for what the sweep is not for,
an odd date, a March figure found now, years of old statements being
backfilled. It writes the same thing the sweep does. The converted
figure updates as you type, because that is the number being reasoned
about.

#### Layout

An ordinary Dialog (`design-system.md`, Components), reachable from any
holding's row on the dashboard and from the holding's own screen. The
same Dialog, prefilled, edits an existing entry (`manage-accounts.md`,
Account detail).

- **Heading**, naming the act: "Record a value for Savings", with the
  holding's name, for a new figure, and "Edit this value" for a stored
  one.
- **Holding**: preselected when opened from a row, otherwise a select.
  Static when editing, because a value is denominated in one holding's
  unit.
- **Date**, the Date field (`design-system.md`, Components), defaulting
  to today, its upper limit today with the field's default reason.
  Editable when correcting an entry, and limited further for an
  archived holding's entry (Editing an existing entry).
- **Value**, the quantity field, the largest thing on the form. Its
  live result converts for **the date on the form**: the date's own
  price where one exists, else the proposal for that date, else the
  price at that date (Screens).
- **Note**: optional, collapsed behind "Add a note".
- **The prices line**, folded, below.
- Primary **Save**.

**There is no rate field on this form.** A price belongs to a unit, not
a holding. The prices this save writes are on their own line, which is
about the date.

#### The prices line

Recording writes the date's prices as the sweep does (`record-rate.md`,
The refresh), so the form says what it is about to write. One folded
line, ink-secondary, opening into the same rate lines the sweep carries:

- **A date holding no recording**: "Prices for 31 July will be recorded
  with this", opening to the proposals. A 2019 figure takes 2019's
  prices. Changing a line here is the same act as on the sweep, with
  the same announcement of what it moves.
- **A date that holds a recording**: "31 July already holds prices.
  This figure joins them." It opens to that recording's stored prices,
  read only, with a link to its Recording detail, where they are
  changed. No stored price is looked up or rewritten.
  - **A unit the date is missing is filled in**, as on the sweep. Its
    line is looked up and offered like a line on an empty date, and the
    save writes it behind the figure. A date whose prices are complete
    asks the source nothing. The folded line adds: "The prices it is
    missing will be recorded with this."
- **A holding in the main currency** still writes the date's prices for
  every other unit. That is the case the split exists for, and the line
  says so rather than being absent.

Opened, the rate lines always stack, because the Dialog's content box is
416px, below the 720px the sweep's columns need. Every unit's full
name, price and whole provenance show at any window width, with nothing
overlapping or cut off. A chip never exceeds its container and its text
wraps rather than clipping.

#### Editing an existing entry

The same Dialog, prefilled with the stored value, date and note.

- **Changing the value or the note touches no price** (Editing an
  existing snapshot). The prices line reads, folded or not, as the
  date's stored prices, read only.
- **Changing the date records the figure at its new date**. The prices
  line follows the date at once, in the same states as for a new
  figure: proposals fetched for a date holding no recording, the
  missing lines filled for a date holding some, and the stored prices
  read only where nothing is missing. Picking the entry's own date
  again shows its stored prices and fetches nothing. No stored price is
  rewritten.
- **An archived holding's entry moves only to a date before its archive
  date.** Onto the archive date the move would displace the zero, and
  after it the entry would be a figure after the archive
  (`manage-accounts.md`, While archived).
  - The grid disables every day from the archive date on.
  - A typed date on or after it is refused, after today included, on
    the date field's message line:

    > Archived on 12 March 2026. Enter an earlier date.

  - From the moment the Dialog opens, the message line carries the hint
    "Archived on 12 March 2026." in ink-secondary. The date follows
    Settings and always carries its year.
  - Value and note stay editable. The archive's zero itself never opens
    here.

  An entry on a holding that is not archived has no hint, and its
  message line stays reserved, so a refusal never shifts the form.

#### States

- **Proposals in flight**: an inline skeleton on the folded prices line.
  The value field is usable at once, and saving never waits on prices.
- **A price source is unavailable**: the affected line says so in
  ink-secondary, nothing is written for that unit, and saving is never
  blocked (Update values owns the line states).
- **Prices did not save**: the entry is saved and the message says the
  prices were not updated, naming any unit the person typed. The entry
  is never rolled back for it.
- **A move whose prices did not save**: the entry has moved, and the
  Dialog stays open on it, the message above Save critical with its
  icon, naming every unit that did not save:

  > Moved to 10 April 2026. The prices for USD and Gold, troy ounce on
  > that date did not save.

  One unit reads "The price for USD on that date did not save." Units
  are computed. One button, **Open the recording**, goes to that date's
  Recording detail, where empty lines are filled after Update. Save is
  inert until something changes.
- **Duplicate date, entering**: on save, a confirm rather than a
  rejection: "You already recorded USD 12,450.00 for 31 July. Replace
  it?", naming the stored value in the holding's own unit (Same
  holding, same date: upsert). Confirming updates in place. Declining
  leaves the original untouched and returns to the form.
- **Duplicate date, moving**: different copy, because a second record
  dies: "30 July already holds a snapshot of USD 12,100.00. Moving this
  entry there will delete it." Destructive styling on the confirm
  (Moving the date onto an occupied date).
- **The date became taken while you were working**: refused whole,
  nothing written, copy as on Update values, one button opening that
  recording.
- **The holding was archived or deleted in another window**: nothing
  written, and the Dialog says so above Save, with **Done** alone,
  which closes it:

  > Fund 2 was archived in another window. Nothing was saved.

  A move reads "Nothing was moved.", and a holding that is gone
  "deleted".
- **Validation**: the quantity field's and the Date field's own rules
  (Refusing a date).
- **Archived holding**: the entry point does not exist for it, at any
  date.
- **Saved**: the Dialog closes and the dashboard updates from local
  state with no refetch.
- **Closing with changes unsaved**: by Cancel, by Escape, or by a link
  that opens a recording. Nothing blocks leaving and nothing is
  written, as on the sweep. The screen the form closes onto, or the
  recording it opens, carries a critical notice at its head naming
  what was left:

  > You left the entry for 31 July 2026 with changes that were not
  > saved: Current account, the USD rate.

  - The holding is named when its value or note differs from what the
    form opened with, or when an existing entry's date was changed.
  - A unit is named, as "the USD rate", when its line was changed.
  - The date is the one on the form, or an existing entry's stored
    date. A new figure whose date does not read reads "You left the
    entry with changes that were not saved: ...".
  - Once a save writes the figure, closing names nothing, because the
    form's own message already named what did not save.
  - A lock is not leaving: the form comes back after the unlock with
    what was typed and no notice (`login.md`, Rules).

  The notice is shown once and never stored.

## How it works

### Record shape

`record_type: "snapshot"`, with the plaintext `account_id` set to the
owning holding. Decrypted payload, with no price field of any kind:

```json
{
  "date": "2026-07-31",
  "value": "12450.00",
  "note": null
}
```

- **`value` is a decimal string, never a JSON number.** Every quantity
  in the product (value, price, total) is parsed into a **`BigInt` at a
  fixed scale of 12 decimal places**, computed on as an integer, and
  formatted back to a string. No IEEE-754 float touches one, and no
  decimal library is used.
  - **One scale for every quantity.** Scale 12 covers a looked-up price
    (`rate-lookup.md`, Providers), a holding in troy ounces or m², and money at
    two. "Integer minor units" means nothing for a price or for 12.5
    troy ounces, and a scale factor per quantity would be a worse
    decimal library written here.
  - **Multiplication rescales once**: the product of two scale-12 values
    is scale 24, divided back by 10¹² with **round-half-even**.
    Addition and subtraction need no rescale, so a sum of snapshots is
    exact by construction.
  - **Division** happens in two places only, per-holding interpolation
    and the change percentage (`net-worth-view.md`, Values between
    entries and The change), and rounds half-even at scale 12. Display
    rounding is a separate later step on a figure already exact at
    scale 12. The percentage view's shares are no figure: they place
    the drawing, in floats like the rest of its stack, and its ticks are
    exact integers (`net-worth-view.md`, Value ticks).
  - A decimal library is rejected on the grounds a charting library is:
    it supplies rescaling and a rounding mode, the helpers above,
    against one more file to self-host, pin, hash and re-verify inside a
    page that handles the password (architecture.md, Supply chain).
  - A value with more than twelve decimal places is refused at input,
    never truncated.
- **`value` keeps the fraction digits it was typed with**, in canonical
  form `-?(0|[1-9][0-9]*)(\.[0-9]{1,12})?`, with no sign on a zero.
  Typed `12.50` is stored `"12.50"`, `007` is `"7"`, `.5` is `"0.5"`,
  `12.` is `"12"` and `-0.00` is `"0.00"`. The digits typed are the
  precision measured, and the display shows them back
  (`account-settings.md`, Dates and numbers). Arithmetic reads the same
  string at scale 12. Reading never rewrites a value.
- `date` is a calendar date, `YYYY-MM-DD`, no time and no timezone.
- `note` is optional free text, `null` when unset.

A holding's contribution to net worth is `value` times its unit's
price, which `net-worth-view.md` selects from the price timeline.

### Flow

1. Pick a holding and a date (default today).
2. Enter the value. The converted figure shows live (Screens).
3. The client encrypts and `PUT`s the record.
4. On success, the date's price entries are written (`record-rate.md`,
   The write path).

The value is never sent anywhere before it is encrypted. The total and
the chart reflect the write from local state at once, with no refetch.

### Same holding, same date: upsert

**One snapshot per (holding, date).** Entering a value for a date that
has one prompts with the stored value in the holding's own unit, and on
confirm updates that record in place: same `record_id`, `version` + 1,
fresh nonce.

Duplicate detection is client-side: the client already decrypts every
snapshot, and the server cannot see dates. Record ids stay random
UUIDv4, because ids derived from the date would let the server
brute-force which dates hold data.

**The prompt fires only where the stored figure is not already shown in
the field being edited**, which is the single-holding form, where the
date is chosen blind. It does not fire in a reopened recording, nor in
the archive dialog, which names the figure its zero replaces before its
own confirm (`manage-accounts.md`, Archiving).

### Confirming a previous value

Confirming writes an ordinary snapshot: new `date`, new `record_id`, and
the stored `value` string character for character, never the field's
text parsed again, so a confirmed figure is never rounded or
reformatted. No new field.

**Unchanged is decided on stored forms.** A field is untouched while its
text equals its prefill (`account-settings.md`, Dates and numbers),
which keeps a sweep row on Confirm and a recorded row's Save inert. An
edited field is parsed and compared with the stored `value` as strings,
not numbers, so `12.50` typed over a stored `"12.5"` is an edit and
writes `"12.50"`.

**Confirming asserts the quantity only.** What gold has done since is
the price timeline's business, refreshed by the act of recording
whether or not anything was confirmed (`record-rate.md`). So confirming
has no cases and no branch by unit. It is unavailable for a holding
with no snapshots.

### A recording is a date

A recording is one date and every record of the vault owner bearing it,
quantities and prices together, on one screen where each can be
changed, added or cleared.

**Nothing stores a recording.** There is no fifth record type and no
grouping record. A recording is a client-side index over the model in
memory (`net-worth-view.md`, Data flow): snapshots and price entries
grouped by their own `date`. A grouping record is rejected because:

- Every fact it could hold is already on its members. The uniqueness
  rules, one snapshot per (holding, date) and one entry per (symbol,
  date), already pin its identity.
- It could disagree with its members. A member deleted from the
  holding's page, written by a second session, or moved to another date
  would leave it naming records that are not there. A derived index
  cannot be wrong about its contents.
- Its own `version` would make two sessions recording one date lose a
  concurrency check on a record neither cares about.
- It would need deleting with its last member, a cascade the server
  cannot run because it cannot see a date.

Consequences:

- **A recording exists exactly as long as a record carries its date.**
  Clear every quantity and the prices still carry the date. Delete
  every record at the date and it is gone, with no tombstone.
- **A recording has no version and cannot conflict as a whole.**
  Concurrency stays per record (`record-api.md`).
- **It has no author, no wall-clock time and no note.**
- Export carries recordings by carrying their members
  (`export-import.md`), with no format change.

### Reopening and editing a recording

Saving a reopened recording covers, in any combination:

1. **Changing a quantity** at that date: a versioned update of that
   snapshot, same `record_id`.
2. **Adding a quantity** for a holding with none at that date: a create
   at a fresh UUIDv4 and `version: 1`. Nothing distinguishes adding it
   now from having recorded it then.
3. **Changing a price** at that date (`record-rate.md`, Editing a
   captured rate).

Each is saved by its own control, and no save spans them. Write order
and partial failure are `record-rate.md`'s (Saving at a date that holds
a recording).

**Opening a recording writes nothing and fetches nothing**: no version
bump, no nonce, no price request, even with an empty rate line, which
asks only when Look it up is pressed. Reading history is a read.

**A recording's date does not move.** The date is its identity, and a
whole-date move onto an occupied date would have to resolve a collision
per holding. Moving one entry stays an edit of that snapshot from the
holding's page.

**Two doors reach one snapshot.** The holding's page edits one entry
across its history and can move its date (`manage-accounts.md`, Account
detail). A recording edits one date across every holding and cannot.
Both are the same versioned write, so neither door needs to know about
the other.

#### Creating and reopening are distinct acts

A recording is **created** at a date holding none of the owner's
records, or **reopened** at a date holding some. **A create never
becomes an update behind the person's back.**

**Which happens is routing, decided before anything is typed.** Picking
a date the model already holds records for opens its Recording detail,
with no request and nothing created. Every record is fetched on unlock
and kept in memory (`net-worth-view.md`, Data flow), so the dates
holding a recording are the index itself, and a picker over it costs no
request. A record that cannot be decrypted carries no readable date,
belongs to no recording, and is counted in the dashboard's decryption
warning instead. The refusal below is for a stale choice: a date that
became occupied after the client read its model, which only another
session can cause.

- **A create at a date another session has since recorded fails**, and
  so does a create inside a reopened recording whose slot another
  session filled. It does not become an update, merge, or retry. The
  person is told the date was recorded elsewhere and reaches it through
  reopening.
- **The replace prompt is a different case**: the stored figure is put
  in front of the person before anything is written. That is consent,
  not a collision.
- **The check runs against freshly reloaded records**, never the model
  in memory. Before the first record a sitting creates at a date, the
  client reloads the types it will create in
  (`GET /api/records?type=snapshot` and `type=rate`, the reload
  `record-api.md` prescribes) and re-checks. A session open since the
  morning is exactly the one whose model says the date is free.
- **A sitting that creates nothing runs no reload.** Changes and clears
  are updates under the version rule, which catches another session on
  those records. Adding a holding with no record at the date is a
  create and brings the reload, as does a date move.
- **A row's create reloads once per sitting.** After the first reload
  the date belongs to this session against creates: another session's
  create there is refused by its own reload. A sweep costs one extra
  pair of `GET`s however many rows it records. A quantity makes a
  recording legitimately, so a row's create needs no check that the
  date still holds one.
- **The rate-lines save reloads on every save that creates an entry,
  claimed date or not**, one pair of `GET`s per save, because a typed
  price alone never makes a recording and only a fresh reload shows the
  date emptied (`record-rate.md`, The write path).
- **Every figure created for a holding, and every date move, first
  reads the holdings afresh** (`GET /api/records?type=account`), claimed
  date or not, because a sitting can outlive an archive made in another
  window (`manage-accounts.md`, While archived). A create is refused
  when the holding is now archived or gone, at any date, and a move
  when it is gone or archived on or before the new date. Nothing is
  written, and the model takes the holdings, snapshots and rates as
  they now stand. The holdings read comes before the date's reload.
- **A reload after the claim judges the slots only.** The session's own
  records are at the date, so finding the date recorded does not refuse
  it. It refuses a slot the save would create that is taken and, for
  the rate-lines save, a date holding no record at all.
- **A save is refused whole** when the reload finds the date recorded
  elsewhere or any slot it would create taken. Nothing is written, not
  even into free slots, because writing half a screen against a date
  the person has not seen is worse than writing none.
- **Look it up on a reopened recording is a narrower case too**
  (`record-rate.md`, Saving at a date that holds a recording). It runs
  the same reload of both types on every press, writes nothing at a
  date found holding no record, and leaves a price slot taken since to
  the entry there, while writing the free ones.
- **The archive is the other narrower case** (`manage-accounts.md`,
  Archiving). It runs the same reload of both types once, and is
  refused only when the archived holding's own slot at the date is
  taken. A date recorded elsewhere is the recording its zero joins, and
  a price slot taken since is one its refresh leaves alone.
- **What was typed is lost, and that is accepted.** No draft buffer, no
  merge, no re-apply. The screen reloads to the recording as it stands.
  Two sessions recording one date is rare in a single-owner vault, and
  retyping is cheap next to machinery to avoid it.
- The server cannot make this check. It cannot see a date, and ids are
  random, so one per slot is a client rule the reload enforces.

#### Clearing a figure

A quantity cleared in a reopened recording **deletes that snapshot**.

- **Only a field backed by a record at that date can be cleared.**
  Emptying a field prefilled from another date deletes nothing. The
  stored record decides whether a record dies, never the prefill.
- An empty field that was already empty writes nothing.
- **Clearing a quantity clears no price** (Edge cases, deleting a
  snapshot).
- **Clearing every quantity leaves a recording with its prices
  intact**, an ordinary state, the same when every quantity was deleted
  or moved away. Those prices are still true of that day and still
  price the dates around it (`net-worth-view.md`). The recording
  reopens with its rate lines and takes a value again later. A typed
  price alone never makes a recording (`record-rate.md`, The write
  path), so an empty recording is always one somebody emptied. It
  appears in no holding's list of values, and the date picker, which
  marks it like any other, is the way back to it.
- **Clearing is an ordinary edit**, with no more confirmation than any
  save. Destroying a date is its own action.
- **A `DELETE` answering Not Found counts as done.** The record is gone,
  which is what was asked.
- **An archive's zero cannot be cleared** while its holding is archived
  (`manage-accounts.md`, While archived).

#### Deleting a recording

A separate action (Recording detail, Delete) removes **every record
bearing that date**, snapshots and price entries together. It is the
only thing that removes a date and the only way a date becomes free.

- **It cannot be restored.** There is no undo and no server-side copy.
  An exported file is the only way back, if one was made.
- Ordinary `DELETE` requests, one per record, with no transaction
  spanning them, like the deletions in a save. Quantities go first and
  prices after, so a run that stops partway leaves the date priced
  rather than leaving quantities nothing can value.
- **A partial delete leaves a recording, not a broken one.**
- **The date is free afterwards** and is recorded again as though it
  never had been, unless an archive's zero keeps it.
- **An archive's zero stays.** The zero of a holding archived on that
  date is not deleted, and the date remains a recording holding it
  (`manage-accounts.md`, While archived).
- **It moves the chart further than clearing values.** Removing the
  date's price entries reprices every holding in those symbols across
  the stretches those entries anchored, not only the holdings recorded
  that day, and the chart runs across the date as though the sitting
  never happened. The confirmation says so, and `net-worth-view.md`
  bounds the stretch.

### Editing an existing snapshot

Value, note and **date** are editable, from the holding's page
(`manage-accounts.md`, Account detail). Editing is a versioned write of
the same `record_id`. An archived holding's entries are limited further
(`manage-accounts.md`, While archived).

**Changing the value or the note touches no price**: none fetched, none
written, no proposal, and no pre-create reload. A price is a separate
record, edited in its recording.

**Moving the date is recording the quantity at its new date.** The entry
leaves its recording and joins or starts the one at the new date, and
prices behave as for a figure added there on the single-holding form:

- **The refresh runs over the new date**, covering the moved entry's
  own unit (`record-rate.md`, The refresh). With the new date's prices
  complete it issues no request to `/api/rates`.
- **No stored price is rewritten.** Entries at the new date stand, and
  the date left keeps every price, for the reason deleting a snapshot
  deletes none (Edge cases).
- **A move that leaves its symbol without a price still saves.** With
  the source not answering, nothing is written for that symbol and the
  entry reads not priced at its new date, on the recording and the
  holding's page, until that date has an entry. It never borrows the
  price of the date it left or any earlier one. The exception is a new
  date before the symbol's `since`, where the symbol has no rate source
  (`record-rate.md`, Reading): no request asks about it, and the entry
  takes the newest price at or before its new date, with that price's
  date.
- **The Dialog shows the new date's prices as soon as the date
  changes** (Snapshot entry, Editing an existing entry).
- **Order: the snapshot `PUT`, then the rate `PUT`s, then the displaced
  record's `DELETE`.** The quantity goes first and gates the prices, as
  on every recording (`record-rate.md`, The write path). The deletion
  runs after every rate `PUT` has answered, so a move that fails partway
  has destroyed nothing. A failed rate `PUT` skips nothing after it, and
  the Dialog reports the entry moved and names each symbol whose price
  did not land.
- **A move claims its new date first**, by the pre-create reload, and is
  refused whole on the same terms before its `PUT`. The snapshot keeps
  its `record_id` but takes the holding's slot at the new date as a
  create would, so that slot counts as one the move creates unless it
  holds the record the move's confirmation named for deletion.
- **A move's sitting begins when the Dialog shows the new date.** A
  date that held no record then is one the move would start, so a
  reload finding any record there refuses the move, even with every
  slot it would take free. A date that held records then is one the
  move joins, and only its slots are judged.

#### Moving the date onto an occupied date

This destroys a record, unlike the upsert, which replaces the one being
written, so its confirmation reads differently (Snapshot entry, States).

**Write, then delete.** No transaction spans two records. Delete-first
risks losing the displaced record while the `PUT` fails, leaving a hole.
Write-first risks a moment of two snapshots on one date, harmless
server-side because one per date is a client rule, and visible to the
client.

**Two snapshots on one date is reachable, and is surfaced, never
silently resolved.** Two paths reach it, and no third:

- **A date move whose `DELETE` failed.**
- **Two sittings whose first creates cross inside the reload window.**
  The pre-create reload refuses every collision older than one round
  trip. Two creates crossing inside it each carry a fresh UUIDv4 at
  `version: 1`, so neither loses a version check, and the server has
  nothing to refuse.

A client that finds a pair takes no guess, not the highest `version` and
not the latest `updated_at`. It renders both, flagged, in the holding's
history and in that date's recording, with an action to keep one, and
excludes that date from interpolation until resolved, because there is
no correct curve through two values. A visible fault beats a quiet
wrong number, as with a decryption failure.

### Refusing a date

A snapshot's date is typed into the Date field (`design-system.md`,
Components) on every form that writes one, with that field's refusals,
copy and accessibility. The limit is today, because a snapshot describes
what was. An archived holding's entry has a tighter one (Snapshot entry,
Editing an existing entry).

- A refused date is refused on the date field's own message line, with
  the reason for what refused it. The field supplies the reasons for
  empty and unparseable text, the screen the reason for its limit.
- **Save asks the field whether its value is valid.** On a refused date
  it shows the refusal again and writes nothing. It never treats
  unparseable text as an empty date, which would give the wrong reason.
- **The Dialog's general error line never carries a date refusal.** It
  reports only the outcomes of a save, and a reason away from its field
  leaves the person searching for the wrong field.
- The refusal clears as soon as the value fits, before Save.

### Inputs / outputs

- In: holding, date, value, optional note.
- Out: an encrypted snapshot via `PUT /api/records/<uuid>`, and the
  date's price entries behind it (`record-rate.md`).

## Edge cases

- **No price is available for the unit** (the provider is down,
  rate-limited or has no data, the unit is free text nobody priced, the
  date precedes the unit's `since` with nothing typed at or before it,
  or the rate line was left empty): **the quantity saves.** Nothing in
  the price half ever blocks a quantity, in any form: no disabled save,
  no required price field, no warning to dismiss. The line says nothing
  was written for that unit, and the holding is listed as not priced
  rather than counted wrong (`record-rate.md`, The refresh).
- **Future date**: refused on the date field.
- **Date before the holding's `createdAt`**: allowed. Backfilling is
  normal.
- **Editing a past snapshot**: allowed, versioned. The AAD's `version`
  binds each ciphertext to its version, so the server cannot pass an
  old blob off as current. It does not prevent a rollback: re-serving
  an intact earlier `(ciphertext, version)` pair decrypts cleanly,
  because the client holds no record that a later version existed.
  Catching that needs the DEK-authenticated manifest architecture.md
  does not ship (Threat model). No test asserts rollback is detected.
- **Deleting a snapshot**: allowed, one confirm, from the holding's page
  or by clearing its figure in its recording, except an archive's zero.
  Deleting a holding's only snapshot leaves it with no current value,
  excluded from the total rather than counted as zero. No price entry
  goes with it: a price belongs to a symbol, not to the holding that
  prompted it.
- **Zero**: valid, a closed-out position, not the same as no snapshot.
- **Negative**: valid. Mortgages and loans are holdings with negative
  balances, and net worth is a signed sum.
- **Non-numeric or malformed value**: inline validation, no submission.
- **Recording against an archived holding**: blocked at every entry
  point and date, a screen drawn before the archive included. The archive's own zero is no exception, because it is
  written while the holding is still active, before `archivedAt` is set
  (`manage-accounts.md`, Archiving).
- **Two windows entering the same value, or editing the same
  recording**: neither loses a write without saying so. The second gets
  a Conflict and reloads.

## Acceptance criteria

1. A recorded value shows in the total and the chart at once, from
   local state, with no reload. Test:
   `tests/browser/parts/snapshot-entry.mjs`.
2. The converted figure is visible while the value is typed, before
   anything is saved. Test: no test.
3. Recording stores one `snapshot` record whose plaintext columns carry
   `account_id` and no date or value, and whose payload carries no
   price field. Test: `tests/test_client.py::test_the_client_side_rules_hold`.
4. `value` round-trips as an exact decimal string, identical on any
   machine, and `"0.1"` plus `"0.2"` in a total is `"0.3"`. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
5. (blind) Multiplying two scale-12 values rounds half-even at the
   twelfth decimal, asserted on a value exactly on the midpoint in both
   directions (any other case also passes round-half-up). Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
6. A value with more than twelve decimal places is refused at input,
   not truncated. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`,
   `tests/browser/parts/snapshot-entry.mjs`.
7. Typed `12.50`, `007`, `.5`, `12.` and `-0.00` store `"12.50"`, `"7"`,
   `"0.5"`, `"12"` and `"0.00"`, and every stored `value` matches the
   canonical form with no signed zero. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
8. (blind) A snapshot stored as `"12.5"` reads `12.5`, and displaying
   it, opening its recording and confirming it at a new date leave its
   own record byte-identical, compared byte for byte. Test:
   `tests/browser/parts/update-values.mjs`.
9. Saving the single-holding form at a date that holds a snapshot asks
   to replace it, naming the stored figure in the holding's unit, and
   confirming leaves one record for that (holding, date) at `version` +
   1 under a different nonce. Test:
   `tests/browser/parts/snapshot-entry.mjs`.
10. Declining the replace prompt leaves the original record untouched.
    Test: `tests/browser/parts/snapshot-entry.mjs`.
11. (blind) Editing inside a reopened recording never shows the replace
    prompt, while the single-holding form at an occupied date still
    does. Assert both directions. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/snapshot-entry.mjs`.
12. Zero and negative values are accepted, round-trip and count in the
    total. Zero is a closed-out position, distinct from never valued. A
    holding with no snapshots is excluded from the total. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
13. No request issued while recording, on the sweep or the form,
    contains the entered value, in any field or encoding. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/snapshot-entry.mjs`.
14. With the rate proxy down, the value still saves, every row still
    records, nothing is written for that unit, and the line says so
    quietly rather than blocking. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/snapshot-entry.mjs`.
15. (blind) A quantity in a unit with no price at all, none typed, saves
    with the save control live throughout, writes one `snapshot`, and
    the holding is listed as not priced. Asserted for a free-text unit,
    a symbol whose lookup returned nothing, and gold before its `since`
    (the case that looks like a listed symbol with a source). Test:
    `tests/browser/parts/update-values.mjs`.
16. A holding in a unit you made up triggers no lookup, gets no entry
    from a recording, and its line says why the price is yours to set.
    Test: `tests/browser/parts/update-values.mjs`.
17. On a date before a published unit's prices begin, its line says when
    they begin and that the price is yours to set, starts from the last
    price before that date, asks for one when there is none, triggers no
    lookup, and never reads like a source that did not answer. Test:
    `tests/browser/parts/update-values.mjs`.
18. A holding measured in the main currency shows no price anywhere, and
    the main currency has no rate line. Test:
    `tests/browser/parts/update-values.mjs`.
19. A rate published later changes no recorded figure and no chart point
    before today. Nothing the app does on its own rewrites a stored
    price. Test: no test.
20. (blind) A row not acted on produces no entry: leave most rows of a
    sweep alone, save the rest, and those holdings' record sets hold no
    snapshot at that date, asserted against the record sets and not the
    sweep's report. A prefilled figure nobody confirmed appears nowhere.
    Test: `tests/browser/parts/update-values.mjs`.
21. Two sweeps covering different halves of the holdings leave entries
    only for the halves covered, and neither is treated as unfinished.
    Test: no test.
22. Nothing on the sweep counts, scores, flags or later mentions how many
    holdings were left alone. Test: no test.
23. Recording one franc holding writes a price entry dated that day for
    every published unit in the vault, touched or not, and none for the
    main currency. Test: `tests/browser/parts/update-values.mjs`.
24. On one sweep, an untouched rate line is written and an untouched
    holding row is not. Test: `tests/browser/parts/update-values.mjs`.
25. (blind) Opening the sweep, acting on nothing and leaving writes
    nothing, prices included, whether the date was empty or held a
    recording. With a price typed at a date holding no record and no row
    recorded, leaving leaves no record of any kind at that date,
    asserted against the record sets. Test:
    `tests/browser/parts/update-values.mjs`.
26. Backfilling a figure dated in March writes March's prices, not
    today's. Test: `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/snapshot-entry.mjs`.
27. A unit only you can price keeps its figure and date however many
    times something else is recorded. Test:
    `tests/browser/parts/update-values.mjs`.
28. A date before the holding was created is accepted. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
29. A price's provenance (proposed, changed with the proposal still
    shown, typed) reads the same a year later, whether it was changed on
    the evening or years afterwards. Test:
    `tests/browser/parts/update-values.mjs`.
30. Changing a price on a reopened recording is announced before it goes
    through, naming how many holdings move, and moves every holding in
    that unit on that date, visibly the rows on screen. Test:
    `tests/browser/parts/update-values.mjs`.
31. No screen lists prices on their own or lets one be changed away from
    the recording that wrote it. Test: no test.
32. Opening a date that holds a recording shows every figure recorded
    for it, including other sittings that day, and starts no second
    recording. Test: `tests/browser/parts/recording-detail.mjs`.
33. Correcting a figure from months ago moves the chart only between
    that entry's neighbors. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
34. (blind) Opening a recording of any age, its own screen or its sweep,
    issues no `PUT`, no `DELETE` and no request to `/api/rates`, and
    every record at that date is byte-identical afterwards. With an
    empty rate line present, the request fires only when Look it up is
    pressed (a stub that answers passes whether it fired on open or on
    press). Test: `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/recording-detail.mjs`.
35. A line left empty because no price came back says so on the
    reopened recording and offers Look it up, whichever way the recording
    is reached. A line holding a price never offers it, nor one dated
    before its unit's published prices.
    Test: `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/update-values-review.mjs`.
36. Pressing Look it up fills the line when the source answers, labeled
    with the day it is for, and saves it. Test:
    `tests/browser/parts/update-values-review.mjs`.
37. (blind) A price filled in on a reopened recording saves on its own,
    with no holding row touched: pressing Look it up writes the answer
    for every empty published line it covers, as `proposed`, with no
    further press and no confirmation, and leaving at once names no unit
    as unsaved. Test: `tests/browser/parts/update-values.mjs`.
38. Adding a figure for a holding silent at a reopened date creates one
    `snapshot` at `version: 1` and changes no other snapshot there. Test:
    `tests/browser/parts/update-values.mjs`.
39. Adding a figure to a date that carries prices uses them, looks none
    up again, and fills only an empty line for a published unit when the
    source answers. Test: `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/snapshot-entry.mjs`.
40. (blind) Clearing a figure backed by a record at that date deletes
    exactly that record. Clearing a field prefilled from another date
    deletes nothing and writes nothing (a test that clears a field
    backed by a real record passes whatever rule is used). Test:
    `tests/browser/parts/update-values.mjs`.
41. (blind) Clearing every quantity at a date leaves its price entries
    byte-identical, the recording reopens with its rate lines, and the
    prices still price the dates around it. A test that only finds the
    date in a list proves nothing. Test:
    `tests/browser/parts/update-values.mjs`.
42. A recording with no figures reads as an ordinary empty recording on
    its own screen, saying it holds no figures, listing its prices and
    offering Update and Delete, never as an error. Test: no test.
43. Clearing a figure asks no more than changing one: no typed
    confirmation, no second warning. Test: no test.
44. A recording is deleted only by its own button on Recording detail,
    never from the sweep and never by emptying it. Test:
    `tests/browser/parts/recording-detail.mjs`.
45. The delete confirmation says the prices go too, that every holding
    in those units moves on that date, and that it cannot be undone.
    Test: `tests/browser/parts/recording-detail.mjs`.
46. Deleting a recording removes every snapshot and price entry at that
    date, the chart runs across it, and the date is offered as a fresh
    recording. Test: `tests/browser/parts/recording-detail.mjs`.
47. (blind) Deleting a recording that holds an archive's zero leaves that
    zero byte-identical and the date still opening, while every other
    record at the date goes. Test:
    `tests/browser/parts/account-detail.mjs`.
48. A delete whose third `DELETE` fails leaves the remaining records
    readable, rolls nothing back, and reports what is left. Test:
    `tests/browser/parts/recording-detail.mjs`.
49. A `DELETE` answering Not Found during a save is reported as saved.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
50. New recording opens a date picker set to today that marks every date
    holding a recording, emptied ones included. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`,
    `tests/browser/parts/update-values.mjs`.
51. Picking a marked date opens that recording's own screen with no
    warning, no request and no create. Picking an unmarked date goes
    straight to the sweep. Test:
    `tests/browser/parts/recording-detail.mjs`,
    `tests/browser/parts/update-values.mjs`.
52. Recording detail shows its date, every figure with its holding, and
    every price with its unit and provenance. Test:
    `tests/browser/parts/recording-detail.mjs`.
53. A holding named on Recording detail opens that holding. Test: no
    test.
54. Update on Recording detail opens the sweep at that date holding what
    was recorded. Test: `tests/browser/parts/update-values.mjs`.
55. Every route to an existing recording lands on its own screen, except
    Update values in the top bar, which opens the sweep at today. Test:
    `tests/browser/parts/update-values.mjs`.
56. No figure converts at another day's price as though it were that
    day's. On a recording and in a holding's list, a published unit with
    no price on a covered date reads "not priced", and an owner-priced
    unit, or one dated before its published prices, shows the date of
    an earlier price it is valued at. Test:
    `tests/browser/parts/recording-detail.mjs`.
57. (blind) A second session whose model predates another session's
    recording is refused when it creates at that date: the reload runs,
    nothing is written, not even into free slots, the message names the
    date as taken rather than blaming the person, and one click opens
    that recording. Asserted for a fresh recording and for one holding
    added inside a reopened one, and against the record sets, since the
    message alone is the easy fake. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
58. (blind) A sweep recording many rows at a new date issues exactly one
    extra type reload, before the first row is written, and none after,
    asserted as a request count and position. Test:
    `tests/browser/parts/update-values.mjs`.
59. (blind) A sitting that only changes and clears existing records
    issues no type reload, and its writes are updates at stored
    `version` + 1. Test: `tests/browser/parts/update-values.mjs`.
60. (blind) On a sweep at a new date, after the first row is recorded, a
    rate-lines save that creates a price issues its own type reload and
    writes that price. Skipping the reload because the sitting claimed
    the date passes every test on a date nobody else touched. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
61. (blind) A Conflict on a snapshot inside a recording save reloads that
    row to the stored record, retries nothing, and leaves it
    byte-identical. Test: `tests/browser/parts/update-values.mjs`.
62. Editing a snapshot with a stale `version`, from a second tab, returns
    Conflict, overwrites nothing, and says so. Test:
    `tests/browser/parts/snapshot-entry.mjs`,
    `tests/test_records.py::test_only_stored_version_plus_one_is_accepted`.
63. A recording offers no way to change its own date, and moving one
    snapshot's date from the holding's page works. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/snapshot-entry.mjs`.
64. (blind) Changing only an entry's value or note issues no request to
    `/api/rates`, writes no price and runs no pre-create reload. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
65. Deleting a snapshot deletes no price entry, asserted by count. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
66. (blind) Confirming writes the holding's last recorded `value` string
    character for character at the new date, for a holding in the main
    currency, one with a rate source and one without, with no branch
    between them. Under `moneyPlaces` `0`, an `XAU-ozt` holding stored as
    `"12.125"` writes `"12.125"` and a `USD` holding stored as
    `"1000.40"` writes `"1000.40"`, read from the written record, not
    the screen. Test: `tests/browser/parts/update-values.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
67. (blind) A sweep row prefilled from `"12.5"` offers Confirm, offers
    Record once edited, offers Confirm again when the prefill is typed
    back, and with `12.50` typed writes `"12.50"` (a numeric comparison
    fails these cases). Test: `tests/browser/parts/update-values.mjs`.
68. Confirm stays available and one click with the rate proxy answering
    No Content. Test: `tests/browser/parts/update-values.mjs`.
69. Confirm is not offered for a holding never valued, and the
    equivalent request is refused client-side. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
70. Moving a snapshot onto an occupied date prompts with copy naming the
    deletion, different from the replace prompt, and on confirm leaves
    exactly one record for that date. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
71. (blind) A move issues the snapshot `PUT`, then every rate `PUT`,
    then the displaced record's `DELETE`, asserted on the wire with each
    stub in turn: a failing snapshot `PUT` issues no rate `PUT` and no
    `DELETE`, a failing rate `PUT` still issues the `DELETE` and the
    Dialog names the symbol. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/snapshot-entry.mjs`.
72. (blind) With the move's `DELETE` failing, both records still exist,
    the holding's page shows both flagged and asks which to keep, and
    the chart leaves that date out until answered. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
73. With two snapshots for one (holding, date), the holding's history,
    the recording and the sweep show both flagged with Keep this one,
    the app picks neither, and the date is left out of the
    interpolated series until resolved. Test:
    `tests/browser/parts/dashboard.mjs`,
    `tests/browser/parts/update-values.mjs`.
74. (blind) Moving a `USD` snapshot from 2010-03-31 to 2026-04-10, a date
    holding no records, issues exactly one request to `/api/rates`, for
    2026-04-10, writes an entry there for every symbol the refresh
    covers, converts the figure at that entry on the recording and in
    the holding's list, and leaves every entry at 2010-03-31
    byte-identical. A move that only rewrites the date fails this. Test:
    `tests/browser/parts/snapshot-entry.mjs`,
    `tests/browser/parts/recording-detail.mjs`.
75. (blind) With the proxy answering No Content for that move, the
    snapshot moves, no `USD` entry is written, and the figure reads not
    priced at 2026-04-10 on the recording and in the holding's list,
    never at the 2010-03-31 price. Test:
    `tests/browser/parts/recording-detail.mjs`.
76. (blind) Moving an `XAU-g` snapshot to 2012-06-29, a date holding no
    records, in a vault whose only other unit is the main currency,
    issues no request to `/api/rates` and writes no price. With an
    `XAU-g` entry at 2011-06-30 the figure converts at it and carries
    2011-06-30 on the recording and in the holding's list. With none at
    or before 2012-06-29 it reads not priced. Test: no test.
77. Moving a snapshot onto a date whose prices are complete issues no
    request to `/api/rates` and leaves every price there byte-identical.
    Onto a date missing one symbol, it writes that symbol's entry and no
    other. Test: `tests/browser/parts/snapshot-entry.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
78. Moving an archived holding's entry to an earlier date with no entry
    for its unit writes that unit's entry there. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
79. (blind) A move whose reload finds the holding's slot at the new date
    taken by a record its confirmation did not name writes nothing and
    names the date. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/snapshot-entry-review-move.mjs`.
80. A move whose prices did not save leaves the entry moved, names every
    unit in the Dialog, leaves Save inert until something changes, and
    offers the recording. Test: `tests/browser/parts/snapshot-entry.mjs`.
81. (blind) A typed future date is refused on the date field's own line
    with the future reason, the input carries `aria-invalid="true"` and
    an `aria-describedby` naming that line, Save issues no `PUT`, and the
    Dialog's general line stays empty (finding the text anywhere on the
    Dialog is the easy fake). Test:
    `tests/browser/parts/snapshot-entry.mjs`.
82. (blind) Unparseable text in the date field, on Save, shows the
    unparseable reason and never the empty-date one, and issues no
    `PUT`. An emptied field shows the empty-date reason. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
83. (blind) Correcting a refused date to one that fits clears the
    refusal and `aria-invalid` before Save, asserted without pressing
    Save. Test: `tests/browser/parts/snapshot-entry.mjs`.
84. Recording against an archived holding is blocked at every entry
    point and every date. Test: `tests/browser/parts/account-detail.mjs`.
85. (blind) On a reopened recording, the archive's zero row shows the
    zero as text with no control. The server cannot see this, so only a
    test against the controls asserts it. Test:
    `tests/browser/parts/account-detail.mjs`.
86. (blind) On the single-holding form, the opened prices line shows
    every unit's full name, price and whole provenance at a narrow and a
    wide window, no chip wider than its container and no two boxes
    intersecting, asserted on rendered geometry, not on text in the DOM.
    Test: `tests/browser/parts/snapshot-entry.mjs`.
87. (blind) A single-holding form open since before another window
    archived its holding writes nothing at an earlier date, and says the
    holding was archived in another window. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
88. A date move onto or past an archive another window made since the
    form opened writes nothing and says nothing was moved. Test:
    `tests/browser/parts/snapshot-entry.mjs`.
89. (blind) A sweep row of a holding archived in another window after
    the sweep claimed its date writes nothing, says so, and leaves the
    screen. Test: `tests/browser/parts/update-values.mjs`.
90. In a vault whose main currency no source quotes into, a currency's
    rate line says no price source quotes in that main currency, offers
    no Look it up, and the sweep asks the proxy nothing. Test:
    `tests/browser/parts/update-values.mjs`,
    `tests/browser/parts/update-values-review-unquoted.mjs`.
91. Closing the single-holding form with a typed price or figure
    unsaved writes nothing, and the screen it closes onto names the
    holding and the unit left. A lock and unlock in between shows no
    notice. Test: `tests/browser/parts/snapshot-entry.mjs`,
    `tests/browser/parts/snapshot-entry-review-leave.mjs`,
    `tests/browser/parts/unlock-lock.mjs`.
92. A move to a date that held no record when the Dialog showed it,
    where another window records a different holding's figure there
    before Save, writes nothing, names the date and offers its
    recording, although no slot the move would take is taken. Test:
    `tests/browser/parts/snapshot-entry.mjs`,
    `tests/browser/parts/snapshot-entry-review-move.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
93. The single-holding form's heading reads "Record a value for" and the
    holding's name for a new figure, and "Edit this value" for a stored
    one. Test: `tests/browser/parts/snapshot-entry.mjs`,
    `tests/browser/parts/snapshot-entry-review-heading.mjs`.
94. At 320px, 375px, 601px and 901px wide, Recording detail holding two
    seven-digit figures for one holding on its date pans no screen or
    box sideways. Every control, Keep this one included, lies on screen
    and takes a tap at its center, and each control in its lists is at
    least 44px tall at phone width. A holding name with no break in it
    wraps rather than pans. Test:
    `tests/browser/parts/recording-detail.mjs`,
    `tests/browser/parts/recording-detail-review-phone.mjs`.
95. On the single-holding form, the folded prices line shows what the
    save writes, such as "Prices for 31 July will be recorded with
    this", without being opened. Test:
    `tests/browser/parts/snapshot-entry.mjs`,
    `tests/browser/parts/snapshot-entry-review-fold.mjs`.
96. (blind) Recording detail and Update values name a unit as
    `design-system.md`, Units, sets: a price line for `XAU-ozt` reads
    "Gold, troy ounce", one for `XAU-g` reads "Gold, gram", a currency
    reads by its code, and no line or message shows a symbol such as
    `XAU-ozt`. Test: `tests/browser/parts/recording-detail.mjs`,
    `tests/browser/parts/update-values.mjs`.
