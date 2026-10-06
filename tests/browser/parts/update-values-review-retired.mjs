// Reviewer's checks of holdings measured in retired units
// (spec/features/rate-lookup.md, Maintaining the table, criterion 80;
// record-rate.md, Reading; design-system.md, Units), written from the
// spec alone. Silver has no price source, gold and the dollar have one,
// and all three are retired before the vault exists. The main currency
// is retired after registration, which offers only units still listed.
import { check, run, sql } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const retire = (symbol) => sql('UPDATE symbols SET retired = 1 WHERE symbol = ?', symbol);
const SYMBOLS = /XAG-ozt|XAU-ozt/;

await run(async () => {
  for (const symbol of ['XAG-ozt', 'XAU-ozt', 'USD']) retire(symbol);
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, T, ago, proposalsFor, rateAsks, traffic, text, tableRow, home, sweepToday, newRecording, lineState, line, figure, reread, quiet } = r;

  const silverRow = await tableRow('Silver coins');
  check(
    'review 80: on the dashboard a holding in a retired unit carries it in short, never as its symbol',
    Boolean(silverRow) && silverRow.text.includes('100.10 ozt') && !silverRow.text.includes('XAG'),
    JSON.stringify(silverRow),
  );
  const dashboard = await text();
  check('review 80 / design-system Units: the dashboard shows no retired symbol in place of a unit', !SYMBOLS.test(dashboard), dashboard);

  traffic.length = 0;
  await sweepToday();
  await rec.waitUntil((query) => document.querySelector(query)?.querySelector('input')?.value !== '', { args: [line('USD')], label: 'the proposals on arrival' });
  await quiet();
  const silver = await lineState('XAG-ozt');
  check(
    'review 80 / rate 9: a retired unit with no source reads by its label on Update values, as one nobody prices yet',
    Boolean(silver) && silver.says.includes('No market price for Silver, troy ounce yet') && !silver.says.includes('XAG-ozt'),
    JSON.stringify(silver),
  );
  const proposed = proposalsFor(T);
  const gold = await lineState('XAU-ozt');
  const usd = await lineState('USD');
  check(
    'review 80: a retired metal with a price source still gets its market rate',
    Boolean(gold) && figure(gold.value) === Number(proposed['XAU-ozt'].rate) && gold.chip.startsWith('Market rate'),
    JSON.stringify(gold),
  );
  check(
    'review 80: a retired currency with a price source still gets its market rate',
    Boolean(usd) && figure(usd.value) === Number(proposed.USD.rate) && usd.chip.startsWith('Market rate'),
    JSON.stringify(usd),
  );
  check('review rate 3: the sweep asked the proxy once', rateAsks().length === 1, rateAsks().map((a) => a.url).join(' '));
  const sweep = await text();
  check('review 80 / design-system Units: Update values shows no retired symbol in place of a unit', !SYMBOLS.test(sweep), sweep);

  // The main currency retired since registration is still the vault's
  // main currency: every sourced unit keeps its rate source.
  retire('CHF');
  await reread();
  await home();
  traffic.length = 0;
  const D = ago(12);
  await newRecording(D);
  await rec.waitUntil((query) => document.querySelector(query)?.querySelector('input')?.value !== '', { args: [line('USD')], label: 'the proposals with the main currency retired', timeout: 20000 })
    .catch(() => {});
  const later = proposalsFor(D);
  const after = { usd: await lineState('USD'), gold: await lineState('XAU-ozt') };
  check(
    'review record-rate Reading: with the main currency retired, a sourced unit is still asked for and gets its market rate',
    rateAsks().length === 1 &&
      Boolean(after.usd) && figure(after.usd.value) === Number(later.USD.rate) && after.usd.chip.startsWith('Market rate') &&
      Boolean(after.gold) && figure(after.gold.value) === Number(later['XAU-ozt'].rate),
    JSON.stringify({ asks: rateAsks().length, ...after }),
  );
  check(
    'review record-rate Reading: with the main currency retired, no line says no source quotes in it',
    !(await text()).includes('No price source quotes in'),
  );
}, { signsIn: false });
