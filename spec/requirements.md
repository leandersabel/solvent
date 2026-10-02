# Requirements

## What Solvent is

- Solvent tracks your net worth: what you own, what you owe, and how the
  total moved over time.
- Solvent records what things were worth, not what happened. It has no
  transactions, no spending and no budgeting.
- Solvent serves a small invited group, not the public. Nobody can sign
  up without an invite.
- Each person has their own vault with their own password, and nobody
  sees inside anyone else's.

## Privacy

- Your vault uses zero-knowledge encryption. Everything in it is
  readable only with your password, and only in your own browser.
- Nobody holding the server, its disk or its database can read anything
  in a vault.
- Your password never leaves your browser.
- Nobody can recover or reset a lost password, not an administrator and
  not whoever runs the machine. A vault whose password is lost stays
  unreadable for good.
- You confirm that you understand this before your vault is created.
- Solvent asks for no email address and no phone number, and never sends
  mail.
- Nothing that could open your vault is kept on your device. Reloading
  the page, closing the tab or coming back later means typing your
  password again.
- You can lock your vault at any moment.
- A locked vault leaves nothing readable in the browser, even to
  somebody who opens the browser's own tools.
- A lock keeps whatever you were typing into an unsaved form, and
  nothing else.
- Signing in reveals nothing about which usernames exist, or which
  belong to administrators.
- Solvent records no IP addresses and no devices.

## How it looks

- Solvent looks like a private bank, which means restraint:
  - A deep petrol blue carries the frame of every screen, with a warm
    brass and a plum as sparing accents.
  - The page is a warm off-white, never pure white.
  - Your net worth is the largest thing on any screen, and nothing
    competes with it.
  - Figures line up in right-aligned columns.
  - No screen carries a tagline, a slogan, a welcome tour or
    promotional copy.
  - Nothing moves for effect. No figure animates and nothing slides in.
- The ground is light, and there is no dark theme.
- Color never carries meaning by itself. A word or an icon beside it
  says the same.

## On a phone

- Every screen can be read and operated end to end on a phone, without
  panning sideways.
- Entering figures works on a phone, the update across all your
  holdings included. A phone may show it in a different shape, such as
  one holding at a time.
- A vault can be created and opened on a phone or a tablet, not only on
  a computer.

## Holdings

- A holding is anything you own or owe: a bank account, a brokerage
  depot, gold, a flat, a mortgage.
- A holding is measured in a currency, a metal, or a unit you name
  yourself, such as square meters or bottles.
- Gold can be kept in grams or in troy ounces.
- A brokerage depot is one figure, the total your broker shows. Solvent
  has no share or fund prices, no tickers and no positions.
- What you owe counts against your net worth. A mortgage is a holding
  with a negative value.
- You enter values by hand. Solvent connects to no bank, because a bank
  feed and a vault only you can read cannot both exist.
- You can file holdings along dimensions you invent, such as Liquidity
  with Cash, Investments and Retirement.
- A vault with no filing works fully.
- When a holding ends, you choose between archiving it and deleting it
  for good with all its history.
- Archiving a holding sets it to zero on the date it is archived, and
  leaves every figure you recorded before that exactly as it was. On the
  chart, only the stretch from its last recorded figure to the archive
  date changes: the line runs gradually down to that zero.
- Archiving can be undone. Undoing it lets you enter values for the
  holding again, and leaves its history as it is.

## Main currency

- Your vault counts everything into one main currency, chosen when you
  create the vault.
- The main currency cannot be changed afterwards, because every rate
  ever recorded converts into it. Restoring a backup file is the
  exception, because it replaces the currency and the whole history
  together.

## Recording values

- You record a figure only for the holdings you have one for.
- Solvent never writes a figure you did not give it. Archiving a holding
  is how you give it its zero.
- Solvent never counts, flags or reminds you of the holdings you left
  alone.
- You can record figures for past dates, years back, including dates
  before you added the holding.
- Any figure or rate you recorded can be corrected later.
- Nothing recalculates your history behind you. A rate published later
  never changes a figure or a rate already recorded.
- A figure reads back exactly as you entered it, on any machine.

## Exchange rates and prices

- Recording anything refreshes the rate of every currency and metal in
  your vault, for the date you are recording.
- Solvent looks those rates up for you. Every rate it proposes is one
  you can change.
- A proposed rate shows the day it is actually for, which on a weekend
  or a holiday is an earlier day.
- A failed lookup never stops you recording. Every figure in Solvent can
  be entered by hand.
- A price nobody publishes, such as your flat per square meter, is one
  you set yourself.
- Prices come from free public sources with nobody answerable for them.
  A paid provider is not used, because the good ones require their data
  deleted when you stop paying, and the server cannot delete a rate
  stored in your vault.
- A lookup never carries how much you hold, and does not reveal which
  holding you updated.
- Prices are looked up only when you record something. Looking at your
  figures contacts no outside source.

## Your net worth

- The main screen shows your net worth in your main currency, with your
  assets and your debts beside it.
- The total is exact to the cent and can be checked by hand.
- A chart shows your net worth over time, split by any of your
  dimensions, with every part labeled.
- The chart marks the dates you actually recorded something.
- Every figure states how old it is. Nothing flags a figure as too old.
- The chart can be used from the keyboard, and its numbers are also
  available as a plain table.

## Dates and numbers

- You choose how dates and numbers are written: the language, the date
  order, the thousands mark, and whether money shows cents.
- Those choices change only how things are shown, never what is stored.

## Accounts and administration

- An administrator account runs the instance. It invites and removes
  people, and holds no financial data.
- An administrator cannot read any vault, reset a password or recover a
  vault.
- Removing an account, which destroys its vault, is the only destructive
  thing an administrator can do.
- Somebody who runs the instance and keeps their own finances in Solvent
  holds a separate account for each.
- Several administrators can exist at once.
- The last administrator cannot be removed.
- An invite is a link an administrator creates and hands over in person
  or by message. It works once, and stops working when it expires or is
  called back.
- The first administrator is set up by whoever installed Solvent, on the
  machine it runs on.
- You can change your password. A backup file you already saved still
  opens with the old one.
- You can delete your own account, and everything in it goes at once,
  with nothing kept in reserve.

## Backups

- You can download your whole vault as one file, locked with your
  password and worthless to anyone without it.
- Restoring a file replaces your whole vault. Nothing is merged.
- A restore happens completely or not at all. If it fails, your vault
  stays exactly as it was.
- A file from an older version of Solvent restores into a newer one.
- A backup file is no way back in if you forget your password.
