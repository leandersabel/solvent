# Nightly harness

The tooling a QA hunt puts around the image it hunts, so `qa` can
check what no browser alone can see: the price sources answering under
their real names, data that took years to accumulate, promises that
take hours to come due, and the server's own log.

## How it works

### What it does

It is pipeline tooling under `tools/nightly/`, never in the image, and
nothing in the image knows it exists (CLAUDE.md, The loop, Nightly and
stable). Every harness container of a hunt runs the hunted image by
its digest, unchanged, with its entrypoint overridden and
`tools/nightly/` mounted read-only. No step of a hunt builds, commits
or tags an image, so the image a nightly or a candidate publishes is
the one it hunts. The daily source check is the one part outside the
hunt (The source checks).

### Which features it serves

| Harness part | Features it lets `qa` check |
|---|---|
| The stand-in, its request list and failure modes, the known prices | `rate-lookup`, `record-snapshot`, `net-worth-view`, `manage-accounts` |
| Prepared vaults, expected totals | `net-worth-view`, `record-snapshot`, `manage-accounts`, `account-settings`, `login` |
| Prepared backup files | `export-import` |
| The older vault and the aged session | `login`, `account-settings` |
| The expired invite and the harness administrator | `register`, `admin-invites` |
| The server log, stopping and starting the app | `app-shell`, `login`, `admin-invites` |

### Trust boundaries

- **The app has no route out** (The network), so a lookup reaches the
  stand-in or nothing, and no fixture value can reach a real source.
- **The stand-in is trusted by name and by a mounted trust store, never
  by a setting.** The app's provider hosts and URL templates are
  constants (rate-lookup.md, SSRF and egress hardening). The harness
  answers those names on its own network and mounts a trust store
  holding only the run's certificate authority over the image's system
  store, so an installation has no switch a test could have flipped.
- **The run's certificate authority vouches for the provider names
  alone, for one day, and signs once.** Its key is deleted once the
  stand-in's certificate is signed, so whoever reads the runner
  afterwards holds nothing that can vouch for another host.
- **`qa` reaches the server only through the harness tools.** They have
  fixed names and argument shapes, take no command, path, container
  name or URL, and run with an empty environment, so no token reaches
  them. The hunt step holds no unrestricted shell (What the workflow
  does).
- **Everything the server says is untrusted text**, returned to `qa` as
  JSON strings, never interpreted.
- **Fixture passwords are public.** They are committed in the plan,
  open only throwaway vaults on an instance nobody outside the runner
  can reach, and are never reused.
- **Prepared data never leaves the runner.** The output and TLS
  directories are never uploaded as artifacts.

### Files

Python 3.12 or later and Node 24 or later, adding no dependency.
Beyond the standard library and `node:` built-ins, the only imports
are these:

- `standin.py`, `mcp.py` and `prices.py prepare` import their sibling
  `prices`, on the path as the script's own directory, so every price
  comes from that one module.
- `sources.py` imports from `solvent.rates` the constants rate-lookup.md
  names for it (SSRF and egress hardening).
- `fixtures.mjs` imports the Chrome driver `tests/browser/cdp.mjs`
  rather than keeping a second one.

Nothing else imports from `solvent` or `tests/`. Only the harness's own
tests import from `tools/`, and nothing in `solvent` does.

| Path | What it is |
|---|---|
| `ca.py` | the run's certificate authority and the stand-in's certificate |
| `standin.py` | the price stand-in |
| `prices.py` | the known-price model, the expected totals, and `prepare` |
| `relay.py` | the one way in from the runner to the app |
| `sources.py` | `check` against the real sources, `probe` against the stand-in |
| `fixtures.mjs` | writes the prepared data through the app's own browser code |
| `patch.py` | dates back what a promise needs time for |
| `mcp.py` | the harness tools, as an MCP server |
| `fixtures/plan.json` | what the prepared data holds, committed |
| `fixtures/backup-format-1.json` | the older backup file, committed, never regenerated |
| `fixtures/backup-format-1.plan.json`, `fixtures/backup-format-1.expected.json` | the plan that made it and the figures it holds, committed with it |
| `fixtures/out/` | the hunt's generated data, ignored by git |

`qa` may read `fixtures/plan.json`, `fixtures/out/manifest.json` and
the backup files, never the code. A script that runs to an end exits 0
on success, 1 on a failed check and 2 on a usage error, and writes
nothing but its stated outputs.

### The network

Each hunt creates its own Docker networks:

- `nightly`, created with `--internal`: the app, the stand-in, and one
  leg of the relay. Nothing on it has a route out.
- `nightly-edge`, an ordinary bridge: the relay's other leg, which
  publishes `127.0.0.1:8000`.

The stand-in joins `nightly` with the aliases `api.frankfurter.dev` and
`api.nbp.pl`, so Docker's resolver answers those names with its
address. A port cannot be published from an internal network, which is
why the relay exists. It is the runner's only way to the app, and the
app sees it as every client's peer.

### The run's certificate authority

`python3 tools/nightly/ca.py <dir>` runs the `openssl` command line with
argument lists, never a shell, and writes into `<dir>`, which must be
empty or absent:

| Output | Contents |
|---|---|
| `ca.pem` | the CA certificate |
| `leaf.pem` | the stand-in's certificate |
| `leaf.key` | its private key, mode `0600` |
| `trust/ca-certificates.crt` | `ca.pem`, byte for byte |
| `trust/<subject hash>.0` | `ca.pem` again, named by `openssl x509 -subject_hash`, so OpenSSL's directory lookup finds it |

