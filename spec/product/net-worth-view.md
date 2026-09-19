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

## The screens

### The total

At the top, your net worth in your main currency, and beneath it the
change over whatever span the chart is showing, as an amount and a
percentage, with an arrow carrying the direction so color is never the
only signal.

Beside it, in smaller type, your gross assets and your gross
liabilities. Net worth is a signed sum, and hiding a mortgage inside one
collapsed figure hides the most important thing about it.

Each holding's figure is converted at the price recorded with its own
most recent entry, so a flat last valued in March joins the total at
March's exchange rate. That is visible: every figure shows the date it
is as of.

An "Update values" action sits here and in the top bar of every screen,
because the total is where you arrive already intending to update it.

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

Nothing you touch on the chart contacts the network. It is all already
in front of you.

### The chart is mostly inferred, and says so

You record values a few times a year. The chart draws a line for every
day. Everything between two of your entries is the app interpolating,
and everything after a holding's last entry is the app carrying the
figure forward.

A "Show what's estimated" checkbox marks the dates where you actually
recorded something. It is off by default, which is a decision taken on
your behalf and raised as a question with this batch.

The chart is drawn as curves rather than steps deliberately. Real
transfers are instant and sharp, but a decade of sparse entries drawn as
steps is a field of cliffs that is harder to read than a smooth line and
no more truthful. Where you do want the sharp edge, recording a value on
the day it happened produces it honestly.

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

The as of date sorts, which is how you find what you have not touched in
a while without the app deciding for you what counts as too long.
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

- The total equals the sum of every active holding's latest figure
  converted at its own recorded price. Exactly, to the cent, checkable
  by hand.
- Every figure on screen carries the date it is as of.
- A currency moving today changes nothing about any past point in the
  chart, and nothing about any figure already recorded.
- For every date in the chart, the visible bands add up to the net worth
  line at that date.
- The breakdown bars add up to the total, with no disclaimer attached.
- Every holding appears in exactly one band of the chosen axis, and the
  bands together account for every holding.
- Holdings not filed under the chosen axis appear in an "Unassigned"
  band, which is visible and counted, never dropped.
- A holding with two entries, 100 in January and 200 in March, reads 150
  in February, and that stretch is marked when the estimated checkbox is
  on.
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
  every figure states its age in plain words next to the control that
  fixes it. See the question raised with this batch.
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
- **Estimated stretches are not marked by default.** The checkbox is off
  when the screen loads. Raised as a question with this batch.
- **Archived holdings leave the current total** and stay in history.
- **A holding with no recorded values is left out of the total** rather
  than counted as zero.
- **A very long history is thinned out for drawing only.** Totals are
  always computed on everything you recorded.
