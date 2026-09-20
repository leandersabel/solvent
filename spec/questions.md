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

- **engineer**: `design-system.md` says nothing about password
  managers, and every field the product builds is a fill target until
  it says otherwise. A manager offering to fill a holding name writes a
  stored login into an encrypted record, and the vault is the one place
  that content cannot be reviewed later by anyone but its owner. The
  implementation now marks every field off-limits by default and lets
  only the credential fields opt back in by declaring `autocomplete`.
  Whether that default belongs in the design system's Fields section is
  the architect's to settle.

- **engineer**: the client asked for settings not to charge the
  password a second time, and for a locale setting defaulting to the
  browser, covering dates and money, with the thousands mark and the
  decimals on money settable against the language. Both are built.
  Three files state the target: `product/account-settings.md` (Dates
  and numbers), `features/account-settings.md` (the profile record's
  four new keys, and how the one formatter answers), and
  `ui/settings.md` plus `ui/design-system.md` (the Date field
  component). Two contracts name what changed and were not re-emitted:
  `app-shell.json`, whose `surfaceVault` names `/settings` as a shell
  page where it is now a redirect onto the one vault page, and
  `account-settings.json`, which does not yet carry the profile
  record's new keys. The compiler owns both.

- **engineer**: the date field is hand-built, which is the only
  control in the product that reimplements one the platform provides.
  `input type=date` is written in the browser's locale and no page can
  change it, so an in-app locale setting cannot reach it. The
  alternative is to keep the native control and let the setting govern
  displayed dates only, which would mean a reader whose browser is in
  English types American dates into a product showing them Swiss ones.
  The designer owns confirming the component, which is specified in
  `design-system.md`, Components.
