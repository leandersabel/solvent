# Rate lookup

<!-- Everything outside the Providers section is provider-independent. -->

## What it does

A server-side proxy and cache that fetches conversion rates (FX, metals)
from a whitelisted public provider and serves an entry-date rate
**proposal** to the client. It exists so requests get cached and so no
browser individually leaks its update timing to a third party.

The proposal is advice, never authority: the user can always override
it, and the value that lands in the price timeline is whatever the user
accepted (`record-rate.md`).

## Endpoint

`GET /api/rates?date=<YYYY-MM-DD>&quote=<CCY>[&symbol=<SYMBOL>]`

- `date`, the recording date.
- `quote` — the user's main currency, the currency to price into.
- `symbol` is **optional**. One symbol, which is a holding's unit
  (`manage-accounts.md`). Omitted, the response covers the whole
  quotable table.
- Session-authenticated. Anonymous requests are refused, so the proxy is
  not an open relay.

Response OK, one symbol:

```json
{ "rate": "3142.75", "base": "1 XAU-ozt", "quote": "CHF",
  "asOf": "2026-07-31", "source": "provider-name", "cached": true }
```

Response OK, whole table:

```json
{ "date": "2026-07-31", "quote": "CHF",
  "rates": {
    "USD": { "rate": "0.9312", "base": "1 USD", "asOf": "2026-07-31",
             "source": "frankfurter", "cached": true },
    "XAU-ozt": { "rate": "3142.75", "base": "1 XAU-ozt",
                 "asOf": "2026-07-30", "source": "nbp+frankfurter",
                 "cached": false }
  } }
```

A symbol the proxy cannot price for that date is **absent from the
map**, never present with a null. Absence in the map means exactly what
No Content means for one symbol.

Response No Content, meaning no proposal available at all (a symbol with
no provider yet, no data for that date, provider unreachable). The
client falls back to manual entry.

### The client never names a symbol

**Every request the app makes omits `symbol`.** Recording anything
refreshes the price of every holding the person has (`record-rate.md`),
so a per-symbol fan-out would hand the proxy a complete, repeating list
of which currencies and metals that person holds, on the schedule they
do their books. The whole-table form reveals the date and the main
currency, which the server already holds, and nothing else.

It costs almost nothing to serve. The FX provider returns every currency
against one base in a single call, and gold is one more plus its FX leg,
so a whole table for one `(date, quote)` is a bounded handful of
outbound requests and a few kilobytes back. It is composed from, and
populates, the same per-symbol cache entries as the single form.

The single-symbol form stays because the acceptance sweep below queries
every symbol in the table individually, which is what keeps
`/api/rates/symbols` and `/api/rates` from drifting apart.

**The endpoint accepts no amount parameter, in any form.** This is the
base-amount rule made structural: the rate is always for one fixed base
unit (1 troy oz, one unit of the base currency), so there is no
field an amount could travel in even by mistake. Any request carrying an unrecognised query parameter
is rejected with Bad Request rather than ignored.

The same rule covers the other direction. **A price the person typed or
overrode is never sent here either**, in any field. It is their
valuation of their own holding (`record-rate.md`), and this endpoint
asks questions rather than reporting answers.

## Providers

The proxy routes a request to a provider by the symbol's asset class.
Each provider is a server-side constant — host, URL template, and any
key — and never influenced by client input or by any setting (SSRF
and egress hardening, below).

**Every proposal is composed in `Decimal` at the default context's 28
significant digits and rounded once**, to 8 decimal places, half to
even, written as a plain decimal string with no trailing zeros and no
exponent. The steps before that rounding are pinned per provider below,
so an independent computation in the same order reaches the same digits
(nightly-harness.md, Known prices).

### FX

**Frankfurter's public instance, `api.frankfurter.dev`.** HTTPS, no API
key, no daily or monthly quota; requests are rate-limited only against
abuse, and the operators ask heavy users to cache, which this design
already does (see Caching). The `/v1` endpoints the app calls serve the
European Central Bank's reference rates, which begin on 1999-01-04.
Not every currency begins then: `BRL`, `CNY`, `ILS` and `INR` first
appear on 2000-01-13. Before that date the table omits them, and a
request with one of them as `base` answers Not Found. Each currency's
start is its floor (The symbol table). Frankfurter advertises history
back to 1948 from other central banks' series. It is not the API the
app calls.

