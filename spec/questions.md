# Open questions

Maintained by the product-owner agent. When it can't resolve something
from the spec alone, it logs a question here instead of guessing.
Answer by editing the relevant spec file, then remove the question and
recompile.

**No open questions as of 2026-08-01.** A spec review that day raised
twelve findings; all are now closed. Everything below is kept with its
reasoning so decisions are not re-litigated by inference — including one
that was reversed on the day it was confirmed.

## Closed: the AAD's `user_id` binding (2026-08-01)

**Removed from the AAD. Import re-keys instead.** Raised by a review
that found the client could never build an AAD at all: no endpoint
returned the session user's own `user_id`, and registration encrypted
the profile record before the server had assigned one.

The fix was not to plumb the id through. Binding `user_id` turned out to
buy nothing the per-user DEK does not already give — a blob moved into
another vault fails to decrypt under that vault's key, unconditionally.
Its only live case was the one place two users legitimately share a key:
a vault transfer through Export/Import. And the spec's response to that
case was to make import re-encrypt every record.

So the binding was carrying a permanent structural cost to *detect* a
state that could be *prevented*. Import now generates a fresh DEK
instead — identical work, and afterwards the two vaults share no key
material, so cross-injection fails at the cryptography rather than at a
check. Registration's ordering problem dissolves as a side effect: every
AAD field is one the client chose.

Consequences: the client never needs to know its `user_id`, no endpoint
returns one, and the export file no longer carries one.

## Closed: registration is one transaction (2026-08-01)

**Single-phase, not two.** Two-phase registration — create the user,
then write the profile through `PUT /api/records` — would have bought a
clean invariant: only one code path ever creates a record row. It was
rejected because it burns a single-use invite in phase one, so a failure
in phase two leaves a logged-in user holding a vault with no main
currency, having already paid a ~1 s key derivation and spent an invite
that cannot be reused. The invariant is recovered at the implementation
level instead: the registration transaction calls the same record
validator `PUT` does.

## Closed: how a second admin is made (2026-08-01)

The spec promised an admin could be made "by the bootstrap CLI or by an
invite carrying `is_admin`", and neither existed — the invite endpoint
had no such flag, and the CLI refused on a populated instance. The set
of admins was frozen at one, permanently.

**Both paths now exist.** `POST /api/admin/invites` takes `isAdmin`,
and the CLI runs on a populated instance behind `--force`.

The CLI guard was dropped because it defended against someone who had
already won: only an actor with shell access to the host can run it, and
that actor already holds the database, the `SECRET_KEY`, and the served
JavaScript — which `architecture.md` states outright is not defended
against. Its real effect was to delete the only recovery path in the
product, leaving hand-edited SQLite as the alternative. Note the
boundary this does **not** cross: minting an account that is born an
admin is not promoting an existing one, and no endpoint does the latter.

## Closed: freeform tags are removed (2026-08-01)

**Dimensions are the only taxonomy.** Owner's call, on noticing that
every tag example in the spec was already a dimension: `architecture.md`
offered "cash", "investment", "retirement" — verbatim the values of the
`liquidity` dimension — and the canonical record carried `bank:ubs`
(a dimension written as a tag) beside `emergency-fund` (a one-value
dimension).

Overlap was the stated reason to keep both, and overlap is what having
several dimensions already provides: an account carries a liquidity
value and an emergency-fund value at once. Tags were a second spelling
that could not be ordered, stacked, or summed without a disclaimer — the
dashboard's tag breakdown shipped with a standing note that the parts
could exceed the whole.

Removed with them: the chip input and the routing logic that caught a
typed `key:value` and redirected it into a select, tag normalization,
the "Untagged" group, the tag filter, and that disclaimer. Added in
their place: a **flag** (a one-value dimension, rendered as a checkbox)
for the yes/no case, an account-level **note** field for text that was
never a category, and inline value/dimension creation on the account
form so classifying stays one gesture.

Nothing was implemented, so this cost spec edits and no migration.

## Closed: dimensions use opaque ids (2026-08-01)

**Ids are generated, never derived from labels, and never change.** The
original design keyed dimensions by a user-visible string, which made a
key rename a multi-record re-encryption over every account carrying it —
the most dangerous operation in the feature, offered for a value the
user never sees.

A first proposal slugified the label at creation and froze it. The
owner's counter was better: use a generated id and let the label be
free. That removes transliteration and collision rules entirely, and it
closes a hazard the slug version kept — a label-derived key can collide
with a string already in user data, silently classifying accounts that
carried a `key:value`-shaped tag. A generated id cannot.

Two consequences fall out. **No operation in the dimensions feature
writes more than one record**, ever. And deleting became archiving:
since ids are not reconstructible from a label, a re-created dimension
would orphan every assignment, so definitions are kept with an
`archivedAt` and restore exactly. There is deliberately no "remove from
all accounts" option — that is a destructive multi-record write to
reclaim bytes inside ciphertext nobody reads.

