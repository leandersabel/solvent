# Net worth view

## What it does

The core payoff: current total net worth in the user's main currency,
per-account balances, grouping by dimension, and a stacked trend chart
over time. Every figure is computed client-side from decrypted records —
the server has nothing to template here, because it has no plaintext.

## Data flow

1. On unlock, fetch all four record types
   (`GET /api/records?type=account|snapshot|rate|profile`) and decrypt
   them with the session DEK.
2. Build the model in memory: profile (main currency), accounts,
   snapshots grouped by `account_id` and sorted by date, and prices
   grouped by `symbol` and sorted by date (`record-rate.md`).
3. Compute totals and series locally. Subsequent writes update this
   model directly, with no refetch on every save. The one refetch in
   the write path is the reload before the first record a sitting
   creates at a date (`record-snapshot.md`, Creating and reopening are distinct
   acts), which is what a stale model cannot substitute for.

For the expected data volume (a household, manual snapshots, years of
history) fetching everything once per session is the right call: it is
simpler, and it means the server learns nothing from access patterns
about which account you are looking at.

## Current net worth

Every account contributes its **last recorded quantity** at a price
drawn from that unit's own timeline (`record-rate.md`). The two are
looked up separately, which is the point of the split: a dollar account
last recorded in March is not stuck at March's exchange rate.

`total = Σ over active accounts of (latest snapshot.value × price)`

The view has a **pricing mode**, and it selects the price:

- **Latest rates** (the default): the **latest** entry for that
  account's unit, whatever date it carries.
- **Rates as of each figure**: the latest entry for that unit **at or
  before** the date of the account's own latest snapshot. This is what
  the holding was worth when it was last recorded, which is a real
  question and a different number.

Both modes use the same quantity. The mode changes only which price is
paired with it, and switching modes makes no network request, because
both series are already in memory.

**The mode reaches the total, the account list and the breakdown, and
nothing else.** It is not a chart control (Trend chart, Ranges and
modes). It is named for the latest rate rather than today's rate
because nothing on this screen fetches a price: the newest entry in the
vault is whatever the last recording wrote.

- **Latest means the greatest `date`**, in either series, never the most
  recently written.
- **An account whose unit is the main currency** prices at exactly `"1"`
  in both modes, from no entry, and is never reported as unpriced.
- Each account's figure carries its **quantity's as-of date** wherever
  it appears, because that is the date the person acts on
  (`ui/update-values.md`). A row whose price is older than the newest
  price in the vault also carries **its price's date**, since latest
  rates is then not true of that row. That case is a holding
  with no rate source, whose price only moves when its owner revisits
  it.
- **There is no staleness threshold and no stale-account warning.** No
  single number fits a product built on uneven cadence — a current
  account moves monthly, unlisted property every few years — so any
  threshold leaves the slow accounts permanently flagged until the user
  learns to ignore it, at which point it fails for the account that
  genuinely went quiet. The age of each figure is stated in plain
  language on `ui/update-values.md`, next to the control that acts on
  it.
- **Archived accounts are excluded from the current total** — an
  archived account is a closed position. They remain in history up to
  their `archivedAt` date (see Trend chart).
- **An account with no snapshots contributes nothing** and is listed
  separately as "not yet valued" rather than shown as 0. Zero is a real
  value a user can record and means something different.
- **An account with a quantity and no price for its unit contributes
  nothing either**, and is listed separately as **not priced**, with
  that as the stated reason rather than the other one. It is never
  counted at its bare quantity, which would silently value a holding as
  though its unit were the main currency. The state is reached by a
  recording whose price writes all failed (`record-rate.md`, The write
  path), by a free-text unit nobody has priced yet, and by the deletion
  or the flagged duplication of a symbol's only entry.
- Negative balances (mortgages, loans) subtract. Net worth is a signed
  sum, and the UI shows gross assets, gross liabilities, and the net
  figure separately.

## Trend chart

A **stacked area chart** over time: one band per group, the bands
summing to net worth. It answers two questions at once — how the total
moved, and what it was made of.

