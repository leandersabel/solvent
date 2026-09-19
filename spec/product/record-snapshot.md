# Record a value

## What it does

Records what one holding was worth on one date. A date and a number in
the holding's own unit. Do that a few times a year per holding and the
result is your history, which is what the chart draws and what the
total is made of. What one unit of it is worth in your main currency is
recorded too, on its own, and mostly without you doing anything.

This is the recurring act in Solvent. Everything else is setup. It is
for the person who sits down at the end of a month or a quarter, opens
the online banking of four banks, and wants to be done in a few minutes.
What they gathered that evening is what gets recorded, and nothing else
does.

The number you type never leaves your browser in readable form, and it
is never part of any price lookup the app makes. The app can ask what a
troy ounce of gold was worth on 31 July without anyone learning that you
hold twelve of them.

## Two things, recorded separately

How much you hold and what a unit of it is worth are different
questions, and Solvent keeps them apart.

A holding's own list of values holds only the quantities you actually
recorded. Twelve troy ounces in March, twelve and a half in September,
and nothing on the dates in between. The gold price has its own run of
entries alongside that list, and so does the dollar rate. One run per
unit, shared by every holding measured in it.

The two are joined at the moment a figure is shown. What a holding is
worth on a date is the quantity on that date at the rate on that date,
and either side can have moved since you last looked.

Nothing is ever recalculated behind you. What your dollars were worth
in 2019 is what 2019's rate says, whatever the dollar does tomorrow,
and no later recording touches it. A chart that changes its own past
on its own is not a record of anything.

The one thing that can change a past rate is you, and only by opening
the recording that wrote it. The difference that matters is who acted:
the app never moves your history, and you always can.

Each rate entry says where it came from, and still says it a year
later: the figure the app proposed, one you changed, with what was
proposed still shown, or one you typed because nothing was available.
That is a question you will only ever ask about an old figure, which is
why it is stored rather than remembered by the tab that entered it.

## Recording anything refreshes every rate

Record your franc account and nothing else, and the dollar rate and the
gold price get a fresh entry too, for the same date, without you asking
for one. That is the point of it. Your total is then never built out of
a rate nobody has looked at since March, however long ago you last
touched the holdings that need one.

You see every rate that is about to be written and can change any of
them. Leaving one alone accepts it.

**That is the opposite of how a quantity behaves, and it is
deliberate.** A quantity is written only if you act. A rate is written
unless you act. The two rules look inconsistent and are the same test
applied twice: a quantity is something you have to go and look up on a
statement, so the app will never write one you did not gather, and
nobody gathers an exchange rate, so refusing to write one buys you
nothing and costs you a stale total.

The same test decides which rates refresh. A rate somebody publishes,
the dollar or gold, costs nothing to get right and is written by
default. A price only you can supply, what your flat is worth per
square meter, is something you have to sit down and think about, so it
follows the quantity rule instead. It is written when you set it and
not otherwise, and its age stays honest.

Recording nothing writes nothing. Open the sweep, act on no row, close
it, and there is no new entry anywhere, rates included. The refresh
rides along with a recording. It is not something the app does on a
timer.

Rates are written for the date being recorded, not for today. Adding a
March figure from a statement you have just found writes March's rates,
which is what makes a backfilled figure worth anything at all.

The refresh fills a date that has none. Record onto a date that
already carries rates and those rates stand as they are. They belong
to that date's recording and they move when you move them there, never
as a side effect of putting a figure in next to them.

## A recording is a thing you can reopen

A sitting is not a moment that has passed. It is a recording: the
figures you entered that evening and the rates written alongside them,
kept together under one date, and you can go back to it.

A recording is identified by its date and nothing else. One value per
holding per day and one rate per unit per day together mean that two
sittings on the same day are one recording, so opening a date shows
everything recorded for that date however many sittings it took. The
second sitting joins the first by reopening it, which is the only way
in once a date exists.

Three things you might want to put right are the same act on the same
screen:

- **A figure you got wrong.** The balance you typed was the wrong
  account's.
- **A holding that was silent.** You skipped it that evening, so it has
  no entry for that date, and the statement is in front of you now.
- **A rate you disagree with.** The figure the source published that
  day looks wrong to you, or nothing came back and the line went in
  empty.

All three are: open the recording, edit, save. A price is changed where
it was captured, which is inside a recording, whether that recording is
today's or one from four years ago.

## The screens

### The sweep: updating in one sitting

The main way to record values, and the screen that decides how much your
monthly update costs you.

