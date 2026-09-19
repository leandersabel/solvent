# Admin

## Purpose

The administration surface. An administrator hands out accounts on this
instance, removes them, maintains the list of units a holding can be
measured in, and changes their own password. Nothing else is here, and
nothing here reaches a vault.

Exercises: `spec/features/admin-invites.md`, and the symbol table half
of `spec/features/rate-lookup.md`.

## The frame

An administrator's top bar carries the wordmark and **Sign out**, and
nothing else (`app-shell.md`). There is no nav in it, because an
administrator has one destination. Moving around inside that
destination is this screen's own job.

Content max-width 900px on the ground.

## Arrangement

Three things stack, in this order, on every part of the area:

1. **The boundary callout.** Always present, never dismissible.
2. **The section links**: Invites, Accounts, Units, Your password.
   Invites is where the area opens.
3. **The section itself**, as cards.

The section links are a single row at the top of the content region,
above the first card, not in the top bar. The active one takes brass,
which is what brass is for in navigation (`design-system.md`, The
look), and the rest take petrol-600. Identity comes from the word, and
the active one is also marked by a 2px brass-500 rule under it, so it
does not rest on color alone.

The boundary callout sits above the links rather than inside the first
section, because the boundary is a property of the whole area. An
administrator who has been working in Units for ten minutes is exactly
the person about to be asked for help they cannot give.

## The boundary this area states

A tinted petrol-50 callout, full content width, in the app's own voice:

> You can invite and remove people on this instance, and maintain the
> list of units a holding can be measured in. You cannot read anyone's
> accounts, balances, notes, or history, you cannot reset anybody's
> password, and you cannot recover a locked-out vault. Solvent holds no
> key that could, including for the vault behind your own user account.

It carries no icon and no status color. This is not a warning, it is
what the account is.

## Invites

### Create an invite

One card. Three controls, then one primary button, **Create invite
link**.

- **This link creates** a user account or an administrator account. Two
  radio options, "A user account" selected, never remembered from the
  last invite. Choosing the administrator option reveals one line
  directly beneath it, at the point of choice:

  > Whoever uses this link gets an administrator account. They can
  > invite and remove people on this instance, and they get no vault of
  > their own. They still cannot read anyone's data, and neither can
  > anybody else. If that person also wants to keep their own finances
  > in Solvent, they need a separate invite for a user account.

  Radios rather than a checkbox, because the two outcomes are two kinds
  of account rather than one account with something switched on. The
  control decides the kind of the account the link will make, and it is
  the only thing anywhere that decides it: the value is read once, when
  somebody follows the link, and an account carries the kind it was
  born with for as long as it exists.

- **A note to yourself.** Optional free text, "Sarah's laptop". One
  line beneath, at the point of typing:

  > Only administrators see this, and Solvent stores it as you typed
  > it. It is the one thing anybody types in Solvent that the server can
  > read, so keep it to a nickname.

- **This link stops working after.** A select, 1 to 30 days, 7
  selected.

### The link, once

On success the card is replaced in place by the link, in a read-only
field with a **Copy** button beside it, and beneath it:

> Copy this now. Solvent does not store the link and cannot show it
> again.

That is literally true rather than a scare line, because only a hash of
it is kept. For an administrator invite the confirmation names the kind
in its own line above the field: **This is an administrator invite.**

A **Create another** button returns the card to its empty shape, with
the kind back on "A user account" and the note cleared.

### Outstanding invites

A table, newest first. Columns: **Kind** · **Note** · **Created** ·
**Stops working** · **Status** · action.

- **Kind** is first, and carries a chip reading "Administrator" or
  "User". An unused administrator link is the most powerful thing
  outstanding on the instance, so it is read off the leftmost column
  rather than found later by noticing who turned up in Accounts. The
  word carries it, never the color.
- **Note** shows the text, or an ink-muted "None" when there is none.
- **Status** is a chip: **Waiting**, **Used**, **Expired**, or **Called
  back**. A Used chip is followed on the same line by the username it
  produced and the date. A row that is anything other than Waiting sets
  its text in ink-secondary, so the live links stand out from the spent
  ones without a second chip color.
- The action cell offers **Call back** on a Waiting row only, with a
  confirmation dialog:

  > Calling back this link stops it working immediately, even though it
  > has time left. Anybody holding it will be turned away.

- On a Used row the action cell reads, in ink-secondary: "Already used.
  Remove the account instead." The username in the Status cell is a
  link to that row in Accounts.
- On an Expired or Called back row the action cell is empty.
- The link itself never appears in this table.

## Accounts

One table, every account on the instance, both kinds. Columns:
**Username** · **Kind** · **Created** · **Last signed in** · **Items**
· action.

- **Kind** carries the same chip as the invites table, "Administrator"
  or "User". It is shown here and changed nowhere, because it is not
  something an account has, it is what an account is.
- **Last signed in** shows the date, or an ink-muted "Never" for an
  account whose invite was followed but which has not signed in since.
