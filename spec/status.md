# Status

Maintained by the compiler agent: spec, compiled, implemented, verified.

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
| record-rate | x | | |
| record-snapshot | x | | |
| net-worth-view | x | | |
| export-import | x | | |

`admin-invites` comes before `register` because registration consumes
an invite, and the invite table and `flask create-invite` are what
produce one. Its `/api/admin/*` endpoints need a session, so they
follow `login`.

`rate-lookup` comes before `register` for the same kind of reason: the
main-currency picker is the currency half of the symbol table. The
proxy and the symbol-table admin routes need a session, so they follow
`login` too.

`record-rate` sits between `manage-accounts` and `record-snapshot`. It
reads the unit of every active account and the main currency in the
profile record, and takes its proposals from `rate-lookup`, while
`record-snapshot`'s write path and `net-worth-view`'s pricing both read
the series it writes.

`dependsOn` in each contract is the coupling as it stands, which is
many-to-many and in places circular. Build order is stated here and is
not derived from it.