- An FX symbol is the **base currency's ISO 4217 code** (`USD`, `EUR`),
  which is the holding's unit, and `quote` is the user's main currency.
  A unit names the base asset only (`manage-accounts.md`).
- **Request**: `FX_URL`, `https://api.frankfurter.dev/v1/{date}?base={quote}`,
  with headers `User-Agent: USER_AGENT`, which is
  `Solvent/1.0 (self-hosted net worth tracker)`, and
  `Accept: application/json`. Both providers front their public
  instance with a CDN that refuses an unnamed client. One request
  returns every currency against `quote`.
- **Read**: `base`, which must equal `quote`; `date`, the publication
  day, which becomes `asOf`; and `rates`, mapping each code to how many
  of it one `quote` buys. The price of one unit of a code is
  `1 / rates[code]`. Nothing else in the body is read.
- The currency half of the operator's symbol table can be seeded
  directly from the provider's own currency list rather than typed by
  hand.
- Rates are **not published for every calendar date**. A weekend,
  holiday, or pre-publication date resolves through the existing
  prior-close rule below, with `asOf` carrying the earlier date so the
  user sees the lag. This is the normal path, not an error.
- No provider in this design has an API key. The key-redaction rule
  below stays because it binds any keyed provider added later, of which
  metals.dev is the live candidate (see Rejected below).
- Self-hosting Frankfurter is the same open-source service, so moving to
  a private instance later changes one host constant and nothing else.

### Gold

**Narodowy Bank Polski's public API, `api.nbp.pl`.** HTTPS, no API key,
no quota, no account. Publishes the
price of 1 g of fine gold (millesimal fineness 1000) in PLN, daily, from
2013-01-02, queryable by date and by date range — the same shape as the
FX provider, and chosen for the same reasons: a central bank rather than
a vendor, nothing to sign up for, and one host constant to unwind.

- Lookup is a **range query**, not a single-date query: `NBP_URL`,
  `https://api.nbp.pl/api/cenyzlota/{start}/{end}?format=json` with
  `start` 14 days before `date` and `end` equal to it, and the same
  headers as the FX request. It returns only the days NBP actually
  published, and the adapter takes the last entry on or before `date`,
  reading its `cena`, PLN per gram, and its `data`, which becomes
  `asOf`.
  That satisfies the prior-close rule in one request with no retry loop,
  and an empty result inside the window means No Content. A single-date
  query returns Not Found on every weekend and Polish holiday, so it is
  the wrong call to make. The API caps a range at 93 days.
- **The quote conversion is a second leg.** NBP prices in PLN only, so a
  non-PLN `quote` is converted PLN→quote through Frankfurter **at the
  `asOf` date, not the requested date** — pairing a rate with FX from a
  different day would misprice it. Either leg failing yields No Content;
  a half-composed rate is never returned. `source` names the chain
  (`"nbp+frankfurter"`, or `"nbp"` when the quote is PLN).
- **Unit conversion is exact**: `XAU-g` takes NBP's figure directly,
  `XAU-ozt` multiplies by 31.1034768. Compose at full precision and
  round once, at the end, in this order: `cena × (1 / rates["PLN"])`
  from the `asOf` table (`cena` alone when the quote is PLN), then
  `× 31.1034768` for `XAU-ozt`, then the rounding above.
- **NBP's price trails the London fixing by one business day.** Its
  published price for date D is the previous business day's LBMA AM
  fixing at NBP's USD rate of that day, within 0.1%. So `asOf` is
  usually one business day behind the snapshot date even midweek, not
  only across weekends. That is acceptable: the proposal is advice, the
  user sees `asOf` and can override it with a better figure. Do not
  paper over it by stamping `asOf` with the requested date.
- History begins 2013-01-02, which is the `since` of both gold symbols
  (The symbol table).

Rejected: **LBMA's own JSON feeds** (`prices.lbma.org.uk`) are keyless,
CORS-open, and carry every metal back to 1968 in USD/GBP/EUR — a perfect
technical fit that fails on licensing. IBA requires a licence "in order
to obtain, use or redistribute real-time or historical benchmark data …
including for pricing and valuation activities", which is precisely this
use; the World Gold Council removed its historical LBMA series at IBA's
request in March 2025. Public reachability is not permission. **Twelve
Data** forbids caching beyond documented timeframes, which this design's
indefinite cache would breach. **metals.dev** remains the
fallback if silver, platinum, or palladium lookup is wanted later: USD
per troy ounce natively, all four metals, storage unrestricted, at the
cost of an API key, a vendor account, ~5 years of history, and a 100
request/month free tier.

