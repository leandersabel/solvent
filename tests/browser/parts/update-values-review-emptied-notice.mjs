// Reviewer's checks of when the Callout about a recording deleted in
// another window shows and goes, written from
// spec/features/record-snapshot.md (Update values, States, "The date was
// emptied while you were working"; "Rate lines on a reopened recording";
// criterion 117) and record-rate.md (criteria 43 and 45) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const DELETED = 'Another window deleted the recording for';
const FILLED = 'The USD rate was filled in another window, and the line shows what is stored now.';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const {
    rec, D1, ago, ev, quiet, press, go, home, newRecording, stored, on, plantHere, reread, snap, price, faults, traffic,
    bodyOf, unwatched, line, lineState, typeLine, typeRow, pressRow, rowState,
  } = r;

  const shown = () => ev("document.querySelector('main').innerText.replace(/\\s+/g, ' ')");
  const deletedNotice = async () => (await shown()).includes(DELETED);
  const atDate = async (date) => [...on(await stored('snapshot'), date), ...on(await stored('rate'), date)];
  const ratesAt = async (date) => Object.fromEntries(on(await stored('rate'), date).map((p) => [p.payload.symbol, p.payload]));
  const emptyElsewhere = async (date) => {
    const ids = (await atDate(date)).map((x) => x.recordId);
    await unwatched(() => rec.call(async (gone) => {
      const api = await import('/static/js/api.js');
      for (const recordId of gone) await api.del('/api/records/' + recordId);
    }, ids));
  };
  const saveLines = async () => {
    traffic.length = 0;
    await press('Save the rate lines');
    if (await ev("Boolean(document.querySelector('.dialog'))")) await press('Save the prices', '.dialog');
    await quiet();
  };
  const reopen = async (date) => {
    await go(`#/recording/${date}`);
    await press('Update', '.form-actions');
    await rec.waitUntil((query) => Boolean(document.querySelector(query)), { args: [line('USD')], label: 'the rate lines' });
    await quiet();
  };
  const lookUp = async (unit) => {
    await rec.call((query) => document.querySelector(query).querySelector('.btn-inline').click(), line(unit));
    await quiet();
  };

  // ---- 117: the banner from before the save, then the Callout ----------

  // D1 holds no dollar price, so its USD line reopens empty, and a price
  // typed there meets one another window stored meanwhile.
  await home();
  await reopen(D1);
  await typeLine('USD', '0.96');
  await quiet();
  await plantHere([price('USD', D1, '0.93', 'proposed')]);
  await saveLines();
  check('review 117: the save first says the USD rate was filled in another window', (await shown()).includes(FILLED),
    (await shown()).slice(0, 600));

  await typeLine('XAU-ozt', '2777');
  await quiet();
  await emptyElsewhere(D1);
  await saveLines();
  const page = await shown();
  check('review 117: the next save, on the deleted recording, shows the Callout', page.includes(DELETED), page.slice(0, 600));
  check('review 117: the banner about the recording as it stood is gone beside the Callout', !page.includes(FILLED),
    page.slice(0, 600));

  await typeRow('Savings', '5100');
  await pressRow('Savings');
  const priced = await ratesAt(D1);
  check('review 117: recording the first holding saved the typed price', priced['XAU-ozt']?.rate === '2777',
    JSON.stringify(priced));
  const afterRow = await shown();
  check('review 117: once the first holding saved the prices, the Callout is gone', !afterRow.includes(DELETED),
    afterRow.slice(0, 600));
  check('review 117: the banner from before the deletion does not come back', !afterRow.includes(FILLED), afterRow.slice(0, 600));

  // ---- 43: the same on a sweep that started the date -------------------

  const E = ago(60);
  await home();
  await newRecording(E);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '',
    { args: [line('XAU-ozt')], label: 'the proposals' });
  await typeRow('Current account', '1200');
  await pressRow('Current account');
  await typeLine('USD', '0.97');
  await quiet();
  await emptyElsewhere(E);
  await saveLines();
  check('review 43: changing a stored price on the deleted recording shows the Callout', await deletedNotice(),
    (await shown()).slice(0, 600));
  await typeRow('Savings', '5200');
  await pressRow('Savings');
  check('review 43: recording the next row wrote the typed price', (await ratesAt(E)).USD?.rate === '0.97',
    JSON.stringify(await ratesAt(E)));
  check('review 117: the Callout is gone once that row saved the prices', !(await deletedNotice()), (await shown()).slice(0, 600));

  // ---- Look it up on a deleted recording, answered by Confirm ----------

  // Current account holds 1100 at D2, before H, so Confirm records it.
  const H = ago(65);
  await plantHere([snap('Current account', H, '1000')]);
  await reread();
  await home();
  await reopen(H);
  await emptyElsewhere(H);
  await lookUp('USD');
  check('review: Look it up on the deleted recording shows the Callout', await deletedNotice(), (await shown()).slice(0, 600));
  const confirm = await rowState('Current account');
  check('review: the emptied date offers Confirm on a holding valued before it', confirm.label.trim() === 'Confirm' && !confirm.disabled,
    JSON.stringify(confirm));
  await pressRow('Current account');
  const h = await ratesAt(H);
  check('review: Confirm recorded the holding and the prices at the date', on(await stored('snapshot'), H).length === 1 &&
    h.USD?.rateSource === 'proposed', JSON.stringify(h));
  check('review 117: the Callout is gone once a confirmed holding saved the prices', !(await deletedNotice()),
    (await shown()).slice(0, 600));

  // ---- A first holding whose save failed has saved nothing -------------

  const F = ago(70);
  await plantHere([snap('Current account', F, '1000')]);
  await reread();
  await home();
  await reopen(F);
  await emptyElsewhere(F);
  await lookUp('USD');
  check('review: the second deleted recording shows the Callout', await deletedNotice(), (await shown()).slice(0, 600));
  const refuse = (entry) => entry.method === 'PUT' && bodyOf(entry)?.recordType === 'snapshot' ? 500 : 0;
  faults.push(refuse);
  await typeRow('Savings', '5300');
  await pressRow('Savings');
  faults.splice(faults.indexOf(refuse), 1);
  check('review: the refused row wrote nothing at the date', (await atDate(F)).length === 0,
    JSON.stringify((await atDate(F)).map((x) => x.payload)));
  check('review 117: the Callout stays while no holding has saved the prices', await deletedNotice(), (await shown()).slice(0, 600));
  await pressRow('Savings');
  check('review: the retried row saved the prices', (await ratesAt(F)).USD?.rateSource === 'proposed',
    JSON.stringify(await ratesAt(F)));
  check('review 117: the Callout is gone once the retried row saved the prices', !(await deletedNotice()),
    (await shown()).slice(0, 600));
}, { signsIn: false });
