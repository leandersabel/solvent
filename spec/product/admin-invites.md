# Admin invites

## What it does

Solvent is not open to the public and has no sign-up. An account comes
into existence exactly one way: somebody already inside the instance
creates a link and hands it to a person they know.

There are two kinds of account on an instance, and they are different
things rather than the same thing with different powers.

- A **user account** owns a vault: the holdings, balances, notes and
  history one person keeps. Everything in it is readable only with that
  person's password. Following a link into a user account is what
  `register.md` describes.
- An **administrator account** manages the platform. It decides who
  gets an account on this instance and who stops having one. **It has
  no vault.** It holds no holdings, no balances, no notes, nothing
  encrypted, and there is nothing in it to unlock.

That an administrator cannot read anyone's data is therefore not a rule
enforced in each place somebody might try. It is what the account is.

Who it is for: the household member who runs the instance, and anyone
they choose to share that duty with.

## Two accounts, one person

The same person may hold both kinds. Two usernames, two passwords, used
for two different jobs. The household member who runs the instance
signs in to their administrator account to hand out an invite or remove
somebody, and signs in to their user account to look at their own
money. Neither account can do the other's work.

Privilege is stepped into on purpose for the length of one task rather
than carried around all day in the account used for everything. The
cost is a second password to remember and a second sign-in before
administrative work. What it buys is that an administrator account has
nothing in it worth stealing: somebody who guesses an administrator's
password gets a list of usernames and the power to delete, and not one
figure out of any vault, including the one belonging to that same
administrator's own user account.

**Several administrator accounts can exist at the same time.** Sharing
the duty is normal, not an exception, and the instance does not have a
single privileged person in it.

**An account never changes kind**, in either direction. This is not a
restriction the product enforces, because there is nothing to convert:
a user account's whole substance is a vault nobody but its owner can
read, and an administrator account has no vault to give it or take
away. Somebody who has a vault and now needs to administer the instance
is given a second account, and keeps the first one untouched.

## The admin boundary

You asked for zero-knowledge encryption. Applied to administration,
and stated the way it is experienced:

- An administrator cannot read anyone's holdings, balances, notes, or
  history. Not one figure. Not another person's, and not the vault held
  by their own user account, which they reach the same way everybody
  does, by signing in to that account with its own password.
- An administrator cannot reset anybody's password.
- An administrator cannot recover a locked-out vault.
- The only destructive power an administrator holds is removing an
  entire account, and that destroys the vault rather than opening it.

This is the hard line of the product.

The line bounds an administrator, it does not enumerate them. The tasks
of running the platform will grow: handing out accounts, removing them,
and maintaining the settings that apply to the whole instance rather
than to one vault, such as the list of units a holding can be measured
in. What never grows is reach into a vault. A new administrator task is
judged against the line above, not against the tasks that came before
it.

It also has to be said out loud on screen, because "admin panel" means
the opposite in nearly every other product a person has used. An
administrator who assumes otherwise will promise help they cannot give
to somebody who has just locked themselves out.

## The screens

### The admin area

Reachable only by signing in to an administrator account. Nobody else
ever sees the entry, and if they go looking for the address directly
the app behaves as though the page does not exist rather than telling
them they are not allowed in. Confirming that an admin area exists is
itself information this instance does not hand out.

The area opens with the boundary stated plainly, in the app's own
voice: you can invite and remove people, you cannot read anyone's data,
reset a password, or recover a vault, and Solvent holds no key that
could.

### Creating an invite

Three choices, then one button.

- **Which kind of account the link creates.** A user account unless
  chosen otherwise, never remembered from the last invite. Choosing an
  administrator account is spelled out where it is chosen: whoever uses
  this link gets an account that can invite and remove people and has
  no vault of its own, and if that person also wants to keep financial
  data in Solvent they need a separate invite for a user account.
- **A note to yourself.** Optional, free text, something like "Sarah's
  laptop", so that a list of outstanding links is tellable apart. This
  is the one thing you type anywhere in Solvent that the server can
  read, and the form says so at the moment of typing. The guidance is
  to keep it to a nickname. It is provisioning paperwork rather than
  vault content, and encrypting it would mean the invite list could be
  read only by the one administrator who wrote it.
- **How long the link stays good.** Seven days unless changed, and
  anywhere from one to thirty: short enough that a forgotten link
  expires, long enough to survive a weekend.

On creation the link appears once, ready to copy, with the plain fact
beside it that it is not stored and cannot be shown again. An
administrator invite says which kind of account it creates in its
confirmation.

The link is copied and delivered however the administrator likes:
message, in person, written down. Solvent does not send it.

### Outstanding invites

One row per link ever created: which kind of account it creates, the
note, when it was made, when it stops working, and where it stands. A
link is waiting to be used, has been used (by whom, and when), has run
out of time, or was called back. An invite for an administrator account
is marked as such at a glance, because an unused administrator link is
the most powerful thing outstanding on the instance and should not be
discoverable only by noticing who turns up in the accounts list later.

A link that has not been used yet can be called back, with a
confirmation. Once a link has been used, calling it back is meaningless
and the app says so, pointing at removing the resulting account
instead.

The link itself never appears again here.

### The accounts on this instance

One row per account: its username, which kind of account it is, when it
was created, and when it was last signed in to. A user account also
shows how many items its vault holds.

That item count and those dates are the only facts about somebody
else's account that exist anywhere in this product, and an
administrator about to remove an account reads them to check they have
the right one and that it is not in active use. None of it is content,
and no further fact is added later without checking the boundary above.

