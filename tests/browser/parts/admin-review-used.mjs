// Reviewer's part for issue #187, written from
// spec/features/admin-invites.md (Admin, Invites, the Status bullet; At
// phone width; criteria 51, 53 and 57) and design-system.md
// (Accessibility) without reading how the screen is built. A used
// invite reads "Used <username> on <day>", the day in the Created
// column's format. The username is a button that opens Accounts,
// scrolls to that row and focuses its username with the focus ring,
// whether clicked or pressed from the keyboard. A removed account reads
// "account removed" with no control, one removed while Invites was open
// focuses nothing, and the cell fits every width criterion 53 names.
import { REGISTRANT_PASSWORD, administrator, check, openBrowser, page, register, run, sql } from '../harness.mjs';

const KEPT = 'sarah.used';
const LONG = 'abcdefghijklmnopqrstuvwxyz.01234';
const WIDTHS = [320, 390, 768, 901, 1280];
// design-system.md, the petrol-600 focus ring.
const PETROL_600 = 'rgb(44, 100, 113)';
const GONE = 'Already used. The account it created has since been removed.';
const LIVE = 'Already used. Remove the account instead.';
const DAY = 86400000;

const api = (method, path, body) =>
  page.call(async (m, p, b) => {
    const response = await fetch(p, {
      method: m,
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: b === null ? undefined : JSON.stringify(b),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, method, path, body ?? null);

const invite = async (label) => {
  const made = await api('POST', '/api/admin/invites', { expiresInDays: 7, label, kind: 'vault_owner' });
  if (made.status >= 300) throw new Error(`invite: ${JSON.stringify(made)}`);
  return made.body;
};

const registerElsewhere = async (token, username) => {
  const other = await openBrowser();
  try {
    await register(other.session, token, username, REGISTRANT_PASSWORD);
    await other.session.waitUntil("!location.pathname.startsWith('/register')", { timeout: 90000, label: `${username} registered` });
  } finally {
    other.close();
  }
};

const remove = (username) => api('DELETE', `/api/admin/accounts/${username}`, { confirmUsername: username });

const setSize = async (width, height) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: width < 900 });
  await page.frames();
};

const openSection = async (name) => {
  await page.call((label) => {
    [...document.querySelectorAll('.section-switcher a, .section-switcher button')]
      .find((n) => n.textContent.trim() === label).click();
  }, name);
  await page.frames();
};

// The invites table, each row by its note: the Created cell's text, the
// Status cell's text, the buttons and links in it, and the action cell.
const invites = () =>
  page.call(() => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Stops working'));
    if (!table) return null;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const flat = (n) => (n ? n.innerText.replace(/\s+/g, ' ').trim() : null);
    const out = {};
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.querySelectorAll('td, th')];
      const status = cells[heads.indexOf('Status')];
      out[flat(cells[heads.indexOf('Note')])] = {
        created: flat(cells[heads.indexOf('Created')]),
        status: flat(status),
        buttons: [...status.querySelectorAll('button')].map((b) => b.textContent.trim()),
        links: [...status.querySelectorAll('a')].map((a) => a.textContent.trim()),
        action: flat(cells[cells.length - 1]),
      };
    }
    return out;
  });

