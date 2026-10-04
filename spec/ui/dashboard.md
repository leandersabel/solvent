# Dashboard

## Purpose

The core payoff screen: what you are worth right now, how it got there,
and how it splits. Everything is computed client-side from decrypted
records — the server has nothing to template here.

Exercises: `spec/features/net-worth-view.md`. Links into
`account-form.md`, `snapshot-entry.md`, `update-values.md` and
`recording-detail.md`.

## Layout

Standard app shell (`design-system.md`, App shell). The holdings table
below is the list of holdings the shell deliberately has no nav entry
for.

Regions, top to bottom, each at the full content width and 32px apart.
The hero sits on the ground, and every region after it is a Card
opening on its section heading (`design-system.md`, Components).

### 1. Hero figure

Summary figures read in whole units of the main currency: the total,
the change, gross assets and liabilities here, the legend and the
breakdown below. The holdings table carries the money places, because
it is where a figure is checked against a statement.

The total holds the left, its section label above it and the change
beneath it. At the right, level with the foot of the total, sit gross
assets and gross liabilities, each set off by a hairline rule at its
left, and after them New recording. Which rates takes its own row
beneath, at the left, as a segmented control (`design-system.md`,
Components).

- The net worth total, ink-primary, proportional figures, in the main
  currency, under the section label "Net worth" (`design-system.md`,
  Typography).
- Beneath it, the change over the selected chart range: an arrow icon,
  the signed absolute change, and the percentage — in status good or
  critical, **with the arrow icon carrying the sign, not the color
  alone**.
- Beside the total, two smaller figures under their own section
  labels: gross assets and gross liabilities. Net worth is a signed sum and the UI must show
  both sides (`net-worth-view.md`).
- **Which rates**, a two-position control on its own row beneath the
  total, both positions named:
  - **"Latest rates, 31 July"**, every holding's last figure at the
    newest rate there is. The position the screen opens in, and the
    answer to what am I worth. The date in the label is the one rate
    date for the whole vault, which is the day something was last
    recorded: recording anything refreshes every rate
    (`record-snapshot.md`), so there is one such date rather than one
    per holding.
  - **"Rates as of each figure"**, each holding at the rate that
    applied the day it was last recorded. In this position the label
    carries no date, because the rate date is the row's own as-of date
    in the table below, or the date a row carries where its price is
    older (Holdings table).
  - It changes the total, the holdings table and the breakdown, and
    **leaves the chart untouched**: every point in the chart is already
    drawn at the rates of its own date, so there is nothing there for
    the control to do. The hero then no longer matches the chart's
    right hand edge. That is the comparison working, and the screen
    says nothing apologetic about it.
  - Neither position is an unlabeled off state. Both are real
    questions, and the second one is for comparing: held against the
    first it separates how much of the move was the money from how much
    was the rates.
  - It contacts nothing. Both series are already in memory.
- **New recording**, the primary action, opening the marked date picker
  (`design-system.md`, Components) set to today. This is the front door
  to recording, and it sits here because the total is where somebody
  arrives already meaning to update it.
  - **A date holding no recording** goes straight to the sweep for that
    date (`update-values.md`), with no screen in between. There is
    nothing yet to look at.
  - **A marked date** opens that recording's own screen
    (`recording-detail.md`), with no warning, no question and nothing
    to confirm. The picker can see what is there, so it opens it.
  - **Every date holding a recording is marked**, including one whose
    figures were all cleared. Its prices are still captured, so it is a
    recording like any other, and the picker is the one route back to
    it (`recording-detail.md`).
  - The top bar's **Update values** is the other route and is not
    repeated here (`design-system.md`, App shell).
- **No staleness chip and no warning.** How old each figure is belongs
  beside the control that fixes it, on the sweep, not as a badge here
  (`net-worth-view.md`).

### 2. Trend chart

A **stacked area chart**, drawn directly in SVG with no charting library
(`net-worth-view.md`, Rules). Asset bands stack up from zero, liability
bands mirror down, the net-worth line runs over the top.

**Controls**, in one row above the plot:

- **Range**: 1M / 6M / 1Y / All as text buttons. Default 1Y, or All when
  history is shorter.
- **Group by**: a select listing "Total" plus every configured dimension
  in the profile's configured order (`account-settings.md`), archived
  ones excluded. Default "Total" — one band, no stacking — until the
  user configures a dimension. It also drives the breakdown section
  below. Beside it, the dimension's **coverage**: "7 of 10 holdings
  assigned", clickable to filter the table to the unassigned ones
  (`dimensions.md`, which owns what coverage is for).
