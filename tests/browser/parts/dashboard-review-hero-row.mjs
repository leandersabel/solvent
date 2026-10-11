// The hero's arrangement, written from spec/features/net-worth-view.md
// alone (Hero figure; At phone width; acceptance criterion 83) and
// design-system.md (Typography). Wherever the hero holds one row, gross
// assets and gross liabilities sit at the right, level with the foot of
// the total, each behind a hairline rule, with New recording after them
// and the change and the date line beneath the total. Which rates takes
// its own row beneath, at the left. Reading a day moves neither the
// chart nor the gross figures. At phone width the gross figures sit
// side by side in two equal columns beneath the change, Which rates
// spans the width beneath them and New recording beneath that, 48px
// tall. At any width, a net worth in the millions included, no part of
// the hero lies over another. The holding
// screen's header shares the hero's classes, and keeps its figure and
// its as-of date side by side on one line (manage-accounts.md, Header).
// Templates: dashboard.html. Modules: view-dashboard.js, view-holding.js.
// Styles: tokens.css.
import { BACKDATE, check, holdings, idNamed, openHolding, page, recording, reloadModel, run, vaultOwner } from '../harness.mjs';

const WIDE = [1920, 1440, 1280, 1200, 1100, 1000, 901];
const NARROW = [900, 760, 601];
const PHONE = 390;

// Where each part of the hero sits. A figure's foot is its baseline,
// read from an empty inline-block appended to it, whose bottom edge
// lies on the baseline, and its text's bottom from a range over it.
const layout = () =>
  page.call(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const foot = (node) => {
      if (!node) return null;
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;';
      node.append(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const range = document.createRange();
      range.selectNodeContents(node);
      return { baseline, ink: range.getBoundingClientRect().bottom };
    };
    const hero = document.querySelector('.dashboard .hero');
    const total = hero.querySelector('.hero-figure');
    const parts = [...hero.querySelectorAll('.hero-part')];
    const action = [...hero.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New recording');
    const rates = hero.querySelector('.hero-rates');
    return {
      hero: box(hero),
      total: box(total),
      // The figure's text, which can run past its own box.
      totalInk: (() => {
        const range = document.createRange();
        range.selectNodeContents(total);
        return box(range);
      })(),
      totalFoot: foot(total),
      change: box(hero.querySelector('.hero-change')),
      at: box(hero.querySelector('.hero-at-line')),
      parts: parts.map((part) => {
        const value = part.querySelector('.hero-part-value');
        const style = getComputedStyle(part);
        return {
          box: box(part),
          value: box(value),
          foot: foot(value),
          rule: style.borderLeftStyle !== 'none' ? parseFloat(style.borderLeftWidth) : 0,
          ruleTop: style.borderTopStyle !== 'none' ? parseFloat(style.borderTopWidth) : 0,
          label: part.textContent,
        };
      }),
      // A rule may belong to the row of gross figures rather than to
      // each: the one at the first figure's left, or the one over both
      // at phone width.
      partsRule: (() => {
        const style = getComputedStyle(hero.querySelector('.hero-parts'));
        return style.borderTopStyle !== 'none' ? parseFloat(style.borderTopWidth) : 0;
      })(),
      partsLeftRule: (() => {
        const style = getComputedStyle(hero.querySelector('.hero-parts'));
        return style.borderLeftStyle !== 'none' ? parseFloat(style.borderLeftWidth) : 0;
      })(),
      action: box(action),
      rates: box(rates),
      chart: box(document.querySelector('.dashboard svg.trend')),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });

const overlaps = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const near = (a, b, within) => Math.abs(a - b) <= within;

const atWidth = async (width) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.frames(4);
  return layout();
};

// The hero's own boxes, pairwise apart. The date line is empty and
// holds only its height, so it is left out.
const apart = (l) => {
  const named = { total: l.totalInk, change: l.change, action: l.action, rates: l.rates, assets: l.parts[0]?.box, liabilities: l.parts[1]?.box };
  const clashes = [];
  const keys = Object.keys(named);
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      if (overlaps(named[keys[i]], named[keys[j]])) clashes.push(`${keys[i]}/${keys[j]}`);
    }
  }
  return clashes;
};