One date at the top for the whole sweep, defaulting to today. That
date is not a setting on the screen, it is which recording you are
looking at: move it to a day you already recorded and the sweep fills
with what is there. One row per active holding, each one showing its
last recorded figure and how long ago that figure was recorded, in
plain words: "3 weeks ago", "about a year ago", "never valued".

You act on the rows you have a number for and leave the rest. Updating
four holdings this month and the other eleven in March is an ordinary
pair of sittings, and the screen treats it as one. It counts nothing,
marks nothing as outstanding, and never comes back to the rows you left.

Each row offers three answers, and the third one is free:

- **Type the new number.** The unit is on the field, and the converted
  figure appears as you type. Nothing is recorded until you act on the
  row.
- **Confirm.** One click, meaning "this is still the same". The quantity
  is recorded again at the sweep's date without you retyping it. It is
  the right answer whenever the quantity has not moved. You still own
  the same 12.5 troy ounces, and what moved is the gold price, which is
  the app's job and not yours.
- **Leave it alone.** The holding gets no entry for this date and keeps
  exactly the history it has. A figure you have not gone and looked up
  is not a figure, and the app will not put one in your history on your
  behalf.

A number showing in a row is not a number in your history. The field may
already carry your last recorded figure, so that confirming it or
adjusting it is quick, and showing it there records nothing whatsoever.
Only Confirm, or typing a figure and saving that row, writes an entry.
Scroll past a row with your last figure sitting in it and that holding
has no entry for that date.

No holding row ever asks you about a price. Every row answers in its
own unit, and confirming one is one click whatever it is measured in.

#### The rates, at the foot of the sweep

Below the rows, one line per unit anything in your vault is measured
in, filled in for the sweep's date. It is not a second sheet of work.
In the ordinary case you read it, it is right, and you finish.

- **A unit somebody publishes**, dollars or gold. The line arrives
  filled in and says which day the figure is actually for, which over a
  weekend is an earlier day (`rate-lookup.md`). It is written whether
  or not you touched it.
- **A unit only you can price**, your flat's square meters. The line
  shows your last figure and the day you set it, and writes nothing
  unless you change it. Your estimate of the flat does not get newer
  because you recorded a bank balance.
- **A published unit whose source did not answer.** The line says so
  and stays empty. Nothing is written for that unit, your total carries
  on at the most recent rate it has, and the line comes back filled in
  as soon as the source does. You are never asked to type a dollar rate
  in order to record a franc account.

The one time a rate is asked for rather than offered is when the unit
has no rate at all and you are recording a quantity in it. Twelve troy
ounces with no gold price is not a figure, so the app asks once, and
after that the unit refreshes or carries forward like any other.

Your main currency has no line. There is nothing to convert.

The rates go in with the first row you record, so stopping halfway
still leaves them fresh. Change a line after that and the day's rate
changes with it.

Rows record one at a time as you finish them. You can stop anywhere and
keep every row you acted on, and a row that fails to record says so on
itself and leaves the others alone.

On a phone this is the screen that changes shape rather than simply
getting narrower. The wide table with every holding in view is the
computer's answer, and a phone may walk you through one holding at a
time instead. Same sweep, not a cut-down one, and it comes after the
first version (`app-shell.md`, which owns the rule). Nothing here
stands in its way: every question the sweep asks belongs to a single
holding or to a single unit, and both record one at a time.

### One holding, one date

A small form for everything the sweep is not for: an odd date, a March
figure you are adding now that the statement is in front of you,
history you are backfilling from old statements. Holding, date, value,
an optional note. The converted figure updates as you type, because
that is the number you are actually reasoning about.

This records something, so it writes rates like the sweep does, for the
date on the form. They sit on one folded line stating what will be
written, which opens if you want to change any of them. A figure dated
2019 takes 2019's rates, so the entry is worth something the moment it
lands. Pick a date that already holds a recording and the line shows
that recording's rates rather than fresh ones, because the figure you
are adding is joining it.

### Going back to a recording

#### Finding one

There is no list of recordings anywhere, because the dates are already
listed in the places you would look, and each of them leads to the same
screen.

- **A holding's own page** lists every value ever recorded for it,
  newest first, with the date, the figure, the rate that applied on
  that date, the converted amount, and where that rate came from. Each
  date opens the recording it belongs to. This is where a typo from
  eight months ago gets found.
- **The chart** names a date wherever you put the crosshair, and where
  you recorded something on that date it opens that recording
  (`net-worth-view.md`).
