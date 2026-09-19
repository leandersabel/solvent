# Register

## What it does

Turns an invite link (`admin-invites.md`) into a vault. The person
picks a username, a password, and the currency their whole net worth
will be counted in, and lands inside Solvent already signed in, with an
empty vault ready to fill.

This is the single most consequential screen in the product, for one
reason: the password chosen here is the only thing that will ever open
this vault. Nobody at Solvent, no administrator, and no operator with
access to the machine can open it without that password, and none of
them can issue a new one. The client asked for zero-knowledge
encryption, and this screen is where the person finds out what that
costs them.

Who it is for: a household member who has been sent a link.

## The screens

### Create your vault

A single card, nothing else on the page. No navigation, no marketing.
The person arrived from a link, they are here to do one thing.

- **Username.** Three to thirty-two characters, lowercase letters,
  digits, dot, underscore, hyphen. It is lowercased as they type rather
  than quietly changed afterwards, so what they see is what they will
  sign in with.
- **Password, and again to confirm.** With a strength gauge that fills
  as they type and says, in words, roughly how long the password would
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

The gauge reads as a magnitude, not as a verdict: it fills, it does not
go from red to green, because a weak password here is not an error the
person has made, it is a distance they have left to cover.

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

The list holds only currencies Solvent can actually look up a rate
into. Offering more would let somebody pick a currency that quietly
breaks every future conversion, and they would find out years later
with a full vault and no way to fix it.

### Setting up

Deriving the key from the password is deliberately slow, around a
second on a computer and longer on a phone. Setting up a vault does
that plus a little more. The screen says so and stays responsive. It
must never look like it has hung.

### When it goes wrong

- **The link is no good.** No form at all, just: this invite link is
  not valid. Wrong, used, expired, and called back all say exactly
  that, word for word.
- **The username is taken.** Said plainly. Somebody holding a valid
  invite to a small household instance learning that a username exists
  is accepted rather than defended against here.
- **The device cannot do it.** On a device without enough memory to
  spare, chiefly an iPhone or iPad, setting up a vault cannot be done
  at all. The screen says so in terms of the device, not the password,
  makes clear that no vault was created and the invite is still good,
  and suggests a computer. It does not quietly set up a weaker vault
  instead. See "Decisions taken on the client's behalf", and the
  question that goes with it.
- **The submit fails after the slow part.** Everything typed is still
  there. Nobody re-types a password and waits again because of a
  network blip.

## What must be true

- A valid link, a password that clears the bar, and a free username
  produce a vault, and the person is inside it, already signed in.
  They are never bounced to a sign-in screen to type the password they
  just chose.
- The password never leaves the browser. Not in any form, not once.
- Nobody with the machine, the disk, or the database in hand can read
  the main currency, the account names, or anything else in the vault,
  because none of it is stored in readable form.
- The link is used up. Trying it a second time fails.
- A registration that fails partway leaves no account and does not use
  up the link. The person tries again with the same link.
- A password under twelve characters, or one that fails the strength
  rating, cannot be submitted, and the slow setup never starts.
- The form cannot be submitted without ticking the no-recovery
  acknowledgement.
- The two passwords have to match.
- The currency list offers only currencies that will work for every
  future conversion this vault makes.
- A wrong, used, expired, or called-back link produce responses that
  are identical down to the wording, so probing teaches nothing about
  which one applies.
- Whatever a doctored or hand-built request claims, a vault is never
  created with weaker protection than the instance requires.
- On a device that cannot run the setup, no vault is created, nothing
  is sent, and the invite is still usable elsewhere.

## What it deliberately does not do

- **No sign-up without a link.** See `admin-invites.md`.
- **No password recovery, no reset, no recovery code, no security
  questions.** This is the client's zero-knowledge requirement in its
  most literal form. There is nothing held anywhere that could open
  this vault except the password, so there is nothing to recover it
  with. The screen makes the person say they understand this before
  they can continue.
- **No email address, no phone number, no verification step.** Solvent
  never sends anything. An address would exist only to send a recovery
  mail that cannot exist, and it would be one more readable fact about
  a person on a server that otherwise holds none.
- **No weaker setup on a device that cannot manage the real one.**
  Falling back would create a vault permanently easier to break into,
  on the device least able to protect it, and would record that
  weakness as though it had been chosen. Refusing is the honest answer.
- **No changing the main currency afterwards.** See
  `account-settings.md`, which owns that rule.
- **No composition rules.** No required symbol, no required digit, no
  forced mixed case. They push people toward short passwords with
  punctuation, which is the wrong direction here.

## Decisions taken on the client's behalf

- **The password bar is twelve characters plus a strength rating.**
  The client asked for zero-knowledge, which makes the password the
  only defense if the stored data is ever stolen outright. Somebody had
  to pick a number. Twelve with a strength check, rather than a longer
  minimum, keeps a memorable four-word phrase comfortably inside the
  bar while ruling out anything on a common-password list.
- **Username shape and length.** Lowercase, three to thirty-two
  characters, with dot, underscore, and hyphen allowed. Nobody asked
  for this. It exists so that two people cannot claim names that differ
  only by capitalization.
- **Vault setup is refused on low-memory devices rather than weakened.**
  The consequence is that iPhones and iPads cannot create a vault, and
  see `login.md` for the same limit on opening one. Raised as a
  question, because the client asked for responsive web and may not
  have pictured a phone being excluded.
