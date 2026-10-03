# Recording detail

## Purpose

One date, and everything recorded at it: the figures entered that
evening and the prices captured alongside them. It is for looking. The
questions it answers are "what did I put in that day" and "where did
that price come from", and it is the way back into a sitting from four
years ago.

Exercises: `spec/features/record-snapshot.md` (A recording is a date,
Reopening and editing a recording, Deleting a recording) and
`spec/features/record-rate.md` (Reading, Editing a captured rate).

## Getting here

A recording is identified by its date and nothing else, and **there is
no list of recordings anywhere in the product**. The dates are already
in front of the person:

- **New recording** on the dashboard, picking a marked date
  (`dashboard.md`).
- **A date in a holding's own list of values** (`account-detail.md`).
  This is where a typo from eight months ago gets found.
- **A marked date on the chart** (`dashboard.md`).

The one route that skips this screen is the top bar's **Update
values**, which goes straight into editing today (`design-system.md`,
App shell).

**Starting a recording never comes through here.** A date holding
nothing has nothing to look at, so the picker goes straight to the
sweep.

## Layout

Standard app shell (`design-system.md`, App shell), content max-width
900px.

### The heading

**The date, as the heading.** That is the recording's name. Nothing
beside it: no time of day, no author, no note of its own. Two sittings
on one day are one recording, because the date is the identity.

### The figures

One line each: the holding, the figure in that holding's own unit, and
the same figure in the main currency at the price at this date
(`record-rate.md`, Reading). Both figures form columns, and each shows
as `design-system.md`, Typography, sets it.

- **The holding's name is the link**, opening that holding
  (`account-detail.md`), because "which holding was that" is the
  question this screen provokes.
- **A figure in a unit with a rate source** converts at that unit's
  price at this date and no other. With none here it reads **not
  priced** in place of the converted figure. It never converts at
  another day's price, and never shows the bare quantity as though the
  unit were the main currency (`net-worth-view.md`).
- **A figure in a unit with no rate source** converts at that unit's
  newest price at or before this date. Where that price is from an
  earlier day, the price date line sits beneath the converted figure,
  "priced 15 Jan 2024" (`design-system.md`, Components). With no price
  at or before this date it reads **not priced**.
- **An archive's zero is listed like any other figure.** While its
  holding is archived it is read-only, and Update offers no control for
  it (`update-values.md`).
- **Holdings left silent that day are not here.** The screen shows what
  the date holds, and a holding with no figure on it holds nothing
  here. Nothing counts or names them, and filling one in is an edit,
  which happens after Update.

### The prices

One line each: the unit, the price, and where it came from.

**This screen owns the provenance vocabulary.** The same three words
are used wherever a price's origin is shown, including the rate block
on the sweep (`update-values.md`), and each is a chip
(`design-system.md`, Components) beside the figure:

| Stored as | Chip | Meaning |
|---|---|---|
| `proposed` | "Market rate", or "Market rate as of 29 Jul" where the provider's figure is for an earlier day | the app proposed it and nobody changed it |
| `edited` | "Edited from 0.9312", naming the figure that was replaced | the app proposed it and the person changed it |
| `manual` | "Typed by you" | nothing was available, so the person supplied it |

A price says where it came from **a year later exactly as it did the
evening it was written**, which is why the provenance is stored rather
than remembered by the tab that entered it. That is a question only
ever asked about an old figure.

**Nothing on this screen contacts a price source.** It shows the prices
that were captured. Looking at an old day asks nobody anything, however
old the day is, because a screen that repriced March by being opened is
the one thing this screen must not be.

### The two buttons

- **Update**, primary. Opens the sweep for this date
  (`update-values.md`), holding what was recorded. Everything that
  could be done the evening it was recorded can be done again:
  correcting a figure, filling in a holding that was silent, changing
  or clearing a price.
- **Delete**, destructive. Below.

## Delete

**Delete lives here and nowhere else**, so the screen somebody types
into holds no button that destroys a date, and a deletion is a
deliberate separate act rather than a consequence of emptying fields.

**Clearing is not deleting.** Emptying every figure leaves the
recording standing, because the prices captured that evening are still
captured and the date is still a date (`update-values.md`). Only this
button removes a date.

