// Reviewer's checks of the Account form's unit picker with a retired
// unit (spec/features/manage-accounts.md, Account form, Fields, Measured
// in, criterion 64; rate-lookup.md, Maintaining the table), written from
// the spec alone. Silver by the troy ounce is retired before the vault
// exists, and two holdings are already measured in it: one with values,
// one without.
import { check, run, sql } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const RETIRED = 'XAG-ozt';
const LABEL = 'Silver, troy ounce';
const REFUSAL = 'XAG-ozt is no longer offered for new holdings.';

await run(async () => {
  sql('UPDATE symbols SET retired = 1 WHERE symbol = ?', RETIRED);
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, id, text, press, quiet, set, go, home, plantHere, reread, stored, writesSent, traffic } = r;

  const [bar] = await plantHere([
    { type: 'account', payload: { name: 'Silver bar', unit: RETIRED, dims: {}, note: null, archivedAt: null, createdAt: '2020-01-03T00:00:00Z' } },
  ]);
  await reread();
  await home();

  const options = () =>
    rec.call(() => [...document.querySelectorAll('#holding-unit-list [role=option]')]
      .map((o) => ({ symbol: o.dataset.symbol || '', text: o.textContent.trim() })));

  await press('Add a holding');
  await rec.waitUntil("document.querySelectorAll('#holding-unit-list [data-symbol]').length > 10", { label: 'the unit list' });
  const offered = await options();
  check(
    'review 64: a retired unit is not offered for a new holding, and its neighbours are',
    !offered.some((o) => o.symbol === RETIRED || o.text.includes(LABEL)) &&
      offered.some((o) => o.symbol === 'XAG-g') && offered.some((o) => o.symbol === 'XAU-ozt'),
    JSON.stringify(offered.map((o) => o.symbol)),
  );
  await set('#holding-unit', 'troy');
  await quiet();
  const searched = await options();
  check(
    'review 64: searching the list never finds a retired unit',
    !searched.some((o) => o.symbol === RETIRED || o.text.includes(LABEL)) && searched.some((o) => o.symbol === 'XAU-ozt'),
    JSON.stringify(searched.map((o) => o.symbol)),
  );
  await set('#holding-unit', '');

  const accountsBefore = (await stored('account')).length;
  await set('#holding-name', 'New silver');
  await rec.eval("document.querySelector('#holding-unit-list .unit-other').click()");
  const refusals = {};
  for (const typed of ['XAG-ozt', 'xag-ozt', 'XAG-OZT', '  xAg-OzT  ']) {
    traffic.length = 0;
    await set('#holding-unit-other', typed);
    await rec.eval("document.querySelector('.dialog button[type=submit]').click()");
    await quiet();
    refusals[typed] = {
      says: (await text()).includes(REFUSAL),
      open: await rec.eval("Boolean(document.querySelector('.dialog'))"),
      writes: writesSent().length,
    };
  }
  check(
    'review 64: a retired symbol typed as free text, in any case, is refused naming it, and writes nothing',
    Object.values(refusals).every((x) => x.says && x.open && x.writes === 0) && (await stored('account')).length === accountsBefore,
    JSON.stringify(refusals),
  );
  await press('Cancel', '.dialog');

  // A holding already measured in it shows it as its current choice,
  // by its label, and nothing needs deciding to save it.
  const edit = async (account) => {
    await go(`#/holding/${account}`);
    await rec.waitUntil("[...document.querySelectorAll('button, a')].some((b) => b.textContent.trim() === 'Edit')", { label: 'the Edit control' });
    await press('Edit');
    await rec.waitUntil("document.querySelector('#holding-name')", { label: 'the holding editor' });
    await quiet();
    // Locked, the choice reads in the disabled field. Open, it is the
    // option the list marks selected.
    return rec.call(() => ({
      shown: document.querySelector('#holding-unit').value,
      selected: [...document.querySelectorAll('#holding-unit-list [aria-selected=true]')].map((o) => o.textContent.trim()),
      disabled: document.querySelector('#holding-unit').disabled,
    }));
  };
  const valued = await edit(id['Silver coins']);
  check(
    'review 64: a holding with values in a retired unit shows it by its label, fixed',
    valued.shown.includes(LABEL) && valued.disabled,
    JSON.stringify(valued),
  );
  await rec.eval("[...document.querySelectorAll('#app .panel-form button')].find((b) => b.textContent === 'Cancel').click()");
  await quiet();

  const fresh = await edit(bar);
  check(
    'review 64: a holding with no values in a retired unit shows it by its label as the current choice',
    fresh.selected.length === 1 && fresh.selected[0].includes(LABEL),
    JSON.stringify(fresh),
  );
  await set('#holding-name', 'Silver bar, renamed');
  traffic.length = 0;
  await rec.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
  await rec.waitUntil("!document.querySelector('#holding-name')", { label: 'the edit to save', timeout: 10000 }).catch(() => {});
  await quiet();
  const saved = (await stored('account')).find((a) => a.recordId === bar)?.payload;
  check(
    'review 64: renaming a holding in a retired unit saves, and keeps the unit',
    saved?.name === 'Silver bar, renamed' && saved?.unit === RETIRED && !(await text()).includes(REFUSAL),
    JSON.stringify(saved),
  );
}, { signsIn: false });
