// Settings' Open sessions at phone widths, written from
// spec/features/account-settings.md (Settings, At phone width, and
// acceptance criterion 78) and design-system.md (Components, Chip)
// without reading how the screen is built. The chip is found by its
// text, and its row and cells as the Table component lays them out.
import {
  BASE, VAULT_PASSWORD, check, intoVault, openBrowser, page, run, signInOn, vaultOwner,
} from '../harness.mjs';

const WIDTHS = [390, 360, 320, 1280];

const measure = () => page.call(() => {
  const html = document.documentElement;
  // A mobile viewport widens to its content, so the edge is the root's.
  const width = html.clientWidth;
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && n.closest('[hidden]') === null;
  };
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`;
  const lineCount = (rects) => new Set([...rects].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  const textNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.textContent.trim() && shown(walker.currentNode.parentElement)) nodes.push(walker.currentNode);
    return nodes;
  };
  const rangeOf = (node, start, end) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  };

  // The innermost shown element reading exactly "This session".
  const chip = [...document.querySelectorAll('#app *')]
    .filter((n) => shown(n) && n.textContent.trim() === 'This session')
    .find((n) => ![...n.children].some((c) => c.textContent.trim() === 'This session'));
  if (!chip) return JSON.stringify({ chip: false });
  const chipRange = document.createRange();
  chipRange.selectNodeContents(chip);
  const chipBox = chip.getBoundingClientRect();
  const chipStyle = getComputedStyle(chip);

  const row = chip.closest('tr, [role=row]');
  const cells = row ? [...row.children].filter(shown) : [];
  const cell = cells.find((c) => c.contains(chip)) || chip.parentElement;
  const cellBox = cell.getBoundingClientRect();
  const cellStyle = getComputedStyle(cell);
  const cellContent = cellBox.width - parseFloat(cellStyle.paddingLeft) - parseFloat(cellStyle.paddingRight)
    - parseFloat(cellStyle.borderLeftWidth) - parseFloat(cellStyle.borderRightWidth);

  // The cells of the row side by side, left to right, on one band.
  const boxes = cells.map((c) => c.getBoundingClientRect());
  const sideBySide = boxes.every((b, i) => i === 0 || (b.left >= boxes[i - 1].right - 0.5 && Math.abs(b.top - boxes[0].top) < 1));

  // Every word in every row's date cells on one line and inside its cell.
  const table = chip.closest('table, [role=table]');
  const rows = table ? [...table.querySelectorAll('tr, [role=row]')].filter(shown) : [];
  const brokenWords = [];
  const spilled = [];
  for (const r of rows) {
    for (const c of [...r.children].filter(shown).slice(1)) {
      const right = c.getBoundingClientRect().right;
      for (const node of textNodes(c)) {
        for (const m of node.textContent.matchAll(/\S+/g)) {
          const range = rangeOf(node, m.index, m.index + m[0].length);
          if (lineCount(range.getClientRects()) > 1) brokenWords.push(m[0]);
          if (range.getBoundingClientRect().right > right + 0.5) spilled.push(m[0]);
        }
      }
    }
  }

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
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') continue;
    const b = n.getBoundingClientRect();
    if (b.left < -0.5 || b.right > width + 0.5) past.push(`${label(n)} ${Math.round(b.left)}..${Math.round(b.right)}`);
  }

  return JSON.stringify({
    chip: true,
    chipLines: lineCount(chipRange.getClientRects()),
    chipWidth: chipBox.width,
    chipInsideCell: chipBox.left >= cellBox.left - 0.5 && chipBox.right <= cellBox.right + 0.5,
    chipCut: chip.scrollWidth > chip.clientWidth + 0.5 || chipStyle.textOverflow === 'ellipsis',
    cellContent,
    cells: cells.length,
    sideBySide,
    rows: rows.length,
    brokenWords,
    spilled,
    pans,
    past,
  });
}).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  // A second session, so the list holds a row without the chip.
  const other = await openBrowser(`${BASE}/login`);
  await signInOn(other.session, VAULT_PASSWORD, 'leander');
  check('a second session opens', await intoVault(other.session, 'the second session'));
  other.close();

  await page.eval("location.hash = '#/settings'");
  await page.waitUntil("[...document.querySelectorAll('#app *')].some((n) => n.textContent.trim() === 'This session')", { label: 'the session list' });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: width < 600 });
    await page.frames();
    const seen = await measure();
    const at = `at ${width}px`;
    check(`the "This session" chip is shown ${at}`, seen.chip);
    if (!seen.chip) continue;
    check(`the "This session" chip sits on one line ${at}`, seen.chipLines === 1, `${seen.chipLines} lines`);
    check(`the chip stays inside its cell ${at}`, seen.chipInsideCell);
    check(`the chip's text is not clipped or truncated ${at}`, !seen.chipCut);
    check(`Open sessions keeps three columns side by side ${at}`, seen.cells === 3 && seen.sideBySide, JSON.stringify([seen.cells, seen.sideBySide]));
    check(`the session list shows both sessions ${at}`, seen.rows >= 2, `${seen.rows} rows`);
    if (width < 600) check(`the first column is as wide as the chip on one line ${at}`, seen.cellContent - seen.chipWidth < 1.5, `${seen.cellContent} for a ${seen.chipWidth}px chip`);
    check(`the dates wrap between words, never inside one ${at}`, seen.brokenWords.length === 0, seen.brokenWords.join(', '));
    check(`the dates stay inside their own columns ${at}`, seen.spilled.length === 0, seen.spilled.join(', '));
    check(`the page and no box on it scroll sideways ${at}`, seen.pans.length === 0, seen.pans.join('; '));
    check(`nothing is drawn past the screen's edge ${at}`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
});
