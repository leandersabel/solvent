// Every money figure rounds on its own, half-even, to whole units, and a
// total from the exact sum of its parts, written from
// spec/features/net-worth-view.md (Hero figure and acceptance criteria
// 74 and 75) without reading how the screen is built or tested: the
// holdings table, the legend at the chart's right hand edge, the
// legend's changes over a span, and the readout's rows. The figures are
// chosen so that sharing a total out among its parts would read
// otherwise, so a screen that still shares one out fails.
// Templates: dashboard.html. Modules: view-dashboard.js, decimal.js,
// model.js, format.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// Exact figures are integers at scale 12, as the value model holds them.
const SCALE = 12;
const ONE = 10n ** BigInt(SCALE);
const floorDiv = (a, b) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
const halfEvenDiv = (a, b) => {
  const q = floorDiv(a, b);
  const twice = (a - q * b) * 2n;
  return twice > b || (twice === b && q % 2n !== 0n) ? q + 1n : q;
};
// The spec's method: each exact figure to whole units on its own.
const whole = (exact) => halfEvenDiv(exact, ONE);
// What sharing a total out by largest remainder would show instead, to
// prove the figures below tell the two apart.
const shares = (parts) => {
  const floors = parts.map((p) => floorDiv(p, ONE));
  const rests = parts.map((p, i) => p - floors[i] * ONE);
  let missing = whole(parts.reduce((a, b) => a + b, 0n)) - floors.reduce((a, b) => a + b, 0n);
  const order = parts.map((_, i) => i).sort((a, b) => (rests[b] > rests[a] ? 1 : rests[b] < rests[a] ? -1 : a - b));
  for (const i of order) if (missing-- > 0n) floors[i] += 1n;
  return floors;
};
const differs = (parts) => JSON.stringify(shares(parts).map(String)) !== JSON.stringify(parts.map(whole).map(String));
const exactOf = (decimal) => {
  const [whole, frac = ''] = decimal.replace('-', '').split('.');
  const n = BigInt(whole) * ONE + BigInt(frac.padEnd(SCALE, '0'));
  return decimal.startsWith('-') ? -n : n;
};
// A figure as shown under en-US in whole units: the currency code, the
// group commas and a leading plus dropped. `null` for anything else, a
// decimal point or a minus on zero included.
const shown = (text) => {
  const body = (text || '').replace(/[A-Z]{3}/g, '').replace(/[,\s+]/g, '');
  const match = /^([−-]?)([0-9]+)$/.exec(body);
  if (!match) return null;
  const n = BigInt(match[2]);
  if (match[1] && n === 0n) return null;
  return match[1] ? -n : n;
};
const sum = (list) => list.reduce((a, b) => a + b, 0n);

// Day numbers from 1970-01-01, and a recorded history to read them in.
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
const dayOfShown = (text) => Date.parse(`${text} UTC`) / 86400000;
// A main-currency holding's value at `day`: nothing before its first
// figure, the chord between two, the last carried forward.
const valueAt = (figures, day) => {
  const points = figures.map(([iso, value]) => [dayOf(iso), exactOf(value)]);
  if (!points.length || day < points[0][0]) return 0n;
  for (let i = 1; i < points.length; i += 1) {
    const [d1, v1] = points[i - 1];
    const [d2, v2] = points[i];
    if (day < d2) return v1 + halfEvenDiv((v2 - v1) * BigInt(day - d1), BigInt(d2 - d1));
  }
  return points.at(-1)[1];
};

