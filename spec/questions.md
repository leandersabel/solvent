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

- **engineer**: `rate-lookup.md`, SSRF and egress hardening pins the
  symbol allowlist as `^[A-Z0-9][A-Z0-9._-]{0,15}$`, and Seeded symbols
  names the generative rule `<ISO 4217 metal code>-<unit>` with unit
  `ozt` or `g`. No seeded metal matches the regex, so the proxy refuses
  every one of them, gold included. The implementation widened the case
  range to `^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$`, which leaves every SSRF
  property intact and lets the seeded table resolve. Which of the two
  the spec means is the architect's to settle: the regex, the unit
  suffixes, or the pairing.
