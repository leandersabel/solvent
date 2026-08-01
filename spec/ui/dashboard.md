# Dashboard

## Purpose

The core payoff screen: what you are worth right now, how it got there,
and how it splits. Everything is computed client-side from decrypted
records — the server has nothing to template here.

Exercises: `spec/features/net-worth-view.md`. Links into
`account-form.md` and `snapshot-entry.md`.

## Layout

App shell: petrol-800 top bar with wordmark, nav (Dashboard, Accounts,
Settings, and Admin for admins), and a lock button. Content max-width
1200px on ground.

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
- A staleness chip if any account's latest snapshot is older than 90
  days: warning color, icon, and text "3 accounts not valued recently".
  Clicking filters the account list to them.

### 2. Trend chart

- **Step chart** — sparse snapshots make the series a step function, and
  a smoothed line would draw values nobody entered.
- Carried-forward segments render **lighter or dashed**; segments
  anchored by a real snapshot render solid. This distinction is
  load-bearing, not decorative.
- Range selector: 1M / 6M / 1Y / All, as a single row of text buttons
  above the chart. Default 1Y, or All when history is shorter.
- Crosshair with a tooltip on hover: date, total, and which accounts
  were carried forward at that point.
- Single series → **no legend box**; the section heading names it.
- Chart colors, mark specs, and the tooltip contract come from
  `design-system.md`.
- **Switching range or tag filter issues no network request.** The whole
  model is already in memory.

### 3. Accounts table

Columns: Name · Tags · Latest value (native unit) · In main currency ·
As of · (row action).

- Money columns right-aligned, `tabular-nums`.
- "As of" shows the snapshot date, with the warning chip inline when
  stale.
- Accounts with no snapshots are listed in a separate "Not yet valued"
  group below the table — **not shown as 0**, which is a real value
  meaning something different.
- Archived accounts are hidden by default behind a "Show archived"
  toggle; when shown they are dimmed with an "Archived" chip.
- Row click → account detail/edit (`account-form.md`). A primary
  "Record snapshot" action per row.

### 4. Breakdown by tag

- Horizontal bars, one per tag, sorted by value descending.
- **Every bar is chart slot 1** — these are nominal categories and the
  bar length already carries the value (`design-system.md`).
- Direct label on each bar: tag name and amount.
- Untagged accounts group under "Untagged".
- Directly beneath, always visible, not behind a tooltip: **"An account
  with several tags counts in every one of them, so these can add up to
  more than your total."** Presenting this as a pie chart of the whole
  would be a lie, so it is not a pie chart.

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
- **Error — some records failed to decrypt**: the view renders
  everything readable, with a **prominent, non-dismissible** critical
  banner: "N records could not be read." This is the AAD-binding
  tripwire firing (`architecture.md`, Data integrity) — it must never be
  swallowed or degrade to a console warning. Links to a detail list of
  the affected record ids.
- **Error — session expired mid-action**: prompt to re-unlock in place;
  never discard unsaved input.

## Rules

- Money arithmetic in decimal at full precision; rounded only for
  display.
- Every decrypted string — account name, tag, tooltip label — renders
  with `x-text`. An account named `<script>alert(1)</script>` appears as
  literal text in the table, the chart legend, and every tooltip.
- Large histories downsample **for display only**; totals always compute
  on the full data.
