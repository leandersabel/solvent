// Reviewer's part for issue #453, written from spec/features/admin-invites.md
// (Admin, States: the paragraph on a request refused because the session
// ended, and Accounts, "Error, list failed"; criterion 62), blind to the
// change. An account list the server fails, or never answers, reads "The
// account list would not load." where the table goes, with no row of a
// table and a Retry that asks again and loads it. A request refused
// because the session ended, by its time limit or by a password change in
// another session of the same administrator, takes the page to the
// sign-in screen: opening Accounts, pressing Retry, and creating an invite.
import {
  ADMIN_PASSWORD, BASE, NEW_PASSWORD, SECOND_PASSWORD, administrator, check, click, expectedFailures, intercept,
  mintInvite, openBrowser, page, register, run, setValue, signInOn, sql,
} from '../harness.mjs';

const FAILED = 'The account list would not load.';
const CARD = 'same bar as anybody';
const SIGN_IN = "location.pathname === '/login' && Boolean(document.querySelector('#unlock-password'))";

const inAdmin = (session, label) =>
  session.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
    timeout: 90000,
    label,
  });

// What Accounts shows: whether the failure line and a Retry are drawn,
// and the text of every table row drawn on screen.
const accounts = () =>
  page.call((words) => {
    const drawn = (node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const line = [...document.querySelectorAll('#app *')].find((node) =>
      [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.includes(words)));
    const retry = [...document.querySelectorAll('#app button')].find((b) => b.textContent.trim() === 'Retry');
    return {
      line: Boolean(line && drawn(line)),
      retry: Boolean(retry && drawn(retry)),
      rows: [...document.querySelectorAll('#app tr')].filter((tr) => tr.querySelector('td') && drawn(tr)).map((tr) => tr.innerText),
    };
  }, FAILED);

const showsFailure = () =>
  page.holds((words) => document.body.innerText.includes(words), { args: [FAILED], timeout: 30000, label: 'the failure line' });

const showsOwnRow = () =>
  page.holds(
    () => [...document.querySelectorAll('#app td')].some((td) => td.textContent.trim() === 'ops.leander'),
    { timeout: 30000, label: 'the account list' },
  );

const reachesSignIn = () => page.holds(SIGN_IN, { timeout: 30000, label: 'the sign-in screen' });

// Ends every session of `username` by its time limit, the way twelve
// hours past its issue would.
const expire = (username) =>
  sql(
    "UPDATE sessions SET issued_at = '2000-01-01T00:00:00+00:00' WHERE principal_id = (SELECT id FROM principals WHERE username = ?)",
    username,
  );

const signInAgain = async (password, username) => {
  await page.goto(`${BASE}/login`);
  await signInOn(page, password, username);
  await inAdmin(page, `${username} back in the admin area`);
};

// The account list answered with `answer` while `body` runs, counting
// the times it is asked for.
const failingList = async (answer, body) => {
  const asked = { count: 0 };
  const stop = await intercept(page, '*/api/admin/accounts*', (request) => {
    if (request.method !== 'GET') return null;
    asked.count += 1;
    return answer;
  });
  try {
    await body(asked);
  } finally {
    await stop();
  }
};

const outcomes = [
  ['a Server Error', { status: 500, body: '{}' }],
  ['a dropped connection', { drop: true }],
];

await run(async () => {
  await administrator();
  // Every refusal below is provoked, and the browser logs each.
  expectedFailures.add('/api/admin/');

  for (const [how, answer] of outcomes) {
    await failingList(answer, async (asked) => {
      await page.eval('location.reload()');
      await inAdmin(page, 'the admin area');
      await click('Accounts');
      check(`an account list failed with ${how} reads "${FAILED}"`, await showsFailure());
      const failed = await accounts();
      check(`it is drawn with a Retry beside it`, failed.line && failed.retry, JSON.stringify(failed));
      check(`and no table row is drawn, skeleton or partial`, failed.rows.length === 0, JSON.stringify(failed.rows));

      const before = asked.count;
      await click('Retry');
      await page.idle();
      const again = await accounts();
      check(`a Retry that fails again asks for the list once more`, asked.count === before + 1, `${before} then ${asked.count}`);
      check(`and still reads the failure with a Retry and no rows`, again.line && again.retry && again.rows.length === 0, JSON.stringify(again));
    });
    await click('Retry');
    check(`after ${how}, a Retry the server answers loads the list`, await showsOwnRow());
    const loaded = await accounts();
    check(`and the failure line and Retry are gone`, !loaded.line && !loaded.retry, JSON.stringify(loaded));
  }

  // The time limit, then opening Accounts.
  await click('Invites');
  // Invites has loaded before the session ends, so only the step after it
  // is refused.
  await page.idle();
  expire('ops.leander');
  await click('Accounts');
  check('with the session past its time limit, opening Accounts goes to the sign-in screen', await reachesSignIn());

  // The time limit, then Retry on a list that had failed.
  await signInAgain(ADMIN_PASSWORD, 'ops.leander');
  await failingList({ status: 500, body: '{}' }, async () => {
    await click('Accounts');
    await showsFailure();
  });
  await page.idle();
  expire('ops.leander');
  await click('Retry');
  check('with the session past its time limit, Retry goes to the sign-in screen', await reachesSignIn());

  // The time limit, then a request that is not the list.
  await signInAgain(ADMIN_PASSWORD, 'ops.leander');
  await click('Invites');
  await page.idle();
  expire('ops.leander');
  await setValue('input[type=text]', 'After the limit');
  await click('Create invite link');
  check('with the session past its time limit, creating an invite goes to the sign-in screen', await reachesSignIn());
  check('and no invite was made', sql("SELECT id FROM invites WHERE label = 'After the limit'").length === 0);

  // A password change in another session of the same administrator,
  // then opening Accounts. A second administrator, so ops.leander keeps
  // the password tests/test_browser.py checks its verifier against.
  await register(page, mintInvite('administrator'), 'ops.second', SECOND_PASSWORD);
  await inAdmin(page, 'the second administrator');
  const { session: other, close } = await openBrowser(`${BASE}/login`);
  try {
    await signInOn(other, SECOND_PASSWORD, 'ops.second');
    await inAdmin(other, 'the second administrator in another browser');
    await other.call(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === 'Your password').click());
    await other.waitUntil((words) => document.body.innerText.includes(words), { args: [CARD], label: 'the password card' });
    await other.call((words, currentValue, nextValue) => {
      const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
      const set = (node, value) => {
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(card.querySelector('input[autocomplete=current-password]'), currentValue);
      for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
    }, CARD, SECOND_PASSWORD, NEW_PASSWORD);
    await other.waitUntil(
      (words) => ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled,
      { args: [CARD], label: 'the strength gauge' },
    );
    await other.call((words) => {
      [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click();
    }, CARD);
    await other.waitUntil("document.body.innerText.includes('Your password is changed.')", { timeout: 90000, label: 'the changed password' });
  } finally {
    close();
  }
  // Invites is open, and switching to it would send a request of its own.
  await click('Accounts');
  check('with the session ended by a password change in another session, opening Accounts goes to the sign-in screen', await reachesSignIn());
});
