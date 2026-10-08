# Manage holdings

Creating, editing, archiving and deleting holdings: name, native unit,
dimension assignments and a note. All content is encrypted client-side
and stored through the generic record API (architecture.md, Record
storage API).

## What the client gets

The list of what you own and what you owe, one entry per holding: a
bank account, a brokerage depot, the gold in the safe, the flat, the
mortgage on it. Everything else in Solvent stands on this list. Each
household member has a separate vault, and what you type here is locked
in your browser before it is stored. So nobody can look your holdings
up for you, and nobody can recover them if you lose your password. The
screens carry the look in `app-shell.md`, What the client gets: nothing
is decorated, and nothing nags.

- **A holding is a name, a unit, its filing and an optional note.** Two
  holdings may share a name, because two accounts at one bank can. A
  note is for what was never a category: "joint with M", "sold half in
  2024".
- **The unit is also what prices it**: francs, dollars, troy ounces of
  gold, square meters, bottles. So a holding can never be measured in
  grams and priced per ounce, a mistake wrong by a factor of thirty that
  shows nowhere on screen. Its prices are that unit's run, shared with
  every holding in the unit and kept apart from the figures you record
  (`record-snapshot.md`).
- **The unit is fixed once a value is recorded**, and the app says why
  rather than revaluing your history against another run of prices. A
  different unit means archiving and starting a new holding, which
  breaks its history in two. Everything else, and every figure in its
  history, can be put right at any time.
- **Filing** puts a holding in at most one value of each dimension you
  invented, such as Liquidity with Cash, Investments and Retirement, so
  the chart's bands add up to your net worth (`net-worth-view.md`). A
  holding that is half retirement and half cash is two holdings. Filing
  happens inside the holding's form, because a taxonomy you have to
  leave a half-filled form to maintain stops being used. Dimensions
  themselves are kept on `account-settings.md`, Dimensions. A vault with
  no filing is complete.
- **A brokerage depot is one holding**, in the currency the broker
  reports in, valued at the total the broker shows. Not one line per
  position.
- **Stopping a holding asks what you mean**, because selling the flat is
  not deciding it never belonged in the list.
  - **Archive**, the normal answer, records zero on the day you archive.
    The holding leaves your active list and current total and takes no
    new values. Every earlier figure stays. Like any figure, the zero
    joins that date's recording and refreshes its prices, and the chart
    runs down to it, so your net worth on the days between can change.
    Unarchiving undoes it in one action.
  - **Delete permanently** removes the holding and every value recorded
    against it, and your past net worth figures change with it unless
    every one of those values was zero.

What it deliberately does not do:

- **No position-level tracking of shares**: no tickers, share counts,
  cost basis or per-holding performance (architecture.md, Non-goals). A
  depot is one figure read off the broker, which keeps an update sitting
  to a few minutes.
- **No automatic connection to any bank** (architecture.md, Non-goals).
  Values are entered by hand, and the sweep (`record-snapshot.md`,
  Update values) makes that cheap.
- **No free-floating tags beside dimensions.** A yes or no label is a
  dimension with one value, shown as a single checkbox.
- **No permanent deletion of a dimension or one of its values**
  (`account-settings.md`, Dimensions).
- **No search or report the server runs for you.** It cannot read your
  list. Everything is assembled in your browser after you unlock.

## Screens

### Account form

Creates and edits a holding, and holds the archive or delete decision.
A modal over the dashboard for create, a full panel for edit, reached
from Account detail. Form max-width 480px, one column at every width,
so it stacks at phone width.

#### Fields

- **Name**: free text, required.
- **Measured in**: one searchable select over the operator's symbol
  table (`GET /api/rates/symbols`, `rate-lookup.md`, The symbol table),
  showing each symbol and its label, with **"Something else…"** at the
  foot opening a free-text field. This one control sets the unit and the
  rate symbol, because they are the same thing (Record shape).
  - **Order**: the main currency, the other currencies, the metals,
    then "Something else…", grouped by `kind`, so the common answer
    takes no searching. There is no share or ticker unit.
  - **A metal appears once per unit**, gram and troy ounce as separate
    rows, because they are separate runs of prices. The rows read as
    their labels, "Gold, gram" and "Gold, troy ounce", so the choice is
    made on words rather than on `XAU-g` against `XAU-ozt`.
  - **A symbol with `lookup: false` is listed and selectable**, marked
    "rate entered by hand" in the option row itself, never behind hover,
    and not as a warning. It records the canonical symbol, so the holding
    gets proposals if a provider is added later, which free text would
    lose.
  - **In a vault whose main currency no source quotes into**, every
    option but the main currency is marked "rate entered by hand",
    because none has a rate source there (`record-rate.md`, Reading).
  - **"Something else…"** takes free text (`m²`, `bottles`) and states
    the consequence at the point of choice: "You enter the price
    yourself each time you record a value." Typed text is trimmed and its
    case kept, because `m²` is not `M²`. Where it matches a listed
    symbol ignoring case, the form offers that symbol instead, because a
    holding in `usd` and one in `USD` look identical everywhere and only
    one is ever priced. Where it matches a retired symbol ignoring
    case, it is refused with "XAG-ozt is no longer offered for new
    holdings.", naming the symbol.
  - **A unit the picker does not offer** still shows as the current
    choice on a holding measured in it: a retired symbol by its label,
    free text as stored. A retired symbol keeps its name and pricing
    (`rate-lookup.md`, Maintaining the table), so nothing needs
    deciding. It is absent for anyone choosing afresh.
  - **A missing unit** has the free-text option as its answer, with:
    "Not listed? This list is set up for the whole instance by an
    administrator, not per vault." Adding a unit is an administrator
    task, so the form offers no way to ask for one.
  - Under the open control: "You can change this until you record a
    value for this holding. After that it is fixed, and the only way to
    a different unit is to archive this holding and start a new one."
  - Option labels are server-supplied text and render through
    `textContent`.
  - At phone width the select is a full-height list with a text filter.
