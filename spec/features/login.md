# Login

## What it does

One flow signs in both kinds of account. The browser fetches the salt
and KDF parameters, derives the Master Key and Auth Key, and sends only
the Auth Key. The server verifies it against a stored hash and starts a
session. For a vault owner it also returns the wrapped DEK, which the
browser unwraps. Master Key and unwrapped DEK live in browser memory
for the session only — never in localStorage or sessionStorage. For an
administrator there is no wrapper, and the Master Key the browser
derived is discarded.

Every field this feature reads or writes belongs to the account's
**`password` credential row** (architecture.md, Credentials and vault
key wrappers): its `params` hold the salt and KDF envelope, its
`verifier` holds the Auth Key hash. The `dek_wrappers` row keyed to
that credential is the wrapper this flow returns when one exists. The
`principals` table is touched for identity and `last_login_at` alone.
v1 has no other credential method, and this feature specifies none.

**Kind is invisible until the credential verifies.** Steps 1 and 2
below are byte-identical for a vault owner, an administrator, and a
username that does not exist. This is a hard property, not an
incidental one, and Rules and Acceptance criteria below both pin it.

## Flow

1. `POST /api/auth/salt` `{ username }` → `{ salt, kdf }`, which is the
   `password` credential's `params` and nothing else. Returns a real
   salt + envelope for a known account **of either kind**, and a
   **deterministic decoy** `HMAC(server_secret, normalized_username)`
   truncated to 16 bytes, plus the server's current default KDF
   envelope, for an unknown one. Responses must be identically shaped
   and constant-time (architecture.md, Login enumeration). **The
   response carries no field naming, implying, or derivable into the
   account's kind**, and there are only two fields, so adding one is
   the failure mode to watch for. This endpoint answers an
   unauthenticated caller, which is why `params` carries nothing secret
   and the Auth Key hash is a separate column.
2. Client derives Master Key + Auth Key in a Web Worker. **Both
   halves, always**, because the client does not yet know whether it
   will need the Master Key (architecture.md, Administrator
   credentials).
3. `POST /api/auth/login` `{ username, authKey }` → on success, sets the
   session cookie, writes `last_login_at`, and returns
   `{ kind, kdfStale }` plus, for a vault owner only, `wrappedDek` and
   `dekNonce`. That wrapper is the one belonging to the credential the
   caller just authenticated with, never a list (architecture.md, One
   key, N wrappers). An **unknown username still runs a full Argon2id
   verification** against a fixed decoy hash and discards the result.
   Without it the endpoint answers in microseconds for accounts that do
   not exist and in tens of milliseconds for ones that do, which
   reveals existence by timing and throws away the work the decoy salt
   did one step earlier.
4. **A vault owner** unwraps the DEK with the Master Key. **A failed
   unwrap is itself an authentication failure** — treat it as a wrong
   password and surface the same error, do not silently continue with
   a dead key. **An administrator** discards the Master Key and lands
   in the admin area.
5. If `kdfStale` is true, run the KDF upgrade below.

`kind` is an explicit field rather than something the client infers
from the presence of `wrappedDek`. A client that branches on a missing
field treats a truncated or malformed response as an administrator
login, which is the one wrong guess that must not be cheap to make.
The field is safe to return because it is read only after the
credential verified: it tells the caller a fact about the account whose
password they have just proven they know.

The wrapper lookup happens **after** verification, keyed on the
credential id, and is an indexed read against an Argon2id verification
that costs 64 MiB. It is not a timing signal and it is not on the
pre-authentication path.

## Stale-KDF upgrade

**This is the only path by which an account's KDF parameters are
raised**,
and therefore the path by which the Argon2id memory parameter is raised
if Safari's WebAssembly engine gets faster (architecture.md, Why 64 MiB
and not more). The operator raises the server's default envelope, and
every vault follows on its owner's next login, with no migration, no
re-encryption, and no prompt. There is no other mechanism, which is why
the envelope is stored per vault rather than compiled in.

When the stored envelope is weaker than the server's current default,
the login response sets `kdfStale: true` and includes the target
envelope. **Both kinds run this**, because both derive a password with
Argon2id and both are attacked offline through `verifier`. After a
successful sign-in the client, without user interaction:

1. Generates a fresh 128-bit salt.
2. Re-derives Master Key' + Auth Key' from the still-in-memory password
   using the target parameters.
