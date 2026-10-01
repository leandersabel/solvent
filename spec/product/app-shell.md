# App shell

## What it does

The app shell is the frame every signed-in screen sits in: the bar
across the top, the navigation, the controls at its right, and the
width the page content is held to. With a vault it is identical on
every screen, so you always know where you are and what you can reach
from there. The admin area sits in a stripped-down version of the same
frame.

It is also where the app's protections are applied once for the whole
product rather than screen by screen, so a new screen cannot be added
without them.

The shell itself never shows anything from the vault. The only words in
it are the app's name and the navigation labels. Figures, holding
names and notes exist only after the password has been entered, and
only inside the browser.

## Who it is for

The household members who use Solvent day to day, and the
administrators who provision the instance for them. There is no
visitor, no public page, no signed-out landing page. Everything the
shell frames sits behind the password.

## What "looks like a private bank" commits us to

You asked for something that looks like a private bank. In terms of
what you see, that is:

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
rather than borrowed from the light page below, so their text and focus
outline stay readable against it.

The password screen and the registration screen sit outside the shell.
They are a single centered card on the warm ground with nothing else on
the page: no bar, no navigation, no copy selling the product.

### Navigation

Two entries, the same two for everybody who has a vault, and never
more:

- **Dashboard**
- **Settings**

There is deliberately no **Holdings** entry. The dashboard's own table
is the list of holdings, so a third entry would either lead back to the
screen you are already on or open a thinner second copy of it.

There is no **Admin** entry either, and there is no navigation state in
which one appears. Administering the instance is done from a separate
account with no vault (`admin-invites.md`), so nobody signed in to a
vault has anywhere administrative to go.

### Update values

"Update values" is an action in the bar, not a destination in the
navigation. Pressing it opens the update sweep from wherever you are,
which is what keeps the sweep reachable while you are deep inside a
single holding. It goes straight into editing today and asks nothing.
The dashboard carries the front door instead, a New recording button
with a date picker, because that is where you arrive already meaning to
do it and where choosing the date is worth a click
(`record-snapshot.md`).

### Lock

One press of **Lock** immediately discards the keys and everything
decrypted from them, and shows the password screen. There is no "are
you sure". This is the control you reach for when somebody else walks
into the room, and a confirmation step spends the seconds the control
exists to save.

Locking is not signing out. The session stays alive, so coming back
needs the password only and the username is not asked for again.

A lock does not throw away text typed into an open form and not yet
saved, so locking in the middle of entering figures does not destroy
the work. Nothing else survives it (`login.md`).

Signing out fully, and signing out everywhere at once, live in Settings
rather than in the bar, so that two similar controls never sit side by
side. An administrator has no Lock, so Sign out is the only control in
their bar and there is nothing for it to be confused with.

### The administrator's frame

An administrator account has no vault, so almost nothing above applies
to it. The admin area sits in a plainer version of the same frame: the
same deep petrol blue bar, the same wordmark, the same restraint, and
at the right a single **Sign out**.

What is missing is missing because there is nothing for it to act on:

- **No Dashboard and no Settings**, because there are no figures and no
  vault whose behavior could be configured.
- **No Update values**, because there are no holdings to update.
- **No Lock**, because nothing has been decrypted. A lock exists to
  throw away figures on screen, and there are none. Signing out is the
  only way to leave.

The navigation inside the admin area is that area's own business
(`admin-invites.md`), not the product's main navigation. The two bars
are told apart by what they carry rather than by looking different. A
chrome of its own would make the admin area feel like a second product
bolted on, and the same restraint with fewer controls in it says more
plainly that there is simply less here.

### The page below the bar

Content sits centered on the warm ground and is held to a width that
stays readable on a wide monitor. Narrower content sets its own: forms
are narrow, the update sweep and a single holding's detail sit in
between.

A content region arrives empty and fills once the browser has decrypted
what belongs in it. That is why a screen shows its skeleton first, and
why a page refresh always costs a fresh decryption.

## On a phone

Every screen can be read and operated end to end on a phone, without
panning sideways. Not a reduced set of them, and not reading only:
entering figures works too, the monthly update sweep included.

Working on a phone does not mean one layout that stretches. A screen is
allowed two designs that do the same job in different shapes, and the
app chooses between them by the width of the screen it is on. The
update sweep is the example you gave: on a computer it is a wide
table with every holding in view, and on a phone it may instead be a
step at a time, one holding per step. Same act, same figures recorded
at the end, different screen. So a screen is described at each size
wherever the two differ, rather than described once and assumed to fit.

No action exists only inside a wide table, and no screen has a single
route to something a narrow screen could not offer.

## What must be true

**The chrome**

1. Every screen a vault owner sees when signed in shows the same top
   bar: the wordmark at the left, the navigation beside it, Update
   values and Lock at the right.
2. Everybody with a vault sees exactly two navigation entries,
   Dashboard and Settings. Nobody, ever, sees a Holdings entry or an
   Admin entry. An administrator sees the bar carrying the wordmark and
   Sign out, with no Dashboard, no Settings, no Update values and no
   Lock.
3. The password screen and the registration screen show no top bar and
   no navigation at all.
4. Every control in the top bar can be reached and operated with the
   keyboard alone, and shows a visible white outline while it has
   focus.
5. Update values opens the update sweep for today from any screen,
   with no screen in between, and it is the same sweep the dashboard's
   New recording button reaches once a date has been picked.
6. One press of Lock clears every figure from the screen and shows the
   password screen, with no confirmation step in between.
7. After locking, entering the password alone returns you to the app.
   The username is not asked for again.
8. Locking while a form holds unsaved typed input, then unlocking,
   returns that typed input. Nothing else comes back without being
   decrypted again.
9. Nothing in the bar or the navigation ever shows a holding's name, a
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
19. Every refusal looks the same whether the address exists or was
    invented. An expired sign-in is refused like an absent one.
20. A mistyped address and an unexpected failure are answered with the
    same protections as any working page.
21. The styling and scripts the app serves load for anyone, signed in
    or not, and contain nothing about any person.
22. Starting the app with its configuration incomplete fails
    immediately, and the failure names what is missing without printing
    its value. The app never fills in a missing value itself, which
    would either sign everyone out on every restart or leave sessions
    forgeable, and surface much later as something inexplicable. No
    secret appears in a log line or on an error page.

## What it deliberately does not do

- **No Holdings entry and no Admin entry in the navigation** (see
  Navigation).
- **No sign-out button in the top bar.** Locking is the frequent act
  and signing out is rare and deliberate. Two similar-looking buttons
  side by side in the bar would invite the wrong one. Signing out lives
  in Settings.
- **No dark theme.** You asked for a light ground. A dark theme
  is a second complete set of colors that has to be checked for
  readability from scratch rather than inverted, and the chart colors
  in particular are chosen against the warm ground and are not valid on
  a dark one.
- **No custom typeface.** The app uses the typeface your own device
  provides. A downloaded one would have to be hosted and
  version-pinned like every other asset, and it would flash unstyled
  text on the password screen, the slowest screen in the product.
  Elegance here comes from spacing and restraint instead.
- **The shell shows no financial data at all, and could not.** The
  server that renders it holds no readable copy of anything in the
  vault. This is not a rule the shell follows, it is a thing it is
  incapable of.