- **Dimensions**: one single-select per configured dimension, labelled
  with its display label, listing its values in configured order plus
  "Unassigned", the default and a real state, never nagged about. The
  user never sees an id.
  - A dimension with exactly one value, a **flag**, renders as a
    checkbox. Unchecked means unassigned, so a yes or no tag is one
    click.
  - **`+ New value`** at the foot of each select appends a value to that
    dimension in the profile and selects it. **`+ New dimension`**
    beneath the block asks for a dimension label and a first value.
    Either writes the profile first and then the holding, two
    single-record writes. If the profile write fails, the form keeps
    every field, says the value was not created, and never saves a
    holding referencing an id that does not exist.
  - With no dimensions configured, `dims` is `{}` and the block
    collapses to the `+ New dimension` link.
- **Note**: optional free text, collapsed behind "Add a note" and
  labelled "Note" once open.
- Primary "Save", secondary "Cancel".

#### Unit, once there are snapshots

On a holding with at least one snapshot the unit control is disabled,
still readable and never removed, because the unit is one of the facts
somebody opens this form to check. Beside it:

> The unit cannot change once a value is recorded here, including the
> zero an archive records. Your figures are counted in this unit, and
> the prices that value them belong to it. Archive this holding and
> create a new one instead.

Name, note and filing stay editable.

#### Delete: the user chooses

Delete on a holding with snapshots opens a dialog offering both
options, archive preselected. A holding with no snapshots is deleted
outright with no dialog. Delete on an archived holding offers permanent
delete alone.

**Archive.** The archive date is the day the archive is made, shown in
the copy rather than chosen, because a holding stops counting from the
moment it is stopped:

> Records zero for this holding on 3 October 2026 and takes it out of
> your total. Every value you recorded before then stays as it is. You
> can undo this.

- Where that date holds a non-zero figure for this holding, one more
  line above the confirm names the stored figure in the holding's unit.
  It is the consent, so the replace prompt does not also fire. At phone
  width it is on screen together with the confirm button. Where the
  date already holds a zero in any form, there is no such line.

  > This replaces the USD 12,450.00 recorded for 3 October 2026.

The same confirmation opens from Account detail's **Archive** action,
the only way a holding with no values reaches it.

**Delete permanently.** The user types the holding's name. The confirm
stays disabled until the name matches, in the shared disabled look
(design-system.md, Components), so a mistyped name reaches no error
state. The dialog says what the delete takes with it, read from the
holding's snapshots each time it opens, never from the action that
opened it:

- No snapshots: "There are no recorded values to delete. Your past net
  worth figures stay as they are."
- One: "This also deletes 1 recorded value." Several: "This also
  deletes N recorded values." Either is followed by "Your past net
  worth figures will change." when one of them is not zero, and by
  "Your past net worth figures stay as they are." otherwise, because a
  zero moves no past total.

Destructive styling, as the
secondary action. Nothing in it suggests a price entry goes with it,
because none does.

#### States

- **Loading**: the form opens at once from the in-memory model. Only the
  unit select waits on the symbol table, as a skeleton.
- **Error, validation**: inline per field, on its message line
  (design-system.md, Components, Input). A name and a unit, picked or
  typed, are required. Nothing else is. A refusal follows the field as
  it stands: it goes the moment the field fits, before Save, and a unit
  that still does not fit shows why it does not now.
- **Error, the symbol table cannot be fetched**: the control degrades to
  free text with a retry: "The unit list could not be loaded. Try
  again, or type a unit." Saving is not blocked, and the notice names
  the cost, because a typed `dollars` is a free-text unit rather than
  the `USD` run of prices, fixed once a value is recorded.
- **Error, Conflict stale version**: "This holding was changed in
  another tab." The panel reloads the current record and the user
  redoes the edit.
- **Error, save failed**: the form keeps every value.
- **Populated**: the saved holding appears in the table at once from
  local state, with no refetch.

The archive's failure states are under Archiving, Writes.

#### What it deliberately does not show

- **No price and no rate field.** Prices belong to a unit and are
  captured inside a recording (`record-rate.md`, `record-snapshot.md`,
  Update values).
- **No rate symbol field and no "no price source" checkbox.** The unit
  is the symbol.
- **No unit converter.** A unit change means a different run of prices,
  not arithmetic on the quantity.
- **No age, freshness or completeness marker**, and no prompt to file
  the holding (`net-worth-view.md`).
- **No value field and no rate lines in the archive dialog.** The zero
  is the only figure an archive writes, and its prices are the date's
  proposals, changed in the recording for that date
  (`record-snapshot.md`, Recording detail).
