// The sign-in card when Solvent cannot be reached, written from
// spec/features/login.md (Unlock, States, "The attempt did not go
// through"; Edge cases, "Solvent cannot be reached mid-sign-in";
// acceptance criteria 15, 16 and 17) and architecture.md, Login
// enumeration, without reading how the card is built.
//
// Each request of a sign-in is made to fail the ways a network and a
// proxy fail it: no answer, Solvent's own Server Error, and a proxy's
// error page. The card must say the attempt did not go through, keep
// what was typed, hold no key, and read the same for a vault owner, an
// administrator and a name nobody has.
import {
  ADMIN_PASSWORD, BASE, VAULT_PASSWORD, administrator, check, fetchOff, fetchOn, intoVault, isRateAsk, page, provoked,
  run, signInOn, vaultOwner,
} from '../harness.mjs';

const OUTAGE = 'That did not go through. Everything you typed is still here, so you can try again.';
const WRONG = 'Invalid username or password.';
const STRANGER = 'margrit.keller';
const WRONG_PASSWORD = 'not the password at all';
const NAMES = [
  ['a vault owner', 'leander', VAULT_PASSWORD],
  ['an administrator', 'ops.leander', ADMIN_PASSWORD],
  ['a name nobody has', STRANGER, VAULT_PASSWORD],
];
const PROXY_PAGE = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>';
const WAYS = [
  ['no answer', null],
  ['a Server Error from Solvent', { status: 500, type: 'text/html; charset=utf-8', body: '<!doctype html><title>500 Internal Server Error</title>' }],
  ['a Server Error with an empty body', { status: 500, type: 'application/json', body: '' }],
  ['a proxy\'s Bad Gateway page', { status: 502, type: 'text/html', body: PROXY_PAGE }],
  ['a proxy\'s Gateway Timeout page', { status: 504, type: 'text/html', body: PROXY_PAGE.replaceAll('502 Bad Gateway', '504 Gateway Time-out') }],
];

// Every request whose path holds `path` fails `way` until the returned
// function is called. `seen` counts the requests it failed.
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

// A sign-in's login response with its wrapper's first byte flipped, so
// the Auth Key verifies and the unwrap fails.
const tamperedWrapper = async () => {
  const handler = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request, responseStatusCode, responseHeaders } = message.params;
    if (isRateAsk(page, request)) return;
    if (responseStatusCode === undefined || !request.url.endsWith('/api/auth/login')) {
      await page.send('Fetch.continueRequest', { requestId });
      return;
    }
    const { body, base64Encoded } = await page.send('Fetch.getResponseBody', { requestId });
    const answer = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString() : body);
    if (answer.wrappedDek) {
      const bytes = Buffer.from(answer.wrappedDek, 'base64');
      bytes[0] ^= 1;
      answer.wrappedDek = bytes.toString('base64');
    }
    await page.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: responseStatusCode,
      responseHeaders,
      body: Buffer.from(JSON.stringify(answer)).toString('base64'),
    });
  };
  page.on(handler);
  await fetchOn(page, '*/api/auth/login*', 'Response');
  return async () => {
    page.handlers = page.handlers.filter((h) => h !== handler);
    await fetchOff(page);
  };
};

// The sign-in card with no session behind it.
const freshCard = async () => {
  await page.send('Network.clearBrowserCookies');
  await page.goto(`${BASE}/login`);
};

// Waits until the attempt has an outcome on screen: either message, or
// the card gone. Never throws, so a hang is one failed check.
const settled = () =>
  page.waitUntil(
    (outage, wrong) => {
      const said = document.body.innerText;
      return said.includes(outage) || said.includes(wrong) || !document.querySelector('#unlock-password');
    },
    { args: [OUTAGE, WRONG], timeout: 90000, label: 'the attempt to settle' },
  ).then(() => true, () => false);

