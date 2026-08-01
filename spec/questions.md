# Open questions

Maintained by the product-owner agent. When it can't resolve something
from the spec alone, it logs a question here instead of guessing.
Answer by editing the relevant spec file, then remove the question and
recompile.

## Conversion-rate provider(s) (spec/architecture.md, Data model)

Need a provider (or providers) covering FX rates, gold/metals, and stock
prices for the entry-date rate "proposal." Owner has flagged this needs
hands-on testing/evaluation before deciding — not resolvable from the
spec alone. Once chosen, update the "Conversion-rate lookup" note in
Data model, and the symbol-table format in
`spec/features/rate-lookup.md`.

Blocks: `rate-lookup` acceptance criteria are provider-independent and
can be implemented against a stubbed provider, so this does not block
starting the feature — only shipping it.

## Charting library (spec/features/net-worth-view.md)

Needs to be self-hosted, CSP-safe with no `eval`, able to render a step
chart, and take label/tooltip text without an HTML string. Not chosen.
Candidates worth benchmarking against those constraints rather than
picking from memory.

## UI screens not yet specified (spec/ui/)

`spec/ui/` holds only its README — no screen specs exist. Features
reference screens (registration, unlock, dashboard, account form,
snapshot entry, settings, admin) but nothing defines their layout,
states, or which feature each exercises. Needed before compiling, or
each contract's `sourceFiles` will cover only half its sources.

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
