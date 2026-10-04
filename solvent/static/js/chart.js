// The trend chart, drawn directly in SVG with no charting library
// (spec/features/net-worth-view.md, Rules).
//
// What a library supplies here is scales, tick math and path building.
// What this chart needs is the partition rule, per-holding
// interpolation, asset/liability mirroring and provenance ticks, which
// is domain logic written either way. SVG rather than canvas because
// the direct labels, tabular figures and the table fallback all need
// real DOM.
import * as decimal from './decimal.js';
import { el } from './dom.js';
import { dayNumber, isoFromDay } from './model.js';

const NS = 'http://www.w3.org/2000/svg';

// Categorical slots, assigned in fixed order and never cycled
// (spec/ui/design-system.md, Chart palette).
const SLOTS = ['#0098b7', '#ad7d00', '#964265', '#7f79d1'];
const UNASSIGNED_FILL = '#c4cccf';
const OTHER_FILL = '#798285';

export function fillFor(band, index) {
  if (band.id === 'unassigned') return UNASSIGNED_FILL;
  if (band.id === 'other') return OTHER_FILL;
  return SLOTS[index % SLOTS.length];
}

function svg(tag, props = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(props)) {
    if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  return node;
}

function toNumber(value) {
  return Number(decimal.format(value));
}

/** The trend chart at the width its card gives it. It is drawn in
 *  pixels rather than stretched, so the axis text stays the size the
 *  design system sets, and drawn again when that width changes. */
export function trendChart(options) {
  const frame = el('div', { class: 'chart-frame' });
  let drawn = 0;
  const observer = new ResizeObserver(() => {
    if (!frame.isConnected) {
      // Removed by a redraw or a lock: nothing keeps the series alive.
      if (drawn) observer.disconnect();
      return;
    }
    const width = Math.floor(frame.clientWidth);
    if (!width || width === drawn) return;
    drawn = width;
    frame.replaceChildren(drawChart({ ...options, width }));
  });
  observer.observe(frame);
  return frame;
}

/** Where each band's two sides sit on each day. The asset part of
 *  every band stacks up from zero and the liability part mirrors down
 *  from it, both in band order, so a band holding a flat and its
 *  mortgage shows both rather than their difference. The net line is
 *  the signed sum. In percentage mode each side is normalized against
 *  its own total, assets against total assets and liabilities against
 *  total liabilities (net-worth-view.md, Ranges and modes).
 *
 *  `phase` stacks a band's `before` side instead, the one just before
 *  a day (see `Vault.series`).
 *
 *  Pure, so the arithmetic is tested without a page. */
export function stack(bands, percentage = false, phase = null) {
  const count = bands.length ? bands[0].points.length : 0;
  const layers = bands.map((band) => ({ band, upper: [], lower: [] }));
  const net = [];
  for (let index = 0; index < count; index += 1) {
    const sides = layers.map(({ band }) => {
      const { assets, liabilities } = phase ? band[phase] : band;
      return [toNumber(assets[index]), toNumber(liabilities[index])];
    });
    const assetTotal = sides.reduce((sum, [asset]) => sum + asset, 0);
    const liabilityTotal = sides.reduce((sum, [, liability]) => sum - liability, 0);
    let up = 0;
    let down = 0;
    let line = 0;
    layers.forEach((layer, at) => {
      let [asset, liability] = sides[at];
      line += asset + liability;
      if (percentage) {
        asset = assetTotal ? (asset / assetTotal) * 100 : 0;
        liability = liabilityTotal ? (liability / liabilityTotal) * 100 : 0;
      }
      layer.upper[index] = [up, up + asset];
      layer.lower[index] = [down, down + liability];
      up += asset;
      down += liability;
    });
    net.push(line);
  }
  return { layers, net };
}

/** The day under a pointer at `x`: day k of a range of days 0 to n sits
 *  at x0 + k * (x1 - x0) / n, so the nearest is round((x - x0) * n /
 *  (x1 - x0)), a half going to the later day and the ends clamped. A
 *  range of one day reads that day at every x (net-worth-view.md,
 *  Reading a date). */
