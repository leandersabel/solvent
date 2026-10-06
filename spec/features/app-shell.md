# App shell

The one Flask application every other feature runs inside. It sets the
response headers, enforces the CSRF header, issues and reads the
session cookie, opens the SQLite file, renders the chrome the
authenticated screens sit in, and renders the error page. Each is
stated once here and holds for every route.

## What the client gets

The frame every signed-in screen sits in: the bar across the top, the
navigation, the controls at its right, and the width the page content
is held to. With a vault it is identical on every screen, so you always
know where you are and what you can reach. The admin area sits in a
stripped-down version of the same frame. It serves the household
members who use Solvent and the administrators who provision the
instance. There is no public page and no signed-out landing page. The
app's protections are applied here once, so no new screen can skip
them.

### What "looks like a private bank" commits us to

The values behind each of these are design-system.md's.

- **One structural color**, a deep petrol blue, and two accents used
  sparingly: brass for the primary action, plum for secondary emphasis.
  A screen that needs a third accent is over-designed.
- **A warm off-white page, never pure white. Hairline rules instead of
  boxes and shadows.** A soft shadow on a dialog only. Nothing fully
  round but an avatar and a status dot.
- **The money is the only loud thing on screen.** The net worth figure
  is the largest thing anywhere, and nothing in the chrome competes.
  Money columns are right-aligned, with digits of equal width.
- **No marketing language**: no tagline, slogan, welcome tour,
  promotional copy or explanation of why the product is good. Labels
  name the thing and stop.
- **Nothing moves for effect**: no entrance animation, sliding panel or
  figure counting up from zero. Only a brief hover or focus change, and
  not even that under reduced motion.
- **A loading page shows the shape of what is coming**, never a spinner.
- **Color never carries meaning alone.** A word or an icon says it too.

### The bar

- **The top bar**, deep petrol blue and full width, is on every
  signed-in screen but the error page: the wordmark "Solvent", the
  navigation, and at the right **Update values** and **Lock**.
- **Navigation** is **Dashboard** and **Settings**, for everybody with a
  vault, and never more. There is no **Holdings** entry, because the
  dashboard's own table is the list of holdings, and a third entry
  would lead back to it or to a thinner copy. There is no **Admin**
  entry in any state, because the instance is administered from a
  separate account with no vault (`admin-invites.md`).
- **Update values** opens the update sweep for today from wherever you
  are, asking nothing, so the sweep is reachable from deep inside one
  holding (`record-snapshot.md`, Update values). The dashboard's **New
  recording** asks for the date instead, because there you arrive
  already meaning to record (`net-worth-view.md`, Dashboard). So no
  screen carries two buttons for one thing.
- **Lock** is the idle lock pressed by hand (`login.md`, Rules). One
  press discards the keys and everything decrypted, closes any open
  dialog and shows the password screen, with no "are you sure". It is
  what you reach for when somebody walks into the room, and a
  confirmation spends the seconds it exists to save. The session stays
  alive, so only the password is asked. A form in a dialog comes back
  after unlocking with what you typed. A confirmation holds nothing
  typed, so it does not come back. Nothing else survives.
- **While a dialog is open** the bar shows only the wordmark and Lock,
  above the dialog, at every width. The navigation and Update values
  cannot act then, so they are hidden rather than left looking
  pressable.
- **The administrator's frame** is the same bar with a single **Sign
  out**: no navigation, Update values or Lock, because there is no
  vault, no holding and nothing decrypted. Movement inside the admin
  area is its own (`admin-invites.md`, Admin). The two bars differ by
  what they carry, never by looking different, because a chrome of its
  own would make the admin area feel like a second product bolted on.
- **The password and registration screens sit outside the shell**: one
  centered card, no bar, no navigation, no copy selling the product.
- **The page below the bar** is centered at a width readable on a wide
  monitor. Forms are narrower, and the update sweep and a single
  holding's detail sit in between. A content region fills only once the
  browser has decrypted it, so a screen shows its skeleton first and a
  refresh costs a fresh decryption.
- **A screen you open starts at its top**, with the whole bar in view,
  whether you opened it from the bar, a button or a link. Going back or
  forward with the browser returns you to where you were on that
  screen.

### On a phone

Every screen can be read and operated end to end on a phone without
panning sideways, entering figures and the update sweep included. A
screen may have two designs for one job, chosen by screen width. The
update sweep is the example you gave: a wide table on a computer,
possibly one holding per step on a phone, with the same figures
recorded. A screen is described at each size wherever the two differ.
No action exists only inside a wide table, and no screen has a single
route to something a narrow screen could not offer.

### What it deliberately does not do

- **No sign-out button in a vault owner's top bar.** Locking is
  frequent and signing out rare and deliberate, and two similar buttons
  side by side invite the wrong one. Signing out, and signing out
  everywhere, live in Settings (`account-settings.md`, Settings). An
  administrator has no Lock, so Sign out is the only control in their
  bar and there is nothing for it to be confused with.
- **No dark theme**, because you asked for a light ground
  (design-system.md, Dark mode).
- **No custom typeface**, because a downloaded one has to be hosted and
  pinned and flashes unstyled text on the password screen, the slowest
  screen in the product (design-system.md, Typography).
- **No financial data in the shell, and it could not show any.** Its
  only words are the app's name and the navigation labels, and the
  server that renders it holds no readable copy of the vault. Figures,
  holding names and notes exist only inside the browser, after the
  password.

## Screens

### Error page

The page served wherever no screen can be: an address with no page
behind it, an address the visitor may not open, and an unexpected
failure. It says the page cannot be shown and offers the way back. The
server renders it whole, the same for every visitor (How it works,
Error pages).

#### Layout

The card outside the shell (How it works, The chrome), max-width 420px,
padded 32px as the sign-in card is (`login.md`, Unlock).

