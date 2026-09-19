# Net worth view

## What it does

Answers the question the product exists for: what am I worth, right
now, and how did it get there. It is the screen you open, and the only
one you might open without intending to change anything.

Everything on it is assembled in your own browser from the figures you
recorded, after you unlock. The machine that stores your vault cannot
read any of it, so it computes nothing here and learns nothing from
what you look at.

## How it should look

The look is the one described in app shell: a private bank, which here
means restraint. What this screen adds is where the restraint spends
itself. The total is the largest thing in the product and nothing
competes with it. Every other figure is quiet, aligned, and stated
rather than decorated.

The chart is the one place color carries meaning, and it is held to the
same rule as everywhere else: every band is labeled, so a reader who
cannot tell two colors apart loses nothing.

Everything described here is the screen on a computer. It works on a
phone too, where picking a span by dragging across the chart needs an
answer of its own. That shape is a later design and not part of the
first version (`app-shell.md`, which owns the rule).

## The screens

### The total

At the top, your net worth in your main currency, and beneath it the
change over whatever span the chart is showing, as an amount and a
percentage, with an arrow carrying the direction so color is never the
only signal.

Beside it, in smaller type, your gross assets and your gross
liabilities. Net worth is a signed sum, and hiding a mortgage inside one
collapsed figure hides the most important thing about it.

Each holding joins the total at its last recorded quantity, valued at
the most recent rate for its unit. Your March dollar balance, at this
month's rate. Two dates are in play and both are on the screen: each
holding states the date of its own last figure, and the screen states
one date for the rates, which is the day you last recorded anything.
Recording anything refreshes every rate, so there is one rate date for
the whole vault rather than one per holding (`record-snapshot.md`,
which owns that rule).

An "Update values" action sits here and in the top bar of every screen,
because the total is where you arrive already intending to update it.

### Which rates the screen is using

A two-position control beside the total:

- **Latest rates**, with the date they are from. Every holding's last
  figure at the newest rate there is. This is what you are worth, and
  it is the position the screen opens in.
- **Rates as of each figure**, which values each holding at the rate
  that applied on the day you last recorded it. Your March dollars at
  March's rate.

Both sides are named rather than one being an unlabeled off state,
because both are real questions and the default deserves a name as
much as the alternative. It says latest rather than today's because
nothing here fetches anything: the newest rate you have is the one
your last recording wrote.

The second position is for comparing, not a second answer. Held
against the first it tells you how much of the move since you last
looked was your money and how much was the rates, which is the one
thing the first position cannot show on its own. It changes the total,
the list of holdings and the breakdown, and leaves the chart alone,
because every point in the chart is already drawn at the rates of its
own date and there is nothing there for the control to do. In the
second position the total is not the chart's right hand edge. That is
the comparison working, not a disagreement.

### The chart

A stacked area chart over time. One band per value of whichever axis you
group by, the bands adding up to your net worth, assets stacking upward
from zero and liabilities mirroring downward in the same color, with the
net worth line drawn over the top.

It answers two questions at once: how the total moved, and what it was
made of while it moved. Grouped by nothing, it is a single band, which
is just your net worth over time.

What it is actually for, in order:

- **The shape of the last few years.** Range buttons for one month, six
  months, one year and everything, defaulting to a year.
- **What one part of your money did over a specific span.** You drag
  across the chart between any two dates, the selection stays after you
  let go, the total at the top becomes the change across exactly those
  two points, and every band in the legend gets its own change for the
  same span. This is how "what did my retirement do between 2019 and
  2024" gets answered, and it is the reason the chart is worth building
  rather than buying.
- **Composition drift.** Clicking a legend entry hides a band, hovering
  one highlights it, and the crosshair reads out every visible band and
  the total for the date under the cursor.
- **Shares rather than amounts.** A percentage mode, which measures each
  side against itself, because a share of a net figure means nothing
  when the net figure is near zero.

Beside the grouping control, the app states how much of your money the
axis actually covers: "7 of 10 holdings assigned", clickable to see
which ones are not. An axis you only ever filled in for three holdings
draws a chart that is perfectly correct and completely misleading, and
this line is what stops that being read as a bug.

The crosshair's date is also the way back into that day. Where you
recorded something on the date under the cursor, the chart opens that
recording, which is where a figure or a rate from that day is
corrected (`record-snapshot.md`, which owns that screen).

