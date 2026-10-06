# Register

An invite link (`admin-invites.md`) becomes the account it was made
for. The invite fixes the kind, vault owner or administrator, and the
person never chooses it.

## What the client gets

- **An invite for a user account** makes a vault. You pick a username,
  a password, and the currency your whole net worth is counted in, and
  land inside Solvent already signed in, with an empty vault ready to
  fill.
- **An invite for an administrator account** makes no vault, because an
  administrator account does not have one. You pick a username and a
  password, and land in the admin area, signed in.

The vault screen is the most consequential screen in the product. The
password chosen there is the only thing that will ever open that vault.
Nobody at Solvent, no administrator, and no operator with access to the
machine can open it without that password, and none of them can issue a
new one. You asked for zero-knowledge encryption, and this screen is
where its cost is met. It is for a household member who has been sent
a link, and for the person taking on the running of the instance.

- The password is the only defense if the stored data is ever stolen
  outright. Twelve characters with a strength rating, rather than a
  longer minimum, keeps a memorable four-word phrase inside the bar
  while ruling out anything on a common-password list.
- The main currency cannot be changed later, and the list offers only
  currencies Solvent can look up a rate into (Rules).
- A username is taken once across the whole instance, so a person
  holding both kinds of account signs in under two different names.

What it deliberately does not do:

- **No sign-up without a link** (`admin-invites.md`).
- **No password recovery, no reset, no recovery code, no security
  questions.** Nothing held anywhere could open the vault except the
  password, so there is nothing to recover it with.
- **No email address, no phone number, no verification step.** Solvent
  never sends anything. An address would exist only to send a recovery
  mail that cannot exist, and it would be one more readable fact about
  a person on a server that otherwise holds none.
- **No weaker setup offered to a device that is short of memory right
  now** (Edge cases).
- **No changing the main currency afterwards** (`account-settings.md`).
- **No composition rules.** No required symbol, digit or mixed case.
  They push people toward short passwords with punctuation, which is
  the wrong direction here.

## Screens

### Register

Server-rendered at `GET /register?invite=<token>`, so nothing here calls
an API that needs a session (Flow). The invite's kind decides which of
two forms renders. Both are the card outside the shell (`app-shell.md`,
The chrome), max-width 480px, with no navigation and no marketing. The
person arrived from a link to do one thing.

#### Create your vault

The form a user invite renders.

1. Heading: "Create your vault".
2. **Username**, with its message line (The username field).
3. **Password**, and **Confirm password**, with the strength gauge.
4. **Main currency**.
5. The no-recovery acknowledgement.
6. Primary button: **Create vault**.

#### Create an administrator account

The form an administrator invite renders.

1. Heading: "Create an administrator account".
2. One line beneath it, saying what the account is:

   > This link creates an administrator account. It invites and removes
   > people on this instance. It holds no financial data of its own and
   > cannot read anybody else's. If you also want to keep your own
   > finances in Solvent, that is a separate account and you need a
   > separate invite for it.

3. **Username**, the same field and message line.
4. **Password**, and **Confirm password**, with the same strength gauge
   held to the same bar. The bar is not relaxed here, because this
   password guards the power to remove every account on the instance.
5. Primary button: **Create account**.

Absent, because there is no vault: the main currency, the no-recovery
acknowledgement (that sentence is not true of an account with nothing
encrypted, nothing takes its place, and the form makes no claim about
recovery either way), and a vault being built (Setting up).

#### The username field

Both forms use it, unchanged. An Input with its message line
(`design-system.md`, Components). The rule is the one in Rules.

- The field lowercases as it is typed, so what the person sees is what
  they will sign in with. Usernames are lowercase only, so no two people
  claim names that differ by capitalization alone.
- `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"`,
  so a phone keyboard neither capitalizes nor "corrects" the name.
  Autocomplete `username`.
- **No `maxlength`.** A value past 32 characters stays in the field and
  is reported, because a name cut short silently is a name the person
  never chose.

The message line is a hint before anything is typed and whenever the
value fits:

> Use 3 to 32 characters: letters a to z, digits, dot, underscore or
> hyphen.

It turns into an error on the trimmed value:

| When | Copy |
|---|---|
| A character outside the set, the moment it is typed | "Only letters a to z, digits, dot, underscore and hyphen are allowed." |
| More than 32 characters, the moment the 33rd is typed | "That is more than 32 characters." |
| 1 or 2 characters, when the field loses focus | "Use at least 3 characters." |

- A character outside the set is named before the length, because
  removing it may fix the length too.
- An empty field keeps the hint on blur. Passing through a field is not
  a mistake, and the disabled button already holds the form.