- The wordmark "Solvent" above the card, as on the sign-in card. It is
  text, not a link, so the card's button is the one way on.
- In the card, an `h1` in Section heading type carrying the sentence
  (Copy).
- Beneath it, **Go to Solvent**: a link to `/` styled as Button,
  primary, spanning the card's width at the foot, as **Unlock** does.
  It opens the screen Solvent starts on for whoever follows it.

The wordmark and card stack centered horizontally and vertically, set
in the app's own type, never the browser's default. The page title is
"Solvent".

At phone width the card fills the width inside the 16px gutter and pads
16px, the heading steps down with Section heading, and the button is at
least 44px tall (design-system.md, Spacing and shape, Typography).
Nothing else changes shape.

#### Copy

| Variant | Heading |
|---|---|
| Missing, or refused | There is no page at this address. |
| Unexpected failure | Something went wrong and this page could not be shown. |

The button reads "Go to Solvent" in both.

#### States

The two variants above and no other. **A refused address shows the
missing variant**, byte for byte, so nothing tells a refused address
from one that does not exist. The admin area opened from inside a vault
is one such address, and a vault screen opened by an administrator is
another. Telling them apart would confirm which addresses exist, which
this instance does not hand out (`admin-invites.md`, The admin
boundary).

#### What it deliberately does not show

- **No top bar and no navigation**, because the bar depends on who is
  signed in and this page does not.
- **No status code and no technical name for the failure.** "Forbidden"
  means nothing to the reader, and it would tell a refused address from
  a missing one.
- **No cause or detail of the failure.** The reader cannot act on it,
  and it would hand internals to whoever triggered it.
- **The address asked for is not repeated.** It adds nothing and puts
  outside text on the page.
- **No sign-in link, Back button or Try again.** Go to Solvent leads to
  sign-in or to the reader's own starting screen, and the browser has
  Back.

## How it works

### What it does

Flask, Jinja2 and htmx. The shell never handles plaintext financial
data (architecture.md, Components). It renders as text only nav labels,
the wordmark, the error page's fixed copy and the current default KDF
envelope (architecture.md, Key management). No key derivation,
decryption or vault rendering happens here.

### Response headers

Set in one place and carried by every response, error responses
included:

- **CSP**, as architecture.md, Application hardening states it. It does
  not vary by route. A route that would need a looser policy is a design
  change, not a local override.
- **HSTS**, as architecture.md, Network & transport states it, with its
  condition on `preload`.

No separate `X-Frame-Options` is served. `frame-ancestors 'none'` in
the CSP covers framing, and a second header stating the same thing is a
second thing to keep in sync. The Alpine build served is the CSP-safe
one (architecture.md, Application hardening).

### Configuration

- `SECRET_KEY` is read from the environment (architecture.md, Tech
  stack). **The app refuses to start when it is absent or empty**,
  rather than generating one. A generated key is new on every restart
  and silently invalidates every session row. A committed default is
  forgeable.
- No secret reaches a log line or an error page.

Every other setting is an environment variable read once at start. Each
default lives with the rule it tunes:

| Variable | Sets |
|---|---|
| `DATABASE_PATH` | the SQLite file (Database) |
| `HSTS_PRELOAD`, `HSTS_MAX_AGE` | HSTS (architecture.md, Network & transport) |
| `TRUSTED_PROXY_HOPS` | how many proxies' `X-Forwarded-For` entries are trusted, default 0 (architecture.md, Network & transport) |
| `LOGIN_ATTEMPTS_PER_ACCOUNT`, `LOGIN_ACCOUNT_WINDOW_MINUTES` | the per-username throttle (architecture.md, Application hardening) |
| `LOGIN_LOCKOUT_THRESHOLD`, `LOGIN_LOCKOUT_WINDOW_MINUTES`, `LOGIN_LOCKOUT_MINUTES` | the per-username lock |
| `LOGIN_FAILURES_PER_ADDRESS`, `LOGIN_ADDRESS_WINDOW_MINUTES`, `LOGIN_ADDRESS_LOCK_MINUTES` | the per-address lock |
| `VERIFY_CONCURRENCY`, `VERIFY_WAIT_SECONDS` | the concurrency cap (architecture.md, Application hardening) |
| `RATE_REQUESTS_PER_HOUR`, `RATE_BREAKER_FAILURES`, `RATE_BREAKER_COOLOFF_MINUTES` | the rate lookup's limit, and the failure count and cool-off of each provider's breaker (`rate-lookup.md`) |
| `EXPORTS_PER_USER_HOUR` | the export limit (`export-import.md`) |

- **A limit, a window, a lock, a wait or a concurrency is a whole number
  of at least 1**, and `TRUSTED_PROXY_HOPS` a whole number of at least
  0. Anything else refuses to start.
- **`LOGIN_REQUESTS_PER_IP_HOUR` refuses to start whenever it is set**,
  empty included. Ignoring it would leave an operator believing a limit
  holds that does not exist. The message names it and the variables of
  the per-address lock.
- Every refusal to start names the variable and never its value.

### CSRF

The `X-Solvent-Request` header check (architecture.md, Application
hardening) is step 1 of the request gate.

Exempt are the routes meant to be reached by navigation: the
server-rendered shell pages and the static endpoint. An exemption is a
named route, never a path pattern, so an endpoint added under an
existing prefix cannot inherit one. The static endpoint is exempt
because no subresource request carries a custom header. What it serves
is public by construction and holds nothing about any person: the
design tokens, the client-side code, the vendored Alpine build and the
app's icon.

