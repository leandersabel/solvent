# Design system

Shared visual foundations and shared behavior. Every screen spec in
this directory assumes this file and states only what it adds. It is
not a screen, and nothing compiles against it alone.

**The screen files and this file state how every screen looks.**
Sizes, spacing and component styling are this file's tokens and
components. It also holds why each token is what it is, the contrast
floors, and the rules for what each component means. A screen's Layout
section states its arrangement: the order of its regions, what sits
beside what, and the widths that matter. What changes shape at phone
width is stated beside it, under At phone width.

## The look

Clean and elegant, in the register of a private bank: light ground, deep
petrol blue as the structural color, generous whitespace, hairline rules
instead of heavy borders and drop shadows. Restraint is the aesthetic —
the money is the only thing on screen allowed to be loud.

Two accents, used sparingly and for different jobs:

- **Brass** — the prestige accent. Primary actions, active navigation,
  the emphasis on a key figure. Warm against the cool petrol.
- **Plum** — the secondary accent. Non-primary highlights, chart series
  3. Never on a button that competes with brass.

If a screen needs a third accent, it is over-designed. Cut something.

## Two palettes, not one

The rule easiest to get wrong: **chrome colors and chart colors are
different jobs and do not share values.**

- **Chrome** (nav, text, buttons, rules) is muted — low chroma. That is
  what makes it read as expensive rather than as a toy.
- **Chart series** must clear a **chroma floor of OKLCH C ≥ 0.10**.
  Below it a hue reads as gray and stops carrying identity, so the same
  elegant muted petrol that is right for a header is *wrong* for a chart
  line — measured, not argued: the muted petrol sits at C 0.05.

Both palettes are drawn from the same three hue families (petrol 216°,
brass 82°, plum 356°), so they read as one system despite differing in
saturation.

## Ground and surfaces

| Role | Hex | Notes |
|---|---|---|
| Ground (page) | `#faf9f7` | Warm off-white, never pure white |
| Surface (cards, panels) | `#ffffff` | Sits on ground, separated by a hairline |
| Surface tinted | `#eff7f9` | petrol-50; callouts, selected rows |

The warm ground against cool petrol is the pairing that carries the
whole look. Pure `#ffffff` as the page ground flattens it.

## Petrol ramp (chrome)

| Step | Hex | Contrast on ground | Typical use |
|---|---|---|---|
| 50 | `#eff7f9` | 1.03 | tinted surface |
| 100 | `#e0eef2` | 1.13 | hover wash |
| 200 | `#c4dde3` | 1.35 | disabled fill |
| 300 | `#9dc2cc` | 1.81 | dividers on tinted |
| 400 | `#71a1ae` | 2.69 | icons, decorative |
| 500 | `#477e8c` | 4.31 | secondary text on ground |
| 600 | `#2c6471` | 6.30 | links, focus ring |
| 700 | `#184d59` | 8.89 | button fill |
| **800** | **`#0c3943`** | **11.87** | **primary brand — nav, headers** |
| 900 | `#06272f` | 14.91 | deepest, footer/rail |

petrol-800 is *the* petrol blue. Use 900 only where 800 needs something
to sit against.

## Accents

| Role | Hex | Contrast on ground | Use |
|---|---|---|---|
| brass-500 | `#a08147` | 3.49 | large fills, borders, non-text |
| **brass-600** | **`#876b36`** | **4.77** | **accent text, primary CTA** |
| brass-700 | `#6c5426` | 6.80 | pressed state |
| plum-600 | `#7f415a` | 7.11 | secondary accent text |
| plum-700 | `#693449` | 9.12 | pressed state |

brass-500 is below 4.5:1 — it is **not** a text color. Use brass-600 for
any brass text.

## Ink and line

| Role | Hex | Contrast | Use |
|---|---|---|---|
| ink-primary | `#111d20` | 16.35 | body, figures |
| ink-secondary | `#4d575a` | 7.06 | labels, supporting copy |
| ink-muted | `#798285` | 3.73 | axis ticks, timestamps — **never body text** |
| rule | `#c4cccf` | 1.55 | table dividers, axis baseline |
| hairline | `#d8dfe1` | 1.28 | card borders, gridlines |

