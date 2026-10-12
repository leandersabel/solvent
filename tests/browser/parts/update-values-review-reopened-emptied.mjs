// Reviewer's checks of a recording reopened through Update, then deleted
// by another window before a rate-lines save, written from
// spec/features/record-snapshot.md (Update values, States, "The date was
// emptied while you were working"; Rules) and record-rate.md (criteria
// 32, 37, 43 and 45) alone.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const {
    rec, D1, D2, ago, quiet, proposalsFor, traffic, writesSent, typeReads, rateAsks, bodyOf, unwatched, ev, press, stored, on,
    pressRow, typeRow, rowState, line, lineState, typeLine, figure, home, go, newRecording, plantHere, reread, snap,
  } = r;

  const offersLineSave = () =>
    ev("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save the rate lines' && b.getClientRects().length)");
  const rateBlock = () => ev("[...document.querySelectorAll('.rate-line')].map((l) => l.textContent).join(' | ')");
  const calloutSays = () => ev(`(() => {
    const box = [...document.querySelectorAll('main .callout')].find((c) => c.getClientRects().length);
    return box ? box.textContent.replace(/\\s+/g, ' ').trim() : '';
  })()`);
  const atDate = async (date) => [...on(await stored('snapshot'), date), ...on(await stored('rate'), date)];
  const ratesAt = async (date) => Object.fromEntries(on(await stored('rate'), date).map((p) => [p.payload.symbol, p.payload]));
  const emptyElsewhere = async (date) => {
    const ids = (await atDate(date)).map((x) => x.recordId);
    await unwatched(() => rec.call(async (gone) => {
      const api = await import('/static/js/api.js');
      for (const recordId of gone) await api.del('/api/records/' + recordId);
    }, ids));
    return ids.length;
  };
  const saveLines = async () => {
    traffic.length = 0;
    await press('Save the rate lines');
    await quiet();
    if (await ev("Boolean(document.querySelector('.dialog'))")) await press('Save the prices', '.dialog');
    await quiet();
  };
  // Recording detail, then its Update, as the person reopens a recording.
  const reopen = async (date) => {
    await go(`#/recording/${date}`);
    await press('Update', '.form-actions');
    await rec.waitUntil((query) => Boolean(document.querySelector(query)), { args: [line('USD')], label: 'the rate lines' });
    await quiet();
  };
  const editedFrom = (chip, proposal) => chip.startsWith('Edited from') && figure(chip) === Number(proposal);
  // Every request to the rate proxy, as sent, holds no typed figure.
  const asksCarry = (typed) =>
    rateAsks().filter((a) => [a.url, JSON.stringify(a.headers), a.body].some((part) => part.includes(typed)));

  // ---- 45 and 37: a proposal typed over on a reopened recording ---------

  const E = ago(60);
  const proposal = proposalsFor(E)['XAU-ozt'];
  await home();
  await newRecording(E);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '',
    { args: [line('XAU-ozt')], label: 'the proposals' });
  await typeRow('Current account', '1200');
  await pressRow('Current account');
  const made = await ratesAt(E);
  check(
    'review rate 45: the first sitting recorded the proposals at the date',
    made['XAU-ozt']?.rateSource === 'proposed' && made['XAU-ozt'].rate === proposal.rate && made.USD?.rateSource === 'proposed',
    JSON.stringify(made),
  );

  await home();
  await reopen(E);
  await typeLine('XAU-ozt', '2777');
  const before = await lineState('XAU-ozt');
  check(
    'review rate 45: on the reopened recording a price typed over the proposal reads Edited from it',
    editedFrom(before.chip, proposal.rate),
    JSON.stringify(before),
  );
  check(
    'review rate 45: another window deleted every record at the date',
    (await emptyElsewhere(E)) === 3,
  );
  await saveLines();
  const sent = writesSent();
  const reloaded = typeReads('snapshot').length + typeReads('rate').length > 0;
  const after = await lineState('XAU-ozt');
  const block = await rateBlock();
  check(
    'review rate 43: the save changing a stored price on the emptied recording reloads, sends no DELETE, and the date holds nothing',
    reloaded && !sent.some((w) => w.method === 'DELETE') && (await atDate(E)).length === 0,
    JSON.stringify({ reloaded, sent: sent.map((w) => `${w.method} ${w.url}`) }),
  );
  check(
    'review snapshot: the Callout says another window deleted the recording',
    (await calloutSays()).includes('Another window deleted the recording for'),
    await calloutSays(),
  );
  check(
    'review rate 45: after the save the typed line keeps the price and still reads Edited from the proposal',
    figure(after.value) === 2777 && editedFrom(after.chip, proposal.rate),
    JSON.stringify(after),
  );
  check('review rate 45: the typed line offers no Look it up', !after.lookup, JSON.stringify(after));
  check('review rate 45: no rate line says no rate was recorded', !/No rate was recorded/.test(block), block);
  check(
    'review rate 45: no rate line offers Look it up on the emptied date',
    !(await ev("[...document.querySelectorAll('.rate-line .btn-inline')].some((b) => !b.hidden && b.getClientRects().length)")),
    block,
  );
  check(
    'review snapshot: the untouched USD line reads as on a date holding nothing, with its proposal',
    figure((await lineState('USD')).value) === Number(proposalsFor(E).USD.rate) && (await lineState('USD')).chip.startsWith('Market rate'),
    JSON.stringify(await lineState('USD')),
  );
  check(
    'review snapshot: the emptied date offers no rate-lines save and its rows read as nothing recorded',
    !(await offersLineSave()) && (await rowState('Current account')).state.includes('Nothing recorded'),
    JSON.stringify(await rowState('Current account')),
  );
  check('review snapshot rules: no price request carries the typed price', asksCarry('2777').length === 0);

  traffic.length = 0;
  await typeRow('Savings', '5100');
  await pressRow('Savings');
  const next = await ratesAt(E);
  const order = writesSent().map((w) => (bodyOf(w) || {}).recordType);
  check(
    'review rate 45 and 37: recording the next row stores the typed price as edited, the proposal as proposedRate, its rateAsOf kept',
    order[0] === 'snapshot' && next['XAU-ozt']?.rate === '2777' && next['XAU-ozt'].rateSource === 'edited' &&
      next['XAU-ozt'].proposedRate === proposal.rate && next['XAU-ozt'].rateAsOf === proposal.asOf,
    JSON.stringify({ order, xau: next['XAU-ozt'] }),
  );
  check(
    'review rate 43: the untouched proposal is written at the date as proposed',
    next.USD?.rateSource === 'proposed' && next.USD.rate === proposalsFor(E).USD.rate,
    JSON.stringify(next.USD),
  );
  check(
    'review rate 45: once recorded, the line still reads Edited from the proposal',
    editedFrom((await lineState('XAU-ozt')).chip, proposal.rate),
    JSON.stringify(await lineState('XAU-ozt')),
  );
  check('review snapshot rules: recording the row asked the proxy nothing with the typed price', asksCarry('2777').length === 0);

  // ---- A line that went in empty, on a reopened recording deleted elsewhere

  // D2 holds a USD proposal and no gold price, so its gold line reopens
  // saying no rate was recorded, with Look it up.
  await home();
  await reopen(D2);
  const emptyBefore = await lineState('XAU-ozt');
  check(
    'review: the reopened recording offers Look it up on the line that went in empty',
    emptyBefore.lookup && /No rate was recorded/.test(emptyBefore.says),
    JSON.stringify(emptyBefore),
  );
  await typeLine('USD', '0.97');
  await emptyElsewhere(D2);
  await saveLines();
  const gold = await lineState('XAU-ozt');
  const usd = await lineState('USD');
  const block2 = await rateBlock();
  check(
    'review rate 43: the save changing a stored price on the deleted recording writes nothing and keeps the typed price',
    (await atDate(D2)).length === 0 && figure(usd.value) === 0.97 && usd.chip.startsWith('Edited from'),
    JSON.stringify({ usd, sent: writesSent().map((w) => w.method) }),
  );
  check(
    'review snapshot: the line that went in empty no longer says no rate was recorded, offers no Look it up and holds the date\'s proposal',
    !/No rate was recorded/.test(block2) && !gold.lookup && figure(gold.value) === Number(proposalsFor(D2)['XAU-ozt'].rate),
    JSON.stringify({ gold, block2 }),
  );
  check('review snapshot rules: no price request carries the typed USD price', asksCarry('0.97').length === 0);

  traffic.length = 0;
  await typeRow('Savings', '5200');
  await pressRow('Savings');
  const d2 = await ratesAt(D2);
  check(
    'review rate 43: recording the next row writes the typed price as edited and the gold proposal as proposed',
    d2.USD?.rate === '0.97' && d2.USD.rateSource === 'edited' && d2['XAU-ozt']?.rateSource === 'proposed' &&
      d2['XAU-ozt'].rate === proposalsFor(D2)['XAU-ozt'].rate,
    JSON.stringify(d2),
  );

  // ---- 32: a save that creates a price on a reopened recording deleted elsewhere

  // D1 holds no dollar price, so its USD line reopens empty with Look it up.
  await home();
  await reopen(D1);
  await typeLine('USD', '0.96');
  await emptyElsewhere(D1);
  await saveLines();
  const created = writesSent();
  const usd1 = await lineState('USD');
  const block3 = await rateBlock();
  check(
    'review rate 32: a creating save on the deleted reopened recording reloads, sends no PUT or DELETE, and the date holds nothing',
    typeReads('snapshot').length + typeReads('rate').length > 0 && created.length === 0 && (await atDate(D1)).length === 0,
    JSON.stringify(created.map((w) => `${w.method} ${w.url}`)),
  );
  check(
    'review rate 32: the typed price stays, no rate-lines save shows, no line says no rate was recorded, and the Callout shows',
    figure(usd1.value) === 0.96 && !(await offersLineSave()) && !/No rate was recorded/.test(block3) &&
      (await calloutSays()).includes('Another window deleted the recording for'),
    JSON.stringify({ usd1, block3, callout: await calloutSays() }),
  );
  check('review snapshot rules: no price request carries the typed price on the creating save', asksCarry('0.96').length === 0);
  await typeRow('Savings', '5300');
  await pressRow('Savings');
  check('review rate 32: recording the first row then writes the typed price', (await ratesAt(D1)).USD?.rate === '0.96',
    JSON.stringify(await ratesAt(D1)));

  // ---- Look it up on a reopened recording deleted elsewhere --------------

  const H = ago(65);
  await plantHere([snap('Current account', H, '1000')]);
  await reread();
  await home();
  await reopen(H);
  await emptyElsewhere(H);
  traffic.length = 0;
  await rec.call((query) => document.querySelector(query).querySelector('.btn-inline').click(), line('USD'));
  await quiet();
  const looked = await lineState('USD');
  const block4 = await rateBlock();
  check(
    'review: Look it up on a deleted reopened recording writes nothing and shows the Callout',
    writesSent().length === 0 && (await atDate(H)).length === 0 && (await calloutSays()).includes('Another window deleted the recording for'),
    JSON.stringify({ sent: writesSent().map((w) => w.method), callout: await calloutSays() }),
  );
  check(
    'review snapshot: after it the lines read as on a date holding nothing, the dollar line holding its proposal as a market rate',
    !/No rate was recorded/.test(block4) && figure(looked.value) === Number(proposalsFor(H).USD.rate) &&
      looked.chip.startsWith('Market rate') && !looked.lookup,
    JSON.stringify({ looked, block4 }),
  );
  traffic.length = 0;
  await typeRow('Savings', '5400');
  await pressRow('Savings');
  const h = await ratesAt(H);
  check(
    'review rate 43: recording the next row writes the proposals at the date as proposed',
    h.USD?.rateSource === 'proposed' && h.USD.rate === proposalsFor(H).USD.rate && h['XAU-ozt']?.rateSource === 'proposed',
    JSON.stringify(h),
  );
}, { signsIn: false });