// What the card shows and the page holds: the fields' values, the
// button, whichever message shows and its shape and place, and any key.
const cardState = () =>
  page.call(async (outage, wrong) => {
    const s = await import('/static/js/session.js');
    const shown = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const flat = (n) => n.textContent.replace(/\s+/g, ' ').trim();
    const user = document.querySelector('#unlock-username');
    const pass = document.querySelector('#unlock-password');
    const button = document.querySelector('button[type=submit]');
    // The outermost shown element holding exactly the copy, which is the
    // message with its icon.
    const message = (copy) => {
      const node = [...document.querySelectorAll('body *')].find(
        (n) => shown(n) && flat(n) === copy && !(n.parentElement && flat(n.parentElement) === copy),
      );
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const field = pass ? pass.getBoundingClientRect() : null;
      return {
        tag: node.tagName,
        cls: node.className && node.className.baseVal === undefined ? node.className : '',
        color: getComputedStyle(node).color,
        icon: node.querySelectorAll('svg, img, [class*=icon]').length > 0 || !['none', 'normal'].includes(getComputedStyle(node, '::before').content),
        above: field ? box.bottom <= field.top + 1 : false,
        gap: field ? Math.round(field.top - box.bottom) : null,
        live: Boolean(node.closest('[role=alert], [aria-live]')),
      };
    };
    return JSON.stringify({
      path: location.pathname,
      user: user ? user.value : null,
      pass: pass ? pass.value : null,
      card: Boolean(pass),
      button: button ? { text: flat(button), disabled: button.disabled } : null,
      outage: message(outage),
      wrong: message(wrong),
      cardText: pass && pass.form ? pass.form.innerText : '',
      keys: s.holdsKeys(),
      vault: s.currentVault() !== null,
    });
  }, OUTAGE, WRONG).then(JSON.parse);

// The checks every failed attempt answers to.
const outageHolds = (label, state, username, password) => {
  check(`${label}: the card says the attempt did not go through`, state.outage !== null, JSON.stringify(state));
  check(`${label}: the card never calls the password wrong`, state.wrong === null, JSON.stringify(state.wrong));
  check(`${label}: the username is still filled`, username === null || state.user === username, String(state.user));
  check(`${label}: the password is still filled`, state.pass === password, state.pass === null ? 'no field' : 'emptied or changed');
  check(`${label}: no key and no vault is held`, !state.keys && !state.vault, JSON.stringify({ keys: state.keys, vault: state.vault }));
  check(`${label}: Unlock is ready to try again`, state.button && state.button.text === 'Unlock' && !state.button.disabled, JSON.stringify(state.button));
};

// One attempt as `username` with `password`, through `path` failed
// `way`, from a fresh card. Returns the card it leaves.
const failedAttempt = async (path, way, username, password) => {
  await freshCard();
  const failed = await outage(path, way);
  await signInOn(page, password, username);
  const done = await settled();
  const state = await cardState();
  await failed.lift();
  return { done, state, reached: failed.seen > 0 };
};

