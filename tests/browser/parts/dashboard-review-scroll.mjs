// Where a screen opens, written from spec/features/app-shell.md (The
// bar, "A screen you open starts at its top"; acceptance criteria 81
// and 82). At a phone's width, a screen opened from a scrolled
// dashboard, by the bar's link, the bar's button or a holding's row,
// starts at its top with the whole bar in view, and the browser's Back
// and Forward return each screen to where it was. Nothing of it is kept
// past the page.
// Templates: dashboard.html. Modules: app.js, view-dashboard.js,
// view-holding.js, view-settings.js.
import { check, holdings, page, recording, reloadModel, run, vaultOwner } from '../harness.mjs';

const NAMES = Array.from({ length: 30 }, (_, n) => `Holding ${String(n + 1).padStart(2, '0')}`);
const LAST = NAMES.at(-1);

await run(async () => {
  await vaultOwner();
  await holdings(NAMES.map((name) => [name, 'CHF']));
  // The last holding has figures enough that its own screen scrolls.
  for (let day = 1; day <= 12; day++) {
    await recording(`2026-0${1 + Math.floor((day - 1) / 6)}-${String(((day - 1) % 6 + 1) * 4).padStart(2, '0')}`, { [LAST]: String(100 * day) });
  }
  await recording(new Date().toISOString().slice(0, 10), Object.fromEntries(NAMES.map((name, n) => [name, String(1000 + n)])));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await reloadModel('#/');
  const dashboard = () =>
    page.waitUntil("location.hash === '#/' && document.querySelector('svg.trend') && document.querySelector('.holdings-table .row-name')", {
      label: 'the dashboard',
    });
  await dashboard();
  await page.idle();

  const where = () => page.call(() => ({ y: Math.round(window.scrollY), bar: Math.round(document.querySelector('.topbar').getBoundingClientRect().top), tall: document.documentElement.scrollHeight }));
  const scrollTo = async (y) => {
    await page.call((to) => window.scrollTo(0, to), y);
    await page.frames();
  };
  const centerOf = (find, ...args) =>
    page.call(`(...args) => {
      const box = (${find})(...args).getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }`, ...args);
  const navigate = async (delta) => {
    const { currentIndex, entries } = await page.send('Page.getNavigationHistory');
    await page.send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex + delta].id });
  };
  // The position a screen settles at once it has drawn and grown.
  const settled = async (want, read) => {
    await page.holds(`(${read})() === ${JSON.stringify(want)}`, { timeout: 5000 });
    await page.frames(4);
    return page.call(read);
  };

  // ---- The bar's link ---------------------------------------------------

  // Scrolled by about the issue's 50 px, so the nav row of the bar is
  // still partly in view and the Settings link can take a real click.
  await scrollTo(50);
  const before = await where();
  const settings = await centerOf(() => document.querySelector('.topbar nav a[href="#/settings"]'));
  await page.mouseClick(settings.x, settings.y);
  await page.waitUntil("location.hash === '#/settings' && document.body.innerText.includes('Main currency')", { label: 'settings' });
  await page.idle();
  const onSettings = await where();
  check(
    'app-shell: a real click on Settings in the bar, from a dashboard scrolled down, opens Settings at its top with the bar at the top',
    before.y === 50 && onSettings.y === 0 && onSettings.bar === 0 && onSettings.tall > 844 + 50,
    JSON.stringify({ before, onSettings }),
  );

  await navigate(-1);
  await dashboard();
  const backFromSettings = await settled(50, () => Math.round(window.scrollY));
  check('app-shell: Back from Settings returns the dashboard to the same scrollY', backFromSettings === 50, JSON.stringify({ backFromSettings }));

  // ---- The bar's button -------------------------------------------------

  // The button sits in the bar's first row, so a smaller scroll leaves it in reach.
  const update = () => [...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === 'Update values');
  await scrollTo(0);
  const lifted = Math.round((await centerOf(update)).y) - 8;
  await scrollTo(lifted);
  const pressed = await centerOf(update);
  await page.mouseClick(pressed.x, pressed.y);
  await page.waitUntil("location.hash.startsWith('#/sweep/')", { label: 'the sweep' });
  await page.idle();
  const onSweep = await where();
  check(
    'app-shell: Update values in the bar, from a dashboard scrolled down, opens the sweep at its top with the bar at the top',
    lifted > 0 && onSweep.y === 0 && onSweep.bar === 0,
    JSON.stringify({ lifted, onSweep }),
  );
  await navigate(-1);
  await dashboard();
  await settled(lifted, () => Math.round(window.scrollY));

  // ---- A holding's row far down -----------------------------------------

  const lastRow = (name) => [...document.querySelectorAll('.holdings-table .row-name')].find((b) => b.textContent === name);
  await page.call(`(name) => (${lastRow})(name).scrollIntoView({ block: 'center' })`, LAST);
  await page.frames();
  const rowTop = `() => Math.round((${lastRow})(${JSON.stringify(LAST)}).getBoundingClientRect().top)`;
  const rowBefore = { ...(await where()), row: await page.call(rowTop) };
  const row = await centerOf(lastRow, LAST);
  await page.mouseClick(row.x, row.y);
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: 'the holding' });
  await page.idle();
  const onHolding = await where();
  check(
    "app-shell: a real click on a holding's row far down the dashboard opens the holding at its top with the bar at the top",
    rowBefore.y > 844 && onHolding.y === 0 && onHolding.bar === 0,
    JSON.stringify({ rowBefore, onHolding }),
  );

  // Scrolled on the holding, so Forward has a place of its own to return to.
  const holdingAt = Math.min(200, onHolding.tall - 844);
  await scrollTo(holdingAt);
  await navigate(-1);
  await dashboard();
  const rowAfter = await settled(rowBefore.row, rowTop);
  check(
    "app-shell: Back from the holding returns the dashboard with the holding's row at the same height on screen",
    rowAfter === rowBefore.row,
    JSON.stringify({ before: rowBefore.row, after: rowAfter, y: await page.eval('Math.round(scrollY)') }),
  );

  await navigate(1);
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: 'the holding again' });
  const forward = await settled(holdingAt, () => Math.round(window.scrollY));
  check(
    'app-shell: Forward to the holding returns it to where it was',
    holdingAt > 0 && forward === holdingAt,
    JSON.stringify({ holdingAt, forward }),
  );

  // ---- Nothing outlives the page ----------------------------------------

  const kept = await page.call((names, positions) => {
    const values = [];
    const walk = (v) => (v && typeof v === 'object' ? Object.values(v).forEach(walk) : values.push(v));
    walk(history.state);
    return {
      state: JSON.stringify(history.state),
      named: names.filter((name) => values.some((v) => String(v).includes(name))),
      positions: values.filter((v) => positions.includes(Number(v))),
    };
  }, NAMES, [50, rowBefore.y, holdingAt]);
  check(
    'app-shell: the history entry, which outlives the page, holds no scroll position and no holding',
    kept.named.length === 0 && kept.positions.length === 0,
    JSON.stringify(kept),
  );
}, { signsIn: false });
