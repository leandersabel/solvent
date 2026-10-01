# Admin invites

## What it does

An administrator runs the platform. This file owns the part of that
job that provisions accounts: single-use, time-limited invite links,
each naming the **kind of account** it will create. Registration
requires a valid unused invite, and there is no self-service sign-up
(architecture.md, Components). An administrator lists and revokes
outstanding invites, sees the accounts on the instance, and removes
one.

**An administrator account is a kind of account, not a capability on a
vault-owning one** (architecture.md, Accounts on this instance). Several
exist at once.

**The job is not a fixed list of tasks.** Running a platform means
whatever running this platform turns out to need, and the set grows.
What bounds the role is the admin boundary below, and a new
administrator task is judged against that rather than against the
tasks that came before it. Two tasks exist today beyond provisioning:

- **The instance-wide unit and symbol table** (`rate-lookup.md`, The
  symbol table): one list, identical for every account, revealing
  nothing about who holds what.
- **Rotating their own password** (An administrator's own credential,
  below).

Neither is provisioning, and both clear the boundary on their own.

## The admin boundary

An administrator has **no decryption ability over any vault**, and in
this model that is a statement about what their account *is* rather
than a list of endpoints that were careful.

An administrator principal has no `dek_wrappers` row and no `records`
row, and the schema refuses to give it either (`app-shell.md`,
Database). So there is no key material in an administrator session for
an endpoint to leak by accident, nothing for a mistaken join to pull
back, and no vault that "their" account owns. The request gate refuses
an administrator session every vault route (`app-shell.md`, The two
surfaces).

On top of that structure, there is no endpoint, and must never be one,
that returns any record ciphertext, or any field of any account's
credential row (salt, KDF envelope, Auth Key hash) or wrapper. An
administrator cannot reset a password, because a password reset would
orphan the vault anyway — there is nothing to reset toward. The only
destructive power an administrator holds is removing an account
outright, which destroys that vault rather than opening it.

**The same person's two accounts are not linked anywhere**, and no
feature may add a link. A stored association between an administrator
and "their" vault is the one field that would make an administrator
the owner of something encrypted, and the first feature to read it
would be the one that crosses this line.

**This is the test a new administrator task has to pass**, and it is
the only one. A task belongs to the role if it touches no vault: no
record ciphertext, no credential field, no wrapper, and no fact about
what is inside anyone's vault. It does not have to resemble anything
already on the list.

## Invite lifecycle

An invite row: `id`, `token_hash`, `kind`, `created_by`, `created_at`,
`expires_at`, `status`, `used_at`, `used_by`, `label`.

- **`kind`** is `vault_owner` or `administrator`, chosen at creation
  and never edited. It is the sole source of the kind of the account
  the invite produces (`register.md`), which is what makes "the kind
  is fixed at creation" true of the *account* rather than merely
  unexposed: the value is decided before the account exists and read
  once, at the moment it is written.

- **Token**: 256 bits from `secrets.token_urlsafe(32)`. Shown **once**,
  at creation, in the response — never retrievable afterwards, because
  only its hash is stored.
- **Hashing**: SHA-256. The token is high-entropy and unguessable, so a
  slow KDF buys nothing here; lookup is by hash, in constant time.
- **Expiry**: default 7 days, set by the administrator at creation
  (1–30 days).
- **Status**: `pending` → `used` | `revoked`. `expired` is derived from
  `expires_at`, not stored, so it cannot drift.
- **Single use**: consumed atomically in the same transaction as the
  user insert (register.md). A failed registration does not consume it.
- `label` is a free-text note ("Sarah's laptop") so an administrator
  can tell outstanding invites apart. It is deliberately server-side
  plaintext, since invites are provisioning metadata, not vault data.
- `created_by` is the administrator who minted the invite, or the
  reserved sentinel `system:bootstrap` for one minted by the CLI, which
  runs with no session and no principal behind it. The sentinel is
  refused as a username at registration, so it can never name a real
  account of either kind. A sentinel rather than an empty
  `created_by`, so every row names its origin and nothing reading the
  column has to special-case an absence.

  **It is stored and never returned.** `GET /api/admin/invites`
  leaves it out and no screen shows it (`product/admin-invites.md`,
  Outstanding invites). Every administrator can do everything any
  other can, so naming one on a row sorts the rows by a distinction
  that changes nothing about what anybody may do with them. It stays
  stored because it is the one thing separating a CLI-minted invite
  from one handed out in the app.

## Endpoints