const invitesShown = (needle) =>
  page.waitUntil(
    (n) => [...document.querySelectorAll('table')].some((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Stops working') && t.innerText.includes(n)),
    { args: [needle], timeout: 60000, label: `the invites table showing ${needle}` },
  );

// Where the button reading `name` is, scrolled into view.
const spot = (name) =>
  page.call((n) => {
    const b = [...document.querySelectorAll('#app button')].find((x) => x.textContent.trim() === n);
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, name);

// The Accounts table as it stands, and what has focus.
const accounts = (name) =>
  page.call((n) => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Last signed in'));
    const a = document.activeElement;
    const rows = table ? [...table.querySelectorAll('tbody tr')] : [];
    const row = rows.find((tr) => tr.cells[0] && tr.cells[0].innerText.trim() === n);
    const s = a ? getComputedStyle(a) : null;
    const r = row ? row.getBoundingClientRect() : null;
    return {
      shown: Boolean(table && table.getBoundingClientRect().height > 0),
      names: rows.map((tr) => tr.cells[0] && tr.cells[0].innerText.trim()),
      focusText: a ? a.textContent.trim() : null,
      focusTag: a ? a.tagName : null,
      focusInRow: Boolean(row && row.contains(a)),
      focusInTable: Boolean(table && table.contains(a)),
      ring: s ? { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, shadow: s.boxShadow } : null,
      rowOnScreen: Boolean(r) && r.top >= 0 && r.bottom <= innerHeight,
    };
  }, name);

const ringDrawn = (ring) =>
  Boolean(ring) &&
  ((ring.style !== 'none' && parseFloat(ring.width) >= 2 && ring.color === PETROL_600) || ring.shadow.includes(PETROL_600));

const focused = (name) =>
  page.waitUntil(
    (n) => document.activeElement && document.activeElement.textContent.trim() === n,
    { args: [name], timeout: 30000, label: `focus on ${name}` },
  ).catch(() => {});

const accountsLoaded = () =>
  page.waitUntil(
    () => [...document.querySelectorAll('table')].some((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Last signed in') && t.querySelector('tbody tr td')),
    { timeout: 60000, label: 'the accounts table' },
  );

// The Status cell holding the button `name` at the current width: the
// page's sideways overflow, the button, the Used chip and every piece
// of the cell's text against the screen's edges, and whether the
// username starts on the chip's line.
const fit = (name) =>
  page.call((n) => {
    const b = [...document.querySelectorAll('#app button')].find((x) => x.textContent.trim() === n);
    if (!b) return null;
    const cell = b.closest('td, [role=cell]') || b.parentElement;
    const chip = [...cell.querySelectorAll('*')].find((x) => x.textContent.trim() === 'Used' && !x.contains(b));
    const lines = (rects) => new Set([...rects].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    const past = [];
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const pieces = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      pieces.push({ text: t.textContent.trim(), rects: [...range.getClientRects()].filter((r) => r.width > 0) });
    }
    for (const p of pieces) {
      for (const r of p.rects) if (r.left < -0.5 || r.right > innerWidth + 0.5) past.push(`${p.text} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    const br = b.getBoundingClientRect();
    if (br.left < -0.5 || br.right > innerWidth + 0.5) past.push(`button ${Math.round(br.left)}..${Math.round(br.right)}`);
    const chipRange = document.createRange();
    if (chip) chipRange.selectNodeContents(chip);
    const firstTop = (rects) => (rects.length ? Math.min(...rects.map((r) => r.top)) : null);
    const nameRange = document.createRange();
    nameRange.selectNodeContents(b);
    const overlap = (a, c) => a && c && a.top < c.bottom && c.top < a.bottom;
    const chipBox = chip ? chip.getBoundingClientRect() : null;
    const nameFirst = [...nameRange.getClientRects()].filter((r) => r.width > 0).sort((x, y) => x.top - y.top)[0];
    return {
      pans: document.documentElement.scrollWidth > innerWidth + 0.5,
      past,
      chip: Boolean(chip),
      chipLines: chip ? lines(chipRange.getClientRects()) : 0,
      nameBesideChip: Boolean(overlap(chipBox, nameFirst)),
      firstTops: [firstTop([...chipRange.getClientRects()]), nameFirst && nameFirst.top],
      widths: {
        cell: Math.round(cell.getBoundingClientRect().width),
        chip: chipBox && Math.round(chipBox.width),
        name: Math.round(br.width),
        display: getComputedStyle(b).display,
        besideChip: chipBox && Math.round(cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight) - chipBox.right),
      },
    };
  }, name);

const dayOf = (offset) => new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);
const onDay = (stamp, day) => stamp.replace(/^\d{4}-\d{2}-\d{2}/, day);

await run(async () => {
  await administrator(page);

  const kept = await invite('Kept');
  await registerElsewhere(kept.token, KEPT);
  const gone = await invite('Gone');
  await registerElsewhere(gone.token, 'gone.user');
  const late = await invite('Late');
  await registerElsewhere(late.token, 'late.gone');
  const long = await invite('Long');
  await registerElsewhere(long.token, LONG);
  const reference = await invite('Reference');
  check('the setup removes gone.user', (await remove('gone.user')).status < 300);

  // Kept was made ten days ago and used three days ago. Reference, still
  // waiting, was made at the very moment Kept was used, so its Created
  // cell is that day in the Created column's format.
  const row = sql('SELECT created_at, used_at FROM invites WHERE id = ?', kept.id)[0];
  const usedAt = onDay(row.used_at, dayOf(3));
  sql('UPDATE invites SET created_at = ?, used_at = ? WHERE id = ?', onDay(row.created_at, dayOf(10)), usedAt, kept.id);
  sql('UPDATE invites SET created_at = ? WHERE id = ?', usedAt, reference.id);

  await setSize(1280, 800);
  await page.eval('location.reload()');
  await invitesShown(KEPT);
  let rows = await invites();

  // Criterion 57: the username and the day used.
  const k = rows.Kept;
  check(
    'a used invite reads Used, its username, " on " and the day it was used, in the Created column\'s format',
    k && rows.Reference && k.status === `Used ${KEPT} on ${rows.Reference.created}`,
    JSON.stringify({ kept: k, reference: rows.Reference }),
  );
  check('the day shown is the day used, not the day the link was made', k && !k.status.endsWith(k.created), JSON.stringify(k));
  check(
    'the username is a button, not a link, and the only control in the cell',
    k && k.buttons.length === 1 && k.buttons[0] === KEPT && k.links.length === 0,
    JSON.stringify(k),
  );
  check('a used invite whose account remains still says to remove the account', k && k.action === LIVE, JSON.stringify(k));

  // Criterion 51: a removed account names nobody and offers no control.
  const g = rows.Gone;
  check(
    'a used invite whose account is gone reads account removed, still with its day',
    g && /^Used account removed on \S/.test(g.status) && !g.status.includes('gone.user'),
    JSON.stringify(g),
  );
  check('account removed is neither a button nor a link', g && g.buttons.length === 0 && g.links.length === 0, JSON.stringify(g));
  check('its action cell says the account has since been removed', g && g.action === GONE, JSON.stringify(g));

  // Criterion 57: clicked, the username opens Accounts, scrolls to the
  // row and focuses the username with the focus ring. The window is
  // short, so the row starts out of sight.
  await setSize(1280, 360);
  const at = await spot(KEPT);
  check(`the ${KEPT} button is found`, Boolean(at));
  if (at) await page.mouseClick(at.x, at.y);
  await accountsLoaded();
  await focused(KEPT);
  await page.frames();
  let seen = await accounts(KEPT);
  check('clicking the username opens Accounts', seen.shown, JSON.stringify(seen));
  check('focus is on that account\'s username in its row', seen.focusInRow && seen.focusText === KEPT, JSON.stringify(seen));
  check('the focused username draws the focus ring after a click', ringDrawn(seen.ring), JSON.stringify(seen.ring));
  check('the account\'s row is scrolled into view', seen.rowOnScreen, JSON.stringify(seen));

  // The same from the keyboard.
  await openSection('Invites');
  await invitesShown(KEPT);
  await page.call((n) => [...document.querySelectorAll('#app button')].find((x) => x.textContent.trim() === n).focus(), KEPT);
  await page.key('Enter');
  await accountsLoaded();
  await focused(KEPT);
  await page.frames();
  seen = await accounts(KEPT);
  check('Enter on the username opens Accounts with focus on that username', seen.shown && seen.focusInRow && seen.focusText === KEPT, JSON.stringify(seen));
  check('the focused username draws the focus ring after Enter', ringDrawn(seen.ring), JSON.stringify(seen.ring));
  check('the account\'s row is scrolled into view after Enter', seen.rowOnScreen, JSON.stringify(seen));

  // An account removed while Invites was open: absent from Accounts,
  // and nothing focused.
  await setSize(1280, 800);
  await openSection('Invites');
  await invitesShown('late.gone');
  check('the setup removes late.gone while Invites is open', (await remove('late.gone')).status < 300);
  const lateAt = await spot('late.gone');
  check('the late.gone button is still drawn from the list as it was loaded', Boolean(lateAt));
  if (lateAt) await page.mouseClick(lateAt.x, lateAt.y);
  await accountsLoaded();
  await page.idle();
  await page.frames();
  seen = await accounts('late.gone');
  check('Accounts opens without the removed account', seen.shown && !seen.names.includes('late.gone') && seen.names.includes(KEPT), JSON.stringify(seen));
  check('nothing in Accounts is focused', !seen.focusInTable, JSON.stringify(seen));

  await openSection('Invites');
  await invitesShown(LONG);
  rows = await invites();
  check('the invite of the account removed while Invites was open now reads account removed', rows.Late && rows.Late.status.includes('account removed') && rows.Late.buttons.length === 0, JSON.stringify(rows.Late));

  // Criterion 53: the cell, with a 32-character username, at every width.
  for (const width of WIDTHS) {
    await setSize(width, 800);
    for (const name of [LONG, KEPT]) {
      const f = await fit(name);
      check(`the Status cell of ${name} is drawn at ${width}px`, Boolean(f) && f.chip, JSON.stringify(f));
      if (!f) continue;
      check(`nothing scrolls sideways with ${name} at ${width}px`, !f.pans, JSON.stringify(f));
      check(`no piece of ${name}'s Status cell is past the screen's edge at ${width}px`, f.past.length === 0, f.past.join('; '));
      check(`the Used chip of ${name} stays on one line at ${width}px`, f.chipLines === 1, JSON.stringify(f));
    }
    const f = await fit(KEPT);
    if (f) check(`the username follows the Used chip on its line at ${width}px`, f.nameBesideChip, JSON.stringify([f.firstTops, f.widths]));
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