### Values between entries

An account's worth at a chart date is the product of two interpolated
series:

`value(account, t) = quantity(account, t) × price(unit(account), t)`

- **Quantity** is linearly interpolated between that account's own
  snapshots. It contributes nothing to dates **before its first
  snapshot**, not backfilled with zero, which would show a false
  jump when a long-held account is first entered, and after the last
  snapshot it is **carried forward**, because there is nothing to
  interpolate toward.
- **Price** is linearly interpolated between that symbol's own entries,
  **carried forward** after the last and **carried backward** before the
  first. The asymmetry with quantity is deliberate: a price series
  samples something that existed before anyone started sampling it,
  while a holding genuinely did not exist before its first entry.
  Blanking a band before its symbol's first price would draw a holding
  appearing out of nowhere on the day its owner first recorded a price,
  which is the same false jump the no-zero-backfill rule exists to
  prevent.
- Interpolation is **per account and then summed**, never interpolation
  of an already-summed series, because accounts start at different dates
  and summing first would smear one account's first snapshot across the
  rest.

**A band bends between two quantity entries.** The product of two
piecewise-linear series is piecewise quadratic, so a price entry falling
between two snapshots pulls the band off the straight line between them.
A holding recorded in January and again in July, priced monthly in
between, follows the currency rather than running as a chord across six
months.

Two consequences for drawing it:

- **Sample each account at the union** of its own snapshot dates and its
  symbol's price dates within range, plus the range endpoints. Sampling
  only the snapshot dates would cut every bend off, silently and
  everywhere.
- Between two samples the segment is drawn straight. Both factors are
  linear there, so the error is the quadratic term alone, at most a
  quarter of the product of the two deltas across that segment, which at
  any realistic price cadence is below a pixel.

**A change to one entry moves a bounded stretch, and only it.** Adding
an entry to either series, changing one, and deleting one all affect
the dates between that entry's neighbors in its own series, and no
others:

- An entry with a neighbor on each side affects the open stretch
  between them.
- The **last** entry of a series affects everything from the previous
  entry onward, because what follows it is carried forward.
- The **first** entry of a price series affects everything up to the
  next entry, because what precedes it is carried backward. An
  account's first snapshot instead moves where that account's band
  starts, since nothing precedes it.

This is what makes an edit safe to offer (`record-snapshot.md`,
Reopening and editing a recording): correcting a figure from eight
months ago cannot move last year, and cannot move today unless the
figure was the newest one.

**Deleting a whole recording moves more than its own holdings.** It
takes the date's rate entries with it (`record-snapshot.md`, Deleting a
recording), and each removed entry frees the stretch between its
neighbors in its own symbol's series. Every band measured in those
symbols moves across those stretches, including holdings that were
never recorded that day. The bound is the one above, applied once per
removed entry.

**A recording with rates and no values still shapes the chart.** Its
rate entries are ordinary knots: they anchor their symbols' series, and
a band between two quantity entries bends over them exactly as it does
over any other price entry. A date nobody recorded a quantity at is
still a date somebody priced.

**The dates a quantity was recorded are marked from the moment the
chart loads.** The entry marks are ticks under the x-axis, one at every
date carrying at least one snapshot, so a stretch running between two
ticks is a stretch that was drawn rather than recorded.
`ui/design-system.md` owns the mark, `ui/dashboard.md` the one control
that takes them off, **Just the line**. They are on by default because
the accurate drawing is the one nobody should have to ask for, and
because they are the chart's way into a recording
(`record-snapshot.md`): hidden by default, they would hide that route
with them.

**A tick means a quantity, never a price.** It answers "when did I
actually go and look this holding up", which is the question the sweep
is built around, and a tick for every price entry would put one under
every month for every account and bury the ones that matter. A date
carrying rate entries and no snapshots bends the bands and takes no
tick.