- The error clears the moment the value fits, while typing.
- **The primary button stays disabled until the username fits**, as it
  does for the password. Enter in any field sends nothing and derives
  nothing while it is disabled, so nobody waits through the slow setup
  only to be refused for the name.

#### The strength gauge

Both forms use it, unchanged, against the bar in Rules.

- A four-segment bar filling in petrol-600. It reads as a magnitude,
  not a verdict: it fills, it does not run red to green. A password
  that is not there yet is a distance left to cover, not a mistake.
- A live label beside it: the rating word and roughly how long the
  password would hold up.
- One line of guidance under it, the one place in the product where
  advice changes the outcome: "Length beats symbols. A four-word phrase
  you can remember is stronger than `P@ssw0rd!`."
- The button stays disabled until both conditions pass, and whichever
  one is unmet is named inline. Never a bare "password too weak".
- It reads what the field holds now. A form that clears the field
  empties the gauge with it, and the button is disabled again.
- Autocomplete `new-password`.

#### The acknowledgement

On the vault form only. A checkbox, not a dismissible notice, and the
form will not submit without it:

> I understand that if I lose this password, my data is permanently
> unreadable. Solvent has no way to reset it or recover my vault.

Rendered in a tinted petrol-50 callout with a critical-colored icon,
because it is the most consequential sentence in the product.

#### Main currency

On the vault form only. A searchable combobox (`design-system.md`,
Components, Combobox, searchable): a search field with the placeholder
"Search by code or name" over the list of currencies, each shown as its
name and code, "Swiss Franc (CHF)". Typing narrows the list to the
currencies whose code or name contains the text, ignoring case, and a
search that matches none shows "No currency matches." Typed text never
chooses: a currency is chosen only by picking it from the list, by
click, or by Enter or Space on an option reached with the arrow keys.

Nothing is chosen when the form opens, because whatever came first
would otherwise be fixed for good on a vault whose owner skipped the
field. Until a currency is chosen, the line under the list reads "No
currency chosen yet." and **Create vault** stays unusable. Once one is,
it reads "Chosen: Swiss Franc (CHF)" and the option shows selected.

A 13px ink-secondary line sits directly beneath: **"This cannot be
changed later."** People choose this in five seconds and live with it
for years, so the warning belongs at the point of choice and not in
settings afterwards (`account-settings.md`, Settings). Every option
works for every conversion the vault will ever make (Rules), so there
is no "unsupported currency" state.

#### Setting up

Deriving the key is deliberately slow on both forms, with the wait
`login.md`, Unlock, times.

- On submit the button becomes a working state and the form goes quiet.
  On the vault form it reads "Setting up your vault". On the
  administrator form it reads "Creating your account", because no vault
  is being built and the copy must not say one is.
- A 13px line beneath, on both: "This takes a moment by design. It is
  what makes your password hard to attack."
- The tab stays responsive throughout, also to touch on a phone or a
  tablet, where setting up takes a couple of seconds. It must never
  look like it has hung.
- No spinner before the work starts.

#### States

Both forms unless a state says otherwise. Which server answer leads to
which state is In the browser.

- **The link is no good**: no form renders. A bare card: "This invite
  link is not valid." Identical for a link that is wrong, already used,
  out of time, or called back, and whichever kind of account it would
  have made, in wording, layout and which form it would have shown, so
  a probe learns nothing about which state applies.
- **The invite is refused at submit**: the form gives way, with no page
  load, to the same bare card and the same words. Nothing on the form
  could make it usable, so no field is kept.
- **Loading**: none. The page is server-rendered and fetches nothing.
- **Working**: Setting up.
- **Error, the username field's rule**: on its message line, before
  anything is derived.
- **Error, that username is taken**: on the username's message line,
  plain: "That username is taken." Enumeration is accepted here (Edge
  cases).
- **Error, the server refuses the username**: on the username's message
  line: "This username was not accepted. Use 3 to 32 characters:
  letters a to z, digits, dot, underscore or hyphen." For both username
  errors, editing the username returns the line to the hint.
- **Error, the passwords do not match**: on the confirmation field's
  message line, before anything is derived.
- **Error, this browser cannot run the encryption**: a hard stop with a
  plain explanation, no form and no retry (Edge cases).
- **Error, not enough memory right now** (Edge cases). The copy names
  the moment, never the password and never a device (`login.md`,
  Unlock):
  - On the vault form: "This device does not have enough memory
    available right now. No vault was created and your invite link is
    still good. Close some other tabs and try again."
  - On the administrator form: "This device does not have enough memory
    available right now. No account was created and your invite link is
    still good. Close some other tabs and try again."
  - A **Try again** button, because closing tabs can fix it.
