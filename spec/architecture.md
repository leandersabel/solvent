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
  hand, and so is a published unit at a date before its source's prices
  begin (record-rate.md, Reading).
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
- Updates are sparse by design. Which price values a figure is
  record-rate.md, Reading, and how the total and the chart pair a
  holding's quantity with a price between entries is net-worth-view.md.

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

### Vault epoch

**A page holding a replaced DEK neither writes nor reads.** Import
gives the vault a new DEK (export-import.md), and every other page
where the vault is open still holds the old one. The server cannot
tell which key encrypted a blob. Unchecked, a create from such a page
is stored and never decrypts again, and a delete or purge from it
removes a restored record, because import keeps record ids. The vault
epoch is the check: a value naming the DEK a page holds, which reveals
nothing about the key.

`vault_epochs`:

| Column | Visibility | Notes |
|---|---|---|
| `principal_id` | plaintext | primary key, `ON DELETE CASCADE` from `principals` |
| `epoch` | plaintext | 16 bytes from `secrets.token_bytes`, as 32 lowercase hex characters |

- **Exactly one row per vault owner, none for an administrator.**
  Registration writes it in the transaction that creates the principal
  (register.md). Import replaces it in the transaction that replaces
  the DEK (export-import.md). Nothing else writes it. Every process
  start gives a fresh row to each vault owner without one, so a
  database an earlier build wrote needs no migration and keeps its
  schema version (app-shell.md, Database). A trigger refuses an
  administrator's row, as it refuses an administrator's wrapper.
- **Its own table.** `principals` holds identity and kind alone, and a
  column on `dek_wrappers` would repeat one vault's value on every
  wrapper.
- **Random, not a counter**, so a fresh one needs no read of the old
  one and says nothing about how often a vault was restored.
- **The page learns it** from the sign-in that hands it the wrapper
  (login.md), from registration (register.md) and from its own import
  (export-import.md). It lives in page memory, never in localStorage or
  sessionStorage. Unlike the keys it survives a lock and the session
  ending, because the next sign-in compares it (login.md, A vault
  replaced elsewhere).
- **Every API request a page sends once it holds one carries it**, as
  `X-Solvent-Vault: <epoch>`. The request gate answers a vault owner's
  request to any API route outside Public with Bad Request when the
  header is missing, and Conflict `{"refused":"vault-replaced"}` when
  it is not the vault's (app-shell.md, The request gate). A missing
  header is a refusal, not an exemption, so a page loaded before the
  epoch existed fails loudly instead of writing.
- **Every handler that serves a vault owner's own request and reads or
  writes `records` or `dek_wrappers`, or deletes their principal,
  compares it again inside its own transaction**, with the same
  Conflict. An administrator removing a vault owner
  (admin-invites.md) compares nothing: the administrator's page holds
  no epoch, and the removal destroys the vault whatever key it is
  under. A write compares after
  `BEGIN IMMEDIATE` takes the lock, a read inside the transaction that
  reads its rows. So a request racing an import either commits first
  and is replaced with everything else, or answers Conflict. Sign-in
  reads the wrapper and the epoch in one transaction, so
  it never hands out one without the other. The handlers are record
  read, write and delete (record-api.md), purge (manage-accounts.md),
  export and import (export-import.md), the stale-KDF upgrade
  (login.md), and password change and account deletion
  (account-settings.md).
- **A page that learns its epoch was replaced tells the browser's
  other pages at once**, on a `BroadcastChannel` (login.md, A vault
  replaced elsewhere).
- **Not a secret.** Sign-in hands it to whoever proves the password,
  and only a valid vault owner session reaches the comparison, so it is
  compared as a plain string.
- **A consistency control, not a boundary against the server.** A
  server that ignores it can store a blob that does not decrypt, which
  it can do anyway (Threat model).
- **It is not in the AAD**, because a new AAD field makes every stored
  record unreadable, and the AAD binds a blob to its slot rather than
  to a key.
- **The server checks no proof of which DEK a page holds**, such as a
  key-check value. It can verify none, and a value only a client can
  write would be missing for every existing vault until its owner's
  next sign-in.
