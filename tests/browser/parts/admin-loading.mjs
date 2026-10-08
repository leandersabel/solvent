// The Admin tables on their way (admin-invites.md, Admin, States).
// While its list is held, each of Invites, Accounts and Units shows
// skeleton rows and no word, then its table once the list arrives.
import { administrator, check, click, intercept, page, run } from '../harness.mjs';

const SECTIONS = [
  ['Accounts', 'accounts', 'ops.leander'],
  ['Units', 'symbols', 'XAU-ozt'],
  ['Invites', 'invites', 'Outstanding invites'],
];

await run(async () => {
  await administrator(page);
  for (const [section, route, loaded] of SECTIONS) {
    let release;
    let reach;
    const gate = new Promise((resolve) => { release = resolve; });
    const reached = new Promise((resolve) => { reach = resolve; });
    const stop = await intercept(page, `*/api/admin/${route}`, async () => {
      reach();
      await gate;
      return null;
    });
    try {
      await click(section);
      await reached;
      const held = await page.call(() => ({
        skeletons: document.querySelectorAll('#app .skeleton-row').length,
        loading: document.querySelector('#app').innerText.includes('Loading'),
      }));
      check(`${section} loads as skeleton rows`, held.skeletons > 0);
      check(`${section} shows no Loading while it loads`, !held.loading);
    } finally {
      release();
      await stop();
    }
    await page.waitUntil(
      (words) => document.querySelector('#app').innerText.includes(words) && !document.querySelector('#app .skeleton-row'),
      { args: [loaded], timeout: 30000, label: `the ${section} table` },
    ).catch(() => {});
    check(`${section} replaces its skeleton rows with the table`, !(await page.call(() => !!document.querySelector('#app .skeleton-row'))));
  }
}, { signsIn: false });