The CA's private key exists only in a temporary directory that is
deleted before the script exits, whether or not signing succeeded.

| | CA | Leaf |
|---|---|---|
| Key | EC P-256 | EC P-256 |
| Signature | ecdsa-with-SHA256 | ecdsa-with-SHA256, by the CA |
| Validity | from now, 1 day | from now, 1 day |
| Subject | `CN=Solvent nightly CA` | `CN=api.frankfurter.dev` |
| Serial | 128 random bits | 128 random bits |
| `basicConstraints` | critical, `CA:TRUE, pathlen:0` | critical, `CA:FALSE` |
| `keyUsage` | critical, `keyCertSign, cRLSign` | critical, `digitalSignature` |
| `extendedKeyUsage` | none | `serverAuth` |
| `subjectAltName` | none | `DNS:api.frankfurter.dev, DNS:api.nbp.pl` |
| `nameConstraints` | critical, permitted `DNS:api.frankfurter.dev`, `DNS:api.nbp.pl`, excluded `IP:0.0.0.0/0.0.0.0`, `IP:::/0` | none |
| Key identifiers | `subjectKeyIdentifier` | `subjectKeyIdentifier`, `authorityKeyIdentifier` |

Both conform to RFC 5280 as OpenSSL's `X509_V_FLAG_X509_STRICT` checks
it, because the image's Python enables that flag in its default
context and would otherwise refuse the stand-in.

The workflow mounts `trust/` read-only at `/etc/ssl/certs` in the app
container, the image's OpenSSL CA directory. `sources.py probe` proves
the image's default context then accepts the stand-in, so a base image
that moves its trust store fails the harness rather than every lookup.

### The stand-in

`python /harness/standin.py --cert <leaf.pem> --key <leaf.key> --state
<dir> [--port 443]`, in a container of the hunted image on `nightly`.

- HTTPS only, TLS 1.2 or later, a `ThreadingHTTPServer` behind an
  `ssl.SSLContext(PROTOCOL_TLS_SERVER)` holding the leaf alone.
- It routes on the `Host` header: `api.frankfurter.dev` and
  `api.nbp.pl` each answer as below, and any other host gets `421` with
  an empty body.
- The statuses here are the providers' own, outside Solvent's status
  set (architecture.md, Status codes).

#### Known prices

`prices.py` is the one home of every price the stand-in publishes. A
price is a pure function of the source, the date and the currency, so
every process that asks gets the same answer.

- **Publication days** are Monday to Friday, with no holidays, up to
  and including the stand-in's current UTC date. Frankfurter publishes
  from `1999-01-04` and NBP from `2013-01-02`, the real series' starts
  and each symbol's date floor (rate-lookup.md, Providers). The app
  sends no earlier date, so it never exercises the stand-in's `404`
  before them.
- **Currencies** are Frankfurter's list, the seeded currency half of
  the symbol table (rate-lookup.md, Seeded symbols). Constant tables in
  `prices.py` give each a reference value `ref[C]`, units of C per euro
  with `ref["EUR"] = 1`, and a first publication day `start[C]`: the
  real series' start (rate-lookup.md, Providers, FX), `2000-01-13` for
  `BRL`, `CNY`, `ILS` and `INR` and `1999-01-04` for every other.
  `prices.py` keeps its own copy rather than importing the app's, so an
  app floor that drifts from the source shows as a wrong answer.
- **Frankfurter**, for publication day `p`, base `Q` and symbol `C ≠ Q`:
  `rates[C] = ref[C] / ref[Q] × f(p)`, rounded half-even to 5
  significant digits, where
  `f(p) = 1 + ((p.toordinal() mod 101) − 50) / 2000`.
- **NBP**, for publication day `p`: `cena = 250 × g(p)`, rounded
  half-even to 2 decimal places, where
  `g(p) = 1 + ((p.toordinal() mod 89) − 44) / 1000`.
- Arithmetic is `decimal.Decimal` in the default context. A value is
  written into JSON as a number with exactly those digits, so the app's
  parse through `float` and `str` returns the same decimal.

`prices.known_table(date, quote)` is what `/api/rates` must answer for
the whole table on that date and quote, without `cached`: every
currency but `quote` whose `start` the date has reached, and `XAU-g`
and `XAU-ozt` where NBP published within `NBP_WINDOW` (rate-lookup.md,
Providers, Gold), each `{rate, base, asOf, source}`, and nothing at all
on a date before `start[quote]`. An empty table matches No Content. It
applies rate-lookup.md's composition exactly as pinned there
(Providers), so it is the oracle for every proposal `qa` sees.

#### What it answers

| Host | Request | Answer |
|---|---|---|
| `api.frankfurter.dev` | `GET /v1/<D>?base=<Q>`, `Q` a known currency, `D` on or after `start[Q]` | `200`, `{"amount": 1.0, "base": Q, "date": <last publication day ≤ D>, "rates": {C: …}}` for every known `C ≠ Q` with `start[C]` on or before that day |
| `api.frankfurter.dev` | anything else | `404`, `{"message": "not found"}` |
| `api.nbp.pl` | `GET /api/cenyzlota/<S>/<E>?format=json`, `S ≤ E`, span at most 93 days, a publication day in range | `200`, `[{"data": <day>, "cena": …}, …]`, every publication day in range, ascending |
| `api.nbp.pl` | same, no publication day in range | `404`, `Not Found - Brak danych` as `text/plain` |
| `api.nbp.pl` | same, `S > E` or span over 93 days | `400`, `Bad Request` as `text/plain` |
| `api.nbp.pl` | anything else | `404`, `Not Found` as `text/plain` |

