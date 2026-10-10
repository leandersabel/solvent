// The entry mark's click target, written from
// spec/features/net-worth-view.md alone (Trend chart card, The estimated
// marker, Reading a date, acceptance criteria 22 and 27). Four years of
// history under All make a day narrower than a pixel, at 1280px and at
// 390px. A tick is a target 24px square around its drawn mark: a click
// or a tap 8px beside a lone tick, or 8px below it, opens its recording,
// one 16px beside it opens nothing, and so does a click on the plot 8px
// beside it. A tick on the chart's last day, a recording made today,
// takes the same 8px on either side. Two ticks nearer than 24px split
// the gap between them halfway. Just the line takes away the marks and paints nothing else
// differently, so the target itself draws nothing.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, vaultOwner } from '../harness.mjs';

const TODAY = '2026-10-10';
const FIRST = '2022-10-01';
const LONE = '2024-06-01';
const PAIR = ['2025-06-01', '2025-06-26'];
const dayOf = (iso) => Date.UTC(...iso.split('-').map((part, n) => Number(part) - (n === 1 ? 1 : 0))) / 86400000;
const SPAN = dayOf(TODAY) - dayOf(FIRST);

const home = async () => {
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the dashboard chart' });
  await page.call(() => [...document.querySelectorAll('.range-buttons button')].find((b) => b.textContent.trim() === 'All').click());
  await page.frames();
  await page.eval("document.querySelector('.chart-frame svg.trend').scrollIntoView({ block: 'center' })");
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await page.frames();
};
// Where each day and the marks sit, in page pixels: a day's x from the
// plot's ends (Reading a date), the marks' vertical middle, and the
// plot's.
const geometry = () =>
  page.call(() => {
    const svg = document.querySelector('.chart-frame svg.trend');
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const zero = svg.querySelector('.zero-line');
    const mark = svg.querySelector('.entry-mark').getBoundingClientRect();
    return {
      box: { x: box.left, y: box.top, width: box.width, height: box.height },
      left: box.left + Number(zero.getAttribute('x1')) * scale,
      right: box.left + Number(zero.getAttribute('x2')) * scale,
      markY: mark.top + mark.height / 2,
      plotY: box.top + box.height * 0.4,
    };
  });
const xOf = (g, iso) => g.left + ((dayOf(iso) - dayOf(FIRST)) * (g.right - g.left)) / SPAN;

// The recording a press at (x, y) opens, or the hash it left.
const press = async (x, y, touch) => {
  await (touch ? page.tap(x, y) : page.mouseClick(x, y));
  await page.frames(4);
  const hash = await page.eval('location.hash');
  if (hash !== '#/') await home();
  return hash.startsWith('#/recording/') ? hash.slice('#/recording/'.length) : hash;
};

// The svg as painted, one RGBA array, decoded in the page. A clip is
// placed on the document, not the viewport.
const pixels = async (box) => {
  const { data } = await page.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x + box.scrollX, y: box.y + box.scrollY, width: box.width, height: box.height, scale: 1 },
  });
  return page.call(async (png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return { width: image.width, data: Array.from(ctx.getImageData(0, 0, image.width, image.height).data) };
  }, data);
};
const justTheLine = async () => {
  await page.call(() => {
    const box = [...document.querySelectorAll('.chart-card label')].find((l) => l.textContent.includes('Just the line'));
    box.querySelector('input').click();
  });
  await page.waitUntil("document.querySelector('svg.trend') && !document.querySelector('svg.trend .entry-mark')", { label: 'the chart with just the line' });
  await page.frames();
};
// The svg's box on the page now, scrolled into view.
const svgBox = async () => {
  await page.eval("document.activeElement && document.activeElement.blur()");
  await page.eval("document.querySelector('.chart-frame svg.trend').scrollIntoView({ block: 'center' })");
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await page.frames();
  return page.call(() => {
    const b = document.querySelector('.chart-frame svg.trend').getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height, scrollX, scrollY };
  });
};

