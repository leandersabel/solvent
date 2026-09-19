# Rate lookup

<!-- Everything outside the Providers section is provider-independent. -->

## What it does

A server-side proxy and cache that fetches conversion rates (FX, metals)
from a whitelisted public provider and serves an entry-date rate
**proposal** to the client. It exists so requests get cached and so no
browser individually leaks its update timing to a third party
(architecture.md, Data model).

The proposal is advice, never authority: the user can always override
it, and the value that lands in the snapshot is whatever the user
accepted (record-snapshot.md).

## Endpoint

`GET /api/rates?symbol=<SYMBOL>&date=<YYYY-MM-DD>&quote=<CCY>`

- `symbol` — the account's unit, which is its symbol
  (`manage-accounts.md`).
- `date` — the snapshot date.
- `quote` — the user's main currency, the currency to price into.
- Session-authenticated. Anonymous requests are refused, so the proxy is
  not an open relay.

Response OK:

```json
{ "rate": "3142.75", "base": "1 XAU-ozt", "quote": "CHF",
  "asOf": "2026-07-31", "source": "provider-name", "cached": true }
```

Response No Content — no proposal available (a symbol with
no provider yet, no data for that date, provider unreachable). The
client falls back to manual entry.

**The endpoint accepts no amount parameter, in any form.** This is the
base-amount rule made structural: the rate is always for one fixed base
unit (1 troy oz, one unit of the base currency), so there is no
field an amount could travel in even by mistake (architecture.md,
Base-amount rule). Any request carrying an unrecognised query parameter
is rejected with Bad Request rather than ignored.

## Providers

The proxy routes a request to a provider by the symbol's asset class.
Each provider is a server-side constant — host, URL template, and any
key — and never influenced by client input (see SSRF hardening below).

### FX

**Frankfurter's public instance, `api.frankfurter.dev`.** HTTPS, no API
key, no daily or monthly quota; requests are rate-limited only against
abuse, and the operators ask heavy users to cache, which this design
already does (see Caching). 201 currencies from 84 central banks, with
history back to 1948, so an FX symbol is simply an ISO 4217 code.

- An FX symbol is the **base currency code** (`USD`, `EUR`) — which is
  simply the account's unit — and `quote` is the user's main currency.
  A unit names the base asset only (`manage-accounts.md`).
- The currency half of the operator's symbol table can be seeded
  directly from the provider's own currency list rather than typed by
  hand.
- Rates are **not published for every calendar date**. A weekend,
  holiday, or pre-publication date resolves through the existing
  prior-close rule below, with `asOf` carrying the earlier date so the
  user sees the lag. This is the normal path, not an error.
- Because there is no API key, the key-redaction rule below has no FX
  component. No provider in this design has one. The rule stays because
  it binds any keyed provider added later — metals.dev is the live
  candidate (see Rejected below).
- Self-hosting Frankfurter is the same open-source service, so moving to
  a private instance later changes one host constant and nothing else.

### Gold

**Narodowy Bank Polski's public API, `api.nbp.pl`.** HTTPS (HTTP was
retired 2025-08-01), no API key, no quota, no account. Publishes the
price of 1 g of fine gold (millesimal fineness 1000) in PLN, daily, from
2013-01-02, queryable by date and by date range — the same shape as the
FX provider, and chosen for the same reasons: a central bank rather than
a vendor, nothing to sign up for, and one host constant to unwind.

- Lookup is a **range query**, not a single-date query: `GET
  /api/cenyzlota/{date−14d}/{date}` returns only the days NBP actually
  published, and the adapter takes the last entry on or before `date`.
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
  round once, at the end.
- **NBP's price trails the London fixing by one business day.** Verified
  against ten consecutive days: NBP's published price for date D is the
  previous business day's LBMA AM fixing at NBP's USD rate of that day,
  matching within 0.1%. So `asOf` will usually be one
  business day behind the snapshot date even midweek — not only across
  weekends. This is acceptable and deliberate: the proposal is advice,
  the user sees `asOf` and can override it with a better figure. Do not
  paper over it by stamping `asOf` with the requested date.
