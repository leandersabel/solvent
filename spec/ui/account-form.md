# Account form

## Purpose

Create and edit a holding, and the archive/delete decision for one
that already has history.

Exercises: `spec/features/manage-accounts.md`.

## Layout

Modal over the dashboard for create; full panel for edit, reached from
the holding's detail screen (`account-detail.md`). Form max-width
480px.

- **Name** — free text. Not required to be unique; two holdings may
  share a name.
- **Measured in**, the unit the holding is counted in, and the choice
  that decides which run of prices values it. One searchable select
  over the operator's symbol table (`GET /api/rates/symbols`,
  `rate-lookup.md`), showing each symbol and its label, with
  **"Something else…"** at the foot opening a free-text field.

  This single control sets the unit *and* the rate symbol, because they
  are the same thing (`manage-accounts.md`): a listed unit gets
  proposals, a free-text unit does not, and no combination of answers
  can produce a holding measured in grams and priced per ounce.

  **The ordinary answers come first, and an unusual one says what it
  commits you to** (`product/manage-accounts.md`, Decisions taken on your
  behalf).

  - **Order**: the vault's main currency, then the other currencies,
    then the metals, then "Something else…". Nearly every holding is a
    bank account or a depot in a currency, so the common answer takes no
    searching and an unusual one is reached on purpose.
  - Currencies and metals sit in one list, grouped by `kind`. A
    brokerage depot picks its reporting currency here like any bank
    account; the form offers no share or ticker unit (architecture.md,
    Non-goals).
  - **A metal appears once per unit**, gram and troy ounce as separate
    rows, because they are separate runs of prices and a holding counted
    in one but priced by the other is wrong by a factor of thirty with
    nothing on any later screen to reveal it. The rows read as their
    labels, "Gold, gram" and "Gold, troy ounce", so the choice is made
    on words rather than on the difference between `XAU-g` and
    `XAU-ozt`.
  - Symbols with `lookup: false` are **listed and selectable**, marked
    "rate entered by hand" in the option row — silver, platinum and
    palladium in v1. Picking one is a normal choice, not a warning
    state: it records the canonical symbol against the holding, so it
    starts getting proposals automatically if a provider is added
    later. Pushing the user to free text would lose that.
  - **"Something else…"** takes free text (`m²`, `bottles`) with a
    one-line consequence stated at the point of choice, not discovered
    later: "You enter the price yourself each time you record a value."
    This is a normal case for unlisted property or collectibles, not an
    error.
    - Typed text is trimmed and its case kept, because `m²` is not
      `M²`. What it is not is normalized toward the table: where the
      typed text matches a listed symbol ignoring case, the form offers
      that symbol instead of accepting the free text. A holding
      measured in `usd` and one measured in `USD` look identical on
      every later screen and only one of them is ever priced.
  - **A unit the table no longer offers** still shows as the current
    choice on a holding already measured in it, with its stored text.
    A retired symbol keeps pricing (`rate-lookup.md`, Maintaining the
    table), so nothing is wrong and nothing needs deciding. The option
    is simply absent for anyone choosing afresh.
  - When the wanted unit is absent, the same free-text option is the
    answer, with: "Not listed? This list is set up for the whole
    instance by an administrator, not per vault." Adding a unit is an
    administrator task (`rate-lookup.md`, Maintaining the table), so the
    form offers no way to ask for one and must not send the user looking
    for a setting they do not have.
  - **What the choice commits you to**, stated under the control while
    it is still open and not only once it is locked: "You can change
    this until you record a value for this holding. After that it is
    fixed, and the only way to a different unit is to archive this
    holding and start a new one." The freeze is announced where the
    choice is made.
  - Option labels are server-supplied text and render through
    `textContent`, never as markup (`rate-lookup.md`, Maintaining the
    table).
