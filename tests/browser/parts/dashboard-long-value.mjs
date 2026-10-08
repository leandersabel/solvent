// The breakdown with dimension values too long for the room beside their
// bars and the legend (net-worth-view.md, Breakdown by dimension, Legend,
// and acceptance criterion 79): one beside the widest positive bar and
// one beside a negative bar. Each wraps inside its card as literal text,
// and the page never pans sideways.
import { BACKDATE, check, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const MARKUP = 'Low <img src=x onerror=alert(1)> and some more words to fill the room';
const UNBROKEN = 'HypothekarkreditFestverzinslichZehnJahreNummer987654321';
const WIDTHS = [320, 375, 601, 901, 1280];

const measure = () => page.call((names) => {
  const html = document.documentElement;
  const width = html.clientWidth;
  const shown = ['.bar-name', '.legend-name'].flatMap((where) => names.map((name) => {
    const label = [...document.querySelectorAll(where)].find((n) => n.textContent === name);
    if (!label) return { where, name, missing: true };
    const r = label.getBoundingClientRect();
    const card = label.closest('.card').getBoundingClientRect();
    return { where, name, left: r.left, right: r.right, inside: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 };
  }));
  return JSON.stringify({ width, scrollWidth: html.scrollWidth, images: document.querySelectorAll('.card img').length, shown });
}, [MARKUP, UNBROKEN]).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  await setProfile({
    dimensions: [{ id: 'risk', label: 'Risk', values: [{ id: 'low', label: MARKUP }, { id: 'debt', label: UNBROKEN }] }],
  });
  const ids = await holdings([['Depot', 'CHF', { risk: 'low' }], ['Mortgage', 'CHF', { risk: 'debt' }]]);
  await plant([
    { type: 'snapshot', accountId: ids.Depot, payload: { date: BACKDATE, value: '400000', note: null } },
    { type: 'snapshot', accountId: ids.Mortgage, payload: { date: BACKDATE, value: '-250000', note: null } },
  ]);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-card select')", { label: 'the dashboard' });
  await page.call(() => {
    const s = document.querySelector('.chart-card select');
    s.value = 'risk';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitUntil("document.querySelector('.bars')", { label: 'the breakdown' });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    check(`net-worth-view: the dashboard never pans sideways with long values at ${width}px`, seen.scrollWidth <= seen.width, JSON.stringify(seen));
    check(`net-worth-view: a value holding markup renders as text in the chart and the breakdown at ${width}px`, seen.images === 0, JSON.stringify(seen));
    for (const n of seen.shown) {
      check(
        `net-worth-view: ${n.name.slice(0, 12)}… is shown inside its card in ${n.where} at ${width}px`,
        !n.missing && n.inside,
        JSON.stringify(n),
      );
    }
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
