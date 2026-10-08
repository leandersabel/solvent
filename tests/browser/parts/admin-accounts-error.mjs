// The Accounts list that would not load (admin-invites.md, Admin,
// States, Accounts). A list the server fails shows the error above
// where the table goes, with a Retry that loads it. A list refused
// because the session ended leaves for the sign-in screen.
import { administrator, check, click, expectedFailures, intercept, page, run, sql } from '../harness.mjs';

const FAILED = 'The account list would not load.';

const reads = (text, label) =>
  page.waitUntil((words) => document.body.innerText.includes(words), { args: [text], timeout: 30000, label }).catch(() => {});

await run(async () => {
  await administrator(page);
  expectedFailures.add('/api/admin/accounts');

  const release = await intercept(page, '*/api/admin/accounts', () => ({ status: 500, body: '{}' }));
  try {
    await click('Accounts');
    await reads(FAILED, 'the list error');
  } finally {
    await release();
  }
  const failed = await page.call(() => ({
    text: document.body.innerText,
    retry: [...document.querySelectorAll('#app button')].some((b) => b.textContent.trim() === 'Retry'),
    table: !!document.querySelector('#app table'),
  }));
  check('a list the server fails says so', failed.text.includes(FAILED));
  check('with a Retry beside it', failed.retry);
  check('and no partial table', !failed.table);

  await click('Retry');
  await reads('ops.leander', 'the accounts table');
  check('Retry loads the list', await page.call(() => !!document.querySelector('#app table')));

  sql('DELETE FROM sessions');
  await click('Accounts');
  await page.waitUntil("location.pathname === '/login'", { timeout: 30000, label: 'the sign-in screen' }).catch(() => {});
  check('a session that ended leaves for the sign-in screen', (await page.eval('location.pathname')) === '/login');
}, { signsIn: false });
