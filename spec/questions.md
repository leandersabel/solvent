# Open questions

Open questions only. Each is tagged with the agent that asked it. A
question is removed when the spec file that answers it has been
edited, and the decision lives there, not here.

Only the product owner puts a question to the client, and only after
translating it out of technical vocabulary. Everything else is decided
by the agent that owns the file.

Format:

```
## <feature>: <short title>          [asked by: architect]

What is undecided, and what it changes.
```

## login: the administrator sign-in wait   [asked by: architect]

`spec/product/login.md`, "Signing in as an administrator", says an
administrator sign-in is quick because there is no key to build. The
same section says the screen must not reveal, before a correct
password has been typed, that a username belongs to an administrator.

Those two cannot both hold. The wait happens in the browser, before
anything is sent to the server. For the browser to skip it, it has to
know the account is an administrator, and the only thing that could
tell it is the response to typing the username, which the app hands
to anybody who asks. A quick sign-in for administrators is therefore
a stopwatch that reads out which usernames are administrators, to
somebody who never has to guess a password. It is a better oracle
than the one the decoy design exists to close, because it needs no
network access and no tooling.

`spec/features/login.md` currently resolves it the second way, and
the product file needs to change to match whichever is chosen.

- **Administrators wait too.** One or two seconds on a phone, a
  fraction of a second on a desktop, spent building a key that is
  thrown away. Nobody can time the screen to find the
  administrators. Costs nothing to build, because it is the flow that
  already exists.
- **Administrators sign in fast, and the instance accepts that
  administrator usernames are discoverable.** Anybody who can reach
  the sign-in page can find out who administers the instance, then
  aim password guessing at exactly those names. The rate limits still
  apply. Costs nothing to build either.
- **Administrators sign in fast, and the wait is faked for
  everybody.** The screen holds the fast path back for the same
  duration. Only as good as the fake, which has to match a real
  derivation on hardware the developer does not have, and it is the
  kind of control that quietly stops matching after any change to the
  key parameters.

Recommended: the first. The wait is the one thing on this screen the
product already explains to the person in plain words, and an
administrator paying it two or three times a week is a small price
for the property.

## admin-invites: re-entering the password to remove an account   [asked by: architect]

An administrator account now holds exactly one kind of power: creating
accounts and destroying them. It holds nothing else, because it has no
vault of its own. Removing a vault owner destroys that person's
financial history permanently, and nobody, including the
administrator, can make a copy of it first.

Today that removal asks the administrator to type the username of the
person they are removing, and nothing more. Anyone sitting at an
administrator's open browser can do it.

Whether to also require the administrator to type their own password
before a removal goes through is a choice between friction and
consequence, and it is not one engineering can settle.

- **Type the username only, as today.** Nothing to build. An unattended
  administrator session can destroy an account in two clicks, bounded
  only by the fifteen-minute idle timeout.
- **Type the username and the password, for every removal.** The
  administrator waits roughly two seconds on a phone and a fraction of
  a second on a desktop while the password is checked, every time they
  remove anyone. Costs a round of work in the admin area and the
  removal endpoint.
- **Type the username and the password only when removing a vault
  owner**, not when removing another administrator. Matches the cost to
  the consequence, since removing an administrator destroys no data.
  Costs the same work plus a rule that has to be explained on screen.

Recommended: the second. A removal is the only irreversible act in the
product that one person can perform on another person's data, and the
password is already something the administrator knows and the browser
already knows how to check.

## record-rate: where a price is corrected during a sweep   [asked by: architect]

A price belongs to a symbol, not to a holding. Two dollar accounts are
priced by one dollar rate on one date, and the split that separates
quantities from prices is what makes that true.

The sweep screen is one row per holding. If the price sits on the row
and is editable there, two rows in the same symbol can be typed with two
different prices for the same date, and one of them has to win silently.
If the price does not sit on the row, the person has nowhere to correct
a proposal they disagree with, and "the person sees a proposed rate and
may overwrite it" is not met.

This is a screen question created by the split, and it changes what the
sweep looks like. It does not change how anything is stored: one entry
per symbol per date either way.

- **A prices block on the sweep, separate from the holdings.** One line
  per symbol for the sweep's date, showing the proposal and taking an
  override, above or below the rows. Two holdings can never disagree,
  because there is only one place to type. Costs a second region on a
  screen that currently has one, and a person who never touches it never
  notices it is there.
- **The price stays on each holding's row, and editing it changes every
  holding in that symbol.** Nothing new on the screen. The row has to
  say what editing it will do, and the other rows have to visibly move
  when it is edited, or the person has changed a figure they were not
  looking at.
- **The price is read-only on the sweep, and corrections happen on the
  holding's own page afterwards.** The sweep stays exactly as wide as it
  is today. A person who can see the proposal is wrong has to leave the
  screen to fix it, and they will do the whole sweep at a price they
  know is wrong rather than break the flow.

Recommended: the first. A price is one fact about one symbol, and the
only shape where the person can see what they are changing is one that
names the symbol rather than a holding that happens to use it.
