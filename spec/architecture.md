# Architecture

<!-- Edit this file directly. It's the top-level source of truth: what the
system is, what it's made of, and how the pieces talk to each other.
The product-owner agent reads this alongside spec/features/*.md and
spec/ui/*.md to compile implementation contracts. -->

## What Solvent is

A net worth tracker, self-hosted on the owner's own NAS.

- **Users**: not single-user — a small number of accounts (e.g. household
  members), not open to the public. Each user has a fully separate,
  privately encrypted vault: own password → own encryption key, no data
  shared or visible between users. No shared/household view.

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

All entity content below (names, tags, values) is encrypted client-side
per the Security model — the server sees ciphertext, not these fields.

- **User**: has one **main currency** — the currency all accounts
  normalize into for the total net-worth figure.
- **Account**: a holding, virtual (bank, brokerage, crypto exchange) or
  physical (gold, real estate, collectibles). Has a name, a native unit
  (currency code, or an asset unit like troy oz or shares), and any
  number of **tags**. Some accounts (private equity, a private loan,
  unlisted real estate) have no public price or rate source — the rate
  proposal is best-effort per snapshot, not required of the account.
- **Tag**: user-defined, freeform (e.g. "cash", "investment",
  "retirement"), many-to-many with accounts — used for grouping/slicing
  in the UI.
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
| `updated_at` | plaintext | server clock, for sync and debugging |

The first six columns are exactly the AAD (see Key management), so the
server cannot move a blob to a different slot without breaking
decryption. They are also, by construction, **metadata the server can
see**: record counts, which snapshots belong to which account, and write
timestamps. That is within the accepted metadata leak in the threat
model — the plaintext shape deliberately carries no name, value, date,
or unit.

Endpoints (all session-authenticated, all CSRF-protected on writes):

- `GET /api/records?type=<t>` — all of the user's records of a type.
- `PUT /api/records/<record_id>` — create or update. The client sends
  the expected current `version`; the server rejects with 409 if it
  differs, so a stale tab cannot silently clobber a newer write.
- `DELETE /api/records/<record_id>` — delete one record.

The server never accepts a `user_id` from the client; it is always taken
from the session.

**Conversion-rate lookup**: a small server-side proxy/cache endpoint
fetches rates (FX, gold, stocks) from a public API and serves the
entry-date "proposal" to the client. Chosen over a direct client-side
fetch: requests get cached, and no browser individually leaks update
timing to a third party.
- **Privacy scope (resolved)**: the proxy does observe which asset
  types/currencies an authenticated user queries (gold, AAPL, CHF) — but
  never the amount held. Per owner's call, asset *type* is not
  confidential (knowing someone holds gold or AAPL reveals nothing
  sensitive); the *amount* is what the zero-knowledge model protects, and
  that never reaches the proxy or server in any form.
- **Base-amount rule (hard requirement)**: every rate request queries the
  rate for a fixed, reasonable base unit (e.g. "price of 1 troy oz",
  "1 share", a unit currency pair) — never the account's actual snapshot
  value. This is what keeps amounts out of the request entirely; enforce
  it client-side as a requirement, not an incidental property of the API
  shape.
- **SSRF hardening**: the outbound request's host/provider is never
  client-influenced — providers and endpoints are server-side
  whitelisted, symbols are validated against a strict allowlist/regex
  before use, redirects are disabled, and egress has a timeout. This
  matters because the proxy runs in an environment with reachable
  internal NAS services.
- **FX provider (resolved 2026-08-01): Frankfurter's public instance at
  `api.frankfurter.dev`.** Free, no API key, no daily or monthly quota,
  aggregating 84 central banks across 201 currencies with history back
  to 1948. Chosen over self-hosting the same open-source service on the
  NAS because it adds no container, no writable volume, no `FROM` digest
  for Dependabot to track, and nothing extra to pull by hand on a
  platform with no auto-pull — while landing exactly on the privacy line
  already drawn above: it observes which currencies are queried, never
  an amount, because the base-amount rule leaves no parameter an amount
  could travel in. The decision is deliberately cheap to unwind — self
  hosting runs the same software, so switching is one host constant in
  the server-side whitelist.
- **Metals and listed equities are still unresolved** — tracked in
  `spec/questions.md`. Those are also where data licensing needs
  checking: this design caches past rates indefinitely, which several
  commercial providers forbid. Frankfurter carries no such restriction
  and asks only that heavy users cache, which this design already does.

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
  auth (`hash-wasm`/libsodium.js, Alpine, anything in the auth/session
  path) are excluded from auto-merge regardless of bump level and always
  need manual review. Actions workflows run with least-privilege
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
  sessions just carry a logged-in flag after Auth Key verification, which
  any framework handles equally well. JSON endpoints that store/return
  ciphertext blobs (IV, nonce, tag, wrapped DEK) use Pydantic for
  validation, added directly into Flask rather than adopting FastAPI for
  that one benefit.
- **Storage**: SQLite. The server only stores opaque values (ciphertext
  blobs, wrapped DEKs, Auth Key hashes, per-user salts) and never holds
  plaintext, so no server-side encryption-at-rest layer (e.g. SQLCipher)
  is needed for confidentiality — SQLite is chosen for operational
  simplicity (single file, no separate DB service), not its own
  encryption. The disk file still deserves protection as defense in
  depth, but the security guarantee doesn't depend on it.
- **Frontend**: hybrid. Flask + Jinja2 + htmx server-renders the app shell
  (navigation, login/registration, layout) — nothing sensitive passes
  through it. Data screens (balances, net worth charts) render
  client-side: a small vanilla-JS/Alpine.js layer (no build step, matching
  htmx's philosophy) fetches ciphertext blobs from the JSON API, decrypts
  them in-browser with the session's Master Key, and renders the result —
  the server has nothing to template there, since it never has plaintext.

<!-- Leave blank if undecided — the product-owner agent should flag this
in spec/questions.md rather than choosing for you. -->

## Security

### Threat model

Actors this design defends against vs. accepts, named explicitly so
nothing gets resolved by inference downstream:

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
  admin — can't decrypt anything, and can no longer silently rearrange
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
  salt → Argon2id via WASM (e.g. `hash-wasm` or libsodium.js — not native
  Web Crypto PBKDF2, which is weaker) → HKDF-split into two keys:
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
    Authenticated Data is set to `user_id ‖ account_id ‖ record_type ‖
    record_id ‖ schema_version ‖ monotonic_version`. Decryption fails if
    the server relocates, swaps, or rolls back a blob to a different
    logical slot — AES-GCM's per-blob authentication alone protects
    contents but not arrangement, so this closes that gap. A
    client-maintained, DEK-authenticated manifest (expected record IDs +
    versions) would additionally catch wholesale deletion of the set —
    worth revisiting post-v1, not required to ship.
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
  account names, tags, and any imported data are attacker-influenceable
  and rendered client-side, where XSS means password/Master Key capture,
  not just session theft.
- **Session cookies**: `HttpOnly`, `Secure`, `SameSite=Lax`. Flask
  `SECRET_KEY` must be a strong value injected externally (TrueNAS app
  env), never a default or committed value — a weak/leaked key forges
  sessions with no password needed.
- **CSRF**: state-changing JSON endpoints (store-blob, invite, import,
  password change) require `SameSite` plus a CSRF token or a required
  custom header — same-origin cookie auth is not implicitly CSRF-safe.
- **Login enumeration**: the salt-fetch step returns a deterministic
  decoy salt (`HMAC(server_secret, normalized_username)`) for unknown
  identifiers, with constant-time, identically-shaped responses for real
  vs. fake accounts — invite-only registration protects sign-up, not
  whether an account already exists.
- **Rate limiting**: per-account and per-IP limits with exponential
  backoff and lockout/alerting on the login and salt-fetch endpoints.
  Argon2id runs client-side, so the server's per-attempt cost is cheap —
  throttling is the only thing standing between an online attacker and
  unlimited guesses.

### Storage & data handling

- **Blob and quota limits**: max ciphertext blob size, max records per
  vault, and a total per-user storage quota (starting point: low tens of
  MB per user — generous for years of manual snapshots across a
  household's accounts, adjustable, not itself load-bearing on
  security). Reject oversized payloads before they hit the DB.
- **Invite tokens**: ≥128-bit entropy, single-use, time-limited, stored
  hashed at rest, invalidated on first use.
- **Import authorization**: strict schema/size validation on the
  imported file (client and server), and the server ties every imported
  record to the authenticated user's own vault only — one user's import
  can never write into another user's vault. Overwrite-vs-merge
  semantics must be explicit in the Export/Import feature spec.

### Supply chain

- All crypto and framework JS/WASM (`hash-wasm`/libsodium.js, Alpine) is
  self-hosted from the app origin with pinned versions and Subresource
  Integrity hashes — never loaded from a third-party CDN, which would
  otherwise sit inside the trust boundary and could silently exfiltrate
  passwords via a malicious script. CI/CD supply-chain controls (image
  signing, dependency-merge policy) live under Tech stack.

## Non-goals

- No transaction-level spending tracking or budgeting/expense
  categorization.
- No automated bank sync / Plaid-style integration — conflicts with
  zero-knowledge encryption, since a third party can't encrypt on the
  user's behalf.
- No mobile app — responsive web only.
- No shared/household view — vaults are private per user.
- No multi-tenant/public hosting — single instance, small fixed set of
  invited users.
