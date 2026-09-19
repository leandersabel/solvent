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
by the feature that owns them: records (record-api.md), users and
unlock methods (register.md), invites (admin-invites.md), sessions
(architecture.md, Application hardening).

`users` carries identity and role and nothing else, so the columns the
shell needs are its whole column set: no key material is a column of
`users` (architecture.md, Vault key and unlock methods). Registration
adds the separate `unlock_methods` table rather than extending this
one.

## The chrome

Layout, the three nav entries, the global Update values action, the
lock button, and the content max-width are specified in
ui/design-system.md, App shell. This feature renders that shell; each
screen spec describes only its own content region.

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
- Nav shows Dashboard and Settings for a non-admin, and Admin as a
  third entry for an admin. There is no Accounts entry for either.
- The lock button discards keys and decrypted state and shows
  re-unlock with no confirmation dialog, and the server session
  survives it (login.md, Rules).
- No response body originating in the shell contains vault plaintext.
