# Error page

## Purpose

The page served wherever no screen can be: an address with no page
behind it, an address the visitor may not open, and an unexpected
failure. It says the page cannot be shown and offers the way back.

Exercises: `spec/features/app-shell.md`.

## Layout

The card outside the shell (`design-system.md`, App shell), max-width
420px, padded 32px as unlock's is.

- The wordmark "Solvent" above the card, as on unlock. It is text, not
  a link, so the card's button is the one way on.
- In the card, an `h1` in Section heading type carrying the sentence
  (Copy).
- Beneath it, **Go to Solvent**: a link to `/` styled as Button,
  primary, spanning the card's width at the foot, as **Unlock** does.

The wordmark and the card stack in the middle of the ground, centered
horizontally and vertically. The page title is "Solvent".

At phone width the card fills the width inside the 16px gutter and
pads 16px, the heading steps down with Section heading, and the button
is at least 44px tall (`design-system.md`, Spacing and shape,
Typography). Nothing else changes shape.

## Copy

| Variant | Heading |
|---|---|
| Missing, or refused | There is no page at this address. |
| Unexpected failure | Something went wrong and this page could not be shown. |

The button reads "Go to Solvent" in both.

## States

The page has the two variants above and no other state. It is rendered
whole by the server and loads the stylesheet and the app's icon only:
no script, so it has nothing to load, nothing to fetch and nothing to
fail on its own.

**The page is identical whoever opens it**: signed out, signed in to a
vault, or signed in as an administrator. Nothing on it depends on the
session, which is why it carries no top bar (`product/app-shell.md`, A
page that cannot be shown).

**A refused address shows the missing variant**, byte for byte the same
page, so nothing on it tells one from the other.

## What it deliberately does not show

- **No top bar and no navigation.** The bar depends on who is signed
  in, and this page does not.
- **No status code, and no technical name for the failure.** A number
  or a term like "Forbidden" means nothing to the person reading, and
  it would be the one thing telling a refused address from a missing
  one.
- **No cause, and no detail of the failure.** The person cannot act on
  it, and it would hand internals to whoever triggered it.
- **The address asked for is not repeated.** It is what the visitor
  typed or followed, and echoing it adds nothing and puts outside text
  on the page.
- **No sign-in link, no Back button, no Try again.** **Go to Solvent**
  already leads to sign-in for somebody signed out and to their own
  starting screen for somebody signed in, and the browser has Back.
