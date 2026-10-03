# App shell

## What it does

One Flask application wraps every other feature: it sets the response
headers, enforces the CSRF header, issues and reads the session cookie,
opens the SQLite file, renders the chrome the authenticated screens
sit inside, and renders the error pages. Each is stated once here and
holds for every route.

The shell never handles plaintext financial data (architecture.md,
Components). What it renders as text is nav labels, the wordmark, the
error pages' fixed copy, and the current default KDF envelope
(architecture.md, Key management).

## Response headers

Set in one place and carried by every response, including error
responses:

- **CSP** — as stated in architecture.md, Application hardening. It
  does not vary by route. A route that would need a
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

Every other setting is an environment variable read once at start.
Each default lives with the rule it tunes:

| Variable | Sets |
|---|---|
| `DATABASE_PATH` | the SQLite file (Database) |
| `HSTS_PRELOAD`, `HSTS_MAX_AGE` | HSTS (architecture.md, Network & transport) |
| `TRUSTED_PROXY_HOPS` | how many proxies' `X-Forwarded-For` entries are trusted, default 0 (architecture.md, Network & transport) |
| `LOGIN_ATTEMPTS_PER_ACCOUNT`, `LOGIN_ACCOUNT_WINDOW_MINUTES` | the per-username throttle (architecture.md, Rate limiting) |
| `LOGIN_LOCKOUT_THRESHOLD`, `LOGIN_LOCKOUT_WINDOW_MINUTES`, `LOGIN_LOCKOUT_MINUTES` | the per-username lock |
| `LOGIN_FAILURES_PER_ADDRESS`, `LOGIN_ADDRESS_WINDOW_MINUTES`, `LOGIN_ADDRESS_LOCK_MINUTES` | the per-address lock |
| `VERIFY_CONCURRENCY`, `VERIFY_WAIT_SECONDS` | the concurrency cap (architecture.md, Application hardening) |
| `RATE_REQUESTS_PER_HOUR`, `RATE_BREAKER_FAILURES`, `RATE_BREAKER_COOLOFF_MINUTES` | the rate lookup's limit and breaker (rate-lookup.md) |
| `EXPORTS_PER_USER_HOUR` | the export limit (export-import.md) |

- **A limit, a window, a lock, a wait or a concurrency is a whole
  number of at least 1**, and `TRUSTED_PROXY_HOPS` a whole number of at
  least 0. Anything else refuses to start.
- **`LOGIN_REQUESTS_PER_IP_HOUR` refuses to start whenever it is set**,
  empty included. Ignoring it would leave an operator believing a
  limit holds that does not exist. The message names it and the
  variables of the per-address lock.
- Every refusal to start names the variable and never its value.

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
(admin-invites.md), sessions (architecture.md, Application hardening),
attempts (architecture.md, Rate limiting).

**Every connection the app opens sets `PRAGMA secure_delete = ON`**
(architecture.md, Storage & data handling).

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

**Expired `attempts` rows are deleted** (architecture.md, Rate
limiting):

- **At every process start**, in that same write transaction, together
  with every row whose bucket starts with `ip:`. Such a row holds a
  plaintext address. No code writes one, and the start deletes any it
  finds, so a file any build wrote keeps none past its first start.
- **Once every 60 seconds in each serving process**, by one daemon
  thread the app factory starts. Each pass opens its own connection as
  `file:<DATABASE_PATH>?mode=rw`, so it never creates a file, sets
  `secure_delete`, deletes in one transaction and closes. A failed pass
  logs `attempts.prune_failed` with the exception's type and no
  message, and the next pass runs as usual. The deletion is one
  function taking the current time, which tests call directly.

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
A Forbidden or Not Found body is the one Error pages pins.

## Error pages

Forbidden, Not Found and Server Error answer with one HTML document,
rendered from `error.html` (`product/app-shell.md`, A page that cannot
be shown). Its layout, copy and document title are `ui/error-page.md`.

- **Two bodies, not three.** The template takes one variant, `missing`
  or `failure`. Forbidden and Not Found render `missing` and are
  byte-identical, so the body never tells a refused address from an
  invented one. Server Error renders `failure`.
- **The variant is the template's only input.** It reads no session,
  principal kind, path, query string, request header or database value,
  and no context processor hands it one. So the page is the same for
  every visitor, and a Server Error caused by the database still
  renders.
- **The head** is `<meta charset="utf-8">`, `<meta name="viewport"
  content="width=device-width, initial-scale=1">`, the title, the
  stylesheet `css/tokens.css` and the icon (CSRF), on `<html
  lang="en">`. The page loads nothing else.
- **Root-absolute URLs.** The stylesheet and icon are referenced as
  the static endpoint builds them, `/static/...`, never relative. The
  page answers paths of any depth, and a relative URL under an invented
  path resolves to another invented path, whose refusal is a console
  error and leaves the page unstyled.