**Every page declares the app's icon from the static endpoint**, the
error page included: `<link rel="icon" href="<static>/icon.png"
type="image/png">`, a transparent 1x1 PNG. A page that declares none
makes the browser request `/favicon.ico`, which the gate refuses like
any invented path, and the refusal is a console error. There is no
`/favicon.ico` route, because it would answer a path nothing links to.
The icon is not a `data:` URL, because `img-src 'self'` blocks it.

### Database

One place creates the schema and opens the SQLite file on its writable
volume (architecture.md, Tech stack). Each table's columns are stated
by its owner: records (`record-api.md`), principals, credentials and DEK
wrappers (architecture.md, Data model), invites (`admin-invites.md`),
sessions and attempts (architecture.md, Application hardening), vault
epochs (architecture.md, Vault epoch). **Every connection the app opens
sets `PRAGMA secure_delete = ON`** (architecture.md, Storage & data
handling).

A database at another schema version is refused at start, because this
schema has no migration path beyond export and import. So every
start-time repair below runs in the one write transaction that creates
the schema, before any request is served, and keeps the schema version:

- **A null `principals.last_login_at` is filled with the row's
  `created_at`.** Every account has signed in by the time it exists
  (`login.md`, The session a sign-in issues), so the column is never
  null where a request can read it, whichever build wrote the row. The
  DDL leaves it nullable, because SQLite cannot add `NOT NULL` to an
  existing column without rebuilding `principals`.
- **Each vault owner without a `vault_epochs` row gets a fresh one**,
  generated as registration generates it. The table is created `IF NOT
  EXISTS`. A row that exists is never rewritten at start, because a page
  already holds it.
- **Expired `attempts` rows are deleted** (architecture.md, Application
  hardening), together with every row whose bucket starts with `ip:`.
  Such a row holds a plaintext address. No code writes one, so a file
  any build wrote keeps none past its first start.
- **The rate cache is emptied** (`rate-lookup.md`, Caching), because an
  entry may hold a proposal an earlier build rounded otherwise, and a
  settled one would never be fetched again.
- **An invite's `used_by` naming no principal is set to null**
  (`admin-invites.md`, Invite lifecycle), because a file an earlier
  build wrote may keep the username of an account removed since.

**Expired `attempts` rows are also deleted once every 60 seconds in
each serving process**, by one daemon thread the app factory starts.
Each pass opens its own connection as `file:<DATABASE_PATH>?mode=rw`,
so it never creates a file, sets `secure_delete`, deletes in one
transaction and closes. A failed pass, a vanished database file
included, logs `attempts.prune_failed` with the exception's type and
no message, and the next pass runs as usual. The deletion is one
function taking the current time, which tests call directly.

**The schema's triggers**: a `BEFORE INSERT` on `records`, on
`dek_wrappers` and on `vault_epochs`, each resolving the row's
principal and aborting when its `kind` is `administrator`. They are the
storage-layer half of "an administrator has no vault" (architecture.md,
Credentials and vault key wrappers). They are triggers because a SQLite
`CHECK` cannot reach another table. Nothing in the application is
expected to hit them. They exist so that a future feature that would
has to be written deliberately.

An `AFTER DELETE` trigger on `principals` sets `invites.used_by` to null
where it names the deleted username, so both deletion paths clear it in
their own transaction (admin-invites.md, Invite lifecycle).

### The two surfaces

There are two surfaces, the vault and the administration, and no
session reaches both. Every route is in exactly one group below. The
request gate checks the group against the session once per request, so
no endpoint repeats it.

- **Public**, the routes that answer without a session, to anyone:
  - `GET /login` and `POST /api/auth/login` (`login.md`).
  - `POST /api/auth/salt`, needed before there is anything to
    authenticate with (`login.md`, Flow).
  - `GET /register` and `POST /api/register`, gated by the invite
    rather than a session (`register.md`).
  - `POST /api/auth/logout`, which answers OK to an absent or expired
    session (`account-settings.md`, Session and lock).
  - `GET /`, the root path (below).
  - The framework's `static` route, whose files every signed-out page
    loads and which depend on nobody.

  Public lifts the session requirement and nothing else. A Public API
  route still requires the header and keeps its own feature's checks
  and rate limits.
- **Shared**, the routes every account needs to keep its credential
  current: `/api/auth/upgrade-kdf` and `/api/auth/change-password`. Both
  kinds reach them with a valid session.
- **Vault**: the record store, the rate lookup including `GET
  /api/rates/symbols`, export, import, `/api/sessions`,
  `/api/auth/logout-all`, `DELETE /api/auth/account`, `/settings`,
  `/settings/dimensions`, `/settings/export-import`, the dashboard, and
  every screen that renders vault data. A vault owner reaches these.
  **An administrator gets Not Found**, `/settings` included, because
  settings exists only inside a vault. A route that redirects a vault
  owner still answers an administrator Not Found.
- **Administration**: the `/admin` shell page and **every**
  `/api/admin/*` endpoint, including ones no feature has been written
  for yet. An administrator reaches these. **A vault owner gets Not
  Found.**

The **root path** resolves by kind: the Dashboard for a vault owner,
the Admin area for an administrator. It is the only route that resolves
to different content per kind, because a bookmark of the bare host has
to work for both. Without a session there is no kind to resolve by, so
it sends the visitor to the Dashboard, whose sign-in card signs in both
kinds and takes an administrator on to the Admin area (`login.md`,
Unlock).

**Public is a list of named routes, never a path pattern**, and names
nothing at `/admin` or under `/api/admin/`. The other groups are placed
by prefix: outside Public, everything under `/api/admin/` is
administration and everything else that touches a vault is vault, so a
route added later is placed by where it sits. A route matching no group
is unreachable.

#### The request gate

Every request passes these steps in order, before any handler runs. The
first that refuses decides the response, at the status architecture.md,
Refusals gives, or for step 7 the one it names.

1. **Header.** An API request without `X-Solvent-Request: 1` is refused.
   No API route is exempt, so this needs no routing.
