# Export / import

The whole vault written to one local file that stays encrypted, and a
vault restored from such a file. It is a user-held backup and the only
migration path across data-model upgrades.

## What the client gets

Your whole vault downloads into one file on your own machine, and one
file puts it back. The file is locked with your password from end to
end. It is fine on a USB stick, an external disk or a cloud drive, and
worth nothing to anyone who has it without the password.

- **A backup you hold yourself**, independent of your server's own
  backups, and the way out: you leave with your data without asking
  anyone.
- **The way your vault survives an upgrade** that changes how records
  are shaped. A file written by an older version of the app is brought
  up to date as it goes back in.
- **A restore replaces everything**, main currency included, and you are
  told before you confirm. Your password and login stay as they are.
- **A file restores into any account on the instance**, given its
  password, because nothing in it names whose vault it was. A vault
  moves to a new account or a fresh install unaided, and a backup found
  by a stranger names nobody.
- **After a restore, the tab you restored in stays open.** Everywhere
  else your vault is open, it closes and asks for your password: in the
  same browser at once, on another device when its page is next used
  and at the latest when it locks. Unsaved typing there is lost, the
  screen says so, and nothing entered there reaches the vault.

What it deliberately does not do:

- **No way back in without the password.** Nothing in the file or on
  the server opens a vault whose password is lost. The file guards
  against losing the machine, not against forgetting.
- **No merge.** Combining a file with what is already there needs rules
  for which copy of a thing wins, and those rules would be wrong in ways
  nobody notices for a year.
- **No upload, no sync.** The file is one moment, copied, and the app
  sends it nowhere.
- **No partial download.** Both jobs the file does mean the whole vault.
- **No "do not ask me again"** on the confirmation. It destroys a vault
  every time.
- **Nothing reminds you to make a backup**, and no screen shows when
  you last made one. Every download is one you start, so nothing in the
  app depends on knowing when one was made.

## Screens

### Export / import

Its own screen on the vault surface, reached from Settings through a row
reading "Download your vault, or restore one from a file." It does not
exist for an administrator session (`app-shell.md`, The two surfaces).
Content max-width 720px, two cards. Neither card treats the file's
portability as a hazard to warn about.

The delete-my-account dialog's "Export first" (`account-settings.md`,
Settings) reaches the same export, warning included.

#### Export

- One paragraph on what the file is: every holding, figure and captured
  price, plus the salt, KDF envelope and wrapped DEK that open it.
  Encrypted throughout.
- One line: the file holds **one way in, your password**, and no device,
  no second method, no recovery key.
- A Callout with the critical icon (design-system.md, Components),
  **shown before the download starts, not after**, and never
  dismissible:

  > This file is exactly as sensitive as your password. Anyone who has
  > both owns your vault. It stays locked with the password you have
  > right now, even if you change it later, and if you lose that
  > password the file is permanently unreadable.

- Primary button "Export vault", **not a link**: it fetches and saves
  through a blob URL, because the endpoint needs a header a navigation
  cannot send (Export).
- Afterwards, in ink-muted: what the file holds by kind, figures and
  prices both named, and its approximate size.

#### Import

A flow in one card, each step revealed as the previous completes.
Replace-only, and nothing on the screen may imply a merge exists.

1. **Choose file.** Drag-drop or picker. Validated client-side for size
   before parse, then for `format`, `formatVersion` and the rest of what
   the file shows without its password. Nothing is decrypted first.
2. **Password for that file.** Labeled "The password this file was
   exported under", never "your password", because they can differ and
   this is the feature's most confusing point. It opens the file's
   envelope, checks the records in it as the server would, then
   decrypts and re-encrypts **every record** (The decryption wait), so
   a wrong password or a file that cannot be restored is caught here,
   before the review and before any request is sent. Only the wrap and
   the upload wait for the confirmation.