JSON answers carry `Content-Type: application/json; charset=utf-8`.

#### Failure modes

`<state>/modes.json` is `{"frankfurter": "up" | "down", "nbp": "up" |
"down"}`. The stand-in reads it on every request. Absent, unreadable or
malformed, both sources are up. A source that is down answers every
request `503` with an empty body, after recording it.

#### The request list

Every request the stand-in receives is one line appended to
`<state>/requests.jsonl`, written before the answer is sent, the file
opened, appended and closed under a lock per request:

```json
{ "seq": 1, "at": "2026-07-31T01:12:09+00:00", "sni": "api.nbp.pl",
  "host": "api.nbp.pl", "method": "GET",
  "target": "/api/cenyzlota/2026-07-17/2026-07-31?format=json",
  "headers": [["User-Agent", "Solvent/1.0 (self-hosted net worth tracker)"],
              ["Accept", "application/json"]],
  "body": "", "mode": "up", "status": 200 }
```

- `seq` counts from 1 and continues from the file's existing line count
  at start.
- `target` and `headers` are exactly as received, in order. `body` is
  the received body decoded as Latin-1, so every byte survives, up to
  64 KiB.
- A request the stand-in cannot parse is still a line, with what could
  be read and `status` as sent.

### The relay

`python /harness/relay.py --listen 0.0.0.0:8000 --to solvent:8000`,
in a container of the hunted image. It copies bytes both ways between
each accepted connection and one new connection to the fixed target,
and closes both when either side closes. It reads, logs and alters
nothing.

### The source checks

`python /harness/sources.py check|probe`, in a container of the app's
image with `PYTHONPATH=/app`, requests exactly what the app requests:
it imports `FX_URL`, `NBP_URL`, `NBP_WINDOW`, `USER_AGENT`,
`EGRESS_TIMEOUT_SECONDS`, `MAX_RESPONSE_BYTES` and `SEEDED_SYMBOLS`
from `solvent.rates`, and opens each URL with the default context and
redirects off, as the app does.

Both send one request to each source, for quote `CHF` and the date `D`
seven days before the current UTC date (NBP from `D − NBP_WINDOW` to `D`),
and print one line per source:
`<frankfurter|nbp> <ok|no-answer|changed> <reason>`. The reason names
the status, exception class or first shape violation, never the body.

**Shape.** Frankfurter answers an object whose `base` is `CHF`, whose
`date` is an ISO date within `[D − 7 days, D]`, and whose `rates` maps
three-letter upper-case codes to numbers above zero, every seeded
currency but `CHF` among them. NBP answers a non-empty array, ascending
by `data`, of objects whose `data` is an ISO date within
`[D − NBP_WINDOW, D]` and whose `cena` is a number above zero. A boolean
is not a number.

**`check`** runs once a day against the real sources, on the default
bridge network (What the workflow does).

| Outcome | When |
|---|---|
| `no-answer` | name resolution, connection or TLS failure, a timeout, `429` or any `5xx` |
| `changed` | any other status but `200`, `3xx` included, because the app follows no redirect. A `200` body over the size cap, not JSON, or off the shape above |
| `ok` | `200` with the shape above |

It exits 1 when any source is `changed`, and 0 otherwise, so a source
that does not answer is a note in the run's summary and no finding,
because the outage is the source's.

**`probe`** runs per hunt against the stand-in, on `nightly` with
`trust/` mounted as in the app. It exits 0 only when both sources are
`ok` and a TCP connection to `1.1.1.1:443` does not open within 3
seconds, which proves the trust store, the aliases and the missing
route out together.

### Prepared data

#### The plan

`fixtures/plan.json` names every prepared account with its username,
password, kind and main currency, and what its vault holds. The
coverage names below are the contract: each must be covered by at
least one prepared item, and `prepare` exits 1 naming any the plan
leaves out.

