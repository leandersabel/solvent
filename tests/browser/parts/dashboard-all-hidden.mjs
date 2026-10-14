// With every band hidden through the legend, the plot keeps its value
// axis and logs no error (spec/features/net-worth-view.md, Trend chart).
// Templates: dashboard.html. Modules: chart.js, view-dashboard.js.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner } from '../harness.mjs';

const LIQUIDITY = { id: 'liq00001', label: 'Liquidity', archivedAt: null, values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }] };

await run(async () => {
  await vaultOwner();
  await holdings([['Savings', 'CHF', { [LIQUIDITY.id]: 'cash0001' }], ['Car loan', 'CHF']]);
  const today = new Date();
  const earlier = new Date(today.getTime() - 30 * 86400000);
  await recording(earlier.toISOString().slice(0, 10), { Savings: '1000.00', 'Car loan': '-200.00' });
  await recording(today.toISOString().slice(0, 10), { Savings: '1500.00', 'Car loan': '-150.00' });
  await setProfile({ dimensions: [LIQUIDITY] });
  await unlockDashboard('the dashboard of two holdings');

  await page.call((value) => {
    const select = document.querySelector('.chart-card select');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, LIQUIDITY.id);
  await page.waitUntil("document.querySelectorAll('.legend-entry').length === 2", { label: 'the legend' });
  for (let at = 0; at < 2; at += 1) {
    await page.call((n) => document.querySelectorAll('.legend-entry')[n].click(), at);
    await page.frames();
  }

  const plot = await page.eval(`(() => {
    const trend = document.querySelector('svg.trend');
    const nan = [...trend.querySelectorAll('*')].filter((node) => [...node.attributes].some((a) => a.value.includes('NaN')));
    return {
      hidden: [...document.querySelectorAll('.legend-entry')].every((e) => e.getAttribute('aria-pressed') === 'false'),
      ticks: [...trend.querySelectorAll('.axis-tick[text-anchor="end"]')].map((t) => t.textContent),
      zero: Boolean(trend.querySelector('.zero-line')),
      nan: nan.map((node) => node.tagName),
    };
  })()`);
  check('net-worth-view: every legend entry hides its band', plot.hidden, JSON.stringify(plot));
  check('net-worth-view: with every band hidden the value axis runs from 0 to 1', plot.ticks.join() === '0,1', plot.ticks.join());
  check('net-worth-view: with every band hidden the zero line is drawn', plot.zero);
  check('net-worth-view: with every band hidden no mark is placed at NaN', plot.nan.length === 0, plot.nan.join());
});
