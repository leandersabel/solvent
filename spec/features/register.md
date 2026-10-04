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
   vault owner only, main currency chosen from that embedded list. The
   browser checks the username before anything is derived (Checks and
   their answers).
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
   session by the same rule as a sign-in (login.md, The session a
   sign-in issues). The account is new, so the session the request
   carried is at most another account's, and a live one is deleted and
   replaced. Starting that session is the account's first sign-in and
   writes its `last_login_at`. A vault owner's answer carries
   `vaultEpoch`, and the vault owner lands logged in with keys and
   epoch already in memory (architecture.md, Vault epoch).
   An administrator's answer carries no `vaultEpoch`, and they land in
   the admin area.

**The payload's shape is checked against the invite, not chosen by the
client.** The invite row's `kind` is the discriminator, so a payload
carrying a wrapper or a profile record against an administrator
invite is a Bad Request, and one omitting them against a vault owner
invite is too. Nothing in the request names a kind. A client cannot
mint itself an administrator account by leaving fields out, and cannot
attach a vault to an administrator account by putting them in.

## What registration writes

An administrator gets a `principals` row and a `credentials` row. A
vault owner also gets a `dek_wrappers` row, a `vault_epochs` row and a
profile record. This feature owns the columns of the first three
(architecture.md, Accounts on this instance, and Credentials and vault
key wrappers). The epoch is architecture.md's, Vault epoch, and the
profile record record-api.md's.

- **`principals`**: identity and kind only, meaning the normalized
  username, the kind copied from the invite, and the two timestamps.
  `created_at`, `last_login_at` and the invite's `used_at` take one
  server clock reading, so a new account's last sign-in is its
  creation time. Registration adds **no key column** to this table.
  The app shell already creates it (`app-shell.md`, Database).
- **`credentials`**: exactly one row, `method: 'password'`, for **both
  kinds**. Its `params` take the request's salt and KDF envelope
  verbatim and its `verifier` takes the Argon2id hash of the submitted
  Auth Key. The unique index on `(principal_id)` where
  `method = 'password'` makes a second password row unrepresentable.
- **`dek_wrappers`**: exactly one row for a vault owner, keyed to that
  credential, taking the wrapper and its nonce. **None at all for an
  administrator**, and the schema trigger refuses one
  (`app-shell.md`, Database).
- **`vault_epochs`**: exactly one row for a vault owner, a fresh
  epoch, and none for an administrator, which a trigger refuses too.

`kind` is not a client input either. The server copies it from the
invite row, which an administrator set when they minted the link, and
no endpoint anywhere writes it again (admin-invites.md).

`method` is not a client input. The server writes `'password'`, and
**no endpoint in v1 accepts any other value**, so a payload carrying
one is a Bad Request (architecture.md, Credentials and vault key
wrappers).

The profile blob is encrypted at step 4, **before** the server has
assigned this user an identity, and that is only possible because
`principal_id` is not part of the AAD (architecture.md, Key management).
Every AAD field is one the client chose: `account_id` empty,
`record_type: "profile"`, its own `record_id`, its own
`schema_version`, `version: 1`.

Registration is deliberately **one transaction, not two phases**: the
principal row, its password credential row, its wrapper, epoch and
profile record where they apply, and the invite's consumption commit
together or not at all. Splitting it would mean a request that burns a
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
  (salt, KDF envelope, Auth Key hash), a wrapper row, a vault epoch row
  and a profile record for a vault owner only, invalidated invite,
  session cookie, and `vaultEpoch` in a vault owner's answer.

## Rules

- **Password policy is client-enforced by construction.** The server
  never sees the password, so it cannot verify length or entropy — the
  browser must refuse to submit a password below the bar, and this spec
  does not pretend it is a server-side control. Bar: **≥12 characters
  and a zxcvbn score of ≥3**, no composition rules (architecture.md,
  Password/passphrase policy).
- **The strength gauge never takes a script source from the page's
  markup**, because content rendered into the page could plant one and
  have any same-origin script run. `strength.js` resolves zxcvbn's path
  against its own module URL and holds that file's hash as a constant,
  and the test suite checks both against the pinned version and hash.
- The registration screen must state plainly that **there is no password
  recovery** and require an explicit acknowledgement before submitting.
