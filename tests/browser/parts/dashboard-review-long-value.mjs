// The dashboard grouped by a dimension whose values are wider than the
// screen, written from spec/features/net-worth-view.md (Trend chart
// card's Legend, Breakdown by dimension, At phone width, and acceptance
// criteria 73 and 79), manage-accounts.md (criteria 17 and 58) and
// architecture.md (Application hardening) without reading how the
// screen is built or tested. One value has no space, the other holds
// `<img src=x onerror=alert(1)>`, and each names a positive band under
// one dimension and a negative band under the other. Each name, in the
// legend, the breakdown and the readout, is literal text, wraps inside
// its card, breaks a word only where it has to, and the page never pans
// sideways.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, holdings, page, recording, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// Each wider than 1280px at body size: the first with no point a line
// may break at, the second in words, and neither a prefix of the other.
const NO_SPACE = 'LangfristigGebundeneVorsorge'.repeat(8);
const MARKUP = `Low <img src=x onerror=alert(1)> ${'reserves kept for the long run and never touched '.repeat(4)}`.trim();
const VALUES = [NO_SPACE, MARKUP];
const WIDTHS = [320, 375, 601, 901, 1280];
const PHONE = 600;

const measure = () => page.call((values) => {
  const width = document.documentElement.clientWidth;
  const html = document.documentElement;
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`;
  // Content of a closed <details> keeps a box in Chrome without being drawn.
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && n.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
  };
  // Inside a box that scrolls or clips sideways, which is measured itself.
  const clippedBy = (n) => {
    for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true;
    }
    return false;
  };
  const rect = (r) => ({ left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) });
  const past = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!shown(n) || clippedBy(n)) continue;
    const s = getComputedStyle(n);
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') continue;
    const r = n.getBoundingClientRect();
    if (r.left < -0.5 || r.right > width + 0.5) past.push(`${label(n)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }

  // How wide a value is on one line, in the font its own label uses.
  const unwrapped = (value, like) => {
    const probe = document.createElement('span');
    probe.style.whiteSpace = 'nowrap';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.font = getComputedStyle(like).font;
    probe.textContent = value;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };

  // Every shown text node holding a value: where it is drawn against
  // the screen, the box it sits in and its card, and where its lines
  // break.
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const owner = node.parentElement;
    const value = values.find((v) => node.textContent.includes(v));
    if (!value || !shown(owner) || owner.closest('select')) continue;
    const at = node.textContent.indexOf(value);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + value.length);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    if (!rects.length) continue;
    let box = owner;
    while (getComputedStyle(box).display === 'inline' && box.parentElement) box = box.parentElement;
    const card = owner.closest('section.card') || owner.closest('.chart-readout') || box;
    const b = box.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));

    // A line that breaks inside a word is fine only for a word wider
    // than the box it wraps in.
    const tops = [];
    for (let i = 0; i < value.length; i += 1) {
      const one = document.createRange();
      one.setStart(node, at + i);
      one.setEnd(node, at + i + 1);
      const r = [...one.getClientRects()].find((x) => x.width > 0);
      tops.push(r ? Math.round(r.top) : null);
    }
    const midWord = [];
    for (let i = 1; i < value.length; i += 1) {
      if (tops[i] === null || tops[i - 1] === null || tops[i] === tops[i - 1]) continue;
      if (value[i] === ' ' || value[i - 1] === ' ') continue;
      const start = value.lastIndexOf(' ', i) + 1;
      const end = value.indexOf(' ', i) < 0 ? value.length : value.indexOf(' ', i);
      const word = value.slice(start, end);
      if (unwrapped(word, owner) <= b.width + 0.5) midWord.push(word);
    }

    found.push({
      value: value === values[0] ? 'no-space' : 'markup',
      where: owner.closest('.legend') ? 'legend' : owner.closest('.bars') ? 'breakdown' : owner.closest('.chart-readout') ? 'readout' : label(owner),
      exact: owner.textContent.trim() === value || node.textContent.trim() === value,
      in: label(box),
      left: Math.round(left),
      right: Math.round(right),
      box: rect(b),
      card: rect(c),
      inBox: left >= b.left - 0.5 && right <= b.right + 0.5,
      inCard: left >= c.left - 0.5 && right <= c.right + 0.5,
      lines: new Set(rects.map((r) => Math.round(r.top))).size,
      clipped: [owner, box].some((n) => n.scrollWidth > n.clientWidth + 0.5 && getComputedStyle(n).overflowX !== 'visible'),
      ellipsis: getComputedStyle(owner).textOverflow === 'ellipsis' || getComputedStyle(box).textOverflow === 'ellipsis',
      wide: unwrapped(value, owner) > width,
      midWord,
    });
  }

  // Each bar of the breakdown: its fill and its label against each other
  // and the card.
  const bars = [...document.querySelectorAll('.bars .bar')].filter((bar) => bar.checkVisibility()).map((bar) => {
    const card = bar.closest('section.card').getBoundingClientRect();
    const fill = bar.querySelector('.bar-fill').getBoundingClientRect();
    const track = bar.querySelector('.bar-track').getBoundingClientRect();
    const tag = bar.querySelector('.bar-label').getBoundingClientRect();
    const name = bar.querySelector('.bar-name').getBoundingClientRect();
    const amount = bar.querySelector('.bar-amount').getBoundingClientRect();
    const inCard = (r) => r.left >= card.left - 0.5 && r.right <= card.right + 0.5;
    return {
      name: bar.querySelector('.bar-name').textContent.slice(0, 20),
      negative: bar.classList.contains('negative'),
      fill: rect(fill),
      // Longer than the 2px any bar keeps, so its length says something.
      drawn: fill.width > 2.5,
      track: rect(track),
      tag: rect(tag),
      nameBox: rect(name),
      amount: rect(amount),
      fillInCard: fill.width > 0 && inCard(fill),
      amountInCard: amount.width > 0 && inCard(amount),
      // Beside the bar on a computer, the label lies wholly past its
      // outboard end, never over the fill.
      outboard: bar.classList.contains('negative') ? tag.right <= fill.left + 0.5 : tag.left >= fill.right - 0.5,
      // On a phone, above the bar, name left and amount right.
      above: tag.bottom <= track.top + 0.5 && name.left <= amount.left,
    };
  });

  const images = [...document.querySelectorAll('img')].filter((i) => i.getAttribute('src') === 'x').length;
  return JSON.stringify({ width, pans: html.scrollWidth > html.clientWidth + 0.5 ? `${html.scrollWidth} > ${html.clientWidth}` : '', past, found, bars, images });
}, VALUES).then(JSON.parse);

