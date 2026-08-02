# Status

Maintained by the product-owner agent: spec → compiled → implemented →
verified.

**Every feature and screen is spec'd and compiled.**

Rows are in build order.

| Feature | Compiled | Implemented | Verified |
|---|---|---|---|
| app-shell | x | | |
| record-api | x | | |
| rate-lookup | x | | |
| admin-invites | x | | |
| register | x | | |
| login | x | | |
| account-settings | x | | |
| manage-accounts | x | | |
| record-snapshot | x | | |
| net-worth-view | x | | |
| export-import | x | | |

`admin-invites` is built in two parts: the invite table and
`flask create-invite` come before `register`, which consumes an invite;
its `/api/admin/*` endpoints need a session, so they come after `login`.

`spec/ui/` holds `design-system.md` plus eleven screens: unlock,
register, dashboard, account-form, account-detail, snapshot-entry,
update-values, dimensions, settings, export-import, admin. Every feature
has a screen except `app-shell`, which renders the chrome around them,
and `record-api`, which is infrastructure.

`spec/questions.md` holds no open questions, so compiling can start.

Re-validate the chart palette in `design-system.md` if any hex changes.