## Closed: the "Ambiguous" band is gone (2026-08-01)

It was introduced as an integrity signal: an account holding two values
for one dimension is malformed, and the client must never silently pick
one. With tags removed, dimension assignments moved from `key:value`
strings in a shared array to a **map keyed by dimension id** — and a
JSON object cannot carry the same key twice. The state became
unrepresentable by the form, an import, and a hand-edited export alike.

Detection beat guessing; impossibility beats detection. "Unassigned"
stays a real band, and a value id naming an archived or unknown value
renders there too. The 45° hatch is removed from `design-system.md`
rather than reserved — a pattern kept for an unreachable state gets
reused for the wrong thing later.

## Closed: where snapshot history lives (2026-08-01)

`record-snapshot.md` specified editing and deleting past snapshots, and
`rateSource` existed so "a user can audit which figures were guessed" —
none of which had a screen. A user who mistyped a value could only fix
it by remembering the exact date and re-entering it.

**A new `ui/account-detail.md`** owns the account's snapshot history,
rate provenance, and archive lifecycle. Two connected calls:

- **A snapshot's date is editable**, not frozen. Moving one onto an
  occupied date destroys the record already there, so it gets its own
  copy naming the deletion — distinct from the entry-time replace
  prompt, which destroys nothing.
- **The move writes before it deletes.** No transaction spans two
  records in this API, so one of the two orderings has to be chosen
  deliberately: delete-first can lose the displaced record and leave a
  hole, write-first can leave two snapshots on one date. The second is
  recoverable and visible, so it wins — and it makes duplicate dates a
  reachable state, which the detail screen surfaces rather than
  resolving by picking the higher `version`.

## Closed: charting library (2026-08-01)

**No library. The chart is drawn directly in SVG.** Owner's call, after
benchmarking the candidates' shipped bundles rather than their docs.

What the benchmark found, against the constraints from
architecture.md (Supply chain, Application hardening) and
ui/design-system.md:

| Library | gz | `eval` / `new Function` | `innerHTML` |
|---|---|---|---|
| Chart.js 4.5.1 | 69 KB | 0 | 0 |
| uPlot 1.6.32 | 21 KB | 0 | 0 |
| ECharts 6.1.0 | 360 KB | 1 | 15 |
| ApexCharts 6.6.1 | 226 KB | 0 | 37 |
| frappe-charts 1.6.2 | 17 KB | 0 | 17 |
| chartist 1.5.0 | 11 KB | 0 | 1 |

- **ECharts, ApexCharts, frappe-charts fail structurally**: their label
  and tooltip paths end in `innerHTML`. In an app where XSS means
  Master Key capture, that is not a configuration problem. (ECharts'
  single `new Function` is a legacy `JSON.parse` fallback in the geo
  module and was not the disqualifier.)
- **Chart.js and uPlot both pass** the CSP tests cleanly — no `eval`,
  no `new Function`, no `innerHTML`, no `setAttribute('style')`, both
  MIT.
- They were still not taken. What a library supplies here is scales,
  tick math and path building. What this chart actually needs — the
  partition rule, per-account interpolation, provenance tracking,
  per-band selection deltas, asset/liability mirroring — is domain logic
  written either way. Prototypes confirmed it: the full stacked,
  interactive chart is ~200 lines of dependency-free JS, and a
  production version with real tick generation, decimal arithmetic, a
  keyboard path and a table fallback is estimated at 350–450.

**Still open as a narrow option, not a question**: `d3-scale` +
`d3-array` alone (~10 KB gz, MIT, no `eval`) would replace only the
tick and scale math — the weakest part of the hand-rolled version —
without touching rendering or the DOM. Adopt it if the axis code proves
painful. It is not a charting library and does not reopen this
decision.

Constraints that survive for any library added later: self-hosted with
SRI, no CDN, no `eval`/`new Function`, text-only labels and tooltips,
and an explicit categorical palette rather than an imposed one.

## Closed: how the chart treats gaps and grouping (2026-08-01)

Four connected owner's calls, all on the same day, recorded together
because each one only makes sense with the others.

**1. Interpolate between snapshots; do not carry values forward as
steps.** This reverses the decision confirmed earlier the same day. The
owner's reasoning, recorded verbatim in substance so it is not
reverse-engineered wrongly later: *the chart exists to visualize trends,
not transactions.* Real transfers between accounts are instant and
sharp-edged, but a decade of sparse snapshots drawn as steps is a field
of cliffs that reads worse and communicates less than a curve.

