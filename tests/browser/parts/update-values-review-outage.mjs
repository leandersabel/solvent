// Reviewer's checks of a published unit's rate line while its source
// does not answer, before and after a figure is typed or recorded in the
// unit, and of the line asking for a price where a unit has none at all,
// written from spec/features/record-snapshot.md (Update values, The rates,
// at the foot of the sweep; criteria 14 and 15) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, proxy, quiet, home, line, typeRow, pressRow, rowState, stored, on, figure, format, group, rateAsks, traffic, D1, D2 } = r;

  const open = async (hash) => {
    await home();
    await rec.call((next) => { location.hash = next; }, hash);
    await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.rate-line'), { args: [hash], label: hash });
    await quiet();
  };
  // Everything a person reads on the line, and whether it reads as an error.
  const read = (unit) =>
    rec.call((query) => {
      const l = document.querySelector(query);
      if (!l) return null;
      const error = l.querySelector('.field-error');
      return {
        text: l.innerText.replace(/\s+/g, ' ').trim(),
        value: l.querySelector('input') ? l.querySelector('input').value : null,
        error: error && !error.hidden ? error.textContent : '',
        alert: Boolean(l.querySelector('[role=alert]')),
        first: document.querySelector('.rate-line') === l,
      };
    }, line(unit));
  const OUTAGE_USD = 'No market rate came back for USD. Nothing will be recorded for it for this date.';
  const OUTAGE = /No market rate came back for .+\. Nothing will be recorded for it for this date\./;
  const OWNED = /What (is|was) 1 |Nothing prices|No price for|yours to set|until a price exists|Estimated|Set on|Typed by you/;
  const quietOutage = (state, exact) =>
    Boolean(state) && (exact ? state.text.includes(exact) : OUTAGE.test(state.text)) &&
      !OWNED.test(state.text) && state.value === '' && state.error === '' && !state.alert;

  // Each date in turn: a published unit with no price at or before it
  // (the dollar before its first entry), and one with an earlier price.
  for (const [mode, date, priced] of [['down', ago(150), false], ['none', ago(155), false], ['down', ago(60), true]]) {
    const where = `proxy ${mode}, ${priced ? 'an earlier dollar price' : 'no dollar price yet'}`;
    proxy.mode = mode;
    await open(`#/sweep/${date}`);
    const arrived = { usd: await read('USD'), gold: await read('XAU-ozt') };
    check(`review 14 (${where}): on arrival the dollar and gold lines say no market rate came back, quietly`,
      quietOutage(arrived.usd, OUTAGE_USD) && quietOutage(arrived.gold), JSON.stringify(arrived));

    await typeRow('Brokerage', '2200');
    await quiet();
    const typed = await read('USD');
    check(`review 14 (${where}): with a dollar figure typed, the dollar line keeps the outage wording and asks for no price`,
      quietOutage(typed, OUTAGE_USD), JSON.stringify(typed));
    const live = !(await rowState('Brokerage')).disabled;

    await pressRow('Brokerage');
    await typeRow('Gold bars', '13');
    await quiet();
    const goldTyped = await read('XAU-ozt');
    await pressRow('Gold bars');
    const recorded = { usd: await read('USD'), gold: await read('XAU-ozt') };
    check(`review 14 (${where}): with a gold figure typed, the gold line keeps the outage wording`,
      quietOutage(goldTyped), JSON.stringify(goldTyped));
    check(`review 14 (${where}): once rows are recorded in them, the dollar and gold lines keep the outage wording`,
      quietOutage(recorded.usd, OUTAGE_USD) && quietOutage(recorded.gold), JSON.stringify(recorded));

    const snaps = on(await stored('snapshot'), date);
    const symbols = on(await stored('rate'), date).map((p) => p.payload.symbol);
    check(`review 14 (${where}): both rows record with the control live, and no price is written for the dollar or gold`,
      live && snaps.some((s) => s.accountId === r.id.Brokerage && s.payload.value === '2200') &&
        snaps.some((s) => s.accountId === r.id['Gold bars'] && s.payload.value === '13') &&
        !symbols.includes('USD') && !symbols.includes('XAU-ozt'),
      JSON.stringify({ live, snaps: snaps.map((s) => s.payload), symbols }));
  }

  // ---- 15: no price at all, proxy down --------------------------------------

  // Before the first recording, nothing prices silver or PAINT, and gold
  // has no published price before its prices begin.
  proxy.mode = 'down';
  const P = '2012-06-29';
  const begins = await format('fullDate', '2013-01-02');
  traffic.length = 0;
  await open(`#/sweep/${P}`);
  const controls = [];
  const asks = {};
  for (const [name, unit, value] of [['Art', 'PAINT', '3'], ['Silver coins', 'XAG-ozt', '50'], ['Gold bars', 'XAU-ozt', '4']]) {
    await typeRow(name, value);
    await quiet();
    asks[unit] = await read(unit);
    controls.push((await rowState(name)).disabled);
    await pressRow(name);
  }
  check('review 15: with no PAINT price at all and a quantity typed, its line asks for one at the head of the block, never as an outage',
    asks.PAINT && asks.PAINT.first &&
      asks.PAINT.text.includes('What is 1 PAINT worth in CHF? Nothing prices PAINT yet. The figure records either way, and until a price exists the holding is listed as not priced.') &&
      !OUTAGE.test(asks.PAINT.text),
    JSON.stringify(asks.PAINT));
  check('review 15: silver, whose lookup returns nothing, says the price is yours to set, never as an outage',
    asks['XAG-ozt'] && /yours to set|until a price exists/.test(asks['XAG-ozt'].text) && !OUTAGE.test(asks['XAG-ozt'].text),
    JSON.stringify(asks['XAG-ozt']));
  check('review 15: gold before its prices begin asks for a price and says when they begin, never as an outage, and nobody asks the source',
    asks['XAU-ozt'] &&
      asks['XAU-ozt'].text.includes(`What was 1 troy ounce worth in CHF on ${await format('fullDate', P)}? Published prices for Gold, troy ounce begin on ${begins}.`) &&
      !OUTAGE.test(asks['XAU-ozt'].text) &&
      !rateAsks().some((a) => new URL(a.url).searchParams.get('symbol') === 'XAU-ozt'),
    JSON.stringify({ gold: asks['XAU-ozt'], asks: rateAsks().map((a) => a.url) }));
  const snapsP = on(await stored('snapshot'), P);
  check('review 15: each quantity saves with the control live throughout, one snapshot each, and no price written',
    controls.every((disabled) => disabled === false) &&
      ['Art', 'Silver coins', 'Gold bars'].every((n) => snapsP.filter((s) => s.accountId === r.id[n]).length === 1) &&
      on(await stored('rate'), P).length === 0,
    JSON.stringify({ controls, snaps: snapsP.map((s) => [s.accountId, s.payload.value]) }));
  await home();
  check('review 15: the PAINT holding is listed as not priced', (await group('Not priced')).includes('Art'));
  // The seeded prices stand untouched.
  const seeded = (await stored('rate')).filter((p) => [D1, D2].includes(p.payload.date)).map((p) => figure(p.payload.rate));
  check('review 14: the earlier prices stay as they were', seeded.length === 4, JSON.stringify(seeded));
}, { signsIn: false });
