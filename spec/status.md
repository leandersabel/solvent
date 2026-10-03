# Status

Maintained by the compiler agent. Rows are in build order.

| Feature | Compiled | Implemented | Verified |
|---|---|---|---|
| app-shell | x | | |
| record-api | x | x | x |
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
| nightly-harness | x | | |

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

`nightly-harness` comes last because the prepared data is written
through every other feature's browser code and its stand-in answers the
sources `rate-lookup` calls. It has no product file, so `qa` has no
product criteria for it. `.github/workflows/nightly.yml` is the
client's, so its part of the contract reaches the client as a pull
request.

`dependsOn` in each contract records coupling, which is many-to-many
and in places circular. Build order is stated here, not derived from
it.