- **Update values**, with the date moved back. If that day holds a
  recording you get it, and if it does not you are starting one.

#### It is the sweep

Reopening is not another screen. It is the sweep, at that date, the
same rows in the same order with the same rates at the foot, and
everything you could do the evening you recorded it you can do again.
That is what keeps this cheap.

What is different is that the rows arrive holding what was recorded
rather than a proposal.

- A holding with a figure for that date shows it. Type over it to
  correct it, or clear it to take it out of your history.
- A holding that was silent that date shows what the sweep always
  shows for a holding with nothing on the date: its last figure before
  then and how old that is. Type a figure and it is silent no longer.
  Confirming such a row records the figure the holding carried into
  that date, which is the last one before it and not the newest one
  you have.
- The rate lines show the rates this recording wrote and where each
  came from. Change one and it becomes yours, with what was proposed
  still shown beside it afterwards. Clear one and that date has no
  rate for that unit, which moves the same holdings and is announced
  the same way.
- A unit that went in empty, because the source did not answer that
  day, is the one thing the screen goes and asks about. It arrives
  filled in if the source answers now, labeled with the day it is
  actually for like any proposal, and you can take it, change it, or
  leave the line empty. A rate that is already there is never looked
  up again, because it may be one you chose.

A rate line on a reopened recording saves by itself. On a new sweep
the rates ride in with the first row you record, because until then
there is nothing for them to belong to. On a recording that already
exists there is, so filling in the rate that was missing is a
complete act and needs no holding touched alongside it. Reopen a
date, touch nothing, and nothing is written, the proposal on the
empty line included.

#### Starting one and editing one are different acts

A date holds one recording and only the first attempt to start it
succeeds. A vault open in two windows, or on a phone and a laptop at
once, cannot start the same date twice. The second attempt does not
quietly turn into an edit of the first. It stops, says the date
already has a recording, and offers it in one click, which is the
route every change goes through.

The wording is not an accusation. Your other window got there first,
and there is nothing to put right beyond opening the date and carrying
on.

What was typed into the attempt that lost is gone, and it is typed
again on the reopened date. Nothing is held for them, and the screen
never claims to have saved anything it did not. A rescue that works
only some of the time is worse than none.

Carrying those entries across, so the losing attempt opens the date
with what was typed still in it, is wanted and is not in the first
version. What the first version owes it is only that it does not stand
in the way: the entries that lost are discarded because nothing keeps
them yet, never because the date has been closed against them.

#### What saving does to your history

- **A figure you changed** moves that holding on that date. Its line
  bends there and the runs either side of it move with it. Your total
  changes only if that date is the holding's newest figure.
- **A figure you added to a silent holding** gives that holding a
  point where it had none, so the straight run that used to cross that
  date now bends at it.
- **A figure you cleared** takes the point out, and the run straightens
  back over it.
- **A rate you changed** moves every holding measured in that unit on
  that date, and every total that used it. Your net worth on that day
  changes and the chart changes with it. The app says so before it goes
  through, naming the holdings that move, and you watch it happen,
  because those holdings are the rows in front of you.

That last one is why a price is corrected here and nowhere else. The
same edit made on a screen listing nothing but rates would move
figures the person was not looking at.

Nothing outside that date moves. March's rate is March's, and changing
it leaves April alone. Nothing recalculates itself afterwards either: a
figure you corrected today is not corrected again tomorrow by anything
the app does.

#### Clearing one out, and deleting one

Two different acts, and what separates them is the prices.

**Clear every figure and the recording stands.** The prices captured
that evening are still captured, so the date is still a date. What you
have is a recording with no figures and its prices intact, which is an
ordinary state and not the wreckage of one. The date still shows in
the chart, because those prices are real and every holding measured in
those units is valued by them, so the foreign bands still bend there.
What has gone is the quantities: the holdings you cleared have no
point on that date any more, and their runs straighten across it.

Clearing a figure is an ordinary edit and costs what an edit costs. No
typed confirmation and no warning ladder. It says what it does, the
same as changing a figure says what changing it does.

An empty recording is always one you emptied. Opening a date that
holds nothing and acting on nothing still writes nothing, so the app
never makes one. And since no holding has a figure on that date, an
empty recording appears in no holding's list of values. You reach it
by its date, from the chart or by moving the sweep's date onto it.

**Delete removes the recording outright, prices and all.** It is its
own button on the reopened recording and a deliberate separate act,
never a consequence of emptying the fields. It asks once, and the
confirmation says the two things that make it destructive: the prices
go with it, so every holding measured in those units moves on that
date and not only the holdings that had a figure, and there is no way
back. Deleted, the date is gone from every holding's list and from
every unit's prices, and the chart runs across it as though the
sitting had never happened.

