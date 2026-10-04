// Reviewer's checks of the delete dialog reached from Account detail
// (spec/features/manage-accounts.md, Account form, Delete: the user
// chooses, criteria 18 to 21 and 59), written from the feature page
// alone: what the permanent delete says it takes, counted from the
// holding's own snapshots whichever action opened it, whether past net
// worth figures change, which options each holding is offered, and the
// confirm's disabled look.
import {
  BACKDATE, check, click, confirmLook, looksDisabled, looksEnabledRed, openHolding, page, plant, reloadModel,
  rowOf, run, setValue, vaultOwner, watched,
} from '../harness.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const EARLIER = new Date(Date.parse(BACKDATE) - 30 * 86400000).toISOString().slice(0, 10);
const NONE = 'There are no recorded values to delete.';
const STAYS = 'Your past net worth figures stay as they are.';
const CHANGES = 'Your past net worth figures will change.';

const account = (name, archivedAt = null) => ({
  name, unit: 'CHF', dims: {}, note: null, archivedAt, createdAt: new Date().toISOString(),
});
const dialogOpen = () => page.eval("Boolean(document.querySelector('.dialog'))");
const dialogText = () => page.eval("[...document.querySelectorAll('.dialog')].map((d) => d.innerText).join(' | ')");
// The options the dialog shows, by the labels of its visible choices
// and its visible buttons.
const offered = () => page.eval(`(() => {
  const shown = (n) => n.getClientRects().length > 0;
  const dialog = document.querySelector('.dialog');
  return JSON.stringify({
    choices: [...dialog.querySelectorAll('input[type=radio]')].filter(shown).map((r) => r.closest('label').textContent.trim()),
    checked: [...dialog.querySelectorAll('input[type=radio]')].filter((r) => r.checked).map((r) => r.closest('label').textContent.trim()),
    buttons: [...dialog.querySelectorAll('button')].filter(shown).map((b) => b.textContent.trim()),
  });
})()`).then(JSON.parse);
const openDialog = async (id, action) => {
  await openHolding(id);
  await click(action);
  await page.waitUntil("document.querySelector('.dialog')", { label: `the dialog ${action} opens` });
  await page.frames();
};
const choosePurge = async () => {
  await page.eval("[...document.querySelectorAll('.dialog label')].find((l) => l.textContent.trim() === 'Delete permanently').click()");
  await page.frames();
};
const cancel = async () => {
  await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Cancel').click()");
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });
};
// What the permanent delete says, opened through `action`.
const purgeCopy = async (id, action) => {
  await openDialog(id, action);
  if ((await offered()).choices.length) await choosePurge();
  const said = await dialogText();
  await cancel();
  return said;
};
const says = (said, count, past) =>
  said.includes(count) && said.includes(past) && !said.includes(past === STAYS ? CHANGES : STAYS);

