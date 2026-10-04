// Account detail at phone, tablet and desktop widths, written from
// spec/features/manage-accounts.md (Account detail, At phone width, and
// acceptance criterion 58) without reading how the screen is built.
// The list of values is found as the spec describes it: the entries
// whose dates are links, and the smallest box holding all of them.
import {
  BACKDATE, check, openHolding, page, plant, recording, reloadModel, run, vaultOwner,
} from '../harness.mjs';

const NAME = 'Zürcher Kantonalbank Sparkonto';
// Decrypted text the page must show as text, never as markup
// (architecture.md, Application hardening).
const MARKUP_NOTE = '<img src=x onerror=__noteRan=1> moved';
// An address has no point a line may break at, and this one is wider
// than the text column of a phone.
const ADDRESS = 'private.banking.desk@zuercherkantonalbank.ch';
const WIDTHS = [320, 375, 601, 901];
// Up to 900px the list of values is a list whose every action is a 44px
// target (Account detail, At phone width).
const NARROW = 900;

// A date as the screen writes it, in either order the locale picks.
const DATE_TEXT = String.raw`\d{1,2} [A-Z][a-z]{2}(?: \d{4})?|[A-Z][a-z]{2} \d{1,2}(?:, \d{4})?`;

const dayAfter = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Everything a check reads off the screen, measured in the page. `narrow`
// says whether the phone-width layout rules apply.
const measure = (narrow) => page.call((isNarrow, dateText) => {
  const DATE = new RegExp(`\\b(?:${dateText})\\b`, 'g');
  const FIGURE = /[-\u2212]?\d[\d'\u2019\u00a0\u202f\u2009 .,]*\d/g;
  const CONTROLS = 'a[href], button, input, select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
  const width = window.innerWidth;
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && n.closest('[hidden]') === null;
  };
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`;
  // How many lines a run of text spans.
  const lines = (node, start, end) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  };
  const textNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.parentElement && shown(walker.currentNode.parentElement)) nodes.push(walker.currentNode);
    return nodes;
  };

  const main = document.querySelector('#app') || document.body;
  const dateLinks = [...main.querySelectorAll('a, button')].filter((a) => shown(a) && new RegExp(`^(?:${dateText})$`).test(a.textContent.trim()));
  let list = dateLinks[0] || null;
  while (list && !dateLinks.every((a) => list.contains(a))) list = list.parentElement;

  // A page or box that pans sideways, and anything drawn past the edge.
  const html = document.documentElement;
  const pans = [];
  if (html.scrollWidth > html.clientWidth + 0.5) {
    // Text can spill out of a box that itself fits, so name what does.
    const spilling = textNodes(document.body).filter((t) => {
      const range = document.createRange();
      range.selectNodeContents(t);
      return range.getBoundingClientRect().right > html.clientWidth + 0.5;
    }).map((t) => `${label(t.parentElement)} holding "${t.textContent.trim().slice(0, 30)}"`);
    pans.push(`page ${html.scrollWidth} > ${html.clientWidth}${spilling.length ? `, past it: ${spilling.join(', ')}` : ''}`);
  }
  const past = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!shown(n)) continue;
    const s = getComputedStyle(n);
    if (['auto', 'scroll'].includes(s.overflowX) && n.scrollWidth > n.clientWidth + 0.5) pans.push(`${label(n)} ${n.scrollWidth} > ${n.clientWidth}`);
    // Visually hidden labels are clipped to nothing and are not drawn.
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') continue;
    const r = n.getBoundingClientRect();
    if (r.left < -0.5 || r.right > width + 0.5) past.push(`${label(n)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }

  // Every control, brought to the middle of the view, lies inside the
  // width and is what a tap at its centre lands on.
  const controls = [...document.querySelectorAll(CONTROLS)].filter(shown);
  const offScreen = [];
  const covered = [];
  for (const c of controls) {
    c.scrollIntoView({ block: 'center', inline: 'center' });
    const r = c.getBoundingClientRect();
    if (r.left < -0.5 || r.right > width + 0.5) offScreen.push(`${label(c)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === c || c.contains(hit))) covered.push(`${label(c)} under ${hit ? label(hit) : 'nothing'}`);
  }
  window.scrollTo(0, 0);

  const listControls = list ? controls.filter((c) => list.contains(c)) : [];
  const short = listControls.filter((c) => c.getBoundingClientRect().height < 43.5).map((c) => `${label(c)} ${c.getBoundingClientRect().height}`);

  // Dates and figures in the list, each on one line.
  const broken = [];
  for (const node of list ? textNodes(list) : []) {
    const text = node.textContent;
    const dates = [...text.matchAll(DATE)];
    for (const m of dates) if (lines(node, m.index, m.index + m[0].length) > 1) broken.push(`date "${m[0]}"`);
    const inDate = (i) => dates.some((d) => i >= d.index && i < d.index + d[0].length);
    for (const m of text.matchAll(FIGURE)) {
      if (m[0].replace(/\D/g, '').length < 4 || inDate(m.index)) continue;
      if (lines(node, m.index, m.index + m[0].length) > 1) broken.push(`figure "${m[0]}"`);
    }
  }

  // Each entry: its date first, then its figures, then its actions on a
  // line of their own.
  const order = [];
  if (isNarrow) {
    for (const link of dateLinks) {
      let entry = link.parentElement;
      while (entry && entry !== list && !(entry.querySelector('button') && [...entry.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Edit'))) entry = entry.parentElement;
      if (!entry || entry === list) continue;
      const figureBoxes = [];
      for (const node of textNodes(entry)) {
        if (link.contains(node) || node.parentElement.closest('button')) continue;
        for (const m of node.textContent.matchAll(FIGURE)) {
          if (m[0].replace(/\D/g, '').length < 4) continue;
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          figureBoxes.push(range.getBoundingClientRect());
        }
      }
      const actions = [...entry.querySelectorAll('button')].filter((b) => shown(b) && ['Edit', 'Delete'].includes(b.textContent.trim()));
      const dateBox = link.getBoundingClientRect();
      const figuresTop = Math.min(...figureBoxes.map((b) => b.top));
      const figuresBottom = Math.max(...figureBoxes.map((b) => b.bottom));
      // The value at the left, and the main-currency figure at its right
      // when the two share a line.
      const [value, converted] = figureBoxes;
      const ok = figureBoxes.length >= 1 && actions.length === 2 &&
        dateBox.bottom <= figuresTop + 0.5 &&
        actions.every((a) => a.getBoundingClientRect().top >= figuresBottom - 0.5) &&
        (!converted || Math.round(value.top) !== Math.round(converted.top) || value.right <= converted.left);
      if (!ok) order.push(`${link.textContent.trim()}: ${figureBoxes.length} figures, ${actions.length} actions`);
    }
  }

  return JSON.stringify({
    entries: dateLinks.length,
    list: Boolean(list),
    pans, past, offScreen, covered, short, broken, order,
    markupRan: window.__noteRan !== undefined || (list ? list.querySelectorAll('img').length : 0) > 0,
    noteShown: list ? list.textContent.includes('<img src=x onerror=__noteRan=1> moved') : false,
  });
}, narrow, DATE_TEXT).then(JSON.parse);

// The note icons: the list's controls that are neither a date link nor a
// named action.
const expandNotes = () => page.call((dateText) => {
  const dateLinks = [...document.querySelectorAll('a, button')].filter((a) => new RegExp(`^(?:${dateText})$`).test(a.textContent.trim()));
  let list = dateLinks[0] || null;
  while (list && !dateLinks.every((a) => list.contains(a))) list = list.parentElement;
  if (!list) return 0;
  const toggles = [...list.querySelectorAll('button, [role=button], summary')]
    .filter((b) => !dateLinks.includes(b) && !['Edit', 'Delete', 'Keep this one'].includes(b.textContent.trim()) && b.getBoundingClientRect().width > 0);
  for (const t of toggles) t.click();
  return toggles.length;
}, DATE_TEXT);

// The centre of the first entry's action named `name`, scrolled into view.
const actionCentre = (name) => page.call((wanted, dateText) => {
  const button = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === wanted && b.getBoundingClientRect().width > 0)
    .find((b) => [...document.querySelectorAll('a, button')].some((a) => new RegExp(`^(?:${dateText})$`).test(a.textContent.trim()) && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  if (!button) return null;
  button.scrollIntoView({ block: 'center' });
  const r = button.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, name, DATE_TEXT);

await run(async () => {
  await vaultOwner();
  const today = new Date().toISOString().slice(0, 10);
  const [id] = await plant([{
    type: 'account',
    payload: {
      name: NAME, unit: 'USD', dims: {}, note: `Held jointly. Statements from ${ADDRESS} every quarter.`,
      archivedAt: null, createdAt: new Date().toISOString(),
    },
  }]);
  await reloadModel();
  // A seven-digit figure today and at the backdate, both priced, a
  // second entry on the backdate, and one between them valued at the
  // backdate's price.
  await recording(today, { [NAME]: '1234567.89' });
  await recording(BACKDATE, { [NAME]: '1200000.00' });
  await plant([
    { type: 'snapshot', accountId: id, payload: { date: BACKDATE, value: '9876543.21', note: `${MARKUP_NOTE}, confirmed by ${ADDRESS}` } },
    { type: 'snapshot', accountId: id, payload: { date: dayAfter(BACKDATE, 10), value: '1210000.50', note: null } },
  ]);
  await reloadModel();
  await openHolding(id);
  await page.waitUntil("document.body.innerText.includes('Keep this one')", { label: 'the duplicate-date entries' });

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const narrow = width <= NARROW;
    for (const state of ['notes closed', 'notes open']) {
      if (state === 'notes open') {
        check(`there is a note icon to open at ${width}px`, (await expandNotes()) > 0);
        await page.frames();
      }
      const at = `at ${width}px, ${state}`;
      const seen = await measure(narrow);
      check(`the list of values shows four entries ${at}`, seen.list && seen.entries === 4, JSON.stringify(seen.entries));
      check(`no page or box pans sideways ${at}`, seen.pans.length === 0, seen.pans.join('; '));
      check(`nothing is drawn past the screen's edge ${at}`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
      check(`every control lies on screen ${at}`, seen.offScreen.length === 0, seen.offScreen.join('; '));
      check(`a tap at every control's centre lands on it ${at}`, seen.covered.length === 0, seen.covered.join('; '));
      check(`no date or figure in the list breaks across lines ${at}`, seen.broken.length === 0, seen.broken.join('; '));
      if (narrow) {
        check(`every control in the list of values is at least 44px tall ${at}`, seen.short.length === 0, seen.short.join('; '));
        check(`each entry shows its date, then its figures, then its actions on a line of their own ${at}`, seen.order.length === 0, seen.order.join('; '));
      }
      if (state === 'notes open') {
        check(`an entry's note is shown as text, never run as markup ${at}`, seen.noteShown && !seen.markupRan, JSON.stringify([seen.noteShown, seen.markupRan]));
      }
    }

    // A real tap on an entry's Edit and Delete opens what each opens.
    for (const [name, opens] of [['Edit', 'Snapshot entry'], ['Delete', 'confirm']]) {
      const centre = await actionCentre(name);
      let opened = false;
      if (centre) {
        await page.tap(centre.x, centre.y);
        opened = await page.holds("document.querySelector('.dialog')", { timeout: 10000, label: `the ${opens} dialog` });
      }
      check(`a tap on an entry's ${name} opens its ${opens} at ${width}px`, opened, JSON.stringify(centre));
      if (opened) {
        await page.key('Escape');
        await page.holds("!document.querySelector('.dialog')", { timeout: 10000, label: 'the dialog to close' });
      }
    }
    await reloadModel(`#/holding/${id}`);
    await page.waitUntil("document.body.innerText.includes('Keep this one')", { label: 'the holding again' });
  }
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
