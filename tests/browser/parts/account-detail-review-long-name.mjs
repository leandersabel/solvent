// Account detail of a holding whose name has no space, written from
// spec/features/manage-accounts.md (Account detail, At phone width, and
// acceptance criterion 58) and app-shell.md (On a phone) without reading
// how the screen is built. The name wraps wherever it must, is shown
// whole, and nothing on the screen or the dialogs its actions open pans
// sideways or draws past the screen's edge.
import { BACKDATE, check, click, openHolding, page, plant, reloadModel, run, vaultOwner } from '../harness.mjs';

// Wider than any of the widths below at the heading's size, with no
// point a line may break at.
const NAME = 'ZürcherKantonalbankPrivatbankingSparkontoNummer00123456789';
const WIDTHS = [320, 375, 601, 901];

// What the screen draws, measured in the page: anything that pans or
// lies past the edge, controls a tap at their centre misses, and how
// the name is laid out wherever it is shown. With a dialog open, the
// controls that count are the dialog's, the screen behind it being
// covered on purpose.
const measure = () => page.call((name) => {
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
  const past = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!shown(n)) continue;
    const s = getComputedStyle(n);
    if (['auto', 'scroll'].includes(s.overflowX) && n.scrollWidth > n.clientWidth + 0.5) pans.push(`${label(n)} ${n.scrollWidth} > ${n.clientWidth}`);
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') continue;
    const r = n.getBoundingClientRect();
    if (r.left < -0.5 || r.right > width + 0.5) past.push(`${label(n)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }

  // Each text node holding the name: drawn inside the screen and inside
  // its own box, whole rather than cut off, and on how many lines.
  const names = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const at = node.textContent.indexOf(name);
    if (at < 0 || !shown(node.parentElement)) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + name.length);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const box = node.parentElement;
    const s = getComputedStyle(box);
    names.push({
      in: label(box),
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      // A box narrower than its text cuts the name off when it clips, and
      // an ellipsis hides its end.
      clipped: box.scrollWidth > box.clientWidth + 0.5 && s.overflowX !== 'visible',
      ellipsis: s.textOverflow === 'ellipsis',
    });
  }

  const scope = document.querySelector('.dialog') || document;
  const controls = [...scope.querySelectorAll('a[href], button, input, select, textarea, summary, [role=button]')].filter(shown);
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
  return JSON.stringify({ width, pans, past, names, offScreen, covered });
}, NAME).then(JSON.parse);

const holds = (seen, where, { heading = false } = {}) => {
  check(`no page or box pans sideways ${where}`, seen.pans.length === 0, seen.pans.join('; '));
  check(`nothing is drawn past the screen's edge ${where}`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
  check(`every control lies on screen ${where}`, seen.offScreen.length === 0, seen.offScreen.join('; '));
  check(`a tap at every control's centre lands on it ${where}`, seen.covered.length === 0, seen.covered.join('; '));
  if (heading) check(`the holding's name is shown ${where}`, seen.names.length > 0, JSON.stringify(seen.names));
  for (const n of seen.names) {
    check(`the name in ${n.in} lies inside the screen ${where}`, n.left >= -0.5 && n.right <= seen.width + 0.5, JSON.stringify(n));
    check(`the name in ${n.in} is shown whole, never cut off ${where}`, !n.clipped && !n.ellipsis, JSON.stringify(n));
  }
};

const openDialog = async (action) => {
  await click(action);
  await page.waitUntil("document.querySelector('.dialog')", { label: `the dialog ${action} opens` });
  await page.frames();
};
const closeDialog = async () => {
  await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Cancel').click()");
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });
};

await run(async () => {
  await vaultOwner();
  const [id] = await plant([{
    type: 'account',
    payload: { name: NAME, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
  }]);
  await plant([{ type: 'snapshot', accountId: id, payload: { date: BACKDATE, value: '1234567.89', note: null } }]);
  await reloadModel();
  await openHolding(id);

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    holds(seen, `on Account detail at ${width}px`, { heading: true });
    // At the narrow widths the name is wider than the screen, so it can
    // only fit by wrapping.
    if (width < 600) {
      check(`the name wraps onto more than one line at ${width}px`, seen.names.some((n) => n.lines > 1), JSON.stringify(seen.names));
    }

    // The dialogs the screen's own actions open, the delete one with the
    // name to type.
    await openDialog('Archive');
    holds(await measure(), `in the Archive dialog at ${width}px`);
    await closeDialog();
    await openDialog('Delete');
    await page.eval("[...document.querySelectorAll('.dialog label')].find((l) => l.textContent.trim() === 'Delete permanently').click()");
    await page.frames();
    holds(await measure(), `in the permanent-delete dialog at ${width}px`);
    await closeDialog();
  }
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
