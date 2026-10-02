# Architecture

## What Solvent is

A self-hosted net worth tracker. Every vault is encrypted in the
browser, so the server stores ciphertext and never holds a key that
opens it.

- **Vault owners**: a small number of invited accounts, not open to the
  public. Each has a separate vault: own password, own encryption key,
  nothing shared or visible between them.
- **Administrators**: accounts that provision and remove other accounts
  and own no vault at all. One person doing both jobs holds two
  accounts (Accounts on this instance).

## Components

- **App shell** (server-rendered): Flask + Jinja2 + htmx. Navigation,
  login and registration, layout. Never handles plaintext financial
  data.
- **Data layer** (client-side): vanilla JS and Alpine.js, no build step.
  Derives keys, decrypts blobs fetched from the API, renders balances
  and charts, encrypts new entries before sending them.
- **API**: Flask JSON endpoints, Pydantic-validated.
- **Database**: SQLite, holding only opaque values and the plaintext
  metadata the tables below name.
- **Admin panel**: invite-only account provisioning and instance-wide
  configuration such as the symbol table (admin-invites.md,
  rate-lookup.md). Reachable only by an administrator session, which
  holds no key material.
- **Export/Import**: a vault exported to a local file, still fully
  encrypted. It is the personal backup and the only migration path
  across data-model upgrades (export-import.md).

## Data model

All entity content below (names, notes, classifications, values) is
encrypted client-side. The server sees ciphertext, not these fields.

- **Vault owner**: has one **main currency**, the currency every
  holding normalizes into for the net worth figure.
- **Account**: a holding, virtual (bank, brokerage, crypto exchange) or
  physical (gold, real estate, collectibles). Has a name, a native unit,
  a free-text **note**, and at most one value per configured
  **dimension** (manage-accounts.md). The unit is either a symbol from
  the administrator's symbol table (`USD`, `XAU-ozt`) or free text for
  something with no market price (`m²`), and it **doubles as the
  holding's rate symbol**, so a holding can never be measured in one
  unit and priced in another. A unit with no rate source is priced by
  hand.
- **Quantities and prices are two separate timelines.** A holding's own
  history holds only the quantities its owner recorded. The prices that
  turn those quantities into the main currency are their own series,
  one per symbol, shared by every holding measured in it. The split
  stops a holding from being priced at the day it was last touched,
  which with partial updates is most holdings most of the time.
  - **Snapshot**: a date and a quantity in the holding's native unit,
    and nothing else (record-snapshot.md).
  - **Rate**: what one unit of a symbol was worth in the main currency
    on one date (record-rate.md). Proposed by the lookup proxy where a
    source exists, always overridable, and stored permanently once
    written, because a price recomputed later would rewrite what the
    person was worth in 2019.
  - **Recording anything refreshes every price.** A quantity has to be
    read off a statement, so the app never writes one nobody gathered.
    A price needs no gathering, so it is written by default.
  - **A recording is a date, not a stored thing**: a client-side
    grouping of records by their own `date` field (record-snapshot.md).
- Updates are sparse by design. Today's total, and the total at any past
  date, is each holding's last recorded quantity at the latest price for
  its unit on or before that date.

### Accounts on this instance

Every account on the instance is a row of `principals`, and its `kind`
is fixed when the row is written. No endpoint writes `kind` after the
insert (admin-invites.md).

| Column | Visibility | Notes |
|---|---|---|
| `id` | plaintext | opaque server-generated handle, returned to no client |
| `username` | plaintext | normalized, unique across both kinds |
| `kind` | plaintext | `vault_owner` \| `administrator`, `CHECK`-constrained |
| `created_at` | plaintext | server clock |
| `last_login_at` | plaintext | server clock, written by every session start (login.md, The session a sign-in issues) |

- A **vault owner** owns a vault: a DEK, records, a profile, an export.
- An **administrator** owns none of that: no DEK, no wrapper, no
  records. "An administrator cannot read a vault" is then a property of
  what their row can be joined to, not a check every new admin feature
  has to pass.
- One person holding both kinds holds **two principals, two usernames,
  two passwords**, and **nothing in the schema links them**. A link
  would be a stored claim that some administrator owns some vault, and
  the first feature to read it would cross the boundary admin-invites.md
  draws.
- **One username space across both kinds**, so a username resolves to
  exactly one principal and login never has to ask which kind is meant
  (Login enumeration).

