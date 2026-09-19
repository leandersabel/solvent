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
