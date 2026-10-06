// Reviewer's checks of units on Account detail, written from
// spec/features/manage-accounts.md (The holding's own list of values,
// Deleting a snapshot, Delete: the user chooses, criterion 63) and
// design-system.md, Units, alone. A column is found by its header's
// text, a value by the column it sits under.
import {
  BACKDATE, check, click, openHolding, page, plant, reloadModel, run, vaultOwner,
} from '../harness.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const SYMBOL = /\bX(AU|AG|PT|PD)-(ozt|g)\b/;
// A figure's digits, however Settings groups and points them.
const DIGITS = String.raw`\d[\d,.'’   ]*`;
// Each holding, its unit, its values, and how a value carries its unit:
// a currency's code ahead, any other unit after.
const HOLDINGS = [
  { name: 'Gold bars', unit: 'XAU-ozt', values: [[BACKDATE, '12.5'], [TODAY, '12.5']], carries: new RegExp(`^${DIGITS}\\s?ozt$`) },
  { name: 'Gold grams', unit: 'XAU-g', values: [[BACKDATE, '250']], carries: new RegExp(`^${DIGITS}\\s?g$`) },
  { name: 'Dollar account', unit: 'USD', values: [[BACKDATE, '12450.00'], [TODAY, '12450.00']], carries: new RegExp(`^USD\\s?${DIGITS}$`) },
  { name: 'Flat', unit: 'm2', values: [[BACKDATE, '95']], carries: new RegExp(`^${DIGITS}\\s?m2$`) },
];
// A header naming any unit but the main currency, CHF, or a unit in
// brackets.
const NAMES_A_UNIT = /ozt|\bg\b|gram|troy|gold|xau|usd|m2|\(/i;

const table = () => page.call(() => {
  const heads = [...document.querySelectorAll('main th, main [role=columnheader]')].map((h) => h.textContent.trim());
  const valueAt = heads.findIndex((h) => /^value$/i.test(h));
  const cells = [...document.querySelectorAll('main tbody tr')]
    .map((tr) => (tr.children[valueAt] ? tr.children[valueAt].textContent.trim() : null));
  return JSON.stringify({ heads, valueAt, cells, text: document.querySelector('main').innerText });
}).then(JSON.parse);

// The text of the dialog the row action or screen action `label` opens.
const dialogOf = async (open) => {
  await open();
  await page.waitUntil("document.querySelector('.dialog')", { label: 'a dialog' });
  const said = await page.eval("document.querySelector('.dialog').innerText");
  await page.key('Escape');
  await page.holds("!document.querySelector('.dialog')", { timeout: 10000, label: 'the dialog to close' });
  return said;
};
const deleteFirstRow = () => page.eval(`[...document.querySelector('main tbody tr').querySelectorAll('button')]
  .find((b) => b.textContent.trim() === 'Delete').click()`);

await run(async () => {
  await vaultOwner();
  const ids = {};
  for (const h of HOLDINGS) {
    [ids[h.name]] = await plant([{
      type: 'account',
      payload: { name: h.name, unit: h.unit, dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
    }]);
    await plant(h.values.map(([date, value]) => ({ type: 'snapshot', accountId: ids[h.name], payload: { date, value, note: null } })));
  }
  await reloadModel();

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const h of HOLDINGS) {
    await openHolding(ids[h.name]);
    const seen = await table();
    const what = `${h.name} (${h.unit})`;
    check(`review 63: the list of values of ${what} has a Value column`, seen.valueAt >= 0, JSON.stringify(seen.heads));
    check(`review 63: no header of the list of values of ${what} names a unit but the main currency`,
      seen.heads.length > 0 && seen.heads.every((t) => !NAMES_A_UNIT.test(t)), JSON.stringify(seen.heads));
    check(`review 63: each value of ${what} carries its unit as Units sets`,
      seen.cells.length === h.values.length && seen.cells.every((c) => c !== null && h.carries.test(c)), JSON.stringify(seen.cells));
    check(`review Units: Account detail of ${what} shows no symbol in place of a unit's name`,
      !SYMBOL.test(seen.text), seen.text.slice(0, 600));
  }

  // The confirmations name the stored figure as a figure carries its
  // unit: "USD 12,450.00", "12.5 ozt".
  const asFigure = { 'Dollar account': `USD ${DIGITS}`, 'Gold bars': `${DIGITS}\\s?ozt` };
  for (const [name, shape] of Object.entries(asFigure)) {
    await openHolding(ids[name]);
    const deleting = await dialogOf(deleteFirstRow);
    check(`review: deleting a value of ${name} names the figure with its unit as Units sets`,
      new RegExp(`Delete the value of ${shape} for `).test(deleting) && !SYMBOL.test(deleting), deleting);
    const archiving = await dialogOf(() => click('Archive'));
    check(`review: archiving ${name} names the figure it replaces with its unit as Units sets`,
      new RegExp(`This replaces the ${shape} recorded for `).test(archiving) && !SYMBOL.test(archiving), archiving);
  }

  // At phone width the list becomes a list, and still shows no symbol.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await openHolding(ids['Gold bars']);
  const phone = await page.eval("document.querySelector('main').innerText");
  check('review Units: Account detail at phone width shows no symbol in place of a unit\'s name',
    !SYMBOL.test(phone) && /12\.5\s?ozt/.test(phone), phone.slice(0, 600));
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