- **Error, the registration is refused**: any refusal not named above.
  Above the primary button, every field still filled:
  - On the vault form: "Solvent did not accept this registration. No
    vault was created and your invite link is still unused. If this
    happens again, ask whoever sent you the invite."
  - On the administrator form: "Solvent did not accept this
    registration. No account was created and your invite link is still
    unused. If this happens again, ask whoever sent you the invite."
- **Error, the submit did not go through**: no response, a server
  error from Solvent or a proxy in front of it, or the derivation's
  worker not loading (architecture.md, Key management). The only state worded
  as a failure to get through. Above the primary button, every field
  still filled, the password included, so nobody re-types a password
  and waits again because of a network blip.

  > That did not go through. Everything you typed is still here, so you
  > can try again.

  The copy makes no claim about the invite, because with no response
  the browser cannot know whether the registration landed.
- A form-level error clears when the button is pressed again, and only
  one shows at a time.
- **Error, the new vault could not be read**, on the vault form only
  (Edge cases). The form gives way to a card of the same width,
  announced as an alert:
  - Heading, at section-heading size: "Your vault is created".
  - Beneath it, in label/meta type: "It could not be read just now.
    Nothing was lost, and you do not need to type your password again."
  - A primary **Try again** button. Pressing it disables it and reads
    again in place, with no page load and no password field. Success
    lands as Populated does, and another failure draws this card again.
- **Populated**: success signs the person in. A vault owner lands on the
  dashboard with their keys already in memory. An administrator lands
  in the admin area (`admin-invites.md`, Admin). Neither is ever bounced
  to the sign-in screen to type the password they just chose.

#### Screen rules

- The page drops the invite token out of the address bar as soon as the
  form holds it, so a bookmark, a shared screen, or a synced browser
  history carries nothing afterwards (`admin-invites.md`, Rules).
- **No way to choose the kind of account.** Neither form carries a
  control, a toggle, or a hint that the other exists.
- **No sign-in link.** Somebody on this page holds an invite and does
  not have an account yet.
- No email or phone field, and nothing implying recovery comes later.

## How it works

### What it does

The server takes the kind from the invite row and never from the
request (`admin-invites.md`). A vault owner's browser sets up the whole
vault before anything is sent. An administrator's browser runs the
**same derivation, including the HKDF split**, and keeps nothing but
the Auth Key (architecture.md, Key management, Administrator
credentials). The identical derivation is deliberate. An administrator's
Auth Key must be the HKDF half, not the raw Argon2id output, or the
login client would have to know the kind before it derives, and the
salt endpoint would have to tell it, which is the enumeration oracle
`login.md` closes.

### Flow

1. `GET /register?invite=<token>` is server-rendered (Jinja). The server
   checks the token is well-formed, unused and unexpired, and renders
   the form the invite's kind calls for, or the bad-link card. The page
   embeds the server's **current default KDF envelope** (architecture.md,
   Key management) and, for a vault owner invite, the **currency half of
   the symbol table** (`rate-lookup.md`) for the main-currency picker.
   Both ride on the page because the user has no session to fetch them
   with.
2. The user enters username, password, confirmation and, for a vault
   owner only, a main currency from the embedded list. The browser
   checks the username before anything is derived (In the browser).
3. The client generates a random 128-bit salt
   (`crypto.getRandomValues`).
4. The client derives Master Key and Auth Key from password and salt
   with the embedded parameters. **A vault owner** then generates a
   random 256-bit DEK, wraps it under the Master Key (AES-256-GCM),
   generates a UUIDv4 `profileRecordId`, and encrypts a profile record
   under the DEK holding `{ mainCurrency, createdAt }`, the two required
   keys of the payload (`account-settings.md`, The profile record). The
   optional keys are written later, by the settings that own them.
   **An administrator** stops here and discards the Master Key.
5. `POST /api/register` with invite token, username, Auth Key, salt and
   KDF envelope, plus, for a vault owner, the wrapped DEK and its nonce
   and the profile record's id, schema version, ciphertext and nonce.
   **The password never leaves the browser.**
6. The server validates, stores, marks the invite used, and starts a
   session by the same rule as a sign-in (`login.md`, The session a
   sign-in issues). The account is new, so the session the request
   carried is at most another account's, and a live one is deleted and
   replaced. Starting that session is the account's first sign-in and
   writes its `last_login_at`. A vault owner's answer carries
   `vaultEpoch`, and the vault owner lands logged in with keys and epoch
   already in memory (architecture.md, Vault epoch). An administrator's
   answer carries no `vaultEpoch`.

The registration page then holds the epoch it was handed, so the page
rules of `login.md`, A vault replaced elsewhere, bind it: its API
requests carry `X-Solvent-Vault`, the first read of the new vault
included, and a `vault-replaced` answer closes the vault.
`POST /api/register` itself is Public and needs no header (`app-shell.md`,
The two surfaces).