### Silver, platinum, palladium — deferred, but symbolled

No lookup in v1. Their symbols are **seeded in the symbol table now**
(Seeded symbols), so the rate is entered by hand against a canonical
symbol and adding a provider later is a server-side change with no
migration and no stale user data.

### Listed securities — out of scope

Not deferred like the other metals: **there is nothing here to defer.**
Brokerage holdings are recorded at depot level (architecture.md, Data
model) — one holding in the depot's reporting currency, holding the
total the broker reports. That total needs FX at most, which the FX
provider covers. So there is no security rate to fetch, no ticker
namespace to adopt into user records, and no `kind: equity` in the
symbol table.

Adding a `kind` later would be safe in a way that adding a *symbol* is
not: `kind` is operator config, while a symbol is written into
ciphertext as a holding's unit. That asymmetry is why the metals are
seeded and this is not.

Rejected, the licensing being largely closed:

- **Tiingo** — free tier permits data "only transiently in volatile
  memory or in a temporary, non-persistent cache"; paid tiers require
  deletion on downgrade or expiry.
- **EODHD** and **Financial Modeling Prep** — a non-professional may
  store and analyse the data, but must delete every copy, cached
  included, within a month of the subscription ending.
- **Stooq** — keyless CSV, but now serves a JavaScript proof-of-work
  challenge to non-browser clients. Automated server-side access is
  blocked, which also answers the licensing question.
- **Alpha Vantage** — the only clean one: personal, non-commercial
  licence with no retention, caching, or deletion clause at all. Ruled
  out on fit rather than terms — 25 requests/day shared across the whole
  instance, and thin coverage of European listings.

The objection that generalizes binds every future provider for any
asset class. A rate is stored permanently as a vault record, inside
ciphertext the server cannot read, enumerate or delete, so terms
requiring deletion of all data on termination are unsatisfiable by
construction, not a cache policy a shorter TTL could fix. A provider is
checked against this, not merely against request volume, the same test
that eliminates LBMA for gold.

## The symbol table

`GET /api/rates/symbols` → `[{ symbol, label, kind, lookup, since }]`,
the operator's configured symbol table. Session-authenticated,
read-only, cacheable.

It exists because **the account form's unit picker is built from it**
(`ui/account-form.md`): a user chooses what a holding is measured in
from this list, and that choice is also its rate symbol
(`manage-accounts.md`). An unknown symbol stays a Bad Request at
`/api/rates`, which no user reaches by choosing: the client never names
a symbol at all, and a free-text unit draws no proposal rather than an
error.

- `kind` — `currency` or `metal`. Display and grouping only.
- `lookup` — whether the proxy can price this symbol **today**. `false`
  means the symbol is valid and canonical but has no provider yet: the
  user enters the rate by hand, and `/api/rates` answers No Content, not
  Bad Request. This is a designed state, not a degraded one.
- `since` — the symbol's floor, `YYYY-MM-DD`, or `null` for a symbol
  with no provider adapter. It does not follow `lookup`, because the
  floor is the provider's fact, and a main currency whose `lookup` is
  off still bounds every rate quoted into it.

**A symbol's floor is the first date its provider publishes it**: the
provider's own history start, 1999-01-04 for Frankfurter and 2013-01-02
for NBP, raised for a currency whose series begins later (Providers,
FX). A symbol with no provider adapter has no floor. The floor is a
server-side constant derived from the adapter registry, like
`hasAdapter`, never stored on the row and never set through any route.
It holds whatever the row's `lookup`. A currency an administrator adds
takes Frankfurter's 1999-01-04, because the server knows no later start
for it. `GET /api/admin/symbols` carries no `since`: no administrator
decision turns on it, since `lookup` is refused only for want of an
adapter.

**A rate source applies to a date only on or after the later of the
symbol's floor and the quote's.** The quote's counts because
Frankfurter answers Not Found for a `base` before its start, which
would count against its breaker (Rate limiting and failure). Before
that date nobody published a price, so no provider is asked for it,
and the client treats the symbol as one its owner prices at that date
(`record-rate.md`, Reading). This is a designed state like
`lookup: false`, never an outage.

