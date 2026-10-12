// Reviewer's checks of a filtered dashboard's address
// (spec/features/app-shell.md, Addresses inside the vault, criteria 83
// and 84, and spec/features/net-worth-view.md, Dashboard, Filtered to
// the unassigned), written from the spec alone: `#/unassigned/<dimension>`
// is the filtered dashboard only for an active dimension of the vault.
// Any other dimension, archived, unknown or a name every object answers
// to, shows "There is no page at this address." with Go to Solvent and
// Lock, writes nothing, and Go to Solvent opens the dashboard still
// unlocked.
// Modules: app.js, routes.js, view-dashboard.js.
import {
  OWN, VAULT_PASSWORD, check, enterPassword, holdings, markDocument, page, recordWrites, recording, reloadModel, run,
  setProfile, sitting, sql, vaultOwner, writesSeen,
} from '../harness.mjs';

const MISSING = 'There is no page at this address.';
const FILTERED = 'Showing the holdings with no Liquidity value.';

const LIQUIDITY = {
  id: 'liq',
  label: 'Liquidity',
  archivedAt: null,
  values: [{ id: 'cash', label: 'Cash', archivedAt: null }],
};
const REGION = {
  id: 'region',
  label: 'Region',
  archivedAt: '2026-01-05T09:00:00.000Z',
  values: [{ id: 'home', label: 'Home', archivedAt: null }],
};

