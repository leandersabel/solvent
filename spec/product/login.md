# Login

## What it does

Opens a vault. You type your password, wait a moment, and your
holdings, figures, and history appear.

It is the only screen where a password is typed outside registration
and changing a password, and it is where your zero-knowledge
requirement is felt rather than explained: the password is not checked
against something the server knows, it is the thing that makes the
vault readable. A wrong password does not fail a check, it produces a
key that opens nothing.

The same screen does three jobs:

- **Signing in to a user account**, from cold. Username and password.
- **Unlocking again**, when the session is still good but the vault has
  been locked, by the idle timer, the lock button, or a page reload.
  The username is already known, so only the password is asked for.
- **Signing in to an administrator account** (`admin-invites.md`).
  Username and password, and nothing is opened, because an
  administrator account has no vault.

The username decides which of the two kinds of account is being signed
in to, and you never say which you meant, because a username belongs
to exactly one account on the instance. Somebody who holds both kinds
holds two usernames and signs in to one at a time.

## The screens

### Unlock

A single centered card on the plain ground. Nothing else on the page.

- The wordmark.
- Username, when signing in cold. When unlocking again, the username is
  shown as text with a way to sign out and switch person.
- Password, with a show-and-hide toggle.
- **Unlock.**
- Beneath the card, quietly: Solvent cannot recover a lost password.

There is no "remember me" and no "forgot password" link. Neither
exists, and a link that hints at recovery is worse than no link at all.

Password managers are supported deliberately. A manager-generated
passphrase is the most realistic protection a vault with no recovery
can have.

### The wait

Turning a password into a key is slow on purpose. About a sixth of a
second on a computer, and a little under two seconds on a phone or
tablet, where the browser runs this kind of work much more slowly on
otherwise comparable hardware. This is the screen's defining moment and
it must never look like a hang.

On submit the button becomes a progress state labeled as deriving the
key, and the form goes quiet. One line beneath: this takes a moment by
design, it is what makes the password hard to attack. The tab stays
responsive the whole time.

### Signing in as an administrator

Same card, same two fields, same wait, and from there it is a
different act. There is no vault behind an administrator account, so
nothing is decrypted, and it lands in the admin area rather than on a
dashboard.

The wait is the one part that does not change, and that is deliberate.
It happens in the browser before anything is sent, so for the screen to
skip it the browser would have to know the name belongs to an
administrator before anything has been proved. Anyone could then time
the screen and read off which usernames administer the instance,
without guessing a single password. So an administrator pays the same
second or two, building a key that is thrown away.

The card looks and behaves identically while it is being filled in.
Anyone can put a name into the field, and nothing that comes back
before a correct password says which kind of account, if any, wears
it.

An administrator has nothing to lock and no vault to re-open, so
everything below about locking, the idle timer, and the lock button
belongs to a user account and not to them. The only way out of an
administrator session is signing out.

### Locking

Locking is a vault owner's concern.

The vault locks in three ways, and all three land back on this screen:

- **By itself**, after a stretch of no activity. You set how long in
  settings (`account-settings.md`, which owns the period).
- **By hand**, with the lock button in the top bar. One click, no
  confirmation (`app-shell.md`, which owns the button).
- **By reloading the page.** Nothing is kept anywhere on the device, so
  a refresh always means typing the password again.

Locking is not cosmetic. Everything readable goes: not just the key,
but every figure, chart, name, and note that had been decrypted. The
threat this defends against is another household member at an unlocked
machine, and that person can open the browser's own developer tools. So
unlocking reloads and re-reads the vault, and that pause is
by design.

**One thing survives a lock: whatever you were typing.** An unsaved
form keeps what is in it, so a lock in the middle of entering figures
does not destroy the work. That is what you are about to commit, not
vault content read back. Nothing else is exempt, and after unlocking
you are returned to where you were.

### When it goes wrong

- **Wrong password, or a username that does not exist.** The same
  words, in the same place: invalid username or password. And the same
  speed. The screen must not give away which of the two it was, by
  wording or by how quickly it gives up, nor whether the name it was
  given belongs to a user account or an administrator account.
- **Too many attempts.** Try again in a few minutes, said the same way
  whether or not the account exists.
- **The browser cannot do the encryption Solvent needs.** A hard stop
  with a plain explanation. No fallback is offered, because none
  exists.
- **The device is out of memory at that moment.** A separate message.
  Any device, of any kind, can be too busy right now to spare what
  unlocking needs. The copy blames the moment, not the password and not
  the device: this device does not have enough memory available right
  now, close other tabs and try again. Retry is offered, because
  closing tabs can fix it. It must never tell you that your
  phone or your computer is incapable of opening a vault.
- **The session ran out mid-action.** You are asked to unlock again.
  Nothing you typed is thrown away.

### Keeping the lock current

