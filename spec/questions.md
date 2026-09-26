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
