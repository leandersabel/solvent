// Reviewer's part for issue #123, written from
// spec/features/admin-invites.md (Admin, At phone width, Invites,
// Accounts, Units, Rules, and criteria 18 and 53) and design-system.md
// (Components, Chip, Accessibility) without reading how the screen is
// built. Rows, chips and controls are found by their text, and each
// table's entries by the row holding a known value.
import { BASE, administrator, check, openBrowser, page, register, run, sql } from '../harness.mjs';

// Criterion 53's widths, and 899 and 900, the widest two At phone width's
// "up to 900px wide" covers.
const WIDTHS = [320, 390, 768, 899, 900, 901, 1280];
// design-system.md, Ink and line.
const INK_SECONDARY = 'rgb(77, 87, 90)';
const LONG_NAME = 'abcdefghijklmnopqrstuvwxyz.01234';
const LONG_NOTE = 'Sarahs-work-laptop-in-the-second-floor-meeting-room-by-the-window';
const SPACED_NOTE = 'The laptop Sarah takes home on weekends and to the office in Basel';
const CHIPS = ['Administrator', 'User', 'Waiting', 'Used', 'Expired', 'Called back', 'Retired'];
const PASSWORD = 'plover ember quarry vellum';

// The sections, each with the value that picks its entry, the column
// headings that entry must carry, and the control its action cell offers.
const SECTIONS = {
  Invites: { key: LONG_NOTE, headings: ['Kind', 'Note', 'Created', 'Stops working', 'Status'], action: 'Call back' },
  Accounts: { key: LONG_NAME, headings: ['Username', 'Kind', 'Created', 'Last signed in', 'Items'], action: 'Remove' },
  Units: { key: 'XAU-ozt', headings: ['Code', 'Name', 'Kind', 'Rate lookup'], action: 'Retire' },
};

const api = (method, path, body) =>
  page.call(async (m, p, b) => {
    const response = await fetch(p, {
      method: m,
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: b === null ? undefined : JSON.stringify(b),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, method, path, body ?? null);

const invite = async (kind, label) => {
  const made = await api('POST', '/api/admin/invites', { expiresInDays: 7, label, kind });
  if (made.status !== 201 && made.status !== 200) throw new Error(`invite: ${JSON.stringify(made)}`);
  return made.body;
};

const registerElsewhere = async (token, username) => {
  const other = await openBrowser();
  try {
    await register(other.session, token, username, PASSWORD);
    await other.session.waitUntil("!location.pathname.startsWith('/register')", { timeout: 90000, label: `${username} registered` });
  } finally {
    other.close();
  }
};

const openSection = async (name) => {
  await page.call((label) => {
    const link = [...document.querySelectorAll('.section-switcher a, .section-switcher button')]
      .find((n) => n.textContent.trim() === label);
    link.click();
  }, name);
  await page.waitUntil(
    (key) => [...document.querySelectorAll('#app *')].some((n) => n.children.length === 0 && n.textContent.includes(key)),
    { args: [SECTIONS[name].key], timeout: 60000, label: `the ${name} table` },
  );
  await page.frames();
};

const setWidth = async (width) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: width < 900 });
  await page.frames();
};