- **Import rotates no cookie and revokes no session.** Every tab of one
  browser shares the cookie, so a rotated one reaches the stale tabs
  too. Revoking the importing session would close the tab the restore
  was made in. Revoking the others protects nothing the epoch does not,
  and would cost every other device the chance to say why it closed
  before asking for the password.

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
| Conflict | 409 | the write lost an optimistic-concurrency check, the target's state forbids it, or the request's vault epoch is not the vault's (Vault epoch) |
| Content Too Large | 413 | a storage cap would be exceeded (Storage & data handling) |
| Too Many Requests | 429 | a rate limit engaged (Application hardening) |
| Server Error | 500 | an unhandled failure. Never a designed answer. It appears in this spec only where a test stubs one |

A Bad Request or a Conflict names its reason, as the body
`{"refused":"<reason>"}`, only where this spec pins that reason, and
only when the reason tells the caller nothing it did not send or could
not already learn. Every other Bad Request or Conflict carries no
`refused` member, so `vault-replaced` is never mistaken for a lost
version check.

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

The gate's vault epoch step (Vault epoch) is not a refusal in this
sense. It runs only for a vault owner the steps above let through to
a route of their own surface, so its answer says nothing about paths
or kinds.

## Tech stack

- **Packaging**: one container image, which is what deploys. It holds
  `app.py`, `solvent/` and the dependencies `requirements.txt` pins, on
  the base image, and nothing else: no test, no tool and nothing of the
  nightly harness. The Dockerfile copies those paths by name, so the
  build context's contents cannot widen it. The nightly tests that
  image unchanged and publishes the one it tested (nightly-harness.md).
  It has no setting that names a price source or a certificate
  authority (rate-lookup.md, SSRF and egress hardening), so nothing
  built for testing can redirect an installation's lookups.
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
    recording's burst of writes), request sizes, and when an unlocked
    page comes back into view, which its epoch check reveals (login.md,
    A vault replaced elsewhere).
  - Whatever a deployment's own TLS-terminating intermediary (reverse
    proxy, CDN edge, tunnel) sees of connection metadata.
  - Someone holding both `SECRET_KEY` and the database can recover the
    address behind an address key still in the `attempts` table, by
    hashing every candidate address, for as long as Rate limiting keeps
    the key.
  - The rate proxy learning the user's main currency, which travels as
    `quote` on every lookup, and the date of each lookup.
  - Wholesale deletion of a vault's record set. Detecting it needs a
    DEK-authenticated manifest of expected record ids and versions,
    which Solvent does not ship.

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
  - **The split** is HKDF-SHA256 over the Argon2id output with an empty
    salt, info `solvent/master-key` for the Master Key and
    `solvent/auth-key` for the Auth Key, 32 bytes each. The Auth Key
    travels as padded base64, and its hash is over that text.
  - **An Auth Key that becomes a verifier** (registration, a password
    change, the stale-KDF upgrade) must decode as strict base64 to
    exactly 32 bytes, or the request is a Bad Request that writes
    nothing. A hand-built request could otherwise give its account a
    credential weaker than the split makes. An Auth Key that is only
    verified gets no shape check, so a sign-in has one answer for every
    wrong key.
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
    client can catch and report (login.md, Unlock). CI asserts an RFC 9106
    known-answer vector. **`hash-wasm`** is rejected: identical output,
    but 16 to 19 percent slower on Apple devices, which set the memory
    parameter. **libsodium.js** is rejected: a few hundred KB of
    Emscripten port for one function, with a heap whose allocation
    behaviour has to be verified per browser.
  - **The worker loads on the first derivation of a page**, and a
    load that fails ends that derivation as a request that got no
    answer, so the screen says it did not go through and never waits
    for good. The next derivation loads the worker again. There is no
    timeout, because a real derivation takes seconds on a phone.
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
    then fails on every record, so the vault looks corrupt. The same
    transaction replaces the vault epoch, so no page still holding the
    old DEK reads or writes again (Vault epoch).
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
- **The client address is the TCP peer's**, unless `TRUSTED_PROXY_HOPS`
  is N > 0. Then Werkzeug's `ProxyFix(x_for=N)` wraps the WSGI app and
  takes the Nth entry from the right of `X-Forwarded-For`, the one the
  outermost of N trusted proxies appended. Only `x_for` is set. Scheme,
  host, port and prefix are never read from a header, because the
  cookie is `Secure` and HSTS is sent whatever the scheme.
  - **Too low**, and every client shares the proxy's address, so one
    guesser's lock shuts out the whole instance (Rate limiting).
  - **Too high**, and a client writes its own entry into the header and
    gets a fresh address per guess, which leaves only the per-username
    limit.
  - With N = 0, the first request in a process that carries
    `X-Forwarded-For` logs `config.proxy_header_ignored` once, at
    WARNING, naming `TRUSTED_PROXY_HOPS` and no header value.
