# Net worth view

What a vault owner is worth now, how it got there and what it is made
of: the total, a stacked trend chart, the list of holdings and a
breakdown by dimension. Every figure is computed in the browser from
decrypted records, so the server has nothing to template here.

## What the client gets

What you are worth right now, and how it got there: the screen you
open, and the only one you might open without meaning to change
anything. It is assembled in your browser after you unlock, so the
machine that stores your vault computes nothing and learns nothing from
what you look at. It looks like the rest of the product, and on a phone
dragging a span follows the phone rule (`app-shell.md`, What the client
gets). The total is the largest thing in the product, and the chart is
the one place color carries meaning, every band labeled so a reader who
cannot tell two colors apart loses nothing.

- **The total**, with the change over the span the chart shows, and
  beside it gross assets and gross liabilities, because hiding a mortgage
  inside one figure hides the most important thing about it. Until a
  holding you keep has a value, all three read as a dash, never as 0,
  because 0 is a real figure that means something else.
- **Two dates.** Each holding counts at its last recorded quantity,
  valued at the most recent rate for its unit (your March dollars at this
  month's rate), and states the date of its own last figure. The screen
  states one date for the rates, the day you last recorded anything,
  because recording anything refreshes every rate (`record-snapshot.md`,
  What the client gets).
- **Which rates**: latest rates, or rates as of each figure (your March
  dollars at March's rate), which tells you how much of the move since
  you last looked was your money and how much was the rates. It says
  latest and not today's, because nothing here fetches anything.
- **The chart** serves, in order: the shape of the last few years, what
  one part of your money did over a span you drag across ("what did my
  retirement do between 2019 and 2024"), composition drift, and shares
  rather than amounts. It says how much of your money the grouping covers
  and which holdings are unassigned, because a dimension filled in for
  three holdings draws a correct and misleading chart.
- **Mostly inferred, and it says so.** Between your entries quantities
  and rates are interpolated, and after the last they are carried
  forward, so a band moves on days you recorded nothing. Neither is
  written down: they are the drawing. The dates you recorded something
  are marked. The line is curves, not steps, because a decade of sparse
  entries drawn as steps is a field of cliffs. Record a value on the day
  something happened to get a sharp edge.
- **The list of holdings** is the list of holdings, so the navigation has
  no Holdings entry (`app-shell.md`, The chrome). Its as-of date sorts,
  so you find what you have not touched in a while without the app
  deciding what counts as too long.
- **The breakdown** adds up to exactly your net worth, so it needs no
  small print.
- From the chart, the date picker and the list, any recording opens on
  its own screen, which is how a wrong figure from last year gets put
  right (`record-snapshot.md`, Recording detail).

What it deliberately does not do:

- **No warning that a figure is old.** No badge, color or threshold.
  Holdings move at different speeds, so any single threshold flags the
  slow ones until you learn to ignore it, then fails for the one that
  really went quiet. Every figure states its age in words, next to the
  action that records a new one. An older price is dated, which is a date
  and not a warning.
- **No rate lookup from this screen.** Rates move when you record
  something.
- No forecast, projection or target. The chart ends today.
- No benchmark and no performance figure, which would need position
  level data Solvent does not hold.
- No income, spending or cash flow.
- **No pie chart.** A pie cannot show a negative slice, and a mortgage is
  one. Bars also compare lengths better and label directly.
- **No fifth color.** Past four values the rest fold into "Other",
  because beyond that no set of colors stays distinguishable, including
  for color blind readers.

## Screens

### Dashboard

Standard app shell (`app-shell.md`, The chrome). Regions top to bottom,
each at the full content width and 32px apart. The hero sits on the
ground, and every later region is a Card opening on its section heading
(design-system.md, Components). It links to the account form and account
detail (`manage-accounts.md`) and to snapshot entry, update values and
recording detail (`record-snapshot.md`).

#### Hero figure

The total holds the left under the section label "Net worth", ink-primary,
proportional figures (design-system.md, Typography), with the change
beneath it, then a line that keeps its height while empty for the date
the chart reads, so reading a day never moves the chart under the
pointer. At the right, level with the foot of the total, sit gross
assets and gross liabilities under their own section labels, each set off
by a hairline rule at its left, then New recording. Which rates takes its
own row beneath, at the left. Summary figures (the total, the change,
gross assets and liabilities, the legend and the breakdown) are written
by the formatter's `whole`. The holdings table and the data table carry
the money places, because that is where a figure is checked against a
statement.

While no active holding is valued, the total, gross assets and gross
liabilities each read `—`, with no change beneath them, and the hero
follows neither hover nor keyboard, because a sum of nothing is no
figure and 0 is a real one. A side with no holdings beside valued ones
reads 0, because that sum is real.

Every set of figures shown as the parts of a figure adds up to that
figure as shown: gross assets and liabilities to the total, the bars to
the total, the holdings table's converted figures to the total at the
money places, the legend to the chart's right hand edge, the legend's
changes over a span to the change, and the readout's rows to its net.
Rounding each part alone misses, because three parts of 0.40 make 1 and
would each show 0. The whole rounds once, half-even. Each part rounds
toward minus infinity, and the units still missing go to the parts with
the largest remainders, ties to the earlier part in screen order, so a
part never moves a whole unit from its exact value. Each set is shared
out from exact figures, so a band's bar can differ by a unit from the
sum of its holdings as the table shows them.

- **The change** over the selected range or selection: an arrow icon, the
  signed amount and the percentage (one decimal place), in status good or
  critical, the arrow carrying the sign so color is never the only
  signal (The change).
- **Which rates**, a segmented control with both positions named, neither
  an unlabeled off state: **"Latest rates, 31 July"** (the vault's one
  rate date) and **"Rates as of each figure"** (no date, because each
  row's rate date is its own As of date or the price date it carries). It
  reprices the total, the holdings table and the breakdown, leaves the
  chart untouched and contacts nothing (Ranges and modes). Its label is
  the only thing saying which position shows: no banner, no caveat,
  nothing apologetic about the hero differing from the chart's edge.
- **New recording**, the primary action, sits here because the total is
  where somebody arrives meaning to update it. It opens the marked date
  picker (design-system.md, Components) with today focused, future dates
  not selectable, and every date holding a recording marked, one whose
  figures were all cleared included, because its prices still stand and
  the picker is the one route back to it. With nothing marked it is an
  ordinary picker that explains nothing. A date with no recording goes
  straight to the sweep at that date (`record-snapshot.md`, Update
  values). A marked date opens that recording's screen
  (`record-snapshot.md`, Recording detail), with no warning, question or
  confirmation. Dismissing it writes and asks nothing. The top bar's
  Update values is the other route and is not repeated here
  (`app-shell.md`, The chrome).
- No staleness chip and no warning. A figure's age belongs on the sweep,
  beside the control that fixes it.

#### Trend chart card

A stacked area chart in SVG (Rules). The section heading holds the left
of one row above the plot and the controls the right, in this order,
wrapping beneath the heading when the row runs out:

- **Range**: 1M / 6M / 1Y / All, segmented (Ranges and modes).
- **Group by**: "Total" plus every configured dimension in the profile's
  order, archived ones excluded (`account-settings.md`, Dimensions).
  "Total" (one band) until a dimension exists. While no dimension is
  active, a "Create a dimension" link beside it opens the Dimensions
  screen, where one is created or restored. It also drives the
  breakdown. Beside it the **coverage**, "7 of 10 holdings assigned", N
  the active holdings (`account-settings.md`, Dimensions, owns what
  coverage is for). While some are unassigned it is a link filtering the
  holdings table to them. Otherwise, "10 of 10" and "0 of 0" included, it
  is plain text, never a control, because there is nothing to filter to.
- **Absolute / percentage**, segmented, captioned that each side is
  measured against itself, because a reader would otherwise assume shares
  of the net figure.
- **"Just the line"**, a checkbox, off on load. Ticking it removes the
  entry marks and changes nothing else. The name says what the control
  does without claiming the marked chart is the untidy one, since the
  marked chart is the accurate one.

The plot spans the card, value ticks at the left. Beneath it, under a
hairline rule, the legend runs as one row of swatch, band name and
figure, with the key to the entry marks at its right end. "View as table"
closes the card. A single band ("Total") has no legend box, and the
section heading names it.

Interaction, each reading one calendar day (Reading a date):

- **Hover**: a dotted crosshair on the day and a tooltip pinned to the
  top of the plot: the date, every visible band with its value, then the
  net total on a separated row, value first and date second, because
  the value is what the reader came for. The hero
  follows. Leaving the plot removes the crosshair and returns the hero.
- **Drag** selects a span that stays after release. The hero shows the
  change across it and each legend entry its own. A plain click, or a
  change of range or dimension, clears it.
- **Legend** entries toggle a band, and hovering one highlights it and
  dims the rest. With a band hidden, a line under the chart states that
  the total covers only the visible bands. A band name too long for its
  entry wraps, breaking a word only where it has to.
- **A click on a marked date, or on its tick, opens that date's
  recording** (`record-snapshot.md`, Recording detail), and on any other
  day nothing. A date with prices and no figures takes no tick and is
  reached through the date picker.
- **Archive annotations**: a marker on the x-axis at each `archivedAt`,
  and a tooltip line naming the holding (Archived holdings).
- **Keyboard**: the chart is focusable, and focus puts the crosshair on
  the range's last day. Left and Right step one day. Shift+Left and
  Shift+Right jump to the previous or next marked date, even with Just
  the line on. Home and End reach the first and last day. Enter on a
  marked date opens its recording, elsewhere nothing. No key moves past
  either end, and a jump with no marked date ahead stays put. Each move
  announces the tooltip's readout and the hero follows. Leaving removes
  the crosshair. Nothing is reachable only by pointer.
- **View as table**: a Table (design-system.md, Components) of "Date",
  each band under its legend name in band order, then "Net worth" (under
  "Total" only the first and last). Dates read as the tooltip writes
  them, figures carry the places Decimals on money sets, and rows are The
  data table's.
- No control here issues a network request: range, dimension, mode,
  pricing, band visibility, selection.

#### Stacked areas

One band per dimension value, in the dimension's configured order and
never reordered by size, because a stack that reorders over time cannot
be read. The adjacent-pairlist validation (design-system.md, Chart
palette (validated)) is exactly this case, so the four slots apply
unchanged.

- Asset bands fill at 85% opacity. Liability bands mirror below the zero
  line in the same group color at 45%: same hue means same group, and the
  side of the axis carries the sign. The zero line is ink-muted, drawn
  over the bands.
- The net-worth line runs over the stack in ink-primary at 1.75px,
  ending in a dot at the latest point. It summarizes the bands and takes
  no chart slot.
- Inferred stretches take the estimated marker, never a change to the
  fills (design-system.md, Chart palette (validated), on pattern fills).

#### The two neutral bands

"Unassigned" and "Other" are not categories the user chose. They take no
chart slot, must not read as one, and must not collide with each other:

| Band | Fill | Meaning |
|---|---|---|
| Unassigned | rule gray `#c4cccf` | no value for this dimension, normal |
| Other | ink-muted `#798285` | the fifth-and-beyond value, folded |

Both always carry a direct label. A chart showing both is legible, and
tells the user their dimension neither covers its holdings nor fits in
four values.

#### The estimated marker

Inferred figures (every stretch between two snapshots, and everything
after a holding's last one) are marked by ticks under the x-axis,
ink-muted, at every date carrying at least one snapshot. Never a status
color, because inferred data is not a warning, the same reason figure
age is stated in words.

- Under the axis rather than in the fill, because four dashed stacked
  bands are unreadable and the distinction has to survive a decade of
  history.
- **A tick means a quantity, never a price.** It answers "when did I go
  and look this holding up", the question the sweep is built around. A
  tick per price entry would sit under every month for every holding.
- The marks do not separate an interpolated quantity from an
  interpolated price. A tick sits on a date every band shares, and a
  per-factor mark would need one per band per date. Where one figure's
  provenance matters, the sweep's row carries it.
- **A row carries no mark.** On the sweep nearly every row is carried
  forward, so a mark would say nothing its age in words does not
  (`record-snapshot.md`, Update values).
- **On when the chart loads**, with nothing turned on and no stored
  preference read. The accurate drawing is the one nobody has to ask
  for, and the tick is the click target that opens its date's recording,
  so hiding it by default would hide that route too.
- The ticks ship with wording, never as the mark alone: beside them the
  name of the control that removes them (design-system.md,
  Accessibility).

#### Axes

- Each value tick reads the value of its own gridline, and no two read
  the same (Value ticks).
- A mark at either edge of the plot is drawn whole at every width: the
  net-worth line's dot, an entry mark, an archive marker. The plot keeps
  half the widest mark clear inside its left and right edges.
- Every value label lies inside the drawing at every width, a sign and a
  unit included.
- A one-day history draws one whole dot in the plot's horizontal middle
  under every range, with its date beneath it on the date axis, at
  desktop and phone width (Reading a date).

#### Breakdown by dimension

What the money is made of now, where the chart shows how it moved.
Horizontal bars, one per band of the Group by dimension, in the same
order as the stack, "Unassigned" a bar like any other and "Other" folding
the fifth and beyond. Color, direct labels and the signed zero baseline
are design-system.md's (Colors by chart job). The bars run the card's
width less the room the labels take at the outboard ends, a room that
narrows with the card so the bars keep width of their own. A label longer
than its room wraps inside it, breaking a word only where it has to, and
its bar's row grows to hold it. A band can be net negative
(a mortgage under "Fixed"), so negative bands run leftward. When every
band is positive the baseline sits at the left edge, and the layout never
changes shape with the data. The bars sum to exactly the net-worth total,
as a signed sum, and their amounts as shown add up to the total as
shown (Hero figure). Under "Total" the section is absent, because one
bar equal to the hero says nothing.

#### Holdings table

The section heading holds the left of the card's head row and the "Show
archived" toggle the right. Columns: Name, Dimensions, Latest value
(native unit), In main currency, As of, row action.

- **The table renders only when it lists at least one row.** A listed row
  is an active holding with a figure in the selected mode, or an archived
  holding while Show archived is on, narrowed to the unassigned while that
  filter applies. Headings over nothing read as a fault, so otherwise the
  "Not yet valued" and "Not priced" groups stand directly beneath the head
  row, or the card holds the one line its state gives.
- Dimensions shows one chip per assignment (`Liquidity: Cash`), omitting
  dimensions the holding has no value for rather than printing
  "Unassigned" on every row. With no dimensions configured
  the column is absent.
- Latest value and In main currency are figure columns
  (design-system.md, Typography). The native figure shows the digits it
  was entered with, and the converted figure follows Decimals on money.
- **A holding's name wraps wherever it must**, in the table and in both
  groups, and is shown whole. A name with no space breaks inside the word
  rather than widen the page, at any width.
- Rows in creation order, oldest first. A row never moves because its
  figure changed.
- **As of is the date of the quantity, never of the rate**, shown plainly
  at any age.
- **A price date line** (design-system.md, Components) sits beneath the
  converted figure of a row valued at an older price (Current net worth),
  never as a column. A row priced at its own date, a main-currency row and
  a not-priced row carry none.
- **An archived holding is an archived row, whatever its figures**, and
  never joins either group. Archived rows are hidden behind "Show
  archived". Shown, each has an "Archived" chip and ink-secondary text,
  never reduced opacity, which would drop text and chips below their
  contrast floors (design-system.md, Ink and line).
  - Its unit has no price in the selected mode: Latest value is its
    latest quantity, and In main currency reads "not priced" with no price
    date line.
  - It has no readable snapshot: Latest value reads "not yet valued", and
    In main currency and As of are empty.
  - Its row action is **Unarchive** in place of Record a value
    (`manage-accounts.md`, Account form).
- The "Not yet valued" and "Not priced" groups sit below the table and
  list active holdings only.
- **Filtered to the unassigned**, from the coverage line here or on the
  dimensions screen: the table and both groups list only holdings with no
  value for the Group by dimension, archived ones included while Show
  archived is on. A line in ink-secondary between the head row and the
  table says so and ends in a **Show all holdings** link that clears the
  filter. Setting Group by to "Total" clears it too.
- A row click opens the holding (`manage-accounts.md`, Account detail).
  "Record a value" on each active row opens the single-holding form at
  that holding (`record-snapshot.md`, Snapshot entry). It is not a second
  New recording: that one asks which date and sweeps every holding, this
  one takes one holding to one date, for an odd date or a backfill.

#### At phone width

The regions keep their order and stack, 20px apart.

- **Hero**: the total, the change, then gross assets and liabilities side
  by side in two equal columns under a hairline rule. Which rates spans
  the width beneath, and New recording beneath that, 48px tall.
- **Trend chart**: Range spans the width across the top and the other
  controls wrap beneath. Group by drops its visible label and keeps it as
  the select's accessible name, because the section heading above
  already says what it groups. The value ticks sit in a gutter left of
  the plot, so none lies over a band or a mark. The legend runs in two
  columns without each band's figure, with the mark key beneath it. The
  table under View as table keeps every column and scrolls sideways
  inside the card, never the page.
- **Breakdown**: each bar's label moves above it, name left and amount
  right, over the shared zero baseline.
- **Holdings table**: a list with no column headings. Each row holds the
  name with its chips beneath it at the left, and at the right the
  main-currency figure with any price date line, then the as-of date,
  preceded by the native figure where the unit is not the main currency.
  An archived row reads as at desktop width. No row carries a row action:
  a tap opens the holding's screen, which offers Record a value or
  Unarchive.

#### States

- **Loading**: none, no skeleton. Records decrypt inside the unlock card's
  working state (`login.md`, Unlock), and the dashboard draws only once
  the total is final.
- **Empty, no holdings**: one centered card, "Add your first holding",
  primary button. No chart, table, zero total or New recording.
- **Empty, holdings but no snapshots**: every active holding under "Not
  yet valued" directly beneath the head row, no table, no column headings.
  With Show archived on, each archived holding is an archived row reading
  "not yet valued", so the table renders above the group with those rows
  alone. Total, gross assets and gross liabilities `—`, not 0 (Hero
  figure). No chart. New recording works, because
  recording is how this state is left.
- **A one-day history** (every snapshot, price and archive dated today):
  one point at the plot's middle under every range, never a failure or a
  flat line back to the beginning of time (Axes).
- **All holdings archived**: total, gross assets and gross liabilities
  `—` with no change (Hero figure), history still renders. Reading a day
  on the chart fills its tooltip and leaves the hero as it is. Show
  archived off: the card holds one ink-secondary line beneath its head
  row and no table:

  > Every holding is archived.

  Show archived on: every holding is an archived row.
- **Filtered to the unassigned**, with "Liquidity" as Group by:

  > Showing the holdings with no Liquidity value. Show all holdings

- **Filtered, nothing unassigned** (for example a filter opened from a
  link made before the last holding was assigned): the line stands alone
  beneath the head row, with no table and no groups, and keeps its way
  back:

  > Every holding has a Liquidity value. Show all holdings

- **No dimensions configured**, or every one archived: Group by offers
  only "Total", with the "Create a dimension" link beside it. One band, no
  breakdown, every other control works. This is a new vault's default and
  must not nag.
- **A dimension no holding carries**: one "Unassigned" band, coverage "0
  of N". Correct, and the coverage stops it being read as a bug.
- **Error, records failed to decrypt**: everything readable renders, under
  a prominent, non-dismissible critical banner, "N records could not be
  read.", linking to a list of the affected record ids. This is the
  AAD-binding tripwire (architecture.md, Key management) and is never
  swallowed, reduced to a console warning or allowed to crash the view.
  An unreadable price entry drops out of its series and the neighbors
  interpolate across it.
- **Error, two entries on one date** (a holding with two values on one
  date, or a unit with two entries on one date that are not
  byte-identical): a critical banner names it and links to the date's
  recording, where one is kept (`record-snapshot.md`, Recording detail).
  Meanwhile the pair drops out of the series and the neighbors
  interpolate across the date, rather than the chart picking a number
  nobody chose (`record-rate.md`). When the pair is the symbol's only
  entry, its active holdings are not priced rather than counted at either
  figure.
- **Error, session expired mid-action**: re-unlock in place, never
  discarding unsaved input, unless the vault was replaced meanwhile.
- **Replaced since last open**: the vault was replaced from a file while
  this page was locked, or while it stayed open after its session ended
  for its own reason, so the page learns it only at unlock (`login.md`, A
  vault replaced elsewhere) and reaches this rather than the unlock card's
  Replaced elsewhere. Every input and dialog kept through the lock is
  dropped, and unlocking lands here rather than on the previous view,
  which can name a record the restore removed.
  - A Callout (design-system.md, Components) at the top of the content
    region, above the hero, full content width, 32px above it, a polite
    live region.
  - Kept input was dropped: critical icon, and

    > Your vault was replaced from a file since you last opened it
    > here. What you had typed here and not saved is gone.

  - None was: no icon, and

    > Your vault was replaced from a file since you last opened it
    > here. Nothing you had typed here was lost.

  - No control. It stays until the person leaves the dashboard and is not
    shown again, because it reports one event.
  - A page that learned of the restore before unlocking says so on the
    unlock card (`login.md`, Unlock) and shows no callout after it.

## How it works

### Data flow

1. On unlock, fetch every record type
   (`GET /api/records?type=account|snapshot|rate|profile`) and decrypt
   with the session DEK.
2. Build the model in memory: profile (main currency), holdings,
   snapshots grouped by `account_id` and sorted by date, prices grouped by
   `symbol` and sorted by date (`record-rate.md`).
3. Compute totals and series locally. Later writes update the model
   directly with no refetch. The one refetch in the write path is the
   pre-create reload (`record-snapshot.md`, Creating and reopening are
   distinct acts), which a stale model cannot stand in for.

One fetch per session suits a household's volume, and is why there is no
single-record `GET` (`record-api.md`, Endpoints).

### Current net worth

Every holding contributes its **last recorded quantity** at a price from
its unit's own timeline (`record-rate.md`), looked up separately, so a
dollar holding last recorded in March is not stuck at March's rate.

`total = Σ over active holdings of (latest snapshot.value × price)`

The **pricing mode** selects the price:

- **Latest rates** (default): the latest price for the holding's unit
  (`record-rate.md`, Reading).
- **Rates as of each figure**: the price as recorded, the newest entry at
  or before the quantity's date for every symbol, published ones
  included. It never reads not priced where that date has no entry,
  because every holding in the total must carry a figure for the total to
  add up. The figure carries the entry's date instead.

Both modes use the same quantity, and switching makes no request,
because both series are in memory (Ranges and modes).

- **Latest means the greatest `date`**, in either series, never the most
  recently written.
- A holding whose unit is the main currency prices at `"1"` in both
  modes, from no entry, and is never reported as not priced
  (`record-rate.md`, Reading).
- Each figure carries its **quantity's as-of date**, the date the person
  acts on, at any age (What the client gets). A row priced older than the
  date it is shown for also carries **its price's date**: on latest
  rates, a price dated before the screen's rate date (the newest `date` of
  any entry in the vault), on rates as of each figure, a price dated
  before the row's quantity date. Most often it is a holding with no rate
  source.
- **Archived comes first.** An archived holding is excluded from the
  current total and never listed as not yet valued or not priced, because
  being archived is the reason. It stays in history before `archivedAt`
  (Archived holdings).
- **An active holding with no snapshots contributes nothing** and is
  listed as "not yet valued", never 0, because zero is a real value a
  user can record.
- **An active holding with a quantity and no price contributes nothing**
  and is listed as **not priced**, never counted at its bare quantity as
  though its unit were the main currency. A recording whose price writes
  all failed (`record-rate.md`, The write path), a free-text unit nobody
  has priced, and the deletion or flagged duplication of a symbol's only
  entry each lead here.
- Negative balances subtract, and gross assets and gross liabilities are
  shown beside the net figure.

### Trend chart

A stacked area chart over time, one band per group, the bands summing to
net worth.

#### Values between entries

`value(account, t) = quantity(account, t) × price(unit(account), t)`

- **Quantity** is linearly interpolated between the holding's own
  snapshots. It contributes nothing before its first snapshot, never
  backfilled with zero, which would show a false jump when a long-held
  holding is first entered. After the last snapshot it is carried
  forward.
- **Price** is linearly interpolated between the symbol's entries,
  carried forward after the last and **carried backward** before the
  first. The asymmetry is deliberate: a price samples something that
  existed before anyone sampled it, while a holding did not exist before
  its first entry. Blanking a band before its first price would draw the
  same false jump.
- Interpolation is **per holding and then summed**, never of a summed
  series, because summing first smears one holding's first snapshot
  across the rest.

**A band bends between two quantity entries.** The product of two
piecewise-linear series is piecewise quadratic, so a price entry between
two snapshots pulls the band off the chord: a holding recorded in January
and July, priced monthly, follows the currency.

- Sample each holding at the **union** of its snapshot dates and its
  symbol's price dates within range, plus the range endpoints. Sampling
  only snapshot dates cuts off every bend, silently.
- Between two samples the segment is straight. Both factors are linear
  there, so the error is the quadratic term, at most a quarter of the
  product of the two deltas, below a pixel at any realistic cadence.

**A change to one entry moves a bounded stretch, and only it.** Adding,
changing or deleting an entry in either series affects the dates between
that entry's neighbors in its own series:

- An entry with a neighbor on each side: the open stretch between them.
- The last entry of a series: everything from the previous entry on,
  because what follows is carried forward.
- The first entry of a price series: everything up to the next entry,
  because what precedes is carried backward. A holding's first snapshot
  moves where its band starts.

This is what makes an edit safe to offer (`record-snapshot.md`,
Reopening and editing a recording): correcting a figure from eight months
ago cannot move last year, and moves today only if it was the newest.

**Deleting a whole recording** takes the date's rate entries with it
(`record-snapshot.md`, Deleting a recording), so the bound applies once
per removed entry, and every band in those symbols moves across those
stretches, holdings not recorded that day included.

**A recording with rates and no values still shapes the chart.** Its rate
entries are ordinary knots that anchor their series, and bands bend over
them. A date nobody recorded a quantity at is still a date somebody
priced, and it takes no tick (The estimated marker).

#### Grouping by dimension

Bands come from a **dimension**, a named axis whose values partition the
holdings (`manage-accounts.md`, Dimensions). A stack needs a partition,
or the bands would not sum to net worth.

- Each holding falls in exactly one band per dimension, by the record
  shape: `dims` is a map keyed by dimension id, so a second value cannot
  be expressed, by the form, an import or a hand-edited export. There is
  no "Ambiguous" band and no third neutral band.
- Holdings with no entry for the dimension group under **"Unassigned"**,
  a real band, never hidden. An entry naming an archived or unknown value
  lands there too, and the entry is kept, so restoring the value restores
  the band.
- No dimension gives a single band: plain net worth.
- Band order is fixed per dimension, from its configured value order
  (`account-settings.md`), never by size.
- Past four values, the first four in configured order take chart slots
  and the rest fold into "Other" (design-system.md, Chart palette
  (validated)).
- Wherever a dimension is chosen, the UI shows its **coverage**, because a
  dimension covering three of ten holdings draws a correct and useless
  chart and the user needs to see why.

#### Assets and liabilities

A negative balance cannot stack with positive ones, so liability bands
mirror below zero in their own color (Stacked areas), which keeps the
signed sum visible.

#### Archived holdings

A holding archived on date D counts on every chart date before D and on
none from D on, so the chart at D agrees with the current total.

Archiving writes the holding's zero at D (`manage-accounts.md`,
Archiving), so the band interpolates into zero as between any two
snapshots, a stretch between two entry marks like any inferred stretch.
Someone who wound a position down on one day records a figure that day
and gets the sharp edge honestly. The zero is the new last snapshot, and
the archive's refresh may add price entries at D (`record-rate.md`, The
refresh). Each moves what a new last entry moves (Values between
entries), and nothing before it.

The archive is a **step at D**. A day where a band starts or ends is a
vertical edge at that day's x, from the value just before the day to the
value at it. The range's first day has no side before it.

- A first snapshot is absent just before its date and present at it,
  which is the no-zero-backfill rule drawn as an edge.
- A holding archived on D is present just before D, at D's quantity and
  D's price, and absent at D. With the zero at D that side is zero, so
  there is no edge.
- A holding first valued and archived on the same date is on no chart
  date and on neither side of its step.
- **The value at a date is the side at it.** The tooltip, the data table,
  the hero under the crosshair and the change all read it. The side just
  before shapes the drawing only.

**A holding archived without a zero at D keeps a real step**
(`manage-accounts.md`, A holding archived without a zero at D), falling
from D's figure, or the last quantity carried forward when D has none.
D's price values the side just before the step, so a price entry at D
moves a holding archived on D only where that side is non-zero, and only
then does the confirmation for a rate change on D count it
(`record-snapshot.md`, Update values).

Every archive date carries its annotation, with or without a zero,
because a band running out to nothing, or an unexplained vertical edge,
otherwise looks like a lost value or a bad entry.

#### Ranges and modes

- Ranges 1M, 6M, 1Y, All. Default 1Y, or All if history is shorter.
- **The chart's last day is today**, the device's calendar day, or a
  later `archivedAt`, and every range counts back from it. Each holding
  is carried forward after its last figure, so a range ending at the last
  recording would describe a span that ended weeks ago. After the last
  recording the line runs level to today, and an archive whose D
  carries no snapshot still falls inside the chart.
- **A range starts no earlier than the oldest date carrying a
  snapshot.** No band has a value before it, so counting further back
  would draw an empty stretch ending in a jump, and push a one-day
  history's only point to the edge. A range longer than the history shows
  all of it, and a one-day history, recorded only today, is that day
  under every range.
- **Pricing mode is not a chart control.** Every point is drawn at the
  prices of its own date, so switching moves no pixel. On latest rates
  the right hand edge **is** the total: each active holding's last
  quantity carried forward at its symbol's last price carried forward,
  and no archived holding, because the edge lies at or after every
  archive. On rates as of each figure the total is deliberately not the
  edge. The gap says how much of the move was money and how much rates,
  and a chart that repriced with the control would close it.
- **Absolute / percentage**: the percentage view normalizes asset bands
  against total assets and liability bands against total liabilities,
  because a share of a signed net figure is meaningless near zero.

#### Value ticks

The value axis carries a gridline and a label at each tick. Its domain
runs from the lowest drawn value to the highest, zero always included. A
domain with no extent runs from 0 to 1.

- **The step is 1, 2 or 5 times a power of ten, never below 1**: the
  smallest such number at least the domain's span over the target count,
  six at desktop width and three at phone width.
- **Ticks are counted from zero**, at `i × step` for every integer `i`
  inside the domain, computed as that product and never by repeated
  addition, so every tick is an exact integer. Zero is always a tick.
- Below a thousand a tick reads its exact whole number. From a thousand
  up it reads in short form: its magnitude over the largest of a
  thousand, a million and a billion not exceeding it, with at most one
  decimal and no trailing zero, then `k`, `M` or `B` (design-system.md,
  Figures).
- Every label is written by the formatter's `compact`
  (`account-settings.md`, Dates and numbers): 1500 reads `1.5k` or `1,5k`
  by the decimal point, and 1500000000000 carries the group mark, `1’500B`
  under an apostrophe.
- **No two ticks read the same, because every label is exact.** The
  domain contains zero, so the step is at least a sixth of the largest
  tick, and a multiple of such a step is exact in one decimal of the
  tick's unit.
- The percentage view takes the same step rule and writes each tick with
  `percent` at no places.

Where the labels sit is the Dashboard's (Axes, At phone width).

#### Reading a date

**Every calendar day from the range's first to its last is a date the
chart reads.** The crosshair, its tooltip, the hero under it, both ends of
a selection and the keyboard each resolve to one day and read it through
the value model, on the side at it, never from the drawing's samples or
downsampled points. The line between two samples may sit off the model by
the sub-pixel bound, and the figure shown is the model's.

- **Days are evenly spaced**: in a range of days 0 to n, n at least 1, day
  k sits at `x0 + k × (x1 − x0) / n`.
- **A one-day range draws its point at `(x0 + x1) / 2`**, whole, at every
  width, and reads that day at every x. At `x0` its mark would be cut in
  half at the plot's edge.
- **The pointer reads the nearest day**:
  `k = round((x − x0) × n / (x1 − x0))`, clamped to the range, a half
  rounding to the later day. Every x reads exactly one day. Where the
  plot has at least as many pixels as days, every day is read at some x.
  Otherwise the keyboard reaches the days between.
- **A selection's ends are the days under press and release**, ordered
  earlier first whichever way the drag ran. The change is the later day's
  value minus the earlier's, for the total and every band. A press and
  release on one day is a click.
- **The keyboard reaches every day** (Dashboard, Trend chart card). Each
  readout is the tooltip's text, exposed to assistive technology.
- **Day arithmetic is on calendar dates, never timestamps.** A day is a
  `YYYY-MM-DD` and the next is that date plus one, so a daylight-saving
  change or time zone cannot skip or repeat a day.
- **Only a date carrying a snapshot opens a recording.** The tick under
  the axis is a click target of its own, so a recording stays reachable
  where a day is narrower than a pixel.

#### The change

The hero states the change between two days, the range's ends or a
selection's. The **amount** is the later day's net worth minus the
earlier's, exact.

- **The percentage is `amount × 100 / |earlier|`**, divided in decimal at
  scale 12 with round-half-even (`record-snapshot.md`, Record shape), then
  written by `percent` at one place, half-even again. Dividing by the
  magnitude keeps a debt shrinking from −1000 to −500 a rise of 50%.
- **No percentage when the earlier net worth is zero**, because nothing
  is a share of zero. The amount stands alone.
- **The sign is the amount's own**: `+` before a rise, `−` before a fall,
  on the amount and the percentage alike, each written from its
  magnitude. So the arrow, amount and percentage never disagree, even
  where a figure rounds to zero. A change of zero carries no sign.

#### The data table

"View as table" stands in for the chart's numbers, not its current view,
so hiding a band and the percentage view leave it unchanged: every band
is a column and every figure is absolute money.

- **Rows are the days the chart samples**, oldest first, one per day: the
  range's first and last day, and every day carrying a snapshot, a price
  entry for any holding's unit (archived ones included), or an
  `archivedAt`. Downsampling removes no row. Other days are read through
  the keyboard.
- **The first column is the date, by `longDate`** (`account-settings.md`,
  Dates and numbers), as the tooltip writes it.
- Under a dimension the bands follow in band order, with "Unassigned" and
  "Other" wherever the chart has them.
- **"Net worth" is the last column**: the exact decimal sum of the row's
  band values, rounded only for display, never read off the drawing's
  float stack.
- Every figure is the value at the row's day, the side at it, written by
  `money`.

### Rules

- All money arithmetic is decimal, never floats (`record-snapshot.md`,
  Record shape). Sums run at full precision and round only for display. A
  chart point costs two multiplications, each rounding half-even at
  scale 12.
- Decrypted strings render as text (architecture.md, Application
  hardening), so no chart library that takes an HTML string for labels or
  tooltips is ever used.
- **The chart is drawn directly in SVG with no charting library.** A
  library supplies scales, tick math and path building. What this chart
  needs (the partition rule, per-holding interpolation, provenance,
  per-band selection deltas, asset and liability mirroring) is domain
  logic either way. The interactive chart prototypes at about 200 lines
  of dependency-free JS, and a production version at an estimated 350 to
  450.
  - SVG, not canvas: direct labels, `tabular-nums` figures and the
    accessible fallback need real DOM.
  - A library added later inherits the constraints: self-hosted,
    hash-pinned, CSP-safe with no `eval` or `new Function`, no CDN
    (architecture.md, Supply chain), and text-only labels and tooltips.
    Measured against the shipped bundles:

    | Library | gz | `eval` / `new Function` | `innerHTML` |
    |---|---|---|---|
    | Chart.js 4.5.1 | 69 KB | 0 | 0 |
    | uPlot 1.6.32 | 21 KB | 0 | 0 |
    | ECharts 6.1.0 | 360 KB | 1 | 15 |
    | ApexCharts 6.6.1 | 226 KB | 0 | 37 |
    | frappe-charts 1.6.2 | 17 KB | 0 | 17 |
    | chartist 1.5.0 | 11 KB | 0 | 1 |

    ECharts, ApexCharts and frappe-charts fail structurally: their label
    and tooltip paths end in `innerHTML`, and where XSS means Master Key
    capture that is not a configuration problem. Chart.js and uPlot pass
    the CSP tests cleanly and are both MIT.
- The chart is keyboard reachable and has a data-table fallback. A static
  `aria-label` on the SVG is not enough for the app's primary screen.
- A very large history downsamples for drawing only. Totals and every
  reading at a date use the full data.
- Formatting follows the reader's settings (`account-settings.md`, Dates
  and numbers).

## Edge cases

Each edge case is a state of the Dashboard (States, Holdings table) or a
rule of the chart (Archived holdings, Ranges and modes).

## Acceptance criteria

1. (walk) With three holdings in different units and known snapshots and
   prices, the total equals the hand-computed `Σ value × price`, exactly
   in decimal, to the cent, in both pricing modes, and the two modes
   differ. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
2. (walk) A holding last recorded in March, with a price entry from this
   week, contributes at this week's price on latest rates and at March's
   price on rates as of each figure. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
3. (walk) Recording one franc holding changes the converted figure of
   every dollar and gold holding, and the band of every foreign unit on
   that date and after, without any of them gaining a snapshot. Test: no
   test.
4. (walk) A rate written today adds a point at today and moves no
   earlier point and no recorded quantity. Test: no test.
5. (walk) Opening the dashboard asks no price source anything, and a
   revised provider figure with nothing recorded changes no figure
   anywhere. Test: `tests/browser/parts/dashboard-net-worth.mjs`.
6. (blind) (walk) Adding, changing or deleting an interior entry in
   either series changes only the stretch between its neighbors,
   asserted for all three operations with every point outside the
   stretch compared. Correcting a rate moves every band in that unit.
   Test: `tests/test_client.py::test_the_client_side_rules_hold`.
7. (walk) Deleting the newest entry of a series moves every point after
   the previous entry and none before it. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
8. (walk) Deleting a whole recording moves every band in the symbols it
   priced, across the stretches those entries anchored and no further,
   including bands with no entry at that date. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
9. (walk) A date carrying rate entries and no snapshots, including a
   recording whose figures were all cleared, still bends the bands of
   the symbols it prices, compared with the same date with those entries
   removed. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
10. A symbol with two differing entries on one date prices that date from
    its neighbors, and the dashboard names the fault. Test:
    `tests/browser/parts/dashboard.mjs`.
11. When that pair is the symbol's only entry, its active holdings are
    listed as not priced. Test: `tests/browser/parts/dashboard.mjs`.
12. (blind) (walk) An active holding with a quantity and no price is
    listed as not priced, is excluded from the total, and its bare
    quantity never appears in the total. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
13. (blind) (walk) On rates as of each figure, a `USD` holding whose
    latest quantity is at 2026-04-10, with `USD` entries only at
    2010-03-31, counts at the 2010-03-31 rate and its row carries
    2010-03-31. A row whose price sits at its quantity date carries no
    price date. Test: `tests/browser/parts/dashboard-net-worth.mjs`.
14. (blind) (walk) On latest rates, in a vault whose newest entry is at
    2026-04-10, a free-text holding priced only at 2024-01-15 carries
    2024-01-15, and a `USD` holding priced at 2026-04-10 carries none.
    The reference date moves between the two modes, so both are
    asserted. Test: `tests/browser/parts/dashboard-net-worth.mjs`.
15. (blind) (walk) The price date is a line in the converted figure's
    cell, never a column, and is absent on a row priced at its own date,
    on a main-currency row and on a not-priced row. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
16. (walk) A holding last valued in March shows "as of" March and still
    counts in the total, with no warning at any age. Every figure
    carries its quantity's date and the screen carries one rate date.
    Test: no test.
17. (walk) A snapshot after the chart range's start does not appear
    before its date, and a holding contributes nothing before its first
    snapshot: ten years of an old holding's history make no step at the
    left edge. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/dashboard.mjs`.
18. (walk) A main-currency holding at 100 on 1 January 2026 and 200 on
    31 January 2026 reads 150 on 16 January, with 1 and 31 January
    marked and 16 January not, with nothing turned on. Nothing on screen
    treats the months between two entries as an omission. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
19. (blind) (walk) The same holding in a unit priced 1.00 on 1 January
    and 2.00 on 31 January reads 150 × 1.50 on 16 January, not the chord
    between 100 and 400. The price must change between the two
    snapshots, or an implementation sampling only snapshot dates passes.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
20. (walk) A chart date before a symbol's first price is priced at that
    entry. The band neither starts at zero nor vanishes. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
21. (blind) (walk) Adding a price entry adds no tick. Ticks mark
    quantity entries only. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
22. (blind) (walk) The chart loads with its entry marks showing, with
    nothing turned on and no stored preference read. Just the line
    removes them and changes nothing else. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
23. (blind) (walk) With recordings on 15 January, 10 April and 30 June
    2026 only, the pointer at 5 February reads 5 February and at 3 June
    reads 3 June, and the tooltip and hero show the value model's bands
    and total exactly in decimal, on days that are not drawing samples.
    Test: `tests/browser/parts/dashboard-net-worth.mjs`.
24. (blind) (walk) A drag from 3 June back to 5 February selects 5
    February to 3 June, and the hero and each legend entry read the
    later day's value minus the earlier's, exactly. Asserted in both
    drag directions. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
25. (blind) (walk) Walking the pointer one pixel column at a time reads
    days that never go backward, from the range's first day to its last,
    and reads every day where the plot has at least as many columns as
    days. Test: `tests/browser/parts/dashboard-net-worth.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
26. (blind) (walk) Stepping one day at a time from the first day reads
    every day once and in order to the last, with the pointer's readout
    on each, across a daylight-saving change. The recorded-date key
    lands on every date carrying a snapshot and on no other. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
27. (blind) (walk) A click or Enter on a day with no snapshot opens
    nothing, and on a snapshot day or its tick opens that date's
    recording. Test: `tests/browser/parts/dashboard-net-worth.mjs`.
28. (blind) (walk) In a history long enough to downsample, the readout
    at a day whose sample was dropped equals the value model, and the
    data table lists that day. Test:
    `tests/browser/parts/dashboard-fixtures.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
29. (walk) Under Total the data table's columns are Date and Net worth
    only. Under a dimension they are Date, the bands in legend order,
    then Net worth. Test: `tests/browser/parts/dashboard-net-worth.mjs`.
30. (blind) (walk) With snapshots on 2026-01-15 and 2026-06-30, a `USD`
    price on 2026-04-10 for a `USD` holding, and a main-currency holding
    archived on 2026-05-20 with no snapshot that day, the table under
    All lists exactly 2026-01-15, 2026-04-10, 2026-05-20 and 2026-06-30
    in order, and under 1M the range's first day and 2026-06-30 only.
    Test: `tests/browser/parts/dashboard-fixtures.mjs`.
31. (blind) (walk) Each table row's band cells equal the value model at
    its day and Net worth their exact decimal sum. Two main-currency
    holdings in different bands at `4503599627370496.25` give
    `9,007,199,254,740,992.50` under `en-US`. Test:
    `tests/browser/parts/dashboard-fixtures.mjs`.
32. (blind) (walk) Each table row's date equals `longDate` of its day
    and the tooltip's date: 2026-01-15 reads `Jan 15, 2026` under
    `en-US` with no `dateStyle` and `15.01.2026` under `dmy`. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
33. (blind) (walk) Hiding a band and switching to Percentage leave the
    table's text unchanged. Test:
    `tests/browser/parts/dashboard-fixtures.mjs`.
34. (blind) Over single-holding totals from 0.40 to 10^10 (each 1, 2, 2.5,
    5 and 7.5 times a power of ten and the integers either side, both
    signs) at 1280px and 390px, no two tick labels read the same, every
    tick is a multiple of a 1, 2 or 5 step of at least 1, zero included,
    and each label read back through its unit equals its gridline. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
35. (blind) (walk) One holding at 2500, at 1280px, has ticks 0, 500,
    1000, 1500, 2000 and 2500, with 1500 reading `1.5` and 2500 `2.5`
    before the suffix, and `1,5` and `2,5` under a comma decimal point.
    Each tick is an exact multiple of the step, never built by repeated
    addition. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/dashboard.mjs`.
36. (blind) (walk) Under `de-DE` with `groupSeparator` `period`, one
    holding at 2500000 at 1280px reads `0`, `500k`, `1M`, `1,5M`, `2M`,
    `2,5M`. With an asset and a liability holding the percentage ticks
    read `−100%`, `−50%`, `0%`, `50%`, `100%`. Both are written by the
    formatter. Test: `tests/browser/parts/dashboard-fixtures.mjs`.
37. (walk) Under `de-DE`, `groupSeparator` `period` and `moneyPlaces`
    `0`, net worth from 1000 to 1368946 gives a change of `+1.367.946`
    and `+136.794,6%`. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
38. (blind) (walk) The change percentage rounds half-even: in the main
    currency under `en-US`, 2000 to 2005 reads `+0.2%` and 2000 to 1995
    `−0.2%`, where a float or half-away rounding gives 0.3. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
39. (blind) (walk) 2000 to 2001 reads `+0.0%` beside the rising arrow,
    −1000 to −500 reads `+50.0%`, and 0 to 500 shows the amount with no
    percentage. Test: no test.
40. (blind) (walk) With a single recording, made today, at 1280px and
    390px, under 1M, 6M, 1Y and All, the point's center is at the plot's
    horizontal middle within half a pixel and its mark's bounding box
    lies wholly inside the drawing. The pointer at either edge and the
    middle reads that day. Test: `tests/browser/parts/dashboard.mjs`,
    `tests/browser/parts/dashboard-review-chart-end.mjs`.
41. (walk) Every recorded point is drawn whole on a computer and a
    phone, including one at the chart's first or last date. Test:
    `tests/browser/parts/dashboard.mjs`.
42. (blind) (walk) With snapshots only at 2026-03-01 and 2026-04-10 and
    a price entry at 2026-01-15, 6M, 1Y and All each start at
    2026-03-01. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/dashboard.mjs`.
43. (blind) (walk) Switching the pricing mode changes the total, the
    list and the breakdown, and no chart point, asserted over every
    sample of every band, not only the right hand edge. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`,
    `tests/browser/parts/dashboard-review-pricing-mode.mjs`.
44. (blind) (walk) On latest rates the right hand edge equals the total
    exactly. With a March figure and a different price this week, rates
    as of each figure gives a total that is not the edge, and nothing on
    screen reports it as a fault. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
45. (walk) Two holdings whose histories start years apart: the later
    one's first snapshot raises only its own band. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
46. (blind) (walk) Archiving on D removes the holding from the total and
    from the value at D and after, with an annotation at D naming it.
    Every point up to and including the latest entry before D of each
    series the archive wrote to is unchanged, compared point by point.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/dashboard-net-worth.mjs`.
47. (blind) (walk) A main-currency holding at 100 on 1 January 2026,
    archived on 31 January 2026, reads 50 on 16 January, and no vertical
    edge is drawn at 31 January. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
48. (blind) (walk) A holding archived on the chart's last day leaves the
    chart's last point, the table's last row and the end of the change
    each equal to the total on latest rates, exactly. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
49. (blind) (walk) A holding archived after the newest recording draws
    the chart to the archive date through its zero, and the point there
    equals the total on latest rates. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
50. (blind) (walk) Changing the price at D of the unit of a holding
    archived on D with its zero leaves its contribution at D and just
    before D at zero, and the confirmation does not count it. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
51. (blind) A holding archived on D with no snapshot at D, loaded from a
    fixture, steps at D from its last quantity carried forward at D's
    price, annotated at D. One loaded with a non-zero snapshot at D steps
    from that figure, and changing D's price moves the side before the
    step and is counted by the confirmation. Loading either writes
    nothing. Test: `tests/test_client.py::test_the_client_side_rules_hold`.
52. (walk) An unarchived holding whose zero sits at D contributes zero
    from D until its next snapshot and interpolates up to it. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
53. (blind) (walk) For every date in the chart, the visible bands sum to
    the net worth line, in decimal, not at a sampled few. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
54. (walk) Each holding appears in exactly one band of the selected
    dimension, the bands together account for every holding, and
    holdings with no value are in a visible, counted "Unassigned" band.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
55. (walk) An active holding with no snapshots is listed as "not yet
    valued" and not counted as 0. With holdings and no values the total,
    gross assets and gross liabilities read `—`, with no change and no
    chart. Test: `tests/browser/parts/dashboard.mjs`,
    `tests/browser/parts/dashboard-review-unvalued.mjs`.
56. (walk) At 1280px, in a vault whose only holdings are active with no
    snapshots, no holdings table and no column heading render. Recording
    one renders the table with that holding as its only row. Test: no
    test.
57. (blind) (walk) With every holding archived, Show archived off
    renders no table, no column heading and the line "Every holding is
    archived.", and on renders each archived holding as a row. The
    absence is asserted on the rendered page, never as a table hidden by
    styling. Test: `tests/browser/parts/dashboard-fixtures.mjs`.
58. (blind) With holdings and no snapshots and an archived holding
    present, the active holdings are under Not yet valued and the
    archived one is an archived row reading "not yet valued" only with
    Show archived on. Test: `tests/browser/parts/dashboard.mjs`.
59. (blind) (walk) Under a dimension every active holding carries, the
    coverage reads "N of N holdings assigned", is neither link nor
    button, is not focusable, and a click leaves the rows unchanged. The
    same at 0 of 0. With one valued active holding unassigned it is a
    control listing exactly that holding. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
60. (blind) (walk) With the unassigned filter applied and nothing
    unassigned left, no table and no column heading render, the line
    reads "Every holding has a Liquidity value. Show all holdings", and
    Show all holdings renders every listed row. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
61. (blind) (walk) The filter clears through Show all holdings and
    through Group by "Total", lists archived unassigned holdings only
    while Show archived is on, narrows the groups the same way, and its
    line reads exactly "Showing the holdings with no Liquidity value.
    Show all holdings". Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
62. (blind) (walk) With Show archived on, in both pricing modes, an
    archived holding in a unit with no price and one with no readable
    snapshot are each a table row with the Archived chip and
    ink-secondary text, the first reading its quantity and "not priced",
    the second "not yet valued". Neither is in either group, while an
    active holding in the first one's unit stays under not priced. With
    the toggle off neither appears anywhere. Unarchive shows on the row
    at desktop width. Test: `tests/browser/parts/dashboard.mjs`.
63. (blind) (walk) At phone width no row, active or archived, carries a
    row action. Tapping an archived row opens the holding's screen
    offering Unarchive, and an active row's offering Record a value.
    Test: `tests/browser/parts/dashboard.mjs`.
64. (blind) (walk) The native-unit column shows an XAU-ozt holding
    stored as "12.125" and an m² holding stored as "80" as typed, under
    `moneyPlaces` 0 and 2, while the converted column follows
    `moneyPlaces`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
65. (walk) A negative-balance holding reduces the net figure and appears
    under liabilities. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/dashboard.mjs`.
66. (walk) The breakdown sums to exactly the net worth total, with no
    disclaimer, and bars of 1,234.50, 4,133.26, 41,373.46 and 340,000
    read 1'235, 4'133, 41'373 and 340'000 under a total of 386'741.
    Gross assets and liabilities as shown add up to the total as shown,
    the day the chart reads included. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/dashboard-review-rounding.mjs`,
    `tests/browser/parts/dashboard-net-worth.mjs`,
    `tests/browser/parts/dashboard-review-hero-day.mjs`.
67. (blind) (walk) With one record corrupted, the view renders the rest
    and warns "1 record could not be read.". With the corrupted record a
    price entry, its symbol still prices from the neighboring entries.
    Asserted with a real corrupted record. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
68. (blind) (walk) Switching range, dimension, absolute and percentage,
    pricing mode or band visibility issues no network request and never
    waits, captured as requests. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`.
69. (walk) A holding named `<script>alert(1)</script>` renders as
    literal text in the list, and a dimension value so named in the
    legend and every tooltip.
    Test: `tests/browser/parts/dashboard-net-worth.mjs`.
70. (walk) With no holdings the screen says so and offers to add one,
    with no zero total. Test: `tests/browser/parts/register.mjs`.
71. (walk) The chart can be driven from the keyboard, and the same
    numbers are available as a plain table. Test:
    `tests/browser/parts/dashboard-net-worth.mjs`,
    `tests/browser/parts/dashboard.mjs`.
72. (blind) (walk) With the mouse resting anywhere on the chart, focus,
    Home, End, the arrow keys and Enter behave as they do with the mouse
    elsewhere. Test:
    `tests/browser/parts/dashboard-review-keyboard.mjs`.
73. (walk) At 320px, 375px, 601px, 901px and 1280px wide, a holding in
    the table and one under Not yet valued, each named with no space and
    wider than the screen, are shown whole inside the screen, and the
    page never pans sideways. Test:
    `tests/browser/parts/dashboard-long-name.mjs`,
    `tests/browser/parts/dashboard-review-long-name.mjs`.
74. (walk) With no decimals on money, three holdings of 0.40 alone in
    their bands read 1, 0 and 0 in the holdings table and in the
    breakdown, under a total of 1. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
75. (blind) (walk) The legend adds up to the chart's right hand edge as
    shown, the legend's changes over a selected span to the change as
    shown, and the readout's rows to its net as shown. Test:
    `tests/browser/parts/dashboard-review-shown-parts.mjs`.
76. (walk) With the last recording on 2026-09-15 and today 2026-10-03,
    the chart ends on 2026-10-03, the last figure runs level to it, 1M
    starts on 2026-09-03 and All on the first recording. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/test_review_net_worth_view.py::test_the_chart_ends_today_and_every_range_counts_back_from_it`,
    `tests/browser/parts/dashboard-review-chart-end.mjs`.
77. (walk) With every holding archived, the total, gross assets and
    gross liabilities read `—` with no change, and hovering the chart
    fills its tooltip and leaves the hero a dash with no date. Test:
    `tests/browser/parts/dashboard-fixtures.mjs`,
    `tests/browser/parts/dashboard-review-unvalued.mjs`.
78. (walk) With no active dimension, a "Create a dimension" link sits
    beside Group by and opens the Dimensions screen without asking for
    the password, and once a dimension is active the link is gone. Test:
    `tests/browser/parts/dimensions.mjs`,
    `tests/browser/parts/dashboard-review-create-dimension.mjs`.
79. (walk) At 320px, 375px, 601px, 901px and 1280px wide, under a Group
    by whose values are wider than the screen, one with no space and one
    holding `<img src=x onerror=alert(1)>`, each band's name lies inside
    its card in the legend and the breakdown, beside a positive bar and a
    negative one, and the page never pans sideways. Test:
    `tests/browser/parts/dashboard-long-value.mjs`,
    `tests/browser/parts/dashboard-review-long-value.mjs`.