export function dayAt(x, x0, x1, firstDay, lastDay) {
  const n = lastDay - firstDay;
  if (n === 0) return firstDay;
  return firstDay + Math.min(n, Math.max(0, Math.round(((x - x0) * n) / (x1 - x0))));
}

/** Draw one stacked area chart.
 *
 *  Asset parts stack up from zero at 85% opacity, liability parts
 *  mirror down in the same band color at 45%, and the net-worth line
 *  runs over the top. The side of the axis carries the sign, so a band
 *  keeps its hue on both sides. A band in `hidden` is left out of the
 *  stack and the line, and keeps its color slot. */
function drawChart({
  days, bands, marks, annotations, percentage, justTheLine, onPickDate, onHover, onSelect, width = 900, locale, formatDay, formatDate, group = ',', decimalPoint = '.',
  hidden = new Set(), selection = null,
}) {
  // A phone-width card gets a shorter plot and fewer gridlines. The
  // value labels sit in a gutter at the plot's left at every width, and
  // the plot keeps half the widest mark, the net-worth dot, clear inside
  // both edges (spec/ui/design-system.md, Axes).
  const narrow = width < 560;
  const height = narrow ? 206 : 352;
  const pad = narrow
    ? { top: 8, right: 6, bottom: 36, left: 44 }
    : { top: 8, right: 6, bottom: 44, left: 48 };

  if (!days.length) return el('p', { class: 'empty-line', text: 'No history yet.' });

  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const plotBottom = pad.top + plotHeight;
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const spanDays = lastDay - firstDay;
  // A range of one day draws its point in the middle of the plot, whole.
  const x = (day) => pad.left + (spanDays ? (day - firstDay) / spanDays : 0.5) * plotWidth;

  const fills = new Map(bands.map((band, index) => [band, fillFor(band, index)]));
  // A day's samples are its value just before it and at it, so a
  // holding's first recording or archive draws as a step.
  const shown = bands.filter((band) => !hidden.has(band.id));
  const stacks = [stack(shown, percentage, 'before'), stack(shown, percentage)];
  const { layers, net: netLine } = stacks[1];

  let top = 0;
  let bottom = 0;
  days.forEach((_, index) => {
    for (const { layers: stacked, net } of stacks) {
      for (const layer of stacked) {
        top = Math.max(top, layer.upper[index][1]);
        bottom = Math.min(bottom, layer.lower[index][1]);
      }
      if (!percentage) {
        top = Math.max(top, net[index]);
        bottom = Math.min(bottom, net[index]);
      }
    }
  });
  if (top === bottom) top = bottom + 1;
  const y = (value) => plotBottom - ((value - bottom) / (top - bottom)) * plotHeight;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'trend',
    role: 'img',
    tabindex: '0',
    'aria-label': 'Net worth over time',
  });

  // Gridlines under the fills, the value each one marks beside the plot.
  const valueLabels = [];
  for (const gridValue of valueTicks(bottom, top, narrow ? 3 : 6)) {
    const at = y(gridValue);
    if (gridValue !== 0) {
      root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: at, y2: at, class: 'gridline' }));
    }
    const tick = svg('text', { x: pad.left - 10, y: at + 4, class: 'axis-tick', 'text-anchor': 'end' });
    tick.textContent = tickLabel(gridValue, group, decimalPoint) + (percentage ? '%' : '');
    valueLabels.push(tick);
  }

  layers.forEach((layer, at) => {
    const fill = fills.get(layer.band);
    for (const [side, opacity] of [['upper', '0.85'], ['lower', '0.45']]) {
      const d = areaPath(days, stacks.map((s) => s.layers[at][side]), x, y);
      if (d) {
        root.append(svg('path', { d, fill, 'fill-opacity': opacity, class: 'band', 'data-band': layer.band.id }));
      }
    }
  });

  // The zero line over the fills, a step darker than a gridline.
  root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0), class: 'zero-line' }));
  root.append(...valueLabels);

  if (!percentage) {
    root.append(svg('polyline', { points: outline(days, stacks.map((s) => s.net), x, y).join(' '), class: 'net-line' }));
    root.append(svg('circle', {
      cx: x(lastDay),
      cy: y(netLine[netLine.length - 1]),
      r: 4,
      class: 'net-end',
    }));
  }

  // Ticks under the axis at every date carrying at least one
  // snapshot, on from the moment the chart loads: the accurate
  // drawing is the one nobody should have to ask for, and the tick is
  // also the way into that date's recording.
  if (!justTheLine) {
    for (const date of marks) {
      const day = dayNumber(date);
      if (day < firstDay || day > lastDay) continue;
      // Kept whole at the plot's two edges rather than cut in half.
      const at = Math.min(Math.max(x(day), pad.left + 0.75), width - pad.right - 0.75);
      const tick = svg('line', {
        x1: at,
        x2: at,
        y1: plotBottom + 6,
        y2: plotBottom + 14,
        class: 'entry-mark',
      });
      tick.addEventListener('click', () => onPickDate && onPickDate(date));
      const title = svg('title');
      title.textContent = `${formatDate(date)}, recorded. Open this recording.`;
      tick.append(title);
      root.append(tick);
    }
  }

  for (const annotation of annotations) {
    const day = dayNumber(annotation.date);
    if (day < firstDay || day > lastDay) continue;
    const marker = svg('line', {
      x1: x(day),
      x2: x(day),
      y1: pad.top,
      y2: plotBottom,
      class: 'archive-annotation',
    });
    const title = svg('title');
    title.textContent = `${annotation.label} archived`;
    marker.append(title);
    root.append(marker);
  }

  for (const { day, text } of timeLabels(firstDay, lastDay, plotWidth, locale, formatDay)) {
    const label = svg('text', {
      x: x(day),
      y: plotBottom + (narrow ? 30 : 34),
      class: 'axis-tick',
      'text-anchor': 'middle',
    });
    label.textContent = text;
    root.append(label);
  }

  // A selected span stays drawn after release, under the crosshair.
  if (selection) {
    const [from, to] = selection;
    root.append(svg('rect', {
      x: x(from),
      y: pad.top,
      width: Math.max(1, x(to) - x(from)),
      height: plotHeight,
      class: 'selection',
    }));
  }
  const crosshair = svg('line', { y1: pad.top, y2: plotBottom, class: 'crosshair', visibility: 'hidden' });
  const dragging = svg('rect', { y: pad.top, height: plotHeight, class: 'selection', visibility: 'hidden' });
  root.append(dragging, crosshair);

  // Hover, drag and the keyboard all move one crosshair, and each moves
  // it by the calendar day: the drawing's samples are not the dates the
  // chart reads. `onHover` hears the day under it and where it sits
  // across the plot, and null when it leaves.
  const marked = marks.map(dayNumber).filter((day) => day >= firstDay && day <= lastDay);
  let current = null;
  const point = (day) => {
    current = day;
    if (day === null) {
      crosshair.setAttribute('visibility', 'hidden');
      if (onHover) onHover(null);
      return;
    }
    const at = x(day);
    crosshair.setAttribute('x1', at);
    crosshair.setAttribute('x2', at);
    crosshair.setAttribute('visibility', 'visible');
    if (onHover) onHover(day, at / width);
  };
  // Where an event sits in the drawing's own units, and whether that
  // is on the plot rather than in a gutter, a margin or the axis strip.
  const place = (event) => {
    const box = root.getBoundingClientRect();
    const scale = box.width / width;
    const at = (event.clientX - box.left) / scale;
    const down = (event.clientY - box.top) / scale;
    return {
      day: dayAt(at, pad.left, width - pad.right, firstDay, lastDay),
      // Half a pixel of slack, so an edge column and float noise stay on.
      onPlot: at >= pad.left - 0.5 && at <= width - pad.right + 0.5 && down <= plotBottom,
    };
  };
  const dayUnder = (event) => place(event).day;

  // A drag selects the span between two days. A click, a press and
  // release on one day, opens that day's recording when it carries a
  // snapshot and otherwise clears a selection.
  let anchor = null;
  // Set by a press and cleared once the chart has taken or lost focus,
  // because a tap fires pointerup and pointerleave before the focus.
  let pressed = false;
  root.addEventListener('pointerdown', (event) => {
    pressed = true;
    if (event.button !== 0 || event.target.classList.contains('entry-mark')) return;
    const { day, onPlot } = place(event);
    if (!onPlot) return;
    anchor = day;
    // A touch has no hover to put the crosshair there first.
    point(day);
  });
  root.addEventListener('pointermove', (event) => {
    const { day, onPlot } = place(event);
    // Off the plot the crosshair goes, unless a drag is under way.
    if (!onPlot && anchor === null) {
      point(null);
      return;
    }
    point(day);
    if (anchor === null || day === anchor) return;
    const [from, to] = [Math.min(anchor, day), Math.max(anchor, day)];
    dragging.setAttribute('x', x(from));
    dragging.setAttribute('width', Math.max(1, x(to) - x(from)));
    dragging.setAttribute('visibility', 'visible');
  });
  root.addEventListener('pointerup', (event) => {
    if (anchor === null) return;
    const day = dayUnder(event);
    const from = anchor;
    anchor = null;
    dragging.setAttribute('visibility', 'hidden');
    if (day !== from) {
      if (onSelect) onSelect([Math.min(from, day), Math.max(from, day)]);
    } else if (marked.includes(day) && onPickDate) {
      onPickDate(isoFromDay(day));
    } else if (onSelect && selection) {
      onSelect(null);
    }
  });
  root.addEventListener('pointerleave', (event) => {
    anchor = null;
    dragging.setAttribute('visibility', 'hidden');
    // A finger lifts off with a leave of its own, and the day it
    // touched stays read.
    if (event.pointerType !== 'touch') point(null);
  });

  // Focus by keyboard puts the crosshair on the last day. A press with
  // the pointer focuses the chart too, and leaves the crosshair under
  // the pointer.
  root.addEventListener('focus', () => {
    if (!pressed) point(lastDay);
    pressed = false;
  });
  root.addEventListener('blur', () => {
    pressed = false;
    point(null);
  });
  root.addEventListener('keydown', (event) => {
    pressed = false;
    const from = current === null ? lastDay : current;
    let next;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const forward = event.key === 'ArrowRight';
      if (!event.shiftKey) next = from + (forward ? 1 : -1);
      else next = forward ? marked.find((day) => day > from) : marked.findLast((day) => day < from);
    } else if (event.key === 'Home') {
      next = firstDay;
    } else if (event.key === 'End') {
      next = lastDay;
    } else if (event.key === 'Enter') {
      if (current !== null && marked.includes(current) && onPickDate) onPickDate(isoFromDay(current));
      return;
    } else {
      if (event.key === 'Escape') point(null);
      return;
    }
    event.preventDefault();
    if (next !== undefined && next !== current) point(Math.min(lastDay, Math.max(firstDay, next)));
  });

  return root;
}

