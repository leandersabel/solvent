# Open questions

Maintained by the product-owner agent. When it can't resolve something
from the spec alone, it logs a question here instead of guessing. Answer
by editing the relevant spec file, then remove the question and
recompile.

**None open.**

## Decisions

An index of the load-bearing choices and the file that states each one
with its reasoning. The spec is the source; this table only points.
Grouped by subject, so a new decision joins its neighbours rather than
landing at the bottom. Paths are relative to `spec/`, because
`features/` and `ui/` each hold a `register.md` and an
`export-import.md`.

### Keys and crypto

| Decision | Where |
|---|---|
| Argon2id comes from `hash-wasm`, not libsodium.js | architecture.md |
| The AAD binds no user identifier | architecture.md, features/record-api.md |
| Import re-keys under a fresh DEK | features/export-import.md |

### Sessions and auth

| Decision | Where |
|---|---|
| Sessions are server-side rows; the cookie carries only a token | architecture.md |
| CSRF is a required custom header, and export requires it too | architecture.md |
| The idle lock discards decrypted state, not just the keys | features/login.md |
| Idle lock is 5–60 minutes; sessions expire at 12 hours | features/account-settings.md |
| Import invalidates every other session | features/export-import.md |
| Username enumeration is accepted at registration, defended at login | features/register.md, features/login.md |
| Registration commits in one transaction | features/register.md |
| Admins come from an admin invite or the bootstrap CLI | features/admin-invites.md |

### Record storage

| Decision | Where |
|---|---|
| There is no single-record `GET` | features/record-api.md |
| Schema migration is lazy, client-side, and writes nothing back | features/record-api.md |
| `accountId` is `null` on the wire, `""` only inside the AAD | features/record-api.md |
| Storage caps are contract parameters; rate limits are operator config | architecture.md |

### Data model

| Decision | Where |
|---|---|
| Dimensions are the only taxonomy | features/manage-accounts.md |
| An account holds at most one value per dimension | features/manage-accounts.md |
| Dimension ids are opaque and immutable | features/account-settings.md |
| Deleting a dimension or value archives it | features/account-settings.md |
| An account's `unit` is its rate symbol | features/manage-accounts.md |
| Changing a unit is blocked once snapshots exist | features/manage-accounts.md |
| Archived accounts end at a closing snapshot | features/manage-accounts.md |
| Main currency is immutable outside import | features/account-settings.md |
| One snapshot per account per date | features/record-snapshot.md |
| A snapshot's date is editable; a move writes before it deletes | features/record-snapshot.md |
| Decimal arithmetic is `BigInt` at scale 12, with no library | features/record-snapshot.md |

### Rates

| Decision | Where |
|---|---|
| FX from Frankfurter, gold from NBP; other metals by hand | features/rate-lookup.md |
| Brokerage holdings are depot-level; no equity provider | features/rate-lookup.md |
| Rate requests carry a fixed base unit, never an amount | architecture.md |
| The main-currency list is the provider-quotable set | features/register.md |
| Confirm's rate rule turns on whether the unit has a source | features/record-snapshot.md |
| Editing a snapshot never restamps its stored rate | features/record-snapshot.md |
| An edited rate stores the proposal it departed from | features/record-snapshot.md |

### Views

| Decision | Where |
|---|---|
| The trend chart is drawn in SVG, with no library | features/net-worth-view.md |
| Values interpolate between snapshots | features/net-worth-view.md |
| Figure age is shown on the sweep, never as a warning | ui/update-values.md |
| The app shell has three nav entries and a lock button | ui/design-system.md |
