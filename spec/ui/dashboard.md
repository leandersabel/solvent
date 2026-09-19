# Dashboard

## Purpose

The core payoff screen: what you are worth right now, how it got there,
and how it splits. Everything is computed client-side from decrypted
records — the server has nothing to template here.

Exercises: `spec/features/net-worth-view.md`. Links into
`account-form.md`, `snapshot-entry.md`, `update-values.md` and
`recording-detail.md`.

## Layout

Standard app shell (`design-system.md`, App shell). The accounts table
below is the account list the shell deliberately has no nav entry for.

Regions, top to bottom:

### 1. Hero figure

- The net worth total, 44px/600, ink-primary, proportional figures, in
  the main currency.
- Beneath it, the change over the selected chart range: an arrow icon,
  the signed absolute change, and the percentage — in status good or
  critical, **with the arrow icon carrying the sign, not the color
  alone**.
- Beside the total, two smaller figures in ink-secondary: gross assets
  and gross liabilities. Net worth is a signed sum and the UI must show
  both sides (`net-worth-view.md`).
- **Which rates**, a two-position control beside the total, both
  positions named:
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
    in the table below.
  - It changes the total, the accounts table and the breakdown, and
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
  below. Beside it, the dimension's **coverage**: "7 of 10 accounts
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

**Interaction:**

- **Hover** moves a dotted crosshair and a tooltip pinned to the top of
  the plot: date, every visible band with its value, then the net total
  on a separated row. Value first, date second — the value is what the
  user came for. The hero figure follows the cursor.
- **Drag** selects a span between two arbitrary dates. The band stays
  after release, the hero shows the change across exactly those two
  points, and **each legend entry gains its own delta for the span** —
  this is how "what did my retirement do between 2019 and 2024" gets
  answered. A plain click clears it; changing range or dimension clears
  it.
- **Legend** entries toggle a band. Hovering one highlights it and dims
  the rest. With a band hidden, a line under the chart states that the
  total covers only the visible bands.
- **Entry marks**: the chart form of the estimated marker
  (`design-system.md`). The bands themselves are never restyled. A
  stretch running between two marks is drawn rather than recorded, and
  that is the whole of what the marks say.
- **Clicking a marked date opens that date's recording**
  (`recording-detail.md`), which is the route from a shape that looks
  wrong to the evening that produced it. Only marked dates are click
  targets. A date carrying prices and no figures bends the bands and
  takes no tick, because a tick means a quantity was recorded, and it
  is reached through the date picker instead.
- **Archive annotations**: a marker at each `archivedAt` with the
  account named in the tooltip.
- Single band ("Total") → **no legend box**; the section heading names
  it.
- **Keyboard**: the chart is focusable, arrow keys step the crosshair
  between recorded dates, Enter on one opens its recording, and a "View
  as table" disclosure exposes the same series as a real table. Nothing
  the chart offers is reachable only by pointer.
- Chart colors, band order and mark specs come from
  `design-system.md`.
- **No control here issues a network request** — range, dimension, mode,
  band visibility, selection. The whole model is already in memory.

### 3. Accounts table

Columns: Name · Dimensions · Latest value (native unit) · In main
currency · As of · (row action).

- The Dimensions column shows one chip per assignment
  (`Liquidity: Cash`), omitting dimensions the account has no value for
  rather than printing "Unassigned" on every row. With no dimensions
  configured, the column is absent entirely.
- Money columns right-aligned, `tabular-nums`.
- **"As of" is the date of the quantity, never of the rate.** A holding
  has two ages and only one of them is the user's: the rate's age is
  one date for the whole screen (Hero figure), because it is the same
  for everything and nobody can act on it. The quantity's age sorts,
  which is what answers "what have I not touched in a while" without a
  threshold deciding it for the user. Shown plainly, at any age.
  - A row whose unit is priced **older than the vault's newest rate**
    carries that price's date as well, because "latest rates" is not
    true of that row. That is a holding nobody publishes a price for,
    whose price moves only when its owner revisits it
    (`net-worth-view.md`).
- Accounts with no snapshots are listed in a separate "Not yet valued"
  group below the table — **not shown as 0**, which is a real value
  meaning something different.
- Accounts whose unit has no price at all are listed in a separate
  **"Not priced"** group, with that as the stated reason rather than
  the other one, and excluded from the total. Never counted at their
  bare quantity, which would value a holding as though its unit were
  the main currency (`net-worth-view.md`).
- Archived accounts are hidden by default behind a "Show archived"
  toggle; when shown they are dimmed with an "Archived" chip.
- Row click → the account's detail screen (`account-detail.md`), which
  owns that holding's own list of values. A "Record a value" action per
  row opens the single-holding form at that holding
  (`snapshot-entry.md`). It is not a second New recording: that button
  asks which date and sweeps every holding, this one takes one holding
  to one date, which is what an odd date or a backfill needs.

### 4. Breakdown by dimension

Where the chart above shows how composition **moved**, this shows what
it is made of **right now** — a different question, which is why the
section exists.

- Horizontal bars, one per band of the dimension selected in "Group by",
  **in the dimension's configured value order** — not sorted by value.
  Same order as the stack above, so the two read as one thing.
- **Every bar is chart slot 1** — these are nominal categories and the
  bar length already carries the value (`design-system.md`).
- Direct label on each bar: value label and amount.
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

## States

- **Loading**: skeleton blocks for hero, chart, and table while
  records decrypt. The hero figure must never render a wrong
  intermediate number and appears only when the total is final.
- **Empty — no accounts**: single centered card, "Add your first
  account", primary button. No chart, no table, no zero total, and no
  New recording: there is nothing to record against yet.
- **Empty — accounts but no snapshots**: table renders with every
  account under "Not yet valued". Total shows "—", not 0. No chart.
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
- **Populated — one snapshot total**: the chart shows a single point,
  not a flat line running back to the beginning of time.
- **Populated — all accounts archived**: total "—", history still
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
  never discard unsaved input.

## Rules

`net-worth-view.md`, Rules applies unchanged: decimal arithmetic,
`x-text` for every decrypted string, downsampling for display only.