3. **Review.** What is in the file, by kind: holdings, recorded figures,
   captured prices, and the date it was exported, in the date style of
   the vault that is open. Alongside it, what will be destroyed, in the
   same kinds and with the total: "Your vault currently holds X records.
   All of them will be deleted." Both sides read in the same terms,
   because the step exists to answer what is being traded for what.
   - Prices get their own line, because this is where a person sees both
     timelines are in the file before destroying the ones they have.
   - **A vault holding only its profile is empty here**, because the
     profile is settings, not anything the person put in. The destroyed
     side reads "Your vault is empty. Nothing will be deleted." The step
     still shows, since somebody who believes they have data needs to
     see that before restoring.
   - A **different main currency** gets its own line: "This vault is
     kept in EUR. Yours is currently in CHF." It changes every figure on
     the dashboard, so it is not something to discover afterwards.
   - When the file carries an **older `formatVersion`**, one line: "This
     file was written by an earlier version. It is brought up to date as
     it goes in." Not a warning, and nothing to decide.
   - A line that does not apply is left out, never printed as "null".
4. **Confirm.** The user types `ERASE` and presses the destructive
   primary button "Replace my vault". Into an empty vault the word is
   dropped. Every other vault requires it, and no setting turns it off.

A lock, signing out or leaving the screen at any step starts the flow
again at step 1, keeping nothing: the file, its password, the typed
`ERASE` and the re-encrypted records all go, and a re-key in progress
stops. Choosing another file or opening it again discards the same.

Below the flow, what does and does not change:

> Your password stays the same and your login is unaffected. Only the
> contents of your vault are replaced: your holdings, your history, your
> main currency, your dimensions and your idle lock all become the
> file's. Every other tab and window of this browser, and every other
> device where your vault is open, closes it and asks for your
> password. Anything typed there and not yet saved is lost. From this
> moment the two vaults are independent, so anything the file's author
> records in their own vault afterwards never appears here.

This tab stays open on the restored vault (Populated). What the other
pages show is `login.md`, Unlock, Replaced elsewhere, and
`net-worth-view.md`, Dashboard, Replaced since last open.

#### The decryption wait

The re-key (The re-key step) is the longest operation in the product.
It runs at step 2, before the review, and the upload after the
confirmation.

- Named phases. "Decrypting 340 of 1 208…" and "Re-encrypting …" each
  carry determinate progress, because one bar that stalls halfway looks
  broken. "Uploading" is one request, so it waits without a percentage.
- It runs in a Worker, and the tab stays responsive.
- **Nothing is uploaded until every record has decrypted.**
- During the review the page holds the new DEK and the re-encrypted
  records, and of the file's plaintext only its main currency, which
  the review names. It never holds the file's DEK.

#### At phone width

- The review's two halves stack. What will be destroyed stays above the
  confirm step either way, so it is never scrolled past.
- The `ERASE` field and the destructive button sit together, so the
  word and what it does are on screen at once.

#### States

- **Loading**: the export is read from the server and sealed in the
  browser, and the button shows a progress state. Import as in The decryption wait.
- **Empty**: an empty vault exports a file carrying its profile record
  alone. The button stays enabled and the screen says so: "Your vault is
  empty, so the file holds its settings and no holdings, figures or
  prices", followed by the file's size.
- **Error, export ceiling reached**: the button is disabled with the
  reason beside it: "You have downloaded your vault several times in the
  last hour. You can do it again shortly."
- **Error, export failed**: the button returns to rest, and the message
  says nothing was written to disk and nothing in the vault changed.
- **Error, wrong password for the file**: "That password does not open
  this file." Nothing is uploaded and the vault is untouched. The flow
  returns to step 2 with the file still selected.
- **Error, a record fails to decrypt**: refused at step 2, with no
  review and no `ERASE` asked for: "This file is damaged and cannot be
  restored. 1 record in it could not be read. Your vault is unchanged."
  The count covers every record that failed. It names none, because a
  record that fails authentication has no field worth trusting. A
  partial restore is worse than none.
- **Error, malformed JSON, wrong `format`, or a newer `formatVersion`**:
  refused at step 1 with a clear message. A newer file in an older app
  is not something to guess at.
- **Error, a record at a newer `schemaVersion`**: refused as a newer
  file, not a damaged one, as soon as its records can be read: at step
  1 for a format 1 file, at step 2 for a sealed one.
- **Error, a damaged file**: an envelope that does not open under a
  password that opens the wrapper, or records the server would refuse,
  is refused at step 2: "That is not a Solvent vault file, or it has
  been damaged." Nothing is uploaded.
- **Error, oversized file**: refused client-side by its size, before
  parse, and server-side before any write.
- **Error, a file with no profile record**: refused as soon as its
  records can be read, before any request: at step 2, and at step 1 for
  a format 1 file. "This file carries no vault settings, so it would
  restore a vault with no main currency. It cannot be restored."
