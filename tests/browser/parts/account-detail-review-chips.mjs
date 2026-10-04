// Dimension chips at phone widths, on a holding's screen and the
// dashboard, written from design-system.md (Components, Chip) without
// reading how a chip is built: a chip never exceeds its container, its
// text wraps between words rather than clipping or truncating, and it
// breaks inside a word only when that word alone is wider than its
// container. Each chip is found by the text its assignment reads.
import {
  BACKDATE, check, openHolding, page, plant, reloadModel, run, setProfile, vaultOwner,
} from '../harness.mjs';

const WIDTHS = [390, 320];
const PHRASE = 'Available within three business days after written notice';
// One word wider than any chip's container at these widths.
const WORD = 'Freizügigkeitsvorsorgeeinrichtungsguthabenverwaltung';
const CHIPS = [`Liquidity: ${PHRASE}`, `Pension: ${WORD}`];

const measure = (wanted) => page.call((texts) => {
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && n.closest('[hidden]') === null;
  };
  const canvas = document.createElement('canvas').getContext('2d');
  const found = {};
  for (const text of texts) {
    const chip = [...document.querySelectorAll('#app *')]
      .filter((n) => shown(n) && n.textContent.trim() === text)
      .find((n) => ![...n.children].some((c) => c.textContent.trim() === text));
    if (!chip) { found[text] = null; continue; }
    const s = getComputedStyle(chip);
    const box = chip.getBoundingClientRect();
    const parent = chip.parentElement;
    const ps = getComputedStyle(parent);
    const pb = parent.getBoundingClientRect();
    const inner = { left: pb.left + parseFloat(ps.paddingLeft) + parseFloat(ps.borderLeftWidth), right: pb.right - parseFloat(ps.paddingRight) - parseFloat(ps.borderRightWidth) };
    const chipInner = box.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth);
    canvas.font = s.font;
    const walker = document.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
    const brokenFitting = [];
    const lines = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const m of node.textContent.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        tops.forEach((t) => lines.add(t));
        if (tops.size > 1 && canvas.measureText(m[0]).width <= chipInner) brokenFitting.push(m[0]);
      }
    }
    found[text] = {
      inside: box.left >= inner.left - 0.5 && box.right <= inner.right + 0.5,
      onScreen: box.right <= window.innerWidth + 0.5,
      cut: chip.scrollWidth > chip.clientWidth + 0.5 || s.textOverflow === 'ellipsis',
      lines: lines.size,
      brokenFitting,
      detail: `${Math.round(box.left)}..${Math.round(box.right)} in ${Math.round(inner.left)}..${Math.round(inner.right)}`,
    };
  }
  return JSON.stringify({ found, pans: document.documentElement.scrollWidth > document.documentElement.clientWidth + 0.5 });
}, wanted).then(JSON.parse);

const checkChips = async (where, width) => {
  const seen = await measure(CHIPS);
  const at = `on ${where} at ${width}px`;
  for (const text of CHIPS) {
    const c = seen.found[text];
    const name = text.slice(0, text.indexOf(':'));
    check(`the ${name} chip shows its whole text ${at}`, c !== null);
    if (!c) continue;
    check(`the ${name} chip stays inside its container ${at}`, c.inside && c.onScreen, c.detail);
    check(`the ${name} chip's text is not clipped or truncated ${at}`, !c.cut);
    check(`the ${name} chip breaks inside a word only when that word is wider than it ${at}`, c.brokenFitting.length === 0, c.brokenFitting.join(', '));
    check(`the ${name} chip wraps rather than running on one line ${at}`, c.lines > 1, `${c.lines} lines`);
  }
  check(`the page does not scroll sideways ${at}`, !seen.pans);
};

await run(async () => {
  await vaultOwner();
  await setProfile({
    dimensions: [
      { id: 'liqd0001', label: 'Liquidity', archivedAt: null, values: [{ id: 'slow0001', label: PHRASE, archivedAt: null }] },
      { id: 'pens0001', label: 'Pension', archivedAt: null, values: [{ id: 'vest0001', label: WORD, archivedAt: null }] },
    ],
  });
  const [id] = await plant([{
    type: 'account',
    payload: {
      name: 'Notice account', unit: 'CHF', dims: { liqd0001: 'slow0001', pens0001: 'vest0001' }, note: null,
      archivedAt: null, createdAt: new Date().toISOString(),
    },
  }]);
  await plant([{ type: 'snapshot', accountId: id, payload: { date: BACKDATE, value: '25000.00', note: null } }]);
  await reloadModel();

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
    await page.frames();
    await openHolding(id);
    await checkChips('the holding screen', width);
    await reloadModel('#/');
    await page.waitUntil("document.body.innerText.includes('Notice account')", { label: 'the dashboard row' });
    await page.frames();
    await checkChips('the dashboard', width);
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
