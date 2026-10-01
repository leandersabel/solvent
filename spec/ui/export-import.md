# Export / import

## Purpose

Write the whole vault to a local file, and restore one from a file. A
user-held backup and the migration path across data-model upgrades —
explicitly not password recovery and not sync.

The file names nobody and opens with its own password, so it moves: to a
new machine, to a fresh install, or into another person's account on the
instance. Both screens are built on that, and neither treats it as a
hazard to be warned about.

Exercises: `spec/features/export-import.md`.

## Layout

Own screen, reached from Settings. Content max-width 720px, two cards.

The export card is also what the **delete-my-account** dialog reaches
when somebody takes its primary action (`ui/settings.md`). Same
download, same warning before it starts.

### Export

- One paragraph on what the file is: every holding, every figure
  recorded for it, and every price captured alongside them, plus the
  salt, KDF envelope, and wrapped DEK needed to open it. Encrypted
  throughout.
- One line on what it does not carry: the file holds **one way in, your
  password**, and no device, no second method, no recovery key
  (`export-import.md`, What it does).
- A tinted callout with a critical icon, **shown before the download
  starts, not after**:

  > This file is exactly as sensitive as your password. Anyone who has
  > both owns your vault. It stays locked with the password you have
  > right now, even if you change it later, and if you lose that
  > password the file is permanently unreadable.

- Primary button "Export vault", **not a link**: it fetches the endpoint
  and saves the response through a blob URL, because the endpoint
  requires a header a navigation cannot send (`export-import.md`). The
  file lands as `solvent-vault-<YYYY-MM-DD>.json` either way, naming
  nobody, the same as its contents.
- Afterwards, in ink-muted: what the file holds, by kind, and its
  approximate size, so the user can see they got what they expected.
  Both timelines are named, the figures and the prices, because a file
  carrying only one of them would restore a vault that reprices its
  whole history (`record-rate.md`).

### Import

Replace-only. There is no merge, and the UI must not imply one exists.

A flow in one card, each step revealed as the previous completes:

1. **Choose file.** Drag-drop or picker. Validated client-side for size,
   `format`, and `formatVersion` before parse, and refused when it
   carries no profile record, because it would restore a vault with no
   main currency (`export-import.md`, Edge cases). Nothing is decrypted
   first.
2. **Password for that file.** Labelled "The password this file was
   exported under" — not "your password". They can differ, and this is
   the single most confusing point in the feature.
   - The password unwraps the file's key and decrypts **the profile
     alone**, which is all the review below needs. A wrong password is
     caught here, before any other record is touched and before any
     request is sent.
   - The screen never says whose vault the file was, because the file
     says nothing about it. A file made by somebody else restores here
     given its password, and that is the feature working
     (`export-import.md`, Edge cases). No step asks for a name or
     treats the file as suspicious.
3. **Review.** What is in the file, by kind: holdings, recorded figures,
   captured prices, and the date it was exported. Alongside it, what
   will be destroyed, in the same kinds and with the total: "Your vault
   currently holds X records. All of them will be deleted."
   - The two sides are read in the same terms on purpose, because the
     question the step exists to answer is what is being traded for
     what.
   - Prices are named on their own line rather than folded into a total,
     because the review is the one place a person can see that both
     timelines are in the file before they destroy the one they have.
   - Into an empty vault the destroyed side reads "Your vault is empty.
     Nothing will be deleted." The step is still shown: somebody who
     believes they have data and is told they have none needs to see
     that before restoring, not after.
   - **A vault holding only its profile is empty here.** The profile is
     the vault's settings, not anything the person put in it, and a
     registered vault always holds one.
   - When the file's **main currency differs** from the current vault's,
     say so on its own line: "This vault is kept in EUR. Yours is
     currently in CHF." It is correct and consistent — the imported
     prices are denominated in EUR throughout (`export-import.md`), but
     it changes every figure on the dashboard, so it is not something to
     discover afterwards.
   - When the file carries an **older `formatVersion`**, one line: "This
     file was written by an earlier version. It is brought up to date as
     it goes in." Not a warning, and nothing to decide.
4. **Confirm.** The user types `ERASE`. Primary button destructive,
   labelled "Replace my vault".
   - Into an **empty** vault, as the review defines it, there is
     nothing to erase, so the typed word is dropped and the destructive
     button alone confirms. Every other vault requires it, and no
     setting anywhere turns it off.