- **No script and no inline style.** No `<script>` element of any type,
  so no KDF envelope either, unlike the pages outside the shell:
  nothing on the page acts. No `<style>` element and no `style`
  attribute, which `style-src 'self'` refuses.
- **One link.** Exactly one `<a>`, `href="/"`, which the root path
  resolves by kind (The two surfaces). No form, and the wordmark is
  text, not a link.
- **No bar.** The chrome depends on the kind, which this page does not
  read.

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

### The bar above a dialog

**While any dialog is open, a vault owner's Lock stays visible and
operable above it**, at every width, so one press locks whatever is on
screen (`product/app-shell.md`, Lock). An administrator's dialog covers
the whole page, bar included: its scrim starts at the viewport's top
and the bar is `inert` with the rest of the page, because nothing on
that surface is decrypted and there is nothing for a control above the
dialog to protect. Everything below describes the vault owner's bar.

- **Layering.** While a dialog is open the bar is `position: sticky;
  top: 0` and stacks above every scrim. Each scrim, and the full-screen
  sheet at phone width, starts at the bar's lower edge rather than at
  the viewport's top: its top is `var(--chrome-height)`. Nothing a
  scrim or sheet draws overlaps the bar.
- **What the bar carries.** The nav and Update values take `hidden`
  when the first dialog opens and lose it when the last one closes,
  so the bar shows the wordmark and Lock alone. They
  are hidden rather than made inert, because an inert control still
  looks pressable.
- **`--chrome-height`** is the bar's rendered height, set on the root
  element through the CSSOM (`style.setProperty`, which `style-src
  'self'` allows), measured after the nav is hidden and measured again
  whenever the bar's size changes while a dialog is open. At phone
  width the hidden nav takes its second row with it, so the sheet
  starts below one row.
- **Modality is `inert`, not `aria-modal`.** While a dialog is open,
  everything outside the topmost dialog is `inert` except the bar:
  the content region and every dialog beneath the topmost. A dialog
  carries `role="dialog"` and no `aria-modal`, because `aria-modal`
  hides everything outside the dialog from assistive technology, Lock
  included. Closing the topmost dialog makes the one beneath it the
  topmost, and closing the last removes every `inert` this rule set.
- **The focus trap** cycles Lock and the topmost dialog's focusable
  elements, in document order: Tab from the dialog's last element
  reaches Lock, and Tab from Lock reaches the dialog's first. Focus
  never leaves the two while a dialog is open.
- **Escape closes the topmost dialog only**, wherever focus is inside
  the cycle. A dialog beneath stays open. Closing a dialog lifts the
  `inert` from what lies beneath before focus returns to what opened
  it, because focus cannot land in an inert region.
- **Lock with a dialog open** is the lock every other route takes
  (login.md, Rules). Every dialog closes, and which come back after
  unlock is `ui/unlock.md`, Rules. A dialog that comes back puts the
  bar back in this state.

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
- **`LOGIN_REQUESTS_PER_IP_HOUR` set**, to any value or none → the app
  does not start (Configuration).
- **`TRUSTED_PROXY_HOPS` negative or not a whole number** → the app
  does not start.
- **The database file is removed while a process runs** → the pruning
  pass fails, logs, and creates no file.
- **Lock pressed with unsaved form input** → the one named exception in
  login.md, Rules applies; the shell adds no confirmation of its own.
- **The viewport is resized or rotated with a dialog open** → the bar
  keeps its place, `--chrome-height` follows its new height, and the
  scrim or sheet still starts below it.
- **The page is scrolled when a dialog opens** → the bar sits at the
  viewport's top, not where it was in the page.
- **An administrator navigates to a vault route by typing it**
  (`/settings`) → the Not Found an invented address gets, with nothing
  about the kind.
- **A browser opens an API path without the header** (`/api/export`)
  → Forbidden, with the `missing` body.
- **An invented path several segments deep** (`/a/b/c/`) → the
  stylesheet and icon still load from `/static/`.
- **A Server Error during a signed-in request** → the same `failure`
  body a signed-out request gets.

## Acceptance criteria

- Every response — a shell page, a JSON endpoint, a Not Found, and a
  Server Error — carries the same CSP, and carries HSTS.
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
- The body of `GET /api/export` without the header (Forbidden) equals
  the body of an invented page path (Not Found) byte for byte, and
  each is byte-identical with no session, a vault owner's and an
  administrator's.
- A stubbed Server Error has the same body with no session, a vault
  owner's and an administrator's. It contains "Something went wrong and
  this page could not be shown." and not "There is no page at this
  address.", and the Not Found body the reverse.
- In both bodies: the viewport meta above, exactly one
  `<link rel="stylesheet">` with `href` `/static/css/tokens.css`, the
  icon link, exactly one `<a>` with `href="/"`, and no `<script>`,
  `<style>`, `style` attribute, `<form>` or `<nav>`.
