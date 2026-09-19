# Register

## What it does

A person holding a valid invite link creates an account. **The invite
decides which kind** (admin-invites.md): a vault owner account or an
administrator account. The client is told the kind by the page, and
the server takes it from the invite row and never from the request.

- **A vault owner** picks a username, a password, and their main
  currency. The browser sets up the vault — generates a salt, derives
  Master Key and Auth Key via Argon2id, generates and wraps a DEK, and
  encrypts an initial profile record — before anything is sent to the
  server (architecture.md, Key management).
- **An administrator** picks a username and a password. The browser
  generates a salt and runs the **same derivation, including the HKDF
  split**, then discards the Master Key. No DEK, no wrapper, no
  profile record, no main currency (architecture.md, Administrator
  credentials).

The derivation is identical in both flows and that is deliberate. An
administrator's Auth Key must be the HKDF half, not the raw Argon2id
output, or the login client would have to know the kind before it
derives, and the salt endpoint would have to tell it, which is the
enumeration oracle login.md closes.

## Flow

1. `GET /register?invite=<token>` is server-rendered (Jinja). The page
   embeds the server's **current default KDF envelope**
   (architecture.md, Key management), and, for a vault owner invite,
   the **currency half of the symbol table** (rate-lookup.md) for the
   main-currency picker. Both are needed before the user has a
   session, which is why they ride on the page rather than on an API
   the page cannot call. The server checks the token is well-formed,
   unused, and unexpired; an invalid token renders an error page with
   no form. **The rendered form is the one the invite's kind calls
   for**, and an administrator invite renders no currency picker and
   states on the page that this link creates an administrator account
   with no vault.
2. User enters username, password, password confirmation, and, for a
   vault owner only, main currency chosen from that embedded list.
3. Client generates a random 128-bit salt (`crypto.getRandomValues`).
4. Client derives Master Key + Auth Key from password + salt with the
   embedded parameters. **A vault owner** then generates a random
   256-bit DEK, wraps it under the Master Key (AES-256-GCM), generates
   a UUIDv4 `profileRecordId`, and encrypts a profile record under the
   DEK holding `{ mainCurrency, createdAt }` — the two required keys
   of the payload in account-settings.md, The profile record. The
   optional ones are written later, by the settings that own them.
   **An administrator** stops here and discards the Master Key.
5. `POST /api/register` with: invite token, username, Auth Key, salt,
   and KDF parameter envelope, plus, for a vault owner, wrapped DEK +
   its nonce and the profile record's id, schema version, ciphertext,
   and nonce. **The password never leaves the browser.**
6. Server validates, stores, marks the invite used, and starts a
   session. A vault owner lands logged in with keys already in memory.
   An administrator lands in the admin area.

**The payload's shape is checked against the invite, not chosen by the
client.** The invite row's `kind` is the discriminator, so a payload
carrying a wrapper or a profile record against an administrator
invite is a Bad Request, and one omitting them against a vault owner
invite is too. Nothing in the request names a kind. A client cannot
mint itself an administrator account by leaving fields out, and cannot
attach a vault to an administrator account by putting them in.

## What registration writes

Three tables for a vault owner, two for an administrator, and this
feature owns all three (architecture.md, Accounts on this instance,
and Credentials and vault key wrappers).

- **`principals`**: identity and kind only, meaning the normalized
  username, the kind copied from the invite, and the two timestamps.
  Registration adds **no key column** to this table. The app shell
  already creates it (`app-shell.md`, Database).
- **`credentials`**: exactly one row, `method: 'password'`, for **both
  kinds**. Its `params` take the request's salt and KDF envelope
  verbatim and its `verifier` takes the Argon2id hash of the submitted
  Auth Key. The unique index on `(principal_id)` where
  `method = 'password'` makes a second password row unrepresentable.
- **`dek_wrappers`**: exactly one row for a vault owner, keyed to that
  credential, taking the wrapper and its nonce. **None at all for an
  administrator**, and the schema trigger refuses one
  (`app-shell.md`, Database).

`kind` is not a client input either. The server copies it from the
invite row, which an administrator set when they minted the link, and
no endpoint anywhere writes it again (admin-invites.md).

`method` is not a client input. The server writes `'password'`, and
**no endpoint in v1 accepts any other value**, so a payload carrying
one is a Bad Request. No passkey endpoint, storage, or screen is
specified here or anywhere else.

The profile blob is encrypted at step 4, **before** the server has
assigned this user an identity, and that is only possible because
`principal_id` is not part of the AAD (architecture.md, Key management).
Every AAD field is one the client chose: `account_id` empty,
`record_type: "profile"`, its own `record_id`, its own
`schema_version`, `version: 1`.

