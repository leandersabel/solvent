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

This is not decoration. It sets the correct expectation before an admin
tries to help someone who has locked themselves out.

## Layout

Standard shell, content max-width 900px.

### Create invite

- A single primary button, "Create invite link", plus an optional
  expiry select (default from the feature spec).
- On creation, the token is shown **once**, in a copyable field, with:
  "Copy this now — it is not stored and cannot be shown again."
  The token is stored hashed at rest, so this is literally true.

### Invites table

Columns: Created · Expires · Status · (action).

- Status chips: **Unused** (petrol), **Used** (ink-muted, with the
  resulting username and the date), **Expired** (ink-muted),
  **Revoked** (ink-muted).
- Only unused invites offer "Revoke", with a confirm.
- The token itself is never displayed again in this table.

### Users table

Columns: Username · Created · Role · (action).

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
