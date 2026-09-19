# Architecture

<!-- Edit this file directly. It's the top-level source of truth: what the
system is, what it's made of, and how the pieces talk to each other.
The product-owner agent reads this alongside spec/features/*.md and
spec/ui/*.md to compile implementation contracts. -->

## What Solvent is

A net worth tracker, self-hosted on the owner's own NAS.

- **Users**: a small number of accounts (e.g. household members), not open
  to the public. Each user has a separate vault: own password → own
  encryption key, nothing shared or visible between users. No
  shared/household view.

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
- **Database**: SQLite. Stores per-user salts, Auth Key hashes, wrapped
  DEKs, and ciphertext blobs. See Storage under Tech stack.
- **Build/deploy pipeline**: GitHub Actions + Dependabot → GHCR → manual
  pull on TrueNAS. See CI/CD under Tech stack.
- **Admin panel**: user provisioning is invite-only — an admin generates an
  invite link, and registration requires a valid, unused invite. No
  self-service sign-up.
- **Export/Import**: user-initiated export of a vault (ciphertext blobs,
  wrapped DEK, salt) to a local file — still fully encrypted, so the file
  exposes nothing without the password. Serves as a personal backup and
  as the migration path across data-model upgrades, distinct from the
  NAS-level ZFS backups (disaster recovery, not schema migration). Import
  reverses this to restore a vault.

## Data model

All entity content below (names, notes, classifications, values) is
encrypted client-side
per the Security model — the server sees ciphertext, not these fields.

- **User**: has one **main currency** — the currency all accounts
  normalize into for the total net-worth figure.
- **Account**: a holding, virtual (bank, brokerage, crypto exchange) or
  physical (gold, real estate, collectibles). Has a name, a native unit,
  a free-text **note**, and one **dimension assignment** per configured
  dimension. The unit is either a symbol from the operator's rate table
  (`USD`, `XAU-ozt`) or free text for something with no market price
  (`m²`) — and it **doubles as the account's rate symbol**, so a holding
  can never be measured in one unit and priced in another.
  Some accounts (private equity, a private loan, unlisted real estate)
  have no public price or rate source — the rate proposal is
  best-effort per snapshot, not required of the account.
- **Brokerage holdings are recorded at depot level**, not per position:
  one account whose native unit is the depot's reporting currency, and
  whose snapshot value is the total the broker reports — the same act as
  updating a bank account. A depot is therefore an ordinary currency
  account: a foreign-currency depot converts through the same FX path as
  a foreign-currency bank account, and a depot reporting in the user's
  main currency needs no rate at all. No shares, no tickers, no
  per-position rows. See Non-goals.
- **Dimension**: a named axis an account is classified along —
  "Liquidity" with values "Cash", "Retirement", and so on. An account
  carries **at most one value per dimension, structurally**: the
  account record's `dims` is a map from dimension id to value id, so a
  second value for one dimension cannot be expressed at all. That
  partition is what lets the stacked trend chart's bands sum to net
  worth (net-worth-view.md).
  - Dimensions and their values are identified by **short opaque ids
    generated at creation**, never by their display labels. Labels are
    therefore free text in any script, and renaming one rewrites no
    account record — only the profile. Ids also cannot collide with
    anything a user typed, which a label-derived key could.
  - The set of dimensions, their labels, and their value order is user
    configuration in the encrypted profile record (account-settings.md).
- **There is no freeform tag.** Every classification is a dimension,
  because an overlapping label is just a dimension with one value
  ("Emergency fund: yes", absence meaning no). Two taxonomies over the
  same accounts would mean two ways to spell one thing, and only one of
  them can be stacked, ordered, or summed honestly.
- **Snapshot**: a point-in-time value for one account: date, value in the
  account's native unit, and the conversion rate to the main currency
  used at entry time. The rate is always stored on the snapshot, not
  recomputed later — otherwise the trend chart would lie about the past
  as today's rate changes. The rate comes from the lookup proxy or manual
  entry; non-fetchable items (private investments, unlisted assets) have
  no proposal, so both value and rate are always manual.
- Accounts don't need a snapshot on every date — updates are sparse by
  design (you won't touch every account every time). The UI carries the
  last known value forward when charting net worth over time.

### Record storage API

Accounts, snapshots, and the user profile are all stored through one
generic record endpoint — the server has no per-type logic, because it
cannot read any type. A record row is:

| Column | Visibility | Notes |
|---|---|---|
| `user_id` | plaintext | owner; every query is scoped to the session's user |
| `record_id` | plaintext | client-generated UUIDv4 |
| `record_type` | plaintext | `account` \| `snapshot` \| `profile` |
| `account_id` | plaintext | the owning account for `snapshot`; empty otherwise |
| `schema_version` | plaintext | bumped when the plaintext shape changes |
| `version` | plaintext | monotonic, starts at 1, +1 per write |
| `nonce` | plaintext | fresh 96-bit random per encryption |
| `ciphertext` | opaque | AES-256-GCM under the DEK |
| `updated_at` | plaintext | server clock, for debugging |

Five of these columns — `record_id`, `record_type`, `account_id`,
`schema_version`, `version` — are exactly the AAD, so the server cannot
move a blob to a different slot within a vault without breaking
decryption. `user_id` is **not** part of the AAD: cross-vault relocation
is already impossible under the DEK boundary. See Key management for
both.

The plaintext columns are **metadata the server can see**: record
counts, which snapshots belong to which account, and write timestamps.
That is within the accepted metadata leak in the threat model — the
plaintext shape deliberately carries no name, value, date, or unit.

Endpoints (all session-authenticated, all CSRF-protected on writes):

- `GET /api/records?type=<t>` — all of the user's records of a type.
- `PUT /api/records/<record_id>` — create or update. The client sends
  the expected current `version`; the server rejects with Conflict if it
  differs, so a stale tab cannot silently clobber a newer write.
- `DELETE /api/records/<record_id>` — delete one record.

The server never accepts a `user_id` from the client; it is always taken
from the session.

**Conversion-rate lookup**: a server-side proxy/cache endpoint fetches
rates (FX, gold) from a public API and serves the entry-date "proposal"
to the client. Chosen over a direct client-side fetch: requests get
cached, and no browser individually leaks update timing to a third
party.
- **Privacy scope**: the proxy observes which asset types/currencies an
  authenticated user queries (gold, USD, CHF), never the amount held.
  Asset *type* is not confidential (knowing someone holds gold or
  dollars reveals nothing sensitive); the *amount* is what the
  zero-knowledge model protects, and that never reaches the proxy or
  server in any form.
  - This includes the user's **main currency**, which travels as the
    `quote` parameter on every lookup. It is stored only inside the
    encrypted profile record, never as a plaintext column — but the
    server learns it in the ordinary course of serving proposals. That
    falls under the same accepted-leak decision as asset type; it is not
    an oversight against register.md's storage rule.
- **Base-amount rule (hard requirement)**: every rate request queries the
  rate for a fixed, reasonable base unit (e.g. "price of 1 troy oz", a
  unit currency pair) — never the account's actual snapshot value. This
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
  because a brokerage holding is a depot-level account in a currency.
  `rate-lookup.md` holds the adapters, the seeded symbol table, and the
  rejected alternatives with the reason each fails.
- **One constraint binds every future provider**: a snapshot stores its
  rate permanently, inside user ciphertext the server cannot read,
  enumerate, or delete. Terms requiring deletion of all data on
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

Not Found carries three distinct conditions deliberately. Splitting
them would answer the question the attacker is asking — whether an id,
an account, or an admin route exists — so the three are
indistinguishable by construction rather than by convention.

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
  auth (`hash-wasm`, Alpine, anything in the auth/session path) are
  excluded from auto-merge regardless of bump level and always need
  manual review. Actions workflows run with least-privilege
  `permissions:` blocks, pin third-party actions by commit SHA, and use
  `pull_request` (never `pull_request_target`) so fork-triggered runs
  can't reach GHCR push secrets. Images are signed at push (cosign/
  sigstore) with an SBOM generated per build, so a pull can verify
  provenance beyond "the digest I was told." TrueNAS has no auto-pull for
  Custom Apps yet — it surfaces "update available" in the Apps UI, and you
  apply it by hand. Automating that pull is a future improvement.
- **Backend language**: Python.
- **Backend framework**: Flask, over FastAPI/Django. The app is small with
  no external API consumers, so FastAPI's async/auto-docs strengths don't
  pay for their ceremony, and Django's batteries (admin, settings,
  migrations) are more structure than needed. The server never decrypts
  anything (see Security), so it holds no session-scoped decryption key —
  a session row is just an identity after Auth Key verification, which
  any framework handles equally well. JSON endpoints that store/return
  ciphertext blobs (IV, nonce, tag, wrapped DEK) use Pydantic for
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
- **Frontend**: hybrid. Flask + Jinja2 + htmx server-renders the app shell
  (navigation, login/registration, layout) — nothing sensitive passes
  through it. Data screens (balances, net worth charts) render
  client-side: a small vanilla-JS/Alpine.js layer (no build step, matching
  htmx's philosophy) fetches ciphertext blobs from the JSON API, decrypts
  them in-browser with the session's Master Key, and renders the result —
  the server has nothing to template there, since it never has plaintext.

## Security

### Threat model

Actors this design defends against vs. accepts:

- **Network attacker** (on-path or off-path, passive or active): defended
  — TLS everywhere plus HSTS (see Network & transport) prevents both
  credential interception and in-transit tampering with the served
  crypto JS.
- **Malicious or curious server admin**: defended for *passive*
  observation — reading logs, attaching a debugger, dumping the DB — by
  the zero-knowledge model, and for ciphertext *tampering* (relocating,
  swapping, replaying a blob) by AAD binding (see Key management). Not
  defended against an admin who *actively* modifies the served JS to
  capture a password during login — whoever controls the served code
  controls that; closing it fully needs independent code
  signing/verification, out of scope here.
- **Malicious or compromised server process**: same boundary as the
  admin — can't decrypt anything, and cannot silently rearrange
  ciphertext without detection.
- **Another user of the same instance**: defended — per-user salts and
  keys throughout; no vault is decryptable with another user's password,
  and the admin account has no special decryption ability over any
  vault, including its own operator's.
- **Offline attacker with a DB dump or an export file**: only as
  defended as password strength × Argon2id cost, by construction (see
  Key management) — there is no rate limit on an offline attack.
- **Compromised dependency or CDN**: defended — all crypto/framework JS
  is self-hosted with Subresource Integrity, no third-party CDN sits
  inside the trust boundary (see Supply chain).
- **Accepted, not defended**: metadata leakage (login timestamps,
  per-user record counts, request sizes), plus whatever a deployment's
  own TLS-terminating intermediary (reverse proxy, CDN edge, tunnel)
  observes for connection metadata (see Network & transport). The
  conversion-rate lookup revealing queried asset *types* is also
  accepted, but deliberately — see Data model; the amount held is never
  exposed.

### Key management

- **Model: full client-side zero-knowledge encryption.** Server-side
  envelope encryption was rejected because it puts the admin inside the
  trust boundary — anything the server decrypts, the admin can observe,
  even unintentionally. Zero-knowledge means there's no plaintext on the
  server to leak, by construction.
- **Key derivation (per user, browser-side only)**: password + per-user
  salt → Argon2id via **`hash-wasm`** (not native Web Crypto PBKDF2,
  which is weaker) → HKDF-split into two keys:
  - `hash-wasm` ships one small WASM module per algorithm, so the
    self-hosted, SRI-pinned artifact covers Argon2id and nothing else —
    the smallest thing that can be audited and re-pinned on a bump. CI
    asserts a published RFC 9106 Argon2id test vector, which is what
    makes a smaller library as trustworthy here as a larger one: the
    primitive has known-answer tests and this uses exactly one
    primitive.
  - **libsodium.js rejected**: a few hundred KB of Emscripten port to
    reach one function, and its Emscripten heap is where a 256 MiB
    `memlimit` would need verifying on every target browser. The audited
    C provenance is real but does not survive the port unexamined, and
    it buys nothing a known-answer test does not.
  - **Master Key** — never leaves the browser; encrypts/decrypts the
    user's data-encryption key (DEK).
  - **Auth Key** — sent to the server at login to verify identity, stored
    server-side only as a hash. Can't derive the Master Key or decrypt
    anything.
  - **Starting parameters**: Argon2id, memory ≥256 MiB, ≥3 iterations,
    parallelism 1 (single-threaded WASM) — re-benchmarked against actual
    target client hardware before ship, raised if headroom allows.
  - **Versioned envelope**: the KDF algorithm, version, and parameters
    (memory/iterations/parallelism) are stored alongside the per-user
    salt and wrapped DEK, not hardcoded — so a login can detect stale
    parameters and transparently re-wrap the DEK after a successful
    unlock, which is how parameters get raised later without breaking
    existing vaults.
  - **The server's current default envelope is embedded in every
    server-rendered page**: the registration page (register.md) and the
    authenticated app shell (`ui/design-system.md`, App shell). Any
    client-side flow that must derive at *current* parameters — a
    registration, a password change (account-settings.md) — reads it
    from the page it is already on, with no extra round-trip and one
    source for the value. Login is the one exception, because it runs
    before the shell exists: it carries the envelope on the salt
    response, and the target envelope on `kdfStale`.
- **DEK envelope**: a random per-user DEK is generated client-side,
  encrypted with the Master Key, and stored server-side as an opaque blob
  the server can't decrypt. All financial data is encrypted client-side
  with the DEK (AES-256-GCM) before it's sent; the server stores and
  returns ciphertext only.
  - **Nonce strategy**: a fresh random 96-bit nonce for every encryption
    operation, including re-encrypting an existing record on edit — never
    reuse a record's previous nonce. Collision risk is negligible at this
    data volume (well below 2³² messages under one key); revisit DEK
    rotation only if a single vault ever approaches that bound.
  - **Data integrity (AAD binding)**: every blob's GCM Additional
    Authenticated Data is set to `account_id ‖ record_type ‖ record_id
    ‖ schema_version ‖ monotonic_version`. Decryption fails if the
    server relocates, swaps, or rolls back a blob to a different
    logical slot within a vault — AES-GCM's per-blob authentication
    alone protects contents but not arrangement. `record-api.md` pins
    the byte encoding.
  - **`user_id` is deliberately *not* in the AAD**, because the DEK
    boundary already makes a blob undecryptable in another user's
    vault. Two things follow: **the client never needs to know its own
    `user_id`, and no endpoint returns one**, and a vault transfer
    **re-keys** rather than re-binds, so the two vaults share no key
    material afterwards. `record-api.md` argues the first,
    `export-import.md` the second.
  - A client-maintained, DEK-authenticated manifest (expected record
    IDs + versions) would additionally catch wholesale deletion of the
    set — worth revisiting post-v1, not required to ship.
- **Session key handling**: Master Key and unwrapped DEK live only in
  browser memory for the session (not localStorage/sessionStorage, to
  limit XSS exposure) — a page refresh requires re-deriving them from the
  password.
- **Reference pattern**: this split follows audited zero-knowledge
  password managers (e.g. Bitwarden), not a novel design — the point is
  that the server never holds a secret that doubles as both
  authenticator and decryption key.
- Per-user salts and keys give the isolation guarantee in Threat model
  ("Another user of the same instance").
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
  on TrueNAS, no inbound port opened); that's this deployment's choice,
  not a spec requirement — a different operator self-hosting Solvent may
  choose LAN-only or a plain reverse proxy instead.

### Application hardening

- **CSP**: `default-src 'none'; script-src 'self'; connect-src 'self';
  img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri
  'none'; form-action 'self'` — no `unsafe-inline`/`unsafe-eval`.
  `connect-src` is `'self'` alone: the rate provider is reached through
  the server-side proxy (see Data model), so the browser never contacts
  it directly and whitelisting its host would open a hole with no user.
- **Alpine.js must use its CSP-safe build** (the standard build needs
  `unsafe-eval` for `x-` expressions, which would gut the CSP above).
- **Decrypted content is always untrusted output**: render with
  `textContent`/Alpine `x-text` only, never `innerHTML`/`x-html` —
  account names, notes, dimension labels, and any imported data are
  attacker-influenceable
  and rendered client-side, where XSS means password/Master Key capture,
  not just session theft.
- **Sessions are server-side rows**, not self-contained signed cookies:
  `(id, token_hash, user_id, issued_at, last_active_at)`. The cookie
  carries only a random session token, signed with the Flask
  `SECRET_KEY`; the server looks the session up by the token's hash. No
  key material of any kind rides in the cookie. Server-side rows are
  what make sessions enumerable and revocable, which the product
  requires in four places: listing active sessions, "log out
  everywhere", invalidating every other session on a password change or
  an import, and the absolute 12-hour expiry (account-settings.md,
  export-import.md). `id` is a separate opaque handle — it is what
  `GET /api/sessions` returns, so no response ever hands JavaScript the
  cookie's own value.
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
  - These three are **compiled-contract parameters**, not operator
    config: the Content Too Large tests assert exact behaviour at a
    boundary, and a boundary that moves per deployment is one the
    contract cannot state.
  - Every one has an order of magnitude of headroom. A snapshot payload
    is a few hundred bytes; thirty accounts updated monthly for thirty
    years is ~11 000 records and a few MB. The caps exist to bound a
    runaway client or a hostile payload, not to ration honest use, and
    they are not load-bearing on security.
- **Invite tokens**: ≥128-bit entropy, single-use, time-limited, stored
  hashed at rest, invalidated on first use.
- **Import authorization**: strict schema/size validation on the
  imported file (client and server), and the server ties every imported
  record to the authenticated user's own vault only — one user's import
  can never write into another user's vault. Overwrite-vs-merge
  semantics must be explicit in the Export/Import feature spec.

### Supply chain

- All crypto and framework JS/WASM (`hash-wasm`, Alpine) is self-hosted
  from the app origin with pinned versions and Subresource Integrity
  hashes — never loaded from a third-party CDN, which would otherwise
  sit inside the trust boundary and could silently exfiltrate passwords
  via a malicious script. CI/CD supply-chain controls (image signing,
  dependency-merge policy) live under Tech stack.
- **That list is two entries, and it is meant to stay short**, because
  every third-party file in the browser is one more thing to pin, hash,
  re-verify on a bump, and trust with a page that handles the password.
  That is why decimal arithmetic is written against `BigInt`
  (record-snapshot.md) and the trend chart is drawn in SVG
  (net-worth-view.md) rather than pulled in.

## Non-goals

- No transaction-level spending tracking or budgeting/expense
  categorization.
- No automated bank sync / Plaid-style integration — conflicts with
  zero-knowledge encryption, since a third party can't encrypt on the
  user's behalf.
- No position-level tracking of listed securities — no share counts, no
  tickers, no cost basis, no per-holding performance. A brokerage
  account is one depot-level figure the user reads off their broker, the
  same act as updating a bank balance (see Data model).
- No mobile app — responsive web only.
- No shared/household view — vaults are private per user.
- No multi-tenant/public hosting — single instance, small fixed set of
  invited users.
