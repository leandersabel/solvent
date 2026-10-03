# Nightly harness

## What it does

The tooling the nightly run puts around the built image so `qa` can
check what no browser alone can see: the price sources answering under
their real names, data that took years to accumulate, promises that
take hours to come due, and the server's own log. It is pipeline
tooling under `tools/nightly/`. It is never in the image, and nothing
in the image knows it exists (CLAUDE.md, The loop, Nightly and stable).

The image under test is tonight's, unchanged. Every harness container
runs that image with its entrypoint overridden and `tools/nightly/`
mounted read-only. No step builds, commits or tags an image, so the
image the nightly publishes is the one every shard tested.

## Which features it serves

| Harness part | Product features it lets `qa` check |
|---|---|
| The stand-in, its request list and failure modes, the known prices | `rate-lookup`, `record-snapshot`, `net-worth-view`, `manage-accounts` |
| The source check | `rate-lookup` |
| Prepared vaults, expected totals | `net-worth-view`, `record-snapshot`, `manage-accounts`, `account-settings` |
| Prepared backup files | `export-import` |
| The older vault and the aged session | `login`, `account-settings` |
| The expired invite and the harness administrator | `register`, `admin-invites` |
| The server log, stopping and starting the app | `app-shell`, `login`, `admin-invites` |

## Trust boundaries

- **The app has no route out.** Its only network is internal, so a
  lookup reaches the stand-in or nothing, and no fixture value can
  reach a real source.
- **The stand-in is trusted by name and by a mounted trust store, never
  by a setting.** The app's provider hosts and URL templates are
  constants (rate-lookup.md, SSRF and egress hardening). The harness
  answers those names on its own network, and mounts a trust store
  holding only the run's certificate authority over the image's system
  store. So an installation has no switch a test could have flipped.
- **The run's certificate authority vouches for the provider names
  alone, for one day, and signs once.** Its key is deleted as soon as the
  stand-in's certificate is signed, and it is name-constrained, so
  whoever reads the runner afterwards holds nothing that can vouch for
  another host.
- **`qa` reaches the server only through the harness tools.** The tools
  have fixed names and argument shapes, take no command, path,
  container name or URL as an argument, and run with an empty
  environment, so no token reaches them. The walk step holds no
  unrestricted shell (What the workflow does).
- **Everything the server says is untrusted text.** The log and the
  request list return to `qa` as JSON strings, never interpreted.
- **Fixture passwords are public.** They are committed in the plan and
  open only throwaway vaults on an instance nobody outside the runner
  can reach. They are never reused for anything else.
- **Prepared data never leaves the runner.** The output directory and
  the TLS directory are never uploaded as artifacts.

## Files

Under `tools/nightly/`, standard library only, Python 3.12 or later and
Node 24 or later. None adds a dependency. Imports beyond the standard
library and `node:` built-ins are exactly these:

- `standin.py`, `mcp.py` and `prices.py prepare` import `prices`, their
  sibling in `tools/nightly/`, which is on the path as the running
  script's own directory. Every price comes from that one module.
- `sources.py` imports from `solvent.rates` the constants rate-lookup.md
  names for it (SSRF and egress hardening), running in tonight's image
  with `PYTHONPATH=/app`.
- `fixtures.mjs` imports `tests/browser/cdp.mjs`, the Chrome driver,
  rather than keeping a second one.

Nothing else imports from `solvent` or `tests/`. Nothing in `solvent`
imports from `tools/`, and the harness's own tests are the only code
outside it that does.

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
| `fixtures/backup-format-1.plan.json`, `fixtures/backup-format-1.expected.json` | what it was made from and what it holds, committed with it |
| `fixtures/out/` | tonight's generated data, ignored by git |

`qa` may read `fixtures/plan.json`,
`fixtures/out/manifest.json` and the backup files, never the code.

A script that runs to an end exits 0 on success, 1 on a check that
failed, and 2 on a usage error. No script writes anything but its
stated outputs.

## The network

Each shard creates its own Docker networks:

- `nightly`, created with `--internal`: the app, the stand-in, and one
  leg of the relay. Nothing on it has a route out.
- `nightly-edge`, an ordinary bridge: the relay's other leg, which
  publishes `127.0.0.1:8000`.

The stand-in joins `nightly` with the network aliases
`api.frankfurter.dev` and `api.nbp.pl`, so Docker's resolver answers
those names with its address on that network.

A port cannot be published from an internal network, which is why the
relay exists. It is the runner's only way to the app, and the app sees
it as every client's peer.

## The run's certificate authority

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

