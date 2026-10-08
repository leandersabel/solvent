# Admin invites

An administrator runs the platform. This page owns provisioning:
single-use, time-limited invite links that each name the kind of account
they create, the list of accounts on the instance, removing one, and the
administrator's own password.

## What the client gets

Solvent has no sign-up, because you asked for a small invited group. An
account exists only because somebody already inside the instance
created a link and handed it to a person they know,
by hand: Solvent sends no mail of any kind, so there is no mail service
to run or trust with a link that grants an account.

There are two kinds of account, different things rather than one thing
with different powers. A **user account** owns a vault, readable only
with its owner's password (`register.md`). An **administrator account**
decides who gets an account and who stops having one, and **has no
vault**: no dashboard, no holdings, no figures, nothing to lock. It is
not an account with financial features switched off. It is for the
household member who runs the instance, and anyone they share that duty
with.

- **Two accounts, one person.** You may hold both kinds: two usernames,
  two passwords, and neither can do the other's work. Privilege is
  stepped into for one task rather than carried all day. The cost is a
  second sign-in. What it buys is an administrator account with nothing
  worth stealing: its password yields a list of usernames and the power
  to delete, and not one figure from any vault, your own included.
- **Administrators are peers.** Several can exist, each able to do
  everything any other can.
- **An account never changes kind.** There is nothing to convert: a
  user account's substance is a vault only its owner can read, and an
  administrator account has none to give or take. Somebody with a vault
  who needs to administer gets a second account.
- **The admin boundary.** You asked for zero-knowledge encryption, so an
  administrator cannot read anyone's data (their own user account's
  included, which they reach by signing in to it like anybody), cannot
  reset a password and cannot recover a locked-out vault. A reset is
  impossible, not withheld: the password is what makes a vault
  readable, so a new one would open an empty room. The only destructive
  power is removing a whole account, which destroys the vault rather
  than opening it, with no export first, no undo and no grace period.
  The line bounds the role without listing its tasks. The tasks will
  grow (handing out accounts, removing them, the list of units), reach
  into a vault never does, and a new task is judged against the line,
  not against the tasks before it. The screen says the line too,
  because "admin panel" means the opposite in nearly every other
  product.
- **The first administrator** comes from an invite produced on the
  machine Solvent runs on, followed in a browser, so its password is
  chosen by the person who uses it. Every later account comes from a
  link handed out in the app.
- **If every administrator password is lost**, the same machine step is
  the way back. Once an administrator exists it asks for confirmation:
  a speed bump against an absent-minded command, not a security
  control, because whoever can run it already holds the machine. It
  reaches no vault.
- **A locked-out administrator** loses nothing, because nothing of
  theirs is encrypted. Another administrator removes the account and
  invites a fresh one. No administrator can set another's password,
  which would be the first thing letting one person act as another.
- **The last administrator account cannot be removed**, or the instance
  could never hand out an account again without going back to the
  machine.

## Screens

### Admin

Hand out accounts, remove them, maintain the units a holding can be
measured in, and change one's own password. Nothing else is here, and
nothing here reaches a vault.

Reachable only by an administrator session. Anybody else, a signed-in
vault owner included, gets the page a mistyped address gets (app-shell.md,
Error page), because confirming that an admin area exists is itself
information. Nothing elsewhere in the product links to it, names it or
hints at it.

#### Layout

The administrator's top bar carries the wordmark and **Sign out** and
nothing else (app-shell.md, The chrome). It has no nav, because moving
inside the one destination is this screen's job. Content max-width 900px
on the ground. Stacked, in this order, on every part of the area:

1. **The boundary callout.** Always present, never dismissible. It sits
   above the links rather than inside the first section, because the
   boundary is a property of the whole area, and an administrator ten
   minutes into Units is exactly the person about to be asked for help
   they cannot give.
2. **The section links**: Invites, Accounts, Units, Your password.
   Invites is where the area opens. This is the section switcher
   (design-system.md, Components), one row at the top of the content
   region. At phone width it stays one row that scrolls sideways.
3. **The section itself**, as full-width cards, each opening on its
   section heading (design-system.md, Components):
   - Invites: the create card, then the outstanding invites table in a
     card of its own.
   - Accounts: one card holding the table.
   - Units: one card holding the table, the collapsed Retired section
     beneath it, and Add a unit beneath that.
   - Your password: one card, fields stacked at form width, the button
     beneath.

#### The boundary callout

A tinted petrol-50 callout, full content width, no icon and no status
color, because it is not a warning, it is what the account is:

> You can invite and remove people on this instance, and maintain the
> list of units a holding can be measured in. You cannot read anyone's
> holdings, balances, notes, or history, you cannot reset anybody's
> password, and you cannot recover a locked-out vault. Solvent holds no
> key that could, including for the vault behind your own user account.

#### Invites

**Create an invite.** One card and a primary button, **Create invite
link**.

- **This link creates**: two radio options, "A user account" selected,
  never remembered from the last invite. Radios, not a checkbox, because
  the outcomes are two kinds of account, not one account with something
  switched on. Choosing the administrator option reveals one line
  directly beneath it:

  > Whoever uses this link gets an administrator account. They can
  > invite and remove people on this instance, and they get no vault of
  > their own. They still cannot read anyone's data, and neither can
  > anybody else. If that person also wants to keep their own finances
  > in Solvent, they need a separate invite for a user account.

