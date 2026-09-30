# Where prices come from

## What it does

You hold things that are not in your main currency: a dollar holding,
gold in a safe. Your net worth is one figure, so each of those needs a
price for the day you record it, and looking that price up yourself,
for the right day, is the tedious part of an update.

So the app looks it up for you and fills the field in. **What it fills
in is a proposal, never a verdict.** You can always change it, and what
gets kept is the number you saved, not the number the app offered
(`record-snapshot.md`).

It looks up every unit you hold, not only the one you are recording,
because recording anything refreshes every rate (`record-snapshot.md`,
which owns that rule). Updating one franc holding asks the sources
about dollars and gold.

This is for you if you hold a foreign currency or physical gold. If
everything you own is already in your main currency, you never meet
this part of the app.

## The screens

There is no screen of its own. Prices turn up inside the screens
below, and this file says what you can expect of a price wherever you
meet one.

- **Recording a value** and **the sweep**, where the rates sit together
  in one place rather than on the row of the holding they belong to,
  each filled in, each editable, each labeled with both units, and the
  same whether the recording is today's or one reopened from years
  ago. A reopened recording asks the sources about nothing it already
  holds a rate for. What each situation does, and how a rate you
  changed is marked afterwards, is `record-snapshot.md`.
- **A recording's own screen**, which lists every price captured that
  day with its unit and where it came from, and contacts no source
  itself. Its Update button is the one route to changing a price
  (`record-snapshot.md`).
- **A holding's history**, where each entry shows the rate that applied
  on its date and where that rate came from, and the date opens the
  screen of the recording that wrote that rate
  (`record-snapshot.md`).
- **Setting up a holding**, where you choose what it is measured in from
  a list. That one choice also decides whether prices can be looked up
  for it. Things with no price source are in the list too, marked as
  entered by hand, and anything not in the list at all you can type
  yourself, like square meters or bottles (`manage-accounts.md`).

## What must be true

- **Nothing about a lookup can stop you recording a value.** Turn the
  price service off entirely and every figure in the product can still
  be entered by hand, with a sentence on screen explaining why the
  field is yours to fill. A unit whose source did not answer simply
  gets no entry that day, and that day can be filled in later by
  opening its recording (`record-snapshot.md`).
- **A lookup does not say which holding you touched.** Every unit in
  your vault is asked about whenever you record anything, so the
  pattern of lookups is the same whether you updated one holding or
  fifteen, and the same whichever one it was.
- **The amount you hold never goes out with a lookup, in any form.**
  What leaves your NAS is which currency or metal was asked about, for
  which day, and which currency you keep your total in. Never how much
  of it you have.
- **A proposed price always shows the day it is actually for.** On a
  weekend, a holiday, or a day the source has not published yet, that is
  an earlier day than the one you are recording, and you can see it. The
  app does not relabel an older price with today's date.
- **Gold works in grams or in troy ounces**, and the price you are
  offered is for the unit that holding is kept in, so a figure is never
  out by the factor between the two.
- **A thing with no price source reads as a thing with no price source,
  and an outage reads as an outage.** They are never worded the same
  way. Silver having no source yet is normal, and must not look broken.
- **Asking twice costs once.** Several holdings in the same currency,
  the same unit reached twice in one sweep, or two people in the
  household updating on the same day, produce one lookup.
- **The app keeps no record of who asked about what.**

## What it deliberately does not do

- **No share or fund prices.** A brokerage holding is one entry in the
  currency your broker reports in, holding the total your broker states,
  and only that currency conversion is looked up. There is no ticker to
  type anywhere in the app, and none is coming: this is the scope
  decision recorded in `manage-accounts.md`, not a deferral.
- **No silver, platinum, or palladium prices yet.** All three are in the
  unit list by name so you record them against the name the app will
  keep using, and you set the rate. Adding a source later changes
  nothing about what you already recorded.
- **You cannot add a currency or a metal to the list yourself.** The
  list is the same for everyone on the instance and adding to it is an
  administrator's job (`admin-invites.md`). What you can always do
  instead is type your own unit and your own prices.
- **No estimating between published days.** A day with nothing published
  gets the last published figure, labeled with its own date. It is
  never averaged, smoothed, or interpolated into a number nobody
  published.
- **No price tracking.** Each unit has a run of rate entries, but it is
  a record and not a watchlist. No alerts, nothing fetched unless you
  are recording something, and no screen you are only reading ever
  contacts a source.

## Where prices come from, and what that costs you

Prices come from free public sources with nobody answerable for them.
Currencies come from central bank data republished by a free open source
service, gold from the Polish central bank directly. No account, no fee,
no contract.

If a source stops or changes, there is nobody to call and prices get
typed by hand until the app is changed. Silver, platinum and palladium
have no source at all, so you set those rates yourself and they carry
forward until you change them. A paid provider was weighed and
rejected: the good ones require every copy of their data to be deleted
when you stop paying, and Solvent cannot do that, because every rate is
stored inside your encrypted vault, which the server can neither read
nor delete.

What makes this survivable is that a price is only ever a proposal. You
can overwrite any of them, and no entry is ever blocked by a lookup that
failed.

## Decisions taken on your behalf

- **The gold price you are offered is usually a day old**, because the
  Polish central bank publishes one business day behind the London
  market, weekdays included. The app shows the day it is for rather than
  hiding the lag. Overriding it is one edit.
- **How far back prices reach is whatever each source published.** Gold
  does not reach before 2013. Older gold entries take a price you type.
- **There is a ceiling on how many prices one person can ask for in an
  hour**, set far above any real update, so a stolen session cannot be
  used to hammer the source in your name.
