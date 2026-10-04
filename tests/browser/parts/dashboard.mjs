// The dashboard (spec/ui/dashboard.md): the total, the chart, the table of
// holdings and what the screen says of a vault that holds two entries for
// one date.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js, model.js,
// format.js, decimal.js.
import {
  BASE, VAULT_PASSWORD, check, enterPassword, fetchOff, fetchOn, holdings, importOwnExport, isRateAsk, labels, page, plant, recording, reloadModel, run, setProfile,
  story, text, unlockDashboard, vaultOwner,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await story({ backdated: false });
  await unlockDashboard('the dashboard of the story');

  // ---- The dashboard -------------------------------------------------

  const hero = await page.eval("document.querySelector('.hero-figure').textContent");
  check('the hero carries a total in the main currency', hero.includes('CHF'), hero);
  // Read from the markup: the labels are set in capitals by the
  // stylesheet, which innerText reports.
  check(
    'gross assets and liabilities are both shown',
    (await page.eval("document.querySelector('.hero').textContent")).includes('Liabilities'),
  );
  check('the chart is drawn', await page.eval("Boolean(document.querySelector('svg.trend'))"));
  check('the entry marks are on with nothing turned on', (await page.eval("document.querySelectorAll('.entry-mark').length")) > 0);
  check('the table fallback is there', (await text()).includes('View as table'));

  const chartBefore = await page.eval("document.querySelector('svg.trend').innerHTML");
  const totalBefore = hero;
  await page.eval("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('as of each figure')).click()");
  await page.frames();
  check(
    'the rates control leaves the chart untouched',
    (await page.eval("document.querySelector('svg.trend').innerHTML")) === chartBefore,
  );
  await page.eval("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('Latest rates')).click()");
  await page.frames();
  check('switching back restores the total', (await page.eval("document.querySelector('.hero-figure').textContent")) === totalBefore);

  const before = await page.eval("performance.getEntriesByType('resource').length");
  await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
  await page.idle();
  check(
    'no chart control issues a request',
    (await page.eval("performance.getEntriesByType('resource').length")) === before,
  );


  // ---- The chrome, on a page that is not the dashboard -----------------

  check(
    'every authenticated page gives the chrome something to call',
    await page.eval("Boolean(window.Alpine && Alpine.store('vault'))"),
  );

  // ---- What the stylesheet and the password managers do to a form ------

  // The attribute is honoured by a UA rule a class setting a display
  // beats, so this asks the engine rather than the markup.
  check(
    'an element carrying hidden is off the screen',
    await page.eval(`(() => {
      const probe = document.createElement('button');
      probe.className = 'btn-secondary';
      probe.hidden = true;
      document.body.append(probe);
      const shown = getComputedStyle(probe).display;
      probe.remove();
      return shown === 'none';
    })()`),
  );

  // ---- Two entries on one date -------------------------------------------

  // The client refuses to create this state, so it is planted behind
  // the client and read back by a fresh unlock. Everything sits in
  // 2020, before any other figure in the vault, so every chart point
  // there is the probes' alone.
  const holding = (name, unit) => ({
    type: 'account',
    payload: { name, unit, dims: {}, note: null, archivedAt: null, createdAt: '2020-01-01T00:00:00Z' },
  });
  const figure = (accountId, date, value) => ({ type: 'snapshot', accountId, payload: { date, value, note: null } });
  const price = (symbol, date, rate) => ({
    type: 'rate',
    payload: { symbol, date, rate, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: date, proposedRate: null },
  });

  const [euro, sterling, francs] = await plant([
    holding('Probe euro', 'PROBE-E'),
    holding('Probe sterling', 'PROBE-S'),
    holding('Probe francs', 'CHF'),
  ]);
  const planted = await plant([
    // Two differing prices at 11 January between 1.00 and 1.20.
    figure(euro, '2020-01-01', '1000'),
    figure(euro, '2020-01-11', '1000'),
    price('PROBE-E', '2020-01-01', '1.00'),
    price('PROBE-E', '2020-01-11', '1.40'),
    price('PROBE-E', '2020-01-11', '1.60'),
    price('PROBE-E', '2020-01-21', '1.20'),
    price('PROBE-E', '2020-03-11', '1.00'),
    // A pair that is the symbol's only entry.
    figure(sterling, '2020-02-01', '500'),
    price('PROBE-S', '2020-02-01', '1.10'),
    price('PROBE-S', '2020-02-01', '1.30'),
    // Two differing figures at 11 March between 1000 and 2000.
    figure(francs, '2020-03-01', '1000'),
    figure(francs, '2020-03-11', '5000'),
    figure(francs, '2020-03-11', '7000'),
    figure(francs, '2020-03-21', '2000'),
    // Pure duplication, byte for byte.
    price('PROBE-I', '2020-04-01', '2.00'),
    price('PROBE-I', '2020-04-01', '2.00'),
  ]);
  const identical = planted.slice(-2);
  // One of the differing prices carries a higher version, so a rule
  // preferring it would read one entry before an export and the other
  // after, since import resets every version to 1.
  await plant([{ ...price('PROBE-E', '2020-01-11', '1.60'), recordId: planted[4], version: 2 }]);
  await unlockDashboard('the dashboard over the planted pairs');

  // The chart's own table, read at one date, beside the figure that
  // date should carry.
  const chartAt = (date, expected) =>
    page.call(async (day, figure) => {
      const v = (await import('/static/js/session.js')).currentVault();
      [...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const row = [...document.querySelectorAll('details table tbody tr')]
        .find(r => r.cells[0].textContent === v.format.longDate(day));
      return JSON.stringify({ shown: row ? row.cells[1].textContent : null, expected: v.format.money((await import('/static/js/decimal.js')).parse(figure)) });
    }, date, expected).then(JSON.parse);
  const banner = () => labels('.banner-critical button');
  // What the screens make of the planted pairs, for comparing one
  // client's reading with another's.
  const picture = async () => {
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.frames();
    return JSON.stringify({
      banner: (await banner()).filter((line) => !line.includes('PROBE-I')).sort(),
      chart: (await page.eval("[...document.querySelectorAll('details table tbody tr')].map(r => r.textContent)"))
        .filter((row) => row.includes('2020')),
      notPriced: await page.eval(`(() => {
        const group = [...document.querySelectorAll('.table-group')].find(g => g.textContent.includes('Not priced'));
        return group ? [...group.querySelectorAll('.link-button')].map(b => b.textContent).sort() : [];
      })()`),
      hero: await page.eval("document.querySelector('.hero-figure').textContent"),
    });
  };

  const between = await chartAt('2020-01-11', '1100');
  check(
    'a symbol with two differing prices on one date prices it from its neighbours',
    between.shown !== null && between.shown === between.expected,
    JSON.stringify(between),
  );
  check(
    'the dashboard names the price fault',
    (await banner()).some((line) => line.includes('PROBE-E') && line.startsWith('Two entries on')),
    (await banner()).join(' | '),
  );
  const notPriced = JSON.parse(await picture()).notPriced;
  check(
    'a pair that is its symbol\'s only entry leaves the holding not priced',
    notPriced.includes('Probe sterling'),
    notPriced.join(','),
  );
  const figuresAt = await chartAt('2020-03-11', '2500');
  check(
    'the chart leaves two figures on one date out and runs between their neighbours',
    figuresAt.shown !== null && figuresAt.shown === figuresAt.expected,
    JSON.stringify(figuresAt),
  );
  check(
    'the dashboard names the figure fault',
    (await banner()).some((line) => line.includes('Probe francs') && line.startsWith('Two entries on')),
    (await banner()).join(' | '),
  );
  const identicalLeft = await page.call(async (ids) => {
    const api = await import('/static/js/api.js');
    const rows = await api.get('/api/records?type=rate');
    return rows.filter(r => ids.includes(r.recordId)).length;
  }, identical);
  check('a byte-identical pair of prices leaves exactly one record', identicalLeft === 1, `${identicalLeft} left`);
  const inOrder = await picture();

  await page.call((id) => { location.hash = `#/holding/${id}`; }, francs);
  await page.waitUntil("document.querySelector('.card .data-table')", { label: "the probe holding's screen" });
  await page.frames();
  const history = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.card .data-table tbody tr')]
    .map(r => ({ flagged: r.classList.contains('flagged'), keep: r.textContent.includes('Keep this one'), text: r.textContent })))`));
  const pair = history.filter((row) => row.flagged);
  check(
    'the holding page shows both figures on one date flagged, each offering Keep this one',
    history.length === 4 && pair.length === 2 && pair.every((row) => row.keep),
    history.map((row) => `${row.flagged ? 'flagged ' : ''}${row.text}`).join(' | '),
  );

  const flaggedOnRecording = async (date, symbolOrName) => {
    await page.call((day) => { location.hash = `#/recording/${day}`; }, date);
    await page.waitUntil("document.querySelector('.screen-heading')", { label: `the recording for ${date}` });
    await page.frames();
    return JSON.parse(await page.call((wanted) => JSON.stringify([...document.querySelectorAll('.data-table tbody tr')]
      .filter(r => r.cells[0].textContent === wanted)
      .map(r => ({ flagged: r.classList.contains('flagged'), keep: r.textContent.includes('Keep this one') }))), symbolOrName));
  };
  const prices = await flaggedOnRecording('2020-01-11', 'PROBE-E');
  check(
    'the recording shows both differing prices flagged, each offering Keep this one',
    prices.length === 2 && prices.every((row) => row.flagged && row.keep),
    JSON.stringify(prices),
  );
  const figures = await flaggedOnRecording('2020-03-11', 'Probe francs');
  check(
    'the recording shows both figures on one date flagged, each offering Keep this one',
    figures.length === 2 && figures.every((row) => row.flagged && row.keep),
    JSON.stringify(figures),
  );

  // A second client, handed every record list in the opposite order.
  await fetchOn(page, '*/api/records*', 'Response');
  const reverse = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request, responseHeaders = [] } = message.params;
    if (isRateAsk(page, request)) return;
    if (request.method !== 'GET' || !request.url.includes('?type=')) {
      await page.send('Fetch.continueRequest', { requestId });
      return;
    }
    const { body, base64Encoded } = await page.send('Fetch.getResponseBody', { requestId });
    const rows = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString() : body);
    await page.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: responseHeaders.filter((h) => h.name.toLowerCase() !== 'content-length'),
      body: Buffer.from(JSON.stringify(rows.reverse())).toString('base64'),
    });
  };
  page.on(reverse);
  try {
    await unlockDashboard('the dashboard over reversed records');
    const reversed = await picture();
    check('the planted pairs read the same in either order', reversed === inOrder, `${inOrder} vs ${reversed}`);
  } finally {
    page.handlers = page.handlers.filter((h) => h !== reverse);
    await fetchOff(page);
  }

  const roundTrip = JSON.parse(await importOwnExport());
  check('the planted vault survives the round trip', roundTrip.unreadable === 0, String(roundTrip.unreadable));
  await unlockDashboard('the dashboard after the round trip');
  const afterImport = await picture();
  check('the planted pairs read the same after an export and import', afterImport === inOrder, `${inOrder} vs ${afterImport}`);

  // ---- A holding first recorded later steps in, it does not ramp ---------
  //
  // Everything sits in 2019, before any other figure in the vault, so
  // the left of the net line is the probes' alone. The line is read off
  // the drawn polyline, with each date's x taken from its entry mark.
  const [checking, flat] = await plant([holding('Ramp checking', 'CHF'), holding('Ramp flat', 'RAMP-SQM')]);
  const ramp = await plant([
    figure(checking, '2019-09-15', '1000'),
    figure(checking, '2019-10-01', '1000'),
    figure(flat, '2019-10-01', '100'),
    price('RAMP-SQM', '2019-10-01', '8000'),
  ]);
  await unlockDashboard('the dashboard over the ramp probes');
  const line = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    [...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const mark = (iso) => [...document.querySelectorAll('.entry-mark')]
      .find(m => m.querySelector('title').textContent.startsWith(v.format.longDate(iso)));
    const points = document.querySelector('svg.trend .net-line').getAttribute('points').split(' ')
      .map(p => p.split(',').map(Number));
    return JSON.stringify({
      points,
      step: Number(mark('2019-10-01').getAttribute('x1')),
      end: Number(document.querySelector('svg.trend .net-end').getAttribute('cy')),
    });
  })()`));
  const [first, ...others] = line.points;
  const stepAt = line.points.filter(([x]) => Math.abs(x - line.step) < 0.01);
  const toStep = line.points.filter(([x]) => x < line.step - 0.01);
  check(
    'net-worth-view: a holding first recorded on a later date lifts the net line there in one vertical step, not along the way from the date before',
    stepAt.length >= 2 && stepAt[0][1] > stepAt.at(-1)[1] && toStep.every(([, y]) => Math.abs(y - first[1]) < 0.01) &&
      Math.abs(stepAt[0][1] - first[1]) < 0.01,
    JSON.stringify(line.points.slice(0, 6)),
  );
  check(
    'net-worth-view: the net line has no step at the chart\'s first date and none at its last',
    line.points.filter(([x]) => x === first[0]).length === 1 && others.at(-1)[1] === line.end,
    JSON.stringify([first, others.at(-1), line.end]),
  );
  await page.call(async (ids) => {
    const api = await import('/static/js/api.js');
    for (const id of ids) await api.del('/api/records/' + id);
  }, [...ramp, checking, flat]);
  await unlockDashboard('the dashboard after the ramp probes');

  // ---- An archived holding is a row, whatever its figures ----------------
  //
  // Everything sits in 2018, before any other figure in the vault.
  const archivedHolding = (name, unit) => {
    const { payload } = holding(name, unit);
    return { type: 'account', payload: { ...payload, archivedAt: '2018-06-01' } };
  };
  const [oldCellar, , cellar] = await plant([
    archivedHolding('Archive cellar', 'PROBE-BOTTLES'),
    archivedHolding('Archive empty', 'CHF'),
    holding('Active cellar', 'PROBE-BOTTLES'),
  ]);
  await plant([
    figure(oldCellar, '2018-01-01', '12'),
    figure(cellar, '2018-01-01', '7'),
  ]);
  await unlockDashboard('the dashboard over archived probes');
  // What a row shows, read from the engine: the cells that are on the
  // screen, the text colour set against ink-secondary, and the opacity
  // every ancestor multiplies in.
  const archiveCard = () =>
    page.eval(`(() => {
      const card = document.querySelector('.holdings-card');
      const group = (title) => [...card.querySelectorAll('.table-group')].find(g => g.textContent.includes(title));
      const names = (node) => node ? [...node.querySelectorAll('.link-button')].map(b => b.textContent) : [];
      const probe = document.createElement('span');
      probe.style.color = 'var(--ink-secondary)';
      document.body.append(probe);
      const secondary = getComputedStyle(probe).color;
      probe.remove();
      const opacity = (node) => { let o = 1; for (; node; node = node.parentElement) o *= Number(getComputedStyle(node).opacity); return o; };
      return JSON.stringify({
        text: card.textContent,
        total: document.querySelector('.hero-figure').textContent,
        chart: Boolean(document.querySelector('svg.trend')),
        rows: [...card.querySelectorAll('.holdings-table tbody tr')].map(r => {
          const cells = [...r.querySelectorAll('.cell-native, .cell-converted, .cell-asof')];
          const asof = r.querySelector('.cell-asof');
          return {
            name: r.querySelector('.row-name').textContent,
            chip: Boolean(r.querySelector('.chip-archived')),
            buttons: [...r.querySelectorAll('.cell-action button')].map(b => b.textContent),
            shownButtons: [...r.querySelectorAll('button:not(.row-name)')].filter(b => b.getClientRects().length).map(b => b.textContent),
            tops: [r.querySelector('.cell-native'), r.querySelector('.cell-converted')].map(c => c.getBoundingClientRect().top),
            // Somewhere on the row that is no control: the quantity's
            // cell, or the row's right end where that cell is hidden.
            edge: (() => {
              const cell = r.querySelector('.cell-native').getBoundingClientRect();
              const row = r.getBoundingClientRect();
              return cell.width ? { x: cell.left + cell.width / 2, y: cell.top + cell.height / 2 } : { x: row.right - 6, y: row.top + row.height / 2 };
            })(),
            actionShown: getComputedStyle(r.querySelector('.cell-action')).display !== 'none',
            figures: [r.querySelector('.cell-native').textContent, r.querySelector('.cell-converted').textContent, asof.textContent],
            visible: cells.filter(c => getComputedStyle(c).display !== 'none').map(c => c.textContent.trim()).filter(Boolean),
            separator: getComputedStyle(asof, '::before').content,
            secondary: getComputedStyle(r.querySelector('.row-name')).color === secondary,
            opaque: [r, r.querySelector('.row-name'), r.querySelector('.chip-archived')].every(n => !n || opacity(n) === 1),
          };
        }),
        notPriced: names(group('Not priced')),
        notValued: names(group('Not yet valued')),
      });
    })()`).then(JSON.parse);
  const toggleArchived = async () => {
    await page.eval("document.querySelector('.holdings-card .checkbox input').click()");
    await page.frames();
  };
  const pickMode = async (label) => {
    await page.call((wanted) => [...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes(wanted)).click(), label);
    await page.frames();
  };
  const atWidth = async (width) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.idle();
  };
  const archivedRow = (shown, name) => shown.rows.find((r) => r.name === name);
  // The row's right side holds no as-of date: nothing in the as-of
  // cell, and no separator drawn in front of it.
  const noAsOf = (row) => row.figures[2] === '' && row.separator === 'none';

  for (const width of [1280, 390]) {
    await atWidth(width);
    for (const mode of ['Latest rates', 'as of each figure']) {
      await pickMode(mode);
      const where = `${mode} at ${width}px`;
      await toggleArchived();
      const shown = await archiveCard();
      const cellarRow = archivedRow(shown, 'Archive cellar');
      const emptyRow = archivedRow(shown, 'Archive empty');
      check(
        `net-worth-view: an archived holding in a unit with no price is a table row with the Archived chip and Unarchive, reading its quantity and "not priced" (${where})`,
        cellarRow?.chip === true && cellarRow.buttons.join() === 'Unarchive' &&
          cellarRow.figures[0].includes('12') && cellarRow.figures[1] === 'not priced' &&
          cellarRow.visible.includes(cellarRow.figures[0]) && cellarRow.visible.includes('not priced'),
        JSON.stringify(cellarRow),
      );
      check(
        `net-worth-view: an archived holding with no readable snapshot is a table row reading "not yet valued", with In main currency and As of empty (${where})`,
        emptyRow?.chip === true && emptyRow.buttons.join() === 'Unarchive' &&
          emptyRow.figures.join('|') === 'not yet valued||' && emptyRow.separator === 'none' &&
          emptyRow.visible.join('|') === 'not yet valued',
        JSON.stringify(emptyRow),
      );
      // The quantity leads and "not priced" sits beneath it at phone
      // width; on one line each at desktop width.
      check(
        `net-worth-view: an archived holding in a unit with no price reads its quantity, then "not priced" (${where})`,
        width === 390 ? cellarRow?.tops[0] < cellarRow?.tops[1] : cellarRow?.tops[0] === cellarRow?.tops[1],
        JSON.stringify(cellarRow?.tops),
      );
      // A row action is Unarchive or Record a value at desktop width
      // and nothing at phone width, where the row's tap opens the holding.
      check(
        width === 390
          ? `net-worth-view: no row, archived or active, shows a row action (${where})`
          : `net-worth-view: Unarchive stays visible on an archived row (${where})`,
        width === 390
          ? shown.rows.length > 1 && shown.rows.every((r) => r.shownButtons.length === 0)
          : cellarRow?.shownButtons.join() === 'Unarchive' && emptyRow?.shownButtons.join() === 'Unarchive',
        JSON.stringify(shown.rows.map((r) => [r.name, r.shownButtons])),
      );
      check(
        `net-worth-view: archived rows keep their text in ink-secondary and never at reduced opacity (${where})`,
        cellarRow?.secondary === true && cellarRow.opaque === true && emptyRow?.secondary === true && emptyRow.opaque === true,
        JSON.stringify([cellarRow?.secondary, cellarRow?.opaque, emptyRow?.secondary, emptyRow?.opaque]),
      );
      check(
        `net-worth-view: neither group names an archived holding, and an active holding in the same unit stays under Not priced (${where})`,
        shown.notPriced.includes('Active cellar') && !shown.notPriced.includes('Archive cellar') &&
          !shown.notValued.includes('Archive empty') && !shown.notValued.includes('Archive cellar'),
        JSON.stringify([shown.notPriced, shown.notValued]),
      );
      await toggleArchived();
      const hidden = await archiveCard();
      check(
        `net-worth-view: with Show archived off, archived holdings appear nowhere in the holdings card (${where})`,
        !hidden.text.includes('Archive cellar') && !hidden.text.includes('Archive empty') && hidden.notPriced.includes('Active cellar'),
        JSON.stringify(hidden.notPriced),
      );
    }
    await pickMode('Latest rates');
  }
  await page.send('Emulation.clearDeviceMetricsOverride');

  // A press on a row, off its name, opens the holding's screen, which
  // offers Unarchive for an archived holding and Record a value for an
  // active one.
  for (const [width, phone] of [[390, true], [1280, false]]) {
    await atWidth(width);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: phone });
    for (const [kind, archived, offered] of [
      ['an archived', true, 'Unarchive'],
      ['an active', false, 'Record a value'],
    ]) {
      await reloadModel();
      if (!(await page.eval("document.querySelector('.holdings-card .checkbox input').checked"))) await toggleArchived();
      // A press lands only on what is in the viewport.
      const named = (await archiveCard()).rows.find((r) => r.chip === archived)?.name;
      await page.call((wanted) => [...document.querySelectorAll('.holdings-table .row-name')].find((b) => b.textContent === wanted)?.scrollIntoView({ block: 'center' }), named);
      await page.frames();
      const row = (await archiveCard()).rows.find((r) => r.name === named);
      let opened = false;
      if (row) {
        await (phone ? page.tap(row.edge.x, row.edge.y) : page.mouseClick(row.edge.x, row.edge.y));
        opened = await page.waitUntil("location.hash.startsWith('#/holding/')", { timeout: 10000, label: 'the holding screen' }).then(() => true, () => false);
      }
      if (opened) await page.waitUntil("document.querySelector('.form-actions button')", { label: 'the holding screen' });
      const offers = opened ? await labels('.form-actions button') : [];
      check(
        `net-worth-view: pressing ${kind} row opens the holding's screen, offering ${offered} (${width}px)`,
        opened && offers.includes(offered),
        JSON.stringify([row?.name, opened, offers]),
      );
    }
  }
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
  await reloadModel();
  if (await page.eval("document.querySelector('.holdings-card .checkbox input').checked")) await toggleArchived();

  // Holdings and no snapshot at all: every active holding is under Not
  // yet valued and the total is a dash. Each archived one is a row
  // reading "not yet valued" behind the toggle, and nowhere without it.
  await page.call(async () => {
    const api = await import('/static/js/api.js');
    for (const type of ['snapshot', 'rate']) {
      for (const row of await api.get('/api/records?type=' + type)) await api.del('/api/records/' + row.recordId);
    }
  });
  await reloadModel();
  await page.goto(`${BASE}/dashboard`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('.holdings-card')", { timeout: 90000, label: 'the dashboard with no snapshots' });
  await page.idle();
  for (const width of [1280, 390]) {
    await atWidth(width);
    for (const mode of ['Latest rates', 'as of each figure']) {
      await pickMode(mode);
      const where = `${mode} at ${width}px`;
      const without = await archiveCard();
      await toggleArchived();
      const withArchived = await archiveCard();
      await toggleArchived();
      const archivedNames = ['Archive cellar', 'Archive empty'];
      check(
        `net-worth-view: with holdings and no snapshots, the total is a dash with no chart, and active holdings sit under Not yet valued (${where})`,
        without.total === '—' && !without.chart && without.notValued.includes('Active cellar') &&
          archivedNames.every((name) => !without.notValued.includes(name)) && without.notPriced.length === 0,
        JSON.stringify(without),
      );
      check(
        `net-worth-view: with holdings and no snapshots, each archived holding is an archived row reading "not yet valued" behind Show archived, and nowhere without it (${where})`,
        archivedNames.every((name) => !without.text.includes(name)) &&
          archivedNames.every((name) => {
            const row = archivedRow(withArchived, name);
            return row?.chip === true && row.visible.join('|') === 'not yet valued' && row.figures[1] === '' && noAsOf(row);
          }) &&
          archivedNames.every((name) => !withArchived.notValued.includes(name)),
        JSON.stringify(withArchived.rows),
      );
    }
    await pickMode('Latest rates');
  }
  await page.send('Emulation.clearDeviceMetricsOverride');

  // ---- One recording, drawn whole ----------------------------------------
  //
  // The vault is emptied, then holds one holding recorded once at 2500,
  // so the chart is one day long under every range and its value axis
  // reads one known figure.
  await page.call(async () => {
    const api = await import('/static/js/api.js');
    for (const type of ['snapshot', 'rate', 'account']) {
      for (const row of await api.get('/api/records?type=' + type)) await api.del('/api/records/' + row.recordId);
    }
  });
  await reloadModel();
  const today = new Date().toISOString().slice(0, 10);
  await holdings([['Solo', 'CHF']]);
  await recording(today, { Solo: '2500' });

  const redrawn = () =>
    page.waitUntil(
      "Number(document.querySelector('svg.trend').getAttribute('width')) === Math.floor(document.querySelector('.chart-frame').clientWidth)",
      { label: 'the chart drawn at the card\'s width' },
    );
  // What the chart draws at one width and range, read off its markup.
  const drawn = (range) =>
    page.call(async (label) => {
      [...document.querySelectorAll('.range-buttons button')].find((b) => b.textContent === label).click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const svg = document.querySelector('svg.trend');
      const dot = svg.querySelector('.net-end');
      const zero = svg.querySelector('.zero-line');
      const ticks = [...svg.querySelectorAll('.axis-tick')];
      const value = ticks.filter((t) => t.getAttribute('text-anchor') === 'end');
      const half = Number(dot.getAttribute('r')) + parseFloat(getComputedStyle(dot).strokeWidth) / 2;
      const centre = Number(dot.getAttribute('cx'));
      return JSON.stringify({
        width: Number(svg.getAttribute('width')),
        left: centre - half,
        right: centre + half,
        offset: centre - (Number(zero.getAttribute('x1')) + Number(zero.getAttribute('x2'))) / 2,
        plotLeft: Number(zero.getAttribute('x1')),
        dateAt: ticks.filter((t) => t.getAttribute('text-anchor') === 'middle').map((t) => Number(t.getAttribute('x')) - centre),
        values: value.map((t) => t.textContent),
        valueRight: Math.max(...value.map((t) => t.getBBox().x + t.getBBox().width)),
      });
    }, range).then(JSON.parse);
  const viewport = async (width) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.idle();
    await redrawn();
  };
  const soloReads = async (label) => {
    for (const [width, values] of [[1280, ['0', '500', '1k', '1.5k', '2k', '2.5k']], [390, ['0', '1k', '2k']]]) {
      await viewport(width);
      for (const range of ['1M', '6M', '1Y', 'All']) {
        const read = await drawn(range);
        const where = `${label} at ${width}px under ${range}: ${JSON.stringify(read)}`;
        check(
          `net-worth-view: ${label} at ${width}px under ${range} draws its one point whole, in the plot's middle, with its date beneath`,
          Math.abs(read.offset) <= 0.5 && read.left >= 0 && read.right <= read.width &&
            read.dateAt.length === 1 && Math.abs(read.dateAt[0]) <= 0.5,
          where,
        );
        check(
          `net-worth-view: ${label} at ${width}px under ${range} reads its value ticks through their lines, in a gutter outside the plot`,
          JSON.stringify(read.values) === JSON.stringify(values) && read.valueRight <= read.plotLeft,
          where,
        );
      }
    }
  };
  await unlockDashboard('the dashboard of one recording');
  await soloReads('one recording');

  // A price entry older than the oldest snapshot does not move a range's start.
  const older = new Date(Date.parse(today) - 800 * 86400000).toISOString().slice(0, 10);
  await plant([price('PROBE-OLD', older, '2.00')]);
  await unlockDashboard('the dashboard of one recording and an older price');
  check(
    'net-worth-view: history shorter than a year opens on All, whatever price entry is older',
    (await page.eval("document.querySelector('.range-buttons .active').textContent")) === 'All',
  );
  await soloReads('one recording and an older price');

  // A decimal comma reaches the value ticks, the one figure that abbreviates.
  const profileBefore = await page.call(async () => (await import('/static/js/session.js')).currentVault().profile);
  await setProfile({ locale: 'de-DE', groupSeparator: 'period' });
  await unlockDashboard('the dashboard under a decimal comma');
  await viewport(1280);
  check(
    'net-worth-view: under a decimal comma the ticks at 1500 and 2500 read 1,5k and 2,5k',
    JSON.stringify((await drawn('1Y')).values) === JSON.stringify(['0', '500', '1k', '1,5k', '2k', '2,5k']),
  );
  await page.call(async (profile) => {
    const s = await import('/static/js/session.js');
    const writes = await import('/static/js/writes.js');
    await writes.saveProfile(s.currentVault(), profile);
  }, profileBefore);

  // ---- Value labels of a negative total, drawn whole ----------------------
  //
  // Every label lies inside the drawing at every width: the gutter is
  // sized from the widest one, so a sign and a unit never run off the edge.
  for (const figure of ['-410000', '-500000000']) {
    await page.call(async () => {
      const api = await import('/static/js/api.js');
      for (const type of ['snapshot', 'rate', 'account']) {
        for (const row of await api.get('/api/records?type=' + type)) await api.del('/api/records/' + row.recordId);
      }
    });
    await reloadModel();
    await holdings([['Debt', 'CHF']]);
    await recording(older, { Debt: figure });
    await recording(today, { Debt: figure });
    await unlockDashboard(`the dashboard of a total of ${figure}`);
    for (const width of [390, 1280]) {
      await viewport(width);
      const outside = await page.eval(`(() => {
        const svg = document.querySelector('svg.trend').getBoundingClientRect();
        const labels = [...document.querySelectorAll('svg.trend .axis-tick')].filter((t) => t.getAttribute('text-anchor') === 'end');
        return JSON.stringify({
          count: labels.length,
          cut: labels.filter((t) => t.getBoundingClientRect().left < svg.left - 0.01).map((t) => t.textContent),
        });
      })()`).then(JSON.parse);
      check(
        `net-worth-view: at ${width}px the value labels of a total of ${figure} lie inside the chart`,
        outside.count > 1 && outside.cut.length === 0,
        JSON.stringify(outside),
      );
    }
  }
});
