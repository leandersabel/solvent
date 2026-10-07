// The units a recording's delete confirmation names
// (spec/features/record-snapshot.md, Recording detail: Delete lives
// here and nowhere else, and spec/design-system.md, Figures: names in a
// sentence read "A, B and C").
// Modules: view-recording.js, dom.js.
import { check, click, holdings, page, recording, run, unlockDashboard, vaultOwner } from '../harness.mjs';

const TODAY = new Date().toISOString().slice(0, 10);

await run(async () => {
  await vaultOwner();
  await holdings([['Cantonal account', 'CHF'], ['Dollar account', 'USD'], ['Gold bars', 'XAU-ozt'], ['Euro account', 'EUR']]);
  await recording(TODAY, { 'Cantonal account': '1000.00', 'Dollar account': '100.00', 'Gold bars': '2', 'Euro account': '50.00' });
  await unlockDashboard('the dashboard of three priced units');

  await page.call((day) => { location.hash = `#/recording/${day}`; }, TODAY);
  await click('Delete');
  await page.waitUntil("document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Delete the recording for')", {
    label: 'the delete confirmation',
  });
  const said = await page.eval("document.querySelector('.dialog').innerText");
  const units = (said.match(/measured in (.+) move on that date/) || [])[1] || '';
  check(
    'the delete confirmation names three units with commas and "and" only before the last',
    ['USD', 'EUR', 'Gold, troy ounce'].every((name) => units.includes(name)) && units.split(' and ').length === 2,
    said,
  );
});
