// The percentage view fills the plot, written from
// spec/features/net-worth-view.md (Ranges and modes, Absolute /
// percentage, and acceptance criteria 33 and 82) without reading how the
// screen is built or tested. A history where a recording puts every
// holding at zero on the day other holdings are first valued, on both
// sides, and a later one that puts every asset at zero until the next:
// under Total and under a dimension, the asset bands reach 100% and the
// liability bands −100% across every stretch between two drawn days,
// because assets and liabilities are above zero on every day inside
// each. The data table reads the same in either view and with a band
// hidden.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js.
import { check, click, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const KIND = {
  id: 'kind',
  label: 'Kind',
  values: [
    { id: 'cash', label: 'Cash' },
    { id: 'liquid', label: 'Liquid investments' },
    { id: 'fixed', label: 'Fixed investments' },
  ],
};

const HOLDINGS = [
  ['Purse', { kind: 'cash' }],
  ['Broker', { kind: 'liquid' }],
  ['Mortgage', { kind: 'fixed' }],
  ['Loan', { kind: 'cash' }],
];

// [holding, date, value]. On 2026-02-01 Purse and Mortgage fall to zero
// as Broker and Loan are first valued, so each side's total is zero just
// before that day and above zero on every day of the stretch before it.
// On 2026-02-15 Broker falls to zero, the only asset, and is valued
// again on 2026-03-01, so only 2026-02-15 has no assets.
const FIGURES = [
  ['Purse', '2026-01-05', '1000.00'],
  ['Mortgage', '2026-01-05', '-800.00'],
  ['Purse', '2026-02-01', '0.00'],
  ['Mortgage', '2026-02-01', '0.00'],
  ['Broker', '2026-02-01', '500.00'],
  ['Loan', '2026-02-01', '-200.00'],
  ['Broker', '2026-02-15', '0.00'],
  ['Broker', '2026-03-01', '700.00'],
];

// Where the drawn asset and liability stacks reach, read off the SVG
// between every two adjacent x where any band path turns: the top of
// the asset fills and the bottom of the liability fills at each such
// midpoint, and the y of the 100%, 0% and −100% ticks. A path is a
// closed polygon, so each fill crosses a vertical line at its top edge
// and its bottom edge.
const drawn = () =>
  page.call(() => {
    const svg = document.querySelector('svg.trend');
    const points = (d) => d.replace(/[MZ]/g, '').split('L').filter(Boolean).map((p) => p.split(',').map(Number));
    const paths = [...svg.querySelectorAll('path.band')].map((p) => ({
      asset: p.getAttribute('fill-opacity') === '0.85',
      points: points(p.getAttribute('d')),
    }));
    const crossings = (polygon, x) => {
      const ys = [];
      polygon.forEach(([x1, y1], at) => {
        const [x2, y2] = polygon[(at + 1) % polygon.length];
        if ((x1 < x && x < x2) || (x2 < x && x < x1)) ys.push(y1 + ((x - x1) * (y2 - y1)) / (x2 - x1));
      });
      return ys;
    };
    const xs = [...new Set(paths.flatMap((p) => p.points.map(([x]) => x)))].sort((a, b) => a - b);
    const tick = (label) => {
      const t = [...svg.querySelectorAll('text.axis-tick')].find((n) => n.textContent.trim() === label);
      return t ? Number(t.getAttribute('y')) - 4 : null;
    };
    const mids = xs.slice(1).map((x, at) => (xs[at] + x) / 2);
    return {
      top: tick('100%'),
      zero: tick('0%'),
      bottom: tick('−100%'),
      span: [xs[0], xs.at(-1)],
      reach: mids.map((x) => {
        const up = paths.filter((p) => p.asset).flatMap((p) => crossings(p.points, x));
        const down = paths.filter((p) => !p.asset).flatMap((p) => crossings(p.points, x));
        return { x, assets: up.length ? Math.min(...up) : null, liabilities: down.length ? Math.max(...down) : null };
      }),
    };
  });

const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.5;
const full = (seen) =>
  seen.top !== null && seen.bottom !== null && seen.reach.length > 2 &&
  seen.reach.every((r) => near(r.assets, seen.top));
const fullBelow = (seen) => seen.reach.length > 2 && seen.reach.every((r) => near(r.liabilities, seen.bottom));
const gaps = (seen, side, edge) => seen.reach.filter((r) => !near(r[side], seen[edge])).map((r) => [Math.round(r.x), r[side] && Math.round(r[side])]);

const groupBy = async (id) => {
  await page.call((value) => {
    const s = document.querySelector('.chart-card select');
    s.value = value ?? [...s.options].find((o) => o.textContent.trim() === 'Total').value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.frames();
};

const table = () => page.eval("(document.querySelector('.chart-card details table') || {}).textContent || ''");

await run(async () => {
  await vaultOwner();
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await holdToday('2026-03-10');
  const ids = await holdings(HOLDINGS.map(([name, dims]) => [name, 'CHF', dims]));
  await setProfile({ dimensions: [KIND], locale: 'en-US' });
  await plant(FIGURES.map(([name, date, value]) =>
    ({ type: 'snapshot', accountId: ids[name], payload: { date, value, note: null } })));
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('svg.trend path.band')", { label: 'the chart' });

  await groupBy(null);
  const absolute = await table();
  await click('Percentage');
  await page.waitUntil("[...document.querySelectorAll('svg.trend text.axis-tick')].some((t) => t.textContent.trim() === '100%')", { label: 'the percentage ticks' });
  await page.frames();

  const total = await drawn();
  check('net-worth-view: criterion 82, under Total in Percentage the asset band fills the plot on every stretch, beside the recording that puts every holding at zero',
    full(total), JSON.stringify({ top: total.top, gaps: gaps(total, 'assets', 'top') }));
  check('net-worth-view: Absolute / percentage, under Total the liability band fills down to −100% on every stretch, beside the recording that puts every liability at zero',
    fullBelow(total), JSON.stringify({ bottom: total.bottom, gaps: gaps(total, 'liabilities', 'bottom') }));

  await groupBy('kind');
  await page.frames();
  const kind = await drawn();
  check('net-worth-view: criterion 82, under a dimension in Percentage the asset bands fill the plot on every stretch, beside the recording that puts every holding at zero',
    full(kind), JSON.stringify({ top: kind.top, gaps: gaps(kind, 'assets', 'top') }));
  check('net-worth-view: Absolute / percentage, under a dimension the liability bands fill down to −100% on every stretch',
    fullBelow(kind), JSON.stringify({ bottom: kind.bottom, gaps: gaps(kind, 'liabilities', 'bottom') }));

  // Criterion 33 over this history: the table under Total reads the same
  // in Percentage as in Absolute, and under the dimension the same with
  // a band hidden as without.
  const percentTable = await table();
  await groupBy(null);
  const percentTotal = await table();
  await click('Absolute');
  await groupBy('kind');
  const kindAbsolute = await table();
  await page.eval("document.querySelector('.legend-entry').click()");
  const kindHidden = await table();
  await click('Percentage');
  const kindHiddenPercent = await table();
  check('net-worth-view: criterion 33, beside a recording that puts every holding at zero, Percentage and a hidden band leave the table\'s text unchanged',
    absolute.length > 0 && absolute === percentTotal && kindAbsolute.length > 0 &&
      kindAbsolute === kindHidden && kindAbsolute === kindHiddenPercent && kindAbsolute === percentTable,
    JSON.stringify({ absolute, percentTotal, kindAbsolute, kindHidden, kindHiddenPercent, percentTable }));
}, { signsIn: false });
