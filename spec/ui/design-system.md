# Design system

Shared visual foundations. Every screen spec in this directory assumes
these tokens and says only what it adds. Not a screen — no feature
compiles against this file alone, but every UI contract references it.

## The look

Clean and elegant, in the register of a private bank: light ground, deep
petrol blue as the structural color, generous whitespace, hairline rules
instead of heavy borders and drop shadows. Restraint is the aesthetic —
the money is the only thing on screen allowed to be loud.

Two accents, used sparingly and for different jobs:

- **Brass** — the prestige accent. Primary actions, active navigation,
  the emphasis on a key figure. Warm against the cool petrol.
- **Plum** — the secondary accent. Non-primary highlights, chart series
  3, tag chips. Never on a button that competes with brass.

If a screen needs a third accent, it is over-designed. Cut something.

## Two palettes, not one

The most important rule here, and the one that is easy to get wrong:
**chrome colors and chart colors are different jobs and do not share
values.**

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
  **16.6**, worst normal-vision ΔE **18.9**. Both clear their gates (≥8
  and ≥15) with roughly double the margin of the reference palette.
- **All-pairs** (scatter, small multiples — any two marks can touch):
  **the cap is the first three slots**, worst CVD ΔE **14.1**, normal
  **20.7**. Slot 4 must not appear in an all-pairs form: indigo and
  petrol collapse to ΔE 5.0 under deuteranopia when they can sit
  adjacent.
- All four clear 3:1 on the ground, so **no relief channel is required**
  — but direct labels are still specified per chart below.

**Past four series, fold the remainder into "Other."** A fifth tag never
gets a generated hue. Re-validate with the skill's
`validate_palette.js` if any hex changes.

### Colors by chart job

- **Nominal bars** (tag breakdown): every bar takes **slot 1**, and bar
  length carries the value. Coloring nominal bars by value spends the
  identity channel re-encoding what length already shows. Identity comes
  from the direct label on each bar.
- **Sequential** (magnitude, if ever needed): the petrol chart hue as a
  one-hue ramp, light→dark.
- **Diverging** (gains vs losses): status good ↔ status critical with a
  neutral gray midpoint (`#f0efec`). Net-worth change genuinely *means*
  good/bad, so it wears status tokens rather than categorical ones —
  never both in one chart.

## Status

Reserved meaning. Never reused as a series color, and **always shipped
with an icon and a text label** — never color alone.

| Role | Hex | Contrast | Use in Solvent |
|---|---|---|---|
| good | `#1d7635` | 5.40 | gains, positive delta |
| warning | `#c2603d` | 3.96 | stale account (>90 days) |
| critical | `#ac312c` | 6.18 | losses, decryption failure, destructive confirm |

`warning` sits ΔE 9.4 from brass-500 — deliberately, so a warning chip
never reads as the brand accent. `critical` sits ΔE 9.6 from chart slot
3 (plum); where a loss figure and a plum series share a chart, the
icon+label pairing carries the distinction, not hue.

## Typography

**System stack, no webfont:** `system-ui, -apple-system, "Segoe UI",
sans-serif`.

No display or serif face. This is a constraint the architecture already
imposes, not a style preference: `spec/architecture.md` (Supply chain)
requires every asset be self-hosted with SRI and forbids third-party
CDNs, and the frontend has no build step. A webfont would add bytes, a
pinning obligation, and a FOUT on the unlock screen for no functional
gain. Elegance here comes from spacing and restraint. If a serif
wordmark is ever wanted, it must be self-hosted with an SRI hash like
any other asset.

| Role | Size / weight | Notes |
|---|---|---|
| Hero figure (net worth) | 40–48px, 600 | proportional figures |
| Section heading | 20px, 600 | |
| Body | 15px, 400 | |
| Label / meta | 13px, 500 | ink-secondary |
| Axis tick | 12px, 400 | ink-muted |

**`font-variant-numeric: tabular-nums` on every money column, table row,
and axis tick** — anything that must align vertically. The hero figure
keeps proportional figures.

## Spacing and shape

- 8px base scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Content max-width 1200px, centered; forms max-width 480px.
- Radius: 6px on inputs and buttons, 10px on cards. Nothing fully round
  except avatars and status dots.
- **Hairline rules, not shadows.** One 1px `hairline` border. A single
  soft shadow is permitted on a modal only.

## Components

- **Button, primary**: brass-600 fill, white text, 6px radius. One per
  screen region.
- **Button, secondary**: transparent, petrol-700 text, hairline border.
- **Button, destructive**: critical text on transparent, critical border;
  filled critical only inside a confirmation dialog.
- **Input**: white fill, hairline border, petrol-600 2px focus ring.
  Never remove the focus ring.
- **Tag chip**: petrol-50 fill, petrol-700 text, 4px radius, 13px.
- **Card**: white surface, hairline border, 10px radius, 24px padding.
- **Table**: no vertical rules; `rule` horizontal dividers; money columns
  right-aligned and tabular.

## States

Every screen spec must define all four. Defaults:

- **Loading**: skeleton blocks in petrol-100 for content, never a
  spinner for page load. Spinners only for a >1s action already begun.
- **Empty**: one sentence naming what is missing, one primary action.
  Never an empty table with headers.
- **Error**: inline, above the relevant control, critical text with an
  icon. Never a toast for anything the user must act on.
- **Populated**: the real thing.

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
- All interactive elements reachable and operable by keyboard; modals
  trap focus and restore it on close.
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