/** Labels along the time axis: years over a long span, months over a
 *  shorter one, days over a few weeks. Spaced so no two collide, and
 *  none placed where it would run off either end of the plot. */
function timeLabels(firstDay, lastDay, plotWidth, locale, formatDay) {
  if (firstDay === lastDay) return [{ day: firstDay, text: formatDay(isoFromDay(firstDay)) }];
  const perDay = plotWidth / Math.max(1, lastDay - firstDay);
  const dayOf = (year, month, date = 1) => Math.round(Date.UTC(year, month, date) / 86400000);
  const first = new Date(firstDay * 86400000);
  const last = new Date(lastDay * 86400000);
  const candidates = [];
  let margin = 16;

  if (lastDay - firstDay >= 730) {
    const step = Math.max(1, Math.ceil(56 / (365 * perDay)));
    for (let year = first.getUTCFullYear() + 1; year <= last.getUTCFullYear(); year += 1) {
      if (year % step === 0) candidates.push({ day: dayOf(year, 0), text: String(year) });
    }
  } else if (lastDay - firstDay >= 60) {
    const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const step = [1, 2, 3, 6].find((n) => n * 30.4 * perDay >= 72) || 12;
    margin = 24;
    for (let m = first.getUTCMonth() + 1, year = first.getUTCFullYear(); ; m += 1) {
      const day = dayOf(year, m);
      if (day > lastDay) break;
      const at = new Date(day * 86400000);
      if (at.getUTCMonth() % step !== 0) continue;
      const name = month.format(at);
      candidates.push({ day, text: at.getUTCMonth() === 0 ? `${name} ${at.getUTCFullYear()}` : name });
    }
  } else {
    // Days are written by the reader's formatter, so a chosen date
    // style reaches the axis too. A numeric date is ten characters
    // against a spelled day's six, so it gets the room it needs.
    const written = (day) => formatDay(isoFromDay(day));
    const wide = /^[^A-Za-z]{10}$/.test(written(firstDay));
    const step = Math.max(1, Math.ceil((wide ? 96 : 72) / perDay));
    margin = wide ? 36 : 24;
    for (let day = firstDay; day <= lastDay; day += step) {
      candidates.push({ day, text: written(day) });
    }
  }
  return candidates.filter(({ day }) => {
    const at = (day - firstDay) * perDay;
    return at >= margin && at <= plotWidth - margin;
  });
}

