// Both registration forms when the derivation's worker does not load,
// written from spec/features/register.md (Register, States, "Error, the
// submit did not go through"; In the browser; acceptance criterion 46)
// and architecture.md, Key management ("The worker loads on the first
// derivation of a page"), without reading how the forms are built.
//
// The worker's script, or the module it imports, is made to fail the
// ways a network and a proxy fail it. Each form must say the submit did
// not go through, send nothing, keep every field, and on the next press
// in the same page load the worker again and register.
import {
  ADMIN_PASSWORD, BASE, BOOTSTRAP, VAULT_PASSWORD, check, fetchOff, fetchOn, intoVault, isRateAsk, mintInvite, page,
  provoked, run,
} from '../harness.mjs';

const OUTAGE = 'That did not go through. Everything you typed is still here, so you can try again.';
const WORKER = '/static/js/kdf-worker.js';
const IMPORTED = '/static/vendor/argon2id/';
const PROXY_PAGE = '<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>';
const WAYS = [
  ['the worker script getting no answer', WORKER, null],
  ['the worker script getting a proxy\'s Bad Gateway', WORKER, { status: 502, type: 'text/html', body: PROXY_PAGE }],
  ['the worker script getting a Server Error', WORKER, { status: 500, type: 'text/html', body: '<!doctype html><title>500</title>' }],
  ['the module the worker imports getting no answer', IMPORTED, null],
];

// Every request of the page: what reached the server, and the worker's
// script each time it was asked for.
const requests = [];
page.on((message) => {
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request);
});
const registrations = () => requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/register')).length;
const workerAsks = () => requests.filter((r) => new URL(r.url).pathname === WORKER).length;

// Every request whose path starts with `path` fails `way` until lifted.
// `seen` counts what it failed, which covers what the page's worker
// imports too.
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

// The form filled as a person would, every field and the box, and
// submitted once its button unlocks.
const fill = (username, password) =>
  page.call((name, secret) => {
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(document.querySelector('input[type=text]'), name);
    set(document.querySelectorAll('input[type=password]')[0], secret);
    set(document.querySelectorAll('input[type=password]')[1], secret);
    const select = document.querySelector('select');
    if (select) set(select, 'EUR');
    const box = document.querySelector('input[type=checkbox]');
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, username, password);
const press = async () => {
  await page.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
  await page.eval("document.querySelector('button[type=submit]').click()");
};

// What the form shows and holds.
const formState = () =>
  page.eval(`JSON.stringify({
    path: location.pathname,
    text: document.body.innerText,
    username: document.querySelector('input[type=text]')?.value ?? null,
    passwords: [...document.querySelectorAll('input[type=password]')].map((n) => n.value),
    currency: document.querySelector('select')?.value ?? null,
    box: document.querySelector('input[type=checkbox]')?.checked ?? null,
    button: document.querySelector('button[type=submit]') ? {
      text: document.querySelector('button[type=submit]').textContent.replace(/\\s+/g, ' ').trim(),
      disabled: document.querySelector('button[type=submit]').disabled,
    } : null,
  })`).then(JSON.parse);

// Waits for the outage copy, without throwing, so a hang is one failed check.
const saysOutage = () =>
  page.waitUntil((copy) => document.body.innerText.includes(copy), { args: [OUTAGE], timeout: 60000, label: 'the outage message' })
    .then(() => true, () => false);

// One form, failed each way from a fresh page, then registered by
// pressing again in the page of the last failure.
const form = async (kind, invite, username, password, landed) => {
  const vault = kind === 'vault';
  for (const [index, [way, path, answer]] of WAYS.entries()) {
    const label = `the ${kind} form, ${way}`;
    await page.goto(`${BASE}/register?invite=${invite}`);
    await page.waitUntil("document.querySelector('input[type=text]')", { label: 'the form' });
    const failed = await outage(path, answer);
    const sentBefore = registrations();
    await fill(username, password);
    await press();
    const said = await saysOutage();
    const state = await formState();
    check(`${label}: the failing request was made`, failed.seen > 0, `${failed.seen} seen`);
    check(`${label}: the form says the submit did not go through`, said, state.text.slice(0, 400));
    check(`${label}: the message is the only form-level error`,
      !/did not accept|not enough memory|cannot run the encryption|is created/i.test(state.text), state.text.slice(0, 400));
    check(`${label}: nothing is sent`, registrations() === sentBefore, `${registrations() - sentBefore} sent`);
    check(`${label}: the page did not move`, state.path === '/register', state.path);
    check(`${label}: the username is kept`, state.username === username, String(state.username));
    check(`${label}: both passwords are kept`, state.passwords.length === 2 && state.passwords.every((p) => p === password));
    if (vault) check(`${label}: the main currency and the box are kept`, state.currency === 'EUR' && state.box === true, JSON.stringify([state.currency, state.box]));
    check(`${label}: the button is ready to try again, out of its working state`,
      state.button && !state.button.disabled && !/Setting up|Creating your account/.test(state.button.text), JSON.stringify(state.button));
    if (index < WAYS.length - 1) {
      await failed.lift();
      continue;
    }
    // Solvent is back: the same page, the same fields, pressed again.
    await failed.lift();
    const asksBefore = workerAsks();
    await press();
    const arrived = await landed();
    check(`the ${kind} form, pressed again in the same page, loads the worker again`, workerAsks() > asksBefore,
      `${workerAsks() - asksBefore} asks`);
    check(`the ${kind} form, pressed again in the same page, sends the registration and lands`,
      arrived && registrations() === sentBefore + 1, `${registrations() - sentBefore} sent, landed ${arrived}`);
  }
};

await run(async () => {
  await form('administrator', BOOTSTRAP, 'ops.leander', ADMIN_PASSWORD, () =>
    page.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')",
      { timeout: 90000, label: 'the admin area' }).then(() => true, () => false));
  await page.send('Network.clearBrowserCookies');
  await form('vault', mintInvite('vault-owner'), 'leander', VAULT_PASSWORD, () => intoVault(page, 'the new vault'));
}, { signsIn: false });
