# Admin

## Purpose

Invite-only user provisioning. The admin creates invite links, sees
their status, and revokes unused ones. Visible only to admins.

Exercises: `spec/features/admin-invites.md`.

## The boundary this screen must make obvious

An admin has **no ability to read any vault, including their own users'
data**. Nothing here can decrypt, reset a password, or recover an
account. Because "admin panel" implies otherwise in almost every other
product, the screen states it outright in a tinted callout at the top:

> You can invite and remove users. You cannot read anyone's data, reset
> a password, or recover a vault — not even your own users'. Solvent has
> no key that can.

It sets the expectation before an admin tries to help someone who has
locked themselves out.

## Layout

Standard shell, content max-width 900px.

### Create invite

Primary button "Create invite link", with three controls above it:

- **Label** — optional free text, "Sarah's laptop". One line beneath:
  "Only you see this, and it is stored unencrypted — keep it to a
  nickname." This is the one user-typed string in the product the server
  stores in plaintext (`admin-invites.md`), and the form says so at the
  point of entry rather than leaving an admin to assume otherwise.
- **Expires** — select, 1–30 days, default 7.
- **Make this an administrator invite** — a checkbox, unchecked, never
  remembered between invites. The consequence is stated at the point of
  choice, not discovered afterwards:

  > Whoever uses this link becomes an administrator: they can invite and
  > remove users. They still cannot read anyone's data — no one can.

  This checkbox is the only way an admin is made after the bootstrap
  CLI, because there is no promote or demote (`admin-invites.md`). That
  is why it is a visible control on the main path and not a hidden flag:
  the alternative is an operator reaching for shell access to do
  something the product supports.

  It mints a new account that is born an admin. It cannot reach an
  existing user, and checking it changes no one's role.

On creation, the token is shown **once**, in a copyable field, with:
"Copy this now — it is not stored and cannot be shown again." The token
is stored hashed at rest, so this is literally true. For an admin invite
the confirmation names it: "This is an administrator invite."

### Invites table

Columns: Label · Created · Expires · Status · (action).

- The label, or ink-muted "—" when unset.
- An admin invite carries an **Admin** chip beside its label — the
  standard chip, identified by its text rather than a new color
  (`design-system.md`, Accessibility). An unused admin invite is the
  most powerful token outstanding on the instance and must be visible at
  a glance, not inferable only from who eventually appears in the users
  table.
- Status chips: **Unused** (petrol), **Used** (ink-muted, with the
  resulting username and the date), **Expired** (ink-muted),
  **Revoked** (ink-muted).
- Only unused invites offer "Revoke", with a confirm.
- The token itself is never displayed again in this table.

### Users table

Columns: Username · Created · Role · Records · Last active · (action).

- **Records** and **Last active** come from `GET /api/admin/users`
  (`admin-invites.md`) and are the only two facts an admin learns about
  a vault — the record count the server can already see, and a login
  timestamp. They are what an admin checks before deleting someone.
- Removing a user deletes their row, every record, and every session.
  Requires typing the username. The dialog states that the vault is
  gone and unrecoverable — an admin cannot export it first, because an
  admin cannot decrypt it.
- The last remaining admin cannot be removed; the control is disabled
  with the reason shown inline. Role is displayed, never edited — there
  is no promote or demote in v1 (`admin-invites.md`), so the Role column
  carries no control.

## States

- **Loading**: skeleton rows for both tables.
- **Empty — no invites yet**: "No invites yet," with the create button
  as the single action.
- **Empty — one user**: normal; the bootstrap admin is the only account
  until they invite someone.
- **Error — create failed**: inline; no invite was created and none is
  consumed.
- **Error — revoke failed**: inline on the row; status unchanged.
- **Populated**: as above.

## Rules

- Non-admins never see the nav entry, and the route returns 404 rather
  than 403 — an authenticated non-admin should not learn the route
  exists.
- Invite tokens are ≥128-bit, single-use, time-limited, stored hashed,
  and invalidated on first use (`architecture.md`, Storage & data
  handling).
- No control on this screen changes an existing user's role. `isAdmin`
  is sent only on invite creation; the Role column stays display-only
  (`admin-invites.md`).
