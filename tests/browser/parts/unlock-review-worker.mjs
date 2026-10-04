// The sign-in card when the derivation's worker does not load, written
// from spec/features/login.md (Unlock, States, "The attempt did not go
// through"; acceptance criteria 17 and 74) and architecture.md, Key
// management ("The worker loads on the first derivation of a page"),
// without reading how the card is built.
//
// From a fresh page, so the worker has not loaded yet, its script or
// the module it imports fails. The card must say the attempt did not go
// through, keep both fields, send no sign-in and hold no key, read the
// same for a vault owner, an administrator and a name nobody has, and
// Unlock in the same page must then sign in.
import {
  ADMIN_PASSWORD, BASE, VAULT_PASSWORD, administrator, check, enterPasswordOn, fetchOff, fetchOn, intoVault, isRateAsk,
  page, provoked, run, signInOn, vaultOwner,
} from '../harness.mjs';

const OUTAGE = 'That did not go through. Everything you typed is still here, so you can try again.';
const WRONG = 'Invalid username or password.';
const WORKER = '/static/js/kdf-worker.js';
const IMPORTED = '/static/vendor/argon2id/';
const NAMES = [
  ['a vault owner', 'leander', VAULT_PASSWORD],
  ['an administrator', 'ops.leander', ADMIN_PASSWORD],
  ['a name nobody has', 'margrit.keller', VAULT_PASSWORD],
];
const WAYS = [
  ['the worker script getting no answer', WORKER, null],
  ['the worker script getting a proxy\'s Bad Gateway', WORKER, { status: 502, type: 'text/html', body: '<h1>502 Bad Gateway</h1>' }],
  ['the module the worker imports getting no answer', IMPORTED, null],
];

const requests = [];
page.on((message) => {
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request);
});
const signIns = () => requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/auth/login')).length;

// Every request whose path starts with `path` fails `way` until lifted.
const outage = async (path, way) => {
  const failed = { seen: 0 };
  const handler = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (isRateAsk(page, request)) return;
    if (!new URL(request.url).pathname.startsWith(path)) {
      await page.send('Fetch.continueRequest', { requestId });
      return;
    }
    failed.seen += 1;
    if (!way) {
      await page.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' });
      return;
    }
    await page.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: way.status,
      responseHeaders: [{ name: 'Content-Type', value: way.type }],
      body: Buffer.from(way.body).toString('base64'),
    });
  };
  if (!provoked.includes(path)) provoked.push(path);
  page.on(handler);
  await fetchOn(page, `*${path}*`);
  failed.lift = async () => {
    page.handlers = page.handlers.filter((h) => h !== handler);
    await fetchOff(page);
  };
  return failed;
};

const settled = () =>
  page.waitUntil(
    (outage, wrong) => document.body.innerText.includes(outage) || document.body.innerText.includes(wrong) ||
      !document.querySelector('#unlock-password'),
    { args: [OUTAGE, WRONG], timeout: 60000, label: 'the attempt to settle' },
  ).then(() => true, () => false);

const cardState = () =>
  page.call(async () => {
    const s = await import('/static/js/session.js');
    const button = document.querySelector('button[type=submit]');
    return JSON.stringify({
      path: location.pathname,
      text: document.querySelector('#unlock-password')?.form?.innerText ?? document.body.innerText,
      user: document.querySelector('#unlock-username')?.value ?? null,
      pass: document.querySelector('#unlock-password')?.value ?? null,
      button: button ? { text: button.textContent.replace(/\s+/g, ' ').trim(), disabled: button.disabled } : null,
      keys: s.holdsKeys(),
      vault: s.currentVault() !== null,
    });
  }).then(JSON.parse);

const outageHolds = (label, done, state, username, password, sentBefore) => {
  check(`${label}: the card settles`, done, JSON.stringify(state));
  check(`${label}: the card says the attempt did not go through`, state.text.includes(OUTAGE), state.text.slice(0, 300));
  check(`${label}: the password is never called wrong`, !state.text.includes(WRONG));
  check(`${label}: no sign-in is sent`, signIns() === sentBefore, `${signIns() - sentBefore} sent`);
  check(`${label}: the username is still filled`, username === null || state.user === username, String(state.user));
  check(`${label}: the password is still filled`, state.pass === password);
  check(`${label}: no key and no vault is held`, !state.keys && !state.vault, JSON.stringify(state));
  check(`${label}: Unlock is ready to try again`, state.button && state.button.text === 'Unlock' && !state.button.disabled,
    JSON.stringify(state.button));
};

await run(async () => {
  await administrator();
  await page.send('Network.clearBrowserCookies');
  await vaultOwner();

  // ---- Criterion 74 and the state, from a fresh page -------------------

  for (const [way, path, answer] of WAYS) {
    const seen = {};
    for (const [who, username, password] of NAMES) {
      const label = `a fresh sign-in for ${who}, ${way}`;
      await page.send('Network.clearBrowserCookies');
      await page.goto(`${BASE}/login`);
      const failed = await outage(path, answer);
      const sentBefore = signIns();
      await signInOn(page, password, username);
      const done = await settled();
      const state = await cardState();
      await failed.lift();
      check(`${label}: the failing request was made`, failed.seen > 0);
      outageHolds(label, done, state, username, password, sentBefore);
      seen[who] = JSON.stringify({ text: state.text, button: state.button, path: state.path });
    }
    check(`a fresh sign-in, ${way}, reads the same for a vault owner, an administrator and a stranger`,
      new Set(Object.values(seen)).size === 1, Object.values(seen).join(' | '));
  }

  // Unlock in the same page, once the worker loads.
  await page.send('Network.clearBrowserCookies');
  await page.goto(`${BASE}/login`);
  const failed = await outage(WORKER, null);
  await signInOn(page, VAULT_PASSWORD, 'leander');
  await settled();
  await failed.lift();
  await page.eval("document.querySelector('button[type=submit]').click()");
  check('after the worker did not load, Unlock in the same page opens the vault', await intoVault(page, 'the vault on a retry'));

  // ---- A reloaded page holding a session, which asks for the password --

  await page.goto(`${BASE}/dashboard`);
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card after a reload' });
  const again = await outage(WORKER, null);
  const sentBefore = signIns();
  await enterPasswordOn(page, VAULT_PASSWORD);
  const done = await settled();
  const state = await cardState();
  await again.lift();
  outageHolds('unlocking a reloaded page, the worker script getting no answer', done, state, null, VAULT_PASSWORD, sentBefore);
  await page.eval("document.querySelector('button[type=submit]').click()");
  check('unlocking a reloaded page after the worker did not load opens the vault',
    await page.waitUntil("!document.querySelector('#unlock-password') && document.querySelector('.topbar nav a')",
      { timeout: 90000, label: 'the vault after unlocking again' }).then(() => true, () => false));
});
