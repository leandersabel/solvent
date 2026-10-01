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

## register: the state of a new vault whose first read failed          [asked by: engineer]

A vault owner's registration succeeds and the new vault's first read of
its records then fails. `ui/register.md` says a vault owner is never
bounced to a sign-in screen to type the password they just chose
(States, Populated), but names no screen for this moment. The
implementation shows a card in the same document, headed "Your vault
is created", reading "It could not be read just now. Nothing was lost,
and you do not need to type your password again.", with a "Try again"
button that reads again with the keys it holds. The keys sit under the
idle lock while the card is up. Designer: please specify this state,
its copy, and whether it offers anything beside Try again.
