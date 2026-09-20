# Architecture

## What Solvent is

A net worth tracker, self-hosted on the owner's own NAS.

- **Vault owners**: a small number of accounts (e.g. household
  members), not open to the public. Each has a separate vault: own
  password → own encryption key, nothing shared or visible between
  them. No shared/household view.
- **Administrators**: accounts that provision and remove other
  accounts and own no vault at all. A separate kind of account rather
  than a capability on a vault owner, so one person doing both jobs
  holds two accounts with two passwords. Several may exist at once.
  See Data model, Accounts on this instance.

## Components

- **App shell** (server-rendered): Flask + Jinja2 + htmx. Navigation,
  login/registration, layout. Never handles plaintext financial data.
- **Data layer** (client-side): vanilla-JS/Alpine.js. Derives keys,
  decrypts blobs fetched from the API, renders balances/charts, encrypts
  new entries before sending them.
- **API**: Flask JSON endpoints, Pydantic-validated. Auth (Auth Key
  verification), ciphertext blob storage/retrieval, and a conversion-rate
  proxy/cache (public reference data only, no plaintext ever passes
  through it).
- **Database**: SQLite. Stores every account's credential row (salt,
  KDF envelope, Auth Key hash), each vault's DEK wrappers, and its
  ciphertext blobs. See Storage under Tech stack.
- **Build/deploy pipeline**: GitHub Actions + Dependabot → GHCR → manual
  pull on TrueNAS. See CI/CD under Tech stack.
- **Admin panel**: account provisioning is invite-only. An
  administrator generates an invite link naming the kind of account it
  creates, and registration requires a valid, unused invite. There is
  no self-service sign-up. The panel is also where instance-wide
  platform configuration lives, such as the symbol table
  (rate-lookup.md). Reachable only by an administrator session, which
  holds no key material of any kind.
