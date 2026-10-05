// The trend chart from the keyboard and by click, written from
// spec/features/net-worth-view.md (Trend chart card, Keyboard; Reading a
// date; acceptance criteria 26, 27 and 71). Focus reads the last day,
// Home and End the ends, Right every day once across a daylight-saving
// change, Shift and an arrow the marked dates, with Just the line on
// too, and Enter or a click opens a recording only on a marked date or
// its tick. Each is asked again with a mouse resting in the chart's axis
// strip and on its plot, where a person reading by keyboard can leave
// it.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js,
// model.js, format.js.
import { check, holdings, page, plant, reloadModel, run, vaultOwner } from '../harness.mjs';

// Europe/Zurich moves its clocks on 2026-03-29, inside the range.
const ZONE = 'Europe/Zurich';
const MARKED = ['2026-03-20', '2026-03-29', '2026-04-05'];
const UNMARKED = '2026-03-25';
const DAYS = [];
for (let at = Date.UTC(2026, 2, 20); at <= Date.UTC(2026, 3, 5); at += 86400000) DAYS.push(new Date(at).toISOString().slice(0, 10));

await run(async () => {
  await page.send('Emulation.setTimezoneOverride', { timezoneId: ZONE });
  await vaultOwner();
  const ids = await holdings([['Cash', 'CHF'], ['Savings', 'CHF']]);
  await plant([
    ...MARKED.map((date, n) => ({ type: 'snapshot', accountId: ids.Cash, payload: { date, value: String(1000 + 500 * n), note: null } })),
    { type: 'snapshot', accountId: ids.Savings, payload: { date: MARKED[0], value: '300', note: null } },
  ]);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const home = async () => {
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the dashboard chart' });
    await page.frames();
  };
  await home();

  const dates = Object.fromEntries(await page.call(async (list) => {
    const v = (await import('/static/js/session.js')).currentVault();
    return list.map((iso) => [iso, v.format.longDate(iso)]);
  }, DAYS));
  // The day the screen reads: the readout's date and the hero's, or null
  // when there is no crosshair.
  const reading = () =>
    page.call((all) => {
      const readout = document.querySelector('.chart-readout');
      const crosshair = document.querySelector('svg.trend .crosshair');
      if (!readout || readout.hidden || !crosshair || crosshair.getAttribute('visibility') === 'hidden') return null;
      const hero = document.querySelector('.hero-at');
      const found = Object.entries(all).filter(([, long]) => readout.textContent.includes(long));
      // The longest match, so "Mar 2" never stands for "Mar 29".
      const day = found.sort((a, b) => b[1].length - a[1].length)[0];
      return day && hero && !hero.hidden && hero.textContent.includes(day[1]) ? day[0] : `?${readout.textContent}|${hero && hero.textContent}`;
    }, dates);
  const key = async (name, shift = false) => {
    await page.key(name, { shift });
    await page.frames();
  };
  const focusChart = async () => {
    await page.eval("document.activeElement && document.activeElement.blur()");
    await page.frames();
    await page.eval("document.querySelector('svg.trend').focus()");
    await page.frames();
  };
  // Where a day's crosshair stands on screen, put there by the keyboard.
  const spotOf = async (iso) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1279, y: 899 });
    await focusChart();
    await key('Home');
    for (let n = 0; n < DAYS.indexOf(iso); n++) await key('ArrowRight');
    const spot = await page.call(() => {
      const svg = document.querySelector('svg.trend');
      const box = svg.getBoundingClientRect();
      const scale = box.width / Number(svg.getAttribute('width'));
      const line = svg.querySelector('.crosshair');
      return { x: box.left + Number(line.getAttribute('x1')) * scale, y: box.top + (Number(line.getAttribute('y1')) + Number(line.getAttribute('y2'))) / 2 * scale };
    });
    await page.eval("document.querySelector('svg.trend').blur()");
    return spot;
  };

  // Everything the keyboard must do, from wherever the mouse rests.
  const keyboard = async (where) => {
    await focusChart();
    const onFocus = await reading();
    await key('Home');
    const atHome = await reading();
    await key('ArrowLeft');
    const pastHome = await reading();
    const stepped = [atHome];
    for (let n = 1; n < DAYS.length; n++) {
      await key('ArrowRight');
      stepped.push(await reading());
    }
    await key('ArrowRight');
    const pastEnd = await reading();
    await key('Home');
    await key('End');
    const atEnd = await reading();
    check(
      `net-worth-view: focus puts the crosshair on the range's last day, Home and End reach the ends, and no key moves past either, ${where}`,
      onFocus === DAYS.at(-1) && atHome === DAYS[0] && pastHome === DAYS[0] && pastEnd === DAYS.at(-1) && atEnd === DAYS.at(-1),
      JSON.stringify({ onFocus, atHome, pastHome, pastEnd, atEnd }),
    );
    check(
      `net-worth-view: Right from the first day reads every day once and in order across a daylight-saving change in ${ZONE}, ${where}`,
      JSON.stringify(stepped) === JSON.stringify(DAYS),
      JSON.stringify(stepped.map((got, n) => (got === DAYS[n] ? null : `${DAYS[n]}:${got}`)).filter(Boolean)),
    );

    const jumps = async () => {
      await key('Home');
      const forward = [];
      for (let n = 0; n < MARKED.length + 1; n++) {
        await key('ArrowRight', true);
        forward.push(await reading());
      }
      const backward = [];
      for (let n = 0; n < MARKED.length + 1; n++) {
        await key('ArrowLeft', true);
        backward.push(await reading());
      }
      return { forward, backward };
    };
    // From the first day, which is marked, forward lands on each later
    // mark and stays at the last; backward from there the same way down.
    const want = { forward: [...MARKED.slice(1), MARKED.at(-1), MARKED.at(-1)], backward: [MARKED[1], MARKED[0], MARKED[0], MARKED[0]] };
    const plain = await jumps();
    check(
      `net-worth-view: Shift+Right and Shift+Left land on every marked date and no other, and stay put with none ahead, ${where}`,
      JSON.stringify(plain) === JSON.stringify(want),
      JSON.stringify(plain),
    );
    await page.eval("document.querySelector('svg.trend').blur()");
    await page.call(() => {
      const box = [...document.querySelectorAll('.chart-card label')].find((l) => l.textContent.includes('Just the line'));
      box.querySelector('input').click();
    });
    await page.waitUntil("document.querySelector('svg.trend') && !document.querySelector('svg.trend .entry-mark')", { label: 'the chart with just the line' });
    await page.frames();
    await focusChart();
    const bare = await jumps();
    check(
      `net-worth-view: Shift+Right and Shift+Left land on the marked dates with Just the line on, ${where}`,
      JSON.stringify(bare) === JSON.stringify(want),
      JSON.stringify(bare),
    );
    await page.eval("document.querySelector('svg.trend').blur()");
    await page.call(() => {
      const box = [...document.querySelectorAll('.chart-card label')].find((l) => l.textContent.includes('Just the line'));
      box.querySelector('input').click();
    });
    await page.waitUntil("document.querySelector('svg.trend .entry-mark')", { label: 'the chart with its marks' });
    await page.frames();

    // Enter on an unmarked day opens nothing, on a marked one its recording.
    await focusChart();
    await key('Home');
    for (let n = 0; n < DAYS.indexOf(UNMARKED); n++) await key('ArrowRight');
    const onUnmarked = await reading();
    await key('Enter');
    const afterUnmarked = await page.eval('location.hash');
    await key('ArrowRight', true);
    const onMarked = await reading();
    await key('Enter');
    const opened = await page.holds(`location.hash === '#/recording/${MARKED[1]}'`, { timeout: 5000 });
    check(
      `net-worth-view: Enter on a day with no snapshot opens nothing, and on a marked date opens that date's recording, ${where}`,
      onUnmarked === UNMARKED && afterUnmarked === '#/' && onMarked === MARKED[1] && opened,
      JSON.stringify({ onUnmarked, afterUnmarked, onMarked, now: await page.eval('location.hash') }),
    );
    await home();
  };

  // No mouse over the page at all.
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1279, y: 899 });
  await page.eval("document.querySelector('svg.trend').scrollIntoView({ block: 'center' })");
  await page.frames();
  await keyboard('with the mouse off the chart');

  // The mouse resting in the chart's axis strip, under the plot, where
  // it puts no crosshair of its own.
  const strip = await page.call(() => {
    const box = document.querySelector('svg.trend').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.bottom - 2 };
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: strip.x, y: strip.y });
  await page.frames();
  await keyboard('with the mouse resting in the axis strip');

  // The mouse resting on the plot, near its top, where the readout
  // stands, after a move that read the day under it.
  const onPlot = await page.call(() => {
    const box = document.querySelector('svg.trend').getBoundingClientRect();
    return { x: box.left + box.width * 0.4, y: box.top + 6 };
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: onPlot.x - 3, y: onPlot.y });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: onPlot.x, y: onPlot.y });
  await page.frames();
  await keyboard('with the mouse resting on the plot');
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1279, y: 899 });

  // A click: on a day with no snapshot nothing opens, on a marked day
  // and on its tick that date's recording does.
  const unmarkedSpot = await spotOf(UNMARKED);
  await page.mouseClick(unmarkedSpot.x, unmarkedSpot.y);
  await page.frames();
  const afterClick = await page.eval('location.hash');
  const markedSpot = await spotOf(MARKED[1]);
  await page.mouseClick(markedSpot.x, markedSpot.y);
  const clickedOpen = await page.holds(`location.hash === '#/recording/${MARKED[1]}'`, { timeout: 5000 });
  await home();
  const tick = await page.call((long) => {
    const mark = [...document.querySelectorAll('svg.trend .entry-mark')].find((m) => m.textContent.includes(long));
    if (!mark) return null;
    const box = mark.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, dates[MARKED[2]]);
  if (tick) await page.mouseClick(tick.x, tick.y);
  const tickOpen = Boolean(tick) && (await page.holds(`location.hash === '#/recording/${MARKED[2]}'`, { timeout: 5000 }));
  check(
    'net-worth-view: a click on a day with no snapshot opens nothing, and a click on a marked day or its tick opens that date\'s recording',
    afterClick === '#/' && clickedOpen && tickOpen,
    JSON.stringify({ afterClick, clickedOpen, tick, tickOpen }),
  );
}, { signsIn: false });
