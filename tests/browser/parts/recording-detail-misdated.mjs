// Recording detail at a misdated recording (spec/features/
// record-snapshot.md, Recording detail): it opens with its entries and
// Delete, and offers no Update, because the sweep opens only at a
// recorded day. Modules: view-recording.js, model.js.
import { BACKDATE, check, holdings, idNamed, page, plant, recording, reloadModel, run, vaultOwner } from '../harness.mjs';

const buttons = () => page.eval("[...document.querySelectorAll('#app .form-actions button')].map((b) => b.textContent)");

await run(async () => {
  await vaultOwner();
  await holdings([['Cash', 'CHF']]);
  await recording(BACKDATE, { Cash: '100' });
  const [cash] = await idNamed('Cash');
  await plant([{ type: 'snapshot', accountId: cash, payload: { date: '2099-01-01', value: '5', note: null } }]);

  await reloadModel(`#/recording/${BACKDATE}`);
  await page.waitUntil("document.querySelector('#app .form-actions')", { label: 'the recording at a recorded day' });
  check('a recorded day offers Update and Delete', JSON.stringify(await buttons()) === '["Update","Delete"]', JSON.stringify(await buttons()));

  await reloadModel('#/recording/2099-01-01');
  await page.waitUntil("document.querySelector('#app .form-actions')", { label: 'the misdated recording' });
  const shown = await page.eval("document.querySelector('#app').innerText");
  check('the misdated recording lists its figure', shown.includes('Cash'), shown.slice(0, 400));
  check('the misdated recording offers Delete and no Update', JSON.stringify(await buttons()) === '["Delete"]', JSON.stringify(await buttons()));
}, { signsIn: false });
