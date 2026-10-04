// The pricing mode against the chart, written from
// spec/features/net-worth-view.md (Ranges and modes, and acceptance
// criterion 43) without reading how the screen is built or tested.
// Switching Which rates reprices the total, the holdings table and the
// breakdown and moves no chart point: every drawn sample of every band,
// every row of the data table and the readout of every day, at desktop
// and phone width, under every range, scale and grouping.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js,
// model.js, format.js.
import { check, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const WIDTHS = [1280, 390];
const RANGES = ['1M', '6M', '1Y', 'All'];
const SCALES = ['Absolute', 'Percentage'];
const GROUPINGS = ['', 'liq'];

// A dollar holding recorded in April and May and a gold holding in April,
// with each price moving after its figure, so every row not in the main
// currency is worth something else in each mode. A mortgage sits in the
// Unassigned band.
const VAULT = {
  dimensions: [{ id: 'liq', label: 'Liquidity', values: [{ id: 'cash', label: 'Cash' }, { id: 'inv', label: 'Invested' }] }],
  holdings: [
    { name: 'Cantonal account', unit: 'CHF', dims: { liq: 'cash' } },
    { name: 'Dollar account', unit: 'USD', dims: { liq: 'cash' } },
    { name: 'Gold bars', unit: 'XAU-ozt', dims: { liq: 'inv' } },
    { name: 'Mortgage', unit: 'CHF' },
  ],
  figures: [
    ['Cantonal account', '2026-04-10', '5000'], ['Cantonal account', '2026-06-30', '5400'],
    ['Dollar account', '2026-04-10', '1000'], ['Dollar account', '2026-05-20', '1200'],
    ['Gold bars', '2026-04-10', '10'],
    ['Mortgage', '2026-04-10', '-20000'],
  ],
  prices: [
    ['USD', '2026-04-10', '0.90'], ['USD', '2026-05-15', '0.85'], ['USD', '2026-06-30', '0.80'],
    ['XAU-ozt', '2026-04-10', '2500'], ['XAU-ozt', '2026-06-30', '2700'],
  ],
};

await run(async () => {
  await vaultOwner();
  await setProfile({ dimensions: VAULT.dimensions });
  const ids = await holdings(VAULT.holdings.map(({ name, unit, dims = {} }) => [name, unit, dims]));
  await plant([
    ...VAULT.figures.map(([name, date, value]) => ({ type: 'snapshot', accountId: ids[name], payload: { date, value, note: null } })),
    ...VAULT.prices.map(([symbol, date, rate]) => ({
      type: 'rate',
      payload: { symbol, date, rate, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: date, proposedRate: null },
    })),
  ]);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the dashboard chart' });

  // A control is pressed, and the chart it redraws is waited for: a new
  // drawing, at the width its frame has, still that width two frames on.
  // `fresh` asks for a drawing other than the one before the press.
  const drawn = (fresh) => {
    const frame = document.querySelector('.chart-frame');
    const chart = frame && frame.querySelector('svg.trend');
    return Boolean(chart) && (!fresh || chart !== globalThis.__before) &&
      Number(chart.getAttribute('width')) === Math.floor(frame.clientWidth);
  };
  const act = async (press) => {
    await page.call((how) => {
      globalThis.__before = document.querySelector('.chart-frame svg.trend');
      if (how.select !== undefined) {
        const s = document.querySelector('.chart-card select');
        s.value = how.select;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      [...document.querySelectorAll(how.scope + ' button')].find((b) => b.textContent.trim().startsWith(how.label)).click();
    }, press);
    await page.waitUntil(drawn, { args: [true], label: `the chart after ${JSON.stringify(press)}` });
    await page.frames();
    await page.waitUntil(drawn, { args: [false], label: 'the chart at its frame width' });
  };
  const pricing = (label) => act({ scope: '.hero-rates', label });

  // What the screen shows: the priced parts, and every chart point.
  const capture = () =>
    page.call(() => {
      const text = (selector) => {
        const node = document.querySelector(selector);
        return node ? node.textContent : null;
      };
      const chart = document.querySelector('.chart-frame svg.trend');
      const bars = document.querySelector('.bars');
      const priced = {
        total: text('.hero-amount'),
        list: text('.holdings-card'),
        breakdown: bars ? bars.textContent : null,
      };
      const table = [...document.querySelectorAll('.chart-card table tr')].map((tr) => [...tr.cells].map((c) => c.textContent));
      // The legend's figures, the readout and every other word of the card.
      const card = text('.chart-card');
      const drawing = chart.outerHTML;
      const width = chart.getAttribute('width');
      // Every day of the range read through the keyboard, Home first.
      const readouts = [];
      chart.focus();
      const press = (key) => chart.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      press('Home');
      let last = null;
      for (;;) {
        const now = text('.chart-readout');
        if (now === last) break;
        readouts.push(now);
        last = now;
        press('ArrowRight');
      }
      chart.blur();
      return { priced, chart: { width, drawing, table, card, readouts } };
    });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.frames();
    for (const grouping of GROUPINGS) {
      await act({ select: grouping });
      for (const range of RANGES) {
        await act({ scope: '.range-buttons', label: range });
        for (const scale of SCALES) {
          await act({ scope: '.chart-card', label: scale });
          const where = `at ${width}px, ${range}, ${scale}, grouped by ${grouping || 'Total'}`;
          const latest = await capture();
          await pricing('Rates as of each figure');
          const asRecorded = await capture();
          await pricing('Latest rates');
          const back = await capture();

          const moved = Object.keys(latest.chart).filter((key) => JSON.stringify(latest.chart[key]) !== JSON.stringify(asRecorded.chart[key]));
          check(
            `net-worth-view: switching the pricing mode moves no chart point, sample, data table row or day's readout ${where}`,
            moved.length === 0 && latest.chart.readouts.length > 1 && latest.chart.table.length > 1,
            moved.length
              ? `${moved.join(', ')} differ: ${moved.map((key) => `${JSON.stringify(latest.chart[key]).slice(0, 300)} vs ${JSON.stringify(asRecorded.chart[key]).slice(0, 300)}`).join(' / ')}`
              : `${latest.chart.readouts.length} days, ${latest.chart.table.length} table rows`,
          );
          const unchanged = ['total', 'list', ...(grouping ? ['breakdown'] : [])].filter((key) => latest.priced[key] === asRecorded.priced[key]);
          check(
            `net-worth-view: switching the pricing mode changes the total, the list${grouping ? ' and the breakdown' : ''} ${where}`,
            unchanged.length === 0 && (grouping ? latest.priced.breakdown !== null : latest.priced.breakdown === null),
            `unchanged: ${unchanged.join(', ')} ${JSON.stringify(latest.priced)}`,
          );
          check(
            `net-worth-view: switching back to latest rates restores the screen ${where}`,
            JSON.stringify(back) === JSON.stringify(latest),
          );
        }
      }
    }
  }
}, { signsIn: false });
