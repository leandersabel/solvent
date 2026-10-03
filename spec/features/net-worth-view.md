# Net worth view

## What it does

The core payoff: current total net worth in the user's main currency,
per-holding balances, grouping by dimension, and a stacked trend chart
over time. Every figure is computed client-side from decrypted records —
the server has nothing to template here, because it has no plaintext.

## Data flow

1. On unlock, fetch every record type
   (`GET /api/records?type=account|snapshot|rate|profile`) and decrypt
   them with the session DEK.
2. Build the model in memory: profile (main currency), holdings,
   snapshots grouped by `account_id` and sorted by date, and prices
   grouped by `symbol` and sorted by date (`record-rate.md`).
3. Compute totals and series locally. Subsequent writes update this
   model directly, with no refetch on every save. The one refetch in
   the write path is the reload before the first record a sitting
   creates at a date (`record-snapshot.md`, Creating and reopening are distinct
   acts), which is what a stale model cannot substitute for.

For the expected data volume (a household, manual snapshots, years of
history) one fetch per session is the right call, and it is why there
is no single-record `GET` (`record-api.md`, Endpoints).

## Current net worth

Every holding contributes its **last recorded quantity** at a price
drawn from that unit's own timeline (`record-rate.md`). The two are
looked up separately, which is the point of the split: a dollar holding
last recorded in March is not stuck at March's exchange rate.

`total = Σ over active holdings of (latest snapshot.value × price)`

The view has a **pricing mode**, and it selects the price:

- **Latest rates** (the default): the **latest price** for that
  holding's unit (`record-rate.md`, Reading).
- **Rates as of each figure**: the **price as recorded** for that
  holding. This is what the holding was worth when it was last
  recorded, which is a real question and a different number. It takes
  the newest entry at or before the quantity's date for every symbol,
  published ones included, rather than reading not priced where that
  date has no entry, because every holding in the total must carry a
  figure for the total to add up. The figure carries the entry's date
  instead (below).

Both modes use the same quantity. The mode changes only which price is
paired with it, and switching modes makes no network request, because
both series are already in memory.

**The mode reaches the total, the list of holdings and the breakdown,
and nothing else.** It is not a chart control (Trend chart, Ranges and
modes). It is named for the latest rate rather than today's rate
because nothing on this screen fetches a price: the newest entry in the
vault is whatever the last recording wrote.

- **Latest means the greatest `date`**, in either series, never the most
  recently written.
- **A holding whose unit is the main currency** prices at `"1"` in
  both modes (`record-rate.md`, Reading).
- Each holding's figure carries its **quantity's as-of date** wherever
  it appears, because that is the date the person acts on
  (`ui/update-values.md`). A row whose price is older than the date it
  is shown for also carries **its price's date**, so no figure passes
  an older price off as the screen's. On latest rates that is a price
  entry dated before the screen's rate date, the newest `date` of any
  entry in the vault. On rates as of each figure it is a price entry
  dated before the row's quantity date. Most often it is a holding with
  no rate source, whose price moves only when its owner revisits it.
- **There is no staleness threshold and no stale-holding warning.** No
  single number fits a product built on uneven cadence — a current
  holding moves monthly, unlisted property every few years — so any
  threshold leaves the slow holdings permanently flagged until the user
  learns to ignore it, at which point it fails for the holding that
  genuinely went quiet. The age of each figure is stated in plain
  language on `ui/update-values.md`, next to the control that acts on
  it.
- **Archived holdings are excluded from the current total** — an
  archived holding is a closed position. They remain in history before
  their `archivedAt` date (Trend chart, Archived holdings).
- **A holding with no snapshots contributes nothing** and is listed
  separately as "not yet valued" rather than shown as 0. Zero is a real
  value a user can record and means something different.
- **A holding with a quantity and no price for its unit contributes
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

A holding's worth at a chart date is the product of two interpolated
series:

`value(account, t) = quantity(account, t) × price(unit(account), t)`

- **Quantity** is linearly interpolated between that holding's own
  snapshots. It contributes nothing to dates **before its first
  snapshot**, not backfilled with zero, which would show a false
  jump when a long-held holding is first entered, and after the last
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
- Interpolation is **per holding and then summed**, never interpolation
  of an already-summed series, because holdings start at different dates
  and summing first would smear one holding's first snapshot across the
  rest.