- **Export/Import**: user-initiated export of a vault (ciphertext blobs
  plus the password credential's wrapper) to a local file, still fully
  encrypted, so it exposes nothing without the password. It is the
  personal backup and the migration path across data-model upgrades,
  distinct from the NAS-level ZFS backups, which are disaster recovery
  and not schema migration. Import restores a vault from one.

## Data model

All entity content below (names, notes, classifications, values) is
encrypted client-side
per the Security model — the server sees ciphertext, not these fields.

- **Vault owner**: has one **main currency** — the currency every
  holding normalizes into for the total net-worth figure.
- **Account**: a holding, virtual (bank, brokerage, crypto exchange) or
  physical (gold, real estate, collectibles). Has a name, a native unit,
  a free-text **note**, and one **dimension assignment** per configured
  dimension. The unit is either a symbol from the operator's rate table
  (`USD`, `XAU-ozt`) or free text for something with no market price
  (`m²`) — and it **doubles as the holding's rate symbol**, so a holding
  can never be measured in one unit and priced in another.
  Some holdings (private equity, a private loan, unlisted real estate)
  have no public price or rate source, so the price for their unit is
  entered by hand rather than proposed.
- **Brokerage holdings are recorded at depot level**, not per position:
  one holding whose native unit is the depot's reporting currency, and
  whose snapshot value is the total the broker reports — the same act as
  updating a bank account. A depot is therefore an ordinary currency
  holding: a foreign-currency depot converts through the same FX path as
  a foreign-currency bank account, and one reporting in the main
  currency needs no rate at all. See Non-goals.
- **Dimension**: a named axis a holding is classified along —
  "Liquidity" with values "Cash", "Retirement", and so on. A holding
  carries **at most one value per dimension, structurally**: the
  `account` record's `dims` is a map from dimension id to value id, so a
  second value for one dimension cannot be expressed at all. That
  partition is what lets the stacked trend chart's bands sum to net
  worth (net-worth-view.md).
  - Dimensions and their values are identified by **short opaque ids
    generated at creation**, never by their display labels. Labels are
    therefore free text in any script, and renaming one rewrites no
    `account` record — only the profile. Ids also cannot collide with
    anything a user typed, which a label-derived key could.
  - The set of dimensions, their labels, and their value order is user
    configuration in the encrypted profile record (account-settings.md).
- **There is no freeform tag.** Every classification is a dimension,
  because an overlapping label is just a dimension with one value
  ("Emergency fund: yes", absence meaning no). Two taxonomies over the
  same holdings would mean two ways to spell one thing, and only one of
  them can be stacked, ordered, or summed honestly.
- **Quantities and prices are two separate timelines.** A holding's own
  history holds only the quantities its owner recorded. The prices that
  turn those quantities into the main currency are their own series, one
  per symbol, shared by every holding measured in it. The split is what
  stops a holding from being priced at the day it was last touched,
  which with partial updates is most holdings most of the time.
  - **Snapshot**: a point-in-time quantity for one holding, a date and a
    value in the holding's native unit, and nothing else
    (record-snapshot.md).
  - **Rate**: what one unit of a symbol was worth in the main currency
    on one date (record-rate.md). Proposed by the lookup proxy where a
    source exists, always overridable, and stored permanently once
    written, because a price recomputed later would rewrite what the
    person was worth in 2019.
  - **Recording anything refreshes every price.** Record one franc
    holding and the dollar rate and the gold price still get entries.
    Prices are written by default and quantities are not: a quantity has
    to be read off a statement, so the app never writes one nobody
    gathered, while a price needs no gathering.
  - **A recording is a date, not a stored thing.** Everything recorded
    at one date, quantities and prices together, is reopened and
    edited as one act, and it is a client-side grouping of records by
    their own `date` field. There is no fifth record type and no
    grouping record, because one could disagree with the records it
    claims to group. Creating a recording and reopening one are
    distinct acts, and a create at a date that already holds records
    fails rather than merging into it (record-snapshot.md).
  - Today's total is each holding's last recorded quantity at the most
    recent price for its unit.
- Updates are sparse by design: no holding needs a snapshot on every
  date. The UI carries the last known quantity forward when charting net
  worth over time, and prices it from the price timeline at each date.

### Accounts on this instance

Every account on the instance is a row of `principals`, and its `kind`
is fixed when the row is written. There is no promotion and no
demotion, and no endpoint writes `kind` after the insert
(admin-invites.md).

| Column | Visibility | Notes |
|---|---|---|
| `id` | plaintext | opaque server-generated handle, returned to no client |
| `username` | plaintext | normalized, unique across both kinds |
| `kind` | plaintext | `vault_owner` \| `administrator`, `CHECK`-constrained |
| `created_at` | plaintext | server clock |
| `last_login_at` | plaintext | server clock, rewritten on each successful login |

- A **vault owner** owns a vault: a DEK, records, a profile, an export.
- An **administrator** owns none of that. No DEK, no wrapper, no
  records, nothing encrypted and nothing to unlock. This is the point
  of the separation: "an administrator cannot read a vault" becomes a
  property of what their row can be joined to, rather than a check
  every new admin feature has to pass.
- One person holding both kinds holds **two principals, two usernames,
  two passwords**, and **nothing in the schema links them**. A link
  would be a stored claim that some administrator owns some vault, and
  the first feature to read it would be the one that crosses the
  boundary admin-invites.md draws.

**One username space across both kinds.** `username` is unique over the
whole table, so a username resolves to exactly one principal of exactly
one kind. Separate namespaces would let one username name a vault
owner and an administrator at once, and the pre-authentication step
would have to ask an unauthenticated caller which it means, handing out
an account's kind before anyone has proven anything. That is the oracle
Login enumeration exists to close. One space costs the operator a naming
convention for the two accounts of one person, and buys a login flow
that never branches on kind before it has verified a credential.

Every column above means something for both kinds, which is what makes
one table right here. The columns that would not, meaning salt, KDF
envelope, verifier and wrapped DEK, are on this table for neither.

### Credentials and vault key wrappers

Two facts with two existence conditions, so two tables.

**Every principal has exactly one credential.** It is what
authenticates them, and an administrator has one exactly as a vault
owner does.

**Only a vault owner has a wrapper.** A vault has one data encryption
key, wrapped independently by one or more credentials, one row each.
The DEK itself never changes, so adding or removing a wrapper
re-encrypts nothing. Key management holds the cryptographic rules.
These are the row shapes.

`credentials`:

| Column | Visibility | Notes |
|---|---|---|
| `id` | plaintext | opaque server-generated handle |
| `principal_id` | plaintext | `ON DELETE CASCADE` from `principals` |
| `method` | plaintext | `password`. The only value any endpoint accepts |
| `params` | plaintext | method-specific JSON, shape keyed on `method`. For `password`: `{ salt, kdf }` |
| `verifier` | opaque | what the server checks an authenticator against. For `password`: the Argon2id hash of the Auth Key |
| `created_at` | plaintext | server clock |

`dek_wrappers`:

| Column | Visibility | Notes |
|---|---|---|
| `credential_id` | plaintext | primary key, `ON DELETE CASCADE` from `credentials` |
| `wrapped_dek` | opaque | the vault's DEK under this credential's wrapping key, AES-256-GCM |
| `dek_nonce` | plaintext | fresh 96-bit random per wrap |
| `created_at` | plaintext | server clock |

**Why two tables rather than one with an empty wrapper.** One table
would leave `wrapped_dek` and `dek_nonce` permanently empty on every
administrator row, carrying the load-bearing statement "this account
has no vault" with nothing enforcing it. Split, that statement is the
absence of a row, which a foreign key and a primary key enforce between
them, and every column of every row means something. Authenticating and
unwrapping a key are also different jobs: an administrator's credential
is an authenticator that is the source of no wrapping key. A passkey
credential would be the mirror case, a wrapping-key source whose
`verifier` holds a credential public key and no Auth Key, and it fits
these two tables unchanged.

What stays on the credential is the **salt and the KDF envelope**, in
`params`. They belong beside the verifier, which was computed over a
value derived from them, and they are what the pre-authentication step
hands out on its own. The wrapper comes out of the same password and is
still a separate fact: the one a vault owner has and an administrator
does not.

**`params` is public and `verifier` is secret, and that is the line
between them.** `params` holds exactly what a caller needs *before* it
can authenticate, so the pre-authentication step hands it to an
unauthenticated caller (login.md, salt fetch) and nothing secret may
ever be placed in it. `verifier` is returned by no endpoint. A second
method's fields follow the same split: a passkey method would carry its
credential id and PRF salt in `params` and its credential public key in
`verifier`, with no Auth Key anywhere.

`params` is one JSON column rather than a column per field because that
is what lets a second method's fields differ without a schema change.
The server validates it as a union discriminated on `method`, so an
unparseable or wrong-shaped `params` is a Bad Request, not a row that
sits in the table until someone tries to log in with it.

One constraint falls out of that for any future method: its
pre-authentication step needs its own decoy treatment matching the
salt fetch's, or it reintroduces the enumeration oracle login.md
closes.

- **Exactly one `password` credential per principal, always.** Enforced
  by a unique index on `principal_id` restricted to `method =
  'password'`, written in the same transaction as the principal row,
  and removed by nothing except deleting the account. For a vault owner
  the reason is export: an export file carries the password
  credential's wrapper and no other (export-import.md), because a
  wrapper bound to an authenticator cannot travel to another machine. A
  vault with no password credential therefore has no openable export,
  which is this product's only backup and migration path (see
  Components). For an administrator it is the only way in. A second
  method is additive, never a replacement.
