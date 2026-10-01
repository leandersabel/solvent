# Register

## Purpose

Turn an invite link into the account it was made for. Server-rendered
(Jinja) at `GET /register?invite=<token>`, so nothing here calls an API
that needs a session: the page embeds the server's current default KDF
envelope, and, for a user invite, the currency list the main-currency
picker offers (`register.md`).

**The invite decides which of two forms renders.**

Exercises: `spec/features/register.md`.

## Layout

The card outside the shell (`design-system.md`, App shell), max-width
480px. The person arrived from a link and is here to do one thing.

### Create your vault

The form a user invite renders.

1. Heading: "Create your vault".
2. **Username**, with its message line (The username field).
3. **Password**, and **Confirm password**, with the strength gauge.
4. **Main currency**.
5. The no-recovery acknowledgement.
6. Primary button: **Create vault**.

### Create an administrator account

The form an administrator invite renders, and a shorter one.

1. Heading: "Create an administrator account".
2. One line beneath it, saying what the account is:

   > This link creates an administrator account. It invites and removes
   > people on this instance. It holds no financial data of its own and
   > cannot read anybody else's. If you also want to keep your own
   > finances in Solvent, that is a separate account and you need a
   > separate invite for it.

3. **Username**, the same field and message line.
4. **Password**, and **Confirm password**, with the same strength gauge
   held to the same bar. This password protects the power to remove
   every account on the instance, so it is not the place to relax it.
5. Primary button: **Create account**.

Absent here, each because there is no vault:

- **No main currency.** Nothing in this account is ever counted in one.
- **No no-recovery acknowledgement.** That sentence is not true of this
  account. There is nothing that becomes permanently unreadable,
  because there is nothing encrypted to begin with. Nothing takes its
  place, and the form makes no claim about recovery in either
  direction.
- **No vault being built.** The account is made and that is the whole
  of it (Setting up, below).

## The username field

Both forms use it, unchanged. An Input with its message line
(`design-system.md`, Components).

- The rule is the one in `spec/features/register.md`, Rules: after
  trimming, 3 to 32 characters of `[a-z0-9._-]`. The field lowercases
  as it is typed rather than quietly changing the value on submit, so
  what the person sees is what they will sign in with.
- `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"`,
  so a phone keyboard neither capitalizes nor "corrects" the name.
- **No `maxlength`.** A value past 32 characters stays in the field and
  is reported, because a name cut short silently is a name the person
  never chose.

The message line, as a hint, before anything is typed and whenever the
value fits:

> Use 3 to 32 characters: letters a to z, digits, dot, underscore or
> hyphen.

It turns into an error on the trimmed value:

| When | Copy |
|---|---|
| A character outside the set, the moment it is typed | "Only letters a to z, digits, dot, underscore and hyphen are allowed." |
| More than 32 characters, the moment the 33rd is typed | "That is more than 32 characters." |
| 1 or 2 characters, when the field loses focus | "Use at least 3 characters." |

- A character outside the set is named before the length, because
  removing it may fix the length too.
- An empty field keeps the hint on blur. Passing through a field is not
  a mistake, and the disabled button already holds the form.
- The error clears the moment the value fits, while typing, without
  waiting for blur.
- **The primary button stays disabled until the username fits**, as it
  does for the password (The strength gauge). Enter in any field sends
  nothing and derives nothing while it is disabled.

## The strength gauge

The bar is at least 12 characters and a strength rating that common
passwords and obvious patterns do not reach however long they are.
Both are enforced in the browser, because the server never sees the
password and cannot check it (`register.md`, Rules). Both forms use it,
unchanged.

- A four-segment bar filling in petrol-600. It reads as a magnitude,
  not a verdict: it fills, it does not run red to green. A password
  that is not there yet is a distance left to cover, not a mistake the
  person has made.
- A live label beside it: the rating word and roughly how long the
  password would hold up.
- One line of guidance under it, the one place in the product where
  advice changes the outcome: "Length beats symbols. A four-word phrase
  you can remember is stronger than `P@ssw0rd!`."
- The button stays disabled until both conditions pass, and whichever
  one is unmet is named inline. Never a bare "password too weak".

## The acknowledgement

On the vault form only. A checkbox, not a dismissible notice, and the
form will not submit without it:

> I understand that if I lose this password, my data is permanently
> unreadable. Solvent has no way to reset it or recover my vault.

Rendered in a tinted petrol-50 callout with a critical-colored icon. It
carries the visual weight of the most consequential sentence in the
product, because it is.

## Main currency

On the vault form only. A searchable select, with a 13px ink-secondary
line directly beneath it: **"This cannot be changed later."** People
choose this in five seconds and live with it for years, so the warning
belongs at the point of choice and not in settings afterwards
(`ui/settings.md`).

The list holds only currencies the rate provider can quote into
(`register.md`, Rules), so there is no "unsupported currency" state to
design: every option works for every conversion the vault will ever
make.

## Setting up

Turning a password into a key is deliberately slow, and it is slow on
both forms, because both accounts hold a password. The wait is the one
in `ui/unlock.md`, The derivation wait.

- On submit the button becomes a working state and the form goes quiet.
  On the vault form it reads "Setting up your vault". On the
  administrator form it reads "Creating your account", because no vault
  is being built and the copy must not say one is.
