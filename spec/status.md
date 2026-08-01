# Status

Maintained by the product-owner agent. Tracks each feature's progress
through the pipeline: spec written → compiled → implemented → verified.

| Feature | Spec | Compiled | Implemented | Verified |
|---|---|---|---|---|
| register | written 2026-08-01 | | | |
| login | amended 2026-08-01 | | | |
| account-settings | amended 2026-08-01 | | | |
| manage-accounts | amended 2026-08-01 | | | |
| record-snapshot | amended 2026-08-01 | | | |
| rate-lookup | written 2026-08-01 (provider open) | | | |
| net-worth-view | amended 2026-08-01 | | | |
| export-import | written 2026-08-01 | | | |
| admin-invites | written 2026-08-01 | | | |

The seven decisions flagged as unconfirmed in `spec/questions.md` were
reviewed and confirmed on 2026-08-01; four carried amendments, marked
above. See that file for what changed and why.

UI screens (`spec/ui/*.md`) are not yet written — no screen spec exists.
Compilation should not start until they do, or the compiled contracts
will carry no `sourceFiles` entry for the UI half of each feature.
