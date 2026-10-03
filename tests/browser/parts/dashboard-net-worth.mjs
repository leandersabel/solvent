// The dashboard over a vault with a history (spec/ui/dashboard.md): the
// month grid New recording opens, the chart, its controls and what they
// ask of the server, a record that cannot be read, a provider that
// revises its figures, and archived holdings on the chart.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js,
// datepicker.js, model.js, format.js, decimal.js.
import { check, run } from '../harness.mjs';
import { startRecorder } from '../recorder.mjs';

await run(async () => {
  const r = await startRecorder();
  await r.register();
  await r.seed();
  // What the sweeps that came before leave: today's recording, and a past
  // one that confirmed what each holding last held.
  const atD10 = { ...r.FIRST, 'Current account': '1100', Brokerage: '2100', 'Dollar cash': '350.77', Art: '3' };
  delete atD10['Fund 5'];
  await r.plantHere([
    r.snap('Current account', r.T, '1234.56'),
    r.price('USD', r.T, r.proposalsFor(r.T).USD.rate, 'proposed'),
    r.price('XAU-ozt', r.T, r.proposalsFor(r.T)['XAU-ozt'].rate, 'proposed'),
    ...Object.entries(atD10).map(([name, value]) => r.snap(name, r.D10, value)),
    r.price('USD', r.D10, r.proposalsFor(r.D10).USD.rate, 'proposed'),
    { type: 'rate', payload: { symbol: 'XAU-ozt', date: r.D10, rate: '2711.13', rateTarget: 'CHF', rateSource: 'edited', rateAsOf: r.proposalsFor(r.D10)['XAU-ozt'].asOf, proposedRate: r.proposalsFor(r.D10)['XAU-ozt'].rate } },
  ]);
  await r.reread();
  await r.home();

  const {
    rec, dayOf, isoOf, T, ago, D1, D2, D10,
    proxy, proposalsFor, traffic, unwatched, writesSent, rateAsks, ev, text, quiet,
    press, realClick, uncovered, realKey, stored, on, bytes, plantHere,
    reread, go, format, model, line, lineState, figure, tableRow,
    hero, home, sweepToday, script, id, price,
  } = r;

  traffic.length = 0;
  await press('New recording');
  const picker = await ev(`JSON.stringify({
    focused: document.activeElement.classList.contains('is-today'),
    marked: [...document.querySelectorAll('.date-day.has-recording')].map(b => b.getAttribute('aria-label')),
    todayName: document.querySelector('.date-day.is-today').getAttribute('aria-label'),
  })`).then(JSON.parse);
  const tomorrowDisabled = await ev(`(() => {
    const days = [...document.querySelectorAll('.date-day')];
    const at = days.findIndex(b => b.classList.contains('is-today'));
    return at === days.length - 1 || days[at + 1].disabled;
  })()`);
  await press('Cancel', '.dialog');
  check(
    'net-worth-view: New recording opens a month grid on today, marks a recorded date in its name, and refuses the future',
    picker.focused && picker.todayName === `${await format('dayMonth', T)}, has a recording` && tomorrowDisabled,
    JSON.stringify(picker),
  );
  check('net-worth-view: dismissing the date picker writes nothing and asks nothing', traffic.length === 0);

  // The New recording dialog is the month grid and a Cancel, nothing
  // else, and nothing is painted over any part of it. The checks above
  // press with element.click(), which does not notice a calendar laid
  // over the dialog, so these use hit-testing and real input events.
  traffic.length = 0;
  // A person presses it, so it is the focused control, which is where
  // Cancel and Escape have to return the focus to.
  await realClick('button', 'New recording');
  const shape = JSON.parse(await ev(`JSON.stringify({
    heading: document.querySelector('.dialog-heading')?.textContent,
    dialogs: document.querySelectorAll('.dialog').length,
    popups: document.querySelectorAll('.date-popover').length,
    fields: document.querySelectorAll('.dialog input, .dialog .date-field, #recording-date').length,
    hints: document.querySelectorAll('.dialog .hint').length,
    buttons: [...document.querySelectorAll('.dialog button')].filter(b => !b.classList.contains('date-day')).map(b => b.textContent.trim() || b.getAttribute('aria-label')),
    actions: [...document.querySelectorAll('.dialog-actions button')].map(b => b.textContent + ':' + b.className),
    title: document.querySelector('.dialog .date-title')?.textContent || '',
    focusedToday: document.activeElement.classList.contains('is-today'),
    nextDisabled: document.querySelector('.dialog [aria-label="Next month"]')?.disabled,
    previousDisabled: document.querySelector('.dialog [aria-label="Previous month"]')?.disabled,
    todayDated: document.querySelector('.date-day.is-today')?.dataset.date,
    strayText: [...document.querySelectorAll('.dialog .date-picker')].flatMap(p => [...p.childNodes]).filter(n => n.nodeType !== 1).length,
    showsNull: document.querySelector('.dialog').textContent.includes('null'),
  })`));
  check(
    'dashboard: New recording opens one dialog headed "New recording" whose body is the month grid, with no date field, hint, Open or popup',
    shape.heading === 'New recording' && shape.dialogs === 1 && shape.popups === 0 && shape.fields === 0 && shape.hints === 0 &&
      !shape.buttons.includes('Open') && !shape.buttons.includes('Close') && shape.actions.length === 1 &&
      shape.actions[0] === 'Cancel:btn-secondary' && shape.title !== '' && shape.focusedToday && shape.todayDated === T &&
      shape.strayText === 0 && !shape.showsNull,
    JSON.stringify(shape),
  );
  check(
    'dashboard: the date picker opens on the current month, with Next month disabled and Previous month enabled',
    shape.nextDisabled === true && shape.previousDisabled === false,
    JSON.stringify(shape),
  );
  const covered = [];
  for (const [selector, label] of [
    ['.dialog-heading', null],
    ['.dialog .date-title', null],
    ['.dialog [aria-label="Previous month"]', null],
    ['.dialog .date-day.is-today', null],
    ['.dialog-actions button', 'Cancel'],
  ]) {
    if (!(await uncovered(selector, label))) covered.push(label || selector);
  }
  check(
    'dashboard: nothing is painted over the dialog\'s heading, month, buttons, today or Cancel',
    covered.length === 0,
    covered.join(', '),
  );
  traffic.length = 0;
  await realClick('.dialog-actions button', 'Cancel');
  check(
    'dashboard: a real click on Cancel closes the picker at once, writes and asks nothing, and returns focus to New recording',
    (await ev("document.querySelectorAll('.dialog').length")) === 0 && traffic.length === 0 &&
      (await ev("document.activeElement.textContent.trim()")) === 'New recording',
    `${await ev("document.querySelectorAll('.dialog').length")} dialogs, ${traffic.length} requests, focus on ${await ev('document.activeElement.textContent.trim()')}`,
  );
  await realClick('button', 'New recording');
  await realKey('Escape', 'Escape', 27);
  check(
    'dashboard: a real Escape closes the picker with no traffic and returns focus to New recording',
    (await ev("document.querySelectorAll('.dialog').length")) === 0 && traffic.length === 0 &&
      (await ev("document.activeElement.textContent.trim()")) === 'New recording',
  );

  // Arrow keys move the focus a day and a week at a time, and cannot
  // leave the past.
  await press('New recording');
  const focusedDate = () => ev('document.activeElement.dataset.date || null');
  await realKey('ArrowLeft', 'ArrowLeft', 37);
  const dayBefore = await focusedDate();
  await realKey('ArrowUp', 'ArrowUp', 38);
  const weekBefore = await focusedDate();
  await realKey('ArrowRight', 'ArrowRight', 39);
  const weekLess = await focusedDate();
  await realKey('ArrowDown', 'ArrowDown', 40);
  const backToday = await focusedDate();
  await realKey('ArrowDown', 'ArrowDown', 40);
  await realKey('ArrowRight', 'ArrowRight', 39);
  const stillToday = await focusedDate();
  check(
    'dashboard: the arrow keys move the focus by a day and by a week, and stop at today',
    dayBefore === ago(1) && weekBefore === ago(8) && weekLess === ago(7) && backToday === T && stillToday === T,
    JSON.stringify({ dayBefore, weekBefore, weekLess, backToday, stillToday }),
  );
  const titleNow = await ev("document.querySelector('.dialog .date-title').textContent");
  await realClick('.dialog [aria-label="Previous month"]');
  const titleBefore = await ev("document.querySelector('.dialog .date-title').textContent");
  const nextOnPast = await ev("document.querySelector('.dialog [aria-label=\"Next month\"]').disabled");
  await realClick('.dialog [aria-label="Next month"]');
  check(
    'dashboard: Previous month shows the month before, which can be stepped forward again, and the future is not reachable',
    titleBefore !== titleNow && nextOnPast === false &&
      (await ev("document.querySelector('.dialog .date-title').textContent")) === titleNow &&
      (await ev("document.querySelector('.dialog [aria-label=\"Next month\"]').disabled")) === true &&
      (await ev("[...document.querySelectorAll('.dialog .date-day')].filter(b => b.dataset.date > " + JSON.stringify(T) + ").every(b => b.disabled)")),
  );
  traffic.length = 0;
  await realClick(`.dialog .date-day[data-date="${T}"]`);
  check(
    'dashboard: a real click on a marked day closes the picker and opens its recording at once, with no request',
    (await ev("document.querySelectorAll('.dialog').length")) === 0 && (await ev('location.hash')) === `#/recording/${T}` && traffic.length === 0,
    `${await ev('location.hash')} ${traffic.length}`,
  );
  await home();
  // ---- net-worth-view: the dashboard over the recorder vault --------------

  check('net-worth-view: the chart loads with its entry marks showing', (await ev("document.querySelectorAll('.entry-mark').length")) > 0);
  check(
    'net-worth-view: a history shorter than a year opens on All',
    (await ev("document.querySelector('.range-buttons .active').textContent")) === 'All',
  );
  traffic.length = 0;
  await ev(`(() => { const s = [...document.querySelectorAll('.chart-card select')][0]; s.value = 'liq'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await rec.frames();
  const modeBefore = {
    hero: await hero(),
    brokerage: (await tableRow('Brokerage')).converted,
    bars: await ev("[...document.querySelectorAll('.bar-amount')].map(b => b.textContent).join('|')"),
    chart: await ev("document.querySelector('svg.trend').innerHTML"),
  };
  await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('as of each figure')).click()");
  await rec.frames();
  const modeAfter = {
    hero: await hero(),
    brokerage: (await tableRow('Brokerage')).converted,
    bars: await ev("[...document.querySelectorAll('.bar-amount')].map(b => b.textContent).join('|')"),
    chart: await ev("document.querySelector('svg.trend').innerHTML"),
  };
  check(
    'net-worth-view: the pricing mode moves the total, the table and the breakdown, and no chart point',
    modeAfter.hero !== modeBefore.hero && modeAfter.brokerage !== modeBefore.brokerage && modeAfter.bars !== modeBefore.bars &&
      modeAfter.chart === modeBefore.chart,
    JSON.stringify({ ...modeBefore, chart: null, after: { ...modeAfter, chart: null } }),
  );
  await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('Latest rates')).click()");
  await rec.frames();
  const marksOn = await ev(`(() => {
    const copy = document.querySelector('svg.trend').cloneNode(true);
    copy.querySelectorAll('.entry-mark').forEach(n => n.remove());
    return copy.innerHTML;
  })()`);
  await ev("document.querySelector('.chart-card input[type=checkbox]').click()");
  await rec.frames();
  check(
    'net-worth-view: Just the line takes the entry marks away and changes nothing else',
    (await ev("document.querySelectorAll('.entry-mark').length")) === 0 && (await ev("document.querySelector('svg.trend').innerHTML")) === marksOn,
  );
  await ev("document.querySelector('.chart-card input[type=checkbox]').click()");
  await ev("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
  await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent === 'Percentage').click()");
  await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent === 'Absolute').click()");
  await ev("document.querySelector('.legend-entry').click()");
  await ev("document.querySelector('.legend-entry').click()");
  await rec.idle();
  check(
    'net-worth-view: range, dimension, scale, pricing mode, band visibility and Just the line issue no request',
    traffic.length === 0,
    traffic.map((r) => r.url).join(' | '),
  );
  await ev("window.__alerted = false; window.alert = () => { window.__alerted = true; }");
  const scripts = await ev("document.querySelectorAll('script').length");
  await ev(`(() => {
    const svg = document.querySelector('svg.trend');
    const box = svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent('pointermove', { clientX: box.right - 10, clientY: box.top + 20, bubbles: true }));
  })()`);
  await rec.frames();
  const literal = await ev(`JSON.stringify({
    row: [...document.querySelectorAll('.holdings-table .row-name')].some(n => n.textContent === ${JSON.stringify(script)}),
    legend: [...document.querySelectorAll('.legend-name')].some(n => n.textContent === ${JSON.stringify(script)}),
    tooltip: document.querySelector('.chart-readout').textContent.includes(${JSON.stringify(script)}),
    chip: [...document.querySelectorAll('.holdings-table .chip')].some(n => n.textContent === 'Liquidity: ' + ${JSON.stringify(script)}),
  })`).then(JSON.parse);
  check(
    'net-worth-view: a holding and a dimension value named as a script read as literal text in the table, the legend and the tooltip',
    literal.row && literal.legend && literal.tooltip && literal.chip &&
      (await ev("document.querySelectorAll('script').length")) === scripts && !(await ev('window.__alerted')),
    JSON.stringify(literal),
  );

  // Hover, the keyboard and a drag across the plot.
  const pointer = (type, across) =>
    ev(`(() => {
      const svg = document.querySelector('svg.trend');
      const box = svg.getBoundingClientRect();
      svg.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
        clientX: box.left + box.width * ${across}, clientY: box.top + 40, button: 0, bubbles: true,
      }));
    })()`);
  await go('#/');
  const total = await ev("document.querySelector('.hero-amount').textContent");
  await pointer('pointermove', 0.5);
  const hovered = await ev(`JSON.stringify({
    hero: document.querySelector('.hero-amount').textContent,
    at: document.querySelector('.hero-at').textContent,
    rows: [...document.querySelectorAll('.chart-readout p')].map(p => p.className),
    net: document.querySelector('.readout-net').textContent,
    crosshair: document.querySelector('.crosshair').getAttribute('visibility'),
  })`).then(JSON.parse);
  await pointer('pointerleave', 0.5);
  check(
    'net-worth-view: hovering moves a crosshair, pins the date, bands and net above it, and the hero follows',
    hovered.crosshair === 'visible' && hovered.rows[0] === 'readout-date' && hovered.rows.at(-1).includes('readout-net') &&
      hovered.at.startsWith('on ') && Math.round(figure(hovered.net)) === figure(hovered.hero) &&
      (await ev("document.querySelector('.hero-amount').textContent")) === total,
    JSON.stringify(hovered),
  );
  await ev("document.querySelector('svg.trend').focus()");
  await ev("document.querySelector('svg.trend').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))");
  const stepped = await ev("document.querySelector('.hero-at').textContent");
  await ev("document.querySelector('svg.trend').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  await rec.frames();
  const opened = await ev('location.hash');
  check(
    'net-worth-view: the arrow keys step between recorded dates and Enter opens that recording',
    opened.startsWith('#/recording/') && stepped === `on ${await format('longDate', opened.split('/').pop())}`,
    `${stepped} then ${opened}`,
  );
  await go('#/');
  await ev(`(() => { const s = document.querySelector('.chart-card select'); s.value = 'liq'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await rec.frames();
  await pointer('pointerdown', 0.3);
  await pointer('pointermove', 0.8);
  await pointer('pointerup', 0.8);
  await rec.frames();
  const span = await ev(`JSON.stringify({
    since: document.querySelector('.hero-since').textContent,
    rect: document.querySelectorAll('svg.trend rect.selection:not([visibility])').length,
    deltas: [...document.querySelectorAll('.legend-delta')].map(n => n.textContent),
    bands: document.querySelectorAll('.legend-entry').length,
  })`).then(JSON.parse);
  await pointer('pointerdown', 0.5);
  await pointer('pointerup', 0.5);
  await rec.frames();
  check(
    'net-worth-view: a drag selects a span, the hero reads the change across it and each band its own',
    span.since.startsWith('from ') && span.rect === 1 && span.deltas.length === span.bands && span.bands > 1,
    JSON.stringify(span),
  );
  check(
    'net-worth-view: a plain click clears the selected span',
    (await ev("document.querySelectorAll('.legend-delta').length")) === 0 && (await ev("document.querySelector('.hero-since').textContent")).startsWith('since '),
  );

  // One price entry sealed where no key opens it, between two readable
  // ones.
  const between = isoOf(dayOf(D2) + 30);
  const [corrupt] = await plantHere([{ ...price('USD', between, '5', 'manual'), corrupt: true }]);
  await reread();
  await go('#/unassigned/none');
  await go('#/');
  const warning = await ev("document.querySelector('.banner-critical span').textContent");
  const listed = await ev("[...document.querySelectorAll('.unreadable-list li')].map(n => n.textContent)");
  const priced = await model(`{
    shown: decimal.format(v.priceAt('USD', dayNumber('${between}'))),
    expected: decimal.format(decimal.interpolate(dayNumber('${between}'), dayNumber('${D2}'), decimal.parse('0.92'),
      dayNumber('${D10}'), decimal.parse('${proposalsFor(D10).USD.rate}'))),
  }`);
  check(
    'net-worth-view: one unreadable record is named in the warning, and its symbol prices from the neighboring entries',
    warning === '1 record could not be read.' && listed.includes(corrupt) && priced.shown === priced.expected,
    JSON.stringify({ warning, listed, priced }),
  );
  await unwatched(() => ev(`(async () => { await (await import('/static/js/api.js')).del('/api/records/${corrupt}'); })()`));
  await reread();

  // The provider revises what it published. Nothing was recorded, so
  // nothing reads differently, and reopening the recording it
  // revised asks it nothing.
  const backdateUsd = Number(proposalsFor(D10).USD.rate);
  proxy.mode = 'revised';
  await go('#/unassigned/none');
  await go('#/');
  const heroBefore = await hero();
  const tableBefore = await ev("document.querySelector('.holdings-table').textContent");
  const backdateBefore = bytes(on(await stored('snapshot'), D10)) + bytes(on(await stored('rate'), D10));
  traffic.length = 0;
  await go(`#/recording/${D10}`);
  await press('Update');
  await rec.waitUntil("document.querySelector('.sweep-row')", { label: 'the sweep' });
  await quiet();
  const reopenedUsd = await lineState('USD');
  check(
    'record-rate: a reopened recording opens on its stored rates, not on a fresh proposal',
    figure(reopenedUsd.value) === backdateUsd && reopenedUsd.chip === 'Market rate',
    JSON.stringify(reopenedUsd),
  );
  await home();
  await reread();
  await go('#/unassigned/none');
  await go('#/');
  check(
    'record-rate: opening a recording the provider has since revised asks the proxy nothing and writes nothing',
    rateAsks().length === 0 && writesSent().length === 0 &&
      bytes(on(await stored('snapshot'), D10)) + bytes(on(await stored('rate'), D10)) === backdateBefore,
    traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
  );
  check(
    'net-worth-view: a revised provider figure with nothing recorded changes no figure anywhere',
    (await hero()) === heroBefore && (await ev("document.querySelector('.holdings-table').textContent")) === tableBefore,
  );
  proxy.mode = 'answer';

  // Archiving records the zero, and the dates after the holding's last figure run down to it.
  const chartRows = () =>
    ev(`(async () => {
      [...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return [...document.querySelectorAll('details table tbody tr')].map(r => r.textContent);
    })()`);
  const archive = async (name) => {
    await go(`#/holding/${id[name]}`);
    await press('Archive', '.form-actions');
    await rec.waitUntil("document.querySelector('.dialog')", { label: `the archive dialog for ${name}` });
    await press('Archive', '.dialog');
    await rec.waitUntil("!document.querySelector('.dialog')", { label: `the archive of ${name} to land` });
    await quiet();
  };
  await go('#/');
  const shapeBefore = await chartRows();
  const totalBefore = await hero();
  await archive('Fund 4');
  await go('#/');
  const shapeAfter = await chartRows();
  // Fund 4's only figure was on D1, so that is as far as the zero leaves
  // the chart as it was: later dates run down to it like any new last figure.
  check(
    'net-worth-view: archiving leaves every chart point up to the holding\'s last figure, and leaves the total',
    shapeBefore[0].startsWith(await format('date', D1)) && shapeBefore[0] === shapeAfter[0] &&
      (await hero()) !== totalBefore && !(await tableRow('Fund 4')),
  );
  await pointer('pointermove', 0.999);
  check(
    'net-worth-view: the archive is annotated on the chart, and the tooltip at its date names the holding',
    (await ev("[...document.querySelectorAll('.archive-annotation title')].some(t => t.textContent === 'Fund 4 archived')")) &&
      (await ev("document.querySelector('.chart-readout').textContent")).includes('Fund 4 archived'),
    await ev("document.querySelector('.chart-readout').textContent"),
  );
  await pointer('pointerleave', 0.999);
  await archive('Fund 3');
  const closing = on(await stored('snapshot'), T).find((s) => s.accountId === id['Fund 3']);
  await go(`#/holding/${id['Fund 3']}`);
  const archivedActions = await ev("[...document.querySelectorAll('.form-actions button')].map(b => b.textContent)");
  await sweepToday();
  check(
    'record-snapshot: an archived holding takes no new figure, and its archive wrote a zero',
    closing && closing.payload.value === '0' && !archivedActions.includes('Record a value') &&
      // The update screen shows its zero as text, with no control to change it.
      (await ev(`['Fund 3', 'Fund 4'].every((name) => {
        const r = [...document.querySelectorAll('.sweep-row')].find((n) => n.querySelector('.holding-name').textContent === name);
        return r && r.querySelector('.row-state').textContent === 'Archived at zero on this date.' &&
          r.querySelector(':scope > button').hidden && r.querySelector('.quantity-field').hidden;
      })`)),
    JSON.stringify({ closing: closing && closing.payload, archivedActions }),
  );
  await home();

}, { signsIn: false });
