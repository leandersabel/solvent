// Reviewer's checks that a typed price on a line with no rate source at
// its date keeps saying why it is yours to set once saved and on every
// reopening, written from spec/features/record-snapshot.md (Update
// values, The rates, at the foot of the sweep; Rate lines on a reopened
// recording; criteria 16 and 17) alone. Covers a free-text unit, a
// symbol with no provider and a published unit before its prices begin,
// saved through a row and through the lines' own save.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, D2, ago, quiet, press, reread, home, line, typeLine, typeRow, pressRow, stored, on, format, rateAsks, traffic } = r;

  const open = async (hash) => {
    await home();
    await rec.call((next) => { location.hash = next; }, hash);
    await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.rate-line'), { args: [hash], label: hash });
    await quiet();
  };
  // Everything a person reads on the line, its chip apart.
  const read = (unit) =>
    rec.call((query) => {
      const l = document.querySelector(query);
      if (!l) return null;
      const chip = [...l.querySelectorAll('.chip')].map((c) => c.textContent.trim()).filter(Boolean).join(' ');
      return {
        chip,
        text: l.innerText.replace(/\s+/g, ' ').trim().replace(chip, ''),
        value: l.querySelector('input') ? l.querySelector('input').value : null,
        lookup: Boolean(l.querySelector('.btn-inline:not([hidden])')),
      };
    }, line(unit));
  const dialogs = () => rec.call(() => [...document.querySelectorAll('.dialog')].map((d) => d.innerText).join(' | '));
  const saveLines = async () => {
    await press('Save the rate lines');
    return dialogs();
  };
  // What a typed line must not say: an age, that no price exists, a
  // question, when an earlier price was set, or the outage wording.
  const STALE = /\bago\b|\bestimated\b|No price for|Nothing prices|What (is|was) 1|until a price exists|Set on|No market rate came back|No rate was recorded/i;
  const reads = (seen, why) => Boolean(seen) && seen.chip === 'Typed by you' && seen.text.includes(why) && !STALE.test(seen.text) && !seen.lookup;
  // Three readings of each line: as it stands, reopened from the
  // dashboard, and reopened after the vault is read again as a fresh
  // unlock would.
  const thrice = async (hash, units) => {
    const seen = Object.fromEntries(units.map((u) => [u, {}]));
    for (const u of units) seen[u].saved = await read(u);
    await open(hash);
    for (const u of units) seen[u].reopened = await read(u);
    await reread();
    await open(hash);
    for (const u of units) seen[u].fresh = await read(u);
    return seen;
  };
  const every = (seen, why) => reads(seen.saved, why) && reads(seen.reopened, why) && reads(seen.fresh, why);
  const priceAt = async (symbol, date) => on(await stored('rate'), date).filter((p) => p.payload.symbol === symbol);
  const asked = (symbol) => rateAsks().some((a) => new URL(a.url).searchParams.get('symbol') === symbol);

  const FLAT = 'Nobody publishes a price for m2. This one is yours to set.';
  const PAINT = 'Nobody publishes a price for PAINT. This one is yours to set.';
  const SILVER = /No market price for .+ yet\. This one is yours to set\./;

  // ---- 16: the prices the seeded recording wrote by hand, reopened -------

  await open(`#/sweep/${D1}`);
  const flatD1 = await read('m2');
  const silverD1 = await read('XAG-ozt');
  check(
    'review 16: a reopened recording whose m2 price was typed reads Typed by you and says only why the price is yours to set',
    reads(flatD1, FLAT),
    JSON.stringify(flatD1),
  );
  check(
    'review 16: a reopened recording whose silver price was typed reads Typed by you and says only why the price is yours to set',
    reads(silverD1, 'This one is yours to set.') && SILVER.test(silverD1.text),
    JSON.stringify(silverD1),
  );

  // ---- 16: typed on a reopened recording and saved by the lines' save -----

  traffic.length = 0;
  await open(`#/sweep/${D2}`);
  await typeLine('m2', '10400');
  await typeLine('PAINT', '650');
  await typeLine('XAG-ozt', '27');
  const asks = await saveLines();
  const typedAtD2 = on(await stored('rate'), D2).filter((p) => p.payload.rateSource === 'manual').map((p) => p.payload.symbol).sort();
  check(
    'review 16: filling in m2, PAINT and silver on a reopened recording asks nothing and writes all three as typed',
    asks === '' && JSON.stringify(typedAtD2) === JSON.stringify(['PAINT', 'XAG-ozt', 'm2']),
    JSON.stringify({ asks, rates: on(await stored('rate'), D2).map((p) => p.payload) }),
  );
  const d2 = await thrice(`#/sweep/${D2}`, ['m2', 'PAINT', 'XAG-ozt']);
  check(
    'review 16: an m2 price saved by the lines\' save reads Typed by you and why, once saved and on every reopening',
    every(d2.m2, FLAT),
    JSON.stringify(d2.m2),
  );
  check(
    'review 16: a PAINT price saved by the lines\' save reads Typed by you and why, never that there is no price, saved or reopened',
    every(d2.PAINT, PAINT),
    JSON.stringify(d2.PAINT),
  );
  check(
    'review 16: a silver price saved by the lines\' save reads Typed by you and why, once saved and on every reopening',
    every(d2['XAG-ozt'], 'This one is yours to set.') && Object.values(d2['XAG-ozt']).every((seen) => SILVER.test(seen.text)),
    JSON.stringify(d2['XAG-ozt']),
  );
  check(
    'review 16: neither the sweep nor its reopenings ask the source about m2, PAINT or silver',
    !asked('m2') && !asked('PAINT') && !asked('XAG-ozt'),
    JSON.stringify(rateAsks().map((a) => a.url)),
  );

  // ---- 16: typed at a new date and saved with the first row ----------------

  const DN = ago(12);
  await open(`#/sweep/${DN}`);
  await typeLine('m2', '10500');
  await typeRow('Flat', '95');
  await pressRow('Flat');
  const flatNew = (await thrice(`#/sweep/${DN}`, ['m2'])).m2;
  check(
    'review 16: an m2 price saved with the first row recorded reads Typed by you and why, once saved and on every reopening',
    (await priceAt('m2', DN)).length === 1 && every(flatNew, FLAT),
    JSON.stringify(flatNew),
  );

  // ---- 17: the dollar before its published prices begin ------------------

  const begins = await format('fullDate', '1999-01-04');
  const BEGINS = `begin on ${begins}.`;
  const usdWhy = (seen) => Boolean(seen) && /Published prices for .+ begin on /.test(seen.text) && seen.text.includes(`${BEGINS} This one is yours to set.`);

  // Typed where no price exists before the date, saved with the first row.
  const OLD = '1998-06-30';
  traffic.length = 0;
  await open(`#/sweep/${OLD}`);
  await typeRow('Dollar cash', '300');
  const asking = await read('USD');
  await typeLine('USD', '1.45');
  await pressRow('Dollar cash');
  const first = (await thrice(`#/sweep/${OLD}`, ['USD'])).USD;
  check(
    'review 17: before a price is typed, the dollar line in 1998 asks for one and says when published prices begin',
    Boolean(asking) && /What was 1 .+ worth in CHF on .+\? Published prices for .+ begin on /.test(asking.text) && asking.text.includes(BEGINS),
    JSON.stringify(asking),
  );
  check(
    'review 17: a dollar price typed in 1998 and saved with the first row says only when published prices begin and that it is yours to set, saved and on every reopening',
    (await priceAt('USD', OLD)).length === 1 && every(first, BEGINS) && Object.values(first).every(usdWhy),
    JSON.stringify(first),
  );

  // Starting from an earlier price, filled in by the lines' own save.
  const LATER = '1998-09-30';
  await open(`#/sweep/${LATER}`);
  await typeRow('Current account', '900');
  await pressRow('Current account');
  const before = await read('USD');
  check(
    'review 17: an untouched dollar line in 1998 starts from the last price before the date and records nothing',
    Boolean(before) && before.text.includes(`Set on ${await format('fullDate', OLD)}.`) && usdWhy(before) && (await priceAt('USD', LATER)).length === 0,
    JSON.stringify(before),
  );
  await typeLine('USD', '1.47');
  const filled = await saveLines();
  const later = (await thrice(`#/sweep/${LATER}`, ['USD'])).USD;
  check(
    'review 17: a dollar price typed in 1998 and saved by the lines\' save says only when published prices begin and that it is yours to set, saved and on every reopening',
    filled === '' && (await priceAt('USD', LATER)).length === 1 && every(later, BEGINS) && Object.values(later).every(usdWhy),
    JSON.stringify({ filled, later }),
  );
  check(
    'review 17: nothing on the 1998 sweeps asks the source about the dollar',
    !asked('USD'),
    JSON.stringify(rateAsks().map((a) => a.url)),
  );
  await home();
}, { signsIn: false });
