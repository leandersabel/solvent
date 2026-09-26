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

- **engineer**: `features/export-import.md`, Acceptance criteria, says a
  `POST /api/import` payload with a `principalId` field naming another
  user "writes nothing into that user's vault" and that "the records
  land under the session user", which reads as the import succeeding.
  `features/record-api.md`, Rules, says a body carrying `principalId`
  is rejected outright and no row is written under either user. The
  server follows record-api: the whole payload is a Bad Request, and
  neither vault changes. Which one holds decides whether that import is
  refused or goes through with the field ignored. Until it is settled
  the criterion is asserted only in its first half, so export-import
  is not marked verified.
- **engineer**: `ui/design-system.md`, Components, Dialog, says a
  destructive dialog is "one confirmation, never a ladder and never a
  word to type back". `features/manage-accounts.md` requires typing the
  holding's name to delete it permanently, and
  `features/export-import.md` requires typing `ERASE` to replace a
  vault that holds records. The code follows the feature files. Is
  the design-system rule meant to exempt these two, or should one of
  them change?
- **engineer**: `features/export-import.md`, Edge cases, says an empty
  vault exports "a file with an empty `records` array", and the review
  and the `ERASE` rule in `ui/export-import.md` speak of a vault that
  "holds nothing". A registered vault always holds its profile record,
  so its export carries that one record and never an empty array. The
  import screen treats a vault holding only its profile as empty: it
  says nothing will be deleted and asks for no typed word. Is the
  profile alone "nothing" for the review and for `ERASE`, and should a
  file with no profile record at all, which would restore a vault with
  no main currency, be refused?