- **No note that a unit stops being refreshed** when the last active
  holding in it is archived. Its prices stay and keep pricing the dates
  they cover, and unarchiving resumes the refresh (`record-rate.md`,
  Edge cases), so the person meets no consequence.

### Account detail

Everything about one holding: what it is, what it is worth, and its own
list of values. This is where a wrong figure gets found, one click from
the date it belongs to. Standard app shell, content max-width 900px,
reached by clicking a holding's row on the dashboard.

#### Header

- The holding's name as the screen heading (`design-system.md`,
  Typography), with one chip per dimension assignment
  (`Liquidity: Cash`) and the note beneath.
- The current value: the native quantity and beside it the
  main-currency figure at the latest price for the holding's unit
  (`record-rate.md`, Reading), with that price's date stated beside it.
  Then "as of 31 Jul" and its age in words, "3 weeks ago", at any age
  and with no warning (`net-worth-view.md`). The as-of date is the
  quantity's, the only age that belongs to the person.
  - The dashboard's rates control does not reach this screen. That
    control is a comparison, and this screen answers what one holding is
    worth now.
- No snapshots: "Not yet valued", not 0. An unarchived holding whose
  last figure is the archive's zero shows 0. A unit with no price at
  all: **"Not priced"** in place of the converted figure, and excluded
  from the total (`net-worth-view.md`).
- Actions: **Record a value** (primary, opening `record-snapshot.md`,
  Snapshot entry, at this holding), **Edit** (Account form), **Archive**
  or **Unarchive**, **Delete**, the last two through Account form's
  dialogs.
- An archived holding shows an "Archived" chip and its `archivedAt`
  date, and offers no "Record a value".

#### The holding's own list of values

A table, newest first: Date, Value, In main currency, row
actions. Both value columns are figure columns (design-system.md,
Typography).

- **The date is a link** to its recording (`record-snapshot.md`,
  Recording detail), where the rest of that evening is and where the
  price that values the row can be corrected.
- **In main currency** converts at the price at that row's own date
  (`record-rate.md`, Reading). An estimate from an earlier day carries a
  price date line beneath the figure, "priced 15 Jan 2024"
  (design-system.md, Components). With no price, "not priced". A cell
  never repeats the quantity.
- **No Rate, Source or price-date column.** An entry carries no rate,
  and where a price came from is shown on the recording that captured
  it.
- A note on an entry shows as an icon that expands the row, never
  truncated.
- **No pagination.** A decade of entries scrolls. Paginating would add
  a control that solves nothing.