- **The address is used for the address limit and nothing else**
  (Rate limiting). No table, response or log line carries it
  (Storage & data handling).

### Application hardening

- **CSP**: everything is refused by default, and the page may load
  scripts, styles and images, connect, and submit forms only to its own
  origin. No `unsafe-inline` or `unsafe-eval`, no `<base>`, and no page
  may frame it (`frame-ancestors 'none'`).
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
  "log out everywhere", invalidating other sessions on a password
  change, and the absolute expiry (login.md, Rules).
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
- **Rate limiting** guards `/api/auth/salt`, `/api/auth/login`,
  `POST /api/auth/change-password` and `DELETE /api/auth/account`. The
  Argon2id derivation runs client-side, so a scripted attacker pays
  nothing per guess and throttling is the only bound. The last two
  check a password too, so a stolen session would otherwise guess
  through them without limit. Each endpoint checks every limit below,
  for the username it names or the session's, before doing any work,
  and a request any one
  refuses gets Too Many Requests with the same body and headers, whether
  or not the username exists and whatever its kind.
  - **Per username**: 10 failed sign-ins within 15 minutes throttle the
    username until the oldest leaves the window. 20 within 60 minutes
    lock it for 15 minutes from the failure that tripped the lock.
  - **Per address**: 30 failed sign-ins from one client address within
    15 minutes lock that address for 15 minutes from the failure that
    tripped the lock. The lock refuses every username from that
    address, administrators' included, on every guarded endpoint. Without it an
    attacker stays under the per-username limit by trying a few
    passwords on every username.
  - **A failed sign-in** is a `/api/auth/login` whose verification,
    real or decoy, did not match, or a change-password or account
    deletion whose password check did not. Nothing else
    counts: not the salt fetch, which verifies nothing and whose
    enumeration the decoy closes (Login enumeration), not a Bad
    Request, and not a request the concurrency cap or a limit turned
    away. Counting salt fetches or successes would let a household
    behind one address lock itself out by signing in.
  - **A refused request writes no row**, in this limiter and every
    other (rate-lookup.md, export-import.md). So a lock runs from the
    failure that tripped it, and retrying during a throttle or a lock
    never lengthens it.
  - A failure while the window still holds the threshold trips a fresh
    lock, so a lock shorter than its window can follow another at once.
  - **A successful sign-in deletes its username's `login:` and
    `login-lock:` rows and none of its address's**, because one valid
    account would otherwise reset its address's budget between guesses.
  - **The address is stored only as a key.** Its key is the first 16
    bytes, as lowercase hex, of HMAC-SHA256 under the address subkey
    over the canonical address in ASCII. The subkey is HKDF-SHA256
    (RFC 5869) with `SECRET_KEY`'s UTF-8 bytes as input keying
    material, no salt (32 zero bytes), info `solvent attempts address
    v1` in ASCII, and 32 bytes of output. An unkeyed hash is rejected,
    because a 32-bit address space reverses in seconds. The subkey
    separates this use from the decoy salt's HMAC under the same secret.
    HKDF is the standard library's `hmac` in RFC 5869's two steps,
    checked against its Test Case 1, rather than a dependency added for
    one function.
  - **The canonical address**: an IPv4 address in dotted decimal. An
    IPv4-mapped IPv6 address as its IPv4 address. Any other IPv6
    address as its /64 network in Python's compressed form
    (`2001:db8:1:2::/64`), because one subscriber holds a whole /64 and
    would otherwise have a fresh address per guess. A value that parses
    as neither is the literal `invalid`, one shared key, so garbage
    cannot buy fresh keys either.
  - **Rows**: the `attempts` table is `(bucket, outcome, at)`, indexed
    on `(bucket, at)`, with `outcome` one of `request` and `failure`
    and `at` from the server clock. It is SQLite rather than process
    memory, so every gunicorn worker shares one budget and a restart
    hands an attacker no fresh one. A row is deleted once it is older
    than the longest window any check reads its bucket over:

    | Bucket | One row per | Deleted once older than |
    |---|---|---|
    | `login:<normalized username>` | failed sign-in, `failure` | the longer of the per-username throttle window and lock window |
    | `login-lock:<normalized username>` | lock tripped, `failure` | the per-username lock |
    | `address:<address key>` | failed sign-in, `failure` | the address window |
    | `address-lock:<address key>` | lock tripped, `failure` | the address lock |
    | `rates:<principal id>` | lookup let through, `request` | 60 minutes |
    | `export:<principal id>` | export let through, `request` | 60 minutes |

    **A lock is its own row**, `login-lock:` or `address-lock:`,
    written in the transaction of the failure that tripped it, and
    holds while its `at` is within the lock's length. Nothing else
    decides whether a lock holds, because a lock derived from the
    failures in its window would lift early once the earliest of them
    aged out. The throttle and the rates and export limits are derived
    from the rows in their windows. No bucket holds an address in any
    other form. Deletion runs at process start and once a minute in
    each serving process (app-shell.md, Database), so at the defaults a
    failed connection's trace is gone within about a quarter of an
    hour.
  - Every limit here and the concurrency cap below is **operator
    config with the stated default** (app-shell.md, Configuration),
    because the right number depends on the deployment's exposure. The
    address window and address lock also set how long an address key
    is kept. Tests assert behaviour at the configured value: the limit
    engages, the lock holds and ends on time, and the response does not
    reveal whether the account exists.
