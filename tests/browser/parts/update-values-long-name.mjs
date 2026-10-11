// Update values with a holding name that has no space (record-snapshot.md,
// Update values, Layout, and acceptance criterion 106). The name wraps
// inside its own column and is shown whole, and the page never pans
// sideways. An ordinary name breaks only between its words, which in the
// band just above phone width takes the row stacking.
import { BACKDATE, check, holdings, page, recording, reloadModel, run, vaultOwner } from '../harness.mjs';

// Wider than the name column at any of the widths below, with no point a
// line may break at.
const NAME = 'UnterschleissheimerstrassenverkehrsgesellschaftsbeteiligungsanteilNummer0123456789';
const ORDINARY = 'Old dollar savings';
const WIDTHS = [320, 375, 601, 640, 719, 901, 1280];

const measure = () => page.call((long, ordinary) => {
  const html = document.documentElement;
  const box = (node) => node.getBoundingClientRect();
  const named = (text) => [...document.querySelectorAll('.sweep-row .holding-name')].find((node) => node.textContent === text);
  const name = named(long);
  // A word drawn on more than one line was broken inside it.
  const text = named(ordinary).firstChild;
  const broken = [...text.data.matchAll(/\S+/g)].filter((word) => {
    const range = document.createRange();
    range.setStart(text, word.index);
    range.setEnd(text, word.index + word[0].length);
    return range.getClientRects().length > 1;
  }).map((word) => word[0]);
  return JSON.stringify({
    width: html.clientWidth,
    scrollWidth: html.scrollWidth,
    card: box(document.querySelector('.sweep-rows')),
    name: box(name),
    cut: name.scrollWidth > name.clientWidth + 0.5,
    broken,
  });
}, NAME, ORDINARY).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  await holdings([[NAME, 'CHF'], [ORDINARY, 'CHF']]);
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
    check(`update-values: an ordinary holding name breaks only between words at ${width}px`, !seen.broken.length, JSON.stringify(seen));
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
