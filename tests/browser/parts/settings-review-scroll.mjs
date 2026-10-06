// Settings left scrolled down and come back to with the browser's
// Forward, written from spec/features/app-shell.md (The bar, "Going
// back or forward with the browser returns you to where you were on
// that screen"). Its session list is fetched, so the screen reaches its
// full height only once the list arrives, here over a network that
// takes a moment.
// Templates: dashboard.html. Modules: app.js, view-settings.js.
import { check, intercept, page, reloadModel, run, vaultOwner } from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await reloadModel('#/');
  await page.eval("location.hash = '#/settings'");
  const settings = "location.hash === '#/settings' && document.querySelector('.sessions-table')";
  await page.waitUntil(settings, { label: 'settings with its sessions' });
  await page.idle();

  await page.call(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.frames();
  const left = await page.eval('Math.round(scrollY)');

  const navigate = async (delta) => {
    const { currentIndex, entries } = await page.send('Page.getNavigationHistory');
    await page.send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex + delta].id });
  };
  await navigate(-1);
  await page.waitUntil("location.hash === '#/' && document.body.innerText.includes('Add your first holding')", { label: 'the dashboard' });
  await page.idle();

  // The list takes a moment to arrive, as it can on a phone's network.
  const release = await intercept(page, '*/api/sessions', () => new Promise((done) => setTimeout(() => done(null), 300)));
  await navigate(1);
  await page.waitUntil(settings, { label: 'settings again' });
  await page.idle();
  await release();
  const back = await page.eval('Math.round(scrollY)');
  check(
    'app-shell: Forward to Settings, whose session list arrives after the screen draws, returns it to where it was left',
    left > 844 && back === left,
    JSON.stringify({ left, back }),
  );
}, { signsIn: false });