- **Items** is how many things the vault holds. For an administrator the
  cell reads an ink-muted **No vault**, never a zero. Zero and "there is
  nothing to count" are different statements, and a zero invites the
  reader to think a vault is sitting there empty. ink-muted is allowed
  here because the Kind column says the same thing in the same row
  (`design-system.md`, Ink and line).
- Items and the two dates are the whole of what this screen knows about
  an account. There is no row that can be opened and nothing behind a
  username.

### Removing an account

The action cell offers **Remove**, destructive styling. It opens a
dialog that asks for the username and nothing else. No password, no
export, no second step.

For a user account:

> **Remove sarah?**
>
> This deletes the account, everything in its vault, and every session
> it has open. It happens all at once and it cannot be undone.
>
> Solvent cannot save you a copy first. It cannot read what is in
> there.
>
> Type the username to confirm.

For an administrator account:

> **Remove ops.leander?**
>
> This deletes the administrator account and every session it has open.
> There is no vault and nothing encrypted, so nothing becomes
> unreadable. A replacement is made by inviting one.
>
> Type the username to confirm.

The confirm button is filled critical and reads **Remove account**. It
stays disabled until the typed username matches the row exactly.
**Cancel** is the secondary action and has focus when the dialog opens.

The administrator is not asked for their own password. Typing the
username is the whole of the friction, and the dialog leans on it: the
name is typed, not pasted from a placeholder, and the button will not
take a near miss.

Two rows say more:

- **Your own row** adds two lines to the dialog: "This is the account
  you are signed in as. Removing it signs you out immediately." and
  "Any user account you hold is a separate account and is not touched."
- **The only administrator on the instance** has no Remove control at
  all. In its place, in ink-secondary: "The only administrator. Invite
  another one before removing this account." Removing it would leave
  nobody able to hand out an account.

## A locked-out administrator

An administrator who has forgotten their password is replaced rather
than recovered, and that needs no screen of its own: another
administrator removes the account from the table above and creates a
fresh administrator invite from the card above that. Nothing of theirs
was encrypted, so nothing is lost by it.

The one line that has to be on screen for this to be findable is the
one already in the remove dialog for an administrator account: "A
replacement is made by inviting one."

There is no control anywhere in this area that sets a password on
another account. That absence is the point, and it is the reason the
path above is two ordinary actions rather than one special one.

## Units

The instance-wide list of units a holding can be measured in
(`rate-lookup.md`, The symbol table). It is identical for every account
and says nothing about who holds what, which is what makes it an
administrator's to keep.

One table. Columns: **Code** · **Name** · **Kind** · **Rate lookup** ·
action.

- **Code** is tabular and static. `XAU-ozt`, `CHF`. It is never
  editable and there is no control anywhere that renames one.
- **Name** is the display text, editable in place in an inline input.
  Saving writes only this field. It is rendered with `textContent`,
  never as markup (`design-system.md`, Accessibility).
- **Kind** reads "Currency" or "Metal", static.
- **Rate lookup** is a two-state control on each row: **Automatic** or
  **Entered by hand**. Set to Automatic, Solvent proposes a rate when
  somebody records a holding in this unit. Set to Entered by hand, they
  type their own figure and nothing is fetched.

  On a row the server has no price source for, the control is
  **disabled at Entered by hand**, with the reason in ink-secondary
  beside it: "No source for this unit yet. Rate lookup can be turned on
  once one is configured on the server." The row carries whether a
  source exists (`hasAdapter`), so the screen says so up front rather
  than inviting somebody to switch the control on and then refusing
  them. Turning it off stays available on any row.
- The action cell offers **Retire**, or **Restore** on an already
  retired row. A retired row sets its text in ink-secondary and carries
  a **Retired** chip beside its code.
- Retired rows are listed with the rest, in a collapsed **Retired**
  section beneath the table when there is anything in it.

Beneath the table, **Add a unit**, which opens a form:

- **Code.** One line beneath it, at the point of typing:

  > A code is permanent. It is written inside people's vaults as the
  > unit a holding is measured in, and Solvent cannot read those to
  > change it afterwards. Check it before you add it.

  For a metal, a second line gives the shape rather than making
  somebody guess it: "Metals are named `<code>-ozt` or `<code>-g`, such
  as `XAU-ozt`."
- **Name.**
- **Kind**, currency or metal. Fixed once the unit exists, for the same
  reason the code is.
- **Rate lookup**, Entered by hand selected.

### Retiring, which is what this screen has instead of deleting

**Retire** is the only way a unit leaves the picker, and the dialog
says what it does:

> **Retire XAG-g?**
>
> This takes it out of the list people choose from when they set up a
> holding. Accounts already measured in it keep working and keep
> getting rates, and nothing is renamed.
>
> Solvent cannot tell you how many accounts use it. A unit lives inside
> vault data, which it cannot read.
>
> You can put it back at any time.

Restoring puts it back in the picker exactly as it was, and the dialog
for that says so in one line.

A unit is never deleted and never renamed. That is not a control this
screen has chosen to withhold: the code is written into record
ciphertext the server cannot read, so deleting or renaming one would
leave accounts measured in something that no longer exists, findable
only by their owners, one at a time.

## Your password

One card, and the only control in this area that is not about the
instance.