- Row actions: **Edit** (Snapshot entry, pre-filled, also where the
  entry's date is moved) and **Delete**. While the holding is archived,
  the archive's zero has neither.

#### At phone width

Up to 900px wide, where four columns leave a date no room, the list of
values becomes a list, the headings laid out as each entry is. An entry
holds its date with the note icon and any duplicate-date line first,
then the value at the left and the main-currency figure at the right,
then its actions on a line of their own. A date never wraps. The two
figures share a line when they fit and otherwise each takes one,
never broken inside a figure. A note wraps wherever it must, inside
an address too, and so does the holding's name in the heading. Every
action is a 44px target, and nothing on the screen pans sideways.

#### Deleting a snapshot

A single confirm:

> Delete the value of USD 12,450.00 for 31 July? Your net worth for
> the period around this date will change.

For the holding's only snapshot, the copy says instead that the holding
returns to "Not yet valued" and leaves the current total, which is not
the same as being worth 0.

**Deleting a value deletes no price.** A price belongs to a unit, so
the date keeps its prices and the recording stands. The copy does not
mention prices. Destroying a date, prices and all, is Recording
detail's act.

#### States

- **Loading**: none.
- **Empty, no snapshots**: "Nothing recorded yet. Record what this
  holding is worth." and the primary action, in place of the table.
- **One snapshot**: a table with one row.
- **Error, duplicate date**: two entries share one date (a date move
  whose `DELETE` failed, or two crossed sittings). Both rows render
  flagged, with a line naming the fault and **Keep this one** on each,
  and the chart leaves that date out of its interpolated series until it
  is answered. Recording detail owns the fault's presentation, and
  answering it in either place answers it.
- **A figure unpriced at its date**: its native value and "not priced".
  Other rows are unaffected.
- **Error, Conflict on a snapshot write**: "This value was changed in
  another tab." The row reloads.
- **Error, delete failed**: inline on the row, "Nothing was deleted.",
  and the row stays.

#### Rules

- Opening, sorting or expanding a note issues no request and looks up
  no price. Every figure comes from the in-memory model
  (`net-worth-view.md`, Rules).
- A converted figure can move without this holding being touched,
  because correcting a price in a recording moves every holding in that
  unit on that date. The screen states no caveat: it shows the quantity
  recorded times the price recorded.
- The table is this holding's values only. A cross-holding price audit
  is not here.

## How it works

### Record shape

`record_type: "account"`, plaintext `account_id` empty. Decrypted
payload:

```json
{
  "name": "UBS dollar account",
  "unit": "USD",
  "dims": { "d7f3a1b2": "9c4e0f11", "a4b8c2d1": "3e7f9a02" },
  "note": "joint with M",
  "archivedAt": null,
  "createdAt": "2026-08-01T09:14:00Z"
}
```

- `unit` is what the holding is measured in **and its rate symbol**: a
  symbol from the operator's table (`USD`, `XAU-ozt`, `XAU-g`) or free
  text for a holding with no market price (`m²`, `bottles`).
  - **There is no separate rate-symbol field.** A second field could
    disagree with the unit: a holding in `XAU-g` priced with `XAU-ozt`
    is wrong by a factor of 31.1034768, silently.
  - The unit names the **base asset only**. The quote currency is the
    main currency and travels as a separate `quote` parameter, so a pair
    like `USDCHF` is never a unit (`rate-lookup.md`).
  - A unit in the symbol table gets rate proposals. A free-text unit
    gets none, and its rates are entered by hand. No flag, no checkbox,
    no `null` case.
  - Formatting follows the reader's settings, not the unit
    (`account-settings.md`, Dates and numbers), so the record carries no
    `kind`.
- `dims` maps dimension id to value id (Dimensions).
- `note` is optional, `null` when unset.
- `archivedAt` is `null` for an active holding, otherwise the ISO date
  it was archived.
- **There is no server-side dimension entity**, because a server-side
  list would leak the classification graph. Everything the UI shows is
  derived client-side from the decrypted profile and holdings.

### Dimensions

A dimension is a named axis whose values partition the holdings. Its
list, labels and value order are user configuration that the holdings
cannot yield, and order is load-bearing for a stacked chart, so they
live in the encrypted profile record (`account-settings.md`, The profile
record).

- **At most one value per dimension, structurally.** `dims` is a map
  keyed by dimension id, and a JSON object cannot carry a key twice, so
  no form, import or hand-edited export can write a second value.
- **Ids, never labels.** Both halves are short opaque ids
  (`account-settings.md`, Dimensions). Renaming a label is a
  single-record write to the profile, and nothing in this feature
  rewrites many records. An id also cannot collide with anything the
  user typed, where a label-derived key could: a holding carrying a
  `bank:ubs`-style string would silently gain an assignment the moment a
  dimension keyed `bank` appeared.
- **A missing entry is a real state**, rendered as "Unassigned", never
  an error and never hidden. A dimension created later predates every
  holding before it, so readers treat an absent key as unassigned.
  Nothing is backfilled, because a backfill is a multi-record
  re-encryption that can partially fail.
- **An entry naming no configured value**, because the value or its
  dimension was archived or never existed, also renders as
  "Unassigned". The entry stays on the holding untouched, also across a
  save of the holding, so restoring the value restores every assignment
  exactly. Stripping it would be a destructive multi-record write to
  tidy a display setting.

### Inputs / outputs

The form's fields in, one `PUT /api/records/<uuid>` with the encrypted
blob out.

### Delete: the user chooses

Deleting a holding that has snapshots is the user's decision at delete
time, because both options are legitimate (Account form). Archive is
reversible (Archiving). **Delete permanently** removes the `account`
record and cascades to every snapshot carrying its `account_id`,
irreversibly. **It deletes no price entry.** A price belongs to a
symbol, another holding may be measured in it, and the server could not
find it anyway, because the symbol is inside the ciphertext.

The cascade runs **server-side** as one transaction, `DELETE
/api/accounts/<account_id>?mode=purge`, answering No Content. Any other
`mode`, or none, is a Bad Request. The server sees `account_id` on
snapshot rows, so it deletes the set atomically without the client
listing ids, and no other record type carries one. An `account_id` of
another vault is Not Found. The purge compares the vault epoch after
`BEGIN IMMEDIATE`, because import keeps record ids and a purge from a
page holding the replaced DEK would otherwise delete a restored holding
(architecture.md, Vault epoch).

### Archiving

D is the day the archive is made. The dialog shows it and offers no
choice.

**The zero is what archiving means.** The person choosing to archive
gives it, so it is a figure they gave (requirements.md, Recording
values). There is no closing value and no way to archive without the
zero: a closed position is worth nothing, and a band ending at any other
figure drops at D with nothing recorded to explain it.

The zero is an ordinary `snapshot`, `{ "date": D, "value": "0",
"note": null }`, with the holding's plaintext `account_id`. Nothing in
it marks it. **The archive's zero is the zero-valued snapshot at a
holding's `archivedAt` while `archivedAt` is set**, so the record shape,
export and import learn nothing new.

#### Writes

**The zero is a recording.** It joins the recording at D, or starts one,
and refreshes D's prices like any recorded quantity (`record-rate.md`,
The refresh).

Before its first create, the archive runs the pre-create reload of
`type=snapshot` and `type=rate` once and decides every step from what it
returned (`record-snapshot.md`, Creating and reopening are distinct
acts). An archive that creates nothing runs no reload. It is refused
only when the reload finds this holding's own slot at D taken. Other
holdings' records at D are the recording the zero joins, and a rate slot
taken since is one the refresh leaves alone. A refused archive writes
nothing and the dialog reopens on what D holds. A holding already
archived is not archived again, and nothing is written.

In this order:

1. **The zero at D**, by what D holds for this holding:
   - **Nothing**: a create at a fresh UUIDv4 and `version: 1`.
   - **A non-zero figure**: updated in place on the dialog's confirm,
     same `record_id`, `version` + 1, fresh nonce, `value` `"0"`, `note`
     kept. The dialog's statement is the consent, so the replace prompt
     does not also fire (`record-snapshot.md`, Same holding, same date:
     upsert).
   - **A zero** in any canonical form (`"0"`, `"0.00"`): nothing is
     written. This is the retry path after a failed flag write, and a
     stored `"0.00"` keeps its digits.
2. **D's price entries**, ensured over the units of the active holdings
   as they stand, this holding still among them: created only where D
   has no entry for a symbol, so a date that holds a recording keeps
   every rate it holds and a retry rewrites none it wrote. A date whose
   prices are complete issues no request to `/api/rates`, and a unit the
   proxy returns no proposal for gets no entry.
3. **The `account` record**, `archivedAt: D`, at `version` + 1.

A holding with no snapshots archives the same way, so the zero is its
only figure. It appears on no chart date (`net-worth-view.md`, Edge
cases), and unarchived it reads zero. **The zero is a recorded figure,
so from then on its unit is fixed** (Rules), archived or not.

**The order is load-bearing.**

- **The zero before the prices** is the write path's own order
  (`record-rate.md`, The write path): prices written with the quantity
  then failing would move every holding in those units for a figure
  that is not there.
- **The prices before the flag**, because the refresh covers active
  holdings only. A flag first would drop this holding's unit out of the
  set, and D would go unpriced for every other holding measured in it.
- **The flag last**, because each earlier step alone leaves a true
  state. A flag first with the zero failing would leave an archived
  holding stepping off its last figure, unable to take the snapshot
  that would repair it.

Failures, each a state of the archive dialog:

- **The zero did not save**: no price and no `account` write, the
  holding is untouched, and the dialog stays open:

  > The zero for 3 October 2026 did not save, so nothing was archived.

- **Conflict on the replacement**: surfaced, never retried. The dialog
  reloads that record and states the replacement again with the figure
  now stored, under:

  > This figure was changed in another window.

- **Refused after the reload**: another window recorded this holding at
  D, and nothing was written. The dialog reopens on what D holds, with
  the replacement line where the figure is not zero, under:

  > 3 October 2026 now holds a figure for this holding, recorded in
  > another window. Nothing was archived.

- **A price did not save**: the archive still goes through, because a
  price write never fails a quantity write (`record-rate.md`, The write
  path). Nothing is rolled back. The message names the units, computed
  rather than written into the copy, and the recording is a link:

  > Archived. The prices for USD and Gold, troy ounce on 3 October 2026
  > did not save. Add them in the recording for that date.

- **The flag did not save**: the zero and the prices written stay at D,
  and the holding stays active at zero. The archive is offered again,
  and the retry finds the zero, writes only the prices still missing,
  then the flag.

  > Zero is recorded for 3 October 2026, but the holding was not
  > archived. It is still in your total, at zero.

- **Conflict on the flag**: the message starts "This holding was
  changed in another tab.", the `account` record reloads, and archiving
  again finishes against the reloaded record, keeping the zero.

#### While archived

- **No new snapshot**, at any date (`record-snapshot.md`, Edge cases).
- **The archive's zero is read-only.** No edit, clear or delete, from
  Account detail or from the recording for D. An archived value has no
  reason to be anything but zero, and unarchiving is how it becomes
  editable.
- **An entry's date moves only to a date before D.** Onto D it would
  displace the zero (`record-snapshot.md`, Moving the date onto an
  occupied date), and after D it is a figure after the archive. A typed
  date on D or later is refused on the date field's own line, with the
  archive as the reason, even when the date is also in the future,
  because D is never later than today (`record-snapshot.md`, Refusing a
  date, and Snapshot entry for the copy).
- **Every other snapshot stays editable and deletable**
  (`record-snapshot.md`, Editing an existing snapshot), including a
  non-zero figure at D, which becomes the archive's zero when edited to
  zero.
- **Deleting the recording at D keeps the zero.** Every other record at
  D goes, the date stays a recording holding the zero, and the
  confirmation says the zero stays. Refusing the delete would leave
  unarchive, delete and archive again as the only route, and archiving
  again moves D to that day.
- **Purge still takes the zero** with every other snapshot. Read-only
  guards the zero against edits, not against deleting the holding.

All of this is client-enforced by construction, like the unit rule: the
server sees neither a date nor `archivedAt`. So a session whose model
predates the archive reads the holding afresh before every figure it
records for it, and is refused when the holding is now archived
(`record-snapshot.md`, Creating and reopening are distinct acts). A
plaintext archived flag the server could enforce is rejected, because
it tells the server which holdings are closed and when, and still
cannot judge a move against an encrypted date. Pinning the holding's
version on the server is rejected too, because a rename elsewhere
would refuse a save. Two sessions crossing inside one round trip can
still put a figure beside the zero, and none at D or later reaches a
total, because the chart counts an archived holding on no date from D
on and draws whatever D holds as the step (`net-worth-view.md`,
Archived holdings).

#### Unarchiving

One action, no dialog, from the archived rows and from Account detail.
It clears `archivedAt` at `version` + 1 and writes nothing else. The
holding rejoins active lists and the total at zero, and the zero
becomes editable. Its unit rejoins the set the next recording refreshes
(`record-rate.md`, The refresh).

#### A holding archived without a zero at D