**The payload's shape is checked against the invite's kind**, never
chosen by the client (Checks and their answers, step 5). A client
cannot mint itself an administrator account by leaving the wrapper and
profile out, and cannot attach a vault to an administrator account by
putting them in.

### What registration writes

Both kinds get a `principals` row and one `password` credential. A
vault owner also gets one `dek_wrappers` row keyed to that credential,
one fresh `vault_epochs` row and a profile record, and the schema's
triggers refuse either row for an administrator. The tables and their
rules are architecture.md's (Accounts on this instance, Credentials and
vault key wrappers, Vault epoch), the triggers `app-shell.md`'s
(Database), and the profile record `record-api.md`'s.

- `principals` takes the normalized username and the kind copied from
  the invite, and **no key column**. `created_at`, `last_login_at` and
  the invite's `used_at` take one server clock reading, so a new
  account's last sign-in is its creation time.
- The credential's `params` take the request's salt and KDF envelope
  verbatim, and its `verifier` the Argon2id hash of the submitted Auth
  Key.
- Neither `kind` nor `method` is a client input. `kind` comes from the
  invite, and no endpoint writes it again (`admin-invites.md`). The
  server writes `method: 'password'`, and no endpoint accepts any
  other value.

The profile blob is encrypted at step 4, **before** the server has
assigned the user an identity. That works only because `principal_id`
is not in the AAD (architecture.md, Key management). Every AAD field is
one the client chose: `account_id` empty, `record_type: "profile"`, its
own `record_id`, its own `schema_version`, `version: 1`.

Registration is deliberately **one transaction, not two phases**: the
principal, its password credential, its wrapper, epoch and profile
record where they apply, and the invite's consumption commit together
or not at all. Splitting it would allow a request that burns a
single-use invite and leaves a logged-in user holding a vault with no
main currency, or a user row with no way to unlock it. The server
writes the profile row through the same validator that backs
`PUT /api/records` (`record-api.md`), so there is one set of rules with
two callers rather than two record writers.

### Rules

- **The password policy is client-enforced by construction.** The
  server never sees the password, so it cannot check length or entropy.
  The browser refuses to submit a password below the bar, and this spec
  does not pretend it is a server-side control. Bar: **at least 12
  characters and a zxcvbn score of at least 3**, no composition rules,
  the same for both kinds (architecture.md, Key management,
  Password/passphrase policy).
- **The strength gauge never takes a script source from the page's
  markup**, because content rendered into the page could plant one and
  have any same-origin script run. `strength.js` resolves zxcvbn's path
  against its own module URL and holds that file's SHA-384 hash as a
  constant, and the test suite checks both against the pinned version
  and hash. zxcvbn loads only where a password is scored
  (architecture.md, Supply chain).
- **The username rule.** Normalized (trimmed, lowercased) before
  storage and comparison. Allowed: 3 to 32 characters of `[a-z0-9._-]`.
  It refuses the `system:bootstrap` sentinel (`admin-invites.md`,
  Invite lifecycle), since a colon is outside the set. **One namespace
  across both kinds** (architecture.md, Accounts on this instance). The
  product suggests no naming convention and enforces none beyond
  uniqueness.
- **The browser and the server apply the same rule, held in one
  fixture.** `tests/fixtures/usernames.json` is
  `{"accept": [{"raw", "normalized"}], "refuse": [raw]}`. pytest runs
  every case through the server's normalization and the client tests
  run every case through the browser's check, and both must agree with
  the file. It covers at least: 3 and 32 characters, 2 and 33, each of
  `.` `_` `-`, uppercase accepted as its lowercase, leading and trailing
  whitespace accepted trimmed, an inner space, a character outside the
  set, a non-ASCII letter, the empty string, and `system:bootstrap`. Its
  whitespace is ASCII space and tab only, where Python's `str.strip` and
  JavaScript's `trim` agree.
- The server validates: the Auth Key is 32 bytes (architecture.md, Key
  management), the salt is exactly 16 bytes, the KDF envelope's
  parameters are at or above the server's configured minimum (a client
  must not be able to register itself a weak KDF), and the wrapped DEK
  and profile blobs are within the blob limits (architecture.md,
  Storage & data handling).
- **The main-currency list is exactly the provider-quotable currency
  set**: the `kind: currency` rows of the symbol table that have an
  adapter (`rate-lookup.md`, The symbol table), not the full ISO 4217
  set and not a currency an administrator added. The main currency is the `quote` on every
  rate lookup the vault will ever make, and it is immutable outside
  import (`account-settings.md`), so a code the provider cannot quote
  into means no proposal ever resolves, a fault found years later with
  a full vault and beyond fixing in settings.