const BANDS = ['Cash', 'Invested', 'Fixed', 'Unassigned'];
const HOLDINGS = [
  ['Pocket', 'CHF', { liq: 'cash' }, 'Cash'],
  ['Fund', 'CHF', { liq: 'inv' }, 'Invested'],
  ['Flat', 'CHF', { liq: 'fixed' }, 'Fixed'],
  ['Loose', 'CHF', {}, 'Unassigned'],
];
// The first sitting: three holdings of 0.40, each alone in its band.
const FIRST = { Pocket: [['2026-01-01', '0.40']], Fund: [['2026-01-01', '0.40']], Flat: [['2026-01-01', '0.40']], Loose: [] };
// The second adds figures finer than a cent, so that sharing each set's
// total out would read otherwise than rounding each part alone.
const SECOND = {
  Pocket: [['2026-01-01', '0.40'], ['2026-01-11', '1.454']],
  Fund: [['2026-01-01', '0.40'], ['2026-01-08', '1.054'], ['2026-01-11', '1.454']],
  Flat: [['2026-01-01', '0.40'], ['2026-01-11', '1.302']],
  Loose: [['2026-01-08', '0.15']],
};
const bandsAt = (history, day) =>
  BANDS.map((band) => sum(HOLDINGS.filter((h) => h[3] === band).map(([name]) => valueAt(history[name], day))));
const latest = (history) => Object.fromEntries(HOLDINGS.map(([name]) => [name, history[name].length ? exactOf(history[name].at(-1)[1]) : null]));

const screen = () =>
  page.call(() => {
    const t = (node) => (node ? node.textContent : null);
    return {
      total: t(document.querySelector('.dashboard .hero-amount')),
      change: t(document.querySelector('.dashboard .hero-delta')),
      since: t(document.querySelector('.dashboard .hero-since')),
      table: [...document.querySelectorAll('.holdings-card tr')].filter((tr) => tr.querySelector('.cell-converted'))
        .map((tr) => [tr.querySelector('.cell-name').textContent, tr.querySelector('.cell-converted').textContent]),
      bars: [...document.querySelectorAll('.bars .bar-label')].map((b) => [t(b.querySelector('.bar-name')), t(b.querySelector('.bar-amount'))]),
      legend: [...document.querySelectorAll('.legend-entry')].map((e) => [t(e.querySelector('.legend-name')), t(e.querySelector('.legend-value')), t(e.querySelector('.legend-delta'))]),
    };
  });

// Every day of the range through the keyboard, Home first, with what
// the readout shows on each.
const readouts = () =>
  page.call(() => {
    const chart = document.querySelector('.chart-frame svg.trend');
    const press = (key) => chart.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const read = () => ({
      date: document.querySelector('.readout-date')?.textContent,
      rows: [...document.querySelectorAll('.chart-readout .readout-row:not(.readout-net)')].map((p) => [p.firstChild.textContent, p.lastChild.textContent]),
      net: document.querySelector('.readout-net .numeric')?.textContent,
    });
    chart.focus();
    press('Home');
    const seen = [];
    for (;;) {
      const now = read();
      if (seen.length && now.date === seen.at(-1).date) break;
      seen.push(now);
      press('ArrowRight');
    }
    chart.blur();
    return seen;
  });

