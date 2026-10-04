// What each prepared vault shows, for tests/test_review_nightly_harness.py:
// signs in to each vault owner REVIEW_CHECKS names and prints, as JSON,
// the dashboard's figures under both pricing modes, how many figures and
// prices each named date still holds, and, where asked, whether
// code-like names read as literal text in the list, the legend and the
// chart's readout.
//
// SOLVENT_BASE is the server. REVIEW_CHECKS is a JSON list of
// {username, password, dates, literal?: {holding, dimension, value}}.
import { launch, Session } from './cdp.mjs';

const base = process.env.SOLVENT_BASE;
const checks = JSON.parse(process.env.REVIEW_CHECKS);

const read = (page) => page.eval(`(() => {
  const plain = (text) => text.replace(/^[A-Z]{3}\\s/, '').replace(/\\u2212/g, '-').trim();
  const parts = Object.fromEntries([...document.querySelectorAll('.hero-part')].map((part) => [
    part.querySelector('.eyebrow').textContent, plain(part.querySelector('.hero-part-value').textContent),
  ]));
  // With nothing valued the hero figure holds a dash and no amount.
  const total = document.querySelector('.hero-amount') || document.querySelector('.hero-figure');
  return JSON.stringify({ total: total ? plain(total.textContent) : null, assets: parts.Assets ?? null, debts: parts.Liabilities ?? null });
})()`).then(JSON.parse);

const shown = {};
for (const account of checks) {
  const opened = await launch();
  try {
    const page = await Session.connect(opened.target);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.track();
    await page.goto(`${base}/login`);
    await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the sign-in card' });
    await page.call((name, secret) => {
      const set = (selector, value) => {
        const node = document.querySelector(selector);
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#unlock-username', name);
      set('#unlock-password', secret);
      document.querySelector('button[type=submit]').click();
    }, account.username, account.password);
    await page.waitUntil(
      "location.pathname === '/dashboard' && !document.querySelector('#unlock-password') && (document.querySelector('.hero-figure') || document.body.innerText.includes('Add your first holding'))",
      { timeout: 120000, label: `the dashboard of ${account.username}` },
    );
    await page.idle();

    const entry = { latest: await read(page), recordings: {} };
    for (const date of account.dates) {
      entry.recordings[date] = await page.call((day) => import('/static/js/session.js').then((s) => {
        const { figures, prices } = s.currentVault().recording(day);
        return { figures: figures.length, prices: prices.length };
      }), date);
    }

    if (account.literal) {
      const { holding, dimension, value } = account.literal;
      await page.eval("window.__alerted = false; window.alert = () => { window.__alerted = true; }");
      const scripts = await page.eval("document.querySelectorAll('script').length");
      const picked = await page.call((label) => {
        const select = document.querySelector('.chart-card select');
        const option = select && [...select.options].find((o) => o.textContent === label);
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, dimension);
      await page.frames();
      await page.eval(`(() => {
        const svg = document.querySelector('svg.trend');
        if (!svg) return;
        const box = svg.getBoundingClientRect();
        svg.dispatchEvent(new PointerEvent('pointermove', { clientX: box.right - 10, clientY: box.top + 20, bubbles: true }));
      })()`);
      await page.frames();
      entry.literal = await page.call((name, val, chose) => ({
        row: [...document.querySelectorAll('.holdings-table .row-name')].some((n) => n.textContent === name),
        legend: chose && [...document.querySelectorAll('.legend-name')].some((n) => n.textContent === val),
        tooltip: chose && (document.querySelector('.chart-readout')?.textContent ?? '').includes(val),
      }), holding, value, picked);
      entry.literal.scriptsAdded = (await page.eval("document.querySelectorAll('script').length")) - scripts;
      entry.literal.alerted = await page.eval('window.__alerted');
    }

    const toggled = await page.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Rates as of each figure');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (toggled) {
      await page.frames();
      entry.asRecorded = await read(page);
    }
    shown[account.username] = entry;
  } finally {
    opened.child.kill();
  }
}
console.log(JSON.stringify(shown));
