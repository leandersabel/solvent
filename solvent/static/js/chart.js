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
export const UNASSIGNED_FILL = '#d8dfe1';
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

/** Draw one stacked area chart.
 *
 *  Asset bands stack up from zero, liability bands mirror down in the
 *  same group color, and the net-worth line runs over the top. The
 *  side of the axis carries the sign, so a band keeps its hue on both
 *  sides. */
export function drawChart({ days, bands, marks, annotations, percentage, justTheLine, onPickDate, onHover }) {
  const width = 900;
  const height = 320;
  const pad = { top: 16, right: 16, bottom: 32, left: 64 };

  if (!days.length) return el('p', { class: 'empty-line', text: 'No history yet.' });

  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const spanDays = Math.max(1, lastDay - firstDay);
  const x = (day) => pad.left + ((day - firstDay) / spanDays) * plotWidth;

  // Assets above the zero line, liabilities below it, each side
  // stacked in band order.
  const stacked = bands.map((band) => ({ band, upper: [], lower: [] }));
  const netLine = days.map(() => 0);
  const positiveTotals = days.map(() => 0);
  const negativeTotals = days.map(() => 0);

  days.forEach((_, index) => {
    let up = 0;
    let down = 0;
    for (const layer of stacked) {
      const value = toNumber(layer.band.points[index]);
      if (value >= 0) {
        layer.upper[index] = [up, up + value];
        layer.lower[index] = null;
        up += value;
      } else {
        layer.upper[index] = null;
        layer.lower[index] = [down, down + value];
        down += value;
      }
      netLine[index] += value;
    }
    positiveTotals[index] = up;
    negativeTotals[index] = down;
  });

  const normalize = (index, value, negative) => {
    if (!percentage) return value;
    const base = negative ? Math.abs(negativeTotals[index]) : positiveTotals[index];
    return base === 0 ? 0 : (value / base) * 100;
  };

  let top = 0;
  let bottom = 0;
  days.forEach((_, index) => {
    top = Math.max(top, normalize(index, positiveTotals[index], false));
    bottom = Math.min(bottom, -normalize(index, Math.abs(negativeTotals[index]), true));
    if (!percentage) {
      top = Math.max(top, netLine[index]);
      bottom = Math.min(bottom, netLine[index]);
    }
  });
  if (top === bottom) top = bottom + 1;
  const y = (value) =>
    pad.top + plotHeight - ((value - bottom) / (top - bottom)) * plotHeight;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'trend',
    role: 'img',
    tabindex: '0',
    'aria-label': 'Net worth over time',
    preserveAspectRatio: 'none',
  });

  for (const gridValue of gridLines(bottom, top)) {
    root.append(
      svg('line', {
        x1: pad.left,
        x2: width - pad.right,
        y1: y(gridValue),
        y2: y(gridValue),
        class: gridValue === 0 ? 'zero-line' : 'gridline',
      }),
    );
    const tick = svg('text', {
      x: pad.left - 8,
      y: y(gridValue) + 4,
      class: 'axis-tick',
      'text-anchor': 'end',
    });
    tick.textContent = percentage
      ? `${Math.round(gridValue)}%`
      : compact(gridValue);
    root.append(tick);
  }

  stacked.forEach((layer, index) => {
    const fill = fillFor(layer.band, index);
    const upper = areaPath(days, layer.upper, x, y, (i, v, neg) => normalize(i, v, neg), false);
    if (upper) root.append(svg('path', { d: upper, fill, 'fill-opacity': '0.85' }));
    const lower = areaPath(days, layer.lower, x, y, (i, v, neg) => normalize(i, v, neg), true);
    if (lower) root.append(svg('path', { d: lower, fill, 'fill-opacity': '0.45' }));
  });

  const linePoints = days
    .map((day, index) => `${x(day)},${y(percentage ? 0 : netLine[index])}`)
    .join(' ');
  if (!percentage) {
    root.append(svg('polyline', { points: linePoints, class: 'net-line' }));
  }

  // Ticks under the axis at every date carrying at least one
  // snapshot, on from the moment the chart loads: the accurate
  // drawing is the one nobody should have to ask for, and the tick is
  // also the way into that date's recording.
  if (!justTheLine) {
    for (const date of marks) {
      const day = Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);
      if (day < firstDay || day > lastDay) continue;
      const tick = svg('line', {
        x1: x(day),
        x2: x(day),
        y1: pad.top + plotHeight + 2,
        y2: pad.top + plotHeight + 8,
        class: 'entry-mark',
      });
      tick.style.cursor = 'pointer';
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
      y2: pad.top + plotHeight,
      class: 'archive-annotation',
    });
    const title = svg('title');
    title.textContent = `${annotation.label} archived`;
    marker.append(title);
    root.append(marker);
  }

  for (const [index, day] of [0, days.length - 1].entries()) {
    const label = svg('text', {
      x: index === 0 ? pad.left : width - pad.right,
      y: height - 8,
      class: 'axis-tick',
      'text-anchor': index === 0 ? 'start' : 'end',
    });
    label.textContent = isoFromDay(days[day]);
    root.append(label);
  }

  if (onHover) {
    root.addEventListener('pointermove', (event) => {
      const box = root.getBoundingClientRect();
      const ratio = (event.clientX - box.left) / box.width;
      const day = Math.round(firstDay + ratio * spanDays);
      let nearest = 0;
      days.forEach((candidate, index) => {
        if (Math.abs(candidate - day) < Math.abs(days[nearest] - day)) nearest = index;
      });
      onHover(nearest);
    });
    root.addEventListener('pointerleave', () => onHover(null));
    root.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        onHover(event.key === 'ArrowRight' ? 1 : -1, true);
      }
    });
  }

  return root;
}

function areaPath(days, spans, x, y, normalize, negative) {
  const present = spans.some((span) => span !== null);
  if (!present) return null;
  const tops = [];
  const bottoms = [];
  days.forEach((day, index) => {
    const span = spans[index] || [0, 0];
    const base = normalize(index, span[0], negative);
    const edge = normalize(index, span[1], negative);
    tops.push(`${x(day)},${y(negative ? -Math.abs(edge) : edge)}`);
    bottoms.push(`${x(day)},${y(negative ? -Math.abs(base) : base)}`);
  });
  return `M${tops.join('L')}L${bottoms.reverse().join('L')}Z`;
}

function gridLines(bottom, top) {
  const lines = [0];
  const step = niceStep((top - bottom) / 4);
  for (let value = 0; value <= top; value += step) lines.push(value);
  for (let value = -step; value >= bottom; value -= step) lines.push(value);
  return [...new Set(lines)].sort((a, b) => a - b);
}

function niceStep(rough) {
  if (rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const factor of [1, 2, 5, 10]) {
    if (rough <= factor * magnitude) return factor * magnitude;
  }
  return 10 * magnitude;
}

function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(Math.round(value));
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
