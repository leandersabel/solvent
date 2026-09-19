# Record a value

## What it does

Records what one holding was worth on one date. A date, a number in the
holding's own unit, and the price used to turn it into your main
currency. Do that a few times a year per holding and the result is your
history, which is what the chart draws and what the total is made of.

This is the recurring act in Solvent. Everything else is setup. It is
for the person who sits down at the end of a month or a quarter, opens
the online banking of four banks, and wants to be done in a few minutes.

The number you type never leaves your browser in readable form, and it
is never part of any price lookup the app makes. The app can ask what a
troy ounce of gold was worth on 31 July without anyone learning that you
hold twelve of them.

## The price, and why it is kept

A holding measured in dollars has to become francs to join your total.
The app proposes the price where a source exists, you can always change
it, and the price you actually used is kept with that entry forever.

That last part is the whole point. The price is never recalculated
later, so today's currency move does not rewrite what you were worth in
2019. A chart that changes its own past is not a record of anything.

The app is also honest about where each price came from, and stays
honest a year later. Each entry says whether the price was the one the
app proposed, one you changed (and shows what was proposed), or one you
typed because nothing was available. That is a question you will only
ever ask about an old figure, which is why it is stored rather than
remembered by the tab that entered it.

## The screens

### The sweep: updating everything in one sitting

The main way to record values, and the screen that decides how much your
monthly update costs you.

One date at the top for the whole sweep, defaulting to today. One row
per active holding, each one showing what it is worth now, and how long
ago that figure was actually recorded, in plain words: "3 weeks ago",
"about a year ago", "never valued". A figure that has simply been
carried forward since the last time you touched it says so, so you find
out here rather than believing the chart.

Each row offers two ways to be done with it:

- **Type the new number.** The unit is on the field, and the converted
  figure appears as you type. Nothing is saved until you act on the row.
- **Confirm.** One click, meaning "this is still the same". The quantity
  is written again at today's date without you retyping it.

Confirm is not a shortcut for lazy people, it is the correct answer for
most holdings. You still own the same 12.5 troy ounces. What moved is
the gold price, and that is the app's job, not yours. What it costs you
depends only on whether anything can contradict you:

- **Already in your main currency.** One click, no price question at
  all, because there is nothing that could be wrong.
- **Something with a live price source**, like a foreign currency or
  gold. One click, and the app fetches the price for the new date. It
  never reuses the old price. Stamping a new date onto a price a known
  source disagrees with looks like a measurement and is not one.
- **Something with no price source**, like your flat or the wine. One
  click, and your last price carries forward, shown to you before you
  save. You are the only authority on that number, so your last estimate
  is the best figure there is.
- **A live source that does not answer** (the provider is down, or has
  nothing for that date). The one click steps aside and the row asks for
  the price, with the quantity already filled in. You are only asked for
  the part nothing can supply, and the click comes back as soon as
  prices do.

Rows save one at a time as you finish them. You can stop halfway through
and keep everything you entered, and a row that fails to save says so on
itself and leaves the others alone.

### One holding, one date

A small form for everything the sweep is not for: an odd date, a value
you forgot to enter in March, history you are backfilling from old
statements. Holding, date, value, price, an optional note. The converted
figure updates as you type, because that is the number you are actually
reasoning about.

### Finding and fixing a wrong figure

The holding's own page lists every value ever recorded for it, newest
first, with the date, the figure, the price used, the converted amount,
and where that price came from. This is where a typo from eight months
ago gets found and corrected.

Correcting the number or the note leaves the price alone. Correcting the
price records that you changed it, and keeps what the app had proposed.
Moving an entry to a different date makes the app offer the price for
the new date beside the field, as one click, without applying it. The
usual reason for a date correction is a mistyped day on a figure that
was always about the day you meant, so the price you already vouched for
stays unless you say otherwise.

Deleting a value asks once, naming what will happen: your net worth
around that date will change.

## What must be true

- A value recorded today shows up in the total and the chart
  immediately, with no reloading and no waiting.
- The converted figure is visible while you type, before anything is
  saved.
- A price that moves tomorrow does not change any figure you already
  recorded, or any point in the chart before today.
- A value entered on one machine reads back identically on another,
  down to the last decimal. No figure ever drifts by a fraction of a
  cent through being stored and read back.
- Nothing the app sends out to look up a price contains the amount you
  are entering, in any form.
- The price provider being down never stops you recording a value. The
  form says so quietly and lets you type the price.
- A holding with a unit you made up never triggers a lookup at all, and
  the form says why the price field is yours to fill rather than showing
  an empty field with no explanation.
- A holding measured in your main currency never shows a price field.
- Recording a second value for a holding on a date it already has asks
  whether to replace the one that is there, naming the figure already
  recorded, and ends with one value on that date either way.
- Moving an entry onto a date that is already taken warns that the other
  entry will be destroyed, in different words than the ordinary replace,
  because a second record dies.
- If that move half fails, nothing is lost. The holding's page shows
  both entries flagged and asks you which to keep, and the chart leaves
  that date out until you answer, rather than picking one and putting a
  number you never chose into your history.
- Confirming a holding with a live price source stores the new date's
  price, never the old one.
- Confirming a holding with no price source carries your last price
  forward and shows it to you before saving.
- Confirming is unavailable for a holding that has never been valued.
  There is nothing to confirm.
- A value of zero is accepted and means a closed out position, which is
  not the same as a holding you never valued.
- A negative value is accepted. A mortgage is a holding with a negative
  balance, and your net worth is a signed sum.
- A date in the future is refused.
- A date before you created the holding is accepted, because entering
  ten years of old statements is a normal thing to do.
- An entry that was recorded a year ago still says, today, whether its
  price was proposed, changed by you, or typed by you.
- Entering the same value in two browser tabs does not silently lose one
  of them.

## What it deliberately does not do

- **No transactions.** One figure per holding per date, not every
  deposit and withdrawal. Solvent records what things were worth, not
  what happened. Spending and budgeting are somebody else's product.
- **No more than one value per holding per day.** A date holds what it
  was worth that day. Intraday movement is not what this measures.
- **No future dates.** An entry describes what was.
- **No confirming everything at once.** Confirming is a statement that
  you checked, and a button that makes that statement for fifteen
  holdings at once would put figures into your history that nobody
  looked at. See the question raised with this batch.
- **No automatic price for things without a market.** Your flat, the
  wine, the private loan you made. Nobody publishes a price, so the app
  does not invent one.
- **No audit view across holdings.** "Show me every price I typed by
  hand" is a different question with a different shape, and it is not in
  this version. The provenance of each price is on the holding's page.

## Decisions taken on your behalf

These were not in anything you said. They are marked so you can overrule
them.

- **One value per holding per date**, with entering a second one
  offering to replace the first.
- **Future dates are refused** outright rather than warned about.
- **Confirming never reuses an old price for something with a live
  source.** The price is refetched, and if none comes back the one click
  becomes a short question instead. The alternative, carrying the old
  price forward, is quieter and sometimes wrong in a way nothing on
  screen would reveal.
- **The closing value offered when archiving a holding** follows the
  same one value per date rule as everything else, so archiving on a
  date that already has a value offers to replace it.
