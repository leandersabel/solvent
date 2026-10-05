# Login

One sign-in screen at one address opens a vault for a vault owner and
signs an administrator in to the admin area. The password never leaves
the browser: it derives the key that makes the vault readable.

## What the client gets

You type your password, wait a moment, and your holdings, figures and
history appear. The password is not checked against something the
server knows. It makes the vault readable, so a wrong password produces
a key that opens nothing.

- **One screen for everything** (Unlock): signing in, unlocking again,
  and signing in to an administrator account, which opens nothing
  (`admin-invites.md`). A username belongs to exactly one account, so it
  decides the kind, and somebody holding both holds two usernames. A separate address
  for administrators would be one more thing to know and would hide
  nothing, and one screen means a probe cannot tell the kinds apart by
  where a name was accepted. The cost is that the screen behaves
  differently after a correct password without hinting at it before.
- **The wait** takes about a sixth of a second on a computer and a
  little under two seconds on a phone or tablet, whose browsers run this
  work much more slowly. A strength that kept a computer at a fraction
  of a second would leave a phone waiting eight to ten seconds at every
  unlock, and two seconds costs roughly one character of password
  strength against a stolen copy of the data (architecture.md, Key
  management). Solvent raises the strength on its own as phone browsers
  get faster, with no prompt and no extra wait (Stale-KDF upgrade).
  Registration uses the same setting (`register.md`), and an
  administrator pays the same wait (Rules).
- **Locking** takes every key and everything decrypted, because the
  threat is another household member at an unlocked machine with the
  browser's developer tools (Rules). It happens after a stretch of no
  activity you set (`account-settings.md`, Session and lock), with Lock
  (`app-shell.md`, The chrome), on a reload, and on a restore made
  elsewhere (`export-import.md`). Unlocking re-reads the vault, and that
  pause is by design. **Whatever you were typing survives a lock**,
  except after a restore made elsewhere. An administrator has nothing to
  lock and leaves only by signing out.
- **When it goes wrong**, the card never says whether a name exists or
  which kind it is. Too many attempts slow and then lock sign-in for a
  few minutes, for every username from that connection, administrators
  included. Trying again during a lock does not lengthen it. Whoever
  runs the instance sets the numbers, because a home-only install and
  one facing the internet need different limits. No IP address is kept
  readable and no device is recorded (architecture.md, Application
  hardening).

What it deliberately does not do:

- **No password recovery** (`register.md`), and no "forgot password"
  link. A dead link that implies recovery is worse than none.
- **No "remember me"** and no staying signed in across a browser
  restart. The vault is readable only while the tab is open and
  unlocked, so there is nowhere to remember it to.
- **No way to turn the idle lock off.** It is the last defense against
  somebody walking up to an unlocked screen.
- **No second factor.** The vault's protection is the password itself,
  so a second factor would guard the session, not the data. On an
  administrator account the password is all that stands in front of the
  power to delete every account, and that gap is a known one.
- **No easier unlock for a device short of memory.** A weaker
  derivation produces a key that opens nothing, and weakening it for
  everybody undoes the one protection between a stolen copy of the data
  and someone reading it. You close a tab and try again.

## Screens

### Unlock

The only place a password is typed outside registration and the
change-password forms, and the only place key derivation starts from
cold. Password managers
are supported on purpose: a manager-generated passphrase is the most
realistic protection a vault with no recovery can have.

Modes:

- **Signing in.** No session. Username and password.
- **Unlocking again**, a vault owner's mode only. The session is good
  and the in-memory keys are gone (idle timer, Lock, reload, or a
  restore in any other tab, window or device). The username is known.

#### Layout

The card outside the shell (`app-shell.md`, The chrome), max-width
420px, padding 32px. The wordmark, the card and the line beneath it
stack in the middle of the ground, centered both ways.

- **Username** field, when signing in. When unlocking again, the
  username is static ink-secondary text with a "Not you? Sign out" link
  beside it, which ends the session and offers the full card. A
  hidden text field holds the known username before the password, so a
  password manager pairs the password with that login. It is not
  `type=hidden`, which managers do not read as a username, and sign-in
  never reads it.
- **Password** field, `type=password`, with a show-and-hide toggle
  inside the field at its right end.
- Each field carries its label above it.
- Primary button **Unlock**, spanning the card's width at the foot.
- Beneath the card, 13px ink-muted: "Solvent cannot recover a lost
  password."

#### One card, both kinds

Until a correct password, the card is identical for both kinds in
fields, wording, layout, button, wait, failures and timing. Nothing
hints that a username is an administrator's or that an admin area
exists. Then a vault owner goes to the dashboard and an administrator to
the admin area (`admin-invites.md`, Admin).

#### The derivation wait

Argon2id runs in a Web Worker (architecture.md, Key management). It must
never look like a hang.

- On submit the button becomes a working state reading "Deriving your
  key", and the form goes quiet.
- A 13px line beneath: "This takes a moment by design. It is what makes
  your password hard to attack."
- The tab stays responsive throughout, to touch on a phone too.
- No spinner before the derivation starts.
- The copy is the same for both kinds, which the screen cannot tell
  apart.

#### States

- **Loading**: the card renders at once. Nothing to fetch, no skeleton.
- **Deriving**: as above. Left only by navigating away.
- **Wrong password or a username nobody has**: inline above the password
  field, critical text with an icon: "Invalid username or password."
  Identical wording, placement and speed for both cases and both kinds.
