# Account settings

## What it does

A user's own settings: change password, view and understand their main
currency, see session state, and delete their own account. Nothing here
is admin-facing (admin-invites.md) and nothing here can recover a lost
password.

## The profile record

One `profile` record per vault, holding everything about the user that
is not a credential. It is the only record guaranteed to exist after
registration, and the complete payload is:

```json
{
  "mainCurrency": "CHF",
  "createdAt": "2026-07-31T09:14:00Z",
  "idleLockMinutes": 15,
  "dimensions": []
}
```

- **`mainCurrency`** — required. Chosen at registration from the
  provider-quotable currency set (`register.md`) and immutable outside
  import (Main currency, below).
- **`createdAt`** — required. Written once at registration, never
  rewritten.
- **`idleLockMinutes`** — optional, 5–60, absent means 15 (Session and
  lock).
- **`dimensions`** — optional. The grouping configuration (Dimensions,
  below), which is where its own shape is defined; absent or empty means
  no dimensions.

Registration writes the two required keys and nothing else
(`register.md`), and both optional keys appear the first time the user
sets one. The shape is stated here rather than assembled from the
sections that own each field, because two things read the *whole*
payload and need to know its bounds: `schema_version` migration
(`record-api.md`) and import validation (`export-import.md`).

## Change password

The DEK does not change, so **no vault record is re-encrypted** — only
the envelope around the DEK is rebuilt. This is the whole reason the
Master Key wraps a DEK instead of encrypting records directly.

1. User enters current password and a new password (twice). The new one
   is held to the same client-side bar as registration: ≥12 characters,
   zxcvbn ≥3 (register.md).
2. Client derives `MK_old` + `AK_old` from the stored salt and envelope,
   and unwraps the DEK. A failed unwrap means the current password is
   wrong — stop, do not send anything.
3. Client generates a fresh 128-bit salt and derives `MK_new` + `AK_new`
   with the server's **current default** KDF parameters, read from the
   envelope the app shell embeds (architecture.md, Key management), not
   the old ones. A password change is also a KDF upgrade.
4. Client re-wraps the same DEK under `MK_new` with a fresh nonce.
5. `POST /api/auth/change-password`
   `{ currentAuthKey, salt, kdf, authKey, wrappedDek, dekNonce }`.
6. Server verifies `currentAuthKey` against the stored hash, then
   replaces the **`password` unlock method row only** (its `params`,
   its `verifier`, and its wrapper) in one transaction. No other row
   is written, and any other unlock method the vault holds is left
   alone, because the DEK is the same key afterwards and every wrapper
   still opens it (architecture.md, One key, N wrappers).
7. Server invalidates **all other sessions** for the user and keeps the
   current one. The client keeps its in-memory DEK; no re-login needed.

The current password is verified in two independent places — client-side
by the DEK unwrap, server-side by the Auth Key. Both must hold.

**There is no "remove password" action, and there will not be one.**
The password method is the only wrapper an export file can carry
(`export-import.md`), so a vault without it has no openable backup and
no migration path. Changing the password replaces the row. Nothing
deletes it short of deleting the account.

The screen must warn that **existing export files still open with the
old password**, since they carry their own salt and wrapped DEK. Changing
the password does not retroactively protect an exported file.

## Main currency

Displayed, not editable in v1.

Every snapshot stores a rate *into the main currency* at entry time
(record-snapshot.md). Changing the main currency would leave every
historical rate denominated in the old one, so the trend chart would
silently mix two currencies. Making it changeable needs each snapshot to
record which currency its rate targets, plus a conversion strategy for
history — real work, not a settings toggle.

The settings screen shows the main currency with a one-line note that it
is fixed at registration and why. Do not ship an editable field that
quietly corrupts history.

**Import is the one exception, and it is not a loophole.** Restoring a
vault replaces the profile *and* every snapshot together
(`export-import.md`), so the imported vault is internally consistent —
there is no history left denominated in the old currency to mix with.
The danger this rule guards against is changing the label while keeping
the data, which import does not do.

## Dimensions

The user's grouping dimensions (`manage-accounts.md`, Dimensions) are
configured on their own screen (`ui/dimensions.md`, linked from
settings) and stored in the **encrypted profile record**, so they follow
the user across devices and the server never learns how anyone slices
their wealth.

