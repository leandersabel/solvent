// The dashboard with holdings whose names have no space, written from
// spec/features/net-worth-view.md (Holdings table, At phone width, and
// acceptance criterion 73) and app-shell.md (On a phone) without reading
// how the screen is built or tested. Each name, in the table, under Not
// yet valued, under Not priced and as an archived row, wraps wherever it
// must, is shown whole inside its own box and the screen, and nothing on
// the dashboard pans sideways or pushes a control off the screen.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { BACKDATE, check, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// Each wider than any of the widths below at body size, with no point a
// line may break at, and none a prefix of another.
const NAMES = {
  table: 'ZürcherKantonalbankPrivatbankingSparkontoNummer00123456789',
  notValued: 'PostFinanceVorsorgekontoDritteSäuleGebundenNummer98765',
  notPriced: 'InteractiveBrokersDollarMarginKontoSubaccountU1234567',
  archived: 'RaiffeisenbankMitgliederkontoAufgelöstSaldoÜbertragen4242',
};
const WIDTHS = [320, 375, 601, 901, 1280];

const measure = () => page.call((names) => {
  const width = document.documentElement.clientWidth;
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`;
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && n.closest('[hidden]') === null;
  };
  const html = document.documentElement;
  const pans = [];
  if (html.scrollWidth > html.clientWidth + 0.5) pans.push(`page ${html.scrollWidth} > ${html.clientWidth}`);
  const card = document.querySelector('.holdings-card') || document.body;
  for (const n of [card, ...card.querySelectorAll('*')]) {
    if (!shown(n)) continue;
    const s = getComputedStyle(n);
    if (['auto', 'scroll'].includes(s.overflowX) && n.scrollWidth > n.clientWidth + 0.5) pans.push(`${label(n)} ${n.scrollWidth} > ${n.clientWidth}`);
  }
  const past = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!shown(n)) continue;
    const s = getComputedStyle(n);
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') continue;
    const r = n.getBoundingClientRect();
    if (r.left < -0.5 || r.right > width + 0.5) past.push(`${label(n)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }

  // Each text node holding a name: where it is drawn, against the screen
  // and against the nearest box that is not inline, whose edge is the
  // edge of the cell or row it sits in.
  const found = {};
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (const [key, name] of Object.entries(names)) {
      const at = node.textContent.indexOf(name);
      if (at < 0 || !shown(node.parentElement)) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + name.length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      let box = node.parentElement;
      while (getComputedStyle(box).display === 'inline' && box.parentElement) box = box.parentElement;
      const b = box.getBoundingClientRect();
      const s = getComputedStyle(node.parentElement);
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      (found[key] ||= []).push({
        in: label(box),
        left: Math.round(left),
        right: Math.round(right),
        box: [Math.round(b.left), Math.round(b.right)],
        lines: new Set(rects.map((r) => Math.round(r.top))).size,
        inBox: left >= b.left - 0.5 && right <= b.right + 0.5,
        clipped: [node.parentElement, box].some((n) => n.scrollWidth > n.clientWidth + 0.5 && getComputedStyle(n).overflowX !== 'visible'),
        ellipsis: s.textOverflow === 'ellipsis' || getComputedStyle(box).textOverflow === 'ellipsis',
      });
    }
  }

  const controls = [...card.querySelectorAll('a[href], button, input, select, summary, [role=button]')].filter(shown);
  const offScreen = [];
  const covered = [];
  for (const c of controls) {
    c.scrollIntoView({ block: 'center', inline: 'center' });
    const r = c.getBoundingClientRect();
    if (r.left < -0.5 || r.right > width + 0.5) offScreen.push(`${label(c)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === c || c.contains(hit) || (c.tagName === 'INPUT' && c.labels && [...c.labels].some((l) => l.contains(hit))))) {
      covered.push(`${label(c)} under ${hit ? label(hit) : 'nothing'}`);
    }
  }
  window.scrollTo(0, 0);
  return JSON.stringify({ width, pans, past, found, offScreen, covered });
}, NAMES).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  await setProfile({ dimensions: [{ id: 'liq', label: 'Liquidity', values: [{ id: 'cash', label: 'Cash' }] }] });
  const account = (name, unit, archivedAt = null) => ({
    type: 'account',
    payload: { name, unit, dims: { liq: 'cash' }, note: null, archivedAt, createdAt: new Date().toISOString() },
  });
  const [table, , notPriced, archived] = await plant([
    account(NAMES.table, 'CHF'),
    account(NAMES.notValued, 'CHF'),
    // No price entry for the dollar is ever written, so its figure stays
    // not priced.
    account(NAMES.notPriced, 'USD'),
    account(NAMES.archived, 'CHF', BACKDATE),
  ]);
  const figure = (accountId, value) => ({ type: 'snapshot', accountId, payload: { date: BACKDATE, value, note: null } });
  await plant([figure(table, '1234567.89'), figure(notPriced, '250000.00'), figure(archived, '98765.43')]);
  await reloadModel();
  await page.waitUntil("document.querySelector('.holdings-card')", { timeout: 90000, label: 'the dashboard' });
  await page.eval("document.querySelector('.holdings-card .checkbox input').click()");
  await page.frames();

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    const where = `on the dashboard at ${width}px`;
    check(`net-worth-view: no page or box in the holdings card pans sideways ${where}`, seen.pans.length === 0, seen.pans.join('; '));
    check(`app-shell: nothing is drawn past the screen's edge ${where}`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
    check(`net-worth-view: every control of the holdings card lies on screen ${where}`, seen.offScreen.length === 0, seen.offScreen.join('; '));
    check(`net-worth-view: a tap at every control's centre in the holdings card lands on it ${where}`, seen.covered.length === 0, seen.covered.join('; '));
    for (const [key, name] of Object.entries(NAMES)) {
      const shown = seen.found[key] || [];
      check(`net-worth-view: the ${key} holding's name is shown ${where}`, shown.length > 0, name);
      for (const n of shown) {
        const detail = JSON.stringify(n);
        check(`net-worth-view: the ${key} name lies inside the screen ${where}`, n.left >= 0 && n.right <= seen.width, detail);
        check(`net-worth-view: the ${key} name stays inside its own cell ${where}`, n.inBox, detail);
        check(`net-worth-view: the ${key} name is shown whole, never cut off ${where}`, !n.clipped && !n.ellipsis, detail);
        // Wider than the screen, so it can fit only by wrapping.
        if (width < 600) check(`net-worth-view: the ${key} name wraps ${where}`, n.lines > 1, detail);
      }
    }
  }
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
