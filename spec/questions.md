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

- **engineer**: `features/login.md`, Acceptance criteria, has
  criteria the suite does not yet assert, each a test to write rather
  than a behaviour to change:
  - exceeding the per-account attempt limit locks the account, with
    the same response shape for a nonexistent account.
  - the login request body carries nothing derived from the Master
    Key, and the password appears in no request, observed on the wire
    in the browser.
  - a wrong password and an unknown username produce identical
    client-visible errors on the sign-in card.
  - the derivation compared by code path across both kinds, where
    `tests/client/run.mjs` compares only the output of one call.
  - an administrator's stored verifier is a hash over the HKDF Auth
    Key and not over the raw Argon2id output.
  - a KDF upgrade leaves the DEK unchanged, proven by decrypting a
    record written before it, and raising the server's default memory
    parameter and signing in leaves every record decryptable. The
    server tests upgrade with random bytes, which proves the rows
    change but not that the vault still opens.
  - an upgrade answered with Server Error leaves the caller signed in
    and able to sign in again at the old parameters.

- **engineer**: `ui/dimensions.md` commits an inline rename on Enter
  or on blur, and `ui/design-system.md`, Components, says an inline
  rename is saved by an explicit action because a field that saves on
  blur turns clicking away into a write. The implementation follows
  `dimensions.md`. The two cannot both hold, and the designer owns
  both files. `dimensions.md` also says a blank label keeps what was
  typed, where the implementation restores the stored label.
