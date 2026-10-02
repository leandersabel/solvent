# App shell

## What it does

One Flask application wraps every other feature: it sets the response
headers, enforces the CSRF header, issues and reads the session cookie,
opens the SQLite file, and renders the chrome the authenticated screens
sit inside. Each is stated once here and holds for every route.

The shell never handles plaintext financial data (architecture.md,
Components). What it renders as text is nav labels, the wordmark, and
the current default KDF envelope (architecture.md, Key management).

## Response headers

Set in one place and carried by every response, including error
responses:

- **CSP** — the literal policy in architecture.md, Application
  hardening. It does not vary by route. A route that would need a
  looser policy is a design change, not a local override.
- **HSTS** — as stated in architecture.md, Network & transport,
  including the condition on `preload`.

No separate `X-Frame-Options` is served: `frame-ancestors 'none'` in
the CSP covers framing, and a second header stating the same thing is a
second thing to keep in sync.

## Configuration

- `SECRET_KEY` is read from the environment (architecture.md, Tech
  stack).
- **The app refuses to start when `SECRET_KEY` is absent or empty**,
  rather than generating one. A generated key is new on every restart
  and silently invalidates every session row. A committed default is
  forgeable.
- No secret reaches a log line or an error page.

## CSRF

The `X-Solvent-Request` header check (architecture.md, Application
hardening) is step 1 of the request gate.

Exempt are the routes meant to be reached by navigation: the
server-rendered shell pages and the static endpoint. An exemption is a
named route, never a path pattern, so an endpoint added under an
existing prefix cannot inherit one. The static endpoint is exempt
because no subresource request carries a custom header.

**Every page declares the app's icon from the static endpoint**, error
pages included: `<link rel="icon" href="<static>/icon.png"
type="image/png">`, a transparent 1x1 PNG. A page that declares none
makes the browser request `/favicon.ico`, which the request gate refuses
like any invented path, and the refusal is a console error. There is no
`/favicon.ico` route, because it would answer a path nothing links to.
The icon is not a `data:` URL, because `img-src 'self'` blocks it.

## Database

One place creates the schema and opens the SQLite file on its writable
volume (architecture.md, Tech stack). Each table's columns are stated
by the feature that owns them: records (record-api.md), principals and
credentials (register.md), DEK wrappers (register.md), invites
(admin-invites.md), sessions (architecture.md, Application hardening).

`principals` carries identity and kind and nothing else, so the columns
the shell needs to resolve a session and choose a nav are its whole
column set: no key material is a column of `principals`
(architecture.md, Accounts on this instance). Registration adds the
separate `credentials` and `dek_wrappers` tables rather than extending
this one.

**Every process start fills a null `principals.last_login_at` with the
row's `created_at`**, in the one write transaction that creates the
schema, before any request is served. Every account has signed in by
the time it exists (login.md, The session a sign-in issues), so the
column is never null where a request can read it, whichever build
wrote the row. The DDL leaves the column nullable and the schema
version unchanged: SQLite cannot add `NOT NULL` to an existing column
without rebuilding `principals`, and a database at another schema
version is refused at start, because this schema has no migration
path beyond export and import.

The schema is created in one place, so its triggers live here:

- a `BEFORE INSERT` on `records` and
- a `BEFORE INSERT` on `dek_wrappers`

each resolving the row's principal and aborting when its `kind` is
`administrator`. They are the storage-layer half of "an administrator
has no vault" (architecture.md, Credentials and vault key wrappers).
A SQLite `CHECK` cannot reach another table, which is why this is a
trigger and not a column constraint. Nothing in the application is
expected to hit them. They exist so that a future feature that would
has to be written deliberately.

## The two surfaces

There are two surfaces, the vault and the administration, and no
session reaches both. Every route is in exactly one of the groups
below. The request gate (below) checks the group against the session
once per request, so no endpoint repeats it.

- **Public**, the routes that answer without a session, to anyone:
  - `GET /login` and `POST /api/auth/login` (login.md).
  - `POST /api/auth/salt`, needed before there is anything to
    authenticate with (login.md, Flow).
  - `GET /register` and `POST /api/register`, gated by the invite
    rather than a session (register.md).
  - `POST /api/auth/logout`, which answers OK to an absent or expired
    session (account-settings.md, Session and lock).
  - `GET /`, the root path (below).
  - The framework's `static` route, whose files every signed-out page
    loads and which depend on nobody.

  Public lifts the session requirement and nothing else: a Public API
  route still requires the header and keeps its own feature's checks
  and rate limits.
