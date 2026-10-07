// The hero while the chart reads a day, written from
// spec/features/net-worth-view.md alone (Hero figure; Trend chart card,
// Hover and Keyboard; Legend; acceptance criterion 66): the hero follows
// the day, its total the readout's net, and gross assets and gross
// liabilities as shown add up to that total as shown, by the spec's
// rounding. With a band hidden the total covers only the visible bands,
// and so do its parts. Leaving the chart returns the hero.
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
// The spec's method in whole units: the whole rounds once, half-even,
// each part toward minus infinity, and the units missing go to the
// largest remainders, ties to the earlier part.
const shares = (parts) => {
  const floors = parts.map((p) => floorDiv(p, ONE));
  const rests = parts.map((p, i) => p - floors[i] * ONE);
  let missing = halfEvenDiv(parts.reduce((a, b) => a + b, 0n), ONE) - floors.reduce((a, b) => a + b, 0n);
  const order = parts.map((_, i) => i).sort((a, b) => (rests[b] > rests[a] ? 1 : rests[b] < rests[a] ? -1 : a - b));
  for (const i of order) if (missing-- > 0n) floors[i] += 1n;
  return floors;
};
const exactOf = (decimal) => {
  const [whole, frac = ''] = decimal.replace('-', '').split('.');
  const n = BigInt(whole) * ONE + BigInt(frac.padEnd(SCALE, '0'));
  return decimal.startsWith('-') ? -n : n;
};
// A whole figure as shown under en-US, the currency code, group commas
// and a leading plus dropped. `null` for a dash or anything else.
const shown = (text) => {
  const match = /^([−-]?)([0-9]+)$/.exec((text || '').replace(/[A-Z]{3}|[,\s+]/g, ''));
  if (!match) return null;
  return match[1] ? -BigInt(match[2]) : BigInt(match[2]);
};
// Gross liabilities as shown, signed, whether the screen writes them
// with their minus or as a magnitude.
const owed = (text) => {
  const n = shown(text);
  return n === null ? null : n > 0n ? -n : n;
};

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

// Each band holds holdings of one sign, so gross assets and liabilities
// read the same whether summed by holding or by band.
const HOLDINGS = [
  ['Fund', 'CHF', { liq: 'cash' }, 'Cash'],
  ['Gold', 'CHF', { liq: 'inv' }, 'Invested'],
  ['Debt', 'CHF', { liq: 'fixed' }, 'Fixed'],
  ['Loan', 'CHF', {}, 'Unassigned'],
];
// On the first day assets are 110.60 and liabilities −50.40, so the net
// of 60.20 reads 60 where each side rounded alone reads 111 and −50.
const HISTORY = {
  Fund: [['2026-01-01', '100.15'], ['2026-01-10', '300.20']],
  Gold: [['2026-01-01', '10.45']],
  Debt: [['2026-01-01', '-50.40'], ['2026-01-10', '-80.70']],
  Loan: [['2026-01-08', '-20.45']],
};
const TODAY = '2026-01-14';

// The gross sides at `day`, over the holdings in `bands`.
const sidesAt = (day, bands) => {
  const values = HOLDINGS.filter((h) => bands.includes(h[3])).map(([name]) => valueAt(HISTORY[name], day));
  return [values.filter((v) => v > 0n).reduce((a, b) => a + b, 0n), values.filter((v) => v < 0n).reduce((a, b) => a + b, 0n)];
};

// The hero as shown, and the date the chart reads.
const hero = () =>
  page.call(() => {
    const root = document.querySelector('.dashboard .hero');
    const labelled = (name) => {
      const label = [...root.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === name);
      return label ? label.parentElement.textContent.replace(name, '').trim() : null;
    };
    const at = root.querySelector('.hero-at');
    return {
      total: root.querySelector('.hero-amount')?.textContent.trim() ?? null,
      assets: labelled('Assets'),
      liabilities: labelled('Liabilities'),
      date: at && !at.hidden ? at.textContent.trim() : '',
      readout: document.querySelector('.chart-readout .readout-date')?.textContent.trim() || '',
    };
  });

