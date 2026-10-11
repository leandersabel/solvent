// The hero's layout across window widths with a total in the millions
// and in the tens of millions, written from
// spec/features/net-worth-view.md alone (Hero figure, At phone width,
// and acceptance criterion 83). Above phone width the total stays clear
// of gross assets and the change's arrow, amount and percentage share
// one line. While the dashboard is narrower than 1000px the total and
// the change hold a row of their own, gross assets and gross
// liabilities sit at the left beneath them and New recording at the
// right; from 1000px gross assets sit beside the total. At phone width
// the gross figures sit side by side in two equal columns, Which rates
// spans the width beneath them and New recording, 48px tall, beneath
// that. The page never pans sideways.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, holdToday, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const PHONE = 600;
// Window widths around the phone edge, the reported 901px and either
// side of 1000px of dashboard width behind 40px gutters.
const WIDE = [601, 700, 768, 820, 900, 901, 950, 1000, 1024, 1079, 1080, 1095, 1100, 1280, 1440];
const NARROW = [320, 375, 414, 600];

// Each hero item's box, and the change's parts.
const measure = () => page.call(() => {
  const box = (n) => {
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const hero = document.querySelector('.dashboard .hero');
  const leaves = [...hero.querySelectorAll('*')].filter((n) => n.children.length === 0);
  const groupOf = (label) => {
    const leaf = leaves.find((n) => n.textContent.trim().toLowerCase() === label);
    return leaf ? leaf.parentElement : null;
  };
  // What a group draws: the union of its text's line boxes.
  const inked = (n) => {
    if (!n) return null;
    const rects = [];
    const t = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    while (t.nextNode()) {
      if (!t.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t.currentNode);
      rects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
    }
    if (!rects.length) return null;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  };
  const total = hero.querySelector('.hero-amount');
  // The change: the text holding the percentage, widened to the nearest
  // ancestor also holding the amount and the arrow, short of the total.
  const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
  let percent = null;
  while (walker.nextNode()) if (walker.currentNode.textContent.includes('%')) { percent = walker.currentNode; break; }
  let change = percent && percent.parentElement;
  while (change && change !== hero && !(change.querySelector('svg') && /\d[\d,'’]*\d/.test(change.textContent.replace(/[\d.]+%/, '')))) {
    if (change.parentElement.contains(total)) break;
    change = change.parentElement;
  }
  const arrow = change && change.querySelector('svg');
  // Every drawn piece of the change: the line boxes of each text run
  // holding the amount or the percentage, and the arrow. A note on what
  // the change is measured from is no part of the three.
  const pieces = [];
  if (change) {
    const t = document.createTreeWalker(change, NodeFilter.SHOW_TEXT);
    while (t.nextNode()) {
      if (!/\d/.test(t.currentNode.textContent) || /^since /.test(t.currentNode.textContent.trim())) continue;
      const range = document.createRange();
      range.selectNodeContents(t.currentNode);
      for (const r of range.getClientRects()) {
        if (r.width > 0) pieces.push({ text: t.currentNode.textContent.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      }
    }
    if (arrow) pieces.push({ text: 'arrow', ...box(arrow) });
  }
  const span = pieces.length ? {
    left: Math.min(...pieces.map((p) => p.left)), right: Math.max(...pieces.map((p) => p.right)),
    top: Math.min(...pieces.map((p) => p.top)), bottom: Math.max(...pieces.map((p) => p.bottom)),
  } : null;
  const newRecording = [...hero.querySelectorAll('a, button')].find((n) => n.textContent.trim() === 'New recording');
  let rates = leaves.find((n) => n.textContent.trim().startsWith('Latest rates'));
  while (rates && rates !== hero && !rates.textContent.includes('Rates as of each figure')) rates = rates.parentElement;
  const root = document.scrollingElement;
  return JSON.stringify({
    hero: box(hero),
    total: box(total),
    totalText: total ? total.parentElement.textContent.trim() : null,
    totalClipped: total ? total.scrollWidth > total.clientWidth + 1 : null,
    change: span,
    changeText: change ? change.textContent.replace(/\s+/g, ' ').trim() : null,
    arrow: Boolean(arrow),
    pieces,
    assets: box(groupOf('assets')),
    liabilities: box(groupOf('liabilities')),
    assetsInk: inked(groupOf('assets')),
    liabilitiesInk: inked(groupOf('liabilities')),
    newRecording: box(newRecording),
    rates: box(rates),
    pans: root.scrollWidth > window.innerWidth,
    scrollWidth: root.scrollWidth,
  });
}).then(JSON.parse);

const atWidth = async (width) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.frames();
};

const apart = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
const oneLine = (pieces) => pieces.length > 0 && Math.max(...pieces.map((p) => p.top)) < Math.min(...pieces.map((p) => p.bottom)) - 1;
const near = (a, b, slack = 1) => Math.abs(a - b) <= slack;

const heroHolds = async (width, scene) => {
  await atWidth(width);
  const s = await measure();
  const at = `${scene} at ${width}px (hero ${Math.round(s.hero.width)}px)`;
  const detail = JSON.stringify(s);
  check(`net-worth-view 73/79: the page never pans sideways, ${at}`, !s.pans, `scrollWidth ${s.scrollWidth}`);
  const found = s.total && s.change && s.assets && s.liabilities && s.newRecording && s.rates;
  check(`net-worth-view Hero figure: the total, the change, both gross figures, Which rates and New recording are found, ${at}`, Boolean(found), detail);
  if (!found) return;
  check(`net-worth-view Hero figure: the change carries an arrow icon, ${at}`, s.arrow, s.changeText);
  if (width <= PHONE) {
    check(`net-worth-view At phone width: gross assets and liabilities sit side by side beneath the change, ${at}`,
      s.assets.top >= s.change.bottom - 0.5 && near(s.assets.top, s.liabilities.top) && s.assets.right <= s.liabilities.left + 0.5, detail);
    check(`net-worth-view At phone width: gross assets and liabilities take two equal columns, ${at}`,
      near(s.assets.width, s.liabilities.width), `${s.assets.width} and ${s.liabilities.width}`);
    check(`net-worth-view At phone width: Which rates spans the width beneath the gross figures, ${at}`,
      s.rates.top >= Math.max(s.assets.bottom, s.liabilities.bottom) - 0.5 && s.rates.width >= s.hero.width - 1, JSON.stringify({ rates: s.rates, hero: s.hero }));
    check(`net-worth-view At phone width: New recording sits beneath Which rates, 48px tall, ${at}`,
      s.newRecording.top >= s.rates.bottom - 0.5 && near(s.newRecording.height, 48), JSON.stringify(s.newRecording));
    return;
  }
  // Criterion 83.
  check(`net-worth-view 83: the total stays clear of gross assets, ${at}`, apart(s.total, s.assets) && apart(s.change, s.assets), JSON.stringify({ total: s.total, assets: s.assets, text: s.totalText }));
  check(`net-worth-view 83: the change's arrow, amount and percentage read on one line, ${at}`,
    s.arrow && oneLine(s.pieces), `${s.changeText}: ${JSON.stringify(s.pieces)}`);
  check(`net-worth-view Hero figure: the total is drawn whole, ${at}`, !s.totalClipped, s.totalText);
  check(`net-worth-view Hero figure: gross liabilities' figure stays clear of New recording, ${at}`,
    apart(s.liabilitiesInk, s.newRecording), JSON.stringify({ liabilities: s.liabilitiesInk, newRecording: s.newRecording }));
  for (const [name, other] of [['gross liabilities', s.liabilities], ['New recording', s.newRecording]]) {
    check(`net-worth-view Hero figure: the total and the change stay clear of ${name}, ${at}`,
      apart(s.total, other) && apart(s.change, other), detail);
  }
  if (s.hero.width < 1000) {
    const foot = Math.max(s.total.bottom, s.change.bottom);
    check(`net-worth-view Hero figure: below 1000px the total and the change take a row of their own, ${at}`,
      [s.assets, s.liabilities, s.newRecording].every((b) => b.top >= foot - 0.5), detail);
    check(`net-worth-view Hero figure: below 1000px gross assets and liabilities sit at the left, side by side, ${at}`,
      s.assets.left < s.hero.left + s.hero.width / 4 && s.assets.right <= s.liabilities.left + 0.5 && near(s.assets.top, s.liabilities.top, 8), detail);
    check(`net-worth-view Hero figure: below 1000px New recording sits at the right, ${at}`,
      s.newRecording.left >= s.liabilities.right - 0.5 && near(s.newRecording.right, s.hero.right), detail);
  } else {
    check(`net-worth-view Hero figure: from 1000px gross assets sit beside the total, at its right, ${at}`,
      s.assets.left >= Math.max(s.total.right, s.change.right) - 0.5, detail);
    check(`net-worth-view Hero figure: from 1000px the gross figures sit level with the foot of the total, ${at}`,
      near(s.assetsInk.bottom, s.total.bottom, 8) && near(s.liabilitiesInk.bottom, s.total.bottom, 8),
      JSON.stringify({ total: s.total, assets: s.assetsInk, liabilities: s.liabilitiesInk }));
  }
  check(`net-worth-view Hero figure: Which rates takes its own row beneath, ${at}`,
    s.rates.top >= Math.max(s.assets.bottom, s.liabilities.bottom, s.newRecording.bottom, s.change.bottom) - 0.5
      && s.rates.left < s.hero.left + s.hero.width / 4, detail);
};

const clickRange = (label) => page.call((wanted) => {
  const control = [...document.querySelectorAll('.chart-card button, .chart-card label, .chart-card [role=radio]')]
    .find((n) => n.textContent.trim() === wanted);
  control.click();
}, label);

await run(async () => {
  await vaultOwner();
  await setProfile({ locale: 'en-US' });
  await holdToday('2026-03-01');
  const ids = await holdings([['Home', 'CHF'], ['Mortgage', 'CHF']]);
  const figure = (name, date, value) => ({ type: 'snapshot', accountId: ids[name], payload: { date, value, note: null } });
  const settle = async () => {
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.dashboard .hero-amount') && document.body.innerText.includes('%')", { label: 'the dashboard' });
  };

  // The issue's figures: CHF 7,331,239, up CHF 6,362,771 or 657.0% from
  // CHF 968,468.
  await plant([
    figure('Home', '2026-01-01', '1200000'), figure('Mortgage', '2026-01-01', '-231532'),
    figure('Home', '2026-03-01', '7800000'), figure('Mortgage', '2026-03-01', '-468761'),
  ]);
  await settle();
  const issue = await measure();
  check('net-worth-view 83: the millions scene shows the issue\'s total and change',
    /7,331,239/.test(issue.totalText) && /6,362,771/.test(issue.changeText) && /657\.0%/.test(issue.changeText), `${issue.totalText} / ${issue.changeText}`);
  for (const width of [...WIDE, ...NARROW]) await heroHolds(width, 'millions, rising');

  // Tens of millions, the widest digits, rising by thousands of percent.
  await holdToday('2026-04-01');
  await plant([figure('Home', '2026-04-01', '98888888'), figure('Mortgage', '2026-04-01', '-10000000')]);
  await settle();
  for (const width of [...WIDE, ...NARROW]) await heroHolds(width, 'tens of millions, rising');

  // Tens of millions, falling over 1M.
  await holdToday('2026-04-20');
  await plant([figure('Home', '2026-04-20', '88888888'), figure('Mortgage', '2026-04-20', '-90000000')]);
  await settle();
  await clickRange('1M');
  await page.frames();
  const falling = await measure();
  check('net-worth-view 83: the falling scene reads a fall in the tens of millions', /[−-]/.test(falling.changeText), falling.changeText);
  for (const width of [...WIDE, ...NARROW]) await heroHolds(width, 'tens of millions, falling');
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