**A band bends between two quantity entries.** The product of two
piecewise-linear series is piecewise quadratic, so a price entry falling
between two snapshots pulls the band off the straight line between them.
A holding recorded in January and again in July, priced monthly in
between, follows the currency rather than running as a chord across six
months.

Two consequences for drawing it:

- **Sample each holding at the union** of its own snapshot dates and its
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
  next entry, because what precedes it is carried backward. A
  holding's first snapshot instead moves where that holding's band
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
every month for every holding and bury the ones that matter. A date
carrying rate entries and no snapshots bends the bands and takes no
tick.

**The marks do not separate an interpolated quantity from an
interpolated price.** A tick sits on a date shared by every band, so a
per-factor mark would need one per band per date, which is unreadable
across a decade of history. Where one figure's own provenance matters,
the row form of the mark carries it (`ui/update-values.md`).

### Grouping by dimension

Bands come from a **dimension** — a named axis whose values partition
the holdings (`manage-accounts.md`, Dimensions). A stacked chart
requires a partition: if one holding could land in two bands, the bands
would not sum to net worth.

- Each holding falls in **exactly one band per dimension**, guaranteed
  by the record shape rather than by a check — `dims` is a map keyed by
  dimension id, so a second value cannot be expressed
  (`manage-accounts.md`). There is no "Ambiguous" band, because there is
  no ambiguous state to display.
- Holdings with no entry for the dimension group under
  **"Unassigned"** — a real band, never hidden, or the bands would not
  sum to the total. An entry naming an archived or unknown value lands
  here too.
- Grouping by **no dimension** gives a single band: plain net worth.
- Band order is **fixed per dimension**, from the dimension's configured
  value order (`account-settings.md`), never sorted by size. A stack
  whose bands reorder over time cannot be read.

Because a dimension only partitions the holdings that carry it, the UI
must show its **coverage** — how many holdings are assigned — wherever a
dimension is chosen. A dimension covering three of ten holdings produces
a mostly-"Unassigned" chart that is correct and useless, and the user
needs to see why.

### Assets and liabilities

A negative balance cannot be stacked with positive ones. Asset bands
stack **upward** from zero, liability bands **mirror downward**, each
band keeping its group's color on both sides, and the net-worth line
runs over the top. This keeps the signed-sum rule above visible instead
of hiding it in a single collapsed figure.

### Archived holdings

A holding archived on date D counts on **every chart date before D and
on none from D on**, so its value at D is part of no total. The chart
at D then agrees with the current total, which leaves the holding out.

Archiving writes the holding's zero at D (`manage-accounts.md`,
Archiving), so the band **interpolates into zero** as it does between
any two snapshots. The run-down lies between two entry marks like any
other inferred stretch, so the chart already says it was drawn rather
than recorded. A person who wound a position down on one specific day
records a figure on that day and gets the sharp edge honestly.

The zero is the holding's new last snapshot, and the archive's refresh
may add price entries at D (`record-rate.md`, The refresh). Each moves
exactly what a new last entry moves (Values between entries): the
dates after the previous entry in its own series, and nothing before
it.

The archive is a **step at D**. A day where a band starts or ends is
drawn as a vertical edge at that day's x, from the band's value just
before the day to its value at it. The first day of the range has no
side before it.

- A holding's **first snapshot** is absent just before its date and
  present at it, which is the no-zero-backfill rule (Values between
  entries) drawn as an edge.
- A holding **archived on D** is present just before D, at D's
  quantity and D's price, and absent at D. With the zero at D that side
  is zero, so the step is no edge at all.
- **The value at a date is the side at it.** The tooltip, the data
  table, the hero under the crosshair and the change over a range all
  read that side. The side just before shapes the drawing only.

**A holding archived without a zero at D keeps a real step**
(`manage-accounts.md`, A holding archived without a zero at D). It
falls from D's figure, or from the last quantity carried forward when
D has none, with nothing recorded to explain the drop.

D's price values the side just before the step, so a price entry at D
moves a holding archived on D only where that side is non-zero. Only
then does the confirmation for a rate change on D count it
(`ui/update-values.md`, Changing or clearing a rate says what it
moves).

Every archive date carries an **annotation** on the x-axis and a
tooltip line naming the holding, with or without a zero. A band running
out to nothing otherwise looks the same as a holding that lost its
value or a bad entry, and an unexplained vertical edge in an otherwise
smooth chart is indistinguishable from a bad snapshot.

### Ranges and modes

