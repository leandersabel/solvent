# Login

## What it does

A user unlocks their vault. The browser fetches the user's salt and KDF
parameters, derives the Master Key and Auth Key, and sends only the Auth
Key. The server verifies it against a stored hash, starts a session, and
returns the wrapped DEK. Master Key and unwrapped DEK live in browser
memory for the session only — never in localStorage or sessionStorage.

## Flow

1. `POST /api/auth/salt` `{ username }` → `{ salt, kdf }`. Returns a
   real salt + envelope for a known user, and a **deterministic decoy**
   `HMAC(server_secret, normalized_username)` truncated to 16 bytes,
   plus the server's current default KDF envelope, for an unknown one.
   Responses must be identically shaped and constant-time
   (architecture.md, Login enumeration).
2. Client derives Master Key + Auth Key in a Web Worker.
3. `POST /api/auth/login` `{ username, authKey }` → on success, sets the
   session cookie and returns `{ wrappedDek, dekNonce, kdfStale }`.
4. Client unwraps the DEK with the Master Key. **A failed unwrap is
   itself an authentication failure** — treat it as a wrong password and
   surface the same error, do not silently continue with a dead key.
5. If `kdfStale` is true, run the re-wrap flow below.

## Stale-KDF re-wrap

When the stored envelope is weaker than the server's current default,
the login response sets `kdfStale: true` and includes the target
envelope. After a successful unlock the client, without user
interaction:

1. Generates a fresh 128-bit salt.
2. Re-derives Master Key' + Auth Key' from the still-in-memory password
   using the target parameters.
3. Re-wraps the existing DEK under Master Key'.
4. `POST /api/auth/rewrap` `{ salt, kdf, authKey, wrappedDek, dekNonce }`
   against the authenticated session; the server replaces all five
   fields in one transaction.

The DEK itself does not change, so **no vault record is re-encrypted**.
If the re-wrap POST fails, the session continues normally on the old
parameters and retries on the next login — a failed upgrade must never
lock the user out.

## Inputs / outputs

- In (browser only): password.
- In (over the wire): username, Auth Key.
- Out: session cookie carrying a logged-in flag and user id only — no
  key material of any kind; wrapped DEK + nonce; `kdfStale`.

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
  default 15 — account-settings.md) the client discards the Master Key
  and DEK from memory and shows a re-unlock prompt. The server session
  may still be valid; unlocking re-derives keys from the password
  without a full re-login.
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
- **Clock skew / expired session mid-request** → API returns 401 with a
  machine-readable code; the client prompts for re-unlock rather than
  discarding unsaved input.

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
- If `/api/auth/rewrap` returns 500, the user stays logged in and can
  still log in afterwards with the old parameters.
- Exceeding the per-account attempt limit locks the account and returns
  the same response shape for a nonexistent account.
- After the configured idle period, an attempt to read vault data
  prompts for re-unlock, and the in-memory keys are no longer present.
- A test asserts no key material is written to `localStorage` or
  `sessionStorage` at any point in the flow.
