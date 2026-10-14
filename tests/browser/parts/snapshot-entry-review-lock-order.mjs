// Reviewer's checks that prices typed into the single-holding form's rate
// lines and not saved come back after a lock on the line of the unit they
// were typed for, also where the lines drawn after the unlock are ordered
// differently, written from spec/features/record-snapshot.md (Update
// values, Rules; Snapshot entry, The prices line; criterion 116) and
// spec/features/login.md (Unlock, Rules; criteria 55 and 56) alone.
import { RECORDER_PASSWORD, check, enterPasswordOn, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, D1, id, ev, quiet, set, go, press, format, plantHere, stored, on, figure, price } = r;

  const lines = () =>
    rec.call(() => [...document.querySelectorAll('.dialog .rate-line')].map((l) => ({
      unit: l.dataset.unit,
      field: l.querySelector('input') ? l.querySelector('input').value : null,
    })));
  const typeLine = (unit, value) =>
    rec.call((symbol, next) => {
      const field = [...document.querySelectorAll('.dialog .rate-line')].find((l) => l.dataset.unit === symbol).querySelector('input');
      field.value = next;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, unit, value);
  const openPrices = async () => {
    await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    await quiet();
  };

  const DY = ago(50);
  await go(`#/holding/${id.Savings}`);
  await press('Record a value', '.form-actions');
  await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the form for Savings' });
  await quiet();
  await set('#snapshot-date', await format('date', DY));
  await ev('document.activeElement && document.activeElement.blur()');
  await quiet();
  await set('#snapshot-value', '5050');
  await openPrices();
  const typed = { USD: '0.66', m2: '12345' };
  for (const [unit, value] of Object.entries(typed)) await typeLine(unit, value);
  const before = await lines();

  // Another window, behind the form: holdings in units that sort first
  // and last, each with a price, so the lines drawn after the unlock
  // gain one ahead of every other and one behind.
  const [first, last] = await plantHere([
    { type: 'account', payload: { name: 'Abacus', unit: 'AAA', dims: {}, note: null, archivedAt: null, createdAt: '2018-01-01T00:00:00Z' } },
    { type: 'account', payload: { name: 'Zither', unit: 'zzz', dims: {}, note: null, archivedAt: null, createdAt: '2030-01-01T00:00:00Z' } },
  ]);
  await plantHere([
    { type: 'snapshot', accountId: first, payload: { date: D1, value: '4', note: null } },
    { type: 'snapshot', accountId: last, payload: { date: D1, value: '9', note: null } },
    price('AAA', D1, '2'),
    price('zzz', D1, '3'),
  ]);

  await ev("document.querySelector('.btn-lock').click()");
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
  await enterPasswordOn(rec, RECORDER_PASSWORD);
  await rec.waitUntil("!document.querySelector('#unlock-password') && document.querySelector('#snapshot-value')", { timeout: 90000, label: 'the form after unlocking' });
  await quiet();
  await openPrices();
  const after = await lines();
  const at = (list, unit) => list.findIndex((l) => l.unit === unit);
  check(
    'review 116: the form\'s rate lines drawn after the unlock are ordered differently (the premise of the check below)',
    Object.keys(typed).some((unit) => at(before, unit) !== at(after, unit)),
    JSON.stringify({ before: before.map((l) => l.unit), after: after.map((l) => l.unit) }),
  );
  check(
    'review 116: each price typed into the form and not saved is back on the line of its unit, and on no other line',
    Object.entries(typed).every(([unit, value]) => after.find((l) => l.unit === unit)?.field === value) &&
      after.every((l) => !Object.values(typed).includes(l.field) || typed[l.unit] === l.field),
    JSON.stringify(after),
  );
  check(
    'review 55: the figure typed into the form is there after unlocking',
    (await ev("document.querySelector('#snapshot-value').value")) === '5050',
  );

  await rec.call(() => [...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')]
    .find((b) => b.textContent.trim() === 'Save').click());
  await quiet();
  const rates = on(await stored('rate'), DY);
  const rateOf = (symbol) => rates.find((p) => p.payload.symbol === symbol);
  check(
    'review 116: saving the form after the unlock writes each typed price to its own unit',
    figure(rateOf('USD')?.payload.rate) === 0.66 && figure(rateOf('m2')?.payload.rate) === 12345 &&
      rates.every((p) => !Object.values(typed).includes(p.payload.rate) || typed[p.payload.symbol] === p.payload.rate),
    JSON.stringify(rates.map((p) => [p.payload.symbol, p.payload.rate])),
  );
}, { signsIn: false });
