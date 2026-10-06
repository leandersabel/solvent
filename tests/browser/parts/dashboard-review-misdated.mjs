// Reviewer's checks of a misdated record on screen (spec/features/
// record-snapshot.md, A recording is a date, criterion 99), written from
// the spec alone: a figure stored at a date that is not a day that has
// passed counts toward nothing the dashboard shows, is listed with its
// holding, each line opens its recording, which offers no Update, and
// its holding flags it.
// Modules: view-dashboard.js, view-holding.js, model.js, routes.js.
import {
  BACKDATE, check, holdings, idNamed, openHolding, page, plant, recording, reloadModel, run, vaultOwner,
} from '../harness.mjs';

const MISSING = 'There is no page at this address.';
const FLAG = 'This is not a day that has passed. Move or delete this entry. It counts toward nothing.';

await run(async () => {
  await vaultOwner();
  await holdings([['Cash', 'CHF'], ['Dollars', 'USD']]);
  await recording(BACKDATE, { Cash: '100', Dollars: '10' });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard before the misdated records' });
  const latestRates = () =>
    page.eval(
      "[...document.querySelectorAll('#app button, #app label, #app span')].map((n) => n.textContent.trim()).find((t) => t.startsWith('Latest rates')) || ''",
    );
  const labelBefore = await latestRates();
  const [cash] = await idNamed('Cash');
  const price = (date) => ({ symbol: 'USD', date, rate: '99', rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null });
  await plant([
    { type: 'snapshot', accountId: cash, payload: { date: '2099-01-01', value: '987654', note: null } },
    { type: 'snapshot', accountId: cash, payload: { date: '2026-02-30', value: '876543', note: null } },
    { type: 'rate', payload: price('2099-01-01') },
  ]);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard' });

  const dashboard = await page.eval('document.body.innerText');
  check('no misdated figure reaches the dashboard', !/987|876/.test(dashboard.replace(/2099|2026-02-30/g, '')), dashboard);
  check('no date reads "Invalid Date"', !dashboard.includes('Invalid Date'));
  check(
    'a date that is not a calendar day is shown as stored',
    dashboard.includes('2026-02-30'),
    dashboard.split('\n').filter((line) => line.includes('not a day that has passed')).join(' | '),
  );
  const label = await latestRates();
  check('the vault\'s one rate date ignores a misdated price', label.startsWith('Latest rates,') && label === labelBefore, `${labelBefore} became ${label}`);

  // The controls outside the holdings table that sit in a line naming
  // the holding: the list of misdated records.
  const lines = () =>
    page.eval(`[...document.querySelectorAll('#app a, #app button')]
      .filter((n) => !n.closest('.holdings-card') && (n.closest('li, p, div') || n).innerText.includes('Cash'))
      .length`);
  const count = await lines();
  check('each misdated record is listed with its holding', count >= 2, count);
  const opened = new Set();
  for (let i = 0; i < count; i += 1) {
    await page.call((at) => {
      [...document.querySelectorAll('#app a, #app button')]
        .filter((n) => !n.closest('.holdings-card') && (n.closest('li, p, div') || n).innerText.includes('Cash'))[at]
        .click();
    }, i);
    await page.frames();
    await page.idle();
    opened.add(await page.eval('location.hash'));
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard again' });
  }
  check(
    'each line opens its recording',
    opened.has('#/recording/2099-01-01') && opened.has('#/recording/2026-02-30'),
    [...opened].join(' '),
  );
  for (const date of ['2099-01-01', '2026-02-30']) {
    await page.call((next) => { location.hash = next; }, `#/recording/${date}`);
    await page.frames();
    await page.idle();
    const shown = await page.eval('document.body.innerText');
    check(`the recording at ${date} opens`, !shown.includes(MISSING) && shown.includes('Cash'), shown.slice(0, 400));
    const controls = await page.eval("[...document.querySelectorAll('#app button, #app a')].map((n) => n.textContent.trim())");
    check(`the recording at ${date} offers no Update`, !controls.includes('Update'), controls.join('|'));
  }

  await openHolding(cash);
  await page.idle();
  const holding = await page.eval('document.body.innerText');
  check('the holding flags each misdated row', holding.split(FLAG).length - 1 === 2, holding);
  check('the holding shows no "Invalid Date"', !holding.includes('Invalid Date'));
}, { signsIn: false });
