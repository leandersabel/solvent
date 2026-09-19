# Login

## What it does

A user unlocks their vault. The browser fetches the salt and KDF
parameters, derives the Master Key and Auth Key, and sends only the Auth
Key. The server verifies it against a stored hash, starts a session, and
returns the wrapped DEK. Master Key and unwrapped DEK live in browser
memory for the session only — never in localStorage or sessionStorage.

Every field this feature reads or writes belongs to the vault's
**`password` unlock method row** (architecture.md, Vault key and unlock
methods): its `params` hold the salt and KDF envelope, its `verifier`
holds the Auth Key hash, and its `wrapped_dek` and `dek_nonce` are the
wrapper this flow returns. The `users` table is touched for identity
alone. v1 has no other unlock method, and this feature specifies none.

## Flow

1. `POST /api/auth/salt` `{ username }` → `{ salt, kdf }`, which is the
   `password` row's `params` and nothing else. Returns a real salt +
   envelope for a known user, and a **deterministic decoy**
   `HMAC(server_secret, normalized_username)` truncated to 16 bytes,
   plus the server's current default KDF envelope, for an unknown one.
   Responses must be identically shaped and constant-time
   (architecture.md, Login enumeration). This endpoint answers an
   unauthenticated caller, which is why `params` carries nothing secret
   and the Auth Key hash is a separate column.
2. Client derives Master Key + Auth Key in a Web Worker.
3. `POST /api/auth/login` `{ username, authKey }` → on success, sets the
   session cookie and returns `{ wrappedDek, dekNonce, kdfStale }`,
   which is the `password` row's wrapper: **one wrapper, the one the
   caller just authenticated with**, never a list (architecture.md, One
   key, N wrappers). An
   **unknown username still runs a full Argon2id verification** against
   a fixed decoy hash and discards the result. Without it the endpoint
   answers in microseconds for accounts that do not exist and in tens of
   milliseconds for ones that do, which reveals existence by timing and
   throws away the work the decoy salt did one step earlier.
4. Client unwraps the DEK with the Master Key. **A failed unwrap is
   itself an authentication failure** — treat it as a wrong password and
   surface the same error, do not silently continue with a dead key.
5. If `kdfStale` is true, run the re-wrap flow below.

## Stale-KDF re-wrap

**This is the only path by which a vault's KDF parameters are raised**,
and therefore the path by which the Argon2id memory parameter is raised
if Safari's WebAssembly engine gets faster (architecture.md, Why 64 MiB
and not more). The operator raises the server's default envelope, and
every vault follows on its owner's next login, with no migration, no
re-encryption, and no prompt. There is no other mechanism, which is why
the envelope is stored per vault rather than compiled in.

When the stored envelope is weaker than the server's current default,
the login response sets `kdfStale: true` and includes the target
envelope. After a successful unlock the client, without user
interaction:

1. Generates a fresh 128-bit salt.
2. Re-derives Master Key' + Auth Key' from the still-in-memory password
   using the target parameters.
3. Re-wraps the existing DEK under Master Key'.
4. `POST /api/auth/rewrap` `{ salt, kdf, authKey, wrappedDek, dekNonce }`
   against the authenticated session. In one transaction the server
   replaces the **`password` unlock method row only**: its `params`,
   its `verifier`, and its wrapper. No other row changes, and no other
   unlock method is touched, because the DEK is the same key afterwards
   and every other wrapper still opens it (architecture.md, One key, N
   wrappers).

The DEK itself does not change, so **no vault record is re-encrypted**.
If the re-wrap POST fails, the session continues normally on the old
parameters and retries on the next login — a failed upgrade must never
lock the user out.

## Inputs / outputs

- In (browser only): password.
- In (over the wire): username, Auth Key.
- Out: session cookie carrying an opaque session token only — no key
  material of any kind, and no user id (architecture.md, Application
  hardening); wrapped DEK + nonce; `kdfStale`.

## Rules

- **Residual enumeration leak, accepted.** A decoy always carries the
  server's *current default* KDF envelope, while a real user can carry a
  stale one — that is the whole reason the re-wrap flow above exists. So
  any account not yet upgraded is distinguishable from a decoy by its
  envelope, and the defense only fully holds once every user sits at
  current parameters. This is accepted rather than closed: the audience
  is a small invited household, registration already accepts enumeration
  (register.md), and the alternative — decoys drawing from the set of
  historical parameter sets — would mean the server tracking every
  parameter set it has ever used, forever, for a threat this deployment
  does not face. Do not write a test asserting a stale-envelope account
  is indistinguishable; it is not.
