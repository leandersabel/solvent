// The dashboard's coverage at a count of one, written from
// spec/features/net-worth-view.md (Dashboard, Group by and coverage)
// and spec/design-system.md (Typography, Figures: in "N of M holdings
// assigned" the noun agrees with M) without reading how the dashboard
// is built.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner } from '../harness.mjs';
import { disagreeing } from '../counts.mjs';

const LIQUIDITY = { id: 'liq00001', label: 'Liquidity', archivedAt: null, values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }] };

const groupedByLiquidity = async () => {
  await page.call((id) => {
    const select = document.querySelector('.chart-card select');
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, LIQUIDITY.id);
  await page.waitUntil("document.querySelector('.chart-controls .coverage')", { label: 'the coverage' });
  await page.frames();
  return page.eval("document.querySelector('.chart-controls .coverage').textContent.trim()");
};

await run(async () => {
  await vaultOwner();
  await holdings([['Lone account', 'CHF']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Lone account': '100.00' });
  await setProfile({ dimensions: [LIQUIDITY] });
  await unlockDashboard('the dashboard of one holding');

  const one = await groupedByLiquidity();
  check('net-worth-view: one holding, unassigned, reads "0 of 1 holding assigned"', one === '0 of 1 holding assigned', one);
  const wrong = disagreeing(await page.eval('document.body.innerText'));
  check('design-system: no count on the dashboard disagrees with its noun', wrong.length === 0, wrong.join(' | '));

  await holdings([['Second account', 'CHF', { liq00001: 'cash0001' }]]);
  await recording(new Date().toISOString().slice(0, 10), { 'Second account': '50.00' });
  await unlockDashboard('the dashboard of two holdings');
  const two = await groupedByLiquidity();
  check('net-worth-view: two holdings, one assigned, reads "1 of 2 holdings assigned"', two === '1 of 2 holdings assigned', two);
});
