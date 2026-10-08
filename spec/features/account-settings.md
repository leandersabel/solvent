# Account settings

A vault owner's own account: password, main currency, how figures and
dates are written, the idle lock, open sessions, the dimensions holdings
are grouped by, and deleting the whole vault.

## What the client gets

Everything you control about your own vault, on one settings page, with
dimensions on a screen of their own. The rules that are fixed for good
are shown beside the ones you can change, rather than hidden. Every
person with a vault reaches it, about their own vault only. An
administrator account never does, because provisioning the instance is
a different account's job (`admin-invites.md`).

- **Your main currency is shown and cannot be changed**, with the reason
  beside it.
- **Dates and numbers are written your way**, and nothing stored
  changes, so any choice can be changed back. Language sets the
  defaults, and dates and the thousands mark can each be set against
  it, because a language is a coarse guess at taste: a Swiss reader may
  want an apostrophe between thousands. Money shows whole units, and
  rates keep their decimals (`design-system.md`, Figures).
  The settings follow you to any browser you sign in from.
- **Changing your password is instant**, because nothing is
  re-encrypted. Every other session is signed out and you stay signed
  in. A vault protected less strongly than the instance requires comes
  out of the change at full strength.
- **The idle lock is yours to set**, with no "never". You are signed out
  twelve hours after signing in whatever you do.
- **You see your open sessions.** It is the only way to tell whether you
  are still signed in somewhere else.
- **Dimensions** are the axes your holdings are sorted along. Each
  holding takes one value per dimension, which is what lets the chart's
  bands add up to exactly your net worth. Nothing on that screen
  touches a holding, so nothing can fail halfway.
- **Deleting your account** takes everything at once. Nobody's vault is
  undeletable: handing out accounts is not something a vault owner
  does, so no deletion here can leave the instance unable to.

What it deliberately does not do:

- **No password recovery** (architecture.md, Key management).
- **No "sign out everywhere except this one".** Changing the password is
  the one operation that keeps the current session alive, as part of
  the same act.
- **No IP addresses, no device names, no sign-in history beyond the
  open sessions.** On a household instance it answers no question worth
  the record (architecture.md, Storage & data handling).
- **No soft delete, no grace period, no recycle bin** on deleting an
  account. There is no readable vault to hold in reserve.
- **No freeform tags.** A tag is a dimension with one value, a flag.
  Two vocabularies over the same holdings would mean two ways to spell
  one thing, and only one of them can be stacked and summed honestly.
- **No permanent delete of a dimension** (Deleting is archiving).

## Screens

### Settings

Standard app shell, reached from **Settings** in the nav. Content
max-width 720px, one card per section in the order below, 24px apart,
each opening on its section heading.

The nav entry is an in-page address, not a second page, because the
keys live in one page's memory and a page load would charge the
derivation a second time in one sitting. `/settings`,
`/settings/dimensions` and `/settings/export-import` stay real
addresses, each redirecting to the view it names, so a bookmark or a
typed address still works.

#### Profile

- **Username**, shown, not editable.
- **Main currency**, shown, not editable, with a 13px note beneath it:
  "Fixed when you created your vault. Every rate you have recorded
  converts into it, so changing it would mix two currencies in your
  history." There is no field, not a disabled one.

Each is a label and value pair: the label in ink-secondary in a 160px
column at the left, a hairline rule between pairs.

#### Dates and numbers

A 13px note first: "Display only. Every figure is stored exactly as you
entered it, and every date is stored the same way for everyone, so
changing any of this rewrites nothing." Then four selects in two
columns, Language and Dates on the first row:

- **Language**. A short list rather than free text, because a tag
  nobody can spell is worse than a list: the browser's setting (the
  default), Deutsch (Schweiz), Deutsch (Deutschland), Français (Suisse),
  Italiano (Svizzera), English (UK), English (US).
- **Dates**. The language's own order (the default), 20.09.2026,
  2026-09-20, 09/20/2026. The chosen order is what the date field
  writes, accepts and draws its calendar in (design-system.md,
  Components).
- **Thousands**. The language's own mark (the default), then each
  option shown as the figure it produces: 1 234 567, 1'234'567,
  1,234,567, 1.234.567, 1234567.

Beneath them, a sample line in a tinted petrol-50 strip under its own
section label, with **Save** at the strip's right end. It applies the
current choice to a figure and a date (written with `longDate`) in the
main currency, and updates as each select changes, before anything is
saved. Saving writes the profile record and re-renders the surface, so
every figure and date already on screen changes with it.

#### Organizing

Two link rows sharing one Card with no heading, edge to edge with a
hairline rule between them. Title at the left with its explanation
beneath, the count and a chevron at the right, and the whole row is the
link. Neither belongs inside a settings card, so neither is a section.

- **Dimensions** (Dimensions, below). "How your holdings split up in
  the chart." At the right, how many exist, or "None yet".
- **Export and import** (`export-import.md`, Export / import).
  "Download your vault, or restore one from a file."

#### Change password

Current password, new password, confirm, with the same bar and strength
gauge as registration (`register.md`, Register). Autocomplete
`current-password` and `new-password`, in a form with the username
(design-system.md, Components, Password field). Enter submits it once
the button is enabled. Top to bottom in the card:

- A tinted callout: "Your data is not re-encrypted. Only the lock
  around your key is rebuilt, which is why this is fast even on a large
  vault." Said as reassurance, because a change that takes no time
  otherwise reads as having done nothing.
- The fields in one column at form width, **Change password** beneath.
- Under a hairline rule at the foot, with a critical-colored icon:
  "Export files you have already saved still open with your old
  password. They carry their own copy of the lock, and changing it here
  does not reach back and protect them." It is the one way somebody can
  believe they have locked something they have not.
- On success, an inline confirmation: "Your password is changed. Every
  other session was signed out, and this one is still open."

#### Session and lock

- **Idle lock**, a select: 5, 10, 15, 30, 45 or 60 minutes (How it
  works, Session and lock). A stored value outside these shows the one
  it locks at. It holds a 200px column with the tradeoff
  beside it, level with the control: "Shorter is safer. Every unlock
  costs the deliberate wait while your password becomes a key."
- **Absolute session expiry**, stated: "You are signed out 12 hours
  after signing in, however busy you have been."
