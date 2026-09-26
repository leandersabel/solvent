# Open questions

Open questions only, each tagged with the agent that asked it. A
question is removed when the spec file that answers it has been edited,
and the decision lives there, not here. Who may put one to the client
is in `CLAUDE.md`, Who asks the client.

Format:

```
## <feature>: <short title>          [asked by: architect]

What is undecided, and what it changes.
```

## login: who reports a failed unwrap as an anomaly          [asked by: engineer]

`features/login.md`, Flow step 4 and Edge cases, and `ui/unlock.md`,
States, say a correct Auth Key whose wrapper will not unwrap is logged
server-side as an anomaly. The unwrap happens in the browser after the
login already answered OK, so the server never sees it fail, and no
endpoint exists for the client to report it. Today the card shows the
generic error and nothing is logged. Either an endpoint is specified
for the report, with what it may carry, or the server-side log is
dropped from both files.

## login: how long a verification may queue                [asked by: engineer]

`architecture.md`, Application hardening, Concurrency cap: requests
over the cap "queue, then fail with the ordinary throttle response".
No wait is stated, so a queued request today waits for a slot however
long that takes and never answers Too Many Requests. The bound decides
when an attacker holding every slot starts getting throttled instead
of slowing everyone down.

## login: the shape of the exponential backoff              [asked by: engineer]

`architecture.md`, Application hardening, Rate limiting, and
`features/login.md`, Edge cases, name exponential backoff alongside
the per-account limit and the lockout. Neither states a base, a factor
or what resets it, so the limiter has fixed windows and the lockout
and no backoff.

## login: the machine-readable code on an expired session  [asked by: engineer]

`features/login.md`, Edge cases, and the login contract's
`sessionExpiredMidRequest` ask for Unauthorized "with a
machine-readable code". `architecture.md`, Status codes, names none,
and Unauthorized has one meaning there, so the client treats the
status itself as the signal and the response carries no body code. If
a body field is meant, its name and value belong in Status codes.

## account-settings: which four endpoints need a session     [asked by: engineer]

`features/account-settings.md`, Acceptance criteria: "All four
endpoints return Unauthorized unauthenticated, and the three writes
return Forbidden without the `X-Solvent-Request` header." The feature
has five: change password, `GET /api/sessions`, logout, logout
everywhere and deleting the account. The tests read the four as change
password, the session list, logout everywhere and deletion, and assert
Forbidden on all four writes. `POST /api/auth/logout` answers OK
without a session. If it is one of the four, it must answer
Unauthorized instead.

## account-settings: deletion as a dialog with a typed username  [asked by: engineer]

`ui/settings.md`, Delete my account, calls the deletion form "the
dialog" and has it ask for the username typed back.
`ui/design-system.md`, Components, Dialog, says a destructive dialog
is "one confirmation, never a ladder and never a word to type back".
`features/account-settings.md` requires `confirmUsername`, and the
Settings artboard draws only the collapsed Danger zone. The screen
today puts the password, the username and both buttons inline in the
opened Danger zone, with no dialog.

## account-settings: the note past four values             [asked by: engineer]

`ui/dimensions.md`, The >4 note, quotes "All five are still tracked."
for a note that appears once a dimension holds a fifth value, so it is
wrong at six and beyond. The screen shows the quoted copy verbatim.

## account-settings: dashes in the empty-state copy          [asked by: engineer]

`ui/dimensions.md`, States, Empty, sets "Liquidity" off with a dash
on either side in the example sentence. The screen sets it off with
commas. Which is the copy?

- **engineer**: `features/export-import.md`, Acceptance criteria, says a
  `POST /api/import` payload with a `principalId` field naming another
  user "writes nothing into that user's vault" and that "the records
  land under the session user", which reads as the import succeeding.
  `features/record-api.md`, Rules, says a body carrying `principalId`
  is rejected outright and no row is written under either user. The
  server follows record-api: the whole payload is a Bad Request, and
  neither vault changes. Which one holds decides whether that import is
  refused or goes through with the field ignored. Until it is settled
  the criterion is asserted only in its first half, so export-import
  is not marked verified.
