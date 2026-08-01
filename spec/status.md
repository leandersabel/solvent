# Status

Maintained by the product-owner agent. Tracks each feature's progress
through the pipeline: spec written → compiled → implemented → verified.

| Feature | Spec | Compiled | Implemented | Verified |
|---|---|---|---|---|
| record-api | amended 2026-08-01 (AAD drops user_id) | | | |
| register | amended 2026-08-01 (single-phase, profile ids) | | | |
| login | amended 2026-08-01 | | | |
| account-settings | amended 2026-08-01 (dimension ids, archiving) | | | |
| manage-accounts | amended 2026-08-01 (dims map, tags gone, unit=symbol) | | | |
| record-snapshot | amended 2026-08-01 (editing, date moves, unit=symbol) | | | |
| rate-lookup | amended 2026-08-01 (providers resolved, unit=symbol) | | | |
| net-worth-view | amended 2026-08-01 (no Ambiguous band, no tags, no staleness) | | | |
| export-import | amended 2026-08-01 (re-key, main-currency note) | | | |
| admin-invites | amended 2026-08-01 (admin invites, CLI --force) | | | |

The seven decisions flagged as unconfirmed in `spec/questions.md` were
reviewed and confirmed on 2026-08-01; four carried amendments. A spec
review later the same day found two contradictions, four gaps, and six
smaller items; all twelve are now closed and recorded in that file. See
it for what changed and why.

## UI

Written 2026-08-01. `spec/ui/` holds `design-system.md` plus eleven screen
specs. Every feature above has a screen home **except `record-api`,
which is infrastructure and has no UI by design**. The compile gate is
cleared — contracts can carry `sourceFiles` for both halves of each
user-facing feature.

`record-api` is a dependency of every other feature and should be
compiled and built first.

## Gate before compiling

Per owner's call on 2026-08-01, **the open questions in
`spec/questions.md` are resolved before any code is written.**

**The gate is clear as of 2026-08-01 — `spec/questions.md` holds no open
questions.** The charting library was the last of the original set:
closed by benchmarking the candidates' shipped bundles and choosing none
of them, with the chart drawn directly in SVG. The same session settled
four connected chart decisions — interpolation over carry-forward, a
stacked area grouped by dimension, the structural bands, and how
archiving ends a band.

A review later that day reopened the gate briefly and closed it again
with twelve decisions: the AAD's `user_id` binding removed in favour of
re-keying on import, single-phase registration, admin invites plus a
`--force` CLI override, an account-detail screen owning snapshot
history, a dimensions screen with opaque immutable ids, the removal
of freeform tags, the unit doubling as an account's rate symbol, and
staleness warnings replaced by an update-values sweep.
All are recorded with their reasoning in `questions.md`.

**The review's findings are all closed.** Two contradictions, four gaps,
and six smaller items, settled the same day and recorded with their
reasoning in `questions.md`. `record-api` is a dependency of every other
feature and should be compiled and built first.

FX (Frankfurter) and gold (NBP) are closed, both 2026-08-01. Silver,
platinum, and palladium are deferred to a future version — hand-entered
rates against seeded symbols. Listed securities are out of scope
entirely as of 2026-08-01: brokerage holdings are depot-level accounts,
so no provider is needed. All three are scope decisions by owner's call,
not open questions.

| Screen | Spec |
|---|---|
| design-system | amended 2026-08-01 (neutral bands, warning non-text) |
| unlock | written 2026-08-01 |
| register | written 2026-08-01 |
| dashboard | amended 2026-08-01 (breakdown by dimension, no chip) |
| account-form | amended 2026-08-01 (one unit control, inline create, note) |
| account-detail | written 2026-08-01 |
| snapshot-entry | amended 2026-08-01 (edit mode, date moves, unit=symbol) |
| update-values | written 2026-08-01 |
| dimensions | written 2026-08-01 |
| settings | amended 2026-08-01 (links to dimensions) |
| export-import | amended 2026-08-01 (re-key wording) |
| admin | written 2026-08-01 |

The chart palette in `design-system.md` is validated (colorblind
separation, contrast, lightness band, chroma floor) against the
`#faf9f7` ground. Re-run the check if any hex changes.
