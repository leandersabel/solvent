// Reviewer's part for issue #306, written from spec/features/admin-invites.md
// (Admin, Accounts, the Items bullet, and criterion 20) and
// design-system.md (Ink and line), blind to the change: a vault's count
// is drawn in its row's ink, zero or not, and in the Accounts table only
// No vault is drawn in ink-muted.
import { administrator, check, holdings, openBrowser, run, vaultOwner } from '../harness.mjs';

// design-system.md, Ink and line.
const INK_MUTED = 'rgb(121, 130, 133)';

// For each row of the Accounts table, keyed by its username: the color
// of the Username and Items text, and the text of every element in the
// row drawn in ink-muted. Columns are found by their headings, and a
// cell's color is read off the innermost element holding its text.
const inks = (session) =>
  session.call((muted) => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      [...t.querySelectorAll('th')].some((th) => th.textContent.trim() === 'Items'),
    );
    if (!table) return null;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const drawn = (cell) => {
      let node = cell;
      for (;;) {
        const inner = [...node.children].find((c) => c.textContent.trim() === cell.textContent.trim());
        if (!inner) return getComputedStyle(node).color;
        node = inner;
      }
    };
    const ownText = (node) =>
      [...node.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
    return Object.fromEntries(
      [...table.querySelectorAll('tbody tr')].map((tr) => {
        const cells = [...tr.querySelectorAll('td, th')];
        const items = cells[heads.indexOf('Items')];
        return [cells[heads.indexOf('Username')].textContent.trim(), {
          items: items.textContent.trim(),
          itemsInk: drawn(items),
          usernameInk: drawn(cells[heads.indexOf('Username')]),
          muted: [...tr.querySelectorAll('*')]
            .filter((n) => ownText(n) && getComputedStyle(n).color === muted)
            .map((n) => ownText(n)),
        }];
      }),
    );
  }, INK_MUTED);

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

const inRowInk = (row) => row && row.itemsInk === row.usernameInk && row.itemsInk !== INK_MUTED;
const onlyNoVaultMuted = (rows) =>
  rows && Object.values(rows).every((row) => row.muted.every((t) => t === 'No vault'));

await run(async () => {
  await vaultOwner();
  const { session, close } = await openBrowser();
  try {
    await administrator(session);
    await openAccounts(session);
    let rows = await inks(session);
    check('an empty vault\'s 0 is drawn in its row\'s ink, not ink-muted', inRowInk(rows && rows.leander), JSON.stringify(rows));
    check(
      'an administrator\'s No vault is drawn in ink-muted',
      rows && rows['ops.leander'].items === 'No vault' && rows['ops.leander'].itemsInk === INK_MUTED,
      JSON.stringify(rows),
    );
    check('only No vault is drawn in ink-muted in the Accounts table', onlyNoVaultMuted(rows), JSON.stringify(rows));

    await holdings([['Cantonal account', 'CHF'], ['Gold bars', 'XAU-ozt']]);
    await session.eval('location.reload()');
    await openAccounts(session);
    rows = await inks(session);
    check(
      'a vault\'s count above zero is drawn in its row\'s ink, not ink-muted',
      rows && rows.leander.items === '2' && inRowInk(rows.leander),
      JSON.stringify(rows),
    );
    check('only No vault is drawn in ink-muted once the vault holds items', onlyNoVaultMuted(rows), JSON.stringify(rows));
  } finally {
    close();
  }
}, { signsIn: false });