- History begins 2013-01-02, which is the date floor for gold symbols.
- No API key.

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

No lookup in v1. Their symbols are nonetheless **seeded in the symbol
table now** (see below) so the user enters the rate by hand against a
canonical symbol rather than inventing one. Adding a provider later is
then a server-side change with no migration and no stale user data.

### Listed securities — out of scope

Not deferred like the other metals: **there is nothing here to defer.**
Brokerage holdings are recorded at depot level (architecture.md, Data
model) — one account in the depot's reporting currency, holding the
total the broker reports. That total needs FX at most, which the FX
provider covers. So there is no security rate to fetch, no ticker
namespace to adopt into user records, and no `kind: equity` in the
symbol table.

Adding a `kind` later would be safe in a way that adding a *symbol* is
not: `kind` is operator config, while a symbol is written into
ciphertext as an account's unit. That asymmetry is why the metals are
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

The objection that generalizes: **a snapshot stores its rate
permanently, inside user ciphertext the server cannot read, enumerate,
or delete.** "Delete all data on termination" is unsatisfiable here by
construction, not a cache-policy problem a shorter TTL could fix. Any
future provider for any asset class must be checked against that, not
merely against request volume — the same test that eliminates LBMA for
gold.

## The symbol table

`GET /api/rates/symbols` → `[{ symbol, label, kind, lookup }]`, the
operator's configured symbol table. Session-authenticated, read-only,
cacheable.

It exists because **the account form's unit picker is built from it**
(`ui/account-form.md`): a user chooses what an account is measured in
from this list, and that choice is also its rate symbol
(`manage-accounts.md`). An unknown symbol stays a Bad Request at
`/api/rates` — the table means a user cannot reach that error by
choosing, only by hand-editing an export.

- `kind` — `currency` or `metal`. Display and grouping only.
- `lookup` — whether the proxy can price this symbol **today**. `false`
  means the symbol is valid and canonical but has no provider yet: the
  user enters the rate by hand, and `/api/rates` answers No Content, not
  Bad Request. This is a designed state, not a degraded one.

The table is operator configuration, not user data: it is identical for
every user, reveals nothing about who holds what, and adding a symbol
remains an operator action.

### Seeded symbols

Metal symbols are seeded for all four precious metals even though only
gold has a provider. **A symbol is a permanent identifier written into
user records** — it is the account's `unit` (`manage-accounts.md`); if a
user typing free text records `GOLD`, `xau`, or `XAUCHF` today, adding a
provider later means either abandoning those accounts or migrating
ciphertext the server cannot read. Seeding the canonical form now costs
eight config rows and removes that migration entirely. Because the unit
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
account's unit *is* its symbol, choosing `XAU-g` picks both at once and
the mismatch cannot occur (`manage-accounts.md`). Gold gets both entries
for free: NBP publishes per gram, so `XAU-g` is the raw figure and
`XAU-ozt` is the one conversion.

Currency symbols are seeded from Frankfurter's own currency list, all
with `lookup: true` (see Providers). They are what the unit picker
offers for an ordinary bank account or depot. There are no security
symbols and none are coming: a brokerage holding is a depot account
whose unit is a currency code like any other.

## Caching

- Cache key: `(symbol, quote, date)`. Stored in SQLite.
- **Past dates are cached indefinitely** — a historical rate does not
  change.
- **Today's date is cached for 1 hour**, then refetched.
- A cache hit issues no outbound request. Repeated entry across a
  household's accounts on the same day should mostly hit cache.
- Cache entries are public reference data, not user data: they are not
  per-user and hold nothing about who asked or how much they hold.

## SSRF and egress hardening

Non-negotiable, because the proxy runs where internal NAS services are
reachable (architecture.md, SSRF hardening):

- Provider hosts and URL templates are **server-side constants**. No
  part of the outbound URL's scheme, host, or port is derived from
  client input.
- `symbol` is validated against a strict allowlist before use: it must
  match `^[A-Z0-9][A-Z0-9._-]{0,15}$` **and** be present in the
  server's configured symbol table. Regex alone is not sufficient.