- **Absolute / percentage** toggle. Percentage normalizes each side
  against itself; the caption says so, because a reader will otherwise
  assume the shares are of the net figure.
- **"Just the line"**, a checkbox, **off when the screen loads, which
  means the entry marks are on** (`design-system.md`, The estimated
  marker). Ticking it takes the marks away and leaves a clean line, for
  looking at the shape rather than the evidence.
- **Pricing** is not a chart control. The two-position rates control in
  the hero leaves the chart alone (Hero figure).

The section heading holds the left of that row and the controls the
right, in the order listed, wrapping beneath the heading when the row
runs out. Range and Absolute / percentage are segmented controls. The
plot spans the card with its value ticks at the left. Beneath it,
under a hairline rule, the legend runs as one row, each entry its
swatch, band name and figure, with the key to the entry marks at the
row's right end. The "View as table" disclosure closes the card.

**Interaction:**

- **The crosshair addresses every calendar day in the range**, recorded
  or not. A day is the unit the chart reads in: the pointer, a drag end
  and a key press each resolve to one day, and the readout is that
  day's own value, never the nearest drawn point (`net-worth-view.md`,
  Reading a date).
- **Hover** puts a dotted crosshair on the day under the pointer,
  anywhere in the plot, and a tooltip pinned to the top of the plot:
  date, every visible band with its value, then the net total on a
  separated row. Value first, date second — the value is what the user
  came for. The hero figure follows the crosshair. Leaving the plot
  takes the crosshair away and returns the hero to what it shows
  without one.
- **Drag** selects a span between any two days, each end on the day
  under the pointer. The band stays after release, the hero shows the
  change across exactly those two days, and **each legend entry gains
  its own delta for the span** — this is how "what did my retirement do
  between 2019 and 2024" gets answered. A plain click clears it;
  changing range or dimension clears it.
- **Legend** entries toggle a band. Hovering one highlights it and dims
  the rest. With a band hidden, a line under the chart states that the
  total covers only the visible bands.
- **Entry marks**: the chart form of the estimated marker
  (`design-system.md`). The bands themselves are never restyled. A
  stretch running between two marks is drawn rather than recorded, and
  that is the whole of what the marks say.
- **Clicking with the crosshair on a marked date opens that date's
  recording** (`recording-detail.md`), which is the route from a shape
  that looks wrong to the evening that produced it. On any other day a
  click opens nothing. A date carrying prices and no figures bends the
  bands and takes no tick, because a tick means a quantity was
  recorded, and it is reached through the date picker instead.
- **Archive annotations**: a marker at each `archivedAt` with the
  holding named in the tooltip.
- Single band ("Total") → **no legend box**; the section heading names
  it.
- **Keyboard**: the chart is focusable, and focus puts the crosshair on
  the range's last day. Each move announces the tooltip's readout, and
  the hero follows as it does under the pointer.
  - **Left / Right** step the crosshair back or forward one day.
  - **Shift+Left / Shift+Right** jump to the previous or next marked
    date, whether or not "Just the line" has hidden the marks.
  - **Home / End** jump to the range's first or last day.
  - **Enter** on a marked date opens its recording, and on any other
    day does nothing.
  - No key moves the crosshair past either end of the range, and a jump
    with no marked date in its direction leaves it where it is.
  - Focus leaving the chart takes the crosshair away, as the pointer
    leaving the plot does.

  A "View as table" disclosure exposes the same series as a real table.
  Nothing the chart offers is reachable only by pointer.
- Chart colors, band order, mark specs and the axes come from
  `design-system.md` (Chart palette, Axes).
- **No control here issues a network request** — range, dimension, mode,
  band visibility, selection. The whole model is already in memory.

### 3. Breakdown by dimension

Where the chart above shows how composition **moved**, this shows what
it is made of **right now** — a different question, which is why the
section exists.

- Horizontal bars, one per band of the dimension selected in "Group by",
  **in the dimension's configured value order** — not sorted by value.
  Same order as the stack above, so the two read as one thing.
- **Every bar is chart slot 1** — these are nominal categories and the
  bar length already carries the value (`design-system.md`).
- Direct label on each bar: value label and amount. The bars run the
  card's width less the room these labels take at the outboard ends.
- "Unassigned" is a bar like any other, and "Other" folds the fifth and
  beyond, matching the chart.
