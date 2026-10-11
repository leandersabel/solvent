// The holdings table with ordinary names and dimension chips
// (net-worth-view.md, Holdings table, and acceptance criterion 73). Each
// breaks only between its words, which in the band just above phone width
// takes the list layout.
import { BACKDATE, check, holdings, page, recording, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// A unit other than CHF fills Latest value, which narrows the name column.
const HOLDINGS = [['Cash account', 'CHF'], ['Dollar account', 'USD'], ['Pension fund', 'CHF'], ['Old dollar savings', 'USD']];
const NAMES = HOLDINGS.map(([name]) => name);
const VALUES = ['Liquid investments', 'Fixed investments'];
// At 320px a figure of eight digits leaves a word no room, so it breaks
// where it has to.
const WIDTHS = [601, 901, 915, 960, 1024, 1280];

// A word drawn on more than one line was broken inside it.
const measure = () => page.call((texts) => {
  const html = document.documentElement;
  const nodes = [...document.querySelectorAll('.holdings-table .row-name, .holdings-table .chip')];
  const broken = nodes.flatMap((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const words = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      for (const word of text.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        if (range.getClientRects().length > 1) words.push(word[0]);
      }
    }
    return words;
  });
  const shown = texts.filter((text) => nodes.some((node) => node.textContent.includes(text)));
  return JSON.stringify({ width: html.clientWidth, scrollWidth: html.scrollWidth, shown: shown.length, broken });
}, [...NAMES, ...VALUES]).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  await setProfile({
    dimensions: [{ id: 'liquidity', label: 'Liquidity', values: [{ id: 'liquid', label: VALUES[0] }, { id: 'fixed', label: VALUES[1] }] }],
  });
  await holdings(HOLDINGS.map(([name, unit], i) => [name, unit, { liquidity: i % 2 ? 'fixed' : 'liquid' }]));
  await recording(BACKDATE, Object.fromEntries(NAMES.map((name) => [name, '12345678.90'])));
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the holdings table' });

  for (const width of WIDTHS) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false });
    await page.frames();
    const seen = await measure();
    check(`net-worth-view: every name and chip is in the holdings table at ${width}px`, seen.shown === NAMES.length + VALUES.length, JSON.stringify(seen));
    check(`net-worth-view: ordinary names and chips break only between words at ${width}px`, !seen.broken.length, JSON.stringify(seen));
    check(`net-worth-view: the dashboard never pans sideways at ${width}px`, seen.scrollWidth <= seen.width, JSON.stringify(seen));
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
}, { signsIn: false });