2. **Authentication.** The session cookie is read and looked up.
3. **No session, API.** An API request with no valid session is refused
   unless it resolved to a Public route.
4. **Unresolved.** A request that did not resolve is refused.
5. **No session, page.** A Public page is served. A vault navigation
   page is served and renders its own sign-in card. Any other page is
   refused.
6. **Surface.** A route whose group the session's kind does not reach is
   refused.
7. **Vault epoch.** A vault owner's request to an API route outside
   Public needs `X-Solvent-Vault` holding exactly 32 lowercase hex
   characters, or it is a Bad Request with no `refused` member. A value
   other than the vault owner's `vault_epochs` row is Conflict
   `{"refused":"vault-replaced"}` (architecture.md, Vault epoch).
   Neither writes anything beyond `last_active_at`. An administrator's
   request is not checked and the header on it is ignored, as it is on a
   Public route.

Steps 1 to 6 are the refusals of architecture.md, Refusals. Step 7
answers only a vault owner already let through to a route of their own
surface, so it runs after them and teaches nothing about paths or
kinds. A request refused at or before step 4 writes nothing at all, not
even `last_active_at`.

The URL map sets `merge_slashes = False` and turns off automatic
`OPTIONS` responses. Any other redirect or Method Not Allowed the router
would raise is refused at step 4.

A refusal carries only the headers every response carries (Response
headers), and its body depends only on its status and namespace: no
`Set-Cookie`, `Allow` or `Location`, and no header a route sets on its
own response, such as `Cache-Control: no-store` or `Referrer-Policy`. A
Forbidden or Not Found body is the one Error pages pins.

### Error pages

Forbidden, Not Found and Server Error answer with one HTML document,
rendered from `error.html`. Its layout and copy are the Error page
screen above.

- **Two bodies, not three.** The template takes one variant, `missing`
  or `failure`. Forbidden and Not Found render `missing` and are
  byte-identical. Server Error renders `failure`.
- **The variant is the template's only input.** It reads no session,
  principal kind, path, query string, request header or database value,
  and no context processor hands it one. So the page is the same for
  every visitor, signed out, vault owner or administrator, and a Server
  Error caused by the database still renders.
- **The head** is `<meta charset="utf-8">`, `<meta name="viewport"
  content="width=device-width, initial-scale=1">`, the title, the
  stylesheet `css/tokens.css` and the icon (CSRF), on `<html
  lang="en">`. The page loads nothing else, so it has nothing to fetch
  and nothing to fail on its own.
- **Root-absolute URLs.** The stylesheet and icon are referenced as the
  static endpoint builds them, `/static/...`, never relative. The page
  answers paths of any depth, and a relative URL under an invented path
  resolves to another invented path, whose refusal is a console error
  and leaves the page unstyled.
- **No script and no inline style.** No `<script>` element of any type,
  so no KDF envelope either, unlike the pages outside the shell. No
  `<style>` element and no `style` attribute, which `style-src 'self'`
  refuses.
- **One link.** Exactly one `<a>`, `href="/"`, which the root path
  resolves by kind. No form and no bar.

### The chrome

One server-rendered shell wraps every authenticated screen, and each
screen describes only its own content region. What it carries is What
the client gets, The bar. It differs by kind, by omission:

| | Vault owner | Administrator |
|---|---|---|
| Nav | Dashboard, Settings | none |
| Update values | shown | absent, not disabled |
| Right-hand control | Lock | Sign out |
| Embedded KDF envelope | yes | yes |
| Record and decryption layer | loaded | not loaded |
| Argon2id worker | loaded | loaded |

- **An administrator's bar has no nav entry** because every one would
  answer Not Found, and Sign out takes the place of Lock because Lock
  means "drop the keys and keep the session" and an administrator has
  no keys.
- **Top bar** in petrol-800. Update values and Lock take the chrome
  button variant (design-system.md, Components), not the secondary one,
  which is for the light ground. The current nav entry is white with a
  2px brass-500 rule beneath it and the others are petrol-200, so the
  current one is marked by the rule as well as by hue.
- **At phone width** the nav drops to a second row beneath the wordmark
  and the two buttons, and Lock shows its icon alone, keeping "Lock" as
  its accessible name.
- **The Argon2id worker and the current default KDF envelope ship to an
  administrator too** (architecture.md, Key management), because a
  password change derives at current parameters for any account, and a
  stale-KDF upgrade can fire on any sign-in (`login.md`, Stale-KDF
  upgrade).
- **Content max-width** is 1200px, and each screen states its own
  narrower width.
- **Outside the shell** sit the sign-in card (`login.md`, Unlock),
  registration (`register.md`, Register) and the error page: one
  centered card on the warm ground under the wordmark in petrol-800,
  each setting its own width. Sign-in and registration, with no session
  to fetch one, embed the server's current default KDF envelope in
  their own page.

#### Where a screen opens

The vault page draws each screen in place under one address, so the
browser would otherwise keep the last screen's scroll position, clamped
to the new screen's height, and hide part of the bar. `app.js` sets
`history.scrollRestoration` to `manual` and gives each history entry a
random key in its state the first time it is drawn. On every change of
address it records the screen being left's `scrollY` under that
entry's key, in memory, and scrolls the screen it draws to the
position recorded for its own key, or to the top for an entry it has
never drawn. A screen that fills in after it is drawn, as the trend
chart does at its first layout and Settings when its session list
arrives, is too short for that position at first, so it sets the
position again each time the screen grows, until the position is
reached, the person scrolls, touches or presses a key, or another
screen opens. A
redraw at the same address keeps the position. A `replaceState` that
rewrites the address in place passes `history.state` through, so the
entry keeps its key. Nothing of this outlives the page.

#### The bar above a dialog

