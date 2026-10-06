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

  // A person who scrolls up before the list arrives stays where they
  // scrolled, by the wheel or by dragging the scrollbar.
  const ways = {
    'the wheel': async () => {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 195, y: 400, deltaX: 0, deltaY: -600 });
    },
    'the scrollbar': async () => {
      const { x, y } = await page.call(() => ({ x: window.innerWidth - 3, y: window.innerHeight - 20 }));
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y - 300, button: 'left', buttons: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y - 300, button: 'left', clickCount: 1 });
    },
  };
  for (const [way, scrollUp] of Object.entries(ways)) {
    await page.call(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.frames();
    const bottom = await page.eval('Math.round(scrollY)');
    await navigate(-1);
    await page.waitUntil("location.hash === '#/' && document.body.innerText.includes('Add your first holding')", { label: 'the dashboard' });
    await page.idle();
    let answer;
    const held = new Promise((done) => { answer = done; });
    const stop = await intercept(page, '*/api/sessions', () => held);
    await navigate(1);
    await page.waitUntil("location.hash === '#/settings' && document.querySelector('.sessions .skeleton-row')", { label: 'settings waiting on its list' });
    await page.frames();
    const drawn = await page.eval('Math.round(scrollY)');
    await scrollUp();
    const moved = await page.holds((from) => scrollY < from - 100, { args: [drawn], timeout: 5000 });
    const scrolledTo = await page.eval('Math.round(scrollY)');
    answer(null);
    await page.waitUntil(settings, { label: 'the list' });
    await page.idle();
    await stop();
    const after = await page.eval('Math.round(scrollY)');
    check(
      `app-shell: scrolling up by ${way} before the session list arrives keeps Settings where the person scrolled`,
      moved && after === scrolledTo,
      JSON.stringify({ bottom, drawn, scrolledTo, after }),
    );
  }
}, { signsIn: false });