A holding archived on D whose figure at D is not zero, or which has no
figure at D, keeps its history as it is. Nothing migrates it, because a
zero written into that history would be a figure nobody gave. The chart
draws its step at D (`net-worth-view.md`, Archived holdings).
Unarchiving and archiving it again writes the zero at the new D.

### Rules

- A holding's name need not be unique. The `record_id` is identity.
- Editing a holding never touches its snapshots. Changing the unit of a
  holding with snapshots is **blocked**, because the quantities are
  counted in the old unit and a new unit would price the whole history
  off a different symbol's series (`record-rate.md`). Renaming,
  re-filing and editing the note are always allowed. Like the password
  policy (`register.md`), this is **client-enforced by construction**:
  `unit` lives inside the ciphertext, so the server cannot validate it
  and no server-side control is claimed.
- Every write re-encrypts the whole record with a fresh nonce and
  increments `version` (architecture.md, Key management).
- Names, notes and dimension labels are decrypted user text, rendered
  with `x-text` or `textContent` only (architecture.md, Application
  hardening).
- A dialog left open when the vault locks is reopened after unlocking
  only as `login.md`, Unlock, Rules says. An archive dialog showing its
  outcome is not a fill-in dialog and does not come back.

## Edge cases

- **A holding with no public price source** (unlisted real estate,
  collectibles): a free-text unit, valid and expected, with rates
  entered by hand. A private loan in EUR is not this case: its unit is
  `EUR` and it prices through ordinary FX.
- **A holding in the main currency**, a depot reporting in it included:
  the rate is fixed at 1 and no rate is asked for anywhere.
- **A free-text unit that later becomes a listed symbol**: the holding
  starts receiving proposals with no migration, because the unit string
  was already the symbol. This is why the picker offers canonical
  symbols before free text (`rate-lookup.md`, Seeded symbols).
- **Archiving the last active holding**: allowed. The net worth view
  shows its all-archived state (`net-worth-view.md`, Edge cases).
- **Concurrent edit from two tabs**: the second `PUT` gets Conflict with
  no `refused` member, and the form reloads (Account form, States). A
  Conflict `{"refused":"vault-replaced"}` is not this case and closes the
  vault instead (`login.md`, A vault replaced elsewhere).

## Acceptance criteria

1. Creating a holding stores exactly one `account` record. Test:
   `tests/browser/parts/account-form.mjs`.
2. The name, unit, note and dimension assignments appear nowhere in
   plaintext in the database. Test:
   `tests/browser/parts/account-form.mjs`.
3. (walk) A holding reads back with the same name, note and filing after
   a fresh unlock. Test: `tests/browser/parts/account-form.mjs`.
4. (walk) Two holdings can share a name and both work. Test:
   `tests/browser/parts/account-form.mjs`.
5. (walk) A free-text unit is stored as typed, case kept, and the
   holding works normally. Test: `tests/browser/parts/account-form.mjs`.
6. (walk) No rate-lookup request names any symbol, free text or listed.
   Recording across holdings in several symbols issues one whole-table
   request for the recording date (`rate-lookup.md`, The client never
   names a symbol). Test: `tests/browser/parts/account-detail.mjs`.
7. (walk) A holding in the main currency is never asked a conversion
   rate. Test: `tests/browser/parts/update-values.mjs`.
8. Editing name, note or a dimension assignment increments `version`
   and writes a different nonce. Test:
   `tests/browser/parts/account-form.mjs`.
9. (blind) (walk) A `PUT` with a stale `version` is Conflict with no
   `refused` member and leaves the stored record unchanged. The form
   says so, reloads and the redone edit saves. Only this Conflict runs
   the reload-and-redo, never `vault-replaced`. Test:
   `tests/test_records.py::test_only_stored_version_plus_one_is_accepted`,
   `tests/browser/parts/account-form.mjs`.
10. Re-saving a holding with another value for a dimension leaves
    exactly one entry for that dimension id, guarding the shape itself.
    Test: `tests/browser/parts/account-form.mjs`.
11. (blind) No `account` record has a rate-symbol field, asserted
    against the record shape rather than values. Test:
    `tests/browser/parts/account-form.mjs`.
12. (blind) (walk) Changing the unit of a holding with a snapshot is
    refused by the UI, which says why. The test asserts the UI, never an
    API rejection, because the server cannot see the unit. Test:
    `tests/browser/parts/account-form.mjs`.
13. The dimension list is derived client-side from the decrypted
    profile, and no request returns dimensions, labels or values. Test:
    `tests/browser/parts/account-detail.mjs`.
14. (blind) (walk) Renaming a dimension or value label writes exactly
    one record, the profile, and leaves every `account` record
    byte-identical, compared row by row. Test:
    `tests/browser/parts/account-form.mjs`.
15. (walk) A holding not filed under a dimension shows as "Unassigned",
    as a normal state. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
16. (blind) (walk) A holding whose `dims` names an archived dimension or
    value renders as "Unassigned", and restoring it restores the
    assignment, with no `account` record written either way. Test:
    `tests/browser/parts/account-form.mjs`.
17. (blind) (walk) A name, note or dimension label containing
    `<img src=x onerror=alert(1)>` renders as literal text everywhere
    it appears: the list, the chart legend and every tooltip, not only
    the form. Test: `tests/browser/parts/account-form.mjs`.
