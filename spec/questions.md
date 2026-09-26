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

- **engineer**: `features/login.md`, Acceptance criteria, has
  criteria the suite does not yet assert, each a test to write rather
  than a behaviour to change:
  - exceeding the per-account attempt limit locks the account, with
    the same response shape for a nonexistent account.
  - the login request body carries nothing derived from the Master
    Key, and the password appears in no request, observed on the wire
    in the browser.
  - a wrong password and an unknown username produce identical
    client-visible errors on the sign-in card.
  - the derivation compared by code path across both kinds, where
    `tests/client/run.mjs` compares only the output of one call.
  - an administrator's stored verifier is a hash over the HKDF Auth
    Key and not over the raw Argon2id output.
  - a KDF upgrade leaves the DEK unchanged, proven by decrypting a
    record written before it, and raising the server's default memory
    parameter and signing in leaves every record decryptable. The
    server tests upgrade with random bytes, which proves the rows
    change but not that the vault still opens.
  - an upgrade answered with Server Error leaves the caller signed in
    and able to sign in again at the old parameters.
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
