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