```json
"dimensions": [
  {
    "id": "d7f3a1b2",
    "label": "Liquidity",
    "archivedAt": null,
    "values": [
      { "id": "9c4e0f11", "label": "Cash",               "archivedAt": null },
      { "id": "2a8b7d30", "label": "Liquid investments", "archivedAt": null },
      { "id": "5f1c9e44", "label": "Fixed investments",  "archivedAt": null },
      { "id": "b03d6a27", "label": "Retirement",         "archivedAt": null }
    ]
  }
]
```

- **`id` is opaque and immutable**: 8 characters of `[a-z0-9]` from
  `crypto.getRandomValues`, minted at creation, checked for uniqueness
  against the profile already in memory. It is never shown, never typed,
  and never derived from the label.
- **`label` is free display text** in any script, renamable at any time.
  A rename writes one record — the profile — and touches no account.
  This is the whole reason ids are not slugs: a label-derived key would
  make renaming either impossible or a multi-record rewrite that can
  fail partway, and would risk colliding with strings already in user
  data.
- **Order in `values` is the band order** in the stacked chart. It
  cannot be derived from the accounts, which yield which value ids are
  in use but never the intended sequence — and a stack whose bands
  reorder over time is unreadable (`net-worth-view.md`). Reordering
  writes one record.
- **Order of `dimensions` is the order of the dashboard's "Group by"
  select.**
- Absent or empty means no dimensions: the chart groups by nothing and
  offers "Total" alone. This is the default for a new user; the feature
  costs nothing until it is used.
- Values may exceed four; the chart folds the remainder into "Other"
  (`design-system.md`). The screen says so rather than capping the list,
  because the limit is a rendering constraint, not a data one.

### Deleting is archiving

Deleting a dimension or a single value sets `archivedAt` and keeps the
definition in the profile. It leaves every account's `dims` entry
untouched: those accounts render as "Unassigned" for that dimension
until it is restored, and restoring it brings every assignment back
exactly.

There is deliberately **no "remove everywhere" option**, and no
multi-record write anywhere in this feature. Stripping entries from N
account records to undo a display setting is a destructive operation
that can fail partway, offered in exchange for a few bytes of inert data
inside ciphertext nobody reads. An archived definition costs one line in
the profile record and buys exact reversibility.

An archived dimension is hidden from the account form and the "Group by"
select, and listed under a collapsed "Archived" section on the
dimensions screen with a restore action.

A **flag** — a dimension with a single value — is the shape that
replaces a yes/no tag. Absence of an entry means no; the account form
renders it as a checkbox rather than a select.

## Delete my account

Self-service, irreversible, and distinct from an admin deleting a user.

`DELETE /api/auth/account` `{ authKey, confirmUsername }`.

- Requires re-entering the password (verified via Auth Key, same as
  login) and typing the username to confirm. The server checks `authKey`
  against the stored hash in constant time, and that `confirmUsername`
  equals the session user's normalized username — a mismatch on either
  is a Bad Request and deletes nothing. The typed username is a
  deliberate second factor of intent, so it is verified server-side and
  not left as a UI formality.
- Deletes the user row, every unlock method row, every record, and
  every session, in one transaction. Nothing is soft-deleted: there is
  no vault to preserve that anyone could ever open.
- Refused with Conflict if the user is the last remaining admin
  (admin-invites.md).
- The dialog offers **export first** as the primary action and deletion
  as the secondary one.

## Session and lock

- **Idle lock** after a period without activity: the client discards its
  keys and all decrypted state and shows an unlock prompt; the server
  session survives, so unlocking needs only the password (login.md,
  Rules, which states the rule and its one exception). This screen owns
  only the period.
  - **User-configurable, 5–60 minutes, default 15.** Stored as
    `idleLockMinutes` in the encrypted profile record, so it follows the
    user across devices and the server never sees it; absent means 15.
    Values outside the range are clamped client-side.
  - The range is bounded at both ends deliberately. Re-unlocking costs a
    full Argon2id derivation, a fraction of a second on a desktop
    browser and about two seconds on an iPhone (architecture.md, Key
    management), so a fixed 15 minutes is a real tax on a long session
    on a phone; but the idle
    lock is also the last defense against another household member
    walking up to an unlocked tab, which is a threat this design
    explicitly defends against (architecture.md, Threat model). No
    setting disables it.