- **Concurrency cap** on Auth Key verification: every
  `/api/auth/login`, real or decoy, runs Argon2id over the Auth Key at
  64 MiB, so N parallel attempts allocate N × 64 MiB before the rate
  limiter's verdict matters. Verifications run behind a limit of
  **default 4**, so peak Argon2id memory is about 256 MiB. A
  verification waits **at most 10 seconds** for a slot, then gets the
  ordinary throttle response.
- **Alerting is a structured log line.** Each lock logs one line at
  WARNING when it trips, never on the requests it refuses:
  `auth.lockout scope=username username=<name> lock_minutes=<n>` or
  `auth.lockout scope=address lock_minutes=<n>`. `<name>` is the
  normalized username as a JSON string, so a crafted username cannot
  forge a line. The address line carries no address and no address
  key. There is no email or push path.

### Storage & data handling

- **Blob and quota limits**: **64 KiB** per ciphertext blob, **50 000**
  records per vault, **32 MiB** total per user, rejected before the row
  reaches the database with Content Too Large (record-api.md).
  - These are **fixed by the spec**, not operator config, because the
    tests assert exact behavior at the boundary.
  - Each has an order of magnitude of headroom over decades of monthly
    recordings. They bound a runaway client or a hostile payload, not
    honest use.
- **Invite tokens**: ≥128-bit entropy, single-use, time-limited, stored
  hashed.
- **No client address and no device is kept.** No table, response or
  log line carries a client address, a user agent or a referrer. The
  `attempts` table's address keys are the one trace a connection
  leaves (Rate limiting).
  - gunicorn's access log format is exactly
    `%(t)s "%(m)s %(U)s" %(s)s %(b)s %(M)s`: time, method, path,
    status, bytes and milliseconds. Its default carries the peer
    address (`%(h)s`), the user agent (`%(a)s`) and the referrer
    (`%(f)s`), and the full request line (`%(r)s`) would log a live
    invite token from `/register?invite=` (admin-invites.md, Rules).
  - gunicorn's error log runs at `--log-level error`. gunicorn logs a
    request it cannot parse as `Invalid request from ip=<peer>` at
    WARNING, in the request error handler every worker class shares.
    In the pinned release no line at ERROR or above carries a client's
    address, only the server's own bind address. The app's own lines
    are unaffected: they go through the app's logger, which the flag
    does not set. gunicorn's INFO and WARNING lines (boot, worker
    exits, malformed requests) are what the deployment gives up. A
    logging filter that strips addresses is rejected, because it has to
    recognise every address form in every message, and a level drops
    the whole line. The image test sends malformed requests and fails
    on any log line carrying the peer's address (app-shell.md,
    Acceptance criteria), so an upgrade that moves the line up a level
    is caught.
  - **Every SQLite connection sets `PRAGMA secure_delete = ON`**, so a
    deleted row's bytes are overwritten rather than left in a free
    page.

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
