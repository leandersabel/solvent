// Reviewer's checks of Snapshot entry (spec/features/record-snapshot.md),
// written from the acceptance criteria alone: the blind criteria of the
// single-holding form, its date refusals, and moving an entry's date.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  const {
    rec, T, ago, D1, id, proxy, proposalsFor, traffic, faults, writesSent, rateAsks, typeReads, bodyOf,
    ev, quiet, set, press, stored, on, bytes, plantHere, reread, go, format, line, figure, layout, viewport,
  } = r;

  const kindOf = (t) => (t.method === 'DELETE' ? 'DELETE' : `${t.method} ${(bodyOf(t) || {}).recordType || ''}`.trim());
  const sent = () => writesSent().map(kindOf);
  const dialogText = () => ev("[...document.querySelectorAll('.dialog')].map(d => d.innerText).join(' | ')");
  const save = async () => {
    await ev("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
    await quiet();
  };
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.dialog'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
  };
  const openForm = async (accountId) => {
    await go(`#/holding/${accountId}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  };
  const editEntry = async (accountId, iso) => {
    await go(`#/holding/${accountId}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find((row) => row.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach((b) => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the entry at ${iso}` });
    await quiet();
  };
  const moveEntry = async (accountId, from, to) => {
    await editEntry(accountId, from);
    traffic.length = 0;
    await set('#snapshot-date', await format('date', to));
    await quiet();
    await save();
    const confirming = await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Move and delete')");
    if (confirming) await press('Move and delete', '.dialog');
  };
  // The converted cell for a holding on a recording, and the one on its
  // own list at a date.
  const onRecording = async (iso, name) => {
    await go(`#/recording/${iso}`);
    return rec.call((holding) => [...document.querySelectorAll('.recording .card')[0].querySelectorAll('tbody tr')]
      .find((row) => row.cells[0].textContent === holding).cells[2].textContent, name);
  };
  const inList = async (accountId, iso) => {
    await go(`#/holding/${accountId}`);
    const label = await format('longDate', iso);
    return rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')]
      .find((row) => row.cells[0].textContent.startsWith(day)).cells[2].textContent, label);
  };

  // ---- 76: gold by the gram moved before its published prices, in a vault
  // whose only other unit is the main currency.

  const [grams] = await plantHere([
    { type: 'account', payload: { name: 'Gold grams', unit: 'XAU-g', dims: {}, note: null, archivedAt: null, createdAt: '2010-01-01T00:00:00Z' } },
    { type: 'account', payload: { name: 'Cash box', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: '2010-01-01T00:00:01Z' } },
  ]);
  const OLD = '2012-06-29';
  await plantHere([{ type: 'snapshot', accountId: grams, payload: { date: '2015-03-02', value: '10', note: null } }]);
  await reread();
  await moveEntry(grams, '2015-03-02', OLD);
  const movedOld = on(await stored('snapshot'), OLD);
  const unpricedOld = [await onRecording(OLD, 'Gold grams'), await inList(grams, OLD)];
  check(
    'review 76: moving gold by the gram before 2013 asks no rate, writes no price, and reads not priced with none before',
    rateAsks().length === 0 && !sent().includes('PUT rate') && movedOld.length === 1 && on(await stored('rate'), OLD).length === 0 &&
      unpricedOld.every((cell) => cell === 'not priced'),
    JSON.stringify({ asks: rateAsks().length, sent: sent(), unpricedOld }),
  );
  const BEFORE = '2011-06-30';
  await plantHere([{ type: 'rate', payload: { symbol: 'XAU-g', date: BEFORE, rate: '40', rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null } }]);
  await reread();
  const pricedOld = [await onRecording(OLD, 'Gold grams'), await inList(grams, OLD)];
  const beforeLabel = await format('longDate', BEFORE);
  check(
    'review 76: with a price from 2011 the moved figure converts at it and carries its date',
    pricedOld.every((cell) => figure(cell.split('priced')[0]) === 400 && cell.endsWith(`priced ${beforeLabel}`)),
    JSON.stringify(pricedOld),
  );

  await r.seed();

  // ---- 11: the single-holding form still asks before replacing ----------

  const currentAtD1 = () => stored('snapshot').then((all) => bytes(on(all, D1).filter((s) => s.accountId === id['Current account'])));
  const keptBytes = await currentAtD1();
  await openForm(id['Current account']);
  await set('#snapshot-date', await format('date', D1));
  await set('#snapshot-value', '1');
  traffic.length = 0;
  await save();
  const prompt = await dialogText();
  check('review 11: the form at an occupied date asks to replace, naming the stored figure', prompt.includes('You already recorded') && prompt.includes('1,000'), prompt);
  await press('Keep what is there', '.dialog');
  await closeDialogs();
  check('review 11: declining writes nothing', writesSent().length === 0 && (await currentAtD1()) === keptBytes);

  // ---- 64: changing a value or a note touches no price -----------------

  await editEntry(id.Brokerage, D1);
  traffic.length = 0;
  await set('#snapshot-value', '2001');
  await save();
  const valueOnly = { asks: rateAsks().length, sent: sent(), reloads: typeReads('snapshot').length + typeReads('rate').length };
  await editEntry(id.Brokerage, D1);
  await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  const addNote = await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent.trim() === 'Add a note')");
  if (addNote) await press('Add a note', '.dialog');
  traffic.length = 0;
  await set('.dialog textarea', 'from the statement');
  await save();
  const noteOnly = { asks: rateAsks().length, sent: sent(), reloads: typeReads('snapshot').length + typeReads('rate').length };
  check(
    'review 64: a value change and a note change each write one snapshot, ask no rate and reload nothing',
    [valueOnly, noteOnly].every((s) => s.asks === 0 && s.reloads === 0 && s.sent.join() === 'PUT snapshot'),
    JSON.stringify({ valueOnly, noteOnly }),
  );

  // ---- 81, 82, 83: the date field's refusals -----------------------------

  await openForm(id.Savings);
  await set('#snapshot-value', '5');
  const dateState = () => ev(`(() => {
    const input = document.querySelector('#snapshot-date');
    const described = (input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).map((i) => document.getElementById(i));
    const general = [...document.querySelectorAll('.dialog .field-error:not([hidden])')].filter((n) => !described.includes(n) && !n.closest('.date-field'));
    return {
      invalid: input.getAttribute('aria-invalid'),
      // Every line the field names, its label for screen readers among them.
      described: described.filter(Boolean).map((n) => n.textContent.trim()),
      general: general.map((n) => n.textContent.trim()).join(''),
    };
  })()`);
  const tomorrow = new Date(Date.parse(`${T}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  traffic.length = 0;
  await set('#snapshot-date', await format('date', tomorrow));
  await save();
  const future = await dateState();
  check(
    'review 81: a future date is refused on its own line, marked invalid and described by that line, with no PUT and the general line empty',
    future.described.includes('That date is in the future.') && future.invalid === 'true' && future.general === '' && writesSent().length === 0,
    JSON.stringify(future),
  );
  await set('#snapshot-date', 'not a date');
  await save();
  const garbled = await dateState();
  await set('#snapshot-date', '');
  await save();
  const emptied = await dateState();
  check(
    'review 82: unparseable text gives the unparseable reason and an empty field the empty one, with no PUT',
    garbled.described.some((t) => t.startsWith('Enter the date as ')) && !garbled.described.includes('Enter a date.') &&
      emptied.described.includes('Enter a date.') && writesSent().length === 0,
    JSON.stringify({ garbled, emptied }),
  );
  await set('#snapshot-date', await format('date', ago(5)));
  await quiet();
  const fixed = await dateState();
  check('review 83: a corrected date clears the refusal and aria-invalid before Save', !fixed.described.some((t) => t === 'That date is in the future.' || t === 'Enter a date.' || t.startsWith('Enter the date as ')) && fixed.invalid !== 'true', JSON.stringify(fixed));
  await closeDialogs();

  // ---- 86: the opened prices line, measured -------------------------------

  const geometry = {};
  for (const width of [390, 1280]) {
    await viewport(width);
    await openForm(id.Brokerage);
    await set('#snapshot-date', await format('date', ago(7)));
    await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input') && l.querySelector('input').value !== ''; }, { args: [line('USD')], label: 'the proposals' });
    await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    await rec.frames();
    const measured = await layout('.dialog');
    const chipsFit = await ev(`[...document.querySelectorAll('.dialog .rate-line .chip')].filter((c) => c.getClientRects().length)
      .every((c) => c.getBoundingClientRect().width <= c.parentElement.getBoundingClientRect().width + 0.5)`);
    geometry[width] = { ...measured, chipsFit };
    await closeDialogs();
  }
  await rec.send('Emulation.clearDeviceMetricsOverride');
  check(
    'review 86: at a narrow and a wide window the prices line shows each full name, price and provenance, nothing overlapping or wider than its box',
    Object.values(geometry).every((g) => g.problems.length === 0 && g.chipsFit &&
      ['United States Dollar', 'Gold'].every((name) => g.seen.some((l) => l.unit === name && l.chip.startsWith('Market rate')))),
    JSON.stringify(geometry),
  );

  // ---- 71: write, then prices, then delete ---------------------------------

  const DA = ago(61); const DB = ago(62);
  const DA2 = ago(63); const DB2 = ago(64);
  const DA3 = ago(65); const DB3 = ago(66);
  const DA4 = ago(67); const DB4 = ago(68);
  await plantHere([
    r.snap('Brokerage', DA, '10'), r.snap('Brokerage', DB, '20'),
    r.snap('Dollar cash', DA2, '11'), r.snap('Dollar cash', DB2, '21'),
    r.snap('Dollar cash', DA3, '12'), r.snap('Dollar cash', DB3, '22'),
    r.snap('Brokerage', DA4, '13'), r.snap('Brokerage', DB4, '23'),
  ]);
  await reread();
  await moveEntry(id.Brokerage, DA, DB);
  const order = sent();
  const lastPut = order.lastIndexOf('PUT rate');
  check(
    'review 71: a move writes the snapshot, then every price, then deletes the displaced record',
    order[0] === 'PUT snapshot' && lastPut > 0 && order.slice(1, lastPut + 1).every((k) => k === 'PUT rate') &&
      order[lastPut + 1] === 'DELETE' && order.length === lastPut + 2,
    order.join(', '),
  );
  await closeDialogs();

  faults.push((t) => (t.method === 'PUT' && t.body.includes('"recordType":"snapshot"') ? 500 : null));
  await moveEntry(id['Dollar cash'], DA2, DB2);
  faults.length = 0;
  check('review 71: a failing snapshot PUT issues no price PUT and no DELETE', sent().join() === 'PUT snapshot', sent().join(', '));
  await closeDialogs();

  faults.push((t) => (t.method === 'PUT' && t.body.includes('"recordType":"rate"') ? 500 : null));
  await moveEntry(id['Dollar cash'], DA3, DB3);
  faults.length = 0;
  const rateFailed = await dialogText();
  check(
    'review 71: a failing price PUT still deletes the displaced record and the Dialog names the unit',
    sent().includes('DELETE') && rateFailed.includes('USD'),
    `${sent().join(', ')} | ${rateFailed}`,
  );
  await closeDialogs();

  // ---- 72: a move whose DELETE failed ---------------------------------------

  faults.push((t) => (t.method === 'DELETE' ? 500 : null));
  await moveEntry(id.Brokerage, DA4, DB4);
  faults.length = 0;
  await closeDialogs();
  const both = on(await stored('snapshot'), DB4).filter((s) => s.accountId === id.Brokerage);
  await go(`#/holding/${id.Brokerage}`);
  const flagged = await ev(`(() => {
    const rows = [...document.querySelectorAll('.card .data-table tbody tr.flagged')];
    return { rows: rows.length, keep: rows.filter((row) => [...row.querySelectorAll('button')].some((b) => b.textContent === 'Keep this one')).length };
  })()`);
  check(
    'review 72: with the DELETE failing both records stay, shown flagged on the holding with Keep this one',
    both.length === 2 && flagged.rows === 2 && flagged.keep === 2,
    JSON.stringify({ stored: both.length, flagged }),
  );

  // ---- 74 and 75: a dollar figure moved from 2010 ---------------------------

  const FROM = '2010-03-31';
  const TO = '2026-04-10';
  const TO2 = '2026-04-17';
  await plantHere([
    r.snap('Dollar cash', FROM, '100'),
    r.snap('Brokerage', FROM, '200'),
    r.price('USD', FROM, '1.05', 'proposed'),
  ]);
  await reread();
  const atFrom = bytes(on(await stored('rate'), FROM));
  await moveEntry(id['Dollar cash'], FROM, TO);
  const asks = rateAsks().map((a) => a.url);
  const written = on(await stored('rate'), TO);
  const usdAtTo = written.find((p) => p.payload.symbol === 'USD');
  const converted = [await onRecording(TO, 'Dollar cash'), await inList(id['Dollar cash'], TO)];
  const expected = Number((100 * Number(proposalsFor(TO).USD.rate)).toFixed(2));
  check(
    'review 74: the move asks once, for the new date, writes every published unit there and converts at it',
    asks.length === 1 && asks[0].includes(`date=${TO}`) && usdAtTo && usdAtTo.payload.rate === proposalsFor(TO).USD.rate &&
      written.some((p) => p.payload.symbol === 'XAU-ozt') && converted.every((cell) => figure(cell) === expected && !cell.includes('priced')),
    JSON.stringify({ asks, written: written.map((p) => p.payload.symbol), converted, expected }),
  );
  check('review 74: the date the entry left keeps its prices byte-identical', bytes(on(await stored('rate'), FROM)) === atFrom);
  proxy.mode = 'none';
  await moveEntry(id.Brokerage, FROM, TO2);
  proxy.mode = 'answer';
  const unpriced = [await onRecording(TO2, 'Brokerage'), await inList(id.Brokerage, TO2)];
  check(
    'review 75: with No Content the entry moves, no dollar price is written, and it reads not priced, never at 2010\'s',
    on(await stored('snapshot'), TO2).length === 1 && !on(await stored('rate'), TO2).some((p) => p.payload.symbol === 'USD') &&
      unpriced.every((cell) => cell === 'not priced'),
    JSON.stringify(unpriced),
  );

  // ---- 79: a move onto a slot another session filled ------------------------

  const DT = ago(69);
  await editEntry(id.Savings, D1);
  await set('#snapshot-date', await format('date', DT));
  await quiet();
  await plantHere([r.snap('Savings', DT, '4999')]);
  const beforeMove = bytes([...on(await stored('snapshot'), DT), ...on(await stored('snapshot'), D1)]);
  traffic.length = 0;
  await save();
  const refused = await dialogText();
  const namedDate = [await format('dayMonth', DT), await format('longDate', DT)].some((d) => refused.includes(d));
  check(
    'review 79: a move whose reload finds its slot taken writes nothing and names the date',
    writesSent().length === 0 && namedDate &&
      bytes([...on(await stored('snapshot'), DT), ...on(await stored('snapshot'), D1)]) === beforeMove,
    `${sent().join(', ')} | ${refused}`,
  );
  await closeDialogs();
}, { signsIn: false });
