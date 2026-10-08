// A chart of one band names it in a legend unless that band is
// "Total" (spec/features/net-worth-view.md, Dashboard, Trend chart):
// an "Unassigned" band, and a dimension value every holding carries.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner } from '../harness.mjs';

// The holding carries Kind's one value and no Liquidity.
const LIQUIDITY = { id: 'liq00001', label: 'Liquidity', archivedAt: null, values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }] };
const KIND = { id: 'kind0001', label: 'Kind', archivedAt: null, values: [{ id: 'mony0001', label: 'Money', archivedAt: null }] };

const legendAfterGrouping = async (id) => {
  await page.call((value) => {
    const select = document.querySelector('.chart-card select');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.waitUntil(`${JSON.stringify(id)} === document.querySelector('.chart-card select').value`, { label: 'the grouping' });
  await page.frames();
  return page.eval("document.querySelector('.legend') && [...document.querySelectorAll('.legend .legend-name')].map(n => n.textContent)");
};

await run(async () => {
  await vaultOwner();
  await holdings([['Lone account', 'CHF', { [KIND.id]: 'mony0001' }]]);
  await recording(new Date().toISOString().slice(0, 10), { 'Lone account': '100.00' });
  await setProfile({ dimensions: [LIQUIDITY, KIND] });
  await unlockDashboard('the dashboard of one holding');

  const unassigned = await legendAfterGrouping(LIQUIDITY.id);
  check('net-worth-view: a dimension no holding carries names its one band "Unassigned" in the legend', unassigned.join() === 'Unassigned', unassigned.join());
  const total = await legendAfterGrouping('');
  check('net-worth-view: grouped by Total the chart has no legend box', total === null, String(total));
  const valued = await legendAfterGrouping(KIND.id);
  check('net-worth-view: a dimension whose one value every holding carries names that band in the legend', valued.join() === 'Money', valued.join());
});
