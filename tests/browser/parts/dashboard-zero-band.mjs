// The breakdown draws a bar for every band of the stack, a band at
// zero included (spec/features/net-worth-view.md, Dashboard, Breakdown
// by dimension), and no bar while nothing is valued.
// Templates: dashboard.html. Modules: view-dashboard.js, model.js.
import { check, holdings, page, recording, reloadModel, run, setProfile, unlockDashboard, vaultOwner } from '../harness.mjs';

const LIQUIDITY = {
  id: 'liq00001', label: 'Liquidity', archivedAt: null,
  values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }, { id: 'fixd0001', label: 'Fixed', archivedAt: null }],
};

await run(async () => {
  await vaultOwner();
  // "Fixed" reads 0 and the unassigned holding is not yet valued, so
  // both bands stand at zero in the stack.
  await holdings([
    ['Current account', 'CHF', { [LIQUIDITY.id]: 'cash0001' }],
    ['Spent deposit', 'CHF', { [LIQUIDITY.id]: 'fixd0001' }],
    ['Unvalued account', 'CHF'],
  ]);
  await setProfile({ dimensions: [LIQUIDITY] });
  await reloadModel(`#/unassigned/${LIQUIDITY.id}`);
  await page.waitUntil("document.querySelector('.dashboard .hero-figure')", { label: 'the dashboard grouped by Liquidity' });
  const unvalued = await page.eval("document.querySelector('.dashboard .bars') === null");
  check('net-worth-view: with no holding valued the breakdown is absent', unvalued, String(unvalued));

  await recording(new Date().toISOString().slice(0, 10), { 'Current account': '100.00', 'Spent deposit': '0' });
  await unlockDashboard('the dashboard with bands at zero');

  await page.call((value) => {
    const select = document.querySelector('.chart-card select');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, LIQUIDITY.id);
  await page.waitUntil("document.querySelector('.dashboard .bars')", { label: 'the breakdown' });
  await page.frames();
  const { legend, bars } = await page.eval(`({
    legend: [...document.querySelectorAll('.legend .legend-name')].map((n) => n.textContent),
    bars: [...document.querySelectorAll('.dashboard .bars .bar-name')].map((n) => n.textContent),
  })`);
  check('net-worth-view: the breakdown has a bar for every band the legend lists, in its order, bands at zero included', bars.join() === legend.join() && bars.join() === 'Cash,Fixed,Unassigned', `legend ${legend.join()}, bars ${bars.join()}`);
});