### Credentials and vault key wrappers

**Every principal has exactly one credential**, which authenticates it.
**Only a vault owner has a wrapper**: the vault's data encryption key
(DEK) wrapped by that credential. Two facts with two existence
conditions, so two tables.

`credentials`:

| Column | Visibility | Notes |
|---|---|---|
| `id` | plaintext | opaque server-generated handle |
| `principal_id` | plaintext | `ON DELETE CASCADE` from `principals` |
| `method` | plaintext | `password`, the only value any endpoint accepts |
| `params` | plaintext | JSON keyed on `method`. For `password`: `{ salt, kdf }` |
| `verifier` | opaque | for `password`: the Argon2id hash of the Auth Key |
| `created_at` | plaintext | server clock |

`dek_wrappers`:

| Column | Visibility | Notes |
|---|---|---|
| `credential_id` | plaintext | primary key, `ON DELETE CASCADE` from `credentials` |
| `wrapped_dek` | opaque | the vault's DEK under this credential's wrapping key, AES-256-GCM |
| `dek_nonce` | plaintext | fresh 96-bit random per wrap |
| `created_at` | plaintext | server clock |

- **An administrator is the absence of a wrapper row**, which the keys
  enforce. One table with nullable wrapper columns would carry "this
  account has no vault" with nothing enforcing it.
- **`params` is public and `verifier` is secret.** `params` holds
  exactly what a caller needs before it can authenticate, and the
  salt fetch hands it to anyone (login.md), so nothing secret is ever
  placed in it. No endpoint returns `verifier`. The server validates
  `params` as a union discriminated on `method`, so a wrong-shaped one
  is a Bad Request, not a row that fails at the next login.
- **Exactly one `password` credential per principal, always.** A unique
  index on `principal_id` where `method = 'password'` enforces it, the
  row is written in the same transaction as the principal, and only
  deleting the account removes it. An export carries the password
  credential's wrapper (export-import.md), so without one a vault has
  no openable backup.
- **The schema refuses a vault row attached to an administrator.** A
  `records` insert and a `dek_wrappers` insert each abort on an
  `administrator` principal (app-shell.md, Database).

### Record storage API

`account`, `snapshot`, `rate` and `profile` records are all stored
through one generic record endpoint (record-api.md). The server has no
per-type logic, because it cannot read any type. A record row is:

| Column | Visibility | Notes |
|---|---|---|
| `principal_id` | plaintext | the owning vault owner. Every query is scoped to the session's principal |
| `record_id` | plaintext | client-generated UUIDv4 |
| `record_type` | plaintext | `account` \| `snapshot` \| `rate` \| `profile` |
| `account_id` | plaintext | the owning `account` record for `snapshot`, empty otherwise |
| `schema_version` | plaintext | bumped when the plaintext shape changes |
| `version` | plaintext | monotonic, starts at 1, +1 per write |
| `nonce` | plaintext | fresh 96-bit random per encryption |
| `ciphertext` | opaque | AES-256-GCM under the DEK |
| `updated_at` | plaintext | server clock, for debugging |

`record_id`, `record_type`, `account_id`, `schema_version` and
`version` are exactly the AAD (Key management, Data integrity).

The plaintext columns are **metadata the server can see**: record
counts, which snapshots belong to which `account` record, and write
timestamps. That is within the accepted metadata leak (Threat model).
The plaintext shape deliberately carries no name, value, date, unit or
symbol.

The server never accepts a `principal_id` from the client. It is
always taken from the session.

**Conversion-rate lookup**: a server-side proxy fetches rates from
public providers and proposes them to the client (rate-lookup.md). It
caches, and no browser leaks its update timing to a third party. It
learns the date and the main currency, never an amount and never which
symbols a vault holds: the client asks for the whole quotable table
and never a single holding's value.

## Status codes

Every endpoint answers from this set, and every spec file names the
status rather than its number. The numbers live here alone, so a
contract pins one value and prose stays readable.

