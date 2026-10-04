// Reviewer's part for issue #219, written from spec/features/admin-invites.md
// (Admin, Accounts, the Items column, and criterion 20) blind to the
// change: a fresh vault reads 0, an administrator reads No vault, and
// the count follows what the owner adds.
import { administrator, check, holdings, openBrowser, run, sql, vaultOwner } from '../harness.mjs';

// The Items cell of each row of the Accounts table, keyed by the
// Username cell, the columns found by their headings.
const itemsCells = (session) =>
  session.call(() => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Items'),
    );
    if (!table) return null;
    const heads = [...table.querySelectorAll('th')].map((th) => th.textContent.trim());
    const at = (name) => heads.indexOf(name);
    return Object.fromEntries(
      [...table.querySelectorAll('tbody tr')].map((tr) => {
        const cells = [...tr.querySelectorAll('td, th')];
        return [cells[at('Username')].textContent.trim(), cells[at('Items')].textContent.trim()];
      }),
    );
  });

const openAccounts = async (session) => {
  await session.waitUntil(
    () => [...document.querySelectorAll('a, button')].some((n) => n.textContent.trim() === 'Accounts'),
    { label: 'the Accounts link' },
  );
  await session.call(() => [...document.querySelectorAll('a, button')].find((n) => n.textContent.trim() === 'Accounts').click());
  await session.waitUntil(
    () => [...document.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Items') &&
      document.querySelectorAll('table tbody tr').length >= 2 &&
      ![...document.querySelectorAll('table tbody tr')].some((tr) => tr.textContent.trim() === ''),
    { timeout: 60000, label: 'the accounts table' },
  );
};

await run(async () => {
  await vaultOwner();
  const { session, close } = await openBrowser();
  try {
    await administrator(session);
    await openAccounts(session);
    let cells = await itemsCells(session);
    check('a vault nobody has added anything to reads 0 items', cells && cells.leander === '0', JSON.stringify(cells));
    check('an administrator reads No vault, never a zero', cells && cells['ops.leander'] === 'No vault', JSON.stringify(cells));

    await holdings([['Cantonal account', 'CHF'], ['Gold bars', 'XAU-ozt']]);
    const added = sql(
      "SELECT COUNT(*) AS n FROM records JOIN principals ON principals.id = records.principal_id " +
        "WHERE principals.username = 'leander' AND record_type <> 'profile'",
    )[0].n;
    await session.eval('location.reload()');
    await openAccounts(session);
    cells = await itemsCells(session);
    check(
      'the count follows what the owner added, and leaves the profile out',
      added === 2 && cells && cells.leander === '2',
      `${added} added, ${JSON.stringify(cells)}`,
    );
  } finally {
    close();
  }
}, { signsIn: false });