- **Error, import failed server-side**: the screen says plainly that the
  original vault is intact and readable.
- **Error, the password changed elsewhere**: the page locks and the
  Unlock card says why (`login.md`, Unlock, Password changed
  elsewhere).
- **Populated**: on success the view reloads in place against the
  imported data and confirms what was restored, by kind. Where the main
  currency changed, the confirmation says the figures on screen are now
  in it.

#### What it deliberately does not show

Beyond what the feature does not do (What the client gets):

- **No control that could be read as a merge.** No "keep what I have",
  no per-record choice, no preview of what would survive.
- **No destination picker**, and no hint, reset or recovery route for
  the file's password.
- **No identity read off a file**, no username, vault name or device. No
  step treats a file made by somebody else as suspicious.

## How it works

### What it does

Without the password the file reveals nothing but its size
(architecture.md, Key management, No password recovery). Record ids,
holding ids, edit counters and when it was made would say which figures
belong to one holding, how often each was edited and when the backup
was taken, so they are all sealed.

**It carries both timelines.** Quantities and prices are both ordinary
vault records (`record-rate.md`), so both ride in the same `records`
array with no format change and no second section. A file missing the
price entries would restore a vault whose whole history reprices
itself, which is the failure storing a price permanently exists to
prevent.

**The file carries exactly one wrapper: the password credential's**
(architecture.md, Credentials and vault key wrappers). A wrapper bound
to an authenticator does not travel to another machine, and its
credential id in a shared file is a device correlator. The password
method is what makes a vault exportable at all.

### Export

`GET /api/export` reads the vault and what opens it, with
`Content-Disposition: attachment` naming the file
`solvent-vault-<YYYY-MM-DD>.json`. Two vaults exported on one day
collide in a downloads folder, and the browser's own numbering is the
answer to that.

```json
{
  "exportedAt": "2026-08-01T09:14:00Z",
  "salt": "…",
  "kdf": { "alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1 },
  "wrappedDek": "…", "dekNonce": "…",
  "records": [
    { "recordId": "…", "recordType": "account", "accountId": null,
      "schemaVersion": 1, "version": 3,
      "nonce": "…", "ciphertext": "…" }
  ]
}
```

It **requires the `X-Solvent-Request` header** despite being a GET
(architecture.md, Application hardening, CSRF), so it is not reachable
by navigation. Following the URL directly is a Forbidden.

The browser unwraps the read's `wrappedDek` with the page's Master Key
and seals `{ exportedAt, records }` as JSON in one AES-256-GCM envelope
under that DEK, with a fresh 96-bit nonce and the AAD `solvent-vault`
0x1F `2`, the format version in decimal. That file is what it saves:

```json
{
  "format": "solvent-vault",
  "formatVersion": 2,
  "salt": "…",
  "kdf": { "alg": "argon2id", "v": 19, "m": 65536, "t": 3, "p": 1 },
  "wrappedDek": "…", "dekNonce": "…",
  "nonce": "…", "ciphertext": "…"
}
```

A wrapper that does not open with the page's Master Key writes no file.
The envelope's AAD has two fields where a record's has five, so neither
can pass for the other, and it binds the envelope to its format
version. Records inside keep their own encryption and AAD, so a restore
decrypts them as before.

A `formatVersion: 1` file is the read itself, with `format` and
`formatVersion` beside it: its records, ids and timestamp are in the
open. It still restores, checked record by record at step 1.

The client refuses a file over **64 MiB** by its size. The server's cap
is on the ciphertext it stores, and the file carries that ciphertext
base64 encoded twice, once per record and once in the envelope, so the
file cap sits above it.

Neither the file nor its name carries a **user identifier**, because a
file found on a lost machine or a shared drive must not say whose vault
it is. The file carries no vault epoch either. A record's AAD is built
from the record's own fields (`record-api.md`, The AAD encoding), so
the ciphertext authenticates without knowing who exported it, which is
what makes the file portable between accounts.

### Import: replace-only

Import **replaces the vault entirely**, with no merge, behind the typed
`ERASE` when the vault holds records beyond its profile (Screens).

#### The re-key step

Records are decrypted and re-encrypted client-side under a **freshly
generated DEK** rather than restored verbatim under the file's key.