- In a real browser, at an invented path several segments deep and on a
  stubbed Server Error: the body's computed background color equals
  the root's `--ground`, the card text's computed `font-family` equals
  the sign-in card's, every resource the page requests answers OK, and
  the console has no error.
- At a 390px-wide viewport, both bodies have no horizontal overflow:
  the document's `scrollWidth` does not exceed its `clientWidth`.
- Activating Go to Solvent navigates to `/`, which shows the sign-in
  card with no session, the Dashboard for a vault owner and the Admin
  area for an administrator.
- Starting the app with `SECRET_KEY` unset fails, and the message
  contains the variable name and no key material.
- Starting the app with `LOGIN_REQUESTS_PER_IP_HOUR` set, to `60` and
  to the empty string, fails, and the message names it,
  `LOGIN_FAILURES_PER_ADDRESS`, `LOGIN_ADDRESS_WINDOW_MINUTES` and
  `LOGIN_ADDRESS_LOCK_MINUTES`.
- Starting the app with `TRUSTED_PROXY_HOPS` set to `-1`, or with any
  rate-limit variable set to `0` or `ten`, fails, and the message names
  the variable and not its value.
- With `TRUSTED_PROXY_HOPS` unset, the app's WSGI callable is not
  wrapped in `ProxyFix`. With it set to 2, it is wrapped with `x_for=2`
  and every other `ProxyFix` count 0.
- Starting the app on a database holding an `attempts` row in an `ip:`
  bucket, an expired row in each other bucket, and an unexpired one in
  each, leaves exactly the unexpired rows outside `ip:` buckets, and
  the database file's bytes no longer contain the `ip:` row's address.
- Calling the pruning function with the clock at a row's `at` plus its
  bucket's retention leaves the row, and one second later deletes it,
  for every bucket in architecture.md, Rate limiting.
- The app factory starts one pruning thread, a daemon. A pass against
  a `DATABASE_PATH` whose file is gone logs `attempts.prune_failed`,
  raises nothing, and leaves no file at that path.
- Every connection the app opens, the pruner's included, reads
  `PRAGMA secure_delete` as 1.
- The image's gunicorn command sets `--access-logformat` to exactly
  the format in architecture.md, Storage & data handling, and
  `--log-level` to `error`, asserted by reading the Dockerfile.
- The Dockerfile copies `requirements.txt`, `app.py` and `solvent` and
  nothing else, and `.dockerignore` lists `tests` and `tools`, asserted
  by reading both files (architecture.md, Tech stack, Packaging).
- **No server log line carries the peer's address.** gunicorn runs as
  a subprocess with the Dockerfile's command arguments, bound to
  `127.0.0.1` on a free port, and a client connects from source
  address `127.0.0.2`. It sends a request with an invalid request
  line, one with an invalid header name, one whose request line
  exceeds gunicorn's limit, and a wrong Auth Key to
  `/api/auth/login`. After gunicorn stops, neither its standard output
  nor its standard error contains `127.0.0.2`. The same requests with
  `--log-level warning` in place of `error` produce a line containing
  `ip=127.0.0.2`, which proves the test sees the line the flag drops.
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
- **Every Lock assertion with a dialog open is driven by real input**:
  a mouse click or a touch tap dispatched at the screen coordinates of
  Lock's center, or key presses. None uses a scripted
  `element.click()`, which skips hit-testing and so passes with Lock
  covered.
- With a Record a value dialog open, at desktop width and at phone
  width with touch, the element at Lock's center point is Lock or a
  descendant of it, and no scrim or sheet box intersects the bar's box.
- With that dialog open and a figure typed into it, one mouse click on
  Lock at desktop width, and one touch tap on it at phone width, each
  leave no dialog, no figure and no vault plaintext in the DOM, and show
  the password screen. Unlocking reopens the dialog with the typed
  figure (`ui/unlock.md`, Rules).
- With a confirmation open over a form dialog, one click on Lock closes
  both, and unlocking restores what `ui/unlock.md`, Rules says comes
  back.
- With a dialog open, the bar's nav and Update values are hidden, and
  the wordmark and Lock are visible. Closing the last dialog shows them
  again.
- With a dialog open, the content region and every dialog beneath the
  topmost are `inert`, the bar is not, and no dialog carries
  `aria-modal`. In the accessibility tree, Lock is exposed and the
  content region is not.
- With a dialog open, repeated Tab presses visit only Lock and the
  topmost dialog's focusable elements, cycling in both directions, and
  Tab then Enter on Lock locks as a click does.
- With a confirmation open over a form dialog, Escape closes the
  confirmation alone and focus returns to what opened it. A second
  Escape closes the form.
- At phone width with a dialog open, `--chrome-height` equals the bar's
  rendered height and the sheet's top equals the bar's bottom, before
  and after rotating the viewport.
- No response body originating in the shell contains vault plaintext.
