# Unlock

## Purpose

The single password screen, in two modes. It is the only place a
password is ever typed outside registration and the change-password
form, and the only place key derivation starts.

- **Full login** — no session. Needs username + password.
- **Re-unlock** — session still valid, in-memory keys discarded by the
  idle lock or a page refresh. Username is known; needs password only.

Exercises: `spec/features/login.md`, and the idle-lock half of
`spec/features/account-settings.md`.

## Layout

Centered card, max-width 420px, on the warm ground. Nothing else on the
page — no navigation, no marketing.

- Wordmark, petrol-800.
- Username field (full login only; re-unlock shows the username as
  static ink-secondary text with a "Not you? Log out" link).
- Password field, `type=password`, with a show/hide toggle.
- Primary button: "Unlock".
- Below the card, 13px ink-muted: "Solvent cannot recover a lost
  password."

No "remember me", no "forgot password" link. Neither exists, and a dead
link that implies recovery is worse than its absence.

## The derivation wait

Argon2id runs in a Web Worker and takes a fraction of a second on a
desktop browser and about two seconds on an iPhone (`architecture.md`,
Key management). This is the screen's defining interaction and must not
look like a hang.

- On submit the button becomes a determinate-looking progress state
  labelled "Deriving your key…" and the form disables.
- A 13px line beneath: "This takes a moment by design — it is what makes
  your password hard to attack."
- The tab must stay responsive throughout (Worker, never the UI thread).
- No spinner before derivation actually starts.

## States

- **Loading (initial)**: the card renders immediately; there is nothing
  to fetch. No skeleton.
- **Deriving**: as above. Cancellable by navigating away only.
- **Error — wrong credentials**: inline above the password field,
  critical text with icon: "Invalid username or password." Identical
  text and identical timing for an unknown username and a wrong
  password (`login.md`, decoy salt) — the UI must not distinguish them,
  including by how fast it fails.
- **Error — DEK unwrap failed**: same generic message to the user. The
  anomaly is logged server-side, not surfaced.
- **Error — rate-limited / locked out**: "Too many attempts. Try again
  in N minutes." Same shape whether or not the account exists.
- **Error — WASM unavailable**: hard failure, explanatory: "Your browser
  cannot run the encryption Solvent requires." No fallback is offered
  because none exists.
- **Error — cannot allocate memory for derivation**: a *separate* state
  from the one above. WASM runs, but the allocation is refused. Copy
  names the device, not the password: "This device does not have enough
  memory available right now. Close other tabs and try again." Offer a
  retry, since closing tabs can genuinely fix it.
  - **This is a defensive state, not an expected one.** The allocation
    succeeds on every current target, phones included
    (`architecture.md`, Key management), and a device that refuses it
    is momentarily memory-starved rather than unable to run Solvent. The
    state exists because the alternative is showing a user a raw
    allocation error, and the copy says "right now" for the same
    reason. Never suggest the vault cannot be opened on this class of
    device.
  - **No weaker fallback is offered here either.** Deriving at reduced
    memory would produce a different key and open nothing, so there is
    nothing to fall back *to*, and a fallback that re-derived the whole
    vault lower would weaken the one defense the threat model names
    against an offline attacker with a DB dump (`architecture.md`,
    Threat model).
- **Populated**: n/a — success navigates to the dashboard.

## Rules

- The password field is never auto-submitted, never logged, and cleared
  from the DOM on success.
- Autocomplete: `username` and `current-password`, so password managers
  work. This is a deliberate call — a manager-generated passphrase is
  the best realistic defense for a vault with no recovery.
- Re-unlock mode must preserve whatever the user was doing: after
  unlocking, return to the previous view with unsaved form input intact.
  That input is the **one named exception** to the idle lock discarding
  all decrypted state (`login.md`, Rules) — everything else on the
  previous view is re-decrypted, so the view repopulates rather than
  reappearing.
