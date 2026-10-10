// Reviewer's checks of a refused price when a row is recorded, written
// from spec/features/record-rate.md (The write path, "A price write
// failure is never silent"; criteria 8 and 44) and record-snapshot.md
// (Update values, States, "Rate line, invalid price" and "Closing with
// changes unsaved") alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, proposalsFor, faults, writesSent, bodyOf, ev, press, stored, on, pressRow, typeRow, rowState, line, lineState, typeLine, figure, home, newRecording, quiet } = r;

  const TOO_MANY = '0.1234567890123';
  const FITS = '0.123456789012';
  const LONG_M2 = '9000.1234567890123';

  // The line as a person and a screen reader meet it.
  const read = async (unit) => ({
    ...(await lineState(unit)),
    invalid: await rec.call((query) => document.querySelector(query).querySelector('input').getAttribute('aria-invalid'), line(unit)),
  });
  const refusedWith = (s, typed) => s.value === typed && Boolean(s.error) && s.invalid === 'true';
  const typeAndSettle = async (unit, value) => {
    await typeLine(unit, value);
    await quiet();
  };
  const ratesAt = async (date) => Object.fromEntries(on(await stored('rate'), date).map((x) => [x.payload.symbol, x.payload]));
  const ratePuts = () => writesSent().filter((w) => w.method === 'PUT' && (bodyOf(w) || {}).recordType === 'rate');
  const offersLineSave = () =>
    ev("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save the rate lines' && b.getClientRects().length && !b.disabled)");
  // What the screen says outside its rows and rate lines: the sweep's own
  // message about the prices.
  const outsideLines = () => ev(`(() => {
    const copy = document.querySelector('main').cloneNode(true);
    copy.querySelectorAll('.rate-line, .sweep-row').forEach((n) => n.remove());
    return copy.textContent;
  })()`);
  const saysNotUpdated = (said, ...units) =>
    /not (been )?(updated|saved|written)|did not (save|land)/i.test(said) && units.every((u) => said.includes(u));
  const arrived = (unit) =>
    rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line(unit)], label: 'the proposals on arrival' });

  // ---- 44: a date holding nothing, a refused price left as it is --------

  const D = ago(53);
  await newRecording(D);
  await arrived('USD');
  await typeAndSettle('USD', TOO_MANY);
  await typeAndSettle('m2', LONG_M2);
  await typeAndSettle('XAG-ozt', '27.5');
  const before = { usd: await read('USD'), m2: await read('m2') };
  check(
    'review rate 44: both refused prices show their refusal before any row is recorded',
    refusedWith(before.usd, TOO_MANY) && refusedWith(before.m2, LONG_M2),
    JSON.stringify(before),
  );

  await typeRow('Current account', '1234.5');
  await pressRow('Current account');
  const snapshot = on(await stored('snapshot'), D);
  const first = await ratesAt(D);
  const after = { usd: await read('USD'), m2: await read('m2') };
  const row = await rowState('Current account');
  const said = await outsideLines();

  check(
    'review rate 44: the row is recorded whatever the rate lines hold',
    snapshot.length === 1 && snapshot[0].payload.value === '1234.5' && row.error === '' && !row.state.includes('Nothing recorded'),
    JSON.stringify({ snapshot: snapshot.map((s) => s.payload), row }),
  );
  check(
    'review rate 44: a refused price is written nowhere, neither as typed, rounded nor as the proposal it replaced',
    !('USD' in first) && !('m2' in first),
    JSON.stringify(first),
  );
  check(
    'review rate 44: the lines that fit are written with the row: the typed silver price as manual and the gold proposal',
    first['XAG-ozt']?.rate === '27.5' && first['XAG-ozt'].rateSource === 'manual' &&
      first['XAU-ozt']?.rate === proposalsFor(D)['XAU-ozt'].rate && first['XAU-ozt'].rateSource === 'proposed',
    JSON.stringify(first),
  );
  check(
    'review rate 44: each refused line keeps the typed figure and its refusal, never reset to the market rate',
    refusedWith(after.usd, TOO_MANY) && refusedWith(after.m2, LONG_M2),
    JSON.stringify(after),
  );
  check(
    'review rate 44: the screen names each refused unit as not updated',
    saysNotUpdated(said, 'USD', 'm2'),
    said.slice(0, 800),
  );

  // A second row writes its quantity alone, so the refused lines stay as
  // they are and nothing is written for them.
  r.traffic.length = 0;
  await typeRow('Savings', '5100');
  await pressRow('Savings');
  const second = { usd: await read('USD'), m2: await read('m2') };
  check(
    'review rate 44: a second row writes no price and leaves both refused lines with their figure and refusal',
    ratePuts().length === 0 && refusedWith(second.usd, TOO_MANY) && refusedWith(second.m2, LONG_M2),
    JSON.stringify({ puts: ratePuts().length, second }),
  );

  // Once the price fits, the rate-lines save writes it.
  await typeAndSettle('USD', FITS);
  await typeAndSettle('m2', '9000.5');
  const fixed = { usd: await read('USD'), m2: await read('m2') };
  const offered = await offersLineSave();
  check(
    'review rate 44: once the prices fit their refusals clear and the rate-lines save is offered',
    offered && !fixed.usd.error && fixed.usd.invalid !== 'true' && !fixed.m2.error && fixed.m2.invalid !== 'true',
    JSON.stringify({ offered, fixed }),
  );
  if (offered) {
    await press('Save the rate lines');
    if (await ev("Boolean(document.querySelector('.dialog'))")) await press('Save the prices', '.dialog');
  }
  const saved = await ratesAt(D);
  check(
    'review rate 44: the rate-lines save writes the corrected prices exactly as typed',
    saved.USD?.rate === FITS && saved.m2?.rate === '9000.5',
    JSON.stringify(saved),
  );

  // ---- Leaving with the refused price still on its line ----------------

  const L = ago(54);
  await home();
  await newRecording(L);
  await arrived('USD');
  await typeAndSettle('USD', TOO_MANY);
  await typeRow('Current account', '1300');
  await pressRow('Current account');
  await home();
  const notice = await ev("document.querySelector('main').textContent");
  check(
    'review: leaving after a row with a refused price still on its line names that unit as left unsaved',
    /not saved|were not saved/i.test(notice) && notice.includes('USD'),
    notice.slice(0, 600),
  );
  check('review rate 44: nothing was written for the refused unit at that date', !('USD' in (await ratesAt(L))));

  // ---- 8 with a refused price beside the failing writes ----------------

  const F = ago(55);
  await newRecording(F);
  await arrived('USD');
  await typeAndSettle('USD', TOO_MANY);
  await typeAndSettle('m2', '12000');
  const failRates = (entry) => entry.method === 'PUT' && (bodyOf(entry) || {}).recordType === 'rate' && 500;
  faults.push(failRates);
  await typeRow('Current account', '1400');
  await pressRow('Current account');
  faults.splice(faults.indexOf(failRates), 1);
  const failed = { usd: await read('USD'), m2: await lineState('m2') };
  const failSaid = await outsideLines();
  check(
    'review rate 8: with every price write failing, the typed price stays, the refused one keeps figure and refusal, and nothing is stored',
    figure(failed.m2.value) === 12000 && refusedWith(failed.usd, TOO_MANY) && Object.keys(await ratesAt(F)).length === 0,
    JSON.stringify(failed),
  );
  check(
    'review rate 8: the screen names both the failed and the refused unit as not updated',
    saysNotUpdated(failSaid, 'USD', 'm2'),
    failSaid.slice(0, 800),
  );

  // ---- A date that holds a recording: the rate-lines save --------------

  // The same sweep now holds a recording. A changed line that fits beside
  // a refused one: the refused one is written nowhere and keeps its state.
  await typeAndSettle('m2', '12500');
  await typeAndSettle('USD', TOO_MANY);
  if (await offersLineSave()) {
    await press('Save the rate lines');
    if (await ev("Boolean(document.querySelector('.dialog'))")) await press('Save the prices', '.dialog');
  }
  const held = { usd: await read('USD'), stored: await ratesAt(F) };
  check(
    'review rate: at a date holding a recording, a refused price is written nowhere and its line keeps the figure and the refusal',
    !('USD' in held.stored) && refusedWith(held.usd, TOO_MANY),
    JSON.stringify(held),
  );

  await home();
}, { signsIn: false });