Over time the instance raises how hard it is to attack a stored vault.
When you sign in with an older vault, Solvent quietly rebuilds the
protection around it at the current strength, with no prompt and no
wait beyond the sign-in you already did. Nothing inside the vault is
re-encrypted and nothing can be lost in the process. If it fails, you
are signed in as normal and it is tried again next time. An upgrade
that could lock somebody out would be worse than no upgrade.

## What must be true

- The correct password opens the vault and the real figures appear.
- The password never leaves the browser, in any form, on any attempt.
- Nothing that could open the vault is stored on the device. Closing
  the tab, reloading, or coming back tomorrow all mean typing the
  password again.
- A wrong password and a username nobody has produce the same message
  and take the same time. Somebody guessing usernames at the sign-in
  screen learns nothing about who has an account here, or about which
  names belong to administrators.
- The correct username and password for an administrator account signs
  that administrator in and lands them in the admin area. Nothing is
  decrypted, nothing is asked about a vault, and no dashboard appears.
- A username and password that belong to a user account never reach the
  admin area, however they are submitted.
- Being locked out after too many attempts looks the same whether or
  not the account exists.
- A vault opens on a phone and on a tablet, not only on a computer.
  Unlocking there takes a little under two seconds rather than a
  fraction of one, and for the whole of that the screen shows it is
  working and stays responsive to touch.
- After the idle period, the keys and every decrypted figure, name, and
  chart are gone from the browser, and touching the vault asks for the
  password. Nothing decrypted is reachable by anyone who opens the
  browser's own tools at that point.
- Unlocking after a lock re-reads and re-decrypts the vault rather than
  restoring what was on screen before.
- What you were typing into an open form is still there after
  unlocking, and it is the only thing that is.
- The lock button in the top bar locks immediately, with no
  confirmation, and does not sign you out. Unlocking needs only the
  password.
- Everybody is signed out twelve hours after signing in, however busy
  they have been.
- A vault made when the instance protected vaults less strongly is
  brought up to current strength at the next sign-in, without being
  asked and without touching anything inside the vault. If that step
  fails you are still signed in and can still sign in next time.
- A password that is correct but opens nothing is treated as a failed
  sign-in with the same message.
- Someone already signed in to a user account who returns to the
  sign-in address goes to their dashboard, and is asked to unlock
  rather than shown an empty vault. An administrator already signed in
  goes to the admin area, and is asked for nothing.

## What it deliberately does not do

- **No password recovery, of any kind.** See `register.md`. There is
  no link on this screen that could imply otherwise.
- **No "remember me", no staying signed in across a browser restart.**
  The vault only exists in readable form while the tab is open and
  unlocked. There is nowhere to remember it to.
- **No way to turn the idle lock off.** The period can be stretched
  (`account-settings.md`), never disabled. The lock is the last defense
  against somebody walking up to an unlocked screen, which is a threat
  this product takes seriously.
- **No second factor.** Not in this version. The vault's protection is
  the password itself rather than a check the server performs, so a
  second factor at the door would guard the session, not the data. An
  administrator account is where it would earn its keep soonest,
  because there the password is the whole of what stands in front of
  the power to delete every account on the instance. Named here so the
  gap is a known one.
- **No easier unlock offered to a device that is short of memory right
  now.** Unlocking with anything weaker would produce a key that opens
  nothing anyway, and weakening it for everybody would undo the one
  protection that stands between a stolen copy of the data and someone
  reading it. You close a tab and try again instead.
- **Guessing who has an account is not fully closed off.** For vaults
  at the current protection strength it is. A vault that has not been
  signed into since the last raise is, until its owner next signs in,
  tellable apart by a determined prober. Accepted for a small invited
  household, where sign-in is already gated and registration accepts
  the same exposure.

## Decisions taken on your behalf

- **Both kinds of account sign in at the same screen, at the same
  address.** A separate address for administrators would be one more
  thing to know and would not hide anything, since an address anybody
  can type is not a secret. One screen also means a probe cannot tell
  the two kinds of account apart by where the name was accepted. The
  cost is that the screen has to behave differently after a correct
  password without hinting at it before one. Reversible.
- **Everybody is signed out twelve hours after signing in**, counted
  from sign-in and not extended by activity. Long enough for a day's
  work, short enough that a forgotten tab is not a standing invitation.
- **Attempts are throttled and then locked out for a few minutes.** The
  exact numbers are left to whoever runs the instance, because a
  home-network-only install and an internet-facing one do not need the
  same limits.
- **The encryption was tuned so that a phone or tablet unlocks in
  about two seconds instead of eight to ten.** Reversible. Phone and
  tablet browsers run this particular computation many times slower
  than a computer's does, so a setting that keeps a computer at a
  fraction of a second would leave somebody on a phone waiting eight to
  ten seconds every time they unlocked. The cost is real but small:
  roughly one character of password strength against somebody who has
  stolen a copy of the stored data, and the setting chosen is one of
  the two the standard behind this encryption recommends. If phone
  browsers get faster, Solvent can raise it again on its own. See
  "Keeping the lock current".