Nothing you touch on the chart contacts the network. It is all already
in front of you.

### The chart is mostly inferred, and says so

Each holding is recorded whenever you get around to it, which for some is
monthly and for others every few years, and one update covers whatever
you gathered that evening. So the chart has a handful of real points per
holding and a great many days to draw. Between two of a holding's
entries the app interpolates its quantity, and after the last one it
carries the quantity forward. The rate does the same along its own run
of entries. That is how the line is meant to work: record a holding in
September after a figure from March and the line runs straight from the
March figure to the September one.

So a band moves on days you recorded nothing about the holding under
it. Your dollar account holds the same dollars it held in March and its
band still rises and falls, because the dollar did. That is not a guess
at what you might have done, it is what those dollars were worth. And
because recording anything writes every rate (`record-snapshot.md`), a
sweep in which you touched only your franc account still puts a real
rate point in the dollar and gold runs on that date, so the foreign
bands bend there too.

Neither the interpolation nor the carry forward is written down. They
are the drawing. Your history holds the quantities you recorded and the
rates written alongside them and nothing else (`record-snapshot.md`),
so a long run between two entries is the normal shape of a correct
chart rather than a hole in it.

The dates you recorded something are marked on the chart from the
moment it loads. They are the points the line is actually built from,
and they are the dates that open a recording when you click them, so
the marking earns its place twice over: it says which part of the line
you gave it, and it shows you where there is something to go back to.

One control takes the marks away and leaves a clean line, for when you
want to look at the shape rather than the evidence. The honest drawing
is what you get without asking for it, and the tidier one is the thing
you choose.

The chart is drawn as curves rather than steps deliberately. Real
transfers are instant and sharp, but a decade of sparse entries drawn as
steps is a field of cliffs that is harder to read than a smooth line and
no more truthful. Where you do want the sharp edge, record a value on
the day it happened and you get one.

A holding contributes nothing to dates before its first recorded value.
Entering ten years of an old holding's history does not make a cliff at
the left edge of the chart. An archived holding contributes nothing
after its archive date, and that date is annotated with the holding's
name, because an unexplained vertical drop in an otherwise smooth chart
is indistinguishable from a bad entry.

### The list of holdings

Below the chart, every active holding: its name, what it is filed under,
its latest figure in its own unit, the same figure in your main
currency, and the date that figure is as of.

The as of date is the date of the quantity, never of the rate. A
holding has two ages now and only one of them is yours: the rate's age
is one date for the whole screen rather than a column, because you
cannot act on it and because it is the same for everything. The
quantity's age sorts, which is how you find what you have not touched in
a while without the app deciding for you what counts as too long. Each
date in a holding's own list opens the recording that wrote it, which
is how a wrong figure from last year gets put right
(`record-snapshot.md`).
Holdings you have never valued are listed separately as "not yet
valued", never as zero, because zero is a real figure that means
something else. Archived holdings are hidden behind a toggle. Clicking a
row opens that holding.

There is no separate "Accounts" entry in the navigation. This list is
the account list, and a fourth entry would either lead back to this
screen or open a thinner copy of it.

### The breakdown

At the foot, a bar per band of the axis you grouped by, in the same
order as the chart so the two read as one thing, each bar labeled with
its value and amount. Where the chart shows how the composition moved,
this shows what it is right now, which is a different question.

A band can be net negative, a mortgage under "Fixed", so the bars grow
from a shared zero line and negative bands grow the other way. The bars
add up to exactly your net worth, with the negative ones subtracting, so
the section needs no small print.

## What must be true

- The total equals the sum of every active holding's last recorded
  quantity at the most recent rate for its unit. Exactly, to the cent,
  checkable by hand.
- Every figure on screen carries the date of the quantity behind it,
  and the screen carries one date for the rates it used.
- A rate written today adds a point at today and moves nothing before
  it. No past point in the chart and no quantity you recorded changes.
- The chart's past moves only when you move it. Opening a recording
  and correcting a figure or a rate changes the chart at that date,
  which is the correction working and not the chart drifting
  (`record-snapshot.md`). Correcting a rate moves every band measured
  in that unit on that date.
- Nothing on this screen contacts a price source. What it shows are the
  rates already in your vault, written by your last recording.