const control = async (scope, label) => {
  await page.call((where, name) => [...document.querySelectorAll(`${where} button`)].find((b) => b.textContent.trim().startsWith(name)).click(), scope, label);
  await page.frames();
  await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the chart' });
};
const groupBy = async (id) => {
  await page.call((value) => {
    const s = document.querySelector('.chart-card select');
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.frames();
};

// The device's today, two days past the last recording, where the chart
// and every range end.
const TODAY = '2026-01-14';

await run(async () => {
  await vaultOwner();
  await holdToday(TODAY);
  const ids = await holdings(HOLDINGS.map(([name, unit, dims]) => [name, unit, dims]));
  await setProfile({
    dimensions: [{ id: 'liq', label: 'Liquidity', values: [{ id: 'cash', label: 'Cash' }, { id: 'inv', label: 'Invested' }, { id: 'fixed', label: 'Fixed' }] }],
    locale: 'en-US',
  });
  const plantHistory = (history, from = {}) =>
    plant(Object.entries(history).flatMap(([name, figures]) => figures
      .filter(([date]) => !(from[name] || []).some(([seen]) => seen === date))
      .map(([date, value]) => ({ type: 'snapshot', accountId: ids[name], payload: { date, value, note: null } }))));

  // Criterion 74: three holdings of 0.40 alone in their bands read 0, 0
  // and 0 in the table and the breakdown, under a total of 1.
  await plantHistory(FIRST);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
  await groupBy('liq');
  const first = await screen();
  check('net-worth-view: criterion 74, three holdings of 0.40 read 0, 0 and 0 in the holdings table, under a total of 1',
    JSON.stringify(first.table.map(([name, figure]) => [name, shown(figure)].join(' '))) === JSON.stringify(['Pocket 0', 'Fund 0', 'Flat 0']) &&
      shown(first.total) === 1n,
    JSON.stringify(first));
  check('net-worth-view: criterion 74, the same three read 0, 0 and 0 in the breakdown',
    JSON.stringify(first.bars.filter(([name]) => name !== 'Unassigned').map(([name, figure]) => [name, shown(figure)].join(' '))) ===
      JSON.stringify(['Cash 0', 'Invested 0', 'Fixed 0']),
    JSON.stringify(first.bars));

  await plantHistory(SECOND, FIRST);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
  await groupBy('liq');
  await control('.range-buttons', 'All');
  await control('.chart-card', 'Absolute');
  const now = await screen();

  // The holdings table, in creation order, each row its own exact figure
  // rounded, and the total the exact sum rounded.
  const exactRows = latest(SECOND);
  const names = HOLDINGS.map(([name]) => name);
  const rowParts = names.map((n) => exactRows[n]);
  check('net-worth-view: the holdings table\'s figures are chosen so sharing out the total would read otherwise',
    differs(rowParts), rowParts.join(', '));
  check('net-worth-view: each holdings table figure reads its own exact figure rounded half-even to whole units',
    JSON.stringify(now.table.map(([n]) => n)) === JSON.stringify(names) &&
      JSON.stringify(now.table.map(([, figure]) => String(shown(figure)))) === JSON.stringify(rowParts.map(whole).map(String)),
    `${JSON.stringify(now.table)}, exact ${rowParts.join(', ')}`);
  check('net-worth-view: the total reads the exact sum of the holdings rounded half-even',
    shown(now.total) === whole(sum(rowParts)), `${now.total}, exact ${sum(rowParts)}`);

  // Criterion 75: the legend, at the right hand edge, today.
  const edge = bandsAt(SECOND, dayOf(TODAY));
  check('net-worth-view: the legend\'s figures are chosen so sharing out the total would read otherwise', differs(edge), edge.join(', '));
  check('net-worth-view: criterion 75, each legend figure reads its own exact figure rounded half-even',
    JSON.stringify(now.legend.map(([name]) => name)) === JSON.stringify(BANDS) &&
      JSON.stringify(now.legend.map(([, value]) => String(shown(value)))) === JSON.stringify(edge.map(whole).map(String)),
    `${JSON.stringify(now.legend)}, exact ${edge.join(', ')}`);

  // Criterion 75: the readout on every day of the range, interpolated
  // days included, its net the exact sum rounded.
  const days = await readouts();
  const readWrong = (visible) => ({ date, rows, net }) => {
    const exact = bandsAt(SECOND, dayOfShown(date)).filter((_, i) => visible.includes(i));
    return JSON.stringify(rows.map(([name]) => name)) !== JSON.stringify(visible.map((i) => BANDS[i])) ||
      JSON.stringify(rows.map(([, figure]) => String(shown(figure)))) !== JSON.stringify(exact.map(whole).map(String)) ||
      shown(net) !== whole(sum(exact));
  };
  const all = [0, 1, 2, 3];
  check('net-worth-view: on some day the readout\'s figures are such that sharing out its net would read otherwise',
    days.some(({ date }) => differs(bandsAt(SECOND, dayOfShown(date)))), `${days.length} days`);
  const wrong = days.filter(readWrong(all));
  check('net-worth-view: criterion 75, on every day each readout row reads its own exact figure rounded half-even, and the net the exact sum rounded',
    days.length > 10 && wrong.length === 0,
    `${days.length} days, ${wrong.length} wrong: ${JSON.stringify(wrong.slice(0, 3))}`);

  // Criterion 75: a span from the middle recording to the last, dragged
  // across the plot.
  const plot = await page.call(() => {
    const svg = document.querySelector('svg.trend');
    const box = svg.getBoundingClientRect();
    const zero = svg.querySelector('.zero-line');
    return { left: box.left, top: box.top, scale: box.width / svg.viewBox.baseVal.width, x0: Number(zero.getAttribute('x1')), x1: Number(zero.getAttribute('x2')) };
  });
  const firstDay = dayOfShown(days[0].date);
  const span = dayOfShown(days.at(-1).date) - firstDay;
  const xOf = (day) => plot.left + (plot.x0 + ((day - firstDay) * (plot.x1 - plot.x0)) / span) * plot.scale;
  const pointAt = (type, day) =>
    page.call((name, clientX, clientY) => {
      document.querySelector('svg.trend').dispatchEvent(new PointerEvent(name, { clientX, clientY, button: 0, bubbles: true }));
    }, type, xOf(day), plot.top + 40);
  await pointAt('pointerdown', dayOf('2026-01-08'));
  await pointAt('pointermove', dayOf('2026-01-11'));
  await pointAt('pointerup', dayOf('2026-01-11'));
  await page.frames();
  await page.waitUntil("document.querySelectorAll('.legend-delta').length > 0", { label: 'a selected span' });
  const selected = await screen();
  const [, fromText, toText] = /^from (.+) to (.+)$/.exec(selected.since) || [];
  const early = bandsAt(SECOND, dayOfShown(fromText));
  const late = bandsAt(SECOND, dayOfShown(toText));
  const exactDeltas = late.map((v, i) => v - early[i]);
  const change = shown((selected.change || '').split('·')[0].replace('−', '-'));
  check('net-worth-view: the legend\'s changes are chosen so sharing out the change would read otherwise',
    differs(exactDeltas), `${selected.since}: ${exactDeltas.join(', ')}`);
  check('net-worth-view: criterion 75, each of the legend\'s changes over a span reads its own exact change rounded half-even',
    JSON.stringify(selected.legend.map(([, , delta]) => String(shown(delta)))) === JSON.stringify(exactDeltas.map(whole).map(String)),
    `${selected.since}: ${JSON.stringify(selected.legend)}, exact ${exactDeltas.join(', ')}`);
  check('net-worth-view: the change over a span reads the exact sum of the bands\' changes rounded half-even',
    change === whole(sum(exactDeltas)), `${selected.change}, exact ${sum(exactDeltas)}`);
  // A plain click on a day with no recording clears the span.
  await pointAt('pointerdown', dayOf('2026-01-09'));
  await pointAt('pointerup', dayOf('2026-01-09'));
  await page.frames();

  // With a band hidden, the readout lists the visible bands, each rounded
  // on its own, and a net that covers only them.
  const toggleFixed = async () => {
    await page.call(() => [...document.querySelectorAll('.legend-entry')].find((e) => e.querySelector('.legend-name').textContent === 'Fixed').click());
    await page.frames();
  };
  await toggleFixed();
  const hiddenWrong = (await readouts()).filter(readWrong([0, 1, 3]));
  check('net-worth-view: with a band hidden each readout row rounds on its own and the net is the visible bands\' exact sum rounded',
    hiddenWrong.length === 0, JSON.stringify(hiddenWrong.slice(0, 3)));
  await toggleFixed();

  // The hero follows the readout with the day's net rounded once: a net
  // of exactly 4.505 reads 5, never 4.50 rounded again to 4.
  await plant([{ type: 'snapshot', accountId: ids.Loose, payload: { date: '2026-01-12', value: '0.295', note: null } }]);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
  const resting = await page.call(() => document.querySelector('.dashboard .hero-amount').textContent);
  const followed = await page.call(() => {
    const chart = document.querySelector('.chart-frame svg.trend');
    chart.focus();
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    const read = {
      date: document.querySelector('.readout-date').textContent,
      net: document.querySelector('.readout-net .numeric').textContent,
      hero: document.querySelector('.dashboard .hero-amount').textContent,
    };
    chart.blur();
    return read;
  });
  check('net-worth-view: the hero reading the last day, today, rounds its net once, half-even, as the hero at rest does',
    followed.date === 'Jan 14, 2026' && shown(resting) === 5n && shown(followed.hero) === 5n && shown(followed.net) === 5n,
    JSON.stringify({ resting, followed }));
}, { signsIn: false });