**While any dialog is open, a vault owner's Lock stays visible and
operable above it**, at every width. The dialog, its scrim, the focus
cycle with Lock, Escape and the administrator's whole-page scrim are
design-system.md, Components, Dialog. An administrator's bar is `inert`
with the rest of the page, because nothing on that surface is decrypted
for a control above the dialog to protect.

- **Layering.** While a dialog is open the bar is `position: sticky; top: 0`
  and stacks above every scrim, pinned to the viewport's top however
  far the page had scrolled, resized or rotated. Each scrim, and the
  phone-width sheet, has its top at `var(--chrome-height)`.
- **What the bar carries.** The nav and Update values take `hidden` when
  the first dialog opens and lose it when the last one closes. Hidden,
  not inert, because an inert control still looks pressable.
- **`--chrome-height`** is the bar's rendered height, set on the root
  element through the CSSOM (`style.setProperty`, which `style-src
  'self'` allows), measured after the nav is hidden and again whenever
  the bar's size changes while a dialog is open. At phone width the
  hidden nav takes its second row with it, so the bar is one row.
- **`inert` covers the content region and every dialog beneath the
  topmost, never the bar.** A dialog carries `role="dialog"`. Closing
  the last dialog removes every `inert` this rule set. Closing a dialog
  lifts the `inert` beneath it before focus returns to what opened it,
  because focus cannot land in an inert region. The focus cycle follows
  document order.
- **Lock with a dialog open** is the lock every other route takes
  (`login.md`, Rules). Which dialogs come back after unlocking is
  `login.md`, Unlock. A dialog that comes back puts the bar back in
  this state.

### Rules

- **The vault surface is one shell page.** `/dashboard` carries every
  screen behind the gate, settings, dimensions and export and import
  included, as in-page addresses. The keys live in that page's memory
  and nowhere else, so a second shell page would discard them and charge
  the Argon2id derivation again in the same sitting (`login.md`,
  Unlock). `/settings`, `/settings/dimensions` and
  `/settings/export-import` stay routes on the vault surface, each
  redirecting to the view it names, so a bookmark or a typed address
  still lands on that screen.

## Edge cases

- Lock with unsaved form input: `login.md`, Rules, with no confirmation
  added.
- A browser opens an API path without the header (`/api/export`):
  Forbidden, with the `missing` body.
- An invented path several segments deep (`/a/b/c/`): the stylesheet and
  icon still load from `/static/`.

## Acceptance criteria

1. A signed-in vault owner's every screen but the error page shows the
   wordmark, the nav, Update values and Lock. Test:
   `tests/test_chrome.py::test_a_vault_owners_bar_carries_update_values_and_lock`,
   `tests/browser/parts/unlock.mjs`.
2. A vault owner's nav is exactly Dashboard and Settings. Test:
   `tests/test_chrome.py::test_nav_is_dashboard_and_settings_for_a_vault_owner`.
3. Neither bar has a Holdings or an Admin entry, in any state. Test:
   `tests/test_chrome.py::test_there_is_no_holdings_entry_and_no_admin_entry_in_either_bar`.
4. An administrator's bar carries the wordmark and Sign out and nothing
   else. Test:
   `tests/test_chrome.py::test_an_administrators_bar_carries_the_wordmark_and_sign_out_and_nothing_else`,
   `tests/test_chrome.py::test_an_administrator_has_no_nav_entries_at_all`.
5. The password and registration screens show no top bar and no nav.
   Test:
   `tests/test_chrome.py::test_a_visitor_with_no_session_gets_the_vault_page_in_the_outside_frame`,
   `tests/browser/parts/unlock.mjs`.
6. Every top-bar control works from the keyboard alone and shows a white
   focus outline. Test: no test.
7. Update values opens the sweep for today from any screen, with nothing
   in between, the same sweep New recording reaches once a date is
   picked. Test: `tests/browser/parts/update-values.mjs`.
8. One press of Lock discards keys and decrypted state and shows the
   password screen with no confirmation, and the server session
   survives. Test: `tests/browser/parts/unlock.mjs`.
9. After a lock the password alone returns to the app, with no username
   asked. Test: `tests/browser/parts/unlock.mjs`.
10. (blind) With a Record a value dialog open, at desktop width and at
    phone width with touch, the element at Lock's center is Lock or a
    descendant, and no scrim or sheet box intersects the bar. Every Lock
    assertion with a dialog open uses a real click, tap or key press at
    Lock's center, never `element.click()`, which skips hit-testing.
    Test: `tests/browser/parts/unlock-lock.mjs`.
11. (blind) With that dialog open and a figure typed, one click (desktop)
    or tap (phone) on Lock leaves no dialog, no figure and no vault
    plaintext in the DOM, and shows the password screen. Test:
    `tests/browser/parts/unlock-lock.mjs`.
12. (blind) Unlocking then reopens the dialog with the typed figure.
    Test: `tests/browser/parts/unlock-lock.mjs`.
13. (blind) Lock over a confirmation over a form closes both, and
    unlocking brings back the form alone. Test:
    `tests/browser/parts/unlock-lock.mjs`.
14. With a dialog open the nav and Update values are hidden and the
    wordmark and Lock show. Closing the last dialog shows them again.
    Test: `tests/browser/parts/unlock-lock.mjs`.
15. (blind) With a dialog open, the content region and every dialog
    beneath the topmost are `inert`, the bar is not, no dialog carries
    `aria-modal`, and the accessibility tree exposes Lock and not the
    content region. Test: `tests/browser/parts/unlock-lock.mjs`.
16. (blind) With a dialog open, Tab and Shift+Tab visit only Lock and the
    topmost dialog's controls, in both directions, and Tab then Enter on
    Lock locks. Test: `tests/browser/parts/unlock-lock.mjs`.
