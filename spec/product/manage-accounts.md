# Manage holdings

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

The screens carry the look described in `app-shell.md`. Nothing here is
decorated, and nothing nags.

## What a holding is

- **A name.** Free text, in any language. Two holdings may share a name,
  because two accounts at the same bank legitimately have the same one.
- **What it is measured in.** Swiss francs, dollars, troy ounces of
  gold, square meters, bottles. One choice, and it is the same choice
  the app uses to look up a price. A holding can therefore never be
  measured in grams and priced per ounce, which is the kind of mistake
  that is wrong by a factor of thirty and shows nowhere on screen. It
  also picks which run of rates the holding is valued by, shared with
  every other holding in that unit and kept separately from the
  figures you record (`record-snapshot.md`).
- **Where it is filed.** Zero or more dimensions, each one a question you
  invented about your money: Liquidity, with values Cash, Investments,
  Retirement. A holding sits in exactly one value of each dimension, or
  in none. That is what makes the chart's bands add up to your net
  worth, so a holding that is half retirement and half cash is two
  holdings. What filing buys you is in `net-worth-view.md`.
- **A note.** Optional, free text, for what was never a category:
  "joint with M", "sold half in 2024".

A brokerage depot is one holding, measured in the currency the broker
reports in, and its value is the total the broker shows you. Not one
line per position.

## The screens

### Adding or changing a holding

A short form: name, what it is measured in, one line per dimension you
have configured, and a note hidden behind "Add a note" so it does not
clutter the common case.

The unit is the one choice on this form that is fixed once the holding
has values (What must be true), so the picker offers the ordinary
choices first and says what an unusual one commits you to.

The unit is picked from a list an administrator maintains for the whole
instance, with a "Something else..." option at the foot for anything
not on it, and picking from the list is what lets the app propose
prices later. Typing your own unit is a normal answer for a flat or a
wine cellar, and the form says what it costs in one line at the moment
you choose: you will enter the price yourself each time. Units on the
list with no price source behind them are marked "rate entered by hand"
rather than hidden. When a unit you want is missing, the form says the
list is configured for the instance as a whole rather than per vault,
so you do not go looking for a setting you do not have.

Filing happens inside this form, never on another screen. Each
dimension has a "new value" option at the foot of its list, and there
is a "new dimension" option below the block. A taxonomy you have to
leave a half filled form to maintain is a taxonomy that stops being
used. Renaming, reordering and archiving live on their own screen
(`account-settings.md`).

With no dimensions configured the block collapses to a single link, and
nothing anywhere nags you to create one. A vault with no filing at all
is a complete vault.

### Stopping a holding: you choose

Selling the flat is not the same act as deciding the flat should never
have been in the list, so the app asks which one you mean.

**Archive** is the normal answer and comes preselected. It records zero
for the holding on the day you archive it. The holding leaves your
active list and your current total and takes no new values. Every figure
you recorded for it before that day stays exactly as it was. You can
undo it.

The zero is what archiving means, so the dialog asks for no closing
value. When the holding already has a figure for that day, the dialog
says the zero replaces it. The zero is recorded like any other figure:
it joins the recording for that date and refreshes the rates as any
recording does, and where that date already holds a recording, the
rates it holds stand (`record-snapshot.md`).

While a holding is archived, you cannot change or remove its zero. To
change it, undo the archive. Earlier figures can still be corrected,
but none can be moved onto the archive date or past it, because that
would put a figure where the zero is or after the holding closed. Deleting the recording for the archive date takes everything
else recorded that day and keeps the archived holding's zero, so the
date stays a recording, and the confirmation says so.

The chart runs from the holding's last recorded figure down to zero on
the archive date, as it does between any two figures, and the date is
annotated as an archive (`net-worth-view.md`). Your net worth on the
days between can change, as it does for any new figure.

**Delete permanently** is the secondary answer, and it removes the holding
and every value ever recorded against it. You type the holding's name to
confirm, and the dialog states plainly that your past net worth figures
will change, because the history is what is going away.