- **A note to yourself.** Optional free text, "Sarah's laptop", so
  outstanding links are tellable apart. One line beneath it:

  > Only administrators see this, and Solvent stores it as you typed
  > it. It is the one thing anybody types in Solvent that the server can
  > read, so keep it to a nickname.

- **This link stops working after.** A select, "1 day" to "30 days", 7
  selected. Short enough that a forgotten link expires, long enough to
  survive a weekend.

**The link, once.** On success the card is replaced in place by the link
in a read-only field with a **Copy** button, and beneath it:

> Copy this now. Solvent does not store the link and cannot show it
> again.

That is literal, because only a hash is kept. An administrator invite
adds its own line above the field: **This is an administrator invite.**
**Create another** returns the card to its empty shape, the kind back on
"A user account" and the note cleared.

**Outstanding invites.** A table, newest first, one row per link ever
created. Columns: **Kind**, **Note**, **Created**, **Stops working**,
**Status**, action. The link itself never appears in it.

- **Kind** is first, a chip reading "Administrator" or "User". An unused
  administrator link is the most powerful thing outstanding on the
  instance, so it is read off the leftmost column rather than discovered
  when someone turns up in Accounts. The word carries it, never color.
- **Note** shows the text, or an ink-muted "None".
- **Status** is a chip: **Waiting**, **Used**, **Expired** or **Called
  back**. A Used chip is followed by the username it produced, " on ",
  and the day the link was used, in the Created column's format, so it
  reads "Used sarah on" and the date. The username follows the chip on
  its line where it fits, and otherwise starts the next line. The
  username is a link button: it opens Accounts and, once the list loads,
  scrolls to that account's row and moves focus to its username, drawn
  with the focus ring. Accounts has no address of its own, so the link
  is a button.
  Once that account is removed, by an administrator or by its owner, the
  username gives way to "account removed", with no link, because the
  name is free to register again and the row would credit whoever takes
  it. An account removed while Invites was open is simply absent when
  Accounts opens, and nothing is focused.
  A row that is not Waiting sets its text in ink-secondary, so live links
  stand out without a second chip color.
- The action cell offers **Call back** on a Waiting row only, with a
  confirmation:

  > Calling back this link stops it working immediately, even though it
  > has time left. Anybody holding it will be turned away.

  On a Used row it reads, in ink-secondary: "Already used. Remove the
  account instead.", or "Already used. The account it created has since
  been removed." once that account is gone. On an Expired or Called back
  row it is empty.

#### Accounts

One table, every account, both kinds. Columns: **Username**, **Kind**,
**Created**, **Last signed in**, **Items**, action.

- **Kind** carries the same chip as the invites table, shown here and
  changed nowhere.
- **Last signed in** always shows a date, because creating an account is
  its first sign-in (How it works, Endpoints).
- **Items** is how many things the owner added to the vault: one for
  each holding, one for each holding in each recording, and one for each
  price. The vault's own settings are not counted, so a vault nobody has
  added anything to reads 0. The count is drawn in the row's ink,
  because nothing else in the row says it. For an administrator it
  reads an ink-muted **No vault**, never a zero, because a zero invites
  the reader to think a vault sits there empty. Ink-muted is allowed
  because the Kind column says the same in the same row
  (design-system.md, Ink and line).
- Items and the two dates are all this product knows about someone
  else's account, enough to check it is the right one and not in active
  use. None of it is content, and no fact is added without checking the
  boundary. No row opens and nothing sits behind a username.

**Removing an account.** The action cell offers **Remove**, in
destructive styling. Its dialog asks for the username and nothing else:
no password, no export, no second step.

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
stays disabled, in the shared disabled look (design-system.md,
Components), until the typed username matches the row exactly, so a
near miss does not enable it. The name is typed, not pasted from a
placeholder. **Cancel** is the secondary action and has focus on open.

The administrator is not asked for their own password. The cost: a
session left open on an unlocked machine can destroy somebody's history
in two clicks, and nothing locks it short of the twelve-hour session
limit (login.md, The session a sign-in issues). Keeping the machine to
oneself is what protects it.

- **Your own row** adds two lines to the dialog: "This is the account
  you are signed in as. Removing it signs you out immediately." and "Any
  user account you hold is a separate account and is not touched."
- **The only administrator** has no Remove control. In its place, in
  ink-secondary: "The only administrator. Invite another one before
  removing this account."

A locked-out administrator needs no screen of its own. The
administrator dialog's "A replacement is made by inviting one." is what
makes the path findable.

#### Units

The instance-wide list of units a holding can be measured in. Its rules
(immutable code and kind, no delete, retiring, the `hasAdapter` refusal)
are `rate-lookup.md`'s (Maintaining the table). It is identical for every
account and says nothing about who holds what, which makes it an
administrator's.

One table. Columns: **Code**, **Name**, **Kind**, **Rate lookup**,
action.

- **Code** is tabular and static (`XAU-ozt`, `CHF`), never editable.
- **Name** changes by an inline rename (design-system.md, Components),
  which saves only this field. Rendered with `textContent`, never as
  markup.
- **Kind** reads "Currency" or "Metal", static.
- **Rate lookup** is a two-state control: **Automatic** (Solvent proposes
  a rate when somebody records a holding in this unit) or **Entered by
  hand** (they type their own and nothing is fetched). On a row with no
  source (`hasAdapter` false) the control is disabled at Entered by
  hand, with the reason in ink-secondary beside it: "No source for this
  unit yet. Rate lookup can be turned on once one is configured on the
  server." Turning it off stays available on any row.
