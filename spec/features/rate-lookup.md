# Rate lookup

<!-- Provider choice remains open — see spec/questions.md. Everything
below is provider-independent and holds whichever is chosen. -->

## What it does

A server-side proxy and cache that fetches conversion rates (FX, metals,
listed securities) from a whitelisted public provider and serves an
entry-date rate **proposal** to the client. It exists so requests get
cached and so no browser individually leaks its update timing to a third
party (architecture.md, Data model).

The proposal is advice, never authority: the user can always override
it, and the value that lands in the snapshot is whatever the user
accepted (record-snapshot.md).

## Endpoint

`GET /api/rates?symbol=<SYMBOL>&date=<YYYY-MM-DD>&quote=<CCY>`

- `symbol` — the account's `rateSymbol`.
- `date` — the snapshot date.
- `quote` — the user's main currency, the currency to price into.
- Session-authenticated. Anonymous requests are refused, so the proxy is
  not an open relay.

Response `200`:

```json
{ "rate": "0.9312", "base": "1 XAU-ozt", "quote": "CHF",
  "asOf": "2026-07-31", "source": "provider-name", "cached": true }
```

Response `204 No Content` — no proposal available (unknown symbol for
this provider, no data for that date, provider unreachable). The client
falls back to manual entry.

**The endpoint accepts no amount parameter, in any form.** This is the
base-amount rule made structural: the rate is always for one fixed base
unit (1 troy oz, 1 share, one unit of the base currency), so there is no
field an amount could travel in even by mistake (architecture.md,
Base-amount rule). Any request carrying an unrecognised query parameter
is rejected with 400 rather than ignored.

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
- `quote` must be a known ISO 4217 code.
- `date` must parse as a calendar date, not be in the future, and not
  precede a configured floor (e.g. 1990-01-01).
- HTTP redirects are **disabled**, not followed to a validated target.
- Egress has a hard timeout (5 s connect + read) and a response size cap.
- Outbound requests go to HTTPS only, with certificate verification on.
- The provider API key, if any, is injected via environment config and
  never appears in a response, a log line, or an error message.

## Rate limiting and failure

- Per-user request limit on the endpoint, independent of the login
  limiter — a compromised session must not be usable to hammer the
  provider on the instance's API quota.
- A circuit breaker opens after repeated provider failures and serves
  `204` directly for a cool-off period instead of retrying per request.
- Provider errors are logged with the symbol and status, never with the
  requesting user's identity beyond what the access log already holds.

## Inputs / outputs

- In: symbol, quote currency, date. Never an amount.
- Out: a rate for one base unit, its `asOf` date and source, or `204`.

## Edge cases

- **Provider down, rate-limited, or timing out** → `204`; the client
  falls back to manual entry and says why. Recording a snapshot is never
  blocked by the proxy.
- **Symbol not in the server's symbol table** → `400`. Adding a symbol
  is an operator config change, not a user action.
- **Weekend, holiday, or pre-listing date** → return the most recent
  prior close with `asOf` set to that earlier date, and the client shows
  "rate as of 29 Jul" so the user can see the lag. If no prior close
  exists within a configured window, `204`.
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
  with 400; a test enumerates the accepted parameter set and asserts it
  is exactly `{symbol, date, quote}`.
- `symbol=http://192.168.1.1/`, `symbol=../../etc/passwd`, and a symbol
  matching the regex but absent from the symbol table are all rejected
  with 400, and no outbound request is made.
- With the provider stubbed to reply `302` toward an internal address,
  no request to that address is made.
- With the provider stubbed to hang, the endpoint returns `204` within
  the configured timeout rather than holding the connection.
- After N consecutive provider failures the circuit breaker returns
  `204` without an outbound attempt, and closes again after the cool-off.
- An unauthenticated request returns 401 and makes no outbound request.
- No log line, response body, or error page contains the provider API
  key.
- Exceeding the per-user rate limit returns 429.
- A future date is rejected with 400.