/** The points of one edge, left to right. `runs` holds the value just
 *  before each day and at it. A day with a step emits two points at its
 *  x, a vertical edge, and a day with none emits one. The first day has
 *  nothing before it, so the chart's left end carries no edge. */
export function outline(days, runs, x, y) {
  const points = [];
  days.forEach((day, index) => {
    runs.forEach((run, phase) => {
      if (phase === 0 && index === 0) return;
      const point = `${x(day)},${y(run[index])}`;
      if (point !== points[points.length - 1]) points.push(point);
    });
  });
  return points;
}

/** `spans` is one band side's [low, high] per day, before and at it. */
function areaPath(days, spans, x, y) {
  if (!spans.some((run) => run.some(([from, to]) => from !== to))) return null;
  const tops = outline(days, spans.map((run) => run.map(([, to]) => to)), x, y);
  const bottoms = outline(days, spans.map((run) => run.map(([from]) => from)), x, y);
  return `M${tops.join('L')}L${bottoms.reverse().join('L')}Z`;
}

/** Where the value axis draws a line: every multiple of a 1, 2 or 5
 *  times a power of ten step inside the domain, counted from zero as
 *  `i * step` so each is an exact integer. The step is the smallest
 *  such number, never below 1, that fits `count` of them in the span
 *  (net-worth-view.md, Value ticks). */