- The main currency is stored **only inside the encrypted profile
  record**, never as a plaintext column. An administrator has neither,
  and the rate lookup that would need one is on the vault surface
  (`app-shell.md`, The two surfaces).

### Checks and their answers

`POST /api/register` runs its checks in this order and answers the
first that fails:

1. **The body's shape**: a JSON object holding only the known fields,
   each of its type. `kind`, `method` and any other unknown field fail
   here. Bad Request, no `refused` member.
2. **The username** against the username rule. Bad Request
   `{"refused":"username"}`.
3. **The rest of the input**: the Auth Key, the salt and the KDF
   envelope (Rules), and, where present, `dekNonce` as 96 bits of
   base64 and `wrappedDek` as base64. Bad Request, no `refused` member.
4. **The invite**: the token names a pending, unexpired invite
   (`admin-invites.md`, Invite lifecycle). Bad Request
   `{"refused":"invite"}`, byte-identical in status, headers and body
   whether the token is unknown, empty, used, expired or revoked.
5. **The payload against the invite's kind** (Flow). Bad Request, no
   `refused` member.
6. **The username is free**, across both kinds. Conflict, the same
   whichever kind holds it.
7. **The profile record**, through the record validator
   (`record-api.md`). That validator's own answer, with no `refused`
   member.

The order is the design:

- Steps 1 to 3 read only the request, so malformed input costs no
  database read, and a username refusal reaches the caller whatever the
  invite's state. Neither named reason teaches anything
  (architecture.md, Status codes): the caller sent the username, the
  rule ships in the page's script, and anyone holding the link already
  learns the invite's state from `GET /register`.
- The invite comes before the taken check, so only an invite holder
  learns whether a username exists.
- The kind check comes before the taken check, so the enumeration
  answer goes only to a request the invite would accept.

**Every refusal writes nothing and leaves the invite pending.** The
checks and the writes share the one transaction, and a refusal rolls it
back. So does a Server Error raised inside it. Only with no response at
all is the outcome unknown to the browser, because the transaction may
have committed before the connection dropped.

#### In the browser

- **Before deriving**, the browser normalizes the username as the server
  does and tests it against the rule (Register, The username field).
  The request carries the value the browser checked.
- Derivation runs in a Web Worker, so the UI thread stays responsive.
- The browser reads `refused` from a JSON body. A body that is not JSON,
  or has no `refused` member, is a general refusal, because a reverse
  proxy in front of Solvent can answer Bad Request too.

| Answer | Shown as (Register, States) |
|---|---|
| `{"refused":"username"}` | the server refuses the username |
| `{"refused":"invite"}` | the invite is refused at submit |
| Conflict | that username is taken |
| any other refusal status | the registration is refused |
| no response, a Server Error, or any status of that class from a proxy | the submit did not go through |
| the derivation's worker does not load | the submit did not go through |

Every answer but the invite's leaves every field filled, so nobody
re-types anything to retry. A `{"refused":"username"}` reaching the
browser means the two copies of the rule have drifted, which the shared
fixture prevents.

## Edge cases

- **Username already taken**: a plain error. The endpoint is
  invite-gated and the audience is a small trusted household, so
  username enumeration here is **accepted** rather than defended.
  architecture.md's decoy salt covers sign-in, where the attacker is
  unauthenticated. A failed attempt does not consume the invite, so an
  invite holder can probe repeatedly, which is understood and accepted.
- **The client cannot run WASM Argon2id** (a very old browser): a hard
  failure, with no weaker fallback KDF. This holds for an administrator
  too, because `verifier` is attacked offline either way.
- **The client can run WASM but cannot allocate the KDF's memory**: a
  distinct hard failure naming the moment, with a retry, nothing sent,
  and no account created. It is a **defensive path, not an expected
  one**: the 64 MiB allocation succeeds on every current target, and a
  device that refuses it is memory-starved at that moment rather than
  incapable. Registration must **not** fall back to weaker parameters,
  which would mint a vault permanently below the policy with its KDF
  envelope recording the weakness as if chosen, because of one busy
  moment on one device. The stale-KDF upgrade (`login.md`) raises
  parameters later, but it cannot justify a vault created below the
  minimum.
- **The first read of the new vault fails** (its `GET /api/records`
  after a successful `POST /api/register`): the registration stands. The
  account exists and its session is live. The client keeps the Master
  Key, DEK and wrapper in the same document, starts the idle timer, and
  offers to read again (Register, States). Reading again fetches and
  decrypts the vault in place and enters it. There is no page load and
  no password prompt, because a load drops the keys and asks for the
  password the person has just chosen.
  - The held keys are bound like an open vault's: the idle lock and the
    lock on `pagehide` (architecture.md, Application hardening) discard
    them and draw the unlock card (`login.md`, Unlock), which asks for
    the password only.
  - A lock during the first read or a later one wins. The read finishing
    opens nothing and draws nothing of the vault, and the unlock card
    stands.