Registration is deliberately **one transaction, not two phases**: the
principal row, its password credential row, its wrapper and profile
record where they apply, and the invite's consumption commit together
or not at all. Splitting it would mean a request that burns a
single-use invite and leaves a logged-in user holding a vault with no
main currency, or a user row with no way to unlock it. The server
writes the profile row through the same validator that backs
`PUT /api/records` (record-api.md), so there is one set of rules with
two callers rather than two record writers.

## Inputs / outputs

- In (browser only): invite token, username, password, and, for a
  vault owner, main currency.
- In (over the wire): invite token, username, Auth Key, salt, KDF
  envelope, plus, for a vault owner, wrapped DEK + nonce, profile
  record id, profile schema version, profile ciphertext + nonce.
- Out: principal row (username, kind), its `password` credential row
  (salt, KDF envelope, Auth Key hash), a wrapper row for a vault owner
  only, a profile record for a vault owner only, invalidated invite,
  session cookie.

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
  comparison. Allowed: 3–32 chars, `[a-z0-9._-]`. **One namespace
  across both kinds** (architecture.md, Accounts on this instance), so
  a person holding an administrator account and a vault account needs
  two distinct usernames. The product suggests no convention and
  enforces none beyond uniqueness.
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
  settings.
- Main currency is stored **only inside the encrypted profile record**,
  never as a plaintext column. An administrator has neither, and the
  rate lookup that would need one is on the vault surface
  (app-shell.md, The two surfaces).
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
  with an explanatory message. There is no weaker fallback KDF. This
  holds for an administrator registration too: no vault does not mean
  no Argon2id, because `verifier` is attacked offline either way.
- **Client can run WASM but cannot allocate the KDF's memory** → a
  distinct hard failure naming the moment rather than the device, with
  a retry, and no vault created. This is a **defensive path, not an
  expected one**: the 64 MiB allocation succeeds on every current
  target, and a device that refuses it is memory-starved at that moment
  rather than incapable. Registration must **not** fall back to weaker
  parameters here: that would mint a vault permanently weaker than the
  policy, with the KDF envelope recording the weakness as if it were
  chosen. The stale-KDF upgrade (login.md) raises parameters later, but
  it cannot retroactively justify a vault created below the minimum.
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
- After registration the DB holds exactly one `credentials` row for
  the account, `method: 'password'`, carrying the salt, a KDF envelope
  with the parameters actually used, and an Auth Key **hash** (never
  the Auth Key). For a vault owner it also holds exactly one
  `dek_wrappers` row keyed to that credential, holding a wrapped DEK
  the server cannot unwrap.
- Registering through an administrator invite leaves a `principals`
  row with `kind: administrator`, one `credentials` row, **zero
  `dek_wrappers` rows and zero `records` rows**, asserted against
  both tables, because zero is the whole guarantee.
- The `principals` row holds no salt, no KDF envelope, no Auth Key
  hash and no wrapped DEK, asserted against the table's full column
  set, so the test fails if one is added back.
- A `POST /api/register` against an administrator invite carrying a
  `wrappedDek`, a `dekNonce`, a profile record, or a main currency is
  a Bad Request and writes nothing, leaving the invite unconsumed.
- A `POST /api/register` against a vault owner invite omitting the
  wrapper or the profile record is a Bad Request and writes nothing,
  leaving the invite unconsumed.
- A `POST /api/register` carrying a `kind` field of any value is
  rejected. The stored kind always equals the invite's, asserted by
  registering through an administrator invite while sending
  `kind: vault_owner`.
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
  record_id ‖ schema_version ‖ version` per architecture.md,
  with `account_id` empty and `version` = 1 — and is built
  entirely before the request is sent, asserted by encrypting the blob
  in a test with no server interaction at all.
- A registration whose profile insert fails leaves no principal row,
  no credential row, no wrapper row, and an unconsumed invite; a
  registration that succeeds leaves exactly one principal, one
  `password` credential row, one wrapper, one profile record, and a
  `used` invite.
- An administrator registration that succeeds leaves exactly one
  principal, one `password` credential row, a `used` invite, and
  nothing else.
- Registering a username already held by an account of the *other*
  kind is refused, and the refusal is the same one a same-kind
  collision produces, so the attempt reveals existence but not kind.
- The profile record created by registration is indistinguishable from
  one written through `PUT /api/records` — same validation, same column
  values, same AAD.