- **Shared**, the routes every account needs to keep its credential
  current: `/api/auth/upgrade-kdf` and `/api/auth/change-password`.
  Both kinds reach these with a valid session.
- **Vault**, the record store, the rate lookup including
  `GET /api/rates/symbols`, export, import, `/api/sessions`,
  `/api/auth/logout-all`, `DELETE /api/auth/account`, `/settings`,
  `/settings/dimensions` and `/settings/export-import`, the dashboard, and every screen that renders
  vault data. A vault owner reaches these. **An administrator gets Not
  Found**, `/settings` included: settings exists only inside a vault
  (`account-settings.md`). A route that redirects a vault owner still
  answers an administrator Not Found.
- **Administration**, the `/admin` shell page and **every**
  `/api/admin/*` endpoint, including ones no feature file has been
  written for yet. An administrator reaches these. **A vault owner
  gets Not Found.**

The **root path** resolves by kind: the Dashboard for a vault owner,
the Admin area for an administrator. It is the only route that
resolves to different content per kind, and it does so because a
bookmark of the bare host has to work for both. Without a session there
is no kind to resolve by, so it sends the visitor to the Dashboard,
whose sign-in card signs in both kinds and takes an administrator on to
the Admin area (`ui/unlock.md`).

**Public is a list of named routes, never a path pattern**, and names
nothing at `/admin` or under `/api/admin/`. The other groups are placed
by prefix: outside Public, everything under `/api/admin/` is
administration and everything else that touches a vault is vault, so a
route added later is placed by where it sits. A route matching no group
is unreachable.

### The request gate

Every request passes these steps in order, before any handler runs.
The first that refuses decides the response, at the status
architecture.md, Refusals gives.

1. **Header.** An API request without `X-Solvent-Request: 1` is
   refused. No API route is exempt, so this needs no routing.
2. **Authentication.** The session cookie is read and looked up.
3. **No session, API.** An API request with no valid session is
   refused unless it resolved to a Public route.
4. **Unresolved.** A request that did not resolve is refused.
5. **No session, page.** A Public page is served. A vault navigation
   page is served and renders its own sign-in card. Any other page is
   refused.
6. **Surface.** A route whose group the session's kind does not reach
   is refused.

The URL map sets `merge_slashes = False` and turns off automatic
`OPTIONS` responses. Any other redirect or Method Not Allowed the
router would raise is refused at step 4.

A refusal carries only the headers every response carries (Response
headers), and its body depends only on its status and namespace: no
`Set-Cookie`, `Allow` or `Location`, and no header a route sets on its
own response, such as `Cache-Control: no-store` or `Referrer-Policy`.

## The chrome

Layout, the nav, the global Update values action, the lock button, and
the content max-width are specified in ui/design-system.md, App shell.
This feature renders that shell; each screen spec describes only its
own content region.

The chrome differs by kind, and it differs by omission rather than by
rearrangement:

| | Vault owner | Administrator |
|---|---|---|
| Nav | Dashboard, Settings | none |
| Update values | shown | absent |
| Right-hand control | Lock | Sign out |
| Embedded KDF envelope | yes | yes |
| Record and decryption layer | loaded | not loaded |
| Argon2id worker | loaded | loaded |

- **An administrator's bar carries a wordmark and Sign out and nothing
  else.** No Dashboard, no Settings, no Admin entry: with one
  destination there is nothing for a nav to navigate between, and
  every other entry would answer Not Found. Movement inside the admin
  area is that area's own business (`ui/admin.md`).
- **The right-hand control is Lock for a vault owner and Sign out for
  an administrator**, because Lock means "drop the keys and keep the
  session" and an administrator has no keys to drop.
- **Update values is absent, not disabled.** It opens a vault flow.
- **The Argon2id worker still ships to an administrator**, because
  changing their password derives at current parameters like any other
  account, and because a stale-KDF upgrade can fire on any sign-in
  (login.md).
- **The current default KDF envelope is still embedded**
  (architecture.md, Key management), for the same reason.

## Inputs / outputs

- **In**: the session cookie (or none), the environment, and the
  requested route.
- **Out**: an HTML document for a shell route, or the wrapped response
  of the JSON endpoint that handled the request — headers identical
  either way.

## Rules

- The shell is Flask + Jinja2 + htmx (architecture.md, Components). No
  key derivation, decryption, or vault rendering happens here; that is
  the client-side data layer.