await run(async () => {
  await administrator();
  await page.send('Network.clearBrowserCookies');
  await vaultOwner();

  // ---- Criterion 15: the wrong-password message, for its place --------

  // The refusals below are the server answering correctly.
  provoked.push('/api/auth/login');
  const wrongFor = {};
  for (const [who, username] of NAMES) {
    await freshCard();
    await signInOn(page, WRONG_PASSWORD, username);
    await settled();
    wrongFor[who] = await cardState();
  }
  const wrongShapes = Object.values(wrongFor).map((s) => JSON.stringify(s.wrong));
  check('a wrong password shows "Invalid username or password." for every name',
    Object.values(wrongFor).every((s) => s.wrong !== null && s.outage === null), JSON.stringify(wrongShapes));
  check('the wrong-password message has one shape and place for both kinds and a stranger',
    new Set(wrongShapes).size === 1, wrongShapes.join(' | '));
  const wrongShape = wrongFor['a vault owner'].wrong;

  // ---- Criterion 17: the salt lookup and the sign-in ------------------

  for (const [path, step] of [['/api/auth/salt', 'the salt lookup'], ['/api/auth/login', 'the sign-in']]) {
    for (const [way, answer] of WAYS) {
      const seen = {};
      for (const [who, username, password] of NAMES) {
        const label = `${step} getting ${way}, for ${who}`;
        const { done, state, reached } = await failedAttempt(path, answer, username, password);
        check(`${label}: the request was sent and failed`, reached);
        check(`${label}: the card settles`, done);
        check(`${label}: the card stays at the sign-in address`, state.path === '/login', state.path);
        outageHolds(label, state, username, password);
        check(`${label}: the message sits where the wrong-password message does, in its shape`,
          state.outage !== null && wrongShape !== null &&
            ['tag', 'cls', 'color', 'icon', 'above', 'gap', 'live'].every((k) => state.outage[k] === wrongShape[k]),
          JSON.stringify({ outage: state.outage, wrong: wrongShape }));
        seen[who] = JSON.stringify({ outage: state.outage, cardText: state.cardText, button: state.button, path: state.path });
      }
      check(`${step} getting ${way} reads the same for a vault owner, an administrator and a stranger`,
        new Set(Object.values(seen)).size === 1, Object.values(seen).join(' | '));
    }

    // Unlock tries again, with nothing retyped.
    for (const [who, username, password] of NAMES) {
      const { state } = await failedAttempt(path, null, username, password);
      check(`after ${step} got no answer for ${who}, the fields are still filled to try again`,
        state.user === username && state.pass === password);
      await page.eval("document.querySelector('button[type=submit]').click()");
      if (username === 'leander') {
        check(`after ${step} got no answer, Unlock opens ${who}'s vault`, await intoVault(page, 'the vault on a retry'));
      } else if (username === 'ops.leander') {
        check(`after ${step} got no answer, Unlock signs ${who} in to the admin area`,
          await page.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')",
            { timeout: 90000, label: 'the admin area on a retry' }).then(() => true, () => false));
      } else {
        await page.waitUntil((wrong) => document.body.innerText.includes(wrong), { args: [WRONG], timeout: 90000, label: 'the refusal' })
          .catch(() => {});
        const after = await cardState();
        check(`after ${step} got no answer, Unlock tells ${who} the name or password is wrong`,
          after.wrong !== null && after.outage === null, JSON.stringify(after));
      }
    }
  }

  // ---- Criterion 17: the vault read after a correct password ----------

  for (const [way, answer] of [...WAYS, ['a Server Error with a JSON body', { status: 500, type: 'application/json', body: '{}' }]]) {
    const label = `the vault read getting ${way} after a correct password`;
    const { done, state, reached } = await failedAttempt('/api/records', answer, 'leander', VAULT_PASSWORD);
    check(`${label}: the read was sent and failed`, reached);
    check(`${label}: the card settles`, done);
    check(`${label}: the card is still showing`, state.card, JSON.stringify(state));
    outageHolds(label, state, 'leander', VAULT_PASSWORD);
  }
  // Unlock tries again once the read answers.
  {
    const { state } = await failedAttempt('/api/records', { status: 500, type: 'application/json', body: '' }, 'leander', VAULT_PASSWORD);
    check('after the vault read failed, both fields are still filled', state.user === 'leander' && state.pass === VAULT_PASSWORD,
      JSON.stringify({ user: state.user, pass: state.pass === VAULT_PASSWORD }));
    await page.eval("document.querySelector('button[type=submit]').click()");
    check('after the vault read failed, Unlock opens the vault', await intoVault(page, 'the vault after a failed read'));
  }

  // ---- Unlocking again on a live session ------------------------------

  await page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Lock').click()");
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the card after Lock' });
  for (const [path, step] of [['/api/auth/salt', 'the salt lookup'], ['/api/auth/login', 'the sign-in'], ['/api/records', 'the vault read']]) {
    for (const [way, answer] of [WAYS[0], WAYS[1], WAYS[3]]) {
      const label = `unlocking again, ${step} getting ${way}`;
      const failed = await outage(path, answer);
      await page.call((secret) => {
        const node = document.querySelector('#unlock-password');
        node.value = secret;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('button[type=submit]').click();
      }, VAULT_PASSWORD);
      // The earlier message may still show, so wait for the request first.
      const reached = await (async () => {
        const deadline = Date.now() + 90000;
        while (failed.seen === 0 && Date.now() < deadline) await page.frames();
        return failed.seen > 0;
      })();
      const done = await page.waitUntil(
        (outage) => document.body.innerText.includes(outage) && document.querySelector('button[type=submit]') &&
          !document.querySelector('button[type=submit]').disabled,
        { args: [OUTAGE], timeout: 90000, label: 'the outage message' },
      ).then(() => true, () => false);
      const state = await cardState();
      await failed.lift();
      check(`${label}: the request was sent and failed`, reached);
      check(`${label}: the card settles on the outage message`, done, JSON.stringify(state));
      outageHolds(label, state, null, VAULT_PASSWORD);
    }
  }
  await page.eval("document.querySelector('button[type=submit]').click()");
  check('unlocking again after the outages opens the vault',
    await page.waitUntil("!document.querySelector('#unlock-password') && document.querySelector('.topbar nav a')",
      { timeout: 90000, label: 'the vault after unlocking again' }).then(() => true, () => false));

  // ---- Criterion 16: a correct Auth Key whose unwrap fails ------------

  await freshCard();
  const untamper = await tamperedWrapper();
  await signInOn(page, VAULT_PASSWORD, 'leander');
  await settled();
  const unwrapped = await cardState();
  await untamper();
  check('a correct Auth Key whose unwrap fails shows the wrong-password message',
    unwrapped.wrong !== null && unwrapped.outage === null, JSON.stringify(unwrapped));
  check('a correct Auth Key whose unwrap fails holds no key', !unwrapped.keys && !unwrapped.vault);
});
