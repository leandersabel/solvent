// The username a password manager pairs with the password on the
// unlock card, written from spec/features/login.md (Unlock, Layout and
// Rules; acceptance criterion 73) and register.md (acceptance criterion
// 40), without reading how the card is built.
//
// Unlocking again, the card holds the known username in one text field
// a person cannot see or reach, before the password, and sign-in never
// reads it: a manager that writes another name there changes nothing.
import {
  BASE, REGISTRANT_PASSWORD, VAULT_PASSWORD, check, click, expectedFailures, intercept, intoVault, mintInvite, openBrowser,
  page, run, setValue, vaultOwner, watched,
} from '../harness.mjs';

const OTHER = 'margrit.keller';

// Every input on the card as a person and a password manager meet it.
const cardFields = (session) =>
  session.eval(`JSON.stringify((() => {
    const password = document.querySelector('input[type=password]');
    const reachable = (i) => {
      const box = i.getBoundingClientRect();
      const style = getComputedStyle(i);
      const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.opacity !== '0' && at === i;
    };
    return {
      password: password && { autocomplete: password.getAttribute('autocomplete') },
      others: [...document.querySelectorAll('input')].filter((i) => i !== password).map((i) => ({
        type: i.getAttribute('type'),
        autocomplete: i.getAttribute('autocomplete'),
        value: i.value,
        before: Boolean(password && i.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING),
        clickable: reachable(i),
      })),
    };
  })())`).then(JSON.parse);

// The inputs Tab lands on, from the top of the page through the card.
const tabStops = async (session) => {
  await session.eval('document.activeElement && document.activeElement.blur()');
  const stops = [];
  for (let i = 0; i < 12; i += 1) {
    await session.key('Tab');
    stops.push(await session.eval(`(() => {
      const a = document.activeElement;
      return a && a.tagName === 'INPUT' ? (a.type === 'password' ? 'password' : 'other') : '';
    })()`));
  }
  return stops;
};

// login.md 73 and register.md 40, on the card `session` shows now.
const usernameField = async (session, label, username) => {
  const fields = await cardFields(session);
  const named = fields.others.filter((f) => f.autocomplete === 'username');
  check(`${label}: the password field asks for current-password`, fields.password?.autocomplete === 'current-password', JSON.stringify(fields));
  check(`${label}: one text field with autocomplete username holds the known username, before the password`,
    named.length === 1 && named[0].type === 'text' && named[0].value === username && named[0].before, JSON.stringify(fields));
  check(`${label}: no input but the password is visible where a person could click it`,
    fields.others.every((f) => !f.clickable), JSON.stringify(fields));
  const stops = await tabStops(session);
  check(`${label}: Tab reaches the password and no other input`,
    stops.includes('password') && !stops.includes('other'), JSON.stringify(stops));
};

// Writes OTHER into the username field as a password manager does,
// unlocks, and returns the usernames the salt and sign-in requests sent.
const unlockWithOtherName = async (session, requests, password) => {
  const from = requests.length;
  await session.call((name) => {
    const field = document.querySelector('input[autocomplete=username]');
    field.value = name;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, OTHER);
  await session.call((secret) => {
    const field = document.querySelector('input[type=password]');
    field.value = secret;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('button[type=submit]').click();
  }, password);
  const opened = await intoVault(session, 'the vault after unlocking with another name in the field');
  const sent = requests.slice(from).filter((r) => r.method === 'POST' && /\/api\/auth\/(salt|login)$/.test(r.url))
    .map((r) => JSON.parse(r.body).username);
  return { opened, sent };
};

const signedInAs = (label, { opened, sent }, username) =>
  check(`${label}: another name written into the field still unlocks, as ${username}`,
    opened && sent.length >= 2 && sent.every((name) => name === username), JSON.stringify({ opened, sent }));

await run(async () => {
  // ---- register.md 40: the card over a new vault waiting to be read ----

  const registrant = await openBrowser();
  const traffic = watched[watched.length - 1].requests;
  try {
    const name = 'registrant.card';
    const s = registrant.session;
    await s.goto(`${BASE}/register?invite=${mintInvite('vault-owner')}`);
    await s.call((username, password) => {
      const set = (selector, value, index = 0) => {
        const node = document.querySelectorAll(selector)[index];
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('input[type=text]', username);
      set('input[type=password]', password, 0);
      set('input[type=password]', password, 1);
      set('select', 'CHF');
      const box = document.querySelector('input[type=checkbox]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }, name, REGISTRANT_PASSWORD);
    await s.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
    const release = await intercept(s, '*/api/records?type=*', () => ({ status: 503 }));
    await s.eval("document.querySelector('button[type=submit]').click()");
    await s.waitUntil("document.body.innerText.includes('Your vault is created')", { timeout: 90000, label: 'the unread new vault' });
    await s.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    await s.waitUntil("document.querySelector('input[type=password]')", { label: 'the card over the unread vault' });
    await release();
    await usernameField(s, 'the card over a new vault waiting to be read', name);
    signedInAs('the card over a new vault', await unlockWithOtherName(s, traffic, REGISTRANT_PASSWORD), name);
  } finally {
    registrant.close();
  }

  // ---- login.md 73: the card's modes on a vault owner's page -----------

  const fresh = await openBrowser();
  try {
    await fresh.session.goto(`${BASE}/login`);
    await fresh.session.waitUntil("document.querySelector('input[type=password]')", { label: 'the sign-in card' });
    const fields = await cardFields(fresh.session);
    const user = fields.others.filter((f) => f.autocomplete === 'username');
    check('signing in, one username field a person can click asks for username and the password for current-password',
      fields.password?.autocomplete === 'current-password' && user.length === 1 && user[0].clickable, JSON.stringify(fields));
  } finally {
    fresh.close();
  }

  await vaultOwner();
  const requests = watched[0].requests;

  await click('Lock');
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the card after Lock' });
  await usernameField(page, 'after Lock', 'leander');
  signedInAs('after Lock', await unlockWithOtherName(page, requests, VAULT_PASSWORD), 'leander');

  await page.goto(`${BASE}/dashboard`);
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the card after a reload' });
  await usernameField(page, 'after a reload', 'leander');
  signedInAs('after a reload', await unlockWithOtherName(page, requests, VAULT_PASSWORD), 'leander');

  // A session that ran out: the sign-in starts from cold, so a card that
  // read the field would sign in as the name written there.
  await page.eval("fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' }, body: '{}' })");
  expectedFailures.add('/api/records');
  await page.eval("document.dispatchEvent(new Event('visibilitychange'))");
  await page.waitUntil("document.querySelector('#unlock-password')", { timeout: 20000, label: 'the card after the session ran out' });
  await usernameField(page, 'after the session ran out', 'leander');
  signedInAs('after the session ran out', await unlockWithOtherName(page, requests, VAULT_PASSWORD), 'leander');
  expectedFailures.delete('/api/records');
});