ink-muted is below 4.5:1 and is restricted to non-essential metadata
that is also available another way.

## Chart palette (validated)

Categorical slots, **assigned in fixed order, never cycled**:

| Slot | Hue | Hex | Contrast |
|---|---|---|---|
| 1 | petrol | `#0098b7` | 3.23 |
| 2 | brass | `#ad7d00` | 3.50 |
| 3 | plum | `#964265` | 6.11 |
| 4 | indigo | `#7f79d1` | 3.59 |

Validated against the `#faf9f7` ground with the Machado–Oliveira–
Fernandes (2009) severity-1.0 CVD model, OKLab ΔE ×100:

- **Adjacent pairlist** (stacked areas, bars, lines): worst CVD ΔE
  **16.6**, worst normal-vision ΔE **18.9**. Both clear their gates,
  ≥8 and ≥15.
- **All-pairs** (scatter, small multiples — any two marks can touch):
  **the cap is the first three slots**, worst CVD ΔE **14.1**, normal
  **20.7**. Slot 4 must not appear in an all-pairs form: indigo and
  petrol collapse to ΔE 5.0 under deuteranopia when they can sit
  adjacent.
- All four clear 3:1 on the ground, so **no relief channel is required**
  — but direct labels are still specified per chart below.

**Past four series, fold the remainder into "Other."** A fifth dimension
value never gets a generated hue. Re-validate with the skill's
`validate_palette.js` if any hex changes.

### Colors by chart job