| Name | Code | Answered when |
|---|---|---|
| OK | 200 | the request succeeded and carries a body |
| No Content | 204 | the request was valid and there is nothing to return, such as a rate with no proposal available. Never an error |
| Bad Request | 400 | input is malformed, out of range, or names something the caller may safely learn does not exist |
| Unauthorized | 401 | a refusal of an API request with the `X-Solvent-Request` header and no valid session (Refusals) |
| Forbidden | 403 | a refusal of an API request without the `X-Solvent-Request` header (Refusals) |
| Not Found | 404 | the target does not exist **or** belongs to someone else, and every other refusal (Refusals) |
| Conflict | 409 | the write lost an optimistic-concurrency check, or the target's state forbids it |
| Content Too Large | 413 | a storage cap would be exceeded (Storage & data handling) |
| Too Many Requests | 429 | a rate limit engaged (Application hardening) |
| Server Error | 500 | an unhandled failure. Never a designed answer. It appears in this spec only where a test stubs one |

A Bad Request names its reason, as the body `{"refused":"<reason>"}`,
only where a feature file pins that reason, and only when the reason
tells the caller nothing it did not send or could not already learn.
Every other Bad Request carries no `refused` member.

### Refusals

A refusal's status depends only on the namespace, the
`X-Solvent-Request` header and the session, never on whether the path
exists, its surface or its method, so a probe learns nothing it did
not send. A path under `/api/` is an API request, any other a page
request.

| | No `X-Solvent-Request` header | Header, no valid session | Header, valid session |
|---|---|---|---|
| Page | Not Found | Not Found | Not Found |
| API | Forbidden | Unauthorized | Not Found |

No valid session means no cookie, a badly signed one, or an expired or
revoked session. An unknown path, a method the route does not answer
(`OPTIONS` included) and an address the router would redirect
(`//admin`) are refused as invented. Nothing answers Method Not Allowed,
and no refusal redirects. app-shell.md, The request gate, applies this.

## Tech stack

- **Packaging**: one container image, which is what deploys.
- **Base image**: the current Python release's `-slim` image, pinned by
  digest. The Dockerfile's `FROM` line is the one place the Python
  version is written, and CI tests on that same version, so Dependabot
  moves the image and the tests together. Chosen over alpine,
  distroless and Chainguard for the broadest pip wheel compatibility.
- **Container hardening**: runs as non-root, read-only root filesystem
  with one writable volume for the SQLite database, minimal Linux
  capabilities. Secrets are injected through the environment, never
  baked into the image or committed.
- **Backend framework**: Flask, over FastAPI and Django. The app is
  small with no external API consumers, so FastAPI's async and
  generated docs don't pay for their ceremony, and Django's admin,
  settings and migrations are more structure than needed. Pydantic
  validates the JSON endpoints directly inside Flask.
- **WSGI server**: gunicorn, serving `app:app`. Its worker heartbeat
  needs a writable directory, which the read-only root filesystem has
  to make room for.
- **Storage**: SQLite, for operational simplicity: a single file and no
  separate service. The server holds no plaintext, so confidentiality
  does not depend on encrypting the file, and no SQLCipher layer is
  added.

## Security

### Threat model

- **Network attacker** (passive or active): defended by TLS everywhere
  plus HSTS (Network & transport), against both credential interception
  and tampering with the served crypto JS.
- **Host operator with shell access**: defended against *passive*
  observation (reading logs, attaching a debugger, dumping the
  database) by the zero-knowledge model, and against ciphertext
  *tampering* (relocating, swapping, replaying a blob) by AAD binding.
  Not defended against an operator who *actively* modifies the served
  JS to capture a password at login. Closing that needs independent
  code verification, out of scope. Holding the machine and holding an
  administrator login are different powers, and only the first can do
  this.
- **Malicious or compromised server process**: same boundary as the
  host operator.
- **An administrator account of the same instance**: defended
  structurally. An administrator principal has no wrapper and no
  records, so there is no key material in that session for an endpoint
  to leak. The role runs the platform: provisioning and removing
  accounts and maintaining the symbol table. Removing an account
  destroys its vault rather than opening it. Every new admin task is
  checked against the admin boundary (admin-invites.md, The admin
  boundary).
- **Another vault owner of the same instance**: defended. Per-account
  salts and keys throughout, so no vault opens with another account's
  password.
- **Offline attacker with a database dump or an export file**: only as
  defended as password strength times Argon2id cost. There is no rate
  limit on an offline attack.
