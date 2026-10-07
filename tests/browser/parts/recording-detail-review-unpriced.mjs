// Reviewer's check of Recording detail's prices with a line left empty
// (spec/features/record-snapshot.md, Recording detail, States, "No
// prices at this date", criterion 103), written from the spec and
// record-rate.md, Reading, alone. A unit is named as empty, to be filled
// after Update, only where a rate source applies at the date: a
// `lookup: true` symbol on or after the later of its floor and the main
// currency's. Silver, free text, a symbol with its lookup off, a date
// before a floor and a main currency no source quotes into are never
// named so.
import { check, run, sql } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const UNSERVED = 'ARS';
// The words the empty-line sentence is made of, in any arrangement.
const EMPTY_LINE = /empty|filled|after Update|No price for/i;

await run(async () => {
  sql("INSERT INTO symbols (symbol, label, kind, lookup) VALUES (?, 'Argentine Peso', 'currency', 1)", UNSERVED);
  sql("UPDATE symbols SET lookup = 0 WHERE symbol = 'JPY'");
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { D10, ev, go, id, model, plantHere, reread, snap } = r;

  const [yen, real] = await plantHere([['Yen account', 'JPY'], ['Real account', 'BRL']].map(([name, unit]) => ({
    type: 'account',
    payload: { name, unit, dims: {}, note: null, archivedAt: null, createdAt: '1990-01-01T00:00:00Z' },
  })));
  Object.assign(id, { 'Yen account': yen, 'Real account': real });

  const GOLD_BEFORE = '2012-06-29';
  const BRL_BEFORE = '1999-12-31';
  // Misdated: no source prices a future date (rate-lookup.md, criterion
  // 43), and the recording offers no Update.
  const MISDATED = '2099-01-01';
  // Figures and no price at any of these dates.
  await plantHere([
    ...[
      ['Current account', '1000'], ['Brokerage', '2000'], ['Gold bars', '12.5'], ['Silver coins', '100'],
      ['Flat', '95'], ['Art', '3'], ['Yen account', '50000'], ['Real account', '700'],
    ].map(([name, value]) => snap(name, D10, value)),
    snap('Gold bars', GOLD_BEFORE, '10'),
    snap('Brokerage', GOLD_BEFORE, '1500'),
    snap('Real account', BRL_BEFORE, '600'),
    snap('Brokerage', BRL_BEFORE, '1400'),
    snap('Brokerage', MISDATED, '1300'),
  ]);
  await reread();

  // The lines of the recording's screen that say a unit's line is empty.
  const emptyLines = async (date) => {
    await go(`#/recording/${date}`);
    const shown = await ev("document.querySelector('#app').innerText");
    if (!shown.includes('Brokerage')) throw new Error(`the recording for ${date} did not open: ${shown}`);
    return { shown, lines: shown.split('\n').filter((l) => EMPTY_LINE.test(l)) };
  };
  const names = (lines, unit) => lines.some((l) => new RegExp(`(^|[^\\w-])${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(l));
  const verdict = (date, lines, sourced, unsourced) => {
    for (const unit of sourced) {
      check(`review 103: at ${date}, ${unit}, which a source prices, is named as empty, to be filled after Update`,
        names(lines, unit), JSON.stringify(lines));
    }
    for (const unit of unsourced) {
      check(`review 103: at ${date}, ${unit}, with no rate source there, is never named as empty`,
        !names(lines, unit), JSON.stringify(lines));
    }
  };

  const today = await emptyLines(D10);
  verdict(D10, today.lines, ['USD', 'Gold, troy ounce', 'BRL'], ['Silver, troy ounce', 'XAG-ozt', 'm2', 'PAINT', 'JPY']);

  const gold = await emptyLines(GOLD_BEFORE);
  verdict(GOLD_BEFORE, gold.lines, ['USD'], ['Gold, troy ounce', 'XAU-ozt']);

  const brl = await emptyLines(BRL_BEFORE);
  verdict(BRL_BEFORE, brl.lines, ['USD'], ['BRL']);

  const misdated = await emptyLines(MISDATED);
  check(
    `review 103: at ${MISDATED}, a date no source prices and with no Update, no unit is named as empty`,
    misdated.lines.length === 0,
    JSON.stringify(misdated.lines),
  );

  // A main currency no source quotes into: no unit has a rate source.
  const profile = await model(({ v }) => ({ recordId: v.profileRecord.recordId, version: v.profileRecord.version, payload: v.profile }));
  await plantHere([{
    type: 'profile', recordId: profile.recordId, version: profile.version + 1,
    payload: { ...profile.payload, mainCurrency: UNSERVED },
  }]);
  await reread();
  const unserved = await emptyLines(D10);
  check(
    `review 103: in a vault totalling in ${UNSERVED}, which no source quotes into, no unit is named as empty`,
    unserved.lines.length === 0,
    JSON.stringify(unserved.lines),
  );
}, { signsIn: false });
