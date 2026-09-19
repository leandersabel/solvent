# Register

## Purpose

Turn a valid invite link into a vault. Server-rendered (Jinja) at
`GET /register?invite=<token>`; the page embeds the server's current
default KDF envelope and the selectable currency list, so no extra
round-trip is needed and nothing here calls a session-authenticated API
(`register.md`).

Exercises: `spec/features/register.md`.

## Layout

Same centered card as Unlock, max-width 480px, slightly taller.

1. Heading: "Create your vault".
2. Username — 3–32 chars, `[a-z0-9._-]`, normalized to lowercase as the
   user types (show the normalization, don't silently apply it later).
3. Password + confirmation, with a **strength meter**.
4. Main currency — a searchable select over the currency list the page
   embeds (`register.md`), not all of ISO 4217.
5. The no-recovery acknowledgement (below).
6. Primary button: "Create vault".

## The strength meter

The bar is ≥12 characters and zxcvbn ≥3, enforced client-side because
the server never sees the password and cannot check it
(`register.md`, Rules).

- A four-segment bar, filling petrol-600. Not red-to-green — this is not
  a status signal, it is a magnitude one.
- Live label: the zxcvbn score word plus its own crack-time estimate.
- Below the bar, one line of guidance: "Length beats symbols. A
  four-word phrase you can remember is stronger than `P@ssw0rd!`."
- The submit button stays disabled until both conditions pass, with the
  unmet one named inline. Never a generic "password too weak".

## The acknowledgement

A checkbox, not a dismissible notice, and the form cannot submit without
it:

> I understand that if I lose this password, my data is permanently
> unreadable. Solvent has no way to reset it or recover my vault.

Rendered in a tinted petrol-50 callout with a critical-colored icon.
This is the single most consequential fact in the product and it gets
the visual weight to match.

## Main currency

A select, plus a 13px ink-secondary note directly beneath: **"This
cannot be changed later."** Users pick this in five seconds and live
with it for years — the warning belongs at the point of choice, not in
settings afterwards (`account-settings.md`, Main currency).

The list holds only currencies the rate provider can quote into
(`register.md`, Rules), so there is no "unsupported currency" state to
design here: every option works for every future lookup.

## States

- **Invalid invite**: the form never renders. A bare card: "This invite
  link is not valid." Identical copy for invalid, expired, already-used,
  and revoked (`register.md`) — the UI must not distinguish them.
- **Loading**: none; server-rendered.
- **Deriving**: same Worker progress treatment as Unlock, with copy
  "Setting up your vault…". Longer here — key derivation plus DEK
  generation plus the first encrypted record.
- **Error — username taken**: inline, plain: "That username is taken."
  Enumeration is accepted here (`register.md`, Edge cases); do not
  contort the message.
- **Error — cannot allocate memory for derivation**: same treatment as
  Unlock, including that it is a defensive state rather than an expected
  one (`ui/unlock.md`), but the copy must be clearer that no vault was
  created: "Solvent could not set up your vault. This device does not
  have enough memory available right now. Your invite is still valid.
  Close other tabs and try again." The invite is untouched, since
  nothing was submitted (`register.md`). Do not suggest another device.
- **Error — submit failed after derivation**: the form retains every
  field so nothing must be re-typed or re-derived.
- **Populated**: success lands the user authenticated on the dashboard,
  keys already in memory — never bounced back to a login screen.
