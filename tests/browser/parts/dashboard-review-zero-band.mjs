// The breakdown lists the bands the legend lists, written from
// spec/features/net-worth-view.md (Breakdown by dimension, Grouping by
// dimension, The two neutral bands, and acceptance criteria 66 and 81)
// without reading how the screen is built or tested. Under a dimension
// of six values, the breakdown has one bar per legend entry, in the
// legend's order: a band recorded at zero, a band whose holdings cancel
// to zero, an "Unassigned" band of a holding not yet valued and "Other"
// folding the fifth value and beyond all keep their bar. Each bar reads
// the legend's figure, the bars sum to the total, and under "Total" the
// breakdown is absent.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// A figure as shown under en-US in whole units, the currency code, group
// commas and a leading plus dropped. `null` for anything else, a minus
// on zero included.
const shown = (text) => {
  const body = (text || '').replace(/[A-Z]{3}/g, '').replace(/[,\s+]/g, '');
  const match = /^([−-]?)([0-9]+)$/.exec(body);
  if (!match) return null;
  const n = BigInt(match[2]);
  if (match[1] && n === 0n) return null;
  return match[1] ? -n : n;
};

const LIQUIDITY = {
  id: 'liq',
  label: 'Liquidity',
  values: [
    { id: 'cash', label: 'Cash' },
    { id: 'liquid', label: 'Liquid investments' },
    { id: 'fixed', label: 'Fixed investments' },
    { id: 'retire', label: 'Retirement' },
    { id: 'art', label: 'Art' },
    { id: 'wine', label: 'Wine' },
  ],
};
// A second dimension where the first value no holding carries sits
// among the first four, so whatever the legend makes of it, the
// breakdown has to make the same.
const REGION = {
  id: 'region',
  label: 'Region',
  values: [
    { id: 'home', label: 'Home' },
    { id: 'none', label: 'Nowhere' },
    { id: 'abroad', label: 'Abroad' },
  ],
};

// [name, dims, figure or null for not yet valued].
const HOLDINGS = [
  ['Purse', { liq: 'cash', region: 'home' }, '500.00'],
  ['Broker', { liq: 'liquid', region: 'abroad' }, '0.00'],
  ['Flat', { liq: 'fixed', region: 'home' }, '300000.00'],
  ['Mortgage', { liq: 'fixed', region: 'home' }, '-250000.00'],
  ['Pillar', { liq: 'retire', region: 'home' }, '100.00'],
  ['Loan', { liq: 'retire', region: 'abroad' }, '-100.00'],
  ['Painting', { liq: 'art' }, '1000.00'],
  ['Cellar', { liq: 'wine', region: 'abroad' }, '200.00'],
  ['Loose', {}, null],
];
// What each band reads under Liquidity, in band order: the four first
// values, Unassigned and Other, as the stack orders them.
const EXPECTED = [
  ['Cash', 500n],
  ['Liquid investments', 0n],
  ['Fixed investments', 50000n],
  ['Retirement', 0n],
  ['Unassigned', 0n],
  ['Other', 1200n],
];
const TOTAL = 51700n;

const screen = () =>
  page.call(() => {
    const t = (node) => (node ? node.textContent.trim() : null);
    return {
      total: t(document.querySelector('.dashboard .hero-amount')),
      bars: [...document.querySelectorAll('.bars .bar-label')].map((b) => [t(b.querySelector('.bar-name')), t(b.querySelector('.bar-amount'))]),
      legend: [...document.querySelectorAll('.chart-card .legend-entry')].map((e) => [t(e.querySelector('.legend-name')), t(e.querySelector('.legend-value'))]),
    };
  });

// A dimension by its id, or "Total" by its label.
const groupBy = async (id) => {
  await page.call((value) => {
    const s = document.querySelector('.chart-card select');
    s.value = value ?? [...s.options].find((o) => o.textContent.trim() === 'Total').value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.frames();
};

const read = (pairs) => pairs.map(([name, figure]) => `${name} ${shown(figure)}`);

await run(async () => {
  await vaultOwner();
  await holdToday('2026-03-10');
  const ids = await holdings(HOLDINGS.map(([name, dims]) => [name, 'CHF', dims]));
  await setProfile({ dimensions: [LIQUIDITY, REGION], locale: 'en-US' });
  await plant(HOLDINGS.filter(([, , value]) => value !== null).map(([name, , value]) =>
    ({ type: 'snapshot', accountId: ids[name], payload: { date: '2026-03-01', value, note: null } })));
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });

  await groupBy('liq');
  const liquidity = await screen();
  check('net-worth-view: criterion 81, under Liquidity the legend lists the four first values, Unassigned and Other',
    JSON.stringify(liquidity.legend.map(([name]) => name)) === JSON.stringify(EXPECTED.map(([name]) => name)),
    JSON.stringify(liquidity.legend));
  check('net-worth-view: criterion 81, the breakdown has a bar for every band the legend lists, in its order, the bands at zero included',
    JSON.stringify(liquidity.bars.map(([name]) => name)) === JSON.stringify(liquidity.legend.map(([name]) => name)),
    JSON.stringify({ bars: liquidity.bars, legend: liquidity.legend }));
  check('net-worth-view: criterion 81, each bar reads its band\'s figure, 0 for a band recorded at zero, one that cancels to zero and an Unassigned band not yet valued',
    JSON.stringify(read(liquidity.bars)) === JSON.stringify(EXPECTED.map(([name, value]) => `${name} ${value}`)),
    JSON.stringify(liquidity.bars));
  check('net-worth-view: criterion 81, each bar reads the figure its legend entry reads',
    JSON.stringify(read(liquidity.bars)) === JSON.stringify(read(liquidity.legend)),
    JSON.stringify({ bars: liquidity.bars, legend: liquidity.legend }));
  check('net-worth-view: criterion 66, the bars sum to the total',
    shown(liquidity.total) === TOTAL && liquidity.bars.reduce((a, [, figure]) => a + (shown(figure) ?? 0n), 0n) === TOTAL,
    JSON.stringify(liquidity));

  await groupBy('region');
  const region = await screen();
  check('net-worth-view: criterion 81, under a dimension with a value no holding carries the breakdown and the legend list the same bands in the same order',
    region.legend.length > 0 &&
      JSON.stringify(region.bars.map(([name]) => name)) === JSON.stringify(region.legend.map(([name]) => name)) &&
      JSON.stringify(read(region.bars)) === JSON.stringify(read(region.legend)),
    JSON.stringify({ bars: region.bars, legend: region.legend }));

  await groupBy(null);
  const total = await screen();
  check('net-worth-view: under Total the breakdown is absent', total.bars.length === 0, JSON.stringify(total.bars));
  await groupBy('liq');
  const back = await screen();
  check('net-worth-view: criterion 81, back under Liquidity the breakdown lists the legend\'s bands again',
    JSON.stringify(read(back.bars)) === JSON.stringify(EXPECTED.map(([name, value]) => `${name} ${value}`)),
    JSON.stringify(back.bars));
}, { signsIn: false });
