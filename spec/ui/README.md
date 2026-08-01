# UI

One file per screen or major view. Each covers:

- Purpose of the screen
- Layout / key elements (rough sketch or bullet list is fine — no need
  for pixel-precise mockups)
- States: empty, loading, error, populated
- Which feature(s) in `spec/features/` this screen exercises

## Foundations

- `design-system.md` — palette, typography, spacing, components, motion,
  accessibility. Not a screen; every screen assumes it and states only
  what it adds. **Read this first** — it carries the validated chart
  palette and the rule that chrome colors and chart colors are separate.

## Screens

| Screen | Exercises |
|---|---|
| `unlock.md` | login, idle-lock half of account-settings |
| `register.md` | register |
| `dashboard.md` | net-worth-view |
| `account-form.md` | manage-accounts |
| `account-detail.md` | record-snapshot (edit/delete), manage-accounts (archive) |
| `snapshot-entry.md` | record-snapshot (one account), proposal half of rate-lookup |
| `update-values.md` | record-snapshot (the sweep), proposal half of rate-lookup |
| `dimensions.md` | account-settings (dimensions) |
| `settings.md` | account-settings |
| `export-import.md` | export-import |
| `admin.md` | admin-invites |

Every feature in `spec/features/` has a screen home, and no screen
exercises a feature that does not exist. The one exception is
`record-api.md` — the generic encrypted-record store every screen reads
and writes through. It is infrastructure and has no UI of its own.