- **Compromised dependency or CDN**: defended (Supply chain).
- **Accepted, not defended**:
  - Metadata: login timestamps, per-user record counts (including
    roughly how many priced symbols a vault holds, from the size of a
    recording's burst of writes), and request sizes.
  - Whatever a deployment's own TLS-terminating intermediary (reverse
    proxy, CDN edge, tunnel) sees of connection metadata.
  - The rate proxy learning the user's main currency, which travels as
    `quote` on every lookup, and the date of each lookup.
  - Wholesale deletion of a vault's record set. Detecting it needs a
    DEK-authenticated manifest of expected record ids and versions,
    which v1 does not ship.

### Key management

- **Model: full client-side zero-knowledge encryption.** Server-side
  envelope encryption puts whoever holds the server inside the trust
  boundary. With zero knowledge there is no plaintext on the server to
  leak. This follows audited zero-knowledge password managers: the
  server never holds a secret that is both authenticator and decryption
  key.
- **Key derivation (per account, browser-side only)**: password +
  per-account salt → Argon2id via the **`argon2id`** library (npm
  `argon2id`, from openpgpjs) → HKDF-split into two keys:
  - **Master Key**: never leaves the browser. Unwraps the vault's DEK.
  - **Auth Key**: sent to the server at login, stored server-side only
    as a hash. Can't derive the Master Key or decrypt anything.
  - **Parameters**: 64 MiB memory, 3 iterations, parallelism 1, over a
    128-bit salt. This is RFC 9106's second recommended option with
    parallelism 1, because a single-threaded WASM build in a Worker
    cannot use 4. Memory and passes are unchanged, so an attacker pays
    the same per guess.
  - **Why 64 MiB and not more**: the binding constraint is unlock time
    on the slowest supported client, an iPhone, whose WebAssembly engine
    runs this workload many times slower than desktop Chrome on
    comparable hardware. At 64 MiB an iPhone unlock takes about two
    seconds. Raising iterations instead is rejected, because it spends
    exactly the same login time. A warm WASM instance and a SIMD build
    were both measured and change nothing.
  - **Why `argon2id`**: one algorithm in a small file to audit and
    re-pin, a SIMD and a non-SIMD binary chosen at runtime, and memory
    managed JS-side, so a failed allocation is an ordinary error the
    client can catch and report (`ui/unlock.md`). CI asserts an RFC 9106
    known-answer vector. **`hash-wasm`** is rejected: identical output,
    but 16 to 19 percent slower on Apple devices, which set the memory
    parameter. **libsodium.js** is rejected: a few hundred KB of
    Emscripten port for one function, with a heap whose allocation
    behaviour has to be verified per browser.
  - **Versioned envelope**: the KDF algorithm, version and parameters
    live in the password credential's `params` beside its salt, so a
    login detects stale parameters and re-wraps the DEK after unlock
    (login.md, Stale-KDF upgrade). That is how the memory parameter is
    raised: raise the server's default and each vault upgrades on its
    owner's next login, with no record re-encrypted.
  - **The server's current default envelope is embedded in every
    server-rendered page**, so a flow that derives at current
    parameters (registration, password change) reads it with no extra
    round-trip. Login runs before the shell exists and gets it on the
    salt response instead.
- **Administrator credentials**: the same derivation, the same salt
  fetch, parameters, HKDF split and Auth Key on the wire. The client
  discards the Master Key. It cannot know the account's kind before
  authenticating, and must not (Login enumeration). Sending an
  administrator's password to the server instead is rejected: the wire
  shape would leak the kind, the server would hold a plaintext
  password, and server-side Argon2id at client cost would break the
  Concurrency cap.
- **DEK envelope**: a random per-vault DEK is generated client-side and
  wrapped with the Master Key. All financial data is encrypted
  client-side with the DEK (AES-256-GCM). The server stores and returns
  ciphertext only.
- **One key, N wrappers.** The wrapped DEK belongs to a credential, not
  to the account.
  - **Each authentication returns at most one wrapper**, the one of the
    credential that just authenticated, and none for an administrator.
    No endpoint lists a vault's wrappers or credentials.
  - **Re-wrapping one credential never touches another.** The stale-KDF
    upgrade and a password change each replace one credential row and
    its own wrapper. No record is re-encrypted.
  - **Anything that changes the DEK rewrites every wrapper in the same
    transaction.** Import re-keys the vault (export-import.md), so it is
    the flow this binds. A wrapper still holding the old DEK unwraps and
    then fails on every record, so the vault looks corrupt.
- **Nonce strategy**: a fresh random 96-bit nonce for every encryption,
  including re-encrypting an existing record on edit. Collision risk is
  negligible well below 2³² messages under one key.