- **v1 implements the password method and nothing else.** There are no
  passkey endpoints, no passkey UI, and no `method` value other than
  `password` is accepted anywhere. The row shapes above are the whole
  of what v1 owes a future second method: they admit one without a
  migration. Do not build one now.
- **The schema refuses a vault row attached to an administrator.** A
  `records` insert and a `dek_wrappers` insert each read the
  principal's `kind` and abort on `administrator`. Two triggers, named
  in app-shell.md, Database, because SQLite's `CHECK` cannot reach
  another table and this guarantee is worth more than two statements.
  `register.md` owns `principals` and `credentials`.

### Record storage API

`account`, `snapshot`, `rate` and `profile` records are all stored
through one generic record endpoint. The server has no per-type logic,
because it cannot read any type. A record row is:

| Column | Visibility | Notes |
|---|---|---|
| `principal_id` | plaintext | the owning vault owner; every query is scoped to the session's principal |
| `record_id` | plaintext | client-generated UUIDv4 |
| `record_type` | plaintext | `account` \| `snapshot` \| `rate` \| `profile` |
| `account_id` | plaintext | the owning `account` record for `snapshot`; empty otherwise |
| `schema_version` | plaintext | bumped when the plaintext shape changes |
| `version` | plaintext | monotonic, starts at 1, +1 per write |
| `nonce` | plaintext | fresh 96-bit random per encryption |
| `ciphertext` | opaque | AES-256-GCM under the DEK |
| `updated_at` | plaintext | server clock, for debugging |

The columns `record_id`, `record_type`, `account_id`, `schema_version`
and `version` are exactly the AAD, so the server cannot move a blob to
a different slot within a vault without breaking decryption.
`principal_id` is **not** part of the AAD: cross-vault relocation is
already impossible under the DEK boundary. See Key management for
both.

The plaintext columns are **metadata the server can see**: record
counts, which snapshots belong to which `account` record, and write
timestamps.
That is within the accepted metadata leak in the threat model — the
plaintext shape deliberately carries no name, value, date, or unit.

**A `rate` record adds no column.** It is owned by a symbol rather than
an `account`, and the symbol is the one thing a column here would leak, so
it stays inside the ciphertext and `account_id` is empty like an
`account` or a `profile`. record-rate.md argues that against the threat
model, and record-api.md pins the column rule. Its AAD encoding is the
same as every other type's.

Endpoints (all authenticated as a vault owner, all CSRF-protected on
writes). An administrator session reaches none of them: the record
store is part of the vault surface, and a request to it from an
administrator is Not Found (app-shell.md, The two surfaces), because
that account has no vault for the query to be scoped to.

- `GET /api/records?type=<t>` — all of the user's records of a type.
- `PUT /api/records/<record_id>` — create or update. The client sends
  the expected current `version`; the server rejects with Conflict if it
  differs, so a stale tab cannot silently clobber a newer write.
- `DELETE /api/records/<record_id>` — delete one record.

The server never accepts a `principal_id` from the client; it is
always taken from the session.

**Conversion-rate lookup**: a server-side proxy/cache endpoint fetches
rates (FX, gold) from a public API and serves the entry-date "proposal"
to the client. Chosen over a direct client-side fetch: requests get
cached, and no browser individually leaks update timing to a third
party.
- **Privacy scope**: the proxy observes a date and the user's main
  currency, never the amount held and never which symbols they hold.
  **The client asks for the whole quotable table rather than naming
  symbols** (`rate-lookup.md`, The client never names a symbol): since
  recording anything refreshes every price, a per-symbol fan-out would
  hand the server a repeating list of one person's holdings. Asset
  *type* is not confidential in itself (knowing someone holds gold or
  dollars reveals nothing sensitive), but a complete list on a schedule
  is a profile, and the whole-table form costs nothing to avoid it. The
  *amount* is what the zero-knowledge model protects, and that never
  reaches the proxy or server in any form.
  - This includes the user's **main currency**, which travels as the
    `quote` parameter on every lookup. It is stored only inside the
    encrypted profile record, never as a plaintext column — but the
    server learns it in the ordinary course of serving proposals. That
    falls under the same accepted leak as asset type.
- **Base-amount rule (hard requirement)**: every rate request queries the
  rate for a fixed, reasonable base unit (e.g. "price of 1 troy oz", a
  unit currency pair) — never a holding's actual snapshot value. This
  keeps amounts out of the request entirely; enforce it client-side as a
  requirement, not an incidental property of the API shape.
- **SSRF hardening**: the outbound request's host/provider is never
  client-influenced — providers and endpoints are server-side
  whitelisted, symbols are validated against a strict allowlist/regex
  before use, redirects are disabled, and egress has a timeout. This
  matters because the proxy runs in an environment with reachable
  internal NAS services.
- **Providers**: FX from Frankfurter's public instance, gold from
  Narodowy Bank Polski's. Both are keyless, quota-free public services
  from central-bank data, so each is one host constant to unwind if it
  has to change. Silver, platinum and palladium have no provider in v1
  and are entered by hand, and listed securities have none by design,
  because a brokerage holding is recorded at depot level in a currency.
  `rate-lookup.md` holds the adapters, the seeded symbol table, and the
  rejected alternatives with the reason each fails.
- **One constraint binds every future provider**: a rate is stored
  permanently as a vault record, inside user ciphertext the server
  cannot read, enumerate, or delete. Terms requiring deletion of all data on
  termination are therefore unsatisfiable by construction, not a
  cache-policy problem a shorter TTL could fix. This is a hard
  criterion, and it is what rules out the technically ideal feeds.

## Status codes

Every endpoint answers from this set, and every spec file names the
status rather than its number. The numbers live here alone, so a
contract pins one value and prose stays readable.

