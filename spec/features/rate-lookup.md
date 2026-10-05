# Rate lookup

A server-side proxy and cache that fetches conversion rates (FX, metals)
from a whitelisted public provider and serves an entry-date rate
**proposal** to the client. It exists so requests get cached and so no
browser leaks its update timing to a third party. It learns the date and
the main currency, never an amount and never which symbols a vault
holds. Everything outside Providers is provider-independent.

## What the client gets

You hold things that are not in your main currency: a dollar holding,
gold in a safe. Your net worth is one figure, so each needs a price for
the day you record it. The app looks that price up and fills it in. If
everything you own is in your main currency, you never meet this.

- **A proposal, never a verdict.** You can always change it, and what is
  kept is the number you saved (`record-rate.md`).
- **Every unit you hold is looked up**, because recording anything
  refreshes every rate (`record-rate.md`, The refresh). Updating one
  franc holding asks the sources about dollars and gold.
- **Where you meet a price**: the rate lines of a recording
  (`record-snapshot.md`, Update values, Snapshot entry and Recording
  detail), a holding's history (`manage-accounts.md`, Account detail),
  and the unit picker (`manage-accounts.md`, Account form), where
  choosing what a holding is measured in also decides whether its price
  can be looked up. The list is maintained in the administrator's Units
  section (`admin-invites.md`, Admin).
- **Free public sources, with nobody answerable for them**: currencies
  from central bank data republished by a free open source service,
  gold from the Polish central bank directly. No account, no fee, no
  contract. Gold is usually a day old, because the Polish central bank
  publishes one business day behind the London market. The app shows
  the day a price is for, and overriding it is one edit. A price looked
  up before the source published that day is looked up again an hour
  later, so the day's own price replaces it once published. Gold does not
  reach before 2013, so older gold entries take a price you type, and
  the app says so rather than reporting a failed lookup. If a source
  stops or changes, prices are typed by hand until the app is changed.
  That is survivable, because a price is only a proposal and no entry
  is ever blocked by a failed lookup.

What it deliberately does not do:

- **No share or fund prices.** A brokerage holding is one entry in the
  currency your broker reports, and only that currency is converted.
  There is no ticker anywhere (`manage-accounts.md`).
- **No silver, platinum or palladium prices yet.** All three are in the
  unit list by name, so you record them against the name the app keeps
  using and set the rate yourself, which carries forward until you
  change it. Adding a source later changes nothing you recorded.
- **You cannot add a currency or a metal to the list.** It is the same
  for everyone on the instance, and adding to it is an administrator's
  job. You can always type your own unit and prices instead.
- **No estimating between published days.** A day with nothing published
  gets the last published figure, labeled with its own date, never
  averaged, smoothed or interpolated.
- **No price tracking.** A unit's run of rates is a record, not a
  watchlist. No alerts, nothing fetched unless you are
  recording, and no screen you are only reading contacts a source.

## How it works

### Endpoint

`GET /api/rates?date=<YYYY-MM-DD>&quote=<CCY>[&symbol=<SYMBOL>]`

- `date`: the recording date. `quote`: the user's main currency.
  `symbol`: optional, one symbol, which is a holding's unit
  (`manage-accounts.md`). Omitted, the response covers the whole
  quotable table.
- Session-authenticated, so the proxy is not an open relay.

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
map**, never present with a null. Absence means what No Content means
for one symbol: no proposal at all (no provider yet, no data for that
date, provider unreachable). The client falls back to manual entry.

#### The client never names a symbol

**Every request the app makes omits `symbol`.** Recording anything
refreshes every holding's price (`record-rate.md`), so a per-symbol
fan-out would hand the proxy a complete, repeating list of what that
person holds, on the schedule they do their books. The whole-table form
reveals only the date and the main currency, which the server already
holds.

It costs almost nothing. The FX provider returns every currency against
one base in one call, and gold is one more plus its FX leg, so a whole
table for one `(date, quote)` is a bounded handful of outbound requests.
It is composed from, and populates, the same per-symbol cache entries
as the single form. The single-symbol form stays because the acceptance
sweep queries every symbol individually, which keeps
`/api/rates/symbols` and `/api/rates` from drifting apart.

**No amount parameter, in any form.** The rate is always for one fixed
base unit (1 troy oz, one unit of the base currency), so there is no
field an amount could travel in. An unrecognized query parameter is a
Bad Request, not ignored.

**A price the person typed or overrode is never sent here either.** It
is their valuation of their own holding (`record-rate.md`), and this
endpoint asks questions rather than reporting answers.

### Providers

The proxy routes a request to a provider by the symbol's asset class.
Each provider is a server-side constant (host, URL template, any key),
never influenced by client input or any setting (SSRF and egress
hardening).

**Every proposal is composed in `Decimal` at the default context's 28
significant digits and rounded once**, to 8 decimal places, half to
even, written as a plain decimal string with no trailing zeros and no
exponent. The steps before that rounding are pinned per provider below,
so an independent computation in the same order reaches the same digits
(`nightly-harness.md`, Known prices).

#### FX

**Frankfurter's public instance, `api.frankfurter.dev`.** HTTPS, no API
key, no quota, rate-limited only against abuse, and its operators ask
heavy users to cache, which Caching does. The `/v1` endpoints serve the
European Central Bank's reference rates from 1999-01-04. `BRL`, `CNY`,
`ILS` and `INR` first appear on 2000-01-13: before that the table omits
them, and a request with one as `base` answers Not Found. Each
currency's start is its floor (The symbol table). Frankfurter's history
back to 1948 from other central banks is not the API the app calls.

- An FX symbol is the **base currency's ISO 4217 code** (`USD`), which
  is the holding's unit, and `quote` is the main currency. A unit names
  the base asset only (`manage-accounts.md`).
- **Request**: `FX_URL`,
  `https://api.frankfurter.dev/v1/{date}?base={quote}`, with headers
  `User-Agent: USER_AGENT` (`Solvent/1.0 (self-hosted net worth
  tracker)`) and `Accept: application/json`. Both providers put a CDN in
  front that refuses an unnamed client. One request returns every
  currency against `quote`.
- **Read**: `base`, which must equal `quote`, `date`, the publication
  day, which becomes `asOf` (Edge cases, A publication date that is not
  usable), and `rates`, mapping each code to how many
  of it one `quote` buys. One unit of a code costs `1 / rates[code]`.
  An answer with no usable rate is a changed shape (Rate limiting and
  failure).
  Nothing else in the body is read.
- The provider's own currency list seeds the currency half of the
  symbol table and is the adapter registry's currencies. It is a
  constant in the code, never fetched. A currency outside it has no
  adapter.
- A weekend, holiday or a day not yet published resolves through the
  prior-close rule (Edge cases), with `asOf` carrying the earlier date.
  This is the normal path, not an error.
- No provider here has an API key. The key-redaction rule (SSRF and
  egress hardening) stays for any keyed provider added later, of which
  metals.dev is the live candidate.
- A self-hosted Frankfurter is the same service, so moving to a private
  instance changes one host constant.

#### Gold

**Narodowy Bank Polski's public API, `api.nbp.pl`.** HTTPS, no API key,
no quota, no account. It publishes the price of 1 g of fine gold
(millesimal fineness 1000) in PLN, daily, from 2013-01-02, by date and
by date range. Chosen for the FX provider's reasons: a central bank
rather than a vendor, nothing to sign up for, one host constant to
unwind.

