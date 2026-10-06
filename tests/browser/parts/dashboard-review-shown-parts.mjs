// Every set of figures shown as the parts of a figure adds up to it as
// shown, written from spec/features/net-worth-view.md (Hero figure and
// acceptance criteria 74 and 75) without reading how the screen is built
// or tested: the holdings table to the total at the money places, the
// legend to the chart's right hand edge, the legend's changes over a
// span to the change, and the readout's rows to its net. The whole
// rounds once, half-even, and its parts by largest remainder, ties to
// the earlier part in screen order.
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
const unitOf = (places) => 10n ** BigInt(SCALE - places);
// The spec's method: exact parts to shown parts, in units of `places`.
const shares = (parts, places) => {
  const unit = unitOf(places);
  const floors = parts.map((p) => floorDiv(p, unit));
  const rests = parts.map((p, i) => p - floors[i] * unit);
  let missing = halfEvenDiv(parts.reduce((a, b) => a + b, 0n), unit) - floors.reduce((a, b) => a + b, 0n);
  const order = parts.map((_, i) => i).sort((a, b) => (rests[b] > rests[a] ? 1 : rests[b] < rests[a] ? -1 : a - b));
  for (const i of order) if (missing-- > 0n) floors[i] += 1n;
  return floors;
};
const exactOf = (decimal) => {
  const [whole, frac = ''] = decimal.replace('-', '').split('.');
  const n = BigInt(whole) * ONE + BigInt(frac.padEnd(SCALE, '0'));
  return decimal.startsWith('-') ? -n : n;
};
// A figure as shown under en-US, in units of `places`: the currency code,
// the group commas and a leading plus dropped. `null` for anything else,
// a minus on zero included.
const shown = (text, places) => {
  const body = (text || '').replace(/[A-Z]{3}/g, '').replace(/[,\s+]/g, '');
  const match = /^([−-]?)([0-9]+)(?:\.([0-9]+))?$/.exec(body);
  if (!match || (match[3] || '').length !== places) return null;
  const n = BigInt(match[2] + (match[3] || ''));
  if (match[1] && n === 0n) return null;
  return match[1] ? -n : n;
};
const sum = (list) => list.reduce((a, b) => a + b, 0n);
const within = (got, exact, places) => got !== null && got * unitOf(places) - exact < unitOf(places) && exact - got * unitOf(places) < unitOf(places);

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
// The second adds figures finer than a cent, so that each set rounded
// part by part misses its whole at either number of places.
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

  // Criterion 74: with no decimals on money, three holdings of 0.40 alone
  // in their bands read 1, 0 and 0 in the table and the breakdown,
  // under a total of 1.
  await setProfile({ moneyPlaces: '0' });
  await plantHistory(FIRST);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
  await groupBy('liq');
  const first = await screen();
  check('net-worth-view: criterion 74, three holdings of 0.40 read 1, 0 and 0 in the holdings table, under a total of 1',
    JSON.stringify(first.table.map(([name, figure]) => [name, shown(figure, 0)].join(' '))) === JSON.stringify(['Pocket 1', 'Fund 0', 'Flat 0']) &&
      shown(first.total, 0) === 1n,
    JSON.stringify(first));
  check('net-worth-view: criterion 74, the same three read 1, 0 and 0 in the breakdown',
    JSON.stringify(first.bars.map(([name, figure]) => [name, shown(figure, 0)].join(' '))) === JSON.stringify(['Cash 1', 'Invested 0', 'Fixed 0']),
    JSON.stringify(first.bars));

  await plantHistory(SECOND, FIRST);
  for (const places of [0, 2]) {
    await setProfile({ moneyPlaces: String(places) });
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
    await groupBy('liq');
    await control('.range-buttons', 'All');
    await control('.chart-card', 'Absolute');
    const where = `at ${places} places`;
    const now = await screen();

    // The holdings table, in creation order, to the total at the money
    // places.
    const exactRows = latest(SECOND);
    const names = HOLDINGS.map(([name]) => name);
    const wantRows = shares(names.map((n) => exactRows[n]), places);
    const gotRows = now.table.map(([, figure]) => shown(figure, places));
    check(`net-worth-view: the holdings table's figures read as the spec's rounding gives ${where}`,
      JSON.stringify(now.table.map(([n]) => n)) === JSON.stringify(names) && gotRows.every((g, i) => g === wantRows[i]),
      `${JSON.stringify(now.table)}, wants ${wantRows.join(', ')}`);
    check(`net-worth-view: the holdings table's figures add up to the total at the money places ${where}`,
      gotRows.every((g) => g !== null) && sum(gotRows) === halfEvenDiv(sum(Object.values(exactRows)), unitOf(places)),
      JSON.stringify(now.table));

    // The legend, at the right hand edge, today, which on latest rates
    // is the total the hero shows.
    const lastDay = dayOf(TODAY);
    const edge = bandsAt(SECOND, lastDay);
    const gotLegend = now.legend.map(([, value]) => shown(value, 0));
    check(`net-worth-view: the legend reads as the spec's rounding gives at the right hand edge ${where}`,
      JSON.stringify(now.legend.map(([name]) => name)) === JSON.stringify(BANDS) &&
        JSON.stringify(gotLegend.map(String)) === JSON.stringify(shares(edge, 0).map(String)),
      `${JSON.stringify(now.legend)}, exact ${edge.join(', ')}`);
    check(`net-worth-view: the legend adds up to the right hand edge as shown, which is the total ${where}`,
      gotLegend.every((g) => g !== null) && sum(gotLegend) === halfEvenDiv(sum(edge), ONE) && sum(gotLegend) === shown(now.total, 0),
      `${JSON.stringify(now.legend)} against ${now.total}`);

    // The readout on every day of the range, interpolated days included.
    const days = await readouts();
    const wrong = days.filter(({ date, rows, net }) => {
      const exact = bandsAt(SECOND, dayOfShown(date));
      const got = rows.map(([, figure]) => shown(figure, places));
      const want = shares(exact, places);
      return JSON.stringify(rows.map(([name]) => name)) !== JSON.stringify(BANDS) ||
        got.some((g, i) => g !== want[i] || !within(g, exact[i], places)) ||
        sum(got) !== shown(net, places);
    });
    check(`net-worth-view: on every day the readout's rows read as the spec's rounding gives and add up to its net ${where}`,
      days.length > 10 && wrong.length === 0,
      `${days.length} days, ${wrong.length} wrong: ${JSON.stringify(wrong.slice(0, 3))}`);

    // A span from the middle recording to the last, dragged across the
    // plot: the legend's changes add up to the hero's.
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
    const gotDeltas = selected.legend.map(([, , delta]) => shown(delta, 0));
    const change = shown((selected.change || '').split('·')[0].replace('−', '-'), 0);
    check(`net-worth-view: the legend's changes over a span read as the spec's rounding gives ${where}`,
      JSON.stringify(gotDeltas.map(String)) === JSON.stringify(shares(exactDeltas, 0).map(String)) &&
        gotDeltas.every((g, i) => within(g, exactDeltas[i], 0)),
      `${selected.since}: ${JSON.stringify(selected.legend)}, exact ${exactDeltas.join(', ')}`);
    check(`net-worth-view: the legend's changes over a span add up to the change as shown ${where}`,
      gotDeltas.every((g) => g !== null) && change === halfEvenDiv(sum(exactDeltas), ONE) && sum(gotDeltas) === change,
      `${JSON.stringify(selected.legend)} against ${selected.change}`);
    // A plain click on a day with no recording clears the span.
    await pointAt('pointerdown', dayOf('2026-01-09'));
    await pointAt('pointerup', dayOf('2026-01-09'));
    await page.frames();

    // With a band hidden, the readout lists the visible bands, and they
    // add up to its net, which covers only them.
    await page.call(() => [...document.querySelectorAll('.legend-entry')].find((e) => e.querySelector('.legend-name').textContent === 'Fixed').click());
    await page.frames();
    const visible = [0, 1, 3];
    const hiddenWrong = (await readouts()).filter(({ date, rows, net }) => {
      const exact = bandsAt(SECOND, dayOfShown(date)).filter((_, i) => visible.includes(i));
      const got = rows.map(([, figure]) => shown(figure, places));
      const want = shares(exact, places);
      return JSON.stringify(rows.map(([name]) => name)) !== JSON.stringify(visible.map((i) => BANDS[i])) ||
        got.some((g, i) => g !== want[i]) || sum(got) !== shown(net, places);
    });
    check(`net-worth-view: with a band hidden the readout's rows add up to its net as shown ${where}`,
      hiddenWrong.length === 0, JSON.stringify(hiddenWrong.slice(0, 3)));
    await page.call(() => [...document.querySelectorAll('.legend-entry')].find((e) => e.querySelector('.legend-name').textContent === 'Fixed').click());
    await page.frames();
  }

  // The hero follows the readout with the day's net rounded once: a net
  // of exactly 4.505 reads 5, never 4.50 rounded again to 4.
  await plant([{ type: 'snapshot', accountId: ids.Loose, payload: { date: '2026-01-12', value: '0.295', note: null } }]);
  await setProfile({ moneyPlaces: '2' });
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
    followed.date === 'Jan 14, 2026' && shown(resting, 0) === 5n && shown(followed.hero, 0) === 5n && shown(followed.net, 2) === 450n,
    JSON.stringify({ resting, followed }));
}, { signsIn: false });
