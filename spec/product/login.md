# Login

## What it does

Opens a vault. The person types their password, waits a moment, and
their accounts, figures, and history appear.

It is the only screen where a password is typed outside registration
and changing a password, and it is where the client's zero-knowledge
requirement is felt rather than explained: the password is not checked
against something the server knows, it is the thing that makes the
vault readable. A wrong password does not fail a check, it produces a
key that opens nothing.

The same screen does two jobs:

- **Signing in**, from cold. Username and password.
- **Unlocking again**, when the session is still good but the vault has
  been locked, by the idle timer, the lock button, or a page reload.
  The username is already known, so only the password is asked for.

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
responsive the whole time, so the extra second or two on a phone reads
as the screen working rather than the screen having frozen.

### Locking

The vault locks in three ways, and all three land back on this screen:

- **By itself**, after a stretch of no activity. The person sets how
  long in settings (`account-settings.md`, which owns the period).
- **By hand**, with the lock button in the top bar. One click, no
  confirmation. This is the control somebody reaches for when another
  person walks into the room, and a confirmation step spends the
  seconds it exists to save.
- **By reloading the page.** Nothing is kept anywhere on the device, so
  a refresh always means typing the password again.

Locking is not cosmetic. Everything readable goes: not just the key,
but every figure, chart, name, and note that had been decrypted. The
threat this defends against is another household member at an unlocked
machine, and that person can open the browser's own developer tools. So
unlocking genuinely reloads and re-reads the vault, and that pause is
by design.

**One thing survives a lock: whatever the person was typing.** An
unsaved form keeps what is in it, so a lock in the middle of entering
figures does not destroy the work. That is what the person is about to
commit, not vault content read back. Nothing else is exempt, and after
unlocking they are returned to where they were.

### When it goes wrong

- **Wrong password, or a username that does not exist.** The same
  words, in the same place: invalid username or password. And the same
  speed. The screen must not give away which of the two it was, by
  wording or by how quickly it gives up.
- **Too many attempts.** Try again in a few minutes, said the same way
  whether or not the account exists.
- **The browser cannot do the encryption Solvent needs.** A hard stop
  with a plain explanation. No fallback is offered, because none
  exists.
- **The device is out of memory at that moment.** A separate message.
  Any device, of any kind, can be too busy right now to spare what
  unlocking needs, with enough other tabs and other apps open. The copy
  blames the moment, not the password and not the device: this device
  does not have enough memory available right now, close other tabs and
  try again. Retry is offered, because closing tabs genuinely can fix
  it. The copy must never tell somebody their phone or their computer
  is incapable of opening a vault, because it is not.
- **The session ran out mid-action.** The person is asked to unlock
  again. Nothing they typed is thrown away.

### Keeping the lock current

Over time the instance raises how hard it is to attack a stored vault.
When somebody with an older vault signs in, Solvent quietly rebuilds
the protection around it at the current strength, with no prompt and no
wait beyond the sign-in they already did. Nothing inside the vault is
re-encrypted and nothing can be lost in the process. If it fails, the
person is signed in as normal and it is tried again next time. An
upgrade that could lock somebody out would be worse than no upgrade.

## What must be true

- The correct password opens the vault and the real figures appear.
- The password never leaves the browser, in any form, on any attempt.
- Nothing that could open the vault is stored on the device. Closing
  the tab, reloading, or coming back tomorrow all mean typing the
  password again.
- A wrong password and a username nobody has produce the same message
  and take the same time. Somebody guessing usernames at the sign-in
  screen learns nothing about who has an account here.
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
- What the person was typing into an open form is still there after
  unlocking, and it is the only thing that is.
- The lock button in the top bar locks immediately, with no
  confirmation, and does not sign the person out. Unlocking needs only
  the password.
- Everybody is signed out twelve hours after signing in, however busy
  they have been.
- A vault made when the instance protected vaults less strongly is
  brought up to current strength at the next sign-in, without being
  asked and without touching anything inside the vault. If that step
  fails the person is still signed in and can still sign in next time.
- A password that is correct but opens nothing is treated as a failed
  sign-in with the same message, and reported to the operator as an
  anomaly rather than shown to the person.
- Someone already signed in who returns to the sign-in address goes
  to their dashboard, and is asked to unlock rather than shown an empty
  vault.

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
  second factor at the door would guard the session, not the data. It
  is worth having later, and it is not what makes the vault safe.
- **No easier unlock offered to a device that is short of memory right
  now.** Unlocking with anything weaker would produce a key that opens
  nothing anyway, and weakening it for everybody would undo the one
  protection that stands between a stolen copy of the data and someone
  reading it. The person closes a tab and tries again instead.
- **Guessing who has an account is not fully closed off.** For vaults
  at the current protection strength it is. A vault that has not been
  signed into since the last raise is, until its owner next signs in,
  tellable apart by a determined prober. Accepted for a small invited
  household, where sign-in is already gated and registration accepts
  the same exposure.

## Decisions taken on the client's behalf

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
  fraction of a second would have left somebody on a phone waiting
  eight to ten seconds every time they unlocked. It was lowered until
  a phone comes in a little under two. The cost is real but small:
  roughly one character of password strength against somebody who has
  stolen a copy of the stored data, and the setting chosen is one of
  the two the standard behind this encryption recommends. If phone
  browsers get faster, Solvent can raise it again on its own, applying
  the stronger setting to each person's vault the next time they sign
  in, with nothing for anybody to do and nothing inside the vault
  touched. See "Keeping the lock current".
