// Deleting a recording that moves one holding, written from
// spec/features/record-snapshot.md (Recording detail: Delete lives
// here and nowhere else) and spec/design-system.md (Typography,
// Figures: a count agrees with its noun, and a verb with its count)
// without reading how the screen is built.
import { check, click, holdings, page, recording, run, unlockDashboard, vaultOwner } from '../harness.mjs';
import { disagreeing } from '../counts.mjs';

const TODAY = new Date().toISOString().slice(0, 10);

await run(async () => {
  await vaultOwner();
  await holdings([['Cantonal account', 'CHF'], ['Dollar account', 'USD']]);
  await recording(TODAY, { 'Cantonal account': '1000.00', 'Dollar account': '100.00' });
  await unlockDashboard('the dashboard of one dollar holding');

  await page.call((day) => { location.hash = `#/recording/${day}`; }, TODAY);
  await click('Delete');
  await page.waitUntil("document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Delete the recording for')", {
    label: 'the delete confirmation',
  });
  const said = await page.eval("document.querySelector('.dialog').innerText");
  check(
    'record-snapshot: deleting a recording that moves one holding says "1 holding measured in USD moves on that date"',
    said.includes('1 holding measured in USD moves on that date') && disagreeing(said).length === 0,
    said,
  );
});