- **Dimensions** — one **single-select per configured dimension**
  (`manage-accounts.md`, Dimensions), labelled with the dimension's
  display label and listing its values in configured order, plus
  "Unassigned". Defaults to "Unassigned", which is a real state the user
  can leave in place, not an empty one to nag about.
  - A dimension with exactly one value — a **flag** — renders as a
    checkbox instead of a select. Unchecked means unassigned. This is
    the shape that replaces a yes/no tag, and it must be one click.
  - The user never sees an id. Ids are what `dims` stores; the form
    reads and writes them and displays only labels.
  - One value per dimension needs no enforcement here: `dims` is a map
    keyed by dimension id, so a second value is unrepresentable
    (`manage-accounts.md`). The record shape carries the rule, not the
    control.
  - **`+ New value`** at the foot of each select creates one inline: the
    user types a label, it is appended to that dimension in the profile
    and selected here. Two writes, both single-record — the profile and
    then this holding. Without it, classifying a holding means leaving
    a half-filled form to visit another screen, which is how a taxonomy
    stops being used.
  - **`+ New dimension`** beneath the block does the same one level up,
    asking for a dimension label and a first value.
  - With no dimensions configured, the block collapses to that one
    link. Nothing here nags.
- **Note** — optional free text, collapsed behind "Add a note". For what
  a user wants to remember about a holding that was never a category:
  "joint with M", "sold half in 2024".
- Primary "Save", secondary "Cancel".

## Unit, once there are snapshots

The unit control is **disabled** on a holding with ≥1 snapshot, with an
inline explanation rather than a silent lock:

> The unit cannot change once you have recorded a value here. Your
> figures are counted in this unit, and the prices that value them
> belong to it. Archive this holding and create a new one instead.

Disabled and still readable, never removed: the unit is one of the facts
somebody opens this form to check. Name, note and filing stay editable
alongside it, so the lock is on one control rather than on the screen.

This is client-enforced by construction: `unit` lives inside the
ciphertext, so the server cannot validate it (`manage-accounts.md`).

## Delete: the user chooses

Deleting a holding **with snapshots** opens a dialog offering two real
options, archive preselected. A holding with **no** snapshots skips the
dialog entirely and is deleted outright.

### Archive

Default. Copy: "Keeps every value you recorded. Your past net worth
stays accurate. You can undo this."

The dialog names the **archive date**, the day the archive is made. It
is shown rather than chosen: a holding stops counting from the moment
you stop it.

- A **closing value** field dated the archive date, prefilled `0`,
  editable, with a "Skip" link. Copy: "What was it worth when you closed
  it?"
- Where that date **already holds a value for this holding**, the field
  prefills with the stored figure instead of `0`, and saving updates
  that record in place (`manage-accounts.md`, Edge cases). The dialog
  gets no private path around one value per holding per date.
  - **The replace prompt does not fire here.** It exists to catch
    somebody writing at a date they did not know was taken, and the
    stored figure is in the field they are looking at
    (`record-snapshot.md`, Same holding, same date). The dialog's own
    confirm is the confirmation.
- Skipping states its cost: "Without this, your chart drops by the last
  figure recorded here, with nothing recorded on that date to explain
  it." The date still carries the archive annotation, which is why the
  copy says nothing was recorded rather than nothing is known, and why
  the drop is never read as a bad entry.
- This is the expected path, and the copy reads as an ordinary question
  rather than a warning. The value it captures is what lets the chart
  run into the close instead of falling off a cliff
  (`net-worth-view.md`, Archived holdings).

**A closing value is a recording.** It joins the recording for the
archive date and writes that date's prices for every unit that needs
one, this holding's unit included, because the holding is still active
at the moment it is written (`record-rate.md`, The refresh). Where that
date already holds a recording, **its prices stand** and not one of them
is rewritten.

**The order of the writes is load-bearing**, and the dialog performs
them in this order:

1. The closing value, as an ordinary recording at the archive date.
2. That date's price entries, over the units of the holdings as they
   stand at this moment, this holding still among them.
3. The `account` record's archive flag, last.

The flag goes last because the refresh covers active holdings only.
Setting it first would drop this holding's unit out of the set and
archive a position at a price nobody captured.

**The dialog does not own the closing value once it is written.**
Changing or clearing it later happens where every other figure is
changed, in the recording for that date (`recording-detail.md`,
`record-snapshot.md`). Clearing it there leaves the archive annotation
exactly where it is, and the chart drops on that date the way it does
when the value was skipped here.

