# Admin invites

## What it does

An admin generates single-use, time-limited invite links. Registration
requires a valid unused invite; there is no self-service sign-up
(architecture.md, Components). The admin can list and revoke outstanding
invites, and can see that users exist — and nothing else. **Admin is an
account-provisioning role, not a data role.**

## The admin boundary

Stated here because it is easy to erode later: an admin has **no
decryption ability over any vault, including their own operator's.**
There is no endpoint, and must never be one, that returns any record
ciphertext, or any field of another user's unlock method row (wrapped
DEK, salt, KDF envelope, Auth Key hash). An admin
cannot reset a password, because a password reset would orphan the vault
anyway — there is nothing to reset toward. The only destructive power an
admin holds is deleting a user account outright, which destroys that
vault rather than opening it.

Any future admin feature must be checked against this line.

## Invite lifecycle

An invite row: `id`, `token_hash`, `created_by`, `created_at`,
`expires_at`, `status`, `used_at`, `used_by`, `label`.

- **Token**: 256 bits from `secrets.token_urlsafe(32)`. Shown **once**,
  at creation, in the response — never retrievable afterwards, because
  only its hash is stored.
- **Hashing**: SHA-256. The token is high-entropy and unguessable, so a
  slow KDF buys nothing here; lookup is by hash, in constant time.
- **Expiry**: default 7 days, admin-settable at creation (1–30 days).
- **Status**: `pending` → `used` | `revoked`. `expired` is derived from
  `expires_at`, not stored, so it cannot drift.
- **Single use**: consumed atomically in the same transaction as the
  user insert (register.md). A failed registration does not consume it.
- `label` is a free-text note ("Sarah's laptop") so an admin can tell
  outstanding invites apart. It is server-side plaintext — deliberately,
  since invites are provisioning metadata, not vault data.
- `created_by` is the admin who minted the invite, or the reserved
  sentinel `system:bootstrap` for one minted by the CLI, which runs with
  no session and no user behind it. The sentinel is refused as a
  username at registration, so it can never name a real user. A sentinel
  rather than an empty `created_by`, so provenance is always a value the
  invite list can show and no reader has to special-case an absence.

## Endpoints

All require an authenticated session whose user has `is_admin`, and all
writes are CSRF-protected.

- `POST /api/admin/invites` `{ expiresInDays, label, isAdmin }` →
  `{ id, token, url, expiresAt }`. The only response that ever contains
  the token. `isAdmin` defaults to `false`; when true, the user created
  from this invite is an admin.

  This is **not** a role-change endpoint and does not weaken the rule
  below. It mints a new account that is born an admin; it cannot reach
  an existing user. Promoting an existing account is the operation that
  would let an admin move toward someone else's vault, and it stays
  absent.
- `GET /api/admin/invites` → list of
  `{ id, label, createdAt, expiresAt, status, usedAt, usedBy }`.
  **Never includes the token or its hash.**
- `POST /api/admin/invites/<id>/revoke` → sets `status: revoked`.
  Idempotent on an already-revoked invite; refused on a used one.
- `GET /api/admin/users` → `{ username, createdAt, isAdmin,
  recordCount, lastLoginAt }` per user. Nothing about vault contents
  beyond the count the server can already see.
- `DELETE /api/admin/users/<username>` `{ confirmUsername }` → deletes
  that user's row, every record, and every session, in one transaction.
  Keyed by normalized username, which is what `GET /api/admin/users`
  returns and what the admin types to confirm; `confirmUsername` must
  equal the path segment or the request is a Bad Request. Refused with
  Conflict if the target is the last remaining admin.

  This is the **only** destructive power an admin holds, and it destroys
  a vault rather than opening one. There is deliberately no admin export
  and no admin password reset, because neither is possible — see The
  admin boundary above.

  Note that an admin deleting a user is not the same operation as that
  user deleting themselves (`account-settings.md`): the admin path
  requires no password, because the admin has none that would help, and
  it offers no "export first", because an admin cannot decrypt the vault
  they are about to destroy.

There is **no role-change endpoint in v1** — no promote, no demote. An
admin is made by the bootstrap CLI or by an admin invite, and unmade
only by deleting the account. Adding a promote/demote endpoint later
must be checked against The admin boundary first.

## Bootstrap: the first admin, and the locked-out one

Registration needs an invite and invites need an admin, so the first
account is created out of band by a one-off CLI command run by the
operator on the host:

```
flask create-invite --admin --expires-days 1
```

It prints an invite URL and exits. The invite it creates carries an
`is_admin` flag that the resulting user inherits.

**On a populated instance the command requires `--force`**, printing
how many users and admins already exist and what the flag will do. It
does not refuse outright. The only actor who can run it holds shell
access to the host, and that actor already holds the SQLite file, the
`SECRET_KEY`, and the ability to modify the served JavaScript, which
architecture.md (Threat model) states outright is **not** defended
against. A hard block would stop someone who has already won, at the
cost of the only recovery path in the product.

That path is the point. An admin who loses their password cannot
recover their vault — by design, nothing changes that — but the
*instance* must still be able to provision. Without the override, the
remaining option is hand-editing SQLite against a schema of hashed
tokens and transactional invite consumption, an operation no spec
covers.

The confirmation is friction, not security: it stops an absent-minded
invocation, and it is honest that it cannot stop anything more.

## Inputs / outputs

- In: admin action (create, list, revoke), expiry, optional label.
- Out: an invite URL shown once; a list of invite states; revocation.

## Rules

- Invite tokens are compared by hashing the presented token and looking
  up the hash — never by scanning and comparing plaintext.
- The invite URL is `https://<host>/register?invite=<token>`. It is
  copied to the clipboard by the admin and delivered out of band; the
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
- Revoking is available for `pending` invites only. A used invite cannot
  be revoked; deleting the resulting user is the remedy.

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
- **Non-admin hits an admin endpoint** → Not Found, not Forbidden — do
  not confirm the endpoint exists.
- **Admin revokes their own outstanding invites** → allowed, no special
  case.
- **Last admin deletes themselves** → refused, by either path (the admin
  panel or their own settings); at least one admin must remain, or the
  instance can never provision again without CLI access.
- **Admin deletes their own account from the admin panel** → allowed
  when another admin remains, and it ends their own session. No special
  case beyond the last-admin guard.
- **Admin deletes a user who is currently logged in** → their sessions
  go with the transaction; their next request is an Unauthorized.
- **Deleting a username that does not exist** → Not Found, the same as
  any other admin route reached by a non-admin, so a probe distinguishes
  nothing.
- **Bootstrap command run on a populated instance without `--force`** →
  refuses, exits non-zero, and prints the existing user and admin counts
  plus the flag that would proceed.
- **Sole admin loses their password** → their vault is gone and stays
  gone; the operator runs the CLI with `--force` to mint a new admin
  invite. This is the documented recovery path for the instance, never
  for a vault.

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
- A non-admin session receives Not Found from every `/api/admin/*`
  endpoint.
- No admin endpoint returns any field of any user's unlock method row,
  or any record ciphertext, asserted by inspecting the full response
  shape of every admin endpoint, so the test fails if one is added
  later.
- `flask create-invite --admin` on an empty instance produces a working
  invite whose user is an admin; on a populated instance it exits
  non-zero and creates nothing, and with `--force` it succeeds.
- A CLI-minted invite records `created_by` as `system:bootstrap`, and a
  registration attempt using that value as a username is refused.
- An invite created with `isAdmin: true` produces an admin; the same
  invite without it produces a non-admin. Both are asserted against the
  resulting user row.
- `POST /api/admin/invites` with `isAdmin: true` from a **non**-admin
  session returns Not Found and creates nothing.
- No request to any endpoint changes an existing user's admin status —
  asserted by enumerating every registered route and attempting the
  change through each.
- The last remaining admin cannot delete their own account, by either
  path — the admin panel returns Conflict, and so does
  `DELETE /api/auth/account`.
- `DELETE /api/admin/users/<username>` removes that user's row, every
  record, and every session in one transaction; the deleted user's
  subsequent request returns Unauthorized and their login fails.
- A `DELETE /api/admin/users/<username>` whose `confirmUsername` does
  not match the path segment is a Bad Request and deletes nothing.
- Deleting one user leaves every other user's records and sessions
  untouched — asserted with two populated vaults.
- A simulated DB failure mid-delete leaves the target user fully intact
  and able to log in.
- A non-admin session receives Not Found from `DELETE
  /api/admin/users/*`, and no user is deleted.
- No endpoint promotes or demotes an admin; the admin API surface is
  exactly invites plus user list and user delete, asserted by
  enumerating the registered routes under `/api/admin/`.
- The invite token does not appear in the application's own log output.
