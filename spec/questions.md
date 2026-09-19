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

## Backup and restore: the username in a backup's filename   [asked by: designer]

A downloaded backup's contents deliberately name nobody. That is what
lets a file be handed to another household member, or found by a
stranger, without saying whose vault it came from, and it is recorded
as a decision rather than an accident. The filename the download
arrives under undoes it: it is built from the account's username, so
the one thing the contents were designed not to say is written on the
outside, readable before anybody types a password.

Which is wanted:

1. **Name the file by date alone.** The backup on a disk says only
   that it is a Solvent vault and when it was made. Cost: somebody
   holding backups of two vaults in one folder sees files that differ
   only by date, and has to rename them or keep them apart themselves.
2. **Keep the username in the filename.** Cost: a backup on a lost
   stick names the account it came from, which is the property the
   file's contents exist to avoid, and the product's claim that a
   backup names nobody stops being true.
3. **Ask the person for a name as the download starts.** Cost: the
   browser saves without asking in most setups, so for most people
   this changes nothing while looking like it was addressed.

Recommendation: the first. The second is the only one that contradicts
a stated property of the product, and the cost of the first falls on a
person who is already deliberately keeping two vaults' backups and can
rename a file.

## Net worth view: does the rates control move the chart?  [asked by: designer]

`product/net-worth-view.md` says switching to "Rates as of each figure"
changes the total, the list and the breakdown and leaves the chart
"pixel for pixel the same", and that in that position the total is
deliberately no longer the chart's right hand edge.
`features/net-worth-view.md` says the pricing mode toggle "reprices
every point of every band", so that the chart and the headline figure
can never disagree about which prices they used. Both cannot hold.
`ui/dashboard.md` is written to the product file: the control changes
the total, the accounts table and the breakdown, and leaves the chart
alone. If the feature file is right instead, the hero figure, the
chart and the product file's own acceptance line all change.

## Net worth view: are the chart's entry marks on by default?  [asked by: designer]

`product/net-worth-view.md` says the dates something was recorded on
are marked from the moment the chart loads, and names the control that
removes them "Just the line". `features/net-worth-view.md` says
inferred stretches are marked by a "Show what's estimated" toggle,
default off. `ui/design-system.md` defines a single mark serving both
readings, a tick under the axis at every date a real quantity was
recorded, which makes the two defaults contradict each other rather
than describe two controls. `ui/dashboard.md` is written to the
product file: marks on when the screen loads, "Just the line" takes
them away. If the feature file is right, the chart loads unmarked and
the marks become click targets only once somebody turns them on, which
is the only route from the chart into a recording.