- **The vault would not open**: the Auth Key verified and the DEK
  unwrap failed. The same message, because it means corruption or
  tampering, not a typo. Nothing is logged: the server already answered
  OK and never sees the unwrap fail.
- **The attempt did not go through**: the salt lookup, the sign-in or
  the vault read got no answer, or a server error from Solvent or a
  proxy in front of it, or the derivation's worker did not load
  (architecture.md, Key management). In the same place as the wrong-password message,
  critical text with an icon:

  > That did not go through. Everything you typed is still here, so you
  > can try again.

  Both fields stay filled, and Unlock tries again. A correct password is
  never called wrong. The message is the same for every name and both
  kinds, because the salt lookup and the sign-in fail the same way for
  all of them, and the vault read comes only after the password
  verified.
- **Too many attempts**: "Too many attempts. Try again in a few
  minutes." Same shape and words whether or not the account exists.
- **This browser cannot run the encryption**: a hard stop, "This browser
  cannot run the encryption Solvent needs. There is no weaker fallback."
- **Not enough memory right now**: the browser can run the encryption
  and the allocation was refused anyway. "This device does not have
  enough memory available right now. Close some other tabs and try
  again." A **Try again** button derives again, because closing tabs can
  fix it. The copy names a moment, never a device class: it never says
  a phone, tablet or any device cannot open a vault, and never suggests
  moving to another one. No weaker unlock is offered (architecture.md,
  Threat model).
- **Already signed in**: a live session at `/login` is redirected to the
  root path, which resolves by kind (`app-shell.md`, The two surfaces).
  A vault owner is asked to unlock there if the keys are gone, never
  shown an empty vault. An administrator is asked for nothing.
- **The session ran out mid-action**: the card in its unlocking-again
  shape, username known. Submitting signs in again from cold, and typed
  input is kept unless the vault was replaced meanwhile (How it works,
  A vault replaced elsewhere).
- **Replaced elsewhere**: a restore in another tab, window or device
  replaced the vault while this page held the old one, unlocked or
  locked. The page closes the vault (How it works, A vault replaced
  elsewhere) and shows the card in its unlocking-again shape.
  - A Callout (design-system.md, Components) sits at the top of the
    card, above the username. It is a polite live region, so a screen
    reader hears why the card appeared.
  - When the page dropped typed input, the callout carries the critical
    icon and reads:

    > Your vault was replaced from a file in another tab, window or
    > device. What you had typed here and not saved is gone.

  - When it dropped none, it carries no icon and reads:

    > Your vault was replaced from a file in another tab, window or
    > device. Nothing you had typed here was lost.

  - Unlocking signs in on the live session and opens the restored vault
    on the dashboard, not the view the page was on, because that view
    can name a record the restore removed. The dashboard shows no notice
    of its own.
  - The callout stays until the card is left. A wrong password shows its
    error above the password field, beneath the callout.
- **Populated**: not applicable. Success navigates away.

#### Rules

- Autocomplete: `username` and `current-password`, in both modes.
- The page embeds the server's current default KDF envelope
  (architecture.md, Key management).
- Unlocking again returns to the previous view with unsaved input
  intact. Everything else on it is re-read and re-decrypted.
- **A dialog opened to fill in or choose something comes back** after
  unlocking, destructive or not, over the restored view with what was
  typed in it. A password field comes back empty, because a password
  never outlives a lock.
- **A confirmation that asks only yes or no does not come back**,
  because it holds nothing typed. Where one was open over a form, the
  form comes back alone, and the act waits for the form's own button.
- **A vault replaced since the page last held it keeps nothing**: no
  input, no view, no dialog, whether the page learned it before
  unlocking (Replaced elsewhere) or at unlock (the Replaced since last
  open notice, `net-worth-view.md`, Dashboard). Input typed against the
  old vault would otherwise be saved into the new one.

#### What it deliberately does not show

- Nothing about a restore beyond that it happened: not which tab, file
  or time. Solvent records no devices to name.
- Nothing about what typed input was lost, only whether any was. Naming
  it would mean keeping it.
- No count of attempts left. A counter would say more than the lockout
  message, which reads the same whether or not the account exists.

## How it works

### What it does

The browser derives the Master Key and Auth Key and sends only the Auth
Key (architecture.md, Key management). Every field this reads or writes belongs to the account's `password`
credential row (architecture.md, Credentials and vault key wrappers):
`params` holds the salt and envelope, `verifier` the Auth Key hash. The
`dek_wrappers` row keyed to that credential is the wrapper returned. The
`principals` row is touched for identity and `last_login_at` alone.
There is no other credential method.

### Flow

1. `POST /api/auth/salt` `{ username }` returns `{ salt, kdf }`, the
   credential's `params` and nothing else. A known account of either
   kind gets its real salt and envelope. An unknown one gets the decoy
   (architecture.md, Login enumeration) truncated to 16 bytes, plus the
   server's current default envelope. No field names, implies or derives
   the kind. It answers unauthenticated callers, which is why `params`
   carries nothing secret.
2. The client derives Master Key and Auth Key in a Web Worker, **both
   halves, always**, because it does not yet know whether it needs the
   Master Key (architecture.md, Administrator credentials).
