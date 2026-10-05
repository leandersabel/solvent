// Recording detail at phone, tablet and desktop widths, written from
// spec/features/record-snapshot.md (Recording detail, At phone width,
// States, and acceptance criteria 45, 52 and 94) and app-shell.md (On a
// phone) without reading how the screen is built. A line of either list
// is found as the spec describes it: the largest box around one Keep
// this one that holds no other.
import {
  BACKDATE, OWN, check, holdings, page, plant, recording, reloadModel, run, sql, vaultOwner,
} from '../harness.mjs';

const NAME = 'Zürcher Kantonalbank Sparkonto CH9300762011623852957';
// Decrypted text the page must show as text, never as markup
// (architecture.md, Application hardening).
const MARKUP_NAME = 'Depot <img src=x onerror=__nameRan=1>';
// A name with no point a line may break at, wider than a phone's text
// column. Nothing on the screen pans sideways, whatever a name holds.
const UNBROKEN_NAME = 'ZKB_Vorsorgekonto_3a_CH9300762011623852957';
const WIDTHS = [320, 375, 601, 901];
// Up to 900px the figures and the prices are lists whose every control
// is a 44px target (Recording detail, At phone width).
const NARROW = 900;

const snapshotCount = () => sql(`SELECT record_id FROM records ${OWN} AND record_type = 'snapshot'`).length;

