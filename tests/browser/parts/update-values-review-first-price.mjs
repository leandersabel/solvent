// Reviewer's checks of what the rate-lines save asks on a reopened
// recording, written from spec/features/record-snapshot.md (Update
// values, Changing or clearing a rate says what it moves; criteria 30
// and 102) and record-rate.md (Saving at a date that holds a recording;
// criterion 39) alone. Filling in a missing price asks nothing, and the
// confirmation names only units whose change moves a holding that day.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, D2, ago, id, ev, quiet, press, plantHere, reread, home, line, lineState, typeLine, stored, on, figure, bodyOf, traffic, writesSent, faults, snap, price } = r;

  // Gold holdings the count must tell apart at D1, a unit priced at D1
  // that nothing holds, and one whose only holding sits at zero there.
  const gold = (name, archivedAt = null) => ({
    type: 'account', payload: { name, unit: 'XAU-ozt', dims: {}, note: null, archivedAt, createdAt: '2020-01-03T00:00:00Z' },
  });
  [id['Gold zero'], id['Gold earlier'], id['Gold archived'], id['Gold later'], id.Wine] = await plantHere([
    gold('Gold zero'),
    gold('Gold earlier'),
    gold('Gold archived', ago(250)),
    gold('Gold later'),
    { type: 'account', payload: { name: 'Wine', unit: 'BTL', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-03T00:00:01Z' } },
  ]);
  await plantHere([
    snap('Gold zero', D1, '0'),
    snap('Gold earlier', ago(300), '3'),
    snap('Gold archived', ago(300), '5'),
    snap('Gold archived', ago(250), '0'),
    snap('Gold later', D2, '4'),
    snap('Wine', D1, '0'),
    price('PAINT', D1, '700'),
    price('BTL', D1, '40'),
  ]);
  await reread();
  await home();

  const open = async (hash) => {
    await home();
    await rec.call((next) => { location.hash = next; }, hash);
    await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.rate-line'), { args: [hash], label: hash });
    await quiet();
  };
  const dialogs = () => ev("[...document.querySelectorAll('.dialog')].map((d) => d.innerText).join(' | ')");
  const rateAt = async (symbol, date) => on(await stored('rate'), date).filter((p) => p.payload.symbol === symbol);
  const rateWrites = () => writesSent().filter((w) => (bodyOf(w) || {}).recordType === 'rate');
  // Presses the lines' save and says what, if anything, it asked.
  const saveLines = async () => {
    traffic.length = 0;
    await press('Save the rate lines');
    return dialogs();
  };
  const rowText = (name) =>
    rec.call((holding) => {
      const row = [...document.querySelectorAll('.sweep-row')].find((n) => n.querySelector('.holding-name').textContent === holding);
      return row ? row.innerText : null;
    }, name);

  // ---- 102: an empty line filled in asks nothing ------------------------

  await open(`#/sweep/${D1}`);
  await typeLine('USD', '0.95');
  const emptyAsked = await saveLines();
  const usdD1 = await rateAt('USD', D1);
  check(
    'review 102: a price typed into a reopened recording\'s empty line saves with no confirmation',
    emptyAsked === '' && usdD1.length === 1 && figure(usdD1[0].payload.rate) === 0.95,
    JSON.stringify({ emptyAsked, usdD1: usdD1.map((p) => p.payload) }),
  );

  // ---- 102: an estimate carried from an earlier day, filled in -------------

  await open(`#/sweep/${D2}`);
  const flatBefore = await lineState('m2');
  await typeLine('m2', '10500');
  await typeLine('XAG-ozt', '26');
  const estimateAsked = await saveLines();
  const flatD2 = await rateAt('m2', D2);
  const silverD2 = await rateAt('XAG-ozt', D2);
  check(
    'review 102: prices typed over estimates carried from an earlier day save with no confirmation',
    figure(flatBefore.value) === 10000 && estimateAsked === '' &&
      flatD2.length === 1 && figure(flatD2[0].payload.rate) === 10500 && silverD2.length === 1 && figure(silverD2[0].payload.rate) === 26,
    JSON.stringify({ flatBefore, estimateAsked, flatD2: flatD2.map((p) => p.payload), silverD2: silverD2.map((p) => p.payload) }),
  );

  // ---- 102: a proposal Look it up could not save, typed over ---------------

  await open(`#/sweep/${D2}`);
  const failRates = (entry) => entry.method === 'PUT' && (bodyOf(entry) || {}).recordType === 'rate' && 500;
  faults.push(failRates);
  await rec.call((query) => document.querySelector(query).querySelector('.btn-inline:not([hidden])').click(), line('XAU-ozt'));
  await quiet();
  faults.splice(faults.indexOf(failRates), 1);
  const proposed = await lineState('XAU-ozt');
  await typeLine('XAU-ozt', '2700');
  const proposalAsked = await saveLines();
  const goldD2 = await rateAt('XAU-ozt', D2);
  check(
    'review 102: a price typed over a proposal that holds no stored price saves with no confirmation',
    figure(proposed.value) > 0 && proposalAsked === '' && goldD2.length === 1 && figure(goldD2[0].payload.rate) === 2700,
    JSON.stringify({ proposed, proposalAsked, goldD2: goldD2.map((p) => p.payload) }),
  );

  // ---- 102: a changed price that moves no holding is left out --------------

  await open(`#/sweep/${D1}`);
  await typeLine('PAINT', '800');
  await typeLine('BTL', '45');
  const noneAsked = await saveLines();
  const paint = await rateAt('PAINT', D1);
  const wine = await rateAt('BTL', D1);
  check(
    'review 102: changing stored prices that move no holding that day (none held, or held at zero) opens no confirmation and saves',
    noneAsked === '' && paint.length === 1 && figure(paint[0].payload.rate) === 800 && wine.length === 1 && figure(wine[0].payload.rate) === 45,
    JSON.stringify({ noneAsked, paint: paint.map((p) => p.payload), wine: wine.map((p) => p.payload) }),
  );

  await open(`#/sweep/${D1}`);
  await typeLine('PAINT', '900');
  await typeLine('XAG-ozt', '27');
  const mixed = await saveLines();
  check(
    'review 102: a confirmation for a save that also changes a price moving no holding names only the unit that moves one',
    mixed.includes('Silver, troy ounce') && !mixed.includes('PAINT'),
    mixed,
  );
  await press('Cancel', '.dialog');

  // ---- 39 and 30: the count, announced first, moves the rows on screen ------

  await open(`#/sweep/${D1}`);
  const barsBefore = await rowText('Gold bars');
  await typeLine('XAU-ozt', '2600');
  const counted = await saveLines();
  const sentFirst = rateWrites().length;
  check(
    'review 39: the confirmation counts the gold holdings whose value moves at that date, leaving out one at zero, one archived before, and one first valued after',
    /\bmoves 2 holdings measured in Gold, troy ounce\b/.test(counted),
    counted,
  );
  check('review 30: the change is announced before any price is written', counted !== '' && sentFirst === 0, `${sentFirst} rate writes`);
  await rec.call(() => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() !== 'Cancel').click());
  await quiet();
  const goldD1 = await rateAt('XAU-ozt', D1);
  const barsAfter = await rowText('Gold bars');
  check(
    'review 30: confirming writes the price and the gold row on screen shows the moved figure',
    goldD1.length === 1 && figure(goldD1[0].payload.rate) === 2600 && barsBefore !== null && barsAfter !== barsBefore,
    JSON.stringify({ barsBefore, barsAfter, goldD1: goldD1.map((p) => p.payload) }),
  );
}, { signsIn: false });