| Name | Code | Answered when |
|---|---|---|
| OK | 200 | the request succeeded and carries a body |
| No Content | 204 | the request was valid and there is nothing to return — a rate with no proposal available, never an error |
| Bad Request | 400 | input is malformed, out of range, or names something the caller may safely learn does not exist |
| Unauthorized | 401 | no valid session |
| Forbidden | 403 | the required `X-Solvent-Request` header is absent (Application hardening) |
| Not Found | 404 | the target does not exist, **or** exists but belongs to someone else, **or** is a route the caller must not learn exists |
| Conflict | 409 | the write lost an optimistic-concurrency check, or the target's state forbids it |
| Content Too Large | 413 | a storage cap would be exceeded (Storage & data handling) |
| Too Many Requests | 429 | a rate limit engaged (Application hardening) |
| Server Error | 500 | an unhandled failure. Never a designed answer; it appears in this spec only where a test stubs one |

Not Found's conditions are indistinguishable by construction rather
than by convention. Splitting them would answer the question the
attacker is asking: whether an id, an account, or an admin route
exists.

## Tech stack

- **Deployment**: self-hosted on TrueNAS SCALE via Apps → Custom App
  (Docker-based, managed through TrueNAS's Apps UI — not the experimental
  Instances/LXC feature). TrueNAS pulls the image from a private GHCR
  (GitHub Container Registry) repo.
- **Base image**: `python:3.13-slim` (Debian-based Docker Official Image),
  pinned by digest. Chosen over alpine/distroless/Chainguard for broadest
  pip wheel compatibility and the largest maintained-image audience;
  revisit for a smaller attack surface once dependencies stabilize.
- **Container hardening**: runs as non-root, read-only root filesystem
  with an explicit writable volume for the SQLite DB, minimal Linux
  capabilities. Secrets (Flask `SECRET_KEY`, any provider API key) are
  injected via the TrueNAS app's environment config — never baked into
  the image or committed to the repo.
- **CI/CD & updates**: Dependabot tracks the Dockerfile's `FROM` digest and
  Python (`pip`) dependencies. Each PR triggers a GitHub Actions build+test;
  on merge, Actions builds the image and pushes it to GHCR. A weekly
  scheduled workflow rebuilds the image to catch upstream base-image
  security patches even without a dependency bump, opening a PR if the
  digest changed. Patch-level PRs may auto-merge after CI passes;
  minor/major bumps need manual review. Dependencies touching crypto or
  auth (`argon2id`, Alpine, anything in the auth/session path) are
  excluded from auto-merge regardless of bump level and always need
  manual review. Actions workflows run with least-privilege
  `permissions:` blocks, pin third-party actions by commit SHA, and use
  `pull_request` (never `pull_request_target`) so fork-triggered runs
  can't reach GHCR push secrets. Images are signed at push (cosign/
  sigstore) with an SBOM generated per build, so a pull can verify
  provenance beyond "the digest I was told." TrueNAS has no auto-pull for
  Custom Apps yet — it surfaces "update available" in the Apps UI, and you
  apply it by hand.
- **Backend language**: Python.
- **Backend framework**: Flask, over FastAPI/Django. The app is small with
  no external API consumers, so FastAPI's async/auto-docs strengths don't
  pay for their ceremony, and Django's batteries (admin, settings,
  migrations) are more structure than needed. JSON endpoints that
  store/return ciphertext blobs (IV, nonce, tag, wrapped DEK) use Pydantic for
  validation, added directly into Flask rather than adopting FastAPI for
  that one benefit.
- **WSGI server**: gunicorn, serving `app:app`. Flask's built-in
  server is single-threaded and explicitly not for deployment, and
  gunicorn is the sync-worker default for a Flask app with no async
  code. Its worker heartbeat needs a writable directory, which is
  the one thing the read-only root filesystem has to make room for.
- **Storage**: SQLite. The server only stores opaque values (ciphertext
  blobs, wrapped DEKs, Auth Key hashes, per-user salts) and never holds
  plaintext, so no server-side encryption-at-rest layer (e.g. SQLCipher)
  is needed for confidentiality — SQLite is chosen for operational
  simplicity (single file, no separate DB service), not its own
  encryption. The disk file still deserves protection as defense in
  depth, but the security guarantee doesn't depend on it.
- **Charting**: none. The trend chart is drawn directly in SVG
  (net-worth-view.md, Rules).
- **Frontend**: hybrid, a server-rendered shell around client-rendered
  data screens (see Components). The client layer has no build step,
  matching htmx's philosophy.

## Security

### Threat model

Actors this design defends against vs. accepts:

- **Network attacker** (on-path or off-path, passive or active): defended
  — TLS everywhere plus HSTS (see Network & transport) prevents both
  credential interception and in-transit tampering with the served
  crypto JS.
- **Host operator with shell access to the NAS**: defended for
  *passive* observation — reading logs, attaching a debugger, dumping the DB — by
  the zero-knowledge model, and for ciphertext *tampering* (relocating,
  swapping, replaying a blob) by AAD binding (see Key management). Not
  defended against an operator who *actively* modifies the served JS to
  capture a password during login — whoever controls the served code
  controls that; closing it fully needs independent code
  signing/verification, out of scope here. This actor is distinct from
  the administrator account below: holding the machine and holding an
  administrator login are different powers, and only the first one can
  do this.
- **Malicious or compromised server process**: same boundary as the
  host operator — can't decrypt anything, and cannot silently
  rearrange ciphertext without detection.
- **An administrator account of the same instance**: defended, and
  structurally rather than by endpoint discipline. An administrator
  principal has no credential wrapping any key, no `dek_wrappers` row,
  and no `records` row, so there is no key material in that session
  for an endpoint to leak by accident and nothing for a future admin
  feature to reach toward. What they hold is the running of the
  platform: provisioning accounts, removing them, and maintaining the
  instance-wide symbol table. Removing an account destroys its vault
  rather than opening it. The bound on the role is the admin
  boundary rather than the list of tasks, and it is what every new one
  is checked against (admin-invites.md, The admin boundary). An
  administrator who is also a vault owner under a second account gets
  exactly what that second account's password gets them, in a separate
  session.
