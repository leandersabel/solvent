# Account settings

## What it does

Everything you control about your own account: your password, the
currency your vault counts in, how long it stays unlocked, which
sessions are open, how your holdings are grouped, and, at the bottom,
deleting the whole thing.

Nothing here can recover a lost password. The rules that are fixed for
good are shown alongside the ones you can change, rather than hidden.

Who it is for: every person with a vault, about their own vault only.
This screen exists only inside a vault, so an administrator account
never reaches it. Provisioning the instance is a different account's
job (`admin-invites.md`).

## The screens

### Settings

One page, stacked cards, reached from the main navigation.

#### Profile

Username, shown, not editable.

**Main currency**, shown, not editable, with the reason in one line:
it was fixed when the vault was created, every rate recorded since
converts into it, so changing it would mix two currencies in the same
history. There is no field here, not a disabled one.

#### Dates and numbers

How figures and dates are written for you, and nothing else. Every
figure is stored exactly as you entered it and every date is stored
the same way for everyone, so changing anything here rewrites nothing
and can be changed back.

- **Language**, which sets the rest. It starts as whatever your
  browser is set to, so most people never touch it.
- **Dates**, the order and separator: 20.09.2026, 2026-09-20 or
  09/20/2026. This also sets the calendar you pick a date from, which
  is why Solvent draws its own: the one built into a browser is
  written in the browser's language and no site can change it.
- **Thousands**, the mark between groups of three: a thin space, an
  apostrophe, a comma, a period, or nothing.
- **Decimals on money**, two or none. None is for people who do not
  want to look at centimes. It rounds what is shown, never what is
  held. It applies to money only. A quantity of something that is not
  money keeps exactly the decimals you typed, never rounded and never
  padded with zeros: 12.125 ounces of gold reads 12.125, never 12.12,
  and 80 m² reads 80, never 80.00.

Each of the last three starts at whatever the language does and can
be set against it, because a language is a coarse guess at taste. A
Swiss reader may want an apostrophe between thousands and no
centimes, and no language says that.

A sample line shows the choice before it is saved.

The settings live in the vault, so they follow you to any browser you
sign in from.

#### Organizing

Link rows out to screens that do not belong inside a settings card:

- **Dimensions**, described as how holdings split up in the chart, with
  how many exist right now, or "None yet".
- **Export and import** (`export-import.md`), described as downloading
  the vault or restoring one from a file.

#### Change password

Current password, new password, confirm, with the same strength gauge
as registration (`register.md`) and the same bar.

Three things are said here, most surprising first:

- Changing the password does not re-encrypt the vault. Only the lock
  around the key is rebuilt, which is why it is instant even on a large
  vault. Said as reassurance, because otherwise the speed reads as
  nothing having happened.
- **Export files already saved still open with the old password.** They
  carry their own copy of the lock. Changing the password here does not
  reach back and protect a file already downloaded. This carries a
  warning icon, because it is the one way you can believe you have
  locked something you have not.
- Other sessions were signed out. The current one stays, and you do
  not have to sign in again after changing your own password. Nothing
  is gained by ending it, because the key never changed and there is no
  stolen copy of it to invalidate.

A wrong current password is caught before anything is sent, and is
reported plainly.

#### Session and lock

- **Idle lock**, five to sixty minutes, fifteen unless changed. One
  line of honest tradeoff beneath it: shorter is safer, and every
  unlock costs the deliberate wait while the password becomes a key
  (`login.md`, which owns how long that is). Being adjustable is what
  keeps that wait from taxing a long sitting. There is no "never", and
  the control does not offer one (`login.md` says why).
- **You are signed out twelve hours after signing in, regardless of
  activity.** Stated, not adjustable.
- **Open sessions**, listed by when each started and when it was last
  used, with a line volunteering that Solvent records no IP addresses
  and no devices. Anyone who has used another product assumes those
  are kept. The list is the only way you can tell whether you are still
  signed in somewhere else, because there is no other trace of it.
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

Nobody's vault is undeletable. Handing out accounts is not something a
vault owner can do, so no deletion here can leave the instance unable
to.

### Dimensions

A dimension is an axis holdings are sorted along: "Liquidity", with
values Cash, Investments, Retirement. Each holding takes one value per
dimension, which is what lets the bands of the chart add up to exactly
the net worth. This screen is where they are renamed, reordered, put
away, and brought back. Creating one also happens on the form for
adding or changing a holding (`manage-accounts.md`), and how they are
drawn belongs to the dashboard (`net-worth-view.md`).

One card per dimension, in the order they appear in the dashboard's
grouping control, so dragging a card here changes that order too.

Each card shows:

- Its **name**, editable in place. Renaming is instant and free, and
  touches no holding.