3. **A vault owner** re-wraps the existing DEK under Master Key'. An
   administrator has nothing to re-wrap and skips this.
4. `POST /api/auth/upgrade-kdf` `{ salt, kdf, authKey }`, plus
   `wrappedDek` and `dekNonce` for a vault owner, against the
   authenticated session. In one transaction the server replaces the
   **`password` credential row** (its `params` and its `verifier`) and,
   for a vault owner, that credential's **one `dek_wrappers` row**. No
   other row changes, and no other credential is touched, because the
   DEK is the same key afterwards and every other wrapper still opens
   it (architecture.md, One key, N wrappers).

The endpoint is named for the upgrade rather than the re-wrap because
the re-wrap is the half that an administrator does not have, while the
KDF upgrade is the half that both need. The server discriminates on the
session's principal kind, not on which fields the client sent: a vault
owner's request without a wrapper is a Bad Request, and an
administrator's with one is too. Letting the payload decide would let a
client silently skip re-wrapping a real vault and leave its wrapper
opening under a superseded Master Key.

The DEK itself does not change, so **no vault record is re-encrypted**.
If the upgrade POST fails, the session continues normally on the old
parameters and retries on the next sign-in — a failed upgrade must
never lock anyone out.

## Inputs / outputs

- In (browser only): password.
- In (over the wire): username, Auth Key.
- Out: session cookie carrying an opaque session token only — no key
  material of any kind, and no principal id (architecture.md,
  Application hardening). Plus `kind` and `kdfStale`, and, for a vault
  owner, wrapped DEK + nonce.

## Rules

- **Nothing pre-authentication branches on kind.** The salt response,
  the client derivation, the Auth Key on the wire, the server-side
  Argon2id over it, the rate-limit keying, and the lockout response
  are the same operations in the same order for both kinds. There is
  no point in the flow before a verified credential at which the
  server needs to know the kind, and there must not become one. A
  second credential method added later inherits this: its
  pre-authentication step must be kind-blind as well as carrying its
  own decoy (architecture.md, Credentials and vault key wrappers).
- **Residual enumeration leak, accepted.** A decoy always carries the
  server's *current default* KDF envelope, while a real account can
  carry a stale one — that is the whole reason the KDF upgrade above exists. So
  any account not yet upgraded is distinguishable from a decoy by its
  envelope, and the defense only fully holds once every user sits at
  current parameters. This is accepted rather than closed: the audience
  is a small invited household, registration already accepts enumeration
  (register.md), and the alternative — decoys drawing from the set of
  historical parameter sets — would mean the server tracking every
  parameter set it has ever used, forever, for a threat this deployment
  does not face. Do not write a test asserting a stale-envelope account
  is indistinguishable; it is not.
  - **It leaks existence, never kind.** A stale envelope says an
    account was registered before the current default and nothing
    about whether it owns a vault, because both kinds carry an
    envelope and the same flow upgrades both. Do not let this accepted
    leak grow into a kind leak by, for instance, registering
    administrators at a different envelope.
- The Auth Key is stored server-side hashed with Argon2id at modest
  server-side cost (starting point: 64 MiB, 2 iterations). The Auth Key
  is already high-entropy, so this is defense in depth, not the primary
  work factor — the expensive derivation happens client-side.
