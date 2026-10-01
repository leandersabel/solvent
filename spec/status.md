# Status

Maintained by the compiler agent. Rows are in build order.

| Feature | Compiled | Implemented | Verified |
|---|---|---|---|
| app-shell | x | | |
| record-api | x | x | x |
| rate-lookup | x | x | x |
| admin-invites | x | | |
| register | x | x | x |
| login | x | x | x |
| account-settings | x | x | x |
| manage-accounts | x | x | x |
| record-rate | x | | |
| record-snapshot | x | | |
| net-worth-view | x | x | x |
| export-import | x | x | x |

Verified means every acceptance criterion in the feature file is
asserted.

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

`dependsOn` in each contract records coupling, which is many-to-many
and in places circular. Build order is stated here, not derived from
it.