- **Open sessions**, a Table under its own section label: a first
  column carrying the chip that marks the current session ("This
  session"), then started, then last used. Beneath it: "Solvent keeps
  no IP address readable and records no devices." Saying so is the
  point, because somebody who has used any other product assumes they
  are kept.
- **Sign out** and **Sign out everywhere**, side by side, both
  secondary, closing the card. Sign out everywhere ends this session
  too.

#### Delete my account

A collapsed **Danger zone** disclosure, its own Card at the foot of the
screen, its label in critical. Opened, it holds one destructive button,
**Delete my account**, which opens the dialog. Nothing is typed into
the disclosure itself.

The dialog, headed **Delete your account**, asks for the password and
the username, in a form with the username (design-system.md,
Components, Password field) that Enter never submits, and says:

> Deleting takes the account, everything in the vault, and every
> session you have open. It happens all at once and it cannot be
> undone. Nothing is kept in reserve, and there is no vault left for
> anybody to recover.

**The primary action is "Export first."** Deletion is the secondary
one, a destructive button reading **Delete my vault**, disabled until
the password is filled and the typed username matches exactly, in the
shared disabled look (design-system.md, Components). Somebody who came
here wanting a backup and left with a wiped vault has been failed by
the dialog.

#### At phone width

Everything set side by side stacks. A profile pair puts its label above
its value, the four selects run in one column, and the idle lock
tradeoff moves beneath its select. The sample strip wraps, with
**Save** beneath the sample when the width runs out. Open sessions
keeps its three columns: the first is as wide as the "This session"
chip on one line, and the headings and dates wrap between words in
theirs.

#### States

- **Loading**: everything but the session list comes from the
  in-memory model and renders at once. The session list is fetched, so
  that card alone shows skeleton rows.
- **Empty**: not reachable. Every card has content, and the session
  list always holds at least the session reading it.
- **Changing the password**: the button becomes a working state reading
  "Changing your password" and the form goes quiet. The password being
  replaced and the new one are each turned into a key, so the wait is
  about twice a sign-in's (`login.md`, Unlock). The tab stays
  responsive.
- **Error, wrong current password**: inline above the first field:
  "That is not your current password." Every field is kept.
- **Error, the new password is the current one**: inline above the
  first field: "The new password is your current one." Every field is
  kept, and nothing is derived or sent.
- **Error, the new password fails the policy**: refused before anything
  is derived.
- **Error, the change failed after the slow part**: "Nothing was
  changed. Your current password still works." Every field is kept, so
  nothing is re-typed or re-derived.
- **Password changed**: the inline confirmation, and the Open sessions
  table reloads in place, skeleton rows then one row carrying the This
  session chip.
- **Error, the idle lock would not save**: inline on that control,
  which goes back to the value the vault holds. The lock keeps running
  at that value.
- **Error, the session list would not load**: that card alone shows an
  error with Retry. Every other card still works.
- **Error, signing out everywhere failed**: inline on that control.
  Every session is still open, this one included.
- **Error, deleting failed**: inline in the dialog, which stays open:
  "Nothing was deleted. Your vault is unchanged and you are still
  signed in."
- **Deleting succeeded**: the sign-in screen appears with nothing
  further, because there is no account left to say anything to.

#### Rules

- The destructive controls are **Sign out everywhere**, reversible by
  signing in again, and **Delete my vault**, which is not. Only the
  second is styled destructive and behind a disclosure.
- Nothing about anybody else and nothing about the instance: no other
  account, no invite, no unit list, and no entry that leads to one. An
  administrator changes their own password in the admin area
  (`admin-invites.md`, Admin).

### Dimensions

The only screen where dimensions and their values are renamed,
reordered, archived and restored. Creating one also happens on the
holding form (`manage-accounts.md`, Account form), and how they are
drawn belongs to the dashboard (`net-worth-view.md`, Dashboard).

Standard app shell, content max-width 720px. Reached from Settings,
and from the dashboard's "Group by" control when no dimension exists.

One card per dimension in the profile's order, which is also the order
of the dashboard's "Group by" select. Each card carries:

- The **label**, editable in place.
- Its **coverage**, the same figure the dashboard shows: "7 of 10
  holdings assigned", a link exactly where the dashboard's is one,
  opening the dashboard filtered to the unassigned holdings. A dimension
  covering a third of the holdings draws a chart that is correct and
  useless, and this is where that gets noticed, at setup. Coverage
  counts **active holdings**, the set the dashboard table holds,
  because an archived holding is a closed position. It is stated in
  ink-secondary with **no status color and no icon**, because low
  coverage is a fact about a setting, and a vault where nothing is
  filed is complete (`manage-accounts.md`).
- Its **values**, in band order, each with a reorder control, an
  editable label and an archive action.
- `+ Add value`, and an overflow menu holding **Archive dimension**.

Beneath the cards: `+ Create a dimension`, and a collapsed **Archived**
section when anything is archived.

#### Past four values

Once a dimension holds a fifth value, an inline note appears under its
list, not a warning and not a cap:

> The chart shows the first four values and folds the rest into "Other".
> All of them are still tracked.

The copy counts nothing past the four the chart shows, so it stays true
however many values there are. Four is a rendering limit from the
validated chart palette (design-system.md, Chart palette (validated)),
not a limit on the data.

#### Creating

- **A dimension** asks for a label and a first value, because a
  dimension with no values classifies nothing and would render as an
  empty select on the holding form.
- **A flag** is the second option in the same dialog: a dimension with
  exactly one value, which the holding form renders as a checkbox. It
  is the shape of a yes or no tag ("Emergency fund"), and is as fast as
  typing a tag: one field, one button.
- Ids are generated, never asked for, never shown.

#### Editing a label

An inline rename (design-system.md, Components): Edit reveals the
field, Save or Enter commits, Cancel or Escape abandons it with the
stored label still shown. Clicking away leaves the field open and
writes nothing. One write, the profile.

- A label may not be blank or whitespace alone. The field refuses the
  commit inline and keeps what was typed, because a nameless band is
  unreadable in a chart and unpickable on the holding form.
- **Two dimensions, or two values, may carry the same label.** Identity
  is the id, and refusing a duplicate would refuse something the record
  shape allows and an import can hold. Nothing here deduplicates or
  renumbers.

#### Reordering

Value order and dimension order are real data, so both use the reorder
control (design-system.md, Components) and neither is drag-only. A move
writes the profile once, on drop or on the key press. There is no save
button and no reorder mode.

#### Archiving and restoring

"Delete" is called **Archive**, and the dialog says why in one line:

> Archiving keeps your holdings' assignments. Restore it and every
> holding returns to the band it was in.

- Archiving a **dimension** hides it from the holding form, the "Group
  by" select and the breakdown. Its holdings render as "Unassigned"
  for it.
- Archiving a **value** moves its holdings to "Unassigned" in that
  dimension.
- **Archiving the last active value of a dimension is allowed.** The
  dimension stays, covers nothing, and every holding shows "Unassigned"
  for it. Refusing would invent a rule the record shape does not hold,
  and archiving the dimension is one menu away.

The Archived section lists archived dimensions and, inside each live
card, archived values, each with a restore action and no other control.
An archived label is not editable or reorderable: it is out of the
chart, and its only question is whether it comes back.

#### At phone width

The cards stack and keep every control. The coverage line wraps under
the label and stays a tap target of its own wherever it is a link.

#### States

- **Loading**: none. Dimensions come from the in-memory profile.
- **Empty, no dimensions**: the most important state, because
  "dimension" is the least self-explanatory word in the product. One
  card explaining it, with one primary action:

  > Dimensions are how your net worth splits up. Give one a name,
  > "Liquidity", and values like Cash, Investments, Retirement. Each
  > holding gets one value, so the bands of your chart add up to
  > exactly your net worth.
  >
  > [ Create a dimension ]

  Nowhere else in the app nags about it. A vault with no dimensions
  charts as a single "Total" band.
- **Empty, no holdings yet**: the cards render normally and coverage
  reads "0 of 0 holdings assigned". Configuring before the first holding
  is a normal order of work.
- **Saving**: the change shows at once from local state, the control
  disabled until the write answers (design-system.md, States).
- **Error, save failed**: inline on the card, the edit kept, the
  previous value still shown as current. A failure changes nothing.
- **Error, Conflict on a stale profile**: "Your settings were changed
  in another tab." The screen reloads the profile.

#### What it deliberately does not show

- **No holding names.** Coverage is a count with a link out. A list of
  holdings here would be a second, thinner list of holdings.
- **No ids**, anywhere, in any state.
- **No value totals and no chart preview.** What a band is worth
  belongs to the dashboard, and a figure here would be a second place
  for the same number to be right or wrong.

## How it works

### What it does

**`/settings` is a vault route** (`app-shell.md`, The two surfaces),
because every card is about a vault. An administrator session gets Not Found from the page and from
`GET /api/sessions`, `POST /api/auth/logout-all` and
`DELETE /api/auth/account`.

**Change password is the one section both kinds reach**, through a
shared endpoint. An administrator reaches it from the admin area
(`admin-invites.md`, An administrator's own credential), and deletes
their own account through `DELETE /api/admin/accounts/<their own
username>`, where the last-administrator guard lives
(`admin-invites.md`, Who may remove whom, and the last administrator).

### The profile record

One `profile` record per vault, holding everything about the user that
is not a credential. It is the only record guaranteed to exist after
registration. The complete payload:

```json
{
  "mainCurrency": "CHF",
  "createdAt": "2026-07-31T09:14:00Z",
  "idleLockMinutes": 15,
  "locale": "de-CH",
  "dateStyle": "dmy",
  "groupSeparator": "apostrophe",
  "dimensions": []
}
```

- **`mainCurrency`**: required. Chosen at registration from the
  provider-quotable currencies (`register.md`), immutable outside import
  (Main currency).
- **`createdAt`**: required. Written once at registration.
- **`idleLockMinutes`**: optional, absent means 15 (Session and lock).
- **`locale`**: optional, a BCP 47 tag. Absent or unrecognized means
  the browser's, rather than failing. Never validated against a list,
  so a tag from an import this engine does not know falls back.
- **`dateStyle`**: optional, one of `locale` (the default), `dmy`,
  `ymd`, `mdy`.
- **`groupSeparator`**: optional, one of `locale` (the default),
  `thin`, `apostrophe`, `comma`, `period`, `none`.
- **`dimensions`**: optional, shape in Dimensions below. Absent or empty
  means none, so the feature costs nothing until it is used.

Registration writes the two required keys and nothing else, and each
optional key appears the first time the user sets it. Schema migration
(`record-api.md`) and import validation (`export-import.md`) read the
whole payload and need its bounds.

### Dates and numbers

Display only, entirely client-side. The server stores the profile as
ciphertext and never learns any of it.

Every figure reaches the screen through one formatter built from the
profile, so a setting cannot apply on one screen and not another.
`money`, `percent` and `compact` each take a value exact at
scale 12 (`record-snapshot.md`, Record shape) and round it half-even,
like every rounding in the product. Every entry writes a negative with
the true minus, `−`, decided on the figure as written, so a value that
rounds to zero carries no sign. The entries:

- **money**: a figure in any currency in whole units, grouped as
  configured (`design-system.md`, Figures). That is the main currency and a holding's unit
  whose `kind` in the symbol table is `currency` (`rate-lookup.md`, The
  symbol table).
- **percent(value, places)**: `value` is already the percentage, written
  at `places`, grouped and pointed, followed by `%` with no space, so
  12.5 writes `12.5%`.
- **compact**: a trend chart value tick in the short form
  `net-worth-view.md`, Value ticks, defines, grouped and pointed.
- **quantity**: a stored `value` in any other unit, a metal or free
  text, digit for digit from its decimal string: never rounded, never
  padded, with the group mark in force between groups of three in the
  integer part and the locale's decimal point. `"12.125"` reads
  `12.125`, `"12.50"` reads `12.50`, `"80"` reads `80`. A negative is
  signed as money is.
- **parseQuantity**: the reverse, for a field. The locale's decimal
  point is the point, and so is `.` wherever `.` is not the group mark
  in force, because a keyboard does not always offer the locale's one.
  The group mark in force is accepted only between groups of three
  digits in the integer part. Anywhere else the input is malformed,
  never read with the mark dropped, because `12.5` read as 125 under a
  period group mark is a silent tenfold error. It returns the canonical
  decimal string (`record-snapshot.md`, Record shape) or nothing.
- **editable(value, places)**: a rate, wherever one is written: its
  field, the note naming the figure an edit replaced, beside a rival
  entry, and a recording's price column. Every digit of the exact value
  is kept, never rounded, and the fraction is padded to at least
  `places`, grouped, pointed and signed as money is. A rate takes six,
  because a currency pair moves in the fourth. `0.797` writes
  `0.797000`, and a proposal at ten places writes all ten, because
  rounding it would name a figure nobody proposed.
- **parseFigure**: the reverse, for a rate field. It reads as
  `parseQuantity` does and returns the exact value at scale 12, or
  nothing.
- **date** and **parseDate**: the field form, and nothing else. `date`
  writes an ISO date in digits in the configured order and separator.
  `parseDate` reads it back and returns nothing rather than guessing: a
  two-digit year is refused, and 31 February is refused rather than
  rolled into March.
- **Dates shown for reading** never go through `date`, because under
  the `locale` style it writes digits where every other date spells its
  month, and one screen would write a day two ways. One writer per
  slot:
  - **longDate**: day, abbreviated month and year, for a date in a
    sentence, a row, a tooltip or a table.
  - **fullDate**: the month in full, for a heading.
  - **dayMonth**: day and month, long or abbreviated, for a label that
    implies the year.
  - **monthYear**: the month in full and the year, for how far back a
    long range reaches.
  - **dateTime**: a moment, such as a session's start, in the browser's
    time zone: the day as `longDate` writes it, a comma, and hours and
    minutes in the locale's form.

  Under `dateStyle` `locale` they spell the month in the locale's
  language. Under `dmy`, `ymd` or `mdy`, every one but `monthYear`
  writes the whole date in that style, the text `date` writes, because
  the style is what the reader asked every date to look like. `dayMonth`
  writes the year too, since a style has no yearless shape and a rate
  delay can cross New Year. `monthYear` keeps its spelling, because a
  style has no shape for a month alone.

**No screen writes a figure itself.** Digits, group marks, decimal
point, rounding, minus and percent sign come from an entry above. A
screen adds only words, a unit or currency code, and the sign of a
signed change (`net-worth-view.md`, The change). A figure written with
`toFixed`, `toLocaleString`, `Intl.NumberFormat`, `String` of a number
or a template string skips every setting at once.

Defaults come from `Intl` for the chosen locale, read at run time
rather than tabulated, so there is no second, staler copy of what the
engine knows. The decimal point is always the locale's, because no
setting chooses it. A `groupSeparator` equal to that point is not
applied, because `1.234` would then mean two things, and the locale's
own group mark is in force instead. The point is never swapped to make
room for the chosen mark, because that would change how every figure
reads and which input a field accepts.

**A field that edits a stored `value` prefills it through `quantity`,
whatever the unit**, money included, because a prefill in whole units
saved untouched would write the rounding. A field whose text still
equals its prefill is untouched and never parsed, so it saves the
stored string itself (`record-snapshot.md`, Confirming a previous
value).

**A rate field prefills through `editable` at six places and compares
by value**, never by text. Its `parseFigure` reading equals the stored
or proposed rate whenever padding is all that differs, so an untouched
line writes nothing and keeps its provenance (`record-rate.md`, Editing
a captured rate).

Values stay exact at scale 12 and dates stay ISO, so any setting can be
changed and changed back with no write to any record but the profile.

### Change password

The DEK does not change, so **no vault record is re-encrypted**. Only
the envelope around the DEK is rebuilt. This is the reason the Master
Key wraps a DEK instead of encrypting records directly.

1. The user enters the current password and a new one twice. The new
   one meets the registration bar: at least 12 characters, zxcvbn at
   least 3 (`register.md`). A new password equal to the current one, or
   one failing the policy, is refused before any derivation.
2. The client derives `MK_old` and `AK_old` from the held salt and
   envelope and unwraps the held wrapper (The held credential). On a
   failed unwrap it looks the salt up once. The same salt means the
   current password is wrong: stop, and send nothing more. A different
   one means the password changed, or its protection was strengthened,
   on another page after this one opened the vault (`login.md`, A
   credential changed elsewhere): derive `AK_old` from the fresh salt
   and envelope, and leave the check of the current password to the
   server.
3. The client generates a fresh 128-bit salt and derives `MK_new` and
   `AK_new` at the server's **current default** parameters, read from
   the envelope the app shell embeds (architecture.md, Key management).
   A password change is also a KDF upgrade, so the stale-KDF upgrade is
   redundant after it.
4. The client re-wraps the same DEK under `MK_new` with a fresh nonce.
5. `POST /api/auth/change-password`
   `{ currentAuthKey, currentSalt, salt, kdf, authKey, wrappedDek,
   dekNonce }`, where `currentSalt` is the salt `AK_old` came from.
6. The server checks the sign-in limits for the session's username,
   then compares `currentSalt` with the credential's salt, answering
   Conflict `{"refused":"credential-changed"}` on a mismatch, which
   counts as no failed sign-in, then verifies `currentAuthKey` against
   the stored hash. A mismatch
   is a Bad Request with no `refused` member, counts as a failed
   sign-in and writes nothing else (architecture.md, Rate limiting). A
   new `authKey` that is not 32 bytes is a Bad Request that writes
   nothing (architecture.md, Key management). Otherwise it replaces the
   **`password` credential row** (`params` and `verifier`) and, for a vault owner, that credential's
   **one `dek_wrappers` row**, in one all-or-nothing transaction, and
   writes no other row (architecture.md, Key management). For a vault
   owner the transaction compares the vault epoch after `BEGIN
   IMMEDIATE` and before any write, because a page holding a DEK an
   import replaced would otherwise wrap the old key under the new
   password and leave every record unreadable (architecture.md, Vault
   epoch). It compares `currentSalt` again after the epoch, because the
   Auth Key is verified before the transaction begins. An administrator has no epoch, and the header on their
   request is ignored.
7. The server invalidates **all other sessions** of the user and keeps
   the current one, because the key never changed and there is no
   stolen copy of it to invalidate. The client keeps its in-memory DEK,
   and no re-login is needed. Another session's writes still decrypt, because the DEK
   is unchanged. It must sign in again.

For a vault owner the current password is verified twice, client-side
by the unwrap and server-side by the Auth Key. Both must hold.

**The held credential.** A vault owner's tab holds the `password`
credential's salt, KDF envelope, `wrappedDek` and `dekNonce` as one
set, from the sign-in, unlock or registration that opened the vault,
because step 2 needs a salt and a wrapper that belong together. Every
flow in the tab that rewrites any of them replaces the held copy with
what it sent once the server answers OK: the stale-KDF upgrade
(`login.md`, Stale-KDF upgrade), a password change, and an import's
re-key, which replaces the wrapper alone (`export-import.md`, The
re-key step). A lock discards the set with the keys, and the unlock
fills it again. An administrator's tab holds the salt and envelope the
same way. Holding them exposes nothing: the salt and envelope answer
anyone at `/api/auth/salt`, and the wrapper opens only under the
password.

**An administrator uses the same endpoint** with no `wrappedDek` and no
`dekNonce`. Steps 2 and 4 collapse to deriving `MK_old` and discarding
it, so a wrong current password is caught only server-side, as a Bad
Request. The server discriminates on the session's principal kind, not
on which fields arrived: a vault owner's request without a wrapper is
a Bad Request, and so is an administrator's with one.

**There is no "remove password" action** (architecture.md, Credentials
and vault key wrappers, gives the reason for both kinds). Changing the
password replaces the row, and only deleting the account removes it.
Existing export files carry their own salt and wrapped DEK, so they
keep the old password.

### Main currency

Displayed, never editable. Every price entry stores a rate into the
main currency (`record-rate.md`), so changing it would leave the price
history in the old one and the chart would silently mix two
currencies. Making it changeable needs a conversion strategy for the
whole price timeline. Each entry records which currency it targets,
which keeps that possible.

**Import is the one exception, and not a loophole.** Restoring replaces
the profile and every record together, price entries included
(`export-import.md`, Import: replace-only), so nothing is left in the
old currency. The rule guards against changing the label while keeping
the data.

The cost falls on somebody who moves country or picks the wrong
currency at sign-up: a new vault, and the history entered again by
hand. The warning at the point of choice earns that cost (`register.md`,
Register).

### Dimensions

Dimensions (`manage-accounts.md`, Dimensions) are stored in the
**encrypted profile record**, so they follow the user across devices
and the server never learns how anyone slices their wealth.

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
  against the profile in memory. Each character is drawn uniformly from
  the 36: a random value outside the range is rejected and redrawn,
  never reduced modulo 36, because modulo biases the draw. Never derived
  from the label (why ids are not slugs is `manage-accounts.md`,
  Dimensions).
- **`label` is free display text** in any script.
- **Order in `values` is the band order** in the stacked chart, never
  sorted by size, because a stack whose bands swap places cannot be
  read, and because the holdings yield which value ids are in use,
  never the intended sequence. **Order of `dimensions` is the order of
  the "Group by" select.**

#### Deleting is archiving

Deleting a dimension or a value sets `archivedAt` and keeps the
definition. Every holding's `dims` entry stays untouched, so restoring
brings every assignment back exactly. A **flag**, a dimension with a
single value, replaces a yes or no tag, and absence of an entry means
no.

There is **no "remove everywhere" option and no multi-record write
anywhere in this feature**: every operation writes the profile and
nothing else, renaming included. Stripping entries from many `account`
records to undo a display setting can fail partway, for a few bytes of
inert data inside ciphertext nobody reads. An archived definition costs
one line and buys exact reversibility.

### Delete my account

A vault owner's own account, self-service and irreversible, distinct
from an administrator removing an account (`admin-invites.md`).

`DELETE /api/auth/account` `{ authKey, confirmUsername }`.

- The server checks the sign-in limits for the session's username,
  then `authKey` against the stored hash in constant time, and that
  `confirmUsername` equals the session user's normalized username. A
  mismatch on either is a Bad Request and deletes nothing. A wrong
  `authKey` counts as a failed sign-in (architecture.md, Rate
  limiting).
  The typed username is a deliberate second factor of intent, so it is
  verified server-side, not left as a UI formality.
- It deletes the principal row, every credential row, every wrapper,
  every record, the vault epoch and every session, in one transaction.
  Nothing is soft-deleted. The transaction does not wait for an export
  downloading at the same time: that export completed or it did not.
- It compares the vault epoch after `BEGIN IMMEDIATE`, so a page that
  confirmed deleting a vault since replaced deletes nothing
  (architecture.md, Vault epoch).
- **No last-administrator check.** A vault owner is never an
  administrator, so removing one cannot leave the instance
  unadministered. The guard lives on the one path that can
  (`admin-invites.md`, Who may remove whom, and the last
  administrator).

### Session and lock

- **Idle lock, a vault owner**: `login.md`, Rules, states the rule and
  its one exception. Unlocking signs in on the same session and adds no
  row (`login.md`, The session a sign-in issues). This feature owns
  only the period.
  - **5 to 60 minutes, default 15**, stored as `idleLockMinutes` in the
    encrypted profile, so it follows the user and the server never sees
    it. The period is one of the select's values. Any other stored
    number, a fraction included, locks at the nearest of them, the
    shorter on a tie, because shorter is the safe direction. A stored
    value that is not a number means 15. A changed period applies at
    once, not from the next activity.
  - The range is bounded at both ends on purpose. Re-unlocking costs a
    full Argon2id derivation, a fraction of a second on a desktop and
    about two seconds on an iPhone (architecture.md, Key management),
    so a fixed 15 minutes taxes a long session on a phone. The idle lock
    is also the last defense against another household member at an
    unlocked tab (architecture.md, Threat model). No setting disables
    it.
- **There is no idle rule for an administrator.** The idle lock
  discards in-memory keys and decrypted state, and an administrator
  holds neither. It leaves the server session alive, so it never bounds
  how long a session can act. The absolute expiry does, for both kinds
  (`login.md`, Rules, owns the value).
- **Log out**: `POST /api/auth/logout` invalidates the current session.
  The client discards its keys first, so a failed request still leaves
  nothing readable. Without a session it answers OK, because signing
  out of nothing is harmless.
- **Log out everywhere**: `POST /api/auth/logout-all` invalidates every
  session of the user, **the current one included**. A password change
  ends every other session and keeps the current one. An import ends
  none (architecture.md, Vault epoch).
- **Open sessions**: `GET /api/sessions` returns
  `[{ id, issuedAt, lastActiveAt, current }]`, the user's own live
  sessions only, meaning not past the absolute expiry. An expired row
  is left off whether or not a sign-in has deleted it, because it can
  no longer act. `id` is an opaque handle, never the cookie's value. No
  IP or user agent is stored, because it would be metadata the app does
  not otherwise keep, and so none is returned. The page fetches the list
  when it renders, on Retry, and again once a change-password response
  is OK, because by then every other session has ended. A failed fetch
  replaces the rows with the load error and Retry, never leaving earlier
  rows in view.

## Edge cases

- **Wrong current password, an administrator**: nothing to unwrap, so
  the request is sent and answers Bad Request. Generic error, nothing
  changed. A vault owner's is caught at the unwrap and sends one salt
  lookup.
- **Credential changed by another page since this tab opened the
  vault**: a password change in another tab of the same browser, or a
  sign-in elsewhere that ran the stale-KDF upgrade, ends no session of
  this one. A vault owner's unwrap fails when the password itself
  changed, and step 2 takes the fresh salt. Otherwise the request
  answers `credential-changed`, and the client looks up
  `/api/auth/salt` once, re-derives `currentAuthKey` from the fresh
  salt and envelope, and resends once, unchanged apart from
  `currentAuthKey` and `currentSalt`, since the new salt, `authKey` and
  wrapper never depended on the old salt. The held set stays as it was
  until the change succeeds. A Bad Request, or a second Conflict, is
  final: a vault owner sees the change-failed error, an administrator
  the wrong-password one. One retry, never a loop.
- **Password changed on another session, in another browser or
  device, since this tab opened the vault**: that change ended this
  session, so the request answers
  Unauthorized whatever it carries, and the client treats it as any
  expired session (`login.md`, Edge cases). The unlock that follows
  looks the new salt up, so the stale held set never reaches a request.

## Acceptance criteria

1. (blind) Changing the password rewrites salt, KDF envelope and Auth
   Key hash in the `password` credential row and the wrapped DEK in its
   wrapper, writes no other row, and leaves every record's ciphertext
   byte-identical, compared row by row rather than by counting
   requests. Test: `tests/test_auth.py::test_changing_a_password_rewrites_the_credential_and_the_wrapper_only`,
   `tests/browser/parts/settings.mjs`.
2. (walk) An administrator changing their password rewrites their
   credential row and creates no `dek_wrappers` row, and the new
   password signs them in and the old one does not. Test:
   `tests/test_auth.py::test_an_administrator_changes_their_password_without_a_wrapper`.
3. A change-password request from an administrator session carrying a
   wrapper, or from a vault owner session without one, is a Bad Request
   and writes nothing. Test: `tests/test_auth.py::test_the_change_password_wrapper_follows_the_session_kind`.
4. (walk) After a password change, records written before it still
   decrypt, in the same session and after a fresh sign-in. Test:
   `tests/browser/parts/settings.mjs`.
5. (walk) The old password no longer signs in and the new one does.
   Test: `tests/browser/parts/settings.mjs`.
6. (walk) The change-password request carries neither password in any
   form. Test: `tests/browser/parts/settings.mjs`.
7. (blind) (walk) A vault owner's wrong current password shows "That is
   not your current password." above the first field and sends one
   `/api/auth/salt` request and nothing else between submit and the
   error, asserted from the request log. Test:
   `tests/browser/parts/settings.mjs`,
   `tests/test_client.py::test_the_client_side_rules_hold`.
8. (blind) (walk) A successful change sends no `/api/auth/salt` request:
   the first after sign-in, a second from the same tab, one after that
   tab's stale-KDF upgrade, one after that tab's import, and one after a
   lock and unlock (the unlock's own request excepted), each asserted
   from the tab's request log. Test: `tests/browser/parts/settings.mjs`
   (the first change only, the other sequences have no test).
9. (blind) After another session's stale-KDF upgrade, a change with the
   right current password from a tab that signed in before it succeeds
   with exactly one `/api/auth/salt` request and two change-password
   requests differing only in `currentAuthKey` and `currentSalt`, and
   the new password then signs in. Test:
   `tests/test_client.py::test_the_client_side_rules_hold`.
10. (walk) A change-password request answers Unauthorized when another
    session's password change ended this session. Test: no test.
11. (blind) A change-password request with a wrong `currentAuthKey`
    answers Bad Request and writes nothing but its failed sign-in,
    called directly with the client-side unwrap bypassed. Test: `tests/test_auth.py::test_a_wrong_current_auth_key_is_refused_server_side`,
    `tests/test_review_account_settings.py::test_a_wrong_current_password_is_one_failed_sign_in_and_writes_nothing_else`.
12. (blind) (walk) A password change invalidates every other session of
    the user and keeps the initiating one, asserted from both sides.
    Test:
    `tests/test_auth.py::test_a_password_change_ends_every_other_session_and_keeps_this_one`.
13. (blind) (walk) With a second session open beforehand, the Open
    sessions list on the page that made the change holds one row, marked
    This session, once the change succeeds, with no navigation or
    reload, and the request log shows a `GET /api/sessions` after the
    OK. Test: `tests/browser/parts/settings.mjs`.
14. (blind) When the session list fetch after a successful change
    fails, the card shows its load error and Retry and none of the rows
    from before. Test: `tests/browser/parts/settings.mjs`.
15. (blind) (walk) A vault owner's change-password request carrying the
    epoch from before an import, with a correct `currentAuthKey`,
    answers Conflict `{"refused":"vault-replaced"}`, the `credentials`,
    `dek_wrappers` and `sessions` rows are as they were, and the
    restored vault still opens with the unchanged password. Test:
    `tests/test_vault_epoch.py::test_change_password_with_a_replaced_epoch_changes_nothing`.
16. (blind) (walk) A `DELETE /api/auth/account` carrying the epoch from
    before an import, with a correct `authKey` and `confirmUsername`,
    answers Conflict `{"refused":"vault-replaced"}` and deletes nothing.
    Test:
    `tests/test_vault_epoch.py::test_deleting_the_account_with_a_replaced_epoch_deletes_nothing`.
17. Account deletion leaves no `vault_epochs` row for the account. Test:
    `tests/test_vault_epoch.py::test_deleting_the_account_leaves_no_epoch_row`.
18. (walk) A password change on a vault at old KDF parameters leaves
    parameters equal to the server's current default. Test:
    `tests/test_auth.py::test_a_password_change_on_old_parameters_lands_on_the_current_default`.
19. A change that fails after derivation changes nothing, the old
    password still works, and the screen says "Nothing was changed. Your
    current password still works." Test: no test.
20. (walk) The main currency is shown with its reason and offers no
    control to change it. Test: `tests/browser/parts/settings.mjs`.
21. (walk) Reaching settings or dimensions from the top bar does not ask
    for the password again. Test: `tests/browser/parts/settings.mjs`,
    `tests/browser/parts/dimensions.mjs`.
22. (blind) (walk) With main currency `CHF`, `groupSeparator`
    `apostrophe`, a `USD` holding valued 1000.40
    shows `USD 1’000` with its unit and `1’000` in its holding page's
    list of values, an `XAU-ozt` holding stored as `"12.125"` shows
    `12.125` in both places, one stored as `"12.50"` shows `12.50`, and
    an `m²` holding stored as `"80"` shows `80`, each asserted where it
    appears on screen. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/settings.mjs`.
23. (blind) (walk) A quantity shows its stored digits, asserted with
    values rounding or padding would change (`"12.125"`, `"12.50"`, `"80"`). Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
24. (walk) With locale `de-DE` and `groupSeparator` `apostrophe`, an
    `m²` holding stored as `"1234.5"` shows `1’234,5`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
25. (blind) Under that profile `parseQuantity` reads `1’234,50` as
    `"1234.50"` and `12.5` as `"12.5"`. With locale `de-DE` and
    `groupSeparator` `period` it reads `1.234,5` as `"1234.5"` and
    refuses `12.5` rather than reading 125. Test: `tests/test_client.py::test_the_client_side_rules_hold`.
26. (blind) A clashing group mark is asserted both ways: with locale
    `en-US` and `groupSeparator` `period`, `money` writes 1234567.89 as
    `1,234,568` (CHF 1,234,568 on screen), and `parseQuantity`
    reads `12.5` as `"12.5"` and refuses `12,5`. With locale `de-DE` and
    `groupSeparator` `comma`, `money` writes 1234567.89 as
    `1.234.568`. Test: `tests/test_client.py::test_the_client_side_rules_hold`.
27. (blind) With locale `de-DE` and `groupSeparator` `period`, `percent`
    at one place writes 136794.6 as `136.794,6%`, 0.25 as `0,2%`, 0.35 as `0,4%`, −0.25 as `−0,2%` and
    −0.04 as `0,0%`, and at no places writes −50 as `−50%`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
28. With locale `de-CH` and `groupSeparator` `apostrophe`, `percent` at one place writes 10957493 as `10’957’493.0%`.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
29. (blind) With locale `de-DE` and `groupSeparator` `apostrophe`,
    `compact` writes 999 as `999`, 1500 as `1,5k`, 2000000 as `2M`,
    −2500000 as `−2,5M` and 1500000000000 as `1’500B`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
30. (blind) `editable` keeps every digit and pads to the places asked:
    `"0.797"` at six reads
    `0.797000`, and `"0.93124567"` and a twelve-place rate keep every
    digit. Test: `tests/test_client.py::test_the_client_side_rules_hold`
    (the `0.797` case only).
31. (blind) (walk) A rate field loaded from a stored 0.9312 (shown as
    `0.931200`) and saved untouched writes no record and keeps its
    provenance, with the stored record byte-identical. Test: no test.
32. (blind) No client module but the formatter's calls `toFixed`,
    `toLocaleString` or `Intl.NumberFormat`, asserted by scanning the
    client source. Test: `tests/test_client.py::test_the_client_side_rules_hold`.
33. (blind) (walk) Figures and dates on every screen are written the way
    the settings say, the calendar included, asserted on the screens
    rather than on the formatter. Test:
    `tests/browser/parts/settings.mjs`.
34. (blind) With locale `en-US` and no `dateStyle`, 2026-09-20 reads
    `09/20/2026` from `date`, `Sep 20, 2026` from `longDate`,
    `September 20, 2026` from `fullDate`, `September 20` and `Sep 20`
    from `dayMonth`, and `September 2026` from `monthYear`, and a moment
    that day starts `Sep 20, 2026, ` in `dateTime`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
35. (blind) With locale `en-US` and `dateStyle` `dmy`, `date`,
    `longDate`, `fullDate` and both forms of `dayMonth` read 2026-09-20
    as `20.09.2026`, a moment that day starts `20.09.2026, ` in
    `dateTime`, and `monthYear` reads `September 2026`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
36. (walk) The settings sample line writes its date with `longDate`, so
    under locale `en-US` and no `dateStyle` it spells the month. Test:
    `tests/browser/parts/settings.mjs`.
37. (walk) A date typed the way the settings write it is accepted, and a
    date that does not exist or has a two-digit year is refused rather
    than moved. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
38. A locale tag the engine does not know falls back rather than
    failing. Test: `tests/test_client.py::test_the_client_side_rules_hold`.
39. (walk) Changing a date or number setting and changing it back leaves
    every stored figure and date as it was, and writes no record but the
    profile. Test: no test.
40. (walk) The date and number settings come back the same on another
    browser. Test: no test.
41. (blind) (walk) With locale `de-CH`, the edit
    dialog for a past snapshot of a `USD` holding stored as `"1000.40"`
    prefills `1’000.40` and changing only its note writes `value`
    `"1000.40"`, compared byte for byte. The same dialog for an
    `XAU-ozt` snapshot stored as `"12.125"` prefills `12.125`. Test:
    `tests/browser/parts/settings.mjs`.
42. (walk) Account deletion removes the principal row, its credential
    rows, wrappers, records and sessions, and a later sign-in with those
    credentials fails. Test: `tests/browser/parts/settings.mjs`,
    `tests/test_schema.py::test_deleting_a_principal_cascades_to_everything_it_owns`.
43. (blind) A `DELETE /api/auth/account` with a wrong `authKey`, or a
    `confirmUsername` that is not the session user's, is refused
    server-side and deletes nothing, called directly without the
    dialog. Test: `tests/test_auth.py::test_deleting_an_account_needs_the_auth_key_and_the_typed_username`.
44. (walk) Any vault owner can delete their own account, whoever else is
    on the instance. Test: `tests/browser/parts/settings.mjs`.
45. `DELETE /api/auth/account` from an administrator session answers
    Not Found and deletes nothing, also when they are not the last
    administrator. Test: `tests/test_auth.py::test_an_administrator_cannot_delete_through_the_vault_owners_path`.
46. (walk) An administrator session gets Not Found from `/settings`,
    `GET /api/sessions`, `POST /api/auth/logout-all` and
    `DELETE /api/auth/account`. Test:
    `tests/test_guard.py::test_an_administrator_reaches_change_password_and_not_settings`,
    `tests/test_auth.py::test_an_administrator_cannot_delete_through_the_vault_owners_path`.
47. An administrator session is unaffected by any idle period. Test:
    `tests/browser/parts/admin.mjs`.
48. An administrator session is dead 12 hours after sign-in, asserted
    as a vault owner's is. Test: `tests/test_session.py::test_the_absolute_expiry_binds_an_administrator_the_same_way`.
49. (walk) The deletion dialog offers Export first as the primary action
    and Delete my vault as the destructive secondary one. Test:
    `tests/browser/parts/settings.mjs`.
50. (blind) (walk) Delete my vault is disabled until the password is
    filled and the typed username matches, asserted on computed style:
    petrol-200 fill and border, ink-secondary label, opacity 1 and no
    red while disabled, red once it can act. Test:
    `tests/browser/parts/settings.mjs`.
51. (blind) (walk) `GET /api/sessions` returns no IP address and no user
    agent, asserted against the full response shape so an added field
    fails the test, and never returns a cookie value. Test:
    `tests/test_auth.py::test_sessions_report_no_ip_and_no_user_agent`.
52. (walk) `GET /api/sessions` returns only the session user's own
    sessions. Test:
    `tests/test_auth.py::test_sessions_list_only_the_callers_own`.
53. (blind) (walk) A session row past the absolute expiry and still in
    the table is absent from `GET /api/sessions`. Test:
    `tests/test_session.py::test_the_session_list_leaves_off_an_expired_row_still_in_the_table`.
54. (blind) (walk) Locking and unlocking leaves `GET /api/sessions` with
    the same entries, the same `id` and the same `issuedAt`, compared
    before and after. Test:
    `tests/test_session.py::test_unlocking_does_not_move_issued_at_so_the_expiry_counts_from_sign_in`.
55. (walk) `POST /api/auth/logout` invalidates the calling session only,
    and a second session of the same user still works. Test:
    `tests/test_auth.py::test_logout_ends_only_the_calling_session`.
56. (walk) Log out everywhere invalidates the current session too. Test:
    `tests/test_auth.py::test_log_out_everywhere_ends_the_current_session_too`.
57. (walk) Change password, `GET /api/sessions`, log out everywhere and
    account deletion answer Unauthorized without a session, and
    `POST /api/auth/logout` without a session answers OK. Test:
    `tests/test_auth.py::test_the_settings_endpoints_need_a_session`,
    `tests/test_auth.py::test_logout_without_a_session_answers_ok`.
58. Change password, log out, log out everywhere and account deletion
    answer Forbidden without the `X-Solvent-Request` header. Test:
    `tests/test_auth.py::test_the_settings_writes_need_the_request_header`.
59. A failed sign out everywhere says so inline and leaves every
    session open, this one included. Test: `tests/browser/parts/settings.mjs`.
60. (walk) After the configured idle period the in-memory keys are gone
    and reading vault data asks to unlock, and after 12 hours the server
    session answers Unauthorized whatever the activity. Test:
    `tests/browser/parts/unlock-idle.mjs`,
    `tests/test_session.py::test_a_session_past_the_absolute_lifetime_is_refused`.
61. (blind) (walk) The idle lock defaults to 15 minutes, survives
    signing out and back in, follows the user to another device, and
    appears in plaintext nowhere in the database, asserted by scanning
    the stored rows. Test: `tests/browser/parts/unlock-idle.mjs`.
62. (blind) (walk) A profile with `idleLockMinutes` 0, 500, 7 or 7.5
    locks at 5, 60, 5 and 5, and the select shows that value, each
    asserted by when the lock fires as well as by the select. Test:
    `tests/browser/parts/unlock-idle.mjs`.
63. A stored `idleLockMinutes` that is not a number locks at 15. Test:
    no test.
64. (blind) (walk) A changed period locks at the new one with no
    activity after the change. Test:
    `tests/browser/parts/unlock-idle.mjs`.
65. (walk) No setting anywhere turns the idle lock off. Test: no test.
66. (walk) Reordering a dimension's values reorders the chart's bands
    and writes one record, touching no `account` record. Test:
    `tests/browser/parts/dimensions.mjs`.
67. (walk) Renaming a dimension or a value writes one record and leaves
    every `account` record byte-identical. Test:
    `tests/browser/parts/dimensions.mjs`.
68. (blind) (walk) Archiving a dimension and restoring it returns every
    holding to the band it was in, with no `account` record written
    either way. Test: `tests/browser/parts/dimensions.mjs`.
69. (walk) Archiving a value moves its holdings to "Unassigned", and
    restoring it moves them back. Test:
    `tests/browser/parts/dimensions.mjs`.
70. (blind) (walk) No operation on the dimensions screen writes more
    than one record, asserted by counting `PUT`s across create, rename,
    reorder, archive and restore and by comparing every `account` record
    byte for byte. Test: `tests/browser/parts/dimensions.mjs`.
71. Two dimensions created in one session hold different ids, and no id
    equals a label. Test: `tests/browser/parts/dimensions.mjs`.
72. A dimension id is drawn uniformly, redrawing bytes outside the 36
    characters. Test: `tests/browser/parts/dimensions.mjs`.
73. (walk) A profile with no `dimensions` key renders the dashboard with
    "Total" as the only grouping and no errors. Test:
    `tests/browser/parts/dimensions.mjs`.
74. (walk) Coverage counts the active holdings. Test:
    `tests/browser/parts/dimensions.mjs`.
75. (walk) A blank rename is refused and keeps what was typed, its error
    clears once a name is typed, and clicking away from a rename writes
    nothing and leaves it open. Test:
    `tests/browser/parts/dimensions.mjs`.
76. (walk) A dimension save that fails says so on its card and shows the
    stored value, and a Conflict names the other tab and reloads the
    profile. Test: `tests/browser/parts/dimensions.mjs`.
77. (blind) (walk) A wrong password at `POST /api/auth/change-password`,
    from either kind of session, or at `DELETE /api/auth/account` counts
    as a failed sign-in, and once the sign-in limits engage, both
    endpoints and sign-in refuse the right password with Too Many
    Requests and write nothing. Test:
    `tests/test_attempts.py::test_a_wrong_password_on_a_settings_form_is_a_failed_sign_in`.
78. (walk) At 390 px and at 320 px wide, the "This session" chip sits on
    one line and the page does not scroll sideways. Test:
    `tests/browser/parts/settings.mjs`,
    `tests/browser/parts/settings-review-phone.mjs`.
79. (blind) A `POST /api/auth/change-password` with the right current
    password and a new Auth Key of 3, 31 or 33 bytes, or not base64, is
    a Bad Request, for either kind, and leaves every row as it was.
    Test: `tests/test_auth.py::test_a_rotation_to_an_auth_key_that_is_not_thirty_two_bytes_is_refused`.
80. (blind) (walk) After the password changed in another tab of the same
    browser, a change from this tab with the current password succeeds
    with one `/api/auth/salt` request and one change-password request,
    and the new password then opens the vault. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
81. (blind) (walk) A change-password request whose `currentSalt` is not
    the credential's salt answers Conflict
    `{"refused":"credential-changed"}`, for either kind, and writes
    nothing, no failed sign-in included. Test:
    `tests/test_credential_changed.py::test_a_password_change_on_a_superseded_salt_writes_nothing_and_counts_no_failure`,
    `tests/test_credential_changed.py::test_an_administrator_on_a_superseded_salt_changes_nothing`.
82. (walk) A new password equal to the current one shows "The new
    password is your current one." above the first field, keeps every
    field and sends nothing. Test: `tests/browser/parts/settings.mjs`,
    `tests/browser/parts/settings-review-reuse.mjs`.
83. (walk) After a successful password change, for a vault owner and for
    an administrator, every field is empty, the gauge shows no filled
    segment and no rating, and Change password is disabled. Test:
    `tests/browser/parts/settings.mjs`,
    `tests/browser/parts/settings-review-gauge.mjs`,
    `tests/browser/parts/admin-review-cleared.mjs`,
    `tests/browser/parts/admin-review-gauge.mjs`.
84. (walk) The Change password fields and the delete dialog's password
    field each sit in a form holding the signed-in username in a hidden
    text field with autocomplete `username`, ahead of the password
    fields. Test: `tests/browser/parts/settings.mjs`,
    `tests/browser/parts/settings-review-forms.mjs`.
85. (blind) (walk) A screen reader names each list and password field in
    Settings, and both fields of the deletion dialog, by the label shown
    beside it. Test: `tests/browser/parts/settings.mjs`,
    `tests/browser/parts/settings-review-names.mjs`.
86. (blind) (walk) A screen reader names the Name and First value fields
    of the create dialog, and the Label field of the add value dialog,
    on Dimensions by the label shown beside each. Test:
    `tests/browser/parts/dimensions.mjs`,
    `tests/browser/parts/dimensions-review-names.mjs`.