await run(async () => {
  await vaultOwner();
  await holdings([['Cantonal account', 'CHF'], ['Mortgage', 'CHF']]);
  await recording(BACKDATE, { 'Cantonal account': '11000.00', Mortgage: '-420000.00' });
  await recording(new Date().toISOString().slice(0, 10), { 'Cantonal account': '12450.00', Mortgage: '-410000.00' });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard svg.trend') && document.querySelector('.dashboard .hero-change')", { label: 'the dashboard' });
  await page.idle();

  // ---- One row -----------------------------------------------------------

  let rows = 0;
  for (const width of WIDE) {
    const l = await atWidth(width);
    const [assets, liabilities] = l.parts;
    // The hero holds one row where the gross figures sit beside the total.
    const oneRow = assets && liabilities && assets.box.left >= l.total.right && l.action.left >= liabilities.box.right - 0.5;
    if (!oneRow) continue;
    rows += 1;
    const level = (part) => near(part.foot.baseline, l.totalFoot.baseline, 4) || near(part.foot.ink, l.totalFoot.ink, 4);
    check(
      `net-worth-view: at ${width}px gross assets and gross liabilities sit level with the foot of the total`,
      level(assets) && level(liabilities),
      JSON.stringify({ total: l.totalFoot, assets: assets.foot, liabilities: liabilities.foot }),
    );
    check(
      `net-worth-view: at ${width}px the change and the date line sit beneath the total, below the gross figures`,
      l.change.top >= l.total.bottom - 0.5 && l.at.top >= l.change.bottom - 0.5 && l.change.top >= Math.max(assets.value.bottom, liabilities.value.bottom) - 0.5,
      JSON.stringify({ total: l.total, change: l.change, at: l.at, assets: assets.value, liabilities: liabilities.value }),
    );
    check(
      `net-worth-view: at ${width}px each gross figure is set off by a hairline rule at its left, and New recording follows them`,
      (assets.rule || l.partsLeftRule) > 0 && (assets.rule || l.partsLeftRule) <= 1 && liabilities.rule > 0 && liabilities.rule <= 1 && liabilities.box.left >= assets.box.right - 0.5,
      JSON.stringify({ assets: assets.rule, row: l.partsLeftRule, liabilities: liabilities.rule }),
    );
    check(
      `net-worth-view: at ${width}px Which rates takes its own row beneath, at the left`,
      l.rates.top >= Math.max(l.total.bottom, assets.box.bottom, liabilities.box.bottom, l.action.bottom) - 0.5 && near(l.rates.left, l.hero.left, 1),
      JSON.stringify({ rates: l.rates, hero: l.hero, action: l.action }),
    );
    check(`net-worth-view: at ${width}px no part of the hero lies over another`, apart(l).length === 0, `${apart(l).join(', ')} ${JSON.stringify({ total: l.totalInk, assets: assets.box })}`);
  }
  check('net-worth-view: on a wide window the hero holds one row', rows > 0 && (await atWidth(1440)).parts[0].box.left >= (await layout()).total.right);

  // Reading a day moves neither the chart nor the gross figures.
  const before = await atWidth(1440);
  const plot = before.chart;
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(plot.left + plot.width / 2), y: Math.round(plot.top + plot.height / 2) });
  const reading = await page.holds("!document.querySelector('.dashboard .hero-at').hidden", { timeout: 5000 });
  await page.frames(2);
  const during = await layout();
  check(
    'net-worth-view: at 1440px reading a day shows its date and moves neither the chart nor the gross figures',
    reading && during.chart.top === before.chart.top && during.parts.every((part, n) => part.box.top === before.parts[n].box.top) && during.action.top === before.action.top,
    JSON.stringify({ reading, before: [before.chart.top, before.parts.map((p) => p.box.top)], during: [during.chart.top, during.parts.map((p) => p.box.top)] }),
  );
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await page.frames(2);

  // ---- At and below 900px ------------------------------------------------

  for (const width of NARROW) {
    const l = await atWidth(width);
    check(`net-worth-view: at ${width}px no part of the hero lies over another`, apart(l).length === 0, apart(l).join(', '));
    check(`net-worth-view: at ${width}px the page does not scroll sideways`, l.scrollWidth <= l.clientWidth, JSON.stringify([l.scrollWidth, l.clientWidth]));
    const [assets, liabilities] = l.parts;
    check(
      `net-worth-view: at ${width}px the gross figures sit beneath the change or level with the total's foot, never level with the change`,
      [assets, liabilities].every((part) => part.box.top >= l.change.bottom - 0.5 || near(part.foot.baseline, l.totalFoot.baseline, 4) || near(part.foot.ink, l.totalFoot.ink, 4)),
      JSON.stringify({ total: l.totalFoot, change: l.change, assets: assets.box, liabilities: liabilities.box }),
    );
  }

  // ---- At phone width ----------------------------------------------------

  await page.send('Emulation.setDeviceMetricsOverride', { width: PHONE, height: 844, deviceScaleFactor: 2, mobile: false });
  await page.frames(4);
  const p = await layout();
  const [assets, liabilities] = p.parts;
  check(
    'net-worth-view: at phone width the total, then the change, then the gross figures, top to bottom',
    p.change.top >= p.total.bottom - 0.5 && assets.box.top >= p.change.bottom - 0.5 && near(assets.box.top, liabilities.box.top, 1),
    JSON.stringify({ total: p.total, change: p.change, assets: assets.box, liabilities: liabilities.box }),
  );
  check(
    'net-worth-view: at phone width gross assets and liabilities sit side by side in two equal columns under a hairline rule',
    liabilities.box.left >= assets.box.right - 0.5 && near(assets.box.width, liabilities.box.width, 1.5) &&
      ((p.partsRule > 0 && p.partsRule <= 1) || [assets, liabilities].every((part) => part.ruleTop > 0 && part.ruleTop <= 1)),
    JSON.stringify({ assets: [assets.box, assets.ruleTop], liabilities: [liabilities.box, liabilities.ruleTop], row: p.partsRule }),
  );
  check(
    'net-worth-view: at phone width Which rates spans the width beneath the gross figures, and New recording beneath that, 48px tall',
    p.rates.top >= Math.max(assets.box.bottom, liabilities.box.bottom) - 0.5 &&
      near(p.rates.width, p.hero.width, 1) &&
      p.action.top >= p.rates.bottom - 0.5 &&
      near(p.action.height, 48, 0.5),
    JSON.stringify({ hero: p.hero, rates: p.rates, action: p.action }),
  );
  check('net-worth-view: at phone width no part of the hero lies over another', apart(p).length === 0, apart(p).join(', '));

  // ---- The holding screen's header ---------------------------------------

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await openHolding((await idNamed('Cantonal account'))[0]);
  const header = await page.call(() => {
    const line = document.querySelector('.detail-header .hero-line');
    const figure = line.querySelector('.hero-figure').getBoundingClientRect();
    const age = line.querySelector('.hero-age').getBoundingClientRect();
    return { figure: { top: figure.top, bottom: figure.bottom, right: figure.right }, age: { top: age.top, bottom: age.bottom, left: age.left } };
  });
  check(
    "manage-accounts: the holding's header figure and its as-of date sit beside each other on one line",
    header.age.left >= header.figure.right && header.age.top < header.figure.bottom && header.figure.top < header.age.bottom,
    JSON.stringify(header),
  );

  // ---- A net worth in the millions ---------------------------------------

  await recording(new Date().toISOString().slice(0, 10), { 'Cantonal account': '2500000.00', Mortgage: '-1200000.00' });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard svg.trend') && document.querySelector('.dashboard .hero-change')", { label: 'the dashboard in the millions' });
  await page.idle();
  for (const width of [1440, 1100, 1000, 950, 901, 760]) {
    const l = await atWidth(width);
    check(`net-worth-view: at ${width}px, with a net worth in the millions, no part of the hero lies over another`, apart(l).length === 0, `${apart(l).join(', ')} ${JSON.stringify({ total: l.totalInk, assets: l.parts[0].box })}`);
  }
}, { signsIn: false });
