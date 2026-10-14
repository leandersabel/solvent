// Reviewer's checks that what was typed on the sweep and not saved comes
// back after a lock in the row of the holding, and the line of the unit,
// it was typed for, also where the sweep drawn after the unlock orders
// its rows or lines differently, written from
// spec/features/record-snapshot.md (Update values, Rules; criterion 116)
// and spec/features/login.md (Unlock, Rules; criteria 55 and 56) alone.
import { RECORDER_PASSWORD, check, enterPasswordOn, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, D1, D2, id, ev, quiet, plantHere, home, newRecording, go, typeRow, typeLine, lineState, pressRow, stored, on, figure, snap, price } = r;

  // Every row and line in screen order, with what its field holds and
  // what its control offers.
  const rows = () =>
    rec.call(() => [...document.querySelectorAll('.sweep-row')].map((row) => {
      const control = row.querySelector(':scope > button');
      return {
        name: row.querySelector('.holding-name').textContent,
        field: row.querySelector('input') ? row.querySelector('input').value : null,
        label: control ? control.textContent.trim() : null,
        live: Boolean(control) && !control.disabled,
      };
    }));
  const lines = () =>
    rec.call(() => [...document.querySelectorAll('.rate-line')].map((l) => ({
      unit: l.dataset.unit,
      field: l.querySelector('input') ? l.querySelector('input').value : null,
    })));
  const lock = async (back) => {
    await ev("document.querySelector('.btn-lock').click()");
    await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
    await enterPasswordOn(rec, RECORDER_PASSWORD);
    await rec.waitUntil(back, { timeout: 90000, label: 'the screen after unlocking' });
    await quiet();
  };
  const order = (list, key) => list.map((x) => x[key]);
  const moved = (before, after, key, which) =>
    which.some((name) => order(before, key).indexOf(name) !== order(after, key).indexOf(name));
  // Each typed figure is in its own row or line, and in no other.
  const inPlace = (list, key, typed) =>
    Object.entries(typed).every(([name, value]) => list.find((x) => x[key] === name)?.field === value) &&
    list.every((x) => !Object.values(typed).includes(x.field) || typed[x[key]] === x.field);
  const newHolding = (name, unit, createdAt) => ({
    type: 'account', payload: { name, unit, dims: {}, note: null, archivedAt: null, createdAt },
  });

  // ---- A new sweep: rows answered by typing, lines over proposals ------

  const DX = ago(45);
  await home();
  await newRecording(DX);
  const typedRows = { Savings: '5555', 'Fund 3': '3333', Mortgage: '-390000' };
  for (const [name, value] of Object.entries(typedRows)) await typeRow(name, value);
  // A quantity of PAINT, which has no price at all, puts its line at the
  // head of the block.
  await typeRow('Art', '7');
  typedRows.Art = '7';
  const typedLines = { USD: '0.77', m2: '11111' };
  for (const [unit, value] of Object.entries(typedLines)) await typeLine(unit, value);
  const rowsBefore = await rows();
  const linesBefore = await lines();

  // Another window, behind the sweep on screen: a holding that sorts
  // first by name and by age, one in a unit nothing else is measured in,
  // a first figure for Art, and a price for PAINT, so its line no longer
  // asks for one at the head of the block.
  const [aardvark, acre] = await plantHere([
    newHolding('Aardvark fund', 'CHF', '2019-01-01T00:00:00Z'),
    newHolding('Acre field', 'ACRE', '2019-01-01T00:00:01Z'),
  ]);
  id['Aardvark fund'] = aardvark;
  id['Acre field'] = acre;
  await plantHere([snap('Aardvark fund', D1, '77'), snap('Art', D1, '2'), price('PAINT', D1, '300')]);

  await lock("!document.querySelector('#unlock-password') && document.querySelector('.sweep-row')");
  const rowsAfter = await rows();
  const linesAfter = await lines();
  check(
    'review 116: the sweep drawn after the unlock orders its rows differently (the premise of the checks below)',
    moved(rowsBefore, rowsAfter, 'name', Object.keys(typedRows)),
    JSON.stringify({ before: order(rowsBefore, 'name'), after: order(rowsAfter, 'name') }),
  );
  check(
    'review 116: each figure typed and not saved is back in the row of the holding it was typed for, and in no other row',
    inPlace(rowsAfter, 'name', typedRows),
    JSON.stringify(rowsAfter),
  );
  check(
    'review 116: only the rows typed into offer a live Record after the unlock, so no other row would write a typed figure',
    rowsAfter.every((row) => (row.label === 'Record' && row.live) === (row.name in typedRows)),
    JSON.stringify(rowsAfter),
  );
  check(
    'review 116: the rate block drawn after the unlock orders its lines differently (the premise of the checks below)',
    moved(linesBefore, linesAfter, 'unit', Object.keys(typedLines)),
    JSON.stringify({ before: order(linesBefore, 'unit'), after: order(linesAfter, 'unit') }),
  );
  check(
    'review 116: each price typed and not saved is back on the line of the unit it was typed for, and on no other line',
    inPlace(linesAfter, 'unit', typedLines),
    JSON.stringify(linesAfter),
  );

  // Recording a typed row writes its figure to its own holding, and the
  // typed prices to their own units.
  await pressRow('Fund 3');
  const snapshots = on(await stored('snapshot'), DX);
  const rates = on(await stored('rate'), DX);
  check(
    'review 116: Record on a typed row after the unlock writes the figure typed for that holding, to that holding alone',
    snapshots.length === 1 && snapshots[0].accountId === id['Fund 3'] && figure(snapshots[0].payload.value) === 3333,
    JSON.stringify(snapshots.map((s) => [s.accountId, s.payload.value])),
  );
  const rateOf = (symbol) => rates.find((p) => p.payload.symbol === symbol);
  check(
    'review 116: the prices that go in with that row are the ones typed for their own units',
    figure(rateOf('USD')?.payload.rate) === 0.77 && figure(rateOf('m2')?.payload.rate) === 11111 &&
      rates.every((p) => !['0.77', '11111'].includes(p.payload.rate) || typedLines[p.payload.symbol] === p.payload.rate),
    JSON.stringify(rates.map((p) => [p.payload.symbol, p.payload.rate])),
  );
  await home();

  // ---- A reopened recording: stored figures edited, Save live ----------

  await go(`#/recording/${D2}`);
  await ev("[...document.querySelectorAll('.form-actions button, .form-actions a')].find((b) => b.textContent.trim() === 'Update').click()");
  await rec.waitUntil("document.querySelector('.sweep-row')", { label: `the sweep at ${D2}` });
  await quiet();
  const edited = { Brokerage: '2345' };
  await typeRow('Brokerage', '2345');
  await typeLine('USD', '0.95');
  const reopenedBefore = await rows();
  const reopenedLinesBefore = await lines();
  // Another window: a holding that sorts first, and one in a unit that
  // sorts first, each holding a figure at this date.
  const [aaron, abacus] = await plantHere([
    newHolding('Aaron account', 'CHF', '2018-01-01T00:00:00Z'),
    newHolding('Abacus', 'AAA', '2018-01-01T00:00:01Z'),
  ]);
  id['Aaron account'] = aaron;
  id.Abacus = abacus;
  await plantHere([snap('Aaron account', D2, '10'), snap('Abacus', D2, '4'), price('AAA', D2, '2')]);

  await lock("!document.querySelector('#unlock-password') && document.querySelector('.sweep-row')");
  const reopenedAfter = await rows();
  const reopenedLinesAfter = await lines();
  check(
    'review 116: on a reopened recording, the sweep after the unlock orders its rows differently (the premise of the checks below)',
    moved(reopenedBefore, reopenedAfter, 'name', Object.keys(edited)),
    JSON.stringify({ before: order(reopenedBefore, 'name'), after: order(reopenedAfter, 'name') }),
  );
  check(
    'review 116: on a reopened recording, the edited figure is back in its own row and no other row holds it',
    inPlace(reopenedAfter, 'name', edited),
    JSON.stringify(reopenedAfter),
  );
  const current = reopenedAfter.find((row) => row.name === 'Current account');
  check(
    'review 116: on a reopened recording, Save is live on the edited row alone, and the unedited recorded row keeps its stored figure',
    reopenedAfter.find((row) => row.name === 'Brokerage')?.live &&
      reopenedAfter.filter((row) => row.label === 'Save' && row.live).length === 1 &&
      current && figure(current.field) === 1100 && !current.live,
    JSON.stringify(reopenedAfter),
  );
  check(
    'review 116: on a reopened recording, the rate block after the unlock orders its lines differently (the premise of the check below)',
    moved(reopenedLinesBefore, reopenedLinesAfter, 'unit', ['USD']),
    JSON.stringify({ before: order(reopenedLinesBefore, 'unit'), after: order(reopenedLinesAfter, 'unit') }),
  );
  check(
    'review 116: on a reopened recording, the price typed over a stored one is back on its own line and on no other',
    inPlace(reopenedLinesAfter, 'unit', { USD: '0.95' }) && figure((await lineState('AAA'))?.value) === 2,
    JSON.stringify(reopenedLinesAfter),
  );
}, { signsIn: false });
