// Reviewer's checks that recording a row on Update values leaves an
// unsaved edit to a stored price alone, written from
// spec/features/record-snapshot.md (Update values, Writes, "A reopened
// recording saves one control at a time"; States, "Closing with changes
// unsaved"; criterion 114) and spec/features/record-rate.md (Saving at a
// date that holds a recording) alone. Covers a changed price and a
// cleared one on a reopened recording, a row saved in place and a row
// created there, and a date that became a recording with this sweep's
// first row.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';
import { lists } from '../names.mjs';

const SILVER = 'Silver, troy ounce';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, D1, ev, quiet, press, home, go, line, lineState, typeLine, typeRow, pressRow, rowState, stored, on, bytes, format, sweepToday } = r;

  const pricesAt = async (date, symbols) =>
    on(await stored('rate'), date).filter((p) => symbols.includes(p.payload.symbol));
  const banners = () => ev("[...document.querySelectorAll('.banner-critical')].map((n) => n.textContent.trim()).join(' | ')");
  const saveButton = () => ev("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Save the rate lines')");

  // ---- A reopened recording: a changed price and a cleared one ------------

  await go(`#/sweep/${D1}`);
  await rec.waitUntil((query) => document.querySelector(query) !== null, { args: [line('m2')], label: 'the m2 line' });
  const kept = bytes(await pricesAt(D1, ['m2', 'XAG-ozt']));
  await typeLine('m2', '10500');
  await typeLine('XAG-ozt', '');
  await quiet();
  // How each edited line reads before any row is recorded, which is how
  // it must read after.
  const typed = { m2: await lineState('m2'), silver: await lineState('XAG-ozt') };
  const same = (seen) => JSON.stringify(seen) === JSON.stringify(typed);

  // A quantity saved in place.
  await typeRow('Savings', '5100');
  await pressRow('Savings');
  const inPlace = { m2: await lineState('m2'), silver: await lineState('XAG-ozt'), row: await rowState('Savings') };
  check(
    'review 114: saving a quantity in place on a reopened recording leaves the stored m2 and silver prices as they were',
    bytes(await pricesAt(D1, ['m2', 'XAG-ozt'])) === kept,
    JSON.stringify((await pricesAt(D1, ['m2', 'XAG-ozt'])).map((p) => p.payload)),
  );
  check(
    'review 114: after a quantity saved in place, the m2 line still shows the unsaved 10500 and the silver line stays cleared, each reading as before',
    typed.m2.value === '10500' && typed.silver.value === '' && same({ m2: inPlace.m2, silver: inPlace.silver }),
    JSON.stringify({ typed, inPlace }),
  );
  const savings = on(await stored('snapshot'), D1).filter((s) => s.accountId === r.id.Savings).map((s) => s.payload.value);
  check('review 114: the row itself was saved', JSON.stringify(savings) === '["5100"]', JSON.stringify({ savings, row: inPlace.row }));

  // A quantity created for a holding silent at the date, which brings
  // the refresh of the prices the date lacks.
  await typeRow('Art', '3');
  await pressRow('Art');
  const created = { m2: await lineState('m2'), silver: await lineState('XAG-ozt') };
  check(
    'review 114: recording a holding silent at a reopened date leaves the stored m2 and silver prices as they were',
    bytes(await pricesAt(D1, ['m2', 'XAG-ozt'])) === kept,
    JSON.stringify((await pricesAt(D1, ['m2', 'XAG-ozt'])).map((p) => p.payload)),
  );
  check(
    'review 114: after a holding recorded at a reopened date, the m2 line keeps the unsaved 10500 and the silver line stays cleared, each reading as before',
    same(created),
    JSON.stringify({ typed, created }),
  );
  check('review 114: the rate lines still offer their own save', await saveButton(), '');

  await home();
  const left = await banners();
  check(
    'review 114: leaving names the m2 and silver prices as unsaved, and no holding recorded',
    left.includes(`You left the recording for ${await format('longDate', D1)} with changes that were not saved: `)
      && lists(left, ['the m2 rate', `the ${SILVER} rate`]) && !left.includes('Savings') && !left.includes('Art'),
    left,
  );

  // ---- A date that became a recording with this sweep's first row --------

  await sweepToday();
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals on arrival' });
  await typeRow('Savings', '5200');
  await pressRow('Savings');
  const proposed = await pricesAt(T, ['USD']);
  await typeLine('USD', '0.99');
  await quiet();
  await typeRow('Current account', '1200');
  await pressRow('Current account');
  const second = await pricesAt(T, ['USD']);
  const usd = await lineState('USD');
  check(
    'review 114: once the first row made the date a recording, a second row leaves the stored USD price as it was',
    proposed.length === 1 && bytes(second) === bytes(proposed),
    JSON.stringify({ proposed: proposed.map((p) => p.payload), second: second.map((p) => p.payload) }),
  );
  check(
    'review 114: the edited USD line keeps 0.99 and reads as edited after the second row',
    usd.value === '0.99' && usd.chip.startsWith('Edited from'),
    JSON.stringify(usd),
  );

  // The lines' own save is where the edit is written.
  await press('Save the rate lines');
  if (await ev("Boolean(document.querySelector('.dialog'))")) await press('Save the prices', '.dialog');
  const saved = await pricesAt(T, ['USD']);
  check(
    'review 114: the lines\' own save then writes the edited USD price over the stored one',
    saved.length === 1 && saved[0].payload.rate === '0.99' && saved[0].recordId === proposed[0].recordId,
    JSON.stringify(saved.map((p) => ({ ...p.payload, version: p.version }))),
  );

  await home();
}, { signsIn: false });