export function valueTicks(bottom, top, count) {
  const step = niceStep((top - bottom) / count);
  const ticks = [];
  for (let i = Math.ceil(bottom / step); i * step <= top; i += 1) ticks.push(i * step || 0);
  return ticks;
}

function niceStep(rough) {
  if (rough <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((factor) => factor * magnitude).find((step) => step >= rough);
}

const UNITS = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

/** A tick's label: whole below a thousand, else its magnitude in the
 *  largest of thousands, millions and billions that fits, to one
 *  decimal with no trailing zero. The step rule makes that exact, so a
 *  label never rounds its line (net-worth-view.md, Value ticks). */
export function tickLabel(value, group, point) {
  const abs = Math.abs(value);
  const [size, suffix] = UNITS.find(([unit]) => abs >= unit) || [1, ''];
  const tenths = Math.round((abs * 10) / size);
  const mantissa = `${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ''}`;
  return decimal.toStoredDisplay(`${value < 0 ? '-' : ''}${mantissa}`, group, point) + suffix;
}

/** The table fallback. A static aria-label on the SVG is not
 *  sufficient for the primary screen of the app, so the same series is
 *  exposed as a real table behind a disclosure. */
export function chartTable(days, bands, format) {
  return el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Date' }),
        ...bands.map((band) => el('th', { class: 'numeric', text: band.label })),
      ]),
    ]),
    el(
      'tbody',
      {},
      days.map((day, index) =>
        el('tr', {}, [
          el('td', { text: format.date(isoFromDay(day)) }),
          ...bands.map((band) =>
            el('td', {
              class: 'numeric',
              text: format.money(band.points[index]),
            }),
          ),
        ]),
      ),
    ),
  ]);
}