The table is platform configuration, not user data: identical for
every account and revealing nothing about who holds what. **Maintaining
it is an administrator task** (`admin-invites.md`, The admin boundary),
which the table clears without an exception: no row of it is anyone's
data.

### Maintaining the table

Under `/api/admin/`, administrator session only, CSRF-protected, Not
Found to a vault owner (`app-shell.md`, The two surfaces).

- `GET /api/admin/symbols` → the full table including retired rows,
  which `GET /api/rates/symbols` omits. Each row carries `symbol`,
  `label`, `kind`, `lookup`, `retired`, and **`hasAdapter`**: whether
  this deployment has a provider adapter configured for that symbol.
  It is derived from the adapter registry rather than stored on the
  row, it is read-only, and `POST` and `PATCH` reject it like any
  other unknown field.
- `POST /api/admin/symbols` `{ symbol, label, kind, lookup }` → adds a
  row. `symbol` must match the canonical form and not already exist.
- `PATCH /api/admin/symbols/<symbol>` `{ label?, lookup?, retired? }`
  → changes only those three.

**`symbol` and `kind` are immutable, and there is no delete.** This is
the hard rule of the whole surface and it follows from one fact: a
symbol is written into user records as a holding's `unit`, inside
ciphertext the server cannot read. So the server cannot tell whether a
symbol is in use, cannot migrate the records that use it, and cannot
warn the administrator who is about to strand them. Renaming `XAU-ozt`
or deleting it would leave holdings measured in something that no
longer exists, discoverable only by their owner, one at a time, and
unfixable without hand-editing an export.

- **`kind` is immutable for the same reason plus one more**: `quote`
  on every rate request must be a `kind: currency` row, and a vault's
  main currency is fixed at registration (`register.md`). Flipping a
  currency to a metal would break every lookup a vault has ever made
  and cannot make again.
- **`retired: true` is the substitute for deleting.** A retired symbol
  is dropped from `GET /api/rates/symbols`, so no new holding can be
  measured in it, and stays fully valid everywhere else: `/api/rates`
  still prices it, existing holdings keep working, and unretiring it
  restores it exactly. Same shape as archiving a dimension
  (`account-settings.md`, Deleting is archiving), and for the same
  reason: reversibility costs one flag, and the destructive version
  cannot be undone.
- **`lookup` is the mutable one that matters.** It is the flag that
  flips when a provider appears for a metal that had none, which is
  the main reason this surface exists at all. The server refuses
  `lookup: true` for a symbol with no configured provider adapter, on
  `POST` and on `PATCH` alike, so the flag cannot promise a proposal
  the proxy cannot serve.

  **`hasAdapter` is what makes that refusal avoidable rather than
  merely correct.** With it the control is disabled on the rows that
  have no source, with the reason stated in place, instead of offered
  everywhere and refused afterwards. The server keeps refusing
  regardless: a page open since before an adapter was added or removed
  is a stale page, and a client's knowledge of the registry is not a
  control.
- **`label` is display text and changes freely.** It is stored in no
  user record, so a rename rewrites nothing. It is rendered into the
  unit picker with `textContent`, never `innerHTML` (architecture.md,
  Application hardening), because server-controlled text is still
  text and the rule is not worth a second code path.

**No response here counts how many holdings use a symbol**, and none
could: the server cannot read a `unit`. An administrator retiring a
symbol is told what it means rather than shown who it affects.

### Seeded symbols

Metal symbols are seeded for all four precious metals even though only
gold has a provider. **A symbol is a permanent identifier written into
user records** — it is the holding's `unit` (`manage-accounts.md`); if a
user typing free text records `GOLD`, `xau`, or `XAUCHF` today, adding a
provider later means either abandoning those holdings or migrating
ciphertext the server cannot read. Seeding the canonical form now costs
a few config rows and removes that migration entirely. Because the unit
picker offers this table before it offers free text, the canonical form
is also the path of least resistance.

The naming rule is generative, so a future symbol is derivable rather
than invented: **`<ISO 4217 metal code>-<unit>`**, unit `ozt` or `g`.

| symbol | label | kind | lookup |
|---|---|---|---|
| `XAU-ozt` | Gold, troy ounce | metal | yes |
| `XAU-g` | Gold, gram | metal | yes |
| `XAG-ozt` | Silver, troy ounce | metal | no |
| `XAG-g` | Silver, gram | metal | no |
| `XPT-ozt` | Platinum, troy ounce | metal | no |
| `XPT-g` | Platinum, gram | metal | no |
| `XPD-ozt` | Palladium, troy ounce | metal | no |
| `XPD-g` | Palladium, gram | metal | no |

