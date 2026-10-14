// Reviewer's checks that a stored price changed or cleared on a
// reopened recording's rate lines moves the rows measured in it at once,
// written from spec/features/record-snapshot.md (Screens, A converted
// figure; Update values, Rate lines on a reopened recording and Changing
// or clearing a rate says what it moves; criterion 56) alone. Covers a
// published unit's only price, an owner-priced unit with an earlier
// price, a published unit dated before its published prices begin, and
// a change to a stored price.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, D2, ev, quiet, press, go, line, lineState, typeLine, stored, on, plantHere, price, snap, reread, format, proposalsFor } = r;

  // The converted figure beneath a holding's quantity field, as read.
  const converted = (name) =>
    rec.call((holding) => {
      const row = [...document.querySelectorAll('.sweep-row')].find((x) => x.querySelector('.holding-name').textContent === holding);
      return row ? row.querySelector('.sweep-input .hint').textContent.replace(/\s+/g, ' ').trim() : null;
    }, name);
  const reopen = async (date) => {
    await go(`#/recording/${date}`);
    await press('Update', '.form-actions');
    await rec.waitUntil((query) => Boolean(document.querySelector(query)), { args: [line('USD')], label: 'the rate lines' });
    await quiet();
  };
  // Saves the rate lines through the confirmation, and says what it said.
  const saveLines = async () => {
    await press('Save the rate lines');
    const said = await ev("document.querySelector('.dialog') ? document.querySelector('.dialog').textContent : ''");
    if (said) await press('Save the prices', '.dialog');
    await quiet();
    return said;
  };
  const pricesAt = async (date, symbol) => on(await stored('rate'), date).filter((p) => p.payload.symbol === symbol);
  // Whether the screen still reads the same once the vault is read again
  // and the recording reopened, so a check can tell "moved at once" from
  // "moved on reopening".
  const reopened = async (date, names) => {
    await reread();
    await reopen(date);
    return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await converted(n)])));
  };

  // ---- A published unit's only price, cleared: its rows read not priced ----

  // USD's only price is the seeded 0.92 at D2. Brokerage holds 2100 there
  // and Dollar cash carries its 300 from D1.
  await reopen(D2);
  const brokerageBefore = await converted('Brokerage');
  const cashBefore = await converted('Dollar cash');
  check(
    'review 56: before clearing, Brokerage (USD 2100) and Dollar cash (USD 300) convert at the stored 0.92',
    brokerageBefore.includes('1,932') && cashBefore.includes('276'),
    JSON.stringify({ brokerageBefore, cashBefore }),
  );
  await typeLine('USD', '');
  const clearedSaid = await saveLines();
  const brokerage = await converted('Brokerage');
  const cash = await converted('Dollar cash');
  check(
    'review: clearing the only USD price asks first and the save deletes it',
    clearedSaid.includes('Clearing') && clearedSaid.includes('only price') && (await pricesAt(D2, 'USD')).length === 0,
    clearedSaid,
  );
  check(
    'review 56: once the cleared USD price is saved, Brokerage reads not priced at once, never 1,932 at the cleared 0.92',
    /not priced/i.test(brokerage) && !brokerage.includes('1,932'),
    brokerage,
  );
  check(
    'review 56: once the cleared USD price is saved, Dollar cash reads not priced at once, never 276 at the cleared 0.92',
    /not priced/i.test(cash) && !cash.includes('276'),
    cash,
  );
  const usdLine = await lineState('USD');
  check(
    'review: the cleared USD line reads as a line with no rate recorded, with its Look it up',
    usdLine.value === '' && usdLine.lookup,
    JSON.stringify(usdLine),
  );

  // Look it up saves the date's price at once, and the rows follow it.
  await press('Look it up', line('USD'));
  const fetched = Number(proposalsFor(D2).USD.rate);
  const lookedUp = await converted('Brokerage');
  const expected = Math.round(2100 * fetched).toLocaleString('en-US');
  check(
    'review: a price saved by Look it up after the clear moves Brokerage at once to the fetched rate',
    (await pricesAt(D2, 'USD')).length === 1 && lookedUp.includes(expected) && !/not priced/i.test(lookedUp),
    JSON.stringify({ lookedUp, expected }),
  );

  // ---- An owner-priced unit, cleared: its rows fall back to the earlier price ----

  // m2 is priced 10000 at D1. A second price at D2, cleared there, leaves
  // Flat (95 m2 from D1) valued at D1's price, dated.
  await plantHere([price('m2', D2, '10400')]);
  await reread();
  await reopen(D2);
  const flatBefore = await converted('Flat');
  check('review 56: before clearing, Flat converts at the D2 price of 10400', flatBefore.includes('988,000'), flatBefore);
  await typeLine('m2', '');
  await saveLines();
  const flat = await converted('Flat');
  const priced = `priced ${await format('longDate', D1)}`;
  check(
    'review 56: once the cleared m2 price is saved, Flat converts at once at the earlier 10000 with its price date, never at the cleared 10400',
    (await pricesAt(D2, 'm2')).length === 0 && flat.includes('950,000') && flat.endsWith(priced) && !flat.includes('988,000'),
    JSON.stringify({ flat, priced }),
  );
  check(
    'review 56: reopened from the vault, Flat reads as it did straight after the save',
    (await reopened(D2, ['Flat'])).Flat === flat,
    JSON.stringify({ flat, reopened: await converted('Flat') }),
  );

  // ---- A published unit before its prices begin, cleared ----------------

  // Gold's published prices begin on 2 January 2013. Gold bars holds 10
  // ounces from 29 June 2012, priced by hand then and again on 28
  // September 2012, the date of a recording.
  const EARLIER = '2012-06-29';
  const LATER = '2012-09-28';
  await plantHere([
    snap('Gold bars', EARLIER, '10'),
    price('XAU-ozt', EARLIER, '1600'),
    snap('Current account', LATER, '500'),
    price('XAU-ozt', LATER, '1700'),
  ]);
  await reread();
  await reopen(LATER);
  const goldBefore = await converted('Gold bars');
  check('review 56: before clearing, Gold bars converts at the 1700 set at its date', goldBefore.includes('17,000'), goldBefore);
  await typeLine('XAU-ozt', '');
  await saveLines();
  const gold = await converted('Gold bars');
  const goldPriced = `priced ${await format('longDate', EARLIER)}`;
  check(
    'review 56: once a gold price before published prices begin is cleared and saved, Gold bars converts at once at the earlier 1600 with its price date',
    (await pricesAt(LATER, 'XAU-ozt')).length === 0 && gold.includes('16,000') && gold.endsWith(goldPriced) && !gold.includes('17,000'),
    JSON.stringify({ gold, goldPriced }),
  );

  // ---- A stored price changed: its rows move at once ---------------------

  // Gold is 2500 at D1, where Gold bars holds 12.5 ounces.
  await reopen(D1);
  const barsBefore = await converted('Gold bars');
  check('review: before the change, Gold bars converts at the stored 2500', barsBefore.includes('31,250'), barsBefore);
  await typeLine('XAU-ozt', '2600');
  const changedSaid = await saveLines();
  const bars = await converted('Gold bars');
  check(
    'review: a changed gold price, saved through its confirmation, moves Gold bars at once to 32,500',
    changedSaid.includes('Changing') && (await pricesAt(D1, 'XAU-ozt'))[0].payload.rate === '2600' && bars.includes('32,500'),
    JSON.stringify({ changedSaid, bars }),
  );
}, { signsIn: false });
