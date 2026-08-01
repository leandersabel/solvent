# Manage accounts

## What it does

Create, edit, archive, and delete accounts (holdings): name, native
unit, and freeform tags. All content is encrypted client-side and stored
through the generic record API (architecture.md, Record storage API).

## Record shape

`record_type: "account"`, plaintext `account_id` empty. Decrypted
payload:

```json
{
  "name": "UBS current account",
  "unit": { "kind": "currency", "code": "CHF" },
  "rateSymbol": "USDCHF",
  "tags": ["cash", "liquid"],
  "archivedAt": null,
  "createdAt": "2026-08-01T09:14:00Z"
}
```

- `unit.kind` is `currency` (with an ISO 4217 `code`) or `asset` (with a
  free-text `code` such as `XAU-ozt`, `AAPL`, `m²`). The distinction
  drives formatting and decimal places, nothing else.
- `rateSymbol` is the symbol the rate-lookup proxy should be queried
  with, or `null` for accounts with no public price source. It is set by
  the user, not inferred — see rate-lookup.md.
- `tags` is a plain string array. **There is no server-side tag
  entity**: a separate tag table would leak the tag graph to the server.
  The tag list shown in the UI is the union of all decrypted accounts'
  tags, computed client-side.
- `archivedAt` is `null` for active accounts, otherwise the ISO date the
  account was archived.

## Inputs / outputs

- In: account name, unit kind + code, optional rate symbol, tags.
- Out: `PUT /api/records/<uuid>` with the encrypted blob; the account
  appears in account lists and is selectable when recording a snapshot.

## Delete: the user chooses

Deleting an account that has snapshots presents **two explicit options**
— this is a user decision at delete time, not a fixed policy, because
both are legitimate:

- **Archive** (default, preselected). Sets `archivedAt` and re-writes
  the account record. The account disappears from active lists and can
  take no new snapshots, but every snapshot stays. Historical net worth
  remains truthful. Reversible — an archived account can be unarchived.

  The dialog also offers a **closing snapshot** dated `archivedAt`,
  prefilled with `0` and editable — the closing value if the position
  was liquidated at a figure, `0` if it simply ended. The user may skip
  it. Without one, the trend chart drops by the account's last known
  value on `archivedAt` with nothing recorded to explain it: an artifact
  of a flag rather than data the user entered, which is the same
  objection that rules out interpolation (net-worth-view.md). The
  closing snapshot turns the drop into a fact.
- **Delete permanently.** Removes the account record and cascades to
  every snapshot carrying that `account_id`. Requires typing the account
  name to confirm. The dialog must state plainly that **past net-worth
  figures will change**, because the history is going away. Irreversible.

An account with no snapshots skips the dialog and is deleted outright.

Cascade is executed **server-side** — the server can see `account_id` on
snapshot rows (architecture.md, Record storage API), so it can delete
the set atomically without the client enumerating ids. Endpoint:
`DELETE /api/accounts/<account_id>?mode=purge`.

## Rules

- Account names are not required to be unique; two accounts may share a
  name. The `record_id` is identity.
- Editing an account never touches its snapshots. Changing the unit of
  an account that already has snapshots is **blocked** — the existing
  values and stored rates are denominated in the old unit, and silently
  reinterpreting them would corrupt history. The user must archive and
  create a new account instead. (Renaming and re-tagging are always
  allowed.) Like the password policy (register.md), this is
  **client-enforced by construction**: `unit` lives inside the
  ciphertext, so the server cannot validate it and this spec does not
  pretend it is a server-side control.
- Every write re-encrypts the whole record with a fresh nonce and
  increments `version` (architecture.md, Nonce strategy).
- Decrypted names and tags are rendered with `x-text` / `textContent`
  only, never `x-html` (architecture.md, Application hardening).

## Edge cases

- **Account with no public price source** (private equity, unlisted real
  estate, a private loan) → `rateSymbol: null`. Valid and expected; rate
  proposals are simply unavailable and snapshots take a manual rate.
- **Account whose native unit is the user's main currency** → the rate
  is fixed at 1 and the rate field is hidden when recording snapshots.
- **Archiving an account that is the last active one** → allowed; the
  net worth view shows its empty state.
- **Unarchiving** → clears `archivedAt`; the account rejoins active
  lists and the current total.
- **Concurrent edit from two tabs** → the second `PUT` fails with 409 on
  the version check; the UI reloads and asks the user to redo the edit.
- **Tag with only whitespace, or duplicate tags on one account** →
  normalized away client-side (trim, drop empties, de-duplicate
  case-insensitively while preserving first-seen casing).

## Acceptance criteria

- Creating an account stores exactly one `account` record; the name,
  unit, and tags appear nowhere in plaintext in the DB.
- The account is readable after a fresh login (round-trips through
  encryption correctly).
- Editing name or tags increments `version` and writes a different
  nonce than the previous version.
- A `PUT` sent with a stale `version` is rejected with 409 and does not
  modify the stored record.
- Deleting an account that has snapshots shows a dialog offering both
  archive and permanent delete, with archive preselected.
- **Archive**: the account record gains `archivedAt`, no snapshot record
  is deleted, and the trend chart for dates before the archive is
  unchanged.
- Archiving with the offered closing snapshot accepted writes one
  snapshot dated `archivedAt`, and the chart steps to that value on that
  date instead of dropping by the last known value.
- Archiving with the closing snapshot skipped still archives; the drop
  at `archivedAt` is unexplained, and that is the user's choice.
- **Purge**: the account record and every snapshot with that
  `account_id` are gone, in one transaction — a mid-delete failure
  leaves neither partially deleted.
- Purge cannot delete another user's records: a `DELETE` naming an
  `account_id` belonging to a different user returns 404, not 403, and
  deletes nothing.
- Attempting to change the unit of an account with ≥1 snapshot is
  blocked client-side. The test asserts the UI refuses it — not that an
  API call is rejected, which the server cannot do.
- Unarchiving restores the account to active lists and to the current
  total.
- The tag list offered in the UI is derived client-side from decrypted
  accounts; no request returns a list of tags.
- An account name containing `<img src=x onerror=alert(1)>` renders as
  literal text everywhere it appears.