// What is wrong with the hero `h` on the day it reads, over `bands`.
const wrongOn = (h, bands) => {
  const day = dayOfShown(h.readout);
  if (Number.isNaN(day)) return 'no day read';
  const [assets, liabilities] = sidesAt(day, bands);
  const [wantAssets, wantLiabilities] = shares([assets, liabilities]);
  const wantTotal = halfEvenDiv(assets + liabilities, ONE);
  const got = [shown(h.total), shown(h.assets), owed(h.liabilities)];
  if (got[0] !== wantTotal) return `total ${h.total}, wants ${wantTotal}`;
  if (got[1] !== wantAssets || got[2] !== wantLiabilities) return `assets ${h.assets} and liabilities ${h.liabilities}, want ${wantAssets} and ${wantLiabilities}`;
  if (got[1] + got[2] !== got[0]) return 'the sides do not add up to the total as shown';
  return null;
};

// Focus on the chart, Home, then every day to the last, with the hero
// on each, then 5 January, whose figures are not today's, and the hero
// once the chart loses focus.
const walk = async () => {
  await page.eval("document.activeElement && document.activeElement.blur()");
  await page.eval("document.querySelector('.chart-frame svg.trend').focus()");
  await page.frames();
  const days = [];
  for (let key = 'Home'; ; key = 'ArrowRight') {
    await page.key(key);
    await page.frames();
    const now = await hero();
    if (days.length && now.readout === days.at(-1).readout) break;
    days.push(now);
  }
  await page.key('Home');
  for (let n = 0; n < 4; n += 1) await page.key('ArrowRight');
  await page.frames();
  const before = await hero();
  await page.eval("document.querySelector('.chart-frame svg.trend').blur()");
  await page.frames();
  return { days, before, after: await hero() };
};

// The real pointer over `iso`, then the hero, then the pointer off the
// chart and the hero again.
const hover = async (iso) => {
  const plot = await page.call(() => {
    const svg = document.querySelector('.chart-frame svg.trend');
    svg.scrollIntoView({ block: 'center' });
    const box = svg.getBoundingClientRect();
    const zero = svg.querySelector('.zero-line');
    return { left: box.left, y: box.top + box.height / 2, scale: box.width / svg.viewBox.baseVal.width, x0: Number(zero.getAttribute('x1')), x1: Number(zero.getAttribute('x2')) };
  });
  const span = dayOf(TODAY) - dayOf('2026-01-01');
  const x = plot.left + (plot.x0 + ((dayOf(iso) - dayOf('2026-01-01')) * (plot.x1 - plot.x0)) / span) * plot.scale;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: plot.y });
  await page.frames();
  const on = await hero();
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await page.frames();
  return { on, off: await hero() };
};

const resting = (h) => ({ total: h.total, assets: h.assets, liabilities: h.liabilities, date: h.date });
const same = (a, b) => JSON.stringify(resting(a)) === JSON.stringify(resting(b));