A verbatim restore leaves two accounts holding one DEK, so a
compromised server could inject the exporter's *later* records into the
importer's vault, where they decrypt cleanly. Re-keying leaves the two
vaults no shared key material, so that fails at the cryptography rather
than at a check.

1. The user, signed in as the target account, selects the file and
   enters **the password that vault was exported under**.
2. The client derives `MK_file` from the file's salt and KDF envelope
   and unwraps `DEK_file`.
3. The client decrypts every record with `DEK_file` and the record's
   own AAD. Any failure aborts the whole import before anything is
   sent.
4. The client generates a **new random 256-bit `DEK_new`** and
   re-encrypts each record under it with a fresh nonce. `version` resets
   to 1, and the AAD is rebuilt for that version.
5. The client wraps `DEK_new` under the **current session's Master
   Key**, so the login password keeps working. Salt, KDF envelope and
   Auth Key are untouched.
6. `POST /api/import` carries the new wrapped DEK, the re-encrypted
   records and `currentSalt`, the salt the page's Master Key came from,
   with the page's vault epoch like every vault request. In one
   transaction begun with `BEGIN IMMEDIATE`, the server checks that
   epoch is still the vault's, then that `currentSalt` is still the
   `password` credential's salt (architecture.md, Credentials and vault
   key wrappers), deletes every record of the session user,
   replaces their `password` credential's wrapper, inserts the new set,
   and **replaces the vault epoch** with a fresh one. It answers OK
   `{ records, vaultEpoch }`: the count it stored and the new epoch. No
   session is revoked and no cookie rotates (architecture.md, Vault
   epoch).
7. The client swaps its in-memory DEK to `DEK_new` and its epoch to the
   new one, posts `{"replaced":"<the old epoch>"}` on the vault channel
   (`login.md`, A vault replaced elsewhere), and reloads the view. **The
   restoring page stays open.** Every other page closes the vault at
   once in this browser, and elsewhere at its next request, when it
   comes back into view, or at its next sign-in.

**Import is the one flow that changes the DEK**, so the
rewrite-every-wrapper rule binds it (architecture.md, Key management,
One key, N wrappers). A method the importing session cannot re-wrap is
**deleted in the same transaction**, because a stale wrapper is worse
than a missing one. With password the only method, this costs nothing.

**The profile record is replaced with everything else**, so main
currency, dimensions and idle lock become the file's. It is the one
sanctioned way the main currency changes (`account-settings.md`, Main
currency), because the history arrives with it and every price entry's
`rateTarget` matches the profile it came with.

The exported file keeps opening with `DEK_file` and its own password,
because re-keying the live vault does not reach back into files already
written.

### Rules

- The server assigns `principal_id` from the session on every imported
  record and never reads a `principalId` from the payload, so one
  account's import can never write into another's vault. Both routes
  are on the vault surface, so an administrator session gets Not Found
  from either (`app-shell.md`, The two surfaces).
- Strict server-side validation before any write: total payload size,
  per-record ciphertext size and record count caps (architecture.md,
  Storage & data handling), known `recordType` values, well-formed
  UUIDs, base64 that decodes cleanly, and `accountId` set exactly for
  `snapshot` records, referencing an `account` record in the same
  import, and `null` for every other type, never `""`.
- **Every record goes through the same per-record validator as
  `PUT /api/records`** (`record-api.md`), field-consistency check
  included, so there is one set of rules with two callers. It also
  enforces `version: 1` on every imported record rather than trusting
  the client's step 4. A record at any other version is a Bad Request
  for the whole payload.
- Client-side validation mirrors this, on a sealed file once its
  envelope opens, so a bad file fails fast without a large upload.
- The import is one transaction. A failure at any point leaves the vault
  exactly as it was, never half-erased, and a tab closed mid-import
  leaves no partial state to recover from.
- **Export reads the vault epoch, the credential's `params`, the wrapper
  and every record in one transaction**, so an import landing
  mid-export cannot produce a file whose wrapper does not open its
  records. An export the epoch refuses writes no `attempts` row.
- Export is rate-limited per user, **default 5 per hour**, operator
  config `EXPORTS_PER_USER_HOUR` (architecture.md, Application
  hardening, Rate limiting), because it is a full vault read and nobody
  backs up five times an hour.

## Edge cases

The refusals a person meets on the screen are under Screens, States.
There is no `formatVersion` below 1.