The provisioning endpoints. `rate-lookup.md` owns the symbol table's,
and more will be added as the platform needs them. Every path under
`/api/admin/`, named here or not, is refused to anyone but an
administrator as an invented `/api/` path is (architecture.md,
Refusals).

- `POST /api/admin/invites` `{ expiresInDays, label, kind }` →
  `{ id, token, url, expiresAt, kind }`. The only response that ever
  contains the token. **`kind` is required and has no default.** It is
  `vault_owner` or `administrator`, and any other value is a Bad
  Request.

  A required field rather than a flag defaulting to false, because the
  two outcomes are different kinds of account rather than one account
  with an extra power, and a caller that does not say which it wants
  has not said enough. The screen still presents it as an unticked
  checkbox (`ui/admin.md`). The API does not, because an API has no
  screen to explain a default on.
- `GET /api/admin/invites` → list of
  `{ id, label, kind, createdAt, expiresAt, status, usedAt, usedBy }`.
  **Never includes the token or its hash.**
- `POST /api/admin/invites/<id>/revoke` → sets `status: revoked`.
  Idempotent on an already-revoked invite; refused on a used one.
- `GET /api/admin/accounts` → per account,
  `{ username, kind, createdAt, lastLoginAt }`, plus `recordCount`
  **for a vault owner only**. Both kinds are listed, because an
  administrator needs to see the other administrators to know whether
  they are the last one and to remove one. `lastLoginAt` is never null
  (architecture.md, Accounts on this instance).

  `recordCount` is **absent** for an administrator rather than zero.
  Zero and "has no vault" are different statements, and a zero invites
  the reader to think the vault is empty when the point is that there
  is none. The response is a union discriminated on `kind`, the same
  shape rule `params` follows (architecture.md, Credentials and vault
  key wrappers).

  Nothing about vault contents beyond the count the server can already
  see.
- `DELETE /api/admin/accounts/<username>` `{ confirmUsername }` →
  deletes that principal's row, its credential, its wrapper, every
  record, and every session, in one transaction. Keyed by normalized
  username, which is what `GET /api/admin/accounts` returns and what
  the administrator types to confirm; `confirmUsername` must equal the
  path segment or the request is a Bad Request.

  On a vault owner this destroys a vault rather than opening one. On
  an administrator it destroys no data at all, so it needs no ceremony
  beyond the confirmation and the last-administrator guard below.

  There is deliberately no admin export and no admin password reset,
  because neither is possible — see The admin boundary above.

  Removing a vault owner is not the same operation as that person
  removing themselves (`account-settings.md`): this path requires no
  password, because an administrator has none that would help, and it
  offers no "export first", because an administrator cannot decrypt
  the vault they are about to destroy.

There is **no endpoint that changes an account's kind** — no promote,
no demote, and no field on any request that is read into `principals.
kind` after the insert. An administrator account is made by the
bootstrap CLI's invite or by an administrator invite, and unmade only
by deleting it. Adding such an endpoint later must be checked against
The admin boundary first.

## Who may remove whom, and the last administrator

- **An administrator may remove any account, of either kind**, including
  another administrator. Administrators are peers and the model has no
  hierarchy: the client asked for several at once and named no
  seniority among them.
- **An administrator may remove their own account**, through this
  endpoint, while another administrator remains. Doing so ends their
  own session with the transaction.
- **An administrator's own account is removed here and nowhere else.**
  `DELETE /api/auth/account` is a vault owner's endpoint
  (`account-settings.md`) and answers an administrator session Not
  Found. One deletion path for administrators means one place the
  guard below has to hold.
- **At least one administrator account exists at all times.** A
  deletion that would leave none is refused with **Conflict**. Without
  the rule the instance could never provision an account again without
  shell access to the host.

**The guard and the delete are one `BEGIN IMMEDIATE` transaction.**
Counting the remaining administrators and then deleting in two
statements outside a write transaction lets two administrators remove
each other concurrently, each counting two and each deleting one,
leaving zero. Serializing them means the second attempt counts one and
is refused.

There is no guard on removing the last *vault owner*. An instance with
administrators and no vault owners is idle, not broken.

## An administrator's own credential

An administrator has no settings screen, because settings is a vault
screen (`account-settings.md`). They still hold a password, and a
password nobody can rotate is a defect, so the admin area carries
**one control of its own that is not about provisioning: Change
password.**

- It posts to `POST /api/auth/change-password`, the same shared
  endpoint a vault owner uses, sending no wrapper
  (`account-settings.md`, Change password).
- It invalidates every other session of that administrator and keeps
  the current one, which is what the endpoint already does. That is
  also the administrator's "sign out everywhere": there is no separate
  control, because the one operation they would reach for it after is
  the one that already performs it.
