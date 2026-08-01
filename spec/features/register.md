# Register

## What it does

A person holding a valid invite link creates an account: picks a
username, a password, and their main currency. The browser sets up the
vault — generates a salt, derives Master Key and Auth Key via Argon2id,
generates and wraps a DEK, and encrypts an initial profile record —
before anything is sent to the server (architecture.md, Key management).

## Flow

1. `GET /register?invite=<token>` is server-rendered (Jinja). The page
   embeds the server's **current default KDF parameters** (algorithm,
   version, memory, iterations, parallelism) so no extra round-trip is
   needed. The server checks the token is well-formed, unused, and
   unexpired; an invalid token renders an error page with no form.
2. User enters username, password, password confirmation, and main
   currency (ISO 4217, from a fixed list).
3. Client generates a random 128-bit salt (`crypto.getRandomValues`).
4. Client derives Master Key + Auth Key from password + salt with the
   embedded parameters, generates a random 256-bit DEK, wraps the DEK
   under the Master Key (AES-256-GCM), and encrypts a profile record
   `{ mainCurrency, createdAt }` under the DEK.
5. `POST /api/register` with: invite token, username, Auth Key, salt,
   KDF parameter envelope, wrapped DEK + its nonce, and the profile
   ciphertext + nonce. **The password never leaves the browser.**
6. Server validates, stores, marks the invite used, and starts a
   session — the user lands logged in, keys already in memory.

## Inputs / outputs

- In (browser only): invite token, username, password, main currency.
- In (over the wire): invite token, username, Auth Key, salt, KDF
  envelope, wrapped DEK + nonce, profile ciphertext + nonce.
- Out: user row (username, salt, KDF envelope, Auth Key hash, wrapped
  DEK), profile record, invalidated invite, session cookie.

## Rules

- **Password policy is client-enforced by construction.** The server
  never sees the password, so it cannot verify length or entropy — the
  browser must refuse to submit a password below the bar, and this spec
  does not pretend it is a server-side control. Bar: **≥12 characters
  and a zxcvbn score of ≥3**, no composition rules (architecture.md,
  Password/passphrase policy).
- The registration screen must state plainly that **there is no password
  recovery** and require an explicit acknowledgement before submitting.
- Username is normalized (trimmed, lowercased) before storage and
  comparison. Allowed: 3–32 chars, `[a-z0-9._-]`.
- Server validates: salt is exactly 16 bytes; KDF envelope parameters
  are at or above the server's configured minimum (a client must not be
  able to register itself a weak KDF); wrapped DEK and profile blobs are
  within the size limits from architecture.md, Blob and quota limits.
- Main currency is stored **only inside the encrypted profile record**,
  never as a plaintext column.
- The invite is marked used in the **same transaction** as the user
  insert — a failed registration must not burn the invite, and a
  successful one must not leave it reusable.

## Edge cases

- **Invalid, expired, already-used, or revoked invite** → error page, no
  form rendered. All four render an identical message ("This invite link
  is not valid") so a probe learns nothing about which state applies.
- **Username already taken** → plain error, reported clearly. This
  endpoint is invite-gated and the audience is a small trusted household,
  so username enumeration *here* is **accepted** rather than defended;
  architecture.md's decoy-salt control covers *login*, where the attacker
  is unauthenticated. A failed attempt does not consume the invite, so an
  invite holder can probe repeatedly — understood and accepted.
- **Password fails policy** → inline client-side error, no submission.
- **Password and confirmation differ** → inline error.
- **Client cannot run WASM Argon2id** (very old browser) → hard failure
  with an explanatory message. There is no weaker fallback KDF.
- **KDF derivation is slow** (≥256 MiB, ≥3 iterations) → show a busy
  state; the tab must not appear frozen. Run derivation in a Web Worker
  so the UI thread stays responsive.
- **Registration POST fails after key derivation** → the client keeps
  form state so the user need not re-enter and re-derive.

## Acceptance criteria

- Given a valid unused invite, a compliant password, and a free
  username, registration succeeds and the user lands authenticated with
  Master Key and DEK in memory.
- The registration request body contains no password, no Master Key, and
  no unwrapped DEK — asserted against the captured request payload in a
  test, not by inspection.
- After registration the DB holds: a per-user salt, a KDF envelope with
  the parameters actually used, an Auth Key **hash** (never the Auth
  Key), and a wrapped DEK the server cannot unwrap.
- The stored profile record is ciphertext; the main currency appears in
  plaintext nowhere in the DB.
- The invite's status is `used`, and a second registration with the same
  token fails.
- A POST carrying KDF parameters below the server minimum is rejected
  with 400, even though the client UI would never send them.
- A POST with a salt that is not 16 bytes is rejected.
- Invalid, expired, used, and revoked invites produce byte-identical
  error responses.
- A password of 11 characters, or one scoring below zxcvbn 3, is blocked
  client-side and never derives keys.
- Submitting without the "no password recovery" acknowledgement is
  blocked.
- The AAD used for the profile blob equals `user_id ‖ account_id ‖
  record_type ‖ record_id ‖ schema_version ‖ monotonic_version` per
  architecture.md, with `account_id` empty and `monotonic_version` = 1.
