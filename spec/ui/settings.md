# Settings

## Purpose

A vault owner's own account: their password, the currency their vault
counts in, how long it stays unlocked, which sessions are open, how
their holdings are grouped, and, at the bottom, deleting the whole
thing.

**This screen exists only inside a vault.** An administrator account
has none, never reaches this address, and is answered as though it does
not exist (`app-shell.md`, The two surfaces). Nothing on this screen is
about the instance or about anybody else, and an administrator changes
their own password in the admin area (`ui/admin.md`).

Exercises: `spec/features/account-settings.md`. Two things that feature
owns live on their own screens and are linked from here: dimensions
(`ui/dimensions.md`) and export and import (`ui/export-import.md`).

## Layout

Standard app shell, reached from **Settings** in the nav. Content
max-width 720px, one card per section, stacked in the order below
under the screen heading, 24px apart. Each section's card opens on its
section heading.

The nav entry is an in-page address, not a second page. The keys live
in one page's memory, so a page load here would charge the derivation
a second time in one sitting, on top of the one that opened the vault
(`unlock.md`). `/settings`, `/settings/dimensions` and
`/settings/export-import` stay real addresses, each redirecting to the view it names, so a bookmark or a
typed address still works.

### Profile

- **Username**, shown, not editable.
- **Main currency**, shown, not editable, with a 13px note: "Fixed when
  you created your vault. Every rate you have recorded converts into
  it, so changing it would mix two currencies in your history."

  This is not a control disabled for now: there is no field.

Each is a label and value pair: the label in ink-secondary in a 160px
column at the left, the value beside it, and a hairline rule between
the pairs. The currency's note sits beneath the currency.

### Dates and numbers

Four selects, a sample line, and **Save**. Saving writes the profile
record and re-renders the surface, so every figure and date already on
screen changes with it.

- **Language**. A short list rather than free text, because a tag
  nobody can spell is worse than a list: the browser's setting (the
  default), Deutsch (Schweiz), Deutsch (Deutschland), Français
  (Suisse), Italiano (Svizzera), English (UK), English (US).
- **Dates**. The language's own order (the default), 20.09.2026,
  2026-09-20, 09/20/2026. The chosen order is what the date field
  writes, accepts and draws its calendar in.
- **Thousands**. The language's own mark (the default), then each
  option shown as the figure it produces: 1 234 567, 1'234'567,
  1,234,567, 1.234.567, 1234567.
- **Decimals on money**. The currency's own (the default, two), none,
  or two.

A 13px note above them: "Display only. Every figure is stored exactly
as you entered it, and every date is stored the same way for everyone,
so changing any of this rewrites nothing."

The sample line underneath shows the current choice applied to a
figure and a date in the main currency, and updates as each select
changes, before anything is saved.

The note comes first, then the four selects in two columns in the
order listed, Language and Dates on the first row. The sample line sits
beneath them in a tinted petrol-50 strip, under its own section label,
with **Save** at the strip's right end.

A thousands mark that is also the language's decimal point is not
applied, because 1.234 would then mean two things. The language's own
pairing stands.

### Organizing

Two link rows, each one line of explanation and a chevron. Neither
belongs inside a settings card, so neither is a section.

- **Dimensions** (`ui/dimensions.md`). "How your holdings split up in
  the chart." At the right of the row, how many exist right now, or
  "None yet".
- **Export and import** (`ui/export-import.md`). "Download your vault,
  or restore one from a file."

The two rows share one Card with no heading, each running edge to edge
with a hairline rule between them. A row's title sits at the left with
its explanation beneath it, and the count and the chevron sit at the
right. The whole row is the link.

### Change password

Current password · new password · confirm, with the same bar and the
same strength gauge as registration (`ui/register.md`, The strength
gauge).

Said here, in the order somebody would be surprised to learn them:

- A tinted callout above the form: "Your data is not re-encrypted. Only
  the lock around your key is rebuilt, which is why this is fast even
  on a large vault." Said as reassurance, because a password change
  that takes no time otherwise reads as having done nothing.
- Below the form, with a critical-colored icon: "Export files you have
  already saved still open with your old password. They carry their own
  copy of the lock, and changing it here does not reach back and
  protect them." This is the one way somebody can believe they have
  locked something they have not.
- On success, an inline confirmation naming what else happened: "Your
  password is changed. Every other session was signed out, and this one
  is still open."

Top to bottom in the card: the callout, then the fields stacked in one
column at form width with **Change password** beneath them, then the
export files line under a hairline rule at the foot of the card.

### Session and lock

- **Idle lock**, a select: 5, 10, 15, 30, 45, or 60 minutes, with 15
  selected on a vault that has never set it. A vault carrying a value
  outside that range shows the nearest allowed one, and locks at it.
  - Beside it, the tradeoff in one line: "Shorter is safer. Every
    unlock costs the deliberate wait while your password becomes a key
    (`ui/unlock.md`, which owns how long that is)."
  - There is no "never" and the control does not offer one.
- **Absolute session expiry**, stated and not adjustable: "You are
  signed out 12 hours after signing in, however busy you have been."