3. `POST /api/auth/login` `{ username, authKey }`. On success it sets
   the session cookie, writes `last_login_at`, and returns
   `{ kind, kdfStale }`, plus `wrappedDek`, `dekNonce` and `vaultEpoch`
   for a vault owner only. The wrapper is the one of the credential just
   used, never a list (architecture.md, Key management). The wrapper and
   `vaultEpoch` are read inside the transaction that writes the
   session, so an import cannot land between them. **An unknown
   username still runs a full Argon2id verification** against a fixed
   decoy hash and discards the result. Without it the endpoint answers
   in microseconds for missing accounts and tens of milliseconds for
   real ones.
4. **A vault owner** unwraps the DEK. **A failed unwrap is an
   authentication failure** with the same error, and the client never
   continues with a dead key. **An administrator** discards the Master
   Key and lands in the admin area.
5. If `kdfStale` is true, the client runs the Stale-KDF upgrade.

`kind` is an explicit field, safe to return because it is read only
after verification. Inferring it from a missing `wrappedDek` would treat
a truncated response as an administrator login, the one wrong guess
that must not be cheap. The wrapper lookup happens after verification,
keyed on the credential id, so it is no timing signal.

### Stale-KDF upgrade

**This is the only path by which an account's KDF parameters are
raised** (architecture.md, Key management): the operator raises the
server's default envelope and every account follows on its owner's next
sign-in.

When the stored envelope is weaker than the default, the login response
sets `kdfStale: true` and carries the target envelope. **Both kinds run
it**, because both are attacked offline through `verifier`. After a
successful sign-in the client, without user interaction:

1. Generates a fresh 128-bit salt.
2. Re-derives Master Key' and Auth Key' from the in-memory password at
   the target parameters.
3. A vault owner re-wraps the existing DEK under Master Key'. An
   administrator skips this.
4. Sends `POST /api/auth/upgrade-kdf` `{ salt, kdf, authKey }`, plus
   `wrappedDek` and `dekNonce` for a vault owner, on the authenticated
   session. A new Auth Key that is not 32 bytes is a Bad Request that
   writes nothing (architecture.md, Key management). In one transaction
   the server replaces the `password`
   credential row (`params` and `verifier`) and, for a vault owner, that
   credential's one `dek_wrappers` row. Nothing else changes, because
   the DEK is the same key afterwards. A vault owner's request carries
   the epoch sign-in returned, compared after `BEGIN IMMEDIATE`, so an
   import landing between sign-in and upgrade is never overwritten by a
   wrapper around the old DEK.

The server discriminates on the session's principal kind, not on the
fields sent. A vault owner's request without a wrapper is a Bad Request,
and so is an administrator's with one. Letting the payload decide would
let a client skip re-wrapping a real vault and leave its wrapper under a
superseded Master Key.

If the upgrade fails, the session continues on the old parameters and
retries at the next sign-in, because an upgrade that could lock somebody
out would be worse than none. The one exception is a `vault-replaced`
Conflict, which closes the vault like any other.

### The session a sign-in issues

A successful `POST /api/auth/login` always issues a new random token in
the cookie. What it does to `sessions` rows depends on the session the
request carried:

- **A live session of the same account**: that row is updated in place
  with the new `token_hash`. Its `id` and `issued_at` stay, and the old
  token stops working at once.
- **No live session** (no cookie, a bad signature, a token matching no
  row, an expired row): a new row.
- **A live session of another account**: that row is deleted and a new
  one created, because one client holds one cookie and the old row
  would sit unreachable until expiry.

In every case the signing-in account's expired rows are deleted in the
same transaction. Live means not past the absolute expiry. A failed
login, rate-limited or locked out included, writes no session row,
leaves `last_login_at` as it was, and leaves the carried session
working.

**Starting a session writes `last_login_at`** to the server clock in the
same transaction, and nothing else writes it. A sign-in, an unlock and a
registration (`register.md`, Flow) all start a session this way, so the
column records the last time the account proved its password, and an
account that exists has one.

**There is no separate unlock endpoint.** An unlock calls this one on a
live session, because login is the one place that returns the wrapper,
runs the decoy verification and is rate limited. The branch on the
carried session runs only after the Auth Key verified. Updating the row
in place keeps locking out of the session list, and the token still
changes, so a token planted or captured before (session fixation) is
dead after.

**Unlocking does not move `issued_at`**, so the absolute expiry counts
from sign-in. Resetting it would make the limit sliding for anyone who
unlocks more often than every twelve hours. Unlocking does move
`last_login_at`, which no expiry reads.

### A vault replaced elsewhere

A restore closes the vault in every other page where it is open. This
is the page's half of the vault epoch (architecture.md, Vault epoch). It
binds every page that holds an epoch, the registration page after
registering included.

**A page learns its epoch was replaced** in one of four ways:

- **A `vault-replaced` Conflict** answering any request. The API module
  handles it before any caller sees the response, so no screen's own
  Conflict handling (the version reload) ever runs on it.
- **A message on `BroadcastChannel("solvent-vault")`**: the JSON object
  `{"replaced":"<epoch>"}`, the replaced epoch and nothing else (no key,
  no new epoch, nothing decrypted). A page ignores any other message,
  one naming an epoch it does not hold, and every message while it
  holds no epoch, so a message about an older epoch never closes a page
  on the new one.
- **Coming back into view.** When an unlocked page's `visibilitychange`
  reports `visible`, it sends one `GET /api/records?type=profile`
  through the API module and discards the body. This is how a page in
  another browser or device notices before it is used.