Both units are offered because a holding is measured in one or the
other, and the rate must be per that same unit — a rate per troy ounce
against a holding recorded in grams is off by a factor of 31. Since the
holding's unit *is* its symbol, choosing `XAU-g` picks both at once and
the mismatch cannot occur (`manage-accounts.md`). Gold gets both entries
for free: NBP publishes per gram, so `XAU-g` is the raw figure and
`XAU-ozt` is the one conversion.

Currency symbols are seeded from Frankfurter's own currency list, all
with `lookup: true` (see Providers). They are what the unit picker
offers for an ordinary bank account or depot. **There are no security
symbols and none are coming** (Listed securities, above).

## Caching

- Cache key: `(symbol, quote, date)`. Stored in SQLite.
- **Past dates are cached indefinitely** — a historical rate does not
  change.
- **Today's date is cached for 1 hour**, then refetched.
- A cache hit issues no outbound request, so repeated entry across a
  household's holdings on one day mostly hits cache.
- Cache entries are public reference data, not user data: they are not
  per-user and hold nothing about who asked or how much they hold.

## SSRF and egress hardening

Non-negotiable, because the proxy runs where other services on the
host's network are reachable:

- Provider hosts and URL templates are **server-side constants**. No
  part of the outbound URL's scheme, host, or port is derived from
  client input.
- `symbol` is validated against a strict allowlist before use: it must
  match `^(?=.{1,16}$)[A-Z0-9][A-Z0-9._]*(-[a-z]+)?$` **and** be present
  in the server's configured symbol table. Regex alone is not
  sufficient. The pattern is the canonical form of Seeded symbols: an
  upper-case code and an optional lower-case unit. It admits `XAU-ozt`
  and refuses `usd` and `xau-ozt`, so the table cannot hold two
  spellings of one symbol.
- `quote` must be a `kind: currency` row of the server's symbol table —
  the same set registration offers as a main currency (`register.md`).
  "A known ISO 4217 code" is the looser check and the wrong one: ISO
  4217 contains codes the FX provider cannot quote into, and `quote` is
  the user's main currency on every request the vault ever makes.
- `date` must parse as a calendar date and not be in the future. For a
  symbol with a provider adapter, whatever its `lookup`, it must not
  precede the later of the symbol's floor and the quote's (The symbol
  table). A date before it
  is a Bad Request and reaches no provider. A single global floor would
  either reject valid FX dates or wave through gold dates the provider
  has no data for. The whole-table form leaves out every symbol whose
  floor the date precedes, and asks no provider for it.
- HTTP redirects are **disabled**, not followed to a validated target.
- Egress has a hard timeout, `EGRESS_TIMEOUT_SECONDS` = 5 for connect
  and read together across one proxy request, and a response size cap,
  `MAX_RESPONSE_BYTES` = 1 MiB. How the providers of one request share
  that deadline is under Rate limiting and failure.
- `solvent.rates` exposes `FX_URL`, `NBP_URL`, `USER_AGENT`,
  `EGRESS_TIMEOUT_SECONDS`, `MAX_RESPONSE_BYTES` and `SEEDED_SYMBOLS`
  under those names, because the nightly source check imports them to
  request exactly what the app requests (nightly-harness.md, The source
  checks). Renaming one breaks that check.
- Outbound requests go to HTTPS only, with certificate verification on.
- **No setting names a provider.** No environment variable,
  configuration value, command-line flag or request names a provider
  host, a URL template or a certificate authority. Verification runs
  against the image's system trust store at OpenSSL's default paths,
  and the app adds no CA of its own. So nothing built for testing can
  redirect an installation's lookups: the nightly harness reaches its
  stand-in through name resolution and a trust store mounted over the
  system's (nightly-harness.md).
- A proxy in the deployment's `https_proxy`, which `urllib` honours, can
  carry a connection and cannot change where it ends: the certificate
  is still verified against the provider's own name.

## Rate limiting and failure

- Per-user request limit on the endpoint, **default 120 per hour**,
  independent of the login limiter — a compromised session must not be
  usable to hammer the provider on the instance's API quota. A sweep of
  any size costs **one** request, because the client asks for the whole
  table once per recording date (`record-rate.md`, The refresh), so the
  limit sits far above honest use.