| Coverage | What the prepared item must be |
|---|---|
| `household` | two vault owners with the same main currency, each holding `USD` and `XAU-ozt`, so one recording date in both reaches each source once |
| `long-history` | a vault with main currency `CHF`, holding the main currency, `USD`, `XAU-g` and a debt, recorded at `1998-12-31` and at every month end from `2011-01-31` through the last month end before today. A unit at a date before its `since` carries a price typed by hand, as `manual`, because no source publishes one: `USD` at `1998-12-31` and `XAU-g` at every date before `2013-01-02` |
| `many-dimension-values` | a dimension with at least five values, each held by at least one holding |
| `rate-edited-long-ago` | a proposed rate, more than five years back, edited to a figure other than the known price, and a holding whose latest quantity sits on that date, so the edited rate is its price as recorded |
| `no-source-unit` | a holding in `XAG-ozt`, priced by hand |
| `own-unit` | a holding in a unit outside the symbol table, priced by hand on one old date only, so its price is older than the vault's newest |
| `archived-holding` | a holding archived on a recording date at which every unit already has a price, so archiving makes no lookup |
| `other-main-currency` | a vault whose main currency is `EUR` |
| `damaged-record` | a `snapshot` whose ciphertext is encrypted under the AAD of another `record_id`, so it fails authentication |
| `same-date-pair` | two snapshots of one holding at one date |
| `older-vault` | a vault whose credential's KDF envelope has `m = 32768`, below the server default, and is otherwise the default |
| `empty-vault` | a vault owner with no holdings |
| `idle-lock-out-of-range` | a vault owner used for nothing else, whose profile record carries `idleLockMinutes: 0`, which the app reads as five minutes, the nearest offered period (account-settings.md, Session and lock). It stands alone because each unlock spends a sign-in and its lock would interrupt any other check on the vault |
| `aged-session` | `qa`'s browser starts holding a session of a prepared vault owner, issued 12 hours 5 minutes before `patch.py` ran and last active 1 minute before it |
| `expired-invite` | a vault-owner invite that expired one day before `patch.py` ran |
| `current-backup` | the hunt's export of the `long-history` vault |
| `older-backup` | `fixtures/backup-format-1.json` |
| `harness-admin` | the administrator through whom the invites were made |
| `cleared-date` | a recording whose figures were all cleared, its rates kept, between two recordings, with a foreign price there off the straight line between that unit's neighbors, so the date still bends the band |
| `deleted-recording` | a recording deleted whole, between two recordings, with a foreign price there off the straight line between that unit's neighbors |
| `staggered-starts` | two holdings whose first snapshots are years apart |
| `all-archived` | a vault whose every holding is archived |
| `code-like-names` | a holding, a dimension and a dimension value each named like markup or script |
| `session-ends-mid-action` | a vault owner used for nothing else, whose session `qa` ends from a second tab with a form open in the first, because signing out deletes the session as expiry does |

A plan step `clear` deletes every snapshot at a date and keeps its
rates. `deleteRecording` deletes the date's whole recording. `prepare`
refuses either on an archive date, outside the vault's recorded dates,
or where no price at the date lies off its neighbors' line, compared
exactly.

Neither the damaged record nor the pair is its holding's latest
quantity, and neither sits on a holding's archive date, so every
expected total has exactly one correct value. The stored idle period of
`idle-lock-out-of-range` is one the Idle lock select does not offer,
written through `saveProfile` all the same. Every other quantity, rate
and setting in the plan is one the app's own screens could write.

#### `prices.py prepare`

`python3 tools/nightly/prices.py prepare <plan> <out>` expands the plan
against the current UTC date and writes:

- `<out>/script.json`: per account, in order, every write the
  generator makes, with concrete dates, values and, for each proposed
  rate, the proposal from `known_table`.
- `<out>/expected.json`: per vault, and for each backup file, the
  expected figures under both pricing modes.

The expected figures follow net-worth-view.md, Current net worth, and
record-rate.md, Reading, computed independently of the app in
`Decimal`:

- Each active, priced holding's figure is its latest quantity times its
  price (the latest price, or the price as recorded), rounded half-even
  at scale 12, as `static/js/decimal.js` multiplies.
- The total is the sum of those figures at scale 12. `assets` sums the
  figures above zero and `debts` those below.
- With no holding valued the total, `assets` and `debts` are `null`,
  because the dashboard shows `—` for each.
- Each is given `exact`, at scale 12 without trailing zeros, and
  `display`, rounded half-even to whole units, with no grouping and `-`
  for a negative.

Archived holdings, holdings with no quantity and holdings with no price
are listed by name under `excluded`, with the reason. An archived
holding's reason is `archived` whatever else is true of it
(net-worth-view.md, Current net worth, Archived comes first).

#### `fixtures.mjs`

`node tools/nightly/fixtures.mjs --base <url> --invite <path> --plan
<plan> --out <dir>`, with `CHROME` naming the browser. It reads
`<dir>/script.json` and `<dir>/expected.json` and writes nothing the
app's own code did not produce:

- **Accounts** register through `/register?invite=` as the page does,
  one fresh Chrome profile per account, so no cookie of one account
  replaces another's. `--invite` is a CLI-minted administrator invite,
  which registers `harness-admin`. Every other invite is made through
  `POST /api/admin/invites` from that administrator's page, the
  expired one with the plan's label. Each account waits for its
  registration form, and a form that never shows fails the run naming
  the address and the text the page shows instead.
- **Records** are written only through the served modules
  `/static/js/session.js`, `writes.js`, `crypto.js` and `api.js`:
  `saveProfile`, `saveHolding`, `saveSnapshot`, `refreshPrices` with
  the script's proposals, `saveRate` with `editedRatePayload`,
  `archiveHolding`, `deleteRecord` for a `clear` and `deleteRecording`. The damaged record and the pair are the
  exceptions, written as `tests/browser/harness.mjs` `plant` writes.
  No record is written by the generator's own crypto.
- **No lookup**: proposals come from the script, so the generator
  sends nothing to `/api/rates` and spends no part of any limit.
- **The older vault** is rotated through `/api/auth/upgrade-kdf` with
  keys derived at `m = 32768`, as `harness.mjs` `makeStale` does, and
  `patch.py` then records that parameter.
- **The current backup** is the body of `GET /api/export`, fetched by
  the page through `api.js`, so it carries the `X-Solvent-Request`
  header and the vault epoch.
- **Every request the generator sends for a vault carries the vault
  epoch** registration or sign-in handed it, `plant` writes and
  `makeStale`'s upgrade included, because the gate refuses a request
  without one (architecture.md, Vault epoch).
- **The aged session's cookie** is read with CDP `Network.getCookies`
  in that account's profile, right after it registers.