await run(async () => {
  await vaultOwner();
  const names = [
    'Empty one', 'Empty two', 'Empty three', 'Valued one', 'Zeros', 'Mixed', 'Debt', 'Closed', 'Sold',
    '<b>Bold</b> & co',
  ];
  const ids = Object.fromEntries((await plant(names.map((name) => ({ type: 'account', payload: account(name) }))))
    .map((id, at) => [names[at], id]));
  const snap = (name, date, value) => ({ type: 'snapshot', accountId: ids[name], payload: { date, value, note: null } });
  const archive = (name) => ({ type: 'account', recordId: ids[name], version: 2, payload: account(name, TODAY) });
  await plant([
    snap('Valued one', BACKDATE, '100.00'),
    snap('Zeros', EARLIER, '0'), snap('Zeros', BACKDATE, '0.00'),
    snap('Mixed', EARLIER, '0'), snap('Mixed', BACKDATE, '5'), snap('Mixed', TODAY, '0.00'),
    snap('Debt', BACKDATE, '-250.00'),
    snap('Closed', TODAY, '0'), archive('Closed'),
    snap('Sold', BACKDATE, '40000.00'), snap('Sold', TODAY, '0'), archive('Sold'),
    snap('<b>Bold</b> & co', BACKDATE, '1.00'),
  ]);
  await reloadModel();

  // ---- 59 and the report: no values, reached through Archive ------------

  await openDialog(ids['Empty one'], 'Archive');
  check('the Archive action on a holding with no values offers permanent delete beside it', (await offered()).choices.includes('Delete permanently'), JSON.stringify(await offered()));
  await choosePurge();
  const empty = await dialogText();
  check('59: no values says there are none to delete and past figures stay', says(empty, NONE, STAYS), empty);
  check('59: no values never counts "0 recorded values"', !/\b0 recorded value/.test(empty), empty);

  // ---- 21: the confirm's disabled look, then red once the name matches --

  check('21: the confirm wears the shared disabled look before the name is typed', looksDisabled(await confirmLook('Delete permanently')), JSON.stringify(await confirmLook('Delete permanently')));
  await setValue('#delete-name', 'Empty on');
  await page.frames();
  check('21: a near-miss name keeps the disabled look and shows no error', looksDisabled(await confirmLook('Delete permanently')) &&
    !(await page.eval("[...document.querySelectorAll('.dialog .field-error')].some((e) => !e.hidden && e.textContent.trim())")),
  JSON.stringify(await confirmLook('Delete permanently')));
  await setValue('#delete-name', 'Empty one');
  await page.frames();
  check('21: the matching name turns the confirm red', looksEnabledRed(await confirmLook('Delete permanently')), JSON.stringify(await confirmLook('Delete permanently')));
  const before = watched[0].requests.length;
  await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Delete permanently').click()");
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the purge to finish' });
  await page.idle();
  const purges = watched[0].requests.slice(before).filter((r) => r.method === 'DELETE');
  check('the purge is one DELETE of the holding, mode=purge, with the CSRF header',
    purges.length === 1 && purges[0].url.endsWith(`/api/accounts/${ids['Empty one']}?mode=purge`) && purges[0].headers.includes('X-Solvent-Request'),
    JSON.stringify(purges));
  check('the purged holding is gone from the store', rowOf(ids['Empty one']) === undefined);

  // ---- 19: Delete on a holding with no snapshots asks nothing -----------

  await openHolding(ids['Empty two']);
  await page.eval(`(() => {
    window.__dialogSeen = false;
    new MutationObserver(() => { if (document.querySelector('.dialog')) window.__dialogSeen = true; })
      .observe(document.body, { childList: true, subtree: true });
  })()`);
  await click('Delete');
  for (let n = 0; n < 200 && rowOf(ids['Empty two']) !== undefined; n++) await page.frames();
  await page.idle();
  check('19: Delete on a holding with no snapshots deletes it', rowOf(ids['Empty two']) === undefined);
  check('19: and shows no dialog on the way', !(await page.eval('window.__dialogSeen')) && !(await dialogOpen()));

  // ---- 18: a holding with values offers both, archive preselected -------

  await openDialog(ids['Valued one'], 'Delete');
  const both = await offered();
  check('18: Delete on a holding with snapshots offers archive and permanent delete', both.choices.includes('Archive') && both.choices.includes('Delete permanently'), JSON.stringify(both));
  check('18: archive is preselected', both.checked.length === 1 && both.checked[0] === 'Archive', JSON.stringify(both));
  await cancel();

  // ---- The copy by count and by whether a figure is not zero ------------

  const one = await purgeCopy(ids['Valued one'], 'Delete');
  check('one non-zero value: deletes 1 recorded value and past figures change', says(one, 'This also deletes 1 recorded value.', CHANGES), one);
  const viaArchive = await purgeCopy(ids['Valued one'], 'Archive');
  check('the same holding reached through Archive says the same', says(viaArchive, 'This also deletes 1 recorded value.', CHANGES), viaArchive);
  const zeros = await purgeCopy(ids.Zeros, 'Delete');
  check('several zeros, "0" and "0.00": deletes 2 recorded values and past figures stay', says(zeros, 'This also deletes 2 recorded values.', STAYS), zeros);
  const mixed = await purgeCopy(ids.Mixed, 'Delete');
  check('zeros and one figure: deletes 3 recorded values and past figures change', says(mixed, 'This also deletes 3 recorded values.', CHANGES), mixed);
  const debt = await purgeCopy(ids.Debt, 'Delete');
  check('a negative figure is not zero: past figures change', says(debt, 'This also deletes 1 recorded value.', CHANGES), debt);

  // ---- 20 and 59: archived holdings offer permanent delete alone --------

  await openDialog(ids.Closed, 'Delete');
  const alone = await offered();
  check('20: Delete on an archived holding offers no archive', !alone.choices.includes('Archive') && !alone.buttons.includes('Archive'), JSON.stringify(alone));
  check('20: and offers permanent delete', alone.buttons.includes('Delete permanently'), JSON.stringify(alone));
  const closed = await dialogText();
  check('59: an archived holding whose only value is its zero deletes 1 recorded value and past figures stay', says(closed, 'This also deletes 1 recorded value.', STAYS), closed);
  check('21: the archived holding\'s confirm wears the disabled look', looksDisabled(await confirmLook('Delete permanently')), JSON.stringify(await confirmLook('Delete permanently')));
  await setValue('#delete-name', 'Closed');
  await page.frames();
  check('21: and turns red once the name matches', looksEnabledRed(await confirmLook('Delete permanently')), JSON.stringify(await confirmLook('Delete permanently')));
  await cancel();
  const sold = await purgeCopy(ids.Sold, 'Delete');
  check('an archived holding with an earlier figure: deletes 2 recorded values and past figures change', says(sold, 'This also deletes 2 recorded values.', CHANGES), sold);

  // ---- Read each time the dialog opens ----------------------------------

  const first = await purgeCopy(ids['Empty three'], 'Archive');
  check('a holding with no values says so the first time', says(first, NONE, STAYS), first);
  await plant([snap('Empty three', BACKDATE, '75.00')]);
  await reloadModel();
  const again = await purgeCopy(ids['Empty three'], 'Delete');
  check('once it holds a value, the next opening counts it', says(again, 'This also deletes 1 recorded value.', CHANGES), again);

  // ---- The name renders as text in the dialog --------------------------

  await openDialog(ids['<b>Bold</b> & co'], 'Delete');
  check('a name holding markup shows as literal text in the dialog and builds no element',
    (await dialogText()).includes('<b>Bold</b> & co') && !(await page.eval("Boolean(document.querySelector('.dialog b'))")),
    await dialogText());
  await cancel();
}, { signsIn: false });