- Lookup is a **range query**: `NBP_URL`,
  `https://api.nbp.pl/api/cenyzlota/{start}/{end}?format=json`, `start`
  14 days, `NBP_WINDOW`, before `date`, `end` equal to it, the FX request's headers. It
  returns only published days, ascending. The adapter reads each
  entry's `cena`, PLN per gram, and its `data`, its day, usable within
  the window (Edge cases, A publication date that is not usable). The
  last entry is NBP's last day, and an unusable earlier entry is
  dropped. That is the prior-close rule in one request with no retry
  loop. NBP answers an empty window Not Found,
  which is No Content, so an empty array is a changed shape (Rate
  limiting and failure). A single-date query answers Not
  Found on every weekend and Polish holiday, so it is the wrong call.
  The API caps a range at 93 days.
- **Quoted in PLN**, `asOf` is NBP's last day and the price its `cena`.
- **The quote conversion is a second leg.** A non-PLN `quote` is
  converted PLN to quote through Frankfurter, with both halves for one
  day, the **gold day**: the latest day on or before `date` on which
  NBP published a price and Frankfurter a table. FX from a different
  day misprices the rate. The leg asks Frankfurter for NBP's last day.
  When the table's `date` is a day NBP published, that is the gold day,
  so a day the ECB skips, such as Good Friday, prices gold at the day
  before. Otherwise the leg asks again for NBP's last day before the
  table's `date`, and with no such day in the window there is no
  proposal. The gold day becomes `asOf`, and both `cena` and the PLN
  rate are that day's. Both sources answering is never No Content only
  because their days differ. Either leg failing yields No Content,
  never a half-composed rate. `source` names the chain:
  `"nbp+frankfurter"`, or `"nbp"` when the quote is PLN.
- **Unit conversion is exact**: `XAU-g` takes NBP's figure, `XAU-ozt`
  multiplies by 31.1034768. Compose in this order: `cena × (1 /
  rates["PLN"])` from the `asOf` table (`cena` alone for PLN), then `×
  31.1034768` for `XAU-ozt`, then the one rounding (Providers).
- **NBP trails the London fixing by one business day.** Its price for D
  is the previous business day's LBMA AM fixing at NBP's USD rate, within
  0.1%, so `asOf` is usually a business day behind even midweek. That is
  acceptable, because the proposal is advice the user sees dated and can
  override. Never stamp `asOf` with the requested date.
- 2013-01-02 is the `since` of both gold symbols (The symbol table).

Rejected:

- **LBMA's own JSON feeds** (`prices.lbma.org.uk`): keyless, CORS-open,
  every metal back to 1968 in USD, GBP and EUR, and fails on licensing.
  IBA requires a licence "in order to obtain, use or redistribute
  real-time or historical benchmark data … including for pricing and
  valuation activities", which is this use. The World Gold Council
  removed its historical LBMA series at IBA's request in March 2025.
  Public reachability is not permission.
- **Twelve Data** forbids caching beyond documented timeframes, which
  the indefinite cache breaches.
- **metals.dev** stays the fallback if silver, platinum or palladium
  lookup is wanted: USD per troy ounce, all four metals, storage
  unrestricted, at the cost of an API key, a vendor account, about 5
  years of history and a 100 request per month free tier.

#### Silver, platinum, palladium: deferred, but symbolled

No lookup. Their symbols are **seeded** (Seeded symbols), so the rate is
entered by hand against a canonical symbol, and adding a provider later
is a server-side change with no migration and no stale user data.

#### Listed securities: out of scope

**There is nothing to defer.** Brokerage holdings are recorded at depot
level (architecture.md, Data model), in the depot's reporting currency,
so they need FX at most. There is no security rate to fetch, no ticker
namespace in user records, and no `kind: equity` in the symbol table.
Adding a `kind` later is safe in a way adding a *symbol* is not: `kind`
is operator config, while a symbol is written into ciphertext as a
holding's unit. That is why the metals are seeded and securities are
not.

Rejected, the licensing being largely closed:

- **Tiingo**: the free tier permits data "only transiently in volatile
  memory or in a temporary, non-persistent cache". Paid tiers require
  deletion on downgrade or expiry.
- **EODHD** and **Financial Modeling Prep**: a non-professional may
  store and analyze the data, but must delete every copy, cached included, within a
  month of the subscription ending.
- **Stooq**: keyless CSV, but serves a JavaScript proof-of-work
  challenge to non-browser clients, which blocks server-side access and
  answers the licensing question too.
- **Alpha Vantage**: the only clean licence (personal, non-commercial,
  no retention, caching or deletion clause). Ruled out on fit: 25
  requests a day for the whole instance, and thin coverage of European
  listings.

**The objection that generalizes binds every future provider**, paid
ones included. A rate is stored permanently as a vault record, inside
ciphertext the server cannot read, enumerate or delete, so terms
requiring deletion of all data on termination are unsatisfiable by
construction, not a cache policy a shorter TTL could fix. Every provider
is checked against this, not merely against request volume. The same
test eliminates LBMA.

### The symbol table

`GET /api/rates/symbols` returns `[{ symbol, label, kind, lookup,
since }]`, the configured table without retired rows. Session-
authenticated, read-only, cacheable, no outbound request.

It exists because **the unit picker is built from it**
(`manage-accounts.md`, Account form): the unit a holding is measured in
is also its rate symbol. An unknown symbol is a Bad Request at
`/api/rates`, which no user reaches by choosing: the client never names
a symbol, and a free-text unit draws no proposal rather than an error.

- `kind`: `currency` or `metal`. Display and grouping only.
- `lookup`: whether the proxy can price this symbol **today**: the
  stored flag and an adapter, read together wherever it is used, so a
  row stored with the flag on and no adapter reads `false`. `false`
  means valid and canonical with no provider yet: the rate is entered by
  hand and `/api/rates` answers No Content, not Bad Request. A designed
  state, not a degraded one.
- `since`: the symbol's floor, `YYYY-MM-DD`, or `null` with no provider
  adapter. It does not follow `lookup`, because the floor is the
  provider's fact, and a main currency whose `lookup` is off still
  bounds every rate quoted into it. The client computes from it, with no
  request, whether a rate source applies at a date (`record-rate.md`,
  Reading).

**A symbol's floor is the first date its provider publishes it**:
1999-01-04 for Frankfurter, 2013-01-02 for NBP, later for a currency
whose series starts later (Providers, FX). No adapter, no floor. The
floor is a server-side constant from the adapter registry, like
`hasAdapter`, never stored on the row or set through any route. A
currency an administrator adds has no adapter, because every currency
Frankfurter serves is seeded, so it has no floor and its `lookup` reads
`false`.
`GET /api/admin/symbols` carries no `since`, because no administrator
decision turns on it: `lookup` is refused only for want of an adapter.

**A rate source applies to a date only on or after the later of the
symbol's floor and the quote's.** A single-symbol request before it is a
Bad Request that reaches no provider, and the whole-table form leaves
the symbol out and asks no provider for it. The quote's counts because
Frankfurter answers Not Found for a `base` before its start. Before that
date nobody published a price, so no provider is asked, and the
client treats the symbol as one its owner prices (`record-rate.md`,
Reading), a designed state like `lookup: false`, never an outage.