- **Signing in to another epoch**: the `vaultEpoch` a sign-in returns
  differs from the one held. That is an unlock on a live session, or a
  sign-in from the session-ran-out card after the session ended for its
  own reason (expiry, log out everywhere, a password change).

**The page keeps its epoch in memory until it signs in again**, across a
lock and across its session ending, because the next sign-in compares
it. Never in localStorage or sessionStorage. Signing out discards it and
a reload has none, so neither compares anything.

**A page that learns by Conflict or at sign-in posts
`{"replaced":"<the epoch it held>"}`** on the channel before discarding
it, so every other page of this browser that holds it closes at once. A
page that learned by message posts nothing, because every page on the
channel received the same one. The channel reaches the pages of one
browser profile and storage partition. A private window or another
profile learns as another device does.

**What it drops.** Whichever way it learned, the page discards
everything a lock keeps: unsaved form input and every dialog that would
come back after an unlock (Unlock, Rules). Before discarding, it notes
whether there was any, because the copy differs. A kept dialog counts
even with nothing typed in it. A password field never counts.

**Learning by Conflict or message.** The page:

1. discards the Master Key, the DEK and every decrypted value, as the
   idle lock does,
2. discards what a lock keeps and closes every dialog,
3. discards the epoch it held, so the unlock that follows compares
   nothing,
4. draws the Unlock card in its Replaced elsewhere state, in the wording
   for whether step 2 dropped anything.

A locked page holding the named epoch does the same. A request in flight
when the vault closes draws nothing when it answers.

**Learning at sign-in.** The page drops what a lock kept, opens the
dashboard rather than the view it was on, and shows the Replaced since
last open notice (`net-worth-view.md`, Dashboard) in the wording for
whether it dropped anything. This is how a page locked through the
restore finds it, and a page whose session ended. A page on another
device that is never used again closes no later than its idle lock, and
signing in drops what that lock kept.

**Another device meets Replaced elsewhere, not the session-ran-out
card**, because import revokes no session (architecture.md, Vault
epoch). It meets that card only when its session ended for its own
reason, and then learns at sign-in.

### Rules

- **The sign-in wait is the same for both kinds.** Skipping the
  derivation for an administrator is the obvious optimization. **Do
  not.** It would mean knowing the kind before authenticating, which
  only `/api/auth/salt` could tell, to anyone, and the screen would
  become a stopwatch that reads out administrators' usernames. The
  channel is wall-clock time at the keyboard, so server-side
  constant-time work does not close it. **What an administrator saves is
  the vault**: no DEK unwrap, no record fetch, no decryption, everything
  after verification and nothing before it. The same rule binds
  registration (`register.md`).
- **Kind is invisible until the credential verifies** (architecture.md,
  Login enumeration). Flow steps 1 and 2 are byte-identical for a vault
  owner, an administrator and an unknown username, and step 2 takes the
  same wall-clock time for all three. The server-side Argon2id, the
  rate-limit keying and the lockout response are also the same
  operations in the same order for both kinds. A credential method
  added later inherits this: its pre-authentication step is kind-blind
  and carries its own decoy.
- **Residual enumeration leak, accepted.** A decoy always carries the
  current default envelope, while a real account can carry a stale one,
  so an account not yet upgraded is distinguishable from a decoy.
  Closing it would mean the server keeping every parameter set it ever
  used, forever, for a threat a small invited household does not face,
  and registration already accepts enumeration (`register.md`). No test
  asserts a stale-envelope account is indistinguishable, because it is
  not. **It leaks existence, never
  kind**: both kinds carry an envelope, the same flow upgrades both, and
  administrators are never registered at a different envelope.
- The Auth Key is stored hashed with Argon2id at modest server-side
  cost (starting point 64 MiB, 2 iterations). The Auth Key is already
  high-entropy, so this is defense in depth. Comparison is
  constant-time.
- **Idle lock, for a vault owner**: after the configured idle period
  (`account-settings.md`, Session and lock) the client discards the
  Master Key, the DEK **and every decrypted value derived from them**:
  the in-memory model, rendered figures, chart series and any cached
  plaintext. Dropping the keys alone would leave the lock cosmetic
  against someone with devtools. Unlocking signs in on the live session
  and **re-decrypts the vault from scratch**, so the reload is by
  design, not a missed cache.
  - **One named exception: unsaved input the user typed** survives
    (Unlock, Rules). It is what the user is about to commit, not vault
    content read back. The same rule covers Lock (`app-shell.md`, The
    chrome), `pagehide` (architecture.md, Application hardening) and a
    session expiring mid-request. A replaced vault is the one lock it
    does not cover.
- **No idle rule for an administrator** (`account-settings.md`, Session
  and lock). Nothing is decrypted, so a lock takes nothing away.
- **Session lifetime**: a session expires 12 hours after its
  `issued_at`, absolute, not sliding, for both kinds. For an
  administrator it is the only bound besides signing out.
- A page refresh discards in-memory keys and requires the password.

## Edge cases

- **Unknown username or wrong password**: both derive fine, in the same
  time, and fail at Flow step 3.
- **Rate limits, locks and the concurrency cap** run as architecture.md,
  Application hardening, states. So a correct password during a lock
  gets Too Many Requests with no verification run, retrying never
  lengthens a lock, and an administrator at an address another
  username's guesses locked waits for the lock to end.