- Ranges: 1M, 6M, 1Y, All. Default: 1Y, or All if history is shorter.
- **The chart's last day is the newest date carrying a snapshot, a
  price entry or an `archivedAt`**, and every range counts back from
  it. An archive whose D carries no snapshot still falls inside the
  chart, which the right hand edge below depends on.
- **Pricing mode is not a chart control.** Every chart point is already
  drawn at the prices of its own date, so switching it moves no pixel.
  On latest rates the chart's right hand edge **is** the total: the
  edge carries each active holding's last quantity carried forward at
  its symbol's last price carried forward, which is the total's own
  definition, and no archived holding, because it lies at or after
  every archive (Archived holdings). On rates as of each figure the
  total is deliberately not the edge, and the gap between them is the
  whole point of the mode. It
  says how much of the move since the person last looked was their
  money and how much was the rates, which is the one thing the default
  mode cannot show. A chart that repriced with the control would close
  that gap and answer nothing.
- **Absolute / percentage** toggle. The percentage view normalizes each
  side against itself — asset bands against total assets, liability
  bands against total liabilities — because a share of a signed net
  figure is meaningless when the net approaches zero.

### Reading a date

**Every calendar day from the range's first day to its last is a date
the chart reads.** The crosshair, its tooltip, the hero under the
crosshair, both ends of a selection and the keyboard each resolve to
one such day and read it through the value model (Values between
entries), on the side at it (Archived holdings). None of them reads the
drawing's samples or its downsampled points, which exist to draw the
line. The line at a day between two samples may sit off the model by
the sub-pixel bound above. The figure shown is the model's.

- **Days are evenly spaced.** In a range of days 0 to n, day k sits at
  `x0 + k × (x1 − x0) / n` across the plot. A range of one day reads
  that day at every x.
- **The pointer reads the nearest day:**
  `k = round((x − x0) × n / (x1 − x0))`, clamped to the range, a half
  rounding to the later day. Every x on the plot reads exactly one day.
  Where the plot has at least as many pixels as the range has days,
  every day is read at some x. Where it has fewer, a pixel spans
  several days, and the keyboard reaches the ones between.
- **A selection's ends are the days under the press and the release**,
  by the same rule, ordered earlier first whichever way the drag ran.
  The change across it is the later day's value minus the earlier
  day's, for the total and for every band. A press and release on the
  same day is a click.
- **The keyboard reaches every day.** One key steps the crosshair a
  single day, and another moves it to the previous or next date
  carrying a snapshot. `ui/dashboard.md` owns the keys. Each key's readout is the
  tooltip's text, exposed to assistive technology, so a day the data
  table does not list is readable without the pointer.
- **Day arithmetic is on calendar dates, never on timestamps.** A day
  is a `YYYY-MM-DD` and the next day is that date plus one, so a
  daylight-saving change or the reader's time zone cannot skip or
  repeat a day.
- **A click opens a recording only on a date carrying a snapshot**,
  the dates the entry marks sit on. A click or Enter there opens that
  date's recording (`record-snapshot.md`). On any other day it opens
  nothing. The tick under the axis is a click target of its own for
  its date (`ui/design-system.md`, The estimated marker), so a
  recording stays reachable by pointer where a day is narrower than a
  pixel.

## Inputs / outputs

- In: ciphertext records fetched from the API, decrypted with the
  session DEK: holdings, snapshots, prices, and the profile.
- Out: current total in the selected pricing mode, per-holding balances
  with as-of dates, a breakdown by the selected dimension, trend series.
  Nothing computed here is ever sent back to the server.

## Rules

- All money arithmetic uses decimal, never floats (`record-snapshot.md`).
  Sums are computed at full precision and rounded only for display. A
  chart point costs two multiplications rather than one, and both round
  half-even at scale 12 like every other.
- Every decrypted string — holding name, note, dimension and value
  label — is rendered with `x-text` / `textContent`. Never `x-html`,
  never a chart library that takes an HTML string for labels or tooltips
  (architecture.md, Application hardening).
