// Reviewer's check of a price write failing after the first holding on a
// new sweep (spec/features/record-rate.md, The write path, "A price write
// failure is never silent", criterion 8; record-snapshot.md, Update
// values, Writes; design-system.md, A write that failed), written from
// the spec alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const {
    rec, ago, proposalsFor, traffic, faults, writesSent, rateAsks, bodyOf, ev, press, stored, on,
    pressRow, typeRow, rowState, line, lineState, typeLine, figure, home, newRecording,
  } = r;

  const D = ago(51);
  const failRates = (entry) => entry.method === 'PUT' && (bodyOf(entry) || {}).recordType === 'rate' && 500;
  const ratePuts = () => writesSent().filter((w) => w.method === 'PUT' && (bodyOf(w) || {}).recordType === 'rate');
  const ratesAt = async () => on(await stored('rate'), D);
  const offersLineSave = () =>
    ev("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save the rate lines' && b.getClientRects().length)");
  const outsideLines = () => ev(`(() => {
    const copy = document.querySelector('main').cloneNode(true);
    copy.querySelectorAll('.rate-line, .sweep-row').forEach((n) => n.remove());
    return copy.textContent;
  })()`);

  await newRecording(D);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals on arrival' });
  await typeLine('m2', '12000');
  await typeLine('XAG-ozt', '27.5');
  check('review rate 29: a new sweep offers no rate-lines save before a row is recorded', !(await offersLineSave()));

  faults.push(failRates);
  traffic.length = 0;
  await typeRow('Current account', '1234.5');
  await pressRow('Current account');
  const firstPuts = ratePuts().length;
  const snapshot = on(await stored('snapshot'), D);
  const row = await rowState('Current account');
  const lines = { m2: await lineState('m2'), silver: await lineState('XAG-ozt'), usd: await lineState('USD'), gold: await lineState('XAU-ozt') };
  const banner = await outsideLines();

  check(
    'review rate 8: the quantity record exists and reads back exactly',
    snapshot.length === 1 && snapshot[0].payload.value === '1234.5',
    JSON.stringify(snapshot.map((s) => s.payload)),
  );
  check('review rate 8: every price write failed, so none is stored', firstPuts > 0 && (await ratesAt()).length === 0, String(firstPuts));
  check(
    'review rate 8: the row is not rolled back and reads as recorded',
    figure(row.field) === 1234.5 && !row.state.includes('Nothing recorded') && row.error === '',
    JSON.stringify(row),
  );
  check(
    'review rate 8: the screen says the prices were not updated, naming each unit typed',
    /not (been )?(updated|saved)|did not save/i.test(banner) && banner.includes('m2') && banner.includes('Silver, troy ounce'),
    banner.slice(0, 600),
  );
  check(
    'review rate 8: a price typed on the sweep stays in its line',
    figure(lines.m2.value) === 12000 && figure(lines.silver.value) === 27.5,
    JSON.stringify(lines),
  );
  check(
    'review rate: a line whose proposal failed to write keeps the proposal',
    figure(lines.usd.value) === Number(proposalsFor(D).USD.rate) &&
      figure(lines.gold.value) === Number(proposalsFor(D)['XAU-ozt'].rate),
    JSON.stringify(lines),
  );
  check('review rate: once a row is recorded the rate-lines save is offered', await offersLineSave());

  // The prices go in once per sitting, and nothing failed is retried on
  // the person's behalf.
  traffic.length = 0;
  await typeRow('Savings', '5100');
  await pressRow('Savings');
  check(
    'review: a second row records its quantity alone and retries no price',
    ratePuts().length === 0 && figure((await lineState('m2')).value) === 12000,
    writesSent().map((w) => `${w.method} ${(bodyOf(w) || {}).recordType}`).join(' '),
  );

  faults.splice(faults.indexOf(failRates), 1);
  traffic.length = 0;
  await press('Save the rate lines');
  const asked = await ev("Boolean(document.querySelector('.dialog'))");
  if (asked) await press('Save the prices', '.dialog');
  const retried = Object.fromEntries((await ratesAt()).map((p) => [p.payload.symbol, p.payload]));
  check(
    'review rate: the rate-lines save retries every line whose write failed, typed figures as manual, asking nothing',
    !asked && retried.m2?.rate === '12000' && retried.m2.rateSource === 'manual' &&
      retried['XAG-ozt']?.rate === '27.5' && retried['XAG-ozt'].rateSource === 'manual' &&
      retried.USD?.rateSource === 'proposed' && retried.USD.rate === proposalsFor(D).USD.rate &&
      retried['XAU-ozt']?.rateSource === 'proposed' && retried['XAU-ozt'].rateAsOf === proposalsFor(D)['XAU-ozt'].asOf &&
      Object.keys(retried).length === 4 && rateAsks().length === 0,
    JSON.stringify({ asked, retried, asks: rateAsks().length }),
  );

  // Nothing typed: only the proposals' writes fail.
  const P = ago(52);
  await home();
  await newRecording(P);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals on arrival' });
  faults.push(failRates);
  await typeRow('Current account', '1300');
  await pressRow('Current account');
  faults.splice(faults.indexOf(failRates), 1);
  const offered = await offersLineSave();
  check(
    'review rate: with only proposals failed, their lines keep them and the rate-lines save is offered to retry them',
    offered && figure((await lineState('USD')).value) === Number(proposalsFor(P).USD.rate) &&
      on(await stored('rate'), P).length === 0,
    JSON.stringify({ offered, usd: await lineState('USD') }),
  );
}, { signsIn: false });