- The Alpine build served is the CSP-safe one (architecture.md,
  Application hardening).
- The vault surface is **one shell page**. `/dashboard` carries every
  screen behind the gate, settings and dimensions included, as
  in-page addresses. The keys live in that page's memory and nowhere
  else, so a second shell page would discard them and charge the
  Argon2id derivation again in the same sitting (`ui/unlock.md`).
  `/settings`, `/settings/dimensions` and `/settings/export-import`
  remain routes on the vault surface, each redirecting to the view it names, so a bookmark or a
  typed address still lands on that screen.
- A screen's content region is never server-rendered from vault data,
  because the server has no plaintext to render.

## Edge cases

- **`SECRET_KEY` unset or empty** → the app does not start, and the
  failure names the variable without printing any value.
- **Lock pressed with unsaved form input** → the one named exception in
  login.md, Rules applies; the shell adds no confirmation of its own.
- **An administrator navigates to a vault route by typing it**
  (`/settings`) → the Not Found an invented address gets, with nothing
  about the kind.

## Acceptance criteria

- Every response — a shell page, a JSON endpoint, a Not Found, and a
  Server Error — carries the CSP byte-identical to architecture.md's,
  and carries HSTS.
- No screen, the error pages reached by navigation included, produces
  any error in the browser console, and the Alpine build served is the
  CSP-safe one.
- Every shell page and every error page declares the app's icon from
  the static endpoint, the icon is fetchable with no header and no
  session, and `/favicon.ico` is refused exactly as an invented page
  path is.
- A state-changing JSON request without `X-Solvent-Request` returns
  Forbidden and changes nothing; a shell navigation route loads without
  it.
- `GET /api/export` without the header returns Forbidden.
- A shell page's stylesheet, `shell.js`, and the Alpine bundle are all
  fetchable with no header and no session, and carry the same headers
  as any other response.
- **Refusal fingerprint matrix.** Under every session state (absent,
  expired, vault owner, administrator) and header state (absent,
  present), every refused request has the status architecture.md,
  Refusals gives, and matches every other refusal of the same status,
  API or page, on body and every header except `Date`.
  The requests: every route in the route map under every method it
  answers, an invented page path, `//admin`, an unanswered method on
  a page and an API route, `/api/invented` and `/api/admin/invented`.
- Over the route map, every route requiring the header is under
  `/api/`, every other route is exempt and answers only `GET` and
  `HEAD`, and no route answers `OPTIONS`.
- In a real browser, `/admin` signed out and as a vault owner,
  `/settings` as an administrator, and an invented page path render
  the identical Not Found.
- Starting the app with `SECRET_KEY` unset fails, and the message
  contains the variable name and no key material.
- Nav shows Dashboard and Settings for a vault owner. An
  administrator's bar shows no nav entries at all, and its only
  control is Sign out. There is no Holdings entry and no Admin entry
  in either bar.
- An administrator session receives Not Found from `/settings`,
  `/api/sessions`, and `/api/auth/logout-all`, and OK from
  `/api/auth/change-password`.
- An administrator session receives Not Found from every vault route
  and a vault owner session receives Not Found from every
  administration route, asserted by enumerating every registered route
  and calling each with a session of both kinds. A route that answers
  something other than Not Found to the wrong kind, or that appears in
  no group, fails the test.
- Over the route map, with no session, the gate passes exactly the
  Public routes (with the header, for API routes) and the vault
  navigation pages, and refuses every other route under every method.
- An administrator's `GET /api/records` returns Not Found, not an
  empty list, asserted specifically (`record-api.md`).
- The root path renders the Dashboard for a vault owner and the Admin
  area for an administrator, and neither session can reach the other's
  through it.
- An administrator session's page loads the Argon2id worker and does
  not load the record or decryption layer.
- An administrator session's chrome carries no Update values action,
  no Lock button, and no nav entries.
- Inserting a `records` row or a `dek_wrappers` row whose principal is
  an administrator is rejected by the database itself, asserted
  against the schema with a direct SQL insert rather than through an
  endpoint.
- Starting the app on a database holding a `principals` row with a
  null `last_login_at` leaves that row's `last_login_at` equal to its
  `created_at`, leaves every non-null `last_login_at` as it was, and
  leaves the file's schema version unchanged. Starting it again
  changes nothing.
- The lock button discards keys and decrypted state and shows
  re-unlock with no confirmation dialog, and the server session
  survives it (login.md, Rules).
- No response body originating in the shell contains vault plaintext.
