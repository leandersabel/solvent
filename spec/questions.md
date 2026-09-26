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
dropped from both files. `product/login.md`, What must be true, also
tells the client that such a password is "reported to the operator as
an anomaly rather than shown to you", so dropping the log changes a
product statement as well, which is the product owner's to change.

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
