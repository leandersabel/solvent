// A one-day history in Percentage, written from
// spec/features/net-worth-view.md alone (Axes, States, Ranges and modes,
// Reading a date, acceptance criteria 40 and 86): with every snapshot
// dated today, at 1280px and 390px and under every range, the bands'
// shares stand as one column the net-worth dot's width, centered on the
// plot's middle and wholly inside it, assets from 0% to 100% and
// liabilities from 0% to −100%, under Total and under a dimension. The
// date sits beneath it, and the pointer at either edge and the middle
// reads that day.
// Templates: dashboard.html. Modules: view-dashboard.js, chart.js.
import { check, click, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const TODAY = '2026-06-01';
const RANGES = ['1M', '6M', '1Y', 'All'];

const KIND = {
  id: 'kind',
  label: 'Kind',
  values: [
    { id: 'cash', label: 'Cash' },
    { id: 'liquid', label: 'Liquid investments' },
  ],
};

// Assets 600 + 400, liabilities 300: under Kind the assets split 60% and
// 40%, and the liability side is Cash alone.
const FIGURES = [
  ['Purse', { kind: 'cash' }, '600.00'],
  ['Broker', { kind: 'liquid' }, '400.00'],
  ['Loan', { kind: 'cash' }, '-300.00'],
];

const range = async (label) => {
  await page.call((name) => [...document.querySelectorAll('.range-buttons button')].find((b) => b.textContent.trim() === name).click(), label);
  await page.frames();
  await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the chart' });
};

const groupBy = async (id) => {
  await page.call((value) => {
    const s = document.querySelector('.chart-card select');
    s.value = value ?? [...s.options].find((o) => o.textContent.trim() === 'Total').value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.frames();
};

// The plot's ends, the net-worth dot, every band's extent and the value
// and date ticks, in SVG units, with the scale to page pixels.
const geometry = () =>
  page.call(() => {
    const svg = document.querySelector('.chart-frame svg.trend');
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const zero = svg.querySelector('.zero-line');
    const dot = svg.querySelector('.net-end');
    const bands = [...svg.querySelectorAll('path.band')].map((p) => {
      const b = p.getBBox();
      return { asset: p.getAttribute('fill-opacity') === '0.85', left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
    });
    const ticks = [...svg.querySelectorAll('text.axis-tick')].map((t) => ({
      text: t.textContent.trim(),
      x: Number(t.getAttribute('x')),
      y: Number(t.getAttribute('y')),
      box: (({ x, width }) => ({ x, width }))(t.getBBox()),
    }));
    const tickY = (label) => {
      const t = ticks.find((n) => n.text === label);
      return t ? t.y - 4 : null;
    };
    return {
      left: box.left,
      top: box.top,
      scale,
      x0: Number(zero.getAttribute('x1')),
      x1: Number(zero.getAttribute('x2')),
      dot: dot && (() => {
        const b = dot.getBBox();
        return { cx: b.x + b.width / 2, width: b.width };
      })(),
      bands,
      full: tickY('100%'),
      zero: tickY('0%'),
      less: tickY('−100%'),
      dates: ticks.filter((t) => !/^[−-]?\d+%$/.test(t.text) && !/^[−-]?[\d.,’'kMB\s]+$/.test(t.text) && t.text !== 'CHF'),
    };
  });

const pointAt = async (x, y) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.frames();
  return page.eval("document.querySelector('.chart-readout .readout-date')?.textContent");
};

const near = (a, b, tolerance) => a !== null && b !== null && Math.abs(a - b) <= tolerance;

await run(async () => {
  await vaultOwner();
  await holdToday(TODAY);
  const ids = await holdings(FIGURES.map(([name, dims]) => [name, 'CHF', dims]));
  await setProfile({ dimensions: [KIND], locale: 'en-US' });
  await plant(FIGURES.map(([name, , value]) =>
    ({ type: 'snapshot', accountId: ids[name], payload: { date: TODAY, value, note: null } })));
  const longDate = await page.call(async (at) => (await import('/static/js/session.js')).currentVault().format.longDate(at), TODAY);

  for (const [width, height, mobile] of [[1280, 900, false], [390, 844, true]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { label: 'the dashboard chart' });
    for (const label of RANGES) {
      await range(label);
      for (const [dimension, name] of [[null, 'Total'], ['kind', 'Kind']]) {
        await groupBy(dimension);
        await click('Absolute');
        await page.frames();
        const absolute = await geometry();
        await click('Percentage');
        await page.waitUntil("[...document.querySelectorAll('svg.trend text.axis-tick')].some((t) => t.textContent.trim() === '100%')", { label: 'the percentage ticks' });
        await page.eval("document.querySelector('.chart-frame svg.trend').scrollIntoView({ block: 'center' })");
        await page.frames();
        const g = await geometry();
        const where = `under ${label} and ${name} at ${width}px`;
        const half = 0.5 / g.scale;
        const middle = (g.x0 + g.x1) / 2;
        const assets = g.bands.filter((b) => b.asset);
        const liabilities = g.bands.filter((b) => !b.asset);
        const all = g.bands;
        const left = Math.min(...all.map((b) => b.left));
        const right = Math.max(...all.map((b) => b.right));
        const detail = JSON.stringify({ x0: g.x0, x1: g.x1, scale: g.scale, dot: absolute.dot, bands: g.bands, full: g.full, zero: g.zero, less: g.less });

        check(`net-worth-view 86: a one-day history in Percentage draws its bands as a column centered on the plot's middle ${where}`,
          all.length > 0 && near((left + right) / 2, middle, half), detail);
        check(`net-worth-view 86: the one-day column has nonzero width and lies wholly inside the plot ${where}`,
          all.length > 0 && right - left > 0 && left >= g.x0 - 0.01 && right <= g.x1 + 0.01 &&
            all.every((b) => b.left === left && b.right === right), detail);
        check(`net-worth-view Axes: the one-day column is the net-worth dot's width ${where}`,
          absolute.dot && all.length > 0 && near(right - left, absolute.dot.width, half), detail);
        check(`net-worth-view 86: the asset column runs from 0% to 100% ${where}`,
          assets.length > 0 && near(Math.max(...assets.map((b) => b.bottom)), g.zero, half) &&
            near(Math.min(...assets.map((b) => b.top)), g.full, half), detail);
        check(`net-worth-view Axes: the liability column runs from 0% to −100% ${where}`,
          liabilities.length > 0 && near(Math.min(...liabilities.map((b) => b.top)), g.zero, half) &&
            near(Math.max(...liabilities.map((b) => b.bottom)), g.less, half), detail);
        if (dimension) {
          const span = g.zero - g.full;
          const shares = assets.map((b) => (b.bottom - b.top) / span).sort((a, b) => a - b);
          check(`net-worth-view Axes: under Kind the one-day column stands at the asset bands' shares, 40% and 60%, ${where}`,
            shares.length === 2 && near(shares[0], 0.4, 0.01) && near(shares[1], 0.6, 0.01), JSON.stringify(shares));
        }
        check(`net-worth-view Axes: the one-day history's date stands beneath the column on the date axis ${where}`,
          g.dates.some((t) => near(t.box.x + t.box.width / 2, middle, half) && t.box.x >= 0 && t.box.x + t.box.width <= g.x1 + g.x0),
          JSON.stringify(g.dates));

        const y = g.top + ((g.zero + g.full) / 2) * g.scale;
        const read = [];
        for (const x of [g.x0 + 0.5, middle, g.x1 - 0.5]) read.push(await pointAt(g.left + x * g.scale, y));
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
        await page.frames();
        check(`net-worth-view 40: in Percentage the pointer at either edge and the middle reads the one day ${where}`,
          read.every((date) => date === longDate), JSON.stringify(read));
      }
    }
  }
}, { signsIn: false });