Outputs in `<dir>`:

| File | Contents |
|---|---|
| `manifest.json` | below |
| `backup-<username>.json` | each current backup |
| `patches.json` | the dating back for `patch.py` |
| `storage-state.json` | Playwright storage state, `{"cookies": [<the aged session's cookie>], "origins": []}`, with `expires`, `httpOnly`, `secure` and `sameSite` as CDP reported them |

#### The manifest

```json
{
  "app": "http://localhost:8000",
  "today": "2026-07-31",
  "accounts": [
    { "username": "…", "password": "…", "kind": "vault_owner",
      "mainCurrency": "CHF", "covers": ["household", "long-history"],
      "about": "One sentence on what is in it." }
  ],
  "invites": [
    { "path": "/register?invite=…", "covers": ["expired-invite"] }
  ],
  "browserSession": { "username": "…", "covers": ["aged-session"],
    "about": "Open the dashboard before anything else: the browser holds this session." },
  "backups": [
    { "file": "tools/nightly/fixtures/out/backup-….json", "password": "…",
      "formatVersion": 2, "covers": ["current-backup"] }
  ],
  "expected": { "<username or backup file>": {
    "latest": { "total": {"exact": "…", "display": "…"}, "assets": {…},
                "debts": {…}, "holdings": {"<name>": {…}}, "excluded": {"<name>": "archived"} },
    "asRecorded": { … } } }
}
```

Every coverage name appears under some `covers`. `qa` reads nothing
else to know what is prepared.

#### Dating back

`python /harness/patch.py <database> <patches.json>`, in a one-off
container of the hunted image with `--network none`, the app's volume,
and the app stopped. `patches.json`:

```json
{ "sessions": [{ "username": "…", "issuedMinutesAgo": 725, "lastActiveMinutesAgo": 1 }],
  "invites": [{ "label": "…", "createdMinutesAgo": 11520, "expiresMinutesAgo": 1440 }],
  "credentials": [{ "username": "…", "kdfMemory": 32768 }] }
```

- Times count back from `patch.py`'s own clock and are written as the
  app writes them, `YYYY-MM-DDTHH:MM:SS+00:00`.
- These statements, with every value bound as a parameter, are all it
  runs:
  - `UPDATE sessions SET issued_at = ?, last_active_at = ? WHERE
    principal_id = (SELECT id FROM principals WHERE username = ?)`
  - `UPDATE invites SET created_at = ?, expires_at = ? WHERE label = ?
    AND status = 'pending'`
  - `UPDATE credentials SET params = json_set(params, '$.kdf.m', ?)
    WHERE principal_id = (SELECT id FROM principals WHERE username = ?)
    AND method = 'password'`
- One transaction. A statement that changes no row, or a credential
  change to a value outside `8192 ≤ m < 65536`, rolls it all back and
  exits 1. An unknown key exits 2 before anything is opened.
- It opens the file through `sqlite3` with `PRAGMA secure_delete = ON`,
  as the app does, and touches no other table.

#### The older backup file

`fixtures/backup-format-1.json` is made once, by `prepare` and
`fixtures.mjs` from `backup-format-1.plan.json`, at the server's
default KDF envelope of the build that made it, with every date
absolute. Its expected figures are kept as
`backup-format-1.expected.json`. None of the three is regenerated,
because a file made by today's build is not an older one
(export-import.md, Acceptance criteria, keeps its own fixture the same
way). The manifest carries its password and points at it.

### The harness tools

`mcp.py` is an MCP server over stdio: JSON-RPC 2.0, one message per
line, no network listener.

```
env -i PATH=/usr/bin:/bin python3 tools/nightly/mcp.py \
  --container solvent --state <dir> --url http://localhost:8000
```

- `initialize` answers with the `protocolVersion` the client sent,
  `capabilities: {tools: {}}` and `serverInfo: {name: "harness"}`.
  `tools/list` lists the tools below and nothing else. `ping` answers
  `{}`. Any other method is error `-32601`. Notifications get no reply.
- Every tool's `inputSchema` sets `additionalProperties: false`. An
  argument outside its schema returns `isError: true` naming the
  argument, and does nothing.
- A result is one `text` content item holding a JSON document.
- `docker` runs with an argument list, never a shell. The container
  name and the state directory come only from the server's own
  arguments.
- At start it records the request list's line count. `price_requests`
  shows only requests after it, so the probe's and setup's never reach
  `qa`.

| Tool | Arguments | Does | Returns |
|---|---|---|---|
| `server_log` | `since`: integer ≥ 0, default 0 | `docker logs <container>`, stderr merged into stdout | `{"lines": [...], "next": n}`, at most 500 lines from line `since` |
| `price_requests` | `since`: integer ≥ 0, default 0 | reads `requests.jsonl` | `{"requests": [...], "next": seq}`, at most 200 entries with `seq` above both `since` and the start count |
| `price_source` | `source`: `frankfurter` \| `nbp`, `state`: `up` \| `down` | writes `modes.json` through a temporary file and `os.replace` | the modes in force |
| `known_prices` | `date`: `YYYY-MM-DD` on or before today, `quote`: a known currency | `prices.known_table` | the table, independent of the modes |
| `app_stop` | none | `docker stop --time 10 <container>` | `{"state": "stopped"}` |
| `app_start` | none | `docker start <container>`, then polls `<url>/login` until it answers 200, at most 60 seconds | `{"state": "running"}`, or `isError: true` with `{"state": "not answering"}` |