- **Open sessions**, listed by when each started and when it was last
  used, with the current one marked. One line volunteering the
  absence: "Solvent keeps no IP address readable and records no
  devices." Saying so
  is the point. Somebody who has used any other product assumes they
  are kept.
- **Sign out**, and **Sign out everywhere**, which ends this session
  too.

The card runs in the order listed. The idle lock select holds a 200px
column and the tradeoff sits beside it, level with the control rather
than its label. Open sessions is a Table under its own section label:
a first column carrying the chip that marks the current session, then
started, then last used. The no-IP line sits beneath the table. The two
sign-out buttons close the card side by side, both secondary.

### Delete my account

Behind a collapsed **Danger zone** disclosure, destructive styling.
The disclosure is its own Card at the foot of the screen, its label in
critical. Opened, it holds one destructive button, **Delete my
account**, and that button opens the dialog. Nothing is typed into the
disclosure itself.

The dialog, headed **Delete your account**, asks for the password and
the username, and states plainly what happens:

> Deleting takes the account, everything in the vault, and every
> session you have open. It happens all at once and it cannot be
> undone. Nothing is kept in reserve, and there is no vault left for
> anybody to recover.

**The dialog's primary action is "Export first."** Deletion is the
secondary one, a destructive button reading **Delete my vault**, which
stays disabled until the password is filled and the typed username
matches exactly. Somebody who came here wanting a backup and left with
a wiped vault has been failed by the dialog.

No vault is exempt. Any vault owner can delete their own account,
whoever else is on the instance, because handing out accounts on this
instance is not something a vault owner does.

## At phone width

Everything set side by side stacks. A profile pair puts its label
above its value, the four selects run in one column, and the idle lock
tradeoff moves beneath its select. The sample strip wraps, with
**Save** beneath the sample when the width runs out.

## States

- **Loading**: the profile, the currency, the idle lock, and the
  dimension count come from the in-memory model and render at once. The
  session list is fetched, so that card alone shows skeleton rows.
- **Empty**: not reachable. Every card has content, and the session
  list always holds at least the session reading it.
- **Changing the password**: the button becomes a working state reading
  "Changing your password" and the form goes quiet. It takes a moment:
  the password being replaced and the new one are each turned into a
  key, so the wait is about twice a sign-in's (`ui/unlock.md`, The
  derivation wait). The tab stays responsive throughout.
- **Error, wrong current password**: inline above the first field:
  "That is not your current password." Caught in the browser before
  anything is sent, and nothing is sent.
- **Error, the new password is the current one**: inline, refused
  before anything is derived.
- **Error, the change failed after the slow part**: "Nothing was
  changed. Your current password still works." Every field is kept, so
  nothing is re-typed and nothing is re-derived.
- **Password changed**: the inline confirmation appears under Change
  password, and the Open sessions table reloads
  without leaving the page. It shows skeleton rows while it reloads,
  then one row, carrying the chip that marks the current session. A
  reload that fails shows that card's load error with its retry, as
  when the session list would not load, never the rows from before the
  change.
- **Error, the idle lock would not save**: inline on that control,
  which goes back to the value the vault holds. The lock keeps running
  at that value.
- **Error, the session list would not load**: that card alone shows an
  error with a retry. Every other card still works.
- **Error, signing out everywhere failed**: inline on that control.
  Every session is still open, this one included.
- **Error, deleting failed**: inline in the dialog, which stays open:
  "Nothing was deleted. Your vault is unchanged and you are still
  signed in."
- **Deleting succeeded**: the vault is gone and so is the session. The
  sign-in screen appears with nothing further, because there is no
  account left to say anything to.
- **Populated**: as above.

## Rules

- Every figure and label on this screen that came out of the vault is
  rendered as text, never as markup (`design-system.md`,
  Accessibility).
- Autocomplete: `current-password` and `new-password`.
- The destructive controls are **Sign out everywhere**, which is
  reversible by signing in again, and **Delete my vault**, which is
  not. Only the second is styled destructive and only the second is
  behind a disclosure.

## What it deliberately does not show

- **No editable main currency.** Every rate ever recorded converts into
  it, so relabeling it would leave years of history denominated in the
  old one and the chart would silently add two currencies together.
  Restoring a vault from a file replaces the currency and the whole
  history together, which is why that is not the same thing.
- **No password recovery of any kind.** Changing a password needs the
  current one.
- **No IP addresses, no device names, and no sign-in history beyond the
  open sessions.** None of it is kept readable anywhere, which is why
  the screen says so rather than leaving a blank column. The only trace
  of a connection is the scrambled one a failed sign-in leaves for the
  lock, and it never reaches this screen (`product/login.md`, When it
  goes wrong).
- **No "sign out everywhere except this one".** The only operation that
  keeps this session alive is changing the password, which does it as
  part of the same act.
- **No way to turn the idle lock off.** It is the last defense against
  somebody walking up to an unlocked screen.
- **Nothing about anybody else, and nothing about the instance.** No
  other account, no invite, no unit list, and no entry that leads to
  one. Running the instance is a different account's job, with its own
  screens.