- **Absolute session expiry** at 12 hours from issue.
- **Log out** — `POST /api/auth/logout`. Invalidates the current server
  session; the client discards its in-memory keys first, so a failed
  request still leaves nothing readable in the tab.
- **"Log out everywhere"** — `POST /api/auth/logout-all`. Invalidates
  every session for the user, **including the current one**. There is no
  "all except this one" variant; the one place that keeps the current
  session alive is a password change, which does it as part of its own
  transaction.
- A settings row lists active sessions by issue time and last activity —
  `GET /api/sessions` → `[{ id, issuedAt, lastActiveAt, current }]`.
  No IP or user-agent is stored — it would be metadata the app does not
  otherwise keep, for a household instance where it answers nothing —
  and no endpoint returns any, because none is recorded. `id` is an
  opaque handle, never the session cookie's value.

## Edge cases

- **Wrong current password** → detected client-side at the DEK unwrap;
  nothing is sent, generic error.
- **New password equals current** → refused.
- **New password fails the policy** → inline error, no derivation.
- **Change-password request fails after derivation** → old password
  still works, nothing changed; the transaction is all-or-nothing.
- **Another session was mid-write when the password changed** → the DEK
  is unchanged, so its writes still decrypt; only its session cookie is
  invalidated and it must log in again.
- **Password change on a vault with stale KDF parameters** → the change
  itself performs the upgrade, so the stale-KDF re-wrap (login.md) is
  redundant afterwards.
- **Account deletion while an export is downloading** → the export
  either completed or it did not; the deletion transaction does not wait.

## Acceptance criteria

- Changing the password rewrites salt, KDF envelope, Auth Key hash, and
  wrapped DEK in the `password` unlock method row, writes no other row,
  and leaves every record's ciphertext byte-identical.
- After a password change the user can still decrypt records written
  before it, in the same session and after a fresh login.
- The old password no longer logs in; the new one does.
- The change-password request contains neither password, in any form.
- A change-password request with a wrong `currentAuthKey` is rejected by
  the server even if the client-side unwrap were bypassed.
- Other sessions for the user are invalidated by a password change; the
  initiating session is not.
- A password change on a vault with old KDF parameters results in
  parameters equal to the server's current default.
- The main currency field is not editable and states why.
- Account deletion removes the user row, its unlock method rows, all
  records, and all sessions; a subsequent login with those credentials
  fails.
- A `DELETE /api/auth/account` with a wrong `authKey`, or a
  `confirmUsername` that does not match the session user, is rejected
  server-side and deletes nothing — asserted by calling the endpoint
  directly, since a client bypassing the dialog is the case that
  matters.
- The last remaining admin's `DELETE /api/auth/account` returns Conflict
  and deletes nothing.
- The deletion dialog presents export as the primary action.
- `GET /api/sessions` returns no IP address and no user-agent for any
  session — asserted against the endpoint's full response shape, so the
  test fails if one is added later. It never returns a session cookie
  value.
- `GET /api/sessions` returns only the session user's own sessions;
  none belonging to another user appear.
- `POST /api/auth/logout` invalidates the calling session only; a second
  session for the same user still works afterwards.
- All four endpoints return Unauthorized unauthenticated, and the three
  writes return Forbidden without the `X-Solvent-Request` header.
- After the configured idle period, in-memory keys are gone and reading
  vault data prompts to unlock; after 12 hours, the server session
  answers Unauthorized regardless of activity.
- The idle-lock setting defaults to 15 minutes, survives a re-login, and
  appears in plaintext nowhere in the DB — it lives in the encrypted
  profile record.
- A profile record with `idleLockMinutes` set to 0, 500, or a
  non-integer still locks, at the clamped bound.
- Reordering a dimension's values reorders the chart's bands and writes
  one record — no account record is touched.
- Renaming a dimension's label, or a value's label, writes one record
  and leaves every account record byte-identical.
- Archiving a dimension and restoring it returns every account to the
  band it was in, with no account record written in either direction.
- Archiving a single value moves its accounts to "Unassigned";
  restoring it moves them back.
- No operation in the dimensions feature writes more than one record.
  Asserted by counting `PUT`s across create, rename, reorder, archive,
  and restore.
- Two dimensions created in the same session hold different ids, and an
  id is never equal to any label.
- A profile with no `dimensions` key renders the dashboard with "Total"
  as the only grouping and no errors.
- "Log out everywhere" invalidates the current session too.