### What the workflow does

`.github/workflows/hunt.yml`, which the nightly and the candidate call
with a digest, and `.github/workflows/sources.yml` are the client's
files, and no agent writes them. So the harness's part of the contract
that lives there reaches the client as a pull request, with the exact
change in it and in its comment on the issue (CLAUDE.md, The loop,
When something fails). This is what the workflows must do for the
harness to hold.

**The source check**, once a day in `sources.yml`: builds an image of
its own commit, runs `sources.py check` in a container of it on the
default network, and appends its output to the step summary. On exit 1
it files a `bug` rated high, or comments on the open one. The hunt
never runs it, so a source's changed shape never fails a hunt.

**Each hunt**, before `qa` starts:

1. Runs the setup action, for Node and `CHROME`, and pulls the image
   by its digest.
2. `ca.py "$RUNNER_TEMP/tls"`, and creates `$RUNNER_TEMP/standin`.
3. Creates `nightly` with `--internal` and `nightly-edge`.
4. Starts `standin` on `nightly` with both aliases, as the runner's own
   user, with `--sysctl net.ipv4.ip_unprivileged_port_start=443`,
   `tls/` and `tools/nightly/` read-only and `standin/` writable.
5. Starts `solvent` on `nightly` alone, with the hardening the workflow
   gives it, a fresh `SECRET_KEY`, and `tls/trust/` read-only at
   `/etc/ssl/certs`.
6. Starts `relay` on `nightly-edge` publishing `127.0.0.1:8000:8000`,
   then connects it to `nightly`.
7. Runs `sources.py probe` in a one-off container on `nightly` with
   `tls/trust/` mounted as in step 5.
8. Waits for `/login`, mints an administrator invite, runs
   `prices.py prepare` and then `fixtures.mjs` with that invite.
9. Stops `solvent`, runs `patch.py` against its volume, starts it, and
   waits for `/login`.
10. Mints `qa`'s administrator invite with `--force`, because
    `harness-admin` exists.

Every harness container runs `--read-only --cap-drop ALL
--security-opt no-new-privileges:true`. A failure of any of these ends
the hunt, which advises and never fails its caller.

**The hunt step**, in a fixed time box:

- passes `tools/nightly/fixtures/out/manifest.json` as the manifest.
- adds the `harness` MCP server as above, and
  `--storage-state tools/nightly/fixtures/out/storage-state.json` to the
  Playwright server's arguments.
- adds a second Playwright server, `playwright2`, that starts with
  nothing stored, for a check needing two sessions at once.
- allows `mcp__harness`, `mcp__playwright` and `mcp__playwright2`, and
  no `Bash` beyond
  `gh issue list` and `gh issue view`. With an unrestricted shell the
  hunt would reach Docker, the database volume and the internet, and
  the harness tools would no longer be the only way to the server.

What `qa` recorded is uploaded whether the step finished or not, and a
job with a token that writes issues files it. On failure the hunt
prints `docker logs` of `solvent` and `standin`.

## Edge cases

- **A source does not answer the check**: the stand-in answers the
  hunt either way.
