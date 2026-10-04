// Update values, the sweep (spec/ui/update-values.md): one date, every
// holding on one screen, with the rate lines beneath it, for a recording
// being made and one being reopened.
// Templates: dashboard.html. Modules: view-sweep.js, writes.js, model.js,
// api.js, decimal.js, format.js, datepicker.js.
import {
  BASE, HOLDINGS, VAULT_PASSWORD, check, enterPassword, holdings, labels, page, proxyAsks, run, vaultOwner,
} from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  await vaultOwner();
  await holdings(HOLDINGS);

  check('the vault store backs the top bar', await page.eval("Boolean(window.Alpine && Alpine.store('vault'))"));
  const asksBeforeSweep = proxyAsks.length;
  await page.eval("document.querySelector('.topbar-actions button').click()");
  await page.waitUntil("location.hash.startsWith('#/sweep/') && document.querySelector('.sweep-row')", { label: 'the sweep' });
  await page.idle();

  check('one row per active holding', (await page.eval("document.querySelectorAll('.sweep-row').length")) === 4);
  check(
    'every row states whether this date holds a figure',
    (await labels('.row-state')).every((state) => state === 'Nothing recorded for this date.'),
  );
  const rateUnits = await page.eval("[...document.querySelectorAll('.rate-line')].map(n => n.dataset.unit)");
  check('one rate line per unit that needs one', rateUnits.join(',') === 'USD,XAU-ozt', rateUnits.join(','));
  check('the main currency has no rate line', !rateUnits.includes('CHF'));
  check(
    'a never-valued row offers no Confirm',
    (await labels('.sweep-row button')).every((label) => label !== 'Confirm'),
  );

  const recordRow = async (index, value) => {
    await page.call((at, next) => {
      const row = document.querySelectorAll('.sweep-row')[at];
      const field = row.querySelector('input');
      field.value = next;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      row.querySelector('button').click();
    }, index, value);
    await page.idle();
  };
  await recordRow(0, '12450.00');
  await recordRow(1, '8300.50');
  await recordRow(2, '12.125');
  await recordRow(3, '-410000.00');

  check(
    'every recorded row says so',
    (await labels('.row-state')).every((state) => state === 'Recorded for this date.'),
  );
  // A date has no hour, so a figure recorded now is "Today" at any hour.
  check(
    'a row recorded for today is aged "Today."',
    (await labels('.row-age')).every((age) => age === 'Today.'),
    (await labels('.row-age')).join(','),
  );
  const rateValues = await page.eval("[...document.querySelectorAll('.rate-line input')].map(n => n.value)");
  check('the prices went in with the first row', rateValues.every(Boolean), rateValues.join(','));
  const tabular = (selector) => page.eval(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    return nodes.length > 0 && nodes.every((n) => getComputedStyle(n).fontVariantNumeric === 'tabular-nums');
  })()`);
  check('the value fields have tabular digits', await tabular('.sweep-row input'));
  check('the converted lines have tabular digits', await tabular('.sweep-input .hint'));
  check('the rate fields have tabular digits', await tabular('.rate-line input'));
  const rateCalls = () => proxyAsks.length - asksBeforeSweep;
  const requests = rateCalls();
  check('a four-row sweep asks the proxy once', requests === 1, `issued ${requests}`);
  const rateNames = await labels('.rate-unit');
  check('a rate line is headed by the unit\'s name', rateNames.join(',') === 'United States Dollar,Gold', rateNames.join(','));

  await page.eval(`document.querySelector('.topbar nav a[href="#/"]').click()`);
  await page.waitUntil("document.querySelector('.hero-figure')", { label: 'the dashboard' });

  // ---- Reopening a recording -------------------------------------------

  await page.goto(`${BASE}/dashboard`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard again' });
  await page.idle();
  await page.eval("document.querySelector('.topbar-actions button').click()");
  await page.waitUntil("location.hash.startsWith('#/sweep/') && document.querySelector('.sweep-row')", { label: 'the sweep again' });
  await page.idle();
  check(
    'a reopened recording says every row is already recorded',
    (await labels('.row-state')).filter((s) => s === 'Recorded for this date.').length === 4,
  );

  check('the sweep heading is the date, not a control', (await page.eval("document.querySelectorAll('.screen-heading input').length")) === 0);

  await page.eval(`document.querySelector('.topbar nav a[href="#/"]').click()`);
  await page.waitUntil("document.querySelector('.hero-figure')", { label: 'the dashboard' });

  // ---- The sweep, in a vault of its own ------------------------------

  const r = await startRecorder();
  await r.register();
  const {
    rec, accountIds, T, ago, D1, D2, D5, D6, D7, D8,
    D9, D10, proxy, holdRates, proposalsFor, traffic, faults, writesSent,
    rateAsks, typeReads, bodyOf, ev, text, quiet, set, press,
    stored, on, bytes, plantHere, reread, go, format, model,
    typeRow, clickRow, pressRow, rowState, line, lineState, typeLine, figure,
    tableRow, group, hero, home, newRecording, sweepToday, script, id,
    snap, price, layout, viewport,
  } = r;

  await go(`#/sweep/${T}`);
  const bare = await text();
  await press('Add a holding', '.sweep');
  check(
    'record-snapshot: a sweep with no holdings says to add one first, offers the form, and shows no rates',
    bare.includes('Add a holding first.') && !bare.includes('Rates for this date') &&
      (await ev("document.querySelector('.dialog-heading').textContent")) === 'Add a holding',
  );
  await rec.key('Escape');
  await rec.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

  await r.seed();

  // ---- record-rate: a new sweep, and the franc holding it exists for ----

  const before = { brokerage: await tableRow('Brokerage'), gold: await tableRow('Gold bars') };
  const counts = () => model(({ v }, ...ids) => ids.map(a => v.snapshotsFor(a).length), id.Brokerage, id['Gold bars']);
  const snapshotCounts = await counts();
  traffic.length = 0;
  await sweepToday();
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals on arrival' });
  await quiet();
  const usd = await lineState('USD');
  const gold = await lineState('XAU-ozt');
  check(
    'record-rate: a sweep at a date holding nothing arrives with its rate lines filled in by that date\'s proposals',
    figure(usd.value) === Number(proposalsFor(T).USD.rate) && figure(gold.value) === Number(proposalsFor(T)['XAU-ozt'].rate) &&
      usd.chip === 'Market rate',
    JSON.stringify({ usd, gold }),
  );
  check('record-rate: a proposal for an earlier day says which day it is for', gold.chip.startsWith('Market rate as of '), gold.chip);
  check(
    'record-rate: arriving at a new sweep writes nothing and asks the proxy once',
    writesSent().length === 0 && rateAsks().length === 1,
    `${writesSent().length} writes, ${rateAsks().length} asks`,
  );
  const silver = await lineState('XAG-ozt');
  check(
    'record-rate: a symbol with no provider shows its last figure, its age, and whose it is to set',
    figure(silver.value) === 25 && silver.says.startsWith('Estimated ') && silver.says.includes('No market price for silver yet. This one is yours to set.'),
    JSON.stringify(silver),
  );
  const silverConverted = await ev("[...document.querySelectorAll('.sweep-row')].find(r => r.querySelector('.holding-name').textContent === 'Silver coins').querySelector('.sweep-input .hint').textContent");
  check(
    'record-rate: a sweep row valued at the estimate carried from an earlier day dates it beneath the figure',
    silverConverted.endsWith(`priced ${await format('longDate', D1)}`),
    silverConverted,
  );
  const flat = await lineState('m2');
  check('record-rate: a free-text unit says nobody publishes a price for it', flat.says.includes('Nobody publishes a price for m2'), flat.says);
  await typeRow('Art', '3');
  const head = await ev("document.querySelector('.rate-line').dataset.unit");
  const asked = await lineState('PAINT');
  check(
    'record-rate: a unit with no price at all, being recorded, moves to the head of the block and asks for one',
    head === 'PAINT' && asked.says.startsWith('What is 1 PAINT worth in CHF?'),
    `${head}: ${asked.says}`,
  );
  // The asked line joins the grid: inside the card's border, with its
  // field in line with the others'.
  await rec.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await rec.frames();
  const askedBox = JSON.parse(await rec.call((query) => JSON.stringify((() => {
    const l = document.querySelector(query);
    const card = l.parentElement.getBoundingClientRect();
    const r = l.getBoundingClientRect();
    const lefts = [...document.querySelectorAll('.rate-line input')].map((i) => Math.round(i.getBoundingClientRect().left));
    return {
      inGrid: l.parentElement.classList.contains('rate-block'),
      inside: r.left >= card.left && r.right <= card.right,
      lefts,
      width: Math.round(l.querySelector('input').getBoundingClientRect().width),
    };
  })()), line('PAINT')));
  await rec.send('Emulation.clearDeviceMetricsOverride');
  check(
    'record-rate: the line asking for a price sits inside the block, its field in line with the others and in the field column',
    askedBox.inGrid && askedBox.inside && new Set(askedBox.lefts).size === 1 && askedBox.width <= 260,
    JSON.stringify(askedBox),
  );
  check('record-snapshot: the row stays live while its unit has no price', (await rowState('Art')).disabled === false);
  await typeRow('Art', '');
  await typeRow('Current account', '1234.56');
  await pressRow('Current account');
  const savedRow = await rowState('Current account');
  check(
    'record-snapshot: a saved row stays, says so quietly, and reads as recorded',
    savedRow.saved === 'Saved.' && savedRow.state === 'Recorded for this date.',
  );
  const today = on(await stored('rate'), T).map((r) => r.payload);
  check(
    'record-rate: recording one franc figure writes an entry for every other active unit at the date, and none for francs',
    today.map((p) => p.symbol).sort().join(',') === 'USD,XAU-ozt',
    today.map((p) => p.symbol).join(','),
  );
  check(
    'record-rate: every entry is in the main currency and says it was proposed',
    today.every((p) => p.rateTarget === 'CHF' && p.rateSource === 'proposed' && p.proposedRate === null),
    JSON.stringify(today),
  );
  const firstPut = traffic.findIndex((r) => r.method === 'PUT');
  const reloads = traffic.map((r, i) => (r.url.includes('/api/records?type=') ? i : -1)).filter((i) => i >= 0);
  check(
    'record-snapshot: the first create at a date reloads both types first',
    reloads.length === 2 && reloads.every((i) => i < firstPut),
    JSON.stringify(traffic.map((r) => `${r.method} ${r.url.split('/api/')[1]}`)),
  );
  await home();
  const after = { brokerage: await tableRow('Brokerage'), gold: await tableRow('Gold bars') };
  check(
    'net-worth-view: recording one franc holding reprices every dollar and gold holding, none of them gaining a figure',
    after.brokerage.converted !== before.brokerage.converted && after.gold.converted !== before.gold.converted &&
      JSON.stringify(await counts()) === JSON.stringify(snapshotCounts),
    JSON.stringify({ before, after }),
  );

  // ---- record-rate: fifteen rows at one past date -------------------------

  traffic.length = 0;
  const releaseRates = holdRates();
  const emptyDay = await newRecording(D10, { wait: false });
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('.skeleton:not([hidden])'); }, { args: [line('USD')], label: 'the rate lines to wait for their proposals' });
  const resolving = await rec.call((query) => ({
    skeleton: Boolean(document.querySelector(query).querySelector('.skeleton:not([hidden])')),
    usable: [...document.querySelectorAll('.sweep-row input')].every(i => !i.disabled),
  }), line('USD'));
  releaseRates();
  await quiet();
  check(
    'record-rate: while the proposals resolve the rate lines show a skeleton and every value field stays usable',
    resolving.skeleton && resolving.usable,
    JSON.stringify(resolving),
  );
  check(
    'record-snapshot: a date holding nothing is unmarked in the picker and is started as a recording',
    !emptyDay.marked && !emptyDay.dotted && emptyDay.name === null && (await ev('location.hash')) === `#/sweep/${D10}`,
    JSON.stringify(emptyDay),
  );
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals for the backdate' });
  check('record-snapshot: the sweep carries a row for each of the fifteen holdings', (await ev("document.querySelectorAll('.sweep-row').length")) === 15);
  await typeLine('XAU-ozt', '2711.13');
  const flipped = await lineState('XAU-ozt');
  check(
    'record-rate: editing a proposed line flips its provenance the moment it changes',
    flipped.chip === `Edited from ${proposalsFor(D10)['XAU-ozt'].rate}`,
    flipped.chip,
  );
  // A row prefilled from "12.5" offers Confirm, Record once edited and
  // Confirm again when the prefill is typed back, and 12.50 typed over
  // it is an edit, compared as strings.
  const goldCycle = [];
  for (const typed of [null, '12.50', '12.5']) {
    if (typed !== null) await typeRow('Gold bars', typed);
    const state = await rowState('Gold bars');
    goldCycle.push(`${state.field}:${state.label}`);
  }
  check(
    'record-snapshot: a row prefilled from "12.5" offers Confirm, Record once edited and Confirm again when the prefill is typed back',
    goldCycle.join(',') === '12.5:Confirm,12.50:Record,12.5:Confirm',
    goldCycle.join(','),
  );
  const confirmLabels = [];
  for (const name of ['Current account', 'Savings', 'Brokerage', 'Gold bars', 'Silver coins', 'Flat', 'Mortgage', 'Fund 1', 'Fund 2', 'Fund 3', 'Fund 4', script]) {
    confirmLabels.push((await rowState(name)).label);
    await pressRow(name);
  }
  await typeRow('Dollar cash', '350.77');
  await pressRow('Dollar cash');
  await typeRow('Art', '3');
  await pressRow('Art');
  check('record-snapshot: every untouched row with a figure offers Confirm', confirmLabels.every((l) => l === 'Confirm'), confirmLabels.join(','));
  const firstWrite = traffic.findIndex((r) => r.method === 'PUT');
  check(
    'record-snapshot: a fifteen-row sweep reloads each type once, before its first write, and never after',
    typeReads('snapshot').length === 1 && typeReads('rate').length === 1 &&
      traffic.findIndex((r) => r.url.endsWith('type=rate')) < firstWrite,
    `${typeReads('snapshot').length} and ${typeReads('rate').length}`,
  );
  check('record-rate: a fifteen-row sweep asks the proxy exactly once', rateAsks().length === 1, `${rateAsks().length} asks`);
  const rates = await stored('rate');
  const atBackdate = on(rates, D10).map((r) => r.payload);
  check(
    'record-rate: the sweep writes one set of prices, at its own date',
    atBackdate.map((p) => p.symbol).sort().join(',') === 'USD,XAU-ozt',
    atBackdate.map((p) => `${p.symbol}@${p.date}`).join(','),
  );
  const edited = atBackdate.find((p) => p.symbol === 'XAU-ozt');
  check(
    'record-rate: a proposal changed before the first row is written as edited, keeping the offer and its date',
    edited.rate === '2711.13' && edited.rateSource === 'edited' && edited.proposedRate === proposalsFor(D10)['XAU-ozt'].rate &&
      edited.rateAsOf === proposalsFor(D10)['XAU-ozt'].asOf,
    JSON.stringify(edited),
  );
  const latestUsd = await model(({ v }) => v.latestPrice('USD').date);
  check('record-rate: a backdated recording leaves the later entry the latest', latestUsd === T, latestUsd);
  check(
    'record-rate: a free-text unit and a lookup-off symbol get no entry from a recording',
    !atBackdate.some((p) => p.symbol === 'm2' || p.symbol === 'XAG-ozt' || p.symbol === 'PAINT'),
  );
  const snapshots = await stored('snapshot');
  const valueAt = (name, date) => (on(snapshots, date).find((s) => s.accountId === id[name]) || { payload: {} }).payload.value;
  check(
    'record-snapshot: Confirm writes the carried figure exactly, for francs, dollars and a unit with no source alike',
    valueAt('Current account', D10) === '1100' && valueAt('Brokerage', D10) === '2100' && valueAt('Silver coins', D10) === '100.10',
    ['Current account', 'Brokerage', 'Silver coins'].map((n) => valueAt(n, D10)).join(','),
  );
  check('record-snapshot: a figure in a unit nobody prices saves anyway', valueAt('Art', D10) === '3');
  check('record-snapshot: Confirm writes the stored string character for character', valueAt('Gold bars', D10) === '12.5', valueAt('Gold bars', D10));
  const leaks = ['1234.56', '350.77', '2711.13', ...accountIds];
  const encoded = leaks.flatMap((s) => [s, Buffer.from(s).toString('base64')]);
  const asks = rateAsks().concat(traffic.filter((r) => r.url.includes('/api/rates')));
  check(
    'record-rate: no rate request carries a typed rate, a figure or a holding, in its address or its headers',
    asks.every((r) => {
      const keys = [...new URL(r.url).searchParams.keys()].sort().join(',');
      const whole = r.url + JSON.stringify(r.headers) + r.body;
      return keys === 'date,quote' && !encoded.some((s) => whole.includes(s));
    }),
    asks.map((r) => r.url).join(' | '),
  );
  check(
    'record-snapshot: no request during the sweep carries a typed figure, in any field or encoding',
    traffic.every((r) => {
      const whole = r.url + JSON.stringify(r.headers) + r.body;
      return !['350.77', 'MzUwLjc3', '1234.56'].some((s) => whole.includes(s));
    }),
  );
  await home();
  check('record-snapshot: a figure in a unit nobody prices is listed as not priced', (await group('Not priced')).includes('Art'));
  const silverRow = await tableRow('Silver coins');
  check(
    'record-rate: a price only its owner sets keeps its own date on screen after a recording',
    silverRow.converted.endsWith(`priced ${await format('longDate', D1)}`) && !silverRow.asOf.includes('priced'),
    `${silverRow.converted} | ${silverRow.asOf}`,
  );
  const fund5 = await tableRow('Fund 5');
  check(
    'net-worth-view: a holding last valued long ago shows its date, counts in the total, and carries no warning',
    fund5 && fund5.asOf === await format('longDate', D1) && !/stale|warning|old/i.test(fund5.text),
    JSON.stringify(fund5),
  );

  // ---- record-snapshot: reopening a recording ---------------------------

  const secondBefore = { snapshot: on(await stored('snapshot'), D2), rate: on(await stored('rate'), D2) };
  traffic.length = 0;
  await go(`#/recording/${D2}`);
  check('record-snapshot: a recording offers no way to change its own date', (await ev("document.querySelectorAll('.screen input').length")) === 0);
  await press('Update');
  await rec.waitUntil("document.querySelector('.sweep-row')", { label: 'the sweep' });
  await quiet();
  check(
    'record-snapshot: opening a recording and its sweep sends no write and no rate request, and leaves every record byte-identical',
    writesSent().length === 0 && rateAsks().length === 0 &&
      bytes(on(await stored('snapshot'), D2)) === bytes(secondBefore.snapshot) && bytes(on(await stored('rate'), D2)) === bytes(secondBefore.rate),
    traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
  );
  const goldGap = await lineState('XAU-ozt');
  check(
    'record-rate: a line that went in empty says so and carries its own Look it up',
    goldGap.value === '' && goldGap.says === 'No rate was recorded for XAU-ozt on this date.' && goldGap.lookup,
    JSON.stringify(goldGap),
  );
  const held = await lineState('USD');
  const unsourced = [await lineState('XAG-ozt'), await lineState('m2'), await lineState('PAINT')];
  check(
    'record-rate: Look it up is offered on no line that holds an entry, nor on one whose symbol has no rate source',
    held.value !== '' && !held.lookup && unsourced.every((l) => l && !l.lookup),
    JSON.stringify({ held, unsourced }),
  );
  const asksBefore = rateAsks().length;
  await rec.call((query) => document.querySelector(query).querySelector('.btn-inline').click(), line('XAU-ozt'));
  await quiet();
  const goldAsked = await lineState('XAU-ozt');
  check(
    'record-rate: Look it up shows the answer as a proposal with its day, asks once for the reopened date, and writes nothing',
    rateAsks().length === asksBefore + 1 && new URL(rateAsks().at(-1).url).searchParams.get('date') === D2 && writesSent().length === 0 &&
      figure(goldAsked.value) === Number(proposalsFor(D2)['XAU-ozt'].rate) && goldAsked.chip === `Market rate as of ${await format('dayMonth', proposalsFor(D2)['XAU-ozt'].asOf, 'short')}`,
    JSON.stringify({ goldAsked, url: rateAsks().at(-1).url, writes: writesSent().length }),
  );

  traffic.length = 0;
  await typeRow('Current account', '1111');
  const saveLabel = (await rowState('Current account')).label;
  await pressRow('Current account');
  const change = writesSent();
  const storedCurrent = secondBefore.snapshot.find((s) => s.accountId === id['Current account']);
  check(
    'record-snapshot: changing a figure in a reopened recording is an update at the stored version plus one, with no reload and no prompt',
    saveLabel === 'Save' && change.length === 1 && bodyOf(change[0]).version === storedCurrent.version + 1 &&
      change[0].url.endsWith(storedCurrent.recordId) && typeReads('snapshot').length + typeReads('rate').length === 0 &&
      !(await ev("Boolean(document.querySelector('.dialog'))")),
    JSON.stringify(traffic.map((r) => `${r.method} ${r.url}`)),
  );
  check('record-rate: changing a figure asks the proxy nothing and writes no price', rateAsks().length === 0 && change.every((r) => bodyOf(r).recordType === 'snapshot'));

  const usdAtSecond = bytes(on(await stored('rate'), D2));
  const currentAtSecond = bytes(on(await stored('snapshot'), D2));
  traffic.length = 0;
  await typeRow('Dollar cash', '333');
  await pressRow('Dollar cash');
  const created = writesSent().filter((r) => bodyOf(r).recordType === 'snapshot');
  const secondRates = on(await stored('rate'), D2);
  check(
    'record-snapshot: adding a figure for a holding silent at a reopened date creates one snapshot at version 1, after one reload',
    created.length === 1 && bodyOf(created[0]).version === 1 && typeReads('snapshot').length === 1 && typeReads('rate').length === 1 &&
      currentAtSecond === bytes(on(await stored('snapshot'), D2).filter((s) => s.accountId !== id['Dollar cash'])),
  );
  check(
    'record-rate: adding a skipped figure leaves the date\'s prices byte-identical and fills only the symbol it lacked',
    bytes(secondRates.filter((r) => r.payload.symbol === 'USD')) === usdAtSecond &&
      secondRates.filter((r) => r.payload.symbol === 'XAU-ozt').length === 1 && rateAsks().length === 1,
    secondRates.map((r) => r.payload.symbol).join(','),
  );

  const usdFigures = () =>
    model(({ v, decimal }, day) => v.recording(day).figures.filter(f => f.holding.payload.unit === 'USD')
      .map(f => decimal.format(decimal.multiply(decimal.parse(f.snapshot.payload.value), v.priceOn('USD', day).rate))), D2);
  const usdBefore = await usdFigures();
  await typeLine('USD', '0.93');
  check('record-rate: editing a stored proposal flips its chip to the figure it replaced', (await lineState('USD')).chip === 'Edited from 0.92');
  await press('Save the rate lines');
  const confirmation = await ev("document.querySelector('.dialog').textContent");
  await press('Save the prices', '.dialog');
  const usdEdited = on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD').payload;
  const usdAfter = await usdFigures();
  check(
    'record-rate: a changed rate names how many holdings it moves, and moves every one measured in it at that date',
    confirmation.includes('moves 2 holdings measured in USD') && usdAfter.length === 2 && usdAfter.every((f, i) => f !== usdBefore[i]),
    `${confirmation} ${usdBefore} -> ${usdAfter}`,
  );
  check(
    'record-rate: editing a proposed entry stores edited, keeps its date, and keeps the replaced figure',
    usdEdited.rate === '0.93' && usdEdited.rateSource === 'edited' && usdEdited.proposedRate === '0.92' && usdEdited.rateAsOf === D2,
    JSON.stringify(usdEdited),
  );
  await typeLine('USD', '0.94');
  await press('Save the rate lines');
  await press('Save the prices', '.dialog');
  const usdTwice = on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD').payload;
  check('record-rate: editing an edited entry again keeps the original proposal', usdTwice.rate === '0.94' && usdTwice.proposedRate === '0.92', JSON.stringify(usdTwice));

  traffic.length = 0;
  await typeLine('USD', '0.1234567890123');
  const tooFine = await lineState('USD');
  await press('Save the rate lines');
  check(
    'record-rate: a rate with more than twelve decimal places is refused at input rather than truncated',
    tooFine.error.includes('at most twelve decimal places') && !(await ev("Boolean(document.querySelector('.dialog'))")) && writesSent().length === 0,
    JSON.stringify(tooFine),
  );
  await typeLine('USD', '0.123456789012');
  await press('Save the rate lines');
  await press('Save the prices', '.dialog');
  check(
    'record-rate: a rate round-trips as the exact decimal string typed',
    on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD').payload.rate === '0.123456789012',
  );

  // Another window changes the dollar price and the current account
  // behind this one.
  const usdEntry = on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD');
  await plantHere([{ type: 'rate', recordId: usdEntry.recordId, version: usdEntry.version + 1, payload: { ...usdEntry.payload, rate: '0.97' } }]);
  const usdPlanted = bytes(on(await stored('rate'), D2).filter((r) => r.payload.symbol === 'USD'));
  traffic.length = 0;
  await typeLine('USD', '0.95');
  await press('Save the rate lines');
  await press('Save the prices', '.dialog');
  const conflicted = await lineState('USD');
  const conflictSaid = await ev("document.querySelector('.sweep .banner').textContent");
  check(
    'record-rate: a Conflict on a rate is not retried, the line reloads to the stored entry, and the message names the symbol',
    writesSent().length === 1 && figure(conflicted.value) === 0.97 && conflictSaid.includes('USD') &&
      bytes(on(await stored('rate'), D2).filter((r) => r.payload.symbol === 'USD')) === usdPlanted,
    `${JSON.stringify(conflicted)} ${conflictSaid}`,
  );
  const ratesNowForFault = await stored('rate');
  const currentEntry = on(await stored('snapshot'), D2).find((s) => s.accountId === id['Current account']);
  await plantHere([{ ...snap('Current account', D2, '1122'), recordId: currentEntry.recordId, version: currentEntry.version + 1 }]);
  const currentPlanted = bytes(on(await stored('snapshot'), D2).filter((s) => s.accountId === id['Current account']));
  traffic.length = 0;
  await typeRow('Current account', '1133');
  await pressRow('Current account');
  const rowAfterConflict = await rowState('Current account');
  check(
    'record-snapshot: a Conflict on a figure reloads the row to the stored record and retries nothing',
    writesSent().length === 1 && figure(rowAfterConflict.field) === 1122 && rowAfterConflict.error === 'This figure was changed in another window.' &&
      bytes(on(await stored('snapshot'), D2).filter((s) => s.accountId === id['Current account'])) === currentPlanted,
    JSON.stringify(rowAfterConflict),
  );

  await typeLine('USD', '0.98');
  await typeLine('XAU-ozt', '2799');
  faults.push((r) => (r.method === 'PUT' && r.url.endsWith(on(ratesNowForFault, D2).find((x) => x.payload.symbol === 'XAU-ozt').recordId) ? 500 : null));
  await press('Save the rate lines');
  await press('Save the prices', '.dialog');
  faults.length = 0;
  const halves = await ev("document.querySelector('.sweep .banner').textContent");
  const keptTyped = await lineState('XAU-ozt');
  traffic.length = 0;
  await press('Save the rate lines');
  await press('Save the prices', '.dialog');
  check(
    'record-rate: a save that lands in part names both halves by unit and keeps what did not land typed',
    halves.startsWith('Saved: USD. Not saved: XAU-ozt.') && figure(keptTyped.value) === 2799,
    halves,
  );
  check(
    'record-rate: saving again reissues only what failed',
    writesSent().length === 1 && on(await stored('rate'), D2).find((r) => r.payload.symbol === 'XAU-ozt').payload.rate === '2799',
  );

  const secondSnapshots = on(await stored('snapshot'), D2);
  traffic.length = 0;
  await typeRow('Brokerage', '');
  await pressRow('Brokerage');
  const removed = writesSent();
  check(
    'record-snapshot: clearing a figure backed by a record at the date deletes exactly that record',
    removed.length === 1 && removed[0].method === 'DELETE' &&
      removed[0].url.endsWith(secondSnapshots.find((s) => s.accountId === id.Brokerage).recordId) &&
      on(await stored('snapshot'), D2).length === secondSnapshots.length - 1,
  );
  traffic.length = 0;
  await typeRow('Savings', '');
  await pressRow('Savings');
  check('record-snapshot: clearing a field prefilled from another date deletes and writes nothing', traffic.length === 0);

  const pricesKept = bytes(on(await stored('rate'), D2));
  for (const name of ['Current account', 'Dollar cash']) {
    await typeRow(name, '');
    await pressRow(name);
  }
  await go(`#/recording/${D2}`);
  const emptied = await text();
  check(
    'record-snapshot: clearing every figure leaves the date\'s prices byte-identical and the recording standing with them',
    on(await stored('snapshot'), D2).length === 0 && bytes(on(await stored('rate'), D2)) === pricesKept &&
      emptied.includes('No figures recorded on this date') && (await ev("document.querySelectorAll('.data-table tr[data-unit]').length")) === 2,
  );
  check(
    'record-snapshot: the prices of an emptied recording still price the dates around it',
    await model(({ v }, day) => v.usableEntries('USD').some(e => e.payload.date === day), D2),
  );

  await press('Update');
  const emptyStates = await ev("[...document.querySelectorAll('.row-state')].map(n => n.textContent)");
  const emptyLines = [await lineState('USD'), await lineState('XAU-ozt')];
  check(
    'record-snapshot: an emptied recording reopens with every row unrecorded and the prices that keep the date',
    emptyStates.every((s) => s === 'Nothing recorded for this date.') && emptyLines.every((l) => l.value !== '' && l.chip !== ''),
    JSON.stringify(emptyLines),
  );
  await typeRow('Current account', '4242');
  await home();
  check(
    'record-snapshot: leaving with a figure typed and not saved says so and names it',
    (await text()).includes(`You left the recording for ${await format('longDate', D2)} with changes that were not saved: Current account.`),
  );
  check('record-snapshot: an emptied recording still holds its date in the picker', (await newRecording(D2)).marked);

  // The first recording had no dollar price. Its line asks for one only
  // when asked to.
  traffic.length = 0;
  await go(`#/recording/${D1}`);
  await press('Update');
  await rec.waitUntil("document.querySelector('.sweep-row')", { label: 'the sweep' });
  await quiet();
  const asksOnOpen = rateAsks().length;
  await rec.call((query) => document.querySelector(query).querySelector('.btn-inline').click(), line('USD'));
  await quiet();
  const lookedUp = await lineState('USD');
  check(
    'record-rate: Look it up is what asks, and what comes back is labeled like any proposal',
    asksOnOpen === 0 && rateAsks().length === 1 && figure(lookedUp.value) === Number(proposalsFor(D1).USD.rate) && lookedUp.chip === 'Market rate',
    JSON.stringify(lookedUp),
  );
  check(
    'record-rate: Look it up asks for the line\'s own date, and writes nothing until the rate lines are saved',
    new URL(rateAsks()[0].url).searchParams.get('date') === D1 && writesSent().length === 0,
    `${rateAsks()[0].url}, ${writesSent().length} writes`,
  );
  await press('Save the rate lines');
  await press('Save the prices', '.dialog');
  const firstUsd = on(await stored('rate'), D1).find((r) => r.payload.symbol === 'USD');
  check('record-rate: a looked-up rate on a reopened recording saves by itself, as proposed', firstUsd && firstUsd.payload.rateSource === 'proposed');

  const DP = ago(150);
  await plantHere([snap('Savings', DP, '5100'), snap('Savings', DP, '5200'), price('USD', DP, '0.9'), price('USD', DP, '0.91')]);
  await reread();
  await go(`#/recording/${DP}`);
  await press('Update');
  const pairRow = await rowState('Savings');
  const pairLine = await rec.call((query) => {
    const l = document.querySelector(query);
    return { flagged: l.classList.contains('flagged'), keeps: [...l.querySelectorAll('.rate-pair button')].length, says: l.querySelector(':scope > .hint').textContent };
  }, line('USD'));
  check(
    'record-snapshot: the sweep shows two figures on one date flagged, each with Keep this one, and picks neither',
    pairRow.state === 'Two figures share this date.' && pairRow.keeps === 2,
    JSON.stringify(pairRow),
  );
  check(
    'record-rate: the sweep shows two prices on one date flagged, each with Keep this one',
    pairLine.flagged && pairLine.keeps === 2 && pairLine.says.startsWith('Two prices for this unit share this date.'),
    JSON.stringify(pairLine),
  );
  await clickRow('Savings', '.sweep-pair button');
  await quiet();
  await rec.call((query) => document.querySelector(query).querySelector('.rate-pair button').click(), line('USD'));
  await quiet();
  check(
    'record-snapshot: keeping one of a pair on the sweep leaves exactly one of each',
    on(await stored('snapshot'), DP).length === 1 && on(await stored('rate'), DP).length === 1,
  );

  await go(`#/recording/${ago(3)}`);
  const gone = await text();
  await press('Pick a date');
  check(
    'record-snapshot: a recording that is not there says so and offers the date picker',
    gone.includes(`${await format('longDate', ago(3))} holds no recording.`) && (await ev("document.querySelector('.dialog-heading').textContent")) === 'New recording' &&
      (await ev("[...document.querySelectorAll('.dialog .date-picker')].flatMap(p => [...p.childNodes]).every(n => n.nodeType === 1) && !document.querySelector('.dialog').textContent.includes('null')")),
  );
  await press('Cancel', '.dialog');

  // ---- record-snapshot: another window got there first -------------------

  await home();
  traffic.length = 0;
  await newRecording(D5);
  await plantHere([snap('Savings', D5, '5005')]);
  traffic.length = 0;
  await typeRow('Current account', '10');
  await pressRow('Current account');
  const refusal = await ev("document.querySelector('.sweep .banner').textContent");
  const nowShown = await rowState('Savings');
  const longD5 = await format('longDate', D5);
  check(
    'record-snapshot: a fresh recording at a date another window recorded is refused whole, naming the date',
    refusal.startsWith(`${longD5} already has a recording. Another window got there first.`) && writesSent().length === 0 &&
      on(await stored('snapshot'), D5).length === 1 && on(await stored('rate'), D5).length === 0 &&
      nowShown.state === 'Recorded for this date.' && figure(nowShown.field) === 5005,
    `${refusal} ${JSON.stringify(nowShown)}`,
  );
  await press('Open the recording');
  check('record-snapshot: the refusal opens that recording', (await ev('location.hash')) === `#/recording/${D5}`);
  const unpriced = await text();
  check(
    'record-snapshot: a recording with no prices says so, and names each unit whose line is empty',
    unpriced.includes('No prices were captured at this date.') && unpriced.includes('No price for USD at this date.'),
  );
  await press('Update');
  await plantHere([snap('Current account', D5, '5006')]);
  traffic.length = 0;
  await typeRow('Current account', '11');
  await pressRow('Current account');
  check(
    'record-snapshot: inside a reopened recording, a holding another window filled is refused the same way',
    (await ev("document.querySelector('.sweep .banner').textContent")).startsWith(`${longD5} already has a recording.`) && writesSent().length === 0,
  );

  // ---- record-rate: writes that fail ------------------------------------

  await home();
  const heroFailed = await hero();
  faults.push((r) => (r.method === 'PUT' && bodyOf(r).recordType === 'snapshot' ? 500 : null));
  await newRecording(D6);
  await typeRow('Current account', '20');
  await pressRow('Current account');
  const failedRow = await rowState('Current account');
  faults.length = 0;
  check(
    'record-rate: with the quantity write failing, no price is written and the figure stays typed',
    failedRow.error === 'That did not save. Your figure is still here.' && failedRow.field === '20' && on(await stored('rate'), D6).length === 0,
    JSON.stringify(failedRow),
  );
  await home();
  check('record-rate: a failed quantity leaves the total where it was', (await hero()) === heroFailed);
  faults.push((r) => (r.method === 'PUT' && bodyOf(r).recordType === 'rate' ? 500 : null));
  await newRecording(D6);
  await typeRow('Current account', '20.25');
  await pressRow('Current account');
  const reported = await ev("document.querySelector('.sweep .banner').textContent");
  faults.length = 0;
  const kept = on(await stored('snapshot'), D6).find((s) => s.accountId === id['Current account']);
  check(
    'record-rate: with every price write failing, the figure is stored exactly and the screen says the prices were not updated',
    kept && kept.payload.value === '20.25' && reported.includes('Prices were not updated for USD, XAU-ozt') &&
      (await rowState('Current account')).state === 'Recorded for this date.' && on(await stored('rate'), D6).length === 0,
    reported,
  );

  proxy.mode = 'down';
  await home();
  await newRecording(D7);
  const outage = await lineState('USD');
  await typeRow('Current account', '25');
  await pressRow('Current account');
  check(
    'record-snapshot: with the proxy down the figure still saves and the line says nothing will be recorded for the unit',
    outage.says === 'No market rate came back for USD. Nothing will be recorded for it for this date.' &&
      on(await stored('snapshot'), D7).length === 1 && on(await stored('rate'), D7).length === 0,
    JSON.stringify(outage),
  );

  proxy.mode = 'none';
  await plantHere([{
    type: 'account',
    payload: { name: 'Euro account', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-01T00:01:00Z' },
  }]).then(([euro]) => { id['Euro account'] = euro; });
  await reread();
  await home();
  await newRecording(D9);
  traffic.length = 0;
  const confirmOffered = (await rowState('Savings')).label;
  await pressRow('Savings');
  const confirmed = writesSent();
  await typeRow('Euro account', '40.50');
  const euroLive = !(await rowState('Euro account')).disabled;
  await pressRow('Euro account');
  const noContent = on(await stored('rate'), D9);
  check(
    'record-snapshot: with No Content from the proxy, Confirm is still offered and is one click',
    confirmOffered === 'Confirm' && confirmed.length === 1 && bodyOf(confirmed[0]).recordType === 'snapshot' &&
      on(await stored('snapshot'), D9).some((s) => s.accountId === id.Savings && s.payload.value === '5005'),
  );
  check(
    'record-rate: with No Content from the proxy, no price is written and the previous entry stays the latest',
    noContent.length === 0 && (await model(({ v }) => v.latestPrice('USD').date)) === T,
  );
  await home();
  check(
    'record-snapshot: a figure in a symbol whose lookup returned nothing saves with the control live and is listed as not priced',
    euroLive && on(await stored('snapshot'), D9).some((s) => s.accountId === id['Euro account'] && s.payload.value === '40.50') && (await group('Not priced')).includes('Euro account'),
  );
  proxy.mode = 'answer';

  // ---- record-rate: a price typed at a date holding no record ------------

  await home();
  await newRecording(D8);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals for the date' });
  await quiet();
  const saveOffered = () =>
    ev("[...document.querySelectorAll('.rate-section button')].some((b) => b.textContent.trim() === 'Save the rate lines' && b.getClientRects().length > 0)");
  traffic.length = 0;
  await typeLine('PAINT', '3.5');
  check(
    'record-rate: a price typed at a date holding no record shows no rate-lines save and stays on screen',
    !(await saveOffered()) && figure((await lineState('PAINT')).value) === 3.5 && writesSent().length === 0,
  );
  const refusedWrite = await rec.call(async (date) => {
    const writes = await import('/static/js/writes.js');
    const vault = (await import('/static/js/session.js')).currentVault();
    const payload = writes.rateEntry(vault, 'PAINT', date, { rate: '3.5', rateSource: 'manual', rateAsOf: null, proposedRate: null });
    return JSON.stringify(await writes.saveRateLines(vault, writes.sitting(vault, date), { rates: [{ existing: null, payload }] }));
  }, D8).then(JSON.parse);
  check(
    'record-rate: the client\'s rate-lines write, called at a date holding no record, issues no request and writes nothing',
    refusedWrite.refused === true && traffic.length === 0 && on(await stored('rate'), D8).length === 0,
    `${JSON.stringify(refusedWrite)} ${traffic.map((r) => `${r.method} ${r.url}`).join(' | ')}`,
  );
  await home();
  check(
    'record-rate: leaving with a price typed and no row recorded writes nothing and the next screen names the unit',
    writesSent().length === 0 && on(await stored('rate'), D8).length === 0 && on(await stored('snapshot'), D8).length === 0 &&
      (await text()).includes(`You left the recording for ${await format('longDate', D8)} with changes that were not saved: the PAINT rate.`),
  );

  await newRecording(D8);
  await rec.waitUntil((query) => document.querySelector(query).querySelector('input').value !== '', { args: [line('USD')], label: 'the proposals for the date again' });
  await quiet();
  await typeLine('PAINT', '3.5');
  traffic.length = 0;
  await typeRow('Current account', '77');
  await pressRow('Current account');
  const atD8 = on(await stored('rate'), D8).map((r) => r.payload);
  const writtenKinds = writesSent().map((r) => bodyOf(r).recordType);
  const sourceOf = (symbol) => (atD8.find((p) => p.symbol === symbol) || {}).rateSource;
  check(
    'record-rate: the first row recorded writes its snapshot, then the typed price as manual and every proposal as proposed',
    writtenKinds[0] === 'snapshot' && atD8.map((p) => p.symbol).sort().join(',') === 'PAINT,USD,XAU-ozt' &&
      atD8.find((p) => p.symbol === 'PAINT').rate === '3.5' && sourceOf('PAINT') === 'manual' &&
      sourceOf('USD') === 'proposed' && sourceOf('XAU-ozt') === 'proposed',
    `${writtenKinds.join(',')} ${JSON.stringify(atD8)}`,
  );
  await typeLine('PAINT', '4');
  check('record-rate: from the first row recorded the rate-lines save is offered', await saveOffered());
  await home();

  // The sweep keeps its columns while its block is 720px wide, under
  // one window width, and stacks one pixel under.
  await viewport(1280);
  await go(`#/sweep/${T}`);
  await ev("document.querySelector('.rate-section').scrollIntoView()");
  const columns = await layout('.rate-lines');
  const narrowed = {};
  for (const width of [719, 720]) {
    await rec.call((pixels) => { document.querySelector('.rate-lines').style.width = `${pixels}px`; }, width);
    narrowed[width] = await layout('.rate-lines');
  }
  await ev("document.querySelector('.rate-lines').style.width = ''");
  check(
    'record-rate: the sweep\'s rate lines keep the rows\' columns at a desktop width, unclipped and clear of each other',
    columns.width >= 720 && columns.problems.length === 0 && columns.seen.length >= 2 && columns.seen.every((l) => l.stacked === false),
    JSON.stringify(columns),
  );
  check(
    'record-rate: the rate lines switch at their block\'s 720px and not at the window\'s',
    narrowed[719].width === 719 && narrowed[720].width === 720 &&
      narrowed[719].seen.every((l) => l.stacked && l.chipBelow !== false) && narrowed[720].seen.every((l) => l.stacked === false) &&
      narrowed[719].problems.length === 0 && narrowed[720].problems.length === 0,
    JSON.stringify(narrowed),
  );
  await viewport(390);
  await go(`#/sweep/${T}`);
  const phone = await layout('.rate-lines');
  check(
    'record-rate: the sweep\'s rate lines stack at a phone width, in full',
    phone.problems.length === 0 && phone.seen.every((l) => l.stacked && l.chipBelow !== false),
    JSON.stringify(phone),
  );
  await rec.send('Emulation.clearDeviceMetricsOverride');
  await home();
});