#### Moving an entry to another date

An entry can also be moved to another date, from the holding's page.
That is the answer to a mistyped day rather than a wrong figure, and it
moves the entry onto the rate of the day you meant, which is the point
of the correction. The entry leaves the recording it was in and joins
the one on its new date, or starts one there if that day holds nothing
yet.

Deleting a single value asks once, naming what will happen: your net
worth around that date will change.

## What must be true

- A value recorded today shows up in the total and the chart
  immediately, with no reloading and no waiting.
- The converted figure is visible while you type, before anything is
  saved.
- A rate published tomorrow does not change any figure you already
  recorded, or any point in the chart before today. Nothing the app
  does on its own rewrites a rate that is already in your history.
- A value entered on one machine reads back identically on another,
  down to the last decimal. No figure ever drifts by a fraction of a
  cent through being stored and read back.
- Nothing the app sends out to look up a price contains the amount you
  are entering, in any form.
- The price provider being down never stops you recording a value. The
  rate line says so quietly, nothing is written for that unit, and
  every row still records.
- A holding with a unit you made up never triggers a lookup at all, and
  the screen says why that rate is yours to set rather than showing an
  empty line with no explanation.
- A holding measured in your main currency never shows a rate anywhere
  in the product.
- Recording a single figure onto a date the holding already has asks
  whether to replace the one that is there, naming the figure already
  recorded, and ends with one value on that date either way. Opening
  that date's recording asks nothing, because the figure is in front
  of you to type over.
- Moving an entry onto a date that is already taken warns that the other
  entry will be destroyed, in different words than the ordinary replace,
  because a second record dies.
- If that move half fails, nothing is lost. The holding's page shows
  both entries flagged and asks you which to keep, and the chart leaves
  that date out until you answer, rather than picking one and putting a
  number you never chose into your history.
- A row you did not act on produces no entry. Leave eleven of fifteen
  rows alone, finish the sweep, and those eleven holdings hold exactly
  the values they held before you opened it, even though the rates they
  are valued at have moved.
- A figure the screen pre-filled into a row and you did not confirm
  appears nowhere afterwards. The holding's own list of values has
  nothing new on that date.
- Two sweeps that each covered a different half of your holdings leave
  entries only for the halves they covered, and neither one is treated
  as unfinished at any point.
- Nothing on the sweep counts, scores, flags or later mentions how many
  holdings you left alone.
- Recording one franc account writes a rate entry for every published
  unit anything in your vault is measured in, dated the same day,
  whether or not you looked at any of them.
- A rate line you never touched is written and a holding row you never
  touched is not, on the same sweep.
- Opening the sweep, acting on nothing and closing it writes nothing
  at all, rates included. That holds whether the date held nothing at
  all or already held a recording, and a rate the screen proposed for
  an empty line is not written either.
- Backfilling a figure dated in March writes March's rates, not
  today's.
- A unit only you can price keeps the figure and the date you last set
  it, however many times you record something else.
- One rate per unit per day, the same rule as one value per holding per
  day.
- Confirming is unavailable for a holding that has never been valued.
  There is nothing to confirm.
- A value of zero is accepted and means a closed out position, which is
  not the same as a holding you never valued.
- A negative value is accepted. A mortgage is a holding with a negative
  balance, and your net worth is a signed sum.
- A date in the future is refused.
- A date before you created the holding is accepted, because entering
  ten years of old statements is a normal thing to do.
- The rate that applied to an entry recorded a year ago still says,
  today, whether it was proposed, changed by you, or typed by you.
- A rate is changed by opening the recording for its date, where the
  holdings it moves are the rows on the screen, and the change is
  announced as moving every one of them before it goes through.
- Nowhere in the product is there a screen that lists rates on their
  own or lets one be changed away from the recording that wrote it.
- Opening a date that already holds a recording shows every figure
  recorded for it, including ones entered in a separate sitting the
  same day, and starts no second recording for that date.
- A holding you left alone on a past date can be given a figure for
  that date by reopening it, and that figure joins your history
  exactly as it would have at the time.
- Correcting a figure recorded eight months ago moves the chart at
  that date and leaves every other date alone.
- Changing a rate on a reopened recording moves every holding measured
  in that unit on that date, and those holdings are visibly the rows
  on the screen.