- **The chart is drawn directly in SVG with no charting library.** What a
  library supplies here is scales, tick math, and path building. What
  this chart needs — the partition rule, per-holding interpolation,
  provenance tracking, per-band selection deltas, asset/liability
  mirroring — is domain logic written either way. The full interactive
  chart prototypes at ~200 lines of dependency-free JS. A production
  version with real tick generation, decimal arithmetic, a keyboard path
  and a table fallback is estimated at 350–450.
  - SVG, not canvas: the direct labels, `tabular-nums` figures, and the
    accessible fallback below all need real DOM.
  - Any library added later inherits the constraints: self-hosted and
    hash-pinned, CSP-safe with no `eval` or `new Function`, no CDN
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
- The chart is **keyboard reachable** (Reading a date) **and has a
  data-table fallback**. A static `aria-label` on the SVG is not
  sufficient for the primary screen of the app.
- Formatting follows the reader's settings (account-settings.md, Dates
  and numbers).

## Edge cases

- **No holdings** → empty state pointing at "Add your first holding."
- **Holdings but no snapshots** → holdings listed as "not yet valued,"
  total shown as "—" rather than 0, no chart.
- **One snapshot total** → the chart shows a single point rather than
  failing or drawing a flat line back to the beginning of time.
- **All holdings archived** → total is "—", history still renders.
- **A holding first valued and archived on the same date** → it
  appears on no chart date and on neither side of its step: absent just
  before its first snapshot, and absent at its archive.
- **A dimension no holding carries** → one "Unassigned" band covering
  everything, with the coverage indicator reading 0 of N. Correct, and
  the indicator is what stops it being read as a bug.
- **A holding whose `dims` names an archived or unknown value** →
  "Unassigned", like any unclassified holding. The entry is preserved,
  so restoring the value restores the band.
- **A dimension with more than four values** → the first four in the
  dimension's configured order take chart slots, and the remainder fold
  into "Other" (`ui/design-system.md`).
- **A holding not valued in a long time** → counted in the total at its
  last known **quantity**, priced by the selected mode, with its "as of"
  date shown and no warning at any age.
- **A chart date before any price entry for a symbol** → priced at that
  symbol's first entry, carried backward.
- **Two entries for one (symbol, date) that are not byte-identical** →
  the pair drops out of that symbol's series and the neighboring
  entries interpolate across the date. The fault is named on screen and
  resolved in that date's recording (`record-rate.md`). When the pair
  is the symbol's only entry, its holdings are listed as not priced
  rather than counted at either figure.
- **Decryption fails for one record** → that record is skipped, the rest
  of the view renders, and a prominent warning names how many records
  could not be read. An unreadable price entry drops out of its series,
  which the neighboring entries interpolate across rather than leaving
  a hole. This is the AAD-binding tripwire firing
  (architecture.md, Data integrity) and must never be swallowed
  silently or crash the whole view.
- **A very large history** → the chart downsamples for display; totals
  and every reading at a date are always computed on the full data.

## Acceptance criteria

- With three holdings in different units and known snapshots and price
  entries, the displayed total equals the hand-computed
  `Σ value × price`, exactly, in decimal, in both pricing modes, and the
  two modes differ.
- A holding last recorded in March, with a price entry from this week,
  contributes at this week's price in the default mode and at March's
  price in the other. This is the regression test for the whole split.
- Recording one franc holding changes the converted figure of every
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
- A holding whose unit has a quantity but no price entry is listed as
  not priced, is excluded from the total, and its quantity never appears
  in the total unconverted.
- On rates as of each figure, a `USD` holding whose latest quantity is
  at 2026-04-10, with `USD` entries at 2010-03-31 only, counts in the
  total at the 2010-03-31 rate and its row carries 2010-03-31. A row
  whose price entry sits at its quantity date carries no price date.
- On latest rates, in a vault whose newest entry is at 2026-04-10, a
  free-text holding priced only at 2024-01-15 carries 2024-01-15, and a
  `USD` holding priced at 2026-04-10 carries no price date.
- A holding last valued in March shows an "as of March" marker and
  still contributes to the current total, with no warning attached at
  any age.
- A snapshot recorded in the future of the chart range does not appear
  before its date.
- A holding contributes nothing to chart dates before its first
  snapshot; adding ten years of an old holding's history does not create
  a step at the chart's left edge.
- A holding with snapshots of 100 on 1 January 2026 and 200 on 31
  January 2026, measured in the main currency, reads 150 on 16 January
  2026, the midpoint by day, with 1 January and 31 January carrying an
  entry mark and 16 January carrying none, and with nobody having
  turned anything on.
- The same holding measured in a unit whose price is 1.00 on 1 January
  2026 and 2.00 on 31 January 2026 reads 150 × 1.50 on 16 January 2026,
  not the chord between 100 and 400. This is the assertion that the
  band bends.
