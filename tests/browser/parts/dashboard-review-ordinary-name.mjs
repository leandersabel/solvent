// The holdings card with ordinary names and chips, written from
// spec/features/net-worth-view.md (Holdings table, At phone width, and
// acceptance criteria 63 and 73) without reading how the screen is built
// or tested. From 601px up each word of a name or a chip lies on one
// line. While the card is at least 890px wide the holdings show as a
// table under column headings, and below that as a list with none: the
// name with its chips beneath it at the left, the figures at the right,
// and, above phone width only, the row action beneath the figures. At
// phone width a tap on a row opens the holding, offering Unarchive for
// an archived one and Record a value for an active one.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { BACKDATE, check, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const LIQUID = 'Liquidity: Liquid investments';
const PURPOSE = 'Purpose: Retirement savings';
const ACTIVE = ['Cash account', 'Pension fund', 'Old dollar savings'];
const ARCHIVED = 'Closed dollar savings';
const NAMES = [...ACTIVE, ARCHIVED];
// The main-currency column's heading may name the currency, so it is
// not looked for by its copy.
const HEADINGS = ['Name', 'Dimensions', 'As of'];
const ACTIONS = ['Record a value', 'Unarchive'];
const PHONE = 600;
const CARD = 890;
const WIDTHS = [601, 901, 915, 960, 1024, 1280];

