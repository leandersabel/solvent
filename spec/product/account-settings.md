# Account settings

## What it does

Everything a person controls about their own account: their password,
the currency their vault counts in, how long it stays unlocked, which
sessions are open, how their accounts are grouped, and, at the bottom,
deleting the whole thing.

Nothing here can recover a lost password. Settings is where a person
finds out which of the product's rules are theirs to change and which
are fixed for good, so it has to be honest about both rather than
hiding the fixed ones.

Who it is for: every person with a vault, about their own vault only.
This screen exists only inside a vault, so an administrator account
never reaches it and there is nothing on it an administrator would
recognize. Provisioning the instance is a different account's job
(`admin-invites.md`), with its own screens.

## The screens

### Settings

One page, stacked cards, reached from the main navigation.

#### Profile

Username, shown, not editable.

**Main currency**, shown, not editable, with the reason in one line:
it was fixed when the vault was created, every rate recorded since
converts into it, so changing it would mix two currencies in the same
history. This is not a control that has been disabled for now. Shipping
an editable field here would quietly corrupt years of history, so there
is no field.

#### Organizing

Two link rows out to screens that do not belong inside a settings card:

- **Dimensions**, described as how accounts split up in the chart, with
  how many exist right now, or "None yet".
- **Export and import** (`export-import.md`), described as downloading
  the vault or restoring one from a file.

#### Change password

Current password, new password, confirm, with the same strength gauge
as registration (`register.md`) and the same bar.

Three things are said here, in order of how surprised somebody would be
to learn them:

- Changing the password does not re-encrypt the vault. Only the lock
  around the key is rebuilt, which is why it is instant even on a large
  vault. Said as reassurance, because "changing my password took no
  time at all" otherwise reads as it having done nothing.
- **Export files already saved still open with the old password.** They
  carry their own copy of the lock. Changing the password here does not
  reach back and protect a file already downloaded. This carries a
  warning icon, because it is the one way a person can believe they
  have locked something they have not.
- Other sessions were signed out. The current one stays, and nobody
  has to sign in again after changing their own password.

A wrong current password is caught before anything is sent, and is
reported plainly.

#### Session and lock

- **Idle lock**, five to sixty minutes, fifteen unless changed. One
  line of honest tradeoff beneath it: shorter is safer, and every
  unlock costs the deliberate wait while the password becomes a key
  (`login.md`, which owns how long that is). There is no "never", and
  the control does not offer one.
- **You are signed out twelve hours after signing in, regardless of
  activity.** Stated, not adjustable.
- **Open sessions**, listed by when each started and when it was last
  used, with a line volunteering that Solvent records no IP addresses
  and no devices. Saying so is the point. A person who has used any
  other product assumes those are kept.
- **Sign out**, and **sign out everywhere**, which ends the current
  session too.

#### Delete my account

Behind a "danger zone" disclosure, styled as destructive.

Deleting requires both re-entering the password and typing the
username. It says plainly that everything goes at once, that nothing is
kept in reserve, and that there is no vault left for anybody to
recover.

**The dialog's main action is "Export first."** Deleting is the
secondary one. Somebody who came here wanting a backup and left with a
wiped vault has been failed by the dialog.

Nobody's vault is undeletable. There is no account whose deletion would
leave the instance unable to hand out accounts, because handing out
accounts is not something a vault owner can do.

### Dimensions

A dimension is an axis accounts are sorted along: "Liquidity", with
values Cash, Investments, Retirement. Each account takes one value per
dimension, which is what lets the bands of the chart add up to exactly
the net worth. This screen is the only place they are created, renamed,
reordered, put away, and brought back. How they are drawn belongs to
the dashboard (`net-worth-view.md`).

One card per dimension, in the order they appear in the dashboard's
grouping control, so dragging a card here changes that order too.

Each card shows:

- Its **name**, editable in place. Renaming is instant and free, and
  touches no account.
- Its **coverage**, the same figure the dashboard shows: seven of ten
  accounts assigned, with the unassigned ones a click away. A dimension
  covering a third of the accounts draws a chart that is accurate and
  useless, and this is where somebody should notice, at the point of
  setting it up rather than after a confusing chart.
- Its **values**, in the order they stack in the chart, each draggable,
  renamable, and archivable. This order is never sorted by size: a
  stack whose bands swap places from month to month cannot be read.
- Adding a value, and archiving the whole dimension.

Beneath the cards: creating a dimension, and a collapsed "Archived"
section when there is anything in it.

**Creating a dimension** asks for a name and a first value, because a
dimension with no values sorts nothing. The same dialog offers a
**flag** as the other option: a dimension with exactly one value, which
the account form shows as a checkbox rather than a list. That is the
shape that replaces a yes-or-no tag such as "Emergency fund", and it
has to be as quick to make as typing a tag once was.

**Past four values**, a note appears under the list, not a warning and
not a cap: the chart shows the first four and folds the rest into
"Other", and all of them are still tracked. Four is a limit on how many
bands can be told apart on screen, not a limit on the data.

**Deleting is called archiving**, and the dialog says why in one line:
archiving keeps every account's assignment, and restoring brings every
account back to the band it was in. An archived dimension simply stops
appearing, on the account form, in the grouping control, and in the
chart. An archived value moves its accounts to "Unassigned".

