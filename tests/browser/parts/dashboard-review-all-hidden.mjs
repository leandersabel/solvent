// The trend chart with nothing to draw, written from
// spec/features/net-worth-view.md alone (Trend chart card, Legend and
// Hover; Value ticks; acceptance criteria 84 and 85). A domain with no
// extent runs from 0 to 1, so a history of zeros under "Total" and a
// dimension with every band hidden both draw a value axis of 0 and 1,
// each with its gridline, the zero line at the bottom and the net-worth
// line on it, at desktop and phone width, with no attribute reading NaN
// and nothing logged. With every band hidden the hero still counts every
// band, while the tooltip's net total, covering only visible bands,
// reads zero. Showing a band again brings its own axis back.
// Templates: dashboard.html. Modules: chart.js, view-dashboard.js.
import { check, click, holdings, page, problems, recording, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const TODAY = new Date().toISOString().slice(0, 10);

// A figure as shown under en-US in whole units, the currency code, group
// commas and a leading plus dropped. `null` for anything else.
const shown = (text) => {
  const match = /^([−-]?)([0-9]+)$/.exec((text || '').replace(/[A-Z]{3}|[,\s+]/g, ''));
  if (!match) return null;
  return match[1] ? -BigInt(match[2]) : BigInt(match[2]);
};

// The plot as drawn: its value labels, each with whether a gridline runs
// through it, the zero line, the net-worth line and its dot, and every
// attribute in the chart that reads NaN. Positions are on screen, so a
// transform on a group moves nothing.
const plot = () =>
  page.call(() => {
    const svg = document.querySelector('.chart-frame svg.trend');
    const box = svg.getBoundingClientRect();
    // The zero line is the gridline at 0.
    const horizontals = [...svg.querySelectorAll('line')]
      .map((l) => l.getBoundingClientRect())
      .filter((r) => r.height < 1 && r.width > box.width / 2)
      .map((r) => r.top);
    const labels = [...svg.querySelectorAll('text.axis-tick[text-anchor=end]')].map((t) => {
      const r = t.getBoundingClientRect();
      return { text: t.textContent.trim(), top: r.top, bottom: r.bottom, gridline: horizontals.some((y) => y >= r.top - 4 && y <= r.bottom + 4) };
    });
    const zero = svg.querySelector('.zero-line');
    const z = zero ? zero.getBoundingClientRect() : null;
    const net = svg.querySelector('.net-line');
    const n = net ? net.getBoundingClientRect() : null;
    const end = svg.querySelector('.net-end');
    const e = end ? end.getBoundingClientRect() : null;
    const nan = [...svg.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].filter((a) => a.value.includes('NaN')).map((a) => `${el.tagName}.${a.name}`));
    return {
      labels,
      zero: z && Number.isFinite(z.top) ? z.top : null,
      net: n ? { top: n.top, height: n.height } : null,
      end: e ? (e.top + e.bottom) / 2 : null,
      nan,
    };
  });

// What is wrong with the plot `p` for a domain with no extent, or null.
const wrongEmpty = (p) => {
  if (p.nan.length) return `NaN in ${p.nan.join(', ')}`;
  const texts = p.labels.map((l) => l.text).sort();
  if (texts.join() !== '0,1') return `value labels ${JSON.stringify(texts)}, want 0 and 1`;
  const missing = p.labels.filter((l) => !l.gridline).map((l) => l.text);
  if (missing.length) return `no gridline at ${missing.join(', ')}`;
  const [zeroLabel, oneLabel] = ['0', '1'].map((t) => p.labels.find((l) => l.text === t));
  if (p.zero === null) return 'no zero line';
  if (p.zero < zeroLabel.top - 4 || p.zero > zeroLabel.bottom + 4) return `zero line at ${p.zero}, label 0 at ${zeroLabel.top}–${zeroLabel.bottom}`;
  if (!(oneLabel.bottom < p.zero)) return 'the 1 tick is not above zero';
  if (!p.net || p.net.height > 1 || Math.abs(p.net.top - p.zero) > 1) return `net-worth line ${JSON.stringify(p.net)} off the zero line at ${p.zero}`;
  if (p.end !== null && Math.abs(p.end - p.zero) > 1) return `net-worth dot at ${p.end} off the zero line at ${p.zero}`;
  return null;
};

