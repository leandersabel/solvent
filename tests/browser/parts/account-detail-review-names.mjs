// Reviewer's check of the archive dialog's message when its prices do
// not save (spec/features/manage-accounts.md, Archiving, "A price did
// not save", criterion 36) against design-system.md, Typography,
// Figures: names in a sentence read "A, B and C". Written from the spec
// alone.
import {
  BACKDATE, check, click, failing, inDialog, openHolding, page, plant, reloadModel, run, text, vaultOwner, writing,
} from '../harness.mjs';
import { chains, lists } from '../names.mjs';

const UNITS = ['USD', 'EUR', 'GBP'];

await run(async () => {
  await vaultOwner();
  const [leaving, ...priced] = await plant([['Leaving account', 'CHF'], ...UNITS.map((unit) => [`${unit} account`, unit])]
    .map(([name, unit]) => ({
      type: 'account',
      payload: { name, unit, dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
    })));
  await plant([leaving, ...priced].map((accountId) => ({ type: 'snapshot', accountId, payload: { date: BACKDATE, value: '100', note: null } })));
  await reloadModel();

  await openHolding(leaving);
  await click('Archive');
  await page.waitUntil("document.querySelector('.dialog')", { label: 'the archive dialog' });
  await failing(writing('rate'), async () => {
    await inDialog('Archive');
    await page.waitUntil("document.body.innerText.includes('Add them in the recording for that date')", { timeout: 60000, label: 'the price failure' });
  });
  const said = await text();
  check(
    'review 36: an archive whose prices for three units do not save names them "A, B and C", never chained with "and"',
    said.includes('Archived. The prices for ') && lists(said, UNITS) && !chains(said, UNITS),
    said.slice(0, 600),
  );
}, { signsIn: false });