await run(async () => {
  await vaultOwner();
  await holdToday(TODAY);
  const ids = await holdings([['Cash', 'CHF']]);
  await plant(
    [[FIRST, '1000'], [LONE, '2000'], [PAIR[0], '1500'], [PAIR[1], '3000'], [TODAY, '2500']].map(([date, value]) => ({
      type: 'snapshot',
      accountId: ids.Cash,
      payload: { date, value, note: null },
    })),
  );

  for (const [width, height, mobile] of [[1280, 900, false], [390, 844, true]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await home();
    const g = await geometry();
    const lone = xOf(g, LONE);
    const dayWidth = (g.right - g.left) / SPAN;

    // Criterion 27: 8px beside a lone tick, either side, opens it.
    const beside = { left: await press(lone - 8, g.markY), right: await press(lone + 8, g.markY), below: await press(lone, g.markY + 8) };
    check(
      `net-worth-view 27: a click 8px either side of a lone tick, or 8px below it, opens its recording at ${width}px`,
      dayWidth < 1 && beside.left === LONE && beside.right === LONE && beside.below === LONE,
      JSON.stringify({ dayWidth, lone, markY: g.markY, beside }),
    );
    if (mobile) {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      const tapped = { left: await press(lone - 8, g.markY, true), right: await press(lone + 8, g.markY, true) };
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      check(
        `net-worth-view 27: a tap 8px either side of a lone tick opens its recording at ${width}px`,
        tapped.left === LONE && tapped.right === LONE,
        JSON.stringify(tapped),
      );
    }

    // Outside the 24px square, and on the plot above the axis, the day
    // read carries no snapshot, so nothing opens.
    const away = {
      left: await press(lone - 16, g.markY),
      right: await press(lone + 16, g.markY),
      plotLeft: await press(lone - 8, g.plotY),
      plotRight: await press(lone + 8, g.plotY),
    };
    check(
      `net-worth-view 27: a click 16px beside a lone tick, or on the plot 8px beside it, opens nothing at ${width}px`,
      Object.values(away).every((hash) => hash === '#/'),
      JSON.stringify(away),
    );

    // The right edge: the target is the same 24px square there.
    const today = xOf(g, TODAY);
    const edge = { left: await press(today - 8, g.markY), right: await press(today + 8, g.markY) };
    check(
      `net-worth-view, Reading a date: a click 8px either side of a lone tick on the chart's last day opens its recording at ${width}px`,
      edge.left === TODAY && edge.right === TODAY,
      JSON.stringify({ today, svgRight: g.box.x + g.box.width, edge }),
    );

    // Two ticks nearer than 24px split the gap halfway, and each keeps
    // its outer side.
    const [a, b] = PAIR.map((iso) => xOf(g, iso));
    const gap = b - a;
    const split = {
      outerA: await press(a - 8, g.markY),
      nearA: await press(a + gap * 0.3, g.markY),
      nearB: await press(b - gap * 0.3, g.markY),
      outerB: await press(b + 8, g.markY),
    };
    check(
      `net-worth-view, Reading a date: two ticks nearer than 24px split the target halfway at ${width}px`,
      gap < 24 && split.outerA === PAIR[0] && split.nearA === PAIR[0] && split.nearB === PAIR[1] && split.outerB === PAIR[1],
      JSON.stringify({ gap, split }),
    );

    // Criterion 22: Just the line paints differently only where a mark
    // was drawn, so the target adds no paint of its own.
    const before = await svgBox();
    const marked = await pixels(before);
    await justTheLine();
    const after = await svgBox();
    const bare = await pixels(after);
    const marks = [FIRST, LONE, ...PAIR, TODAY].map((iso) => xOf(g, iso) - g.box.x);
    const markY = g.markY - g.box.y;
    const sameBox = ['x', 'width', 'height'].every((k) => before[k] === after[k]);
    const stray = [];
    for (let i = 0; i < marked.data.length; i += 4) {
      const differs = [0, 1, 2].some((c) => Math.abs(marked.data[i + c] - bare.data[i + c]) > 8);
      if (!differs) continue;
      const x = (i / 4) % marked.width;
      const y = Math.floor(i / 4 / marked.width);
      if (Math.abs(y + 0.5 - markY) <= 6 && marks.some((m) => Math.abs(x + 0.5 - m) <= 2)) continue;
      stray.push([x, y]);
    }
    check(
      `net-worth-view 22: Just the line repaints nothing but the drawn marks at ${width}px, so the target draws nothing`,
      sameBox && marked.data.length === bare.data.length && stray.length === 0,
      JSON.stringify({ before, after, count: stray.length, first: stray.slice(0, 12), marks, markY }),
    );
  }
}, { signsIn: false });
