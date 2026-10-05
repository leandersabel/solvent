// Reviewer's checks of a date move against another window's recording
// (spec/features/record-snapshot.md, Editing an existing snapshot, and
// Creating and reopening are distinct acts), written from the acceptance
// criteria alone: a move onto a date the Dialog showed empty is refused
// once anything is recorded there, a move onto a date that held a
// recording is judged by its slots only, and a slot taken by a record
// the confirmation did not name refuses the move.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, D1, D2, id, traffic, writesSent, typeReads, ev, quiet, set, press, stored, on, bytes, go, format, plantHere, snap, reread } = r;

  const sent = () => writesSent().map((t) => `${t.method} ${t.url}`);
  const dialogText = () => ev("[...document.querySelectorAll('.dialog')].map(d => d.innerText).join(' | ')");
  const dialogButtons = () => ev(`[...document.querySelectorAll('.dialog button')]
    .filter((b) => b.getClientRects().length && !b.closest('details:not([open])')).map((b) => b.textContent.trim())`);
  const save = async () => {
    await ev("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
    await quiet();
  };
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
  };
  const editEntry = async (name, iso) => {
    await go(`#/holding/${id[name]}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `${name}'s entry at ${iso}` });
    await quiet();
  };
  // The Dialog shows the new date once the field holds it and the prices
  // line has followed.
  const moveTo = async (iso) => {
    await set('#snapshot-date', await format('date', iso));
    await quiet();
  };
  const snapshotsOf = async (name) => (await stored('snapshot')).filter((s) => s.accountId === id[name]);
  const atDate = async (iso) => bytes([...on(await stored('snapshot'), iso), ...on(await stored('rate'), iso)]);
  // Folded or not, the prices line says what the Dialog takes the date for.
  const pricesSay = () => ev("[...document.querySelectorAll('.dialog')].pop().textContent");
  const takenCopy = async (iso) => `${await format('longDate', iso)} already has a recording. Another window got there first.`;

  // Asserts a refused move: nothing sent, the holding's entries and the
  // new date's records untouched, the date named, its recording offered.
  const refused = async (label, name, iso, before) => {
    const said = await dialogText();
    const buttons = await dialogButtons();
    check(`${label}: nothing is written`, sent().length === 0, sent().join(', '));
    check(
      `${label}: the holding's entries and the records at the new date are untouched`,
      bytes(await snapshotsOf(name)) === before.holding && (await atDate(iso)) === before.date,
    );
    check(`${label}: the move ran its reload before refusing`, typeReads('snapshot').length >= 1, String(typeReads('snapshot').length));
    check(`${label}: the Dialog names the date as recorded by another window`, said.includes(await takenCopy(iso)), said);
    check(`${label}: the Dialog offers the recording`, buttons.includes('Open the recording'), JSON.stringify(buttons));
  };
  const snapshot = async (name, iso) => ({ holding: bytes(await snapshotsOf(name)), date: await atDate(iso) });

  // ---- 92: the reported case, another holding's figure at a date the Dialog showed empty

  const EMPTY = ago(61);
  await editEntry('Savings', D1);
  await moveTo(EMPTY);
  const shownEmpty = await pricesSay();
  check(
    'review 92: the Dialog shows the new date as holding no recording',
    shownEmpty.includes(`Prices for ${await format('longDate', EMPTY)} will be recorded with this`),
    shownEmpty,
  );
  await plantHere([snap('Fund 1', EMPTY, '111')]);
  let before = await snapshot('Savings', EMPTY);
  traffic.length = 0;
  await save();
  await refused('review 92', 'Savings', EMPTY, before);
  await press('Open the recording', '.dialog');
  check(
    'review 92: Open the recording goes to that date\'s recording, holding the other window\'s figure',
    (await ev('location.hash')) === `#/recording/${EMPTY}` && (await ev("document.body.innerText.includes('Fund 1')")),
    await ev('location.hash'),
  );
  await closeDialogs();

  // The same, with the other window's figure already stored when the
  // Dialog showed the date, behind a model that still says it is free.
  const STALE = ago(62);
  await plantHere([snap('Fund 2', STALE, '222')]);
  await editEntry('Savings', D1);
  await moveTo(STALE);
  const shownStale = await pricesSay();
  check(
    'review 92: a date stored behind the model shows as holding no recording',
    shownStale.includes(`Prices for ${await format('longDate', STALE)} will be recorded with this`),
    shownStale,
  );
  before = await snapshot('Savings', STALE);
  traffic.length = 0;
  await save();
  await refused('review 92, stored before the Dialog showed it', 'Savings', STALE, before);
  await closeDialogs();

  // ---- The other half of the rule: a date that held records is judged by its slots

  await reread();
  await editEntry('Savings', D1);
  await moveTo(D2);
  await plantHere([snap('Fund 3', D2, '333')]);
  traffic.length = 0;
  await save();
  await closeDialogs();
  const savings = await snapshotsOf('Savings');
  check(
    'review: a move onto a date that held a recording saves when another holding\'s figure joins it meanwhile',
    on(savings, D2).length === 1 && on(savings, D1).length === 0,
    `${sent().join(', ')} | ${JSON.stringify(savings.map((s) => s.payload))}`,
  );

  // ---- 79: the holding's own slot taken by a record the move did not see

  const FRESH = ago(63);
  await editEntry('Mortgage', D1);
  await moveTo(FRESH);
  await plantHere([snap('Mortgage', FRESH, '-1')]);
  before = await snapshot('Mortgage', FRESH);
  traffic.length = 0;
  await save();
  await refused('review 79, at a date the Dialog showed empty', 'Mortgage', FRESH, before);
  await closeDialogs();

  await reread();
  await editEntry('Fund 4', D1);
  await moveTo(D2);
  await plantHere([snap('Fund 4', D2, '44')]);
  before = await snapshot('Fund 4', D2);
  traffic.length = 0;
  await save();
  await refused('review 79, at a date that held a recording', 'Fund 4', D2, before);
  await closeDialogs();

  // The confirmation named one record in the slot, and another window
  // added a second there before it was confirmed.
  await plantHere([snap('Fund 5', D2, '50')]);
  await reread();
  await editEntry('Fund 5', D1);
  await moveTo(D2);
  await save();
  const confirm = await dialogText();
  check('review 79: the move onto the holding\'s own entry asks to delete it', confirm.includes('Moving this entry there will delete it.'), confirm);
  await plantHere([snap('Fund 5', D2, '51')]);
  before = await snapshot('Fund 5', D2);
  traffic.length = 0;
  await ev("[...document.querySelectorAll('.dialog .btn-destructive')].pop().click()");
  await quiet();
  await refused('review 79, a second record beside the one the confirmation named', 'Fund 5', D2, before);
  await closeDialogs();
}, { signsIn: false });
