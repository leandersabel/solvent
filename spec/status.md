# Status

Maintained by the product-owner agent: spec → compiled → implemented →
verified.

**Every feature and screen is spec'd. Nothing is compiled.**

Build `record-api` first — every other feature depends on it.

| Feature | Compiled | Implemented | Verified |
|---|---|---|---|
| record-api | | | |
| register | | | |
| login | | | |
| account-settings | | | |
| manage-accounts | | | |
| record-snapshot | | | |
| rate-lookup | | | |
| net-worth-view | | | |
| export-import | | | |
| admin-invites | | | |

`spec/ui/` holds `design-system.md` plus eleven screens: unlock,
register, dashboard, account-form, account-detail, snapshot-entry,
update-values, dimensions, settings, export-import, admin. Every feature
has a screen except `record-api`, which is infrastructure.

`spec/questions.md` holds no open questions, so compiling can start.

Re-validate the chart palette in `design-system.md` if any hex changes.