- **The username rule.** Normalized (trimmed, lowercased) before
  storage and comparison. Allowed: 3–32 chars, `[a-z0-9._-]`. The
  rule refuses the `system:bootstrap` sentinel (admin-invites.md,
  Invite lifecycle), since a colon is outside the set. **One namespace
  across both kinds** (architecture.md, Accounts on this instance), so
  a person holding an administrator account and a vault account needs
  two distinct usernames. The product suggests no convention and
  enforces none beyond uniqueness.
- **The browser and the server apply the same rule, held in one
  fixture.** `tests/fixtures/usernames.json` is
  `{"accept": [{"raw", "normalized"}], "refuse": [raw]}`. pytest runs
  every case through the server's normalization and the client tests
  run every case through the browser's check, and both must agree with
  the file. It covers at least: 3 and 32 characters, 2 and 33, each of
  `.` `_` `-`, uppercase accepted as its lowercase, leading and
  trailing whitespace accepted trimmed, an inner space, a character
  outside the set, a non-ASCII letter, the empty string, and
  `system:bootstrap`. Its whitespace is ASCII space and tab only,
  where Python's `str.strip` and JavaScript's `trim` agree.
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

## Checks and their answers

`POST /api/register` runs its checks in this order and answers the
first that fails:

1. **The body's shape**: a JSON object holding only the known fields,
   each of its type. `kind`, `method` and any other unknown field fail
   here. → Bad Request, no `refused` member.
2. **The username** against the username rule (Rules). → Bad Request
   `{"refused":"username"}`.
3. **The rest of the input**: the salt and the KDF envelope (Rules,
   Server validates), and, where present, `dekNonce` as 96 bits of
   base64 and `wrappedDek` as base64. → Bad Request, no `refused`
   member.
4. **The invite**: the token names a pending, unexpired invite
   (admin-invites.md, Invite lifecycle). → Bad Request
   `{"refused":"invite"}`, byte-identical in status, headers and body
   whether the token is unknown, empty, used, expired or revoked.
5. **The payload against the invite's kind** (Flow). → Bad Request, no
   `refused` member.
6. **The username is free**, across both kinds. → Conflict, the same
   whichever kind holds it.
7. **The profile record**, through the record validator
   (record-api.md). → that validator's own answer, with no `refused`
   member.

The order is the design:

- Steps 1 to 3 read only the request, so malformed input costs no
  database read and a username refusal reaches the caller whatever the
  invite's state. Neither named reason teaches anything
  (architecture.md, Status codes). The caller sent the username, and
  the rule ships in the page's script. Anyone holding the link already
  learns the invite's state from `GET /register`.
- The invite comes before the taken check, so only an invite holder
  learns whether a username exists (Edge cases).
- The kind check comes before the taken check, so the enumeration
  answer goes only to a request the invite would accept.

**Every refusal writes nothing and leaves the invite pending.** The
checks and the writes share the one transaction, and a refusal rolls
it back. So does a Server Error raised inside it. Only with no
response at all is the outcome unknown to the browser, because the
transaction may have committed before the connection dropped.

### In the browser

- **Before deriving**, the browser normalizes the field's value as the
  server does and tests it against the username rule. The submit
  button stays disabled until it passes, so a username outside the
  rule never starts the derivation. The request carries the value the
  browser checked.
- The browser reads `refused` from a JSON body. A body that is not
  JSON, or has no `refused` member, is a general refusal, because a
  reverse proxy in front of Solvent can answer Bad Request too.

| Answer | Shown as (ui/register.md, States) |
|---|---|
| `{"refused":"username"}` | the username field's rule error |
| `{"refused":"invite"}` | the invalid-invite wording |
| Conflict | that username is taken |
| any other refusal status | nothing was created, and the invite is unused |
| no response, a Server Error, or any status of that class from a proxy | the submit did not go through |

Every answer but the invite's leaves every field filled, so nobody
re-types anything to retry.

A `{"refused":"username"}` reaching the browser means the two copies
of the rule have drifted, which the shared fixture (Rules) prevents.

## Edge cases

