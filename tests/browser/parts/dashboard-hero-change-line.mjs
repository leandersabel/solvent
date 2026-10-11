// The hero with a net worth in the millions and the tens of millions
// (spec/features/net-worth-view.md, Hero figure, acceptance criterion
// 83): above phone width the total stays in its column, and the
// change's arrow, amount and percentage read on one line.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const FIRST = '2025-10-01';
const LAST = '2026-06-10';
const WIDTHS = [601, 901, 960, 1024, 1100, 1280];
// The net worth on FIRST and LAST, and what the change reads.
const CASES = [
  ['968468', '7331239', 'CHF +6,362,771 · +657.0%'],
  ['96846800', '73312390', 'CHF −23,534,410 · −24.3%'],
];

// The arrow is on the delta's line when its middle falls within it.
const measure = () => page.call(() => {
  const html = document.documentElement;
  const main = document.querySelector('.dashboard .hero-main');
  const figure = main.querySelector('.hero-figure');
  const change = main.querySelector('.hero-change');
  const arrow = change.querySelector('.icon').getBoundingClientRect();
  const lines = [...change.querySelector('.hero-delta').getClientRects()];
  const middle = (arrow.top + arrow.bottom) / 2;
  return {
    width: html.clientWidth,
    scrollWidth: html.scrollWidth,
    text: change.querySelector('.hero-delta').textContent,
    figureFits: figure.scrollWidth <= main.clientWidth,
    lines: lines.length,
    arrowOnLine: lines.length === 1 && middle > lines[0].top && middle < lines[0].bottom,
  };
});

await run(async () => {
  await vaultOwner();
  await setProfile({ locale: 'en-US' });
  const { Cash } = await holdings([['Cash', 'CHF']]);
  await holdToday(LAST);
  const snapshot = (date, value, recordId, version) =>
    ({ type: 'snapshot', accountId: Cash, recordId, version, payload: { date, value, note: null } });
  const ids = await plant([snapshot(FIRST, '1'), snapshot(LAST, '1')]);

  for (const [index, [start, end, text]] of CASES.entries()) {
    await plant([snapshot(FIRST, start, ids[0], index + 2), snapshot(LAST, end, ids[1], index + 2)]);
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.dashboard .hero-change .icon')", { label: 'the change' });
    for (const width of WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false });
      await page.frames();
      const seen = await measure();
      const detail = JSON.stringify(seen);
      check(`net-worth-view 83: the change reads "${text}" at ${width}px`, seen.text === text, detail);
      check(`net-worth-view 83: a total of ${end} stays in its column at ${width}px`, seen.figureFits, detail);
      check(`net-worth-view 83: the arrow, amount and percentage share one line at ${width}px`, seen.arrowOnLine, detail);
      check(`net-worth-view 83: the dashboard never pans sideways at ${width}px`, seen.scrollWidth <= seen.width, detail);
    }
    await page.send('Emulation.clearDeviceMetricsOverride');
  }
}, { signsIn: false });