18. (walk) Delete on a holding with snapshots offers archive,
    preselected, and permanent delete. Test:
    `tests/browser/parts/account-form.mjs`.
19. (walk) A holding with no snapshots is deleted outright with no
    dialog. Test: `tests/browser/parts/account-form.mjs`.
20. (walk) Delete on an archived holding offers permanent delete alone.
    Test: `tests/browser/parts/account-detail.mjs`.
21. (blind) (walk) The disabled permanent-delete confirm has the shared
    disabled look on computed style (petrol-200 fill and border,
    ink-secondary label, opacity 1, no red) and turns red once the name
    matches. A test of the disabled attribute alone passes a dimmed or
    red button. Test: `tests/browser/parts/account-form.mjs`.
22. (blind) (walk) The archive dialog offers no value field and no way
    to archive without the zero. Absence is the assertion. Test:
    `tests/browser/parts/account-detail.mjs`.
23. (blind) Archiving onto a D holding no records writes, in this
    order: one `snapshot` with that `account_id`, `date` D, `value`
    `"0"`, `note` `null`, `version: 1`. Then one `rate` entry at D for
    every unit of the active holdings except the main currency, this
    holding's unit included, that the proxy proposed. Then the
    `account` record with `archivedAt` D at `version` + 1. Asserted on
    the wire, with each write stubbed to fail in turn. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
24. (blind) (walk) The archived holding's own unit gets an entry at D
    even when it is the last holding measured in it. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
25. (walk) Archiving deletes no snapshot, and every earlier snapshot of
    the holding is byte-identical afterwards. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/account-detail.mjs`.
26. (walk) Archiving removes the holding from today's total and its
    active list. Test: `tests/browser/parts/account-detail.mjs`.
27. (blind) (walk) Archiving onto a D whose prices are complete issues
    no request to `/api/rates`, writes no `rate` record and leaves every
    rate entry at D byte-identical, counted both ways against a D
    holding no prices. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
28. (blind) (walk) The archive runs one reload of `type=snapshot` and
    `type=rate` before its first create, and none when it creates
    nothing, asserted as request count and position. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
29. (blind) (walk) Archiving onto a D where the holding has a non-zero
    snapshot names that figure as replaced before the confirm and shows
    no replace prompt. Test: `tests/browser/parts/account-detail.mjs`.
30. (walk) Afterwards exactly one snapshot exists for that holding and
    D: same `record_id`, `version` + 1, a different nonce, `value`
    `"0"`, the `note` unchanged. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/account-detail.mjs`.
31. (blind) (walk) Archiving onto a D where the holding's snapshot is
    `"0.00"` states no replacement, writes no snapshot and leaves that
    record byte-identical. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
32. (walk) A Conflict on the replacement is not retried, and the dialog
    states the figure now stored. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/account-detail.mjs`.
33. (blind) (walk) With a second session having recorded this holding at
    D after the first read its model, the first session's archive is
    refused after the reload and writes nothing. A second session that
    recorded only other holdings at D does not refuse it. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
34. (blind) With the zero's write stubbed to fail, no `rate` and no
    `account` write is issued, the holding is unchanged, and the dialog
    stays open. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/account-detail.mjs`.
35. (blind) With the `account` write stubbed to fail, the zero and the
    rate entries stay at D and the holding stays active at zero.
    Archiving again issues no snapshot write, no `rate` write and
    exactly one `account` `PUT`. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/account-detail.mjs`.
36. (blind) With one rate write stubbed to fail, the archive goes
    through, the message names that unit and links the recording, and
    nothing is rolled back. With the flag also failed, archiving again
    writes that unit's entry, rewrites no other, and writes the flag.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/account-detail.mjs`.
37. With the rate proxy answering 503, the archive still goes through.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
38. (walk) A Conflict on the archive flag reloads the `account` record,
    and archiving again finishes against it. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
39. (walk) A holding with no snapshots archives to a zero at D at
    `version: 1`, then the `account` record. Unarchived, it reads zero,
    not "Not yet valued". Test:
    `tests/browser/parts/account-detail.mjs`,
    `tests/test_client.py::test_the_client_side_rules_hold`.
40. (blind) (walk) After archiving a holding with no snapshots and
    unarchiving it, changing its unit is refused at the UI. Test:
    `tests/browser/parts/account-detail.mjs`.
41. (blind) (walk) While archived, the holding offers no way to record a
    figure at any date. Its zero at D offers no edit, clear or delete on
    Account detail, on the update row for D, or in the snapshot form,
    asserted on the controls rather than an API. Test:
    `tests/browser/parts/account-detail.mjs`.
42. (walk) While archived, an earlier entry's value can still be edited.
    Test: `tests/browser/parts/account-detail.mjs`.
43. (blind) (walk) While archived, typing D into an earlier entry's date
    refuses it on the date field's own line with the archive as the
    reason, never the future-date wording, with `aria-invalid` set, and
    Save issues no `PUT`. The same holds for a date strictly between a
    past D and today and for a date after today. Test:
    `tests/browser/parts/account-detail.mjs`.
44. (walk) Correcting that date to one before D clears the refusal
    before Save, and Save writes the move. Test:
    `tests/browser/parts/account-detail.mjs`.
