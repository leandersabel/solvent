# Manage accounts

## What it does

Keeps the list of what you own and what you owe. One entry per holding:
a bank account, a brokerage depot, the gold in the safe, the flat, the
mortgage on it. Everything else in Solvent stands on this list.

It is for one person at a time. Each household member has a separate
vault with a separate password, and no one sees inside anyone else's.

What you type here is readable only by you. A holding's name, its note
and how you filed it are locked in your browser before they are stored,
so the machine that keeps the list cannot read it. Two things follow,
and both are intended: nobody can look your holdings up on your behalf,
and nobody can recover them if you lose your password.

The screens carry the look described in app shell. Nothing here is
decorated, and nothing nags.

## What a holding is

- **A name.** Free text, in any language. Two holdings may share a name,
  because two accounts at the same bank legitimately have the same one.
- **What it is measured in.** Swiss francs, dollars, troy ounces of
  gold, square meters, bottles. One choice, and it is the same choice
  the app uses to look up a price. A holding can therefore never be
  measured in grams and priced per ounce, which is the kind of mistake
  that is wrong by a factor of thirty and shows nowhere on screen.
- **Where it is filed.** Zero or more axes, each one a question you
  invented about your money: Liquidity, with values Cash, Investments,
  Retirement. A holding sits in exactly one value of each axis, or in
  none. See net worth view for what filing buys you.
- **A note.** Optional, free text, for what was never a category:
  "joint with M", "sold half in 2024".

A brokerage depot is one holding, measured in the currency the broker
reports in, and its value is the total the broker shows you. Not one
line per position.

## The screens

### Adding or changing a holding

A short form: name, what it is measured in, one line per axis you have
configured, and a note hidden behind "Add a note" so it does not clutter
the common case.

The unit is picked from a list your administrator maintains, with a
"Something else..." option at the foot for anything not on it. Picking
from the list is what lets the app propose prices later. Typing your own
unit is a normal answer for a flat or a wine cellar, and the form says
what it costs in one line at the moment you choose: you will enter the
price yourself each time. Some units on the list are there without a
price source behind them, and those are marked in the list as
"rate entered by hand" rather than hidden. When a unit you want is
missing, the form says the administrator configures the list, so you do
not go looking for a setting you do not have.

Filing happens inside this form, never on another screen. Each axis has
a "new value" option at the foot of its list, and there is a "new axis"
option below the block. A taxonomy you have to leave a half filled form
to maintain is a taxonomy that stops being used.

With no axes configured the block collapses to a single link, and
nothing anywhere nags you to create one. A vault with no filing at all
is a complete vault.

### Stopping a holding: you choose

Selling the flat is not the same act as deciding the flat should never
have been in the list, so the app asks which one you mean.

**Archive** is the normal answer and comes preselected. The holding
leaves your active list and your current total, it takes no new values,
and every value you ever recorded for it stays. Your net worth for last
year does not move. You can undo it.

The same dialog offers to record a closing value on the archive date,
prefilled at zero and editable: what it was worth when you closed it.
This is the expected path rather than a nicety. With it, the chart runs
down into the closing figure like any other recorded value. Skip it and
the chart still drops on that date, with nothing recorded to explain
why, so the app says that in the dialog rather than letting you find out
in a chart six months later. Either way the date is annotated as an
archive, so the drop is never mistaken for a bad entry.

**Delete permanently** is the other answer, and it removes the holding
and every value ever recorded against it. You type the holding's name to
confirm, and the dialog states plainly that your past net worth figures
will change, because the history is what is going away.

A holding with no recorded values skips the dialog and is simply
deleted. There is nothing to lose.

Unarchiving is one action with no dialog. The holding rejoins the list
and the current total.

## What must be true

- A holding added on one machine is there, with the same name, note and
  filing, the next time you unlock the vault on another machine.
- Someone who takes the stored data finds no holding name, note or
  filing in it that they can read.
- Two holdings can be given the same name and both work.
- A holding measured in something you typed yourself works normally, and
  never causes the app to ask anyone on the internet for a price.
- A holding measured in your own main currency never asks you for a
  conversion rate anywhere in the product.
- Renaming an axis or one of its values changes it everywhere it appears
  at once, and changes nothing about any holding.
- A holding you never filed under an axis shows as "Unassigned" for that
  axis, which reads as a normal state and not as an error.
- Archiving a holding leaves every net worth figure before the archive
  date exactly as it was, and removes the holding from today's total.
- Archiving with the closing value accepted makes the chart run into
  that figure. Archiving with it skipped still works, and the chart
  drops on that date with an archive annotation.
- Unarchiving puts the holding back in the list and back in the total,
  with all its history.
- Deleting permanently takes the holding and all its values together.
  There is no state where half of it is gone.
- A holding belonging to another household member can never be reached
  or deleted, and the app gives no hint that it exists.
- Once a holding has recorded values, the app refuses to change what it
  is measured in and says why, rather than quietly reinterpreting
  figures you entered in the old unit.
- Editing a holding in two browser tabs at once does not silently lose
  one of the edits. The second one is told and asked to redo it.
- A name, note or axis label containing something that looks like code
  is shown as the literal text you typed, everywhere it appears.

## What it deliberately does not do

- **No position level tracking of shares.** No tickers, no share counts,
  no cost basis, no per holding performance. A depot is one figure you
  read off your broker, the same act as updating a bank balance. This is
  the single largest scope decision in the product and it is what keeps
  a monthly update to a few minutes.
- **No automatic connection to any bank.** A third party cannot encrypt
  on your behalf, so a bank feed and a vault only you can read cannot
  both exist. Values are entered by hand, and the sweep screen (record a
  value) is what makes that cheap.
- **No free floating tags alongside axes.** A yes or no label is an axis
  with one value, which the form shows as a single checkbox. Two ways to
  classify the same holdings would mean two ways to spell one thing, and
  only one of them can be added up honestly in a chart.
- **No permanent deletion of an axis or one of its values.** Archiving
  hides it and keeps every holding's filing, so restoring it puts every
  holding back exactly where it was. An option to strip a filing from
  every holding would be a destructive change across your whole vault
  offered to tidy up something nobody can see.
- **No search or report the server runs for you.** It cannot read your
  list. Everything you see is assembled in your own browser after you
  unlock.

## Decisions taken on your behalf

These were not in anything you said. They are marked so you can overrule
them.

- **Archive is preselected** in the stop dialog, and permanent delete is
  the secondary action.
- **The closing value is prefilled at zero.** Zero is right for a
  position that simply ended and wrong for one you sold at a figure, so
  the field is editable and never saved without you looking at it.
- **What a holding is measured in is frozen once it has values**, and
  the only route to a different unit is to archive it and start a new
  holding, which breaks the history in two. See the question raised with
  this batch.
- **A holding sits in at most one value of each axis.** This is what
  makes the chart's bands add up to your net worth. A holding that is
  half retirement and half cash has to be two holdings.
- **An axis may hold as many values as you like**, but the chart colors
  the first four and folds the rest into "Other". The limit is the chart,
  not your data.
