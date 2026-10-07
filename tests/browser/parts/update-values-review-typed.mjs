// Reviewer's checks of the rate lines of units only their owner can
// price, before and after a price is typed into them, written from
// spec/features/record-snapshot.md (Update values, The rates, at the foot
// of the sweep; criteria 16 and 17) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, id, quiet, plantHere, reread, home, line, typeLine, typeRow, pressRow, stored, on, figure, format, rateAsks, traffic } = r;

  [id['Gold grams']] = await plantHere([{
    type: 'account', payload: { name: 'Gold grams', unit: 'XAU-g', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:00Z' },
  }]);
  await reread();
  await home();

  const open = async (hash) => {
    await home();
    await rec.call((next) => { location.hash = next; }, hash);
    await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.rate-line'), { args: [hash], label: hash });
    await quiet();
  };
  // Everything a person reads on the line, the chip apart.
  const read = (unit) =>
    rec.call((query) => {
      const l = document.querySelector(query);
      if (!l) return null;
      const chip = [...l.querySelectorAll('.chip')].map((c) => c.textContent.trim()).filter(Boolean).join(' ');
      return { chip, text: l.innerText.replace(/\s+/g, ' ').trim(), value: l.querySelector('input') ? l.querySelector('input').value : null };
    }, line(unit));
  const AGE = /\bago\b|\bestimated\b/i;
  const asked = (symbol) => rateAsks().some((a) => new URL(a.url).searchParams.get('symbol') === symbol);

  // ---- 16: a free-text unit with an earlier figure ------------------------

  const DT = ago(15);
  traffic.length = 0;
  await open(`#/sweep/${DT}`);
  const flatBefore = await read('m2');
  await typeLine('m2', '10400');
  const flatTyped = await read('m2');
  check(
    'review 16: before a price is typed, the m2 line says how old its figure is and that the price is yours to set',
    flatBefore && /Estimated .+ ago\. Nobody publishes a price for m2\. This one is yours to set\./.test(flatBefore.text),
    JSON.stringify(flatBefore),
  );
  check(
    'review 16: once a price is typed into the m2 line, it reads Typed by you and no longer says how old the last price is',
    flatTyped && flatTyped.chip === 'Typed by you' && !AGE.test(flatTyped.text.replace(flatTyped.chip, '')),
    JSON.stringify(flatTyped),
  );
  check(
    'review 16: once a price is typed into the m2 line, it still says why the price is yours to set',
    flatTyped && flatTyped.text.includes('Nobody publishes a price for m2. This one is yours to set.'),
    JSON.stringify(flatTyped),
  );

  // ---- 16: a free-text unit with no price at all, nothing recorded in it ---

  const paintBefore = await read('PAINT');
  await typeLine('PAINT', '650');
  const paintTyped = await read('PAINT');
  check(
    'review 16: before a price is typed, the PAINT line says there is no price yet and that it is yours to set',
    paintBefore && paintBefore.text.includes('No price for PAINT yet. Nobody publishes a price for PAINT. This one is yours to set.'),
    JSON.stringify(paintBefore),
  );
  check(
    'review 16: once a price is typed into the PAINT line, it reads Typed by you, no longer says there is no price, and still says why',
    paintTyped && paintTyped.chip === 'Typed by you' && !/No price for PAINT/.test(paintTyped.text) &&
      paintTyped.text.includes('Nobody publishes a price for PAINT. This one is yours to set.'),
    JSON.stringify(paintTyped),
  );

  // ---- 16: a symbol with no provider, with an earlier figure ---------------

  const silverBefore = await read('XAG-ozt');
  await typeLine('XAG-ozt', '27');
  const silverTyped = await read('XAG-ozt');
  check(
    'review 16: a typed price on the silver line drops its age and keeps that the price is yours to set',
    silverBefore && AGE.test(silverBefore.text) && silverBefore.text.includes('This one is yours to set.') &&
      silverTyped && silverTyped.chip === 'Typed by you' && !AGE.test(silverTyped.text.replace(silverTyped.chip, '')) &&
      silverTyped.text.includes('This one is yours to set.'),
    JSON.stringify({ silverBefore, silverTyped }),
  );
  check(
    'review 16: the sweep asks the source about neither m2 nor PAINT',
    !asked('m2') && !asked('PAINT'),
    JSON.stringify(rateAsks().map((a) => a.url)),
  );

  // ---- 16: a free-text unit no sitting has priced, with a quantity in it ----

  const DQ = ago(14);
  await open(`#/sweep/${DQ}`);
  await typeRow('Art', '3');
  const paintAsks = await read('PAINT');
  await typeLine('PAINT', '700');
  const paintAnswered = await read('PAINT');
  check(
    'review 16: with a quantity of PAINT on the sweep, its line asks for a price, and once one is typed no longer says nothing prices it',
    paintAsks && paintAsks.text.includes('Nothing prices PAINT yet.') &&
      paintAnswered && paintAnswered.chip === 'Typed by you' && !/Nothing prices PAINT|No price for PAINT|until a price exists/.test(paintAnswered.text),
    JSON.stringify({ paintAsks, paintAnswered }),
  );

  // ---- 16: recording writes no price for a free-text unit left alone -------

  const DR = ago(13);
  await open(`#/sweep/${DR}`);
  await typeRow('Flat', '95');
  await pressRow('Flat');
  await typeRow('Art', '3');
  await pressRow('Art');
  const pricesAtDR = on(await stored('rate'), DR).map((p) => p.payload.symbol);
  check(
    'review 16: recording holdings in m2 and PAINT, their lines untouched, writes no price for either',
    on(await stored('snapshot'), DR).length === 2 && !pricesAtDR.includes('m2') && !pricesAtDR.includes('PAINT'),
    JSON.stringify(pricesAtDR),
  );
  await home();

  // ---- 17: gold by the gram, before its published prices begin ----------

  const OLD = '2012-06-29';
  const begins = await format('fullDate', '2013-01-02');
  traffic.length = 0;
  await open(`#/sweep/${OLD}`);
  await typeRow('Gold grams', '10');
  const none = await read('XAU-g');
  check(
    'review 17: with no price before the date and grams on the sweep, the gram line asks for one and says when published prices begin',
    none && none.text.includes(`What was 1 gram worth in CHF on ${await format('fullDate', OLD)}? Published prices for Gold, gram begin on ${begins}.`) &&
      !/No market rate came back|No rate was recorded/.test(none.text) && !asked('XAU-g'),
    JSON.stringify({ none, asks: rateAsks().map((a) => a.url) }),
  );
  await typeLine('XAU-g', '35');
  const answered = await read('XAU-g');
  check(
    'review 17: a price typed into the gram line that asked for one reads Typed by you and no longer says no price exists',
    answered && answered.chip === 'Typed by you' && !answered.text.includes('until a price exists') &&
      answered.text.includes(`Published prices for Gold, gram begin on ${begins}.`),
    JSON.stringify(answered),
  );
  await home();

  await plantHere([r.price('XAU-g', '2011-06-30', '40')]);
  await reread();
  traffic.length = 0;
  await open(`#/sweep/${OLD}`);
  const set = await read('XAU-g');
  check(
    'review 17: the gram line starts from the last price before the date, says when it was set, when published prices begin, and that it is yours to set',
    set && figure(set.value) === 40 &&
      set.text.includes(`Set on ${await format('fullDate', '2011-06-30')}. Published prices for Gold, gram begin on ${begins}. This one is yours to set.`) &&
      !/No market rate came back|No rate was recorded/.test(set.text) && !asked('XAU-g'),
    JSON.stringify({ set, asks: rateAsks().map((a) => a.url) }),
  );
  await typeLine('XAU-g', '45');
  const typed = await read('XAU-g');
  check(
    'review 17: a price typed into the gram line reads Typed by you, drops when the last one was set, and still says when published prices begin',
    typed && typed.chip === 'Typed by you' && !typed.text.includes('Set on') &&
      typed.text.includes(`Published prices for Gold, gram begin on ${begins}. This one is yours to set.`),
    JSON.stringify(typed),
  );
  await home();
}, { signsIn: false });
