// Recording detail with a holding name that has no space
// (record-snapshot.md, Recording detail, Layout and At phone width, and
// acceptance criterion 94). The name wraps inside its own column, each
// figure stays on one line, and the page never pans sideways.
import { BACKDATE, check, holdings, page, recording, reloadModel, run, vaultOwner } from '../harness.mjs';

// Wider than the name column at any of the widths below, with no point a
// line may break at.
const NAME = 'UnterschleissheimerstrassenverkehrsgesellschaftsbeteiligungsanteilNummer0123456789';
const WIDTHS = [320, 375, 601, 901, 1280];

const measure = () => page.call(() => {
  const html = document.documentElement;
  const box = (node) => node.getBoundingClientRect();
  const lines = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  };
  const row = document.querySelector('.recording-table tr');
  const name = row.querySelector('.link-button');
  return JSON.stringify({
    width: html.clientWidth,
    scrollWidth: html.scrollWidth,
    card: box(row.closest('.card')),
    name: box(name),
    figures: [...row.querySelectorAll('.numeric')].map((cell) => [cell.textContent, lines(cell)]),
  });
}).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  await holdings([[NAME, 'CHF']]);
  await recording(BACKDATE, { [NAME]: '1234567.89' });
  await reloadModel(`#/recording/${BACKDATE}`);
  await page.waitUntil("document.querySelector('.recording-table .link-button')", { label: 'the figure line' });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    check(`recording-detail: the screen never pans sideways at ${width}px`, seen.scrollWidth <= seen.width, JSON.stringify(seen));
    check(
      `recording-detail: a long holding name is shown inside its card at ${width}px`,
      seen.name.left >= seen.card.left - 0.5 && seen.name.right <= seen.card.right + 0.5,
      JSON.stringify(seen),
    );
    check(
      `recording-detail: each figure beside a long holding name stays on one line at ${width}px`,
      seen.figures.length === 2 && seen.figures.every(([, count]) => count === 1),
      JSON.stringify(seen.figures),
    );
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