- **Older `formatVersion`**: the plaintext shape migrates client-side
  after decryption and before re-encryption, through the same per-type
  migration chain the client applies lazily on read (`record-api.md`,
  Schema migration). Each supported old version needs an explicit
  migration path and a test with a real fixture file. There is exactly
  one set of migration functions in the product, because an import-only
  copy would drift.
- **Two pages restore at once**: the later import answers Conflict
  `{"refused":"vault-replaced"}` and writes nothing, and that page closes
  the vault (`login.md`, A vault replaced elsewhere).
- **The import committed and its answer was lost**: the restoring page
  still holds the old epoch, so its next request answers
  `vault-replaced` and it closes the vault. Unlocking with the unchanged
  password opens the restored vault.
- **Another page saves while the import runs**: the save commits first
  and is replaced with everything else, or answers `vault-replaced` and
  writes nothing (architecture.md, Vault epoch).
- **The password changed, or its protection was strengthened, on
  another page after this one was unlocked**: the import answers
  Conflict `{"refused":"credential-changed"}` and writes nothing,
  because step 5's wrapper is under a Master Key the current password no
  longer gives. The page locks (`login.md`, A credential changed
  elsewhere).
- **The file's KDF envelope is below the server minimum**: the import
  still succeeds. The file's envelope only opens the file, and the
  vault's own envelope stays the account's.

## Acceptance criteria

1. (blind) Export, wipe, import restores the same ids, types, `account_id`
   links and decrypted payloads, figures and prices alike. Test:
   `tests/browser/parts/export-import.mjs`.
2. (blind) A reimported vault draws a byte-identical chart and the same
   total in both pricing modes (`net-worth-view.md`), which fails if
   either timeline is dropped. Test:
   `tests/browser/parts/export-import.mjs`.
3. The export read carries profile, account, snapshot and rate records
   in one `records` array. Test:
   `tests/test_transfer.py::test_the_export_carries_both_timelines_and_one_wrapper`,
   `tests/test_review_export_import.py::test_the_export_read_carries_every_kind_in_one_records_array_beside_what_opens_it`.
4. (blind) A scan of the file's actual bytes finds no plaintext holding
   name, note, dimension label, value, rate, symbol, date or currency.
   Test: `tests/browser/parts/export-import.mjs`.
5. No field of an exported file holds a user identifier. Test:
   `tests/test_transfer.py::test_the_exported_file_carries_no_user_identifier`.
6. (blind) The `Content-Disposition` header, not the saved name, names a
   dated file and no user. Test:
   `tests/test_transfer.py::test_the_export_filename_is_dated_and_names_nobody`.
7. An exported file carries exactly one wrapper and no field that names,
   counts or describes a credential. Test:
   `tests/test_transfer.py::test_the_export_carries_exactly_one_wrapper_and_nothing_describing_a_credential`.
8. An empty vault exports a valid file holding its profile alone. Test:
   `tests/test_transfer.py::test_an_empty_vault_exports_a_file_with_only_its_profile`.
9. After an import the unchanged password signs in and every restored
   record reads. Test: `tests/browser/parts/export-import.mjs`.
10. A file exported by a different user imports, and every record
    decrypts. Test: `tests/browser/parts/export-import.mjs`.
11. (blind) After an import the stored wrapper unwraps to a key that is
    not the file's `DEK_file`, asserted directly, since a verbatim restore
    passes every other criterion. Test:
    `tests/browser/parts/export-import.mjs`.
12. (blind) A record the source vault writes after the export, inserted
    straight into the destination's rows, fails to decrypt. Test:
    `tests/browser/parts/export-import.mjs`.
13. The exported file still opens with its own password after its vault is
    re-keyed by an import. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`.
14. (blind) An import replaces `wrapped_dek` and `dek_nonce` and leaves
    the credential's `params` and `verifier` byte-identical, compared
    field by field, since a rewritten envelope under the same password
    also signs in. Test:
    `tests/test_transfer.py::test_import_replaces_the_wrapper_and_leaves_the_credential_untouched`.
15. One byte altered in one record's ciphertext is refused at step 2,
    before any review, counting the record without naming it, and
    uploads nothing and leaves the vault intact. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`,
    `tests/browser/parts/export-import-review-damaged.mjs`.
