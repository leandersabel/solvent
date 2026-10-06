// Reviewer's checks of Update values and Recording detail
// (spec/features/record-snapshot.md), written from the acceptance
// criteria and "Which recording you are in" alone: when a sitting begins
// and continues, the reopened recording's empty rate lines and Look it
// up, and every blind criterion these two screens carry.
import { RECORDER_PASSWORD, check, enterPasswordOn, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const {
    rec, T, ago, D1, D2, id, proxy, proposalsFor, traffic, writesSent, rateAsks, typeReads, bodyOf,
    ev, text, quiet, press, stored, on, bytes, plantHere, reread, go, format, model,
    typeRow, pressRow, rowState, line, lineState, typeLine, figure, home, newRecording, sweepToday,
  } = r;

  // Two units with no price anywhere: a published one, and gold by the
  // gram, whose published prices begin in 2013.
  const extra = await plantHere([
    { type: 'account', payload: { name: 'Pounds', unit: 'GBP', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:00Z' } },
    { type: 'account', payload: { name: 'Gold grams', unit: 'XAU-g', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-02T00:00:01Z' } },
  ]);
  [id.Pounds, id['Gold grams']] = extra;
  await reread();
  await home();

  const snapshotsAt = async (date) => on(await stored('snapshot'), date);
  const everythingAt = async (date) => bytes([...on(await stored('snapshot'), date), ...on(await stored('rate'), date)]);
  const byAddress = async (hash) => {
    await rec.call((next) => { location.hash = next; }, hash);
    await rec.waitUntil((wanted) => location.hash === wanted && document.querySelector('.sweep-row, .recording'), { args: [hash], label: hash });
    await quiet();
  };
  const lookUp = async (unit) => {
    await rec.call((query) => document.querySelector(query).querySelector('.btn-inline:not([hidden])').click(), line(unit));
    await quiet();
  };
  const saveLines = async () => {
    await press('Save the rate lines');
    const asked = await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent.trim() === 'Save the prices')");
    if (asked) await press('Save the prices', '.dialog');
  };
  const reopenedWording = (unit, state) =>
    state.says.includes(`No rate was recorded for ${unit} on this date.`) && state.lookup &&
      !state.says.includes('No market rate came back');
  const outageWording = (unit, state) =>
    state.says.includes(`No market rate came back for ${unit}. Nothing will be recorded for it for this date.`) &&
      !state.lookup && !state.says.includes('No rate was recorded');
  const putsAndDeletes = () => writesSent().map((w) => `${w.method} ${new URL(w.url).pathname}`);

  // ---- The reported case: a recording made in an outage, reached by its address

  const DX = ago(33);
  proxy.mode = 'down';
  traffic.length = 0;
  const free = await newRecording(DX);
  check('review: an unmarked date opens the sweep there', !free.marked && (await ev('location.hash')) === `#/sweep/${DX}`, JSON.stringify(free));
  check('review: the new sweep in an outage reads the outage wording', outageWording('USD', await lineState('USD')), JSON.stringify(await lineState('USD')));
  traffic.length = 0;
  await typeRow('Brokerage', '2500');
  await pressRow('Brokerage');
  await typeRow('Gold bars', '13');
  await pressRow('Gold bars');
  const firstPut = traffic.findIndex((t) => t.method === 'PUT');
  const reloadsAt = (type) => traffic.map((t, at) => [t, at]).filter(([t]) => t.method === 'GET' && t.url.endsWith(`/api/records?type=${type}`)).map(([, at]) => at);
  check(
    'review 58: two rows at a new date bring exactly one reload of each type, before the first row is written',
    reloadsAt('snapshot').length === 1 && reloadsAt('rate').length === 1 &&
      reloadsAt('snapshot')[0] < firstPut && reloadsAt('rate')[0] < firstPut,
    JSON.stringify({ snapshot: reloadsAt('snapshot'), rate: reloadsAt('rate'), firstPut }),
  );
  check(
    'review: a redraw on screen continues the sitting, so the line keeps the outage wording',
    outageWording('USD', await lineState('USD')) && outageWording('Gold, troy ounce', await lineState('XAU-ozt')),
    JSON.stringify([await lineState('USD'), await lineState('XAU-ozt')]),
  );
  check('review: nothing is written for the units the source did not answer for', on(await stored('rate'), DX).length === 0);
  check(
    'review 20: only the rows acted on hold a figure at the date',
    (await snapshotsAt(DX)).map((s) => s.accountId).sort().join() === [id.Brokerage, id['Gold bars']].sort().join(),
  );

  await home();
  proxy.mode = 'answer';
  const atDX = await everythingAt(DX);
  traffic.length = 0;
  await byAddress(`#/sweep/${DX}`);
  const usdBack = await lineState('USD');
  check('review 35: by its address after the dashboard, the empty line says no rate was recorded and offers Look it up', reopenedWording('USD', usdBack), JSON.stringify(usdBack));
  check(
    'review 34: opening the reopened sweep asks no rate and writes nothing, and every record at the date is unchanged',
    rateAsks().length === 0 && writesSent().length === 0 && (await everythingAt(DX)) === atDX,
    `${rateAsks().length} asks, ${putsAndDeletes().join(' ')}`,
  );
  check('review: the rows read as recorded on the reopened recording', (await rowState('Brokerage')).state === 'Recorded for this date.');
  // GBP and gram gold have a source at this date and nothing stored; the
  // stub's answer covers neither. Silver is `lookup: false`; m2 and PAINT
  // are free text.
  const offers = Object.fromEntries(await Promise.all(
    ['USD', 'XAU-ozt', 'GBP', 'XAU-g', 'XAG-ozt', 'm2', 'PAINT'].map(async (u) => [u, (await lineState(u) || {}).lookup]),
  ));
  check(
    'review rate 18: Look it up is offered on every empty line with a source, and not on lookup-false or free-text units',
    offers.USD && offers['XAU-ozt'] && offers.GBP && offers['XAU-g'] && !offers['XAG-ozt'] && !offers.m2 && !offers.PAINT,
    JSON.stringify(offers),
  );
  const snapshotsAtDX = bytes(await snapshotsAt(DX));
  await lookUp('XAU-ozt');
  const asked = await ev("Boolean(document.querySelector('.dialog'))");
  const firstWrite = traffic.findIndex((t) => t.method === 'PUT');
  check(
    'review 34: pressing Look it up issues the one request, for this date, carrying no figure or holding',
    rateAsks().length === 1 && new URL(rateAsks()[0].url).searchParams.get('date') === DX &&
      [...new URL(rateAsks()[0].url).searchParams.keys()].every((k) => ['date', 'quote', 'symbol'].includes(k)) &&
      !Object.values(id).some((h) => JSON.stringify(rateAsks()[0]).includes(h)),
    rateAsks().map((a) => a.url).join(' '),
  );
  check(
    'review: Look it up reloads both types before its first write',
    firstWrite >= 0 && reloadsAt('snapshot').some((at) => at < firstWrite) && reloadsAt('rate').some((at) => at < firstWrite),
    JSON.stringify({ snapshot: reloadsAt('snapshot'), rate: reloadsAt('rate'), firstWrite }),
  );
  const savedAtDX = on(await stored('rate'), DX);
  const savedAs = (unit) => savedAtDX.filter((p) => p.payload.symbol === unit);
  const asProposed = (unit) => {
    const [entry, ...more] = savedAs(unit);
    const answer = proposalsFor(DX)[unit];
    return entry && !more.length && entry.version === 1 && entry.payload.rateSource === 'proposed' &&
      entry.payload.rate === answer.rate && entry.payload.rateAsOf === answer.asOf && entry.payload.rateTarget === 'CHF';
  };
  check(
    'review 37 / rate 18: one press saves every empty line the answer covers as proposed with its rateAsOf, with no confirmation, and nothing else',
    asProposed('USD') && asProposed('XAU-ozt') && savedAtDX.length === 2 && !asked &&
      putsAndDeletes().length === 2 && putsAndDeletes().every((w) => w.startsWith('PUT')) &&
      bytes(await snapshotsAt(DX)) === snapshotsAtDX,
    JSON.stringify({ saved: savedAtDX.map((p) => p.payload), asked, writes: putsAndDeletes() }),
  );
  const goldFilled = await lineState('XAU-ozt');
  const goldDay = await format('dayMonth', proposalsFor(DX)['XAU-ozt'].asOf, 'short');
  check(
    'review 36: the line shows the answer, labeled with the day it is for, and no longer offers Look it up',
    figure(goldFilled.value) === Number(proposalsFor(DX)['XAU-ozt'].rate) && goldFilled.chip.includes(goldDay) && !goldFilled.lookup &&
      !(await lineState('USD')).lookup,
    JSON.stringify({ goldFilled, goldDay, usd: await lineState('USD') }),
  );
  check(
    'review: a line the answer left out stays empty with its own Look it up',
    reopenedWording('GBP', await lineState('GBP')) && reopenedWording('Gold, gram', await lineState('XAU-g')),
    JSON.stringify([await lineState('GBP'), await lineState('XAU-g')]),
  );
  await home();
  check('review 37: leaving at once names no unit as unsaved', !(await text()).includes('not saved'), (await text()).slice(0, 300));

  // ---- Look it up beside typed text, and a price filled in elsewhere ----

  const recordInOutage = async (date) => {
    proxy.mode = 'down';
    await home();
    await byAddress(`#/sweep/${date}`);
    await typeRow('Brokerage', '2500');
    await pressRow('Brokerage');
    await home();
    proxy.mode = 'answer';
    await byAddress(`#/sweep/${date}`);
  };
  const DT = ago(46);
  await recordInOutage(DT);
  await typeLine('USD', '0.9');
  await plantHere([r.price('XAU-ozt', DT, '2500', 'proposed')]);
  const plantedGold = bytes(on(await stored('rate'), DT));
  traffic.length = 0;
  await lookUp('XAU-ozt');
  const goldThere = await lineState('XAU-ozt');
  check(
    'review: Look it up leaves a typed line alone and a price stored elsewhere as stored, writing nothing',
    writesSent().length === 0 && bytes(on(await stored('rate'), DT)) === plantedGold &&
      (await lineState('USD')).value === '0.9' && figure(goldThere.value) === 2500,
    JSON.stringify({ writes: putsAndDeletes(), usd: await lineState('USD'), goldThere }),
  );
  check(
    'review: the banner says the price was filled in another window',
    (await text()).includes('The Gold, troy ounce rate was filled in another window, and the line shows what is stored now.'),
    (await text()).slice(0, 600),
  );
  await home();
  const leftNotice = await text();
  check(
    'review: leaving with the typed line names that unit, and not the one stored elsewhere',
    leftNotice.includes('the USD rate') && !leftNotice.includes('the Gold, troy ounce rate'),
    leftNotice.slice(0, 400),
  );

  // ---- A create that fails, retried by the lines' own save -------------

  const DU = ago(47);
  await recordInOutage(DU);
  const failRates = (entry) => entry.method === 'PUT' && (bodyOf(entry) || {}).recordType === 'rate' && 500;
  r.faults.push(failRates);
  traffic.length = 0;
  await lookUp('USD');
  r.faults.splice(r.faults.indexOf(failRates), 1);
  const outsideLines = await ev(`(() => {
    const copy = document.querySelector('main').cloneNode(true);
    copy.querySelectorAll('.rate-line, .sweep-row').forEach((n) => n.remove());
    return copy.textContent;
  })()`);
  check(
    'review: a create that fails keeps the answer on its line and is named outside the lines',
    figure((await lineState('USD')).value) === Number(proposalsFor(DU).USD.rate) &&
      figure((await lineState('XAU-ozt')).value) === Number(proposalsFor(DU)['XAU-ozt'].rate) &&
      outsideLines.includes('USD') && outsideLines.includes('Gold, troy ounce') && on(await stored('rate'), DU).length === 0,
    JSON.stringify({ usd: await lineState('USD'), gold: await lineState('XAU-ozt'), outsideLines: outsideLines.slice(0, 400) }),
  );
  traffic.length = 0;
  await press('Save the rate lines');
  const retryAsked = await ev("Boolean(document.querySelector('.dialog'))");
  const retried = on(await stored('rate'), DU);
  check(
    'review rate 18: the lines\' save retries the failed creates as proposed, asking nothing',
    !retryAsked && retried.length === 2 && retried.every((p) => p.version === 1 && p.payload.rateSource === 'proposed' &&
      p.payload.rateAsOf === proposalsFor(DU)[p.payload.symbol].asOf) && rateAsks().length === 0,
    JSON.stringify({ retryAsked, retried: retried.map((p) => p.payload), asks: rateAsks().length }),
  );

  // ---- An answer after leaving, and a date emptied elsewhere -----------

  const DL = ago(48);
  await recordInOutage(DL);
  traffic.length = 0;
  const release = r.holdRates();
  await rec.call((query) => document.querySelector(query).querySelector('.btn-inline:not([hidden])').click(), line('USD'));
  await ev(`document.querySelector('.topbar nav a[href="#/"]').click()`);
  release();
  await quiet();
  check(
    'review: an answer arriving after the screen was left writes nothing',
    rateAsks().length === 1 && writesSent().length === 0 && on(await stored('rate'), DL).length === 0,
    putsAndDeletes().join(' '),
  );

  const DM = ago(49);
  await recordInOutage(DM);
  await r.unwatched(() => rec.call(async (date) => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const dek = (await import('/static/js/session.js')).currentVault().dek;
    for (const record of await api.get('/api/records?type=snapshot')) {
      if ((await c.decryptRecord(dek, record)).date === date) await api.del(`/api/records/${record.recordId}`, { version: record.version });
    }
  }, DM));
  check('review: the other window emptied the date', (await snapshotsAt(DM)).length === 0);
  traffic.length = 0;
  await lookUp('USD');
  check(
    'review: Look it up at a date another window emptied reloads and writes nothing',
    typeReads('snapshot').length === 1 && typeReads('rate').length === 1 && writesSent().length === 0 &&
      on(await stored('rate'), DM).length === 0,
    `${putsAndDeletes().join(' ')} | ${typeReads('snapshot').length} ${typeReads('rate').length}`,
  );
  await reread();
  await home();

  // ---- The same, by Recording detail's Update and by the date picker ----

  const DY = ago(34);
  proxy.mode = 'down';
  await home();
  await newRecording(DY);
  await typeRow('Dollar cash', '300');
  await pressRow('Dollar cash');
  // Criterion 60: a price typed after the first row, saved by the lines'
  // own save, reloads before it writes.
  await typeLine('XAU-ozt', '2400');
  traffic.length = 0;
  await saveLines();
  const ratePut = traffic.findIndex((t) => t.method === 'PUT' && (bodyOf(t) || {}).recordType === 'rate');
  const rateReload = traffic.findIndex((t) => t.method === 'GET' && t.url.endsWith('/api/records?type=rate'));
  check(
    'review 60: a lines save after the first row reloads and then writes the price',
    rateReload >= 0 && ratePut > rateReload &&
      on(await stored('rate'), DY).some((p) => p.payload.symbol === 'XAU-ozt' && p.payload.rate === '2400'),
    JSON.stringify(traffic.map((t) => `${t.method} ${t.url.split('/api/')[1]}`)),
  );
  await home();
  proxy.mode = 'answer';
  traffic.length = 0;
  const marked = await newRecording(DY);
  check('review: the picked recorded date opens its own screen', marked.marked && (await ev('location.hash')) === `#/recording/${DY}`);
  await press('Update', '.form-actions');
  await rec.waitUntil("document.querySelector('.sweep-row')", { label: 'the sweep from Update' });
  await quiet();
  check('review 35: through the picker and Update, the empty line offers Look it up', reopenedWording('USD', await lineState('USD')), JSON.stringify(await lineState('USD')));
  const goldTyped = await lineState('XAU-ozt');
  check('review 35: a line holding a price offers no Look it up', figure(goldTyped.value) === 2400 && !goldTyped.lookup, JSON.stringify(goldTyped));
  check('review 34: neither screen asked the source or wrote', rateAsks().length === 0 && writesSent().length === 0);

  // ---- The same, by the top bar's Update values, from a holding's screen

  proxy.mode = 'down';
  await sweepToday();
  await typeRow('Brokerage', '2600');
  await pressRow('Brokerage');
  check('review: today\'s new sweep in an outage reads the outage wording', outageWording('USD', await lineState('USD')));
  await go(`#/holding/${id.Brokerage}`);
  proxy.mode = 'answer';
  traffic.length = 0;
  await sweepToday();
  check(
    'review 35: by Update values from a holding\'s screen, today\'s empty line offers Look it up, asking nothing',
    (await ev('location.hash')) === `#/sweep/${T}` && reopenedWording('USD', await lineState('USD')) && rateAsks().length === 0,
    JSON.stringify(await lineState('USD')),
  );

  // ---- The return after a lock continues the sitting --------------------

  const DZ = ago(35);
  proxy.mode = 'down';
  await home();
  await newRecording(DZ);
  await typeRow('Brokerage', '2700');
  await pressRow('Brokerage');
  await typeRow('Savings', '5123');
  await ev("document.querySelector('.btn-lock').click()");
  await rec.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
  await enterPasswordOn(rec, RECORDER_PASSWORD);
  await rec.waitUntil("!document.querySelector('#unlock-password') && document.querySelector('.sweep-row')", { timeout: 90000, label: 'the sweep after unlocking' });
  await quiet();
  const afterLock = await lineState('USD');
  check(
    'review: the sweep after a lock is the same sitting, typed figure kept and the outage wording unchanged',
    (await ev('location.hash')) === `#/sweep/${DZ}` && (await rowState('Savings')).field === '5123' && outageWording('USD', afterLock),
    JSON.stringify({ afterLock, savings: await rowState('Savings') }),
  );
  await typeRow('Savings', '');
  proxy.mode = 'answer';
  await home();

  // ---- A date recorded since the last visit opens as reopened -----------

  const DW = ago(36);
  await byAddress(`#/sweep/${DW}`);
  check('review: a free date by its address is a new sweep', (await rowState('Current account')).state === 'Nothing recorded for this date.');
  await home();
  await plantHere([r.snap('Current account', DW, '1111'), r.price('USD', DW, '0.81', 'proposed')]);
  await reread();
  traffic.length = 0;
  await byAddress(`#/sweep/${DW}`);
  const usdStored = await lineState('USD');
  check(
    'review: a date recorded since the last visit opens as a reopened recording, showing what is stored',
    (await rowState('Current account')).state === 'Recorded for this date.' && figure((await rowState('Current account')).field) === 1111 &&
      figure(usdStored.value) === 0.81 && !usdStored.lookup && rateAsks().length === 0,
    JSON.stringify({ usdStored, row: await rowState('Current account') }),
  );
  await home();

  // ---- 25: opening, acting on nothing and leaving writes nothing --------

  const DE = ago(37);
  const DE2 = ago(38);
  traffic.length = 0;
  await byAddress(`#/sweep/${DE}`);
  await home();
  await byAddress(`#/sweep/${D1}`);
  await home();
  await byAddress(`#/sweep/${DE2}`);
  await typeLine('USD', '0.77');
  await home();
  const leftBehind = [...on(await stored('snapshot'), DE2), ...on(await stored('rate'), DE2), ...on(await stored('snapshot'), DE), ...on(await stored('rate'), DE)];
  check(
    'review 25: leaving an empty date, a recording, and an empty date with a typed price writes nothing',
    writesSent().length === 0 && leftBehind.length === 0,
    `${putsAndDeletes().join(' ')} | ${leftBehind.length} records`,
  );

  // ---- 57: a create at a date another session has since recorded --------

  const DF = ago(39);
  await byAddress(`#/sweep/${DF}`);
  const [elsewhere] = await plantHere([r.snap('Savings', DF, '5050')]);
  const beforeRefusal = await everythingAt(DF);
  traffic.length = 0;
  await typeRow('Current account', '1212');
  await pressRow('Current account');
  const refusal = await text();
  const named = [await format('dayMonth', DF), await format('longDate', DF)].some((d) => refusal.includes(`${d} already has a recording.`));
  check(
    'review 57: a fresh create at a date recorded elsewhere reloads, writes nothing, names the date as taken',
    typeReads('snapshot').length >= 1 && writesSent().length === 0 && (await everythingAt(DF)) === beforeRefusal &&
      named && refusal.includes('Another window got there first.'),
    `${putsAndDeletes().join(' ')} | ${refusal.slice(0, 400)}`,
  );
  await press('Open the recording');
  check('review 57: one click opens that recording', (await ev('location.hash')) === `#/recording/${DF}`, await ev('location.hash'));
  check('review 57: the other session\'s record is there', (await snapshotsAt(DF)).map((s) => s.recordId).join() === elsewhere);

  // Inside a reopened recording: Art is silent at the first date until
  // another session records it there.
  await byAddress(`#/sweep/${D1}`);
  await plantHere([r.snap('Art', D1, '2')]);
  const beforeAdd = await everythingAt(D1);
  traffic.length = 0;
  await typeRow('Art', '3');
  await pressRow('Art');
  check(
    'review 57: an add inside a reopened recording whose slot was filled elsewhere reloads and writes nothing',
    typeReads('snapshot').length >= 1 && writesSent().length === 0 && (await everythingAt(D1)) === beforeAdd &&
      (await text()).includes('already has a recording'),
    `${putsAndDeletes().join(' ')} | ${(await text()).slice(0, 300)}`,
  );
  await reread();
  await home();

  // ---- 8 and 67: a figure stored as "12.5" -----------------------------

  const goldAtD1 = () => stored('snapshot').then((all) => bytes(on(all, D1).filter((s) => s.accountId === id['Gold bars'])));
  const goldBytes = await goldAtD1();
  await byAddress(`#/recording/${D1}`);
  await home();
  const DP2 = ago(160);
  await byAddress(`#/sweep/${DP2}`);
  const prefilled = await rowState('Gold bars');
  await typeRow('Gold bars', '13');
  const edited = await rowState('Gold bars');
  await typeRow('Gold bars', '12.5');
  const typedBack = await rowState('Gold bars');
  await typeRow('Gold bars', '12.50');
  const padded = await rowState('Gold bars');
  check(
    'review 67: Confirm on the prefill, Record once edited, Confirm when typed back, Record for 12.50',
    prefilled.field === '12.5' && prefilled.label === 'Confirm' && edited.label === 'Record' &&
      typedBack.label === 'Confirm' && padded.label === 'Record',
    JSON.stringify([prefilled, edited, typedBack, padded].map((s) => `${s.field}:${s.label}`)),
  );
  await pressRow('Gold bars');
  check('review 67: 12.50 typed writes "12.50"', (await snapshotsAt(DP2)).map((s) => s.payload.value).join() === '12.50');
  await home();
  // Between the first date and DP2, so its prefill is still the first date's.
  const DP = ago(170);
  await byAddress(`#/sweep/${DP}`);
  await pressRow('Gold bars');
  check(
    'review 8: displaying, opening and confirming a "12.5" figure leaves its record byte-identical and writes "12.5"',
    (await goldAtD1()) === goldBytes && (await snapshotsAt(DP)).map((s) => s.payload.value).join() === '12.5',
    (await snapshotsAt(DP)).map((s) => s.payload.value).join(),
  );
  await home();

  // ---- 11, 59, 61, 40: a sitting that changes and clears at D2 ---------

  const [currentAtD2] = (await snapshotsAt(D2)).filter((s) => s.accountId === id['Current account']);
  await byAddress(`#/sweep/${D2}`);
  // Another window changes the figure behind this one's model.
  await plantHere([{ ...r.snap('Current account', D2, '1150'), recordId: currentAtD2.recordId, version: currentAtD2.version + 1 }]);
  const planted = bytes((await snapshotsAt(D2)).filter((s) => s.recordId === currentAtD2.recordId));
  traffic.length = 0;
  await typeRow('Current account', '1200');
  await pressRow('Current account');
  const conflicted = await rowState('Current account');
  const putsToIt = traffic.filter((t) => t.method === 'PUT' && t.url.endsWith(currentAtD2.recordId)).length;
  check(
    'review 61: a Conflict reloads the row to the stored figure, retries nothing, and leaves the record as stored',
    conflicted.error === 'This figure was changed in another window.' && figure(conflicted.field) === 1150 && putsToIt === 1 &&
      bytes((await snapshotsAt(D2)).filter((s) => s.recordId === currentAtD2.recordId)) === planted,
    JSON.stringify({ conflicted, putsToIt }),
  );
  const [brokerageAtD2] = (await snapshotsAt(D2)).filter((s) => s.accountId === id.Brokerage);
  traffic.length = 0;
  await typeRow('Brokerage', '2200');
  await pressRow('Brokerage');
  check('review 11: a change inside a reopened recording shows no replace prompt', !(await ev("Boolean(document.querySelector('.dialog'))")));
  const update = traffic.find((t) => t.method === 'PUT' && t.url.endsWith(brokerageAtD2.recordId));
  // Savings has no figure at D2, so its field holds the first date's.
  check('review 40: Savings at D2 is prefilled from an earlier date', figure((await rowState('Savings')).field) === 5000, (await rowState('Savings')).field);
  await typeRow('Savings', '');
  await pressRow('Savings');
  await typeRow('Current account', '');
  await pressRow('Current account');
  const deletes = writesSent().filter((w) => w.method === 'DELETE');
  check(
    'review 59: changes and clears run no type reload, and the change is an update at stored version + 1',
    typeReads('snapshot').length === 0 && typeReads('rate').length === 0 && update && bodyOf(update).version === brokerageAtD2.version + 1,
    JSON.stringify({ reloads: typeReads('snapshot').length + typeReads('rate').length, version: update && bodyOf(update).version }),
  );
  check(
    'review 40: clearing the recorded figure deletes exactly it, and clearing a prefill writes nothing',
    deletes.length === 1 && deletes[0].url.endsWith(currentAtD2.recordId) &&
      writesSent().filter((w) => w.method === 'PUT').length === 1 &&
      !(await snapshotsAt(D2)).some((s) => s.accountId === id.Savings || s.accountId === id['Current account']),
    putsAndDeletes().join(' '),
  );
  await home();

  // ---- 41: clearing every quantity at a date keeps its prices -----------

  const DQ = ago(60);
  const DQ2 = ago(55);
  await plantHere([r.snap('Current account', DQ, '1'), r.price('m2', DQ, '12000'), r.snap('Flat', DQ2, '96')]);
  await reread();
  const flatAt = async (date) => {
    await byAddress(`#/recording/${date}`);
    return rec.call((holding) => [...document.querySelectorAll('.recording .card')[0].querySelectorAll('tbody tr')]
      .find((row) => row.cells[0].textContent === holding).cells[2].textContent, 'Flat');
  };
  const flatBefore = await flatAt(DQ2);
  const pricesAtDQ = bytes(on(await stored('rate'), DQ));
  await byAddress(`#/sweep/${DQ}`);
  await typeRow('Current account', '');
  await pressRow('Current account');
  await home();
  await byAddress(`#/sweep/${DQ}`);
  const m2Back = await lineState('m2');
  const flatAfter = await flatAt(DQ2);
  check(
    'review 41: clearing every figure leaves the prices byte-identical, the recording reopens with them, and they still price later dates',
    (await snapshotsAt(DQ)).length === 0 && bytes(on(await stored('rate'), DQ)) === pricesAtDQ && figure(m2Back.value) === 12000 &&
      flatAfter === flatBefore && flatAfter.endsWith(`priced ${await format('longDate', DQ)}`),
    JSON.stringify({ m2Back, flatBefore, flatAfter }),
  );
  await home();

  // ---- 15, and 34 and 35 on a recording before published prices ---------

  // An active holding with no price is listed in the dashboard's Not priced group.
  const listed = async () => {
    await home();
    return r.group('Not priced');
  };
  const DN = ago(41);
  proxy.mode = 'none';
  await byAddress(`#/sweep/${DN}`);
  await typeRow('Pounds', '700');
  const poundsLive = !(await rowState('Pounds')).disabled;
  await pressRow('Pounds');
  check(
    'review 15: a quantity in a published unit whose lookup came back empty saves, live, once, and is listed not priced',
    poundsLive && (await snapshotsAt(DN)).filter((s) => s.accountId === id.Pounds).length === 1 && (await listed()).includes('Pounds'),
    JSON.stringify({ live: poundsLive, count: (await snapshotsAt(DN)).filter((s) => s.accountId === id.Pounds).length, listed: await listed() }),
  );
  proxy.mode = 'answer';
  await byAddress(`#/sweep/${DN}`);
  await typeRow('Art', '4');
  const artLive = !(await rowState('Art')).disabled;
  await pressRow('Art');
  check(
    'review 15: a quantity in a free-text unit with no price saves, live, once, and is listed not priced',
    artLive && (await snapshotsAt(DN)).filter((s) => s.accountId === id.Art).length === 1 && (await listed()).includes('Art'),
    JSON.stringify({ live: artLive, count: (await snapshotsAt(DN)).filter((s) => s.accountId === id.Art).length, listed: await listed() }),
  );
  const OLD = '2012-06-29';
  await byAddress(`#/sweep/${OLD}`);
  await typeRow('Gold grams', '10');
  const gramsLive = !(await rowState('Gold grams')).disabled;
  await pressRow('Gold grams');
  check(
    'review 15: gold by the gram before its published prices saves, live, once, and is listed not priced',
    gramsLive && (await snapshotsAt(OLD)).filter((s) => s.accountId === id['Gold grams']).length === 1 && (await listed()).includes('Gold grams'),
    JSON.stringify({ live: gramsLive, count: (await snapshotsAt(OLD)).filter((s) => s.accountId === id['Gold grams']).length, listed: await listed() }),
  );
  const atOld = await everythingAt(OLD);
  traffic.length = 0;
  await byAddress(`#/sweep/${OLD}`);
  const grams = await lineState('XAU-g');
  check(
    'review 35: a line dated before its unit\'s published prices offers no Look it up and never reads as an outage',
    !grams.lookup && !grams.says.includes('No market rate came back') && !grams.says.includes('No rate was recorded'),
    JSON.stringify(grams),
  );
  await home();
  await byAddress(`#/recording/${OLD}`);
  await home();
  await byAddress(`#/recording/${D1}`);
  await home();
  check(
    'review 34: opening an old recording, its own screen and its sweep, issues no PUT, DELETE or rate request and changes nothing',
    writesSent().length === 0 && rateAsks().length === 0 && (await everythingAt(OLD)) === atOld,
    `${putsAndDeletes().join(' ')} | ${rateAsks().length} asks`,
  );

  // ---- 85 and 47: an archive's zero ---------------------------------------

  const DA = ago(45);
  const fund = await model(({ v }, at) => ({ version: v.holdings.get(at).version, payload: v.holdings.get(at).payload }), id['Fund 5']);
  await plantHere([
    r.snap('Fund 5', DA, '0'),
    r.snap('Current account', DA, '1'),
    r.price('USD', DA, '0.8', 'proposed'),
    { type: 'account', recordId: id['Fund 5'], version: fund.version + 1, payload: { ...fund.payload, archivedAt: DA } },
  ]);
  await reread();
  await byAddress(`#/sweep/${DA}`);
  const zeroRow = await rec.call((holding) => {
    const row = [...document.querySelectorAll('.sweep-row')].find((n) => n.querySelector('.holding-name').textContent === holding);
    return row && {
      state: row.querySelector('.row-state').textContent,
      // What a person can see or reach: a control the screen hides is none.
      controls: [...row.querySelectorAll('button, input, select, textarea')].filter((n) => n.getClientRects().length && !n.hidden).length,
      text: row.innerText,
    };
  }, 'Fund 5');
  check(
    'review 85: the archive\'s zero shows as text with no control',
    zeroRow && zeroRow.state === 'Archived at zero on this date.' && zeroRow.controls === 0 && /\b0\b/.test(zeroRow.text),
    JSON.stringify(zeroRow),
  );
  await home();
  const zeroBytes = bytes((await snapshotsAt(DA)).filter((s) => s.accountId === id['Fund 5']));
  await byAddress(`#/recording/${DA}`);
  await press('Delete', '.form-actions');
  await press('Delete the recording', '.dialog');
  const left = [...(await snapshotsAt(DA)), ...on(await stored('rate'), DA)];
  await home();
  const stillOpens = await newRecording(DA);
  check(
    'review 47: deleting a recording keeps the archive\'s zero byte-identical, removes the rest, and the date still opens',
    left.length === 1 && bytes(left) === zeroBytes && stillOpens.marked && (await ev('location.hash')) === `#/recording/${DA}`,
    JSON.stringify({ left: left.length, stillOpens }),
  );
  await home();

  // ---- 66: Confirm copies the stored string under moneyPlaces 0 --------

  const DG = ago(22);
  const DH = ago(21);
  const profile = await model(({ v }) => ({ recordId: v.profileRecord.recordId, version: v.profileRecord.version, payload: v.profile }));
  await plantHere([
    { type: 'profile', recordId: profile.recordId, version: profile.version + 1, payload: { ...profile.payload, moneyPlaces: '0' } },
    r.snap('Gold bars', DG, '12.125'),
    r.snap('Brokerage', DG, '1000.40'),
    r.snap('Current account', DG, '1000.40'),
    r.snap('Flat', DG, '95.50'),
  ]);
  await reread();
  await byAddress(`#/sweep/${DH}`);
  for (const name of ['Gold bars', 'Brokerage', 'Current account', 'Flat']) await pressRow(name);
  const confirmed = Object.fromEntries((await snapshotsAt(DH)).map((s) => [s.accountId, s.payload.value]));
  check(
    'review 66: Confirm writes the stored string character for character under moneyPlaces 0',
    confirmed[id['Gold bars']] === '12.125' && confirmed[id.Brokerage] === '1000.40' &&
      confirmed[id['Current account']] === '1000.40' && confirmed[id.Flat] === '95.50',
    JSON.stringify(confirmed),
  );
  await home();
}, { signsIn: false });
