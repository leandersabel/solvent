// What each prepared vault shows on its dashboard, for
// tests/test_nightly_browser.py: signs in to every vault owner in the
// manifest and prints, as JSON, the figures under both pricing modes
// how many records the vault could not read and, for the vault covering
// idle-lock-out-of-range, the idle lock it stores and the one Settings shows.
//
// SOLVENT_BASE is the server and NIGHTLY_MANIFEST the manifest.
import { readFileSync } from 'node:fs';
import { launch, Session } from './cdp.mjs';

const base = process.env.SOLVENT_BASE;
const manifest = JSON.parse(readFileSync(process.env.NIGHTLY_MANIFEST, 'utf8'));

const shown = {};
for (const account of manifest.accounts.filter((a) => a.kind === 'vault_owner')) {
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

    const read = () => page.eval(`(() => {
      const plain = (text) => text.replace(/^[A-Z]{3}\\s/, '').replace(/\\u2212/g, '-');
      const parts = Object.fromEntries([...document.querySelectorAll('.hero-part')].map((part) => [
        part.querySelector('.eyebrow').textContent, plain(part.querySelector('.hero-part-value').textContent),
      ]));
      const total = document.querySelector('.hero-amount');
      return JSON.stringify({
        total: total ? plain(total.textContent) : null,
        assets: parts.Assets ?? null,
        debts: parts.Liabilities ?? null,
      });
    })()`).then(JSON.parse);

    const entry = { latest: await read() };
    const toggled = await page.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Rates as of each figure');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (toggled) {
      await page.frames();
      entry.asRecorded = await read();
    }
    entry.unreadable = await page.eval("import('/static/js/session.js').then((s) => s.currentVault().unreadable.length)");
    if (account.covers.includes('idle-lock-out-of-range')) {
      entry.storedIdleLock = await page.eval("import('/static/js/session.js').then((s) => s.currentVault().profile.idleLockMinutes)");
      await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
      await page.waitUntil("document.body.innerText.includes('Session and lock')", { label: 'the settings screen' });
      entry.shownIdleLock = await page.eval(
        "[...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Session and lock')).querySelector('select').value",
      );
    }
    shown[account.username] = entry;
  } finally {
    opened.child.kill();
  }
}
console.log(JSON.stringify(shown));