16. A wrong password for the file aborts before any request is sent, with
    the file still chosen. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`.
17. A `principalId` field at the top level or on a record refuses the
    whole import with Bad Request, and neither vault changes. Test:
    `tests/test_transfer.py::test_a_principal_id_in_the_payload_is_refused_whole_and_neither_vault_changes`.
18. Imported records land under the session user. Test:
    `tests/test_transfer.py::test_imported_records_land_under_the_session_user`.
19. A file with no profile record is refused before any request: a
    format 1 file before a password is asked for, a sealed file once its
    password opens it. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`.
20. A file that is not JSON, has the wrong `format` or a newer
    `formatVersion`, or is oversized, is refused at the first step. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`.
21. Into a vault holding only its profile, the review says nothing will be
    deleted and asks for no `ERASE`. Test:
    `tests/browser/parts/export-import.mjs`.
22. Into a non-empty vault, an import without the typed `ERASE` is refused
    and changes nothing. Test: `tests/browser/parts/export-import.mjs`.
23. The review sets the file against what will be deleted, in the same
    kinds, prices on their own line. Test:
    `tests/browser/parts/export-import.mjs`.
24. The review names a main currency that differs from the vault's. Test:
    `tests/browser/parts/export-import.mjs`.
25. The review says so when the file carries an older `formatVersion`.
    Test: no test.
26. A DB failure mid-import leaves the original vault intact and readable,
    and the screen says so. Test:
    `tests/test_transfer.py::test_a_fault_mid_import_leaves_the_original_vault_intact`,
    `tests/browser/parts/export-import.mjs`.
27. A payload over the total size cap or the record-count cap is refused
    before any write. Test:
    `tests/test_transfer.py::test_a_payload_over_the_total_size_cap_is_refused_before_any_write`,
    `tests/test_transfer.py::test_a_payload_over_the_record_count_cap_is_refused`.
28. A payload with an unknown `recordType` is refused before any write.
    Test:
    `tests/test_transfer.py::test_an_unknown_record_type_is_rejected_before_any_write`.
29. A payload with one record at `version: 2` is refused whole. Test:
    `tests/test_transfer.py::test_a_record_at_any_version_but_one_is_rejected_whole`.
30. A payload with a `snapshot` whose `accountId` names no `account` in
    the payload is refused whole. Test:
    `tests/test_transfer.py::test_a_snapshot_naming_no_account_in_the_same_payload_is_rejected_whole`.
31. Every record reads `version: 1` after an import. Test:
    `tests/test_transfer.py::test_import_replaces_the_vault_entirely`,
    `tests/browser/parts/export-import.mjs`.
32. (blind) Pages A and B of one browser share a cookie and A restores. B
    never saves a holding, its create, update, delete and purge each
    answer Conflict `{"refused":"vault-replaced"}`, and A unlocked shows
    every restored record and none unreadable. Test:
    `tests/test_vault_epoch.py::test_a_page_holding_the_replaced_key_never_reaches_the_vault`,
    `tests/browser/parts/export-import.mjs`.
33. (blind) A second session of the importing user still exists after an
    import, never Unauthorized. Its create, update, delete and purge with
    the old epoch each answer Conflict `{"refused":"vault-replaced"}` and
    leave the imported set. Test:
    `tests/test_vault_epoch.py::test_a_second_session_with_the_old_epoch_writes_nothing`,
    `tests/test_transfer.py::test_import_revokes_no_session`.
34. (blind) The restoring page stays open holding the new epoch and
    `DEK_new`, and posts the old epoch on the vault channel once. Test:
    `tests/browser/parts/export-import.mjs`.
35. (blind) The import answers `vaultEpoch` as 32 lowercase hex
    characters, equal to the `vault_epochs` row afterwards and different
    from the one before. Test:
    `tests/test_vault_epoch.py::test_the_next_sign_in_after_an_import_carries_the_new_epoch`.
36. (blind) An import with a replaced epoch answers Conflict
    `{"refused":"vault-replaced"}` and leaves `records`, `dek_wrappers`
    and `vault_epochs` row for row. Test:
    `tests/test_vault_epoch.py::test_an_import_with_a_replaced_epoch_writes_nothing`.
37. (blind) Of two imports sent at once with one epoch, exactly one
    commits. A serial test cannot show it. Test:
    `tests/test_vault_epoch.py::test_of_two_imports_with_one_epoch_exactly_one_commits`.
38. (blind) An import refused for another reason, or failing
    mid-transaction, leaves the epoch as it was. Test:
    `tests/test_vault_epoch.py::test_an_import_refused_for_another_reason_leaves_the_epoch`,
    `tests/test_vault_epoch.py::test_a_fault_mid_import_leaves_the_epoch`.
39. (blind) An export with a replaced epoch answers Conflict
    `{"refused":"vault-replaced"}` and writes no `attempts` row, also when
    the import lands between the gate and the export's transaction. Test:
    `tests/test_vault_epoch.py::test_an_export_with_a_replaced_epoch_is_refused_and_writes_no_attempt`,
    `tests/test_vault_epoch.py::test_an_import_between_the_gate_and_the_export_leaves_no_attempt_row`.
40. (blind) An import landing mid-export cannot produce a file whose
    wrapper does not open its records. Test: no test.
41. (blind) The checked-in `formatVersion: 1` fixture, never regenerated,
    still imports after the format advances. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`.