## The stand-in

`python /harness/standin.py --cert <leaf.pem> --key <leaf.key> --state
<dir> [--port 443]`, in a container of tonight's image on `nightly`.

- HTTPS only, TLS 1.2 or later, a `ThreadingHTTPServer` behind an
  `ssl.SSLContext(PROTOCOL_TLS_SERVER)` holding the leaf alone.
- It routes on the `Host` header: `api.frankfurter.dev` and
  `api.nbp.pl` each answer as below, and any other host gets `421` with
  an empty body.
- The statuses here are the providers' own, outside Solvent's status
  set (architecture.md, Status codes).

### Known prices

`prices.py` is the one home of every price the stand-in publishes. A
price is a pure function of the source, the date and the currency, so
every process that asks gets the same answer.

- **Publication days** are Monday to Friday, with no holidays, up to
  and including the stand-in's current UTC date. Frankfurter publishes
  from `1999-01-04` and NBP from `2013-01-02`, the start of the real
  series the app calls and each symbol's date floor (rate-lookup.md,
  SSRF and egress hardening). The app sends no earlier date, so the
  stand-in's `404` before them is never exercised by it.
- **Currencies** are Frankfurter's list, the same set as the seeded
  currency half of the symbol table (rate-lookup.md, Seeded symbols).
  Each has a reference value `ref[C]`, units of C per euro, in a
  constant table in `prices.py`, with `ref["EUR"] = 1`.
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
currency but `quote`, and `XAU-g` and `XAU-ozt` where NBP published
within the 14-day window, each `{rate, base, asOf, source}`. It applies
rate-lookup.md's composition exactly as pinned there (Providers), so
it is the oracle for every proposal `qa` sees.

### What it answers

| Host | Request | Answer |
|---|---|---|
| `api.frankfurter.dev` | `GET /v1/<D>?base=<Q>`, `Q` a known currency, `D` on or after `1999-01-04` | `200`, `{"amount": 1.0, "base": Q, "date": <last publication day ≤ D>, "rates": {C: …}}` for every known `C ≠ Q` |
| `api.frankfurter.dev` | anything else | `404`, `{"message": "not found"}` |
| `api.nbp.pl` | `GET /api/cenyzlota/<S>/<E>?format=json`, `S ≤ E`, span at most 93 days, a publication day in range | `200`, `[{"data": <day>, "cena": …}, …]`, every publication day in range, ascending |
| `api.nbp.pl` | same, no publication day in range | `404`, `Not Found - Brak danych` as `text/plain` |
| `api.nbp.pl` | same, `S > E` or span over 93 days | `400`, `Bad Request` as `text/plain` |
| `api.nbp.pl` | anything else | `404`, `Not Found` as `text/plain` |

JSON answers carry `Content-Type: application/json; charset=utf-8`.

### Failure modes

`<state>/modes.json` is `{"frankfurter": "up" | "down", "nbp": "up" |
"down"}`. The stand-in reads it on every request. Absent, unreadable or
malformed, both sources are up. A source that is down answers every
request `503` with an empty body, after recording it.

### The request list

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

## The relay

`python /harness/relay.py --listen 0.0.0.0:8000 --to solvent:8000`,
in a container of tonight's image. It copies bytes both ways between
each accepted connection and one new connection to the fixed target,
and closes both when either side closes. It reads, logs and alters
nothing.

## The source checks

`python /harness/sources.py check|probe`, in a container of tonight's
image with `PYTHONPATH=/app`, so it requests exactly what the app
requests: it imports `FX_URL`, `NBP_URL`, `USER_AGENT`,
`EGRESS_TIMEOUT_SECONDS`, `MAX_RESPONSE_BYTES` and `SEEDED_SYMBOLS`
from `solvent.rates`, and opens each URL with the default context and
redirects off, as the app does.

Both send one request to each source, for quote `CHF` and the date `D`
seven days before the current UTC date (NBP from `D − 14 days` to `D`),
and print one line per source:
`<frankfurter|nbp> <ok|no-answer|changed> <reason>`. The reason names
the status, exception class or first shape violation, never the body.

**Shape.** Frankfurter answers an object whose `base` is `CHF`, whose
`date` is an ISO date within `[D − 7 days, D]`, and whose `rates` maps
three-letter upper-case codes to numbers above zero, every seeded
currency but `CHF` among them. NBP answers a non-empty array, ascending
by `data`, of objects whose `data` is an ISO date within
`[D − 14 days, D]` and whose `cena` is a number above zero. A boolean
is not a number.