- **A vault owner whose credential verifies but who has no wrapper**:
  Unauthorized, counted as no failure, because the password was right.
- **A login response without `kind`**: a failed login, never a default
  to either kind. So is a vault owner's response without `vaultEpoch`,
  because a page without one could send no vault request.
- **A restore between sign-in and the stale-KDF upgrade**: the upgrade
  answers `vault-replaced`, writes nothing, and the page closes the
  vault.
- **Solvent cannot be reached mid-sign-in**: whichever request got no
  answer or a server error, the card reads as the attempt did not go
  through, never as a wrong password, and no keys stay held.
- **Clock skew or a session expired mid-request**: Unauthorized, the
  status alone with no code in the body (architecture.md, Status
  codes), and the card's session-ran-out state.

## Acceptance criteria

1. A valid vault owner username and password sign in, and the client
   holds a working DEK proven by decrypting the profile record, so the
   real figures appear. Test:
   `tests/test_auth.py::test_a_vault_owner_login_returns_the_one_wrapper_and_the_kind`,
   `tests/browser/parts/unlock.mjs`.
2. A valid administrator username and password sign in, the response
   carries `kind: administrator` and no `wrappedDek`, `dekNonce` or
   `vaultEpoch`, and the session lands in the admin area with nothing
   decrypted and no dashboard. Test:
   `tests/test_auth.py::test_an_administrator_login_carries_no_wrapper`,
   `tests/browser/parts/unlock.mjs`.
3. A vault owner's username and password never reach the admin area,
   however submitted. Test:
   `tests/test_admin.py::test_a_vault_owner_gets_not_found_from_every_admin_route`.
4. A vault owner's login response carries `vaultEpoch` equal to the
   account's `vault_epochs` row, and after an import the next sign-in's
   equals the epoch the import returned. Test:
   `tests/test_vault_epoch.py::test_a_vault_owner_login_carries_the_epoch_and_an_administrators_none`,
   `tests/test_vault_epoch.py::test_the_next_sign_in_after_an_import_carries_the_new_epoch`.
5. The login body carries the Auth Key and nothing derived from the
   Master Key, and the password appears in no request on any attempt.
   Test: no test.
6. The session cookie carries no key material and is `HttpOnly`,
   `Secure`, `SameSite=Lax`. Test:
   `tests/test_auth.py::test_a_login_cookie_carries_its_flags_and_no_key_material`.
7. (blind) `/api/auth/salt` for an administrator, a vault owner and an
   unknown username, all at current KDF parameters, is
   indistinguishable three ways in body shape, full field set, status
   and timing, so an added field fails it. Test:
   `tests/test_auth.py::test_the_salt_response_is_identically_shaped_for_both_kinds_and_a_stranger`,
   `tests/test_timing.py::test_the_salt_takes_the_same_time_for_either_kind_and_a_stranger`.
8. The decoy salt for a username is stable across calls. Test:
   `tests/test_auth.py::test_the_decoy_salt_for_a_username_is_stable_across_calls`.
9. No `/api/auth/salt` response names, implies or permits deriving the
   kind, asserted against the full response shape. Test:
   `tests/test_auth.py::test_no_field_of_the_salt_response_names_or_implies_a_kind`.
10. `/api/auth/login` with a wrong Auth Key against an administrator, a
    vault owner and an unknown username gives byte-identical responses
    and indistinguishable timing. Test:
    `tests/test_auth.py::test_a_wrong_auth_key_against_either_kind_and_a_stranger_is_byte_identical`,
    `tests/test_timing.py::test_a_wrong_login_takes_the_same_time_for_either_kind_and_a_stranger`.
11. `/api/auth/login` for an unknown username takes indistinguishable
    time from a known one with a wrong Auth Key, with the decoy-hash
    verification in place. Test:
    `tests/test_timing.py::test_a_wrong_login_takes_the_same_time_for_either_kind_and_a_stranger`.
12. (blind) The client's derivation takes the same code path for both
    kinds and an unknown username, compared as the path taken, not only
    the output. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
13. (blind) The wall-clock time from submitting the card to the Auth Key
    leaving the browser is indistinguishable for an administrator, a
    vault owner and an unknown username, measured in the browser. Test:
    `tests/browser/parts/unlock-timing.mjs`.
14. (blind) An administrator's stored `verifier` is an Argon2id hash
    over the HKDF Auth Key, not the raw Argon2id output, shown by
    deriving both and checking which verifies. Test:
    `tests/test_browser.py::test_the_workflows_hold_in_a_browser`.
15. A wrong password and an unknown username produce the same message on
    the card, for either kind. Test: `tests/browser/parts/unlock.mjs`.
16. A correct Auth Key whose DEK unwrap fails is a failed sign-in with
    the same message and no keys held. Test:
    `tests/browser/parts/unlock.mjs`.
17. A salt lookup or sign-in that gets no answer or a server error, for
    a vault owner, an administrator and an unknown username, and a vault
    read that gets a server error after a correct password, each show
    "That did not go through. Everything you typed is still here, so you
    can try again." with both fields still filled, and the vault read
    leaves no keys held. Test: `tests/browser/parts/unlock.mjs`,
    `tests/browser/parts/unlock-review-unreachable.mjs`.