- There is no session list for an administrator and no
  `POST /api/auth/logout-all`. Both are on the vault surface
  (`app-shell.md`, The two surfaces).

**An administrator who has forgotten their password is not recovered,
they are replaced.** Another administrator removes the account and
issues a fresh administrator invite, which costs nothing because the
account held nothing. There is deliberately no power for one
administrator to reset another's password: removal and re-invitation
reaches the same end state without anyone ever holding a credential
they did not derive themselves. On an instance with a single
administrator, the bootstrap CLI below is the way back.

## Bootstrap: the first administrator, and the locked-out one

Registration needs an invite and invites need an administrator, so the
first account on a fresh instance is created out of band by a one-off
CLI command run by the operator on the host:

```
flask create-invite --kind administrator --expires-days 1
```

It prints an invite URL and exits. **`--kind` is required**, taking
`administrator` or `vault-owner`, and the invite it creates carries
that kind for the account to inherit (`register.md`). The command
creates an invite and never an account, which is what keeps every
credential in the product derived in a browser: there is no path by
which an account exists whose Argon2id ran server-side.

**The command requires `--force` whenever an administrator account
already exists**, printing how many accounts of each kind there are
and what it is about to create. That condition, rather than "any
account exists", because an instance with an administrator has the
admin area for this and the CLI is bypassing it, while an instance
with vault owners and no administrator is exactly the state the
command exists to repair.

It does not refuse outright. The only actor who can run it holds shell
access to the host, and that actor already holds the SQLite file, the
`SECRET_KEY`, and the ability to modify the served JavaScript, which
architecture.md (Threat model) states outright is **not** defended
against. A hard block would stop someone who has already won, at the
cost of the only recovery path in the product.

That path is the point. The *instance* must still be able to
provision, and without the override the remaining option is
hand-editing SQLite against a schema of hashed tokens and
transactional invite consumption, which no spec covers.

The confirmation is friction, not security: it stops an absent-minded
invocation and nothing more.

## Inputs / outputs

- In: administrator action (create, list, revoke), the kind of account
  the invite creates, expiry, optional label.
- Out: an invite URL shown once; a list of invite states; revocation.

## Rules

- Invite tokens are compared by hashing the presented token and looking
  up the hash — never by scanning and comparing plaintext.
- The invite URL is `https://<host>/register?invite=<token>`. It is
  copied to the clipboard by the administrator and delivered out of
  band; the
  app does not email it.
- **`/register` carries `Referrer-Policy: no-referrer`**, as do admin UI
  pages. The register page is the one that matters: the token rides in
  *its* URL, so it is that page's outbound navigations that could carry
  the token in a `Referer` header, while the admin page only displays
  the link. The CSP already blocks third-party subresources, which
  closes the common leak path; the header closes the rest at no cost.
- **The register page drops the token from the address bar** with
  `history.replaceState` once the form has taken it, so a bookmark,
  a shared screen, or a browser-history sync afterwards carries nothing.
  The form submits the token it already holds, not the URL's copy.
- The token must not appear in server access logs. Since it rides in a
  query string on `/register`, the app strips or redacts it in its own
  logging, and the deployment's reverse proxy / tunnel logging is
  documented as a place it may still appear — the invite's short expiry
  and single-use nature are what bound that exposure.

## Edge cases

- **Expired invite** → registration refused, with the same generic error
  as invalid/used/revoked (register.md).
- **Reused invite** → refused; the first registration already consumed
  it.
- **Revoked invite whose link is already sent** → refused immediately;
  this is the whole point of having revocation.
- **Revoking an already-used invite** → Conflict, with a message
  pointing at user deletion instead.
- **Two registrations racing on one invite** → the consuming
  transaction's uniqueness constraint means exactly one wins; the other
  gets the generic invalid-invite error.
- **A vault owner hits an admin endpoint** → refused as an invented
  `/api/` path is (Endpoints).
- **An administrator revokes their own outstanding invites** → allowed,
  no special case.
- **The last administrator removes themselves** → Conflict, and
  nothing is deleted.
- **Two administrators concurrently remove each other, and they are
  the only two** → one transaction wins and the other is refused with
  Conflict, and the instance keeps exactly one administrator.
- **An administrator removes their own account while another remains**
  → allowed, and it ends their own session. No special case beyond the
  last-administrator guard.
- **An administrator removes another administrator** → allowed, and no
  vault data is involved, because an administrator account holds none.