One confirmation, and it names the two things that make this
destructive: the prices go too, so every holding measured in those
units moves on that date and not only the ones that had a figure, and
there is no way back.

> **Delete the recording for 31 July?**
>
> Every figure recorded that day goes, and so does every price captured
> with it. 9 holdings measured in USD and XAU-ozt move on that date,
> including ones you recorded nothing for. This cannot be undone.

Where the date holds the zero of a holding archived on it, that zero
stays (`record-snapshot.md`, Deleting a recording), and the
confirmation adds:

> The zero recorded when you archived Savings account stays, and so
> does this recording, holding it.

The holding count, the units and the archived holdings' names are
computed, not written into the copy, and the sentence naming units is
dropped where the date carries no prices at all. The first sentence
follows what the date holds:

- **No figures**: "It holds no figures, and the prices captured that
  day go with it."
- **Archives' zeros and nothing else among its figures**, as an archive
  that started the recording leaves it: "Only the prices captured that
  day go." The zero sentence above follows.

A date holding archives' zeros and no prices offers no Delete, because
there is nothing it could remove.

Filled critical on the confirm button, inside the dialog
(`design-system.md`, Components). No ladder and no typed word to
repeat.

Afterwards the date is gone from every holding's list and from every
unit's prices, the chart runs across it as though the sitting had never
happened, and the date is free to be recorded again. The exception is a
date that keeps an archive's zero: it stays in that holding's list and
remains a recording holding the zero, and this screen reloads to it.

## States

- **Loading**: none.
- **Populated**: as above.
- **Empty recording**: the figures section is replaced by one sentence,
  "No figures recorded on this date", and the prices are listed as
  always, because they are the reason the date is still here. Both
  buttons work: Update to put figures back into it, Delete to take the
  date away. It reads as an ordinary recording. Nothing calls it
  incomplete, offers to tidy it, or suggests deleting it.
- **No prices at this date**: the prices section says so in one
  sentence. A vault holding nothing but the main currency reaches this
  on every recording it ever makes, and it is not a fault. Where a unit
  in the vault has no price at this date because the source did not
  answer that day, the section names the unit and says the line is
  empty, and filling it is done after Update.
- **Error, two entries at this date**: two figures for one holding, or
  two differing prices for one unit, is a fault the client will not
  resolve on its own (`record-snapshot.md`, `record-rate.md`). Both are
  rendered, flagged critical, with a line naming the fault and a **Keep
  this one** action on each. The client picks neither, not by version
  and not by which was written last, and the chart leaves that date out
  of its interpolated series until it is answered. A visible fault
  beats a quiet wrong number.
- **Error, delete landed in part**: nothing is rolled back and nothing
  marks the date as half deleted. The screen reloads to what is
  actually left, names it, and offers Delete again. The records that
  went are gone and the rest still read normally.
- **Error, delete failed outright**: inline, critical, the recording
  unchanged.
- **Error, the recording is gone**: another window deleted this date.
  The screen says the date holds no recording and offers the date
  picker. It never renders a shell of a recording it no longer has.

## What it deliberately does not show

- **No price lookup**, at any age, by any control. Reading history is a
  read.
- **No way to change the recording's date.** The date is the
  recording's identity, so moving it is not an edit of it. Moving one
  entry to another date is an edit of that entry, from the holding's
  own page (`account-detail.md`).
- **No editing in place.** This screen is for looking, and every change
  happens after Update, in the sweep, where the holdings a price moves
  are the rows on the screen.
- **No price timeline.** A unit's prices are never listed on their own,
  here or anywhere. A price is one fact about one unit on one day, and
  the date is the only place where that fact has exactly one field
  (`record-rate.md`). This screen shows prices only as part of a date.
- **No list of recordings**, here or anywhere (Getting here).

## Rules

- Opening this screen issues **no write and no price request**, and
  every record at the date is byte-identical afterwards
  (`record-snapshot.md`).
- Every decrypted string on it, a holding name or a unit, renders
  through `x-text` or `textContent` (`architecture.md`, Application
  hardening).
- A record that could not be decrypted carries no readable date, so it
  belongs to no recording and appears on no such screen. It is counted
  in the dashboard's decryption warning instead of quietly shaping this
  one (`dashboard.md`).
