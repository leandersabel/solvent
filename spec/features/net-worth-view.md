# Net worth view

## What it does

The core payoff: current total net worth in the user's main currency,
per-account balances, grouping and slicing by tag, and a trend chart
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
  must be surfaced: show each account's "as of" date, and flag any
  account whose latest snapshot is older than a configurable staleness
  threshold (default 90 days).
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

For each point on the x-axis, each account contributes its **latest
snapshot at or before that date**, converted at that snapshot's own
stored rate. Values are carried forward, not linearly interpolated —
between two snapshots you know the last recorded value, and drawing a
smooth line between them would invent data the user never entered.
Carried-forward segments are rendered visually distinct (lighter or
dashed) from segments anchored by an actual snapshot.

- An account contributes nothing to dates **before its first snapshot**
  — it is not backfilled with zero, which would show a false jump when
  a long-held account is first entered.
- An archived account contributes nothing **after `archivedAt`**. The
  archive flow offers a closing snapshot at that date
  (manage-accounts.md) so the resulting step is a recorded value rather
  than an unexplained drop; when it was skipped, the chart still drops
  and the UI marks the point as an archive, not a valuation.
- Ranges: 1M, 6M, 1Y, All. Default: 1Y, or All if history is shorter.
- Because sparse snapshots make the series a step function, the chart is
  a step or area chart, not a smoothed line.

## Breakdown by tag

- Filter or group by any tag from the client-derived tag union.
- **An account with multiple tags counts in every one of its groups**,
  so group subtotals can exceed the overall total. The UI must state
  this where subtotals are shown; presenting them as a pie chart of the
  whole would be a lie.
- Untagged accounts group under "Untagged".

## Inputs / outputs

- In: ciphertext records fetched from the API, decrypted with the
  session DEK.
- Out: current total, per-account balances with as-of dates, per-tag
  breakdown, trend series. Nothing computed here is ever sent back to
  the server.

## Rules

- All money arithmetic uses decimal, never floats (record-snapshot.md).
  Sums are computed at full precision and rounded only for display.
- Every decrypted string — account name, tag, note — is rendered with
  `x-text` / `textContent`. Never `x-html`, never a chart library that
  takes an HTML string for labels or tooltips (architecture.md,
  Application hardening).
- The charting library must be self-hosted with SRI and CSP-safe — no
  `eval`, no CDN (architecture.md, Supply chain).
- Formatting follows the main currency's conventions; asset units
  (troy oz, shares) keep their own precision in per-account views.

## Edge cases

- **No accounts** → empty state pointing at "Add your first account."
- **Accounts but no snapshots** → accounts listed as "not yet valued,"
  total shown as "—" rather than 0, no chart.
- **One snapshot total** → the chart shows a single point rather than
  failing or drawing a flat line back to the beginning of time.
- **All accounts archived** → total is "—", history still renders.
- **A stale account** (no snapshot in >90 days) → flagged inline, and
  counted in the total anyway. It is the user's data; the UI warns, it
  does not silently exclude.
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
  still contributes to the current total.
- A snapshot recorded in the future of the chart range does not appear
  before its date.
- An account contributes nothing to chart dates before its first
  snapshot; adding ten years of an old account's history does not create
  a step at the chart's left edge.
- Archiving an account removes it from the current total, leaves every
  chart point before `archivedAt` unchanged, and drops it after.
- An account with no snapshots is listed as "not yet valued" and is not
  counted as 0.
- A negative-balance account reduces the net figure and appears under
  liabilities.
- Tag subtotals for an account tagged `cash` and `liquid` include it in
  both, and the UI shows the overlap caveat.
- With one record deliberately corrupted, the view renders the rest and
  warns that 1 record could not be decrypted.
- No network request is made when switching chart range or tag filter.
- An account named `<script>alert(1)</script>` renders as literal text
  in the list, the chart legend, and any tooltip.
