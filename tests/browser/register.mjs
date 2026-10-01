// The registration forms against stubbed answers
// (spec/ui/register.md, The username field and States;
// spec/features/register.md, In the browser).
//
// Every answer to POST /api/register is made here, so no invite is
// consumed and each case reloads the same link. Run by
// tests/test_register_browser.py, which starts the server and mints
// one invite of each kind.
import { launch, Session } from './cdp.mjs';

const BASE = process.env.SOLVENT_BASE;
const INVITES = { vault: process.env.SOLVENT_VAULT_INVITE, admin: process.env.SOLVENT_ADMIN_INVITE };
const PASSWORD = 'harbour crescent tundra oblige';

const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail: String(detail) });

const { child, target } = await launch();
const page = await Session.connect(target);
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Network.enable');

// How many times a page started the derivation's worker, which it does
// on its first derivation and not before.
await page.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__workers = 0;
    const Original = window.Worker;
    window.__derivations = 0;
    // With __fail set, the worker answers as one that cannot derive:
    // 'memory' as a refused allocation, anything else as no WebAssembly.
    window.Worker = class extends Original {
      constructor(...args) { window.__workers++; super(...args); }
      postMessage(message, ...rest) {
        window.__derivations++;
        if (!window.__fail) return super.postMessage(message, ...rest);
        const data = { id: message.id, ok: false, outOfMemory: window.__fail === 'memory', message: 'refused' };
        setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data })), 10);
      }
    };`,
});

const posts = [];
page.on((message) => {
  if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST') {
    posts.push(message.params.request);
  }
});

// The answer the next POST /api/register gets.
let answer = null;
page.on(async (message) => {
  if (message.method !== 'Fetch.requestPaused') return;
  const { requestId } = message.params;
  if (!answer) {
    await page.send('Fetch.continueRequest', { requestId });
  } else if (answer.drop) {
    await page.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' });
  } else {
    await page.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: answer.status,
      responseHeaders: [{ name: 'Content-Type', value: answer.type ?? 'application/json' }],
      body: Buffer.from(answer.body ?? '').toString('base64'),
    });
  }
});
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/register', requestStage: 'Request' }] });

const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const text = () => page.eval('document.body.innerText');
const open = async (which) => {
  await page.goto(`${BASE}/register?invite=${INVITES[which]}`);
  await page.waitUntil(q('input[type=text]'), { label: 'the form' });
};
const type = (selector, value, index = 0) =>
  page.eval(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    el.focus();
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
const leave = () => page.eval(`${q('input[type=text]')}.blur()`);
const line = () => page.eval(`document.getElementById(${q('input[type=text]')}.getAttribute('aria-describedby')).textContent`);
const lineClass = () => page.eval(`document.getElementById(${q('input[type=text]')}.getAttribute('aria-describedby')).className`);
const disabled = () => page.eval(`${q('button[type=submit]')}.disabled`);
const workers = () => page.eval('window.__workers');
const fillRest = async (vault) => {
  await type('input[type=password]', PASSWORD, 0);
  await type('input[type=password]', PASSWORD, 1);
  if (vault) {
    await page.eval(`(() => { const box = ${q('input[type=checkbox]')}; box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  await page.settle(300);
};
// Enter pressed in each field of the form in turn, then how much was
// derived and sent.
const enterEverywhere = async () => {
  const fields = await page.eval(`document.querySelectorAll('form input').length`);
  for (let index = 0; index < fields; index++) {
    await page.eval(`document.querySelectorAll('form input')[${index}].focus()`);
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
    }
  }
  await page.settle(500);
  return { fields, derived: await page.eval('window.__derivations'), workers: await workers(), sent: posts.length };
};

const HINT = 'Use 3 to 32 characters: letters a to z, digits, dot, underscore or hyphen.';
const NOT_ALLOWED = 'Only letters a to z, digits, dot, underscore and hyphen are allowed.';