- **Nominal bars** (the dashboard's breakdown by dimension): every bar
  takes **slot 1**, and bar length carries the value. Coloring nominal
  bars by value spends the identity channel re-encoding what length
  already shows. Identity comes from the direct label on each bar.
  - **Signed bars**: bars grow rightward from a zero baseline, and a
    negative band grows **leftward** from that same baseline — slot 1
    again, at 45% opacity, matching the stacked chart's liability
    treatment so the sign reads identically in both places. The
    baseline is drawn in ink-muted, as the chart's zero line is. The direct label stays on the outboard end of the
    bar, carrying the signed amount.
  - The bars and the stacked chart show the same dimension, so a reader
    could expect the band colors to carry over. They deliberately do
    not: the stack needs hue to separate four adjacent fills, while a
    bar list separates by position and label already. Reusing the band
    colors here would spend four slots to repeat what the chart above
    just said.
- **Sequential** (magnitude, if ever needed): the petrol chart hue as a
  one-hue ramp, light→dark.
- **Diverging** (gains vs losses): status good ↔ status critical with a
  neutral gray midpoint (`#f0efec`). Net-worth change genuinely *means*
  good/bad, so it wears status tokens rather than categorical ones —
  never both in one chart.

### Stacked areas

The trend chart (`dashboard.md`) stacks one band per dimension value.
The adjacent-pairlist validation above is exactly this case, so the four
slots apply unchanged, in the dimension's configured order — **never
reordered by size**, which would make the stack unreadable over time.

- **Asset bands** fill at 85% opacity; **liability bands** mirror below
  the zero line in **the same group color** at 45%. Same hue means same
  group; the side of the axis carries the sign. The zero line is drawn in
  ink-muted, over the bands.
- The **net-worth line** runs over the stack in ink-primary at 1.75px, ending in a dot at
  the latest point.
  It is a summary of the bands, not a fifth series, so it takes no chart
  slot.
- **Estimated stretches** take the estimated marker below — never a
  change to the fills.

### Axes

- **Each value tick reads the value of its own gridline, and no two
  ticks read the same.** The step is one the tick's short form
  (Typography, Figures) names exactly at every line, so a tick never
  rounds to a neighbour's label or away from its own line. The step
  rule is `net-worth-view.md`'s.
- **A mark at either edge of the plot is drawn whole at every width**:
  the net-worth line's dot, an entry mark, an archive marker. The plot
  keeps half the widest mark clear inside its left and right edges, so
  nothing on the first or last day is cut by the plot or the card.

### The two neutral bands

"Unassigned" and "Other" (`net-worth-view.md`) are not categories the
user chose, and they must not consume a chart slot or read as one. Both
are neutral, and they must not collide with each other:

| Band | Fill | Meaning |
|---|---|---|
| Unassigned | rule gray `#c4cccf` | no value for this dimension — normal |
| Other | ink-muted `#798285` | the fifth-and-beyond value, folded |

Both always carry a direct label. A chart showing both at once is
legible, and is also telling the user their dimension neither covers its
holdings nor fits in four values.

There is no third band for a holding with two values of one
dimension: `dims` is a map keyed by dimension id
(`manage-accounts.md`), so that state cannot be written by the form, an
import, or a hand-edited export. No hatch or pattern fill is defined
anywhere in this system — a pattern reserved for an unreachable state
gets reused for the wrong thing later.

### The estimated marker

Inferred figures — every stretch between two snapshots, and everything
after a holding's last one (`net-worth-view.md`) — are marked on the
trend chart (`dashboard.md`): tick marks under the x-axis, ink-muted,
at the dates a real quantity was recorded. Never in a status color:
data that is inferred is not a warning, the same reason figure age is
stated in words rather than flagged.

The mark is under the axis rather than in the fill because four dashed
stacked bands are unreadable, and the distinction has to survive at the
density of a decade of history.

**A row carries no mark.** On the sweep every row not yet recorded for
the date is carried forward, so a mark there would sit on nearly every
row and say nothing its age in words does not (`update-values.md`).

**The chart's ticks are on when the chart loads**, and the control that
takes them away is **Just the line** (`dashboard.md`). The accurate
drawing is the one nobody has to ask for, and the tick earns its place
twice over: it says which part of the line the reader gave the app, and
it is the click target that opens that date's recording
(`recording-detail.md`).

The ticks ship **with wording, never as the mark alone**: beside them
the name of the control that removes them, which says what they are by
saying what is left without them (Accessibility).

## Status

Reserved meaning. Never reused as a series color, and **always shipped
with an icon and a text label** — never color alone.

| Role | Hex | Contrast | Use in Solvent |
|---|---|---|---|
| good | `#1d7635` | 5.40 | gains, positive delta |
| warning | `#c2603d` | 3.96 | **reserved, no consumer** — non-text, see below |
| critical | `#ac312c` | 6.18 | losses, decryption failure, destructive confirm |

`warning` has no consumer in v1. The token exists so the status triad is
complete, but **nothing should reach for it without first checking that
the thing it marks is really a warning.** Four states in this product
get mistaken for one, and none of them is:

- **Data that is merely old.** Figure age is stated in words, not
  flagged (`net-worth-view.md`).
- **A holding left alone on a sweep.** Leaving a row alone is a
  first-class answer and a partial update is the ordinary case, so
  nothing counts, flags or scores what was left (`update-values.md`).
- **A recording holding no figures.** Its prices are why the date is
  still there, which makes it an ordinary state rather than wreckage
  (`recording-detail.md`).
- **A price the source did not answer for, or a unit nobody has priced
  yet.** The line says so in ink-secondary prose and nothing is
  blocked (`update-values.md`). Marking an outage the product expects,
  and degrades cleanly through, trains the reader to ignore the mark
  before the day it means something.

A write that actually failed is a failure and takes `critical`, not
`warning`: a save that landed in part names what did not land
(`update-values.md`), and a fault the client will not resolve on its
own, such as two entries on one date, is flagged critical wherever it
appears.

`good` and `critical` clear 4.5:1 and may carry text. **`warning` may
not**: at 3.96 it is an icon, border, and fill color only, and the label
beside it sits in ink-primary. Same rule as brass-500 and ink-muted, and
the icon carries the status either way — identity is never color-alone.

There is deliberately **no darker warning step** for text, unlike
brass-600. Darkening it to clear 4.5:1 requires roughly `#b35733`, which
sits ΔE 7.8 from `critical` — under the ~9.5 separation this palette
holds elsewhere, so a warning chip would start reading as an error.
Warning and critical are neighbouring hues and converge as they darken;
the honest resolution is that warning does not get to be text, not that
it gets a step which quietly fails a different test.

`warning` sits ΔE 9.4 from brass-500 — deliberately, so a warning chip
never reads as the brand accent. `critical` sits ΔE 9.6 from chart slot
3 (plum); where a loss figure and a plum series share a chart, the
icon+label pairing carries the distinction, not hue.

## Typography

**The device's own typeface, everywhere:** `system-ui, -apple-system,
"Segoe UI", sans-serif`. No webfont, no display face, no serif, and the
wordmark is set in the same stack as the body. The client settled this
(`product/app-shell.md`), so there is no wordmark exception to reach
for.

The architecture holds the same line from the other side.
`spec/architecture.md` (Supply chain) requires every asset be
self-hosted and hash-pinned and forbids third-party CDNs, and the frontend has
no build step, so a webfont would add bytes, a pinning obligation, and
a flash of unstyled text on the slowest screen in the product. Elegance
here comes from spacing and restraint.

| Role | Size / weight | Notes |
|---|---|---|
| Hero figure (net worth) | 52px, 600 | proportional figures, the currency code beside it at 22px/500 ink-secondary |
| Screen heading | 32px, 600 | |
| Section heading | 20px, 600 | |
| Body | 15px, 400 | |
| Label / meta | 13px, 500 | ink-secondary |
| Section label | 12px, 600, uppercase, 0.08em tracking | ink-secondary, over a figure or a group |
| Axis tick | 12px, 400 | ink-muted |

At phone width four roles step down: the hero figure to 40px with its
currency code at 18px, the screen heading to 26px, the section heading
to 17px, and the section label to 11px. Every other role keeps its
size.

**`font-variant-numeric: tabular-nums` on every figure column, table
row, and axis tick** — anything that must align vertically. The hero
figure keeps proportional figures.

**A figure column is right-aligned, money and quantity alike.** Figures
with different decimals line up at their right edge, never at the
decimal point, because the requirements ask for right-aligned columns.

### Figures

Every figure is grouped and pointed as Settings sets it
(`settings.md`, Dates and numbers).

- **Money** shows the places Decimals on money sets.
- **A quantity in a unit that is not a currency shows exactly the
  decimals it was entered with**, as text and in a field alike. 12.125,
  12.5, 12.50 and 80 read as typed, never rounded and never padded.
  Decimals on money does not reach it, because rounding 12.5 ounces of
  gold to 13 loses part of the holding, and padding it to 12.50 claims
  a precision nobody recorded.
- **A chart's value tick is the one figure that abbreviates.** From a
  thousand up it reads in short form, "2.5k", pointed as Settings sets
  it, so a reader with a decimal comma sees "2,5k". Below a thousand it
  reads whole. The exact format is `net-worth-view.md`'s. Every other
  figure, the chart's tooltip and legend included, shows in full,
  because a tick only has to place a line and the readout is where a
  value is read.

## Spacing and shape

- 8px base scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Content max-width 1200px, centered; forms max-width 480px.
- Page gutter 40px. At phone width the gutter is 16px, a card pads
  16px, and every button is at least 44px tall.
- Radius: 6px on inputs and buttons, 10px on cards. Nothing fully round
  except avatars and status dots.
- **Hairline rules, not shadows.** One 1px `hairline` border. A single
  soft shadow is permitted on a modal only.

## App shell

One shell wraps every authenticated screen; each screen spec describes
only its own content region.

- **Top bar**, petrol-800: wordmark at the left, nav beside it, the
  global **Update values** action and the lock button at the right.
  Both buttons take the chrome variant (Components), not the secondary
  one, which is specified for the light ground. The current nav entry
  is white with a 2px brass-500 rule beneath it and the others are
  petrol-200, so the current one is marked by the rule as well as by
  hue.
- **At phone width** the nav drops to a second row of the bar, beneath
  the wordmark and the two buttons, and the lock button shows its icon
  alone, keeping "Lock" as its accessible name.
- **While a dialog is open** a vault owner's bar carries only the
  wordmark and Lock. The nav and Update values are hidden, not disabled, because
  neither can act until the dialog closes (`product/app-shell.md`, The
  top bar). The bar stays pinned to the top of the viewport above the
  scrim, at every width and however far the page had scrolled, so at
  phone width it is then a single row.
- **Nav is Dashboard and Settings**, the same for everybody who has a
  vault.
  - There is deliberately **no "Holdings" entry**: the dashboard's own
    table *is* the list of holdings (`dashboard.md`,
    `product/app-shell.md`).
  - There is deliberately **no "Admin" entry, in any state.**
    Administering the instance is done from a separate account with no
    vault (`app-shell.md`), so a vault owner has nowhere
    administrative to go and nothing in this bar leads there.
- **Update values** is a global action rather than a nav destination. It
  opens the sweep (`update-values.md`) at today, going straight into
  editing today's recording with no screen in between, which is what
  makes the sweep reachable while the user is deep in one holding
  (`product/app-shell.md`, Update values).
- **The dashboard does not repeat it.** The dashboard hero carries
  **New recording**, which asks which date and routes on the answer
  (`dashboard.md`). One control goes to today and one asks the
  question, so neither screen carries two buttons for one thing.
- **The administrator's frame** is the same bar carrying almost
  nothing: the wordmark, and a single **Sign out** at the right. No nav
  entries at all, no Update values, no Lock, because an administrator
  has no vault, no holdings, and no keys to drop (`app-shell.md`). The
  two bars are told apart by what they carry, never by looking
  different, and movement inside the admin area belongs to `admin.md`.
- **Lock button** — the idle lock, triggered by hand. One click
  discards the keys and all decrypted state and shows the re-unlock
  screen (`unlock.md`, with the rule in `login.md`, Rules). The server
  session stays alive, so unlocking needs only the password. No
  confirmation dialog (`product/app-shell.md`, Lock). With a dialog
  open it is the one control outside the dialog that acts (Components,
  Dialog), and the same click closes every open dialog. Which of them
  come back after unlocking is `unlock.md`'s (Rules).
- Content max-width 1200px on the ground, and each screen states its
  own narrower width.
- The shell is server-rendered Jinja (`architecture.md`, Components)
  and carries no plaintext, only nav labels and the wordmark.
- **Outside the shell** sit unlock, register and the error page
  (`unlock.md`, `register.md`, `error-page.md`): one centered card on
  the warm ground under the wordmark in petrol-800, no navigation and
  no marketing, each setting its own width. Unlock and register, having
  no session with which to fetch one, each embed the server's current
  default KDF envelope in their own page.

## Components

- **Button, primary**: brass-600 fill, white text, 6px radius. One per
  screen region.
- **Button, secondary**: transparent, petrol-700 text, rule border.
  For the light ground only.
- **Button, chrome**: transparent, white text, petrol-400 border, white
  focus ring. The secondary button on the petrol-800 top bar, where
  petrol-700 text measures 1.33:1 and petrol-600 focus 1.88:1, under
  both floors. A surface this dark needs its own variant rather than a
  darker step of the same one.
- **Button, destructive**: critical text on transparent, critical border;
  filled critical only inside a confirmation dialog.
- **Input**: white fill, hairline border, petrol-600 2px focus ring.
  Never remove the focus ring. **An inline rename is this same input
  revealed in place** by an Edit action and saved by an explicit
  action, not a control of its own. A field that saves on blur turns
  clicking away into a write. **Every field refuses password managers
  unless it is a credential**: `autocomplete="off"` plus each major
  manager's own ignore attribute, because a manager that fills a
  holding name writes a stored login into an encrypted record nobody
  but its owner can ever review. A Password field opts back in by
  naming its autocomplete tokens.
  - **The message line** sits directly under a field that has a rule
    to state or an error to show, in label/meta type. As a **hint** it
    is ink-secondary and states the rule before anything is typed. As
    an **error** the same line turns critical, takes the critical icon,
    and says what is wrong, so the form never grows or shifts. It
    returns to the hint the moment the value fits again.
  - **A field's error sits on its own message line**, whether the
    browser or the server found it, never above the form or in a
    summary elsewhere.
  - The input names the line in `aria-describedby` and carries
    `aria-invalid="true"` while it is an error. The line is a polite
    live region, so the turn to an error is announced.
- **Quantity field**: the money input. The holding's own unit sits as a
  suffix inside the box, `inputmode="decimal"`, and the converted
  main-currency figure appears beneath it in ink-secondary as you type,
  because that is the number the person is reasoning about and it costs
  no save to see. **Zero and negative are valid** and are never
  blocked: zero is a closed out position, negative is a mortgage. More
  than twelve decimal places is refused at input rather than truncated,
  and a non-numeric or malformed value is refused inline with nothing
  submitted.
- **Price date line**: "priced 15 Jan 2024", directly beneath a
  converted figure valued at a price from a day earlier than the one
  the figure is shown for. Label/meta type in ink-secondary, tabular
  figures, aligned with the figure above it. ink-secondary rather than
  ink-muted, because the line is the only place that date is stated.
  - The date follows Settings (`settings.md`, Dates and numbers) and
    always carries its year, because the price it dates can be years
    old.
  - It sits in the figure's own cell or slot, so it is read with the
    figure and is never a column.
  - It never takes a status color or an icon. An old price is a date,
    not a warning (Status).
  - It is absent where the price is from the figure's own day, on a
    main-currency figure, which has no price, and on a figure reading
    "not priced".
  - Which day counts as the figure's own is each screen's to state: the
    recording's date, a row's date, or the dashboard's rate position
    (`dashboard.md`, Holdings table).
- **Password field**: `type=password` with a show-and-hide toggle,
  never auto-submitted, never logged, and cleared from the DOM on
  success. Each one carries autocomplete tokens, named by its own
  screen, so a password manager can generate, store and update the
  password (`product/login.md`).
- **Chip**: petrol-50 fill, petrol-200 border, petrol-700 text, 4px
  radius, 12px. Used for
  a dimension assignment (`Liquidity: Cash`), for status chips such as
  "Archived", and for a price's provenance, whose wording is owned by
  `recording-detail.md`. A chip never exceeds its container. Its text
  wraps rather than clipping or truncating, because a provenance cut
  short no longer says where the price came from.
- **Date picker, marked**: a Dialog headed "New recording" whose body
  is the month grid itself, open the moment the control is pressed.
  There is no date field, no Open or confirm button and no popup of its
  own, and nothing covers any part of the dialog.
  - **Above the grid**, the month and year, with a previous month and a
    next month button. Next month is disabled on the current month,
    since everything after it is in the future.
  - **The grid opens on today's month with focus on today.** Arrow keys
    move the focus by a day left and right and by a week up and down.
  - **A date that already holds a recording** carries a petrol-600 dot
    under the numeral **and** says so in its accessible name ("31 July,
    has a recording"), because a dot is a color and identity is never
    color-alone.
  - **Future dates are not selectable at all**, rather than selectable
    and then refused (`record-snapshot.md`).
  - **Picking a day closes the dialog and routes at once**, with nothing
    to confirm. Where it routes is owned by the screen that opens it.
  - **One Button, secondary, "Cancel", beneath the grid** closes it as
    Escape does and writes nothing. It is there because Escape serves
    only a keyboard, and the full-screen sheet at phone width has no
    scrim to tap.

  Used by **New recording** (`dashboard.md`) and by a recording that is
  gone (`recording-detail.md`, Error, the recording is gone).
- **Card**: white surface, hairline border, 10px radius, 24px padding.
- **Table**: no vertical rules; `rule` horizontal dividers; figure
  columns as Typography sets them.
- **Select**: the Input's box, border, radius and focus ring, with a
  petrol-400 chevron. A native `select` wherever the list is short and
  fixed, because it is the control every device already knows and it
  costs nothing to operate. Used for a dimension, a grouping, a value
  order.
- **Combobox, searchable**: a Select that filters as you type, for a
  list too long to scan. The typed text narrows the list and never
  becomes the value on its own: **a free text value is only ever
  committed by an explicit "use what I typed" option in the list**, so
  a mistyped search can never be saved as a new thing by accident.
  Filtering is local, over a table the client already holds, so it
  contacts nothing. The unit picker is the consequential one, since a
  holding's unit freezes once it has a figure (`account-form.md`, which
  owns what goes in the list and in what order).
- **Checkbox**: 16px, hairline border unchecked, petrol-600 fill with a
  white check when checked, petrol-600 focus ring. The label is the
  click target with it. Never a bare switch: a checkbox states what it
  turns on in words beside itself.
- **Dialog**: white surface, 10px radius, 32px padding, max-width
  480px, centered on an ink-primary scrim at 40%. **The one place a
  soft shadow is permitted.** Its first line is a heading that names
  the act rather than asking "Are you sure".
  - **The scrim and the dialog start below a vault owner's top bar**,
    never over it, so Lock stays in view (App shell). In the
    administrator's frame there is no Lock to keep in view, so the
    scrim covers the whole viewport, bar included, and so does the
    sheet at phone width. The scrim covers the
    viewport from the bar's lower edge down and the dialog centers in
    that space. The bar's height is measured into `--chrome-height`
    rather than fixed, because it changes with the width and with what
    the bar wraps.
  - **Modal to everything but Lock.** While a dialog is open,
    everything outside it is `inert` except the Lock button. Focus is
    trapped in one cycle of the dialog's controls and Lock: Tab from
    the dialog's last control reaches Lock, and Tab from Lock returns
    to the dialog's first. The dialog carries no `aria-modal`, because
    that tells a screen reader nothing outside is reachable, Lock
    included. In the administrator's frame everything outside the
    dialog is inert.
  - **A dialog opened from inside another**, such as a confirmation
    over a form, stacks above it, and the one beneath is inert with the
    rest of the page until the top one closes.
  - **Escape closes the topmost dialog only.** Closing a dialog, by
    Escape or by its own controls, returns focus to whatever opened
    it.
  - **A destructive dialog** names the consequence in its body and
    carries the filled critical confirm (Button, destructive). One
    confirmation, never a ladder.
  - **A word typed back is asked for only where the act destroys
    something that cannot be recovered at all**: deleting an account,
    by typing its username (`settings.md`, and `admin.md` where an
    administrator removes one), deleting a holding permanently, by
    typing its name (`account-form.md`), and replacing a vault that
    holds records, by typing `ERASE` (`export-import.md`). Nothing the
    product holds could bring any of those back, so the typed word
    stops a slip of the hand before it costs everything. Anywhere else
    a typed word would only teach people to type it without reading,
    and the confirm button alone is the confirmation.
  - **At phone width it is a full-screen sheet** filling the viewport
    below a vault owner's top bar, same content and same focus behavior, because a
    centered box inside a narrow viewport leaves nothing for the scrim
    to show. The first version ships the
    dialog, and nothing about the sheet is out of reach from it
    (`app-shell.md`).
- **Disclosure**: a label with a chevron that opens a section in place.
  A real `button` with `aria-expanded`, never a bare chevron, and the
  label says what is inside rather than "More". Closed by default only
  where what is inside is genuinely secondary, and the count of what is
  hidden is on the label where there is one to give. It carries the
  archived list, "Add a note", a danger zone, the single-holding
  form's prices line, and the chart's table fallback.
- **Section switcher**: a row of links moving between the sections of
  one screen. Active in brass-600 with a 2px brass-500 rule beneath it,
  inactive in petrol-600, so the active one is marked by the rule as
  well as by hue. **It is not navigation** and never appears in the top
  bar. It exists because an administrator's bar carries no nav at all,
  so movement inside the admin area belongs to the screen
  (`app-shell.md`, `admin.md`).
- **Segmented control**: named positions side by side in one box with
  the Input's hairline border and radius, hairline rules between them,
  13px/500 ink-secondary. The chosen position is filled petrol-800
  with white text. Every position is named, so no position reads as an
  unlabeled off state. Used for the dashboard's Which rates, Range and
  Absolute / percentage (`dashboard.md`). At phone width it spans its
  row and the positions share the width.
- **Progress, determinate**: a 4px track in petrol-100 with a
  petrol-600 fill, under a label naming the phase in words and the
  position within it. For work with known phases that runs long enough
  that a spinner would say nothing, which in this product is the import
  (`export-import.md`). The label is what carries the meaning: a bar
  with no phase named is a spinner with extra steps.
- **Date field**: a text input carrying the date in the reader's own
  order, a button beside it opening a month grid, and the expected
  order as the placeholder and as a screen-reader label. Hand-built
  rather than `input type=date`, which is the only control in the
  product the platform already provides: that one is written in the
  browser's locale, no page can change it, and a reader whose browser
  is in English could otherwise never be given the dates they chose
  (`settings.md`). It keeps what the platform does well. A typed date
  is accepted without the calendar ever opening, the calendar is
  reachable from the keyboard, Escape closes it and returns focus to
  the button, and a date outside the allowed range is disabled in the
  grid, and refused when typed. A field that does not parse reports no
  value, so nothing saves an old date under a new one.
  - **The upper limit and its reason come from the screen using the
    field.** A screen that names neither has today as the limit and
    the future as the reason.
  - **A refusal is the field's own**, on its message line (Input, The
    message line), with `aria-invalid` and `aria-describedby` as there.
    The field refuses on blur and on Save, and clears the refusal as
    soon as the value fits.
  - **Save asks the field whether its value is valid.** A date refusal
    never appears in a form-level line. Save with a refused date writes
    nothing and moves focus to the field.
  - The copy, unless the screen states its own reason:

    | Value | Message line |
    |---|---|
    | Empty, on a form that needs a date | Enter a date. |
    | Does not parse | Enter the date as DD.MM.YYYY. |
    | After the upper limit | That date is in the future. |

    The pattern is the field's own placeholder, in the order Settings
    sets (`settings.md`, Dates and numbers), so "DD.MM.YYYY" stands for
    whichever order the reader chose.
- **Reorder control**: a drag handle, plus **Move up** and **Move
  down** on every item. The handle is never the only route. Order
  changes announce themselves ("moved to position 2 of 5") so the
  result is available without sight, and the buttons are what make the
  control work on touch and from the keyboard (`dimensions.md`).

## States

Every screen spec defines each of these and states only what it does
differently.

- **Loading**: skeleton blocks in petrol-100 for content, never a
  spinner for page load. Spinners only for a >1s action already begun.
  A screen served from the in-memory model has no loading state at
  all, and where one card alone waits on a fetch, only that card
  skeletons.
- **Empty**: one sentence naming what is missing, one primary action.
  Never an empty table with headers.
- **Error**: inline, critical text with an icon. A field's error is on
  that field's message line (Components, Input), and any other error
  sits above the control it concerns. Never a toast for anything the
  user must act on.
- **Populated**: the real thing.

These failures recur across screens, and a screen writes only its own
copy for them:

- **A write that failed**: inline on the control that made it, every
  typed value kept, every other control unaffected, and nothing
  retried on the user's behalf.
- **A conflict**: the copy names what changed in another tab or
  window, the screen reloads that record, and the user redoes the
  edit. Never a merge and never a silent clobber.
- **A save that landed in part**: nothing is rolled back and nothing
  records that a save was partial. The message names both halves, what
  landed and what did not, by name rather than by count, and what is
  on screen is what the vault holds rather than what the save
  intended. Each screen states whether it reloads or stays as it is.

## Motion

Transitions ≤150ms on hover/focus/expand only. No entrance animations,
no parallax, no number count-ups — a net worth figure that animates
upward from zero reads as a slot machine. Respect
`prefers-reduced-motion` by disabling all non-essential transitions.

## Accessibility

- Body text ≥4.5:1, large text and non-text ≥3:1. The tables above give
  the measured value for every token; the sub-4.5 ones are marked with
  their permitted use.
- Visible focus ring on every interactive element, never suppressed.
- Identity is never color-alone: charts carry a legend for ≥2 series and
  direct labels for ≤4; status carries an icon and a label.
- All interactive elements reachable and operable by keyboard. A
  dialog traps focus with Lock in its cycle and restores focus on close
  (Components, Dialog).
- **Phones and tablets are supported targets, not a degraded case.**
  Every screen is reachable, usable and submittable on a touch screen,
  and no action anywhere lives only in a wide layout
  (`product/app-shell.md`, On a phone). A screen states only what changes shape at phone width.
- **No drag is ever the only route.** Every drag interaction has a
  keyboard and pointer equivalent doing the same job: a reorder ships
  Move up and Move down (Components), and a file drop zone is always
  paired with a real file input, which is the control that has to
  work. A drop zone is a convenience laid over that input, which is
  why it needs no component of its own.
- **Decrypted content renders via `x-text`/`textContent` only** — never
  `x-html`, and never a chart library that takes an HTML string for
  labels or tooltips (`spec/architecture.md`, Application hardening).

## Dark mode

**Out of scope for v1.** The brief specifies a light ground, and a dark
theme is a second full palette that must be re-validated against a dark
surface rather than flipped — the chart steps above are selected for
`#faf9f7` and are not valid on a dark surface. Defining tokens now as
CSS custom properties keeps the door open without pretending the work is
done.
