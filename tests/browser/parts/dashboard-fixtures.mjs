// The dashboard drawn over vaults built to the byte, in the page's own
// modules (spec/features/net-worth-view.md): the chart's data table, its
// value ticks and the holdings card with every holding archived. No
// account is signed in; each fixture is the model's, handed straight to
// the dashboard view the app renders.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js,
// model.js, format.js.
import { BASE, check, click, page, run } from '../harness.mjs';

await run(async () => {
  await page.goto(`${BASE}/login`);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // Builds a vault from `spec` the way the value model's own tests do and
  // shows its dashboard alone on the page. A `today` holds the device's
  // clock at its noon, so the chart ends there.
  await page.call(() => {
    const RealDate = Date;
    globalThis.show = async ({ today, main = 'CHF', profile = {}, dimensions = [], holdings = [], figures = [], prices = [] }) => {
      const instant = `${today}T12:00:00`;
      globalThis.Date = today
        ? class extends RealDate {
          constructor(...args) {
            super(...(args.length ? args : [instant]));
          }
          static now() {
            return new RealDate(instant).getTime();
          }
        }
        : RealDate;
      const { Vault } = await import('/static/js/model.js');
      const { dashboardView } = await import('/static/js/view-dashboard.js');
      const vault = new Vault(null);
      vault.profile = { mainCurrency: main, dimensions, locale: 'en-US', groupSeparator: 'comma', ...profile };
      const ids = {};
      let next = 0;
      for (const h of holdings) {
        ids[h.name] = `h${(next += 1)}`;
        vault._index({
          recordId: ids[h.name],
          recordType: 'account',
          version: 1,
          payload: { name: h.name, unit: h.unit, dims: h.dims || {}, note: null, archivedAt: h.archivedAt || null, createdAt: '2020-01-01T00:00:00Z' },
        });
      }
      for (const [name, date, value] of figures) {
        vault._index({ recordId: `s${(next += 1)}`, recordType: 'snapshot', accountId: ids[name], version: 1, payload: { date, value, note: null } });
      }
      for (const [symbol, date, rate] of prices) {
        vault._index({
          recordId: `r${(next += 1)}`,
          recordType: 'rate',
          version: 1,
          payload: { symbol, date, rate, rateTarget: main, rateSource: 'manual', rateAsOf: date, proposedRate: null },
        });
      }
      vault._sortSeries();
      globalThis.vault = vault;
      const noop = new Proxy({}, { get: () => () => {} });
      document.body.replaceChildren(dashboardView(vault, noop));
    };
  });
  const show = (spec) => page.call((fixture) => globalThis.show(fixture), spec);
  const chartDrawn = () => page.waitUntil("document.querySelector('svg.trend')", { label: 'the chart' });
  const table = () =>
    page.call(() => {
      const t = document.querySelector('.chart-card details table');
      return {
        heads: [...t.querySelectorAll('thead th')].map((th) => th.textContent),
        rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
        text: t.textContent,
      };
    });
  const valueTicks = () =>
    page.eval("JSON.stringify([...document.querySelectorAll('svg.trend text.axis-tick[text-anchor=end]')].map((t) => t.textContent))").then(JSON.parse);

  // ---- The data table's days ---------------------------------------------

  // Snapshots on 15 January and 30 June, a USD price on 10 April for a
  // USD holding, and a main-currency holding archived on 20 May with no
  // figure that day.
  await show({
    today: '2026-06-30',
    holdings: [
      { name: 'Cash', unit: 'CHF' },
      { name: 'Dollars', unit: 'USD' },
      { name: 'Old', unit: 'CHF', archivedAt: '2026-05-20' },
    ],
    figures: [
      ['Cash', '2026-01-15', '100'], ['Cash', '2026-06-30', '150'],
      ['Dollars', '2026-01-15', '10'], ['Old', '2026-01-15', '5'],
    ],
    prices: [['USD', '2026-04-10', '0.9']],
  });
  await chartDrawn();
  const days = async (range) => {
    await click(range);
    return (await table()).rows.map((row) => row[0]);
  };
  const listedAll = await days('All');
  const listedMonth = await days('1M');
  check(
    'net-worth-view: the data table under All lists 2026-01-15, 2026-04-10, 2026-05-20 and 2026-06-30 in order and no other day',
    listedAll.join('|') === 'Jan 15, 2026|Apr 10, 2026|May 20, 2026|Jun 30, 2026',
    listedAll.join('|'),
  );
  check(
    'net-worth-view: the data table under 1M lists the range\'s first day and 2026-06-30 only',
    listedMonth.join('|') === 'May 31, 2026|Jun 30, 2026',
    listedMonth.join('|'),
  );

  // ---- Net worth is the exact sum ------------------------------------------

  const bands = {
    dimensions: [{ id: 'd', label: 'D', values: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
    holdings: [
      { name: 'First', unit: 'CHF', dims: { d: 'a' } },
      { name: 'Second', unit: 'CHF', dims: { d: 'b' } },
    ],
  };
  const group = () =>
    page.eval(`(() => { const s = document.querySelector('.chart-card select'); s.value = 'd'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await show({
    ...bands,
    today: '2026-03-01',
    figures: [['First', '2026-03-01', '4503599627370496.4'], ['Second', '2026-03-01', '4503599627370496.4']],
  });
  await group();
  const exact = await table();
  check(
    'net-worth-view: two holdings at 4503599627370496.4 in different bands give a data table Net worth of 9,007,199,254,740,993',
    exact.rows.length === 1 && exact.rows[0].at(-1) === '9,007,199,254,740,993' &&
      exact.rows[0].slice(1, -1).every((cell) => cell === '4,503,599,627,370,496'),
    JSON.stringify(exact),
  );

  // ---- Hiding a band and Percentage leave the table alone ----------------------

  await show({
    ...bands,
    today: '2026-06-30',
    figures: [
      ['First', '2026-01-15', '100.5'], ['First', '2026-06-30', '200'],
      ['Second', '2026-03-01', '300'],
    ],
  });
  await group();
  const whole = await table();
  await page.eval("document.querySelector('.legend-entry').click()");
  const hidden = await table();
  const bandHidden = await page.eval("document.querySelector('.legend-entry').getAttribute('aria-pressed') === 'false'");
  await click('Percentage');
  const percentage = await table();
  await page.waitUntil("document.querySelector('svg.trend text.axis-tick[text-anchor=end]')", { label: 'the percentage ticks' });
  const percentageDrawn = (await valueTicks()).some((tick) => tick.endsWith('%'));
  check(
    'net-worth-view: hiding a band and switching to Percentage leave the data table\'s text unchanged',
    bandHidden && percentageDrawn && whole.rows.length > 1 && whole.text === hidden.text && whole.text === percentage.text,
    JSON.stringify({ whole, hidden, percentage }),
  );

  // ---- A day the drawing cannot space is still a row ----------------------------

  // A figure every day for more days than the plot has pixel columns.
  const start = Date.parse('2014-01-01T00:00:00Z');
  const length = 4000;
  const daily = Array.from({ length }, (_, at) => ['Cash', new Date(start + at * 86400000).toISOString().slice(0, 10), String(1000 + at)]);
  await show({ today: '2024-12-13', holdings: [{ name: 'Cash', unit: 'CHF' }], figures: daily });
  await chartDrawn();
  await click('All');
  const long = await table();
  const plotWidth = await page.eval("document.querySelector('svg.trend').getAttribute('width') | 0");
  const model = await page.eval("JSON.stringify(vault.series(null, vault.chartRange(null).fromDay, vault.chartRange(null).lastDay).days.length)");
  const dayOfRow = (at) => long.rows[at][0];
  check(
    'net-worth-view: over a history with more days than the plot has pixel columns, the data table still lists every day',
    length > plotWidth && long.rows.length === length && Number(model) === length &&
      dayOfRow(1) === 'Jan 2, 2014' && dayOfRow(1234) === 'May 19, 2017' && dayOfRow(length - 1) === 'Dec 13, 2024',
    JSON.stringify({ plotWidth, rows: long.rows.length, model, second: dayOfRow(1) }),
  );

  // ---- Value ticks come through the formatter -----------------------------------

  await show({
    profile: { locale: 'de-DE', groupSeparator: 'period' },
    holdings: [{ name: 'Cash', unit: 'CHF' }],
    figures: [['Cash', '2026-03-01', '2500000']],
  });
  await chartDrawn();
  const german = await valueTicks();
  check(
    'net-worth-view: under de-DE with a period thousands mark, one holding at 2500000 has ticks 0, 500k, 1M, 1,5M, 2M and 2,5M',
    german.join(',') === '0,500k,1M,1,5M,2M,2,5M',
    german.join(','),
  );
  await show({
    profile: { locale: 'de-DE', groupSeparator: 'period' },
    holdings: [{ name: 'Flat', unit: 'CHF' }, { name: 'Mortgage', unit: 'CHF' }],
    figures: [['Flat', '2026-03-01', '1000000'], ['Mortgage', '2026-03-01', '-400000']],
  });
  await chartDrawn();
  await click('Percentage');
  await page.waitUntil("document.querySelector('svg.trend text.axis-tick[text-anchor=end]')", { label: 'the percentage ticks' });
  const percent = await valueTicks();
  check(
    'net-worth-view: with an asset and a liability holding the percentage view\'s ticks read −100%, −50%, 0%, 50% and 100%',
    percent.join(',') === '−100%,−50%,0%,50%,100%',
    percent.join(','),
  );

  // ---- Every holding archived ------------------------------------------------------

  await show({
    holdings: [{ name: 'Gone one', unit: 'CHF', archivedAt: '2026-04-01' }, { name: 'Gone two', unit: 'CHF', archivedAt: '2026-05-01' }],
    figures: [['Gone one', '2026-01-15', '10'], ['Gone one', '2026-04-01', '0'], ['Gone two', '2026-01-15', '20'], ['Gone two', '2026-05-01', '0']],
  });
  const card = () =>
    page.eval(`(() => {
      const c = document.querySelector('.holdings-card');
      return JSON.stringify({
        hero: [...document.querySelectorAll('.hero-figure, .hero-part-value')].map((p) => p.textContent),
        change: Boolean(document.querySelector('.hero-change')),
        tables: c.querySelectorAll('table').length,
        headings: c.querySelectorAll('th').length,
        line: [...c.querySelectorAll('p.hint')].map((p) => p.textContent),
        rows: [...c.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('.row-name').textContent + ':' + Boolean(tr.querySelector('.chip-archived'))),
      });
    })()`).then(JSON.parse);
  const hiddenArchive = await card();
  await chartDrawn();
  const hoveredArchive = await page.call(() => {
    const svg = document.querySelector('svg.trend');
    const box = svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + box.width / 2, clientY: box.top + 40, bubbles: true }));
    const shown = {
      readout: !document.querySelector('.chart-readout').hidden,
      total: document.querySelector('.hero-figure').textContent,
      at: !document.querySelector('.hero-at').hidden,
    };
    svg.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    return shown;
  });
  check(
    'net-worth-view: with every holding archived the total, assets and liabilities are dashes with no change',
    hiddenArchive.hero.join('|') === '—|—|—' && !hiddenArchive.change,
    JSON.stringify(hiddenArchive),
  );
  check(
    'net-worth-view: with every holding archived, hovering the chart reads the day in the tooltip and leaves the hero a dash with no date',
    hoveredArchive.readout && hoveredArchive.total === '—' && !hoveredArchive.at,
    JSON.stringify(hoveredArchive),
  );
  check(
    'net-worth-view: with every holding archived and Show archived off there is no table, no heading, and the line "Every holding is archived."',
    hiddenArchive.tables === 0 && hiddenArchive.headings === 0 && hiddenArchive.rows.length === 0 &&
      hiddenArchive.line.join('|') === 'Every holding is archived.',
    JSON.stringify(hiddenArchive),
  );
  await page.eval("document.querySelector('.holdings-card input[type=checkbox]').click()");
  const shownArchive = await card();
  check(
    'net-worth-view: with every holding archived and Show archived on, each archived holding is a row',
    shownArchive.tables === 1 && shownArchive.headings > 0 && shownArchive.line.length === 0 &&
      shownArchive.rows.join('|') === 'Gone one:true|Gone two:true',
    JSON.stringify(shownArchive),
  );
}, { signsIn: false });