**`check`** runs once a night against the real sources, in the build
job, on the default bridge network.

| Outcome | When |
|---|---|
| `no-answer` | name resolution, connection or TLS failure, a timeout, `429` or any `5xx` |
| `changed` | any other status but `200`, `3xx` included, because the app follows no redirect. A `200` body over the size cap, not JSON, or off the shape above |
| `ok` | `200` with the shape above |

It exits 1 when any source is `changed`, and 0 otherwise. Its
`no-answer` lines are the note in the run's summary.

**`probe`** runs per shard against the stand-in, on `nightly` with
`trust/` mounted as in the app. It exits 0 only when both sources are
`ok` and a TCP connection to `1.1.1.1:443` does not open within 3
seconds, which proves the trust store, the aliases and the missing route out
together.

## Prepared data

### The plan

`fixtures/plan.json` names every prepared account with its username,
password, kind and main currency, and what its vault holds. The
manifest's coverage names below are the contract: each must be covered
by at least one prepared item, and a test fails the plan that leaves
one out.

| Coverage | What the prepared item must be |
|---|---|
| `household` | two vault owners with the same main currency, each holding `USD` and `XAU-ozt`, so one recording date in both reaches each source once |
| `long-history` | a vault recorded at every month end from before `2013-01-02` through the last month end before today, holding the main currency, `USD`, `XAU-g` and a debt. Gold dates before `2013-01-02` carry a price typed by hand |
| `many-dimension-values` | a dimension with at least five values, each held by at least one holding |
| `rate-edited-long-ago` | a proposed rate, more than five years back, edited to a figure other than the known price, and a holding whose latest quantity sits on that date, so the edited rate is its price as recorded |
| `no-source-unit` | a holding in `XAG-ozt`, priced by hand |
| `own-unit` | a holding in a unit outside the symbol table, priced by hand on one old date only, so its price is older than the vault's newest |
| `archived-holding` | a holding archived on a recording date at which every unit already has a price, so archiving makes no lookup |
| `other-main-currency` | a vault whose main currency is `EUR` |
| `damaged-record` | a `snapshot` whose ciphertext was encrypted under the AAD of another `record_id`, so it fails authentication |
| `same-date-pair` | two snapshots of one holding at one date |
| `older-vault` | a vault whose credential's KDF envelope has `m = 32768`, below the server default, and is otherwise the default |
| `empty-vault` | a vault owner with no holdings |
| `aged-session` | `qa`'s browser starts holding a session of a prepared vault owner, issued 12 hours 5 minutes before `patch.py` ran and last active 1 minute before it |
| `expired-invite` | a vault-owner invite that expired one day before `patch.py` ran |
| `current-backup` | tonight's export of the `long-history` vault |
| `older-backup` | `fixtures/backup-format-1.json` |
| `harness-admin` | the administrator through whom the invites were made |

Neither the damaged record nor the pair is its holding's latest
quantity, and neither sits on a holding's archive date, so every
expected total has exactly one correct value. Every other quantity and
rate in the plan is one the app's own screens could write.

### `prices.py prepare`

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

- each active, priced holding's figure is its latest quantity times its
  price (the latest price, or the price as recorded), rounded half-even
  at scale 12, as `static/js/decimal.js` multiplies;
- the total is the sum of those figures at scale 12. `assets` sums the
  figures above zero and `debts` those below;
- each is given `exact`, at scale 12 without trailing zeros, and
  `display`, rounded half-even to the places the vault's profile shows,
  with no grouping and `-` for a negative.

Archived holdings, holdings with no quantity and holdings with no price
are listed by name under `excluded`, with the reason.

### `fixtures.mjs`

`node tools/nightly/fixtures.mjs --base <url> --invite <path> --plan
<plan> --out <dir>`, with `CHROME` naming the browser. It reads
`<dir>/script.json` and `<dir>/expected.json` and writes nothing the
app's own code did not produce:

- **Accounts** register through `/register?invite=` as the page does,
  one fresh Chrome profile per account, so no cookie of one account
  replaces another's. `--invite` is a CLI-minted administrator invite,
  which registers `harness-admin`. Every other invite is made through
  `POST /api/admin/invites` from that administrator's page, the
  expired one with the plan's label.
- **Records** are written only through the served modules
  `/static/js/session.js`, `writes.js`, `crypto.js` and `api.js`:
  `saveProfile`, `saveHolding`, `saveSnapshot`, `refreshPrices` with
  the script's proposals, `saveRate` with `editedRatePayload`, and
  `archiveHolding`. The damaged record and the pair are the
  exceptions, written as `tests/browser/harness.mjs` `plant` writes.
  No record is written by the generator's own crypto.