**The marks do not separate an interpolated quantity from an
interpolated price.** A tick sits on a date shared by every band, so a
per-factor mark would need one per band per date, which is unreadable
across a decade of history. Where one figure's own provenance matters,
the row form of the mark carries it (`ui/update-values.md`).

### Grouping by dimension

Bands come from a **dimension** — a named axis whose values partition
the accounts (`manage-accounts.md`, Dimensions). A stacked chart
requires a partition: if one account could land in two bands, the bands
would not sum to net worth.

- Each account falls in **exactly one band per dimension**, guaranteed
  by the record shape rather than by a check — `dims` is a map keyed by
  dimension id, so a second value cannot be expressed
  (`manage-accounts.md`). There is no "Ambiguous" band, because there is
  no ambiguous state to display.
- Accounts with no entry for the dimension group under
  **"Unassigned"** — a real band, never hidden, or the bands would not
  sum to the total. An entry naming an archived or unknown value lands
  here too.
- Grouping by **no dimension** gives a single band: plain net worth.
- Band order is **fixed per dimension**, from the dimension's configured
  value order (`account-settings.md`), never sorted by size. A stack
  whose bands reorder over time cannot be read.

Because a dimension only partitions the accounts that carry it, the UI
must show its **coverage** — how many accounts are assigned — wherever a
dimension is chosen. A dimension covering three of ten accounts produces
a mostly-"Unassigned" chart that is correct and useless, and the user
needs to see why.

### Assets and liabilities

A negative balance cannot be stacked with positive ones. Asset bands
stack **upward** from zero, liability bands **mirror downward**, each
band keeping its group's color on both sides, and the net-worth line
runs over the top. This keeps the signed-sum rule above visible instead
of hiding it in a single collapsed figure.

### Archived accounts

An archived account contributes nothing **after `archivedAt`**. The
archive flow's closing snapshot at that date (`manage-accounts.md`) is
the expected path, and the value **interpolates into it** like any other
snapshot rather than holding flat and stepping.

That interpolated run-down lies between two entry marks like any other
inferred stretch, so the chart already says it was drawn rather than
recorded. A user who wound a position down on one specific day can
record an intermediate snapshot and get the sharp edge honestly.
When the closing snapshot is skipped, the band still drops at
`archivedAt` and the UI marks the point as an archive, not a valuation.

Either way the drop carries an **annotation** on the x-axis and a
tooltip line naming the account, because an unexplained vertical edge in
an otherwise smooth chart is indistinguishable from a bad snapshot.

### Ranges and modes

- Ranges: 1M, 6M, 1Y, All. Default: 1Y, or All if history is shorter.
- **Pricing mode is not a chart control.** Every chart point is already
  drawn at the prices of its own date, by the formula above, so there
  is nothing for the mode to do here and switching it moves no pixel.
  On latest rates the chart's right hand edge **is** the total: the
  edge carries each account's last quantity carried forward at its
  symbol's last price carried forward, which is the total's own
  definition. On rates as of each figure the total is deliberately not
  the edge, and the gap between them is the whole point of the mode. It
  says how much of the move since the person last looked was their
  money and how much was the rates, which is the one thing the default
  mode cannot show. A chart that repriced with the control would close
  that gap and answer nothing.
- **Absolute / percentage** toggle. The percentage view normalizes each
  side against itself — asset bands against total assets, liability
  bands against total liabilities — because a share of a signed net
  figure is meaningless when the net approaches zero.

## Inputs / outputs

- In: ciphertext records fetched from the API, decrypted with the
  session DEK: accounts, snapshots, prices, and the profile.
- Out: current total in the selected pricing mode, per-account balances
  with as-of dates, a breakdown by the selected dimension, trend series.
  Nothing computed here is ever sent back to the server.

## Rules

- All money arithmetic uses decimal, never floats (record-snapshot.md).
  Sums are computed at full precision and rounded only for display. A
  chart point costs two multiplications rather than one, and both round
  half-even at scale 12 like every other.