// What a reader sees of the open section at `width`.
const measure = (width, section) => page.call((edge, spec, chipWords, exempt) => {
  const html = document.documentElement;
  const switcher = document.querySelector('.section-switcher');
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && n.closest('[hidden]') === null;
  };
  const clipped = (n) => {
    for (let a = n; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return true;
    }
    return false;
  };
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`;
  const lines = (rects) => new Set([...rects].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  const textNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (t.textContent.trim() && shown(t.parentElement) && !clipped(t.parentElement)) nodes.push(t);
    }
    return nodes;
  };
  const wordsSplit = (root) => {
    const split = [];
    for (const node of textNodes(root)) {
      for (const m of node.textContent.matchAll(/\S+/g)) {
        if (exempt.some((e) => e.includes(m[0]))) continue;
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        if (lines(range.getClientRects()) > 1) split.push(m[0]);
      }
    }
    return split;
  };

  // Sideways: the page, and any box but the section links.
  const pans = [];
  if (html.scrollWidth > edge + 0.5 || html.clientWidth > edge + 0.5) pans.push(`page ${html.scrollWidth} in ${edge}`);
  for (const n of document.querySelectorAll('body *')) {
    if (!shown(n) || (switcher && (switcher.contains(n) || n.contains(switcher)))) continue;
    const s = getComputedStyle(n);
    if (['auto', 'scroll'].includes(s.overflowX) && n.scrollWidth > n.clientWidth + 0.5) pans.push(`${label(n)} ${n.scrollWidth} > ${n.clientWidth}`);
  }

  // Past the edge: every control, and every piece of text, in the content.
  const past = [];
  const app = document.querySelector('#app');
  for (const n of app.querySelectorAll('*')) {
    if (!shown(n) || clipped(n) || (switcher && switcher.contains(n))) continue;
    const control = n.matches('button, a[href], input, select, textarea, summary, [role=button], [role=switch], [role=radio]');
    const ownText = [...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim());
    if (!control && !ownText) continue;
    const b = n.getBoundingClientRect();
    if (b.left < -0.5 || b.right > edge + 0.5) past.push(`${label(n)} ${Math.round(b.left)}..${Math.round(b.right)}`);
  }

  // Chips: the innermost element reading exactly a chip's word, drawn
  // with a fill or a border.
  const chips = [...app.querySelectorAll('*')].filter((n) => {
    if (!shown(n) || !chipWords.includes(n.textContent.trim())) return false;
    if ([...n.children].some((c) => c.textContent.trim() === n.textContent.trim())) return false;
    const s = getComputedStyle(n);
    return parseFloat(s.borderTopWidth) > 0 || s.backgroundColor !== 'rgba(0, 0, 0, 0)';
  });
  const chipProblems = [];
  for (const chip of chips) {
    const range = document.createRange();
    range.selectNodeContents(chip);
    const word = chip.textContent.trim();
    if (lines(range.getClientRects()) > 1) chipProblems.push(`${word} on ${lines(range.getClientRects())} lines`);
    if (chip.scrollWidth > chip.clientWidth + 0.5) chipProblems.push(`${word} clipped`);
    const holder = chip.closest('td, th, [role=cell], li') || chip.parentElement;
    const c = chip.getBoundingClientRect();
    const h = holder.getBoundingClientRect();
    if (c.left < h.left - 0.5 || c.right > h.right + 0.5) chipProblems.push(`${word} past its cell ${Math.round(c.right)} > ${Math.round(h.right)}`);
  }

  // Words split: in headings and controls.
  const split = [];
  for (const n of app.querySelectorAll('h1, h2, h3, h4, th, [role=columnheader], button, a, summary, label, select')) {
    if (shown(n) && !(switcher && switcher.contains(n))) split.push(...wordsSplit(n).map((w) => `${w} in ${n.tagName.toLowerCase()}`));
  }

  // The entry holding the key value: its cells, the labels beside them,
  // and where its action sits.
  const keyNode = textNodes(app).find((t) => t.textContent.includes(spec.key));
  let entry = null;
  if (keyNode) {
    for (let a = keyNode.parentElement; a && a !== app; a = a.parentElement) {
      const hasAction = [...a.querySelectorAll('button, a, [role=button]')].some((b) => b.textContent.trim() === spec.action);
      if (hasAction) { entry = a; break; }
    }
  }
  const out = { pans, past, chips: chips.map((c) => c.textContent.trim()), chipProblems, split, entry: Boolean(entry) };
  if (!entry) return JSON.stringify(out);
  const row = entry.closest('tr, [role=row]') || entry;
  const cells = [...row.children].filter(shown);
  const boxes = cells.map((c) => c.getBoundingClientRect());
  out.cells = cells.length;
  out.sideBySide = boxes.every((b, i) => i === 0 || (b.left >= boxes[i - 1].right - 0.5 && Math.abs(b.top - boxes[0].top) < 1));
  out.stacked = boxes.every((b, i) => i === 0 || b.top >= boxes[i - 1].bottom - 0.5);
  const action = [...row.querySelectorAll('button, a, [role=button]')].find((b) => b.textContent.trim() === spec.action && shown(b));
  const actionBox = action ? action.getBoundingClientRect() : null;
  out.actionOnScreen = Boolean(actionBox) && actionBox.left >= -0.5 && actionBox.right <= edge + 0.5;
  out.actionBeneath = Boolean(actionBox) && cells.every((c) => c.contains(action) || c.getBoundingClientRect().bottom <= actionBox.top + 0.5);
  // A heading beside a cell can be text or generated content.
  const labels = [];
  for (const n of row.querySelectorAll('*')) {
    if (!shown(n)) continue;
    for (const pseudo of ['::before', '::after']) {
      const s = getComputedStyle(n, pseudo);
      const content = s.content.replace(/^"|"$/g, '');
      if (s.content !== 'none' && s.content !== 'normal' && content) labels.push({ text: content, color: s.color });
    }
    const own = [...n.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent).join('').trim();
    if (own && spec.headings.includes(own) && !clipped(n)) labels.push({ text: own, color: getComputedStyle(n).color });
  }
  out.labels = labels;
  return JSON.stringify(out);
}, width, SECTIONS[section], CHIPS, [LONG_NAME, LONG_NOTE, SPACED_NOTE]).then(JSON.parse);

// The center of the shown control reading `text`, inside `scope`,
// scrolled into view vertically, as a finger would reach it.
const spot = (text, scope = '#app') => page.call((t, sel) => {
  const roots = [...document.querySelectorAll(sel)];
  const n = roots.flatMap((r) => [...r.querySelectorAll('button, a, summary, [role=button]')])
    .find((b) => b.textContent.trim() === t && b.getBoundingClientRect().width > 0 && !b.disabled);
  if (!n) return null;
  n.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, onScreen: r.left >= 0 && r.right <= innerWidth };
}, text, scope);

// In the row holding `key`.
const spotInRow = (key, text) => page.call((k, t) => {
  const holder = [...document.querySelectorAll('#app *')].find((n) => n.children.length === 0 && n.textContent.includes(k));
  if (!holder) return null;
  for (let a = holder.parentElement; a; a = a.parentElement) {
    const b = [...a.querySelectorAll('button, a, [role=button]')].find((c) => c.textContent.trim() === t && c.getBoundingClientRect().width > 0);
    if (b) {
      b.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, onScreen: r.left >= 0 && r.right <= innerWidth };
    }
  }
  return null;
}, key, text);

const tap = async (where, name) => {
  check(`${name} is on screen to be tapped`, where && where.onScreen, JSON.stringify(where));
  if (!where) throw new Error(`${name} not found`);
  await page.frames();
  await page.mouseClick(where.x, where.y);
};

const DIALOG = 'dialog[open], [role=dialog], [role=alertdialog]';
const DIALOG_BUTTONS = DIALOG.split(', ').map((s) => `${s} button`).join(', ');
const confirmIn = () =>
  page.call((sel) => [...document.querySelectorAll(sel)].map((b) => b.textContent.trim()).find((t) => t && t !== 'Cancel'), DIALOG_BUTTONS);

await run(async () => {
  await administrator(page);

  // The data criterion 53 names: a waiting administrator invite with a
  // long note, used invites, a 32-character username, and the rest of
  // the statuses and chips.
  const second = await invite('administrator', 'Second admin');
  await registerElsewhere(second.token, 'second.admin');
  const longUser = await invite('vault_owner', 'Long name');
  await registerElsewhere(longUser.token, LONG_NAME);
  const goneUser = await invite('vault_owner', 'Gone');
  await registerElsewhere(goneUser.token, 'gone.user');
  const removed = await api('DELETE', '/api/admin/accounts/gone.user', { confirmUsername: 'gone.user' });
  check('the setup removes gone.user', removed.status < 300, JSON.stringify(removed));
  const revoked = await invite('vault_owner', 'Revoked');
  await api('POST', `/api/admin/invites/${revoked.id}/revoke`, {});
  const expired = await invite('vault_owner', 'Expired');
  sql('UPDATE invites SET expires_at = ? WHERE id = ?', '2020-01-01T00:00:00+00:00', expired.id);
  await invite('vault_owner', SPACED_NOTE);
  await invite('administrator', LONG_NOTE);
  const retired = await api('PATCH', '/api/admin/symbols/XAG-g', { retired: true });
  check('the setup retires XAG-g', retired.status < 300, JSON.stringify(retired));
  await page.eval('location.reload()');
  await page.waitUntil("document.querySelector('#app .section-switcher')", { timeout: 60000, label: 'the admin area' });

  for (const width of WIDTHS) {
    await setWidth(width);
    for (const section of Object.keys(SECTIONS)) {
      await openSection(section);
      if (section === 'Units') {
        // Open the Retired section, so its chip is measured too.
        await page.call(() => {
          const opener = [...document.querySelectorAll('#app summary, #app button')].find((n) => n.textContent.trim().startsWith('Retired'));
          if (opener && opener.tagName === 'SUMMARY' && !opener.parentElement.open) opener.click();
          else if (opener && opener.getAttribute('aria-expanded') === 'false') opener.click();
        });
        await page.frames();
      }
      const seen = await measure(width, section);
      const at = `${section} at ${width}px`;
      check(`nothing scrolls sideways but the section links on ${at}`, seen.pans.length === 0, seen.pans.join('; '));
      check(`nothing is drawn past the screen's edge on ${at}`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
      check(`no word of a heading or control is split on ${at}`, seen.split.length === 0, seen.split.join(', '));
      check(`every chip stays on one line, whole, inside its cell on ${at}`, seen.chipProblems.length === 0, seen.chipProblems.join(', '));
      check(`the ${section} entry holding ${SECTIONS[section].key} and its ${SECTIONS[section].action} is found on ${at}`, seen.entry);
      if (!seen.entry) continue;
      check(`the ${SECTIONS[section].action} control is on screen on ${at}`, seen.actionOnScreen);
      if (width <= 900) {
        check(`each cell sits on a line of its own on ${at}`, seen.stacked && seen.cells > 1, JSON.stringify([seen.cells, seen.stacked]));
        check(`the row's action sits beneath its cells on ${at}`, seen.actionBeneath);
        const missing = SECTIONS[section].headings.filter((h) => !seen.labels.some((l) => l.text === h && l.color === INK_SECONDARY));
        check(`each cell is beside its column's heading in ink-secondary on ${at}`, missing.length === 0, `missing ${missing.join(', ')}; saw ${JSON.stringify(seen.labels)}`);
      } else {
        check(`the row's cells sit side by side as a table on ${at}`, seen.sideBySide && seen.cells > 1, JSON.stringify([seen.cells, seen.sideBySide]));
      }
    }
    const shownChips = [];
    for (const section of Object.keys(SECTIONS)) {
      await openSection(section);
      shownChips.push(...(await measure(width, section)).chips);
    }
    const unseen = CHIPS.filter((c) => !shownChips.includes(c));
    check(`every chip the tables use is drawn at ${width}px`, unseen.length === 0, `not seen: ${unseen.join(', ')}`);
  }

  // Operated on a phone, with every control tapped where it is drawn,
  // and every request it sends going to an admin route (criterion 18).
  await setWidth(390);
  const asked = [];
  page.on((message) => {
    if (message.method !== 'Network.requestWillBeSent') return;
    const { request } = message.params;
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) asked.push(`${request.method} ${path}`);
  });

  await openSection('Invites');
  await tap(await spotInRow(LONG_NOTE, 'Call back'), 'Call back on the waiting administrator invite');
  await page.waitUntil(`document.querySelector(${JSON.stringify(DIALOG)})`, { label: 'the call back dialog' });
  const confirmCallBack = await confirmIn();
  await tap(await spot(confirmCallBack, DIALOG), `${confirmCallBack} in the call back dialog`);
  await page.waitUntil(
    (note) => [...document.querySelectorAll('#app tr, #app li, #app [role=row]')]
      .some((r) => r.textContent.includes(note) && r.textContent.includes('Called back')),
    { args: [LONG_NOTE], timeout: 30000, label: 'the invite called back' },
  ).catch(() => {});
  check('a tapped Call back stops the link', sql("SELECT status FROM invites WHERE label = ?", LONG_NOTE)[0]?.status === 'revoked');

  await openSection('Accounts');
  await tap(await spotInRow(LONG_NAME, 'Remove'), `Remove on ${LONG_NAME}`);
  const DIALOG_INPUT = DIALOG.split(', ').map((s) => `${s} input:not([type=hidden])`).join(', ');
  await page.waitUntil(`document.querySelector(${JSON.stringify(DIALOG_INPUT)})`, { label: 'the remove dialog' });
  await page.call((sel, name) => {
    const input = document.querySelector(sel);
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, DIALOG_INPUT, LONG_NAME);
  await page.frames();
  const dialogPast = await page.call((sel) => {
    const out = [];
    for (const n of document.querySelectorAll(sel.split(',').map((s) => `${s} *`).join(','))) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && (r.left < -0.5 || r.right > innerWidth + 0.5)) out.push(`${n.tagName} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return out;
  }, DIALOG);
  check('the remove dialog fits the phone\'s screen', dialogPast.length === 0, dialogPast.slice(0, 6).join('; '));
  await tap(await spot('Remove account', DIALOG), 'Remove account in the dialog');
  await page.waitUntil(
    (name) => !document.querySelector('dialog[open], [role=dialog], [role=alertdialog]') &&
      ![...document.querySelectorAll('#app *')].some((n) => n.children.length === 0 && n.textContent.trim() === name),
    { args: [LONG_NAME], timeout: 30000, label: 'the account removed' },
  ).catch(() => {});
  check('a tapped Remove removes the account', sql('SELECT 1 FROM principals WHERE username = ?', LONG_NAME).length === 0);

  await openSection('Units');
  await tap(await spotInRow('XAU-ozt', 'Retire'), 'Retire on XAU-ozt');
  await page.waitUntil(`document.querySelector(${JSON.stringify(DIALOG)})`, { label: 'the retire dialog' });
  const confirmRetire = await confirmIn();
  await tap(await spot(confirmRetire, DIALOG), `${confirmRetire} in the retire dialog`);
  await page.waitUntil(
    () => !document.querySelector('dialog[open], [role=dialog], [role=alertdialog]'),
    { timeout: 30000, label: 'the retire dialog closed' },
  ).catch(() => {});
  const xau = await api('GET', '/api/admin/symbols', null);
  const xauRow = (xau.body?.symbols || xau.body || []).find?.((s) => s.symbol === 'XAU-ozt');
  check('a tapped Retire retires the unit', xauRow && (xauRow.retired === true || Boolean(xauRow.retiredAt)), JSON.stringify(xauRow));

  const elsewhere = asked.filter((a) => !/^\w+ \/api\/admin\//.test(a) && a !== 'POST /api/auth/change-password');
  check('every request the tapped controls send goes to an admin route', asked.length > 0 && elsewhere.length === 0, `elsewhere: ${elsewhere.join(', ')}; all: ${asked.join(', ')}`);
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