- **Each provider has its own circuit breaker**, keyed `frankfurter`
  and `nbp`. A breaker opens after **5 consecutive failures** of its
  own provider. For a **5-minute cool-off** it then fails that
  provider's requests without sending them, instead of retrying per
  request, so every symbol needing that provider gets no proposal.
- A failure is an outbound request that cannot connect, times out,
  answers anything but 200, or answers a body that is not JSON. A
  success resets its own provider's count and touches no other
  breaker.
- The gold lookup's currency leg is a Frankfurter request and counts
  against Frankfurter. So while Frankfurter is down, NBP requests still
  go out and gold quoted in PLN still resolves, and while NBP is down,
  every currency lookup still goes out. There is no breaker shared by
  both providers, because one provider's outage would silence the
  other, and the other's successes would keep resetting the count.
- **A proxy request sends only the outbound requests its pending
  symbols need**, a pending symbol being one neither cached nor the
  identity case. Frankfurter's table for `date` goes out when a
  currency symbol is pending, NBP's range query when a gold symbol is,
  and the gold quote leg only for a gold symbol quoted in anything but
  PLN.
- **Frankfurter's table and NBP's range query go out at once**, and
  the proxy request waits for both within its one
  `EGRESS_TIMEOUT_SECONDS` deadline. Asked one after the other, a
  provider that hangs would use up the deadline before the other was
  asked, so its outage would silence the other provider until its
  breaker opened. Giving each provider its own share of the deadline
  avoids that too, but cuts the time each gets to answer, so a slow
  provider that answers within the deadline would fail.
- **The gold quote leg goes out once NBP has answered**, because it is
  fetched at NBP's `asOf`, and it has only what is left of the
  deadline. When `asOf` is the requested date and the table for `date`
  is already going out, the leg waits for that request instead of
  sending a second one.
- The outbound requests run on threads of their own, each handed its
  provider, URL and deadline as values. They touch no database
  connection and no Flask context: caching and composing the response
  happen on the request's thread once every outbound request has
  returned. A breaker's count changes under a lock, because the table
  and the quote leg can be in flight to Frankfurter at once.
- The request limit, the failure count and the cool-off are operator
  config with those defaults, and the failure count and cool-off apply
  to each breaker alike (app-shell.md, Configuration).
- Provider errors are logged with the symbol and status, never with the
  requesting user's identity beyond what the access log already holds.

## Inputs / outputs

- In: symbol, quote currency, date. Never an amount.
- Out: a rate for one base unit, its `asOf` date and source, or No
  Content.

## Edge cases

- **Provider down, rate-limited, or timing out** → No Content; the
  client falls back to manual entry and says why. Recording a snapshot
  is never blocked by the proxy.
- **`symbol` equals `quote`** → OK with `rate: "1"`, `base` naming
  that unit, `asOf` set to the requested date, `source: "identity"`,
  `cached: false`, and **no outbound request**. The answer is 1 by
  definition, and Frankfurter errors on base = quote, so passing it
  through would turn the most trivially answerable question in the API
  into a provider error. The client never asks — the rate field is
  hidden for a main-currency holding (`record-snapshot.md`) — but the
  server answers correctly regardless, the same reason a
  `lookup: false` symbol answers No Content rather than Bad Request.
- **Symbol not in the server's symbol table** → Bad Request. Adding a
  symbol is an administrator action, not a user one
  (`admin-invites.md`).
- **Symbol in the table with `lookup: false`** (`XAG-ozt` and the rest)
  → No Content, no outbound request, no error log. A symbol with no
  provider adapter has no floor, so that holds at every date. One with
  an adapter and `lookup` turned off answers Bad Request before its
  floor, like any symbol with that floor. The client should not
  have asked — it holds the table — but the server must answer this way
  regardless, so that turning a symbol's lookup on later is a config
  change and nothing more.
- **Gold, non-PLN quote, FX leg fails** → No Content. Never return the
  PLN figure labelled with the requested quote.
- **A date before the symbol's or the quote's floor**, gold before
  2013-01-02 → Bad Request, not No Content — the request is out of
  range, not merely unanswerable. In the whole-table form the symbol is
  absent from the map, and when every symbol is, the answer is No
  Content with no outbound request.