45. (blind) (walk) Deleting the recording at D deletes every other
    record bearing D and leaves the archive's zero byte-identical. The
    recording still opens, holding the zero, and the confirmation says
    the zero stays. Test: `tests/browser/parts/account-detail.mjs`.
46. Purging an archived holding deletes its zero with every other
    snapshot. Test: `tests/browser/parts/account-detail.mjs`.
47. (blind) (walk) Unarchiving writes only the `account` record, with
    `archivedAt` `null`, and leaves every snapshot, the zero included,
    byte-identical. Test: `tests/browser/parts/account-detail.mjs`.
48. (walk) Unarchived, the holding rejoins the active list and the total
    at zero, a figure can be recorded for it, and the zero can be
    edited. Test: `tests/browser/parts/account-detail.mjs`.
49. (blind) A holding archived on D with no snapshot at D, or a non-zero
    one, gains no snapshot on unlock, on any read or on any write
    elsewhere, compared over every snapshot record before and after.
    Test: `tests/test_client.py::test_the_client_side_rules_hold`.
50. Unarchiving such a holding and archiving it again writes the zero at
    the new D. Test: no test.
51. (walk) Archiving the last holding in a unit stops that unit being
    refreshed when recording. Its rates so far stay, and unarchiving
    resumes them. Test: no test.
52. (walk) An earlier figure can be corrected by opening its recording
    from the date link in the holding's own list. Test: no test.
53. (blind) A purge removes the `account` record and every snapshot with
    that `account_id` in one transaction. With a fault injected
    mid-delete, neither is partially deleted. Test:
    `tests/test_transfer.py::test_purge_removes_the_holding_and_every_snapshot_carrying_its_id`,
    `tests/test_transfer.py::test_a_fault_mid_purge_leaves_the_holding_and_its_snapshots_whole`.
54. (blind) A purge deletes no `rate` record, compared before and after.
    Test:
    `tests/test_transfer.py::test_purge_removes_the_holding_and_every_snapshot_carrying_its_id`.
55. A purge without `mode=purge` is a Bad Request. Test:
    `tests/test_transfer.py::test_purge_requires_the_mode_parameter`.
56. (walk) A purge naming another vault's `account_id` answers Not
    Found, never Forbidden, and deletes nothing, so the app gives no
    hint the holding exists. Test:
    `tests/test_transfer.py::test_purge_cannot_reach_another_users_records`.
57. (blind) (walk) A purge naming a restored holding, sent with the
    epoch from before the import, answers Conflict
    `{"refused":"vault-replaced"}` and leaves the holding and every
    snapshot in place, row for row. Import keeps record ids, so a purge
    that checks only the id deletes it. Test:
    `tests/test_vault_epoch.py::test_a_page_holding_the_replaced_key_never_reaches_the_vault`,
    `tests/test_vault_epoch.py::test_an_import_between_the_gate_and_the_transaction_makes_the_write_answer_replaced`.
58. (walk) At 320px, 375px, 601px and 901px wide, a holding with a note,
    a seven-digit figure and two entries sharing a date pans no screen
    or box sideways. Every control lies on screen and takes a tap at its
    center, each control in the list of values is at least 44px tall at
    phone width, and no date wraps. A note holding an email address
    pans nothing either, nor does a name without a space. Test:
    `tests/browser/parts/account-detail.mjs`,
    `tests/browser/parts/account-detail-review-phone.mjs`.
59. (walk) The permanent-delete dialog of a holding with no snapshots
    says there are no recorded values to delete and that past net worth
    figures stay as they are, and of one whose only snapshot is an
    archive's zero, that it deletes 1 recorded value and past figures
    stay as they are. Test: `tests/browser/parts/account-detail.mjs`,
    `tests/browser/parts/account-detail-review-delete.mjs`.
60. (walk) A name or unit refused on Save stops being refused, with
    `aria-invalid` gone, the moment the field holds one that fits,
    before Save is pressed again. Test:
    `tests/browser/parts/account-form.mjs`,
    `tests/browser/parts/account-form-review-refusals.mjs`.
61. (walk) In a vault whose main currency no source quotes into, every
    unit option but the main currency is marked "rate entered by hand".
    Test: `tests/browser/parts/account-form.mjs`,
    `tests/browser/parts/account-form-review-unquoted.mjs`.
62. (walk) The holding's name is drawn at the screen heading's size and
    weight (`design-system.md`, Typography). Test:
    `tests/browser/parts/account-detail.mjs`,
    `tests/browser/parts/account-detail-review-heading.mjs`.
63. (blind) (walk) No header of the holding's own list of values names a
    unit but the main currency, and each value carries its unit as
    `design-system.md`, Units, sets, such as "12.5 ozt". Test:
    `tests/browser/parts/account-detail.mjs`.
64. (walk) A retired unit is not offered for a new holding, and typed as
    free text in any case it is refused. A holding already measured in
    it shows it as its current choice by its label, and so does one
    whose unit is fixed by a recorded value. Test:
    `tests/browser/parts/account-form-retired.mjs`,
    `tests/browser/parts/account-form-review-retired.mjs`.
65. (walk) Once "Add a note" is open, the note box is announced by its
    visible label, "Note". Test: `tests/browser/parts/account-form.mjs`,
    `tests/browser/parts/account-form-review-note.mjs`.