### Delete permanently

Requires typing the holding's name to confirm. The confirm button stays
disabled until the typed name matches, so a mistyped name reaches no
error state.

The dialog states plainly: "This also deletes N recorded values. Your
past net worth figures will change." Destructive styling, and it is the
secondary action.

It takes the holding and its own figures and **no price entry**. Another
holding measured in the same unit keeps working at the same prices, and
nothing in the dialog may suggest otherwise (`manage-accounts.md`,
Delete: the user chooses).

## At phone width

The form is one column at every width, so it stacks rather than taking
a second arrangement.

- The unit select is a full-height list with a text filter, and never a
  control that needs hover to reveal what an option means: "rate
  entered by hand" sits in the option row itself.
- In the archive dialog the closing value field is reachable without
  the confirm button leaving the screen.

## States

- **Loading**: the form opens at once from the in-memory model. The unit
  select alone waits on the symbol table and shows a skeleton until it
  resolves, and every other field is usable meanwhile.
- **Empty**: n/a.
- **Error, validation**: inline per field. A name is required, and a
  unit is required whether picked or typed. Nothing else is.
- **Error, the symbol table cannot be fetched**: the control degrades
  to free text with a retry and an inline notice: "The unit list could
  not be loaded. Try again, or type a unit." Saving is not blocked, and
  the notice names the cost, because a typed `dollars` is a free-text
  unit rather than the `USD` run of prices, and the choice is fixed once
  a value is recorded.
- **Error, Conflict stale version**: "This holding was changed in
  another tab." The panel reloads the current record.
- **Error, save failed**: the form keeps every value.
- **Error, the closing value did not save**: nothing is archived and
  the holding is untouched. The dialog stays open with the figure still
  in the field and says exactly that. This is what the write order buys.
- **Error, the closing value saved but the prices did not**: the figure is
  recorded and the archive goes through. The message names the units
  whose prices were not written, and nothing is rolled back
  (`record-rate.md`, The write path).
- **Error, the closing value saved but the archive flag did not**: the
  figure stays recorded at that date and the holding is still active.
  Say both halves and offer the archive again, which now prefills with
  the figure stored there.
- **Populated**: the saved holding appears in the table immediately
  from local state, with no refetch.

## What it deliberately does not show

- **No price and no rate field.** A holding's figure carries no price
  (`record-snapshot.md`), and prices belong to a unit and are captured
  inside a recording (`record-rate.md`, `update-values.md`).
- **No rate symbol field and no "no price source" checkbox.** The unit
  is the symbol, and one field cannot disagree with itself
  (`manage-accounts.md`).
- **No unit converter.** Nothing offers to restate a holding in another
  unit, because what a unit change means is a different run of prices,
  not arithmetic on the quantity.
- **No age, freshness or completeness marker.** A holding nobody has
  updated in a year is an ordinary holding, and this screen neither says
  so nor ranks by it (`net-worth-view.md`).
- **No prompt to file the holding.** An unfiled holding is a complete
  holding.
- **No note in the archive dialog that a unit stops being refreshed**
  when the last active holding measured in it is archived
  (`record-rate.md`, The refresh). Nothing breaks and nothing is lost:
  the prices captured so far stay, they keep pricing the dates they
  cover, and unarchiving resumes the refresh. The person meets no
  consequence, so the dialog spends no line on one.

## Rules

- `manage-accounts.md`, Rules applies unchanged.
- Creating a value or a dimension inline writes the profile record
  first. If that write fails, the account form keeps every field and
  says the value was not created; it never saves a holding referencing
  an id that does not exist.
- Unarchiving is available from the archived rows and from the
  holding's detail screen: one action, no dialog, restoring the holding
  to active lists and the current total. Its unit rejoins the set that the next
  recording refreshes (`record-rate.md`, The refresh).
- Names, notes and dimension labels are decrypted user text and render
  through `x-text` or `textContent` only (`design-system.md`,
  Accessibility).