- A rate you changed still says, a year later, that you changed it,
  and still shows what was proposed, whether you changed it the
  evening it was written or four years afterwards.
- Reopening a recording asks the source about no unit it already holds
  a rate for. A rate you overrode a year ago is still yours when you
  open that date again.
- A unit left with no rate because nothing came back arrives filled in
  when you reopen that date and the source answers, as a proposal you
  can change or leave.
- A rate filled in on a reopened recording is saved on its own, with
  no holding row touched.
- Adding a figure to a date that already carries rates uses those
  rates. Nothing is looked up and no holding measured in those units
  moves.
- Clearing every figure out of a recording leaves the recording and
  its prices. The date still bends every band measured in those
  units, and only the cleared holdings straighten across it.
- A recording with no figures reads as an ordinary empty recording,
  never as an error or as something to tidy up.
- Clearing a figure asks no more of you than changing one does. No
  typed confirmation, no second warning.
- A recording is deleted by its own button and never by emptying it.
- The delete confirmation says that the prices go too, that every
  holding measured in those units moves on that date, and that it
  cannot be undone.
- A deleted recording leaves no trace. Its date is gone from every
  holding's list and from every unit's prices, and the chart runs
  across it.
- Two sessions starting a recording for the same date end with one
  recording. The second is refused, told the date already has one, and
  given it in a single click.
- A refused attempt leaves nothing behind. None of its figures appear
  anywhere afterwards, and nothing on screen says anything was saved.
- The refusal reads as the date already being taken, never as
  something the person did wrong.
- Entering the same value in two browser tabs never loses one of them
  without saying so, and neither does editing the same recording in
  two.

## What it deliberately does not do

- **No transactions.** One figure per holding per date, not every
  deposit and withdrawal. Solvent records what things were worth, not
  what happened. Spending and budgeting are somebody else's product.
- **No more than one value per holding per day**, and no more than one
  rate per unit per day. A date holds what things were worth that day.
  Intraday movement is not what this measures.
- **No rate attached to a value.** A figure you recorded is a quantity
  and nothing else. There is no second rate sitting on the entry that
  could disagree with the unit's own run of rates.
- **No rate refresh on a timer.** Rates move when you record something.
  Nothing runs in the background, nothing updates while you are away,
  and a screen you are only reading never contacts a source.
- **No future dates.** An entry describes what was.
- **No button that records every holding at once.** There is nothing
  for one to do. A holding you did not go and look up needs no action
  at all, and one you did look up is a single click on its own row.
- **No value carried into your history.** A holding without an entry
  for a date has no entry for that date, and the app never writes one
  from the last figure it happens to know. What the chart and the total
  do across a gap is in `net-worth-view.md`.
- **No automatic price for things without a market.** Your flat, the
  wine, the private loan you made. Nobody publishes a price, so the app
  does not invent one.
- **No rescue for a recording that was refused.** When a date turns
  out to already have a recording, the figures typed into the attempt
  that lost are not kept, offered back, or merged into the one that
  stands. They are typed again on the reopened date.
- **No screen of nothing but prices.** There is no list of rates to go
  and edit. A rate belongs to the recording that wrote it and is
  changed there, where the holdings it moves are on the screen in
  front of you.
- **No audit view across holdings.** "Show me every price I typed by
  hand" is a different question with a different shape, and it is not in
  this version. The provenance of each price is on the holding's page.

## Decisions taken on your behalf

These were not in anything you said. They are marked so you can overrule
them.

- **One value per holding per date**, with entering a second one
  offering to replace the first.
- **Future dates are refused** outright rather than warned about.
- **A published rate that could not be fetched writes nothing**, rather
  than carrying the last one forward under a new date. Carrying it
  forward would put a figure nobody published into your history under a
  date it was not published for, quietly and in a way nothing on screen
  would reveal.
- **A rate only you can supply follows the quantity rule.** Your flat's
  price per square meter is written when you set it and not otherwise.
  The rule you gave was about exchange rates, and this is where the
  line under it falls: a price you have to think about is gathered, and
  the app does not write things you did not gather.
- **Reopening looks up only what is missing.** A rate already written
  for that date is shown as it stands and the source is not asked
  about it, because it may be one you chose. A unit that went in empty
  is looked up again, because the outage that emptied it is the reason
  you came back.
- **Confirming on a reopened recording records the figure the holding
  carried into that date**, meaning its last figure before that date
  rather than the newest one in its history.
- **The closing value offered when archiving a holding** follows the
  same one value per date rule as everything else, so archiving on a
  date that already has a value offers to replace it.
