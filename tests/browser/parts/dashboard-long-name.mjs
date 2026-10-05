// The dashboard with holding names that have no space (net-worth-view.md,
// Holdings table, and acceptance criterion 73): one in the table and one
// under Not yet valued. Each wraps and is shown whole, and the page never
// pans sideways.
import { BACKDATE, check, page, plant, reloadModel, run, vaultOwner } from '../harness.mjs';

// Wider than any of the widths below, with no point a line may break at.
const VALUED = 'ZürcherKantonalbankPrivatbankingSparkontoNummer00123456789';
const UNVALUED = 'PostFinanceVorsorgekontoDreiAFreizügigkeitNummer987654321';
const WIDTHS = [320, 375, 601, 901, 1280];

const measure = () => page.call((names) => {
  const html = document.documentElement;
  const width = html.clientWidth;
  const shown = names.map((name) => {
    const button = [...document.querySelectorAll('.holdings-card button')].find((b) => b.textContent === name);
    if (!button) return { name, missing: true };
    const r = button.getBoundingClientRect();
    return { name, left: r.left, right: r.right, cut: button.scrollWidth > button.clientWidth + 0.5 };
  });
  return JSON.stringify({ width, scrollWidth: html.scrollWidth, shown });
}, [VALUED, UNVALUED]).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  const [valued] = await plant([
    { type: 'account', payload: { name: VALUED, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
    { type: 'account', payload: { name: UNVALUED, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
  ]);
  await plant([{ type: 'snapshot', accountId: valued, payload: { date: BACKDATE, value: '1234567.89', note: null } }]);
  await reloadModel();
  await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the holdings table' });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    check(`net-worth-view: the dashboard never pans sideways at ${width}px`, seen.scrollWidth <= seen.width, JSON.stringify(seen));
    for (const n of seen.shown) {
      check(
        `net-worth-view: ${n.name.slice(0, 12)}… is shown whole inside the screen at ${width}px`,
        !n.missing && !n.cut && n.left >= -0.5 && n.right <= seen.width + 0.5,
        JSON.stringify(n),
      );
    }
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
