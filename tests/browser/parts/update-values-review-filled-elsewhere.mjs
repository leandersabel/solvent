// Reviewer's checks of a rate-lines save on a reopened recording whose
// typed price another window filled in meanwhile, written from
// spec/features/record-snapshot.md (Update values, "Rate lines on a
// reopened recording"; Creating and reopening are distinct acts;
// criteria 37 and 115) and spec/features/record-rate.md (Saving at a
// date that holds a recording, the rate-lines save, step 0) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

const FILLED = 'The USD rate was filled in another window, and the line shows what is stored now.';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const {
    rec, D1, ev, text, quiet, press, home, go, line, lineState, typeLine, figure, stored, on, bytes, plantHere, price,
    traffic, writesSent, typeReads,
  } = r;

  const pricesAt = async (date, symbol) => on(await stored('rate'), date).filter((p) => p.payload.symbol === symbol);
  const shown = () => ev("document.querySelector('main').innerText.replace(/\\s+/g, ' ')");
  const offers = (label) =>
    rec.call((name) => [...document.querySelectorAll('main button, main a')]
      .some((b) => b.textContent.trim() === name && b.getClientRects().length), label);
  // The converted figure beneath a holding's quantity field.
  const convertedOn = (name) =>
    rec.call((holding) => [...document.querySelectorAll('.sweep-row')]
      .find((row) => row.querySelector('.holding-name').textContent === holding).querySelector('.hint.numeric').textContent, name);
  const saveLines = async () => {
    traffic.length = 0;
    await press('Save the rate lines');
    if (await ev("Boolean(document.querySelector('.dialog'))")) await press('Save the prices', '.dialog');
    await quiet();
  };
  const reopen = async (date) => {
    await go(`#/recording/${date}`);
    await press('Update', '.form-actions');
    await rec.waitUntil((query) => Boolean(document.querySelector(query)), { args: [line('USD')], label: 'the rate lines' });
    await quiet();
  };

  // ---- 115: a typed price alone, its slot filled in another window -------

  // D1 holds no dollar price, so its USD line reopens empty.
  await reopen(D1);
  await typeLine('USD', '0.96');
  await quiet();
  const [planted] = await plantHere([price('USD', D1, '0.93', 'proposed')]);
  const before = bytes(await pricesAt(D1, 'USD'));
  await saveLines();
  const after = await pricesAt(D1, 'USD');
  const usd = await lineState('USD');
  const page = await shown();
  check(
    'review 115: the save reloads both types and sends no write',
    typeReads('snapshot').length > 0 && typeReads('rate').length > 0 && writesSent().length === 0,
    JSON.stringify(traffic.map((t) => `${t.method} ${t.url}`)),
  );
  check(
    'review 115: the price the other window stored is left as stored, the only USD entry at the date',
    after.length === 1 && after[0].recordId === planted && bytes(after) === before,
    JSON.stringify(after.map((p) => ({ ...p.payload, version: p.version }))),
  );
  check('review 115: the line shows the stored 0.93', figure(usd.value) === 0.93, JSON.stringify(usd));
  const brokerage = await convertedOn('Brokerage');
  check(
    'review: Brokerage, USD 2000, converts at the 0.93 its line now shows, never the refused 0.96',
    brokerage.includes('1,860') && !brokerage.includes('1,920'),
    brokerage,
  );
  check(`review 115: the banner says "${FILLED}"`, page.includes(FILLED), page.slice(0, 600));
  check(
    'review 115: nothing says the date already has a recording, and no Open the recording is offered',
    !page.includes('already has a recording') && !page.includes('got there first') && !(await offers('Open the recording')),
    page.slice(0, 600),
  );

  await home();
  check('review 37 / 115: leaving after the refusal names no unit as unsaved', !(await text()).includes('not saved'),
    (await text()).slice(0, 400));

  // ---- 115 and step 0: the taken slot refuses the whole save -------------

  // The planted dollar entry goes, so D1's dollar line reopens empty again.
  await rec.call(async (gone) => (await import('/static/js/api.js')).del('/api/records/' + gone), planted);
  await r.reread();
  await reopen(D1);
  const goldBefore = bytes(await pricesAt(D1, 'XAU-ozt'));
  await typeLine('XAU-ozt', '2777');
  await typeLine('USD', '0.96');
  await quiet();
  const [second] = await plantHere([price('USD', D1, '0.94', 'manual')]);
  await saveLines();
  const page2 = await shown();
  check(
    'review rate step 0: a taken slot refuses the whole save, the gold change unwritten',
    writesSent().length === 0 && bytes(await pricesAt(D1, 'XAU-ozt')) === goldBefore,
    JSON.stringify(writesSent().map((w) => `${w.method} ${w.url}`)),
  );
  check('review 115: the USD line shows the stored 0.94', figure((await lineState('USD')).value) === 0.94,
    JSON.stringify(await lineState('USD')));
  check(
    'review 115: the banner names USD as filled in another window, never the date as taken',
    page2.includes(FILLED) && !page2.includes('already has a recording'),
    page2.slice(0, 600),
  );
  const usdAfter = await pricesAt(D1, 'USD');
  check('review 115: the stored USD price is left as stored', usdAfter.length === 1 && usdAfter[0].recordId === second,
    JSON.stringify(usdAfter.map((p) => p.payload)));

  // Typed and saved again, the gold change creates nothing and goes through.
  await typeLine('XAU-ozt', '2777');
  await quiet();
  await saveLines();
  const goldNow = await pricesAt(D1, 'XAU-ozt');
  check(
    'review: saving again writes the gold change over the stored entry and leaves USD alone',
    goldNow.length === 1 && goldNow[0].payload.rate === '2777' && bytes(await pricesAt(D1, 'USD')) === bytes(usdAfter),
    JSON.stringify(goldNow.map((p) => p.payload)),
  );
}, { signsIn: false });