- **A band can be net negative** — a mortgage under "Fixed" — so the
  bars sit against a **shared zero baseline** and negative bands run
  **leftward** from it, in the same slot-1 fill at the liability
  opacity (`design-system.md`, Nominal bars). This is the stacked
  chart's asset-up/liability-down convention turned on its side, so the
  two sections read the same way. When every band is positive the
  baseline sits at the left edge and the bars look ordinary; the layout
  does not change shape depending on the data.
- **The bars sum to exactly the net-worth total**, a *signed* sum with
  leftward bars subtracting, the same arithmetic the hero figure does,
  so the section needs no caveat. Bars rather than a pie: a pie cannot
  show a negative slice at all, and bars compare lengths better and
  label directly.
- With "Group by" on "Total", this section is absent — a single bar
  equal to the hero figure says nothing.

### 4. Holdings table

The section heading holds the left of the card's head row and the
"Show archived" toggle the right, with the table filling the card
beneath them.

Columns: Name · Dimensions · Latest value (native unit) · In main
currency · As of · (row action).

- The Dimensions column shows one chip per assignment
  (`Liquidity: Cash`), omitting dimensions the holding has no value for
  rather than printing "Unassigned" on every row. With no dimensions
  configured, the column is absent entirely.
- Latest value and In main currency are figure columns, and each
  figure shows as `design-system.md`, Typography, sets it.
- Rows in the order the holdings were created, oldest first. A row
  never moves because its figure changed.
- **"As of" is the date of the quantity, never of the rate.** A holding
  has two ages and only one of them is the user's: the rate's age is
  one date for the whole screen (Hero figure), because it is the same
  for everything and nobody can act on it. The quantity's age sorts,
  which is what answers "what have I not touched in a while" without a
  threshold deciding it for the user. Shown plainly, at any age.
  - **A row valued at a price older than the date it is shown for**
    carries the price date line beneath its converted figure, "priced
    15 Jan 2024" (`design-system.md`, Components), because the screen's
    rate date is not true of that row (`net-worth-view.md`, Current net
    worth). Which date that is follows Which rates:
    - **Latest rates**: a price dated before the rate date in the
      control's label.
    - **Rates as of each figure**: a price dated before the row's own
      As of date. A unit with a rate source reaches it where the row's
      quantity date has no price.

    Most often it is a holding nobody publishes a price for, whose
    price moves only when its owner revisits it.
- **An archived holding is an archived row, whatever its figures**, and
  never joins either group below. Being archived is why it is out of
  the total, so a missing value or price is never given as the reason
  (`net-worth-view.md`).
- Active holdings with no snapshots are listed in a separate "Not yet
  valued" group below the table — **not shown as 0**, which is a real
  value meaning something different.
- Active holdings whose unit has no price at all are listed in a
  separate **"Not priced"** group, with that as the stated reason
  rather than the other one, and excluded from the total. Never counted
  at their bare quantity, which would value a holding as though its
  unit were the main currency (`net-worth-view.md`).
- Archived holdings are hidden by default behind a "Show archived"
  toggle. When shown, each is a row in the table with an "Archived"
  chip and its text in ink-secondary, never at reduced opacity, which
  would take its text and chips below their contrast floors
  (`design-system.md`, Ink and line).
  - **Its unit has no price**: Latest value is its latest quantity, and
    In main currency reads "not priced" with no price date line.
  - **It has no readable snapshot**: Latest value reads "not yet
    valued", and In main currency and As of are empty.
  - Its row action is **Unarchive** in place of Record a value
    (`account-form.md`, Rules).
- Row click → the holding's detail screen (`account-detail.md`), which
  owns that holding's own list of values. A "Record a value" action on
  each active row opens the single-holding form at that holding
  (`snapshot-entry.md`). It is not a second New recording: that button
  asks which date and sweeps every holding, this one takes one holding
  to one date, which is what an odd date or a backfill needs.

## At phone width

The regions keep their order and stack, 20px apart.

- **Hero**: the total, then the change, then gross assets and gross
  liabilities side by side in two equal columns under a hairline rule.
  Which rates spans the width beneath them, and New recording spans
  the width beneath that, 48px tall.
- **Trend chart**: Range spans the width across the top of the
  controls, and the rest wrap in rows beneath it. Group by drops its
  visible label and keeps it as the select's accessible name, because
  the section heading above already says what it groups. The value
  ticks sit in a gutter at the plot's left, outside it, so no tick lies
  over a band or a mark. The legend
  runs in two columns and drops each band's figure, which the breakdown
  below carries, and the key to the entry marks sits beneath it.
- **Breakdown**: each bar's label moves above the bar, the band's name
  at the left and its amount at the right, and the bar keeps the shared
  zero baseline beneath it.
