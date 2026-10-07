# Design system

Shared visual foundations and shared behavior. Every screen in
`spec/features/` assumes this file and states only what it adds. It is
not a screen.

**The screens and this file state how every screen looks.** Sizes,
spacing and component styling are this file's tokens and components. It
also holds why each token is what it is, the contrast floors, and what
each component means. A screen states its arrangement: the order of its
regions, what sits beside what, and the widths that matter. What changes
shape at phone width is stated beside it, under At phone width.

## The look

Clean and elegant, in the register of a private bank: light ground, deep
petrol blue as the structural color, generous whitespace, hairline rules
instead of heavy borders and drop shadows. Restraint is the aesthetic.
The money is the only thing on screen allowed to be loud.

Two accents, used sparingly and for different jobs:

- **Brass**, the prestige accent. Primary actions, active navigation,
  the emphasis on a key figure. Warm against the cool petrol.
- **Plum**, the secondary accent. Non-primary highlights, chart series
  3. Never on a button that competes with brass.

If a screen needs a third accent, it is over-designed. Cut something.

## Two palettes, not one

The rule easiest to get wrong: **chrome colors and chart colors are
different jobs and do not share values.**

- **Chrome** (nav, text, buttons, rules) is muted, low chroma. That is
  what makes it read as expensive rather than as a toy.
- **Chart series** must clear a **chroma floor of OKLCH C ≥ 0.10**.
  Below it a hue reads as gray and stops carrying identity. So the muted
  petrol that is right for a header is *wrong* for a chart line. This
  is measured, not argued: the muted petrol sits at C 0.05.

Both palettes are drawn from the same three hue families (petrol 216°,
brass 82°, plum 356°), so they read as one system despite differing in
saturation.

## Ground and surfaces

| Role | Hex | Notes |
|---|---|---|
| Ground (page) | `#faf9f7` | Warm off-white, never pure white |
| Surface (cards, panels) | `#ffffff` | Sits on ground, separated by a hairline |
| Surface tinted | `#eff7f9` | petrol-50, callouts, selected rows |

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
| **800** | **`#0c3943`** | **11.87** | **primary brand, nav, headers** |
| 900 | `#06272f` | 14.91 | deepest, footer or rail |

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

brass-500 is below 4.5:1, so it is **not** a text color. Use brass-600
for any brass text.

## Ink and line

| Role | Hex | Contrast | Use |
|---|---|---|---|
| ink-primary | `#111d20` | 16.35 | body, figures |
| ink-secondary | `#4d575a` | 7.06 | labels, supporting copy |
| ink-muted | `#798285` | 3.73 | axis ticks, timestamps, **never body text** |
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

Validated against the `#faf9f7` ground with the Machado, Oliveira and
Fernandes (2009) severity-1.0 CVD model, OKLab ΔE ×100:

- **Adjacent pairlist** (stacked areas, bars, lines): worst CVD ΔE
  **16.6**, worst normal-vision ΔE **18.9**. Both clear their gates,
  ≥8 and ≥15.
- **All-pairs** (scatter, small multiples, where any two marks can
  touch): **the cap is the first three slots**, worst CVD ΔE **14.1**,
  normal **20.7**. Slot 4 must not appear in an all-pairs form, because
  indigo and petrol collapse to ΔE 5.0 under deuteranopia when they can
  sit adjacent.
- All four clear 3:1 on the ground, so **no relief channel is
  required**. Each chart still carries direct labels, as its screen
  states.

**Past four series, fold the remainder into "Other."** A fifth
dimension value never gets a generated hue. How the chart draws "Other"
and "Unassigned" is `net-worth-view.md`'s (Dashboard). Re-validate with
the skill's `validate_palette.js` if any hex changes.

**No hatch or pattern fill is defined anywhere in this system.** A
pattern reserved for an unreachable state gets reused for the wrong
thing later.

### Colors by chart job

