// Counts of one on the dimensions screen and the Settings row that
// opens it, written from spec/features/account-settings.md (Settings,
// the Dimensions link row; Dimensions, coverage) and
// spec/design-system.md (Typography, Figures: in "N of M holdings
// assigned" the noun agrees with M) without reading how either is
// built.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner } from '../harness.mjs';
import { disagreeing } from '../counts.mjs';

const LIQUIDITY = { id: 'liq00001', label: 'Liquidity', archivedAt: null, values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }] };

const openSettings = async () => {
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.topbar nav a[href=\"#/settings\"]')", { label: 'the dashboard' });
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings' });
  await page.idle();
};
const openDimensions = async () => {
  await openSettings();
  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Liquidity') && document.body.innerText.includes('assigned')", {
    timeout: 20000, label: 'the dimensions screen',
  });
  await page.idle();
};
const coverage = () =>
  page.eval("(document.body.innerText.match(/\\d+ of \\d+ holdings? assigned/) || [''])[0]");

await run(async () => {
  await vaultOwner();
  await holdings([['Lone account', 'CHF']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Lone account': '100.00' });
  await setProfile({ dimensions: [LIQUIDITY] });
  await unlockDashboard('the dashboard of one holding');

  await openSettings();
  const row = await page.eval("document.querySelector('.link-row[href=\"/settings/dimensions\"]').innerText");
  check('account-settings: the Dimensions row counts one dimension without a plural', disagreeing(row).length === 0 && !/\b1 dimensions\b/.test(row), row);

  await openDimensions();
  check('account-settings: one holding, unassigned, reads "0 of 1 holding assigned"', (await coverage()) === '0 of 1 holding assigned', await coverage());
  const wrong = disagreeing(await page.eval('document.body.innerText'));
  check('design-system: no count on the dimensions screen disagrees with its noun', wrong.length === 0, wrong.join(' | '));

  await holdings([['Second account', 'CHF', { liq00001: 'cash0001' }]]);
  await recording(new Date().toISOString().slice(0, 10), { 'Second account': '50.00' });
  await unlockDashboard('the dashboard of two holdings');
  await openDimensions();
  check('account-settings: two holdings, one assigned, reads "1 of 2 holdings assigned"', (await coverage()) === '1 of 2 holdings assigned', await coverage());
});
