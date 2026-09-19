# App shell

## What it does

The app shell is the frame every signed-in screen sits in: the bar
across the top, the navigation, the two controls at its right, and the
width the page content is held to. It is identical on every screen, so
a person always knows where they are and what they can reach from
there.

It is also where the app's protections are applied once for the whole
product rather than screen by screen, so a new screen cannot be added
without them.

The shell itself never shows anything from the vault. The only words in
it are the app's name and the navigation labels. Figures, account names
and notes exist only after the password has been entered, and only
inside the browser.

## Who it is for

The household members who use Solvent day to day, the small invited
group the product as a whole is for. There is no visitor, no public
page, no signed-out landing page. Everything the shell frames sits
behind the password.

## What "looks like a private bank" commits us to

The client asked for something that looks like a private bank. In terms
of what a person actually sees, that is:

- **One structural color.** A deep petrol blue carries the chrome.
  Beyond it there are two accents, a warm brass for the primary action
  and a plum for secondary emphasis, both used sparingly. A screen that
  needs a third accent color is over-designed and something gets cut.
- **A warm off-white page, never pure white.** Pure white flattens the
  look. The warm ground against the cool blue is the pairing that
  carries it.
- **Hairline rules instead of boxes and shadows.** One thin line
  separates things. A soft shadow is permitted on a dialog and nowhere
  else. Nothing is fully round except an avatar and a status dot.
- **The money is the only loud thing on screen.** The net worth figure
  is the largest thing anywhere. Nothing in the chrome competes with
  it.
- **Figures line up.** Money columns and table rows use digits of equal
  width and are right-aligned, so amounts stack into a readable column
  instead of a ragged one.
- **No marketing language anywhere.** No tagline, no slogan, no welcome
  tour, no promotional copy, no explanation of why the product is good.
  Labels name the thing and stop.
- **Nothing moves for effect.** No entrance animations, no sliding
  panels, no net worth figure counting up from zero, which would read
  as a slot machine. The only motion is a brief hover or focus change,
  and that is switched off for anyone whose device asks for reduced
  motion.
- **A page that is still loading shows the shape of what is coming, not
  a spinner.** A spinner appears only for an action already underway
  that is taking longer than a moment.
- **Color never carries meaning by itself.** Whatever a color says, a
  word or an icon beside it says too.

## The chrome

### The top bar

Deep petrol blue, full width, on every signed-in screen. Left to right:
the wordmark "Solvent", the navigation beside it, and at the right the
**Update values** action and the **Lock** button.

Those two buttons are outlined in white and styled for the dark bar
rather than borrowed from the light page below, so their text and their
focus outline stay readable against it.

The password screen and the registration screen sit outside the shell.
They are a single centered card on the warm ground with nothing else on
the page: no bar, no navigation, no copy selling the product.

### Navigation

Three entries at most, and never more:

- **Dashboard**
- **Settings**
- **Admin**, for an administrator only. Everyone else sees two entries.

There is deliberately no **Accounts** entry. The dashboard's own table
is the list of accounts, so a fourth entry would either lead back to
the screen the person is already on or open a thinner second copy of
it.

### Update values

"Update values" is an action in the bar, not a destination in the
navigation. Pressing it opens the update sweep from wherever the person
currently is, which is what keeps the sweep reachable while someone is
deep inside a single account. The dashboard repeats the same action
next to the net worth figure, because that is where a person arrives
already meaning to do it.

### Lock

One press of **Lock** immediately discards the keys and everything
decrypted from them, and shows the password screen. There is no "are
you sure". This is the control someone reaches for when another person
walks into the room, and a confirmation step spends the seconds the
control exists to save.

Locking is not signing out. The session stays alive, so coming back
needs the password only and the username is not asked for again.

The one thing a lock does not throw away is text the person has typed
into an open form and not yet saved, so locking in the middle of
entering figures does not destroy the work. Nothing else survives it.

Signing out fully, and signing out everywhere at once, live in Settings
rather than in the bar.

### The page below the bar

Content sits centered on the warm ground and is held to a width that
stays readable on a wide monitor. Narrower content sets its own: forms
are narrow, the update sweep and a single account's detail sit in
between.

A content region arrives empty and fills once the browser has decrypted
what belongs in it. That is why a screen shows its skeleton first, and
why a page refresh always costs a fresh decryption.

