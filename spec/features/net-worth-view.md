# Net worth view

## What it does

The core payoff: current total net worth in the user's main currency,
per-account balances, grouping by dimension, and a stacked trend chart
over time. Every figure is computed client-side from decrypted records —
the server has nothing to template here, because it has no plaintext.

## Data flow

1. On unlock, fetch all three record types
   (`GET /api/records?type=account|snapshot|profile`) and decrypt them
   with the session DEK.
2. Build the model in memory: profile (main currency), accounts,
   snapshots grouped by `account_id` and sorted by date.
3. Compute totals and series locally. Subsequent writes update this
   model directly — no refetch on every save.

For the expected data volume (a household, manual snapshots, years of
history) fetching everything once per session is the right call: it is
simpler, and it means the server learns nothing from access patterns
about which account you are looking at.

## Current net worth

`total = Σ over active accounts of (latest snapshot.value × that
snapshot.rate)`

- **Latest** means the snapshot with the greatest `date`, not the most
  recently written.
- Each account contributes at its own snapshot's stored rate, so an
  account last valued in March uses March's rate. This is deliberate and
  must be surfaced: show each account's "as of" date wherever its figure
  appears.
- **There is no staleness threshold and no stale-account warning.** An
  earlier draft flagged any account not valued within a configurable
  number of days. It was removed because no single number fits a product
  built on uneven cadence — a current account moves monthly, unlisted
  property every few years — so the slow accounts sit permanently
  flagged until the warning is ignored, and then it fails for the
  account that genuinely went quiet. The age of each figure is instead
  stated in plain language on `ui/update-values.md`, next to the control
  that acts on it.
- **Archived accounts are excluded from the current total** — an
  archived account is a closed position. They remain in history up to
  their `archivedAt` date (see Trend chart).
- **An account with no snapshots contributes nothing** and is listed
  separately as "not yet valued" rather than shown as 0. Zero is a real
  value a user can record and means something different.
- Negative balances (mortgages, loans) subtract. Net worth is a signed
  sum, and the UI shows gross assets, gross liabilities, and the net
  figure separately.

## Trend chart

A **stacked area chart** over time: one band per group, the bands
summing to net worth. It answers two questions at once — how the total
moved, and what it was made of.

### Values between snapshots

Each account is **linearly interpolated between its own snapshots**,
each snapshot first converted to the main currency at its own stored
rate. Interpolation is per account and then summed — never interpolation
of an already-summed series, because accounts start at different dates
and summing first would smear one account's first snapshot across the
rest.

- An account contributes nothing to dates **before its first snapshot**
  — it is not backfilled with zero, which would show a false jump when
  a long-held account is first entered.
- After an account's last snapshot its value is **carried forward**.
  There is nothing to interpolate toward.
- Every stretch between two snapshots is **inferred, not recorded**. A
  "Show what's estimated" toggle marks it, and tick marks under the
  x-axis show where real snapshots exist. Default off.

Interpolation replaced carry-forward steps by owner's call on
2026-08-01, reversing the earlier decision. The reason is recorded in
`questions.md` so it is not re-litigated by inference: this chart exists
to show **trends**, not transactions. Real transfers are instant and
sharp-edged, but a decade of sparse snapshots drawn as steps is a field
of cliffs that reads worse than a curve. The literal version stays one
click away rather than being the default.

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

That interpolated run-down is inferred, and the estimated-data toggle
marks it as such. A user who wound a position down on one specific day
can record an intermediate snapshot and get the sharp edge honestly.
When the closing snapshot is skipped, the band still drops at
`archivedAt` and the UI marks the point as an archive, not a valuation.

Either way the drop carries an **annotation** on the x-axis and a
tooltip line naming the account, because an unexplained vertical edge in
an otherwise smooth chart is indistinguishable from a bad snapshot.

### Ranges and modes

- Ranges: 1M, 6M, 1Y, All. Default: 1Y, or All if history is shorter.
- **Absolute / percentage** toggle. The percentage view normalizes each
  side against itself — asset bands against total assets, liability
  bands against total liabilities — because a share of a signed net
  figure is meaningless when the net approaches zero.

## Inputs / outputs

- In: ciphertext records fetched from the API, decrypted with the
  session DEK.
- Out: current total, per-account balances with as-of dates, a
  breakdown by the selected dimension, trend series. Nothing computed
  here is ever sent back to the server.

## Rules

- All money arithmetic uses decimal, never floats (record-snapshot.md).
  Sums are computed at full precision and rounded only for display.
- Every decrypted string — account name, note, dimension and value
  label — is rendered with `x-text` / `textContent`. Never `x-html`,
  never a chart library that takes an HTML string for labels or tooltips
  (architecture.md, Application hardening).
- **The chart is drawn directly in SVG with no charting library**
  (owner's call, 2026-08-01 — see `questions.md`). The candidates were
  benchmarked rather than picked from memory; what a library would have
  supplied is a fraction of what this chart needs, and the parts it does
  not supply — the partition rule, per-account interpolation, provenance
  tracking, per-band selection deltas — are the bulk of the work.
  - Any library added later inherits the unchanged constraints:
    self-hosted with SRI, CSP-safe with no `eval` or `new Function`, no
    CDN (architecture.md, Supply chain), and text-only labels and
    tooltips.
  - SVG, not canvas: the direct labels, `tabular-nums` figures, and the
    accessible fallback below all need real DOM.
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
  last known value, with its "as of" date shown. It is the user's data:
  the UI states the age, it neither warns nor silently excludes.
- **Decryption fails for one record** → that record is skipped, the rest
  of the view renders, and a prominent warning names how many records
  could not be read. This is the AAD-binding tripwire firing
  (architecture.md, Data integrity) and must never be swallowed
  silently or crash the whole view.
- **A very large history** → the chart downsamples for display; totals
  are always computed on the full data.

## Acceptance criteria

- With three accounts in different units and known snapshots, the
  displayed total equals the hand-computed `Σ value × rate`, exactly, in
  decimal.
- Changing today's provider rate for a symbol does not change any
  historical chart point or the stored total for a past date.
- An account last valued in March shows an "as of March" marker and
  still contributes to the current total, with no warning attached at
  any age.
- A snapshot recorded in the future of the chart range does not appear
  before its date.
- An account contributes nothing to chart dates before its first
  snapshot; adding ten years of an old account's history does not create
  a step at the chart's left edge.
- An account with snapshots of 100 on 1 January and 200 on 1 March
  reads 150 on 1 February, and that stretch is marked as estimated when
  the toggle is on.
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
  no disclaimer needed — the property the old overlapping tag breakdown
  could not have.
- With one record deliberately corrupted, the view renders the rest and
  warns that 1 record could not be decrypted.
- No network request is made when switching chart range, dimension,
  absolute/percentage mode, or band visibility.
- An account named `<script>alert(1)</script>` renders as literal text
  in the list, the chart legend, and any tooltip — as does a dimension
  value labelled the same way.
