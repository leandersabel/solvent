// Reviewer's checks of the holding's name on Account detail
// (spec/features/manage-accounts.md, Account detail, Header, and
// criterion 62), written from the feature page and design-system.md,
// Typography, alone. The name is found as the text it is, not by how
// the screen marks it up: the first shown text on the screen that reads
// the holding's name.
import { check, openHolding, page, plant, reloadModel, run, vaultOwner } from '../harness.mjs';

// The screen heading's size by width (design-system.md, Typography),
// and the weight it keeps at every width.
const SIZES = [[1280, '32px'], [901, '32px'], [375, '26px'], [320, '26px']];
const WEIGHT = '600';
const MARKUP = '<img src=x onerror=__nameRan=1>Vault & co';

const account = (name, archivedAt = null) => ({
  name, unit: 'CHF', dims: {}, note: null, archivedAt, createdAt: new Date().toISOString(),
});

// How the first shown occurrence of `name` is drawn, outside any dialog.
const drawn = (holding) => page.call((name) => {
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && n.closest('[hidden]') === null;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const box = walker.currentNode.parentElement;
    if (walker.currentNode.textContent.trim() !== name || !shown(box) || box.closest('.dialog')) continue;
    const s = getComputedStyle(box);
    const heading = box.closest('h1, h2, h3, h4, h5, h6, [role=heading]');
    return JSON.stringify({
      size: s.fontSize, weight: s.fontWeight,
      heading: heading ? heading.tagName.toLowerCase() : null,
    });
  }
  return 'null';
}, holding).then(JSON.parse);

await run(async () => {
  await vaultOwner();
  const names = ['Zürcher Kantonalbank Sparkonto', 'Old pension', MARKUP];
  const ids = Object.fromEntries((await plant(names.map((name) => ({ type: 'account', payload: account(name) }))))
    .map((id, at) => [names[at], id]));
  await plant([{
    type: 'account', recordId: ids['Old pension'], version: 2,
    payload: account('Old pension', new Date().toISOString().slice(0, 10)),
  }]);
  await reloadModel();

  for (const [width, size] of SIZES) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const name of names) {
      await openHolding(ids[name]);
      const seen = await drawn(name);
      const what = `"${name}" at ${width}px`;
      check(`62: the name of ${what} is shown on its screen`, seen !== null, JSON.stringify(seen));
      if (seen === null) continue;
      check(`62: the name of ${what} is drawn at the screen heading's ${size}`, seen.size === size, JSON.stringify(seen));
      check(`62: the name of ${what} is drawn at the screen heading's weight ${WEIGHT}`, seen.weight === WEIGHT, JSON.stringify(seen));
      check(`the name of ${what} is the screen's heading`, seen.heading !== null, JSON.stringify(seen));
    }
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {});

  // Decrypted text renders as text (architecture.md, Application hardening).
  await openHolding(ids[MARKUP]);
  check('a name holding markup builds no element and runs nothing',
    !(await page.eval("Boolean(document.querySelector('img[src=x]'))")) && !(await page.eval('window.__nameRan === 1')));
}, { signsIn: false });
