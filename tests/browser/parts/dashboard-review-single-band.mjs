// A chart of one band, written from spec/features/net-worth-view.md
// (Trend chart card, The two neutral bands, A dimension no holding
// carries, and acceptance criteria 69, 75 and 80) without reading how
// the screen is built or tested. Under a dimension no holding carries,
// the lone "Unassigned" band has a legend entry naming it, in rule gray.
// Under a dimension every holding carries with one value, that value has
// one, as literal text even when it reads as markup. Each lone entry's
// figure is the exact total rounded half-even, and it is named at phone
// width too. Under "Total" the card shows no legend box, and switching
// back and forth brings the legend and takes it away.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, holdings, page, recording, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const MARKUP = '<script>alert(1)</script>';
const RULE_GRAY = 'rgb(196, 204, 207)';
// 1'000.50 and 2'000.00: the exact total 3'000.50 reads 3'000 half-even.
const TOTAL = 3000n;

// A figure as shown under en-US in whole units, the currency code, group
// commas and a leading plus dropped. `null` for anything else.
const shown = (text) => {
  const body = (text || '').replace(/[A-Z]{3}/g, '').replace(/[,\s+]/g, '');
  const match = /^([−-]?)([0-9]+)$/.exec(body);
  if (!match) return null;
  return match[1] ? -BigInt(match[2]) : BigInt(match[2]);
};

// The chart card's legend as drawn: whether any legend box shows, and
// each shown entry's name, figure and swatch colour.
const legend = () =>
  page.call(() => {
    const card = document.querySelector('.chart-frame').closest('section');
    const drawn = (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && n.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    };
    const boxes = [...card.querySelectorAll('.legend')].filter(drawn);
    const entries = [...card.querySelectorAll('.legend-entry')].filter(drawn).map((e) => {
      const name = e.querySelector('.legend-name');
      const value = e.querySelector('.legend-value');
      // The swatch: the entry's one coloured mark that is neither text
      // nor the figure.
      const swatch = [...e.querySelectorAll('*')].find((n) => n !== name && n !== value && !n.contains(name) &&
        drawn(n) && !n.textContent.trim() && getComputedStyle(n).backgroundColor !== 'rgba(0, 0, 0, 0)');
      const r = name ? name.getBoundingClientRect() : null;
      const c = card.getBoundingClientRect();
      return {
        name: name ? name.textContent.trim() : null,
        nameShown: Boolean(name && drawn(name) && r.left >= c.left - 0.5 && r.right <= c.right + 0.5),
        value: value && drawn(value) ? value.textContent.trim() : null,
        swatch: swatch ? getComputedStyle(swatch).backgroundColor : null,
      };
    });
    return {
      boxes: boxes.length,
      entries,
      scripts: [...document.querySelectorAll('script')].filter((s) => s.textContent.includes('alert(1)')).length,
    };
  });

// A dimension by its id, or "Total" by its label.
const groupBy = async (id) => {
  await page.call((value) => {
    const s = document.querySelector('.chart-card select');
    s.value = value ?? [...s.options].find((o) => o.textContent.trim() === 'Total').value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.frames();
};

// The readout's band rows at the middle of the plot.
const readout = async () => {
  const at = await page.call(() => {
    const chart = document.querySelector('.chart-frame svg.trend');
    chart.scrollIntoView({ block: 'center' });
    const r = chart.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await page.waitUntil("!document.querySelector('.chart-readout').hidden", { label: 'the readout' });
  const rows = await page.call(() =>
    [...document.querySelectorAll('.chart-readout .readout-row:not(.readout-net)')].map((p) => p.firstChild.textContent.trim()));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await page.frames();
  return rows;
};

await run(async () => {
  await vaultOwner();
  await setProfile({
    dimensions: [
      { id: 'region', label: 'Region', archivedAt: null, values: [{ id: 'eu', label: 'Europe', archivedAt: null }, { id: 'as', label: 'Asia', archivedAt: null }] },
      { id: 'risk', label: 'Risk', archivedAt: null, values: [{ id: 'lo', label: MARKUP, archivedAt: null }, { id: 'hi', label: 'High', archivedAt: null }] },
    ],
  });
  await holdings([['Pocket', 'CHF', { risk: 'lo' }], ['Fund', 'CHF', { risk: 'lo' }]]);
  await recording('2026-01-15', { Pocket: '500.00', Fund: '1500.00' });
  await recording(new Date().toISOString().slice(0, 10), { Pocket: '1000.50', Fund: '2000.00' });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-card select')", { timeout: 90000, label: 'the dashboard' });

  const cases = [
    ['region', 'Unassigned', 'a dimension no holding carries'],
    ['risk', MARKUP, 'a dimension every holding carries with one value'],
  ];
  for (const width of [1280, 375]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.frames();
    const at = `at ${width}px`;

    await groupBy(null);
    let seen = await legend();
    check(`net-worth-view: criterion 80, under "Total" the chart has no legend box ${at}`,
      seen.boxes === 0 && seen.entries.length === 0, JSON.stringify(seen));

    for (const [id, name, what] of cases) {
      await groupBy(id);
      seen = await legend();
      const where = `under ${what} ${at}`;
      const detail = JSON.stringify(seen);
      check(`net-worth-view: criterion 80, the legend shows ${where}`, seen.boxes === 1, detail);
      check(`net-worth-view: criterion 80, the legend has exactly one entry ${where}`, seen.entries.length === 1, detail);
      const [entry] = seen.entries;
      if (!entry) continue;
      check(`net-worth-view: criterion 80, the legend names the band "${name}" ${where}`, entry.name === name && entry.nameShown, detail);
      check(`net-worth-view: the lone entry carries a swatch ${where}`, entry.swatch !== null, detail);
      if (name === 'Unassigned') {
        check(`net-worth-view: The two neutral bands, the lone "Unassigned" swatch is rule gray ${where}`, entry.swatch === RULE_GRAY, detail);
      } else {
        check(`manage-accounts: criterion 17, a value named as markup becomes no element ${where}`, seen.scripts === 0, detail);
        check(`net-worth-view: a value band takes a chart slot, never rule gray ${where}`, entry.swatch !== null && entry.swatch !== RULE_GRAY, detail);
      }
      if (width > 600) {
        check(`net-worth-view: criterion 75, the lone entry's figure is its exact total rounded half-even ${where}`,
          shown(entry.value) === TOTAL, detail);
        const rows = await readout();
        check(`net-worth-view: criterion 69, the readout names the lone band "${name}" as literal text ${where}`,
          rows.length === 1 && rows[0] === name, JSON.stringify(rows));
      } else {
        check(`net-worth-view: At phone width, the legend runs without the band's figure ${where}`, entry.value === null, detail);
      }
    }

    await groupBy(null);
    seen = await legend();
    check(`net-worth-view: criterion 80, back under "Total" the legend box is gone ${at}`,
      seen.boxes === 0 && seen.entries.length === 0, JSON.stringify(seen));
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