- The action cell offers **Retire**, or **Restore** on a retired row. A
  retired row sets its text in ink-secondary and carries a **Retired**
  chip beside its code. Retired rows sit in a collapsed **Retired**
  section beneath the table when there are any.
- A retired metal whose code names no weight (`rate-lookup.md`, Seeded
  symbols) has Restore disabled, with the reason in ink-secondary
  beside it: "It names no weight, so it cannot be restored. Metals are
  named `<code>-ozt` or `<code>-g`, such as `XAU-ozt`."

**Add a unit**, beneath the table, opens a form:

- **Code**, with one line beneath it:

  > A code is permanent. It is written inside people's vaults as the
  > unit a holding is measured in, and Solvent cannot read those to
  > change it afterwards. Check it before you add it.

  While Kind is Metal, a second line gives the shape: "Metals are named
  `<code>-ozt` or `<code>-g`, such as `XAU-ozt`."
- **Name.**
- **Kind**, currency or metal, fixed once the unit exists.
- **Rate lookup**, disabled at Entered by hand, with the no-source
  reason beneath it. Every unit a source serves is already in the
  table (`rate-lookup.md`, Seeded symbols), so a unit added here has
  none.

**Retiring, not deleting.** Retire is the only way a unit leaves the
picker:

> **Retire XAG-g?**
>
> This takes it out of the list people choose from when they set up a
> holding. Holdings already measured in it keep working and keep
> getting rates, and nothing is renamed.
>
> Solvent cannot tell you how many holdings use it. A unit lives inside
> vault data, which it cannot read.
>
> You can put it back at any time.

Restoring puts it back in the picker exactly as it was, and its dialog
says so in one line.

#### Your password

