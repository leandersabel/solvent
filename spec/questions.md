# Open questions

Open questions only, each tagged with the agent that asked it. A
question is removed when the spec file that answers it has been edited,
and the decision lives there, not here. Who may put one to the client
is in `CLAUDE.md`, Who asks the client.

Format:

```
## <feature>: <short title>          [asked by: architect]

What is undecided, and what it changes.
```

## login: who reports a failed unwrap as an anomaly          [asked by: engineer]

`features/login.md`, Flow step 4 and Edge cases, and `ui/unlock.md`,
States, say a correct Auth Key whose wrapper will not unwrap is logged
server-side as an anomaly. The unwrap happens in the browser after the
login already answered OK, so the server never sees it fail, and no
endpoint exists for the client to report it. Today the card shows the
generic error and nothing is logged. Either an endpoint is specified
for the report, with what it may carry, or the server-side log is
dropped from both files. `product/login.md`, What must be true, also
tells the client that such a password is "reported to the operator as
an anomaly rather than shown to you", so dropping the log changes a
product statement as well, which is the product owner's to change.
