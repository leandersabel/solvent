// The admin area's tables at phone and desktop widths, from
// spec/features/admin-invites.md (Admin, At phone width) and
// design-system.md (Components, Chip): no sideways panning, every
// control on screen, and a chip's fixed wording never split inside a
// word. Worst-case rows: a waiting administrator invite with a long
// note, used invites, a 32-character username and units with no source.
import {
  VAULT_PASSWORD, administrator, check, intoVault, mintInvite, openBrowser, register, run, vaultOwner,
} from '../harness.mjs';

const WIDTHS = [320, 390, 768, 901, 1280];
const LONG_NAME = 'a.very.long.username.of.32.chars';
const NOTE = "Sarah's laptop in the upstairs study, the one with the cracked screen";

// What does not fit at the width the page is shown at: the page or a
// box scrolling sideways, a shown control past the screen's edge, and
// a word of a chip, heading or control split across lines. Typed
// values, a username or a note, may break, but must fit. The section
// links are left out, because at phone width they are one row that
// scrolls sideways by design.
const measure = (session) => session.call(() => {
  const html = document.documentElement;
  const width = html.clientWidth;
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && n.closest('[hidden]') === null;
  };
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`;
  const pans = [];
  if (html.scrollWidth > width + 0.5) pans.push(`page ${html.scrollWidth} > ${width}`);
  const past = [];
  for (const n of document.querySelectorAll('#app *')) {
    if (!shown(n) || n.closest('.section-switcher')) continue;
    const s = getComputedStyle(n);
    if (['auto', 'scroll'].includes(s.overflowX) && n.scrollWidth > n.clientWidth + 0.5) pans.push(`${label(n)} ${n.scrollWidth} > ${n.clientWidth}`);
    if (s.clipPath === 'inset(50%)') continue;
    const b = n.getBoundingClientRect();
    if (b.left < -0.5 || b.right > width + 0.5) past.push(`${label(n)} ${Math.round(b.left)}..${Math.round(b.right)}`);
  }
  const broken = [];
  for (const n of document.querySelectorAll('#app .chip, #app th, #app button:not(.typed), #app select')) {
    if (!shown(n)) continue;
    const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const m of node.textContent.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (lines.size > 1) broken.push(m[0]);
      }
    }
  }
  const rows = document.querySelectorAll('#app tbody tr').length;
  return JSON.stringify({ pans, past, broken, rows });
}).then(JSON.parse);

const openSection = async (session, name) => {
  await session.call((section) => [...document.querySelectorAll('.section-switcher a, .section-switcher button')]
    .find((n) => n.textContent.trim() === section).click(), name);
  await session.waitUntil(() => document.querySelectorAll('#app tbody tr').length >= 2 &&
    ![...document.querySelectorAll('#app')].some((n) => n.textContent.includes('Loading…')),
  { timeout: 60000, label: `the ${name} table` });
};

await run(async () => {
  await vaultOwner();
  const other = await openBrowser();
  await register(other.session, mintInvite('vault-owner'), LONG_NAME, VAULT_PASSWORD);
  check('the 32-character username registers', await intoVault(other.session, 'the long username'));
  other.close();

  const { session, close } = await openBrowser();
  try {
    await administrator(session);
    const made = await session.call(async (note) => (await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'administrator', label: note, expiresInDays: 7 }),
    })).status, NOTE);
    check('a waiting administrator invite with a note is made', made === 201, String(made));

    for (const section of ['Invites', 'Accounts', 'Units']) {
      await openSection(session, section);
      for (const width of WIDTHS) {
        await session.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: width < 600 });
        await session.frames();
        const seen = await measure(session);
        const at = `${section} at ${width}px`;
        check(`${at} shows its rows`, seen.rows >= 2, `${seen.rows} rows`);
        check(`${at} does not scroll sideways`, seen.pans.length === 0, seen.pans.join('; '));
        check(`${at} draws nothing past the screen's edge`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
        check(`${at} splits no word of a chip, heading or control`, seen.broken.length === 0, seen.broken.join(', '));
      }
      await session.send('Emulation.clearDeviceMetricsOverride');
    }
  } finally {
    close();
  }
}, { signsIn: false });
