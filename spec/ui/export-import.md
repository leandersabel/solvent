# Export / import

## Purpose

Write the whole vault to a local file, and restore one from a file. A
user-held backup and the migration path across data-model upgrades —
explicitly not password recovery and not sync.

Exercises: `spec/features/export-import.md`.

## Layout

Own screen, reached from Settings. Content max-width 720px, two cards.

### Export

- One paragraph on what the file is: every record, plus the salt, KDF
  envelope, and wrapped DEK needed to open it. Encrypted throughout.
- A tinted callout with a critical icon, **shown before the download
  starts, not after**:

  > This file is exactly as sensitive as your password. Anyone who has
  > both owns your vault. If you lose the password, the file is
  > permanently unreadable.

- Primary button "Export vault". Downloads
  `solvent-vault-<username>-<YYYY-MM-DD>.json`.
- Beneath, ink-muted: the record count and the file's approximate size,
  so the user can sanity-check what they got.

### Import

Replace-only. There is no merge, and the UI must not imply one exists.

A four-step flow in one card, each step revealed as the previous
completes:

1. **Choose file.** Drag-drop or picker. Validated client-side for size,
   `format`, and `formatVersion` before parse.
2. **Password for that file.** Labelled "The password this file was
   exported under" — not "your password". They can differ, and this is
   the single most confusing point in the feature.
3. **Review.** A plain summary: N accounts, M snapshots, exported on
   DATE. Alongside it, what will be destroyed: "Your vault currently
   holds X records. All of them will be deleted."
4. **Confirm.** The user types `ERASE`. Primary button destructive,
   labelled "Replace my vault".

Below the flow, a short note on what does and does not change: "Your
password stays the same. Your login is unaffected. Only the contents of
your vault are replaced."

## The decryption wait

Import decrypts every record with the file's DEK, then re-encrypts every
record under the current user's AAD. On a large vault this is the
longest operation in the product.

- Determinate progress: "Decrypting 340 of 1 208…", then "Re-encrypting
  …". Two labelled phases, because they are genuinely different work and
  a single bar that stalls halfway looks broken.
- Runs in a Worker; the tab stays responsive.
- **Nothing is uploaded until every record has decrypted successfully.**

## States

- **Loading**: export assembles server-side; button shows a progress
  state. Import as above.
- **Empty**: an empty vault exports fine, producing a file with an empty
  `records` array. Say so rather than disabling the button.
- **Error — wrong password for the file**: "That password does not open
  this file." Nothing is uploaded; the existing vault is untouched. The
  flow returns to step 2 with the file still selected.
- **Error — one record fails to decrypt**: abort the entire import,
  naming which record. Copy must be explicit that nothing changed: "No
  records were imported. Your vault is unchanged." A partial restore is
  worse than none.
- **Error — malformed JSON, wrong `format`, or a newer
  `formatVersion`**: rejected at step 1 with a clear message. A newer
  file in an older app is not something to guess at.
- **Error — oversized file**: rejected client-side before parse.
- **Error — import failed server-side**: the transaction rolled back;
  the original vault is fully intact and readable. Say that plainly.
- **Populated**: on success, the view reloads against the imported data
  and confirms the count restored.

## Rules

- The `ERASE` confirmation is required whenever the target vault holds
  any records. It is never skipped, and no "don't ask again" exists.
- An older `formatVersion` migrates client-side after decryption, before
  re-encryption. Each supported version needs its own fixture test.
- Export is rate-limited per user; the button reflects the limit rather
  than failing silently.
