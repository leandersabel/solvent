# Admin invites

## What it does

Solvent is not open to the public and has no sign-up. An account comes
into existence exactly one way: somebody already inside the instance
creates a link and hands it to a person they know. That person follows
the link and sets up their own vault (`register.md`).

The person who hands out links is an **administrator**. It is a
provisioning role and nothing else. An administrator decides who gets
an account on this instance and who stops having one. They get no
ability to see what anyone keeps in it.

Who it is for: the household member who runs the instance, and anyone
they choose to share that duty with.

## The admin boundary

The client asked for zero-knowledge encryption. Applied to the
administrator role, that means the following, stated the way a person
experiences it rather than the way it is built:

- An administrator cannot read another person's accounts, balances,
  notes, or history. Not one figure.
- An administrator cannot reset anybody's password.
- An administrator cannot recover a locked-out vault. Not someone
  else's, and not their own.
- The only destructive power an administrator holds is removing an
  entire account, and that destroys the vault rather than opening it.

This is the hard line of the product. Every future administrator
feature is checked against it before it is built.

It also has to be said out loud on screen, because "admin panel" means
the opposite in nearly every other product a person has used. An
administrator who assumes otherwise will promise help they cannot give
to somebody who has just locked themselves out.

## The screens

### The admin area

Reachable only by an administrator. Somebody who is not one never sees
the entry, and if they go looking for the address directly the app
behaves as though the page does not exist rather than telling them they
are not allowed in. Confirming that an admin area exists is itself
information this instance does not hand out.

The area opens with the boundary stated plainly, in the app's own
voice: you can invite and remove people, you cannot read anyone's data,
reset a password, or recover a vault, and Solvent holds no key that
could.

### Creating an invite

Three choices, then one button.

- **A note to yourself.** Optional, free text, something like "Sarah's
  laptop", so that a list of outstanding links is tellable apart. This
  is the one thing a person types anywhere in Solvent that the server
  can read, and the form says so at the moment of typing rather than
  leaving the administrator to assume otherwise. The guidance is to
  keep it to a nickname.
- **How long the link stays good.** Between one and thirty days.
- **Whether the person becomes an administrator.** A checkbox, off
  every time, never remembered from the last invite. Ticking it is
  spelled out where it is ticked: whoever uses this link can invite and
  remove people, and still cannot read anyone's data, because nobody
  can.

On creation the link appears once, ready to copy, with the plain fact
beside it that it is not stored and cannot be shown again. That is
literally true, not a scare message. An administrator invite says so in
its confirmation.

The link is copied and delivered however the administrator likes:
message, in person, written down. Solvent does not send it.

### Outstanding invites

One row per link ever created: the note, when it was made, when it
stops working, and where it stands. A link is waiting to be used, has
been used (by whom, and when), has run out of time, or was called back.
An invite that makes an administrator is marked as such at a glance,
because an unused administrator link is the most powerful thing
outstanding on the instance and should not be discoverable only by
noticing who eventually turns up in the people list.

A link that has not been used yet can be called back, with a
confirmation. Once a link has been used, calling it back is meaningless
and the app says so, pointing at removing the resulting person instead.

The link itself never appears again here.

### The people on this instance

One row per person: their username, when they joined, whether they are
an administrator, how many items their vault holds, and when they last
signed in.

Those last two are the only facts about somebody else's vault that
exist anywhere in this product. A count and a date. An administrator
about to remove somebody looks at them to check they are removing the
right account and that it is not in active use. Neither is content, and
no third fact is added later without checking the boundary above.

Removing a person requires typing their username. The dialog states
that the vault goes with them and cannot be brought back, and does not
offer to save a copy first, because an administrator cannot read the
vault they are about to destroy.

Whether somebody is an administrator is shown here and cannot be
changed here. See "What it deliberately does not do".

### The first administrator, and the locked-out one

Registration needs a link, and links need an administrator, so the very
first account on a new instance is created by whoever installed
Solvent, working directly on the machine it runs on. That produces one
invite link and nothing else.