- **Another vault owner of the same instance**: defended — per-account
  salts and keys throughout; no vault is decryptable with another
  account's password.
- **Offline attacker with a DB dump or an export file**: only as
  defended as password strength × Argon2id cost, by construction (see
  Key management) — there is no rate limit on an offline attack.
- **Compromised dependency or CDN**: defended — all crypto/framework JS
  is self-hosted with Subresource Integrity, no third-party CDN sits
  inside the trust boundary (see Supply chain).
- **Accepted, not defended**: metadata leakage (login timestamps,
  per-user record counts, including roughly how many distinct priced
  symbols a vault holds from the size of a recording's burst of writes,
  request sizes), plus whatever a deployment's
  own TLS-terminating intermediary (reverse proxy, CDN edge, tunnel)
  observes for connection metadata (see Network & transport). The
  conversion-rate lookup revealing queried asset *types* is also
  accepted, but deliberately — see Data model; the amount held is never
  exposed.

### Key management

- **Model: full client-side zero-knowledge encryption.** Server-side
  envelope encryption was rejected because it puts whoever holds the
  server inside the trust boundary — anything the server decrypts, they
  can observe, even unintentionally. Zero-knowledge means there's no plaintext on the
  server to leak, by construction.
- **Key derivation (per account, browser-side only)**: password +
  per-account salt → Argon2id via the **`argon2id`** library (npm `argon2id`, from
  openpgpjs) rather than native Web Crypto PBKDF2, which is weaker →
  HKDF-split into two keys:
  - **Master Key** — never leaves the browser; encrypts/decrypts the
    vault's data-encryption key (DEK). An administrator derives it and
    discards it, unused (Administrator credentials, below).
  - **Auth Key** — sent to the server at login to verify identity, stored
    server-side only as a hash. Can't derive the Master Key or decrypt
    anything.
  - **Parameters**: 64 MiB memory, 3 iterations, parallelism 1, over a
    128-bit salt. RFC 9106's second recommended option is 64 MiB at 3
    iterations. Its parallelism of 4 is unavailable to a single-threaded
    WASM build in a Worker, and dropping to 1 leaves memory and passes
    unchanged, so an attacker pays the same area per guess.
  - **Why 64 MiB and not more**: the binding constraint is time on the
    slowest supported client, not memory. No current device refuses the
    allocation, at this size or well above it. Safari's WebAssembly
    engine runs this workload roughly twelve times slower than Chrome's
    on hardware whose single-core performance is within about 15
    percent, so each doubling of memory costs an iPhone whole seconds
    rather than tens of milliseconds. At 64 MiB an iPhone unlock takes
    about two seconds and a desktop browser a fraction of one, which is
    the bar.
  - **Raising iterations to compensate for the lower memory is
    rejected.** It buys the attacker cost back by spending exactly the
    login time the memory setting exists to protect, on the same device.
  - **These mitigations are ruled out by measurement rather than
    argument**, so neither is worth re-investigating. A warm
    WebAssembly instance is within 2 percent of a cold one at every
    size, so growing the WASM heap is not the cost. Every target reports
    WebAssembly SIMD and the library already selects its SIMD binary, so
    shipping a SIMD build changes nothing. The residual is the engine
    itself.
  - The `argon2id` library is one algorithm and nothing else, about 7 KB
    minified with the WASM inlined, so the self-hosted, SRI-pinned
    artifact is a single small file to audit and re-pin on a bump. It
    ships separate SIMD and non-SIMD binaries and chooses between them,
    and it manages the hash's memory JS-side, so a failed allocation
    surfaces as an ordinary allocation failure the client can catch and
    report (`ui/unlock.md`) instead of an opaque WASM trap. CI asserts a
    published RFC 9106 Argon2id test vector, which is what makes a small
    library as trustworthy here as a large one: the primitive has
    known-answer tests and this uses exactly one primitive.
  - **`hash-wasm` rejected**: it produces byte-identical output for
    identical parameters, so the choice between the two is purely cost,
    and it is 16 to 19 percent slower on Apple devices while a dead heat
    on desktop. The slowest supported device is what sets the memory
    parameter, so a library that is slower only there is the one that
    costs memory.
  - **libsodium.js rejected**: a few hundred KB of Emscripten port to
    reach one function, with an Emscripten heap whose allocation
    behaviour has to be verified per target browser instead of being
    managed explicitly. The audited C provenance is real but does not
    survive the port unexamined, and it buys nothing a known-answer test
    does not.
  - **Versioned envelope**: the KDF algorithm, version, and parameters
    (memory/iterations/parallelism) live in the password method's
    `params` alongside its salt, not in a constant, so a login can
    detect stale parameters and transparently re-wrap the DEK after a
    successful unlock. **That re-wrap is the mechanism by which the
    memory parameter is raised** (login.md, Stale-KDF upgrade): raising
    the server's default envelope upgrades each vault on its owner's
    next login, re-encrypting no record and breaking no existing vault.
    A faster WebAssembly engine on the slowest supported device is
    cashed out this way and no other.
  - **The server's current default envelope is embedded in every
    server-rendered page**: the registration page (register.md) and the
    authenticated app shell (`ui/design-system.md`, App shell). Any
    client-side flow that must derive at *current* parameters — a
    registration, a password change (account-settings.md) — reads it
    from the page it is already on, with no extra round-trip and one
    source for the value. Login is the one exception, because it runs
    before the shell exists: it carries the envelope on the salt
    response, and the target envelope on `kdfStale`.