- **Data integrity (AAD binding)**: every blob's GCM Additional
  Authenticated Data is `account_id ‖ record_type ‖ record_id ‖
  schema_version ‖ version`, so decryption fails if the server
  relocates, swaps or rolls back a blob within a vault. `record-api.md`
  pins the byte encoding.
  - **`principal_id` is not in the AAD**, because the DEK boundary
    already makes a blob undecryptable in another vault. So the client
    never needs its own `principal_id` and no endpoint returns one, and
    a vault transfer re-keys rather than re-binds (record-api.md,
    export-import.md).
- **Session key handling**: the Master Key and the unwrapped DEK live
  only in page memory, never in localStorage or sessionStorage. A page
  refresh re-derives them from the password.
- **No password recovery, by design.** Nothing server-side can derive
  the Master Key, so a forgotten password makes the vault permanently
  unreadable. An export is a user-held backup, not a recovery
  mechanism.
- **Password/passphrase policy**: enforced at registration on length
  and entropy, not composition rules. It is the primary defense against
  an offline attacker. Export warns that an export file is exactly as
  sensitive as the password.

### Network & transport

- **TLS end to end, with HSTS** (`includeSubDomains`). The browser
  fetches the crypto JS and sends the Auth Key on every login, so plain
  HTTP would let a network attacker read one and tamper with the other.
  A hop between a TLS-terminating proxy and the app that crosses a
  network boundary needs TLS too.
- **HSTS `preload`** is opt-in, valid only once a fixed public domain
  has served the header stably through the preload probation period.
- How the instance is reached (LAN, VPN, reverse proxy, tunnel) is the
  deployment's choice.

### Application hardening