**A quote no source serves is asked nothing.** A `quote` that is a
currency row with no adapter answers No Content, at any date and for
any symbol, with no outbound request, because every rate into it needs
Frankfurter to quote into it. Such a currency is never offered as a
main currency (`register.md`, Rules), and a vault that has one asks
nothing (`record-rate.md`, Reading).

The table is platform configuration: identical for every account and
revealing nothing about who holds what. **Maintaining it is an
administrator task** (`admin-invites.md`, The admin boundary), which it
clears without an exception, because no row is anyone's data. Its
screen is the Units section of `admin-invites.md`, Admin.

#### Maintaining the table

Under `/api/admin/`, administrator session only, CSRF-protected, Not
Found to a vault owner (`app-shell.md`, The two surfaces).

- `GET /api/admin/symbols`: the full table including retired rows, each
  with `symbol`, `label`, `kind`, `lookup` as it reads, `retired` and
  **`hasAdapter`**, whether this deployment has a provider adapter for
  it. `hasAdapter` is derived from the registry, read-only, and `POST`
  and `PATCH` reject it like any unknown field.
- `POST /api/admin/symbols` `{ symbol, label, kind, lookup }`: adds a
  row. `symbol` must match the canonical form (SSRF and egress
  hardening) and not exist yet.
- `PATCH /api/admin/symbols/<symbol>` `{ label?, lookup?, retired? }`:
  changes only those three.

**`symbol` and `kind` are immutable, and there is no delete.** A symbol
is written into user records as a holding's `unit`, inside ciphertext.
The server cannot tell whether it is in use, migrate the records, or
warn the administrator about to strand them. Renaming or deleting
`XAU-ozt` would leave holdings measured in nothing, found only by their
owner one at a time, and fixable only by hand-editing an export.

- **`kind` is immutable for one more reason**: `quote` must be a
  `kind: currency` row, and a vault's main currency is fixed at
  registration (`register.md`). Flipping a currency to a metal would
  break every lookup a vault has made.
- **`retired: true` replaces deleting.** A retired symbol leaves
  `GET /api/rates/symbols`, so no new holding can be measured in it, and
  stays valid everywhere else: `/api/rates` still prices it, existing
  holdings keep working, and unretiring restores it exactly. Same shape
  as archiving a dimension (`account-settings.md`, Deleting is
  archiving): reversibility costs one flag, and deletion cannot be
  undone.
- **`lookup` is the mutable one that matters.** It flips when a provider
  appears for a metal, the main reason this surface exists. The server
  refuses `lookup: true` for a symbol with no adapter, on `POST` and
  `PATCH`, so the flag cannot promise a proposal the proxy cannot serve.
  **`hasAdapter` lets the screen avoid that refusal**, disabling the
  control with its reason in place. The server keeps refusing anyway,
  because a page open since before an adapter changed is stale, and a
  client's knowledge of the registry is not a control.
- **`label` is display text and changes freely.** No user record stores
  it, so a rename rewrites nothing. The picker renders it with
  `textContent`, never `innerHTML`, because server-controlled text is
  still text (architecture.md, Application hardening).

**No response here counts the holdings that use a symbol**, and none
could, because the server cannot read a `unit`. An administrator
retiring a symbol is told what it means rather than shown who it
affects.

#### Seeded symbols

All four precious metals are seeded though only gold has a provider.
**A symbol is a permanent identifier written into user records**
(`manage-accounts.md`). Had a user typed `GOLD`, `xau` or `XAUCHF`,
adding a provider later would mean abandoning those holdings or
migrating ciphertext the server cannot read. Seeding the canonical form
costs a few rows, and because the picker offers the table before free
text, it is also the path of least resistance.

The naming rule is generative: **`<ISO 4217 metal code>-<unit>`**, unit
`ozt` or `g`.

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

Both units exist because the rate must be per the holding's own unit: a
rate per troy ounce against grams is off by a factor of 31. The unit
*is* the symbol, so choosing `XAU-g` picks both and the mismatch cannot
occur. NBP publishes per gram, so `XAU-g` is the raw figure and
`XAU-ozt` the one conversion.

Currency symbols are seeded from Frankfurter's currency list, all with
`lookup: true`, for an ordinary bank account or depot. **There are no
security symbols and none are coming** (Listed securities: out of
scope).

### Caching

- Cache key `(symbol, quote, date)`, in SQLite.
- **An entry for date D fetched at or after 00:00 UTC on D+2 is cached
  indefinitely**, because by then both sources have published D and a
  published rate does not change. **Every other entry is cached for 1
  hour** after it was fetched, then refetched, because it may hold the
  prior close of a day not yet published. Weekends and holidays settle
  at D+2 like any other date.
- Settling reads only when the entry was fetched, never its `asOf`,
  because an `asOf` before D reads the same whether D is a day nothing
  is published or a day not yet published.
- A cache hit issues no outbound request, so a household's entries on
  one day mostly hit cache.
- Entries are public reference data: not per-user, holding nothing about
  who asked or how much they hold.

### SSRF and egress hardening

Non-negotiable, because the proxy runs where other services on the
host's network are reachable.

- Provider hosts and URL templates are **server-side constants**. No
  part of the outbound URL's scheme, host or port comes from client
  input.
- `symbol` must match `^(?=.{1,16}$)[A-Z0-9][A-Z0-9._]*(-[a-z]+)?$`
  **and** be in the symbol table. Regex alone is not sufficient. The
  pattern is the canonical form of Seeded symbols, an upper-case code
  and an optional lower-case unit: it admits `XAU-ozt` and refuses `usd`
  and `xau-ozt`, so the table cannot hold two spellings of one symbol.
- `quote` must be a `kind: currency` row, the set registration offers as
  a main currency (`register.md`). "A known ISO 4217 code" is the looser
  check and the wrong one: ISO 4217 has codes the FX provider cannot
  quote into.
- `date` must be a calendar date written `YYYY-MM-DD` exactly as
  `date.isoformat()` writes it, not in the future, and for a symbol
  with an adapter, whatever its `lookup`, on or after its applicable
  floor (The symbol table). A single global floor would reject valid FX
  dates or wave through gold dates with no data.
- HTTP redirects are **disabled**, not followed to a validated target.
- Egress has a hard deadline, `EGRESS_TIMEOUT_SECONDS` = 5, for
  connect and the whole read together across one proxy request (shared
  as in Rate limiting and failure), and a response cap,
  `MAX_RESPONSE_BYTES` = 1 MiB. A body over the cap fails rather than
  being cut short. A socket timeout bounds each receive on its own, so
  a provider sending its answer a byte at a time would outlast it: the
  read runs on a daemon thread the request waits for only until the
  deadline, and at the deadline the sockets that thread opened are shut
  down, so it receives nothing past it, whether the headers, a chunked
  body or a sized one is arriving. A provider that has not answered by
  then has failed.
- `solvent.rates` exposes `FX_URL`, `NBP_URL`, `NBP_WINDOW`,
  `USER_AGENT`, `EGRESS_TIMEOUT_SECONDS`, `MAX_RESPONSE_BYTES` and `SEEDED_SYMBOLS`
  under those names, because the nightly source check imports them to
  request exactly what the app does (`nightly-harness.md`, The source
  checks). Renaming one breaks that check.