- **Holdings table**: a list rather than a table, with no column
  headings. Each row holds the name with its dimension chips beneath
  it at the left, and at the right the main-currency figure with any
  price date line and then the as-of date beneath it, preceded by the
  native figure where the unit is not the main currency. A row carries
  no row action, because tapping it opens the holding's screen, which
  offers Record a value or Unarchive (`account-detail.md`). An archived
  row keeps its ink-secondary text and its "Archived" chip. Where its
  unit has no price, the right side reads its quantity and then "not
  priced", with no price date line. Where it has no readable snapshot,
  the right side reads "not yet valued", with no as-of date.

## States

- **Loading**: none, and no skeleton. The records decrypt inside the
  unlock card's working state (`unlock.md`, The derivation wait), and
  the dashboard is drawn only once the total is final, so the hero
  figure never renders a wrong intermediate number.
- **Empty — no holdings**: single centered card, "Add your first
  holding", primary button. No chart, no table, no zero total, and no
  New recording: there is nothing to record against yet.
- **Empty — holdings but no snapshots**: table renders with every
  active holding under "Not yet valued", and with "Show archived" on,
  each archived one as an archived row reading "not yet valued"
  (Holdings table). Total shows "—", not 0. No chart.
  New recording works, because this is the state somebody leaves by
  recording.
- **Date picker open**: today is focused, dates holding a recording are
  marked, future dates are not selectable (`design-system.md`,
  Components). Dismissing it changes nothing and writes nothing.
- **Date picker with nothing marked**: an ordinary picker. A vault with
  no recordings yet needs no explanation of why the marks are absent.
- **Rates control, second position**: the total, the table and the
  breakdown reprice and the chart is unchanged. The control's own label
  is the only thing on screen that says which position is showing. No
  banner, no caveat.
- **Populated — a one-day history**: every range is that one day
  (`net-worth-view.md`, Ranges and modes). The plot draws one whole dot in its horizontal middle, with that day's
  date beneath it on the date axis, at desktop and at phone width. No
  line runs back to the beginning of time.
- **Populated — all holdings archived**: total "—", history still
  renders.
- **No dimensions configured**: "Group by" offers only "Total", with a
  link to `dimensions.md` to create one. The chart is a single band, the
  breakdown section is absent, and every other control still works. This
  is the default for a new vault and must not nag.
- **Error — some records failed to decrypt**: the view renders
  everything readable, with a **prominent, non-dismissible** critical
  banner: "N records could not be read." This is the AAD-binding
  tripwire firing (`architecture.md`, Data integrity) — it must never be
  swallowed or degrade to a console warning. Links to a detail list of
  the affected record ids.
- **Error, two entries on one date**: a holding with two values on one
  date, or a unit with two differing prices on one date. A critical
  banner names it and links to the date's recording, where the pair is
  shown and one is kept (`recording-detail.md`). Meanwhile that date
  drops out of the interpolated series rather than the chart picking a
  number nobody chose.
- **Error — session expired mid-action**: prompt to re-unlock in place;
  never discard unsaved input, unless the vault was replaced meanwhile
  (Replaced since last open).
- **Replaced since last open**: the page held the vault, the vault was
  replaced from a file while the page was locked, or while it stayed
  open after its session ended for its own reason, and the page learns
  it only at unlock (`spec/features/login.md`). Every input
  and dialog kept through the lock is dropped, and unlocking lands
  here rather than on the view the page was on, which can name a record
  the restore removed. A page on another device that was locked before
  the restore, or a page whose session ended for its own reason,
  reaches this rather than `unlock.md`, Replaced elsewhere, because it
  makes no request that could learn of the restore until it unlocks.
  - A Callout (`design-system.md`, Components) sits at the top of the
    content region, above the hero, at the full content width and 32px
    above it like every other region. It is a polite live region.
  - When kept input was dropped, it carries the critical icon and
    reads:

    > Your vault was replaced from a file since you last opened it
    > here. What you had typed here and not saved is gone.

  - When none was, it carries no icon and reads:

    > Your vault was replaced from a file since you last opened it
    > here. Nothing you had typed here was lost.

  - It has no control and stays until the person leaves the dashboard.
    It is not shown again, because it reports one event and the
    dashboard beneath it is already the restored vault.
  - A page that learned of the restore before unlocking says so on the
    unlock card instead (`unlock.md`, Replaced elsewhere), and the
    dashboard shows no callout after it.

## Rules

`net-worth-view.md`, Rules applies unchanged: decimal arithmetic,
`x-text` for every decrypted string, downsampling for display only.
