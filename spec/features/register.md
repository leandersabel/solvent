# Register

## What it does

A person holding a valid invite link creates an account: picks a
username, a password, and their main currency. The browser sets up the
vault — generates a salt, derives Master Key and Auth Key via Argon2id,
generates and wraps a DEK, and encrypts an initial profile record —
before anything is sent to the server (architecture.md, Key management).

## Flow

1. `GET /register?invite=<token>` is server-rendered (Jinja). The page
   embeds two things so no extra round-trip is needed: the server's
   **current default KDF envelope** (architecture.md, Key management)
   and the **currency half of the symbol table** (rate-lookup.md) for
   the main-currency picker. Both are needed before the user has a
   session, which is why they ride on the page rather than on an API
   the page cannot call. The server checks the token is well-formed,
   unused, and unexpired; an invalid token renders an error page with
   no form.
2. User enters username, password, password confirmation, and main
   currency, chosen from that embedded list.
3. Client generates a random 128-bit salt (`crypto.getRandomValues`).
4. Client derives Master Key + Auth Key from password + salt with the
   embedded parameters, generates a random 256-bit DEK, wraps the DEK
   under the Master Key (AES-256-GCM), generates a UUIDv4
   `profileRecordId`, and encrypts a profile record under the DEK
   holding `{ mainCurrency, createdAt }` — the two required keys of the
   payload in account-settings.md, The profile record. The optional
   ones are written later, by the settings that own them.
5. `POST /api/register` with: invite token, username, Auth Key, salt,
   KDF parameter envelope, wrapped DEK + its nonce, and the profile
   record's id, schema version, ciphertext, and nonce. **The password
   never leaves the browser.**
6. Server validates, stores, marks the invite used, and starts a
   session — the user lands logged in, keys already in memory.

## What registration writes

Two tables, and this feature owns both (architecture.md, Vault key and
unlock methods).

- **`users`**: identity and role only, meaning the normalized username
  and the admin flag. Registration adds **no key column** to this
  table. The app shell already creates it (`app-shell.md`, Database).
- **`unlock_methods`**: exactly one row, `method: 'password'`. Its
  `params` take the request's salt and KDF envelope verbatim, its
  `verifier` takes the Argon2id hash of the submitted Auth Key, and its
  `wrapped_dek` and `dek_nonce` take the wrapper. The unique index on
  `(user_id)` where `method = 'password'` makes a second password row
  unrepresentable.

`method` is not a client input. The server writes `'password'`, and
**no endpoint in v1 accepts any other value**, so a payload carrying
one is a Bad Request. That, and the row shape, is the whole of what v1
owes a second unlock method. No passkey endpoint, storage, or screen is
specified here or anywhere else.

The profile blob is encrypted at step 4, **before** the server has
assigned this user an identity, and that is only possible because
`user_id` is not part of the AAD (architecture.md, Key management).
Every AAD field is one the client chose: `account_id` empty,
`record_type: "profile"`, its own `record_id`, its own
`schema_version`, `version: 1`.

Registration is deliberately **one transaction, not two phases**: the
user row, its password unlock method row, the profile record, and the
invite's consumption commit together or not at all. Splitting it would
mean a request that burns a single-use invite and leaves a logged-in
user holding a vault with no main currency, or a user row with no way
to unlock it, the worst place in the product for a partial state,
since the invite is spent and the key derivation has already been
paid. The server writes the profile row through the same validator that
backs `PUT /api/records` (record-api.md), so there is one set of rules
with two callers rather than two record writers.

## Inputs / outputs

- In (browser only): invite token, username, password, main currency.
- In (over the wire): invite token, username, Auth Key, salt, KDF
  envelope, wrapped DEK + nonce, profile record id, profile schema
  version, profile ciphertext + nonce.
- Out: user row (username), its `password` unlock method row (salt, KDF
  envelope, Auth Key hash, wrapped DEK + nonce), profile record,
  invalidated invite, session cookie.

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
- **The main-currency list is exactly the provider-quotable currency
  set** — the `kind: currency` rows of the operator's symbol table,
  which are seeded from the FX provider's own currency list
  (rate-lookup.md). Not the full ISO 4217 set. The main currency is the
  `quote` on *every* rate lookup the vault will ever make, and it is
  immutable outside import (account-settings.md), so a code the
  provider cannot quote into means no proposal ever resolves — a fault
  discovered long after the vault is populated and no longer fixable in
  settings. Offering only quotable codes makes that unreachable by
  choosing.
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
- **Client can run WASM but cannot allocate the KDF's memory** → a
  distinct hard failure naming the device, with a retry, and no vault
  created. This is a **defensive path, not an expected one**: the 64 MiB
  allocation succeeds on every current target, and a device that refuses
  it is memory-starved at that moment rather than incapable. It is
  specified because the alternative to a designed state is a raw
  allocation error shown to a user. Registration must **not** fall back
  to weaker parameters here: that would mint a vault permanently weaker
  than the policy and the KDF envelope would record the weakness as if
  it were chosen. The stale-KDF re-wrap (login.md) upgrades parameters
  later, but it cannot retroactively justify a vault created below the
  minimum.
- **KDF derivation is slow** → show a busy state; the tab must not
  appear frozen. Run derivation in a Web Worker so the UI thread stays
  responsive.
- **Registration POST fails after key derivation** → the client keeps
  form state so the user need not re-enter and re-derive.

## Acceptance criteria

- Given a valid unused invite, a compliant password, and a free
  username, registration succeeds and the user lands authenticated with
  Master Key and DEK in memory.
- The registration request body contains no password, no Master Key, and
  no unwrapped DEK — asserted against the captured request payload in a
  test, not by inspection.
- After registration the DB holds exactly one `unlock_methods` row for
  the user, `method: 'password'`, carrying the salt, a KDF envelope with
  the parameters actually used, an Auth Key **hash** (never the Auth
  Key), and a wrapped DEK the server cannot unwrap.
- The `users` row holds no salt, no KDF envelope, no Auth Key hash and
  no wrapped DEK, asserted against the table's full column set, so the
  test fails if one is added back.
- A `POST /api/register` carrying a `method` field of any value is
  rejected with Bad Request, and no endpoint accepts a `method` other
  than `password`.
- A second `password` row for the same user cannot be inserted. The
  unique index rejects it.
- The stored profile record is ciphertext; the main currency appears in
  plaintext nowhere in the DB.
- The invite's status is `used`, and a second registration with the same
  token fails.
- A POST carrying KDF parameters below the server minimum is rejected
  with Bad Request, even though the client UI would never send them.
- A POST with a salt that is not 16 bytes is rejected with Bad
  Request.
- Invalid, expired, used, and revoked invites produce byte-identical
  error responses.
- A password of 11 characters, or one scoring below zxcvbn 3, is blocked
  client-side and never derives keys.
- Submitting without the "no password recovery" acknowledgement is
  blocked.
- The AAD used for the profile blob equals `account_id ‖ record_type ‖
  record_id ‖ schema_version ‖ monotonic_version` per architecture.md,
  with `account_id` empty and `monotonic_version` = 1 — and is built
  entirely before the request is sent, asserted by encrypting the blob
  in a test with no server interaction at all.
- A registration whose profile insert fails leaves no user row, no
  unlock method row, and an unconsumed invite; a registration that
  succeeds leaves exactly one user, one `password` unlock method row,
  one profile record, and a `used` invite.
- The profile record created by registration is indistinguishable from
  one written through `PUT /api/records` — same validation, same column
  values, same AAD.