- The Auth Key is stored server-side hashed with Argon2id at modest
  server-side cost (starting point: 64 MiB, 2 iterations). The Auth Key
  is already high-entropy, so this is defense in depth, not the primary
  work factor — the expensive derivation happens client-side.
- Auth Key comparison is constant-time.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`
  (architecture.md, Application hardening).
- **Idle lock**: after the user's configured idle period (5–60 minutes,
  default 15 — account-settings.md) the client discards the Master Key,
  the DEK, **and every decrypted value derived from them** — the whole
  in-memory model, rendered figures, chart series, and any cached
  plaintext — then shows a re-unlock prompt. Dropping the keys alone
  would leave the lock cosmetic against the threat it exists for:
  another household member at the unlocked machine, who can open
  devtools. The server session may still be valid; unlocking re-derives
  the keys and **re-decrypts the vault from scratch**, so the reload
  after an idle lock is by design, not a missed cache.
  - **One named exception: unsaved form input the user typed**, which
    survives so a lock mid-entry does not destroy work (`ui/unlock.md`).
    It is what the user is about to commit, not vault content read back
    from the server, and it is scoped to the open form — nothing else
    decrypted is exempt. The same rule covers the manual lock button
    (`ui/design-system.md`, App shell) and a session expiring
    mid-request.
- **Session lifetime**: server-side session expires 12 hours after
  issue, absolute, not sliding.
- A page refresh discards in-memory keys by definition and requires
  re-entering the password.
- The session is rotated (new session id) on successful login.

## Edge cases

- **Unknown username** → decoy salt; the client wastes the same
  derivation time and gets the same-shaped failure at step 3. Timing of
  the salt response must not vary with existence.
- **Wrong password** → derivation succeeds, Auth Key mismatches; generic
  "Invalid username or password."
- **Correct Auth Key but DEK unwrap fails** → treated as a failed login
  and logged server-side as an anomaly; this indicates corruption or
  tampering, not a typo.
- **Rate limiting**: per-account and per-IP on both `/api/auth/salt` and
  `/api/auth/login`, exponential backoff, lockout with operator alerting
  (architecture.md, Rate limiting). Lockout responses must not reveal
  whether the account exists.
- **Already-authenticated user hits `/login`** → redirect to the
  dashboard; keys are still only in memory, so if they were lost to a
  refresh the client must prompt to unlock rather than render an empty
  vault.
- **Clock skew / expired session mid-request** → API returns
  Unauthorized with a machine-readable code; the client prompts for
  re-unlock rather than discarding unsaved input.

## Acceptance criteria

- A valid username + password logs in, and the client holds a working
  DEK proven by decrypting the profile record.
- The login request body contains the Auth Key and nothing derived from
  the Master Key; the password appears in no request.
- The session cookie contains no key material, and carries `HttpOnly`,
  `Secure`, `SameSite=Lax`.
- `/api/auth/salt` returns the same response shape, same status, and
  statistically indistinguishable timing for a known and an unknown
  username; the decoy salt for a given username is stable across calls.
  Asserted for a user **at current KDF parameters** — a stale-envelope
  account is knowingly distinguishable (see Rules).
- Wrong password and unknown username produce identical client-visible
  errors.
- A user whose stored KDF envelope is below the server default is
  transparently upgraded on login: salt, envelope, Auth Key hash, and
  wrapped DEK all change; the DEK is unchanged, proven by decrypting a
  record written before the upgrade.
- That upgrade writes the user's `password` unlock method row and
  nothing else, asserted by comparing every other row of `users` and
  `unlock_methods` before and after.
- Raising the server's default Argon2id memory parameter and logging in
  leaves the vault stored at the new value, with every record still
  decryptable. This is the test that the parameter has a live upgrade
  path rather than a documented one.
- `POST /api/auth/login` returns exactly one wrapper and no field
  naming, counting, or describing any other unlock method.
- If `/api/auth/rewrap` returns Server Error, the user stays logged in
  and can still log in afterwards with the old parameters.
- Exceeding the per-account attempt limit locks the account and returns
  the same response shape for a nonexistent account.
- `/api/auth/login` with an unknown username takes statistically
  indistinguishable time from one with a known username and a wrong Auth
  Key — asserted with the decoy-hash verification in place, since
  removing it is the regression this catches.
- After the configured idle period, an attempt to read vault data
  prompts for re-unlock, the in-memory keys are gone, **and no decrypted
  account name, value, or snapshot remains reachable** — asserted
  against the in-memory model, not only the key handles. Unsaved input
  in an open form is the one thing still present.
- Re-unlocking after an idle lock refetches and re-decrypts the vault;
  it does not restore a model kept across the lock.
- A test asserts no key material is written to `localStorage` or
  `sessionStorage` at any point in the flow.
