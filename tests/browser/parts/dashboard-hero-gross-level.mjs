// While the dashboard is at least 1100px wide, gross
// assets and gross liabilities sit level with the foot of the total,
// with the change and the date line beneath the total
// (spec/features/net-worth-view.md, Hero figure, criterion 87).
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const WIDTHS = [1200, 1280, 1440, 1920];

// The foot of each figure's drawn text, and the top of the change.
const measure = () => page.call(() => {
  const foot = (n) => {
    const range = document.createRange();
    range.selectNodeContents(n);
    return Math.max(...[...range.getClientRects()].map((r) => r.bottom));
  };
  const hero = document.querySelector('.dashboard .hero');
  return JSON.stringify({
    total: foot(hero.querySelector('.hero-amount')),
    parts: [...hero.querySelectorAll('.hero-part-value')].map(foot),
    change: hero.querySelector('.hero-change').getBoundingClientRect().top,
    atLine: hero.querySelector('.hero-at-line').getBoundingClientRect().top,
  });
}).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  await setProfile({ locale: 'en-US' });
  await holdToday('2026-03-01');
  const ids = await holdings([['Home', 'CHF'], ['Mortgage', 'CHF']]);
  const figure = (name, date, value) => ({ type: 'snapshot', accountId: ids[name], payload: { date, value, note: null } });
  await plant([
    figure('Home', '2026-01-01', '1200000'), figure('Mortgage', '2026-01-01', '-231532'),
    figure('Home', '2026-03-01', '7800000'), figure('Mortgage', '2026-03-01', '-468761'),
  ]);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-change')", { label: 'the dashboard with its change' });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.frames();
    const s = await measure();
    check(`net-worth-view 83: gross assets and liabilities sit level with the foot of the total at ${width}px`,
      s.parts.length === 2 && s.parts.every((b) => Math.abs(b - s.total) <= 8), JSON.stringify(s));
    check(`net-worth-view Hero figure: the change and the date line sit beneath the total at ${width}px`,
      s.change >= s.total - 0.5 && s.atLine >= s.change, JSON.stringify(s));
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
