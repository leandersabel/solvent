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

- `SECRET_KEY` and any provider key are read from the environment
  (architecture.md, Tech stack).
- **The app refuses to start when `SECRET_KEY` is absent or empty**,
  rather than generating one. A generated key is new on every restart
  and silently invalidates every session row. A committed default is
  forgeable.
- No secret reaches a log line or an error page.

## CSRF

The `X-Solvent-Request` header check (architecture.md, Application
hardening) is middleware: it applies to every route unless that route
is named in the exempt list, and it runs before authentication.

Exempt are the routes meant to be reached by navigation: the
server-rendered shell pages themselves, and the static endpoint. Every
JSON endpoint requires the header, `GET /api/export` included. An
exemption is a named route, never a path pattern, so adding an endpoint
under an existing prefix cannot inherit one.

**The static endpoint is exempt because a browser cannot make it
otherwise.** No subresource request carries a custom header, so a
stylesheet or script fetched by `<link>` or `<script src>` would fail.
It is also a Public route (The two surfaces), which says why it needs
no session and why what it serves may be fetched by anyone.

**The header is checked per named route; the namespace picks only the
status a refusal carries.** The check runs before authentication and
before any handler, on every route not named exempt, wherever it sits.
Which status a refused request gets is decided by its namespace, the
header and the session, never by the route (architecture.md, Status
codes, Refusals), so no route's CSRF protection depends on its path and
no refusal depends on whether the path exists. Two invariants make the
split safe, and a route that would break either is a design change:

- **Every route that requires the header is in the API namespace**,
  under `/api/`. Outside it a missing header is refused with Not Found,
  which the app's own client reads as done on a `DELETE`.
- **Every route in the page namespace is a named navigation route or
  the static endpoint**, exempt from the header, and answers only `GET`
  and `HEAD`. So a page route changes nothing, and a cross-site
  navigation to one does nothing the header would have stopped.

No route answers `OPTIONS`: automatic `OPTIONS` responses are turned
off. No CORS headers are served, so the method has no use, and an
automatic answer carries an `Allow` header naming the route's methods,
which an invented path cannot imitate.

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
session reaches both. Every route in the product is in exactly one of
the groups below, and the group together with the session, and its
principal kind when there is one, decides whether the route answers at
all. The surface check is one step of the request gate (below), which
runs once per request, so no individual endpoint repeats it.

- **Public**, the routes that must answer a caller who holds no valid
  session, each for the reason given beside it. They answer a caller
  with no session and a session of either kind. Each is a named route:
  - `GET /login`, the sign-in screen, which is where a session is
    asked for (login.md).
  - `GET /register`, the invite landing, which a person opens before
    they have an account at all (register.md).
  - `POST /api/register`, which creates the account and starts its
    first session. The invite token gates it, not a session
    (register.md).
  - `POST /api/auth/salt`, because the sign-in derivation needs the
    salt and envelope before there is anything to authenticate with
    (login.md, Flow).
  - `POST /api/auth/login`, which issues the session (login.md, Flow).
  - `POST /api/auth/logout`, because signing out of an absent or
    expired session answers OK rather than being refused
    (account-settings.md, Session and lock). A client whose session
    lapsed can still sign out cleanly.
  - `GET /`, the root path, because a bookmark of the bare host has to
    work signed out (below).
  - The static endpoint, the framework's own `static` route, because
    every page served without a session, a vault page's sign-in card
    included, loads its stylesheet and scripts before a session exists. What it serves is public by construction: the design
    tokens, the client-side code, and the vendored libraries. Nothing
    under it depends on who asks.

  Public lifts the session requirement and nothing else. A Public JSON
  endpoint still requires the header (CSRF), and each keeps the checks
  and rate limits its own feature states.
- **Shared**, the routes every account needs to keep its credential
  current: `/api/auth/upgrade-kdf` and `/api/auth/change-password`.
  Both kinds reach these with a valid session.
- **Vault**, the record store, the rate lookup including
  `GET /api/rates/symbols`, export, import, `/api/sessions`,
  `/api/auth/logout-all`, `DELETE /api/auth/account`, `/settings`,
  `/settings/dimensions` and `/settings/export-import`, the dashboard, and every screen that renders
  vault data. A vault owner reaches these. **An administrator gets Not
  Found**, `/settings` included: settings exists only inside a vault
  (`account-settings.md`). The surface is decided before any handler
  runs, so an address that answers a vault owner with a redirect still
  answers an administrator with Not Found.
- **Administration**, the `/admin` shell page and **every**
  `/api/admin/*` endpoint, including ones no feature file has been
  written for yet. An administrator reaches these. **A vault owner
  gets Not Found.**

A session of the wrong kind is refused as architecture.md, Status
codes, Refusals says for a valid session. For an administrator on a
vault route the resulting Not Found is also literally accurate, because
that account has no vault for the route to address.

The **root path** resolves by kind: the Dashboard for a vault owner,
the Admin area for an administrator. It is the only route that
resolves to different content per kind, and it does so because a
bookmark of the bare host has to work for both. Without a session there
is no kind to resolve by, so it sends the visitor to the Dashboard,
whose sign-in card signs in both kinds and takes an administrator on to
the Admin area (`ui/unlock.md`).

**Public is a list of named routes; the other groups are placed by
prefix.** A route is public only by being named in Public, never by a
path pattern, so an endpoint added later beside `/api/auth/login` or
`/api/register` inherits no sessionless access, for the same reason a
header exemption is a named route (CSRF). No Public route is
`/admin` or under `/api/admin/`, so nothing on the administration
surface ever answers without a session. Outside Public, everything
under `/api/admin/` is administration and everything else that touches
a vault is vault, so a route added later is placed by where it sits
rather than by being added here. The administrator role is expected to
grow (`admin-invites.md`), and a surface rule that had to be edited for
each new task would eventually be edited wrong. A route matching no
group is unreachable, which is the safe direction to fail.

