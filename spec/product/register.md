# Register

## What it does

Turns an invite link (`admin-invites.md`) into the account it was made
for. Every invite is for one of the two kinds of account, fixed when it
was created, and the link decides which of two screens you see. You
never choose.

- **An invite for a user account** makes a vault. You pick a username,
  a password, and the currency your whole net worth will be counted
  in, and land inside Solvent already signed in, with an empty vault
  ready to fill.
- **An invite for an administrator account** makes no vault, because an
  administrator account does not have one. You pick a username and a
  password, and that is the whole of it.

The first is the single most consequential screen in the product, for
one reason: the password chosen there is the only thing that will ever
open that vault. Nobody at Solvent, no administrator, and no operator
with access to the machine can open it without that password, and none
of them can issue a new one. You asked for zero-knowledge encryption,
and this screen is where the cost of that is met.

Who it is for: a household member who has been sent a link, and the
person taking on the running of the instance.

## The screens

### Create your vault

This is the screen an invite for a user account opens.

A single card, nothing else on the page. No navigation, no marketing:
you arrived from a link to do one thing.

- **Username.** Three to thirty-two characters, lowercase letters,
  digits, dot, underscore, hyphen. Lowercase only, so no two people
  claim names that differ by capitalization alone. It is lowercased as
  you type rather than quietly changed afterwards, so what you see is
  what you will sign in with. A line under the field always states the
  rule. It says what is wrong the moment you type a character the rule
  does not allow or go past thirty-two, and points out a name that is
  too short when you leave the field. The button stays unusable until
  the username fits, so nobody waits through the slow setup only to be
  refused for the name.
- **Password, and again to confirm.** With a strength gauge that fills
  as you type and says, in words, roughly how long the password would
  hold up.
- **Main currency.** Everything in the vault is eventually counted into
  this one currency, and it is chosen here.
- **The acknowledgement.** A checkbox that has to be ticked.
- **Create vault.**

### The strength gauge

The bar is at least twelve characters, and a strength rating that
common passwords and obvious patterns do not reach however long they
are. Both have to pass before the button becomes usable, and whichever
one is not met is named. Never a bare "password too weak".

The password is the only defense if the stored data is ever stolen
outright. Twelve characters with a strength rating, rather than a
longer minimum, keeps a memorable four-word phrase comfortably inside
the bar while ruling out anything on a common-password list.

The gauge reads as a magnitude, not as a verdict: it fills, it does not
go from red to green, because a weak password here is not an error you
have made, it is a distance you have left to cover.

One line of guidance under it, because this is the one place in the
product where the advice changes the outcome: length beats symbols, and
a four-word phrase somebody can actually remember is stronger than a
short password with punctuation in it.

### The acknowledgement

Not a notice that can be dismissed. A checkbox, and the form will not
submit without it:

> I understand that if I lose this password, my data is permanently
> unreadable. Solvent has no way to reset it or recover my vault.

It carries the visual weight of the most important sentence in the
product, because it is.

### Main currency

A searchable list, with one line directly beneath it: **this cannot be
changed later**. People choose this in five seconds and live with it
for years, so the warning belongs here and not in settings afterwards
(`account-settings.md`).

The list holds only currencies Solvent can look up a rate
into. Offering more would let somebody pick a currency that quietly
breaks every future conversion, and they would find out years later
with a full vault and no way to fix it.

### Setting up

Turning the password into a key is deliberately slow (`login.md`,
which owns the timing), and setting up a vault does that plus a little
more. For the whole of it the screen says it is working and stays
responsive. It must never look like it has hung.

### Create an administrator account

This is the screen an invite for an administrator account opens, and it
is a shorter one. A single card, same as the other, with a username
under the same rule and the same line beneath it, and a password held
to the same bar and measured by the same strength gauge. The bar is not relaxed here, because this password guards the
power to delete every account on the instance.

What is absent is absent because there is no vault:

- **No main currency.** Nothing in this account is ever counted in one.
- **No no-recovery acknowledgement.** The sentence a vault owner has to
  agree to is not true here. There is no vault to become permanently
  unreadable.

The wait stays. Even with no vault, the password still has to be turned
into the proof the server checks at sign-in, and that is the same slow
work. What changes is only what the screen says while it happens: it is
making an account, not building a lock around something.

In their place, one line saying what the account is: this account
invites and removes people on this instance. It holds no financial data
and cannot read anybody else's. If you also want to keep your own
finances in Solvent, that is a separate account, and you need a
separate invite for it.

You land in the admin area, signed in.

### When it goes wrong