A holding with no recorded values skips the dialog and is simply
deleted. There is nothing to lose.

Unarchiving undoes an archive in one action with no dialog. The holding
rejoins the list and the current total and takes values again. Its
history stays as it is, the archive's zero included, so it counts as
zero until you record a new figure.

A holding archived without a zero on its archive date keeps its history
as it is. Unarchiving it and archiving it again gives it one.

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
- Renaming a dimension or one of its values changes it everywhere it
  appears at once, and changes nothing about any holding.
- A holding you never filed under a dimension shows as "Unassigned" for
  that dimension, which reads as a normal state and not as an error.
- Archiving a holding records zero for it on the archive date and
  removes it from today's total. Every figure you recorded before that
  date stays exactly as it was.
- Archiving never asks what the holding was worth.
- Archiving a holding that already has a figure on the archive date
  says, before it goes through, that the zero replaces it.
- Archiving onto a date with no recording starts one and refreshes the
  rates for that date, like any recording. Archiving onto a date that
  already has a recording joins it, and the rates it holds stand.
- While a holding is archived, its zero on the archive date cannot be
  changed or removed, from the holding's page or from that date's
  recording. Unarchiving makes it changeable again.
- While a holding is archived, the app offers no way to record a new
  value for it, on any date.
- While a holding is archived, its earlier figures can still be
  corrected or deleted, but none can be moved onto the archive date or
  past it. Trying to is refused because of the archive, never because
  the date is in the future, and the refusal goes away as soon as you
  enter a date before the archive.
- Deleting the recording on an archived holding's archive date removes
  everything else recorded that day and keeps the holding's zero. The
  date stays a recording, and the confirmation says the zero stays.
- Archiving the last holding measured in a unit stops that unit being
  refreshed when you record. Its rates so far stay and unarchiving
  resumes them.
- Unarchiving puts the holding back in the list and back in the total,
  with all its history, the archive's zero included. It reads zero until
  you record a new figure, and you can record one.
- Deleting permanently takes the holding and all its values together.
  There is no state where half of it is gone.
- A holding belonging to another household member can never be reached
  or deleted, and the app gives no hint that it exists.
- A value recorded for a holding years ago can be put right by opening
  the recording it belongs to, reached from the holding's own list of
  values (`record-snapshot.md`). Nothing about a holding's history is
  fixed once it is written.
- Once a holding has recorded values, the app refuses to change what it
  is measured in and says why, rather than quietly reinterpreting
  figures you entered in the old unit and revaluing its whole history
  against a different run of rates. Grams of gold and troy ounces of
  gold are priced by different runs. A different unit means archiving
  the holding and starting a new one, which breaks its history in two.
- Editing a holding in two browser tabs at once does not silently lose
  one of the edits. The second one is told and asked to redo it.
- A name, note or dimension label containing something that looks like
  code is shown as the literal text you typed, everywhere it appears.

## What it deliberately does not do

- **No position level tracking of shares.** No tickers, no share counts,
  no cost basis, no per holding performance. A depot is one figure you
  read off your broker, the same act as updating a bank balance, and it
  is what keeps an update sitting to a few minutes.
- **No automatic connection to any bank.** A third party cannot encrypt
  on your behalf, so a bank feed and a vault only you can read cannot
  both exist. Values are entered by hand, and the sweep screen (record a
  value) is what makes that cheap.
- **No free floating tags alongside dimensions.** A yes or no label is
  a dimension with one value, which the form shows as a single checkbox
  (`account-settings.md`, which owns dimensions).
- **No permanent deletion of a dimension or one of its values.**
  Archiving hides it and keeps every holding's filing, so restoring it
  puts every holding back exactly where it was (`account-settings.md`).
- **No search or report the server runs for you.** It cannot read your
  list. Everything you see is assembled in your own browser after you
  unlock.