- `quote` must be a `kind: currency` row of the server's symbol table —
  the same set registration offers as a main currency (`register.md`).
  "A known ISO 4217 code" is the looser check and the wrong one: ISO
  4217 contains codes the FX provider cannot quote into, and `quote` is
  the user's main currency on every request the vault ever makes.
- `date` must parse as a calendar date, not be in the future, and not
  precede the floor configured **for that symbol** — 2013-01-02 for
  gold, the provider's own history start for others. A single global
  floor would either reject valid FX dates or wave through gold dates
  the provider has no data for.
- HTTP redirects are **disabled**, not followed to a validated target.
- Egress has a hard timeout (5 s connect + read) and a response size cap.
- Outbound requests go to HTTPS only, with certificate verification on.
- The provider API key, if any, is injected via environment config and
  never appears in a response, a log line, or an error message.

## Rate limiting and failure

- Per-user request limit on the endpoint, **default 120 per hour**,
  independent of the login limiter — a compromised session must not be
  usable to hammer the provider on the instance's API quota. A full
  sweep of thirty accounts costs at most thirty requests and mostly
  hits cache, so the limit sits far above honest use.
- A circuit breaker opens after **5 consecutive provider failures** and
  serves No Content directly for a **5-minute cool-off** instead of
  retrying per request.
- Both are operator config with those defaults (architecture.md, Rate
  limiting).
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
  hidden for a main-currency account (`record-snapshot.md`) — but the
  server answers correctly regardless, the same reason a
  `lookup: false` symbol answers No Content rather than Bad Request.
- **Symbol not in the server's symbol table** → Bad Request. Adding a
  symbol is an operator config change, not a user action.
- **Symbol in the table with `lookup: false`** (`XAG-ozt` and the rest)
  → No Content, no outbound request, no error log. The client should not
  have asked — it holds the table — but the server must answer this way
  regardless, so that turning a symbol's lookup on later is a config
  change and nothing more.
- **Gold, non-PLN quote, FX leg fails** → No Content. Never return the
  PLN figure labelled with the requested quote.
- **Gold date before 2013-01-02** → Bad Request, per the per-symbol
  floor, not a No Content — the request is out of range, not merely
  unanswerable.
- **Weekend, holiday, or pre-listing date** → return the most recent
  prior close with `asOf` set to that earlier date, and the client shows
  "rate as of 29 Jul" so the user can see the lag. If no prior close
  exists within a configured window, No Content.
- **Provider returns a rate in an unexpected currency** → reject and
  treat as no proposal rather than silently mislabelling it.
- **Provider returns a zero, negative, or non-numeric rate** → treated
  as no proposal.
- **Two accounts share a symbol** → one cache entry serves both, one
  outbound request.

## Acceptance criteria

- A request for a supported symbol and past date returns a rate and, on
  repeat, `"cached": true` with no second outbound request.
- Today's rate is refetched after the 1-hour TTL and not before.
- A request with any parameter that could carry an amount is rejected
  with Bad Request; a test enumerates the accepted parameter set and
  asserts it is exactly `{symbol, date, quote}`.
- `symbol=http://192.168.1.1/`, `symbol=../../etc/passwd`, and a symbol
  matching the regex but absent from the symbol table are all rejected
  with Bad Request, and no outbound request is made.
- With the provider stubbed to reply `302` toward an internal address,
  no request to that address is made.
- With the provider stubbed to hang, the endpoint returns No Content
  within the configured timeout rather than holding the connection.
- After the configured number of consecutive provider failures the
  circuit breaker returns No Content without an outbound attempt, and
  closes again after the cool-off.
- An unauthenticated request returns Unauthorized and makes no outbound
  request.
- No log line, response body, or error page contains the provider API
  key.
- Exceeding the per-user rate limit returns Too Many Requests.
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
- `symbol=CHF&quote=CHF` returns `rate: "1"` with no outbound request.
- A `quote` that is a valid ISO 4217 code but absent from the symbol
  table is rejected with Bad Request — asserted with a code the FX
  provider does not serve, since that is the case a plain ISO check
  waves through.
