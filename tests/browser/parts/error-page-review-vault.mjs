// Reviewer's checks of the in-app missing card (spec/features/app-shell.md,
// Error page, Inside the vault, and Addresses inside the vault, criteria
// 83 and 84), written from the spec alone: an address inside the unlocked
// vault that names no screen shows "There is no page at this address."
// with Go to Solvent and Lock, writes nothing, and Go to Solvent opens the
// dashboard still unlocked.
// Modules: app.js, routes.js, view-sweep.js.
import {
  OWN, VAULT_PASSWORD, check, enterPassword, holdings, markDocument, page, recordWrites, recording, reloadModel, run, sitting,
  sql, vaultOwner, writesSeen,
} from '../harness.mjs';

const MISSING = 'There is no page at this address.';

await run(async () => {
  await vaultOwner();
  await holdings([['Cash', 'CHF']]);
  const today = await page.eval(
    "(() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })()",
  );
  const tomorrow = await page.eval(
    "(() => { const d = new Date(); d.setDate(d.getDate() + 1); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })()",
  );
  await recording(today, { Cash: '100' });

  // What the content region shows once an address has settled.
  const shown = () =>
    page.eval(`JSON.stringify({
      heading: [...document.querySelectorAll('#app h1')].map((h) => h.textContent.trim()),
      controls: [...document.querySelectorAll('#app button, #app a')].map((n) => n.textContent.trim()).filter(Boolean),
      fields: document.querySelectorAll('#app input, #app textarea, #app select').length,
      sweep: document.querySelectorAll('.sweep-row').length,
      dashboard: Boolean(document.querySelector('.holdings-card, svg.trend')),
      lock: [...document.querySelectorAll('.topbar button')].some((b) => b.textContent.trim() === 'Lock' || b.getAttribute('aria-label') === 'Lock'),
    })`).then(JSON.parse);
  const go = async (hash) => {
    await page.call((next) => { location.hash = next; }, hash);
    await page.frames();
    await page.idle();
  };

  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard' });
  await markDocument(page, 'review');
  await recordWrites();
  // Every record the vault holds, by id and version, which any write moves.
  const stored = () => JSON.stringify(sql(`SELECT record_id, version FROM records ${OWN} ORDER BY record_id`));
  const before = stored();

  // ---- Criterion 84: every address that names no screen ------------------
  for (const hash of [
    '#/nonsense', '#/holdings', '#/admin', '#/dashboard', '#/settings/other', '#/holding',
    '#/sweep/garbage', '#/sweep/2099-01-01', `#/sweep/${tomorrow}`, '#/sweep/2026-02-30', `#/sweep/${today}/extra`,
    '#/recording/2099-01-01',
  ]) {
    await go(hash);
    await page
      .waitUntil((copy) => document.body.innerText.includes(copy), { args: [MISSING], label: `the missing card at ${hash}` })
      .catch(() => {});
    const seen = await shown();
    check(`${hash} shows the missing heading`, seen.heading.length === 1 && seen.heading[0] === MISSING, JSON.stringify(seen.heading));
    check(`${hash} offers Go to Solvent and nothing else in the content`, seen.controls.join('|') === 'Go to Solvent', seen.controls.join('|'));
    check(`${hash} draws no field, no sweep row and no dashboard`, !seen.fields && !seen.sweep && !seen.dashboard, JSON.stringify(seen));
    check(`${hash} keeps Lock in the bar`, seen.lock);
  }
  check('no address that names no screen wrote anything', (await writesSeen()).length === 0 && stored() === before);

  // ---- Go to Solvent: the dashboard, still unlocked ---------------------
  await go('#/sweep/2099-01-01');
  const at = await page.eval(`(() => {
    const link = [...document.querySelectorAll('#app button, #app a')].find((n) => n.textContent.trim() === 'Go to Solvent');
    const box = link.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  await page.mouseClick(at.x, at.y);
  const drawn = await page
    .waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard from Go to Solvent' })
    .then(() => true, () => false);
  const after = await sitting(page, 'review');
  check(
    'Go to Solvent opens the dashboard in the same unlocked page',
    drawn && after.sameDocument && after.keys && !after.card && ['', '#/'].includes(after.hash),
    JSON.stringify(after),
  );

  // ---- A sweep at a recorded day still opens ----------------------------
  await go(`#/sweep/${today}`);
  const sweepOpened = await page
    .waitUntil("document.querySelector('.sweep-row')", { label: 'the sweep at today' })
    .then(() => true, () => false);
  check('a sweep at today still opens', sweepOpened && !(await page.eval('document.body.innerText')).includes(MISSING));

  // ---- The address typed before the vault is unlocked -------------------
  // The page loaded afresh at that address, so the keys are gone and
  // the card asks for the password first.
  await go('#/sweep/2099-01-01');
  const loaded = page.waitFor('Page.loadEventFired');
  await page.send('Page.reload');
  await loaded;
  await enterPassword(VAULT_PASSWORD);
  const unlocked = await page
    .waitUntil((copy) => !document.querySelector('#unlock-password') && document.body.innerText.includes(copy), {
      args: [MISSING], timeout: 90000, label: 'the missing card after unlocking',
    })
    .then(() => true, () => false);
  await page.idle();
  const seen = await shown();
  check('a sweep at a date to come, typed before unlocking, shows the missing card once unlocked', unlocked && !seen.sweep && !seen.fields, JSON.stringify(seen));
  check('and nothing was written', stored() === before);
});