Below the flow, what does and does not change:

> Your password stays the same and your login is unaffected. Only the
> contents of your vault are replaced: your holdings, your history, your
> main currency, your dimensions and your idle lock all become the
> file's. You are signed out anywhere else you are signed in. From this
> moment the two vaults are independent, so anything the file's author
> records in their own vault afterwards never appears here.

## The decryption wait

Import decrypts every record with the file's DEK, then re-encrypts every
record under a **newly generated** DEK (`export-import.md`, The re-key
step). On a large vault this is the longest operation in the product.

- Named phases. "Decrypting 340 of 1 208…" and "Re-encrypting …" carry
  determinate progress, because they are genuinely different work and
  one bar that stalls halfway looks broken. "Uploading" is a single
  request in one transaction, so it waits without a fabricated
  percentage.
- Runs in a Worker; the tab stays responsive.
- **Nothing is uploaded until every record has decrypted successfully.**

## At phone width

- The review's two halves, what is in the file and what will be
  destroyed, stack instead of sitting side by side. What will be
  destroyed stays above the confirm step either way, so it is never
  scrolled past.
- The `ERASE` field and the destructive button sit together, so the
  word and what it does are on screen at once.

## States

- **Loading**: export assembles server-side; button shows a progress
  state. Import as above.
- **Empty**: an empty vault exports fine, producing a file that carries
  its profile record alone. Say so rather than disabling the button:
  "Your vault is empty, so the file holds its settings and no holdings,
  figures or prices", followed by the file's size.
- **Error, export ceiling reached**: the button is disabled with the
  reason in place of a silent failure: "You have downloaded your vault
  several times in the last hour. You can do it again shortly."
- **Error, export failed**: nothing was written to disk and nothing in
  the vault changed. The button returns to its resting state and the
  message says both.
- **Error, wrong password for the file**: "That password does not open
  this file." Nothing is uploaded; the existing vault is untouched. The
  flow returns to step 2 with the file still selected.
- **Error, one record fails to decrypt**: abort the entire import,
  naming which record. Copy must be explicit that nothing changed: "No
  records were imported. Your vault is unchanged." A partial restore is
  worse than none.
- **Error, malformed JSON, wrong `format`, or a newer
  `formatVersion`**: rejected at step 1 with a clear message. A newer
  file in an older app is not something to guess at.
- **Error, oversized file**: rejected client-side before parse.
- **Error, a file with no profile record**: rejected at step 1, before
  any password is asked for: "This file carries no vault settings, so
  it would restore a vault with no main currency. It cannot be
  restored."
- **Error, import failed server-side**: the transaction rolled back;
  the original vault is fully intact and readable. Say that plainly.
- **Populated**: on success, the view reloads against the imported data
  and confirms what was restored, by kind. Where the main currency
  changed, the confirmation says the figures on screen are now in it.

## What it deliberately does not show

- **Nothing about when a backup was last made.** No date, no reminder,
  no schedule, no "it has been a while". The product does not know, and
  it is kept that way so a backup stays a plain file the person holds
  and nothing comes to depend on the app tracking it
  (`product/export-import.md`, What it deliberately does not do). A screen
  implying otherwise would be the first such dependency.
- **No merge, and no control that could be read as one.** No "keep what
  I have", no per-record choice, no preview of what would survive.
- **No partial export.** Not one holding, not one year. Both jobs the
  file does mean the whole vault.
- **No upload and no destination picker.** The file lands on the
  person's machine and where it goes next is their decision.
- **No hint, reset or recovery route** for the file's password. Nothing
  in the file and nothing on the server can open a vault whose password
  is lost.
- **No identity read off a file.** Not a username, not a vault name,
  not a device. The screen cannot show one because the file's contents
  carry none, which is what lets a backup found by a stranger name
  nobody. The filename is dated and names nobody, the same as the
  contents.

## Rules

- The `ERASE` confirmation is required whenever the target vault holds
  any record beyond its profile. It is never skipped, and no "don't ask
  again" exists.
- An older `formatVersion` migrates client-side after decryption, before
  re-encryption. Each supported version needs its own fixture test.
- Export is rate-limited per user (`export-import.md`); the button
  reflects the limit rather than failing silently.
- Both cards live on the vault surface. An administrator session reaches
  neither, and the screen does not exist for it (`app-shell.md`, The two
  surfaces).