- A chart date before a symbol's first price entry is priced at that
  first entry. The band does not start at zero and does not vanish.
- The axis ticks mark quantity entries only: adding a price entry adds
  no tick.
- The chart loads with its entry marks showing, with nothing turned on
  and no stored preference consulted. Just the line removes them and
  changes nothing else about the drawing.
- With recordings on 15 January, 10 April and 30 June 2026 and nothing
  between, the pointer at the x of 5 February 2026 reads 5 February,
  and at the x of 3 June reads 3 June. The tooltip and the hero show
  the value model's bands and total for that day, exactly, in decimal,
  and neither day is a drawing sample.
- On that chart, a drag from 3 June back to 5 February selects 5
  February to 3 June. The hero shows the total at 3 June minus the
  total at 5 February, and each legend entry its band's value at 3 June
  minus its value at 5 February, exactly, in decimal.
- Moving the pointer across the plot one pixel column at a time reads
  days that never go backward, starting at the range's first day and
  ending at its last. On a range with no more days than the plot has
  pixel columns, every day of the range is read.
- From the range's first day, stepping the crosshair one day at a time
  reads every day of the range once, in order, ending at its last, with
  the same readout the pointer gives on each. This holds across a
  daylight-saving change in the reader's time zone. The key that moves
  between recorded dates lands on every date carrying a snapshot and on
  no other.
- A click or Enter on a day carrying no snapshot opens nothing. On a
  day carrying one, and on that day's tick, it opens that date's
  recording.
- With a history long enough to downsample, the readout at a day whose
  sample the downsampling dropped equals the value model at that day.
- Switching the pricing mode changes the total, the list of holdings
  and the breakdown, and changes no chart point. Asserted over every
  sample of every band, not only the right hand edge.
- On latest rates the chart's right hand edge equals the total exactly,
  in decimal. With a holding last recorded in March and a price entry
  from this week at a different figure, rates as of each figure gives
  a total that is not the edge, and nothing on screen reports that
  difference as a fault.
- Two holdings whose histories start years apart produce a chart where
  the later holding's first snapshot raises only its own band — summing
  before interpolating would instead bend the whole series.
- Archiving a holding on D removes it from the current total and from
  the value at D and at every later date, with an archive annotation at
  D. Every chart point up to and including the latest entry before D of
  each series the archive wrote to is unchanged.
- A holding measured in the main currency with a snapshot of 100 on 1
  January 2026, archived on 31 January 2026, reads 50 on 16 January
  2026, and the chart draws no vertical edge at 31 January: the side
  just before it is zero.
- A holding archived on the newest recorded date leaves the chart's
  last point, the data table's last row and the end of the change over
  the range each equal to the total on latest rates, exactly, in
  decimal.
- A holding archived on a date after the newest recording extends the
  chart to the archive date through its zero, and the point there
  equals the total on latest rates.
- Changing the price at D of the unit a holding archived on D is
  measured in leaves that holding's contribution at D and just before D
  at zero, and the confirmation does not count it.
- A holding archived on D with no snapshot at D, loaded from a fixture,
  steps at D from its last quantity carried forward at D's price, with
  the annotation at D. One archived with a non-zero snapshot at D steps
  from that figure, and changing D's price moves the side just before
  the step and is counted by the confirmation. Loading either writes
  nothing.
- An unarchived holding whose zero sits at D contributes zero from D
  until its next snapshot and interpolates up to that snapshot.
- For every date in the chart, the sum of the visible bands equals the
  net-worth line at that date, in decimal.
- A holding appears in exactly one band of the selected dimension, and
  the holding count across all bands equals the total holding count.
- A holding with no snapshots is listed as "not yet valued" and is not
  counted as 0.
- A negative-balance holding reduces the net figure and appears under
  liabilities.
- The breakdown by dimension sums to exactly the net-worth total, with
  no disclaimer needed.
- With one record deliberately corrupted, the view renders the rest and
  warns that 1 record could not be decrypted. With that record being a
  price entry, its symbol still prices from the neighboring entries.
- No network request is made when switching chart range, dimension,
  absolute/percentage mode, pricing mode, or band visibility.
- A holding named `<script>alert(1)</script>` renders as literal text
  in the list, the chart legend, and any tooltip — as does a dimension
  value labelled the same way.