Removing an account requires typing its username, and nothing more.
For a user account the dialog states that the vault goes with it and
cannot be brought back, and does not offer to save a copy first,
because an administrator cannot read the vault they are about to
destroy.

The administrator is not asked for their own password first. That has
a cost: an administrator session left open on an unlocked
machine can destroy somebody's whole history in two clicks, and nothing
locks it short of the twelve-hour session limit (`login.md`), so what
protects it is keeping the machine to yourself rather than anything the
app does.

Which kind an account is, is shown here and is not changed here,
because it is not changed anywhere.

### The first administrator, and a second one

Links need an administrator, and there is nobody on a fresh instance to
create one, so the very first link is produced by whoever installed
Solvent, working directly on the machine it runs on. It is an invite
for an administrator account and nothing else. The installer follows it
in a browser, chooses a username and a password, and the instance has
its first administrator. No vault is created, because an administrator
account does not have one. The step on the machine produces an invite
rather than an account, so the password is chosen in the browser by the
person who will use it, and an account comes to exist in one way only.

Every account after that comes from a link handed out inside the app.
A **second administrator** is created the ordinary way: an existing
administrator makes an invite for an administrator account and gives it
to the person who will hold it. The step on the machine is not needed
again.

The same direct-on-the-machine step is also the instance's only way
back if every administrator password is lost. On an instance that
already has an administrator it says so, and what it is about
to do, and proceeds only when told to go ahead anyway. That is a speed
bump against an absent-minded command and not a security control:
whoever can run it already holds the machine. It creates an
administrator account and reaches no vault, so it is not a route to
anybody's data.

### A locked-out administrator

An administrator who forgets their password is not in the position a
vault owner is. Nothing of theirs is encrypted with it, so nothing
becomes permanently unreadable.

Another administrator removes the locked-out account and issues a
fresh administrator invite. It is the same act as removing any other
account, so there is nothing new an administrator can do.

Deliberately there is no way for one administrator to set a new
password on another administrator's account. That would be the first
thing on the instance letting one person act as another, and it is
worth more to keep that absent than to save the few minutes the
removal takes.

On an instance with a single administrator there is nobody to do the
removing, and the way back is the same step on the machine that
created the first administrator.

## What must be true

- There is no way to create an account of either kind on this instance
  without a link, and only an administrator can produce one from inside
  the app.
- Every invite creates either a user account or an administrator
  account, fixed when the invite is made and shown on the link's row
  until it is used.
- An administrator account has no vault. There is nothing in it to
  encrypt, nothing to unlock, and no financial data of any kind, and no
  screen anywhere offers to put any there.
- An administrator sees no holdings, balances, notes, or history
  belonging to anybody, including the vault of a user account they
  themselves hold. The item count and the dates named above are the
  whole of what an administrator learns about an account.
- There is no way, anywhere in the product, to turn a user account into
  an administrator account or an administrator account into a user
  account.
- More than one administrator account can exist on an instance at the
  same time, and each can do everything any other administrator can.
- A link works once. The second person to try it is turned away.
- A link stops working when its time runs out.
- A link that has been called back stops working immediately, even
  though it has not run out of time.
- A link that is wrong, used up, out of time, or called back all fail
  the same way, with the same words. Someone holding a bad link learns
  nothing about which kind of bad it is, or which kind of account it
  would have made.
- The link is readable exactly once, at the moment it is created. It is
  nowhere in the app afterwards.
- Somebody who is not signed in to an administrator account, trying
  anything in the admin area, is answered as though it does not exist,
  and nothing happens. A signed-in vault owner is answered the same way
  as a stranger.
- Removing a user account removes the account, everything in its vault,
  and every session it has open, all at once or not at all. If it fails
  partway, the account is still there and can still sign in.
- Removing one account leaves every other account untouched.
- Someone removed while signed in is signed out on their next action
  and cannot sign back in.
- The last remaining administrator account cannot be removed, by
  another administrator or by itself.
- An administrator who is not the last one can remove their own
  administrator account, and is signed out by doing it. Their user
  account, if they hold one, is a separate account and is not touched.
- Asking to remove a username that does not exist looks exactly like
  every other refusal, so guessing usernames teaches nothing.
- Setting up the first account on an empty instance produces a working
  administrator and no vault. Doing it on an instance that already has
  accounts refuses, says how many there are, and changes nothing, until
  it is explicitly told to proceed.
- The link does not turn up in Solvent's own logs.

## What it deliberately does not do

- **No self-service sign-up.** You asked for a small invited group,
  not a public service.
- **No vault on an administrator account.** It is not an account with
  its financial features switched off. There is no dashboard, no list
  of holdings, no figures, and nothing to lock, because there is
  nothing in it to hide.
- **No password reset by an administrator.** Not withheld, impossible.
  There is nothing to reset toward: a vault owner's password is what
  makes their vault readable, so a new one would open an empty room.
- **No administrator view of anyone's data**, and no export of a vault
  before deleting it. Same reason.
- **Solvent does not send the invite.** It never sends mail of any
  kind, so there is no mail service to run, keep working, or trust with
  a link that grants an account. The administrator delivers it by hand.
- **No undo on removing an account.** Nothing is kept in a recycle bin,
  because there is no readable vault to keep.
- **The last administrator account cannot be removed**, or the instance
  could never hand out an account again without going back to the
  machine.
