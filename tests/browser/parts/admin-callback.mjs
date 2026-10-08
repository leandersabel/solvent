// Calling back an invite from the Invites table (admin-invites.md,
// Admin, States, Invites, and criterion 61). One invite is used in a
// second browser while the table is open, and its Call back refreshes
// the row to Used with its message. Another's Call back the server
// fails, and its row stays Waiting with the error beneath.
import {
  REGISTRANT_PASSWORD, administrator, check, click, expectedFailures, intercept, openBrowser, page, register, run, sql,
} from '../harness.mjs';

const USED = 'This link has already been used. Remove the account instead.';
const FAILED = 'The link was not called back. Try again.';

const invite = (label) =>
  page.call(async (note) => {
    const response = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInDays: 7, label: note, kind: 'administrator' }),
    });
    return response.json();
  }, label);

// The row whose note is `label`: its Status and action cells.
const row = (label) =>
  page.call((note) => {
    const tr = [...document.querySelectorAll('tr')].find((r) => r.cells[1]?.textContent.trim() === note);
    if (!tr) return null;
    const flat = (cell) => cell.innerText.replace(/\s+/g, ' ').trim();
    return { status: flat(tr.cells[4]), action: flat(tr.cells[5]) };
  }, label);

const callBack = async (label) => {
  await page.call((note) => {
    const tr = [...document.querySelectorAll('tr')].find((r) => r.cells[1]?.textContent.trim() === note);
    [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Call back').click();
  }, label);
  await click('Call it back');
};

const rowReads = (label, text) =>
  page.waitUntil(
    (note, words) => {
      const tr = [...document.querySelectorAll('tr')].find((r) => r.cells[1]?.textContent.trim() === note);
      return tr?.cells[5]?.innerText.includes(words);
    },
    { args: [label, text], timeout: 30000, label: `the ${label} row reading ${text}` },
  ).catch(() => {});

await run(async () => {
  await administrator(page);
  const raced = await invite('Raced');
  await invite('Flaky');
  await page.eval('location.reload()');
  await page.waitUntil(() => document.body.innerText.includes('Flaky'), { timeout: 60000, label: 'the invites table' });

  // Answered Conflict, which the browser logs as a failed request.
  expectedFailures.add('/revoke');

  const other = await openBrowser();
  try {
    await register(other.session, raced.token, 'raced.admin', REGISTRANT_PASSWORD);
    await other.session.waitUntil("!location.pathname.startsWith('/register')", { timeout: 90000, label: 'raced.admin registered' });
  } finally {
    other.close();
  }

  await callBack('Raced');
  await rowReads('Raced', USED);
  const used = await row('Raced');
  check('a call back on a link used meanwhile refreshes the row to Used', used?.status.startsWith('Used raced.admin'), JSON.stringify(used));
  check('and its action cell reads that the link has already been used', used?.action === USED, JSON.stringify(used));

  const release = await intercept(page, '*/api/admin/invites/*/revoke', () => ({ status: 500, body: '{}' }));
  try {
    await callBack('Flaky');
    await rowReads('Flaky', FAILED);
  } finally {
    await release();
  }
  const flaky = await row('Flaky');
  check('a call back the server fails says so on the row', flaky?.action.includes(FAILED), JSON.stringify(flaky));
  check('and the row is still Waiting', flaky?.status === 'Waiting', JSON.stringify(flaky));
  check('and the link still works', sql("SELECT status FROM invites WHERE label = 'Flaky'")[0]?.status === 'pending');
}, { signsIn: false });