- **Nominal bars** (the dashboard's breakdown by dimension): every bar
  takes **slot 1**, and bar length carries the value. Coloring nominal
  bars by value spends the identity channel re-encoding what length
  already shows. Identity comes from the direct label on each bar.
  - **Signed bars**: bars grow rightward from a zero baseline, and a
    negative band grows **leftward** from that same baseline, in slot 1
    again at 45% opacity. This matches the stacked chart's liability
    treatment (`net-worth-view.md`, Dashboard), so the sign reads the
    same in both places. The baseline is drawn in ink-muted, as the
    chart's zero line is. The direct label stays on the outboard end of
    the bar, carrying the signed amount.
  - The bars and the stacked chart show the same dimension, so a reader
    could expect the band colors to carry over. They deliberately do
    not. The stack needs hue to separate four adjacent fills, while a
    bar list separates by position and label already. Reusing the band
    colors here would spend four slots to repeat what the chart above
    just said.
- **Sequential** (magnitude, if ever needed): the petrol chart hue as a
  one-hue ramp, light→dark.
- **Diverging** (gains vs losses): status good ↔ status critical with a
  neutral gray midpoint (`#f0efec`). Net-worth change genuinely *means*
  good or bad, so it wears status tokens rather than categorical ones,
  and never both in one chart.

## Status

Reserved meaning. Never reused as a series color, and **always shipped
with an icon and a text label**, never color alone.

| Role | Hex | Contrast | Use in Solvent |
|---|---|---|---|
| good | `#1d7635` | 5.40 | gains, positive delta |
| warning | `#c2603d` | 3.96 | **reserved, no consumer**, non-text, see below |
| critical | `#ac312c` | 6.18 | losses, decryption failure, destructive confirm |

`warning` has no consumer. The token exists so the status triad is
complete, but **nothing reaches for it without first checking that the
thing it marks is really a warning.** These states get mistaken for
one, and none of them is:

- **Data that is merely old.** Figure age is stated in words, not
  flagged (`net-worth-view.md`).
- **A holding left alone on a sweep.** Leaving a row alone is a
  first-class answer and a partial update is the ordinary case, so
  nothing counts, flags or scores what was left (`record-snapshot.md`,
  Update values).
- **A recording holding no figures.** Its prices are why the date is
  still there, which makes it an ordinary state rather than wreckage
  (`record-snapshot.md`, Recording detail).
- **A price the source did not answer for, a unit nobody has priced
  yet, or a date before a unit's published prices begin.** The line
  says so in ink-secondary prose and nothing is blocked
  (`record-snapshot.md`, Update values). Marking an outage the product
  expects, and degrades cleanly through, trains the reader to ignore
  the mark before the day it means something.

A write that actually failed is a failure and takes `critical`, not
`warning`. A save that landed in part names what did not land
(`record-snapshot.md`, Update values), and a fault the client will not
resolve on its own, such as two entries on one date, is flagged
critical wherever it appears.

`good` and `critical` clear 4.5:1 and may carry text. **`warning` may
not**: at 3.96 it is an icon, border and fill color only, and the label
beside it sits in ink-primary. Same rule as brass-500 and ink-muted, and
the icon carries the status either way, so identity is never
color-alone.

There is deliberately **no darker warning step** for text, unlike
brass-600. Darkening it to clear 4.5:1 requires roughly `#b35733`, which
sits ΔE 7.8 from `critical`, under the ~9.5 separation this palette
holds elsewhere, so a warning chip would start reading as an error.
Warning and critical are neighboring hues and converge as they darken.
The honest resolution is that warning does not get to be text, not that
it gets a step which quietly fails a different test.

`warning` sits ΔE 9.4 from brass-500, deliberately, so a warning chip
never reads as the brand accent. `critical` sits ΔE 9.6 from chart slot
3 (plum). Where a loss figure and a plum series share a chart, the
icon and label pairing carries the distinction, not hue.

## Typography

**The device's own typeface, everywhere:** `system-ui, -apple-system,
"Segoe UI", sans-serif`. No webfont, no display face, no serif, and the
wordmark is set in the same stack as the body. The client settled this
(`app-shell.md`, What the client gets), so there is no wordmark
exception to reach for.

The architecture holds the same line from the other side. Every asset
is self-hosted and hash-pinned, third-party CDNs are forbidden
(`architecture.md`, Supply chain), and the frontend has no build step.
A webfont would add bytes, a pinning obligation, and a flash of
unstyled text on the slowest screen in the product. Elegance here comes
from spacing and restraint.

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
row and axis tick**, anything that must align vertically. The hero
figure keeps proportional figures.

**A figure column is right-aligned, money and quantity alike.** Figures
with different decimals line up at their right edge, never at the
decimal point, because the requirements ask for right-aligned columns.

### Figures

Every figure is grouped and pointed as Settings sets it
(`account-settings.md`, Dates and numbers).

- **Money** shows the places Decimals on money sets.
- **A price shows every digit it has, padded to at least six decimal
  places**, as text and in a field alike, never rounded. 0.9312 reads
  0.931200, 0.93124567 reads 0.93124567, and "Edited from 0.931200"
  names it the same way. Decimals on money does not reach it, because a
  price is not money (`account-settings.md`, Dates and numbers,
  `editable`).
- **A quantity in a unit that is not a currency shows exactly the
  decimals it was entered with**, as text and in a field alike. 12.125,
  12.5, 12.50 and 80 read as typed, never rounded and never padded.
  Decimals on money does not reach it, because rounding 12.5 ounces of
  gold to 13 loses part of the holding, and padding it to 12.50 claims
  a precision nobody recorded.
- **A percentage shows one decimal place**, grouped and pointed like
  every other figure, so a change reads "+136,794.6%" by default and
  "+136.794,6%" under German with a period as the thousands mark.
  Decimals on money does not reach it, because a percentage is not
  money.
- **A chart's value tick is the one figure that abbreviates.** From a
  thousand up it reads in short form, "2.5k" or "1.5M", grouped and
  pointed as Settings sets it, so a reader with a decimal comma sees
  "2,5k" and "1,5M". Below a thousand it reads whole, and in the
  percentage view every tick reads as a whole percent, grouped the same
  way. The exact format is `net-worth-view.md`'s (Value ticks). Every
  other figure, the chart's tooltip and legend included, shows in full,
  because a tick only has to place a line and the readout is where a
  value is read.

- **A count agrees with its noun, and a verb with its count.** One
  reads "1 day", "1 recorded figure" and "1 holding moves", every other
  count the plural, 0 included. In "N of M holdings assigned" the noun
  agrees with M. A unit symbol never changes, so "about 1 KB".
- **Names in a sentence read "A, B and C".** Commas between them, and
  "and" only before the last.

### Units

A unit reads the same way on every screen that names it, from the
symbol table (`rate-lookup.md`, Seeded symbols).

- **A sentence, a label or a price line names a unit in full**: a
  currency by its code, "USD", and any other listed unit by its whole
  label, "Gold, troy ounce", so grams and troy ounces never read alike.
  A unit the table does not list is free text and reads exactly as
  typed.
- **A figure carries a unit in short**: a currency's code ahead of it,
  "USD 12,450.00", a price included, "CHF 2,500.000000", and any
  other unit after it, by the part of the
  symbol after the hyphen or the free text as typed, "12.5 ozt".
- **No screen outside the unit picker and the administrator's symbol
  table shows a symbol such as `XAU-ozt` in place of a unit's name.**
- **A table header names no unit but a currency**, by its code, "In
  CHF", because a header is set in capitals and "OZT" is no unit's
  name. Any other unit sits in each cell, with its figure.

## Spacing and shape

- 8px base scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Content max-width 1200px, centered. Forms max-width 480px. Each
  screen states its own narrower width.
- Page gutter 40px. At phone width the gutter is 16px, a card pads
  16px, and every button is at least 44px tall.
- Radius: 6px on inputs and buttons, 10px on cards. Nothing fully round
  except avatars and status dots.
- **Hairline rules, not shadows.** One 1px `hairline` border. A single
  soft shadow is permitted on a modal only.

The chrome every authenticated screen sits in, and the card the screens
outside it use, are `app-shell.md`'s (The chrome).

## Components

- **Button, primary**: brass-600 fill, white text, 6px radius. One per
  screen region.
- **Button, secondary**: transparent, petrol-700 text, rule border.
  For the light ground only.
  A file input's own button wears it too, so no picker shows the
  browser's default.
- **Button, chrome**: transparent, white text, petrol-400 border, white
  focus ring. The secondary button on the petrol-800 top bar, where
  petrol-700 text measures 1.33:1 and petrol-600 focus 1.88:1, under
  both floors. A surface this dark needs its own variant rather than a
  darker step of the same one.
- **Button, destructive**: critical text on transparent, critical
  border. Filled critical only inside a confirmation dialog.
- **Button, disabled**: one look for primary, secondary and
  destructive, filled or outlined. petrol-200 fill and border, the
  label in ink-secondary at 5.24:1 on that fill, no hover change and
  `cursor: default`. Nothing of the enabled variant shows through, the
  critical red included, so a confirm turns red only once it can act.
  Never `opacity`, because it lets the variant's color through and
  drops the label under the 4.5:1 floor.
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
  main-currency figure appears beneath it in ink-secondary as the
  person types, because that is the number they are reasoning about and
  it costs no save to see. **Zero and negative are valid** and are
  never blocked: zero is a closed out position, negative is a mortgage.
  More than twelve decimal places is refused at input rather than
  truncated, and a non-numeric or malformed value is refused inline
  with nothing submitted.
- **Price date line**: "priced 15 Jan 2024", directly beneath a
  converted figure valued at a price from a day earlier than the one
  the figure is shown for. Label/meta type in ink-secondary, tabular
  figures, aligned with the figure above it. ink-secondary rather than
  ink-muted, because the line is the only place that date is stated.
  - The date follows Settings (`account-settings.md`, Dates and
    numbers) and always carries its year, because the price it dates
    can be years old.
  - It sits in the figure's own cell or slot, so it is read with the
    figure and is never a column.
  - It never takes a status color or an icon. An old price is a date,
    not a warning (Status).
  - It is absent where the price is from the figure's own day, on a
    main-currency figure, which has no price, and on a figure reading
    "not priced".
  - Which day counts as the figure's own is each screen's to state: the
    recording's date, a row's date, or the dashboard's rate position
    (`net-worth-view.md`, Dashboard).
- **Password field**: `type=password` with a show-and-hide toggle,
  never auto-submitted, never logged, and cleared from the DOM on
  success. Each one carries autocomplete tokens, named by its own
  screen, so a password manager can generate, store and update the
  password (`login.md`, What the client gets). It sits in a `<form>`,
  and where the screen knows whose password it is, the form also holds
  a hidden text field ahead of it with autocomplete `username` and the
  signed-in username, so the manager knows which login to fill or update. Nothing
  sends that field.
- **Chip**: petrol-50 fill, petrol-200 border, petrol-700 text, 4px
  radius, 12px. Used for a dimension assignment (`Liquidity: Cash`), for
  status chips such as "Archived", and for a price's provenance, whose
  wording is `record-snapshot.md`'s (Recording detail). A chip never
  exceeds its container. Its text wraps rather than clipping or
  truncating, because a provenance cut short no longer says where the
  price came from.
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

  Used by **New recording** (`net-worth-view.md`, Dashboard) and by a
  recording that is gone (`record-snapshot.md`, Recording detail).
- **Card**: white surface, hairline border, 10px radius, 24px padding.
- **Callout**: Surface tinted fill, no border, 6px radius, 16px
  padding, body type in ink-primary, 15.8:1 on its fill. It states one
  thing the reader must take in before going on, and is never
  dismissible. Where something is at stake or already lost it carries
  the critical icon at the start of its first line, the icon alone in
  critical (5.99:1) and the text still ink-primary. Otherwise it
  carries no icon, because a statement of what is true is not a
  warning (Status). Each screen states its copy and whether it carries
  the icon.
- **Table**: no vertical rules, `rule` horizontal dividers, figure
  columns as Typography sets them.
- **Select**: the Input's box, border, radius and focus ring, with a
  petrol-400 chevron. A native `select` wherever the list is short and
  fixed, because it is the control every device already knows and it
  costs nothing to operate. Used for a dimension, a grouping, a value
  order.
- **Combobox, searchable**: a Select that filters as the person types,
  for a list too long to scan. The typed text narrows the list and
  never becomes the value on its own: **a free text value is only ever
  committed by an explicit "use what I typed" option in the list**, so
  a mistyped search can never be saved as a new thing by accident.
  Filtering is local, over a table the client already holds, so it
  contacts nothing. The unit picker is the consequential one, since a
  holding's unit freezes once it has a figure (`manage-accounts.md`,
  Account form, which owns what goes in the list and in what order).
- **Checkbox**: 16px, hairline border unchecked, petrol-600 fill with a
  white check when checked, petrol-600 focus ring. The label is the
  click target with it. Never a bare switch: a checkbox states what it
  turns on in words beside itself.
- **Dialog**: white surface, 10px radius, 32px padding, max-width
  480px, centered on an ink-primary scrim at 40%. **The one place a
  soft shadow is permitted.** Its first line is a heading that names
  the act rather than asking "Are you sure".
  - **The scrim and the dialog start below a vault owner's top bar**,
    never over it, so Lock stays in view (`app-shell.md`, The chrome).
    The scrim covers the viewport from the bar's lower edge down and
    the dialog centers in that space. The bar's height is measured into
    `--chrome-height` rather than fixed, because it changes with the
    width and with what the bar wraps. In the administrator's frame
    there is no Lock to keep in view, so the scrim covers the whole
    viewport, bar included, and so does the sheet at phone width.
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
    by typing its username (`account-settings.md`, Settings, and
    `admin-invites.md`, Admin, where an administrator removes one),
    deleting a holding permanently, by typing its name
    (`manage-accounts.md`, Account form), and replacing a vault that
    holds records, by typing `ERASE` (`export-import.md`, Export /
    import). Nothing the product holds could bring any of those back,
    so the typed word stops a slip of the hand before it costs
    everything. Anywhere else a typed word would only teach people to
    type it without reading, and the confirm button alone is the
    confirmation.
  - **At phone width it is a full-screen sheet** filling the viewport
    below a vault owner's top bar, with the same content and the same
    focus behavior, because a centered box inside a narrow viewport
    leaves nothing for the scrim to show. Nothing about the sheet is
    out of reach from the dialog (`app-shell.md`, What the client
    gets).
- **Disclosure**: a label with a chevron that opens a section in place.
  A real `button` with `aria-expanded`, never a bare chevron, and the
  label says what is inside rather than "More". Closed by default only
  where what is inside is genuinely secondary, and the count of what is
  hidden is on the label where there is one to give. It carries the
  archived list, "Add a note", a danger zone, the single-holding form's
  prices line, and the chart's table fallback.
- **Section switcher**: a row of links moving between the sections of
  one screen. Active in brass-600 with a 2px brass-500 rule beneath it,
  inactive in petrol-600, so the active one is marked by the rule as
  well as by hue. **It is not navigation** and never appears in the top
  bar. It exists because an administrator's bar carries no nav at all,
  so movement inside the admin area belongs to the screen
  (`app-shell.md`, The chrome, and `admin-invites.md`, Admin).
- **Segmented control**: named positions side by side in one box with
  the Input's hairline border and radius, hairline rules between them,
  13px/500 ink-secondary. The chosen position is filled petrol-800
  with white text. Every position is named, so no position reads as an
  unlabeled off state. Used for the dashboard's Which rates, Range and
  Absolute / percentage (`net-worth-view.md`, Dashboard). At phone
  width it spans its row and the positions share the width.
- **Progress, determinate**: a 4px track in petrol-100 with a
  petrol-600 fill, under a label naming the phase in words and the
  position within it. For work with known phases that runs long enough
  that a spinner would say nothing, which in this product is the import
  (`export-import.md`, Export / import). The label is what carries the
  meaning: a bar with no phase named is a spinner with extra steps.
- **Date field**: a text input carrying the date in the reader's own
  order, a button beside it opening a month grid, and the expected
  order as the placeholder and as a screen-reader label. Hand-built
  rather than `input type=date`, which is the only control in the
  product the platform already provides. That one is written in the
  browser's locale, no page can change it, and a reader whose browser
  is in English could otherwise never be given the dates they chose
  (`account-settings.md`, Settings). It keeps what the platform does
  well. A typed date is accepted without the calendar ever opening, the
  calendar is reachable from the keyboard, Escape closes it and returns
  focus to the button, and a date outside the allowed range is disabled
  in the grid and refused when typed. A field that does not parse
  reports no value, so nothing saves an old date under a new one.
  - **The calendar opens in the form's flow**, below the field's
    message line, never laid over the form, so it stays inside a
    dialog's edges, and it carries a hairline and no shadow. A dialog
    too short for it scrolls. Opening it moves focus into the grid, and
    Escape there closes the calendar alone, never the dialog holding
    it.
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
    sets (`account-settings.md`, Dates and numbers), so "DD.MM.YYYY"
    stands for whichever order the reader chose.
- **Reorder control**: a drag handle, plus **Move up** and **Move
  down** on every item. The handle is never the only route. Order
  changes announce themselves ("moved to position 2 of 5") so the
  result is available without sight, and the buttons are what make the
  control work on touch and from the keyboard (`account-settings.md`,
  Dimensions).

## States

Every screen defines each of these and states only what it does
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
  edit. Never a merge and never a silent clobber. A vault replaced from
  a file is not a conflict: the page closes the vault rather than
  reloading anything (`login.md`, Unlock, Replaced elsewhere).
- **A save that landed in part**: nothing is rolled back and nothing
  records that a save was partial. The message names both halves, what
  landed and what did not, by name rather than by count, and what is
  on screen is what the vault holds rather than what the save
  intended. Each screen states whether it reloads or stays as it is.

## Motion

Transitions ≤150ms on hover, focus and expand only. No entrance
animations, no parallax, no number count-ups, because a net worth
figure that animates upward from zero reads as a slot machine. Respect
`prefers-reduced-motion` by disabling all non-essential transitions.

## Accessibility

- Body text ≥4.5:1, large text and non-text ≥3:1. The tables above give
  the measured value for every token, and the sub-4.5 ones are marked
  with their permitted use.
- A disabled button's label meets the 4.5:1 floor too (Components,
  Button, disabled), because it still names what the button does once
  it can act.
- Visible focus ring on every interactive element, never suppressed.
- Identity is never color-alone: charts carry a legend for ≥2 series
  and direct labels for ≤4, and status carries an icon and a label.
- A form control's visible label is its accessible name: the label
  names the control by its `id`, or the input inside a wrapper such as a
  password field with Show.
- All interactive elements are reachable and operable by keyboard. A
  dialog traps focus with Lock in its cycle and restores focus on close
  (Components, Dialog).
- **Phones and tablets are supported targets, not a degraded case.**
  Every screen is reachable, usable and submittable on a touch screen,
  and no action anywhere lives only in a wide layout (`app-shell.md`,
  What the client gets). A screen states only what changes shape at
  phone width.
- **No drag is ever the only route.** Every drag interaction has a
  keyboard and pointer equivalent doing the same job. A reorder ships
  Move up and Move down (Components), and a file drop zone is always
  paired with a real file input, which is the control that has to
  work. A drop zone is a convenience laid over that input, which is
  why it needs no component of its own.
- **Decrypted content renders via `x-text` or `textContent` only**,
  never `x-html`, and never a chart library that takes an HTML string
  for labels or tooltips (`architecture.md`, Application hardening).

## Dark mode

**Out of scope.** The brief specifies a light ground, and a dark
theme is a second full palette that must be re-validated against a dark
surface rather than flipped. The chart steps above are selected for
`#faf9f7` and are not valid on a dark surface. The tokens are CSS
custom properties, which keeps the door open without pretending the
work is done.