- Outbound requests are HTTPS only, with certificate verification on.
- No provider API key appears in any response, log line or error
  message.
- **No setting names a provider.** No environment variable, config
  value, flag or request names a provider host, URL template or
  certificate authority. Verification uses the image's system trust
  store at OpenSSL's default paths, and the app adds no CA. So nothing
  built for testing can redirect an installation's lookups: the nightly
  harness reaches its stand-in through name resolution and a trust store
  mounted over the system's (`nightly-harness.md`).
- A proxy in the deployment's `https_proxy`, which `urllib` honors, can
  carry a connection but not change where it ends: the certificate is
  still verified against the provider's own name.

### Rate limiting and failure

- A per-user request limit, **default 120 per hour**, independent of the
  login limiter, so a compromised session cannot hammer the provider on
  the instance's quota. A sweep of any size costs **one** request, the
  whole table once per recording date (`record-rate.md`, The refresh),
  so the limit sits far above honest use. Its rows are in
  architecture.md, Application hardening. A refused request writes no
  row.
- **Each provider has its own circuit breaker**, keyed `frankfurter` and
  `nbp`. After **5 consecutive failures** of its provider it opens, and
  for a **5-minute cool-off** fails that provider's requests without
  sending them, instead of retrying per request, so every symbol needing
  it gets no proposal. The
  breakers live in process memory, so a restart resets them.
- A failure is an outbound request that cannot connect, times out,
  answers anything but 200 or Not Found, answers a body that is not
  JSON, or answers JSON in a changed shape. A success is an answer the
  adapter reads a figure from, and resets its own provider's count and
  no other.
- **Not Found is what the source does not publish**, such as a currency
  before its series starts: no proposal, neither a failure nor a
  success, and no log line. Counting it would let one vault asking about
  such a day open the breaker for every other vault. A moved endpoint
  still shows in the nightly source check (`nightly-harness.md`, The
  source checks).
- **A changed shape** is, for Frankfurter, anything but an object whose
  `base` equals `quote`, whose `date` is usable and whose `rates` is an
  object holding at least one usable rate. For NBP it is anything but a
  non-empty array whose last entry is an object with a usable `cena`
  and a usable `data`. Usable means as Edge cases says for a figure and
  a publication date. An unusable rate in an otherwise usable table is
  dropped and the rest stands, because one bad code must not open the
  breaker on every currency. A source that keeps answering in a changed
  shape opens its breaker like one that is down, and the log says why.
- The gold lookup's currency leg is a Frankfurter request and counts
  against Frankfurter. So while Frankfurter is down, NBP requests still
  go out and gold quoted in PLN still resolves, and while NBP is down,
  currency lookups still go out. A shared breaker would let one
  provider's outage silence the other, and the other's successes keep
  resetting the count.
- **At most `LOOKUP_CONCURRENCY` = 4 proxy requests send at once.**
  One that finds 4 already sending answers what needs no source,
  cached and identity symbols, sends nothing and leaves the breakers
  as they were. Its other symbols get no proposal, as for a provider
  that is down. Waiting for a turn would hold a request thread for the
  lookups ahead of it, which is what the cap prevents
  (architecture.md, WSGI server).
- **A proxy request sends only what its pending symbols need**, a
  pending symbol being one neither cached nor the identity case:
  Frankfurter's table for `date` when a currency symbol is pending,
  NBP's range query when a gold symbol is, and the gold quote leg only
  for gold quoted in anything but PLN.
- **Frankfurter's table and NBP's range query go out at once**, and the
  request waits for both within its one `EGRESS_TIMEOUT_SECONDS`
  deadline. One after the other, a hanging provider would use up the
  deadline and silence the other until its breaker opened. A share of
  the deadline per provider avoids that too, but fails a slow provider
  that answers within the whole deadline.
- **The gold quote leg goes out once NBP has answered**, because it is
  fetched at NBP's last day, with what is left of the deadline. When
  that is the requested date and the table for `date` is already going
  out, the leg waits for that request instead of sending a second. Each
  further request toward the gold day goes out after the one before
  has answered, within the same deadline, and counts against
  Frankfurter's breaker.
- Outbound requests run on threads of their own, each handed its
  provider, URL and deadline as values. They touch no database
  connection and no Flask context: caching and composing happen on the
  request's thread once all have returned. A breaker's count changes
  under a lock, because the table and the quote leg can be in flight to
  Frankfurter at once.
- The request limit, the failure count and the cool-off are operator
  config with those defaults, the last two applying to each breaker
  alike (`app-shell.md`, Configuration).
- A failed fetch logs one warning, `rates.provider source=<source>
  status=<status>`. `source` is `frankfurter` or `nbp`. `status` is the
  HTTP status of an answer that was not 200, `shape` for a changed
  shape, else the first that fits of `timeout`, `tls`, `network`, `body`
  and `other`. The line holds nothing of the answer's body, and no
  URL, date, quote or error text, because the URL carries the quote and
  date asked for, which the access log, recording the path without its
  query, does not. A fetch the breaker or the spent deadline skips logs
  nothing.

## Edge cases

- **Provider down, rate-limited or timing out**: No Content. The client
  falls back to manual entry and says why. Recording is never blocked by
  the proxy.
- **`symbol` equals `quote`**: OK with `rate: "1"`, `base` naming that
  unit, `asOf` the requested date, `source: "identity"`,
  `cached: false`, and **no outbound request**. The answer is 1 by
  definition, and Frankfurter errors on
  base equal to quote, so passing it through would turn the most
  trivial question into a provider error. The client never asks,
  because a main-currency holding has no rate line, but the server
  answers correctly regardless.
- **A quote with no adapter**: No Content with no outbound request,
  whatever the symbol and date (The symbol table).
- **Symbol not in the table**: Bad Request. Adding one is an
  administrator action (`admin-invites.md`).
- **Symbol with `lookup: false`** (`XAG-ozt` and the rest): No Content,
  no outbound request, no error log, at every date when it has no
  adapter. One with an adapter and `lookup` off answers Bad Request
  before its floor, like any symbol with that floor. The client should
  not have asked, but answering this way keeps turning lookup on later a
  config change and nothing more.
- **Gold, non-PLN quote, FX leg fails**: No Content, never the PLN
  figure under the requested quote's label.
- **Gold, non-PLN quote, on a day NBP published and the ECB did not**,
  such as Good Friday, or before Frankfurter's table for the day is
  out: priced at the gold day (Providers, Gold), never NBP's day paired
  with an earlier table.
- **A date before the symbol's or the quote's floor**, gold before
  2013-01-02: Bad Request, because the request is out of range rather
  than unanswerable. In the whole-table form the symbol is absent, and
  when every symbol is, the answer is No Content, never Bad Request,
  with no outbound request and no change to any breaker's count.
- **Weekend, holiday or a day not yet published**: the most recent
  prior close, `asOf` that earlier date, and the client shows "rate as
  of 29 Jul". A currency takes the prior close Frankfurter answers with,
  with no window of its own. Gold quoted in PLN takes the last day in
  NBP's fixed 14-day range, and gold quoted in anything else the gold
  day within it (Providers, Gold). No such day is No Content.