18. A vault owner below the default envelope is upgraded at sign-in:
    salt, envelope, Auth Key hash and wrapped DEK change, and the DEK is
    unchanged, proven by decrypting a record written before. Test:
    `tests/test_auth.py::test_the_upgrade_replaces_the_credential_and_its_one_wrapper`,
    `tests/browser/parts/unlock.mjs`.
19. An administrator below the default envelope is upgraded the same
    way, no `dek_wrappers` row is created, and the password still signs
    in. Test:
    `tests/test_auth.py::test_an_administrator_upgrade_creates_no_wrapper`.
20. (blind) The upgrade writes the `password` credential row and, for a
    vault owner, its wrapper, and nothing else, comparing every other
    row of `principals`, `credentials` and `dek_wrappers`. Test:
    `tests/test_auth.py::test_the_upgrade_replaces_the_credential_and_its_one_wrapper`.
21. `POST /api/auth/upgrade-kdf` with a wrapper from an administrator
    session, or without one from a vault owner session, is a Bad Request
    and writes nothing. Test:
    `tests/test_auth.py::test_the_server_discriminates_on_kind_not_on_which_fields_arrived`.
22. Raising the server's default memory parameter and signing in leaves
    the vault at the new value with every record decryptable. Test:
    `tests/test_auth.py::test_raising_the_server_default_upgrades_an_account_at_the_old_one`.