- **No lookup**: proposals come from the script, so the generator
  sends nothing to `/api/rates` and spends no part of any limit.
- **The older vault** is rotated through `/api/auth/upgrade-kdf` with
  keys derived at `m = 32768`, as `harness.mjs` `makeStale` does, and
  `patch.py` then records that parameter.
- **The current backup** is the body of `GET /api/export`, fetched by
  the page with the `X-Solvent-Request` header.
- **The aged session's cookie** is read with CDP `Network.getCookies`
  in that account's profile, right after it registers.

Outputs in `<dir>`:

| File | Contents |
|---|---|
| `manifest.json` | below |
| `backup-<username>.json` | each current backup |
| `patches.json` | the dating back for `patch.py` |
| `storage-state.json` | Playwright storage state, `{"cookies": [<the aged session's cookie>], "origins": []}`, with `expires`, `httpOnly`, `secure` and `sameSite` as CDP reported them |

### The manifest

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
      "formatVersion": 1, "covers": ["current-backup"] }
  ],
  "expected": { "<username or backup file>": {
    "latest": { "total": {"exact": "…", "display": "…"}, "assets": {…},
                "debts": {…}, "holdings": {"<name>": {…}}, "excluded": {"<name>": "archived"} },
    "asRecorded": { … } } }
}
```

Every coverage name appears under some `covers`. `qa` reads nothing
else to know what is prepared.

### Dating back

`python /harness/patch.py <database> <patches.json>`, in a one-off
container of tonight's image with `--network none`, the app's volume,
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

### The older backup file

`fixtures/backup-format-1.json` was made once, by `prepare` and
`fixtures.mjs` from `backup-format-1.plan.json`, at the server's
default KDF envelope of that build, with every date absolute. Its
expected figures were kept as `backup-format-1.expected.json`. None of
the three is regenerated, because a file made by today's build is not
an older one (export-import.md, Acceptance criteria, keeps its own
fixture the same way). The manifest carries its password and points at
it.

## The harness tools

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
| `price_source` | `source`: `frankfurter` \| `nbp`, `state`: `up` \| `down` | writes `modes.json` through a temporary file and `os.replace` | the modes now in force |
| `known_prices` | `date`: `YYYY-MM-DD` on or before today, `quote`: a known currency | `prices.known_table` | the table, independent of the modes |
| `app_stop` | none | `docker stop --time 10 <container>` | `{"state": "stopped"}` |
| `app_start` | none | `docker start <container>`, then polls `<url>/login` until it answers 200, at most 60 seconds | `{"state": "running"}`, or `isError: true` with `{"state": "not answering"}` |

## What the workflow does

`.github/workflows/nightly.yml` is the client's. This is what it must
do for the harness to hold.

**Build job**, after the image is built and before any shard starts: a
step with the id `sources` runs `sources.py check` in a container of
tonight's image on the default network, appends its output to the
step summary, and fails the job on exit 1.

**Each QA shard**, before the walk, in steps whose failure fails the
shard as the harness:

1. Runs the setup action, for Node and `CHROME`.
2. `ca.py "$RUNNER_TEMP/tls"`, and creates `$RUNNER_TEMP/standin`.
3. Creates `nightly` with `--internal` and `nightly-edge`.
4. Starts `standin` on `nightly` with both aliases, as the runner's own
   user, with `--sysctl net.ipv4.ip_unprivileged_port_start=443`,
   `tls/` and `tools/nightly/` read-only and `standin/` writable.
5. Starts `solvent` on `nightly` alone, with the hardening it has
   today, a fresh `SECRET_KEY`, and `tls/trust/` read-only at
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
--security-opt no-new-privileges:true`.

**The walk step**:

- passes `tools/nightly/fixtures/out/manifest.json` as the manifest;
- adds the `harness` MCP server as above, and
  `--storage-state tools/nightly/fixtures/out/storage-state.json` to the
  Playwright server's arguments;
- allows `mcp__harness` and `mcp__playwright`, and no `Bash` beyond
  `gh issue list` and `gh issue view`. With an unrestricted shell the
  walk would reach Docker, the database volume and the internet, and
  the harness tools would no longer be the only way to the server.

On failure it prints `docker logs` of `solvent` and `standin`.

## Edge cases

- **A source answers the check in a changed shape** → the build job
  fails at `sources`, before any shard, and the failure issue names
  that step.
- **A source does not answer the check** → noted in the summary, and
  the night goes on. The stand-in answers the shards either way.
