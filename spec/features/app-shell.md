# App shell

## What it does

One Flask application wraps every other feature: it sets the response
headers, enforces the CSRF header, issues and reads the session cookie,
opens the SQLite file, and renders the chrome the authenticated screens
sit inside. Each of those is stated once here and holds for every
route.

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
  rather than generating one. A generated key is new on every restart,
  which silently invalidates every session row; a committed default is
  forgeable. Failing at startup makes a misconfigured deployment
  obvious before it serves a request.
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
stylesheet or script fetched by `<link>` or `<script src>` would fail,
and the unauthenticated screens have no session to offer either. It
stays one named endpoint rather than a path pattern, and what it serves
is public by construction: the design tokens, the client-side code, and
the vendored Alpine build, all of which any visitor may read.

**The check also runs before routing.** A request without the header is
Forbidden whether or not the path resolves, so a probe cannot learn
which routes exist by comparing Forbidden against Not Found. Not Found
is reserved for a caller who got past the header (architecture.md,
Status codes), which is the construction that makes its three
conditions indistinguishable.

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

Two triggers live here, because they are schema and the schema is
created in one place:

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
session reaches both. Routes that belong to neither are shared.

Every route in the product is in exactly one of the three groups
below, and the group together with the session's principal kind
decides whether the route answers at all. The check sits beside the
CSRF middleware and runs immediately after authentication, once, so no
individual endpoint repeats it.

- **Shared**, the routes every account needs to hold a
  credential and a session: `/login`, `/api/auth/salt`,
  `/api/auth/login`, `/api/auth/logout`, `/api/auth/upgrade-kdf`, and
  `/api/auth/change-password`. Both kinds reach these.
- **Vault**, the record store, the rate lookup including
  `GET /api/rates/symbols`, export, import, `/api/sessions`,
  `/api/auth/logout-all`, `DELETE /api/auth/account`, the `/settings`
  shell page, the dashboard, and every screen that renders vault
  data. A vault owner reaches these. **An administrator gets Not
  Found**, `/settings` included: settings exists only inside a vault
  (`account-settings.md`).
- **Administration**, the `/admin` shell page and **every**
  `/api/admin/*` endpoint, including ones no feature file has been
  written for yet. An administrator reaches these. **A vault owner
  gets Not Found.**

Not Found in both directions, never Forbidden, and for the same reason
in both: Forbidden confirms the route exists (architecture.md, Status
codes). For an administrator on a vault route it is also literally
accurate, because that account has no vault for the route to address.

The **root path** resolves by kind: the Dashboard for a vault owner,
the Admin area for an administrator. It is the only route that
resolves to different content per kind, and it does so because a
bookmark of the bare host has to work for both.

**The membership rule is a prefix, not a list.** Everything under
`/api/admin/` is administration and everything else that touches a
vault is vault, so a route added later is placed by where it sits
rather than by being added here. The administrator role is expected to
grow (`admin-invites.md`), and a surface rule that had to be edited
for each new task would eventually be edited wrong. A route matching
no group is unreachable, which is the safe direction to fail.

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
- A screen's content region is never server-rendered from vault data,
  because the server has no plaintext to render.
- Headers and the CSRF check apply to unknown routes and error
  responses too — they are properties of the application, not of a
  route.

## Edge cases

- **`SECRET_KEY` unset or empty** → the app does not start, and the
  failure names the variable without printing any value.
- **A request to an unknown path** → Not Found carrying the same
  headers as any other response, for a caller who sent the header.
  Without it, Forbidden, the same as any other path.
- **A state-changing request from a logged-out session** → Forbidden
  when the header is missing, because the check precedes authentication;
  Unauthorized when the header is present and the session is not.
- **Lock pressed with unsaved form input** → the one named exception in
  login.md, Rules applies; the shell adds no confirmation of its own.
- **An administrator navigates to a vault route by typing it** → Not
  Found, the same page a vault owner gets for `/admin`. No message
  explains the kind mismatch, because explaining it is the thing Not
  Found is chosen over Forbidden to avoid.

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
- A request without the header returns Forbidden for a path that exists
  and for one that does not, so the two are indistinguishable.
- The same request without the header returns Forbidden whether the
  session is valid, expired, or absent — asserted across all three,
  since the point of ordering the check first is that they are
  indistinguishable.
- Starting the app with `SECRET_KEY` unset fails, and the message
  contains the variable name and no key material.
- Nav shows Dashboard and Settings for a vault owner. An
  administrator's bar shows no nav entries at all, and its only
  control is Sign out. There is no Accounts entry and no Admin entry
  in either bar.
- An administrator session receives Not Found from `/settings`,
  `/api/sessions`, and `/api/auth/logout-all`, and OK from
  `/api/auth/change-password`.
- An administrator session receives Not Found from every vault route
  and a vault owner session receives Not Found from every
  administration route, asserted by enumerating every registered route
  and calling each with a session of both kinds. A route that answers
  something other than Not Found to the wrong kind, or that appears in
  neither group, fails the test.
- An administrator's `GET /api/records` returns Not Found, not an
  empty list, asserted specifically, because an empty list is the
  plausible wrong answer and it reads as "your vault is empty" rather
  than "you have none".
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
