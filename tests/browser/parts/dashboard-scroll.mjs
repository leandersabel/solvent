// Where a screen opens (app-shell.md, Where a screen opens): one opened
// from the top bar or a link starts at its top with the whole bar in
// view, and Back returns to where the screen left was scrolled. Clicks
// are real input at a phone viewport, where the bar is not sticky.
import { check, page, reloadModel, run, story, vaultOwner } from '../harness.mjs';

const at = () => page.call(() => JSON.stringify({
  y: window.scrollY,
  bar: document.querySelector('.topbar').getBoundingClientRect().top,
  hash: location.hash,
})).then(JSON.parse);

// Real input at the middle of the first element matching `selector`,
// and holding `label` when one is given.
const clickOn = async (selector, label = null) => {
  const { x, y } = JSON.parse(await page.call((query, name) => {
    const el = [...document.querySelectorAll(query)].find((e) => name === null || e.textContent.trim() === name);
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, selector, label));
  await page.mouseClick(x, y);
};

await run(async () => {
  await vaultOwner();
  await story();
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 500, deviceScaleFactor: 2, mobile: true });
  await reloadModel();
  await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the holdings table' });
  await page.idle();

  // Scrolled a little, as far as the bar stays in reach, then Settings.
  await page.call(() => window.scrollTo(0, 40));
  await clickOn('.topbar nav a', 'Settings');
  await page.waitUntil("location.hash === '#/settings' && document.getElementById('app').className === 'app-narrow'", { label: 'Settings' });
  await page.frames();
  let seen = await at();
  check('app-shell: Settings opened from the bar starts at its top with the bar in view', seen.y === 0 && seen.bar === 0, JSON.stringify(seen));

  // Back to the dashboard, far down it, then a holding from its table.
  await page.eval('history.back()');
  await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the dashboard again' });
  await page.frames();
  seen = await at();
  check('app-shell: Back returns to where the dashboard was scrolled', seen.y === 40, JSON.stringify(seen));

  // The row is compared where it sits on screen, not by the scroll
  // offset: the dashboard's skeleton fills in after Back, and the
  // browser keeps the row where it was as it does.
  const rowTop = () => page.call(() => document.querySelector('.holdings-table .row-name').getBoundingClientRect().top);
  const far = await page.call(() => {
    document.querySelector('.holdings-table .row-name').scrollIntoView({ block: 'center' });
    return window.scrollY;
  });
  check('app-shell: the dashboard is scrolled well down before a holding opens', far > 100, String(far));
  await page.frames();
  const before = await rowTop();
  await clickOn('.holdings-table .row-name');
  await page.waitUntil("document.querySelector('.detail-header')", { label: 'a holding' });
  await page.frames();
  seen = await at();
  check('app-shell: a holding opened from the dashboard starts at its top with the bar in view', seen.y === 0 && seen.bar === 0, JSON.stringify(seen));

  await page.eval('history.back()');
  await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the dashboard once more' });
  await page.idle();
  const after = await rowTop();
  check('app-shell: Back from the holding shows the row it was opened from where it was', Math.abs(after - before) < 1, JSON.stringify({ before, after }));

  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
