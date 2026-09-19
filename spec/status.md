# Status

Maintained by the product-owner agent: spec → compiled → implemented →
verified.

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