- **The base image moves its trust store** → the probe fails the shard
  as the harness, rather than every lookup failing as a finding.
- **`qa` sets a source down and the breaker opens** → the app skips
  that source for the cool-off after it comes back up
  (rate-lookup.md, Rate limiting and failure). `app_stop` and
  `app_start` reset it, because the breaker lives in process memory.
- **`app_start` before `app_stop`** → `docker start` on a running
  container changes nothing, and the tool answers `running`.
- **The prepared data spans midnight UTC** → `prepare` reads the date
  once and writes it as the manifest's `today`. The expected figures
  hold for that date, since no later price is written.
- **A plan that leaves a coverage name uncovered** → `prepare` exits 1
  naming it.

## Acceptance criteria

- `ca.py` writes exactly the outputs above. The CA and the leaf carry
  every field in the table, read back with `openssl x509 -text`. The
  validity is at most one day. No private key but `leaf.key` exists
  anywhere under the output directory or the system's temporary
  directory afterwards. `trust/` holds two files byte-identical to
  `ca.pem`, one named by its subject hash.
- A Python 3.13 default context loaded with `ca.pem` alone completes a
  handshake with `standin.py` on 127.0.0.1 under `server_hostname`
  `api.frankfurter.dev` and `api.nbp.pl`, and fails under any other
  name.
- `standin.py` answers every row of the answers table as stated, with a
  weekend `D` answered at the preceding Friday and a range holding no
  weekday answered `404`.
- With `modes.json` setting a source down, every request to it is
  answered `503` and still recorded with `mode: "down"`. With the file
  absent or holding invalid JSON, both answer.
- Every request, a malformed one included, is one line of
  `requests.jsonl` with every field above. `seq` continues across a
  restart of the stand-in.
- `known_table` equals what the app's `/api/rates` returns for the
  whole table, without `cached`, on dates covering a weekday, a
  weekend, the day before `2013-01-02` and today, for `CHF`, `EUR` and
  `PLN`, with the app's opener stubbed to answer from `standin.py`'s
  routing.
- The currency list in `prices.py` equals the seeded currencies in
  `solvent.rates`.
- `sources.py`'s classification yields `no-answer` for a timeout, a
  refused connection, `429` and `503`. It yields `changed` for `301`,
  `404`, a non-JSON `200`, a body over the cap, a missing `PLN`, a
  missing seeded currency, a boolean rate, an empty NBP array and a
  date outside the window. It yields `ok` for the real providers'
  documented shapes. `check` exits 1 exactly when a line is `changed`.
- `relay.py` carries a request and its response byte for byte, in both
  directions, and closes both sides when either closes.
- `prepare` fails a plan missing any coverage name, and one whose
  damaged record or pair is its holding's latest quantity. Its
  `expected.json` matches a hand-computed vault covering an archived
  holding, an unpriced one, a main-currency one, a debt and an edited
  rate, under both modes.
- `fixtures.mjs`, run from the test suite against a fresh instance,
  exits 0, sends no request to `/api/rates`, and writes every output
  above. After `patch.py` runs on that instance's database, each
  vault's dashboard shows the manifest's `display` total under both
  pricing modes, the damaged record is reported unreadable, and the
  aged session's cookie is refused as no session.
- `patch.py` changes exactly the rows its file names, in `sessions`,
  `invites` and `credentials`, and every other table is byte-identical
  in a dump afterwards. A patch naming an unknown username or label,
  or a `kdfMemory` of 65536, changes nothing and exits 1.
- `backup-format-1.json` has `formatVersion: 1` and a `kdf` envelope at
  `m = 65536, t = 3, p = 1`, and its plan and expected files exist.
- `mcp.py`, driven over stdio, lists exactly the tools in the table
  with their schemas. A call with an extra argument, a wrong enum value
  or a malformed date returns `isError: true` and runs nothing. With a
  stand-in `docker` first on `PATH`, `server_log`, `app_stop` and
  `app_start` run it with exactly `logs <container>`,
  `stop --time 10 <container>` and `start <container>`.
  `price_source` leaves `modes.json` holding the new state.
  `price_requests` omits the lines present at start.
- `mcp.py` started under `env -i` with `GH_TOKEN` and
  `CLAUDE_CODE_OAUTH_TOKEN` in the parent's environment has neither in
  its own, read from `/proc/<pid>/environ`.
- The imports of every file under `tools/nightly/`, read from its
  source, are the standard library, `node:` built-ins and exactly the
  imports listed under Files. No module under `solvent/` imports from
  `tools/`.
