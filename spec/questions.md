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

- **engineer**: the CSP in `architecture.md`, Application hardening
  forbade WebAssembly compilation, so the Argon2id derivation threw a
  `CompileError` in every browser and no account could be created or
  unlocked. `'wasm-unsafe-eval'` was added to `script-src` and the
  reason written into that section, because a policy the product
  cannot run under is not a policy. The architect owns confirming the
  wording, and the compiler owns re-emitting `app-shell.json`, whose
  `csp` parameter was edited by hand to match.

- **engineer**: six features are implemented and exercised but not
  fully verified, and the gap is the same shape in each. Three kinds
  of criterion have no harness yet. **Timing**, meaning the sign-in
  wait and the salt and login responses being statistically
  indistinguishable across both kinds and a stranger, which needs a
  sampling harness rather than a single call. **Two entries on one
  date**, for a holding and for a symbol, which needs records planted
  behind the client's own rules to reach the state at all. **The idle
  lock firing on its own timer**, which needs a clock the test can
  move. Each is a test to write rather than a behaviour to change, and
  the behaviour each one covers is built.
