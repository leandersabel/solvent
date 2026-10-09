// Recording detail beside holding names with no break in them, written
// from spec/features/record-snapshot.md (Recording detail, Layout and At
// phone width, acceptance criterion 94) and design-system.md (Figures,
// Units) without reading how the screen is built. At every width a name
// wraps rather than pans, and each figure beside it, its unit and "not
// priced" included, stays on one line. Opening it writes nothing and asks
// no price (criterion 34), and a price line names its unit in full
// (criterion 96).
import {
  BACKDATE, OWN, check, holdings, page, plant, proxyAsks, recording, reloadModel, run, sql, vaultOwner, watched,
} from '../harness.mjs';

// Wider than the content column at every width, so it must wrap.
const ENDLESS = 'ZKB_Vorsorgekonto_3a_CH9300762011623852957_Freizuegigkeitsstiftung_Rahmenvertrag_Pensionskasse_Hauptkonto_Zuerich';
// Long enough to crowd the figures, short enough to fit a desktop line.
const LONG = 'UBS_Wertschriftendepot_CH5604835012345678009';
const LINES = [
  [ENDLESS, 'CHF', '18120.00'],
  [LONG, 'USD', '1234567.89'],
  // A unit whose price line is left empty: its figure is planted after
  // the recording's prices were written.
  ['Festgeld_Deutsche_Bank_DE89370400440532013000', 'EUR', '2500000.00'],
  ['Goldbarren_Zollfreilager_Embraport_CH12345678', 'XAU-ozt', '1250000.125'],
  ['Parkplatz_Tiefgarage_Seefeldstrasse_123_Zuerich', 'm2', '1250000'],
];
const WIDTHS = [320, 375, 601, 901, 1280];

