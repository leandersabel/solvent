// Where the trend chart ends, written from spec/features/net-worth-view.md
// alone (Ranges and modes, Reading a date, Axes, States, acceptance
// criteria 40 and 76): a single recording made today is one whole point
// in the plot's middle under every range, at desktop and phone width.
// With the last recording on 2026-09-15 and today 2026-10-03 the chart
// ends today, the last figure runs level to it, End and focus read
// today, 1M counts back from today in the hero, the table and Home, and
// All starts on the first recording.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js,
// model.js, format.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// 250 as money reads, in whole units (design-system.md, Figures).
const WHOLE_250 = /^(CHF\s?)?250$/;

const ZONE = 'Europe/Zurich';
const FIRST = '2026-06-01';
const LAST = '2026-09-15';
const TODAY = '2026-10-03';
const RANGES = ['1M', '6M', '1Y', 'All'];

const range = async (label) => {
  await page.call((name) => [...document.querySelectorAll('.range-buttons button')].find((b) => b.textContent.trim() === name).click(), label);
  await page.frames();
  await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the chart' });
};
const home = async () => {
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the dashboard chart' });
  await page.frames();
};
const longDate = (iso) => page.call(async (at) => (await import('/static/js/session.js')).currentVault().format.longDate(at), iso);
// The day the readout and the hero show after `keys` on the focused
// chart, as text, or what was there instead.
const keyed = (keys) =>
  page.call((list) => {
    const chart = document.querySelector('.chart-frame svg.trend');
    chart.focus();
    for (const key of list) chart.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const read = {
      date: document.querySelector('.chart-readout .readout-date')?.textContent,
      hero: document.querySelector('.dashboard .hero-at')?.textContent,
      net: document.querySelector('.chart-readout .readout-net .numeric')?.textContent,
    };
    chart.blur();
    return read;
  }, keys);
// The plot's ends, the net line's dot and every mark, in page pixels.
const geometry = () =>
  page.call(() => {
    const svg = document.querySelector('.chart-frame svg.trend');
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const zero = svg.querySelector('.zero-line');
    const dot = svg.querySelector('.net-end');
    const inside = (node) => {
      const b = node.getBoundingClientRect();
      return b.left >= box.left - 0.01 && b.right <= box.right + 0.01 && b.top >= box.top - 0.01 && b.bottom <= box.bottom + 0.01;
    };
    const line = svg.querySelector('.net-line').getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
    return {
      left: box.left,
      top: box.top,
      scale,
      x0: Number(zero.getAttribute('x1')),
      x1: Number(zero.getAttribute('x2')),
      dot: dot && { cx: Number(dot.getAttribute('cx')), cy: Number(dot.getAttribute('cy')), whole: inside(dot) },
      marks: [...svg.querySelectorAll('.entry-mark')].map(inside),
      line,
    };
  });
const pointAt = async (x, y) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.frames();
  return page.eval("document.querySelector('.chart-readout .readout-date')?.textContent");
};