- Every decrypted string — account name, note, dimension and value
  label — is rendered with `x-text` / `textContent`. Never `x-html`,
  never a chart library that takes an HTML string for labels or tooltips
  (architecture.md, Application hardening).
- **The chart is drawn directly in SVG with no charting library.** What a
  library supplies here is scales, tick math, and path building. What
  this chart needs — the partition rule, per-account interpolation,
  provenance tracking, per-band selection deltas, asset/liability
  mirroring — is domain logic written either way. The full interactive
  chart prototypes at ~200 lines of dependency-free JS; a production
  version with real tick generation, decimal arithmetic, a keyboard path
  and a table fallback is estimated at 350–450.
  - SVG, not canvas: the direct labels, `tabular-nums` figures, and the
    accessible fallback below all need real DOM.
  - Any library added later inherits the constraints: self-hosted with
    SRI, CSP-safe with no `eval` or `new Function`, no CDN
    (architecture.md, Supply chain), and text-only labels and tooltips.
    Measured against the shipped bundles:

    | Library | gz | `eval` / `new Function` | `innerHTML` |
    |---|---|---|---|
    | Chart.js 4.5.1 | 69 KB | 0 | 0 |
    | uPlot 1.6.32 | 21 KB | 0 | 0 |
    | ECharts 6.1.0 | 360 KB | 1 | 15 |
    | ApexCharts 6.6.1 | 226 KB | 0 | 37 |
    | frappe-charts 1.6.2 | 17 KB | 0 | 17 |
    | chartist 1.5.0 | 11 KB | 0 | 1 |

    ECharts, ApexCharts, and frappe-charts fail structurally: their label
    and tooltip paths end in `innerHTML`, and in an app where XSS means
    Master Key capture that is not a configuration problem. Chart.js and
    uPlot pass the CSP tests cleanly and are both MIT.
- The chart is **keyboard reachable and has a data-table fallback**. A
  static `aria-label` on the SVG is not sufficient for the primary
  screen of the app.
- Formatting follows the main currency's conventions; asset units
  (troy oz, m²) keep their own precision in per-account views.

## Edge cases

- **No accounts** → empty state pointing at "Add your first account."
- **Accounts but no snapshots** → accounts listed as "not yet valued,"
  total shown as "—" rather than 0, no chart.
- **One snapshot total** → the chart shows a single point rather than
  failing or drawing a flat line back to the beginning of time.
- **All accounts archived** → total is "—", history still renders.
- **A dimension no account carries** → one "Unassigned" band covering
  everything, with the coverage indicator reading 0 of N. Correct, and
  the indicator is what stops it being read as a bug.
- **An account whose `dims` names an archived or unknown value** →
  "Unassigned", like any unclassified account. The entry is preserved,
  so restoring the value restores the band.
- **A dimension with more than four values** → the first four in the
  dimension's configured order take chart slots; the remainder fold into
  "Other" (`design-system.md`).
- **An account not valued in a long time** → counted in the total at its
  last known **quantity**, priced by the selected mode, with its "as of"
  date shown. It is the user's data: the UI states the age, it neither
  warns nor silently excludes.
- **An account whose unit has no price entry at all** → listed as not
  priced, excluded from the total, and never counted at its bare
  quantity.
- **A chart date before any price entry for a symbol** → priced at that
  symbol's first entry, carried backward.
- **Two entries for one (symbol, date) that are not byte-identical** →
  the pair drops out of that symbol's series, the neighboring entries
  interpolate across the date. The fault is named on screen and resolved in that date's recording
  (`record-rate.md`). When the pair is the symbol's only entry, its
  holdings are listed as not priced rather than counted at either
  figure.
- **Decryption fails for one record** → that record is skipped, the rest
  of the view renders, and a prominent warning names how many records
  could not be read. An unreadable price entry drops out of its series,
  which the neighboring entries interpolate across rather than leaving
  a hole. This is the AAD-binding tripwire firing
  (architecture.md, Data integrity) and must never be swallowed
  silently or crash the whole view.
- **A very large history** → the chart downsamples for display; totals
  are always computed on the full data.

