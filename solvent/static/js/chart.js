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
import { isoFromDay } from './model.js';

const NS = 'http://www.w3.org/2000/svg';

// Categorical slots, assigned in fixed order and never cycled
// (spec/ui/design-system.md, Chart palette).
export const SLOTS = ['#0098b7', '#ad7d00', '#964265', '#7f79d1'];
export const UNASSIGNED_FILL = '#c4cccf';
export const OTHER_FILL = '#798285';

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
 *  Pure, so the arithmetic is tested without a page. */
export function stack(bands, percentage = false) {
  const count = bands.length ? bands[0].points.length : 0;
  const layers = bands.map((band) => ({ band, upper: [], lower: [] }));
  const net = [];
  for (let index = 0; index < count; index += 1) {
    const sides = layers.map((layer) => [
      toNumber(layer.band.assets[index]),
      toNumber(layer.band.liabilities[index]),
    ]);
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

/** Draw one stacked area chart.
 *
 *  Asset parts stack up from zero at 85% opacity, liability parts
 *  mirror down in the same band color at 45%, and the net-worth line
 *  runs over the top. The side of the axis carries the sign, so a band
 *  keeps its hue on both sides. A band in `hidden` is left out of the
 *  stack and the line, and keeps its color slot. */
export function drawChart({
  days, bands, marks, annotations, percentage, justTheLine, onPickDate, onHover, onSelect, width = 900, locale,
  hidden = new Set(), selection = null,
}) {
  // A phone-width card gets a shorter plot, fewer gridlines, and the
  // value labels inside the plot rather than in a gutter beside it.
  const narrow = width < 560;
  const height = narrow ? 206 : 352;
  const pad = narrow
    ? { top: 4, right: 6, bottom: 36, left: 0 }
    : { top: 8, right: 6, bottom: 44, left: 48 };

  if (!days.length) return el('p', { class: 'empty-line', text: 'No history yet.' });

  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const plotBottom = pad.top + plotHeight;
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const spanDays = Math.max(1, lastDay - firstDay);
  const x = (day) => pad.left + ((day - firstDay) / spanDays) * plotWidth;

  const fills = new Map(bands.map((band, index) => [band, fillFor(band, index)]));
  const { layers, net: netLine } = stack(bands.filter((band) => !hidden.has(band.id)), percentage);

  let top = 0;
  let bottom = 0;
  days.forEach((_, index) => {
    for (const layer of layers) {
      top = Math.max(top, layer.upper[index][1]);
      bottom = Math.min(bottom, layer.lower[index][1]);
    }
    if (!percentage) {
      top = Math.max(top, netLine[index]);
      bottom = Math.min(bottom, netLine[index]);
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

  // Gridlines under the fills, the value each one marks over them, so
  // a label inside a narrow plot stays readable.
  const grid = gridLines(bottom, top, narrow ? 3 : 6);
  const valueLabels = [];
  for (const gridValue of grid) {
    const at = y(gridValue);
    if (gridValue !== 0) {
      root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: at, y2: at, class: 'gridline' }));
    }
    const tick = narrow
      ? svg('text', { x: 1, y: at + 13 > plotBottom ? at - 4 : at + 13, class: 'axis-tick' })
      : svg('text', { x: pad.left - 10, y: at + 4, class: 'axis-tick', 'text-anchor': 'end' });
    tick.textContent = percentage ? `${Math.round(gridValue)}%` : compact(gridValue);
    valueLabels.push(tick);
  }

  for (const layer of layers) {
    const fill = fills.get(layer.band);
    for (const [spans, opacity] of [[layer.upper, '0.85'], [layer.lower, '0.45']]) {
      const d = areaPath(days, spans, x, y);
      if (d) {
        root.append(svg('path', { d, fill, 'fill-opacity': opacity, class: 'band', 'data-band': layer.band.id }));
      }
    }
  }

  // The zero line over the fills, a step darker than a gridline.
  root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0), class: 'zero-line' }));
  root.append(...valueLabels);

  if (!percentage) {
    const linePoints = days.map((day, index) => `${x(day)},${y(netLine[index])}`).join(' ');
    root.append(svg('polyline', { points: linePoints, class: 'net-line' }));
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
      const day = Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);
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
      title.textContent = `${date}, recorded. Open this recording.`;
      tick.append(title);
      root.append(tick);
    }
  }

  for (const annotation of annotations) {
    const day = Math.round(Date.parse(annotation.date + 'T00:00:00Z') / 86400000);
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

  for (const { day, text } of timeLabels(firstDay, lastDay, plotWidth, locale)) {
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
      x: x(days[from]),
      y: pad.top,
      width: Math.max(1, x(days[to]) - x(days[from])),
      height: plotHeight,
      class: 'selection',
    }));
  }
  const crosshair = svg('line', { y1: pad.top, y2: plotBottom, class: 'crosshair', visibility: 'hidden' });
  const dragging = svg('rect', { y: pad.top, height: plotHeight, class: 'selection', visibility: 'hidden' });
  root.append(dragging, crosshair);

  // Hover, drag and the keyboard all move one crosshair. `onHover`
  // hears the index under it and where it sits across the plot, and
  // null when it leaves.
  let current = null;
  const point = (index) => {
    current = index;
    if (index === null) {
      crosshair.setAttribute('visibility', 'hidden');
      if (onHover) onHover(null);
      return;
    }
    const at = x(days[index]);
    crosshair.setAttribute('x1', at);
    crosshair.setAttribute('x2', at);
    crosshair.setAttribute('visibility', 'visible');
    if (onHover) onHover(index, at / width);
  };
  const nearest = (event) => {
    const box = root.getBoundingClientRect();
    const scale = box.width / width;
    const ratio = (event.clientX - box.left - pad.left * scale) / (plotWidth * scale);
    const day = Math.round(firstDay + ratio * spanDays);
    let found = 0;
    days.forEach((candidate, index) => {
      if (Math.abs(candidate - day) < Math.abs(days[found] - day)) found = index;
    });
    return found;
  };

  // A drag selects the span between two dates, and a plain click
  // clears it.
  let anchor = null;
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.classList.contains('entry-mark')) return;
    anchor = nearest(event);
  });
  root.addEventListener('pointermove', (event) => {
    const index = nearest(event);
    point(index);
    if (anchor === null || index === anchor) return;
    const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)];
    dragging.setAttribute('x', x(days[from]));
    dragging.setAttribute('width', Math.max(1, x(days[to]) - x(days[from])));
    dragging.setAttribute('visibility', 'visible');
  });
  root.addEventListener('pointerup', (event) => {
    if (anchor === null) return;
    const index = nearest(event);
    const span = index === anchor ? null : [Math.min(anchor, index), Math.max(anchor, index)];
    anchor = null;
    dragging.setAttribute('visibility', 'hidden');
    if (onSelect && (span || selection)) onSelect(span);
  });
  root.addEventListener('pointerleave', () => {
    anchor = null;
    dragging.setAttribute('visibility', 'hidden');
    point(null);
  });

  // The keyboard steps between recorded dates, and Enter opens the one
  // under the crosshair.
  const recorded = days
    .map((day, index) => (marks.includes(isoFromDay(day)) ? index : null))
    .filter((index) => index !== null);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (!recorded.length) return;
      const forward = event.key === 'ArrowRight';
      const next = current === null
        ? recorded[recorded.length - 1]
        : forward
          ? recorded.find((index) => index > current)
          : [...recorded].reverse().find((index) => index < current);
      if (next !== undefined) point(next);
      return;
    }
    if (event.key === 'Enter' && current !== null && recorded.includes(current) && onPickDate) {
      onPickDate(isoFromDay(days[current]));
    }
    if (event.key === 'Escape') point(null);
  });
  root.addEventListener('blur', () => point(null));

  return root;
}

