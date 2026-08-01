# Open questions

Maintained by the product-owner agent. When it can't resolve something
from the spec alone, it logs a question here instead of guessing. Answer
by editing the relevant spec file, then remove the question and
recompile.

**None open.**

## Decisions

An index of the load-bearing choices and the file that states each one
with its reasoning. The spec is the source; this table only points.

| Decision | Where |
|---|---|
| The AAD binds no user identifier | architecture.md, record-api.md |
| Import re-keys under a fresh DEK | export-import.md |
| Registration commits in one transaction | register.md |
| Admins come from an admin invite or the bootstrap CLI | admin-invites.md |
| Dimensions are the only taxonomy | manage-accounts.md |
| Dimension ids are opaque and immutable | account-settings.md |
| Deleting a dimension or value archives it | account-settings.md |
| An account holds at most one value per dimension | manage-accounts.md |
| An account's `unit` is its rate symbol | manage-accounts.md |
| Changing a unit is blocked once snapshots exist | manage-accounts.md |
| Brokerage holdings are depot-level; no equity provider | rate-lookup.md |
| FX from Frankfurter, gold from NBP; other metals by hand | rate-lookup.md |
| Rate requests carry a fixed base unit, never an amount | architecture.md |
| The trend chart is drawn in SVG, with no library | net-worth-view.md |
| Values interpolate between snapshots | net-worth-view.md |
| Archived accounts end at a closing snapshot | manage-accounts.md |
| Figure age is shown on the sweep, never as a warning | update-values.md |
| A snapshot's date is editable; a move writes before it deletes | record-snapshot.md |
| One snapshot per account per date | record-snapshot.md |
| Main currency is immutable outside import | account-settings.md |
| Idle lock is 5–60 minutes; sessions expire at 12 hours | account-settings.md |
| Username enumeration is accepted at registration, defended at login | register.md, login.md |
| There is no single-record `GET` | record-api.md |
| Schema migration is lazy, client-side, and writes nothing back | record-api.md |
