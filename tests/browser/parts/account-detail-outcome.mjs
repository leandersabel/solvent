// The archive dialog once it shows its outcome (spec/ui/unlock.md,
// Rules): what a lock keeps is a fill-in dialog with what was typed in
// it, and an outcome message is not one.
// Templates: dashboard.html. Modules: view-holding-form.js, dom.js, app.js.
import {
  BACKDATE, VAULT_PASSWORD, check, click, enterPassword, failing, inDialog, openHolding, page, plant, reloadModel,
  run, story, text, unlockDashboard, vaultOwner, writing,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await story();
  await unlockDashboard('the dashboard of the story');
  const [euroId] = await plant([
    { type: 'account', payload: { name: 'Probe euro', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
  ]);
  await plant([{ type: 'snapshot', accountId: euroId, payload: { date: BACKDATE, value: '100', note: null } }]);
  await reloadModel();
  await openHolding(euroId);
  await click('Archive');
  await page.waitUntil("document.body.innerText.includes('Records zero for this holding on')", { label: 'the archive dialog' });
  // The archive goes through and the price of its unit does not save,
  // which leaves the dialog showing what landed and what did not.
  await failing(writing('rate'), async () => {
    await inDialog('Archive');
    await page.waitUntil("document.body.innerText.includes('Add them in the recording for that date')", { timeout: 60000, label: 'the price failure' });
  });
  check('the dialog shows its outcome', (await text()).includes('Archived. The prices for EUR'));

  await page.eval("document.querySelector('.btn-lock').click()");
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the lock' });
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("!document.querySelector('#unlock-password') && document.querySelector('.topbar nav a')", { timeout: 90000, label: 'the unlock' });
  await page.idle();
  const after = await page.eval("JSON.stringify([...document.querySelectorAll('.dialog')].map((d) => d.innerText))");
  check('unlocking after a lock on the outcome reopens no archive-or-delete dialog', JSON.parse(after).length === 0, after);
});