- **engineer**: `ui/design-system.md`, Components, Dialog, says a
  destructive dialog is "one confirmation, never a ladder and never a
  word to type back". `features/manage-accounts.md` requires typing the
  holding's name to delete it permanently, and
  `features/export-import.md` requires typing `ERASE` to replace a
  vault that holds records. The code follows the feature files. Is
  the design-system rule meant to exempt these two, or should one of
  them change?
- **engineer**: `features/export-import.md`, Edge cases, says an empty
  vault exports "a file with an empty `records` array", and the review
  and the `ERASE` rule in `ui/export-import.md` speak of a vault that
  "holds nothing". A registered vault always holds its profile record,
  so its export carries that one record and never an empty array. The
  import screen treats a vault holding only its profile as empty: it
  says nothing will be deleted and asks for no typed word. Is the
  profile alone "nothing" for the review and for `ERASE`, and should a
  file with no profile record at all, which would restore a vault with
  no main currency, be refused?
- **engineer**: `features/net-worth-view.md`, Acceptance criteria, reads
  150 on 1 February between 100 on 1 January and 200 on 1 March, and
  150 × 1.50 for the priced case. Values between entries are
  interpolated linearly by day (Values between entries), which is also
  the only reading under which a straight segment on the chart's time
  axis is exact. By day, 150 is the value at the span's midpoint, 31
  January in a leap year, and 1 February 2026 reads 152.542372881356.
  The suite asserts the midpoint. The criterion's date or its figure
  needs restating, and `net-worth-view` is not marked verified until
  it is.
- **engineer**: `features/record-rate.md`, Saving an edited recording,
  and its criteria on a save of one quantity and two rates, describe
  one save spanning quantities, rates and deletions. `ui/update-values.md`
  and the Sweep artboard give each row its own control and the rate
  lines their own save, so no screen issues such a save. The write
  order and the failure handling are asserted on the save function the
  rate-line save runs through. Either a reopened recording saves as one
  act with one control, or the criteria are restated per control.
- **engineer**: `ui/snapshot-entry.md`, The prices line, says a figure
  added at a date that already holds a recording looks nothing up.
  `features/record-rate.md`, The refresh, says adding a value for a
  holding skipped at a past date ensures that date's prices and can fill
  a symbol that had none. The two differ only when that date lacks a
  price for some unit. The sweep follows `record-rate.md` and the form
  follows `snapshot-entry.md`.
- **engineer**: `features/record-snapshot.md`, Creating and reopening
  are distinct acts, says picking a date that already holds records in
  New recording opens it for editing. `ui/dashboard.md` and
  `ui/recording-detail.md` open that recording's own screen, which is
  for looking, with editing one Update away. Built as the screens say.
  No request and no create are asserted either way.
- **engineer**: `ui/update-values.md`, States, Closing with changes
  unsaved: the screen says so and names them. Built as a notice on the
  screen that replaced the sweep, naming each holding and unit left
  typed. The other reading is a confirmation that stops the navigation
  until the person chooses to leave.
- **engineer**: `ui/update-values.md` gives copy for a symbol with no
  provider yet and for an outage, and none for these lines, which carry
  wording written by the engineer: a free-text unit ("Nobody publishes
  a price for m2. This one is yours to set."), a unit being recorded
  with no price at all ("What is 1 PAINT worth in CHF? Nothing prices
  PAINT yet. The figure records either way, and until a price exists
  the holding is listed as not priced."), and an empty line on a
  reopened recording ("No rate was recorded for XAU-ozt on this
  date."). The outage copy says "Nothing will be recorded for it
  today" on a backdated sweep too.
- **engineer**: `ui/update-values.md`, Changing or clearing a rate says
  what it moves, counts the holdings a price moves "on that date". The
  count is every holding measured in the unit, archived and never
  valued included, following `features/record-rate.md` (the client
  holds every `account` record). A holding with no quantity at that
  date does not move on it.
- **engineer**: `ui/dashboard.md`, States, Loading, asks for skeleton
  blocks while records decrypt. Decryption runs inside the unlock
  card's working state (`ui/unlock.md`), and the dashboard is drawn only
  once the total is final, so no skeleton is ever shown.
