// Reviewer's checks of Update values in a vault whose main currency no
// source quotes into (spec/features/record-snapshot.md, Update values,
// The rates, criterion 90; record-rate.md, Reading and The refresh,
// criterion 42), written from the spec alone. The currency is one an
// administrator added, stored with its flag on as an operator's shell
// would, so only the missing adapter says no source serves it.
import { check, run, sql } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const MAIN = 'ARS';

await run(async () => {
  sql("INSERT INTO symbols (symbol, label, kind, lookup) VALUES (?, 'Argentine Peso', 'currency', 1)", MAIN);
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, ago, proxy, rateAsks, traffic, stored, on, model, plantHere, reread, go, home, newRecording, typeRow, pressRow, rowState, lineState } = r;

  const profile = await model(({ v }) => ({ recordId: v.profileRecord.recordId, version: v.profileRecord.version, payload: v.profile }));
  await plantHere([{
    type: 'profile', recordId: profile.recordId, version: profile.version + 1,
    payload: { ...profile.payload, mainCurrency: MAIN },
  }]);
  await reread();
  await go('#/');
  check('review: the vault now totals in the unquoted currency', (await model(({ v }) => v.mainCurrency)) === MAIN);

  const unquoted = `No price source quotes in ${MAIN}, your main currency. This one is yours to set.`;
  const sourced = ['USD', 'CHF', 'XAU-ozt'];
  const D = ago(15);
  proxy.mode = 'answer';
  traffic.length = 0;
  await newRecording(D);
  const fresh = Object.fromEntries(await Promise.all(sourced.map(async (u) => [u, await lineState(u)])));
  check(
    'review 90: each sourced unit\'s rate line says no price source quotes in the main currency, and offers no Look it up',
    sourced.every((u) => fresh[u] && fresh[u].says.includes(unquoted) && !fresh[u].lookup && !fresh[u].says.includes('No market rate came back')),
    JSON.stringify(fresh),
  );
  check('review 90: the main currency has no rate line', (await lineState(MAIN)) === null);

  await typeRow('Brokerage', '2600');
  await pressRow('Brokerage');
  await typeRow('Savings', '5100');
  await pressRow('Savings');
  check('review: both figures recorded', (await rowState('Brokerage')).state === 'Recorded for this date.' && (await rowState('Savings')).state === 'Recorded for this date.',
    JSON.stringify([await rowState('Brokerage'), await rowState('Savings')]));
  // Swiss francs had no price at all, and Savings now records a
  // quantity in them, so the line asks for one, still saying why.
  const asked = await lineState('CHF');
  check(
    'review 90: a line asking for a price it never had still says no price source quotes in the main currency',
    asked.says.includes(`No price source quotes in ${MAIN}, your main currency.`) && !asked.lookup,
    JSON.stringify(asked),
  );
  check(
    'review 90 / rate 42: opening the sweep and recording in it asks the proxy nothing',
    rateAsks().length === 0,
    rateAsks().map((a) => a.url).join(' '),
  );
  check('review rate: an owner-priced line writes no price it was not given', on(await stored('rate'), D).length === 0);

  await home();
  traffic.length = 0;
  await rec.call((next) => { location.hash = next; }, `#/sweep/${D}`);
  await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.rate-line'), { args: [`#/sweep/${D}`], label: 'the reopened sweep' });
  await r.quiet();
  const reopened = Object.fromEntries(await Promise.all(sourced.map(async (u) => [u, await lineState(u)])));
  check(
    'review 90: the reopened recording offers no Look it up on any line and asks nothing',
    sourced.every((u) => reopened[u] && !reopened[u].lookup && reopened[u].says.includes(unquoted)) && rateAsks().length === 0,
    JSON.stringify({ reopened, asks: rateAsks().length }),
  );
}, { signsIn: false });
