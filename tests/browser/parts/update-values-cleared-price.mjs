// A price cleared and saved on Update values moves the rows measured in
// it at once, from spec/features/record-snapshot.md (A converted figure;
// Changing or clearing a rate says what it moves; criterion 56).
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, quiet, press, home, line, typeLine } = r;

  const converted = (name) =>
    rec.call((holding) => {
      const row = [...document.querySelectorAll('.sweep-row')].find((r) => r.querySelector('.holding-name').textContent === holding);
      return row.querySelector('.sweep-input > .hint').textContent;
    }, name);

  await home();
  await rec.call((next) => { location.hash = next; }, `#/sweep/${D1}`);
  await rec.waitUntil((query) => document.querySelector(query), { args: [line('XAG-ozt')], label: 'the silver line' });
  await quiet();
  const before = await converted('Silver coins');

  // Silver's price at D1 is its only one, so clearing it leaves the
  // coins with none.
  await typeLine('XAG-ozt', '');
  await press('Save the rate lines');
  await rec.holds("Boolean(document.querySelector('.dialog'))", { timeout: 10000, label: 'the confirmation' });
  await press('Save the prices', '.dialog');
  await rec.holds("!document.querySelector('.dialog')", { timeout: 10000, label: 'the confirmation to close' });
  await quiet();
  const after = await converted('Silver coins');
  check(
    '56: a price cleared and saved leaves the rows measured in it not priced, on the same screen',
    before.includes('CHF') && after === 'not priced',
    JSON.stringify({ before, after }),
  );
  await home();
}, { signsIn: false });