const groupBy = async (id) => {
  await page.call((value) => {
    const s = document.querySelector('.chart-card select');
    s.value = value ?? [...s.options].find((o) => o.textContent.trim() === 'Total').value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.frames();
};

const toggleAll = async () => {
  await page.call(() => document.querySelectorAll('.legend-entry').forEach((e) => e.click()));
  await page.frames();
};

const heroTotal = () => page.call(() => document.querySelector('.dashboard .hero-amount').textContent.trim());

// The pointer over the middle of the plot: the readout's net total and
// the hero under it, then the pointer off the chart.
const hover = async () => {
  const at = await page.call(() => {
    const chart = document.querySelector('.chart-frame svg.trend');
    chart.scrollIntoView({ block: 'center' });
    const r = chart.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await page.waitUntil("!document.querySelector('.chart-readout').hidden", { label: 'the readout' });
  const read = await page.call(() => ({
    date: document.querySelector('.chart-readout .readout-date')?.textContent.trim() ?? null,
    net: document.querySelector('.chart-readout .readout-net .numeric')?.textContent.trim() ?? null,
    hero: document.querySelector('.dashboard .hero-amount').textContent.trim(),
  }));
  const p = await plot();
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await page.frames();
  return { ...read, nan: p.nan };
};

// The keyboard over every day, Home to End, with any NaN met on the way.
const stepThrough = async () => {
  await page.eval("document.querySelector('.chart-frame svg.trend').focus()");
  const nan = new Set();
  await page.key('Home');
  for (let n = 0; n < 4; n += 1) {
    await page.key('ArrowRight');
    await page.frames();
    (await plot()).nan.forEach((a) => nan.add(a));
  }
  await page.key('End');
  await page.frames();
  (await plot()).nan.forEach((a) => nan.add(a));
  await page.eval("document.querySelector('.chart-frame svg.trend').blur()");
  await page.frames();
  return [...nan];
};

await run(async () => {
  await vaultOwner();
  await holdings([['Empty', 'CHF', { liq: 'cash' }]]);
  await recording('2026-01-15', { Empty: '0.00' });
  await recording(TODAY, { Empty: '0.00' });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-frame svg.trend')", { timeout: 90000, label: 'the dashboard' });

  for (const width of [1280, 375]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.frames();
    const before = problems.length;
    const p = await plot();
    check(`net-worth-view Value ticks: a history of zeros under Total draws a value axis from 0 to 1 with its gridlines, and the net-worth line on zero, at ${width}px`,
      wrongEmpty(p) === null, `${wrongEmpty(p)}: ${JSON.stringify(p)}`);
    check(`net-worth-view Value ticks: a history of zeros logs no error at ${width}px`,
      problems.length === before, problems.slice(before).join(' | '));
  }
  await page.send('Emulation.clearDeviceMetricsOverride');

  await setProfile({
    dimensions: [{ id: 'liq', label: 'Liquidity', archivedAt: null, values: [{ id: 'cash', label: 'Cash', archivedAt: null }, { id: 'inv', label: 'Invested', archivedAt: null }] }],
    locale: 'en-US',
  });
  await holdings([['Pocket', 'CHF', { liq: 'cash' }], ['Fund', 'CHF', { liq: 'inv' }], ['Loan', 'CHF', {}]]);
  await recording('2026-01-15', { Pocket: '1000.00', Fund: '2500.00', Loan: '-400.00' });
  await recording(TODAY, { Pocket: '1200.00', Fund: '3000.00', Loan: '-300.00' });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-card select')", { timeout: 90000, label: 'the dashboard' });

  for (const width of [1280, 375]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.frames();
    const at = `at ${width}px`;
    await groupBy('liq');
    const restShown = await heroTotal();
    const hoverShown = await hover();
    const before = problems.length;

    await toggleAll();
    const entries = await page.call(() => document.querySelectorAll('.legend-entry').length);
    const p = await plot();
    check(`net-worth-view 85: with every band hidden through the legend, the plot draws its value axis from 0 to 1 with its gridlines, the zero line at the bottom and the net-worth line on it, ${at}`,
      entries === 3 && wrongEmpty(p) === null, `${entries} entries, ${wrongEmpty(p)}: ${JSON.stringify(p)}`);
    check(`net-worth-view 84: with every band hidden, the hero at rest still counts every band, ${at}`,
      (await heroTotal()) === restShown, `${await heroTotal()} vs ${restShown}`);

    if (width > 600) {
      const pointed = await hover();
      check('net-worth-view 84: with every band hidden, hovering the plot the hero still counts every band',
        pointed.date === hoverShown.date && pointed.hero === hoverShown.hero, JSON.stringify({ pointed, hoverShown }));
      check('net-worth-view Legend: with every band hidden, the tooltip\'s net total covers no band and reads 0',
        shown(pointed.net) === 0n, JSON.stringify(pointed));
      check('net-worth-view 85: with every band hidden, hovering the plot leaves no attribute reading NaN',
        pointed.nan.length === 0, pointed.nan.join(', '));
      const stepped = await stepThrough();
      check('net-worth-view 85: with every band hidden, stepping the keyboard across the chart leaves no attribute reading NaN',
        stepped.length === 0, stepped.join(', '));
    }

    await click('Percentage');
    await page.frames();
    const pct = await plot();
    check(`net-worth-view 85: with every band hidden in Percentage, the plot keeps a value axis, the zero line, and no attribute reading NaN, ${at}`,
      pct.nan.length === 0 && pct.labels.length >= 2 && pct.zero !== null, JSON.stringify(pct));
    await click('Absolute');
    await page.frames();

    check(`net-worth-view 85: with every band hidden the page logs no error, ${at}`,
      problems.length === before, problems.slice(before).join(' | '));

    // Fund alone: 2500 to 3000 lies well above 1, so the axis is the band's.
    await page.call(() => [...document.querySelectorAll('.legend-entry')].find((e) => e.querySelector('.legend-name').textContent.trim() === 'Invested').click());
    await page.frames();
    const back = await plot();
    const texts = back.labels.map((l) => l.text);
    check(`net-worth-view Legend: showing a band again draws its own value axis, ${at}`,
      back.nan.length === 0 && texts.length > 2 && !texts.includes('1') && back.labels.every((l) => l.gridline),
      JSON.stringify(back));
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.chart-card select')", { timeout: 90000, label: 'the dashboard' });
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
