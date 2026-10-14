// A one-day history in Percentage, from net-worth-view.md (Axes, and
// acceptance criterion 40): with one holding recorded only today, the
// asset band is drawn whole at the plot's horizontal middle, from 0% to
// 100%, at desktop and phone width.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js.
import { check, click, holdToday, holdings, page, plant, reloadModel, run, vaultOwner } from '../harness.mjs';

const TODAY = '2026-10-14';

// The drawn asset band's box, the plot's horizontal extent read off its
// gridlines, and the y of the 0% and 100% ticks.
const drawn = () =>
  page.call(() => {
    const svg = document.querySelector('svg.trend');
    const band = svg.querySelector('path.band');
    const grid = svg.querySelector('line.zero-line');
    const tick = (label) => {
      const t = [...svg.querySelectorAll('text.axis-tick')].find((n) => n.textContent.trim() === label);
      return t ? Number(t.getAttribute('y')) - 4 : null;
    };
    const box = band && band.getBBox();
    return {
      band: box && { x: box.x, y: box.y, width: box.width, height: box.height },
      left: Number(grid.getAttribute('x1')),
      right: Number(grid.getAttribute('x2')),
      zero: tick('0%'),
      top: tick('100%'),
    };
  });

const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.5;

await run(async () => {
  await vaultOwner();
  await holdToday(TODAY);
  const ids = await holdings([['Solo', 'CHF', {}]]);
  await plant([{ type: 'snapshot', accountId: ids.Solo, payload: { date: TODAY, value: '1000.00', note: null } }]);
  for (const width of [1280, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 560 });
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('svg.trend .net-end')", { label: 'the chart' });
    await click('Percentage');
    await page.waitUntil("[...document.querySelectorAll('svg.trend text.axis-tick')].some((t) => t.textContent.trim() === '100%')", { label: 'the percentage ticks' });
    await page.frames();
    const seen = await drawn();
    const { band } = seen;
    check(`net-worth-view: Axes, at ${width}px in Percentage a one-day history draws its band whole at the plot's middle, from 0% to 100%`,
      band !== null && band.width > 0 &&
        near(band.x + band.width / 2, (seen.left + seen.right) / 2) &&
        band.x >= seen.left && band.x + band.width <= seen.right &&
        near(band.y, seen.top) && near(band.y + band.height, seen.zero),
      JSON.stringify(seen));
  }
}, { signsIn: false });