### The request gate

Every request passes these steps in order, before any handler runs,
and the first that refuses decides the response. Each refusal's status
is the one architecture.md, Status codes, Refusals gives for the
request's namespace, header and session, which is what these steps are
arranged to produce.

1. **Header.** A request in the API namespace without
   `X-Solvent-Request: 1` is Forbidden, resolved or not. No API route
   is exempt, so this step needs no routing.
2. **Authentication.** The session cookie is read and looked up.
   Absent, expired, revoked and badly signed are one outcome: no valid
   session.
3. **Unauthenticated API request.** A request in the API namespace with
   no valid session is Unauthorized unless it resolved to a Public
   route (The two surfaces), whether or not its path exists.
4. **Unresolved.** A request that did not resolve is Not Found. Only a
   page-namespace request, or an API request with a valid session,
   reaches this step.
5. **No session, page namespace.** A Public page is served. A vault
   navigation page is served and renders its own sign-in card, so the
   derivation that buys the session also buys the keys. Any other page
   is Not Found, which is what makes `/admin` answer a signed-out
   visitor exactly as an invented address does.
6. **Surface.** With a valid session, a route whose surface the
   session's kind does not reach is Not Found.

**A request is served only when** it resolves, it is exempt or carries
the header, and one of these holds: the route is Public; it is a vault
navigation page requested without a session; or the session is valid
and its kind reaches the route's group. Every other request is
refused.

**Unresolved means any routing outcome other than a match**: an
unknown path, a method the route does not answer, or an address the
router would redirect to its canonical form (architecture.md, Status
codes, Refusals). The URL map sets `merge_slashes = False`, so `//admin`
has no canonical form to be redirected to. The gate is the backstop
for every other redirect or Method Not Allowed the router would still
raise: it refuses the request as unresolved before either can be
answered.

**A refusal carries the headers every response carries** (Response
headers) **and no others**, and its body depends on its status and
namespace alone. No `Set-Cookie`, no `Allow`, no `Location`, and no
header a route sets on its own response, such as `Cache-Control:
no-store` on the vault shell or `Referrer-Policy` on admin pages. The
page-namespace Not Found renders nothing that depends on the session or
the kind.

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
- **A request to an unknown path** → refused exactly as a registered
  route the caller cannot reach would be in its namespace
  (architecture.md, Status codes, Refusals), carrying the same headers
  as any other response.
- **A method a route does not answer, or an address the router would
  redirect** (`POST /admin`, `DELETE /api/auth/salt`, `//admin`) →
  refused as an unknown path is, never Method Not Allowed and never a
  redirect (The request gate).
- **A state-changing request from a logged-out session** → Forbidden
  when the header is missing, because the check precedes authentication;
  Unauthorized when the header is present and the session is not,
  unless the route is Public (The two surfaces).
- **Lock pressed with unsaved form input** → the one named exception in
  login.md, Rules applies; the shell adds no confirmation of its own.
- **A vault owner or a signed-out visitor opens `/admin`** → Not Found,
  the same response as an invented address gets.
- **An administrator navigates to a vault route by typing it**
  (`/settings`) → Not Found, the same page an invented address gets. No
  message explains the kind mismatch, because explaining it is the
  thing Not Found is chosen over Forbidden to avoid.

## Acceptance criteria

- Every response — a shell page, a JSON endpoint, a Not Found, and a
  Server Error — carries the CSP byte-identical to architecture.md's,
  and carries HSTS.
- No screen produces a CSP violation in the browser console, and the
  Alpine build served is the CSP-safe one.
- A state-changing JSON request without `X-Solvent-Request` returns
  Forbidden and changes nothing; a shell navigation route loads without
  it.
- `GET /api/export` without the header returns Forbidden.
- A shell page's stylesheet, `shell.js`, and the Alpine bundle are all
  fetchable with no header and no session, and carry the same headers
  as any other response.
- **The refusal fingerprint matrix.** For each session state (absent,
  expired, vault owner, administrator) and each header state (absent,
  present), one cell. Within a cell, every request the gate refuses
  matches every other on status, body, and every header except `Date`,
  within its namespace, and carries the status architecture.md, Status
  codes, Refusals gives for that cell. The requests in each cell are:
  every registered route enumerated from the route map under every
  method it answers, kept where the gate refuses it; an invented page
  path; `//admin`; a method a registered route does not answer, in each
  namespace; `/api/invented`; and `/api/admin/invented`. A route added
  later joins the matrix without being listed.
- Without the header, a refusal in either namespace is identical across
  all four session states. With the header, a refusal to an expired
  session is identical to one to an absent session.
- The namespace invariant holds over the route map, enumerated at test
  time: every route requiring the header starts with `/api/`, and every
  route outside `/api/` is exempt from the header and answers only `GET`
  and `HEAD`. No route answers `OPTIONS`.
- In a real browser, top-level navigations to `/admin` signed out and
  as a vault owner, to `/settings` as an administrator, and to an
  invented page path each render the identical Not Found.
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
- The Public group is asserted over the route map, enumerated at test
  time, against the list in The two surfaces. With the header and no
  session, every Public route is passed by the gate, and every other
  registered API route is Unauthorized under every method it answers.
  Without a session, the only pages served are the Public pages and the
  vault navigation pages. No Public route is `/admin` or under
  `/api/admin/`. A route that answers without a session and is not
  named in Public fails the test.
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
- The lock button discards keys and decrypted state and shows
  re-unlock with no confirmation dialog, and the server session
  survives it (login.md, Rules).
- No response body originating in the shell contains vault plaintext.