- For every date in the chart, the visible bands add up to the net worth
  line at that date.
- The breakdown bars add up to the total, with no disclaimer attached.
- Every holding appears in exactly one band of the chosen axis, and the
  bands together account for every holding.
- Holdings not filed under the chosen axis appear in an "Unassigned"
  band, which is visible and counted, never dropped.
- A holding with two entries, 100 in January and 200 in March, reads 150
  in February, and January and March carry a mark while February does
  not, without anybody turning anything on.
- A holding recorded in March and then not again until September draws
  a straight run between those two figures, and nothing on the screen
  treats the months between as an omission.
- An update that covered only some of your holdings records a quantity
  only for those. Every other holding keeps the quantity it had, with
  nothing recorded for it and nothing flagged, and its band still moves
  if its rate did.
- Recording one franc account moves every band measured in a foreign
  unit, on that date and after it, because every rate was refreshed.
- Switching to rates as of each figure changes the total, the list and
  the breakdown, and leaves the chart pixel for pixel the same.
- On latest rates, the chart's right hand edge is the total.
- Two holdings whose histories start years apart do not bend each
  other's shape. The later one's first entry lifts only its own band.
- A holding you have never valued is listed as not yet valued and is not
  counted as zero.
- With no holdings at all, the screen says so and offers to add one,
  rather than showing a zero total.
- With holdings but no values, the total reads as a dash rather than
  zero, and there is no chart.
- With exactly one recorded value in the whole vault, the chart shows
  one point rather than a flat line running back to the beginning of
  time.
- A negative holding reduces the total and appears on the liabilities
  side.
- Archiving a holding leaves every point before the archive date
  untouched, removes it from today's total, and annotates that date.
- Changing the range, the grouping, the mode or which bands are visible
  never contacts the network and never waits.
- The chart can be driven from the keyboard, and the same numbers are
  available as a plain table for anyone who cannot use the chart.
- If any part of your vault cannot be read back, the screen still shows
  everything that can, with an unmissable notice saying how many entries
  could not be read. It is never swallowed and it never takes the whole
  screen down.
- A holding named after something that looks like code is shown as the
  literal text you typed, in the list, the legend and every tooltip.

## What it deliberately does not do

- **No warning that a figure is old.** No badge, no color, no threshold.
  Your holdings move at completely different speeds, a current account
  monthly and a flat every few years, so any single threshold would flag
  the slow ones permanently until you learned to ignore it, at which
  point it would fail for the one that genuinely went quiet. Instead
  every figure states its age in plain words next to the action that
  records a new one. See the question raised with this batch.

  This is about the age of a quantity, the only age that is yours. A
  rate's age is the app's to keep down and it is stated once for the
  whole screen, so there is nothing to badge there either.
- **No rate lookup from this screen.** Opening the overview fetches
  nothing. Rates move when you record something (`record-snapshot.md`),
  which is why the control reads latest rates and not today's rates.
- **No forecast, no projection, no target.** The chart ends today.
- **No benchmark and no performance figure.** Solvent does not tell you
  how you are doing against an index, which would need position level
  data it deliberately does not hold.
- **No income, spending or cash flow.** What things are worth, not what
  moved.
- **No pie chart.** A pie cannot show a negative slice at all, and your
  mortgage is a negative slice.
- **No fifth color in the chart.** An axis may hold as many values as
  you like, but past four the rest are folded into "Other", because
  beyond that no set of colors stays distinguishable, including for
  color blind readers.

## Decisions taken on your behalf

These were not in anything you said. They are marked so you can overrule
them.

- **The chart defaults to one year**, or everything when your history is
  shorter, and defaults to grouping by nothing until you have set up an
  axis.
- **The control that hides the marks is called Just the line.** The
  name is a decision taken on your behalf. It has to say what it does
  without claiming the marked chart is the untidy one, since the marked
  chart is the accurate one.
- **The screen opens on latest rates.** That is the answer to what am I
  worth. The other position answers a question you go looking for, and
  opening on it would put a comparison where the headline belongs.
- **Archived holdings leave the current total** and stay in history.
- **A holding with no recorded values is left out of the total** rather
  than counted as zero.
- **A very long history is thinned out for drawing only.** Totals are
  always computed on everything you recorded.