There is no permanent delete and no "remove this from all my accounts".
Stripping a setting out of every account is a destructive sweep that
can fail halfway, offered in exchange for a scrap of leftover data
nobody will ever read. An archived definition costs one line and buys
exact reversibility.

The first time somebody opens this screen it explains the word, because
"dimension" is the least self-explanatory thing in the product, with
one concrete example and one button. Nowhere else in the app nags about
it: a vault with no dimensions is completely usable and charts as a
single total.

## What must be true

- The main currency is shown and cannot be changed, and the screen says
  why.
- Changing the password works, and afterwards everything written under
  the old password still reads correctly, in the same session and after
  signing in fresh.
- The old password no longer signs in and the new one does.
- Neither password, old or new, ever leaves the browser.
- A wrong current password changes nothing, and is caught before
  anything is sent. A doctored request that skips the browser check is
  still refused.
- Changing the password signs out every other session and leaves the
  current one alone. Nobody has to sign in again after changing their
  own password.
- A change that fails partway changes nothing: the old password still
  works, and the screen says exactly that.
- A vault protected less strongly than the instance currently requires
  comes out of a password change at full current strength.
- Deleting the account removes the account, everything in the vault,
  and every open session. Signing in afterwards fails.
- Deleting requires both the correct password and the correctly typed
  username, checked by the server and not only by the dialog. A request
  that skips the dialog entirely still cannot delete with either one
  wrong.
- Any vault owner can delete their own account, whoever else is on the
  instance. No vault is exempt.
- The delete dialog offers exporting first as its main action.
- The list of open sessions shows only the person's own sessions, never
  anyone else's, and carries no IP address and no device information,
  because none is recorded anywhere.
- Signing out ends the current session and leaves another session on
  the same account working. Signing out everywhere ends that one too,
  including the current one.
- The idle lock is fifteen minutes unless changed, can be set between
  five and sixty, survives signing out and back in, follows the person
  to another device, and is not readable by anybody holding the
  machine.
- There is no setting, anywhere, that turns the idle lock off. A vault
  carrying a nonsense value for it still locks, at the nearest
  allowed setting.
- Renaming a dimension or one of its values changes no account.
- Reordering a dimension's values reorders the chart's bands, and
  changes no account.
- Archiving a dimension and restoring it puts every account back in
  exactly the band it was in, without touching a single account either
  way.
- Archiving one value moves its accounts to "Unassigned", and restoring
  it moves them back.
- Nothing on the dimensions screen can fail halfway across several
  accounts, because nothing it does writes to more than one place.
- A vault with no dimensions charts as a single total and works
  normally throughout.
- Two dimensions made in the same sitting never collide, whatever they
  are called.

## What it deliberately does not do

- **The main currency cannot be changed.** Every value ever recorded
  carries the rate that converted it at the time, so relabeling the
  currency would leave years of history denominated in the old one and
  the chart would silently add two currencies together. Making it
  changeable means recording which currency each historical rate points
  at and deciding what to do about the past, which is real work and not
  a toggle. Restoring a vault from a file is the one exception, and it
  is not a loophole: an import replaces the currency and the whole
  history together, so nothing is left over to mix.

  The cost is accepted rather than overlooked, and it falls on one
  person: somebody who moves country, or who picks the wrong currency
  in the moment they spend on that list at sign-up. Their route out is
  a new vault and their history entered again by hand. What earns that
  cost is the warning at the point of choice, which sits directly under
  the field and says the choice is permanent.
- **No password recovery here either.** Changing a password needs the
  current one. See `register.md`.
- **No "sign out everywhere except this one".** The only operation that
  keeps the current session alive is changing the password, which does
  it as part of the same act.
- **No IP addresses, no device names, no login history beyond open
  sessions.** It is metadata the product does not otherwise keep, and
  on a household instance it answers no question worth the record.
- **No soft delete, no grace period, no recycle bin** on deleting an
  account. There is no readable vault to hold in reserve.
- **No permanent delete of a dimension**, and no way to strip one from
  every account at once.
- **No cap on how many values a dimension has**, even though the chart
  only draws four separately.
- **No freeform tags.** Every way of labeling an account is a
  dimension, because a tag is a dimension with one value. Two
  vocabularies over the same accounts would mean two ways to spell one
  thing, and only one of them can be stacked and summed honestly.

## Decisions taken on the client's behalf

- **The idle lock is fifteen minutes unless changed, adjustable between
  five and sixty, and cannot be switched off.** Both ends are chosen.
  Unlocking is never free, so a fixed fifteen would be a tax on a long
  sitting, and no lock at all would undo the defense against somebody
  walking up to an open screen.
- **Changing a password signs out other sessions but not this one.**
  The alternative, signing everybody out including the person who just
  changed it, is defensible and more cautious. Keeping the current
  session is the friendlier default and there is no stolen key to
  invalidate, because the key never changed.
- **Deleting a dimension archives it instead.** Nobody asked for
  archiving. It exists because the honest alternative, editing every
  account to remove a setting, can fail halfway.
- **Open sessions are listed at all.** Nobody asked for the list. It
  is the only way a person can tell whether they are still signed in
  somewhere else, given that there is no other trace of it anywhere.