17. (blind) Escape over a confirmation on a form closes the confirmation
    alone, with focus back on what opened it. A second Escape closes the
    form. Test: `tests/browser/parts/unlock-lock.mjs`.
18. (blind) At phone width with a dialog open, `--chrome-height` equals
    the bar's height and the sheet's top the bar's bottom, before and
    after rotating. Test: `tests/browser/parts/unlock-lock.mjs`.
19. (blind) An administrator's dialog scrim covers the viewport from its
    top, the bar is inert, and there is no Lock. Test:
    `tests/browser/parts/admin.mjs`.
20. (blind) No response body from the shell contains vault plaintext, and
    the bar and nav never show a holding's name, a figure or a note.
    Grepping templates proves nothing: no route wired to the shell may
    receive decrypted content. Test:
    `tests/test_chrome.py::test_no_shell_response_contains_vault_plaintext`.
21. An administrator's page loads the Argon2id worker and not the record
    or decryption layer. Test:
    `tests/test_chrome.py::test_an_administrator_loads_the_worker_and_not_the_record_layer`.
22. Every screen uses the warm off-white ground, never pure white, and
    the one petrol bar. Test: no test.
23. No screen carries a tagline, slogan, welcome tour or promotional
    copy. Test: no test.
24. No number animates and nothing slides or fades in. Under reduced
    motion, hover and focus transitions stop too. Test: no test.
25. Money columns are right-aligned with digits of equal width. Test: no
    test.
26. Wherever a color carries meaning, a word or icon beside it does too.
    Test: no test.
27. (blind) A shell page, a JSON endpoint, a Not Found and a Server Error
    each carry the same CSP and carry HSTS. Test:
    `tests/test_headers.py::test_every_response_shape_carries_the_policy_byte_identically`,
    `tests/test_headers.py::test_every_response_shape_carries_hsts`.
28. The CSP refuses framing and no `X-Frame-Options` is served. Test:
    `tests/test_headers.py::test_no_separate_x_frame_options_is_served`.
29. (blind) No screen, error pages reached by navigation included, logs a
    console error of its own: a resource the page needs that is blocked
    or refused, a policy violation or an uncaught exception. The
    browser's line for a refused request the person made, such as a
    wrong password, a used invite or too many attempts, is the product
    answering and not such an error. Test:
    `tests/browser/parts/error-page.mjs`.
30. The Alpine build served is the CSP-safe one. Test:
    `tests/test_chrome.py::test_the_alpine_build_served_is_the_csp_safe_one_at_its_pinned_hash`.
31. (blind) Every shell page and every error page declares the icon from
    the static endpoint. Test:
    `tests/test_icon.py::test_every_shell_page_declares_the_icon`,
    `tests/test_icon.py::test_every_error_page_declares_the_icon`.
32. The icon is fetchable with no header and no session. Test:
    `tests/test_icon.py::test_the_icon_loads_with_no_header_and_no_session`.
33. (blind) `/favicon.ico` is refused exactly as an invented page path,
    and no route or exemption answers it. Test:
    `tests/test_icon.py::test_favicon_is_refused_exactly_as_an_invented_page_path`,
    `tests/test_icon.py::test_there_is_no_favicon_route`.
34. A shell page's stylesheet, `shell.js` and the Alpine bundle load with
    no header and no session, carry the usual headers, and hold nothing
    about any person. Test:
    `tests/test_guard.py::test_static_assets_need_no_header_and_no_session`.
35. A state-changing JSON request without `X-Solvent-Request` is
    Forbidden and changes nothing. Test:
    `tests/test_review_refusals.py::test_every_non_get_route_requires_header_and_changes_nothing`.
36. A shell navigation route loads without the header. Test:
    `tests/test_guard.py::test_shell_pages_load_without_the_header`.
37. `GET /api/export` without the header is Forbidden. Test:
    `tests/test_guard.py::test_export_requires_the_header_despite_being_a_get`.
38. (blind) An exempt route and a non-exempt route under the same prefix
    are told apart. Test:
    `tests/test_guard.py::test_an_exemption_is_a_named_route_not_a_prefix`.
39. (blind) Refusal fingerprint matrix: under each session state
    (absent, expired, vault owner, administrator) and header state,
    every refused request gets the status architecture.md, Refusals
    gives and matches every other refusal of that status on body and
    every header but `Date`. Requests: every route in the route map read
    at test time under each method, an invented page path, `//admin`, an
    unanswered method on a page and an API route, `/api/invented`,
    `/api/admin/invented`. Test:
    `tests/test_review_refusals.py::test_refusal_fingerprint_matrix`,
    `tests/test_guard.py::test_every_registered_route_is_refused_like_every_other`.
40. (blind) Without the header a refusal is identical across all four
    session states, and with it an expired session's refusal equals an
    absent one's. Test:
    `tests/test_session.py::test_absent_tampered_expired_and_unsigned_cookies_are_all_refused`,
    `tests/test_guard.py::test_a_page_probe_is_refused_identically_in_every_cell`.
41. (blind) A refusal carries no `Set-Cookie`, `Allow`, `Location` or
    route-set header. Test:
    `tests/test_guard.py::test_a_refusal_carries_nothing_a_route_sets_for_itself`,
    `tests/test_review_refusals.py::test_refusals_carry_no_route_headers`.
42. (blind) An unanswered method and `//admin` are refused as invented,
    never Method Not Allowed and never a redirect. Test:
    `tests/test_guard.py::test_the_router_does_not_merge_slashes`,
    `tests/test_review_refusals.py::test_refusal_fingerprint_matrix`.
43. (blind) Over the route map read at test time, every route requiring
    the header is under `/api/`, every other answers only `GET` and
    `HEAD`, and none answers `OPTIONS`. Test:
    `tests/test_guard.py::test_the_namespace_invariant_holds_over_the_route_map`,
    `tests/test_review_refusals.py::test_namespace_invariant_over_route_map`.