23. If `/api/auth/upgrade-kdf` answers Server Error, the caller stays
    signed in and signs in afterwards on the old parameters. Test:
    `tests/browser/parts/unlock.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
24. `POST /api/auth/upgrade-kdf` from a vault owner carrying the epoch
    from before an import answers Conflict
    `{"refused":"vault-replaced"}` and leaves `credentials` and
    `dek_wrappers` byte-identical. Test:
    `tests/test_vault_epoch.py::test_the_stale_kdf_upgrade_with_a_replaced_epoch_changes_nothing`.
25. `POST /api/auth/login` returns at most one wrapper and no field
    naming, counting or describing another credential. Test:
    `tests/test_auth.py::test_the_login_body_carries_no_field_describing_another_credential`.
26. (blind) From one client: sign in, sign in again, fail once, sign in
    again, each carrying the previous cookie. The account has exactly
    one `sessions` row with the first `id` and `issued_at`, every
    replaced cookie answers Unauthorized, and the cookie carried into
    the failure still worked after it. Rows are compared, not cookies
    alone. Test:
    `tests/test_session.py::test_repeated_sign_ins_from_one_client_keep_one_row_and_a_failed_one_changes_nothing`.
27. A sign-in carrying another account's live session deletes that row,
    and the old cookie answers Unauthorized. Test:
    `tests/test_session.py::test_a_sign_in_over_another_accounts_live_session_replaces_that_row`.
28. (blind) A sign-in with no cookie creates a new row and leaves the
    account's other live rows untouched. Test:
    `tests/test_session.py::test_a_sign_in_with_no_cookie_leaves_the_accounts_other_live_rows_alone`.
29. (blind) A sign-in deletes the signing-in account's expired rows, and
    only those. Test:
    `tests/test_session.py::test_a_sign_in_deletes_the_signing_in_accounts_expired_rows_and_only_those`.
30. (blind) Signing in, then unlocking 11 hours later, leaves a session
    that answers Unauthorized 12 hours after the first sign-in. Test:
    `tests/test_session.py::test_unlocking_does_not_move_issued_at_so_the_expiry_counts_from_sign_in`.
31. Everybody is signed out 12 hours after signing in, however busy.
    Test:
    `tests/test_session.py::test_a_session_past_the_absolute_lifetime_is_refused`,
    `tests/test_session.py::test_the_absolute_expiry_binds_an_administrator_the_same_way`.
32. (blind) A sign-in sets `last_login_at` to the request time, and so
    does an unlock on a live session, while `issued_at` stays, for both
    kinds with the clock stubbed. Test:
    `tests/test_last_login.py::test_a_sign_in_and_an_unlock_set_last_login_at_and_an_unlock_leaves_issued_at`.
33. (blind) A wrong Auth Key, a rate-limited attempt and a locked-out
    attempt each leave `last_login_at` unchanged. Test:
    `tests/test_last_login.py::test_a_wrong_auth_key_leaves_last_login_at`,
    `tests/test_last_login.py::test_a_rate_limited_or_locked_out_attempt_leaves_last_login_at`.
34. (blind) The per-username throttle and, separately, the per-username
    lock refuse that username with Too Many Requests on both endpoints,
    body and headers byte-identical to the refusal for a nonexistent
    username over the same limit. Test:
    `tests/test_auth.py::test_exceeding_the_account_limit_locks_it_the_same_way_for_a_stranger`,
    `tests/test_attempts.py::test_every_refusal_is_byte_identical_to_the_one_for_a_username_nobody_has`.
35. (blind) With per-username limits out of reach and the clock stubbed,
    the configured failures from one address spread over unknown
    usernames lock the address: the next salt fetch and sign-in for an
    administrator, a vault owner and an unknown username each answer Too
    Many Requests byte-identically, and a different address signs the
    administrator in. Test:
    `tests/test_attempts.py::test_an_address_lock_refuses_every_username_and_spares_other_addresses`.
36. (blind) The lock ends on time despite retries. Trip an address lock,
    retry every minute with a salt fetch, a wrong Auth Key and the
    administrator's correct Auth Key, each Too Many Requests, with the
    `attempts` row count unchanged. At the lock's length plus one second
    the correct Auth Key signs in. The same holds for a per-username
    lock. Test:
    `tests/test_attempts.py::test_an_administrator_signs_in_when_the_lock_ends_despite_retries_during_it`,
    `tests/test_attempts.py::test_a_username_lock_ends_on_time_despite_retries`.
37. (blind) A request refused by any limit, on either endpoint, leaves
    `attempts` row for row as it was, and so do a salt fetch that answers
    OK, a Bad Request and a sign-in the concurrency cap turned away.
    Test:
    `tests/test_attempts.py::test_a_request_that_is_not_a_failure_or_is_refused_leaves_the_table_as_it_was`.
38. A wrong Auth Key, for a real or unknown username, writes one
    `failure` row in the username's bucket and one in the address's.
    Test:
    `tests/test_attempts.py::test_a_failure_writes_one_row_per_bucket_and_a_success_clears_only_the_username`.
39. (blind) A correct Auth Key deletes the username's `login:` and
    `login-lock:` rows and leaves the address's. Test:
    `tests/test_attempts.py::test_a_success_deletes_the_username_lock_row_and_leaves_the_address_rows`.
40. (blind) The failure that trips a per-username lock writes exactly
    one `login-lock:` row, and one that trips an address lock exactly
    one `address-lock:` row, each in the failure's own transaction. A
    failure that trips neither writes neither. Test:
    `tests/test_attempts.py::test_a_failure_writes_a_lock_row_only_when_it_trips_the_lock`.
41. (blind) The username lock lasts its full length however its
    failures are spread: at the defaults, with address limits out of
    reach, 10 wrong Auth Keys at 0:00, 9 at 15:01 and the 20th at 59:00
    give Too Many Requests at 60:01 and 74:00 and a sign-in at 74:01.
    Test:
    `tests/test_attempts.py::test_a_username_lock_runs_its_full_length_on_the_schedule_that_ages_failures_out`.
42. A lock covers every username from that connection, a name nobody
    has tried yet included, until it ends. Test:
    `tests/test_attempts.py::test_an_address_lock_refuses_every_username_and_spares_other_addresses`.
43. (blind) No plaintext address is stored. After failures from
    `203.0.113.7` and `2001:db8:1:2::5`, no table value, no byte of the
    database file and no captured log line contains either address or
    the `/64` network. Test:
    `tests/test_attempts.py::test_no_plaintext_address_is_kept_in_a_table_the_file_or_a_log`.
44. (blind) Each `address:` bucket key equals the value the test
    computes from architecture.md, Rate limiting, with the test's
    `SECRET_KEY`, and changes when `SECRET_KEY` does. Test:
    `tests/test_attempts.py::test_the_address_key_is_keyed_canonical_and_follows_the_secret`.
45. The HKDF function returns RFC 5869 Test Case 1's OKM. Test:
    `tests/test_attempts.py::test_hkdf_returns_rfc_5869_test_case_1`.
46. `2001:db8:1:2::5` and `::6` share one address key,
    `2001:db8:1:3::5` has another, `::ffff:203.0.113.7` shares
    `203.0.113.7`'s, and two unparseable addresses share one. Test:
    `tests/test_attempts.py::test_the_address_key_is_keyed_canonical_and_follows_the_secret`.
47. (blind) With `TRUSTED_PROXY_HOPS` 0, failures from one peer with a
    different `X-Forwarded-For` each time lock that peer, and the first
    such request logs `config.proxy_header_ignored` once. With it 1,
    requests whose last entries differ count apart, and a client-written
    entry left of the proxy's changes nothing. Test:
    `tests/test_attempts.py::test_without_trusted_proxies_a_forwarded_header_changes_nothing_and_is_logged_once`,
    `tests/test_attempts.py::test_with_one_trusted_proxy_the_last_forwarded_entry_is_the_client`.
48. (blind) Tripping a lock logs exactly one `auth.lockout` line and the
    requests it refuses none. The address line has no address and no
    address key. A username with a newline and a quote logs as one line
    holding its JSON string. Test:
    `tests/test_attempts.py::test_a_lock_logs_one_line_when_it_trips_and_the_requests_it_refuses_none`,
    `tests/test_attempts.py::test_an_address_lock_logs_one_line_with_no_address`.
49. The card shows "Too many attempts. Try again in a few minutes." past
    the limit. Test: `tests/browser/parts/unlock.mjs`.
50. A vault opens on a phone and a tablet in a little under two seconds,
    showing the working state and staying responsive to touch
    throughout. Test: no test.
51. The card shows "Deriving your key" and goes quiet while the key is
    derived. Test: `tests/browser/parts/unlock.mjs`.
52. A browser that cannot run the encryption gets a hard stop with no
    fallback. Not enough memory offers Try again, which derives again.
    Test: `tests/browser/parts/unlock.mjs`.
53. (blind) After the idle period, reading vault data prompts for
    re-unlock, the keys are gone, and no decrypted holding name, value
    or snapshot is reachable, asserted against the in-memory model, not
    only the key handles. Unsaved form input is the one thing left.
    Test: `tests/browser/parts/unlock-idle.mjs`.
54. (blind) Re-unlocking after a lock refetches and re-decrypts the
    vault rather than restoring a model kept across the lock. Test:
    `tests/browser/parts/unlock-idle.mjs`.
55. What was typed in an open form is there after unlocking, and the
    person returns to the view the lock found. Test:
    `tests/browser/parts/unlock-idle.mjs`.
56. A dialog to fill in or choose something comes back after unlocking
    with what was typed or chosen in it, destructive or not, a
    yes-or-no confirmation does not, and no password field is refilled.
    The Archive or delete dialog comes back with Delete permanently
    chosen and the typed name, its confirm enabled only by the whole
    name. Test: `tests/browser/parts/unlock-lock.mjs`,
    `tests/browser/parts/unlock-idle.mjs`,
    `tests/browser/parts/unlock-review-dialogs.mjs`.
57. Lock locks at once with no confirmation, keeps the server session,
    and unlocking needs only the password. Test:
    `tests/browser/parts/unlock.mjs`.
58. A refresh asks for the password again. Test:
    `tests/browser/parts/unlock.mjs`.
59. (blind) No key material is written to `localStorage` or
    `sessionStorage` at any step, upgrade, lock, unlock and restore
    included. Test: `tests/browser/parts/unlock.mjs`.
60. (blind) No vault epoch is written to `localStorage` or
    `sessionStorage` at any step. An epoch kept in storage to survive a
    lock passes every functional test. Test: no test.
61. A signed-in vault owner at the sign-in address goes to the dashboard
    and is asked only for the password. A signed-in administrator goes to
    the admin area. Test:
    `tests/test_auth.py::test_an_already_authenticated_caller_at_login_is_sent_to_the_root`,
    `tests/browser/parts/unlock.mjs`.
62. A session that ran out mid-action shows the card with the username
    known, and signing in returns to the form with what was typed. Test:
    `tests/browser/parts/unlock.mjs`.
63. (blind) Two pages, one browser. Pages A and B are unlocked on one
    vault and B has a holding form open with a name typed. A restores a
    file. Before B sends any request, B holds no key, no decrypted name
    or figure and no typed name, every dialog is closed, and its card is
    in Replaced elsewhere for dropped input. A stays open on the
    restored vault. Unlocking B opens the dashboard with the restored
    figures, no notice and no unreadable record. Test:
    `tests/browser/parts/export-import.mjs`.
64. (blind) The same with B showing only the dashboard and nothing kept
    puts B's card in the wording for nothing dropped. A kept dialog with
    nothing typed counts as dropped. Test:
    `tests/browser/parts/export-import.mjs`,
    `tests/browser/parts/unlock-replaced.mjs`.
65. (blind) With B's channel stubbed so no message arrives, B's save
    answers Conflict `{"refused":"vault-replaced"}`, B shows Replaced
    elsewhere and posts `{"replaced":"<its epoch>"}`, the records are
    exactly the restored set, and the Conflict never reaches the holding
    form's version reload. Test:
    `tests/browser/parts/export-import.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