await run(async () => {
  await vaultOwner();
  await holdToday(TODAY);
  const ids = await holdings(HOLDINGS.map(([name, unit, dims]) => [name, unit, dims]));
  await setProfile({
    dimensions: [{ id: 'liq', label: 'Liquidity', values: [{ id: 'cash', label: 'Cash' }, { id: 'inv', label: 'Invested' }, { id: 'fixed', label: 'Fixed' }] }],
    locale: 'en-US',
    moneyPlaces: '2',
  });
  await plant(Object.entries(HISTORY).flatMap(([name, figures]) =>
    figures.map(([date, value]) => ({ type: 'snapshot', accountId: ids[name], payload: { date, value, note: null } }))));
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-amount') && document.querySelector('.chart-frame svg.trend')", { label: 'the dashboard' });
  const ALL = ['Cash', 'Invested', 'Fixed', 'Unassigned'];

  const atRest = await hero();
  check('net-worth-view 66: at rest, gross assets and liabilities read as the spec rounds today\'s figures and add up to the total as shown',
    atRest.date === '' && wrongOn({ ...atRest, readout: 'Jan 14, 2026' }, ALL) === null, JSON.stringify(atRest));

  // Under Total, one band holding both signs: the sides are the gross
  // figures of the day, never today's.
  const total = await walk();
  const totalWrong = total.days.map((h) => [h.readout, wrongOn(h, ALL)]).filter(([, w]) => w);
  check('net-worth-view 66: under Total, on every day the keyboard reads, the hero\'s gross assets and liabilities are that day\'s and add up to its total as shown',
    total.days.length === 14 && totalWrong.length === 0, `${total.days.length} days: ${JSON.stringify(totalWrong.slice(0, 3))}`);
  check('net-worth-view Trend chart card, Keyboard: on each day read the hero carries the readout\'s date',
    total.days.every((h) => h.date !== '' && h.date.includes(h.readout)), JSON.stringify(total.days.map((h) => [h.readout, h.date])));
  check('net-worth-view Trend chart card, Keyboard: leaving the chart returns the hero, gross assets and liabilities included',
    same(total.after, atRest), JSON.stringify({ before: total.before, after: total.after, atRest: resting(atRest) }));

  const first = await hover('2026-01-01');
  check('net-worth-view 66: hovering 1 January, gross assets read 111 and liabilities −51 under a total of 60, where each rounded alone gives 111 and −50',
    first.on.readout === 'Jan 1, 2026' && shown(first.on.total) === 60n && shown(first.on.assets) === 111n && owed(first.on.liabilities) === -51n,
    JSON.stringify(first.on));
  check('net-worth-view Trend chart card, Hover: leaving the plot returns the hero, gross assets and liabilities included',
    same(first.off, atRest), JSON.stringify({ off: resting(first.off), atRest: resting(atRest) }));

  // Under a dimension with a band hidden, the total read on the chart
  // covers only the visible bands, and so do its two sides.
  await page.call(() => {
    const s = document.querySelector('.chart-card select');
    s.value = 'liq';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.frames();
  for (const hidden of ['Cash', 'Fixed']) {
    await page.call((name) => [...document.querySelectorAll('.legend-entry')].find((e) => e.querySelector('.legend-name').textContent === name).click(), hidden);
    await page.frames();
    const visible = ALL.filter((b) => b !== hidden);
    const rest = await hero();
    check(`net-worth-view 66: with ${hidden} hidden, at rest, gross assets and liabilities add up to the total as shown`,
      shown(rest.assets) !== null && owed(rest.liabilities) !== null && shown(rest.assets) + owed(rest.liabilities) === shown(rest.total),
      JSON.stringify(rest));
    const read = await walk();
    const wrong = read.days.map((h) => [h.readout, wrongOn(h, visible)]).filter(([, w]) => w);
    check(`net-worth-view 66: with ${hidden} hidden, on every day the keyboard reads, the hero's total and both sides cover only the visible bands and add up as shown`,
      read.days.length === 14 && wrong.length === 0, `${read.days.length} days: ${JSON.stringify(wrong.slice(0, 3))}`);
    const pointed = await hover('2026-01-10');
    check(`net-worth-view 66: with ${hidden} hidden, hovering 10 January the hero's total and both sides cover only the visible bands`,
      pointed.on.readout === 'Jan 10, 2026' && wrongOn(pointed.on, visible) === null, `${JSON.stringify(pointed.on)}: ${wrongOn(pointed.on, visible)}`);
    check(`net-worth-view Trend chart card, Hover: with ${hidden} hidden, leaving the plot returns the hero as it rested`,
      same(pointed.off, rest), JSON.stringify({ off: resting(pointed.off), rest: resting(rest) }));
    await page.call((name) => [...document.querySelectorAll('.legend-entry')].find((e) => e.querySelector('.legend-name').textContent === name).click(), hidden);
    await page.frames();
  }
}, { signsIn: false });