## Acceptance criteria

1. The invite's kind alone decides which form renders. Neither form
   lets the person choose the kind, and an invite for one kind never
   produces the other. Test: `tests/test_admin.py::test_an_invite_kind_decides_the_accounts_kind`, `tests/browser/parts/register.mjs`.
2. A valid unused vault owner invite, a compliant password and a free
   username register a vault owner who lands at `/dashboard`
   authenticated, in the same document, with Master Key and DEK in
   memory and no password asked again. Test: `tests/browser/parts/register.mjs`.
3. A valid administrator invite, a compliant password and a free
   username register an administrator who lands in the admin area,
   signed in, with no currency asked for. Test: `tests/browser/parts/register.mjs`.
4. (blind) An administrator registration leaves a `principals` row with
   `kind: administrator`, one `credentials` row, a `used` invite, and
   zero `dek_wrappers`, `vault_epochs` and `records` rows, asserted
   against all three tables rather than the response. Its answer
   carries no `vaultEpoch`. Test: `tests/test_auth.py::test_registering_an_administrator_leaves_zero_wrappers_and_zero_records`, `tests/test_vault_epoch.py::test_an_administrator_has_no_epoch_and_is_told_none`.
5. (blind) A vault owner registration leaves exactly one `vault_epochs`
   row, equal to the answer's `vaultEpoch`, and a registration that
   fails partway leaves none. Test: `tests/test_vault_epoch.py::test_a_vault_owner_registers_with_one_epoch_and_is_told_it`, `tests/test_vault_epoch.py::test_a_registration_that_fails_leaves_no_epoch`.
6. (blind) No request of the registration flow carries the password,
   the Master Key or the unwrapped DEK, each asserted separately against
   the captured request bytes, not by reading the code. Test: no test.
7. After registration the database holds exactly one `credentials` row
   for the account, `method: 'password'`, with the salt, the KDF
   envelope actually used, and an Auth Key hash, never the Auth Key. A
   vault owner also has exactly one `dek_wrappers` row keyed to it,
   holding a wrapped DEK the server cannot unwrap. Test: `tests/test_auth.py::test_registering_a_vault_owner_writes_three_tables`.
8. (blind) The `principals` table has no salt, KDF envelope, Auth Key
   hash or wrapped DEK column, asserted against its full column set so
   the test fails if one is added back. Test: `tests/test_schema.py::test_principals_carries_no_key_material_column`.
9. A `POST /api/register` against an administrator invite carrying a
   `wrappedDek`, a `dekNonce`, a profile record or a main currency is a
   Bad Request, writes nothing, and leaves the invite unconsumed. Test: `tests/test_auth.py::test_an_administrator_invite_refuses_a_wrapper_or_a_profile`.
10. A `POST /api/register` against a vault owner invite omitting the
    wrapper or the profile record is a Bad Request, writes nothing, and
    leaves the invite unconsumed. Test: `tests/test_auth.py::test_a_vault_owner_invite_needs_the_wrapper_and_the_profile`.
11. A `POST /api/register` carrying a `kind` field of any value is
    rejected, and the stored kind equals the invite's, asserted by
    registering through an administrator invite while sending
    `kind: vault_owner`. Test: `tests/test_auth.py::test_a_payload_naming_kind_or_method_is_rejected`, `tests/test_auth.py::test_the_stored_kind_always_equals_the_invites`.
12. A `POST /api/register` carrying a `method` field of any value is a
    Bad Request. Test: `tests/test_auth.py::test_a_payload_naming_kind_or_method_is_rejected`.
13. A second `password` credential row for one principal cannot be
    inserted. Test: `tests/test_schema.py::test_a_second_password_credential_cannot_be_inserted`.
14. The stored profile record is ciphertext, and the main currency
    appears in plaintext nowhere in the database. Test: `tests/test_auth.py::test_the_main_currency_appears_in_plaintext_nowhere`.
15. A successful registration marks the invite `used`, and a second
    registration with the same token fails. Test: `tests/test_auth.py::test_the_invite_is_consumed_and_a_second_use_fails`.
16. (blind) A registration carrying another account's live session
    deletes that `sessions` row, asserted against the table, and the old
    cookie answers Unauthorized. A failed registration leaves the
    carried session working. Test: `tests/test_session.py::test_registration_replaces_another_accounts_live_session_and_a_failed_one_does_not`, `tests/test_review_session_issue15.py::test_failed_registration_partway_keeps_carried_session`.