/** Labels along the time axis: years over a long span, months over a
 *  shorter one, days over a few weeks. Spaced so no two collide, and
 *  none placed where it would run off either end of the plot. */
function timeLabels(firstDay, lastDay, plotWidth, locale) {
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
    const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const step = Math.max(1, Math.ceil(72 / perDay));
    margin = 24;
    for (let day = firstDay; day <= lastDay; day += step) {
      candidates.push({ day, text: short.format(new Date(day * 86400000)) });
    }
  }
  return candidates.filter(({ day }) => {
    const at = (day - firstDay) * perDay;
    return at >= margin && at <= plotWidth - margin;
  });
}

function areaPath(days, spans, x, y) {
  if (!spans.some(([from, to]) => from !== to)) return null;
  const tops = days.map((day, index) => `${x(day)},${y(spans[index][1])}`);
  const bottoms = days.map((day, index) => `${x(day)},${y(spans[index][0])}`);
  return `M${tops.join('L')}L${bottoms.reverse().join('L')}Z`;
}

function gridLines(bottom, top, count) {
  const lines = [0];
  const step = niceStep((top - bottom) / count);
  for (let value = step; value <= top; value += step) lines.push(value);
  for (let value = -step; value >= bottom; value -= step) lines.push(value);
  return lines.sort((a, b) => a - b);
}

function niceStep(rough) {
  if (rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 5, 10]) {
    if (rough <= factor * magnitude) return factor * magnitude;
  }
  return 10 * magnitude;
}

/** "1.5M", "500k", "−1M": the axis needs magnitude, not precision. */
function compact(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '\u2212' : '';
  const short = (n) => String(Number(n.toFixed(1)));
  if (abs >= 1e9) return `${sign}${short(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${short(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}k`;
  return `${sign}${Math.round(abs)}`;
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
