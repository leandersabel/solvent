// Reviewer's checks of a published unit's rate line whose source did not
// answer, once a price is typed into it, saved through a row and through
// the lines' own save, and on reopening, written from
// spec/features/record-snapshot.md (Update values, The rates, at the foot
// of the sweep; criterion 14) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, proxy, quiet, press, reread, home, line, typeLine, typeRow, pressRow, stored, on, figure } = r;

  const open = async (hash) => {
    await home();
    await rec.call((next) => { location.hash = next; }, hash);
    await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.rate-line'), { args: [hash], label: hash });
    await quiet();
  };
  // Everything a person reads on the line, its chip apart, and whether
  // any of it reads as an error.
  const read = (unit) =>
    rec.call((query) => {
      const l = document.querySelector(query);
      if (!l) return null;
      const chip = [...l.querySelectorAll('.chip')].map((c) => c.textContent.trim()).filter(Boolean).join(' ');
      const error = l.querySelector('.field-error');
      return {
        chip,
        text: l.innerText.replace(/\s+/g, ' ').trim().replace(chip, '').trim(),
        value: l.querySelector('input') ? l.querySelector('input').value : null,
        error: error && !error.hidden ? error.textContent : '',
        alert: Boolean(l.querySelector('[role=alert]')),
      };
    }, line(unit));
  const OUTAGE = 'No market rate came back for USD. Nothing will be recorded for it for this date.';
  const NOTHING = /Nothing will be recorded|No market rate came back/;
  // What a line with a source must never borrow from an owner-priced one.
  const OWNED = /What (is|was) 1 |Nothing prices|No price for|yours to set|until a price exists|Estimated|Set on|No rate was recorded/;
  const typed = (seen, value) =>
    Boolean(seen) && seen.chip === 'Typed by you' && figure(seen.value) === value &&
      !NOTHING.test(seen.text) && !OWNED.test(seen.text) && seen.error === '' && !seen.alert;
  const outage = (seen) =>
    Boolean(seen) && seen.text.includes(OUTAGE) && seen.value === '' && seen.chip !== 'Typed by you' && seen.error === '' && !seen.alert;
  const usdAt = async (date) => on(await stored('rate'), date).filter((p) => p.payload.symbol === 'USD');

  proxy.mode = 'down';

  // ---- A date holding no recording: the price waits for the first row ----

  const DA = ago(70);
  await open(`#/sweep/${DA}`);
  const before = await read('USD');
  check('review 14: with the source down, the dollar line arrives empty and says nothing will be recorded, quietly',
    outage(before), JSON.stringify(before));

  await typeLine('USD', '0.9');
  await quiet();
  const typedA = await read('USD');
  check('review 14: once a price is typed into the dollar line, it reads Typed by you and no longer says nothing will be recorded',
    typed(typedA, 0.9), JSON.stringify(typedA));

  await typeLine('USD', '');
  await quiet();
  const emptied = await read('USD');
  check('review 14: emptied again, the dollar line says once more that nothing will be recorded',
    outage(emptied), JSON.stringify(emptied));

  await typeLine('USD', '0.9');
  await typeRow('Brokerage', '2200');
  await quiet();
  const withRow = await read('USD');
  check('review 14: with a dollar figure typed beside the typed price, the dollar line still reads Typed by you without the outage sentence',
    typed(withRow, 0.9), JSON.stringify(withRow));

  await pressRow('Brokerage');
  const savedA = await read('USD');
  const pricesA = await usdAt(DA);
  check('review 14: recording the first row records the typed dollar price, the one price at that date for the dollar',
    pricesA.length === 1 && figure(pricesA[0].payload.rate) === 0.9 && pricesA[0].payload.rateSource === 'manual' &&
      on(await stored('snapshot'), DA).some((s) => s.accountId === r.id.Brokerage && s.payload.value === '2200'),
    JSON.stringify(pricesA.map((p) => p.payload)));
  check('review 14: once the typed dollar price is saved, the line reads the same: Typed by you, without the outage sentence',
    typed(savedA, 0.9), JSON.stringify(savedA));

  await open(`#/sweep/${DA}`);
  const reopenedA = await read('USD');
  await reread();
  await open(`#/sweep/${DA}`);
  const freshA = await read('USD');
  check('review 14: reopened with the source still down, the saved dollar price reads Typed by you without the outage sentence',
    typed(reopenedA, 0.9) && typed(freshA, 0.9), JSON.stringify({ reopenedA, freshA }));

  // ---- A date already holding a recording: the lines' own save ----------

  const DB = ago(65);
  await open(`#/sweep/${DB}`);
  await typeRow('Dollar cash', '350');
  await pressRow('Dollar cash');
  const recorded = await read('USD');
  check('review 14: with a row recorded in dollars and no price typed, the dollar line keeps saying nothing will be recorded',
    outage(recorded) && (await usdAt(DB)).length === 0, JSON.stringify(recorded));

  await typeLine('USD', '0.88');
  await quiet();
  const typedB = await read('USD');
  check('review 14: a price typed into the dollar line after a dollar row is recorded reads Typed by you without the outage sentence',
    typed(typedB, 0.88), JSON.stringify(typedB));

  await press('Save the rate lines');
  const savedB = await read('USD');
  const pricesB = await usdAt(DB);
  check('review 14: the lines\' own save records the typed dollar price, and the line reads the same once saved',
    pricesB.length === 1 && figure(pricesB[0].payload.rate) === 0.88 && pricesB[0].payload.rateSource === 'manual' &&
      typed(savedB, 0.88),
    JSON.stringify({ savedB, prices: pricesB.map((p) => p.payload) }));

  await open(`#/sweep/${DB}`);
  const reopenedB = await read('USD');
  check('review 14: reopened, the dollar price saved through the lines reads Typed by you without the outage sentence',
    typed(reopenedB, 0.88), JSON.stringify(reopenedB));
  await home();
}, { signsIn: false });
