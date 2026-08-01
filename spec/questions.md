# Open questions

Maintained by the product-owner agent. When it can't resolve something
from the spec alone, it logs a question here instead of guessing.
Answer by editing the relevant spec file, then remove the question and
recompile.

## Conversion-rate provider: metals and equities (spec/features/rate-lookup.md)

**FX is resolved** — Frankfurter's public instance, decided 2026-08-01;
see `rate-lookup.md`, Providers, and `architecture.md`, Data model.

Still needed: a source for **gold/metals** and for **listed equities**.
Two criteria matter more than price, because volume here is trivial:

1. **Historical lookup by date.** Snapshots are routinely backfilled and
   the weekend/holiday path needs dated queries. Current-rate-only
   endpoints are common on free tiers and useless here.
2. **Permission to cache indefinitely.** `rate-lookup.md` caches past
   rates forever. Several commercial APIs forbid storing or
   redistributing their data, which would put that cache in breach.
   Check the terms for storage, not just for request volume.

Candidates worth hands-on evaluation: LBMA fixings or Nasdaq Data Link
for gold; Tiingo or Alpha Vantage for equities; Twelve Data if one
provider covering both is worth more than best-in-class per class.

Each provider chosen adds one server-side host constant, one adapter,
and its entries in the symbol table served by `GET /api/rates/symbols`.

Blocks: `rate-lookup` acceptance criteria are provider-independent and
can be implemented against a stub, so this does not block starting the
feature — only shipping it. **Owner's call (2026-08-01): resolve before
any code is written anyway**, so the pipeline compiles once against a
complete spec rather than twice.

## Charting library (spec/features/net-worth-view.md)

Not chosen. Must be benchmarked against these constraints rather than
picked from memory — the full set, now that the UI is specified:

- Self-hosted with an SRI hash, no CDN (architecture.md, Supply chain).
- CSP-safe: no `eval`, no `new Function` (architecture.md, Application
  hardening).
- Renders a **step** chart, with per-segment styling — carried-forward
  segments must be visually distinct from snapshot-anchored ones
  (ui/dashboard.md). This is the constraint most libraries fail.
- Takes label and tooltip text as **text, never an HTML string**.
- Crosshair tooltip on hover, downsampling for large series.
- Accepts an explicit categorical palette (ui/design-system.md) rather
  than imposing its own.

Writing the step chart directly in SVG is a legitimate outcome of this
evaluation, not a fallback — the requirements above are most of what a
charting library would be brought in to provide.

**Owner's call (2026-08-01): resolve before writing code.** Both open
questions are gating the compile, not just the ship.

## Confirmed decisions (2026-08-01)

All seven previously-unconfirmed decisions were reviewed and confirmed.
Kept here as a record of what was deliberately chosen, so nothing gets
re-litigated by inference downstream. Four were amended in the process:

- **Carry-forward, not interpolation** (net-worth-view.md). Confirmed
  unchanged. A straight line between two sparse snapshots draws data the
  user never entered.
- **Import re-encrypts client-side** rather than restoring blobs
  verbatim (export-import.md). Confirmed unchanged — forced by AAD
  binding `user_id`; a verbatim restore yields a vault that opens and
  then decrypts nothing. Import therefore needs the export file's
  password, not the current one.
- **Username enumeration accepted at registration**, defended at login
  (register.md). Confirmed unchanged. The endpoint is invite-gated; the
  worst case is an invited household member learning who else has an
  account.
- **Changing an account's unit is blocked once it has snapshots**
  (manage-accounts.md). Rule confirmed; **amended** — the old acceptance
  criterion promised the server would reject a forced change, which it
  cannot do, since `unit` is inside the ciphertext. Now stated as
  client-enforced by construction, like the password policy.
- **Main currency is immutable in v1** (account-settings.md). Confirmed;
  **amended** — snapshots now carry `rateTarget` (record-snapshot.md)
  naming the currency their rate converts into. Redundant today, and it
  keeps a changeable main currency from becoming a migration over
  ambiguous historical rates.
- **Archived accounts leave the current total**, stay in history to
  `archivedAt` (net-worth-view.md). Confirmed; **amended** — the archive
  dialog now offers a closing snapshot at `archivedAt`, prefilled `0` and
  skippable (manage-accounts.md). Without it the chart drops by the last
  known value with nothing recorded to explain it, which is the same
  objection that rules out interpolation.
- **Idle lock, absolute session expiry at 12 hours** (login.md,
  account-settings.md). Expiry confirmed unchanged; idle lock
  **amended** — now user-configurable 5–60 minutes, default 15, stored
  as `idleLockMinutes` in the encrypted profile record. Re-unlock costs
  a full Argon2id derivation, so a fixed 15 minutes taxes long sessions;
  but the idle lock defends the walk-up threat, so it cannot be
  disabled.
