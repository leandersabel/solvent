# Status

Maintained by the product-owner agent. Tracks each feature's progress
through the pipeline: spec written → compiled → implemented → verified.

| Feature | Spec | Compiled | Implemented | Verified |
|---|---|---|---|---|
| record-api | written 2026-08-01 | | | |
| register | written 2026-08-01 | | | |
| login | amended 2026-08-01 | | | |
| account-settings | amended 2026-08-01 | | | |
| manage-accounts | amended 2026-08-01 | | | |
| record-snapshot | amended 2026-08-01 | | | |
| rate-lookup | written 2026-08-01 (provider open) | | | |
| net-worth-view | amended 2026-08-01 | | | |
| export-import | written 2026-08-01 | | | |
| admin-invites | written 2026-08-01 | | | |

The seven decisions flagged as unconfirmed in `spec/questions.md` were
reviewed and confirmed on 2026-08-01; four carried amendments, marked
above. See that file for what changed and why.

## UI

Written 2026-08-01. `spec/ui/` holds `design-system.md` plus eight
screen specs. Every feature above has a screen home **except
`record-api`, which is infrastructure and has no UI by design**. The
compile gate is cleared — contracts can carry `sourceFiles` for both
halves of each user-facing feature.

`record-api` is a dependency of every other feature and should be
compiled and built first.

## Gate before compiling

Per owner's call on 2026-08-01, **both open questions in
`spec/questions.md` are resolved before any code is written** — the
conversion-rate provider and the charting library. Do not run the
product-owner agent until they are closed; compiling now would produce
contracts with `openQuestions` on two features and require a second
pass.

| Screen | Spec |
|---|---|
| design-system | written 2026-08-01 |
| unlock | written 2026-08-01 |
| register | written 2026-08-01 |
| dashboard | written 2026-08-01 |
| account-form | written 2026-08-01 |
| snapshot-entry | written 2026-08-01 |
| settings | written 2026-08-01 |
| export-import | written 2026-08-01 |
| admin | written 2026-08-01 |

The chart palette in `design-system.md` is validated (colorblind
separation, contrast, lightness band, chroma floor) against the
`#faf9f7` ground. Re-run the check if any hex changes.
