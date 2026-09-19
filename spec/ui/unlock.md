# Unlock

## Purpose

The one sign-in screen, at one address, for both kinds of account. It
is the only place a password is typed outside registration and the
change-password forms, and the only place key derivation starts from
cold.

Two modes:

- **Signing in.** No session. Username and password.
- **Unlocking again.** A vault owner's session is still good and the
  in-memory keys are gone, discarded by the idle timer, the lock
  button, or a page reload. The username is already known, so only the
  password is asked for.

The username decides which kind of account is being signed in to, and
the person never says which they meant. A username belongs to exactly
one account on the instance, so there is nothing to disambiguate.

Exercises: `spec/features/login.md`, and the idle-lock half of
`spec/features/account-settings.md`.

## Layout

A centered card, max-width 420px, on the warm ground. Nothing else on
the page, no navigation and no marketing.

- Wordmark, petrol-800.
- **Username** field, when signing in. When unlocking again, the
  username is static ink-secondary text with a "Not you? Sign out"
  link beside it.
- **Password** field, `type=password`, with a show-and-hide toggle.
- Primary button: **Unlock**.
- Beneath the card, 13px ink-muted: "Solvent cannot recover a lost
  password."

No "remember me" and no "forgot password" link. Neither exists, and a
dead link that implies recovery is worse than its absence.

## One card, both kinds

**The card looks and behaves identically for both kinds of account
until a correct password has been given.** Same fields, same wording,
same button, same wait, same failures. Nothing on it announces, before
a correct password has been typed, that a username belongs to an
administrator, and nothing anywhere on the page hints that an admin
area exists.

Anybody can put any name into that field. What comes back must not tell
them which kind of account, if any, wears it.

Only after a correct password does the screen do anything different,
and then it does one thing: a vault owner is taken to their dashboard,
an administrator to the admin area (`ui/admin.md`). Nothing is
decrypted for an administrator, because there is nothing behind that
account to decrypt.

**Unlocking again is a vault owner's mode only.** An administrator
holds nothing decrypted, so there is nothing a lock could take away and
nothing to re-open. The only way out of an administrator session is
Sign out.

## The derivation wait

Turning a password into a key is slow on purpose. Argon2id runs in a
Web Worker and takes **about a sixth of a second on a computer, and a
little under two seconds on a phone or tablet**, where the browser runs
this kind of work much more slowly on otherwise comparable hardware
(`architecture.md`, Key management). This is the screen's defining
moment and it must never look like a hang.

- On submit the button becomes a working state reading "Deriving your
  key", and the form goes quiet.
- A 13px line beneath: "This takes a moment by design. It is what makes
  your password hard to attack."
- The tab stays responsive throughout, and on a phone it stays
  responsive to touch, so the extra second or two reads as the screen
  working rather than the screen having frozen.
- No spinner before the derivation actually starts.

**An administrator pays the same wait, and there is no fast path for
them.** It is not an oversight to be optimized away later. The
derivation happens in the browser before anything is sent, so the only
way to skip it would be for the page to know the name belongs to an
administrator before anything has been proved. Anyone could then time
this screen and read off which usernames administer the instance
without guessing a single password. So an administrator builds a key
and throws it away, and the screen gives nothing away.

The working copy is the same words for both kinds, because at the
moment it is shown the screen does not know which it is.

## States

- **Loading**: the card renders immediately. There is nothing to fetch
  and no skeleton.
- **Deriving**: as above. It can be left only by navigating away.
- **Error, wrong password or a username nobody has**: inline above the
  password field, critical text with an icon: "Invalid username or
  password." Identical wording, identical placement, and identical
  speed for both cases, and identical again whichever kind of account
  the name belongs to. The screen must not distinguish them, including
  by how fast it gives up.
- **Error, the vault would not open**: the same generic message. This
  is logged server-side as an anomaly and never surfaced to the person,
  because it means corruption or tampering rather than a typo.
- **Error, too many attempts**: "Too many attempts. Try again in a few
  minutes." Same shape and same words whether or not the account
  exists.
- **Error, this browser cannot run the encryption**: a hard stop with a
  plain explanation. No fallback is offered, because none exists.
- **Error, not enough memory right now**: a separate state from the one
  above. The browser can run the encryption, and the allocation was
  refused anyway. The copy names the moment: "This device does not have
  enough memory available right now. Close some other tabs and try
  again." A **Try again** button, because closing tabs genuinely can
  fix it.
  - A moment, not a device class. Any device, of any kind, can be too
    busy right now with enough other tabs and other apps open. The copy
    never says a phone, a tablet, or any other device cannot open a
    vault, and never suggests moving to a different one.
  - No weaker unlock is offered. Deriving at reduced memory would
    produce a different key that opens nothing, so there is nothing to
    fall back to, and weakening it for everybody would undo the one
    defense that stands between a stolen copy of the data and somebody
    reading it (`architecture.md`, Threat model).
- **Already signed in**: somebody who reaches this address with a live
  session is sent where their account belongs rather than shown the
  card. A vault owner goes to their dashboard, and is asked to unlock
  there if the keys are gone, rather than being shown an empty vault.
  An administrator goes to the admin area and is asked for nothing.
- **The session ran out mid-action**: the card appears in its
  unlocking-again shape, with the username known. Submitting it signs
  in again from cold. Nothing the person had typed into an open form is
  thrown away, and they are returned to where they were.
- **Populated**: not applicable. Success navigates away.

## Rules

- The password field is never auto-submitted, never logged, and cleared
  from the DOM on success.
- Autocomplete: `username` and `current-password`, so password managers
  work. This is deliberate. A manager-generated passphrase is the most
  realistic protection a vault with no recovery can have.
- Phones and tablets are supported targets, not a degraded case. The
  card is reachable, usable, and submittable on a touch screen, and the
  wait on one is stated above rather than apologized for.
- Unlocking again preserves whatever the person was doing. Afterwards
  they are returned to the previous view with unsaved form input
  intact. That input is the **one named exception** to the lock
  discarding all decrypted state (`login.md`, Rules). Everything else
  on that view is re-read and re-decrypted, so it repopulates rather
  than reappearing.
- The page embeds the server's current default KDF envelope, since it
  sits outside the app shell and has no session with which to fetch one
  (`design-system.md`, App shell).

## What it deliberately does not show

- **Nothing about which kind of account a username belongs to**, at any
  point before a correct password. Not in the copy, not in the layout,
  not in the timing.
- **No hint that an admin area exists.** Somebody who has never held an
  administrator account learns nothing here about whether one could.
- **No "remember me", and no staying signed in across a browser
  restart.** The vault exists in readable form only while the tab is
  open and unlocked. There is nowhere to remember it to.
- **No "forgot password".** There is nothing held anywhere that could
  open a vault except the password.
- **No second factor.** Not in this version.
- **No hint of how many attempts are left.** The lockout message says
  the same thing whether or not the account exists, and a counter would
  say more than that.
