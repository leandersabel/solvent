// The hero's change when a figure rounds to zero
// (spec/features/net-worth-view.md, The change, acceptance criterion
// 39): a figure that reads zero carries no sign, and an amount that
// reads zero shows no arrow, in the flat tone.
// Templates: dashboard.html. Modules: view-dashboard.js, format.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const FIRST = '2026-06-01';
const LAST = '2026-06-10';

// The net worth on FIRST and LAST, and what the change reads.
const CASES = [
  ['10000', '9997', 'CHF −3 · 0.0%', 'down', 'critical'],
  ['10000', '9999.6', 'CHF 0 · 0.0%', null, 'flat'],
  ['10000', '10000.4', 'CHF 0 · 0.0%', null, 'flat'],
  ['2000', '2001', 'CHF +1 · 0.0%', 'up', 'good'],
  ['-1000', '-500', 'CHF +500 · +50.0%', 'up', 'good'],
  ['0', '500', 'CHF +500', 'up', 'good'],
];

await run(async () => {
  await vaultOwner();
  await setProfile({ locale: 'en-US' });
  const { Cash } = await holdings([['Cash', 'CHF']]);
  await holdToday(LAST);
  const snapshot = (date, value, recordId, version) =>
    ({ type: 'snapshot', accountId: Cash, recordId, version, payload: { date, value, note: null } });
  const ids = await plant([snapshot(FIRST, '1'), snapshot(LAST, '1')]);

  for (const [index, [start, end, text, arrow, tone]] of CASES.entries()) {
    await plant([snapshot(FIRST, start, ids[0], index + 2), snapshot(LAST, end, ids[1], index + 2)]);
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.dashboard .hero-change')", { label: 'the change' });
    const shown = await page.call(() => {
      const change = document.querySelector('.dashboard .hero-change');
      const icon = change.querySelector('.icon');
      return {
        text: change.querySelector('.hero-delta').textContent,
        arrow: icon ? icon.getAttribute('class').replace('icon icon-', '') : null,
        tone: ['good', 'critical', 'flat'].find((name) => change.classList.contains(name)) || null,
      };
    });
    check(
      `net-worth-view 39: ${start} to ${end} reads "${text}" with ${arrow ? `the ${arrow} arrow` : 'no arrow'}, in the ${tone} tone`,
      shown.text === text && shown.arrow === arrow && shown.tone === tone,
      JSON.stringify(shown),
    );
  }
}, { signsIn: false });