44. (blind) A vault owner's request to every API route outside Public,
    read from the route map under each method, is a Bad Request with no
    `refused` member when `X-Solvent-Vault` is missing, empty, 31 or 33
    hex characters, or 32 uppercase ones. Test:
    `tests/test_vault_epoch.py::test_a_malformed_or_missing_epoch_is_a_bad_request_with_no_reason`.
45. (blind) The same requests with another vault's epoch or this vault's
    from before an import are Conflict `{"refused":"vault-replaced"}`,
    the body parsed and not only the status. Test:
    `tests/test_vault_epoch.py::test_another_vaults_epoch_and_a_replaced_one_are_a_conflict_on_every_route`.
46. (blind) Each of those leaves every table but `sessions.last_active_at`
    row for row as it was. Test:
    `tests/test_vault_epoch.py::test_a_malformed_or_missing_epoch_is_a_bad_request_with_no_reason`,
    `tests/test_vault_epoch.py::test_another_vaults_epoch_and_a_replaced_one_are_a_conflict_on_every_route`.
47. (blind) An administrator's shared-route request answers the same with
    any `X-Solvent-Vault` or none, and so does every Public API route.
    Test:
    `tests/test_vault_epoch.py::test_an_administrator_and_a_public_route_ignore_the_header`.
48. (blind) A vault owner's request that steps 1 to 6 refuse gets the
    same answer with and without `X-Solvent-Vault`. Test:
    `tests/test_vault_epoch.py::test_a_refusal_before_the_epoch_step_is_the_same_with_and_without_the_header`.
49. (blind) In a real browser, `/admin` signed out and as a vault owner,
    `/settings` as an administrator, and an invented path render the
    identical Not Found. Test: `tests/browser/parts/error-page.mjs`.
50. (blind) The Forbidden body of `GET /api/export` without the header
    equals an invented path's Not Found body byte for byte, each the
    same with no session, a vault owner's and an administrator's. Test:
    `tests/test_chrome.py::test_forbidden_and_not_found_are_one_body_for_every_visitor`.
51. (blind) A stubbed Server Error has one body for all three visitors
    and with the database unavailable. Test:
    `tests/test_chrome.py::test_a_server_error_is_one_body_for_every_visitor`,
    `tests/test_chrome.py::test_a_server_error_with_the_database_unavailable_is_the_same_body`.
52. (blind) The failure body holds its own sentence and not the missing
    one, and the missing body the reverse, each with one button, Go to
    Solvent. Test:
    `tests/test_chrome.py::test_a_server_error_is_one_body_for_every_visitor`.
53. (blind) Each body, parsed, has the viewport meta, exactly one
    stylesheet link to `/static/css/tokens.css`, the icon link, exactly
    one `<a href="/">`, and no `<script>`, `<style>`, `style` attribute,
    `<form>` or `<nav>`. Test:
    `tests/test_chrome.py::test_both_error_bodies_carry_the_head_and_the_one_link_and_nothing_else`.
54. Neither body names a status code or repeats the address asked for.
    Test:
    `tests/test_chrome.py::test_an_error_body_names_no_code_and_repeats_no_address`.
55. (blind) In a real browser, at a deep invented path and on a stubbed
    Server Error, the background equals `--ground`, the card's font
    equals the sign-in card's, every resource answers OK and the console
    has no error. Test: `tests/browser/parts/error-page.mjs`.
56. At a 390px viewport neither body overflows: `scrollWidth` does not
    exceed `clientWidth`. Test: `tests/browser/parts/error-page.mjs`.
57. (blind) Activating Go to Solvent, not reading its `href`, lands on the
    sign-in card with no session, the Dashboard for a vault owner and
    the Admin area for an administrator. Test:
    `tests/browser/parts/error-page.mjs`.
58. An administrator gets Not Found from `/settings`, `/api/sessions` and
    `/api/auth/logout-all`, and OK from `/api/auth/change-password`.
    Test:
    `tests/test_guard.py::test_an_administrator_reaches_change_password_and_not_settings`.
59. (blind) Calling every registered route, read at test time, with each
    kind's session: each kind gets Not Found from the other's surface,
    and a route in no group fails. Test:
    `tests/test_guard.py::test_each_kind_gets_not_found_from_the_other_surface`,
    `tests/test_guard.py::test_every_registered_route_is_placed_in_a_surface`.
60. (blind) With no session the gate passes exactly the Public routes
    (with the header, for API routes) and the vault navigation pages,
    over the route map under every method. Test:
    `tests/test_guard.py::test_with_no_session_the_gate_serves_exactly_the_public_routes_and_the_vault_pages`.
61. (blind) An administrator's `GET /api/records` is Not Found, not an
    empty list. Test:
    `tests/test_guard.py::test_an_administrator_gets_not_found_from_records_not_an_empty_list`.
62. The root path renders the Dashboard for a vault owner and the Admin
    area for an administrator, and neither reaches the other's through
    it. Test: `tests/test_guard.py::test_the_root_path_resolves_by_kind`.
63. (blind) A real process start with `SECRET_KEY` unset or empty fails,
    naming the variable and printing no key material. A unit test of the
    loader alone is not this. Test:
    `tests/test_config.py::test_process_fails_to_start_with_secret_key_unset`,
    `tests/test_config.py::test_no_key_material_reaches_process_output`.
64. (blind) `LOGIN_REQUESTS_PER_IP_HOUR` set to `60` or to the empty
    string fails the start, naming it and the per-address lock's three
    variables. Test:
    `tests/test_config.py::test_the_removed_per_ip_limit_refuses_to_start_whenever_it_is_set`.
