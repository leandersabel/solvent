// Reviewer's checks of the sentences Update values builds from names
// (spec/features/record-snapshot.md, Update values; record-rate.md,
// criteria 8 and 29) against design-system.md, Typography, Figures:
// names in a sentence read "A, B and C". Written from the spec alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';
import { chains, lists } from '../names.mjs';

const GOLD = 'Gold, troy ounce';
const SILVER = 'Silver, troy ounce';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, D1, faults, bodyOf, ev, press, go, line, typeLine, typeRow, pressRow, home, newRecording } = r;
  const failRates = (entry) => (entry.method === 'PUT' && (bodyOf(entry) || {}).recordType === 'rate' ? 500 : null);
  const banners = () => ev("[...document.querySelectorAll('.banner')].map((n) => n.textContent.trim()).join(' | ')");

  // Leaving a sweep with three prices typed names the three.
  const LEFT_AT = ago(57);
  await newRecording(LEFT_AT);
  await rec.waitUntil((query) => document.querySelector(query) !== null, { args: [line('PAINT')], label: 'the PAINT line' });
  await typeLine('PAINT', '3.5');
  await typeLine('m2', '12000');
  await typeLine('XAG-ozt', '27.5');
  await home();
  const left = await banners();
  const typed = ['the PAINT rate', 'the m2 rate', `the ${SILVER} rate`];
  check(
    'review rate 29: leaving a sweep with three prices typed names them "A, B and C"',
    left.includes('with changes that were not saved: ') && lists(left, typed) && !chains(left, typed),
    left,
  );

  // A row recorded while every price write fails names the units.
  const FAILED_AT = ago(58);
  await newRecording(FAILED_AT);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals on arrival' });
  await typeLine('m2', '12000');
  await typeLine('XAG-ozt', '27.5');
  faults.push(failRates);
  await typeRow('Current account', '1234.5');
  await pressRow('Current account');
  faults.length = 0;
  const failed = await banners();
  const units = ['USD', GOLD, SILVER, 'm2'];
  check(
    'review rate 8: a recorded row whose price writes fail names the units "A, B and C"',
    /not (been )?(updated|saved)/i.test(failed) && lists(failed, units) && !chains(failed, units),
    failed,
  );

  // The rate lines of a reopened recording, saved while every write
  // fails, name the units that did not land.
  await go(`#/sweep/${D1}`);
  await typeLine('XAU-ozt', '2801');
  await typeLine('XAG-ozt', '26');
  await typeLine('m2', '10001');
  faults.push(failRates);
  await press('Save the rate lines');
  await press('Save the prices', '.dialog');
  faults.length = 0;
  const lines = await banners();
  const unsaved = [GOLD, SILVER, 'm2'];
  check(
    'review record-rate: rate lines whose writes fail name the units "A, B and C"',
    lines.includes('Not saved: ') && lists(lines, unsaved) && !chains(lines, unsaved),
    lines,
  );
}, { signsIn: false });
