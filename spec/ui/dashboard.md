# Dashboard

## Purpose

The core payoff screen: what you are worth right now, how it got there,
and how it splits. Everything is computed client-side from decrypted
records — the server has nothing to template here.

Exercises: `spec/features/net-worth-view.md`. Links into
`account-form.md` and `snapshot-entry.md`.

## Layout

Standard app shell (`design-system.md`, App shell), content max-width
1200px on ground. The accounts table below is the account list the shell
deliberately has no nav entry for.

Four regions, top to bottom:

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
- An **"Update values"** action leading to `update-values.md`, the sweep
  across every account. No staleness chip and no warning: how old each
  figure is belongs on that screen, beside the control that fixes it,
  not as a badge here (`net-worth-view.md`).

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
  assigned", clickable to filter the table to the unassigned ones. A
  dimension covering a third of the accounts draws a chart that is
  correct and misleading, and this line is what prevents that being read
  as a bug.
- **Absolute / percentage** toggle. Percentage normalizes each side
  against itself; the caption says so, because a reader will otherwise
  assume the shares are of the net figure.
- **"Show what's estimated"** checkbox, default off.

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
- **Estimated data**, when shown: the chart form of the estimated
  marker (`design-system.md`) — tick marks under the x-axis at the dates
  real snapshots exist. The bands themselves are unchanged.
- **Archive annotations**: a marker at each `archivedAt` with the
  account named in the tooltip.
- Single band ("Total") → **no legend box**; the section heading names
  it.
- **Keyboard**: the chart is focusable, arrow keys step the crosshair
  between snapshot dates, and a "View as table" disclosure exposes the
  same series as a real table.
- Chart colors, band order, mark specs, and the tooltip contract come
  from `design-system.md`.
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
- "As of" shows the snapshot date, plainly, at any age. The column is
  sortable, which is what makes it answer "what have I not touched in a
  while" without a threshold deciding for the user.
- Accounts with no snapshots are listed in a separate "Not yet valued"
  group below the table — **not shown as 0**, which is a real value
  meaning something different.
- Archived accounts are hidden by default behind a "Show archived"
  toggle; when shown they are dimmed with an "Archived" chip.
- Row click → the account's detail screen (`account-detail.md`), which
  owns its snapshot history. A primary "Record snapshot" action per row.

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
- **The bars sum to exactly the net-worth total** — a *signed* sum, with
  leftward bars subtracting, which is the same arithmetic the hero
  figure does. So the section needs no caveat. Dimensions partition,
  which would make a pie chart defensible here too — except that a pie
  cannot show a negative slice at all; bars are used anyway, because
  they compare lengths better and label directly.
- With "Group by" on "Total", this section is absent — a single bar
  equal to the hero figure says nothing.

## States

- **Loading**: skeleton blocks for hero, chart, and table while records
  decrypt. Decryption of a full vault is fast but not instant, and the
  hero figure must never render a wrong intermediate number — it appears
  only when the total is final.
- **Empty — no accounts**: single centered card, "Add your first
  account", primary button. No chart, no table, no zero total.
- **Empty — accounts but no snapshots**: table renders with every
  account under "Not yet valued". Total shows "—", not 0. No chart.
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
- **Error — session expired mid-action**: prompt to re-unlock in place;
  never discard unsaved input.

## Rules

`net-worth-view.md`, Rules applies unchanged: decimal arithmetic,
`x-text` for every decrypted string, downsampling for display only.