65. `TRUSTED_PROXY_HOPS` at `-1`, or a rate-limit variable at `0` or
    `ten`, fails the start, naming the variable and not its value. Test:
    `tests/test_config.py::test_a_limit_below_its_minimum_or_not_a_number_refuses_to_start`,
    `tests/test_config.py::test_a_refused_value_is_never_echoed`.
66. (blind) With `TRUSTED_PROXY_HOPS` unset the WSGI callable is not
    wrapped in `ProxyFix`, and at 2 it is wrapped with `x_for=2` and
    every other count 0. Test:
    `tests/test_attempts.py::test_trusted_proxy_hops_wraps_only_the_client_address`.
67. (blind) A start on a pre-written file with an `ip:` row, an expired
    row in each other bucket and an unexpired one in each keeps exactly
    the unexpired non-`ip:` rows, and the file's bytes hold no trace of
    the `ip:` address. Test:
    `tests/test_attempts.py::test_starting_the_app_deletes_ip_rows_and_expired_rows_and_overwrites_them`.
68. (blind) The pruning function keeps a row with the clock at its `at`
    plus its bucket's retention and deletes it one second later, for
    every bucket. Test:
    `tests/test_attempts.py::test_each_bucket_is_kept_for_its_own_longest_window_to_the_second`.
69. (blind) The app factory starts one daemon pruning thread, and a pass
    on a vanished database file logs `attempts.prune_failed`, raises
    nothing and creates no file. Test:
    `tests/test_attempts.py::test_the_factory_starts_one_daemon_pruner_and_a_failed_pass_only_logs`.
70. (blind) Every connection the app opens, the pruner's included, reads
    `PRAGMA secure_delete` as 1. Test:
    `tests/test_attempts.py::test_every_connection_the_app_opens_sets_secure_delete`.
71. (blind) A start on a pre-written file gives each vault owner lacking
    a `vault_epochs` row a distinct 32-lowercase-hex one, leaves an
    existing row, adds none for an administrator, keeps the schema
    version, and a second start changes nothing. Test:
    `tests/test_vault_epoch.py::test_a_start_gives_each_vault_owner_without_an_epoch_a_fresh_one`.
72. (blind) A start on a pre-written file sets a null `last_login_at` to
    its `created_at`, leaves non-null ones, keeps the schema version, and
    a second start changes nothing. Test:
    `tests/test_last_login.py::test_starting_the_app_fills_null_last_login_at_with_created_at_and_only_those`.
73. (blind) A direct SQL insert of a `records` or `dek_wrappers` row for
    an administrator is rejected by the database. Test:
    `tests/test_schema.py::test_the_schema_refuses_a_records_row_for_an_administrator`,
    `tests/test_schema.py::test_the_schema_refuses_a_dek_wrapper_for_an_administrator`.
74. (blind) A direct SQL insert of a `vault_epochs` row for an
    administrator is rejected by the database. Test:
    `tests/test_vault_epoch.py::test_an_administrator_cannot_be_given_an_epoch`.
75. (blind) The Dockerfile's gunicorn command sets `--access-logformat`
    to exactly the format in architecture.md, Storage & data handling,
    and `--log-level` to `error`. Test:
    `tests/test_deployment.py::test_gunicorn_logs_no_address_agent_referrer_or_query_and_only_errors`.
76. (blind) The Dockerfile copies exactly `requirements.txt`, `app.py`
    and `solvent`, with no wildcard or whole-context copy, and
    `.dockerignore` lists `tests` and `tools`. Test:
    `tests/test_deployment.py::test_the_image_holds_the_app_and_nothing_of_the_tests_or_tools`.
77. (blind) gunicorn, run with the Dockerfile's arguments on `127.0.0.1`,
    receives from `127.0.0.2` an invalid request line, an invalid header
    name, an over-long request line and a wrong Auth Key to
    `/api/auth/login`, and its output then holds no `127.0.0.2`. The same
    run at `--log-level warning` logs `ip=127.0.0.2`, which proves the
    test sees the line the flag drops. Test:
    `tests/test_deployment.py::test_no_server_log_line_carries_the_peer_address`.
78. The Dockerfile's gunicorn command runs one `gthread` process with
    more request threads than `LOOKUP_CONCURRENCY`. Test:
    `tests/test_deployment.py::test_one_gthread_process_serves_more_requests_than_lookups_can_hold`,
    `tests/test_review_app_shell.py::test_the_image_runs_one_gthread_process_with_more_threads_than_lookups`,
    `tests/test_review_app_shell.py::test_the_image_starts_exactly_one_worker_process`.
79. (blind) gunicorn, run with the Dockerfile's arguments, holding
    `LOOKUP_CONCURRENCY` requests stalled halfway, still serves the
    sign-in page. Test:
    `tests/test_deployment.py::test_requests_held_open_as_long_as_lookups_can_be_leave_the_instance_answering`,
    `tests/test_review_app_shell.py::test_requests_held_open_as_long_as_every_lookup_slot_leave_the_sign_in_page_answering`,
    `tests/test_review_app_shell.py::test_the_control_holding_every_thread_does_stop_the_sign_in_page`.
80. A start empties the rate cache and keeps the schema version. Test:
    `tests/test_rates.py::test_starting_the_app_empties_the_rate_cache`.
81. At a 390px phone viewport, a real click on Settings in the bar with
    the dashboard scrolled down, and on a holding's row far down the
    dashboard, each opens its screen with `scrollY` 0 and the bar's top
    at 0. Test: `tests/browser/parts/dashboard-scroll.mjs`.
82. Back from each returns the dashboard to where it was: the same
    `scrollY` from Settings, and the holding's row at the same height on
    screen from the holding. Test:
    `tests/browser/parts/dashboard-scroll.mjs`.