- **A rate in an unexpected currency**: a changed shape, so no proposal
  from that table, never a mislabeled one.
- **A figure that is not a usable price**: a source's rate or gold
  price is usable only as a JSON number, not a string or a boolean,
  above 0 and below 10^20. A proposal is served only when, rounded, it is
  above 0 and below 10^20, the most that keeps 8 decimal places in 28
  digits. Anything else is no proposal for the symbols built from that
  figure, never an error or a price of 0, and the rest of the answer
  stands. A bad PLN rate drops gold quoted in anything but PLN. A bad
  NBP price, or a Frankfurter table with no usable rate, is a changed
  shape: it drops what that source prices and counts as a failure. A
  cached `"0"` is a miss, so it is fetched
  again and replaced.
- **A publication date that is not usable**: Frankfurter's `date` or
  NBP's `data` becomes `asOf` only as a string `s` for which
  `date.fromisoformat(s).isoformat() == s`, no later than the requested
  `date`, and for NBP no earlier than the start of its 14-day window.
  Anything else is a changed shape: that source's symbols are absent,
  never an error or a proposal dated a day it is not for, and the rest
  of the answer stands. A bad Frankfurter date drops the currencies and
  gold quoted in anything but PLN, and a bad NBP date drops both gold
  symbols. A cached row whose `asOf` fails the same test against its
  `date` is a miss, so it is fetched again and replaced.
- **Two holdings share a symbol**: one cache entry, one outbound
  request, one price entry in the vault (`record-rate.md`).
- **Whole table, every symbol fails**: No Content rather than OK with an
  empty map. One meaning, one shape.
- **Whole table, some symbols fail**: OK with those symbols absent. A
  partial table is the normal case, because `lookup: false` symbols are
  always absent.

## Acceptance criteria

1. With the price service off, every figure can still be entered and
   saved by hand, and the screen says in a sentence why the field is the
   person's to fill. Test: `tests/browser/parts/update-values.mjs`.
2. A unit whose source did not answer gets no rate entry that day, and
   the day can be filled in later by opening its recording. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
3. Every rate request the app makes omits `symbol`, so the pattern of
   lookups is the same whichever holding was updated. Test:
   `tests/browser/parts/account-detail.mjs`,
   `tests/test_client.py::test_the_client_side_rules_hold`.
4. (blind) Recording across fifteen holdings in six symbols issues
   exactly one request to this endpoint, asserted as a count, since every
   data assertion passes under a per-symbol fan-out. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
5. (blind) The accepted parameter set is exactly `{symbol, date,
   quote}`, with `symbol` the only optional one, and any other parameter
   is a Bad Request. Asserted by enumerating the set, because a handler
   that ignores extra parameters passes every functional test. Test:
   `tests/test_rates.py::test_the_accepted_parameter_set_is_exactly_symbol_date_and_quote`.
6. A proposal for a date with nothing published shows the earlier day
   it is for, never the recording date. Test:
   `tests/browser/parts/update-values.mjs`,
   `tests/browser/parts/update-values-review-prior-close.mjs`.
7. With NBP publishing nothing for a requested Saturday, the proposal
   carries the preceding published day as `asOf`, and with nothing in
   the whole 14-day window the answer is No Content. A currency takes
   Frankfurter's prior close however far back it lies. Test:
   `tests/test_rates.py::test_the_nbp_range_query_takes_the_last_published_day_on_or_before`,
   `tests/test_rates.py::test_nothing_published_in_the_window_is_no_content`,
   `tests/test_review_rate_lookup.py::test_a_saturday_takes_fridays_close_for_every_class`,
   `tests/test_review_rate_lookup.py::test_a_currency_takes_frankfurters_prior_close_however_far_back`,
   `tests/test_review_rate_lookup.py::test_gold_asks_nbp_for_the_14_days_up_to_the_date`,
   `tests/test_review_rate_lookup.py::test_gold_asks_nbp_for_the_window_solvent_rates_exposes`,
   `tests/test_review_rate_lookup.py::test_an_empty_gold_range_quoted_in_pln_is_no_content`.
8. `XAU-g` and `XAU-ozt` for the same date and quote differ by exactly
   31.1034768, to the precision returned. Test:
   `tests/test_rates.py::test_gold_in_grams_and_troy_ounces_differ_by_exactly_the_conversion`.
