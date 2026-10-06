// Reviewer's part for issue #113, written from
// spec/features/admin-invites.md (Admin, Invites: the Status chip and
// the action cell, and criterion 51), blind to the change: a used
// invite whose account was removed names nobody and links nowhere,
// while one whose account remains still names and links it.
import { administrator, check, openBrowser, run, vaultOwner } from '../harness.mjs';

const GONE = 'Already used. The account it created has since been removed.';
const LIVE = 'Already used. Remove the account instead.';

// Each row of the invites table: its text, the Status cell's text and
// links, and the action cell's text. Columns are found by their
// headings, the action cell being the last.
const invites = (session) =>
  session.call(() => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Stops working'),
    );
    if (!table) return null;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    return [...table.querySelectorAll('tbody tr')].map((tr) => {
      const cells = [...tr.querySelectorAll('td, th')];
      const status = cells[heads.indexOf('Status')];
      return {
        text: tr.innerText,
        status: status ? status.innerText : null,
        links: status ? [...status.querySelectorAll('a')].map((a) => a.textContent.trim()) : [],
        action: cells[cells.length - 1].innerText.trim(),
      };
    });
  });

const usedRows = (session) =>
  session.waitUntil(
    () => {
      const table = [...document.querySelectorAll('table')].find((t) =>
        [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Stops working'),
      );
      return table && [...table.querySelectorAll('tbody tr')].filter((tr) => tr.innerText.includes('Used')).length >= 2;
    },
    { timeout: 60000, label: 'the invites table with both used links' },
  );

await run(async () => {
  await vaultOwner();
  const { session, close } = await openBrowser();
  try {
    await administrator(session);
    await usedRows(session);
    let rows = await invites(session);
    check(
      'before removal, the used link names leander and says to remove the account',
      rows.some((r) => /\bUsed leander\b/.test(r.status) && r.action === LIVE),
      JSON.stringify(rows),
    );

    const status = await session.call(async () => (await fetch('/api/admin/accounts/leander', {
      method: 'DELETE',
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmUsername: 'leander' }),
    })).status);
    check('the administrator removes leander', status === 200 || status === 204, String(status));

    await session.eval('location.reload()');
    await usedRows(session);
    rows = await invites(session);
    const removed = rows.filter((r) => r.status && r.status.includes('Used') && !r.text.includes('ops.leander'));
    const kept = rows.filter((r) => r.text.includes('ops.leander'));
    check(
      'the removed account\'s invite reads account removed, with no name and no link',
      removed.length === 1 && removed[0].status.includes('account removed') &&
        removed[0].links.length === 0 && !/\bleander\b/.test(removed[0].text),
      JSON.stringify(rows),
    );
    check('its action cell says the account has since been removed', removed.length === 1 && removed[0].action === GONE, JSON.stringify(removed));
    check(
      'an invite whose account remains still names it and says to remove it',
      kept.length === 1 && kept[0].status.includes('ops.leander') && kept[0].action === LIVE &&
        !kept[0].status.includes('account removed'),
      JSON.stringify(kept),
    );
  } finally {
    close();
  }
}, { signsIn: false });
