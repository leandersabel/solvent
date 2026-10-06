// Changing or clearing a price that moves one holding, written from
// spec/features/record-snapshot.md (Update values, Changing or clearing
// a rate says what it moves) and spec/design-system.md (Typography,
// Figures: a count agrees with its noun, and a verb with its count)
// without reading how the screen is built.
import { check, click, holdings, inDialog, page, recording, run, unlockDashboard, vaultOwner } from '../harness.mjs';
import { disagreeing } from '../counts.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const USD_LINE = '.rate-line[data-unit="USD"] input';

const confirmationFor = async (typed) => {
  await page.call((query, next) => {
    const field = document.querySelector(query);
    field.value = next;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, USD_LINE, typed);
  await click('Save the rate lines');
  await page.waitUntil("document.querySelector('.dialog')", { label: 'the confirmation' });
  const said = await page.eval("document.querySelector('.dialog').innerText");
  await inDialog('Cancel');
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the confirmation to close' });
  return said;
};

await run(async () => {
  await vaultOwner();
  await holdings([['Cantonal account', 'CHF'], ['Dollar account', 'USD']]);
  await recording(TODAY, { 'Cantonal account': '1000.00', 'Dollar account': '100.00' });
  await unlockDashboard('the dashboard of one dollar holding');

  await page.call((day) => { location.hash = `#/recording/${day}`; }, TODAY);
  await click('Update');
  await page.waitUntil((query) => document.querySelector(query), { args: [USD_LINE], label: 'the USD rate line' });
  await page.idle();

  const changed = await confirmationFor('0.4321');
  check(
    'record-snapshot: changing a price that moves one holding names "1 holding measured in USD"',
    /\bmoves 1 holding measured in USD\b/.test(changed) && disagreeing(changed).length === 0,
    changed,
  );

  const cleared = await confirmationFor('');
  check(
    'record-snapshot: clearing a price that moves one holding says "1 holding measured in USD moves on that date"',
    cleared.includes('1 holding measured in USD moves on that date') && disagreeing(cleared).length === 0,
    cleared,
  );
});
