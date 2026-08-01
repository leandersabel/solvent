# Settings

## Purpose

The user's own account: password, main currency, session behavior, and
self-service deletion. Nothing admin-facing lives here, and nothing here
can recover a lost password.

Exercises: `spec/features/account-settings.md`. Export and import live
on their own screen (`export-import.md`) and are linked from here.

## Layout

Standard app shell. Content max-width 720px, one card per section,
stacked.

### Profile

- Username, static.
- **Main currency**, static, with a 13px note: "Fixed when you created
  your vault. Every rate you have recorded converts into it, so changing
  it would mix two currencies in your history." Not an editable field —
  do not ship a control that quietly corrupts history.

### Change password

Current password · new password · confirm, with the same strength meter
as `register.md`.

- A tinted callout above the form: "Your data is not re-encrypted — only
  the lock around your key is rebuilt. This is fast and safe."
- A **critical-icon** warning below: "Export files you already saved
  still open with your old password. Changing it here does not protect
  them."
- On success: an inline confirmation, and a note that other sessions
  were signed out. The current session stays; no re-login.
- The wrong current password is caught client-side at the DEK unwrap —
  nothing is sent, generic error.

### Session and lock

- **Idle lock** — a slider or select, 5–60 minutes, default 15, stored
  as `idleLockMinutes` in the encrypted profile record.
  - Beneath it, the honest tradeoff in one line: "Shorter is safer.
    Unlocking takes a few seconds, because deriving your key is
    deliberately slow."
  - There is no "never" option and the control must not offer one.
- **Absolute session expiry**: stated, not configurable — "You are
  signed out 12 hours after signing in, regardless of activity."
- **Active sessions** — a list by issue time and last activity. No IP,
  no user-agent, with a one-line note saying so: "Solvent does not
  record IP addresses or devices." Volunteering the absence is the
  point; a household user would otherwise assume they are stored.
- **Log out** and **Log out everywhere** (which ends the current session
  too).

### Delete my account

Collapsed behind a "Danger zone" disclosure, destructive styling.

- Requires re-entering the password **and** typing the username.
- The dialog's **primary action is "Export first"**; deletion is the
  secondary. Someone who wanted a backup and got a wiped vault has been
  failed by the dialog.
- States plainly: everything is deleted in one transaction, nothing is
  soft-deleted, and there is no vault left for anyone to recover.
- The last remaining admin cannot delete themselves; the control is
  disabled with the reason shown (`admin-invites.md`).

## States

- **Loading**: profile comes from the in-memory model — instant. The
  session list is fetched; skeleton rows.
- **Empty**: n/a.
- **Error — change-password failure after derivation**: the old password
  still works and nothing changed. Say exactly that: "Nothing was
  changed. Your current password still works."
- **Error — new password equals current**: refused inline.
- **Error — session list fetch failed**: that card alone shows an error;
  the rest of the page still works.
- **Populated**: as above.
