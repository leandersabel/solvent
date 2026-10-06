// Reviewer's checks that no screen says "snapshot"
// (spec/features/record-snapshot.md, Screens, criteria 62, 70 and 97, and
// manage-accounts.md, Account detail), written from the feature pages
// alone. A scan of the source passes copy built at run time and misses an
// accessible name, so each state is reached in the browser and read twice:
// as drawn, and as the accessibility tree names it.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const WORD = /snapshot/i;
// A figure's digits, however Settings groups and points them.
const DIGITS = String.raw`\d[\d,.'’   ]*`;

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ev, quiet, set, press, go, format, stored, plantHere, archiveElsewhere, faults, snap, id, D1, D2, T } = r;
  await rec.send('Accessibility.enable');

  // Every text the page shows and every name, description and value the
  // accessibility tree gives a node a person can reach.
  const heard = async () => {
    const shown = await ev("document.title + '\\n' + document.body.innerText");
    const { nodes } = await rec.send('Accessibility.getFullAXTree');
    const named = nodes.filter((n) => !n.ignored)
      .flatMap((n) => [n.name, n.description, n.value].map((p) => (p && typeof p.value === 'string' ? p.value : '')))
      .filter(Boolean);
    return [shown, ...named].join('\n');
  };
  const listen = async (state) => {
    const said = await heard();
    const at = said.search(WORD);
    check(`review 97: ${state} says no "snapshot"`, at < 0, at < 0 ? '' : said.slice(Math.max(0, at - 120), at + 60));
  };
  const dialogText = () => ev("[...document.querySelectorAll('.dialog')].map((d) => d.innerText).join(' | ')");
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
    await quiet();
  };
  const headerAction = (label) =>
    rec.call((name) => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === name).click(), label);
  const rowAction = async (iso, label) => {
    const day = await format('longDate', iso);
    await rec.call((shown, name) => [...document.querySelectorAll('.values-table tbody tr')]
      .find((row) => row.cells[0].textContent.startsWith(shown))
      .querySelectorAll('button').forEach((b) => { if (b.textContent.trim() === name) b.click(); }), day, label);
    await rec.waitUntil("document.querySelector('.dialog')", { label: `${label} at ${iso}` });
    await quiet();
  };
  const save = async () => {
    await ev("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find((b) => b.textContent === 'Save').click()");
    await quiet();
  };
  const holding = (name) => go(`#/holding/${id[name]}`);

  // ---- The screens as they stand

  await go('#/');
  await listen('the dashboard');
  await press('New recording');
  await listen('the New recording picker');
  await closeDialogs();
  await press('Add a holding');
  await listen('the Add holding form');
  await closeDialogs();
  for (const hash of ['#/settings', '#/settings/dimensions', '#/settings/export-import', `#/recording/${D1}`, `#/sweep/${T}`, `#/sweep/${D1}`]) {
    await go(hash);
    await listen(hash);
  }
  await go(`#/recording/${D1}`);
  await press('Delete');
  await listen("the delete confirmation of a recording");
  await closeDialogs();

  // Account detail: a holding with no values, one, and several.
  await holding('Art');
  const empty = await ev("document.querySelector('main').innerText");
  check('manage-accounts Account detail: the empty state reads as the page sets',
    empty.includes('Nothing recorded yet. Record what this holding is worth.'), empty);
  await listen('Account detail with no values');
  await holding('Savings');
  await listen('Account detail with one value');
  await holding('Current account');
  await listen('Account detail with several values');

  // Two values for one holding on one date: both flagged, Keep this one.
  await plantHere([snap('Fund 1', D2, '1'), snap('Fund 1', D2, '2')]);
  await r.reread();
  await holding('Fund 1');
  await listen('Account detail with two values on one date');
  await go(`#/recording/${D2}`);
  await listen('Recording detail with two values on one date');
  await go(`#/sweep/${D2}`);
  await listen('Update values with two values on one date');

  // ---- Snapshot entry, new

  await holding('Savings');
  await headerAction('Record a value');
  await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the single-holding form' });
  await quiet();
  await listen('Snapshot entry, new');
  await ev("[...document.querySelectorAll('.dialog details, .dialog summary')].forEach((n) => { if (n.tagName === 'DETAILS') n.open = true; })");
  await set('#snapshot-value', '5100');
  await quiet();
  await listen('Snapshot entry, new, value typed and prices opened');

  // An impossible date gets one message on the date field, and it
  // is not the future reason.
  const real = await format('date', '2025-02-28');
  await set('#snapshot-date', real.replace('28', '30'));
  await save();
  const impossible = await ev(`[...document.querySelectorAll('.dialog .field-error, .dialog [role=alert], .dialog .form-error')]
    .filter((n) => !n.hidden && n.textContent.trim()).map((n) => n.textContent.trim())`);
  check('record-snapshot Refusing a date: an impossible date gets one message, never the future reason',
    impossible.length === 1 && !/future/i.test(impossible[0]), JSON.stringify(impossible));
  await listen('Snapshot entry, an impossible date refused');

  // A date that holds a value of this holding: the replace prompt.
  await set('#snapshot-date', await format('date', D1));
  await quiet();
  await save();
  await listen('Snapshot entry, the replace prompt');
  await closeDialogs();
  await listen('Account detail after leaving a form unsaved');

  // ---- Snapshot entry, editing: the move prompt (70)

  await holding('Current account');
  await rowAction(D2, 'Edit');
  await listen('Snapshot entry, editing');
  await set('#snapshot-date', await format('date', D1));
  await quiet();
  await save();
  const moving = await dialogText();
  const movePrompt = new RegExp(`${await format('longDate', D1)} already holds a value of CHF\\s?${DIGITS}\\. Moving this entry there will delete it\\.`);
  check('review 70: moving onto an occupied date says which value it deletes, as the page sets',
    movePrompt.test(moving), moving);
  await listen('Snapshot entry, the move prompt');
  await closeDialogs();

  // ---- A stale version, from another tab (62)

  await holding('Savings');
  await rowAction(D1, 'Edit');
  await set('#snapshot-value', '5200');
  const held = (await stored('snapshot')).find((s) => s.accountId === id.Savings && s.payload.date === D1);
  await plantHere([{ ...snap('Savings', D1, '5300'), recordId: held.recordId, version: held.version + 1 }]);
  await save();
  const conflicted = await ev("document.body.innerText");
  const after = (await stored('snapshot')).find((s) => s.recordId === held.recordId);
  check('review 62: a stale edit overwrites nothing', after.version === held.version + 1 && after.payload.value === '5300', JSON.stringify(after.payload));
  check('review 62: a stale edit says the value was changed in another tab',
    conflicted.includes('This value was changed in another tab.'), conflicted.slice(0, 800));
  await listen('a stale edit refused');
  await closeDialogs();
  await r.reread();

  // ---- Deleting a value

  await holding('Current account');
  await rowAction(D2, 'Delete');
  const several = await dialogText();
  check('manage-accounts Deleting a snapshot: the confirm names the value as the page sets',
    new RegExp(`Delete the value of CHF\\s?${DIGITS} for [^?]+\\?\\s+Your net worth for the period around this date will change\\.`).test(several),
    several);
  await listen('the delete confirmation of one of several values');
  faults.push((entry) => (entry.method === 'DELETE' ? 500 : 0));
  await ev("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Delete').click()");
  await quiet();
  faults.length = 0;
  const failed = await ev("document.body.innerText");
  check('manage-accounts Account detail: a failed delete says nothing was deleted', failed.includes('Nothing was deleted.'), failed.slice(0, 800));
  await listen('a failed delete');
  await closeDialogs();

  await holding('Savings');
  await rowAction(D1, 'Delete');
  const only = await dialogText();
  check('manage-accounts Deleting a snapshot: deleting the only value says the holding returns to "Not yet valued"',
    /not yet valued/i.test(only), only);
  await listen('the delete confirmation of the only value');
  await closeDialogs();

  // ---- The holding's own dialogs

  await holding('Current account');
  for (const action of ['Edit', 'Archive', 'Delete']) {
    await headerAction(action);
    await rec.waitUntil("document.querySelector('.dialog, form')", { label: action });
    await quiet();
    await listen(`Account detail, ${action}`);
    await closeDialogs();
    await holding('Current account');
  }

  // An archived holding: its screen, its permanent delete, and a form
  // open since before another window archived it.
  await archiveElsewhere('Fund 3', T);
  await r.reread();
  await holding('Fund 3');
  await listen('Account detail of an archived holding');
  await headerAction('Delete');
  await rec.waitUntil("document.querySelector('.dialog')", { label: 'the permanent delete' });
  await listen('the permanent delete of an archived holding');
  await closeDialogs();

  await holding('Fund 2');
  await headerAction('Record a value');
  await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the form for Fund 2' });
  await set('#snapshot-value', '7');
  await archiveElsewhere('Fund 2', T);
  await save();
  await listen('Snapshot entry, the holding archived in another window');
  await closeDialogs();

}, { signsIn: false });
