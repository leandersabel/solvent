// A recording's own screen (spec/features/record-snapshot.md, Recording
// detail): one date and everything recorded at it, the way back into a
// sitting, and deleting the recording, whole or partway.
// Templates: dashboard.html. Modules: view-recording.js, view-sweep.js,
// writes.js, model.js, datepicker.js, view-dashboard.js.
import { BACKDATE, check, click, idNamed, labels, page, proxyAsks, recording, run, story, text, unlockDashboard, vaultOwner } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  await vaultOwner();
  await story({ backdated: false });
  await unlockDashboard('the dashboard of the story');
  const asksBefore = proxyAsks.length;
  const rateCalls = () => proxyAsks.length - asksBefore;

  // ---- The recording's own screen -------------------------------------

  await page.eval("document.querySelector('.entry-mark').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: "the recording's screen" });
  await page.idle();
  check('the recording lists what went in that day', (await page.eval("document.querySelectorAll('.card tbody tr').length")) >= 4);
  const chips = await labels('.chip');
  check('each price says where it came from', chips.some((chip) => chip.startsWith('Market rate')), chips.join(','));
  // design-system.md, Units: a price line names its unit in full.
  const priceUnits = await page.eval("JSON.stringify([...document.querySelectorAll('tr[data-unit]')].map((r) => [r.dataset.unit, r.cells[0].textContent]))").then(JSON.parse);
  check(
    'a price line names its unit in full, never by its symbol',
    priceUnits.some(([symbol, name]) => symbol === 'XAU-ozt' && name === 'Gold, troy ounce') &&
      priceUnits.every(([symbol, name]) => !/^X[A-Z]{2}-/.test(name) && (symbol.includes('-') || name === symbol)),
    JSON.stringify(priceUnits),
  );
  check('the recording offers Update and Delete', (await labels('.form-actions button')).join(',') === 'Update,Delete');
  const beforeOpen = rateCalls();
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.entry-mark')", { label: 'the dashboard' });
  await page.eval("document.querySelector('.entry-mark').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: "the recording's screen again" });
  await page.idle();
  check('opening a recording asks the source nothing', rateCalls() === beforeOpen);


  // A second recording, earlier than the first.
  await recording(BACKDATE, { 'Cantonal account': '11000.00' });
  await unlockDashboard('the dashboard with its two recordings');

  // ---- Deleting a recording ---------------------------------------------

  const marksBefore = await page.eval("document.querySelectorAll('.entry-mark').length");
  await page.eval("document.querySelectorAll('.entry-mark')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: 'a recording to delete' });
  await page.frames();
  await click('Delete');
  await page.waitUntil("document.body.innerText.includes('Delete the recording for')", { label: 'the delete dialog' });
  check('the confirmation says the prices go too', (await text()).includes('every price captured with it'));
  check('it names how many holdings move', /\d+ holdings measured in/.test(await text()));
  check('it says there is no way back', (await text()).includes('cannot be undone'));
  await click('Delete the recording');
  await page.waitUntil("location.hash === '#/'", { timeout: 60000, label: 'the dashboard after deleting' });
  await page.idle();
  check(
    'the date is gone from the chart',
    (await page.eval("document.querySelectorAll('.entry-mark').length")) === marksBefore - 1,
  );

  // ---- On a phone ---------------------------------------------------------

  // app-shell.md, On a phone, and Recording detail, At phone width: with
  // the widest lines it can hold, two seven-digit figures for one holding
  // on one date, nothing pans or scrolls sideways and every control lies
  // on the screen where a tap at its center lands on it.
  const goldId = (await idNamed('Gold bars'))[0];
  await page.call(async (id, day) => {
    const writes = await import('/static/js/writes.js');
    const v = (await import('/static/js/session.js')).currentVault();
    await writes.saveSnapshot(v, id, null, { date: day, value: '1234567.125', note: null });
    await writes.saveSnapshot(v, id, null, { date: day, value: '1234567.250', note: null });
  }, goldId, BACKDATE);
  await page.call((day) => { location.hash = `#/recording/${day}`; }, BACKDATE);
  await page.waitUntil("document.querySelectorAll('.recording tr.flagged').length === 2", { label: 'the recording with its widest lines' });
  for (const width of [320, 375, 601, 901]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: width < 600 });
    await page.frames();
    const fit = await page.eval(`(() => {
      const problems = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth) problems.push('the page pans: ' + doc.scrollWidth);
      for (const n of document.querySelectorAll('#app *')) {
        if (getComputedStyle(n).overflowX !== 'visible' && n.scrollWidth > n.clientWidth + 0.5) problems.push('scrolls sideways: ' + n.className);
      }
      for (const n of document.querySelectorAll('#app button, #app a')) {
        n.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = n.getBoundingClientRect();
        if (!r.width) continue;
        const name = n.textContent || n.getAttribute('aria-label');
        if (r.left < -0.5 || r.right > innerWidth + 0.5) problems.push('off the screen: ' + name);
        else if (!n.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2))) problems.push('covered: ' + name);
        if (innerWidth <= 900 && n.closest('.recording tbody') && r.height < 44) problems.push('under 44px: ' + name);
      }
      return problems;
    })()`);
    check(`at ${width}px the recording fits the screen, Keep this one included, each control tappable`, fit.length === 0, fit.join(' | '));
  }
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
  await page.frames();


  // ---- A recording that stops partway, in a vault of its own --------

  const r = await startRecorder();
  await r.register();
  await r.seed();
  // The date a recording is picked at, which holds figures and prices.
  await r.plantHere([
    r.snap('Current account', r.D10, '1100'),
    r.snap('Brokerage', r.D10, '2100'),
    r.price('USD', r.D10, r.proposalsFor(r.D10).USD.rate, 'proposed'),
    r.price('XAU-ozt', r.D10, r.proposalsFor(r.D10)['XAU-ozt'].rate, 'proposed'),
  ]);
  await r.reread();
  await r.home();
  const {
    rec, D1, D10, ago, id, proxy, traffic, faults, ev, press, set, quiet, stored,
    on, bytes, go, figure, format, home, newRecording, plantHere, reread, rateAsks, snap, price, proposalsFor,
  } = r;

  // ---- record-snapshot: the date picker and deleting a recording ----------

  await home();
  traffic.length = 0;
  const saidMarked = await newRecording(D10);
  check(
    'record-snapshot: picking a date that holds a recording opens it, with no request and no create',
    saidMarked.marked && (await ev('location.hash')) === `#/recording/${D10}` && traffic.length === 0,
    JSON.stringify(saidMarked),
  );
  await go(`#/recording/${D1}`);
  let deletes = 0;
  faults.push((r) => (r.method === 'DELETE' && (deletes += 1) === 3 ? 500 : null));
  await press('Delete');
  await press('Delete the recording', '.dialog');
  faults.length = 0;
  const partial = await ev("document.querySelector('.recording .field-error').textContent");
  const leftAtFirst = on(await stored('snapshot'), D1).concat(on(await stored('rate'), D1));
  check(
    'record-snapshot: a delete that stops partway rolls nothing back, and says what is left',
    partial.startsWith('Part of the recording is still there:') && leftAtFirst.length === 1 && leftAtFirst.every((r) => r.payload),
    partial,
  );
  await press('Delete');
  await press('Delete the recording', '.dialog');
  const goneAtFirst = on(await stored('snapshot'), D1).length + on(await stored('rate'), D1).length;
  const freeAgain = await newRecording(D1);
  check(
    'record-snapshot: deleting a recording removes every figure and price at the date, and the date is new again',
    goneAtFirst === 0 && !freeAgain.marked && !freeAgain.dotted,
    JSON.stringify(freeAgain),
  );

  // ---- record-rate: a moved figure is priced at its new date ------------

  // A dollar figure from 2010 and the one dollar price of that year.
  const DY = '2010-01-05';
  await plantHere([snap('Brokerage', DY, '100'), price('USD', DY, '1.0287', 'proposed')]);
  await reread();
  const figureAt = async (to, name) => {
    await go(`#/recording/${to}`);
    return rec.call((holding) => ({
      cells: [...document.querySelectorAll('.recording .card')[0].querySelectorAll('tbody tr')]
        .find(row => row.cells[0].textContent === holding).cells[2].textContent,
      prices: document.querySelectorAll('.recording .card')[1].textContent,
    }), name);
  };
  const moveFigure = async (from, to) => {
    await go(`#/holding/${id.Brokerage}`);
    const label = await format('longDate', from);
    await rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')].find(r => r.cells[0].textContent.startsWith(day))
      .querySelectorAll('button').forEach(b => { if (b.textContent === 'Edit') b.click(); }), label);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the edit form' });
    await quiet();
    traffic.length = 0;
    await set('#snapshot-date', await format('date', to));
    await quiet();
    await ev("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()");
    await quiet();
    return figureAt(to, 'Brokerage');
  };
  const usdAtDY = bytes(on(await stored('rate'), DY));
  const DM = ago(70);
  const priced = await moveFigure(DY, DM);
  const proposedUsd = proposalsFor(DM).USD.rate;
  check(
    'record-rate: a figure moved onto an empty date is priced at that date, from one request for it',
    rateAsks().length === 1 && rateAsks()[0].url.includes(`date=${DM}`) &&
      on(await stored('rate'), DM).some((p) => p.payload.symbol === 'USD' && p.payload.rate === proposedUsd) &&
      figure(priced.cells) === Number((100 * Number(proposedUsd)).toFixed(2)) && !priced.cells.includes('priced'),
    `${rateAsks().length} asks | ${priced.cells}`,
  );
  check(
    'record-rate: a move rewrites no stored price and the date the entry left keeps its own',
    bytes(on(await stored('rate'), DY)) === usdAtDY && on(await stored('snapshot'), DY).length === 0,
  );
  // The source answers nothing for the next date: the figure reads not
  // priced, though 2010 and the date it left both hold a dollar price.
  proxy.mode = 'none';
  const DN = ago(80);
  const unpriced = await moveFigure(DM, DN);
  proxy.mode = 'answer';
  check(
    'record-rate: a moved figure whose date has no price reads not priced, never at another day\'s',
    rateAsks().length === 1 && on(await stored('rate'), DN).length === 0 &&
      unpriced.cells === 'not priced' && unpriced.prices.includes('No prices were captured at this date.'),
    `${unpriced.cells} | ${unpriced.prices}`,
  );
  // Recording detail, States: only a unit whose source did not answer is
  // named. Nothing will ever fill silver, m2 or PAINT.
  check(
    'record-snapshot: a recording names the unit its source left empty, never one only its owner can price',
    unpriced.prices.includes('No price for USD at this date.') &&
      ['Silver', 'm2', 'PAINT'].every((unit) => !unpriced.prices.includes(unit)),
    unpriced.prices,
  );

  // The holding's own list reads the same way: not priced where a
  // sourced unit has no price on the row's date.
  await go(`#/holding/${id.Brokerage}`);
  const historyCell = (iso) =>
    format('longDate', iso).then((label) => rec.call((day) => [...document.querySelectorAll('.card .data-table tbody tr')]
      .find(row => row.cells[0].textContent.startsWith(day)).cells[2].textContent, label));
  check(
    'record-rate: the holding\'s own list reads not priced on a date its sourced unit holds no price for',
    (await historyCell(DN)) === 'not priced',
    await historyCell(DN),
  );

  // A unit nobody publishes a price for keeps its owner's estimate, dated.
  const DE = ago(150);
  const DS = ago(15);
  await plantHere([price('XAG-ozt', DE, '26'), snap('Silver coins', DS, '10')]);
  await reread();
  const aged = await figureAt(DS, 'Silver coins');
  check(
    'record-rate: a figure in a unit with no rate source converts at its newest earlier estimate, dated beneath the figure',
    aged.cells.endsWith(`priced ${await format('longDate', DE)}`) && figure(aged.cells.split('priced')[0]) === 260,
    aged.cells,
  );
  await go(`#/holding/${id['Silver coins']}`);
  const silverCell = await historyCell(DS);
  check(
    'record-rate: the holding\'s own list dates the estimate beneath the figure too',
    silverCell.endsWith(`priced ${await format('longDate', DE)}`),
    silverCell,
  );
});
