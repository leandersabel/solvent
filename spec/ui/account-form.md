# Account form

## Purpose

Create and edit an account (a holding), and the archive/delete decision
for one that already has history.

Exercises: `spec/features/manage-accounts.md`.

## Layout

Modal over the dashboard for create; full panel for edit, reached from a
table row. Form max-width 480px.

- **Name** — free text. Not required to be unique; two accounts may
  share a name.
- **Unit** — a two-part control: kind (`Currency` / `Asset`) then code.
  Currency offers the ISO 4217 list; Asset takes free text with examples
  as placeholder (`XAU-ozt`, `AAPL`, `m²`).
- **Rate symbol** — optional, with a "This account has no public price
  source" checkbox that sets it to `null`. Checked, the field hides and
  the form explains: "You will enter the rate by hand on each snapshot."
  This is a normal case (private equity, a loan, unlisted property), not
  an error state.
- **Tags** — chip input. Free text, comma or Enter to commit. Suggests
  from the client-derived tag union; **no request is made to fetch
  tags** — a server-side tag list would leak the tag graph.
  Whitespace-only and case-insensitive duplicates are normalized away as
  the user types, preserving first-seen casing.
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
- **Error — 409 stale version**: "This account was changed in another
  tab." The panel reloads the current record and asks the user to redo
  the edit rather than silently merging or clobbering.
- **Error — save failed**: the form keeps every value; nothing is lost.
- **Populated**: saved account appears in the table immediately from
  local state, with no refetch.

## Rules

- Every write re-encrypts the whole record with a fresh nonce and
  increments `version`.
- Name and tags render with `x-text` everywhere they are echoed back.
- Unarchiving is available from the archived rows: one action, no
  dialog, restoring the account to active lists and the current total.