await run(async () => {
  await page.send('Emulation.setTimezoneOverride', { timezoneId: ZONE });
  await vaultOwner();
  await setProfile({ locale: 'en-US' });
  const ids = await holdings([['Cash', 'CHF']]);

  // Criterion 40: a single recording, made today.
  await holdToday(FIRST);
  await plant([{ type: 'snapshot', accountId: ids.Cash, payload: { date: FIRST, value: '100', note: null } }]);
  const first = await longDate(FIRST);
  for (const [width, height, mobile] of [[1280, 900, false], [390, 844, true]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await home();
    for (const label of RANGES) {
      await range(label);
      await page.eval("document.querySelector('.chart-frame svg.trend').scrollIntoView({ block: 'center' })");
      await page.frames();
      const g = await geometry();
      const middle = (g.x0 + g.x1) / 2;
      check(
        `net-worth-view 40: a single recording made today is one whole point in the plot's middle under ${label} at ${width}px`,
        g.dot && Math.abs(g.dot.cx - middle) <= 0.5 / g.scale && g.dot.whole && g.marks.length === 1 && g.marks.every(Boolean),
        JSON.stringify({ x0: g.x0, x1: g.x1, dot: g.dot, marks: g.marks }),
      );
      const y = g.top + (g.dot ? g.dot.cy : 20) * g.scale;
      const read = [];
      for (const x of [g.x0 + 0.5, middle, g.x1 - 0.5]) read.push(await pointAt(g.left + x * g.scale, y));
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      check(
        `net-worth-view 40: the pointer at either edge and the middle reads that day under ${label} at ${width}px`,
        read.every((date) => date === first),
        JSON.stringify(read),
      );
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // Criterion 76: the last recording on 2026-09-15 and today 2026-10-03.
  await holdToday(TODAY);
  await plant([{ type: 'snapshot', accountId: ids.Cash, payload: { date: LAST, value: '250', note: null } }]);
  await home();
  const [today, monthBack] = [await longDate(TODAY), await longDate('2026-09-03')];
  const last = await longDate(LAST);

  // History shorter than a year opens on All, from the first recording.
  const onFocus = await keyed([]);
  const atEnd = await keyed(['Home', 'End']);
  const atHome = await keyed(['Home']);
  const level = await keyed(['End', 'ArrowLeft']);
  check(
    'net-worth-view 76: under All focus and End read today, Home the first recording',
    onFocus.date === today && (onFocus.hero || '').includes(today) && atEnd.date === today && atHome.date === first,
    JSON.stringify({ onFocus, atEnd, atHome }),
  );
  check(
    'net-worth-view 76: the last figure runs level to today',
    WHOLE_250.test(atEnd.net || '') && WHOLE_250.test(level.net || ''),
    JSON.stringify({ atEnd, level }),
  );
  const g = await geometry();
  const lastPoint = g.line.at(-1);
  const recorded = g.line.find(([x]) => Math.abs(x - (g.x0 + ((g.x1 - g.x0) * 106) / 124)) < 0.01);
  check(
    "net-worth-view 76: the net line ends at the plot's right edge on today, level with the last recording",
    g.dot && Math.abs(g.dot.cx - g.x1) < 0.01 && Math.abs(lastPoint[0] - g.x1) < 0.01 && recorded && recorded[1] === lastPoint[1],
    JSON.stringify({ x1: g.x1, dot: g.dot, line: g.line.slice(-3) }),
  );

  // 1M counts back thirty days from today.
  await range('1M');
  const since = await page.eval("document.querySelector('.dashboard .hero-since')?.textContent");
  const change = await page.eval("document.querySelector('.dashboard .hero-delta')?.textContent");
  const monthHome = await keyed(['Home']);
  const monthEnd = await keyed(['End']);
  check(
    'net-worth-view 76: under 1M the hero reads since 2026-09-03, and Home and End read 2026-09-03 and today',
    since === `since ${monthBack}` && monthHome.date === monthBack && monthEnd.date === today,
    JSON.stringify({ since, monthHome, monthEnd }),
  );
  // 100 on 06-01 to 250 on 09-15 reads 233.0188... on 09-03, 94 of 106
  // days along: the change to today is 16.98, written whole as 17, or
  // 7.3%.
  check(
    'net-worth-view 76: under 1M the change runs from 2026-09-03 to today',
    /\+17 /.test(change || '') && /\+7\.3%/.test(change || ''),
    change,
  );
  const rows = await page.call(() =>
    [...document.querySelectorAll('.chart-card .data-table tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent)));
  check(
    "net-worth-view 76: under 1M the data table runs from 2026-09-03 to today, the last recording between",
    JSON.stringify(rows.map(([date]) => date)) === JSON.stringify([monthBack, last, today]) && WHOLE_250.test(rows.at(-1)?.at(-1) || ''),
    JSON.stringify(rows),
  );
}, { signsIn: false });
