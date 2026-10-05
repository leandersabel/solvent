// Snapshot entry (spec/features/record-snapshot.md, Snapshot entry): one
// holding, one date, the small form for an odd date, a figure added late,
// or an old statement backfilled, and what it writes, refuses and prices.
// Templates: dashboard.html. Modules: view-forms.js, view-holding.js,
// writes.js, datepicker.js, format.js, decimal.js, model.js.
import { BACKDATE, check, click, page, run, setValue, story, text, unlockDashboard, vaultOwner } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  await vaultOwner();
  await story({ backdated: false });
  await unlockDashboard('the dashboard of the story');
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: "the holding's screen" });

  await click('Record a value');
  await page.waitUntil("document.querySelector('#snapshot-date')", { label: 'the value form' });
  // Typed in the reader's own format, which is what the field accepts:
  // writing an ISO date into it would test a control nobody uses.
  const asWritten = await page.call(async (day) => {
    const f = await import('/static/js/format.js');
    const s = await import('/static/js/session.js');
    return f.formatter(s.currentVault().profile).date(day);
  }, BACKDATE);
  check('the date field shows the reader\'s own format', asWritten !== BACKDATE, asWritten);
  await setValue('#snapshot-date', asWritten);
  await setValue('#snapshot-value', '11000.00');
  await page.idle();
  await page.eval("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  await page.frames();
  const tabular = (selector) => page.call((s) => {
    const nodes = [...document.querySelectorAll(s)];
    return nodes.length > 0 && nodes.every((n) => getComputedStyle(n).fontVariantNumeric === 'tabular-nums');
  }, selector);
  check('the form\'s value field has tabular digits', await tabular('#snapshot-value'));
  check('the form\'s converted line has tabular digits', await tabular('#snapshot-value ~ .hint'));
  check('the form\'s rate fields have tabular digits', await tabular('.dialog .rate-line input'));
  check(
    'the prices line says what the save writes',
    (await text()).includes('will be recorded with this'),
    await page.eval("[...document.querySelectorAll('.dialog .hint')].map(n => n.textContent).join(' | ')"),
  );
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()");
  await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the value to save' });
  await page.idle();
  check('the backdated figure joins the history', (await page.eval("document.querySelectorAll('.card .data-table tbody tr').length")) === 2);

  await page.eval("location.hash = '#/'");
  await page.holds("document.querySelectorAll('.entry-mark').length === 2");
  check('the chart now carries two entry marks', (await page.eval("document.querySelectorAll('.entry-mark').length")) === 2);


  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: "the holding's screen" });
  const archiving = await page.eval("document.querySelector('.screen-heading').textContent");
  await click('Record a value');
  await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  await setValue('#snapshot-value', '99.99');
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()");
  await page.waitUntil("document.body.innerText.includes('Replace the figure already recorded')", {
    label: 'the replace prompt',
  });
  check('a blind date prompts before replacing what is there', true);
  check('the prompt names the stored figure', (await text()).includes('You already recorded'));
  await click('Keep what is there');
  await page.holds("document.querySelectorAll('.dialog').length === 1");
  await page.key('Escape');
  await page.holds("!document.querySelector('.dialog')");
  // Read the record rather than the screen: the dialog's own live
  // preview of what was typed is not what was stored.
  const kept = await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const v = s.currentVault();
    return [...v.snapshots.values()].flat().map(x => x.payload.value).join(',');
  })()`);
  check('declining leaves the original untouched', !kept.includes('99.99'), kept);


  // ---- The form, in a vault of its own ------------------------------

  const r = await startRecorder();
  await r.register();
  await r.seed();
  // What the sweeps that came before leave: today's recording with its
  // prices, so opening the form asks nothing, and the figures the later
  // checks move, delete and overwrite.
  await r.plantHere([
    r.snap('Current account', r.T, '1234.56'),
    r.price('USD', r.T, r.proposalsFor(r.T).USD.rate, 'proposed'),
    r.price('XAU-ozt', r.T, r.proposalsFor(r.T)['XAU-ozt'].rate, 'proposed'),
    r.snap('Savings', r.D5, '5005'),
    r.snap('Savings', r.D9, '5005'),
    r.snap('Savings', r.D10, '5000'),
  ]);
  await r.reread();
  await r.home();
  const {
    rec, dayOf, isoOf, T, ago, D1, D5, D8,
    D9, D10, D11, proxy, traffic, faults, writesSent, rateAsks, typeReads,
    bodyOf, ev, quiet, set, press, stored, on, bytes,
    plantHere, archiveElsewhere, reread, go, format, line, lineState, typeLine, figure,
    home, id, layout, snap, price, viewport,
  } = r;

  // ---- record-snapshot: the single-holding form ---------------------------

  const openForm = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Record a value', '.form-actions');
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the form for ${name}` });
  };
  const formSave = async () => {
    await ev("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()");
    await quiet();
  };
  const formError = () => ev("(() => { const n = document.querySelector('.dialog .field-error:not([hidden])'); return n ? n.textContent : ''; })()");
  // By Escape, which closes the topmost dialog and puts the page back
  // as it was, where removing the scrim would leave the page inert.
  const closeDialogs = async () => {
    for (let n = 0; n < 5 && (await ev("Boolean(document.querySelector('.scrim'))")); n++) {
      await rec.key('Escape');
      await rec.frames();
    }
  };

  proxy.mode = 'down';
  await openForm('Current account');
  await set('#snapshot-date', await format('date', D8));
  await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  await quiet();
  const formOutage = await lineState('USD');
  await set('#snapshot-value', '26');
  await formSave();
  check(
    'record-snapshot: the form saves with the proxy down, its line having said so',
    formOutage.says.startsWith('No market rate came back for USD.') && !(await ev("Boolean(document.querySelector('.dialog'))")) &&
      on(await stored('snapshot'), D8).length === 1,
    JSON.stringify(formOutage),
  );
  proxy.mode = 'answer';

  traffic.length = 0;
  await openForm('Current account');
  await set('#snapshot-value', '1.1234567890123');
  await formSave();
  const fine = await formError();
  await closeDialogs();
  await openForm('Current account');
  await set('#snapshot-date', await format('date', isoOf(dayOf(T) + 1)));
  await ev("document.querySelector('#snapshot-date').dispatchEvent(new Event('blur'))");
  const future = await ev("document.querySelector('.date-field .field-error').textContent");
  await set('#snapshot-value', '5');
  await formSave();
  await closeDialogs();
  check('record-snapshot: a value with more than twelve decimal places is refused at input', fine.includes('at most twelve decimal places'), fine);
  check('record-snapshot: a future date is refused inline and nothing is written', future === 'That date is in the future.' && writesSent().length === 0, future);

  // Every date refusal sits on the date field's own line, never in the
  // dialog's general one, and Save asks the field rather than reading no
  // value as an empty date.
  const dateState = () => ev(`(() => {
    const input = document.querySelector('#snapshot-date');
    const line = document.querySelector('#snapshot-date-line');
    const general = [...document.querySelectorAll('.dialog .field-error:not([hidden])')].filter((n) => n !== line);
    return {
      line: line ? line.textContent : null,
      linked: Boolean(line) && (input.getAttribute('aria-describedby') || '').split(' ').includes(line.id),
      invalid: input.getAttribute('aria-invalid'),
      general: general.map((n) => n.textContent).join(' '),
      focused: document.activeElement === input,
    };
  })()`);
  traffic.length = 0;
  await openForm('Current account');
  await set('#snapshot-value', '5');
  await set('#snapshot-date', await format('date', isoOf(dayOf(T) + 1)));
  await formSave();
  const futureSaved = await dateState();
  await set('#snapshot-date', 'not a date');
  await formSave();
  const garbled = await dateState();
  await set('#snapshot-date', '');
  await formSave();
  const emptied = await dateState();
  await set('#snapshot-date', await format('date', D1));
  const fitted = await dateState();
  await closeDialogs();
  const pattern = await format('datePlaceholder');
  const refusedOnItsLine = (state, reason) => state.line === reason && state.linked && state.invalid === 'true' && state.general === '';
  check(
    'record-snapshot: Save on a typed future date shows the refusal on the date field, focuses it and writes nothing',
    refusedOnItsLine(futureSaved, 'That date is in the future.') && futureSaved.focused && writesSent().length === 0,
    JSON.stringify(futureSaved),
  );
  check(
    'record-snapshot: Save on text that does not parse says how to write the date, not that it is empty',
    refusedOnItsLine(garbled, `Enter the date as ${pattern}.`) && garbled.focused,
    JSON.stringify(garbled),
  );
  check('record-snapshot: Save on an emptied date asks for a date', refusedOnItsLine(emptied, 'Enter a date.') && emptied.focused, JSON.stringify(emptied));
  check(
    'record-snapshot: a date that fits clears the refusal before Save, and a holding that is not archived has no hint',
    fitted.line === '' && fitted.invalid === null && fitted.general === '',
    JSON.stringify(fitted),
  );

  traffic.length = 0;
  await openForm('Current account');
  await set('#snapshot-date', await format('date', D11));
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input').value !== ''; }, { args: [line('USD')], label: 'the form proposals' });
  const formLine = await ev("document.querySelector('.prices-line').textContent");
  const formBody = await ev("document.querySelector('.dialog .prices-body').textContent");
  await set('#snapshot-value', '31415.92');
  await formSave();
  check(
    'record-snapshot: the form opens an empty date to its proposals and writes them behind the figure',
    formLine === `Prices for ${await format('longDate', D11)} will be recorded with this, for every other unit in your vault, although this figure is in CHF.` &&
      on(await stored('rate'), D11).map((r) => r.payload.symbol).sort().join(',') === 'USD,XAU-ozt',
    formLine,
  );
  check(
    'record-snapshot: no request during the form carries the entered figure, in any field or encoding',
    traffic.every((r) => !['31415.92', 'MzE0MTUuOTI='].some((s) => (r.url + JSON.stringify(r.headers) + r.body).includes(s))),
  );
  check(
    'record-snapshot: the prices section of a date with no recording holds no "null" where the open-the-recording link does not apply',
    !/null/i.test(formBody),
    formBody,
  );
  const firstEntry = on(await stored('snapshot'), D11).find((s) => s.accountId === id['Current account']);
  traffic.length = 0;
  await openForm('Current account');
  await set('#snapshot-date', await format('date', D11));
  await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  const joining = await ev("document.querySelector('.prices-line').textContent");
  const joiningLink = await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Open the recording, where they are changed')");
  const joiningFields = await ev("document.querySelectorAll('.dialog .rate-line input').length");
  await set('#snapshot-value', '27182.81');
  await formSave();
  const prompt = await ev("document.querySelector('.dialog:last-of-type') && [...document.querySelectorAll('.dialog')].pop().textContent");
  await press('Replace it', '.dialog');
  const replaced = on(await stored('snapshot'), D11).filter((s) => s.accountId === id['Current account']);
  check(
    'record-snapshot: a date already priced reads its stored prices read-only, links to its recording, and looks nothing up',
    joining === `${await format('longDate', D11)} already holds prices. This figure joins them.` && rateAsks().length === 0 &&
      joiningLink && joiningFields === 0,
    joining,
  );
  check(
    'record-snapshot: confirming the replace prompt leaves one record for the date, one version on, under a new nonce',
    prompt.includes('You already recorded') && replaced.length === 1 && replaced[0].recordId === firstEntry.recordId &&
      replaced[0].version === firstEntry.version + 1 && replaced[0].nonce !== firstEntry.nonce && replaced[0].payload.value === '27182.81',
    prompt,
  );

  const DQ = ago(45);
  await openForm('Savings');
  await set('#snapshot-date', await format('date', DQ));
  await quiet();
  await plantHere([snap('Fund 1', DQ, '1')]);
  traffic.length = 0;
  await set('#snapshot-value', '5300');
  await formSave();
  const takenForm = await formError();
  check(
    'record-snapshot: the form refuses a date another window took while it was open, and offers that recording',
    takenForm.startsWith(`${await format('longDate', DQ)} already has a recording. Another window got there first.`) &&
      (await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Open the recording')")) &&
      writesSent().length === 0,
    takenForm,
  );
  await closeDialogs();

  const DR = ago(50);
  await openForm('Savings');
  await set('#snapshot-date', await format('date', DR));
  // A person leaves the date field before touching a price. The page
  // has had real input by now, so it is focused and the date field
  // really does blur, which draws the prices again.
  await ev('document.activeElement.blur()');
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input').value !== ''; }, { args: [line('USD')], label: 'the form proposals to change' });
  await typeLine('USD', '0.7777');
  await set('#snapshot-value', '5400');
  await formSave();
  const announced = await ev("[...document.querySelectorAll('.dialog')].pop().textContent");
  await ev("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
  await quiet();
  const formEdited = on(await stored('rate'), DR).find((r) => r.payload.symbol === 'USD');
  check(
    'record-snapshot: a price changed on the form says what it moves, and is written as edited behind the figure',
    announced.includes(`Changing the USD rate for ${await format('longDate', DR)} moves 2 holdings measured in USD`) &&
      formEdited && formEdited.payload.rate === '0.7777' && formEdited.payload.rateSource === 'edited',
    announced,
  );

  const DS = ago(55);
  faults.push((r) => (r.method === 'PUT' && bodyOf(r).recordType === 'rate' ? 500 : null));
  await openForm('Savings');
  await set('#snapshot-date', await format('date', DS));
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input').value !== ''; }, { args: [line('USD')], label: 'the form proposals to fail' });
  await set('#snapshot-value', '5500');
  await formSave();
  faults.length = 0;
  const pricesFailed = await formError();
  check(
    'record-snapshot: the form keeps the figure when its prices do not save, and names the units',
    pricesFailed === 'Saved. The prices were not updated for USD, XAU-ozt.' &&
      on(await stored('snapshot'), DS).some((s) => s.accountId === id.Savings) &&
      (await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Done')")),
    pricesFailed,
  );
  await press('Done', '.dialog');

  // A date another holding recorded, priced in dollars and not in
  // gold: a figure added there fills in gold alone, as the sweep would.
  const DF = ago(60);
  await plantHere([snap('Fund 2', DF, '101'), price('USD', DF, '0.88', 'proposed')]);
  await reread();
  const usdAtDP = bytes(on(await stored('rate'), DF));
  await openForm('Fund 1');
  // Counted from the date being chosen, since the form opens on today.
  await quiet();
  traffic.length = 0;
  await set('#snapshot-date', await format('date', DF));
  await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input') && l.querySelector('input').value !== ''; }, { args: [line('XAU-ozt')], label: 'the missing gold price proposed' });
  const fillingLine = await ev("document.querySelector('.prices-line').textContent");
  const usdTypable = await rec.call((query) => Boolean(document.querySelector(query).querySelector('input')), line('USD'));
  await set('#snapshot-value', '100');
  await formSave();
  const atDP = on(await stored('rate'), DF);
  check(
    'record-snapshot: a figure the form adds at a date already priced fills in only the units that date is missing',
    fillingLine === `${await format('longDate', DF)} already holds prices. This figure joins them. The prices it is missing will be recorded with this.` &&
      !usdTypable && rateAsks().length === 1 &&
      bytes(atDP.filter((r) => r.payload.symbol === 'USD')) === usdAtDP &&
      atDP.map((r) => r.payload.symbol).sort().join(',') === 'USD,XAU-ozt' &&
      atDP.find((r) => r.payload.symbol === 'XAU-ozt').payload.rateSource === 'proposed' &&
      on(await stored('snapshot'), DF).some((s) => s.accountId === id['Fund 1']),
    `${fillingLine} | ${atDP.map((r) => r.payload.symbol).join(',')} | asks ${rateAsks().length}`,
  );

  // The opened prices line of the single-holding form: a dollar
  // holding at a date with no recording, so both lines are proposals,
  // then both edited by hand so each chip names the figure replaced.
  const DW = ago(75);
  const prices = async () => {
    await openForm('Dollar cash');
    await set('#snapshot-date', await format('date', DW));
    await rec.waitUntil((query) => { const l = document.querySelector(query); return l && l.querySelector('input').value !== ''; }, { args: [line('USD')], label: 'the form proposals for the layout' });
    await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  };
  const widths = {};
  for (const width of [1280, 390]) {
    await viewport(width);
    await prices();
    // Before any edit: the proposals, gold's naming the earlier day it is for.
    const proposed = await layout('.dialog .rate-block');
    await typeLine('USD', '0.812345678901');
    await typeLine('XAU-ozt', '2111.123456789012');
    await quiet();
    const shown = await layout('.dialog .rate-block');
    // The longest provenance the vocabulary allows, in place of the short one.
    await ev(`document.querySelectorAll('.dialog .rate-meta .chip').forEach(c => { if (c.textContent) c.textContent = 'Edited from 0.931234567890123456'; })`);
    const longest = await layout('.dialog .rate-block');
    widths[width] = { proposed, shown, longest, dialog: await ev("document.querySelector('.dialog').getBoundingClientRect().width") };
    await closeDialogs();
  }
  const formLayout = widths[1280];
  check(
    'record-snapshot: the opened prices line shows each unit in full, without overlap or clipping, at a desktop width',
    formLayout.shown.problems.length === 0 && formLayout.longest.problems.length === 0 && formLayout.proposed.problems.length === 0 &&
      formLayout.proposed.seen.some((l) => l.unit === 'Gold' && l.chip.startsWith('Market rate as of ')) &&
      ['United States Dollar', 'Gold'].every((name) => formLayout.shown.seen.some((l) => l.unit === name && l.chip.startsWith('Edited from '))),
    JSON.stringify(formLayout),
  );
  check(
    'record-rate: the rate lines of the single-holding form stack at a desktop width and at a phone width, since its block is under 720px',
    formLayout.shown.width < 720 && widths[390].shown.width < 720 &&
      [1280, 390].every((w) => widths[w].proposed.seen.every((l) => l.stacked && l.chipBelow !== false) && widths[w].shown.seen.every((l) => l.stacked && l.chipBelow !== false) && widths[w].longest.seen.every((l) => l.stacked && l.chipBelow !== false)),
    JSON.stringify(widths),
  );
  check(
    'record-snapshot: the opened prices line has no overlap or clipping at a phone width',
    widths[390].shown.problems.length === 0 && widths[390].longest.problems.length === 0 && widths[390].proposed.problems.length === 0,
    JSON.stringify(widths[390]),
  );
  await home();

  const editRow = async (iso) => {
    await go(`#/holding/${id['Current account']}`);
    const label = await format('longDate', iso);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find(r => r.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach(b => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the edit form' });
    await quiet();
  };
  const ratesBeforeEdit = (await stored('rate')).length;
  traffic.length = 0;
  await editRow(D11);
  await set('#snapshot-value', '27000');
  await set('.dialog textarea', 'from the statement');
  await formSave();
  const edited = on(await stored('snapshot'), D11).find((s) => s.accountId === id['Current account']);
  check(
    'record-snapshot: editing a figure\'s value and note asks the proxy nothing, writes no price and runs no reload',
    rateAsks().length === 0 && (await stored('rate')).length === ratesBeforeEdit && edited && edited.recordId === firstEntry.recordId &&
      edited.payload.value === '27000' && typeReads('snapshot').length === 0 && typeReads('rate').length === 0 &&
      writesSent().every((r) => r.method === 'PUT' && bodyOf(r).recordType === 'snapshot'),
    traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
  );

  // Moving it to a date holding no recording records it there: that
  // date is priced, its own unit included, and the date it left is not.
  const DMOVE = isoOf(dayOf(D11) - 1);
  const leftPrices = bytes(on(await stored('rate'), D11));
  traffic.length = 0;
  await editRow(D11);
  await set('#snapshot-date', await format('date', DMOVE));
  await quiet();
  await formSave();
  const movedTo = on(await stored('snapshot'), DMOVE).find((s) => s.accountId === id['Current account']);
  const movedPrices = on(await stored('rate'), DMOVE);
  check(
    'record-snapshot: moving a figure to an empty date asks once for that date, then writes the snapshot, the prices and nothing else',
    rateAsks().length === 1 && rateAsks()[0].url.includes(`date=${DMOVE}`) && movedTo && movedTo.recordId === firstEntry.recordId &&
      movedPrices.map((r) => r.payload.symbol).sort().join(',') === 'USD,XAU-ozt' &&
      movedPrices.every((r) => r.payload.rateSource === 'proposed') &&
      bytes(on(await stored('rate'), D11)) === leftPrices &&
      writesSent().map((r) => `${r.method} ${bodyOf(r) ? bodyOf(r).recordType : ''}`).join(',') === 'PUT snapshot,PUT rate,PUT rate' &&
      typeReads('snapshot').length === 1 && typeReads('rate').length === 1,
    traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
  );

  // Back onto a date whose prices are complete: nothing is asked and
  // no stored price is written.
  traffic.length = 0;
  await editRow(DMOVE);
  await set('#snapshot-date', await format('date', D11));
  await quiet();
  await formSave();
  check(
    'record-snapshot: moving a figure to a date whose prices are complete asks the proxy nothing and writes no price',
    rateAsks().length === 0 && on(await stored('snapshot'), D11).some((s) => s.recordId === firstEntry.recordId) &&
      writesSent().every((r) => r.method === 'PUT' && bodyOf(r).recordType === 'snapshot'),
    traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
  );

  // A move whose prices do not save has still moved: the dialog stays
  // on it, names the units, and offers the date's own screen.
  const DX = ago(48);
  faults.push((r) => (r.method === 'PUT' && bodyOf(r).recordType === 'rate' ? 500 : null));
  traffic.length = 0;
  await editRow(D11);
  await set('#snapshot-date', await format('date', DX));
  await quiet();
  await formSave();
  faults.length = 0;
  const lostPrices = await formError();
  const lostState = await ev(`({
    save: [...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').disabled,
    open: [...document.querySelectorAll('.dialog .field-error button')].map(b => b.textContent).join(),
  })`);
  check(
    'record-snapshot: a move whose prices do not save has moved, names every unit, leaves Save inert and offers the recording',
    lostPrices.startsWith(`Moved to ${await format('fullDate', DX)}. The prices for USD and XAU-ozt on that date did not save.`) &&
      lostState.save && lostState.open === 'Open the recording' &&
      on(await stored('snapshot'), DX).some((s) => s.recordId === firstEntry.recordId) && on(await stored('rate'), DX).length === 0 &&
      writesSent().filter((r) => r.method === 'DELETE').length === 0,
    `${lostPrices} | ${JSON.stringify(lostState)}`,
  );
  await set('#snapshot-value', '27001');
  check(
    'record-snapshot: Save is live again once something changes after a move whose prices did not save',
    !(await ev("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').disabled")),
  );
  await closeDialogs();

  // Savings holds figures at the first recording, the refused one, the
  // backdate and No Content's date. Moving two of them onto the
  // backdate displaces its figure.
  const savingsRow = async (iso, button) => {
    await go(`#/holding/${id.Savings}`);
    const label = await format('longDate', iso);
    await rec.call((day, name) => [...document.querySelectorAll('.card .data-table tbody tr')].find(r => r.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach(b => { if (b.textContent === name) b.click(); }), label, button);
    await rec.waitUntil("document.querySelector('.dialog')", { label: 'the dialog' });
    await quiet();
  };
  await savingsRow(D9, 'Edit');
  await set('#snapshot-date', await format('date', D10));
  await formSave();
  const moveCopy = await ev("[...document.querySelectorAll('.dialog')].pop().textContent");
  await press('Move and delete', '.dialog');
  const savingsAt = (iso) => on(snapshotsNow, iso).filter((s) => s.accountId === id.Savings);
  let snapshotsNow = await stored('snapshot');
  check(
    'record-snapshot: moving onto an occupied date names the deletion, and leaves one record there',
    moveCopy.includes(`${await format('longDate', D10)} already holds a snapshot of`) && moveCopy.includes('Moving this entry there will delete it.') &&
      savingsAt(D10).length === 1 && savingsAt(D9).length === 0,
    moveCopy,
  );
  faults.push((r) => (r.method === 'DELETE' ? 500 : null));
  traffic.length = 0;
  await savingsRow(D5, 'Edit');
  await set('#snapshot-date', await format('date', D10));
  await formSave();
  await press('Move and delete', '.dialog');
  faults.length = 0;
  const order = writesSent().map((r) => r.method);
  snapshotsNow = await stored('snapshot');
  check(
    'record-snapshot: a move writes the snapshot, then the prices, then deletes, so a failed delete leaves both records',
    order[0] === 'PUT' && order.at(-1) === 'DELETE' && order.filter((m) => m === 'DELETE').length === 1 && savingsAt(D10).length === 2,
    order.join(','),
  );
  await closeDialogs();
  await go(`#/holding/${id.Savings}`);
  check(
    'record-snapshot: the two figures a failed move left are both flagged on the holding',
    (await ev("document.querySelectorAll('.card .data-table tbody tr.flagged').length")) === 2,
  );
  await ev("[...document.querySelectorAll('.card .data-table tbody tr.flagged button')].find(b => b.textContent === 'Keep this one').click()");
  await quiet();

  const firstSavings = on(await stored('snapshot'), D1).find((s) => s.accountId === id.Savings);
  await plantHere([{ ...snap('Savings', D1, '5001'), recordId: firstSavings.recordId, version: firstSavings.version + 1 }]);
  const savingsPlanted = bytes(on(await stored('snapshot'), D1).filter((s) => s.accountId === id.Savings));
  await savingsRow(D1, 'Edit');
  await set('#snapshot-value', '5002');
  await formSave();
  const stale = await formError();
  await closeDialogs();
  check(
    'record-snapshot: an edit from a tab holding a stale version is refused and overwrites nothing',
    stale.startsWith('This snapshot was changed in another tab.') &&
      bytes(on(await stored('snapshot'), D1).filter((s) => s.accountId === id.Savings)) === savingsPlanted,
    stale,
  );

  const ratesBeforeDelete = (await stored('rate')).length;
  await savingsRow(D10, 'Delete');
  await press('Delete', '.dialog');
  check('record-snapshot: deleting a figure deletes no price', (await stored('rate')).length === ratesBeforeDelete);

  // Silver has no rate source: its estimate from the first recording
  // values a figure today, and the form dates it.
  await openForm('Silver coins');
  await set('#snapshot-value', '2');
  await quiet();
  const silverForm = await ev("document.querySelector('#snapshot-value').parentElement.querySelector('.hint').textContent");
  const lineType = await ev("(() => { const s = getComputedStyle(document.querySelector('.price-date')); return s.fontSize + ' ' + s.fontWeight; })()");
  check(
    'record-rate: the form dates an estimate carried from an earlier day beneath the converted figure, in Label/meta type',
    silverForm.endsWith(`priced ${await format('longDate', D1)}`) && lineType === '13px 500',
    `${silverForm} | ${lineType}`,
  );
  await closeDialogs();

  // #229: a form opened before another window archived its holding.
  const DA = ago(65);
  await openForm('Fund 2');
  await set('#snapshot-date', await format('date', DA));
  await set('#snapshot-value', '5');
  await archiveElsewhere('Fund 2', T);
  traffic.length = 0;
  await formSave();
  const archivedForm = await formError();
  await closeDialogs();
  check(
    'record-snapshot: a form open since before its holding was archived elsewhere records nothing, at an earlier date too, and says so',
    archivedForm === 'Fund 2 was archived in another window. Nothing was saved.' && writesSent().length === 0 &&
      on(await stored('snapshot'), DA).every((s) => s.accountId !== id['Fund 2']),
    archivedForm,
  );

  await plantHere([snap('Fund 3', DA, '3')]);
  await reread();
  await go(`#/holding/${id['Fund 3']}`);
  await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find(r => r.cells[0].textContent.startsWith(day))
    .querySelectorAll('button').forEach(b => { if (b.textContent === 'Edit') b.click(); }), await format('longDate', DA));
  await rec.waitUntil("document.querySelector('#snapshot-date')", { label: 'the edit form' });
  await set('#snapshot-date', await format('date', ago(5)));
  await archiveElsewhere('Fund 3', ago(8));
  traffic.length = 0;
  await formSave();
  const archivedMove = await formError();
  await closeDialogs();
  check(
    'record-snapshot: a move onto or past an archive made elsewhere since the form opened is refused and moves nothing',
    archivedMove === 'Fund 3 was archived in another window. Nothing was moved.' && writesSent().length === 0 &&
      on(await stored('snapshot'), DA).some((s) => s.accountId === id['Fund 3']),
    archivedMove,
  );
});