- A 13px line beneath, on both: "This takes a moment by design. It is
  what makes your password hard to attack."
- The vault form is the longer of the two: the key, then the vault's own
  key, then the first encrypted record. The administrator form stops
  after the key.
- The tab stays responsive throughout, and on a phone it stays
  responsive to touch. It must never look like it has hung.
- No spinner before the work starts.

## States

Both forms unless a state says otherwise.

- **The link is no good**: no form renders at all. A bare card: "This
  invite link is not valid." Identical wording for a link that is
  wrong, already used, out of time, or called back (`register.md`), and
  identical whichever kind of account it would have made. The UI must
  not distinguish them, by wording, by layout, or by which form it
  would have shown.
- **The invite is refused at submit**: the link went bad while the form
  was open. The form gives way, with no page load, to the same bare
  card and the same words: "This invite link is not valid." Nothing on
  the form could make it usable, so no field is kept.
- **Loading**: none. The page is server-rendered and fetches nothing.
- **Working**: as above, Setting up.
- **Error, the username field's rule**: on its message line (The
  username field), before anything is derived.
- **Error, that username is taken**: on the username's message line,
  plain: "That username is taken." A username is taken once across the
  whole instance, whichever kind of account holds it, so somebody who
  holds both picks a second name for the second one. Enumeration is
  accepted here (`register.md`, Edge cases), so do not contort the
  message. Editing the username returns the line to the hint.
- **Error, the server refuses the username**: the browser's check
  passed and the server's did not. On the username's message line:
  "This username was not accepted. Use 3 to 32 characters: letters a to
  z, digits, dot, underscore or hyphen." Editing the username returns
  the line to the hint.
- **Error, the passwords do not match**: on the confirmation field's
  message line, before anything is derived.
- **Error, this browser cannot run the encryption**: a hard stop with a
  plain explanation and no form. No fallback is offered, because none
  exists.
- **Error, not enough memory right now**: a separate state from the one
  above. The browser can run the encryption, and the allocation was
  refused anyway. The copy names the moment:
  - On the vault form: "This device does not have enough memory
    available right now. No vault was created and your invite link is
    still good. Close some other tabs and try again."
  - On the administrator form: "This device does not have enough memory
    available right now. No account was created and your invite link is
    still good. Close some other tabs and try again."
  - A **Try again** button, because closing tabs can fix it.
  - A moment, not a device class, and the copy never names a device
    (`ui/unlock.md`).
  - No weaker setup is offered. Falling back would create an account
    permanently easier to break into, and record that weakness as
    though it had been chosen, because of one busy moment.
- **Error, the registration is refused**: any refusal not named above
  (`spec/features/register.md`, In the browser). Above the primary
  button, every field still filled:
  - On the vault form: "Solvent did not accept this registration. No
    vault was created and your invite link is still unused. If this
    happens again, ask whoever sent you the invite."
  - On the administrator form: "Solvent did not accept this
    registration. No account was created and your invite link is still
    unused. If this happens again, ask whoever sent you the invite."
- **Error, the submit did not go through**: no response, or a server
  error from Solvent or a proxy in front of it. The only state worded
  as a failure to get through. Above the primary button, every field
  still filled, including the password. Nobody re-types a password and
  waits again because of a network blip.

  > That did not go through. Everything you typed is still here, so you
  > can try again.

  The copy makes no claim about the invite, because with no response
  the browser cannot know whether the registration landed.
- A form-level error clears when the button is pressed again, and only
  one shows at a time.
- **Error, the new vault could not be read**, on the vault form only:
  the account exists and the keys are held, and only the first read of
  the vault failed (`spec/features/register.md`, Edge cases, "The first
  read of the new vault fails"). The form gives way to a card of the
  same width, announced as an alert:
  - Heading, at section-heading size: "Your vault is created".
  - Beneath it, in label/meta type: "It could not be read just now.
    Nothing was lost, and you do not need to type your password again."
  - A primary **Try again** button. Pressing it disables it and reads
    again in place, with no page load and no password field. Success
    lands as Populated does, and another failure draws this card again.
  - A lock before the read finishes wins: the unlock card
    (`ui/unlock.md`) stands, and the read finishing behind it opens
    nothing.
- **Populated**: success signs the person in and takes them where the
  account belongs. A vault owner lands on the dashboard with their keys
  already in memory. An administrator lands in the admin area
  (`ui/admin.md`). Neither is ever bounced to the sign-in screen to
  type the password they just chose.

## Rules

- The page drops the invite token out of the address bar as soon as the
  form holds it, so a bookmark, a shared screen, or a synced browser
  history afterwards carries nothing (`admin-invites.md`, Rules).
- Autocomplete: `username` and `new-password`.

## What it deliberately does not show

- **No way to choose the kind of account.** The link decides. Neither
  form carries a control, a toggle, or a hint that the other exists.
- **No email address, no phone number, no verification step.** Solvent
  never sends anything, so an address would exist only to send a
  recovery mail that cannot exist.
- **No password recovery, reset, recovery code, or security question**,
  and no link that implies one is coming later.
- **No composition rules**, no required symbol, digit, or mixed case.
  They push people toward short passwords with punctuation, which is
  the wrong direction here.
- **No sign-in link.** Somebody on this page holds an invite and does
  not have an account yet.