const groupBy = async (id) => {
  await page.call((value) => {
    const s = document.querySelector('.chart-card select');
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  await page.frames();
};

await run(async () => {
  await vaultOwner();
  // Each dimension names one value's band positive and the other's
  // negative, so every name stands beside a bar of either sign.
  await setProfile({
    dimensions: [
      { id: 'risk', label: 'Risk', values: [{ id: 'a', label: NO_SPACE }, { id: 'b', label: MARKUP }] },
      { id: 'term', label: 'Term', values: [{ id: 'a', label: MARKUP }, { id: 'b', label: NO_SPACE }] },
    ],
  });
  await holdings([['Reserve', 'CHF', { risk: 'a', term: 'a' }], ['Mortgage', 'CHF', { risk: 'b', term: 'b' }]]);
  await recording('2026-01-15', { Reserve: '380000.00', Mortgage: '-160000.00' });
  await recording(new Date().toISOString().slice(0, 10), { Reserve: '400000.00', Mortgage: '-150000.00' });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.chart-card select')", { timeout: 90000, label: 'the dashboard' });

  for (const dimension of ['risk', 'term']) {
    await groupBy(dimension);
    for (const width of WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false });
      await page.frames();
      const seen = await measure();
      const where = `grouped by ${dimension} at ${width}px`;
      check(`net-worth-view: criterion 79, the page never pans sideways ${where}`, !seen.pans, seen.pans);
      check(`app-shell: nothing is drawn past the screen's edge ${where}`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
      check(`manage-accounts: criterion 17, no markup in a value becomes an element ${where}`, seen.images === 0, String(seen.images));
      for (const value of ['no-space', 'markup']) {
        for (const part of ['legend', 'breakdown']) {
          const names = seen.found.filter((f) => f.value === value && f.where === part);
          check(`net-worth-view: criterion 79, the ${value} value is named in the ${part} ${where}`, names.length === 1, JSON.stringify(seen.found.map((f) => [f.value, f.where])));
          for (const n of names) {
            const detail = JSON.stringify(n);
            check(`net-worth-view: criterion 79, the ${value} value is wider than the screen ${where}`, n.wide, detail);
            check(`manage-accounts: criterion 17, the ${value} value reads as literal text in the ${part} ${where}`, n.exact, detail);
            check(`net-worth-view: criterion 79, the ${value} name lies inside its card in the ${part} ${where}`, n.inCard && n.left >= 0 && n.right <= seen.width, detail);
            check(`net-worth-view: the ${value} name stays inside its own box in the ${part} ${where}`, n.inBox, detail);
            check(`net-worth-view: the ${value} name is shown whole, wrapped rather than cut off, in the ${part} ${where}`, !n.clipped && !n.ellipsis && n.lines > 1, detail);
            check(`net-worth-view: the ${value} name breaks a word only where it has to in the ${part} ${where}`, n.midWord.length === 0, detail);
          }
        }
      }
      check(`net-worth-view: criterion 79, the breakdown draws a positive bar and a negative one ${where}`,
        seen.bars.some((b) => b.negative && b.drawn) && seen.bars.some((b) => !b.negative && b.drawn), JSON.stringify(seen.bars));
      for (const bar of seen.bars) {
        const detail = JSON.stringify(bar);
        const sign = bar.negative ? 'negative' : 'positive';
        check(`net-worth-view: the ${sign} bar lies inside its card ${where}`, bar.fillInCard, detail);
        check(`net-worth-view: the ${sign} bar's amount lies inside its card ${where}`, bar.amountInCard, detail);
        if (width <= PHONE) check(`net-worth-view: the ${sign} bar's label sits above it, name left and amount right, ${where}`, bar.above, detail);
        else check(`net-worth-view: the ${sign} bar's label sits at its outboard end, clear of the bar, ${where}`, bar.outboard, detail);
      }

      // The pointer's readout names every band too, and the page still
      // does not pan while it shows.
      const plot = await page.call(() => {
        const chart = document.querySelector('.chart-frame svg.trend');
        chart.scrollIntoView({ block: 'center' });
        const r = chart.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: plot.x, y: plot.y });
      await page.waitUntil("!document.querySelector('.chart-readout').hidden", { label: 'the readout' });
      await page.frames();
      const reading = await measure();
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
      await page.call(() => window.scrollTo(0, 0));
      await page.frames();
      check(`net-worth-view: criterion 79, the page never pans sideways while the readout shows ${where}`, !reading.pans, reading.pans);
      check(`manage-accounts: criterion 17, no markup in a value becomes an element in the readout ${where}`, reading.images === 0, String(reading.images));
      for (const value of ['no-space', 'markup']) {
        const rows = reading.found.filter((f) => f.value === value && f.where === 'readout');
        check(`manage-accounts: criterion 17, the ${value} value reads as literal text in the readout ${where}`, rows.length === 1 && rows[0].exact, JSON.stringify(rows));
        for (const n of rows) check(`net-worth-view: the ${value} name lies inside the screen in the readout ${where}`, n.left >= 0 && n.right <= reading.width, JSON.stringify(n));
      }
    }
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