const measure = () => page.call((names, chips, headings, actions) => {
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      && s.clip !== 'rect(0px, 0px, 0px, 0px)' && s.clipPath !== 'inset(50%)' && n.closest('[hidden]') === null;
  };
  const card = document.querySelector('.holdings-card');
  const cardWidth = card.getBoundingClientRect().width;
  const own = (n) => [...n.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent).join('').trim();
  const headingsShown = [...card.querySelectorAll('*')]
    .filter((n) => shown(n) && (n.matches('th, [role=columnheader]') || headings.includes(own(n))))
    .map((n) => own(n) || n.tagName.toLowerCase());

  // Each word of each name and chip, and the lines it is drawn on.
  const split = [];
  const where = {};
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!shown(node.parentElement)) continue;
    for (const phrase of [...names, ...chips]) {
      const at = node.textContent.indexOf(phrase);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + phrase.length);
      const r = range.getBoundingClientRect();
      (where[phrase] ||= []).push({ node: node.parentElement, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      let offset = at;
      for (const word of phrase.split(' ')) {
        const w = document.createRange();
        w.setStart(node, offset);
        w.setEnd(node, offset + word.length);
        const lines = new Set([...w.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (lines.size > 1) split.push(`"${word}" of "${phrase}" over ${lines.size} lines`);
        offset += word.length + 1;
      }
    }
  }

  // A holding's row: the widest ancestor of its name holding no other
  // holding's name.
  const rowOf = (name) => {
    let row = where[name][0].node;
    while (row.parentElement && !names.some((o) => o !== name && row.parentElement.textContent.includes(o))) row = row.parentElement;
    return row;
  };
  const rows = {};
  for (const name of names) {
    if (!where[name]) continue;
    const row = rowOf(name);
    const rr = row.getBoundingClientRect();
    const nameBox = where[name][0];
    const chipBoxes = chips.flatMap((c) => (where[c] || []).filter((b) => row.contains(b.node)));
    const action = [...row.querySelectorAll('a, button')].filter((n) => shown(n) && actions.includes(n.textContent.trim()));
    // The row's other visible text: its figures and dates.
    const figures = [];
    const t = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    while (t.nextNode()) {
      const n = t.currentNode;
      const s = n.textContent.trim();
      if (!s || !shown(n.parentElement) || n.parentElement.closest('a, button')) continue;
      if (s === 'Archived' || [...names, ...chips].some((p) => s.includes(p))) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      figures.push({ text: s, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
    rows[name] = {
      row: [rr.left, rr.right],
      name: nameBox,
      chips: chipBoxes.map(({ top, bottom, left, right }) => ({ top, bottom, left, right })),
      figures,
      actions: action.map((a) => {
        const r = a.getBoundingClientRect();
        return { text: a.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }),
    };
    delete rows[name].name.node;
  }
  return JSON.stringify({ cardWidth, headingsShown, split, rows });
}, NAMES, [LIQUID, PURPOSE], HEADINGS, ACTIONS).then(JSON.parse);

const showArchived = () => page.eval(`(() => {
  const box = document.querySelector('.holdings-card .checkbox input');
  if (!box.checked) box.click();
})()`);

const atWidth = async (width) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false });
  await page.frames();
};

const layoutHolds = (width, seen) => {
  const at = `at ${width}px, card ${Math.round(seen.cardWidth)}px`;
  // Criterion 73 asks it from 601px up.
  if (width > PHONE) {
    check(`net-worth-view: every word of each name and chip lies on one line ${at}`, seen.split.length === 0, seen.split.join('; '));
  }
  for (const name of NAMES) check(`net-worth-view: "${name}" is listed ${at}`, Boolean(seen.rows[name]));
  if (seen.cardWidth >= CARD) {
    const missing = HEADINGS.filter((h) => !seen.headingsShown.includes(h));
    check(`net-worth-view: the holdings show under their column headings ${at}`, missing.length === 0, `missing ${missing.join(', ')} of ${seen.headingsShown.join(', ')}`);
  } else {
    check(`net-worth-view: the holdings list has no column headings ${at}`, seen.headingsShown.length === 0, seen.headingsShown.join(', '));
  }
  for (const [name, r] of Object.entries(seen.rows)) {
    const detail = JSON.stringify(r);
    const want = name === ARCHIVED ? 'Unarchive' : 'Record a value';
    if (width <= PHONE) {
      check(`net-worth-view: "${name}" carries no row action ${at}`, r.actions.length === 0, detail);
      continue;
    }
    check(`net-worth-view: "${name}" carries ${want} ${at}`, r.actions.length === 1 && r.actions[0].text === want, detail);
    if (seen.cardWidth >= CARD) continue;
    const middle = (r.row[0] + r.row[1]) / 2;
    check(`net-worth-view: "${name}"'s chips sit beneath its name ${at}`,
      r.chips.length > 0 && r.chips.every((c) => c.top >= r.name.bottom - 0.5 && c.left < middle), detail);
    check(`net-worth-view: "${name}"'s figures sit at the right of its row ${at}`,
      r.figures.length > 0 && r.figures.every((f) => f.left > middle && f.left >= r.name.right - 0.5), detail);
    const action = r.actions[0];
    if (action) {
      check(`net-worth-view: "${name}"'s row action sits beneath its figures at the right ${at}`,
        action.left > middle && r.figures.every((f) => action.top >= f.bottom - 0.5), detail);
    }
  }
};

await run(async () => {
  await vaultOwner();
  await setProfile({
    dimensions: [
      { id: 'liq', label: 'Liquidity', values: [{ id: 'inv', label: 'Liquid investments' }] },
      { id: 'pur', label: 'Purpose', values: [{ id: 'ret', label: 'Retirement savings' }] },
    ],
  });
  const dims = { liq: 'inv', pur: 'ret' };
  const account = (name, unit, archivedAt = null) => ({
    type: 'account',
    payload: { name, unit, dims, note: null, archivedAt, createdAt: new Date().toISOString() },
  });
  const ids = await plant([
    account('Cash account', 'CHF'),
    account('Pension fund', 'CHF'),
    account('Old dollar savings', 'USD'),
    account(ARCHIVED, 'USD', BACKDATE),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const figure = (accountId, date, value) => ({ type: 'snapshot', accountId, payload: { date, value, note: null } });
  // The dollar priced at the backdate only, so the dollar row today is
  // valued at an older price and carries a price date line.
  await plant([
    figure(ids[0], today, '12345678.90'),
    figure(ids[1], today, '98765432.10'),
    figure(ids[2], today, '23456789.01'),
    figure(ids[3], BACKDATE, '15000000.00'),
    {
      type: 'rate',
      payload: { symbol: 'USD', date: BACKDATE, rate: '0.85', rateTarget: 'CHF', rateSource: 'manual', rateAsOf: BACKDATE, proposedRate: null },
    },
  ]);
  await reloadModel();
  await page.waitUntil("document.querySelector('.holdings-card')", { timeout: 90000, label: 'the dashboard' });
  await showArchived();
  await page.frames();

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const width of WIDTHS) {
    await atWidth(width);
    layoutHolds(width, await measure());
  }

  // Either side of the 890px card, wherever the window puts it.
  await atWidth(1024);
  const offset = 1024 - Math.round((await measure()).cardWidth);
  for (const width of [CARD - 1 + offset, CARD + offset]) {
    await atWidth(width);
    layoutHolds(width, await measure());
  }

  // Phone width: no row action, and a tap opens the holding.
  for (const width of [320, 375, 600]) {
    await atWidth(width);
    layoutHolds(width, await measure());
  }
  await atWidth(375);
  for (const [name, offer] of [[ARCHIVED, 'Unarchive'], ['Cash account', 'Record a value']]) {
    const at = await page.call((wanted) => {
      const walker = document.createTreeWalker(document.querySelector('.holdings-card'), NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.trim() !== wanted) continue;
        const el = walker.currentNode.parentElement;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return null;
    }, name);
    check(`net-worth-view: "${name}" is on the dashboard at 375px`, at !== null);
    if (!at) continue;
    await page.tap(at.x, at.y);
    const opened = await page.waitUntil("document.querySelector('.detail-header')", { label: `${name}'s screen` })
      .then(() => true, () => false);
    check(`net-worth-view: a tap on "${name}" at 375px opens its screen`, opened);
    if (opened) {
      await page.frames();
      const offered = await page.call((label) => [...document.querySelectorAll('a, button')]
        .some((b) => b.textContent.trim() === label && b.getBoundingClientRect().width > 0), offer);
      check(`net-worth-view: "${name}"'s screen offers ${offer}`, offered);
    }
    await page.call(() => { location.hash = '#/'; });
    await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard again' });
    await showArchived();
    await page.frames();
  }
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
