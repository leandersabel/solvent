// Reviewer's checks of units on Update values and Recording detail,
// written from spec/features/record-snapshot.md (The rates, at the foot
// of the sweep; Rate lines on a reopened recording; Changing or clearing
// a rate says what it moves; Recording detail, Layout and Delete;
// criterion 96) and design-system.md, Units, alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const SYMBOL = /\bX(AU|AG|PT|PD)-(ozt|g)\b/;
// A figure's digits, however Settings groups and points them.
const DIGITS = String.raw`\d[\d,.'’   ]*`;

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const { rec, D1, D2, ago, id, proxy, ev, quiet, press, realKey, plantHere, reread, home, line, lineState, typeLine, format } = r;

  // Gold by the gram beside the seeded troy ounces, valued and priced at D1.
  [id['Gold grams']] = await plantHere([{
    type: 'account', payload: { name: 'Gold grams', unit: 'XAU-g', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:00Z' },
  }]);
  await plantHere([r.snap('Gold grams', D1, '250'), r.price('XAU-g', D1, '75')]);
  await reread();
  await home();

  const main = () => ev("document.querySelector('main').innerText");
  const open = async (hash) => {
    await rec.call((next) => { location.hash = next; }, hash);
    await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.sweep-row, .recording'), { args: [hash], label: hash });
    await quiet();
  };
  const unitOf = (unit) => rec.call((query) => {
    const l = document.querySelector(query);
    return l ? l.querySelector('.rate-unit').textContent.trim() : null;
  }, line(unit));
  const dialog = () => ev("document.querySelector('.dialog') ? document.querySelector('.dialog').innerText : ''");
  const closeDialog = async () => {
    await realKey('Escape', 'Escape', 27);
    await rec.holds("!document.querySelector('.dialog')", { timeout: 10000, label: 'the dialog to close' });
  };

  // ---- Recording detail ------------------------------------------------

  await home();
  await open(`#/recording/${D1}`);
  const atD1 = await main();
  check(
    'review 96: Recording detail names each price line\'s unit in full, a symbol never',
    ['Gold, troy ounce', 'Gold, gram', 'Silver, troy ounce', 'm2'].every((name) => atD1.includes(name)) && !SYMBOL.test(atD1),
    atD1.slice(0, 900),
  );
  check(
    'review Units: Recording detail\'s figures carry their unit in short, a currency\'s code ahead and any other unit after',
    /12\.5\s?ozt/.test(atD1) && /250\s?g\b/.test(atD1) && /95\s?m2/.test(atD1) &&
      new RegExp(`USD\\s?${DIGITS}`).test(atD1),
    atD1.slice(0, 900),
  );
  check(
    'review Units: no figure on Recording detail, a price included, carries a currency\'s code after it',
    !/\d[ \u00a0\u202f]?(USD|CHF)\b/.test(atD1),
    (atD1.match(/.*\d[ \u00a0\u202f]?(USD|CHF)\b.*/g) || []).join(' | '),
  );
  await press('Delete', 'main');
  const deleting = await dialog();
  check(
    'review 96: the recording\'s Delete names the units in full and shows no symbol',
    deleting.includes('Gold, troy ounce') && deleting.includes('Gold, gram') && !SYMBOL.test(deleting),
    deleting,
  );
  await closeDialog();
  await home();
  await open(`#/recording/${D2}`);
  const atD2 = await main();
  check(
    'review 96: Recording detail names a currency by its code',
    atD2.includes('USD') && !atD2.includes('United States') && !SYMBOL.test(atD2),
    atD2.slice(0, 600),
  );

  // ---- Update values, reopened at D1 -------------------------------------

  await home();
  await open(`#/sweep/${D1}`);
  const names = {};
  for (const unit of ['XAU-ozt', 'XAU-g', 'XAG-ozt', 'USD', 'm2', 'PAINT']) names[unit] = await unitOf(unit);
  check(
    'review 96: each rate line names its unit in full: Gold, troy ounce; Gold, gram; a currency by its code',
    names['XAU-ozt']?.includes('Gold, troy ounce') && names['XAU-g']?.includes('Gold, gram') &&
      names['XAG-ozt']?.includes('Silver, troy ounce') && names.USD?.includes('USD') && !names.USD.includes('United States') &&
      names.m2?.includes('m2') && names.PAINT?.includes('PAINT') &&
      Object.values(names).every((n) => n !== null && !SYMBOL.test(n)),
    JSON.stringify(names),
  );
  const sweepD1 = await main();
  check('review 96: Update values shows no symbol on any line or message', !SYMBOL.test(sweepD1), sweepD1.slice(0, 900));
  const usdEmpty = await lineState('USD');
  check(
    'review 96: an empty line on a reopened recording names a currency by its code',
    usdEmpty.says.includes('No rate was recorded for USD on this date.'),
    JSON.stringify(usdEmpty),
  );

  await typeLine('XAU-ozt', '2600');
  await press('Save the rate lines');
  const changing = await dialog();
  check(
    'review 96: changing a stored price names its unit in full in the confirmation',
    changing.includes('Changing the Gold, troy ounce rate for ') && changing.includes('measured in Gold, troy ounce') &&
      !SYMBOL.test(changing),
    changing,
  );
  await closeDialog();
  await home();
  const left = await main();
  check(
    'review 96: leaving with a price unsaved names its unit in full',
    left.includes('the Gold, troy ounce rate') && !SYMBOL.test(left),
    left.slice(0, 400),
  );

  await open(`#/sweep/${D1}`);
  await typeLine('XAG-ozt', '');
  await press('Save the rate lines');
  const clearing = await dialog();
  check(
    'review 96: clearing the only price of a unit names it in full in the confirmation',
    clearing.includes('Clearing the Silver, troy ounce price for ') &&
      clearing.includes('This is the only price recorded for Silver, troy ounce.') && !SYMBOL.test(clearing),
    clearing,
  );
  await closeDialog();
  await home();

  // ---- Update values, reopened at D2, where gold went in empty -----------

  await open(`#/sweep/${D2}`);
  const goldEmpty = await lineState('XAU-ozt');
  check(
    'review 96: an empty line on a reopened recording names gold in full',
    goldEmpty.says.includes('No rate was recorded for Gold, troy ounce on this date.'),
    JSON.stringify(goldEmpty),
  );
  check('review 96: the sweep reopened at D2 shows no symbol', !SYMBOL.test(await main()), (await main()).slice(0, 900));
  await home();

  // ---- A new sweep in an outage, and one before published prices ----------

  proxy.mode = 'down';
  await open(`#/sweep/${ago(60)}`);
  const goldDown = await lineState('XAU-ozt');
  check(
    'review 96: the outage wording names gold in full',
    goldDown.says.includes('No market rate came back for Gold, troy ounce.'),
    JSON.stringify(goldDown),
  );
  check('review 96: the sweep in an outage shows no symbol', !SYMBOL.test(await main()), (await main()).slice(0, 900));
  await home();
  proxy.mode = 'answer';

  const OLD = '2012-06-29';
  await open(`#/sweep/${OLD}`);
  const begins = await format('fullDate', '2013-01-02');
  const grams = await lineState('XAU-g');
  check(
    'review 96: before published prices begin, the line names gold by the gram in full',
    grams.says.includes(`Published prices for Gold, gram begin on ${begins}`),
    JSON.stringify(grams),
  );
  check('review 96: the sweep before published prices shows no symbol', !SYMBOL.test(await main()), (await main()).slice(0, 900));
  await home();

  // ---- Two prices for one unit on one date, on the reopened sweep ---------

  const DP = ago(70);
  await plantHere([r.snap('Brokerage', DP, '2000'), r.price('USD', DP, '0.91', 'proposed'), r.price('USD', DP, '0.93', 'proposed')]);
  await reread();
  await open(`#/sweep/${DP}`);
  const pair = await rec.call((query) => document.querySelector(query).innerText, line('USD'));
  check(
    'review Units: the two prices a reopened sweep flags carry the currency\'s code ahead of the figure',
    pair.includes('Keep this one') && !/\d[   ]?CHF\b/.test(pair),
    pair,
  );
  await home();
}, { signsIn: false });