## What must be true

Every line here is checkable by a person sitting in front of the
running app, with no access to the code.

**The chrome**

1. Every signed-in screen shows the same top bar: the wordmark at the
   left, the navigation beside it, Update values and Lock at the right.
2. Someone who is not an administrator sees exactly two navigation
   entries, Dashboard and Settings. An administrator sees those two and
   Admin. Neither sees an Accounts entry.
3. The password screen and the registration screen show no top bar and
   no navigation at all.
4. Every control in the top bar can be reached and operated with the
   keyboard alone, and shows a visible white outline while it has
   focus.
5. Update values opens the update sweep from any screen, and it is the
   same sweep the dashboard opens.
6. One press of Lock clears every figure from the screen and shows the
   password screen, with no confirmation step in between.
7. After locking, entering the password alone returns the person to the
   app. The username is not asked for again.
8. Locking while a form holds unsaved typed input, then unlocking,
   returns that typed input. Nothing else comes back without being
   decrypted again.
9. Nothing in the bar or the navigation ever shows an account name, a
   figure, or a note.

**The look**

10. Every screen uses the warm off-white ground, never pure white, and
    the bar is the one deep petrol blue.
11. No screen carries a tagline, a slogan, a welcome tour, promotional
    copy, or any sentence explaining how good the product is.
12. No number animates. Nothing slides or fades in on arrival. With the
    device set to reduced motion, the remaining hover and focus
    transitions stop too.
13. Money columns are right-aligned with digits of equal width, so
    figures in a column line up exactly.
14. Anywhere a color carries meaning, a word or an icon beside it
    carries the same meaning.

**The protections**

15. The app refuses to be embedded in another website. A page elsewhere
    that tries to frame Solvent gets nothing.
16. Once a browser has visited the app, it refuses to load it over an
    insecure connection even if the insecure address is typed by hand.
17. Opening any screen produces no browser complaint about blocked or
    rejected content.
18. Another website cannot make the app do anything with a signed-in
    person's session. A request that did not originate in the app is
    refused and changes nothing.
19. Someone probing addresses gets an identical refusal whether the
    address exists or was invented, and whether their session is valid,
    expired, or absent. The answer never reveals which.
20. A mistyped address and an unexpected failure are answered with the
    same protections as any working page.
21. The styling and scripts the app serves load for anyone, signed in
    or not, and contain nothing about any person.
22. Starting the app with its configuration incomplete fails
    immediately, and the failure names what is missing without printing
    its value. No secret appears in a log line or on an error page.

## What it deliberately does not do

- **No Accounts entry in the navigation.** The dashboard table is the
  account list, so the entry would lead back to the current screen or
  duplicate it.
- **No sign-out button in the top bar.** Locking is the frequent act
  and signing out is rare and deliberate. Two similar-looking buttons
  side by side in the bar would invite the wrong one. Signing out lives
  in Settings.
- **No confirmation step on Lock.** The control exists to be fast under
  pressure.
- **No dark theme.** The client asked for a light ground. A dark theme
  is a second complete set of colors that has to be checked for
  readability from scratch rather than inverted, and the chart colors
  in particular are chosen against the warm ground and are not valid on
  a dark one.
- **No custom typeface.** The app uses the typeface the person's own
  device provides. A downloaded typeface would have to be hosted and
  version-pinned like every other asset, and it would flash unstyled
  text on the password screen, which is the slowest screen in the
  product. Elegance here comes from spacing and restraint instead. See
  the open question below.
- **The shell shows no financial data at all, and could not.** The
  server that renders it holds no readable copy of anything in the
  vault. This is not a rule the shell follows, it is a thing it is
  incapable of.

## Decisions taken on the client's behalf

The client never spoke to these. Each was taken so the work could
proceed, and each is reversible on request.

- **The navigation is Dashboard, Settings and Admin, with no Accounts
  entry.** Reversing it means designing a separate accounts screen that
  does not simply repeat the dashboard table.
- **Update values is an action in the bar rather than a fourth
  navigation entry.**
- **Lock has no confirmation step.**
- **Signing out lives in Settings rather than the bar.**
- **The app refuses to start when its configuration is incomplete,
  rather than filling in a missing value itself.** Starting anyway
  would either sign everyone out on every restart or leave sessions
  forgeable, and either way the problem would surface much later as
  something inexplicable.