- **Weekend, holiday, or pre-listing date** → return the most recent
  prior close with `asOf` set to that earlier date, and the client shows
  "rate as of 29 Jul" so the user can see the lag. If no prior close
  exists within a configured window, No Content.
- **Provider returns a rate in an unexpected currency** → reject and
  treat as no proposal rather than silently mislabelling it.
- **Provider returns a zero, negative, or non-numeric rate** → treated
  as no proposal.
- **Two holdings share a symbol** → one cache entry serves both, one
  outbound request, and one price entry in the vault
  (`record-rate.md`).
- **A whole-table request where every symbol fails** → No Content,
  rather than OK with an empty map. One meaning, one shape.
- **A whole-table request where some symbols fail** → OK with those
  symbols absent from the map. A partial table is the normal case:
  `lookup: false` symbols are always absent.

## Acceptance criteria

- A request for a supported symbol and past date returns a rate and, on
  repeat, `"cached": true` with no second outbound request.
- A request omitting `symbol` returns every symbol the proxy can price
  for that date and quote, with `lookup: false` symbols absent from the
  map, and costs at most one outbound request more than the gold path alone.
- A whole-table request followed by a single-symbol request for a symbol
  in it makes no second outbound request: the two forms share one cache.
- Recording across fifteen holdings in six symbols issues exactly one
  request to this endpoint.
- Today's rate is refetched after the 1-hour TTL and not before.
- A request with any parameter that could carry an amount is rejected
  with Bad Request; a test enumerates the accepted parameter set and
  asserts it is exactly `{symbol, date, quote}`, with `symbol` the only
  optional one.
- `symbol=http://192.168.1.1/`, `symbol=../../etc/passwd`, and a symbol
  matching the regex but absent from the symbol table are all rejected
  with Bad Request, and no outbound request is made.
- With the provider stubbed to reply `302` toward an internal address,
  no request to that address is made.
- With both providers stubbed to hang, a whole-table request returns
  No Content within `EGRESS_TIMEOUT_SECONDS` plus one second, rather
  than holding the connection. A stub that hangs accepts the connection
  and sends nothing until after the deadline, so the client's own
  timeout ends the wait, not a stub error.
- With Frankfurter stubbed to hang and NBP to answer, a whole-table
  request quoted in PLN with a currency symbol pending returns the gold
  symbols with their rates and no currency rate, within
  `EGRESS_TIMEOUT_SECONDS` plus one second. With NBP stubbed to hang
  and Frankfurter to answer, the same request returns the currency
  rates with the gold symbols absent, within the same bound.
- A gold request quoted in PLN makes exactly one outbound request, to
  NBP.
- After the configured number of consecutive failures of one provider,
  a request needing only that provider returns No Content without an
  outbound attempt, and that provider is asked again once the cool-off
  has passed. Asserted for each provider.
- With Frankfurter stubbed to fail and NBP to answer, whole-table
  requests quoted in PLN, each for a different date, open Frankfurter's
  breaker after the configured number of Frankfurter failures. Each
  request still sends its NBP request and returns the gold symbols with
  their rates, and once the breaker is open no Frankfurter request goes
  out within the cool-off.
- NBP successes interleaved with Frankfurter failures do not reset
  Frankfurter's count: its breaker opens on the configured Frankfurter
  failure, not later.
- With NBP stubbed to fail past the configured count, whole-table
  requests, each for a different date, still each send their Frankfurter
  request and return the currency rates, with only the gold symbols
  absent.
- A failing FX leg of a gold request counts against Frankfurter's
  breaker and not NBP's.
- An unauthenticated request returns Unauthorized and makes no outbound
  request.
- Every `/api/admin/symbols` route returns Not Found to a vault owner
  session, and `GET /api/rates/symbols` returns Not Found to an
  administrator session.
- `PATCH /api/admin/symbols/<symbol>` carrying a new `symbol` or a new
  `kind` is a Bad Request and changes nothing. There is no route that
  deletes a symbol, asserted by enumerating the registered routes.
- Retiring a symbol removes it from `GET /api/rates/symbols` and
  leaves `/api/rates` pricing it unchanged, so a holding already
  measured in it still resolves a rate. Unretiring restores it to the
  picker.
- `PATCH` setting `lookup: true` on a symbol with no configured
  provider adapter is a Bad Request, and so is `POST` creating one
  that way.
