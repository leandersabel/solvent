// Update values with a holding name that has no space (record-snapshot.md,
// Update values, Layout, and acceptance criterion 106). The name wraps
// inside its own column and is shown whole, and the page never pans
// sideways.
import { BACKDATE, check, holdings, page, recording, reloadModel, run, vaultOwner } from '../harness.mjs';

// Wider than the name column at any of the widths below, with no point a
// line may break at.
const NAME = 'UnterschleissheimerstrassenverkehrsgesellschaftsbeteiligungsanteilNummer0123456789';
const WIDTHS = [320, 375, 601, 901, 1280];

const measure = () => page.call(() => {
  const html = document.documentElement;
  const box = (node) => node.getBoundingClientRect();
  const name = document.querySelector('.sweep-row .holding-name');
  return JSON.stringify({
    width: html.clientWidth,
    scrollWidth: html.scrollWidth,
    card: box(document.querySelector('.sweep-rows')),
    name: box(name),
    cut: name.scrollWidth > name.clientWidth + 0.5,
  });
}).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  await holdings([[NAME, 'CHF']]);
  await recording(BACKDATE, { [NAME]: '1234567.89' });
  await reloadModel(`#/sweep/${BACKDATE}`);
  await page.waitUntil("document.querySelector('.sweep-row .holding-name')", { label: 'the sweep row' });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    check(`update-values: the screen never pans sideways at ${width}px`, seen.scrollWidth <= seen.width, JSON.stringify(seen));
    check(
      `update-values: a long holding name is shown whole inside its card at ${width}px`,
      !seen.cut && seen.name.left >= seen.card.left - 0.5 && seen.name.right <= seen.card.right + 0.5,
      JSON.stringify(seen),
    );
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