One card, the only control here not about the instance (How it works,
An administrator's own credential). Current password, new password,
confirm, with the bar and strength gauge registration uses (register.md,
Register), in a form with the username (design-system.md, Components,
Password field). Enter submits it once the button is enabled.

- One line above the fields: "This protects the power to remove every
  account on this instance, so it is held to the same bar as anybody
  else's."
- On submit the button becomes a working state reading "Changing your
  password" and the form goes quiet. Two passwords become keys, so the
  wait is about twice a sign-in's (login.md, Unlock).
- On success, inline: "Your password is changed. Every other session of
  yours was signed out, and this one is still open."
- A wrong current password is reported inline above the first field:
  "That is not your current password." It is caught when the server
  answers, and the screen claims nothing earlier.

#### At phone width

Up to 900px wide, narrower than the full tables need, each table
becomes a list of entries, one per row, divided by
hairlines. An entry puts each cell on a line of its own, beside its
column's heading in ink-secondary, and the row's action beneath them,
so every detail and every control stays on screen without panning
sideways.

At every width a chip in these tables stays on one line, because its
wording is fixed and a word or two long, and a column is never
narrower than its chip. A username or a note can be one long word, so
it breaks anywhere rather than widen the table.

#### States

Every table loads as skeleton rows. The create card and the password card
render at once, since they fetch nothing. Accounts is never empty (the
reader's own row is always there), and neither is Units (the table is
seeded).

A request refused because the session ended, by its time limit or by a
password change in another session, takes the page to the sign-in
screen (login.md), because nothing here can act without a session.

Invites:
- **Empty**: "No invite links yet." beneath the create card.
- **Error, create failed**: inline above the button. No link was made,
  nothing was consumed, every field is kept.
- **Error, call back failed**: inline on the row, status unchanged:
  "The link was not called back. Try again."
- **Error, the link was used while the table was open**: the row
  refreshes to Used and reads "This link has already been used. Remove
  the account instead."

Accounts:
- **Error, list failed**: "The account list would not load." inline
  where the table goes, with a Retry that loads it again. No partial
  table.
- **Error, remove failed**: inline in the dialog, which stays open:
  "Nothing was removed." The account is still there and can sign in.
- **Error, the last administrator**: if the account became the only
  administrator while the dialog was open, the dialog refuses with "The
  only administrator. Invite another one before removing this account."
  and removes nothing.
- **Error, the account is already gone**: "That account is no longer on
  this instance." The dialog closes and the table refreshes.
- **Removing your own account**: the confirmation is the last thing in
  the session. The sign-in screen appears with no explanation, because
  no session is left to explain anything to.

Units:
- **Error, rename failed**: inline on the row, the field still open with
  what was typed and the old name still shown as current.
- **Error, the source went away while the page was open**: inline on the
  row, the control back at Entered by hand: "The source for this unit is
  no longer configured on the server. Reload to see the current list."
  It reads as something that changed, not a mistake.
- **Error, that code already exists** ("That code already exists."), or
  **that is not a valid code**, naming the shape: inline in the add
  form, every field kept. For a currency: "That is not a valid code.
  Use letters, digits, dots, dashes and underscores, starting with a
  letter or digit." For a metal: "That is not a valid metal code.
  Metals are named `<code>-ozt` or `<code>-g`, such as `XAU-ozt`."
- **Error, retire or restore failed**: inline on the row, unchanged:
  "Nothing was retired." or "Nothing was restored."

Your password:
- **Error, the new password is the current one**: inline, refused before
  anything is sent: "The new password is your current one."
- **Error, the change failed**: "Nothing was changed. Your current
  password still works." Every field is kept.

#### Rules

- Every control maps to a route under `/api/admin/` or to
  `POST /api/auth/change-password`. Nothing here is wired to anything a
  vault owner uses.
- No screen here renders a figure, a balance, a holding's name or any
  other decrypted content, because none is reachable from this session.
- Kind is displayed and never edited. No control gives an account a
  vault or takes one away.
- No screen shows a rank, seniority or owner, and no control is
  available to one administrator and not another.
- The destructive controls are the remove dialog and the retire dialog.
  Retire is reversible and says so. Removal is not, and says so.
- There is no session list and no "sign out everywhere", because
  changing the password already ends every other session.

## How it works

### What it does

**An administrator account is a kind of account, not a capability on a
vault-owning one** (architecture.md, Accounts on this instance). Beyond
provisioning, the role holds the unit and symbol table (rate-lookup.md,
The symbol table) and its own password (An administrator's own
credential). Both clear the boundary on their own.

### The admin boundary

No decryption ability over any vault is a statement about what the
account is, not about careful endpoints. An administrator principal has
no `dek_wrappers` row and no `records` row, and the schema refuses
either (app-shell.md, Database). So an administrator session holds no
key material for an endpoint to leak and nothing for a mistaken join to
pull back. The request gate refuses an administrator session every vault
route (app-shell.md, The two surfaces). An administrator's requests
carry no vault epoch, and an `X-Solvent-Vault` on one is ignored
(app-shell.md, The request gate).

On top of that, no endpoint ever returns any record ciphertext, any
field of any credential row (salt, KDF envelope, Auth Key hash) or any
wrapper.

**The same person's two accounts are linked nowhere, and no feature may
add a link.** A stored association between an administrator and "their"
vault would make an administrator the owner of something encrypted, and
the first feature to read it would cross this line.

**This is the one test a new administrator task has to pass.** A task
belongs to the role if it touches no vault: no record ciphertext, no
credential field, no wrapper, and no fact about what is inside anyone's
vault. It does not have to resemble anything already on the list.

### Invite lifecycle

An invite row: `id`, `token_hash`, `kind`, `created_by`, `created_at`,
`expires_at`, `status`, `used_at`, `used_by`, `label`.

- **`kind`** is `vault_owner` or `administrator`, chosen at creation and
  never edited. It is the sole source of the kind of the account the
  invite produces (register.md). It is decided before the account exists
  and read once, when the account is written, which makes "kind is fixed
  at creation" true of the account rather than merely unexposed.
- **Token**: 256 bits from `secrets.token_urlsafe(32)`, shown once in the
  creation response and never retrievable, because only its hash is
  stored (architecture.md, Storage & data handling).
- **Hashing**: SHA-256. The token is high-entropy, so a slow KDF buys
  nothing. Lookup hashes the presented token and finds the hash, in
  constant time, never by scanning and comparing plaintext.
- **Expiry**: default 7 days, set at creation within 1 to 30 days.
- **Status**: `pending`, then `used` or `revoked`. `expired` is derived
  from `expires_at` and never stored, so it cannot drift.
- **Single use**: consumed atomically in the transaction that inserts the
  account (register.md). A failed registration does not consume it. Of
  two registrations racing on one invite, exactly one wins, and the
  other gets the generic invalid-invite error.
- **`used_by`** is the username the invite registered, and is set to
  null in the transaction that deletes that principal, by either
  deletion path, through a trigger (app-shell.md, Database). A start-up
  pass clears any `used_by` naming no principal. `status` and `used_at`
  stay.
- **`label`** is the note, deliberately server-side plaintext, because
  invites are provisioning metadata, not vault data. Encrypting it would
  make the invite list readable only by the administrator who wrote it.
- **`created_by`** is the minting administrator, or the reserved
  sentinel `system:bootstrap` for an invite minted by the CLI, which runs
  with no session and no principal. Registration refuses the sentinel as
  a username, so it never names a real account. A sentinel rather than an
  empty value, so every row names its origin and no reader special-cases
  an absence. **It is stored and never returned** by `GET
  /api/admin/invites` or any screen, because administrators are peers.
  It is kept because it separates a CLI-minted invite from one handed
  out in the app.

### Endpoints

The provisioning endpoints. rate-lookup.md owns the symbol table's.
Every path under `/api/admin/`, named here or not, is refused to anyone
but an administrator as an invented `/api/` path is (architecture.md,
Refusals).

- `POST /api/admin/invites` `{ expiresInDays, label, kind }` returns
  `{ id, token, url, expiresAt, kind }`, the only response that ever
  carries the token. **`kind` is required and has no default.** Any value
  other than `vault_owner` or `administrator` is a Bad Request. A caller
  that does not say which kind of account has not said enough. The
  screen presents a default (Admin, Invites), and an API has no screen
  to explain one on.
- `GET /api/admin/invites` returns a list of `{ id, label, kind,
  createdAt, expiresAt, status, usedAt, usedBy }`. **Never the token or
  its hash.** `usedBy` is null on a used invite whose account is gone.
- `POST /api/admin/invites/<id>/revoke` sets `status: revoked`, and a
  revoked link already sent is refused at once. Idempotent on a revoked
  invite. An administrator may revoke their own invites with no special
  case. A used one is a Conflict `{"refused":"invite-used"}`, its status
  unchanged, because removing the account is the only remedy and the
  reason lets the screen say so (Admin, States).
- `GET /api/admin/accounts` returns, per account, `{ username, kind,
  createdAt, lastLoginAt }`, plus `itemCount` **for a vault owner
  only**. Both kinds are listed, because an administrator needs to see
  the others to know whether they are the last and to remove one.
  - `lastLoginAt` is a timestamp on every row and never null, because
    registration is a sign-in (login.md, The session a sign-in issues).
    A row whose `last_login_at` is null in the file is filled with its
    `created_at` at start-up (app-shell.md, Database).
  - `itemCount` counts the vault's `account`, `snapshot` and `rate`
    records. Every `profile` record is left out, because registration
    writes one and a second is allowed (record-api.md, Edge cases).
  - `itemCount` is **absent** for an administrator, not zero. Zero and
    "has no vault" are different statements. The response is a union
    discriminated on `kind`, the shape rule `params` follows
    (architecture.md, Credentials and vault key wrappers). Nothing about
    vault contents goes beyond the count the server already sees.
- `DELETE /api/admin/accounts/<username>` `{ confirmUsername }` deletes
  the principal's row, its credential, its wrapper, its vault epoch,
  every record and every session, in one transaction. Keyed by
  normalized username, which the account list returns and the
  administrator types. A `confirmUsername` that differs from the path
  segment is a Bad Request. A username that does not exist is Not Found,
  identical to the refusal of an invented `/api/` path. It compares no
  vault epoch (architecture.md, Vault epoch), so a removed account that
  is signed in loses its sessions with the transaction and its next
  request is Unauthorized, never `vault-replaced`. On an administrator
  it destroys no data, so it needs nothing beyond the confirmation and
  the last-administrator guard.

  Removing a vault owner is not that person removing themselves
  (account-settings.md, Delete my account): it takes no password,
  because an administrator has none that would help, and offers no
  export, because an administrator cannot decrypt the vault.

There is no admin export and no admin password reset, because neither is
possible (The admin boundary). **There is no endpoint that changes an
account's kind**: no promote, no demote, and no request field read into
`principals.kind` after the insert. An administrator account is made by
the bootstrap CLI's invite or an administrator invite, and unmade only by
deleting it. Adding such an endpoint is checked against The admin
boundary first.

### Who may remove whom, and the last administrator

- **An administrator may remove any account of either kind**, another
  administrator included. Administrators are peers with no hierarchy: the
  client asked for several and named no seniority.
- **An administrator may remove their own account** here while another
  administrator remains, which ends their own session with the
  transaction.
- **An administrator's own account is removed here and nowhere else.**
  `DELETE /api/auth/account` is a vault owner's endpoint
  (account-settings.md) and answers an administrator Not Found. One
  deletion path means one place the guard has to hold.
- **At least one administrator exists at all times.** A deletion that
  would leave none, the last administrator removing themselves
  included, is a Conflict and deletes nothing. Without it the instance
  could never provision again without shell access.

**The guard and the delete are one `BEGIN IMMEDIATE` transaction.**
Counting and deleting outside one write transaction lets two
administrators remove each other at once, each counting two and each
deleting one, leaving zero. Serialized, the second counts one and is
refused (or finds its own session gone with its account), and exactly
one administrator remains.

There is no guard on removing the last vault owner. An instance with
administrators and no vault owners is idle, not broken.

### An administrator's own credential

Settings is a vault screen (account-settings.md), so an administrator has
none, and a password nobody can rotate is a defect. So the admin area
carries Change password (Admin, Your password).

- It posts to `POST /api/auth/change-password`, the endpoint a vault
  owner uses, sending no wrapper (account-settings.md, Change password).
- It ends every other session of that administrator and keeps the
  current one. That is the administrator's "sign out everywhere", so
  there is no separate control.
- There is no session list for an administrator and no `POST
  /api/auth/logout-all`. Both are on the vault surface (app-shell.md, The
  two surfaces).

**An administrator who forgot their password is replaced, not
recovered.** Removal and re-invitation reach the same end state without
anyone holding a credential they did not derive themselves, and cost
nothing because the account held nothing.

### Bootstrap: the first administrator, and the locked-out one

The first account on a fresh instance comes from a CLI command the
operator runs on the host:

```
flask create-invite --kind administrator --expires-days 1
```

It prints an invite URL and exits. **`--kind` is required**, taking
`administrator` or `vault-owner`, and the invite carries that kind for
the account to inherit (register.md). It creates an invite and never an
account, which keeps every credential derived in a browser: no account
exists whose Argon2id ran server-side.

**It requires `--force` whenever an administrator account exists.**
Without it, it refuses, exits non-zero, and prints how many accounts of
each kind exist, what it is about to create, and the flag that would
proceed. That condition, not
"any account exists", because an instance with an administrator has the
admin area for this, while an instance with vault owners and no
administrator is the state the command exists to repair. When the sole
administrator loses their password, the operator runs it with `--force`
to mint a new administrator invite. This recovers the instance, never a
vault, and vault accounts are untouched.

It does not refuse outright. Whoever can run it holds the SQLite file,
`SECRET_KEY` and the served JavaScript, which architecture.md (Threat
model) does not defend against, so a hard block would stop someone who
has already won at the cost of the only recovery path, leaving
hand-editing SQLite against hashed tokens, which no spec covers. The
confirmation is friction, not security.

### Rules

- The invite URL is `https://<host>/register?invite=<token>`. The
  administrator copies it and delivers it out of band. An expired,
  reused, revoked or unknown invite is refused with the one generic
  error (register.md).
- **`/register` and the admin pages carry `Referrer-Policy:
  no-referrer`.** The register page is the one that matters: the token
  rides in its URL, so its outbound navigations could carry the token in
  a `Referer`. The CSP already blocks third-party subresources, and the
  header closes the rest at no cost.
- **The register page drops the token from the address bar** with
  `history.replaceState` once the form has taken it, so a bookmark, a
  shared screen or a history sync carries nothing. The form submits the
  token it holds, not the URL's copy.
- **No line the container writes to standard output or standard error
  carries an invite token**, the access log included, which records the
  path without its query (architecture.md, Storage & data handling). No
  app log line names the query string or the body of a request. `flask
  create-invite` prints to its own standard output, which `docker exec`
  hands to the operator and the container's log never receives. A
  deployment's reverse proxy or tunnel may still log the full URL, which
  is documented. The short expiry and single use bound that exposure.

## Edge cases

The refusals, races and removals above are stated where they apply:
racing registrations (Invite lifecycle), revoking a used invite and
removing a signed-in or unknown account (Endpoints), the last
administrator and mutual removal (Who may remove whom, and the last
administrator), and the lost sole password (Bootstrap). The rest:

- **A vault owner hits an admin endpoint**: refused as an invented
  `/api/` path is.
- **An administrator removes another administrator**: allowed, and no
  vault data is involved.

## Acceptance criteria

1. (walk) Registration with no valid invite creates no account, and only
   an administrator session can create an invite. Test:
   `tests/test_register_refusals.py::test_the_five_bad_tokens_answer_the_same_bytes`,
   `tests/test_admin.py::test_a_vault_owner_gets_not_found_from_every_admin_route`.
2. (walk) Creating an invite returns the token once, and the invite list
   carries neither the token nor its hash. Test:
   `tests/test_admin.py::test_creating_an_invite_returns_the_token_exactly_once`.
3. (blind) The plaintext token appears in no table, only its hash, read
   from a dump of the whole database. Test:
   `tests/test_admin.py::test_the_db_stores_only_the_token_hash`.
4. `created_by` is stored and never returned by the invite list. Test:
   `tests/test_admin.py::test_created_by_is_stored_and_never_returned`.
5. `expired` is derived from `expires_at`, never stored. Test:
   `tests/test_admin.py::test_expired_is_derived_and_not_stored`.
6. (walk) A valid invite registers one account and is then `used`, and a
   second attempt with it fails. Test:
   `tests/test_auth.py::test_the_invite_is_consumed_and_a_second_use_fails`.
7. (walk) A revoked invite fails registration before its expiry, and an
   expired invite fails registration. Test:
   `tests/test_auth.py::test_used_revoked_and_expired_invites_produce_identical_errors`.
8. (blind) (walk) Invalid, expired, used and revoked invites yield
   byte-identical registration errors, status, headers and body, shared
   with register.md. Test:
   `tests/test_register_refusals.py::test_the_five_bad_tokens_answer_the_same_bytes`,
   `tests/test_auth.py::test_the_register_page_renders_one_message_for_every_bad_invite`.
9. (walk) Revoking a revoked invite succeeds again, and revoking a
   `used` one is a Conflict `{"refused":"invite-used"}` that leaves its
   status. Test:
   `tests/test_admin.py::test_revoking_is_idempotent_and_refused_on_a_used_invite`,
   `tests/test_review_admin_invites.py::test_review_calling_back_a_used_link_is_a_conflict_naming_invite_used`.
10. `POST /api/admin/invites` without `kind`, or with a value other than
    the two kinds, is a Bad Request and creates nothing. Test:
    `tests/test_admin.py::test_kind_is_required_and_has_no_default`.
11. (walk) An invite with `kind: administrator` produces an
    administrator with no wrapper, and one with `kind: vault_owner`
    produces a vault owner with one, asserted against the rows. Test:
    `tests/test_admin.py::test_an_invite_kind_decides_the_accounts_kind`.
12. The schema refuses a records row or a wrapper for an administrator.
    Test: `tests/test_schema.py::test_the_schema_refuses_a_records_row_for_an_administrator`,
    `tests/test_schema.py::test_the_schema_refuses_a_dek_wrapper_for_an_administrator`.
13. (blind) (walk) A vault owner session gets Not Found from every
    `/api/admin/` route, enumerated at test time under every method it
    answers, matching an invented `/api/` path in body and headers, and
    nothing is created or deleted. Test:
    `tests/test_admin.py::test_every_admin_route_is_refused_as_an_invented_api_path_is`,
    `tests/test_admin.py::test_a_vault_owner_gets_not_found_from_every_admin_route`.
14. (blind) An `/api/admin/` request with the header and no session is
    Unauthorized, and one without the header is Forbidden whatever the
    session. Tests must send both. Test:
    `tests/test_guard.py::test_every_api_route_is_forbidden_without_the_header_and_unauthorized_without_a_session`.
15. (walk) Opening `/admin` signed out or as a vault owner shows the
    same page as an invented address. Test:
    `tests/test_guard.py::test_the_admin_area_is_not_confirmed_to_anyone_who_may_not_reach_it`.
16. (blind) No endpoint under `/api/admin/` returns any credential field,
    wrapper or record ciphertext, checked over every route enumerated at
    test time and each one's full response shape, never a fixed list.
    This is the executable admin boundary. Test:
    `tests/test_admin.py::test_no_admin_route_returns_a_credential_field_a_wrapper_or_a_ciphertext`.
17. (blind) No request to any endpoint changes an existing account's
    kind, attempted through every route enumerated at test time. Test:
    `tests/test_admin.py::test_no_route_anywhere_changes_an_existing_accounts_kind`.
18. (blind) (walk) Every control in the rendered admin area maps to a
    route under `/api/admin/` or to `POST /api/auth/change-password`,
    asserted against the rendered area. Test: no test.
19. (walk) The admin area shows the boundary callout and the sections
    Invites, Accounts, Units and Your password, in that order. Test:
    `tests/browser/parts/admin.mjs`.
20. (walk) The created link is shown once, an administrator's account
    row reads No vault, never a zero, and only No vault is drawn in
    ink-muted. Test: `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-ink.mjs`.
21. (blind) (walk) `GET /api/admin/accounts` lists both kinds, and an
    administrator's row has no `itemCount` key, asserted against the
    row's full key set, not its value. Test:
    `tests/test_admin.py::test_the_account_list_carries_no_item_count_for_an_administrator`.
22. (blind) After the first administrator registers through a CLI invite,
    and again after a vault owner and a second administrator register
    through in-app invites, every row's `lastLoginAt` is non-null and
    equals its `createdAt`. A sign-in with the clock advanced moves that
    row past its `createdAt` and no other row. Test:
    `tests/test_last_login.py::test_the_admin_account_list_never_shows_a_null_last_sign_in`.
23. (blind) A `principals` row with a null `last_login_at` in the file
    before start-up comes back with its `createdAt` as `lastLoginAt`.
    Test: `tests/test_last_login.py::test_a_backfilled_null_comes_back_as_created_at_through_the_admin_list`.
24. (walk) Removing an account deletes its principal, credential,
    wrapper, vault epoch, records and sessions in one transaction, and
    its next request is Unauthorized and its login fails. Test:
    `tests/test_admin.py::test_removing_an_account_takes_its_vault_and_leaves_every_other_alone`,
    `tests/test_schema.py::test_deleting_a_principal_cascades_to_everything_it_owns`.
25. (blind) A removed vault owner leaves no `vault_epochs` row. Test:
    `tests/test_vault_epoch.py::test_an_administrator_removing_a_vault_owner_removes_the_epoch_and_compares_none`.
26. (blind) (walk) An administrator's removal of a vault owner succeeds
    with no `X-Solvent-Vault`, with a wrong one and with the owner's
    current one, and the owner's page then meets Unauthorized, not
    `vault-replaced`. Test:
    `tests/test_vault_epoch.py::test_an_administrator_removing_a_vault_owner_removes_the_epoch_and_compares_none`
    covers the no-header case only.
27. (walk) Removing one account leaves every other account's records and
    sessions untouched, with two populated vaults. Test:
    `tests/test_admin.py::test_removing_an_account_takes_its_vault_and_leaves_every_other_alone`.
28. (blind) A fault injected mid-delete leaves the target account intact,
    shown by signing in with it, not by reading rows. Test: no test.
29. A `confirmUsername` that differs from the path segment is a Bad
    Request and deletes nothing. Test:
    `tests/test_admin.py::test_a_mismatched_confirm_username_deletes_nothing`.
30. Removing a username that does not exist answers exactly as an invented
    `/api/` path. Test:
    `tests/test_review_refusals.py::test_unknown_username_delete_matches_invented_api_path`.
31. (walk) The last remaining administrator cannot remove their own
    account: a Conflict, nothing deleted. Test:
    `tests/test_admin.py::test_the_last_administrator_cannot_remove_their_own_account`.
32. (walk) The only administrator's row has no Remove control. Test:
    `tests/browser/parts/admin.mjs`.
33. (blind) Two overlapping deletes, each removing one of the only two
    administrators, leave exactly one administrator. The serial case
    passes either way. Test:
    `tests/test_admin.py::test_the_guard_and_the_delete_are_one_transaction`.
34. (walk) An administrator removes another while a third remains, and
    the removed account can no longer sign in. Test:
    `tests/test_admin.py::test_an_administrator_removes_another_while_a_third_remains`.
35. (blind) (walk) An administrator who is not the last removes their
    own account and their session ends, shown by a refused next request,
    not by the success status. Their user account is untouched. Test: no
    test.
36. (blind) (walk) The disabled Remove account button shows petrol-200
    fill and border, an ink-secondary label, full opacity, a default
    cursor and no red, and turns red once the username matches, asserted
    on computed style. Test: `tests/browser/parts/admin.mjs`.
37. (walk) An administrator changes their password through
    `POST /api/auth/change-password` with no wrapper: the new one signs
    in and the old one does not. Test:
    `tests/test_auth.py::test_an_administrator_changes_their_password_without_a_wrapper`.
38. (walk) A password change ends every other session of the caller and
    keeps the current one. Test:
    `tests/test_auth.py::test_a_password_change_ends_every_other_session_and_keeps_this_one`.
39. An administrator gets Not Found from `DELETE /api/auth/account`.
    Test: `tests/test_auth.py::test_an_administrator_cannot_delete_through_the_vault_owners_path`.
40. `flask create-invite --kind administrator` on an instance with no
    administrator produces an invite whose account is an administrator
    with no vault. Test:
    `tests/test_admin.py::test_the_cli_mints_an_administrator_invite_on_a_fresh_instance`.
41. With an administrator present the CLI exits non-zero, prints the
    counts per kind and the `--force` flag, and creates nothing, and with
    `--force` it succeeds. Test:
    `tests/test_admin.py::test_the_cli_refuses_without_force_once_an_administrator_exists`.
42. `flask create-invite` without `--kind` exits non-zero and creates
    nothing. Test:
    `tests/test_admin.py::test_the_cli_without_kind_exits_non_zero_and_creates_nothing`.
43. The CLI creates an invite and never an account, asserted against
    `principals`. Test:
    `tests/test_admin.py::test_the_cli_creates_an_invite_and_never_an_account`.
44. A CLI-minted invite records `created_by` as `system:bootstrap`, and
    registering that value as a username is refused. Test:
    `tests/test_admin.py::test_the_cli_records_the_bootstrap_sentinel_and_refuses_it_as_a_username`.
45. (walk) `/register` carries `Referrer-Policy: no-referrer`. Test:
    `tests/test_headers.py::test_every_register_response_says_no_referrer_in_the_header`.
46. (walk) The register page drops the token from the address bar. Test:
    `tests/browser/parts/register.mjs`.
47. (blind) (walk) No invite token reaches the real gunicorn's standard
    output or standard error, run with the Dockerfile's arguments, over
    a token from the API and one from `flask create-invite`, `/register`
    requests for a valid, used, expired, revoked and unknown token and a
    registration, read after gunicorn stops. Not a source grep or the
    app's logger alone. Test:
    `tests/test_deployment.py::test_no_invite_token_reaches_the_containers_standard_output_or_error`.
48. (walk) A freshly registered vault reads 0 items, and one holding one
    `account`, one `snapshot`, one `rate` and a second `profile` record
    reads 3. Test:
    `tests/test_admin.py::test_items_count_what_the_owner_added_and_no_profile`.
49. (walk) The password card's error line sits above the Current
    password field. Test: `tests/browser/parts/admin.mjs`.
50. (walk) Removing an account, by an administrator or by its owner,
    clears the username from the invite that created it and leaves it
    used, and a start-up clears a stale one. Test:
    `tests/test_admin.py::test_removing_an_account_clears_its_name_from_the_invite`.
51. (walk) A used invite whose account is gone reads "account removed"
    and "Already used. The account it created has since been removed."
    Test: `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-used.mjs`.
52. (walk) The password card's fields sit in a form holding the
    administrator's username in a hidden text field with autocomplete
    `username`, ahead of the password fields. Test:
    `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-forms.mjs`.
53. (walk) On Invites, Accounts and Units, at 320, 390, 768, 901 and
    1280px, with a waiting administrator invite carrying a long note,
    used invites and a 32-character username, nothing scrolls sideways
    but the section links, no control is drawn past the screen's edge,
    and no word of a chip, heading or control is split across lines.
    Test: `tests/browser/parts/admin-phone.mjs`,
    `tests/browser/parts/admin-review-phone.mjs`,
    `tests/browser/parts/admin-review-used.mjs`.
54. (walk) Adding a metal whose code names no weight, such as `XYZ`,
    shows "That is not a valid metal code. Metals are named `<code>-ozt`
    or `<code>-g`, such as `XAU-ozt`." in the add form, and the unit
    list stays without it. Test: `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-units.mjs`.
55. A retired metal whose code names no weight has Restore disabled with
    its reason beside it, while a retired `XAG-g` and a retired currency
    can be restored. Test: `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-units.mjs`.
56. (walk) Add a unit shows Rate lookup disabled at Entered by hand with
    "No source for this unit yet. Rate lookup can be turned on once one
    is configured on the server." beneath it, and a currency it adds
    that no source serves, such as `XTS`, lists disabled at Entered by
    hand with the same reason. Test: `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-unit-lookup.mjs`.
57. (walk) A used invite reads its username and the day it was used, and
    the username opens Accounts with focus on that account's username.
    Test: `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-used.mjs`.
58. (walk) While the password card reads "Changing your password", its
    fields, their Show toggles and its button are disabled, and typing
    into New password enables nothing. Test:
    `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-working.mjs`.
59. (blind) (walk) A screen reader names A note to yourself and This
    link stops working after on Invites, Type the username to confirm in
    the Remove dialog, Code, Name, Kind and Rate lookup in Add a unit,
    and each field of the password card, by the label shown beside it.
    It names each Units row's Rate lookup by its column's heading and
    the unit's code, such as "Rate lookup, CHF". Test:
    `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-names.mjs`.
60. A Retire or Restore the server refuses reads "Nothing was retired."
    or "Nothing was restored." on its row, which stays as it was. Test:
    `tests/browser/parts/admin.mjs`,
    `tests/browser/parts/admin-review-refused.mjs`.
61. (walk) Calling back an invite that was used while Invites was open
    refreshes its row to Used, reading "This link has already been
    used. Remove the account instead.", and a call back the server
    fails reads "The link was not called back. Try again." on a row
    still Waiting, a Conflict that names no `invite-used` included.
    Test: `tests/browser/parts/admin-callback.mjs`,
    `tests/browser/parts/admin-review-invite-used.mjs`.
62. (walk) An account list the server fails reads "The account list
    would not load." with a Retry that loads it, and with the session
    ended, opening Accounts goes to the sign-in screen. Test:
    `tests/browser/parts/admin-accounts-error.mjs`,
    `tests/browser/parts/admin-review-accounts-error.mjs`.
63. (walk) Add a unit shows "Metals are named `<code>-ozt` or `<code>-g`,
    such as `XAU-ozt`." beneath Code only while Kind is Metal. Test:
    `tests/browser/parts/admin-unit-shape.mjs`,
    `tests/browser/parts/admin-review-unit-shape.mjs`.