await run(async () => {
  await vaultOwner();
  await holdings([['Cash', 'CHF', { liq: 'cash' }], ['Flat', 'CHF']]);
  const today = await page.eval(
    "(() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })()",
  );
  await recording(today, { Cash: '100', Flat: '200' });
  await setProfile({ dimensions: [LIQUIDITY, REGION] });

  // What the content region shows once an address has settled.
  const shown = () =>
    page.eval(`JSON.stringify({
      heading: [...document.querySelectorAll('#app h1')].map((h) => h.textContent.trim()),
      controls: [...document.querySelectorAll('#app button, #app a')].map((n) => n.textContent.trim()).filter(Boolean),
      fields: document.querySelectorAll('#app input, #app textarea, #app select').length,
      dashboard: Boolean(document.querySelector('.holdings-card, svg.trend, .hero-figure')),
      text: document.querySelector('#app') ? document.querySelector('#app').innerText : '',
      lock: [...document.querySelectorAll('.topbar button')].some((b) => b.textContent.trim() === 'Lock' || b.getAttribute('aria-label') === 'Lock'),
    })`).then(JSON.parse);
  const go = async (hash) => {
    await page.call((next) => { location.hash = next; }, hash);
    await page.frames();
    await page.idle();
  };
  const settle = (hash, copy) =>
    page
      .waitUntil((wanted) => document.body.innerText.includes(wanted), { args: [copy], label: `${copy} at ${hash}` })
      .then(() => true, () => false);
  const missingAt = async (hash) => {
    await go(hash);
    await settle(hash, MISSING);
    const seen = await shown();
    check(`${hash} shows the missing heading`, seen.heading.length === 1 && seen.heading[0] === MISSING, JSON.stringify(seen.heading));
    check(`${hash} offers Go to Solvent and nothing else in the content`, seen.controls.join('|') === 'Go to Solvent', seen.controls.join('|'));
    check(`${hash} draws no field and no dashboard`, !seen.fields && !seen.dashboard && !seen.text.includes(FILTERED), JSON.stringify(seen));
    check(`${hash} keeps Lock in the bar`, seen.lock);
  };
  const filteredAt = async (hash, label) => {
    await go(hash);
    await settle(hash, FILTERED);
    const seen = await shown();
    check(
      `${label}: ${hash} is the dashboard filtered to the unassigned`,
      seen.dashboard && seen.text.includes(FILTERED) && seen.text.includes('Show all holdings') && !seen.text.includes(MISSING) &&
        (seen.text.split(FILTERED)[1] || '').includes('Flat') && !(seen.text.split(FILTERED)[1] || '').includes('Cash'),
      seen.text.slice(0, 600),
    );
  };

  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard' });
  await markDocument(page, 'review');
  await recordWrites();
  // Every record the vault holds, by id and version, which any write moves.
  const stored = () => JSON.stringify(sql(`SELECT record_id, version FROM records ${OWN} ORDER BY record_id`));
  const before = stored();

  // ---- An active dimension still opens the filter --------------------
  await filteredAt('#/unassigned/liq', 'an active dimension');

  // ---- Criterion 84: a dimension the vault does not hold as active ----
  // Each is reached from the filtered dashboard, so a view kept from the
  // last address cannot pass for the right one.
  for (const hash of [
    '#/unassigned/nowhere', '#/unassigned/region', '#/unassigned/Liquidity', '#/unassigned/LIQ', '#/unassigned/cash',
    '#/unassigned/constructor', '#/unassigned/__proto__', '#/unassigned/toString', '#/unassigned/hasOwnProperty',
    '#/unassigned/', '#/unassigned', '#/unassigned/liq/extra', '#/unassigned/liq%20',
  ]) {
    await filteredAt('#/unassigned/liq', `before ${hash}`);
    await missingAt(hash);
  }
  check('no filtered address naming no active dimension wrote anything', (await writesSeen()).length === 0 && stored() === before);

  // ---- Go to Solvent: the dashboard, still unlocked, unfiltered -------
  await go('#/unassigned/nowhere');
  await settle('#/unassigned/nowhere', MISSING);
  const at = await page.eval(`(() => {
    const link = [...document.querySelectorAll('#app button, #app a')].find((n) => n.textContent.trim() === 'Go to Solvent');
    const box = link.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  })()`);
  await page.mouseClick(at.x, at.y);
  const drawn = await page
    .waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard from Go to Solvent' })
    .then(() => true, () => false);
  await page.idle();
  const after = await sitting(page, 'review');
  const home = await shown();
  check(
    'Go to Solvent opens the unfiltered dashboard in the same unlocked page',
    drawn && after.sameDocument && after.keys && !after.card && ['', '#/'].includes(after.hash) && !home.text.includes(FILTERED),
    JSON.stringify({ after, text: home.text.slice(0, 300) }),
  );

  // ---- A dimension archived while its filter is open ------------------
  // The address it leaves behind names no active dimension any more.
  await filteredAt('#/unassigned/liq', 'before archiving Liquidity');
  await setProfile({ dimensions: [{ ...LIQUIDITY, archivedAt: '2026-01-06T09:00:00.000Z' }, REGION] });
  await reloadModel('#/unassigned/liq');
  await settle('#/unassigned/liq', MISSING);
  const archived = await shown();
  check(
    'the address of a dimension archived since shows the missing card once the vault reads again',
    archived.heading.length === 1 && archived.heading[0] === MISSING && !archived.dashboard,
    JSON.stringify({ heading: archived.heading, dashboard: archived.dashboard }),
  );
  await setProfile({ dimensions: [LIQUIDITY, REGION] });
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard after unarchiving' });
  const settled = stored();

  // ---- The address typed before the vault is unlocked ----------------
  // The page loads afresh at that address, so the keys are gone and the
  // card asks for the password first. Only once the vault is read can
  // its dimensions be known.
  const unlockAt = async (hash, copy) => {
    await go(hash);
    const loaded = page.waitFor('Page.loadEventFired');
    await page.send('Page.reload');
    await loaded;
    await enterPassword(VAULT_PASSWORD);
    const reached = await page
      .waitUntil((wanted) => !document.querySelector('#unlock-password') && document.body.innerText.includes(wanted), {
        args: [copy], timeout: 90000, label: `${copy} after unlocking at ${hash}`,
      })
      .then(() => true, () => false);
    await page.idle();
    return { reached, seen: await shown() };
  };
  const unknown = await unlockAt('#/unassigned/nowhere', MISSING);
  check(
    'a filter naming no dimension, typed before unlocking, shows the missing card once unlocked',
    unknown.reached && unknown.seen.heading[0] === MISSING && !unknown.seen.dashboard,
    JSON.stringify({ heading: unknown.seen.heading, dashboard: unknown.seen.dashboard }),
  );
  const active = await unlockAt('#/unassigned/liq', FILTERED);
  check(
    'a filter naming an active dimension, typed before unlocking, opens filtered once unlocked',
    active.reached && active.seen.dashboard && !active.seen.text.includes(MISSING),
    active.seen.text.slice(0, 300),
  );
  check('and nothing was written by either', stored() === settled);
});