- **Administrator credentials: the same derivation, half of it thrown
  away.** An administrator has no vault, so there is no Master Key to
  put to work and no wrapper to unwrap. Their credential verification
  is nevertheless the *identical* flow: the same salt fetch, the same
  Argon2id at the same parameters over the same 128-bit salt, the same
  HKDF split, the same Auth Key on the wire, the same server-side
  Argon2id over it. The client derives both halves and discards the
  Master Key.
  - **The waste is the feature.** The client cannot know which kind of
    account it is authenticating as until it has authenticated, and it
    must not, or the pre-authentication step becomes the oracle Login
    enumeration exists to close. A derivation that branched on kind
    would have to be told the kind by `/api/auth/salt`, and that
    endpoint answers anyone. The derivation therefore does not branch,
    and costs an administrator a few microseconds of HKDF on top of an
    Argon2id run they were paying for anyway.
  - **Sending the password to the server instead is rejected.** It is
    the obvious shortcut for an account with no vault, and it fails
    every count. The wire shape of a login would differ by kind and
    leak it before authentication. The server would hold a plaintext
    password, the one secret this whole design is built to keep off
    it. And a server-side Argon2id at client-side cost would blow the
    concurrency cap under Application hardening, which is sized for
    hashing a high-entropy Auth Key and not for being the work factor.
  - For an administrator the Argon2id derivation therefore exists for
    exactly one purpose: making an offline attack on `verifier` pay
    the same price it pays against a vault owner. `verifier` is the
    only thing in the database an offline attacker can attack for an
    administrator account, and there is nothing behind it to decrypt.
- **DEK envelope**: a random per-vault DEK is generated client-side,
  wrapped with the Master Key, and stored server-side as an opaque blob
  the server can't decrypt. All financial data is encrypted client-side
  with the DEK (AES-256-GCM) before it's sent; the server stores and
  returns ciphertext only.
- **One key, N wrappers.** The wrapped DEK is not a property of the
  account. It is a property of a credential, and a vault may hold more
  than one (Data model, Credentials and vault key wrappers). These
  rules follow from the DEK being the same key in every wrapper:
  - **Each authentication returns at most one wrapper**, the one
    belonging to the credential that just authenticated, and none at
    all when the account is an administrator. No endpoint returns the
    set of them, because a client can only unwrap with the credential
    it used, and a list would tell any caller which authenticators a
    vault has. No v1 endpoint enumerates an account's credentials
    either.
  - **Re-wrapping one credential never touches another.** The
    stale-KDF upgrade (login.md) and a password change
    (account-settings.md) each replace exactly one credential row and
    at most its own wrapper, and every other wrapper keeps opening the
    same DEK. This is also why no vault record is re-encrypted by
    either.
  - **Anything that changes the DEK must rewrite every wrapper in the
    same transaction, and delete any wrapper it cannot rewrite.** Import
    re-keys the vault (export-import.md), so it is the one flow this
    binds. A wrapper left holding the previous DEK is worse than a
    missing one: it unwraps successfully and then fails to decrypt every
    record, so the method authenticates and the vault merely looks
    corrupt.
  - **Record encryption is untouched by the wrapper count.** Records are
    encrypted under the DEK and their AAD is built from their own
    fields, so adding, changing, or removing a wrapper alters neither
    the DEK nor any AAD field. No record is re-encrypted, and the
    `principal_id`-not-in-AAD argument below is unaffected.
  - **Zero wrappers is a valid state, and it is what an administrator
    is.** Not a vault whose wrappers were all removed, which is
    unreachable: the last `password` credential of a vault owner
    cannot be deleted (Data model), so a vault owner always has at
    least one. An administrator's principal simply never had a
    `dek_wrappers` row, and the schema refuses to give it one.
  - **Nonce strategy**: a fresh random 96-bit nonce for every encryption
    operation, including re-encrypting an existing record on edit — never
    reuse a record's previous nonce. Collision risk is negligible at this
    data volume (well below 2³² messages under one key); revisit DEK
    rotation only if a single vault ever approaches that bound.
  - **Data integrity (AAD binding)**: every blob's GCM Additional
    Authenticated Data is set to `account_id ‖ record_type ‖ record_id
    ‖ schema_version ‖ version`. Decryption fails if the
    server relocates, swaps, or rolls back a blob to a different
    logical slot within a vault — AES-GCM's per-blob authentication
    alone protects contents but not arrangement. `record-api.md` pins
    the byte encoding.
  - **`principal_id` is deliberately *not* in the AAD**, because the DEK
    boundary already makes a blob undecryptable in another user's
    vault. Two things follow: **the client never needs to know its own
    `principal_id`, and no endpoint returns one**, and a vault transfer
    **re-keys** rather than re-binds, so the two vaults share no key
    material afterwards. `record-api.md` argues the first,
    `export-import.md` the second.
  - Wholesale deletion of the whole record set is not detected.
    Catching it needs a client-maintained, DEK-authenticated manifest
    of expected record ids and versions, which v1 does not ship.
- **Session key handling**: Master Key and unwrapped DEK live only in
  browser memory for the session (not localStorage/sessionStorage, to
  limit XSS exposure) — a page refresh requires re-deriving them from the
  password.
- **Reference pattern**: this split follows audited zero-knowledge
  password managers (e.g. Bitwarden), not a novel design — the point is
  that the server never holds a secret that doubles as both
  authenticator and decryption key.
- **No password recovery, by design.** A forgotten password makes the
  vault permanently unreadable — nothing server-side can derive the
  Master Key, so there's no reset without discarding the data. Accepted
  tradeoff, mitigated by Export/Import (see Components) as a user-held
  backup, not a recovery mechanism.
- **Password/passphrase policy**: enforced at registration on length/
  entropy (not composition rules) — the primary defense for an offline
  attacker with a DB dump or export file, since Argon2id cost is fixed
  and there's no rate limit on an offline guesser. Export/Import must
  warn the user that an export file is exactly as sensitive as their
  password.