The original objection — that a straight line between two snapshots
draws data the user never entered — is answered rather than dismissed:
every inferred stretch is marked by the **"Show what's estimated"**
toggle, and tick marks under the axis show where real snapshots exist.
The literal view is one click away instead of being the default.

**2. The chart is a stacked area chart, grouped by dimension.** This
requires a partition, which freeform many-to-many tags cannot provide —
the same objection that already rules out a pie chart of overlapping
tags. Hence dimensions (manage-accounts.md): namespaced tags with at
most one value per key. No record-format change; the account form's
single-selects are the enforcement.

**3. Two structural bands are never silently absorbed.** Accounts with
no value for a dimension land in "Unassigned"; accounts with two land in
"Ambiguous". The second is an integrity signal, not a grouping outcome —
the form makes it unreachable, so its presence means a malformed
imported or hand-edited record.

**4. Archived accounts end at a closing snapshot, interpolated into.**
The archive dialog's closing snapshot (manage-accounts.md) is the
expected path rather than a nicety. The run-down into it is interpolated
like any other stretch — deliberately, per decision 1, and marked as
estimated. Someone who closed a position on one specific day can record
an intermediate snapshot and get the sharp edge honestly. Both paths
annotate the date, so a drop is never mistaken for a bad snapshot.

## Closed: listed securities (2026-08-01)

Was "which equities provider." Closed by removing the need for one:
**brokerage holdings are recorded at depot level** — one account in the
depot's reporting currency, holding the total the broker reports, the
same act as updating a bank balance. Owner's call, and a scope decision
rather than a provider choice, so it does not reopen if a better API
appears.

The provider search ran before the call and informed it: Tiingo, EODHD,
FMP, and Stooq all fail on terms or on blocked automated access, and
Alpha Vantage — the only licence-clean candidate — offers 25 requests/day
across the whole instance with thin European coverage. `rate-lookup.md`
holds the detail, including the objection that generalizes to any future
provider: a snapshot's rate lives permanently inside ciphertext the
server cannot delete, so "delete all data on termination" can never be
honoured here.

What this removed from the design: per-position accounts, share counts,
ticker or ISIN namespaces in `rateSymbol`, split and corporate-action
handling, a second FX leg for foreign listings, `kind: equity`, and one
API key. What it costs: the user types a depot total they can read off
their broker.

## Closed: the unit is the rate symbol (2026-08-01)

**`rateSymbol` is removed; an account's `unit` doubles as it.** The two
fields could disagree, and the failure was the worst kind: an account
measured in `XAU-g` but priced with `XAU-ozt` reported a net worth
wrong by 31.1034768×, silently, with nothing on any screen to reveal
it. The currency case was likelier still — `unit: USD` with
`rateSymbol: EUR` is one mis-click, and every snapshot afterwards
converts at the wrong rate.

Checking the invariant was the obvious fix and the wrong one. Going
through every case in the spec, the two fields were never legitimately
different: a depot's unit *is* its reporting currency, gold in grams
*is* `XAU-g`, and `rateSymbol: null` occurred exactly when the unit had
no entry in the symbol table. Listed securities would have been the one
case that broke it, and they are out of scope by design. So the second
field stored the same fact twice with nothing keeping the copies
honest.

The account form's unit control is now a single searchable select over
the symbol table with a free-text escape hatch, replacing four controls
(unit kind, unit code, rate symbol, and the "no public price source"
checkbox). `unit.kind` went with them — the symbol table already
carries `kind`, and it "drove formatting and decimal places, nothing
else."

**No per-account opt-out of rate lookups** was added, though removing
the checkbox removed one by accident. The base-amount rule already
keeps amounts out of every request, and suppressing one account's
lookup would not hide a currency that any other account also holds. A
user who distrusts a proposal overwrites it, and `rateSource` records
that as `edited`.

## Confirmed decisions (2026-08-01)

All seven previously-unconfirmed decisions were reviewed and confirmed.
Kept here as a record of what was deliberately chosen, so nothing gets
re-litigated by inference downstream. Four were amended in the process:

- **Carry-forward, not interpolation** (net-worth-view.md). Confirmed
  that morning, then **reversed the same day** — see "how the chart
  treats gaps and grouping" above, which supersedes this entry. Kept
  here so the reversal is visible rather than looking like the decision
  was never made.
- **Import re-encrypts client-side** rather than restoring blobs
  verbatim (export-import.md). Confirmed unchanged — forced by AAD
  binding `user_id`; a verbatim restore yields a vault that opens and
  then decrypts nothing. Import therefore needs the export file's
  password, not the current one.
- **Username enumeration accepted at registration**, defended at login
  (register.md). Confirmed unchanged. The endpoint is invite-gated; the
  worst case is an invited household member learning who else has an
  account.