17. (blind) A successful registration leaves `last_login_at` non-null and
    equal to `created_at` and to the invite's `used_at`, for a vault
    owner invite, an administrator invite, and an administrator invite
    minted by `flask create-invite`. Equality is the point, not
    presence. Test: `tests/test_last_login.py::test_registration_writes_last_login_at_from_the_same_reading_as_created_at`, `tests/test_last_login.py::test_an_administrator_invite_from_the_cli_registers_with_last_login_at_set`.
18. (blind) A hand-built request with KDF parameters below the server
    minimum is a Bad Request, so no vault is ever created weaker than
    the instance requires. Test: `tests/test_auth.py::test_a_kdf_envelope_below_the_server_minimum_is_refused`.
19. A salt that is not 16 bytes is a Bad Request. Test: `tests/test_auth.py::test_a_salt_that_is_not_sixteen_bytes_is_refused`.
20. (blind) `GET /register` with an invalid, expired, used or revoked
    invite renders byte-identical error pages, not merely the same
    wording. Test: `tests/test_auth.py::test_used_revoked_and_expired_invites_produce_identical_errors`, `tests/test_auth.py::test_the_register_page_renders_one_message_for_every_bad_invite`.
21. (blind) `POST /api/register` with an otherwise valid body and a
    token that is unknown, empty, used, expired or revoked answers Bad
    Request `{"refused":"invite"}`, byte-identical across all five in
    status, headers and body, compared as raw bytes. Test: `tests/test_register_refusals.py::test_the_five_bad_tokens_answer_the_same_bytes`.
22. (blind) `POST /api/register` with a username outside the rule
    answers Bad Request `{"refused":"username"}`, with a usable invite
    and with an unusable one alike. Test: `tests/test_register_refusals.py::test_a_username_outside_the_rule_is_refused_by_name_with_a_usable_invite`, `tests/test_register_refusals.py::test_a_username_outside_the_rule_is_refused_by_name_with_an_unusable_invite`.
23. (blind) `POST /api/register` with a taken username and an unusable
    invite answers `{"refused":"invite"}`, not Conflict. Test: `tests/test_register_refusals.py::test_an_unusable_invite_is_refused_before_a_taken_username`.