- **The link is no good.** No form at all, just: this invite link is
  not valid. Wrong, used, expired, and called back all say exactly
  that, word for word. A link that stops working while the page is open
  says the same when you submit.
- **The username is taken.** Said plainly. Somebody holding a valid
  invite to a small household instance learning that a username exists
  is accepted rather than defended against here. A username is taken
  once, across the whole instance, whichever kind of account holds it,
  so a person who holds both a user account and an administrator
  account signs in to them under two different names.
- **The device is out of memory at that moment.** On the vault screen.
  Any device, of any kind, can be too busy right now to spare what
  setting up needs. The screen says so in terms of the moment, not the
  password and not the device, makes clear that no vault was created
  and the invite is still good, and offers a retry after closing other
  tabs. It does not quietly set up a weaker vault instead, and it never
  tells you that your phone cannot do this.
- **Solvent cannot be reached, or fails, after the slow part.**
  Everything typed is still there. Nobody re-types a password and waits
  again because of a network blip. This is the only case that says the
  submit did not go through.
- **Solvent refuses the registration for any other reason.** The screen
  says nothing was created, and to ask whoever sent the invite if it
  happens again.

## What must be true

- The link alone decides which of the two screens appears. Nothing on
  either screen lets you choose which kind of account you are making,
  and a link for one kind never produces the other.
- A valid link for a user account, a password that clears the bar, and
  a free username produce a vault, and you are inside it, already
  signed in. You are never bounced to a sign-in screen to type the
  password you just chose.
- A valid link for an administrator account, a password that clears the
  same bar, and a free username produce an administrator account, and
  you are in the admin area, already signed in. No vault is
  created, no currency is asked for or recorded, and the account holds
  nothing encrypted.
- A username is free or taken across the whole instance, not within one
  kind of account. Two accounts never share a username.
- A vault owner's password never leaves the browser. Not in any form,
  not once.
- Nobody with the machine, the disk, or the database in hand can read
  the main currency, the holding names, or anything else in the vault,
  because none of it is stored in readable form.
- The link is used up. Trying it a second time fails.
- A registration that fails partway leaves no account and does not use
  up the link. You try again with the same link.
- A password under twelve characters, or one that fails the strength
  rating, cannot be submitted, and the slow setup never starts.
- A username outside the rule cannot be submitted either, on either
  screen. The rule is on screen before you type, and a character it
  does not allow, or a thirty-third character, is named as wrong the
  moment it is typed.
- A link that stops working while the page is open is answered with the
  same words as opening a bad link. Any other refusal says that nothing
  was created and to ask whoever sent the invite if it happens again.
- Only a failure to reach Solvent, or Solvent failing, says the submit
  did not go through. No refusal is worded as one.
- The vault form cannot be submitted without ticking the no-recovery
  acknowledgement. The administrator form does not carry one, and does
  not claim anything about recovery in its place.
- The two passwords have to match, on either screen.
- The currency list offers only currencies that will work for every
  future conversion this vault makes.
- A wrong, used, expired, or called-back link produce responses that
  are identical down to the wording, so probing teaches nothing about
  which one applies.
- Whatever a doctored or hand-built request claims, a vault is never
  created with weaker protection than the instance requires.
- A vault can be created on a phone and on a tablet, not only on a
  computer. Setting up there takes a couple of seconds rather than a
  fraction of one, and for the whole of that the screen shows it is
  working and stays responsive to touch.
- When setting up cannot finish because the device has no memory to
  spare at that moment, no vault is created, nothing is sent, and the
  invite is still usable, on that device or another.

## What it deliberately does not do

- **No sign-up without a link.** See `admin-invites.md`.
- **No password recovery, no reset, no recovery code, no security
  questions.** This is your zero-knowledge requirement in its most
  literal form. There is nothing held anywhere that could open this
  vault except the password, so there is nothing to recover it with.
  The screen makes you say you understand this before you can
  continue.
- **No email address, no phone number, no verification step.** Solvent
  never sends anything. An address would exist only to send a recovery
  mail that cannot exist, and it would be one more readable fact about
  a person on a server that otherwise holds none.
- **No weaker setup offered to a device that is short of memory right
  now.** Falling back would create a vault permanently easier to break
  into, and would record that weakness as though it had been chosen,
  because of one busy moment on one device. Saying so and letting you
  try again is the honest answer.
- **No changing the main currency afterwards.** See
  `account-settings.md`, which owns that rule.
- **No composition rules.** No required symbol, no required digit, no
  forced mixed case. They push people toward short passwords with
  punctuation, which is the wrong direction here.
