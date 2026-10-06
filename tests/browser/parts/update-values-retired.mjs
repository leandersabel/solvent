// A unit an administrator retired, on the dashboard and on Update
// values (spec/features/rate-lookup.md, Maintaining the table): a
// holding already measured in it keeps its name and its price source.
// Modules: model.js, view-sweep.js, view-dashboard.js.
import { check, run, sql } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ev, home, reread, sweepToday, line, lineState } = r;

  sql("UPDATE symbols SET retired = 1 WHERE symbol IN ('XAG-ozt', 'XAU-ozt')");
  await reread();
  await home();

  const dashboard = await ev("document.querySelector('main').innerText");
  check(
    'a holding in a retired unit reads its unit in short on the dashboard',
    /100\.10?\s?ozt/.test(dashboard) && !dashboard.includes('XAG-ozt'),
    dashboard,
  );

  await sweepToday();
  const unitOf = (unit) =>
    rec.call((query) => document.querySelector(query).querySelector('.rate-unit').textContent.trim(), line(unit));
  const silver = await lineState('XAG-ozt');
  check('a retired unit\'s rate line names it in full', (await unitOf('XAG-ozt')) === 'Silver, troy ounce', await unitOf('XAG-ozt'));
  check(
    'a retired unit with no price source reads as one, not as typed text',
    silver.says.includes('No market price for Silver, troy ounce yet.'),
    JSON.stringify(silver),
  );
  const gold = await lineState('XAU-ozt');
  check(
    'a retired unit with a price source still gets a market rate',
    gold.chip.startsWith('Market rate') && gold.value !== '',
    JSON.stringify(gold),
  );
  await home();
}, { signsIn: false });
