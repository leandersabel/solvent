// Reviewer's checks of a rate-lines save on a recording another window
// deleted, written from spec/features/record-snapshot.md (Update values,
// States, "The date was emptied while you were working") and
// record-rate.md (The write path; criteria 9, 32, 33, 35 and 43) alone.
// The update path meets a Conflict where the create path meets its
// reload, and both land on the same emptied date.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  const {
    rec, D1, D2, ago, quiet, proposalsFor, traffic, faults, writesSent, typeReads, bodyOf, unwatched, ev, press, stored, on,
    plantHere, pressRow, typeRow, rowState, line, lineState, typeLine, figure, home, newRecording, format,
  } = r;

  const offersLineSave = () =>
    ev("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save the rate lines' && b.getClientRects().length)");
  const outsideLines = () => ev(`(() => {
    const copy = document.querySelector('main').cloneNode(true);
    copy.querySelectorAll('.rate-line, .sweep-row').forEach((n) => n.remove());
    return copy.textContent;
  })()`);
  const atDate = async (date) => [...on(await stored('snapshot'), date), ...on(await stored('rate'), date)];
  const ratesAt = async (date) => Object.fromEntries(on(await stored('rate'), date).map((p) => [p.payload.symbol, p.payload]));
  // Every record at `date`, deleted by another window behind the model
  // on screen.
  const emptyElsewhere = async (date) => {
    const ids = (await atDate(date)).map((x) => x.recordId);
    await unwatched(() => rec.call(async (gone) => {
      const api = await import('/static/js/api.js');
      for (const recordId of gone) await api.del('/api/records/' + recordId);
    }, ids));
    return ids.length;
  };
  // Presses the lines' save, confirming whatever it asks.
  const saveLines = async () => {
    traffic.length = 0;
    await press('Save the rate lines');
    if (await ev("Boolean(document.querySelector('.dialog'))")) await press('Save the prices', '.dialog');
  };
  // The Callout under the date heading, with its icon in critical ink.
  const callout = () => rec.call(() => {
    const heading = document.querySelector('main h1');
    const box = [...document.querySelectorAll('main .callout')].find((c) => c.getClientRects().length);
    if (!box) return null;
    const icon = box.querySelector('.icon');
    const probe = document.createElement('span');
    probe.style.color = 'var(--status-critical)';
    document.body.append(probe);
    const critical = getComputedStyle(probe).color;
    probe.remove();
    return {
      text: box.textContent.replace(/\s+/g, ' ').trim(),
      critical: Boolean(icon) && getComputedStyle(icon).color === critical,
      below: Boolean(heading) && Boolean(heading.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        box.getBoundingClientRect().top >= heading.getBoundingClientRect().bottom - 0.5,
    };
  });
  const deletedSays = async (date) => {
    const day = await format('dayMonth', date);
    const c = await callout();
    return Boolean(c) && c.critical && c.below &&
      c.text.includes(`Another window deleted the recording for ${day}. Your prices were not saved.`) &&
      c.text.includes('saved with the first holding you record for this date');
  };
  // A free date through the picker, a recorded one by its sweep's address.
  const sweepOn = async (date, recorded = false) => {
    await home();
    if (recorded) await rec.call((next) => { location.hash = next; }, `#/sweep/${date}`);
    else await newRecording(date);
    await rec.waitUntil(
      (query, drawn) => document.querySelector(query) && (drawn || document.querySelector(query).querySelector('input').value !== ''),
      { args: [line('USD'), recorded], label: 'the rate lines' },
    );
    await quiet();
  };

  // ---- 43: an update on a recording the sitting made, deleted elsewhere ----

  const E = ago(53);
  await sweepOn(E);
  await typeRow('Current account', '1200');
  await pressRow('Current account');
  const madeHere = await ratesAt(E);
  const deleted = await emptyElsewhere(E);
  await typeLine('USD', '0.99');
  await saveLines();
  const afterSave = await atDate(E);
  const usdLine = await lineState('USD');
  const banner = await outsideLines();
  check(
    'review rate 43: the sitting recorded a row with its proposals, and another window deleted all of it',
    madeHere.USD?.rateSource === 'proposed' && madeHere['XAU-ozt']?.rateSource === 'proposed' && deleted === 3,
    JSON.stringify({ madeHere, deleted }),
  );
  check(
    'review rate 43: a rate-lines save changing a stored price on the deleted recording writes nothing',
    afterSave.length === 0,
    JSON.stringify(afterSave.map((x) => x.payload)),
  );
  check(
    'review snapshot: the save says, in a critical Callout under the date heading, that another window deleted the recording',
    await deletedSays(E),
    JSON.stringify(await callout()),
  );
  check(
    'review rate 43: the save does not call the deletion a price changed in another window',
    !/changed in another window/.test(banner),
    banner.slice(0, 600),
  );
  check('review rate 43: the typed price stays on its line', figure(usdLine.value) === 0.99, JSON.stringify(usdLine));
  check(
    'review snapshot: the emptied date offers no rate-lines save and its rows read as nothing recorded',
    !(await offersLineSave()) && (await rowState('Current account')).state.includes('Nothing recorded'),
    JSON.stringify(await rowState('Current account')),
  );

  traffic.length = 0;
  await typeRow('Savings', '5100');
  await pressRow('Savings');
  const next = await ratesAt(E);
  const snaps = on(await stored('snapshot'), E);
  const order = writesSent().map((w) => (bodyOf(w) || {}).recordType);
  check(
    'review rate 43: recording the next row writes its quantity first, then the typed price and the proposals at the date',
    snaps.length === 1 && snaps[0].payload.value === '5100' && order[0] === 'snapshot' &&
      next.USD?.rate === '0.99' && next['XAU-ozt']?.rateSource === 'proposed' &&
      next['XAU-ozt'].rate === proposalsFor(E)['XAU-ozt'].rate && Object.keys(next).length === 2,
    JSON.stringify({ snaps: snaps.map((s) => s.payload), order, next }),
  );
  await typeLine('XAG-ozt', '30');
  check('review rate 43: once the row is recorded a changed line offers the rate-lines save again', await offersLineSave());

  // ---- 9: a Conflict on a date that still holds its recording ----------

  await sweepOn(D2, true);
  const usd = on(await stored('rate'), D2).find((p) => p.payload.symbol === 'USD');
  await plantHere([{ type: 'rate', recordId: usd.recordId, version: usd.version + 1, payload: { ...usd.payload, rate: '0.93', rateSource: 'manual', rateAsOf: null } }]);
  await typeLine('USD', '0.95');
  await saveLines();
  const conflicted = await ratesAt(D2);
  const reloaded = await lineState('USD');
  const conflictSays = await outsideLines();
  const ratePuts = writesSent().filter((w) => (bodyOf(w) || {}).recordType === 'rate');
  check(
    'review rate 9: a Conflict on a date still recorded overwrites nothing, retries nothing and reloads the line',
    conflicted.USD?.rate === '0.93' && ratePuts.length === 1 && figure(reloaded.value) === 0.93,
    JSON.stringify({ conflicted: conflicted.USD, puts: ratePuts.length, reloaded }),
  );
  check(
    'review rate 9: the message names the symbol and the screen does not call the recording deleted',
    /USD[^.]*another window/.test(conflictSays + reloaded.error) && !(await callout()),
    JSON.stringify({ conflictSays: conflictSays.slice(0, 400), line: reloaded.error, callout: await callout() }),
  );

  // ---- 32 and 33: a save that creates, after one that created ----------

  const F = ago(54);
  await sweepOn(F);
  await typeRow('Current account', '1300');
  await pressRow('Current account');
  await typeLine('m2', '10500');
  await saveLines();
  const createdFirst = await ratesAt(F);
  await emptyElsewhere(F);
  await typeLine('PAINT', '800');
  await saveLines();
  const reloadAsked = typeReads('snapshot').length + typeReads('rate').length > 0;
  const sent = writesSent();
  check(
    'review rate 33: a second creating save on the deleted recording reloads, sends no PUT or DELETE, and the vault holds nothing at the date',
    createdFirst.m2?.rate === '10500' && reloadAsked && sent.length === 0 && (await atDate(F)).length === 0,
    JSON.stringify({ createdFirst: Object.keys(createdFirst), reloadAsked, sent: sent.map((w) => w.method) }),
  );
  check(
    'review rate 32: the typed price stays, no rate-lines save shows, and the Callout says the recording was deleted',
    figure((await lineState('PAINT')).value) === 800 && !(await offersLineSave()) && (await deletedSays(F)),
    JSON.stringify({ paint: await lineState('PAINT'), callout: await callout() }),
  );
  await typeRow('Savings', '5200');
  await pressRow('Savings');
  check('review rate 32: recording the first row then writes the typed price', (await ratesAt(F)).PAINT?.rate === '800');

  // ---- A clear on a recording deleted elsewhere --------------------------

  const G = ago(55);
  await sweepOn(G);
  await typeRow('Current account', '1400');
  await pressRow('Current account');
  await emptyElsewhere(G);
  await typeLine('USD', '');
  await saveLines();
  check(
    'review snapshot: a rate-lines save clearing a price on a recording another window deleted shows the date emptied',
    (await atDate(G)).length === 0 && (await deletedSays(G)) && !(await offersLineSave()),
    JSON.stringify({ callout: await callout(), banner: (await outsideLines()).slice(0, 400), row: await rowState('Current account') }),
  );

  // ---- 35: the second of two updates failing, a deletion after them ----

  await sweepOn(D1, true);
  await typeLine('XAU-ozt', '2600');
  await typeLine('XAG-ozt', '26');
  await typeLine('m2', '');
  let seen = 0;
  let failed = null;
  const secondRateFails = (entry) => {
    if (entry.method !== 'PUT' || (bodyOf(entry) || {}).recordType !== 'rate') return false;
    seen += 1;
    if (seen !== 2) return false;
    failed = entry.url;
    return 500;
  };
  faults.push(secondRateFails);
  await saveLines();
  faults.splice(faults.indexOf(secondRateFails), 1);
  const rates = on(await stored('rate'), D1);
  const byId = Object.fromEntries(rates.map((p) => [p.recordId, p.payload]));
  const failedId = failed && failed.split('/').pop();
  const landedSymbol = rates.find((p) => p.recordId !== failedId && ['XAU-ozt', 'XAG-ozt'].includes(p.payload.symbol));
  const failedSymbol = failedId && byId[failedId]?.symbol;
  const names = { 'XAU-ozt': 'Gold, troy ounce', 'XAG-ozt': 'Silver, troy ounce' };
  const says = await outsideLines();
  check(
    'review rate 35: with the second rate PUT failing, the first lands, the failed one is unchanged and the deletion still runs',
    seen >= 2 && Boolean(failedSymbol) && landedSymbol &&
      landedSymbol.payload.rate === { 'XAU-ozt': '2600', 'XAG-ozt': '26' }[landedSymbol.payload.symbol] &&
      byId[failedId].rate === { 'XAU-ozt': '2500', 'XAG-ozt': '25' }[failedSymbol] &&
      !rates.some((p) => p.payload.symbol === 'm2'),
    JSON.stringify({ seen, failedSymbol, rates: rates.map((p) => p.payload) }),
  );
  check(
    'review rate 35: the message names the unit that did not land, and nothing calls the recording deleted',
    Boolean(failedSymbol) && says.includes(names[failedSymbol]) && !(await callout()),
    says.slice(0, 600),
  );
}, { signsIn: false });