42. The sensitivity warning is on screen before the download is triggered.
    Test: `tests/browser/parts/export-import.mjs`.
43. (blind) A top-level navigation to `GET /api/export` with a valid
    session cookie is Forbidden and writes no file. Test:
    `tests/test_guard.py::test_export_requires_the_header_despite_being_a_get`,
    `tests/browser/parts/export-import.mjs`.
44. (blind) Over the per-user limit, export answers Too Many Requests and
    writes no `attempts` row however often it is retried, so the limit
    lifts an hour after the oldest export let through. Test:
    `tests/test_transfer.py::test_a_refused_export_writes_no_row_and_the_limit_lifts_an_hour_after_the_oldest`.
45. At the export ceiling the button is disabled with the reason beside
    it. Test: `tests/browser/parts/export-import.mjs`.
46. An administrator session gets Not Found from export and import. Test:
    `tests/test_transfer.py::test_an_administrator_reaches_neither_export_nor_import`.
47. After a restore another tab of the browser closes the vault before
    sending a request, holds no key, and says typed input was lost. Test:
    `tests/browser/parts/export-import.mjs`.
48. A file already downloaded opens with its own password after a password
    change, and the change-password screen says so. Test:
    `tests/browser/parts/settings.mjs`.
49. (blind) An import whose `currentSalt` is not the credential's salt,
    after a password change or a stale-KDF upgrade on another page,
    answers Conflict `{"refused":"credential-changed"}` and leaves every
    table row for row as it was. Test:
    `tests/test_credential_changed.py::test_an_import_after_a_password_change_elsewhere_writes_nothing`,
    `tests/test_credential_changed.py::test_an_import_after_a_kdf_upgrade_elsewhere_writes_nothing`.
50. An import carrying both a replaced epoch and a superseded salt
    answers `vault-replaced`. Test:
    `tests/test_credential_changed.py::test_a_replaced_vault_is_named_before_a_changed_credential`.
51. The page that changed the password restores afterwards without
    unlocking again. Test:
    `tests/test_credential_changed.py::test_the_page_that_changed_the_password_still_restores`.
52. A restore refused for a credential changed elsewhere locks the page
    and says why, and unlocking returns to this screen. Test:
    `tests/browser/parts/export-import.mjs`.
53. (blind) An exported file shows nothing outside its envelope but
    `format`, `formatVersion`, the salt, the KDF envelope, the wrapper
    and the envelope's nonce: no record id, holding id, edit counter,
    record or timestamp. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`,
    `tests/browser/parts/export-import-review-sealed.mjs`.
54. A sealed file opens with its password to the records it sealed, and
    restores. Test: `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`,
    `tests/browser/parts/export-import-review-sealed.mjs`.
55. One byte altered in a sealed file's envelope refuses it as damaged
    once its password opens the wrapper, uploading nothing. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import.mjs`,
    `tests/browser/parts/export-import-review-sealed.mjs`.
56. A record at a newer `schemaVersion` is refused as a newer file, not
    a damaged one, before any request. Test:
    `tests/test_client.py::test_the_client_side_rules_hold`,
    `tests/browser/parts/export-import-review-damaged.mjs`.
57. A lock during the import starts it again at step 1, with no review,
    no typed `ERASE` and nothing re-encrypted kept. Test:
    `tests/browser/parts/export-import.mjs`,
    `tests/browser/parts/export-import-review-damaged.mjs`.
