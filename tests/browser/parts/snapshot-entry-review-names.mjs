// Reviewer's checks of Snapshot entry's messages when the prices at a
// date do not save (spec/features/record-snapshot.md, Snapshot entry,
// States, "Prices did not save" and "A move whose prices did not save",
// criterion 80) against design-system.md, Typography, Figures: names in a sentence
// read "A, B and C". Written from the spec alone.
import {
  BACKDATE, check, click, failing, openHolding, page, plant, reloadModel, run, setValue, vaultOwner, writing,
} from '../harness.mjs';
import { chains, lists } from '../names.mjs';

const UNITS = ['USD', 'EUR', 'GBP'];
const MOVED_TO = new Date(Date.now() - 75 * 86400000).toISOString().slice(0, 10);
const format = (method, iso) =>
  page.call(async (name, day) => (await import('/static/js/session.js')).currentVault().format[name](day), method, iso);

const save = () =>
  page.eval("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
const dialogText = () => page.eval("[...document.querySelectorAll('.dialog')].map(d => d.innerText).join(' | ')");
const editEntry = async (id, iso) => {
  await openHolding(id);
  await page.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
    .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), await format('longDate', iso));
  await page.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry Dialog at ${iso}` });
};

await run(async () => {
  await vaultOwner();
  const [mover, ...priced] = await plant([['Moving account', 'CHF'], ...UNITS.map((unit) => [`${unit} account`, unit])]
    .map(([name, unit]) => ({
      type: 'account',
      payload: { name, unit, dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
    })));
  await plant([mover, ...priced].map((accountId) => ({ type: 'snapshot', accountId, payload: { date: BACKDATE, value: '100', note: null } })));
  await reloadModel();

  await editEntry(mover, BACKDATE);
  await setValue('#snapshot-date', await format('date', MOVED_TO));
  await page.idle();
  await failing(writing('rate'), async () => {
    await save();
    await page.waitUntil("document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('did not save')", {
      timeout: 60000, label: 'the move whose prices did not save',
    });
  });
  const said = await dialogText();
  check(
    'review 80: a move whose prices for three units do not save names them "A, B and C", never chained with "and"',
    said.includes(`Moved to ${await format('fullDate', MOVED_TO)}. The prices for `) && lists(said, UNITS) && !chains(said, UNITS),
    said,
  );

  // A figure saved at a date whose prices then fail to save names them.
  const SAVED_AT = new Date(Date.now() - 76 * 86400000).toISOString().slice(0, 10);
  await page.key('Escape');
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the Dialog to close' });
  await openHolding(priced[0]);
  await click('Record a value');
  await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the new entry Dialog' });
  await setValue('#snapshot-date', await format('date', SAVED_AT));
  await setValue('#snapshot-value', '150');
  await page.idle();
  await failing(writing('rate'), async () => {
    await save();
    await page.waitUntil("document.querySelector('.dialog') && /not (been )?(updated|saved)|did not save/.test(document.querySelector('.dialog').innerText)", {
      timeout: 60000, label: 'the save whose prices did not save',
    });
  });
  const saved = await dialogText();
  check(
    'record-snapshot, Prices did not save: a new figure whose prices for three units do not save names them "A, B and C"',
    lists(saved, UNITS) && !chains(saved, UNITS),
    saved,
  );
}, { signsIn: false });