- **An administrator removes an account that is currently signed in**
  → their sessions go with the transaction; their next request is an
  Unauthorized.
- **Removing a username that does not exist** → Not Found, identical
  to the refusal of an invented `/api/` path.
- **Bootstrap command run while an administrator exists, without
  `--force`** → refuses, exits non-zero, and prints how many accounts
  of each kind exist plus the flag that would proceed.
- **Sole administrator loses their password** → that account is gone
  and stays gone; the operator runs the CLI with `--force` to mint a
  new administrator invite. This is the documented recovery path for
  the instance, never for a vault. The vault accounts on the instance
  are untouched by it, since they were never reachable from the
  administrator account in the first place.

## Acceptance criteria

- Creating an invite returns the token exactly once; a subsequent `GET`
  of the invite list contains neither the token nor its hash.
- The DB stores only the token hash; the plaintext token appears in no
  table.
- A valid invite registers one user and is then `used`; a second attempt
  with the same token fails.
- A revoked invite fails registration immediately, before expiry.
- An expired invite fails registration.
- Invalid, expired, used, and revoked invites yield byte-identical
  registration errors (shared assertion with register.md).
- Revoking a `used` invite returns Conflict and does not change its
  status.
- A vault owner session receives Not Found from every `/api/admin/*`
  endpoint.
- No endpoint under `/api/admin/` returns any field of any account's
  credential row, any wrapper, or any record ciphertext. Asserted by
  enumerating the registered routes at test time and inspecting each
  one's full response shape, so an endpoint added later is tested by
  it automatically instead of needing to be added to a list. **This
  is the executable form of the admin boundary**, and it is the test
  that has to keep passing as the role grows.
- `flask create-invite --kind administrator` on an instance with no
  administrator produces a working invite whose account is an
  administrator. With an administrator present it exits non-zero and
  creates nothing, and with `--force` it succeeds.
- `flask create-invite` without `--kind` exits non-zero and creates
  nothing.
- The CLI creates an invite and never an account: after running it,
  `principals` is unchanged, asserted against the table.
- A CLI-minted invite records `created_by` as `system:bootstrap`, and a
  registration attempt using that value as a username is refused.
- An invite created with `kind: administrator` produces a principal
  with `kind: administrator` and no wrapper. One with
  `kind: vault_owner` produces a vault owner with one. Both asserted
  against the resulting rows.
- `POST /api/admin/invites` without `kind` is a Bad Request and
  creates nothing.
- `POST /api/admin/invites` with `kind: administrator` from a **vault
  owner** session returns Not Found and creates nothing.
- No request to any endpoint changes an existing account's kind,
  asserted by enumerating every registered route at test time and
  attempting the change through each, so a route added later is
  covered rather than exempt.
- The last remaining administrator cannot remove their own account:
  `DELETE /api/admin/accounts/<their own>` returns Conflict and
  deletes nothing.
- An administrator removing another administrator succeeds while a
  third remains, and the removed account can no longer sign in.
- An administrator changes their own password through
  `POST /api/auth/change-password`, the new one signs them in, the old
  one does not, and every other session of theirs is gone while the
  current one survives.
- Every control in the rendered admin area maps to a route under
  `/api/admin/` or to `POST /api/auth/change-password`, asserted
  against the rendered area, so a control wired to a vault route
  fails the test whatever it is for.
- Two concurrent `DELETE /api/admin/accounts/*` requests, each
  targeting one of the only two administrators, leave exactly one
  administrator: one succeeds and one returns Conflict. Asserted with
  the two requests overlapping, since the serial case passes either
  way and is not the bug.
- `DELETE /api/admin/accounts/<username>` removes that principal's
  row, its credential, its wrapper, every record, and every session in
  one transaction; the removed account's subsequent request returns
  Unauthorized and their login fails.
- A `DELETE /api/admin/accounts/<username>` whose `confirmUsername`
  does not match the path segment is a Bad Request and deletes
  nothing.
- Removing one account leaves every other account's records and
  sessions untouched — asserted with two populated vaults.
- A simulated DB failure mid-delete leaves the target account fully
  intact and able to sign in.
- A vault owner session receives Not Found from `DELETE
  /api/admin/accounts/*`, and no account is deleted.
- `GET /api/admin/accounts` lists both kinds, and an administrator's
  row carries no `recordCount` field at all, asserted against the row's
  full key set rather than against its value.
- Right after a vault owner and an administrator register, before
  either signs in, `GET /api/admin/accounts` lists both with a non-null
  `lastLoginAt`.
- The invite token does not appear in the application's own log output.