- `GET /api/admin/symbols` reports `hasAdapter: true` on exactly the
  symbols the adapter registry covers, asserted against the registry
  itself rather than a fixture, so the two cannot drift. Every symbol
  carrying `lookup: true` also carries `hasAdapter: true`.
- `POST` or `PATCH` carrying `hasAdapter` is a Bad Request and
  changes nothing.
- No response from any `/api/admin/symbols` route contains a count,
  list, or any other indication of which holdings use a symbol,
  asserted against the full response shape.
- An administrator adding a currency makes it available in the next
  registration's main-currency picker (`register.md`) with no restart.
- No log line, response body, or error page contains the provider API
  key.
- Exceeding the per-user rate limit returns Too Many Requests and
  writes no `attempts` row, so the limit lifts an hour after the
  oldest lookup it let through, however often the client retried.
- A future date is rejected with Bad Request.
- `GET /api/rates/symbols` returns exactly the symbols the server will
  accept at `/api/rates` — asserted by querying every returned symbol
  and getting no Bad Request, so the two can never drift. Symbols with
  `lookup: false` are included in this sweep and must answer No Content.
- `GET /api/rates/symbols` requires a session and makes no outbound
  request.
- The table contains all eight seeded metal symbols, with `lookup: true`
  on exactly `XAU-ozt` and `XAU-g`.
- `XAU-g` and `XAU-ozt` for the same date and quote differ by exactly
  31.1034768, to the precision returned.
- With NBP stubbed to publish nothing for a requested Saturday, the
  proposal returns the preceding published day with `asOf` set to it —
  and with nothing published in the whole 14-day window, No Content.
- A gold request with a non-PLN quote makes exactly two outbound
  requests, and the FX leg is fetched for the **`asOf` date**, not the
  requested date — asserted against a stub that would return a different
  rate for each.
- With the FX leg stubbed to fail, the response is No Content and no
  rate carrying a PLN figure under another currency's label is ever
  returned.
- A gold request dated 2012-12-31 returns Bad Request.
- `GET /api/rates/symbols` carries `since` on every row: `1999-01-04`
  for `USD`, `2000-01-13` for `BRL`, `2013-01-02` for `XAU-g` and
  `XAU-ozt`, and `null` for `XAG-ozt`. A currency whose `lookup` an
  administrator turned off keeps its date.
- For every row but `EUR` with a `since`, a single-symbol request
  quoted in `EUR` dated the day before it returns Bad Request with no
  outbound request. One dated `since` itself sends its outbound request
  when the row's `lookup` is on, and answers No Content with none when
  it is off. Asserted over the whole table, so `since` and the server's
  floor cannot drift.
- `XAG-ozt` dated 2012-12-31 and 1998-12-31 answers No Content with no
  outbound request.
- A whole-table request dated 2012-12-31 quoted in `CHF` sends
  Frankfurter's request and no NBP request, and returns the currencies
  with both gold symbols absent.
- A whole-table request dated 1999-06-30 quoted in `CHF` returns `USD`
  with `BRL`, `CNY`, `ILS` and `INR` absent. Quoted in `BRL`, it sends
  no outbound request, answers No Content, and leaves Frankfurter's
  failure count where it was.
- `symbol=CHF&quote=CHF` returns `rate: "1"` with no outbound request.
- Every outbound request is `FX_URL` or `NBP_URL` with only its
  placeholders filled, carrying exactly the two pinned headers,
  asserted against a stubbed opener for an FX table, gold quoted in PLN
  and gold quoted in CHF.
- A proposal equals the pinned composition: with a stub publishing
  `rates["USD"] = 1.0876` and `rates["PLN"] = 4.2537` against CHF and
  `cena = 251.37`, `USD` is `0.91945568` and `XAU-g` and `XAU-ozt` each
  equal `cena × (1 / 4.2537)`, the latter times 31.1034768, computed in
  `Decimal` and rounded half-even to 8 places, digit for digit.
- The environment variables the app reads are those app-shell.md,
  Configuration, names and the proxy variables `urllib` reads, and no
  others, asserted by recording every read of `os.environ` through
  start-up and a whole-table lookup. None of them changes the outbound
  URL or the TLS context.
- A `quote` that is a valid ISO 4217 code but absent from the symbol
  table is rejected with Bad Request — asserted with a code the FX
  provider does not serve, since that is the case a plain ISO check
  waves through.
