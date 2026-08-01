# Account settings

<!-- Added because architecture.md references a password-change endpoint
(Application hardening, CSRF) and a per-user main currency (Data model)
without either having a feature home. -->

## What it does

A user's own settings: change password, view and understand their main
currency, see session state, and delete their own account. Nothing here
is admin-facing (admin-invites.md) and nothing here can recover a lost
password.

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
   with the server's **current default** KDF parameters, not the old
   ones. A password change is also a KDF upgrade.
4. Client re-wraps the same DEK under `MK_new` with a fresh nonce.
5. `POST /api/auth/change-password`
   `{ currentAuthKey, salt, kdf, authKey, wrappedDek, dekNonce }`.
6. Server verifies `currentAuthKey` against the stored hash, then
   replaces salt, envelope, Auth Key hash, and wrapped DEK in one
   transaction.
7. Server invalidates **all other sessions** for the user and keeps the
   current one. The client keeps its in-memory DEK; no re-login needed.

The current password is verified in two independent places — client-side
by the DEK unwrap, server-side by the Auth Key. Both must hold.

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

## Delete my account

Self-service, irreversible, and distinct from an admin deleting a user.

- Requires re-entering the password (verified via Auth Key, same as
  login) and typing the username to confirm.
- Deletes the user row, every record, and every session, in one
  transaction. Nothing is soft-deleted — there is no vault to preserve
  that anyone could ever open.
- The dialog offers **export first** as the primary action and deletion
  as the secondary one.
- The last remaining admin cannot delete themselves (admin-invites.md).

## Session and lock

- **Idle lock** after a period without activity: the client discards the
  Master Key and DEK from memory and shows an unlock prompt. The server
  session survives, so unlocking needs only the password, not a full
  re-login (login.md).
  - **User-configurable, 5–60 minutes, default 15.** Stored as
    `idleLockMinutes` in the encrypted profile record, so it follows the
    user across devices and the server never sees it; absent means 15.
    Values outside the range are clamped client-side.
  - The range is bounded at both ends deliberately. Re-unlocking costs a
    full Argon2id derivation (~1 s desktop, several seconds on a phone),
    so a fixed 15 minutes is a real tax on a long session; but the idle
    lock is also the last defense against another household member
    walking up to an unlocked tab, which is a threat this design
    explicitly defends against (architecture.md, Threat model). No
    setting disables it.
- **Absolute session expiry** at 12 hours from issue.
- **Log out** discards in-memory keys and invalidates the server session.
- **"Log out everywhere"** invalidates every session for the user.
- A settings row lists active sessions by issue time and last activity.
  No IP or user-agent is stored — it would be metadata the app does not
  otherwise keep, for a household instance where it answers nothing.

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
  wrapped DEK, and leaves every record's ciphertext byte-identical.
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
- Account deletion removes the user row, all records, and all sessions;
  a subsequent login with those credentials fails.
- The deletion dialog presents export as the primary action.
- After the configured idle period, in-memory keys are gone and reading
  vault data prompts to unlock; after 12 hours, the server session is
  rejected regardless of activity.
- The idle-lock setting defaults to 15 minutes, survives a re-login, and
  appears in plaintext nowhere in the DB — it lives in the encrypted
  profile record.
- A profile record with `idleLockMinutes` set to 0, 500, or a
  non-integer still locks, at the clamped bound.
- "Log out everywhere" invalidates the current session too.