// Everything a check reads off the screen, measured in the page.
const measure = (narrow) => page.call((isNarrow) => {
  const FIGURE = /[-−]?\d[\d'’    .,]*\d/g;
  const CONTROLS = 'a[href], button, input, select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
  const width = window.innerWidth;
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && n.closest('[hidden]') === null;
  };
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 30)}"`;
  const textNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (t.textContent.trim() && t.parentElement && shown(t.parentElement)) nodes.push(t);
    }
    return nodes;
  };
  const rangeOf = (node, start, end) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  };
  const lines = (range) => new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;

  // A page or box that pans sideways, and anything drawn past the edge.
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
  for (const t of textNodes(document.body)) {
    const r = rangeOf(t, 0, t.textContent.length).getBoundingClientRect();
    if (r.left < -0.5 || r.right > width + 0.5) past.push(`text "${t.textContent.trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
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

  // A line of either list: the largest box around one Keep this one
  // that holds no other.
  const keeps = controls.filter((c) => c.textContent.trim() === 'Keep this one');
  const lineOf = (keep) => {
    let line = keep;
    while (line.parentElement && [...line.parentElement.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Keep this one').length === 1) line = line.parentElement;
    return line;
  };
  let lists = keeps[0] || null;
  while (lists && !keeps.every((k) => lists.contains(k))) lists = lists.parentElement;
  const listControls = lists ? controls.filter((c) => lists.contains(c) && !['Update', 'Delete'].includes(c.textContent.trim())) : [];
  const short = listControls.filter((c) => c.getBoundingClientRect().height < 43.5).map((c) => `${label(c)} ${c.getBoundingClientRect().height}`);

  const broken = [];
  const order = [];
  for (const keep of keeps) {
    const line = lineOf(keep);
    const texts = textNodes(line).filter((t) => !keep.contains(t));
    const figures = [];
    // The first text is the holding's name or the unit, never a figure.
    for (const t of texts.slice(1)) {
      for (const m of t.textContent.matchAll(FIGURE)) {
        if (m[0].replace(/\D/g, '').length < 4) continue;
        const range = rangeOf(t, m.index, m.index + m[0].length);
        if (lines(range) > 1) broken.push(`figure "${m[0]}"`);
        figures.push(range.getBoundingClientRect());
      }
    }
    if (!isNarrow) continue;
    // The holding or the unit first, then the figures, then the fault
    // with Keep this one on a line of its own.
    const first = texts[0] ? rangeOf(texts[0], 0, texts[0].textContent.length).getBoundingClientRect() : null;
    const keepBox = keep.getBoundingClientRect();
    const figuresTop = Math.min(...figures.map((b) => b.top));
    const figuresBottom = Math.max(...figures.map((b) => b.bottom));
    // The right of the line: the converted figure, else the chip or
    // "not priced".
    const [own, second] = figures;
    const words = texts.find((t) => /not priced|Market rate|Edited from|Typed by you/.test(t.textContent));
    const right = second || (words ? rangeOf(words, 0, words.textContent.length).getBoundingClientRect() : null);
    const ok = first !== null && figures.length >= 1 && right !== null &&
      first.bottom <= figuresTop + 0.5 &&
      keepBox.top >= Math.max(figuresBottom, right.bottom) - 0.5 &&
      (Math.round(own.top) !== Math.round(right.top) || own.right <= right.left);
    if (!ok) {
      const box = (b) => (b ? `${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}` : 'none');
      order.push(`"${line.textContent.trim().slice(0, 40)}": name ${box(first)}, figures ${figures.map(box).join(' ')}, right ${box(right)}, keep ${box(keepBox)}`);
    }
  }

  const main = document.querySelector('main') || document.body;
  return JSON.stringify({
    keeps: keeps.length,
    pans, past, offScreen, covered, short, broken, order,
    heading: (document.querySelector('h1') || { textContent: '' }).textContent.trim(),
    text: main.innerText,
    markupRan: window.__nameRan !== undefined || main.querySelectorAll('img').length > 0,
  });
}, narrow).then(JSON.parse);

// The centre of the first shown control named `name`, scrolled into view.
const centreOf = (name) => page.call((wanted) => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === wanted && b.getBoundingClientRect().width > 0);
  if (!button) return null;
  button.scrollIntoView({ block: 'center' });
  const r = button.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, name);

const openRecording = async () => {
  await reloadModel(`#/recording/${BACKDATE}`);
  await page.waitUntil("document.body.innerText.includes('Keep this one')", { label: 'the recording with its two entries' });
};

await run(async () => {
  await vaultOwner();
  const ids = await holdings([[NAME, 'USD'], [MARKUP_NAME, 'CHF'], ['Euro savings', 'EUR'], [UNBROKEN_NAME, 'CHF']]);
  await recording(BACKDATE, {
    [NAME]: '1234567.89', [MARKUP_NAME]: '2500000.00', 'Euro savings': '3400000.00', [UNBROKEN_NAME]: '1500000.00',
  });
  // A second seven-digit figure for the holding, and a second, differing
  // price for another unit, both on the date.
  await plant([
    { type: 'snapshot', accountId: ids[NAME], payload: { date: BACKDATE, value: '9876543.21', note: null } },
    {
      type: 'rate',
      payload: {
        symbol: 'EUR', date: BACKDATE, rate: '0.990000000000', rateTarget: 'CHF',
        rateSource: 'edited', rateAsOf: BACKDATE, proposedRate: '0.931200000000',
      },
    },
  ]);
  await openRecording();

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const narrow = width <= NARROW;
    const at = `at ${width}px`;
    const seen = await measure(narrow);
    const digits = seen.text.replace(/\D/g, '');
    check(`both figures and both prices show Keep this one ${at}`, seen.keeps === 4, String(seen.keeps));
    check(`the date, the holding, both figures, the unit and the provenance show ${at}`,
      seen.heading !== '' && seen.text.includes(NAME) && digits.includes('123456789') && digits.includes('987654321') &&
      seen.text.includes('USD') && seen.text.includes('EUR') && seen.text.includes('Market rate') && seen.text.includes('Edited from'),
      seen.text.slice(0, 400));
    check(`a holding's name is shown as text, never run as markup ${at}`, seen.text.includes(MARKUP_NAME) && !seen.markupRan);
    check(`no page or box pans sideways ${at}`, seen.pans.length === 0, seen.pans.join('; '));
    check(`nothing is drawn past the screen's edge ${at}`, seen.past.length === 0, seen.past.slice(0, 8).join('; '));
    check(`every control, Keep this one included, lies on screen ${at}`, seen.offScreen.length === 0, seen.offScreen.join('; '));
    check(`a tap at every control's centre lands on it ${at}`, seen.covered.length === 0, seen.covered.join('; '));
    check(`no figure in the lists breaks across lines ${at}`, seen.broken.length === 0, seen.broken.join('; '));
    if (narrow) {
      check(`every control in the lists is at least 44px tall ${at}`, seen.short.length === 0, seen.short.join('; '));
      check(`each line shows the holding or unit, then its figures, then the fault with Keep this one ${at}`, seen.order.length === 0, seen.order.join('; '));
    }

    // A real tap on Delete opens the confirmation, saying the prices go
    // and that it cannot be undone.
    const centre = await centreOf('Delete');
    let confirmation = '';
    if (centre) {
      await page.tap(centre.x, centre.y);
      if (await page.holds("document.querySelector('.dialog')", { timeout: 10000, label: 'the delete confirmation' })) {
        confirmation = await page.eval("document.querySelector('.dialog').innerText");
        await page.key('Escape');
        await page.holds("!document.querySelector('.dialog')", { timeout: 10000, label: 'the confirmation to close' });
      }
    }
    check(`a tap on Delete opens its confirmation ${at}`, /price/i.test(confirmation) && confirmation.includes('cannot be undone'), confirmation || JSON.stringify(centre));
  }

  // A real tap on a figure's Keep this one at the narrowest width answers
  // the fault: it asks first or keeps that figure alone.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 2, mobile: false });
  await openRecording();
  const before = snapshotCount();
  const keep = await centreOf('Keep this one');
  if (keep) await page.tap(keep.x, keep.y);
  const answered = keep !== null && await page.holds(
    () => document.querySelector('.dialog') !== null || [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Keep this one').length < 4,
    { timeout: 10000, label: 'Keep this one to answer' },
  );
  check('a tap on Keep this one at 320px answers it', answered, JSON.stringify({ keep, before, after: snapshotCount() }));

  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