The same path is the instance's only recovery. If the sole
administrator forgets their password, their vault is gone and stays
gone, which is the deal the product makes everywhere. But the
*instance* must still be able to hand out accounts. So the same
direct-on-the-machine step works on an instance that already has
people, after stating how many there are and what it is about to do,
and after being told to go ahead anyway. It is a speed bump against an
absent-minded command, not a security control, and it should not
pretend to be one: whoever can run it already holds the machine.

## What must be true

- There is no way to create an account on this instance without a link
  from an administrator.
- A link works once. The second person to try it is turned away.
- A link stops working when its time runs out.
- A link that has been called back stops working immediately, even
  though it has not run out of time.
- A link that is wrong, used up, out of time, or called back all fail
  the same way, with the same words. Someone holding a bad link learns
  nothing about which kind of bad it is.
- The link is readable exactly once, at the moment it is created. It is
  nowhere in the app afterwards.
- No screen, no list, and no part of the product shows an administrator
  anything from inside another person's vault beyond the item count and
  the last sign-in date named above.
- There is no way, anywhere in the product, to turn an existing account
  into an administrator or to stop one being an administrator.
- Ticking the administrator box creates a person who is an
  administrator from their first sign-in. Leaving it unticked creates
  one who is not.
- A person who is not an administrator, trying anything in the admin
  area, is answered as though it does not exist, and nothing happens.
- Removing a person removes their account, everything in their vault,
  and every session they have open, all at once or not at all. If it
  fails partway, they are still there and can still sign in.
- Removing one person leaves everyone else's vault untouched.
- Someone removed while signed in is signed out on their next action
  and cannot sign back in.
- The last remaining administrator cannot be removed, by an
  administrator or by themselves.
- An administrator who is not the last one can remove their own
  account, and is signed out by doing it.
- Asking to remove a username that does not exist looks exactly like
  every other refusal, so guessing usernames teaches nothing.
- Setting up the very first account on an empty instance produces a
  working administrator. Doing it on an instance that already has
  people refuses, says how many there are, and changes nothing, until
  it is explicitly told to proceed.
- The link does not turn up in Solvent's own logs.

## What it deliberately does not do

- **No self-service sign-up.** The client asked for a small invited
  group, not a public service.
- **No password reset by an administrator.** Not withheld, impossible.
  There is nothing to reset toward: the password is what makes the
  vault readable, so a new one would open an empty room.
- **No administrator view of anyone's data**, and no export of a
  vault before deleting it. Same reason.
- **No promoting or demoting an existing account.** An administrator is
  made at the moment their account is created, or not at all. See
  "Decisions taken on the client's behalf", and the open question in
  the report that goes with this file.
- **Solvent does not send the invite.** It never sends mail of any
  kind, so there is no mail service to run, keep working, or trust with
  a link that grants an account. The administrator delivers it by hand.
- **No undo on removing a person.** Nothing is kept in a recycle bin,
  because there is no readable vault to keep.
- **The last administrator cannot be removed**, or the instance could
  never hand out an account again without going back to the machine.

## Decisions taken on the client's behalf

Recorded here because the client did not choose these and may want to.

- **A link lasts seven days unless changed, and can be set anywhere
  from one to thirty.** Short enough that a forgotten link expires,
  long enough to survive a weekend.
- **There is no promote or demote.** Every route by which an
  administrator could move toward somebody else's vault is one fewer if
  the role is fixed at creation. The cost is real: making an existing
  person an administrator today means removing their account and
  inviting them again, which destroys their vault. Raised as a
  question.
- **The note on an invite is readable by the server.** Everything else
  a person types in Solvent is not. This is provisioning paperwork
  rather than vault content, and encrypting it would mean the invite
  list could only be read by the one administrator who wrote it.
- **The people list carries an item count and a last sign-in date.**
  Both are facts the server already has. They are listed because an
  administrator removing somebody should be able to see they have the
  right account.