- **Changing an account's unit is blocked once it has snapshots**
  (manage-accounts.md). Rule confirmed; **amended** — the old acceptance
  criterion promised the server would reject a forced change, which it
  cannot do, since `unit` is inside the ciphertext. Now stated as
  client-enforced by construction, like the password policy.
- **Main currency is immutable in v1** (account-settings.md). Confirmed;
  **amended** — snapshots now carry `rateTarget` (record-snapshot.md)
  naming the currency their rate converts into. Redundant today, and it
  keeps a changeable main currency from becoming a migration over
  ambiguous historical rates.
- **Archived accounts leave the current total**, stay in history to
  `archivedAt` (net-worth-view.md). Confirmed; **amended** — the archive
  dialog now offers a closing snapshot at `archivedAt`, prefilled `0` and
  skippable (manage-accounts.md). Without it the chart drops by the last
  known value with nothing recorded to explain it. Amended again later
  the same day: the closing snapshot is the expected path and the chart
  interpolates into it — see above.
- **Idle lock, absolute session expiry at 12 hours** (login.md,
  account-settings.md). Expiry confirmed unchanged; idle lock
  **amended** — now user-configurable 5–60 minutes, default 15, stored
  as `idleLockMinutes` in the encrypted profile record. Re-unlock costs
  a full Argon2id derivation, so a fixed 15 minutes taxes long sessions;
  but the idle lock defends the walk-up threat, so it cannot be
  disabled.

## Closed: staleness becomes a sweep, not a warning (2026-08-01)

`net-worth-view.md` promised "a configurable staleness threshold
(default 90 days)" that nothing configured, while two files hardcoded
90. Four options were on the table — fixed, global-configurable,
per-account override, or drop it. **Owner's call: drop it, and build the
screen the warning was standing in for.**

The reasoning that killed every threshold variant: no single number fits
a product whose premise is uneven cadence. A current account moves
monthly, gold yearly, unlisted property every few years. At any fixed
number the slow assets sit permanently flagged, the user learns to skip
the badge, and it then fails for the account that genuinely went quiet.

What replaces it is `ui/update-values.md` — every account on one screen,
for one date, each row stating its own age in plain language ("about a
year ago") beside the control that fixes it, and distinguishing a
**recorded** figure from one **carried forward**. Information at the
moment it is actionable, instead of a badge on a screen where nothing
can be done about it.

The screen's sharpest part is **Confirm**: one action writing the
previous value at the new date with a **freshly fetched rate**. For
anything that is not a currency, the quantity is what stays constant and
the price is what moves — you still own 12.5 troy ounces, and gold has
done something since. Confirm is therefore the main action for metals
and property, not a shortcut for retyping, and it converts an inferred
stretch of the chart into recorded data. Copying the old rate forward
was rejected outright: it stamps a new date onto a stale price, which is
worse than recording nothing because it looks like a measurement.

There is deliberately **no "confirm all"** — confirming asserts that you
checked, and asserting it for fifteen accounts at once makes that a lie.

Consequences: no threshold anywhere, no staleness chip on the dashboard,
and the `warning` status color loses its only consumer. The token is
kept so the status triad stays complete, with a note that the last thing
to wear it turned out to be a fact about data age rather than a warning.

## Closed: four small review findings (2026-08-01)

Settled together, each in a line or two.

- **Import replaces the main currency, and that is allowed.** Import
  swaps the profile record along with every snapshot, so the vault stays
  internally consistent — every `rateTarget` matches the profile it
  arrived with. The immutability rule in `account-settings.md` guards
  against changing the label while keeping the data, which import does
  not do. The review step names the change when the currencies differ,
  because it moves every figure on the dashboard.
- **`warning` is a non-text color.** At 3.96:1 it cannot carry label
  text. No darker step was added: reaching 4.5:1 requires roughly
  `#b35733`, which sits ΔE 7.8 from `critical` — under the ~9.5
  separation this palette holds elsewhere — so a warning chip would
  start reading as an error. Warning and critical are neighbouring hues
  and converge as they darken. The status icon carries the meaning;
  the label sits in ink.
- **The rate proxy learns the main currency**, via `quote` on every
  lookup. Added to the accepted-leak list in `architecture.md` beside
  asset type, so it is covered by a decision rather than looking like an
  oversight against register.md's storage rule. It is never *stored* in
  plaintext, which is what that rule actually says.
- **There is no single-record `GET`, deliberately.** A stale-version
  reload refetches that record's type; the client holds the whole set in
  memory anyway, and a by-id endpoint would hand the server a per-record
  access pattern it currently cannot see. Written into `record-api.md`
  so nobody adds one to satisfy the phrase "reloads the current record".
- **The archive flow's closing snapshot follows the ordinary upsert
  rule** when that date already holds one: prefilled with the existing
  value rather than `0`, replaced after the same confirm. The archive
  dialog gets no private path around one-snapshot-per-date.