- **The base image moves its trust store**: the probe ends the hunt
  as the harness (The run's certificate authority), rather than every
  lookup failing as a finding.
- **`qa` sets a source down and its breaker opens**: the app skips that
  source, and only that source, for the cool-off after it comes back up
  (rate-lookup.md, Rate limiting and failure). `app_stop` and
  `app_start` reset every breaker, because the breakers live in process
  memory.
- **`app_start` before `app_stop`**: `docker start` on a running
  container changes nothing, and the tool answers `running`.
- **The prepared data spans midnight UTC**: `prepare` reads the date
  once and writes it as the manifest's `today`. The expected figures
  hold for that date, since no later price is written.

## Acceptance criteria

1. `ca.py` writes exactly the outputs in its table, and `trust/` holds
   two files byte-identical to `ca.pem`, one named by its subject hash.
   Test: `tests/test_nightly_tools.py::test_the_ca_writes_exactly_its_outputs_and_no_other_private_key`.
2. (blind) The CA and the leaf carry every field in the certificate
   table, read back from the certificates with `openssl x509 -text`, and
   the validity is at most one day. Test: `tests/test_nightly_tools.py::test_every_certificate_field_reads_back_as_the_table_says`.
3. (blind) No private key but `leaf.key` exists anywhere under the
   output directory or the system's temporary directory afterwards,
   also when signing fails midway, not only on the success path.
   Test: `tests/test_nightly_tools.py::test_the_ca_writes_exactly_its_outputs_and_no_other_private_key`, `tests/test_nightly_tools.py::test_a_failed_signing_leaves_no_key_and_no_output`.
4. (blind) A Python 3.13 default context loaded with `ca.pem` alone, not
   a hand-built relaxed one, completes a handshake with `standin.py` on
   127.0.0.1 under `server_hostname` `api.frankfurter.dev` and
   `api.nbp.pl`. Test: `tests/test_nightly_tools.py::test_a_default_python_context_trusts_the_stand_in_under_both_names`.
5. (blind) The same handshake fails under any other server name.
   Test: `tests/test_nightly_tools.py::test_the_handshake_fails_under_any_other_name`.
6. `standin.py` answers every row of the answers table as stated, a
   weekend `D` at the preceding Friday, and a range holding no weekday
   with `404`. Test: `tests/test_nightly_tools.py::test_the_stand_in_answers_every_row_of_the_table`.
7. (blind) With `modes.json` setting a source down, every request to it
   is answered `503` and still recorded with `mode: "down"`.
   Test: `tests/test_nightly_tools.py::test_a_source_that_is_down_answers_503_and_is_still_recorded`.
8. With `modes.json` absent or holding invalid JSON, both sources
   answer. Test: `tests/test_nightly_tools.py::test_modes_that_are_absent_or_malformed_leave_both_sources_up`.
9. (blind) Every request, a malformed one included, is one line of
   `requests.jsonl` with every field. Test: `tests/test_nightly_tools.py::test_every_request_is_a_line_with_every_field_and_seq_continues_across_a_restart`, `tests/test_nightly_tools.py::test_a_request_that_stalls_is_still_recorded_with_what_was_read`.
10. (blind) `seq` continues across a restart of the stand-in.
    Test: `tests/test_nightly_tools.py::test_every_request_is_a_line_with_every_field_and_seq_continues_across_a_restart`.
11. (blind) `known_table` equals what the app's `/api/rates` returns for
    the whole table, without `cached`, on a weekday, a weekend, the day
    before `2013-01-02`, `1999-06-30` and today, for `CHF`, `EUR`, `PLN`
    and `BRL`, with the app's opener stubbed to answer from
    `standin.py`'s routing, never compared with itself or a hand-written
    figure. Test: `tests/test_nightly_tools.py::test_known_table_is_what_the_app_answers_for_the_whole_table`.
12. (blind) An empty `known_table` matches No Content: on `1999-06-30`
    the `CHF` table omits `BRL`, `CNY`, `ILS` and `INR`, and `BRL` answers
    No Content. Test: `tests/test_nightly_tools.py::test_known_table_is_what_the_app_answers_for_the_whole_table`.
13. The currency list in `prices.py` equals the seeded currencies in
    `solvent.rates`, and its `NBP_WINDOW` equals the app's. Test:
    `tests/test_nightly_tools.py::test_the_currency_list_is_the_seeded_currencies`,
    `tests/test_nightly_tools.py::test_the_gold_window_is_the_apps`,
    `tests/test_review_nightly_harness.py::test_prices_keeps_a_gold_window_equal_to_the_apps`.
14. (blind) `sources.py` classifies a timeout, a refused connection,
    `429` and `503` as `no-answer`. Test: `tests/test_nightly_tools.py::test_a_throttled_or_failing_source_is_no_answer`, `tests/test_nightly_tools.py::test_the_requests_failures_are_classified`.
15. (blind) `sources.py` classifies `301`, `404`, a non-JSON `200`, a
    body over the cap, a missing `PLN`, a missing seeded currency, a
    boolean rate, an empty NBP array and a date outside the window as
    `changed`. Test: `tests/test_nightly_tools.py::test_any_other_status_is_changed_redirects_included`, `tests/test_nightly_tools.py::test_a_200_that_is_off_the_shape_is_changed`.
16. `sources.py` classifies the real providers' documented shapes as
    `ok`. Test: `tests/test_nightly_tools.py::test_the_real_providers_documented_shapes_are_ok`.
17. `check` exits 1 exactly when a line is `changed`, and `probe` exits
    0 only when both sources are `ok`. Test: `tests/test_nightly_tools.py::test_check_exits_1_exactly_when_a_line_is_changed_and_probe_needs_everything_ok`.
18. (blind) Run on the real `nightly` network, `probe` fails when a TCP
    connection to `1.1.1.1:443` opens, so a network with a route out
    never passes. Test: no test.
19. `relay.py` carries a request and its response byte for byte, in
    both directions, and closes both sides when either closes.
    Test: `tests/test_nightly_tools.py::test_the_relay_carries_bytes_both_ways_and_closes_both_sides`.
20. `prepare` fails a plan missing any coverage name. Test: `tests/test_nightly_tools.py::test_prepare_refuses_a_plan_that_leaves_a_coverage_name_out`.
21. (blind) `prepare` fails a plan whose damaged record or pair is its
    holding's latest quantity. Test: `tests/test_nightly_tools.py::test_prepare_refuses_a_damaged_record_or_pair_that_leaves_two_correct_totals`.
22. `prepare`'s `expected.json` matches a hand-computed vault covering
    an archived holding, an unpriced one, a main-currency one, a debt
    and an edited rate, under both pricing modes. Test: `tests/test_nightly_tools.py::test_expected_figures_match_a_hand_computed_vault_under_both_modes`.
23. (blind) An archived holding that is also unpriced or has no
    quantity is listed under `excluded` with the reason `archived`.
    Test: `tests/test_nightly_tools.py::test_expected_figures_match_a_hand_computed_vault_under_both_modes`.
24. `fixtures.mjs`, run from the test suite against a fresh instance,
    exits 0 and writes every output. Test: `tests/test_nightly_browser.py::test_the_generator_writes_every_output_and_the_manifest_covers_every_name`.
25. (blind) `fixtures.mjs` sends no request to `/api/rates`, asserted
    from the request log. Test: `tests/test_nightly_browser.py::test_the_generator_sends_no_request_to_the_rate_lookup`.
26. (blind) `fixtures.mjs` writes no record by its own crypto: records
    go through the served modules, and only the damaged record and the
    pair use `plant`. Test: `tests/test_nightly_tools.py::test_the_generator_writes_no_record_by_its_own_crypto`.
27. (blind) Every vault request the generator sends, `plant` writes and
    `makeStale`'s upgrade included, carries `X-Solvent-Vault`, shown
    from a request capture of a fresh run. Test: no test.
28. (blind) After `patch.py` runs on that instance's database, each
    vault's dashboard, in a real browser, shows the manifest's
    `display` total under both pricing modes, and the damaged record is
    reported unreadable. Test: `tests/test_nightly_browser.py::test_each_dashboard_shows_the_manifests_totals_under_both_modes_and_the_damaged_record_is_unreadable`.
29. After `patch.py`, the aged session's cookie is refused as no
    session. Test: `tests/test_nightly_browser.py::test_patch_changes_only_the_rows_it_names_and_the_aged_session_is_refused`.
30. (blind) The `idle-lock-out-of-range` vault's profile record,
    decrypted, holds `idleLockMinutes: 0`, and its Settings screen
    shows an idle lock of five minutes. Test: `tests/test_nightly_browser.py::test_the_out_of_range_idle_lock_is_stored_as_zero_and_shown_as_five_minutes`.
31. (blind) `patch.py` changes exactly the rows its file names, in
    `sessions`, `invites` and `credentials`, and every other table is
    byte-identical in a dump afterwards. Test: `tests/test_nightly_tools.py::test_patch_changes_exactly_the_rows_it_names`.
32. (blind) A patch naming an unknown username or label, or a
    `kdfMemory` of 65536, changes nothing and exits 1. Test: `tests/test_nightly_tools.py::test_a_patch_that_cannot_apply_changes_nothing`.
33. `backup-format-1.json` has `formatVersion: 1` and a `kdf` envelope
    at `m = 65536, t = 3, p = 1`, and its plan and expected files exist.
    Test: `tests/test_nightly_tools.py::test_the_older_backup_and_its_plan_and_figures_are_committed`.
34. `mcp.py`, driven over stdio, lists exactly the tools in the table
    with their schemas. Test: `tests/test_nightly_tools.py::test_the_protocol_lists_exactly_the_tools_and_answers_as_specified`.
35. (blind) A call with an extra argument, a wrong enum value or a
    malformed date returns `isError: true` and runs nothing, shown by
    the handler, not by the schema's declaration alone. Test: `tests/test_nightly_tools.py::test_an_argument_outside_the_schema_is_refused_by_name_and_runs_nothing`.
36. (blind) With a stand-in `docker` first on `PATH`, `server_log`,
    `app_stop` and `app_start` run it with exactly `logs <container>`,
    `stop --time 10 <container>` and `start <container>`. Test: `tests/test_nightly_tools.py::test_the_tools_run_docker_with_exactly_these_argument_lists`.
37. `price_source` leaves `modes.json` holding the new state. Test: `tests/test_nightly_tools.py::test_price_source_leaves_the_new_state_and_known_prices_is_the_table`.
38. `price_requests` omits the lines present at start. Test: `tests/test_nightly_tools.py::test_price_requests_omit_what_was_there_at_start`.
39. (blind) `mcp.py` started under `env -i` with `GH_TOKEN` and
    `CLAUDE_CODE_OAUTH_TOKEN` in the parent's environment has neither in
    its own, read from `/proc/<pid>/environ`, not from inside the
    process. Test: `tests/test_nightly_tools.py::test_the_server_holds_neither_token_in_its_environment`.
40. (blind) The imports of every file under `tools/nightly/`, Python and
    Node alike, read from its source, are the standard library, `node:`
    built-ins and exactly the imports listed under Files.
    Test: `tests/test_nightly_tools.py::test_every_python_file_imports_the_standard_library_and_only_what_the_spec_lists`, `tests/test_nightly_tools.py::test_the_generator_imports_node_builtins_and_the_chrome_driver_alone`, `tests/test_review_nightly_harness.py::test_the_source_check_imports_from_the_app_exactly_the_constants_rate_lookup_names`.
41. (blind) No module under `solvent/` imports from `tools/`.
    Test: `tests/test_nightly_tools.py::test_nothing_in_the_app_imports_from_tools`.
42. `clear` keeps the date's rates and leaves the expected figures as
    they were, and `deleteRecording` leaves nothing at its date. Test: `tests/test_nightly_tools.py::test_clear_and_delete_write_their_ops_and_leave_the_expected_figures`, `tests/test_review_nightly_harness.py::test_the_cleared_date_keeps_its_rates_and_the_deleted_recording_keeps_nothing`.
43. (blind) `prepare` refuses a cleared or deleted date outside the
    recorded dates, with no recording, or whose prices all lie on their
    neighbors' line. Test: `tests/test_nightly_tools.py::test_prepare_refuses_a_cleared_or_deleted_date_that_bends_nothing`, `tests/test_nightly_tools.py::test_prepare_refuses_a_cleared_date_whose_prices_lie_on_the_line`.
44. With no holding valued the expected total, `assets` and `debts` are
    `null`. Test: `tests/test_nightly_tools.py::test_with_nothing_valued_the_total_and_the_sides_are_none`.
45. A registration form that never shows, as for a refused invite,
    fails the generator with the text the page shows. Test: `tests/test_nightly_browser.py::test_a_registration_form_that_never_shows_fails_naming_what_the_page_shows`, `tests/test_review_nightly_harness.py::test_a_refused_invite_fails_the_generator_naming_the_address_and_what_the_page_shows`.