### Network & transport

- **TLS is mandatory end-to-end, with HSTS** (`includeSubDomains`, plus
  `preload` if the deployment is ever internet-reachable on a fixed
  domain) — not optional hardening. The browser fetches the crypto JS
  and transmits the Auth Key over this connection on every login, so
  plain HTTP would let a network attacker read the Auth Key and tamper
  with the served JS to capture the password. If a reverse proxy fronts
  the app, the internal hop to it must also be TLS, or that trust
  boundary must be documented explicitly.
- **Access model is a per-deployment operator choice**: LAN-only,
  VPN-only, or internet-exposed — directly, behind a reverse proxy, or
  through a tunnel service (e.g. Cloudflare Tunnel). Whichever layer
  terminates public TLS for visitors, the operator must document, for
  their own deployment:
  - **The hop between that fronting layer and the Flask app**: if it
    never leaves the host/local network, it can be trusted as a local
    hop without its own TLS layer; if it crosses a network boundary, it
    needs TLS too.
  - **HSTS `preload`**: only submittable once a fixed public domain has
    served the header stably for the required probation period — not
    applicable to a LAN/VPN-only deployment with no public domain.
  - **Metadata exposure to the fronting layer**: any TLS-terminating
    intermediary (reverse proxy, CDN edge, tunnel provider) sees
    connection metadata — source IPs, timing, request sizes — for
    whatever traffic it fronts, but never decrypted vault contents, which
    stay client-side ciphertext regardless of which layer terminates
    transport TLS. Treat your specific intermediary as part of the
    accepted metadata-leak surface (see Threat model), not a
    confidentiality gap.

  This instance is internet-exposed via Cloudflare Tunnel (`cloudflared`
  on TrueNAS, no inbound port opened): this deployment's choice, not a
  spec requirement.

### Application hardening