9. A unit with no price source reads as one ("No market price for
   silver yet", "Nobody publishes a price for m2"), and reads as normal,
   not broken. Test: `tests/browser/parts/update-values.mjs`.
10. A date before a source's prices begin reads as that, and an outage
    reads as an outage, each worded differently from the other and from
    a unit with no source. Test: no test.
11. A request for a supported symbol and past date returns a rate, and a
    repeat returns `"cached": true` with no second outbound request, so
    asking twice costs once whoever asks. Test:
    `tests/test_rates.py::test_a_supported_symbol_resolves_and_then_serves_from_cache`.
12. A request omitting `symbol` returns every symbol the proxy can price
    for that date and quote, with `lookup: false` symbols absent from the
    map, never null, and costs at most one outbound request more than the
    gold path alone. Test:
    `tests/test_rates.py::test_a_whole_table_request_omits_symbols_the_proxy_cannot_price`.
13. (blind) A whole-table request followed by a single-symbol request for
    a symbol in it makes no second outbound request. Test:
    `tests/test_rates.py::test_the_whole_table_and_a_single_symbol_share_one_cache`,
    `tests/test_review_rate_lookup.py::test_the_whole_table_and_a_single_symbol_share_one_unsettled_entry`.
14. An entry fetched under an hour ago is served from cache whatever its
    date. Test:
    `tests/test_rates.py::test_a_price_fetched_under_an_hour_ago_is_served_from_cache_whatever_its_date`,
    `tests/test_review_rate_lookup.py::test_a_price_looked_up_under_an_hour_ago_is_served_from_cache_whatever_its_date`,
    `tests/test_review_rate_lookup.py::test_a_price_looked_up_before_d_plus_2_is_looked_up_again_after_an_hour`.
15. The app keeps no record of who asked about which rate: cache entries
    carry no user. Test: no test.
16. `symbol=http://192.168.1.1/`, `symbol=../../etc/passwd`, and a
    symbol matching the regex but absent from the table are each a Bad
    Request, with no outbound request. Test:
    `tests/test_rates.py::test_an_unknown_or_malformed_symbol_makes_no_outbound_request`.
17. (blind) With the provider stubbed to reply `302` toward an internal
    address, no request to that address is made, asserted on the
    requests sent rather than on the response being an error. Test:
    `tests/test_rates.py::test_redirects_are_disabled_rather_than_followed`.
18. (blind) With both providers stubbed to really hang (accept the
    connection, send nothing until after the deadline), a whole-table
    request returns No Content within `EGRESS_TIMEOUT_SECONDS` plus one
    second, both providers asked at once. A stub that errors at once
    passes while the requests are still sequential. Test:
    `tests/test_rates.py::test_both_providers_hanging_gives_no_content_within_the_bound_and_both_are_asked_at_once`.
19. (blind) With Frankfurter hanging and NBP answering, a whole-table
    request quoted in PLN with a currency symbol pending returns the gold
    symbols with their rates and no currency rate, within the same
    bound. Test:
    `tests/test_rates.py::test_frankfurter_hanging_leaves_the_gold_symbols_in_a_pln_table`.
20. (blind) With NBP hanging and Frankfurter answering, the same request
    returns the currency rates with the gold symbols absent, within the
    same bound. Test:
    `tests/test_rates.py::test_nbp_hanging_leaves_the_currency_rates`.
21. (blind) A request sends only what its pending symbols need: only
    currency symbols send no NBP request, only gold symbols send no
    Frankfurter table, and gold quoted in PLN sends no quote leg,
    asserted on the recorded outbound requests. Test:
    `tests/test_rates.py::test_a_request_sends_only_what_its_pending_symbols_need`.
22. A gold request quoted in PLN makes exactly one outbound request, to
    NBP. Test:
    `tests/test_rates.py::test_a_gold_request_quoted_in_pln_makes_exactly_one_request_to_nbp`.
23. (blind) The quote leg waits for NBP, and when `asOf` is the
    requested date with a currency symbol pending, it reuses the table in
    flight, so Frankfurter gets one request rather than two. Test:
    `tests/test_rates.py::test_the_quote_leg_reuses_the_table_in_flight_when_asof_is_the_requested_date`,
    `tests/test_rates.py::test_the_quote_leg_waits_for_nbp_and_gets_only_a_table_for_its_own_asof`.
24. (blind) Outbound requests touch no database connection and no Flask
    context, caching and composing run on the request's thread, and a
    breaker's count loses no update when changed from several threads at
    once. Test:
    `tests/test_rates.py::test_outbound_requests_run_on_threads_with_no_flask_context`,
    `tests/test_rates.py::test_a_breaker_count_changed_from_many_threads_loses_no_update`.
25. (blind) After the configured number of consecutive failures of one
    provider, a request needing only that provider returns No Content
    without an outbound attempt, and that provider is asked again once
    its own cool-off has passed while the other is left untouched,
    asserted per provider with a stubbed clock. Test:
    `tests/test_rates.py::test_each_provider_is_asked_again_after_its_own_cooloff`,
    `tests/test_rates.py::test_the_circuit_breaker_opens_and_closes`.
26. (blind) With Frankfurter failing and NBP answering, PLN-quoted
    whole-table requests, each for a different date, still send their NBP
    request and return the gold symbols, Frankfurter's breaker opens
    after the configured Frankfurter failures, and no Frankfurter request
    goes out within the cool-off. Test:
    `tests/test_rates.py::test_frankfurter_failing_opens_its_breaker_while_nbp_keeps_answering`.
27. (blind) NBP successes interleaved with Frankfurter failures do not
    reset Frankfurter's count: its breaker opens on exactly the configured
    Frankfurter failure. Test:
    `tests/test_rates.py::test_frankfurter_failing_opens_its_breaker_while_nbp_keeps_answering`.
28. (blind) With NBP failing past the configured count, whole-table
    requests, each for a different date, still send their Frankfurter
    request and return the currency rates, with only the gold symbols
    absent. Test:
    `tests/test_rates.py::test_nbp_failing_past_the_count_stops_only_the_gold_symbols`.
29. (blind) A failing FX leg of a gold request counts against
    Frankfurter's breaker and not NBP's, asserted by how many requests
    each provider then receives. Test:
    `tests/test_rates.py::test_a_failing_fx_leg_of_gold_counts_against_frankfurter_not_nbp`.
30. An unauthenticated request returns Unauthorized and makes no
    outbound request. Test:
    `tests/test_rates.py::test_an_unauthenticated_request_makes_no_outbound_request`.
31. Every `/api/admin/symbols` route returns Not Found to a vault owner
    session. Test:
    `tests/test_admin.py::test_a_vault_owner_gets_not_found_from_every_admin_route`.
32. `GET /api/rates/symbols` returns Not Found to an administrator
    session. Test:
    `tests/test_rates.py::test_the_symbol_table_answers_an_administrator_not_found`.
33. `PATCH /api/admin/symbols/<symbol>` carrying a new `symbol` or a new
    `kind` is a Bad Request and changes nothing. Test:
    `tests/test_rates.py::test_symbol_and_kind_are_immutable_and_there_is_no_delete`.
34. (blind) No route deletes a symbol, asserted by enumerating the
    registered routes, not by probing a guessed path. Test:
    `tests/test_rates.py::test_symbol_and_kind_are_immutable_and_there_is_no_delete`.
35. Retiring a symbol removes it from `GET /api/rates/symbols` and leaves
    `/api/rates` pricing it, so a holding measured in it still resolves a
    rate. Unretiring restores it to the picker. Test:
    `tests/test_rates.py::test_retiring_removes_a_symbol_from_the_picker_and_leaves_pricing_alone`.
36. `PATCH` setting `lookup: true` on a symbol with no provider adapter
    is a Bad Request, and so is `POST` creating one that way. Test:
    `tests/test_rates.py::test_lookup_cannot_promise_a_proposal_the_proxy_cannot_serve`.
37. (blind) `GET /api/admin/symbols` reports `hasAdapter: true` on
    exactly the symbols the adapter registry covers, asserted against the
    registry itself rather than a fixture, and every symbol with
    `lookup: true` also has `hasAdapter: true`. Test:
    `tests/test_rates.py::test_has_adapter_is_derived_from_the_registry`.
38. `POST` or `PATCH` carrying `hasAdapter` is a Bad Request and changes
    nothing. Test: `tests/test_rates.py::test_has_adapter_is_read_only`.
39. (blind) No response from any `/api/admin/symbols` route contains a
    count, list or other indication of which holdings use a symbol,
    asserted against the full response shape. Test:
    `tests/test_rates.py::test_no_admin_symbol_response_counts_which_holdings_use_one`.
40. A currency an administrator adds that no source serves is not
    offered in the next registration's main-currency picker. Test:
    `tests/test_rates.py::test_a_currency_no_source_serves_is_not_offered_at_registration`,
    `tests/test_review_rate_lookup.py::test_a_currency_no_source_serves_is_not_offered_at_registration`,
    `tests/test_review_rate_lookup.py::test_the_registration_list_is_exactly_the_currencies_the_registry_serves`.
41. (blind) No log line, response body or error page contains a
    provider API key, checked against real output even though no
    provider has a key. Test:
    `tests/test_review_rate_lookup.py::test_no_output_of_a_lookup_carries_a_provider_key`.
42. (blind) Exceeding the per-user rate limit returns Too Many Requests
    and writes no `attempts` row, so the limit lifts an hour after the
    oldest lookup it let through however often the client retried,
    asserted by retrying while over it and comparing the table row for
    row. Test:
    `tests/test_rates.py::test_exceeding_the_per_user_limit_is_too_many_requests`,
    `tests/test_rates.py::test_a_refused_lookup_writes_no_row_and_the_limit_lifts_an_hour_after_the_oldest`.
43. A future date is a Bad Request. Test:
    `tests/test_rates.py::test_a_future_date_is_a_bad_request`,
    `tests/test_review_rate_lookup.py::test_a_future_date_reaches_no_provider`.
44. (blind) `GET /api/rates/symbols` returns exactly the symbols
    `/api/rates` accepts, asserted by querying every returned symbol and
    getting no Bad Request, `lookup: false` symbols included and
    answering No Content. Test:
    `tests/test_rates.py::test_every_symbol_the_table_offers_is_accepted_by_the_rate_endpoint`.
45. `GET /api/rates/symbols` requires a session and makes no outbound
    request. Test:
    `tests/test_rates.py::test_the_symbol_table_requires_a_session_and_makes_no_outbound_request`.
46. The table holds all eight seeded metal symbols, with `lookup: true`
    on exactly `XAU-ozt` and `XAU-g`. Test:
    `tests/test_rates.py::test_the_seeded_table_holds_all_eight_metals_with_lookup_on_gold_alone`.
47. (blind) A gold request with a non-PLN quote, both sources
    publishing on NBP's last day, makes exactly two outbound requests,
    and the FX leg is fetched for NBP's last day, not the requested
    date, asserted against a stub returning a different rate for each. Test:
    `tests/test_rates.py::test_gold_converts_through_fx_at_the_as_of_date_not_the_requested_one`,
    `tests/test_review_rate_lookup.py::test_gold_quoted_elsewhere_takes_both_halves_from_nbps_last_day`.
48. With the FX leg failing, the response is No Content and no rate
    carrying a PLN figure under another currency's label is returned.
    Test:
    `tests/test_rates.py::test_a_failed_fx_leg_never_returns_a_pln_figure_under_another_label`.
49. (blind) Each class has its floor on both sides: a currency on
    1998-12-31 is a Bad Request that reaches no provider and on
    1999-01-04 is priced, and gold on 2012-12-31 is a Bad Request and on
    2013-01-02 is priced. One global floor passes either pair alone.
    Test:
    `tests/test_rates.py::test_each_class_has_its_own_floor_on_both_sides`,
    `tests/test_rates.py::test_a_gold_date_before_the_floor_is_a_bad_request`.
50. `GET /api/rates/symbols` carries `since` on every row: `1999-01-04`
    for `USD`, `2000-01-13` for `BRL`, `2013-01-02` for `XAU-g` and
    `XAU-ozt`, `null` for `XAG-ozt`. A currency whose `lookup` an
    administrator turned off keeps its date. Test:
    `tests/test_rates.py::test_the_symbol_table_carries_each_symbols_since`.
51. (blind) For every row but `EUR` with a `since`, a single-symbol
    request quoted in `EUR` dated the day before is a Bad Request with no
    outbound request, and one dated `since` itself sends its outbound
    request when the row's `lookup` is on and answers No Content with
    none when it is off. Asserted over the whole table. Test:
    `tests/test_rates.py::test_the_floor_and_since_cannot_drift_over_the_whole_table`.
52. (blind) `XAG-ozt` dated 2012-12-31 and 1998-12-31 answers No Content
    with no outbound request, while a currency with an adapter and
    `lookup` off answers Bad Request before its floor, because the floor
    follows the adapter and not the flag. Test:
    `tests/test_rates.py::test_a_symbol_with_no_adapter_answers_no_content_at_any_date`.
53. (blind) A whole-table request dated 2012-12-31 quoted in `CHF` sends
    Frankfurter's request and no NBP request, and returns the currencies
    with both gold symbols absent. Test:
    `tests/test_rates.py::test_the_whole_table_before_gold_asks_no_gold_source`.
54. (blind) A whole-table request dated 1999-06-30 quoted in `CHF`
    returns `USD` with `BRL`, `CNY`, `ILS` and `INR` absent. Quoted in
    `BRL`, it sends no outbound request, answers No Content, and leaves
    Frankfurter's failure count where it was. Test:
    `tests/test_rates.py::test_the_whole_table_leaves_out_currencies_not_yet_published`,
    `tests/test_rates.py::test_a_quote_before_its_own_start_asks_nothing_and_spares_the_breaker`.
55. `symbol=CHF&quote=CHF` returns `rate: "1"` with no outbound request.
    Test:
    `tests/test_rates.py::test_symbol_equals_quote_answers_one_with_no_outbound_request`.
56. (blind) Every outbound request is `FX_URL` or `NBP_URL` with only its
    placeholders filled, carrying exactly the two pinned headers,
    asserted against a stubbed opener for an FX table, gold quoted in PLN
    and gold quoted in CHF. Test:
    `tests/test_rates.py::test_every_outbound_request_is_a_template_with_only_its_placeholders_filled`,
    `tests/test_rates.py::test_every_outbound_request_is_named`.
57. (blind) A proposal equals the pinned composition digit for digit:
    with `rates["USD"] = 1.0876` and `rates["PLN"] = 4.2537` against CHF
    and `cena = 251.37`, `USD` is `0.91945568`, and `XAU-g` and `XAU-ozt`
    each equal `cena × (1 / 4.2537)`, the latter times 31.1034768,
    computed in `Decimal` and rounded half-even to 8 places. Not
    approximate equality, because rounding early or applying the ounce
    factor before the PLN leg differs in the last places. Test:
    `tests/test_rates.py::test_a_proposal_equals_the_pinned_composition_digit_for_digit`.
58. (blind) The environment variables the app reads are those
    `app-shell.md`, Configuration, names and the proxy variables `urllib`
    reads, and no others, asserted by recording every read of
    `os.environ` through start-up and a whole-table lookup, not by a grep
    of the source. None of them changes the outbound URL or the TLS
    context. Test:
    `tests/test_rates.py::test_the_only_environment_the_app_reads_is_its_configuration_and_none_of_it_names_a_provider`.
59. A `quote` that is a valid ISO 4217 code but absent from the symbol
    table is a Bad Request, asserted with a code the FX provider does not
    serve. Test:
    `tests/test_rates.py::test_a_quote_the_provider_cannot_serve_is_refused`.
60. (blind) With both providers answering at once but sending the body
    one byte at a time, each well inside the socket timeout, a
    whole-table request returns No Content within
    `EGRESS_TIMEOUT_SECONDS` plus one second. Test:
    `tests/test_rates.py::test_providers_sending_their_answer_slowly_give_no_content_within_the_bound`.
61. A rate of 0, -1, a string, a boolean, NaN, plus or minus infinity,
    `1e300` or `1e-25` is no proposal for its symbol, and the whole
    table still answers OK with the other symbols. The same figure as
    the PLN rate drops only the gold symbols and adds no breaker
    failure. As the NBP price it drops only the gold symbols and counts
    one NBP failure, except `1e-25`, a usable price whose proposal
    rounds to 0. Test:
    `tests/test_rates.py::test_a_rate_that_is_not_a_usable_price_is_no_proposal`,
    `tests/test_rates.py::test_a_gold_figure_that_is_not_a_usable_price_drops_only_gold`.
62. A cached rate of `"0"` for a past date is fetched again and
    replaced. Test:
    `tests/test_rates.py::test_a_cached_rate_of_zero_is_fetched_again`.
63. An NBP `data` that is unreadable, not in canonical ISO form, not a
    string, after the requested date or before its 14-day window, quoted
    in `CHF` or `PLN`, drops only the gold symbols, the whole table
    still answers OK with the currencies, and only NBP's breaker counts
    a failure. Test:
    `tests/test_rates.py::test_a_gold_date_that_is_not_usable_drops_only_gold`.
64. A Frankfurter `date` that is not usable leaves only the gold symbols
    in a table quoted in `PLN`, and No Content quoted in `CHF`, each
    counting a Frankfurter failure and none for NBP. Test:
    `tests/test_rates.py::test_a_currency_date_that_is_not_usable_drops_only_what_its_table_prices`.
65. A cached rate whose `asOf` is unreadable or after its date, or a
    cached gold rate dated before its window, is fetched again and
    replaced. Test:
    `tests/test_rates.py::test_a_cached_rate_with_an_unusable_date_is_fetched_again`,
    `tests/test_review_rate_lookup.py::test_a_cached_gold_rate_dated_before_its_window_is_fetched_again`.
66. (blind) A failed fetch logs exactly `rates.provider source=<source>
    status=<status>`, with the status for an answer that was not 200,
    `shape` for a changed shape, and `timeout`, `tls`, `network`, `body`
    or `other` for each other failure, and no date, quote, provider
    host, error text or anything of the answer's body. Test:
    `tests/test_rates.py::test_a_failed_fetch_logs_its_source_and_status_and_nothing_of_the_request`,
    `tests/test_review_rate_lookup.py::test_a_failed_answer_logs_its_source_and_status_alone`,
    `tests/test_review_rate_lookup.py::test_a_changed_shape_logs_shape_and_counts_against_its_breaker_alone`.
67. A date written other than `YYYY-MM-DD`, such as `20260731`,
    `2026-W31-5` or `2026W315`, is a Bad Request that reaches no
    provider. Test:
    `tests/test_rates.py::test_a_date_not_written_yyyy_mm_dd_is_a_bad_request`,
    `tests/test_review_rate_lookup.py::test_a_date_not_written_as_isoformat_writes_it_reaches_no_provider`.
68. Each changed shape of each provider, such as Frankfurter's `rates`
    as a list, a `base` other than `quote`, a table with no usable rate,
    or NBP's answer as an object, an empty array or a last entry that is
    not an object, gives that provider's symbols no proposal, logs one
    `rates.provider source=<source> status=shape` line and counts one
    failure against that provider's breaker alone. A Frankfurter table
    with one usable rate among bad ones logs nothing and leaves the
    count at zero. Test:
    `tests/test_rates.py::test_a_changed_shape_logs_shape_and_counts_against_its_breaker`,
    `tests/test_rates.py::test_one_usable_rate_among_bad_ones_is_a_success`,
    `tests/test_review_rate_lookup.py::test_a_changed_shape_logs_shape_and_counts_against_its_breaker_alone`,
    `tests/test_review_rate_lookup.py::test_a_changed_shape_opens_its_breaker_like_an_outage`,
    `tests/test_review_rate_lookup.py::test_one_usable_rate_among_bad_ones_logs_nothing_and_counts_no_failure`.
69. With `LOOKUP_CONCURRENCY` lookups already sending, a lookup sends
    nothing, answers an identity symbol and gives a pending one no
    proposal, and leaves the breakers as they were. Once a slot frees,
    the next lookup sends. Test:
    `tests/test_rates.py::test_a_lookup_finding_every_slot_taken_sends_nothing_and_answers_what_needs_no_source`,
    `tests/test_review_rate_lookup.py::test_with_every_slot_sending_a_lookup_sends_nothing_and_answers_only_what_needs_no_source`.
70. (blind) A gold request quoted in `CHF` on a day NBP published and
    Frankfurter answers with the day before's table makes exactly two
    outbound requests, with `asOf` the day before and both `cena` and the
    PLN rate that day's, digit for digit. Test:
    `tests/test_rates.py::test_gold_on_a_day_without_a_currency_table_is_priced_at_the_day_before`,
    `tests/test_review_rate_lookup.py::test_gold_on_good_friday_is_priced_at_the_day_before`,
    `tests/test_review_rate_lookup.py::test_the_whole_table_on_good_friday_prices_gold_at_the_day_before_from_the_one_table`.
71. When Frankfurter's table is for a day NBP did not publish, the leg
    asks again for NBP's last day before it, making three outbound
    requests, and prices gold at that day. Test:
    `tests/test_rates.py::test_gold_steps_back_to_a_day_both_sources_published`,
    `tests/test_review_rate_lookup.py::test_gold_steps_back_to_the_last_day_both_published`,
    `tests/test_review_rate_lookup.py::test_gold_steps_back_as_often_as_the_sources_disagree`.
72. When no NBP day in the window is on or before Frankfurter's table's
    day, a gold request quoted in `CHF` is No Content. Test:
    `tests/test_rates.py::test_gold_with_no_day_both_sources_published_is_no_content`,
    `tests/test_review_rate_lookup.py::test_gold_with_no_day_both_published_in_the_window_is_no_proposal`,
    `tests/test_review_rate_lookup.py::test_a_frankfurter_day_before_nbps_window_is_no_proposal`.
73. A currency row with no adapter reads `lookup: false` and `since:
    null` on both symbol routes, even when stored with `lookup` on. Test:
    `tests/test_rates.py::test_a_currency_no_source_serves_reads_lookup_false_with_no_since`,
    `tests/test_review_rate_lookup.py::test_a_currency_no_source_serves_reads_lookup_false_with_no_since_on_both_routes`.
74. (blind) Quoted in a currency with no adapter, the whole table and
    every single symbol answer No Content with no outbound request and
    no change to either breaker's count. Test:
    `tests/test_rates.py::test_a_quote_no_source_serves_answers_no_content_and_asks_nothing`,
    `tests/test_review_rate_lookup.py::test_a_quote_no_source_serves_answers_no_content_and_asks_nothing`,
    `tests/test_review_rate_lookup.py::test_a_currency_no_source_serves_as_a_symbol_asks_nothing_at_any_date`.
75. (blind) Either source answering Not Found past the configured count
    leaves both breakers' counts at zero, logs no provider line, and
    every request still goes out. Test:
    `tests/test_rates.py::test_a_not_found_answer_leaves_the_breaker_alone`,
    `tests/test_review_rate_lookup.py::test_a_not_found_answer_past_the_count_leaves_the_breakers_alone`,
    `tests/test_review_rate_lookup.py::test_a_not_found_step_back_is_no_proposal_and_no_failure`,
    `tests/test_review_rate_lookup.py::test_a_not_found_answer_neither_counts_nor_resets_a_failure_run`.
76. An entry for D fetched on D holding the prior close is fetched again
    at 00:30 UTC on D+1 and proposes D's own price. Test:
    `tests/test_rates.py::test_a_price_fetched_before_its_day_was_published_is_fetched_again`,
    `tests/test_review_rate_lookup.py::test_a_price_looked_up_on_its_day_before_publication_is_looked_up_again_after_midnight`,
    `tests/test_review_rate_lookup.py::test_the_whole_table_looked_up_before_publication_is_looked_up_again_after_midnight`.
77. An entry fetched at or after 00:00 UTC on D+2 is served from cache a
    month later, for a Saturday and for gold quoted in `CHF`. Test:
    `tests/test_rates.py::test_a_price_fetched_once_its_day_settled_is_served_from_cache_for_good`,
    `tests/test_review_rate_lookup.py::test_a_price_looked_up_at_00_utc_on_d_plus_2_is_served_from_cache_a_month_later`.