24. (blind) Every other Bad Request from `POST /api/register` (an
    unknown field, `kind`, `method`, a short salt, a below-minimum KDF
    envelope, a payload that does not fit the invite's kind) carries no
    `refused` member, asserted by parsing the body. Test: `tests/test_register_refusals.py::test_every_other_bad_request_names_no_reason_and_writes_nothing`.
25. (blind) Every refusal, Conflict included, leaves no principal row and
    the invite `pending`, asserted against both tables. A failed
    registration can be retried with the same link. Test: `tests/test_register_refusals.py::test_a_taken_username_is_a_conflict_that_writes_nothing_and_leaves_the_invite`, `tests/test_register_refusals.py::test_every_other_bad_request_names_no_reason_and_writes_nothing`.
26. (blind) A registration whose profile insert fails leaves no
    principal, credential, wrapper or epoch row and an unconsumed
    invite. A vault owner registration that succeeds leaves exactly one
    principal, one `password` credential row, one wrapper, one epoch
    row, one profile record and a `used` invite. Test: `tests/test_register_refusals.py::test_a_profile_record_the_validator_refuses_leaves_the_invite_pending`, `tests/test_vault_epoch.py::test_a_registration_that_fails_leaves_no_epoch`.
27. Registering a username held by an account of the other kind is
    refused with the same answer a same-kind collision gets, so the
    attempt reveals existence but not kind. Test: `tests/test_auth.py::test_a_username_held_by_the_other_kind_is_refused_the_same_way`.
28. (blind) Every case in `tests/fixtures/usernames.json` gets the same
    verdict, and an accepted case the same normalized value, from the
    server's normalization and from the browser's check, each run
    through the real code rather than a copy of the rule in the test. Test: `tests/test_register_refusals.py::test_the_server_accepts_what_the_fixture_accepts`, `tests/test_client.py::test_the_client_side_rules_hold`.
29. The username's rule shows as a hint before anything is typed. A
    character outside the set or a 33rd character is named the moment
    it is typed, and 1 or 2 characters when the field is left. Test: `tests/test_register_browser.py::test_the_registration_forms_answer_each_refusal_in_its_own_words`.
30. (blind) On both forms, a username outside the rule keeps the submit
    button disabled, and pressing Enter in each field derives nothing
    and sends nothing, asserted against the derivation and the captured
    requests. Test: `tests/test_register_browser.py::test_the_registration_forms_answer_each_refusal_in_its_own_words`.
31. (blind) With `POST /api/register` stubbed, each of
    `{"refused":"invite"}`, `{"refused":"username"}`, Conflict, a Bad
    Request with no `refused` member, a Bad Request with a non-JSON
    body, Content Too Large, Server Error, Service Unavailable and a
    dropped connection shows its own message and no other. Only the last
    three show the network wording, and every field, the password
    included, keeps its value in all but the invite's. Test: `tests/test_register_browser.py::test_the_registration_forms_answer_each_refusal_in_its_own_words`.
32. A password of 11 characters, or one scoring below zxcvbn 3, is
    blocked in the browser and never derives keys. Test: no test.
33. The vault form cannot be submitted without the no-recovery
    acknowledgement ticked. Test: no test.
34. The administrator form carries no no-recovery acknowledgement and no
    main currency, and makes no claim about recovery. Test: `tests/browser/parts/register.mjs`.
35. On either form, a confirmation that differs from the password blocks
    the submit. Test: no test.
36. The main-currency list holds only the symbol table's `kind: currency`
    rows, and only the vault owner page carries it. Test: `tests/test_auth.py::test_the_register_page_offers_the_currency_list_only_for_a_vault_owner`.
37. (blind) The profile blob's AAD is `account_id ‖ record_type ‖
    record_id ‖ schema_version ‖ version` (architecture.md, Key
    management) with `account_id` empty and `version` 1, built entirely
    before the request is sent, asserted by encrypting the blob in a
    test with no server interaction at all. Test: no test.
38. (blind) The profile record registration writes is indistinguishable
    from one written through `PUT /api/records`: same validation, same
    column values, same AAD. Test: `tests/test_auth.py::test_the_profile_registration_writes_is_an_ordinary_record`.
39. (blind) With the first `GET /api/records` after a vault owner
    registration answering 503, the page stays the same document, holds
    the keys, and shows no password field and no unlock card. Reading
    again with the fetch answering lands at `/dashboard` in the same
    document, unlocked, with no password typed. Test: `tests/browser/parts/register.mjs`.
40. (blind) While a new vault waits to be read again, the idle period
    discards the keys and shows the unlock card with a password field
    and no username field a person can type in, and a `pagehide` discards the keys. Test: `tests/browser/parts/register.mjs`, `tests/browser/parts/unlock-review-username.mjs`.
41. (blind) A `pagehide` while the retried read is in flight leaves no
    keys, no vault, nothing of the vault drawn, and the unlock card
    shown, asserted against the in-memory model and the DOM. Test: `tests/browser/parts/register.mjs`.
42. (blind) The gauge's zxcvbn source comes from `strength.js` alone. A
    script source or data attribute for zxcvbn planted in the page's
    markup changes nothing about what loads, and the constant hash and
    the resolved path each equal the pinned version's. Test: `tests/test_register_browser.py::test_the_gauge_loads_only_the_pinned_zxcvbn_whatever_the_page_plants`, `tests/test_chrome.py::test_the_gauge_names_the_pinned_zxcvbn_and_the_vault_page_names_none`.
43. When the device cannot allocate the derivation's memory, no account
    is created, nothing is sent, the fields are kept, and Try again
    derives again. Test: `tests/test_register_browser.py::test_the_registration_forms_answer_each_refusal_in_its_own_words`.
44. A vault can be created on a phone and on a tablet, and for the
    couple of seconds setting up takes the screen shows it is working
    and stays responsive to touch. Test: no test.
45. No endpoint accepts a `method` other than `password`. Test: no test.
46. On both forms, with the derivation's worker script getting no
    answer at submit, the form shows "That did not go through.
    Everything you typed is still here, so you can try again.", sends
    nothing and keeps every field, and pressing the button again in the
    same page loads the worker and sends the registration. Test:
    `tests/test_register_browser.py::test_the_registration_forms_answer_each_refusal_in_its_own_words`,
    `tests/browser/parts/register-review-worker.mjs`.
47. (blind) A `POST /api/register` whose Auth Key is 3, 31 or 33 bytes,
    or not base64, is a Bad Request with no `refused` member, for either
    invite kind, and leaves no principal row and the invite `pending`.
    Test: `tests/test_register_refusals.py::test_an_auth_key_that_is_not_thirty_two_bytes_is_refused`.
48. A `POST /api/register` whose profile schema version is past
    2^53 - 1 is a Bad Request that writes nothing. Test:
    `tests/test_register_refusals.py::test_a_profile_schema_version_past_two_to_the_fifty_three_is_a_bad_request`.
49. The vault form opens with no main currency chosen, and with every
    other field filled **Create vault** stays unusable until a currency
    is picked from the list. Test: `tests/browser/parts/register.mjs`, `tests/browser/parts/register-review-currency.mjs`.
50. Typing in the main currency's search narrows the list to the
    currencies whose code or name contains the text, ignoring case, and
    chooses none. Test: `tests/browser/parts/register.mjs`, `tests/browser/parts/register-review-currency.mjs`.