- **CSP**: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
  connect-src 'self'; img-src 'self'; style-src 'self'; frame-ancestors
  'none'; base-uri 'none'; form-action 'self'` — no
  `unsafe-inline`/`unsafe-eval`.
  `'wasm-unsafe-eval'` is what lets the browser compile the Argon2id
  WebAssembly module (Key management). Compiling one is gated by
  `script-src` in every engine, from a byte buffer and from a
  same-origin URL alike, so without this token the key derivation
  cannot run at all. It is the narrow token for exactly that: it
  permits WebAssembly compilation and nothing else, and in particular
  it does not enable `eval` or the `Function` constructor, which is
  why the line above still holds.
  `connect-src` is `'self'` alone: the rate provider is reached through
  the server-side proxy (see Data model), so the browser never contacts
  it directly and whitelisting its host would open a hole with no user.
- **Alpine.js must use its CSP-safe build** (the standard build needs
  `unsafe-eval` for `x-` expressions, which would gut the CSP above).
- **Decrypted content is always untrusted output**: render with
  `textContent`/Alpine `x-text` only, never `innerHTML`/`x-html` —
  holding names, notes, dimension labels, and any imported data are
  attacker-influenceable
  and rendered client-side, where XSS means password/Master Key capture,
  not just session theft.
- **Sessions are server-side rows**, not self-contained signed cookies:
  `(id, token_hash, principal_id, issued_at, last_active_at)`. The cookie
  carries only a random session token, signed with the Flask
  `SECRET_KEY`; the server looks the session up by the token's hash. No
  key material of any kind rides in the cookie. Server-side rows are
  what make sessions enumerable and revocable, which the product
  requires for listing active sessions, "log out everywhere",
  invalidating every other session on a password change or an import,
  and the absolute 12-hour expiry (login.md, Rules, which owns the
  value, and export-import.md). `id` is a separate opaque handle — it
  is what `GET /api/sessions` returns, so no response ever hands JavaScript the
  cookie's own value.
  - **The row shape does not vary by kind and carries no `kind`
    column.** Kind is read through `principal_id`, so there is exactly
    one place it is written and a session can never disagree with the
    account it belongs to.
  - **`last_active_at` is written on every authenticated request**, not
    only read. It is what `GET /api/sessions` reports.
- **Session cookies**: `HttpOnly`, `Secure`, `SameSite=Lax`. Flask
  `SECRET_KEY` must be a strong value injected externally (TrueNAS app
  env), never a default or committed value — the signature is what
  stops an attacker spraying guessed session tokens at the lookup, so a
  weak or leaked key turns guessing into forgery. A valid signature
  alone is still not a session: the token must hash to a stored row.
- **CSRF**: `SameSite=Lax` plus **a required custom request header**,
  `X-Solvent-Request: 1`, on every endpoint that is not meant to be
  reached by navigation — every state-changing one (records, invite,
  import, password change, logout, account deletion) **and `GET
  /api/export`**. Same-origin cookie auth is not implicitly CSRF-safe. A
  request missing the header is rejected with **Forbidden** and changes
  nothing. The check runs **before authentication and before routing**,
  so the response is identical whether or not the session is valid and
  whether or not the path exists — a caller without the header learns
  nothing about session state and cannot map the route table.
  - **A header rather than a token.** A cross-origin page cannot set a
    custom header without a preflight, and the preflight fails because
    no CORS headers are served. Every endpoint in this product is called
    by same-origin `fetch` — registration and login must be, since they
    carry derived key material — so there is no browser form POST for a
    token to protect that the header does not. A token would add
    minting, embedding, rotation, and a second failure mode, to assert
    the same thing.
  - **Export is included because it is a GET.** With `SameSite=Lax` a
    top-level navigation sends the session cookie, so a hostile link
    would otherwise drop the victim's whole encrypted vault into their
    own Downloads — no exfiltration, since the attacker never sees the
    file, but a surprising vault file on a possibly shared machine.
    Requiring the header makes the endpoint non-navigable; the client
    downloads via `fetch` + blob instead of a plain link
    (export-import.md).
- **Login enumeration**: the salt-fetch step returns a deterministic
  decoy salt (`HMAC(server_secret, normalized_username)`) for unknown
  identifiers, with constant-time, identically-shaped responses for real
  vs. fake accounts — invite-only registration protects sign-up, not
  whether an account already exists.
  - **Nothing before a verified credential varies with an account's
    kind.** The salt response carries no kind field and is drawn from
    the same `credentials.params` for both, both kinds are registered
    with a 128-bit salt and an envelope at or above the same server
    minimum, and the client's derivation is identical (Key management,
    Administrator credentials). The username space is single, so there
    is nothing for the caller to disambiguate. An attacker who can
    tell a vault owner's username from an administrator's without
    guessing a password has found a bug, and login.md's acceptance
    list is where it gets caught.
  - **After** a verified credential the response does differ: a vault
    owner's carries a wrapper and an administrator's does not, and the
    login body names the kind outright. That is a fact the caller has
    just proven they are entitled to. The resulting size difference on
    the wire falls under the accepted request-size metadata leak in
    Threat model, and is not treated as a control.
- **Rate limiting**: per-account and per-IP limits with exponential
  backoff and lockout on the login and salt-fetch endpoints. The
  expensive Argon2id derivation runs client-side, so an attacker
  scripting the API directly pays nothing per guess — throttling is the
  only thing standing between them and unlimited guesses.
  - **Defaults**: per account, 10 attempts per 15 minutes, then a
    15-minute lockout once 20 fail within an hour. Per IP, 60 requests
    per hour across `/api/auth/login` and `/api/auth/salt` together —
    together, because splitting the budget lets an attacker spend twice.
  - Every limit here, and the concurrency cap below, is **operator
    config with the stated default**. Unlike the storage caps, the right
    number depends on the deployment — a LAN-only instance and an
    internet-exposed one face different traffic — and no acceptance
    criterion asserts a specific count. Tests assert the *behaviour* at
    whatever the configured value is: the limit engages, the lockout
    holds, and the response shape does not reveal whether the account
    exists.
- **Concurrency cap on Auth Key verification**: the server's per-attempt
  cost is *not* negligible. Every `/api/auth/login`, for a real account
  or a decoy, runs Argon2id over the Auth Key at 64 MiB (login.md), so N
  parallel attempts allocate N × 64 MiB before the rate limiter's
  verdict matters — a memory-exhaustion lever on a NAS. Verifications
  run behind a concurrency limit — **default 4**, so peak Argon2id
  memory is ~256 MiB — and requests over it queue, then fail with the
  ordinary throttle response. The memory ceiling is then a bound the box
  can hold rather than a consequence of how fast the limiter reacts.
- **Alerting means a structured log line**, not a notification: lockout
  emits an event with a stable name, the affected account, and the
  window, at a level the operator's existing container-log tooling can
  filter on. The product has no email or push path and is not gaining
  one for this.

### Storage & data handling

- **Blob and quota limits** — **64 KiB** per ciphertext blob, **50 000**
  records per vault, **32 MiB** total per user. Rejected before the row
  reaches the DB, with Content Too Large (record-api.md).
  - These are **compiled-contract parameters**, not operator config:
    the Content Too Large tests assert exact behaviour at a boundary,
    and a boundary that moves per deployment is one the contract cannot
    state.
  - Every one has an order of magnitude of headroom. A snapshot payload
    is a few hundred bytes and a price entry less, and thirty holdings
    updated monthly for thirty years, with a price entry per symbol per
    recording date, stays well inside the record cap and a few MB of
    the byte quota. The caps bound a runaway client or a hostile
    payload rather than rationing honest use, and they are not
    load-bearing on security.
- **Invite tokens**: ≥128-bit entropy, single-use, time-limited, stored
  hashed at rest, invalidated on first use.
- **Import authorization**: strict schema/size validation on the
  imported file (client and server), and the server ties every imported
  record to the authenticated user's own vault only — one user's import
  can never write into another user's vault. Overwrite-vs-merge
  semantics must be explicit in the Export/Import feature spec.

### Supply chain

- All crypto and framework JS/WASM is self-hosted from the app origin
  with pinned versions and Subresource Integrity hashes, never loaded
  from a third-party CDN, which would otherwise sit inside the trust
  boundary and could silently exfiltrate passwords via a malicious
  script. CI/CD supply-chain controls (image signing, dependency-merge
  policy) live under Tech stack.
- **The list is named here in full, and it is meant to stay short**:
  `argon2id` (Key management), Alpine in its CSP-safe build, and
  zxcvbn. Every third-party file in the browser is one more thing to
  pin, hash, re-verify on a bump, and trust with a page that handles the
  password, so adding one is a design decision made here rather than an
  import added in passing. That is why decimal arithmetic is written
  against `BigInt` (record-snapshot.md) and the trend chart is drawn in
  SVG (net-worth-view.md) rather than pulled in.
- **zxcvbn is loaded only by the two screens that score a password**,
  registration (`ui/register.md`) and change password
  (`ui/settings.md`). It is the largest of them and the app shell
  has no use for it, so it does not ride along on every authenticated
  page.

## Non-goals

- No transaction-level spending tracking or budgeting/expense
  categorization.
- No automated bank sync / Plaid-style integration — conflicts with
  zero-knowledge encryption, since a third party can't encrypt on the
  user's behalf.
- No position-level tracking of listed securities: no share counts, no
  tickers, no cost basis, no per-holding performance. A brokerage
  holding is one depot-level figure (see Data model).
- No mobile app — responsive web only.
- No shared/household view — vaults are private per user.
- No multi-tenant/public hosting — single instance, small fixed set of
  invited users.