66. (blind) A page in a second browser context, with its own session,
    stays drawn and sends nothing while hidden during a restore. Made
    visible, it sends one `GET /api/records?type=profile` and nothing
    else and shows Replaced elsewhere. Its session row still exists.
    Test: `tests/browser/parts/export-import.mjs`.
67. (blind) A page idle-locked in a second context through a restore
    shows, on unlocking, the Replaced since last open notice: for
    dropped input with a form's input held, the same with a kept dialog
    and nothing typed, and for nothing dropped with nothing kept. In
    each case it posted `{"replaced":"<the epoch it held>"}`. Test:
    `tests/browser/parts/export-import.mjs`.
68. (blind) A page in a second context holding typed input when the
    first logs out everywhere, signs in and restores: its next request
    answers Unauthorized and the card shows the session-ran-out state
    with the input held. Signing in drops the input, opens the dashboard
    and shows Replaced since last open for dropped input. With no restore
    in between, signing in returns to the view with the input and no
    notice. Test: `tests/browser/parts/export-import.mjs`,
    `tests/browser/parts/unlock.mjs`.
69. (blind) Signing out and in again after a restore shows no Replaced
    since last open notice. Test: `tests/browser/parts/export-import.mjs`.
70. (blind) Reloading and signing in again after a restore shows no
    Replaced since last open notice. Test: no test.
71. (blind) A page ignores a channel message naming an epoch it does not
    hold, a message of any other shape, and every message while it holds
    no epoch. Every message a page posts has `replaced` as its only key,
    holding the replaced epoch. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`.
72. (blind) A page that learned by Conflict or at sign-in posts the
    epoch it held, and a page that learned by message posts nothing.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
73. Unlocking again, the card holds one hidden text field with
    `autocomplete="username"` and the known username, before the
    password field, and no username field a person can type in. With
    another name written into it, unlocking still signs in as the known
    username. Test: `tests/browser/parts/unlock.mjs`,
    `tests/browser/parts/unlock-review-username.mjs`.
74. A sign-in from a fresh page whose derivation's worker script gets no
    answer shows "That did not go through. Everything you typed is
    still here, so you can try again." with both fields still filled,
    and Unlock in the same page then opens the vault. Test:
    `tests/browser/parts/unlock.mjs`,
    `tests/browser/parts/unlock-review-worker.mjs`.
79. (blind) A `POST /api/auth/upgrade-kdf` whose new Auth Key is 3, 31
    or 33 bytes, or not base64, is a Bad Request, for either kind, and
    leaves every row as it was. Test:
    `tests/test_auth.py::test_a_rotation_to_an_auth_key_that_is_not_thirty_two_bytes_is_refused`.
