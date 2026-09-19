# Account form

## Purpose

Create and edit an account (a holding), and the archive/delete decision
for one that already has history.

Exercises: `spec/features/manage-accounts.md`.

## Layout

Modal over the dashboard for create; full panel for edit, reached from
the account's detail screen (`account-detail.md`). Form max-width 480px.

- **Name** — free text. Not required to be unique; two accounts may
  share a name.
- **Measured in** — one searchable select over the operator's symbol
  table (`GET /api/rates/symbols`, `rate-lookup.md`), showing each
  symbol and its label, with **"Something else…"** at the foot opening a
  free-text field.

  This single control sets the unit *and* the rate symbol, because they
  are the same thing (`manage-accounts.md`). There is no separate rate
  symbol field and no "no public price source" checkbox: a listed unit
  gets proposals, a free-text unit does not, and no combination of
  answers can produce an account measured in grams and priced per ounce.

  - Currencies and metals sit in one list, grouped by `kind`. A
    brokerage depot picks its reporting currency here like any bank
    account; the form offers no share or ticker unit (architecture.md,
    Non-goals).
  - Symbols with `lookup: false` are **listed and selectable**, marked
    "rate entered by hand" in the option row — silver, platinum and
    palladium in v1. Picking one is a normal choice, not a warning
    state: it records the canonical symbol against the holding, so the
    account starts getting proposals automatically if a provider is
    added later. Pushing the user to free text would lose that.
  - **"Something else…"** takes free text (`m²`, `bottles`) with a
    one-line consequence stated at the point of choice, not discovered
    later: "You will enter the rate by hand on each snapshot." This is a
    normal case for unlisted property or collectibles, not an error.
  - When the wanted symbol is absent, the same free-text option is the
    answer, with: "Not listed? Your instance's administrator configures
    which symbols are available." Adding a symbol is an operator config
    change (`rate-lookup.md`), so the form must not imply the user can
    do it.
  - If the symbol list cannot be fetched, the control degrades to free
    text with an inline notice rather than blocking the save — an
    account can always be created, and the unit is editable until the
    first snapshot.
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
    (`manage-accounts.md`). Unlike the unit lock below, this is not a
    rule the control has to carry — the record shape carries it.
  - **`+ New value`** at the foot of each select creates one inline: the
    user types a label, it is appended to that dimension in the profile
    and selected here. Two writes, both single-record — the profile and
    then this account. Without it, classifying an account means leaving
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

The unit control is **disabled** on an account with ≥1 snapshot, with an
inline explanation rather than a silent lock:

> The unit cannot change once an account has history — the values and
> rates already recorded are in the old unit. Archive this account and
> create a new one instead.

This is client-enforced by construction: `unit` lives inside the
ciphertext, so the server cannot validate it (`manage-accounts.md`).

## Delete: the user chooses

Deleting an account **with snapshots** opens a dialog offering two real
options, archive preselected:

- **Archive** (default) — "Keeps every snapshot. Your past net worth
  stays accurate. You can undo this."
  - Below it, a **closing snapshot** field dated the archive date,
    prefilled `0`, editable, with a "Skip" link. Copy: "What was it
    worth when you closed it?"
  - Explains what skipping costs: "Without this, your chart will drop by
    the last known value on this date with nothing recorded to explain
    it."
  - This is the expected path, and the copy should read as a normal
    question rather than a warning — the value it captures is what lets
    the chart run into the close instead of falling off a cliff
    (`net-worth-view.md`, Archived accounts).
- **Delete permanently** — requires typing the account name to confirm.
  Dialog states plainly: "This also deletes N snapshots. Your past
  net-worth figures will change." Destructive styling, and it is the
  secondary action.

An account with **no** snapshots skips the dialog entirely and is
deleted outright.

## States

- **Loading**: none for create. Edit populates from the in-memory model,
  so it is instant.
- **Empty**: n/a.
- **Error — validation**: inline per field. Name required; unit code
  required; nothing else is.
- **Error — Conflict stale version**: "This account was changed in
  another tab." The panel reloads the current record and asks the user
  to redo the edit rather than silently merging or clobbering.
- **Error — save failed**: the form keeps every value; nothing is lost.
- **Populated**: saved account appears in the table immediately from
  local state, with no refetch.

## Rules

- `manage-accounts.md`, Rules applies unchanged.
- Creating a value or a dimension inline writes the profile record
  first. If that write fails, the account form keeps every field and
  says the value was not created; it never saves an account referencing
  an id that does not exist.
- Unarchiving is available from the archived rows and from the account's
  detail screen: one action, no dialog, restoring the account to active
  lists and the current total.