- **Invalid, expired, already-used, or revoked invite** → error page, no
  form rendered. All four render an identical message ("This invite link
  is not valid") so a probe learns nothing about which state applies.
  An invite that turns bad while the form is open is refused at submit
  with `{"refused":"invite"}` (Checks and their answers), and the
  browser shows the same wording.
- **Username outside the rule** → the button stays disabled and the
  derivation never starts. A hand-built request gets
  `{"refused":"username"}`.
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
- **The first read of the new vault fails** (its `GET /api/records`
  after a successful `POST /api/register`) → the registration stands:
  the account exists and its session is live. The client keeps the
  Master Key, DEK and wrapper in the same document, starts the idle
  timer, and offers to read again (copy and layout: ui/register.md,
  States). Reading again fetches and decrypts the vault in place and
  enters it. There is no page load and no password prompt, because a
  load drops the keys and asks for the password the person has just
  chosen.
  - The held keys are bound like an open vault's: the idle lock and the
    lock on `pagehide` (architecture.md, Application hardening) discard
    them and draw the unlock card, which asks for the password only.
  - A lock during the first read or a later one wins. The read
    finishing opens nothing, and the unlock card stands.

## Acceptance criteria

- Given a valid unused invite, a compliant password, and a free
  username, registration succeeds and the user lands authenticated with
  Master Key and DEK in memory.
- With the first `GET /api/records` after a vault owner registration
  answering 503, the page stays the same document, holds the keys, and
  shows no password field and no unlock card. Reading again with the
  fetch answering lands at `/dashboard` in the same document, unlocked,
  with no password typed.
- While a new vault waits to be read again, the idle period passing
  discards the keys and shows the unlock card with a password field and
  no username field, and a `pagehide` discards the keys.
- A `pagehide` while the retried read is in flight leaves no keys, no
  vault, nothing of the vault drawn, and the unlock card shown.
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
  `dek_wrappers`, `vault_epochs` and `records` rows**, asserted
  against all three tables, because zero is the whole guarantee. Its
  answer carries no `vaultEpoch`.
- A vault owner registration leaves exactly one `vault_epochs` row for
  the account, and the answer's `vaultEpoch` equals it.
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
- A registration carrying another account's live session deletes that
  row, and the old cookie answers Unauthorized. A failed registration
  leaves the carried session working.
- A successful registration leaves the new `principals` row with a
  non-null `last_login_at` equal to its `created_at` and to the
  invite's `used_at`. Asserted for a vault owner invite, an
  administrator invite, and an administrator invite minted by
  `flask create-invite`.
- A POST carrying KDF parameters below the server minimum is rejected
  with Bad Request, even though the client UI would never send them.
- A POST with a salt that is not 16 bytes is rejected with Bad
  Request.
- Invalid, expired, used, and revoked invites produce byte-identical
  error pages from `GET /register`.
- `POST /api/register` with an otherwise valid body and a token that
  is unknown, empty, used, expired or revoked answers Bad Request with
  the body `{"refused":"invite"}`, byte-identical across all five in
  status, headers and body.
- `POST /api/register` with a username outside the rule answers Bad
  Request with the body `{"refused":"username"}`, with a usable invite
  and with an unusable one alike.
- `POST /api/register` with a taken username and an unusable invite
  answers `{"refused":"invite"}`, not Conflict.
- Every other Bad Request from `POST /api/register` (an unknown field,
  `kind`, `method`, a short salt, a below-minimum KDF envelope, a
  payload that does not fit the invite's kind) carries no `refused`
  member.
- Every refusal above, Conflict included, leaves no principal row and
  the invite `pending`, asserted against both tables.
- Every case in `tests/fixtures/usernames.json` gets the same verdict,
  and an accepted case the same normalized value, from the server's
  normalization and from the browser's check.
- On both forms, a username outside the rule keeps the submit button
  disabled, and pressing Enter in a field derives nothing and sends
  nothing, asserted against the derivation and the captured requests.
- With `POST /api/register` stubbed, each answer in the table under In
  the browser shows its own message and no other: `{"refused":"invite"}`,
  `{"refused":"username"}`, Conflict, a Bad Request with no `refused`
  member, a Bad Request with a non-JSON body, Content Too Large, Server
  Error, Service Unavailable, and a dropped connection. Only the last
  three show the network wording, and every field keeps its value in
  all but the invite's.
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
  no credential row, no wrapper row, no epoch row, and an unconsumed
  invite; a registration that succeeds leaves exactly one principal,
  one `password` credential row, one wrapper, one epoch row, one
  profile record, and a `used` invite.
- An administrator registration that succeeds leaves exactly one
  principal, one `password` credential row, a `used` invite, and
  nothing else.
- Registering a username already held by an account of the *other*
  kind is refused, and the refusal is the same one a same-kind
  collision produces, so the attempt reveals existence but not kind.
- The profile record created by registration is indistinguishable from
  one written through `PUT /api/records` — same validation, same column
  values, same AAD.