try {
  // ---- The username field, on the vault form ----------------------
  await open('vault');
  const attributes = await page.eval(`(() => {
    const input = ${q('input[type=text]')};
    return JSON.stringify(['autocapitalize', 'autocorrect', 'spellcheck', 'autocomplete', 'maxlength', 'aria-invalid'].map((n) => input.getAttribute(n)));
  })()`);
  check('the field is told not to capitalize or correct, and has no maxlength', attributes === JSON.stringify(['none', 'off', 'false', 'username', null, null]), attributes);
  check('the line starts as the hint', (await line()) === HINT && (await lineClass()) === 'hint');
  check('the line is a polite live region', (await page.eval(`document.getElementById(${q('input[type=text]')}.getAttribute('aria-describedby')).getAttribute('aria-live')`)) === 'polite');

  await fillRest(true);
  await type('input[type=text]', 'Bo b!');
  check('the field lowercases as it is typed', (await page.eval(`${q('input[type=text]')}.value`)) === 'bo b!');
  check('Bo b! is reported on its own line at once, as an error', (await line()) === NOT_ALLOWED && (await lineClass()) === 'field-error');
  check('the input is marked invalid while it is an error', (await page.eval(`${q('input[type=text]')}.getAttribute('aria-invalid')`)) === 'true');
  check('the button stays disabled with everything else valid', await disabled());
  const pressed = await enterEverywhere();
  check(
    'Enter in each field derives nothing and sends nothing while the button is disabled',
    pressed.fields >= 4 && pressed.derived === 0 && pressed.workers === 0 && pressed.sent === 0,
    JSON.stringify(pressed),
  );
  check('no network wording appears', !(await text()).includes('did not go through'));

  await type('input[type=text]', 'a'.repeat(33));
  check('a 33rd character is reported and kept in the field', (await line()) === 'That is more than 32 characters.' && (await page.eval(`${q('input[type=text]')}.value.length`)) === 33);
  await type('input[type=text]', 'ab');
  check('two characters are not an error until the field is left', (await line()) === HINT);
  await leave();
  check('two characters are reported when the field is left', (await line()) === 'Use at least 3 characters.');
  await type('input[type=text]', 'abc');
  check('the error clears the moment the value fits', (await line()) === HINT && !(await disabled()));
  await type('input[type=text]', '');
  await leave();
  check('an empty field keeps the hint on blur, with the button held', (await line()) === HINT && (await disabled()));

  // ---- Every answer, each with its own message --------------------
  const NETWORK = 'That did not go through. Everything you typed is still here, so you can try again.';
  const refusal = (what) => `Solvent did not accept this registration. No ${what} was created and your invite link is still unused. If this happens again, ask whoever sent you the invite.`;
  const cases = [
    ['refused username', { status: 400, body: '{"refused":"username"}' }, 'user', `This username was not accepted. ${HINT}`],
    ['Conflict', { status: 409, body: '{}' }, 'user', 'That username is taken.'],
    ['Bad Request without a reason', { status: 400, body: '{}' }, 'form', refusal('vault')],
    ['Bad Request that is not JSON', { status: 400, type: 'text/html', body: '<h1>Bad Request</h1>' }, 'form', refusal('vault')],
    ['Content Too Large', { status: 413, body: '{}' }, 'form', refusal('vault')],
    ['Server Error', { status: 500, body: '{}' }, 'form', NETWORK],
    ['Service Unavailable', { status: 503, type: 'text/html', body: 'down' }, 'form', NETWORK],
    ['a dropped connection', { drop: true }, 'form', NETWORK],
  ];
  const others = (expected) => [
    refusal('vault'), refusal('account'), NETWORK, 'That username is taken.', 'This username was not accepted.', 'This invite link is not valid.',
  ].filter((message) => !expected.includes(message) && !message.startsWith(expected.slice(0, 20)));

  for (const [name, stub, where, expected] of cases) {
    await open('vault');
    await fillRest(true);
    await type('input[type=text]', '  Bob  ');
    answer = stub;
    posts.length = 0;
    await page.eval(`${q('button[type=submit]')}.click()`);
    await page.waitUntil(`document.body.innerText.includes(${JSON.stringify(expected)})`, { label: name });
    await page.settle(200);
    const shown = await text();
    check(`${name} shows its own message`, others(expected).every((message) => !shown.includes(message)), shown);
    check(`${name}: the message is where the spec puts it`, where === 'user' ? (await line()).startsWith(expected.slice(0, 20)) : !(await line()).startsWith('That username') && (await line()) === HINT, await line());
    check(`${name}: every field keeps its value and the button works again`,
      (await page.eval(`JSON.stringify([${q('input[type=text]')}.value, ${q('input[type=password]')}.value, document.querySelectorAll('input[type=password]')[1].value])`)) === JSON.stringify(['  bob  ', PASSWORD, PASSWORD]) && !(await disabled()));
    check(
      `${name}: the one request carried the checked, trimmed username`,
      posts.length === 1 && JSON.parse(posts[0].postData ?? '{}').username === 'bob',
      JSON.stringify(posts.map((post) => post.postData)),
    );
    if (where === 'user') {
      await type('input[type=text]', 'bobb');
      check(`${name}: editing the username returns the line to the hint`, (await line()) === HINT);
    }
  }

  await open('vault');
  await fillRest(true);
  await type('input[type=text]', 'Bob');
  answer = { status: 400, body: '{"refused":"invite"}' };
  await page.eval(`${q('button[type=submit]')}.click()`);
  await page.waitUntil(`document.body.innerText.includes('This invite link is not valid.')`, { label: 'the invite card' });
  check('a refused invite gives way to the bare card with no form', !(await page.eval(q('form') + ' !== null')) && (await page.eval(`document.querySelectorAll('.card-heading').length`)) === 1);

  // ---- A browser that cannot derive -------------------------------
  const MEMORY = (what) => `This device does not have enough memory available right now. No ${what} was created and your invite link is still good. Close some other tabs and try again.`;
  const tryAgain = `[...document.querySelectorAll('form button')].find((b) => b.textContent === 'Try again' && !b.hidden)`;
  for (const [which, what] of [['vault', 'vault'], ['admin', 'account']]) {
    await open(which);
    await fillRest(which === 'vault');
    await type('input[type=text]', 'Bob');
    await page.eval("window.__fail = 'memory'");
    posts.length = 0;
    await page.eval(`${q('button[type=submit]')}.click()`);
    await page.waitUntil(`document.body.innerText.includes(${JSON.stringify(MEMORY(what))})`, { label: `not enough memory, ${which}` });
    await page.settle(200);
    check(`${which}: not enough memory names the moment and offers Try again`, await page.eval(`Boolean(${tryAgain})`));
    check(`${which}: not enough memory sent nothing, kept the fields and left the button usable`,
      posts.length === 0 && (await page.eval(`${q('input[type=password]')}.value`)) === PASSWORD && !(await disabled()));
    await page.eval(`${tryAgain}.click()`);
    await page.waitUntil('window.__derivations === 2', { label: 'Try again deriving again' });
    await page.settle(200);
    check(`${which}: Try again derives again`, (await page.eval('window.__derivations')) === 2 && posts.length === 0);
  }

  await open('vault');
  await fillRest(true);
  await type('input[type=text]', 'Bob');
  await page.eval("window.__fail = 'unsupported'");
  posts.length = 0;
  await page.eval(`${q('button[type=submit]')}.click()`);
  const STOP = 'This browser cannot run the encryption Solvent needs. There is no weaker fallback.';
  await page.waitUntil(`document.body.innerText.includes(${JSON.stringify(STOP)})`, { label: 'the hard stop' });
  check('a browser that cannot run the encryption gets a hard stop with no form, no retry and no request',
    !(await page.eval(`${q('form')} !== null`)) && !(await page.eval(`${q('button')} !== null`)) && posts.length === 0 && !(await text()).includes('did not go through'));

  // ---- The administrator form -------------------------------------
  await open('admin');
  await fillRest(false);
  await type('input[type=text]', 'Bo b!');
  check('on the administrator form the same line reports Bo b! and holds the button', (await line()) === NOT_ALLOWED && (await disabled()));
  const adminPressed = await enterEverywhere();
  check(
    'Enter in each field of the administrator form derives nothing and sends nothing',
    adminPressed.fields >= 3 && adminPressed.derived === 0 && adminPressed.workers === 0 && adminPressed.sent === 0,
    JSON.stringify(adminPressed),
  );
  await type('input[type=text]', 'Bob');
  answer = { status: 400, body: '{}' };
  await page.eval(`${q('button[type=submit]')}.click()`);
  await page.waitUntil(`document.body.innerText.includes('No account was created')`, { label: 'the administrator refusal' });
  check('the administrator form words the refusal for an account', (await text()).includes(refusal('account')));
} catch (error) {
  check('the checks ran to the end', false, error.message);
} finally {
  for (const { name, ok, detail } of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : ''}`);
  child.kill();
  process.exitCode = checks.some((c) => !c.ok) ? 1 : 0;
}