- Auth Key comparison is constant-time.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`
  (architecture.md, Application hardening).
- **Idle lock, for a vault owner**: after the user's configured idle
  period (5–60 minutes, default 15 — account-settings.md) the client
  discards the Master Key,
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
- **No idle rule for an administrator**: nothing is decrypted, so
  there is nothing for a lock to take away, and the idle lock never
  bounded the server session for a vault owner either
  (account-settings.md, Session and lock, which owns the reason). An
  administrator session is bounded by the absolute expiry and by
  signing out.
- **Session lifetime**: server-side session expires 12 hours after
  issue, absolute, not sliding. Both kinds, unchanged, and for an
  administrator it is the only bound.
- A page refresh discards in-memory keys by definition and requires
  re-entering the password.
- The session is rotated (new session id) on successful login.

## Edge cases

- **Unknown username** → decoy salt; the client wastes the same
  derivation time and gets the same-shaped failure at step 3. Timing of
  the salt response must not vary with existence, nor with the kind of
  an account that does exist.
- **Wrong password** → derivation succeeds, Auth Key mismatches; generic
  "Invalid username or password."
- **Correct Auth Key but DEK unwrap fails** → treated as a failed login
  and logged server-side as an anomaly; this indicates corruption or
  tampering, not a typo.
- **Rate limiting**: per-account and per-IP on both `/api/auth/salt` and
  `/api/auth/login`, exponential backoff, lockout with operator alerting
  (architecture.md, Rate limiting). Lockout responses must not reveal
  whether the account exists.
- **Already-authenticated caller hits `/login`** → redirect to the
  root path, which resolves by kind (app-shell.md, The two surfaces).
  For a vault owner, keys are still only in memory, so if they were
  lost to a refresh the client must prompt to unlock rather than
  render an empty vault. For an administrator there is nothing to
  prompt for and the admin area renders.
- **A login response arrives with `kind` absent** → the client treats
  it as a failed login rather than defaulting to either kind. TLS
  makes this unreachable in practice. The rule exists so the client
  never has a "kind absent" branch to get wrong.
- **Clock skew / expired session mid-request** → API returns
  Unauthorized with a machine-readable code; the client prompts for
  re-unlock rather than discarding unsaved input.

## Acceptance criteria

- A valid vault owner username + password logs in, and the client
  holds a working DEK proven by decrypting the profile record.
- A valid administrator username + password logs in, the response
  carries `kind: administrator` and **no `wrappedDek` and no
  `dekNonce`**, and the session reaches the admin area.
- The login request body contains the Auth Key and nothing derived from
  the Master Key; the password appears in no request.
- The session cookie contains no key material, and carries `HttpOnly`,
  `Secure`, `SameSite=Lax`.
- `/api/auth/salt` returns the same response shape, same status, and
  statistically indistinguishable timing for a known and an unknown
  username; the decoy salt for a given username is stable across calls.
  Asserted for an account **at current KDF parameters** — a
  stale-envelope account is knowingly distinguishable (see Rules).
- `/api/auth/salt` for an administrator's username, a vault owner's
  username, and an unknown username are indistinguishable from each
  other in body shape, field set, status, and timing, asserted as a
  three-way comparison, with all three accounts at current KDF
  parameters. This is the enumeration test that matters most in the
  two-kind model, because it is the one an added field would break
  silently.
- `/api/auth/login` with a **wrong** Auth Key against an
  administrator's username, a vault owner's username, and an unknown
  username produce byte-identical responses and statistically
  indistinguishable timing.
- The client's key derivation is byte-identical for both kinds:
  asserted by running the derivation against an administrator's salt
  and envelope and a vault owner's and comparing the code path taken,
  not only the output.
- An administrator's stored `verifier` is an Argon2id hash over an
  Auth Key derived through the same HKDF split as a vault owner's, and
  the raw Argon2id output is not what was hashed, asserted by
  deriving both in a test and checking which one verifies.
- No response from `/api/auth/salt` names, implies, or permits
  deriving the kind of the account, asserted against the endpoint's
  full response shape so the test fails if a field is added later.
- Wrong password and unknown username produce identical client-visible
  errors.
- A vault owner whose stored KDF envelope is below the server default
  is transparently upgraded on login: salt, envelope, Auth Key hash,
  and wrapped DEK all change; the DEK is unchanged, proven by
  decrypting a record written before the upgrade.
- An administrator whose stored envelope is below the server default
  is upgraded the same way: salt, envelope, and Auth Key hash change,
  no `dek_wrappers` row is created, and the new password still signs
  them in.
- That upgrade writes the account's `password` credential row and, for
  a vault owner, that credential's wrapper, and nothing else,
  asserted by comparing every other row of `principals`,
  `credentials`, and `dek_wrappers` before and after.
- `POST /api/auth/upgrade-kdf` carrying a wrapper from an
  administrator session is a Bad Request and writes nothing. The same
  request from a vault owner session *without* a wrapper is also a Bad
  Request and writes nothing.
- Raising the server's default Argon2id memory parameter and logging in
  leaves the vault stored at the new value, with every record still
  decryptable. This is the test that the parameter has a live upgrade
  path rather than a documented one.
- `POST /api/auth/login` returns at most one wrapper and no field
  naming, counting, or describing any other credential.
- If `/api/auth/upgrade-kdf` returns Server Error, the caller stays
  signed in and can still sign in afterwards with the old parameters.
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