Current password · new password · confirm, with the same bar and the
same strength gauge as registration (`ui/register.md`, The strength
gauge).

- One line above the fields: "This protects the power to remove every
  account on this instance, so it is held to the same bar as anybody
  else's."
- On submit the button becomes a working state reading "Changing your
  password", and the form goes quiet. It takes a moment: the password
  being replaced and the new one are each turned into a key, so the
  wait is about twice a sign-in's. The tab stays responsive throughout.
- On success, an inline confirmation: "Your password is changed. Every
  other session of yours was signed out, and this one is still open."
- A wrong current password is reported inline above the first field:
  "That is not your current password." It is caught when the server
  answers, and the screen must not claim to have caught it any earlier.

## States

### Invites

- **Loading**: skeleton rows in the table. The create card renders
  immediately, since it fetches nothing.
- **Empty**: "No invite links yet." beneath the create card, which is
  the single action. Never an empty table with headers.
- **Error, create failed**: inline above the button. No link was made
  and nothing was consumed. The form keeps every field.
- **Error, call back failed**: inline on the row, status unchanged.
- **Error, the link was used while the table was open**: the row
  refreshes to Used and reads "This link has already been used. Remove
  the account instead."
- **Populated**: as above.

### Accounts

- **Loading**: skeleton rows.
- **Empty**: unreachable. The administrator reading this screen is an
  account, so their own row is always there.
- **Error, list failed**: inline above the table, with a retry. No
  partial table.
- **Error, remove failed**: inline in the dialog, which stays open.
  "Nothing was removed." The account is still there and can still sign
  in.
- **Error, the last administrator**: if the account became the only
  administrator while the dialog was open, the dialog refuses with "The
  only administrator. Invite another one before removing this account."
  and removes nothing.
- **Error, the account is already gone**: "That account is no longer on
  this instance." The dialog closes and the table refreshes.
- **Removing your own account**: the dialog's confirmation is the last
  thing that happens in the session. The sign-in screen appears, with
  no explanation beyond it, because there is no session left to explain
  anything to.
- **Populated**: as above.

### Units

- **Loading**: skeleton rows.
- **Empty**: unreachable. The table is seeded.
- **Error, rename failed**: inline on the row, the old name restored in
  the field.
- **Error, the source went away while the page was open**: a stale
  page, not a routine path. The control was enabled when the table
  loaded and the server refused it anyway, because the adapter registry
  changed underneath. Inline on the row, and the control goes back to
  Entered by hand: "The source for this unit is no longer configured on
  the server. Reload to see the current list." The copy reads as
  something that changed rather than something the administrator got
  wrong. The server refuses regardless of what the page believes,
  because the flag must never promise a proposal the server cannot
  serve and a client's picture of the registry is not a control.
- **Error, that code already exists**: inline in the add form, which
  keeps every field.
- **Error, that is not a valid code**: inline in the add form, naming
  the shape.
- **Error, retire or restore failed**: inline on the row, unchanged.
- **Populated**: as above.

### Your password

- **Loading**: none, the card renders immediately.
- **Changing**: as above, the form quiet and the button working.
- **Error, wrong current password**: as above, nothing changed.
- **Error, the new password is the current one**: inline, refused
  before anything is sent.
- **Error, the change failed**: "Nothing was changed. Your current
  password still works." Every field is kept.
- **Populated**: the confirmation above.

## Rules

- This area answers Not Found to anybody who is not signed in to an
  administrator account, a signed-in vault owner included
  (`app-shell.md`, The two surfaces). Nothing anywhere else in the
  product links to it, names it, or hints that it exists.
- Every control on these screens maps to a route under `/api/admin/` or
  to the shared change-password endpoint. There is no control here
  wired to anything a vault owner uses.
- No screen in this area renders a figure, a balance, an account name
  from anybody's vault, or any other decrypted content, because none is
  reachable from this session.
- Kind is displayed and never edited, on an invite row or an account
  row. There is no control, on any screen, that gives an account a
  vault or takes one away.
- Administrators are peers. No screen shows a rank, a seniority, or an
  owner, and there is no control available to one administrator and
  not to another.
- Destructive controls are the remove-account dialog and the retire
  dialog. Retire is reversible and says so. Removing an account is not
  and says so.

## What it deliberately does not show

- **No session list and no "sign out everywhere".** Changing the
  password already ends every other session of theirs, which is the one
  thing an administrator would reach for either of those to do.
- **No count of how many accounts use a unit.** Not withheld,
  impossible: a unit lives inside record ciphertext the server cannot
  read. The retire dialog says what retiring means instead of showing
  who it touches.
- **No password reset, for any account, of either kind.** There is
  nothing to reset toward in a vault, and an administrator who has lost
  their own password is replaced rather than recovered.
- **No export of a vault before removing it**, and no offer of one in
  the dialog. An administrator cannot read the vault they are
  destroying, so a copy is not theirs to save.
- **No undo, no recycle bin, no grace period** on removing an account.
  There is no readable vault to hold in reserve.
- **No dashboard and no figures of any kind.** This account has no
  vault, so there is nothing to total.