const measure = () => page.call((names) => {
  // A figure: an optional currency code, the number, an optional unit
  // after it, or the converted figure's "not priced".
  const FIGURE = /(?:[A-Z]{3}[\s  ]?)?[-−]?\d(?:[\d,.'’  ]|\s(?=\d{3}(?!\d)))*(?:[\s  ]?(?:m2|ozt))?|not priced/g;
  const width = window.innerWidth;
  const html = document.documentElement;
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && n.closest('[hidden]') === null;
  };
  const label = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')}`;
  const textNodes = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.parentElement && shown(walker.currentNode.parentElement)) nodes.push(walker.currentNode);
    return nodes;
  };
  // Rendered lines a range covers: a rect starting below the previous
  // line's bottom opens a new one.
  const lineCount = (rects) => {
    const sorted = [...rects].filter((r) => r.width > 0).sort((a, b) => a.top - b.top);
    let count = 0;
    let bottom = -Infinity;
    for (const r of sorted) {
      if (r.top >= bottom - 1) count += 1;
      bottom = Math.max(bottom, r.bottom);
    }
    return count;
  };
  const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

  const pans = [];
  if (html.scrollWidth > html.clientWidth + 0.5) pans.push(`page ${html.scrollWidth} > ${html.clientWidth}`);
  for (const n of document.querySelectorAll('body *')) {
    if (!shown(n)) continue;
    const s = getComputedStyle(n);
    if (['auto', 'scroll'].includes(s.overflowX) && n.scrollWidth > n.clientWidth + 0.5) pans.push(`${label(n)} ${n.scrollWidth} > ${n.clientWidth}`);
  }

  const named = (name) => [...document.querySelectorAll('main a, main button')].filter((a) => a.textContent.trim() === name && shown(a));
  // One line naming `name` by `link`: the largest box around the link
  // holding no other name.
  const measureLine = (name, link) => {
    let line = link;
    while (line.parentElement && line.parentElement !== document.body &&
      named(name).filter((a) => line.parentElement.contains(a)).length === 1 &&
      !names.some((other) => other !== name && line.parentElement.textContent.includes(other))) line = line.parentElement;
    const nameRange = document.createRange();
    nameRange.selectNodeContents(link);
    const nameRects = [...nameRange.getClientRects()].filter((r) => r.width > 0);
    const nameBox = nameRange.getBoundingClientRect();

    // The line's text after the name, joined, with each character's node
    // and offset, so a figure split over elements is one range.
    let joined = '';
    const at = [];
    for (const t of textNodes(line).filter((n) => !link.contains(n))) {
      for (let i = 0; i < t.textContent.length; i += 1) at.push([t, i]);
      joined += t.textContent;
    }
    const figures = [];
    for (const m of joined.matchAll(FIGURE)) {
      const text = m[0].trim();
      if (text !== 'not priced' && text.replace(/\D/g, '').length < 4) continue;
      const [startNode, startOffset] = at[m.index];
      const [endNode, endOffset] = at[m.index + m[0].length - 1];
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset + 1);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const box = range.getBoundingClientRect();
      figures.push({
        text,
        lines: lineCount(rects),
        onScreen: box.left >= -0.5 && box.right <= width + 0.5,
        underName: nameRects.some((r) => rects.some((f) => meets(r, f))),
      });
    }
    return {
      nameLines: lineCount(nameRects),
      nameOnScreen: nameBox.left >= -0.5 && nameBox.right <= width + 0.5,
      figures,
    };
  };
  const lines = Object.fromEntries(names.map((name) => [name, named(name).map((link) => measureLine(name, link))]));
  return JSON.stringify({ pans, lines, text: (document.querySelector('main') || document.body).innerText });
}, LINES.map(([name]) => name)).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  const [recorded, [empty]] = [LINES.filter(([, unit]) => unit !== 'EUR'), LINES.filter(([, unit]) => unit === 'EUR')];
  const ids = await holdings(recorded.map(([name, unit]) => [name, unit]));
  await recording(BACKDATE, Object.fromEntries(recorded.map(([name, , value]) => [name, value])));
  Object.assign(ids, await holdings([[empty[0], empty[1]]]));
  await plant([
    { type: 'snapshot', accountId: ids[empty[0]], payload: { date: BACKDATE, value: empty[2], note: null } },
    // A second figure for the dollar holding at the date, so its two
    // lines carry the fault and Keep this one beside the name.
    { type: 'snapshot', accountId: ids[LONG], payload: { date: BACKDATE, value: '9876543.21', note: null } },
  ]);

  const stored = () => JSON.stringify(sql(`SELECT records.* FROM records ${OWN} ORDER BY record_id`));
  await reloadModel();
  const before = stored();
  const [requestsBefore, asksBefore] = [watched[0].requests.length, proxyAsks.length];
  await page.call((date) => { location.hash = `#/recording/${date}`; }, BACKDATE);
  await page.waitUntil((name) => document.body.innerText.includes(name), { args: [LONG], label: 'the recording' });
  await page.idle();
  const sent = watched[0].requests.slice(requestsBefore);
  check('opening the recording issues no PUT and no DELETE',
    !sent.some((r) => ['PUT', 'DELETE'].includes(r.method)), sent.map((r) => `${r.method} ${r.url}`).join('; '));
  check('opening the recording, with an empty price line on it, asks the price source nothing',
    proxyAsks.length === asksBefore && !sent.some((r) => r.url.includes('/api/rates?')), proxyAsks.slice(asksBefore).join('; '));
  check('every record is byte-identical after opening the recording', stored() === before);

  const prices = await page.eval("(document.querySelector('main') || document.body).innerText");
  check('a price line names gold in full, "Gold, troy ounce"', prices.includes('Gold, troy ounce'));
  check('no line names a unit by its symbol', !/XAU-(ozt|g)\b/.test(prices), prices.match(/.*XAU-.*/g)?.join('; '));

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    const at = `at ${width}px`;
    check(`no page or box pans sideways ${at}`, seen.pans.length === 0, seen.pans.join('; '));
    for (const [name, unit] of LINES) {
      const expected = name === LONG ? 2 : 1;
      check(`the ${unit} holding's name is the control opening it on each of its ${expected} lines ${at}`,
        seen.lines[name].length === expected && seen.text.includes(name), String(seen.lines[name].length));
      for (const [index, line] of seen.lines[name].entries()) {
        const who = `the ${unit} holding's line ${index + 1} ${at}`;
        check(`${who} keeps its name on screen`, line.nameOnScreen);
        if (name === ENDLESS) check(`${who} wraps a name wider than the screen's column`, line.nameLines > 1, String(line.nameLines));
        // The holding's own figure and its converted one, or "not priced".
        check(`${who} shows both figures`, line.figures.length >= 2, JSON.stringify(line.figures));
        const broken = line.figures.filter((f) => f.lines !== 1);
        check(`${who} keeps each figure on one line`, broken.length === 0, broken.map((f) => `"${f.text}" on ${f.lines} lines`).join('; '));
        const off = line.figures.filter((f) => !f.onScreen || f.underName);
        check(`${who} draws no figure past the edge or under the name`, off.length === 0, off.map((f) => f.text).join('; '));
      }
    }
  }
}, { signsIn: false });