- **CSP**: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
  connect-src 'self'; img-src 'self'; style-src 'self'; frame-ancestors
  'none'; base-uri 'none'; form-action 'self'`. No
  `unsafe-inline` or `unsafe-eval`.
  - `'wasm-unsafe-eval'` lets the browser compile the Argon2id
    WebAssembly module, which every engine gates on `script-src`. It
    permits WebAssembly compilation and nothing else, not `eval` and not
    the `Function` constructor.
  - `connect-src` is `'self'` alone, because rate providers are reached
    through the server-side proxy.
- **Alpine.js uses its CSP-safe build**. The standard build needs
  `unsafe-eval` for `x-` expressions.
- **Decrypted content is always untrusted output**: rendered with
  `textContent` or Alpine `x-text` only, never `innerHTML` or `x-html`.
  Holding names, notes, dimension labels and imported data are
  attacker-influenceable, and XSS here means password and Master Key
  capture, not just session theft.
- **Sessions are server-side rows**, not self-contained signed cookies:
  `(id, token_hash, principal_id, issued_at, last_active_at)`. The
  cookie carries only a random session token, signed with the Flask
  `SECRET_KEY`, and the server looks the session up by the token's
  hash. Server-side rows are what make sessions listable and revocable:
  "log out everywhere", invalidating other sessions on a password change
  or an import, and the absolute expiry (login.md, Rules).
  `id` is a separate opaque handle, which `GET /api/sessions` returns,
  so no response hands JavaScript the cookie's value.
  - **No `kind` column.** Kind is read through `principal_id`, so a
    session can never disagree with its account.
  - **`last_active_at`** is written on every request that passes step 4
    of app-shell.md, The request gate, including one refused after it.
    Where a feature file says such a request "changes nothing", it means
    nothing beyond this column.
- **Session cookies**: `HttpOnly`, `Secure`, `SameSite=Lax`. `SECRET_KEY`
  is a strong value injected externally, never a default or committed
  value. The signature is what stops an attacker spraying guessed
  tokens at the lookup.
- **A page left while unlocked keeps no keys.** The vault shell page is
  served with `Cache-Control: no-store`, and the client locks on
  `pagehide`, discarding keys and decrypted state as the idle lock does
  (login.md, Rules). Both, because a browser may keep a `no-store` page
  in the back-forward cache anyway. Back shows the unlock card.
- **CSRF**: `SameSite=Lax` plus **a required custom request header**,
  `X-Solvent-Request: 1`, on every endpoint not meant to be reached by
  navigation: every state-changing one **and `GET /api/export`**
  (export-import.md). **Every route that requires the header is under
  `/api/`**, and every other route answers only `GET` and `HEAD`.
  - **A header rather than a token.** A cross-origin page cannot set a
    custom header without a preflight, and no CORS headers are served.
    Every endpoint is called by same-origin `fetch`, so there is no form
    POST a token would protect that the header does not.
- **Login enumeration**: the salt fetch returns a deterministic decoy
  salt (`HMAC(server_secret, normalized_username)`) for unknown
  usernames, with constant-time, identically shaped responses for real
  and unknown accounts.
  - **Nothing before a verified credential varies with an account's
    kind.** The salt response has no kind field, both kinds register
    with a 128-bit salt and an envelope at or above the same minimum,
    the client's derivation is identical, and the username space is
    single. Telling a vault owner's username from an administrator's
    without a password is a bug.
  - After a verified credential the response does differ, because the
    caller has proven they are entitled to know. The size difference
    falls under the accepted request-size leak.
  - Any future pre-authentication step needs the same decoy treatment.
- **Rate limiting**: per-account and per-IP limits and a lockout on the
  login and salt-fetch endpoints. The Argon2id derivation runs
  client-side, so a scripted attacker pays nothing per guess and
  throttling is the only bound. An account over its limit is throttled,
  and one that keeps failing is locked out, with no backoff between.
  - **Defaults**: per account, 10 attempts per 15 minutes, then a
    15-minute lockout once 20 fail within an hour. Per IP, 60 requests
    per hour across `/api/auth/login` and `/api/auth/salt` together,
    because splitting the budget lets an attacker spend twice.
  - Every limit here and the concurrency cap below is **operator
    config with the stated default**, because the right number depends
    on the deployment's exposure. Tests assert behaviour at the
    configured value: the limit engages, the lockout holds, and the
    response does not reveal whether the account exists.
- **Concurrency cap** on Auth Key verification: every
  `/api/auth/login`, real or decoy, runs Argon2id over the Auth Key at
  64 MiB, so N parallel attempts allocate N × 64 MiB before the rate
  limiter's verdict matters. Verifications run behind a limit of
  **default 4**, so peak Argon2id memory is about 256 MiB. A
  verification waits **at most 10 seconds** for a slot, then gets the
  ordinary throttle response.
- **Alerting is a structured log line**: a lockout emits an event with
  a stable name, the account and the window, at a level container-log
  tooling can filter on. There is no email or push path.

### Storage & data handling

- **Blob and quota limits**: **64 KiB** per ciphertext blob, **50 000**
  records per vault, **32 MiB** total per user, rejected before the row
  reaches the database with Content Too Large (record-api.md).
  - These are **compiled-contract parameters**, not operator config,
    because the tests assert exact behaviour at the boundary.
  - Each has an order of magnitude of headroom over decades of monthly
    recordings. They bound a runaway client or a hostile payload, not
    honest use.
- **Invite tokens**: ≥128-bit entropy, single-use, time-limited, stored
  hashed.

### Supply chain

- All browser JS and WASM is self-hosted from the app origin with
  pinned versions, never loaded from a third-party CDN, which would sit
  inside the trust boundary.
- Every vendored file has a pinned SHA-384 hash, the test suite checks
  each file against it, and every script tag that loads one carries it
  as Subresource Integrity. The `argon2id` import inside the KDF worker
  carries none: enforcing it would need `blob:` in `script-src`, and the
  hash is served by the same origin as the file anyway.
- Vendored files are outside Dependabot and are re-pinned by hand.
- **The list is short on purpose**: `argon2id`, Alpine in its CSP-safe
  build, and zxcvbn. Every browser dependency is one more file to pin,
  re-verify and trust with the password, so adding one is a decision
  made here. That is why decimal arithmetic uses `BigInt`
  (record-snapshot.md) and the trend chart is plain SVG
  (net-worth-view.md).
- **zxcvbn loads only on screens that score a password**. It is the
  largest of them and the app shell has no use for it.

## Non-goals

- No transaction-level spending tracking or budgeting.
- No automated bank sync. A third party cannot encrypt on the user's
  behalf, so it conflicts with zero-knowledge encryption.
- No position-level tracking of listed securities: no share counts,
  tickers, cost basis or per-position performance. A brokerage depot is
  one holding in its reporting currency, updated like a bank account.
- No mobile app. Responsive web only.
- No shared or household view. Vaults are private per user.
- No public sign-up. Accounts exist only by invitation.