- Its **coverage**, the same figure the dashboard shows: "7 of 10
  holdings assigned", with the unassigned ones a click away. A
  dimension covering a third of the holdings draws a chart that is
  accurate and useless, and this is where that shows, at setup rather
  than in a confusing chart later.
- Its **values**, in the order they stack in the chart, each draggable,
  renamable, and archivable. This order is never sorted by size: a
  stack whose bands swap places from month to month cannot be read.
- Adding a value, and archiving the whole dimension.

Beneath the cards: creating a dimension, and a collapsed "Archived"
section when there is anything in it.

**Creating a dimension** asks for a name and a first value, because a
dimension with no values sorts nothing. The same dialog offers a
**flag**: a dimension with exactly one value, which that form shows as
a checkbox rather than a list. That is the shape a yes-or-no label such
as "Emergency fund" takes, and making one is as quick as typing a tag.

**Past four values**, a note appears under the list, not a warning and
not a cap: the chart shows the first four and folds the rest into
"Other", and all of them are still tracked. Four is a limit on how many
bands can be told apart on screen, not a limit on the data.

**Deleting is called archiving**, and the dialog says why in one line:
archiving keeps every holding's assignment, and restoring brings every
holding back to the band it was in. An archived dimension simply stops
appearing, on that form, in the grouping control, and in the chart. An
archived value moves its holdings to "Unassigned".

There is no permanent delete and no "remove this from all my
holdings". Stripping a setting out of every holding is a destructive
sweep that can fail halfway, in exchange for a scrap of leftover data
nobody reads. An archived definition costs one line and buys exact
reversibility.

The first time you open this screen it explains the word, because
"dimension" is the least self-explanatory thing in the product, with
one concrete example and one button. Nowhere else in the app nags about
it: a vault with no dimensions is completely usable and charts as a
single total.

## What must be true

- The main currency is shown and cannot be changed, and the screen says
  why.
- Getting to settings from the top bar does not ask for the password
  again. Nowhere a vault owner can navigate to asks twice in one
  sitting.
- Dates and figures on every screen are written the way the settings
  say, the calendar you pick a date from included.
- A date typed the way the settings write it is accepted. A date that
  does not exist is refused rather than quietly moved.
- Changing any of the date or number settings and changing it back
  leaves every stored figure and date exactly as it was.
- A quantity of something that is not money shows exactly the
  decimals you typed, on every screen and whatever Decimals on money
  says: no digit dropped, no zero added.
- The settings come back the same on another browser, because they
  live in the vault.
- Changing the password works, and afterwards everything written under
  the old password still reads correctly, in the same session and after
  signing in fresh.
- The old password no longer signs in and the new one does.
- Neither password, old or new, ever leaves the browser.
- A wrong current password changes nothing, and is caught before
  anything is sent. A doctored request that skips the browser check is
  still refused.
- Changing the password signs out every other session and leaves the
  current one alone. You do not have to sign in again after changing
  your own password.
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
- The list of open sessions shows only your own sessions, never anyone
  else's, and carries no IP address and no device information, because
  none is recorded anywhere.
- Signing out ends the current session and leaves another session on
  the same account working. Signing out everywhere ends that one too,
  including the current one.
- The idle lock is fifteen minutes unless changed, can be set between
  five and sixty, survives signing out and back in, follows you to
  another device, and is not readable by anybody holding the machine.
- There is no setting, anywhere, that turns the idle lock off. A vault
  carrying a nonsense value for it still locks, at the nearest
  allowed setting.
- Renaming a dimension or one of its values changes no holding.
- Reordering a dimension's values reorders the chart's bands, and
  changes no holding.
- Archiving a dimension and restoring it puts every holding back in
  exactly the band it was in, without touching a single holding either
  way.
- Archiving one value moves its holdings to "Unassigned", and
  restoring it moves them back.
- Nothing on the dimensions screen can fail halfway across several
  holdings, because nothing it does writes to more than one place.
- A vault with no dimensions charts as a single total and works
  normally throughout.
- Two dimensions made in the same sitting never collide, whatever they
  are called.

## What it deliberately does not do

- **The main currency cannot be changed.** Every rate ever recorded
  converts into it, so relabeling the currency would leave years of
  history denominated in the old one and the chart would silently add
  two currencies together. Restoring a vault from a file is the one
  exception and not a loophole: an import replaces the currency and the
  whole history together, so nothing is left over to mix.

  The cost falls on one person: somebody who moves country, or who
  picks the wrong currency in the seconds they spend on that list at
  sign-up. The route out is a new vault and the history entered again
  by hand. What earns that cost is the warning directly under the
  field, at the point of choice, saying the choice is permanent.
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
- **No freeform tags.** Every way of labeling a holding is a
  dimension, because a tag is a dimension with one value. Two
  vocabularies over the same holdings would mean two ways to spell one
  thing, and only one of them can be stacked and summed honestly.
