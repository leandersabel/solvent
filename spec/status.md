# Status

Maintained by the product-owner agent. Tracks each feature's progress
through the pipeline: spec written → compiled → implemented → verified.

| Feature | Spec | Compiled | Implemented | Verified |
|---|---|---|---|---|
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
screen specs; every feature above has a screen home. **The compile gate
is cleared** — contracts can now carry `sourceFiles` for both halves of
each feature.

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