## Acceptance criteria

- With three accounts in different units and known snapshots and price
  entries, the displayed total equals the hand-computed
  `Σ value × price`, exactly, in decimal, in both pricing modes, and the
  two modes differ.
- An account last recorded in March, with a price entry from this week,
  contributes at this week's price in the default mode and at March's
  price in the other. This is the regression test for the whole split.
- Recording one franc account changes the converted figure of every
  dollar and gold holding, without any of them gaining a snapshot.
- A change in the provider's published rate, with nothing recorded,
  changes no figure anywhere: nothing was written, so there is nothing
  to read differently.
- Adding, changing, or deleting an interior entry in either series
  changes only the stretch between that entry's neighbors. No point
  outside it moves, asserted for all three operations.
- Deleting the newest entry of a series moves every point after the
  previous entry and none before it.
- Deleting a whole recording moves every band measured in the symbols
  it priced, across the stretches those entries anchored and no
  further, including bands whose holdings had no entry at that date.
- A date carrying rate entries and no snapshots still bends the bands
  of the symbols it prices, asserted against the same date with those
  entries removed.
- A symbol with two differing entries on one date prices that date from
  its neighboring entries, and the view names the fault.
- An account whose unit has a quantity but no price entry is listed as
  not priced, is excluded from the total, and its quantity never appears
  in the total unconverted.
- An account last valued in March shows an "as of March" marker and
  still contributes to the current total, with no warning attached at
  any age.
- A snapshot recorded in the future of the chart range does not appear
  before its date.
- An account contributes nothing to chart dates before its first
  snapshot; adding ten years of an old account's history does not create
  a step at the chart's left edge.
- An account with snapshots of 100 on 1 January and 200 on 1 March,
  measured in the main currency, reads 150 on 1 February, with 1
  January and 1 March carrying an entry mark and 1 February carrying
  none, and with nobody having turned anything on.
- The same account measured in a unit whose price is 1.00 on 1 January
  and 2.00 on 1 March reads 150 × 1.50 on 1 February, not the chord
  between 100 and 400. This is the assertion that the band bends.
- A chart date before a symbol's first price entry is priced at that
  first entry. The band does not start at zero and does not vanish.
- The axis ticks mark quantity entries only: adding a price entry adds
  no tick.
- The chart loads with its entry marks showing, with nothing turned on
  and no stored preference consulted. Just the line removes them and
  changes nothing else about the drawing.
- Switching the pricing mode changes the total, the account list and
  the breakdown, and changes no chart point. Asserted over every
  sample of every band, not only the right hand edge.
- On latest rates the chart's right hand edge equals the total exactly,
  in decimal. With a holding last recorded in March and a price entry
  from this week at a different figure, rates as of each figure gives
  a total that is not the edge, and nothing on screen reports that
  difference as a fault.
- Two accounts whose histories start years apart produce a chart where
  the later account's first snapshot raises only its own band — summing
  before interpolating would instead bend the whole series.
- Archiving an account removes it from the current total, leaves every
  chart point before `archivedAt` unchanged, and drops it after, with an
  archive annotation at that date.
- For every date in the chart, the sum of the visible bands equals the
  net-worth line at that date, in decimal.
- An account appears in exactly one band of the selected dimension, and
  the account count across all bands equals the total account count.
- An account with no snapshots is listed as "not yet valued" and is not
  counted as 0.
- A negative-balance account reduces the net figure and appears under
  liabilities.
- The breakdown by dimension sums to exactly the net-worth total, with
  no disclaimer needed.
- With one record deliberately corrupted, the view renders the rest and
  warns that 1 record could not be decrypted. With that record being a
  price entry, its symbol still prices from the neighboring entries.
- No network request is made when switching chart range, dimension,
  absolute/percentage mode, pricing mode, or band visibility.
- An account named `<script>alert(1)</script>` renders as literal text
  in the list, the chart legend, and any tooltip — as does a dimension
  value labelled the same way.
