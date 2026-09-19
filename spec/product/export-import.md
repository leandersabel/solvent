# Export and import

## What it does

Downloads your whole vault into one file on your own machine, and puts
one back.

The file is locked with your password from end to end. It is fine on a
USB stick, an external disk, or a cloud drive, and worth nothing to
anyone who has it without the password.

It does two jobs for you:

- **A backup you hold yourself**, independent of whatever the NAS does
  with its own snapshots. It is also the way out: you can leave with
  your data, and it is readable without asking anyone's permission.
- **The way your vault survives an upgrade** that changes how records
  are shaped. A file written by an older version of the app is brought
  up to date as it goes back in.

Two things it is not. It is **not a way back in if you forget your
password**, because the file is locked with that same password. And it
is **not sync**: it is one moment, copied, not a channel between two
machines or two people.

## The screens

Its own screen, reached from Settings through a row reading "Download
your vault, or restore one from a file." It is also offered inside the
delete-my-account dialog, where exporting first is the main action
(`account-settings.md`).

### Download

- A short paragraph on what is in the file: every record, plus
  everything needed to open it with your password. Encrypted throughout.
- A warning **before the download starts, not after**: this file is
  exactly as sensitive as your password, anyone with both owns your
  vault, and if you lose the password the file is permanently
  unreadable.
- One button. Afterwards, how many records it holds and roughly how big
  it is, so you can see you got what you expected.

### Restore

Four steps, each appearing as the one before it is done.

1. **Choose the file.**
2. **The password that file was exported under.** Labeled exactly that
   way, never "your password". They can be different, and this is the
   one place in the app where people will be confused.
3. **Review.** What is in the file, when it was exported, and next to
   it what will be destroyed: your vault currently holds this much, and
   all of it will be deleted. If the file is kept in a different main
   currency than yours, that gets its own line. It is correct, and it
   changes every figure on your dashboard, so it is not something to
   discover afterwards.
4. **Confirm.** You type `ERASE` and press "Replace my vault".

Underneath, what does not change: your password and your login are
unaffected, and only the contents of the vault are replaced.

Restoring a large vault is the longest wait in the product. You see two
named stages with real progress through them, the page stays usable, and
**nothing leaves your browser until the whole file has been opened
successfully**.

## What must be true

- The file opens with the password it was exported under and with
  nothing else. Someone holding it without that password learns only how
  many records there are and what kinds.
- Searching the file for a holding's name, a note, a value, a price, a
  currency, or a dimension finds none of them.
- Download, wipe, restore gives you the vault back: the same holdings,
  the same history, the same figures.
- After restoring, you sign in with the **same password as before**.
  Nothing about your login changes and nothing asks you to set it up
  again.
- A restore either happens completely or not at all. A failure anywhere
  leaves your existing vault exactly as it was and readable, and the app
  says that plainly rather than leaving you guessing.
- If even one record in the file cannot be opened, nothing is uploaded
  and nothing changes. A half restored vault is worse than none.
- Restoring into a vault that holds anything requires typing `ERASE`
  against a screen naming how much will be destroyed. There is no
  setting that turns that off.
- A restore replaces everything, your main currency and dimensions
  included. It is the one sanctioned way the main currency of a vault
  changes (`account-settings.md`), and you are told before you confirm,
  not after.
- After a restore, you are signed out anywhere else you are signed in,
  and have to sign in again. Nothing typed there afterwards reaches the
  vault.
- Two vaults are independent from the moment of a restore. If someone
  gives you their file and keeps using their own vault, nothing they
  enter later can appear in yours.
- A file you already downloaded keeps opening with the password it was
  made under, even after you change your password. The screen where you
  change it says so.
- An empty vault downloads to a valid file rather than refusing.
- A file from a newer version of the app is refused with a clear
  message, never guessed at. A file from an older version is brought up
  to date as it goes in.

## What it deliberately does not do

- **No merge.** Restoring means make this vault be what the file says.
  Combining a file with what is already there needs rules for which copy
  of a thing wins, and those rules would be wrong in ways nobody notices
  for a year. Nothing on the screen may suggest a merge exists.
- **No way back in without the password.** Nothing in the file and
  nothing on the server can open a vault whose password is lost. This
  file is a backup against losing the machine, not against forgetting.
- **No upload, no sync.** The app sends the file nowhere. It lands on
  your machine and where it goes next is your decision.
- **No partial download.** No "just this holding", no "just last year".
  Both jobs the file does mean the whole vault.
- **No "do not ask me again"** on the confirmation. It destroys a vault
  every single time it is used.

## Decisions taken on your behalf

- **A file exported by one person can be restored into another
  person's account on the same instance**, given that file's password.
  The file says nothing about whose vault it was, and that is kept
  rather than tolerated: it is what makes the file portable, it is why
  a vault can move to a new account or a fresh install without anybody
  helping, and it is why a backup found by a stranger names nobody.
  Restoring still needs the password the file was made under, so it is
  not something that can be done to you.
- **Nothing reminds you to make a backup.** Every download is something
  you do deliberately, and the app neither schedules one nor tells you
  how long it has been.

  Telling you how long it has been, or putting a copy somewhere by
  itself, is wanted and is not in the first version. What the first
  version owes them is that a backup stays a plain file you hold,
  with nothing else depending on the app knowing when one was
  last made.
- **There is a ceiling on how often the whole vault can be downloaded**,
  a few times an hour. It reads everything you own, and nobody backs up
  more often than that.
