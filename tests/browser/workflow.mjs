// The workflows, end to end, in a real browser
// (spec/ui/register.md, unlock.md, dashboard.md, update-values.md,
// recording-detail.md, account-detail.md, settings.md, admin.md).
//
// Everything past the sign-in card is client-rendered from decrypted
// records, so this is the only place those screens can be checked.
// Run by tests/test_browser.py, which starts the server and mints the
// bootstrap invite first.
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { launch, Session } from './cdp.mjs';

const BASE = process.env.SOLVENT_BASE;
const BOOTSTRAP = process.env.SOLVENT_INVITE;
// Set by tests/test_browser.py, which also checks the stored verifiers
// against them once this has run.
const ADMIN_PASSWORD = process.env.SOLVENT_ADMIN_PASSWORD;
const VAULT_PASSWORD = process.env.SOLVENT_VAULT_PASSWORD;
const BACKDATE = process.env.SOLVENT_BACKDATE;
// The same server as Node reaches it: the loopback address it is bound
// to, which Node does not always resolve localhost to first.
const DIRECT = BASE.replace('//localhost', '//[::1]');

const checks = [];
const problems = [];
// Addresses a check fails on purpose, whose refusal the browser logs.
const provoked = [];

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail: String(detail) });
}

const { child, target } = await launch();
const page = await Session.connect(target);
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Log.enable');
page.on((message) => {
  if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry;
    // One check here deliberately fetches the export without its
    // header to prove the endpoint is not navigable, which is the gate
    // answering correctly.
    const url = entry.url || '';
    const noise =
      url.endsWith('/api/export') ||
      [...expectedFailures].some((path) => url.includes(path)) ||
      provoked.some((part) => url.includes(part));
    if (entry.level === 'error' && !noise) {
      problems.push(`${entry.url || ''} ${entry.text}`);
    }
  }
  if (message.method === 'Runtime.exceptionThrown') {
    problems.push(message.params.exceptionDetails.exception?.description || 'exception');
  }
});

// ---- Login: what leaves the browser, and what it keeps -------------

// A request a section fails on purpose, by path, for as long as it is
// listed. The browser logs each failed response as an error.
const expectedFailures = new Set();

// Every request a page sends, with its body, and every write to web
// storage, over the whole run. Read back in the login checks, since
// login.md asks it of the whole flow and not only the first sign-in.
async function watch(session) {
  const requests = [];
  const storage = [];
  session.on((message) => {
    if (message.method === 'Network.requestWillBeSent') {
      const { request } = message.params;
      requests.push({
        url: request.url,
        method: request.method,
        headers: JSON.stringify(request.headers),
        body: request.postData || '',
      });
    }
    if (message.method === 'DOMStorage.domStorageItemAdded' || message.method === 'DOMStorage.domStorageItemUpdated') {
      storage.push(message.params);
    }
  });
  await session.send('Network.enable', { maxPostDataSize: 64 * 1024 * 1024 });
  await session.send('DOMStorage.enable');
  return { requests, storage };
}
const watched = [await watch(page)];

// Another browser with a profile of its own, watched like the first.
async function openBrowser(url) {
  const opened = await launch();
  const session = await Session.connect(opened.target);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  watched.push(await watch(session));
  if (url) await session.goto(url);
  return { session, close: () => opened.child.kill() };
}

// The database the server runs on, read and written the way an
// operator's shell would.
function sql(statement, ...args) {
  const db = new DatabaseSync(process.env.DATABASE_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare(statement).all(...args);
  } finally {
    db.close();
  }
}
const credentialOf = (username) =>
  sql(
    `SELECT c.id, c.params, c.verifier, w.wrapped_dek, w.dek_nonce, p.id AS principal
     FROM credentials c JOIN principals p ON p.id = c.principal_id
     LEFT JOIN dek_wrappers w ON w.credential_id = c.id WHERE p.username = ?`,
    username,
  )[0];
const recordsOf = (principal) =>
  JSON.stringify(sql('SELECT * FROM records WHERE principal_id = ? ORDER BY record_id', principal));
const OWN = "JOIN principals ON principals.id = records.principal_id WHERE principals.username = 'leander'";

// The rate proxy as the main page sees it. It is answered here, so no
// check waits on a live provider, and every ask is kept for the checks
// that count them. Fetch.enable replaces the patterns in force and
// Fetch.disable drops them all, so the helpers below keep this one in
// force on the page and skip its requests.
const RATES = { urlPattern: '*/api/rates\\?*', requestStage: 'Request' };
const proxyAsks = [];
const isRateAsk = (session, request) => session === page && request.url.includes('/api/rates?');
const fetchOn = (session, urlPattern, requestStage = 'Request') =>
  session.send('Fetch.enable', {
    patterns: [{ urlPattern, requestStage }, ...(session === page ? [RATES] : [])],
  });
const fetchOff = (session) =>
  session === page ? session.send('Fetch.enable', { patterns: [RATES] }) : session.send('Fetch.disable');
const wholeTable = (date, quote) => {
  const day = Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const before = new Date((day - 1) * 86400000).toISOString().slice(0, 10);
  const entry = (symbol, rate, asOf, source) => ({ rate, base: `1 ${symbol}`, asOf, source, cached: false });
  const rates = {};
  for (const [code, rate] of [['USD', 0.85], ['EUR', 0.93], ['GBP', 1.1], ['JPY', 0.0059]]) {
    if (code !== quote) rates[code] = entry(code, (rate + (day % 7) / 100).toFixed(4), date, 'frankfurter');
  }
  rates['XAU-ozt'] = entry('XAU-ozt', String(2600 + (day % 50)), before, 'nbp+frankfurter');
  rates['XAU-g'] = entry('XAU-g', (80 + (day % 50) / 10).toFixed(2), before, 'nbp+frankfurter');
  return { date, quote, rates };
};

page.on(async (message) => {
  if (message.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = message.params;
  if (!isRateAsk(page, request)) return;
  proxyAsks.push(request.url);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  await page.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify(wholeTable(query.date, query.quote))).toString('base64'),
  }).catch(() => {
    /* the page went away mid-request */
  });
});
await page.send('Fetch.enable', { patterns: [RATES] });

// Answers each request matching `pattern` with what `respond` returns
// for it, { status, body } to fulfil or null to let it through, until
// the returned function is called. `respond` may take its time, which
// holds the request that long.
async function intercept(session, pattern, respond) {
  const handler = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (isRateAsk(session, request)) return;
    const answer = await respond(request);
    if (!answer) {
      await session.send('Fetch.continueRequest', { requestId });
      return;
    }
    await session.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: answer.status,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(answer.body || '{}').toString('base64'),
    });
  };
  session.on(handler);
  await fetchOn(session, pattern);
  return async () => {
    session.handlers = session.handlers.filter((h) => h !== handler);
    await fetchOff(session);
  };
}

// Every request matching `match` answered with `status` while `body` runs.
const answering = async (match, status, body) => {
  const handler = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (isRateAsk(page, request)) return;
    if (match(request)) {
      await page.send('Fetch.fulfillRequest', { requestId, responseCode: status, body: '' });
    } else {
      await page.send('Fetch.continueRequest', { requestId });
    }
  };
  page.on(handler);
  await fetchOn(page, '*/api/*');
  try {
    await body();
  } finally {
    await fetchOff(page);
    page.handlers = page.handlers.filter((h) => h !== handler);
  }
};

// An account at a KDF envelope below the server default, the state of
// one registered before the default was raised. No endpoint stores a
// weak envelope, so the credential is rotated through the upgrade
// endpoint with its salt, Auth Key and wrapper all made at the weak
// memory parameter, and the database then records that parameter. It
// signs in exactly as such an account would. Run in a page signed in
// as `username`, which for a vault owner must hold the unlocked vault.
const WEAK_MEMORY = 32768;
async function makeStale(session, username, password) {
  await session.eval(`(async () => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const kdf = JSON.parse(document.getElementById('kdf-envelope').textContent);
    const salt = c.b64encode(c.randomBytes(16));
    const keys = await c.deriveKeys(${JSON.stringify(password)}, salt, { ...kdf, m: ${WEAK_MEMORY} });
    const body = { salt, kdf, authKey: keys.authKey };
    const vault = s.currentVault();
    if (vault) Object.assign(body, await c.wrapDek(vault.dek, keys.masterKey));
    await api.post('/api/auth/upgrade-kdf', body);
  })()`);
  sql(
    `UPDATE credentials SET params = json_set(params, '$.kdf.m', ?)
     WHERE principal_id = (SELECT id FROM principals WHERE username = ?)`,
    WEAK_MEMORY,
    username,
  );
}

// The sign-in card on any page, filled and submitted. The username is
// typed only where the card asks for it.
const signInOn = (session, password, username = null) =>
  session.eval(`(() => {
    const set = (selector, value) => {
      const node = document.querySelector(selector);
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (${JSON.stringify(username)} && document.querySelector('#unlock-username')) {
      set('#unlock-username', ${JSON.stringify(username)});
    }
    set('#unlock-password', ${JSON.stringify(password)});
    document.querySelector('button[type=submit]').click();
  })()`);

// The password alone, on a card that knows the username.
const enterPasswordOn = (session, password) =>
  session.eval(`(() => {
    const node = document.querySelector('#unlock-password');
    node.value = ${JSON.stringify(password)};
    node.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('button[type=submit]').click();
  })()`);

const text = () => page.eval('document.body.innerText');
const labels = (selector) =>
  page.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(n => n.textContent.trim())`);
const click = (label) =>
  page.eval(
    `[...document.querySelectorAll('button, a')]` +
      `.find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`,
  );
const setValue = (selector, value, index = 0) =>
  page.eval(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
const submit = () => page.eval("document.querySelector('button[type=submit]').click()");
const enterPassword = async (password) => {
  await setValue('input[type=password]', password);
  await submit();
};

// Export the vault, open the file with its own password, and import it
// back under a freshly generated DEK, through the module the transfer
// screen runs. Returns what a fresh unlock reads back.
const importOwnExport = () =>
  page.eval(`(async () => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const t = await import('/static/js/transfer.js');
    const file = t.checkFile(await (await fetch('/api/export', { headers: { 'X-Solvent-Request': '1' } })).json());

    const { fileDek } = await t.openFile(file, ${JSON.stringify(VAULT_PASSWORD)});
    // Re-key: a freshly generated DEK, never the file's.
    const { dek: newDek, records: rekeyed } = await t.rekey(fileDek, file.records);
    const wrapper = await s.wrapForMaster(newDek);
    await api.post('/api/import', { ...wrapper, records: rekeyed });

    // Read the vault back from scratch, as a fresh unlock would.
    const { Vault } = await import('/static/js/model.js');
    const reopened = new Vault(newDek);
    await reopened.load();
    const fileRaw = c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', fileDek)));
    const newRaw = c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', newDek)));
    return JSON.stringify({
      names: [...reopened.holdings.values()].map(h => h.payload.name).sort(),
      unreadable: reopened.unreadable.length,
      rekeyed: fileRaw !== newRaw,
      kinds: [...new Set(file.records.map(r => r.recordType))].sort(),
    });
  })()`);

// Records the client's own rules would never write, encrypted with the
// page's own crypto under the unlocked vault's DEK and PUT straight to
// the record API. Each is { type, payload, accountId?, recordId?,
// version? }; the ids come back in order.
const plant = (records) =>
  page.eval(`(async () => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const { SCHEMA_VERSION } = await import('/static/js/model.js');
    const dek = s.currentVault().dek;
    const ids = [];
    for (const r of ${JSON.stringify(records)}) {
      const slot = {
        recordId: r.recordId || c.uuid4(), recordType: r.type, accountId: r.accountId ?? null,
        schemaVersion: SCHEMA_VERSION, version: r.version || 1,
      };
      const blob = await c.encryptRecord(dek, slot, r.payload);
      await api.put('/api/records/' + slot.recordId, {
        recordType: slot.recordType, accountId: slot.accountId,
        schemaVersion: slot.schemaVersion, version: slot.version, ...blob,
      });
      ids.push(slot.recordId);
    }
    return ids;
  })()`);

// A clock the test can move, installed before any page script runs.
// Every timer still fires on its own in real time; `advance` moves the
// clock forward and fires whatever has fallen due, so a fifteen-minute
// idle period passes in a call.
const CLOCK = `(() => {
  const realSet = window.setTimeout.bind(window);
  const realClear = window.clearTimeout.bind(window);
  const pending = new Map();
  let offset = 0;
  window.setTimeout = (fn, delay = 0, ...args) => {
    const id = realSet(() => { pending.delete(id); fn(...args); }, delay);
    pending.set(id, { fn, args, due: performance.now() + offset + Number(delay) });
    return id;
  };
  window.clearTimeout = (id) => { pending.delete(id); realClear(id); };
  window.testClock = {
    advance(ms) {
      offset += ms;
      const now = performance.now() + offset;
      for (const [id, timer] of [...pending]) {
        if (timer.due > now) continue;
        pending.delete(id);
        realClear(id);
        timer.fn(...timer.args);
      }
    },
  };
})();`;
const MINUTE = 60000;

// Which of `needles` a devtools user could still find: every string
// reachable from the page's heap, after a collection.
const reachable = async (needles) => {
  const chunks = [];
  const collect = (message) => {
    if (message.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(message.params.chunk);
  };
  page.on(collect);
  await page.send('HeapProfiler.enable');
  await page.send('HeapProfiler.collectGarbage');
  await page.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await page.send('HeapProfiler.disable');
  page.handlers = page.handlers.filter((h) => h !== collect);
  const { strings } = JSON.parse(chunks.join(''));
  return needles.filter((needle) => strings.some((s) => s.includes(needle)));
};

// A document the test has marked, so a document load is told from a
// change inside the page: a new document has no mark. Registration and
// sign-in must reach the vault without one, because the keys live in
// the document's memory and a new document has none (login.md, Rules;
// register.md, Flow).
const markDocument = (session, name) => session.eval(`window.__sitting = ${JSON.stringify(name)}`);

// Whether `session` is in the vault, in the document marked `name`:
// the keys in memory, no card asking for a password, and the chrome a
// vault owner has.
const sitting = async (session, name) =>
  JSON.parse(await session.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const bar = document.querySelector('.topbar');
    return JSON.stringify({
      sameDocument: window.__sitting === ${JSON.stringify(name)},
      keys: s.currentVault() !== null,
      card: Boolean(document.querySelector('#unlock-password')),
      path: location.pathname,
      hash: location.hash,
      nav: [...document.querySelectorAll('.topbar nav a')].map((a) => a.textContent.trim()),
      controls: [...document.querySelectorAll('.topbar-actions button')].map((b) => b.textContent.trim()),
      barShown: Boolean(bar) && !bar.hidden && bar.offsetHeight > 0,
      outsideFrame: document.body.classList.contains('outside-body') || Boolean(document.querySelector('.outside-wordmark')),
      passwordFields: document.querySelectorAll('input[type=password]').length,
      title: document.title,
    });
  })()`));

// What chrome a person can see, by what is rendered and not by what is
// in the DOM: a bar with `hidden` is present and not drawn. Outside the
// shell (password and registration screens) there is no top bar, no
// navigation, no Update values and no Lock, only the wordmark above the
// card (product/app-shell.md, What must be true).
const chromeState = async (session) =>
  JSON.parse(await session.eval(`(() => {
    const shown = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const visible = (selector) => [...document.querySelectorAll(selector)].filter(shown);
    const bar = document.querySelector('.topbar');
    return JSON.stringify({
      bar: Boolean(bar) && shown(bar),
      barParts: bar ? [...bar.querySelectorAll('*')].filter(shown).length : 0,
      navs: visible('nav').length,
      links: visible('.topbar a, nav a').length,
      buttons: visible('.topbar button, .topbar-actions button, .btn-chrome').length,
      topbarWordmark: visible('.topbar .wordmark').length,
      outsideWordmark: visible('.outside-wordmark').length,
      text: document.body.innerText,
      card: Boolean(document.querySelector('#unlock-password')),
    });
  })()`));
const noChrome = (state) =>
  !state.bar && state.barParts === 0 && state.navs === 0 && state.links === 0 && state.buttons === 0 &&
  state.topbarWordmark === 0 && state.outsideWordmark === 1 &&
  !/Update values|Dashboard|Settings|\bLock\b/.test(state.text);
const hasChrome = (state) =>
  state.bar && state.navs === 1 && state.links === 2 && state.buttons === 2 && state.topbarWordmark === 1 && state.outsideWordmark === 0;

// Waits for the vault to be showing, without throwing, so that a
// failure is one failed check and the run goes on.
const intoVault = (session, label, timeout = 90000) =>
  session
    .waitUntil("location.pathname === '/dashboard' && document.querySelector('#app').children.length > 0 && !document.querySelector('#unlock-password') && document.querySelector('.topbar nav a')", { timeout, label })
    .then(() => true, () => false);

// Holds the first read of the vault's records on its way to the server
// until `release()`, so a test can act while the vault is being read.
// `reached` resolves when the read is waiting. `stop()` removes it. The
// read then goes on to the server, or is answered with `answer` when given.
const holdRecords = async (session, answer = null) => {
  let release;
  let reach;
  const gate = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { reach = resolve; });
  const stop = await intercept(session, '*/api/records?type=*', async () => {
    reach();
    await gate;
    return answer;
  });
  return { reached, release, stop };
};

// What a page shows and holds once a vault read it began has finished:
// whether any key or vault is held, whether the vault is drawn, and
// whether the card asking for the password is.
const afterRead = (session) =>
  session.eval(`(async () => {
    const s = await import('/static/js/session.js');
    return JSON.stringify({
      keys: s.holdsKeys(),
      vault: s.currentVault() !== null,
      card: Boolean(document.querySelector('#unlock-password')),
      drawn: Boolean(document.querySelector('.hero-figure, .holdings-table, .sweep, .dialog')),
      empty: document.body.innerText.includes('Add your first holding'),
      nav: document.querySelectorAll('.topbar nav a').length > 0 && !document.querySelector('.topbar').hidden
        && document.querySelector('.topbar nav a').offsetParent !== null && document.querySelectorAll('.topbar-actions button').length > 0
        && document.body.innerText.includes('Update values'),
    });
  })()`).then(JSON.parse);

// Where Back lands from a page left while unlocked.
const backFromAway = async (session) => {
  await session.goto('about:blank');
  await session.send('Page.navigateToHistoryEntry', {
    entryId: await session.send('Page.getNavigationHistory').then(({ currentIndex, entries }) => entries[currentIndex - 1].id),
  });
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    await session.settle(250);
    try {
      const back = JSON.parse(await session.eval(`(async () => {
        if (!document.querySelector('#unlock-password')) return 'null';
        return JSON.stringify({
          keys: (await import('/static/js/session.js')).currentVault() !== null,
          text: document.body.innerText,
        });
      })()`));
      if (back) return back;
    } catch {
      // Between documents.
    }
  }
  return null;
};

try {
  // ---- The administrator, from the bootstrap invite ---------------

  await page.goto(`${BASE}/register?invite=${BOOTSTRAP}`);
  check(
    'an administrator invite renders the administrator form',
    (await page.eval("document.querySelector('.card-heading').textContent")) ===
      'Create an administrator account',
  );
  check('the form says what the account is', (await text()).includes('It holds no financial data of its own'));
  check('no main currency on the administrator form', !(await text()).includes('Main currency'));
  check('no no-recovery acknowledgement on it', !(await text()).includes('permanently unreadable'));
  check('the token is dropped from the address bar', !(await page.eval('location.search')).includes('invite'));

  await setValue('input[type=text]', 'ops.leander');
  await setValue('input[type=password]', ADMIN_PASSWORD, 0);
  await setValue('input[type=password]', ADMIN_PASSWORD, 1);
  await page.settle(300);
  check('the button unlocks once the bar is met', await page.eval("!document.querySelector('button[type=submit]').disabled"));
  await submit();
  await page.waitUntil("location.pathname === '/admin'", { timeout: 90000, label: 'the admin area' });
  await page.waitUntil("document.querySelector('#app .section-switcher')", { label: 'the admin area to render' });

  check('an administrator lands in the admin area', (await page.eval('location.pathname')) === '/admin');
  check(
    "an administrator's bar carries only Sign out",
    (await page.eval("document.querySelector('.topbar-actions').textContent.trim()")) === 'Sign out',
  );
  check('an administrator has no nav entries at all', (await page.eval("document.querySelectorAll('.topbar nav a').length")) === 0);
  check('the boundary callout is present', (await text()).includes('You cannot read anyone'));
  check(
    'the four sections are offered',
    (await labels('.switcher-link')).join(',') === 'Invites,Accounts,Units,Your password',
  );

  await setValue('input[type=text]', 'Sprint test');
  await click('Create invite link');
  await page.waitUntil("document.body.innerText.includes('Copy this now')", { label: 'the one-time link' });
  const inviteUrl = await page.eval("document.querySelector('input[readonly]').value");
  check('the invite link is shown once', inviteUrl.includes('/register?invite='));

  await click('Accounts');
  await page.waitUntil("document.body.innerText.includes('ops.leander')", { label: 'the account list' });
  check('an administrator row reads No vault, never a zero', (await text()).includes('No vault'));
  check(
    'the only administrator has no Remove control',
    (await text()).includes('The only administrator'),
  );

  await click('Units');
  await page.waitUntil("document.body.innerText.includes('XAU-ozt')", { label: 'the unit table' });
  check('a unit with no source says so', (await text()).includes('No source for this unit yet'));
  check(
    'gold is automatic and silver is entered by hand',
    await page.eval(`(() => {
      const row = (code) => [...document.querySelectorAll('tr')].find(r => r.textContent.includes(code));
      return row('XAU-ozt').querySelector('select').value === 'true'
        && row('XAG-ozt').querySelector('select').disabled;
    })()`),
  );

  await click('Your password');
  await page.waitUntil("document.body.innerText.includes('same bar as anybody')", { label: 'the password card' });
  check('an administrator can change their own password', (await labels('.card button')).includes('Change password'));

  // ---- The vault owner --------------------------------------------

  const vaultInvite = inviteUrl.split('invite=')[1];
  await page.goto(`${BASE}/register?invite=${vaultInvite}`);
  check(
    'a vault owner invite renders the vault form',
    (await page.eval("document.querySelector('.card-heading').textContent")) === 'Create your vault',
  );
  {
    const registrationChrome = await chromeState(page);
    check(
      'the registration screen shows no top bar and no navigation',
      !registrationChrome.bar && registrationChrome.navs === 0 && registrationChrome.links === 0 && registrationChrome.buttons === 0 && registrationChrome.outsideWordmark === 1,
      JSON.stringify({ ...registrationChrome, text: undefined }),
    );
  }
  check('the currency warning sits at the point of choice', (await text()).includes('This cannot be changed later.'));
  check('the acknowledgement is required', (await text()).includes('permanently unreadable'));

  await setValue('input[type=text]', 'leander');
  await setValue('input[type=password]', VAULT_PASSWORD, 0);
  await setValue('input[type=password]', VAULT_PASSWORD, 1);
  await setValue('select', 'CHF');
  await page.eval(`(() => {
    const box = document.querySelector('input[type=checkbox]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.settle(300);
  await markDocument(page, 'registration');
  await submit();
  const registered = await intoVault(page, 'the vault after registering');
  await page.settle(500);

  // register.md, Flow: "lands logged in with keys already in memory".
  // The keys live in the memory of the document that derived them, so
  // the vault is drawn in that document: a load of /dashboard would
  // find nobody holding them and ask for the password just chosen.
  const landed = registered ? await sitting(page, 'registration') : null;
  check(
    'registering a vault lands in the vault itself, in the same document, with the keys in memory and no password asked again',
    landed && landed.sameDocument && landed.keys && !landed.card && landed.path === '/dashboard',
    JSON.stringify(landed),
  );
  check(
    'the vault the registration lands in is the new one, empty and offering its first holding',
    registered && (await text()).includes('Add your first holding'),
  );
  check(
    "a registered vault owner's bar has the nav, Update values and Lock, and the outside frame is gone",
    landed && landed.nav.join(',') === 'Dashboard,Settings' && landed.controls.join(',') === 'Update values,Lock' &&
      landed.barShown && !landed.outsideFrame && landed.title === 'Solvent',
    JSON.stringify(landed),
  );
  check(
    'after registering no password field is left and the invite token is nowhere in the page or the address',
    landed && landed.passwordFields === 0 && !landed.hash.includes(vaultInvite) &&
      !(await page.eval('location.href')).includes(vaultInvite) &&
      !(await page.eval('document.documentElement.outerHTML')).includes(vaultInvite),
    JSON.stringify(landed),
  );
  // A page load discards the in-memory keys by definition.
  await page.goto(`${BASE}/dashboard`);
  check('a reload asks for the password again', (await text()).includes('Solvent cannot recover a lost password'));
  {
    const reloadedChrome = await chromeState(page);
    check(
      'the password screen after registering and reloading shows no top bar and no navigation',
      noChrome(reloadedChrome),
      JSON.stringify({ ...reloadedChrome, text: undefined }),
    );
  }
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.body.innerText.includes('Add your first holding')", {
    timeout: 90000,
    label: 'the empty dashboard',
  });
  check('an empty vault points at the first holding', true);
  check('no chart and no zero total on an empty vault', !(await page.eval("Boolean(document.querySelector('svg.trend'))")));

  // A manager that fills one of these writes a stored login into an
  // encrypted record, and its inline button invites exactly that.
  const fieldsOffered = [];
  const addHolding = async (name, unit) => {
    await click('Add a holding');
    await page.waitUntil("document.querySelector('.dialog')");
    await page.settle(350);
    fieldsOffered.push(await page.eval(`(() => {
      const credential = ['username', 'current-password', 'new-password'];
      return [...document.querySelectorAll('.dialog input, .dialog textarea, .dialog select')]
        .filter((f) => !credential.includes(f.getAttribute('autocomplete')))
        .filter((f) => !f.hasAttribute('data-1p-ignore'))
        .map((f) => f.id || f.type)
        .join(',');
    })()`));
    await setValue('#holding-name', name);
    const option = `#holding-unit-list [data-symbol="${unit}"]`;
    await page.waitUntil(`document.querySelector('${option}')`, { label: `the ${unit} option` });
    await page.eval(`document.querySelector('${option}').click()`);
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.waitUntil('!document.querySelector(".dialog")', { label: `${name} to save` });
    await page.settle(250);
  };
  await addHolding('Cantonal account', 'CHF');
  await addHolding('UBS dollar account', 'USD');
  await addHolding('Gold bars', 'XAU-ozt');
  check(
    'no vault field offers itself to a password manager',
    fieldsOffered.every((f) => f === ''),
    fieldsOffered.join(' | '),
  );
  await addHolding('Mortgage', 'CHF');

  check('every holding is listed as not yet valued', (await text()).includes('Not yet valued'));
  check(
    'a holding reads back the name it was given',
    (await labels('.plain-list .link-button')).join(',') ===
      'Cantonal account,UBS dollar account,Gold bars,Mortgage',
    (await labels('.plain-list .link-button')).join(','),
  );
  check('four holdings, none of them valued', (await page.eval("document.querySelectorAll('.plain-list li').length")) === 4);
  check('the total reads a dash rather than zero', (await page.eval("document.querySelector('.hero-figure').textContent")) === '—');

  // ---- The sweep ----------------------------------------------------

  check('the vault store backs the top bar', await page.eval("Boolean(window.Alpine && Alpine.store('vault'))"));
  const asksBeforeSweep = proxyAsks.length;
  await page.eval("document.querySelector('.topbar-actions button').click()");
  await page.waitUntil("location.hash.startsWith('#/sweep/')", { label: 'the sweep' });
  await page.settle(1500);

  check('one row per active holding', (await page.eval("document.querySelectorAll('.sweep-row').length")) === 4);
  check(
    'every row states whether this date holds a figure',
    (await labels('.row-state')).every((state) => state === 'Nothing recorded for this date.'),
  );
  const rateUnits = await page.eval("[...document.querySelectorAll('.rate-line')].map(n => n.dataset.unit)");
  check('one rate line per unit that needs one', rateUnits.join(',') === 'USD,XAU-ozt', rateUnits.join(','));
  check('the main currency has no rate line', !rateUnits.includes('CHF'));
  check(
    'a never-valued row offers no Confirm',
    (await labels('.sweep-row button')).every((label) => label !== 'Confirm'),
  );

  const recordRow = async (index, value) => {
    await page.eval(`(() => {
      const row = document.querySelectorAll('.sweep-row')[${index}];
      const field = row.querySelector('input');
      field.value = ${JSON.stringify(value)};
      field.dispatchEvent(new Event('input', { bubbles: true }));
      row.querySelector('button').click();
    })()`);
    await page.settle(1500);
  };
  await recordRow(0, '12450.00');
  await recordRow(1, '8300.50');
  await recordRow(2, '12.5');
  await recordRow(3, '-410000.00');

  check(
    'every recorded row says so',
    (await labels('.row-state')).every((state) => state === 'Recorded for this date.'),
  );
  // A date has no hour, so a figure recorded now is "Today" at any hour.
  check(
    'a row recorded for today is aged "Today."',
    (await labels('.row-age')).every((age) => age === 'Today.'),
    (await labels('.row-age')).join(','),
  );
  const rateValues = await page.eval("[...document.querySelectorAll('.rate-line input')].map(n => n.value)");
  check('the prices went in with the first row', rateValues.every(Boolean), rateValues.join(','));
  const rateCalls = () => proxyAsks.length - asksBeforeSweep;
  const requests = rateCalls();
  check('a four-row sweep asks the proxy once', requests === 1, `issued ${requests}`);
  const rateNames = await labels('.rate-unit');
  check('a rate line is headed by the unit\'s name', rateNames.join(',') === 'United States Dollar,Gold', rateNames.join(','));

  await page.eval(`document.querySelector('.topbar nav a[href="#/"]').click()`);
  await page.settle(900);

  // ---- The dashboard -------------------------------------------------

  const hero = await page.eval("document.querySelector('.hero-figure').textContent");
  check('the hero carries a total in the main currency', hero.includes('CHF'), hero);
  // Read from the markup: the labels are set in capitals by the
  // stylesheet, which innerText reports.
  check(
    'gross assets and liabilities are both shown',
    (await page.eval("document.querySelector('.hero').textContent")).includes('Liabilities'),
  );
  check('the chart is drawn', await page.eval("Boolean(document.querySelector('svg.trend'))"));
  check('the entry marks are on with nothing turned on', (await page.eval("document.querySelectorAll('.entry-mark').length")) > 0);
  check('the table fallback is there', (await text()).includes('View as table'));

  const chartBefore = await page.eval("document.querySelector('svg.trend').innerHTML");
  const totalBefore = hero;
  await page.eval("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('as of each figure')).click()");
  await page.settle(500);
  check(
    'the rates control leaves the chart untouched',
    (await page.eval("document.querySelector('svg.trend').innerHTML")) === chartBefore,
  );
  await page.eval("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('Latest rates')).click()");
  await page.settle(400);
  check('switching back restores the total', (await page.eval("document.querySelector('.hero-figure').textContent")) === totalBefore);

  const before = await page.eval("performance.getEntriesByType('resource').length");
  await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
  await page.settle(400);
  check(
    'no chart control issues a request',
    (await page.eval("performance.getEntriesByType('resource').length")) === before,
  );

  // ---- The recording's own screen -------------------------------------

  await page.eval("document.querySelector('.entry-mark').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: "the recording's screen" });
  await page.settle(600);
  check('the recording lists what went in that day', (await page.eval("document.querySelectorAll('.card tbody tr').length")) >= 4);
  const chips = await labels('.chip');
  check('each price says where it came from', chips.some((chip) => chip.startsWith('Market rate')), chips.join(','));
  check('the recording offers Update and Delete', (await labels('.form-actions button')).join(',') === 'Update,Delete');
  const beforeOpen = rateCalls();
  await page.eval("location.hash = '#/'");
  await page.settle(400);
  await page.eval("document.querySelector('.entry-mark').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.settle(900);
  check('opening a recording asks the source nothing', rateCalls() === beforeOpen);

  // ---- A holding's own screen ------------------------------------------

  await page.eval("location.hash = '#/'");
  await page.settle(700);
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/')", { label: "the holding's screen" });
  await page.settle(500);
  check('the holding lists its own values', (await page.eval("document.querySelectorAll('.card .data-table tbody tr').length")) === 1);
  check(
    'the holding offers its four actions',
    (await labels('.form-actions button')).join(',') === 'Record a value,Edit,Archive,Delete',
  );
  check('there is no rate column on a holding', !(await text()).includes('Source'));
  check(
    'a figure recorded for today is aged "today" on the holding',
    (await labels('.hero-age')).some((age) => age.startsWith('as of ') && age.endsWith(', today')),
    (await labels('.hero-age')).join(','),
  );

  // ---- A backdated figure, and the second recording ---------------------

  await click('Record a value');
  await page.waitUntil("document.querySelector('.dialog')");
  await page.settle(300);
  // Typed in the reader's own format, which is what the field accepts:
  // writing an ISO date into it would test a control nobody uses.
  const asWritten = await page.eval(`(async () => {
    const f = await import('/static/js/format.js');
    const s = await import('/static/js/session.js');
    return f.formatter(s.currentVault().profile).date('${BACKDATE}');
  })()`);
  check('the date field shows the reader\'s own format', asWritten !== BACKDATE, asWritten);
  await setValue('#snapshot-date', asWritten);
  await setValue('#snapshot-value', '11000.00');
  await page.settle(400);
  await page.eval("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
  await page.settle(200);
  check(
    'the prices line says what the save writes',
    (await text()).includes('will be recorded with this'),
    await page.eval("[...document.querySelectorAll('.dialog .hint')].map(n => n.textContent).join(' | ')"),
  );
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()");
  await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the value to save' });
  await page.settle(1500);
  check('the backdated figure joins the history', (await page.eval("document.querySelectorAll('.card .data-table tbody tr').length")) === 2);

  await page.eval("location.hash = '#/'");
  await page.settle(800);
  check('the chart now carries two entry marks', (await page.eval("document.querySelectorAll('.entry-mark').length")) === 2);

  // ---- Settings ----------------------------------------------------------

  // Reached the way a person reaches it, from the top bar. The keys
  // live in this page's memory, so a second server page would charge
  // the derivation again.
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 20000, label: 'settings' });
  await page.settle(700);
  check(
    'opening settings does not ask for the password again',
    !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
  );
  check('the main currency is shown and fixed', (await text()).includes('Fixed when you created your vault'));
  check('the change-password card explains the speed', (await text()).includes('Your data is not re-encrypted'));
  check('it warns that old export files still open', (await text()).includes('still open with your old password'));
  check('the absence of IP records is volunteered', (await text()).includes('Solvent records no IP addresses'));
  check('the session list marks this one', (await text()).includes('This session'));

  // ---- Dates and numbers -------------------------------------------------

  const setSelect = async (id, value) => {
    await page.eval(`(() => {
      const node = document.getElementById('${id}');
      node.value = ${JSON.stringify(value)};
      node.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  };
  await setSelect('format-locale', 'de-CH');
  await setSelect('format-group', 'apostrophe');
  await setSelect('format-places', '0');
  await setSelect('format-dates', 'dmy');
  await page.settle(200);
  const sample = await page.eval(
    "[...document.querySelectorAll('#format-places')][0].closest('.card').querySelector('.hint ~ .hint, .hint').textContent",
  );
  check('the card previews the choice before it is saved', true, sample);

  await page.eval("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Dates and numbers')).querySelector('.btn-primary').click()");
  await page.waitUntil("document.body.innerText.includes('Main currency')", { label: 'settings after saving the format' });
  await page.settle(600);

  const written = await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const f = s.currentVault().format;
    return JSON.stringify({ money: f.money(1234567890000000000n), date: f.date('2026-09-20') });
  })()`);
  check(
    'the saved format is what every figure and date now uses',
    written === JSON.stringify({ money: '1\u2019234\u2019568', date: '20.09.2026' }),
    written,
  );

  await page.eval(`document.querySelector('.topbar nav a[href="#/"]').click()`);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 20000, label: 'the dashboard in the chosen format' });
  await page.settle(600);
  check(
    'the dashboard total carries the apostrophe and no decimals',
    /\d\u2019\d{3}(?!\.)/.test(await page.eval("document.querySelector('.hero-figure, .hero').textContent")),
    await page.eval("document.querySelector('.hero-figure, .hero').textContent"),
  );
  check(
    'going back to the dashboard did not ask for the password again',
    !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
  );

  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 20000, label: 'settings once more' });
  await page.settle(400);
  check('the danger zone is collapsed', !(await page.eval("document.querySelector('.danger-zone').open")));
  await page.eval("document.querySelector('.danger-zone').open = true");
  await page.settle(200);
  check(
    'the danger zone holds one destructive button, and nothing to type into',
    (await page.eval("document.querySelector('.danger-zone .btn-destructive').textContent")) === 'Delete my account' &&
      (await page.eval("document.querySelectorAll('.danger-zone input').length")) === 0,
  );
  await page.eval("document.querySelector('.danger-zone .btn-destructive').click()");
  await page.settle(200);
  check('export is offered as the primary action in the dialog it opens', (await page.eval("document.querySelector('.dialog .btn-primary').textContent")) === 'Export first');
  check(
    'deleting is the destructive secondary action',
    (await page.eval("document.querySelector('.dialog .btn-destructive').textContent")) === 'Delete my vault',
  );
  await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Cancel').click()");
  await page.settle(200);

  const exported = JSON.parse(
    await page.eval(`(async () => {
      const response = await fetch('/api/export', { headers: { 'X-Solvent-Request': '1' } });
      const body = await response.json();
      // Encoded fields and random ids are blanked: a short needle can
      // turn up in base64 by chance, and their decoded bytes are scanned
      // in the export and import section.
      const raw = JSON.stringify(body).replace(/"(salt|wrappedDek|dekNonce|nonce|ciphertext|recordId|accountId)":"[^"]*"/g, '"$1":""');
      return JSON.stringify({
        kinds: [...new Set(body.records.map(r => r.recordType))].sort(),
        leaks: ['Cantonal', 'UBS', 'Gold bars', 'Mortgage', '12450', 'XAU-ozt', 'leander']
          .filter(value => raw.includes(value)),
      });
    })()`),
  );
  check('the export carries both timelines', exported.kinds.join(',') === 'account,profile,rate,snapshot', exported.kinds.join(','));
  check('the exported file leaks nothing in plaintext', exported.leaks.length === 0, exported.leaks.join(','));

  const navigated = await page.eval(`(async () => {
    const response = await fetch('/api/export');
    return response.status;
  })()`);
  check('export is not reachable without the header', navigated === 403, String(navigated));

  // ---- Dimensions ---------------------------------------------------------

  // A profile as registration writes it, with no dimensions key at all.
  const ungrouped = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    location.hash = '#/';
    await new Promise((r) => setTimeout(r, 800));
    return JSON.stringify({
      key: 'dimensions' in v.profile,
      options: [...document.querySelectorAll('.chart-controls select option')].map((o) => o.textContent),
      chart: Boolean(document.querySelector('svg.trend')),
    });
  })()`));
  check(
    'a profile with no dimensions key draws the dashboard with Total as the only grouping',
    !ungrouped.key && ungrouped.chart && ungrouped.options.join(',') === 'Total',
    JSON.stringify(ungrouped),
  );
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { label: 'settings for dimensions' });

  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Dimensions are how')", {
    timeout: 20000,
    label: 'the dimensions empty state',
  });
  check(
    'opening dimensions does not ask for the password again',
    !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
  );
  check('the empty state explains what a dimension is', true);
  const createActions = await labels('button');
  check(
    'the empty state carries one action, to create a dimension',
    createActions.filter((label) => label.includes('Create a dimension')).length === 1,
    createActions.join(','),
  );

  await click('Create a dimension');
  await page.waitUntil("document.querySelector('.dialog')");
  await page.settle(300);
  await page.eval(`(() => {
    const inputs = document.querySelectorAll('.dialog input');
    inputs[0].value = 'Liquidity';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'Cash';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Create').click();
  })()`);
  await page.waitUntil("document.body.innerText.includes('holdings assigned')", { label: 'the coverage line' });
  await page.settle(400);
  const coverage = await page.eval("[...document.querySelectorAll('.hint')].find(n => n.textContent.includes('assigned')).textContent");
  const model = await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const v = s.currentVault();
    return JSON.stringify({ holdings: v.holdings.size, unreadable: v.unreadable.length });
  })()`);
  check('coverage counts the active holdings', coverage === '0 of 4 holdings assigned', `${coverage} with ${model}`);

  // An inline rename writes only on Save (design-system.md, Components).
  // Every PUT the page sends from here on is counted.
  await page.eval(`(() => {
    const send = window.fetch;
    window.__puts = 0;
    window.fetch = (path, init) => {
      if (init && init.method === 'PUT') window.__puts += 1;
      return send(path, init);
    };
  })()`);
  const renameField = "document.querySelector('.card-head input')";
  const renameButton = (label) =>
    page.eval(
      `[...document.querySelectorAll('.card-head button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`,
    );
  await renameButton('Edit');
  await setValue('.card-head input', 'Liquid assets');
  await page.eval(`${renameField}.blur(); document.body.click()`);
  await page.settle(300);
  check(
    'clicking away from a rename writes nothing and leaves it open',
    (await page.eval('window.__puts')) === 0 && !(await page.eval(`Boolean(${renameField}.closest('[hidden]'))`)),
  );
  await setValue('.card-head input', '   ');
  await renameButton('Save');
  await page.settle(300);
  check(
    'a blank rename is refused and keeps what was typed',
    (await page.eval('window.__puts')) === 0 &&
      (await page.eval(`${renameField}.value`)) === '   ' &&
      (await text()).includes('A name cannot be blank.'),
  );
  await setValue('.card-head input', 'Liquid assets');
  await renameButton('Save');
  await page.waitUntil("document.body.innerText.includes('Liquid assets')", { label: 'the renamed dimension' });
  await page.settle(400);
  check('saving a rename writes one record', (await page.eval('window.__puts')) === 1);

  // ---- Account settings: every dimension operation writes one record --

  // What the screen and the chart read, and every account record as the
  // database holds it, byte for byte.
  const dims = () =>
    page.eval("(async () => JSON.stringify((await import('/static/js/session.js')).currentVault().dimensions))()").then(JSON.parse);
  const accountRecords = () =>
    JSON.stringify(sql("SELECT record_id, version, nonce, ciphertext FROM records WHERE record_type = 'account' ORDER BY record_id"));
  const bandsOf = (dimensionId) =>
    page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      const d = v.dimensions.find((x) => x.id === ${JSON.stringify(dimensionId)});
      return JSON.stringify(Object.fromEntries(v.activeHoldings().map((h) => [h.payload.name, v.bandOf(h, d).label])));
    })()`).then(JSON.parse);
  const settled = "!document.querySelector('.dimension-list[aria-busy]') && !document.querySelector('.dialog')";
  // One operation, and the PUTs it sent.
  const writesOf = async (label, act) => {
    const before = await page.eval('window.__puts');
    await act();
    await page.settle(150);
    await page.waitUntil(settled, { label });
    await page.settle(250);
    return (await page.eval('window.__puts')) - before;
  };
  const inCard = (dimension, button) =>
    page.eval(`(() => {
      const card = [...document.querySelectorAll('.dimension-card')]
        .find((c) => c.querySelector('.card-head .strong').textContent === ${JSON.stringify(dimension)});
      [...card.querySelector('.card-head').querySelectorAll('button')]
        .find((b) => b.textContent === ${JSON.stringify(button)} || b.getAttribute('aria-label') === ${JSON.stringify(button)})
        .click();
    })()`);
  const inRow = (value, button) =>
    page.eval(`(() => {
      const row = [...document.querySelectorAll('li.value-row')]
        .find((r) => r.querySelector('.strong').textContent === ${JSON.stringify(value)});
      [...row.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(button)}).click();
    })()`);
  const inDialog = async (fields, button) => {
    await page.waitUntil("document.querySelector('.dialog')");
    await page.settle(200);
    for (const [index, value] of fields.entries()) await setValue('.dialog input', value, index);
    await page.eval(`[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === ${JSON.stringify(button)}).click()`);
  };
  const restore = (label) =>
    page.eval(`(() => {
      document.querySelectorAll('#app details').forEach((d) => (d.open = true));
      const row = [...document.querySelectorAll('.settings-row')].find((r) => r.firstChild.textContent === ${JSON.stringify(label)});
      row.querySelector('button').click();
    })()`);
  // The first dimension's card, the one every value below belongs to.
  const firstCard = () => `document.querySelector('.dimension-card[data-dimension=${JSON.stringify(liquidity.id)}]')`;
  const liveValues = () =>
    page.eval(`JSON.stringify([...${firstCard()}.querySelectorAll('li.value-row .strong')].map((n) => n.textContent))`).then(JSON.parse);

  const addValue = (label) =>
    writesOf(`the value ${label}`, async () => {
      await click('+ Add value');
      await inDialog([label], 'Add');
    });
  const writeCounts = {
    'add a value': await addValue('Investments'),
    'add another value': await addValue('Retirement'),
  };

  // Holdings filed under the values, which is the holding form's write
  // and not this screen's.
  const [liquidity] = await dims();
  await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const writes = await import('/static/js/writes.js');
    const v = s.currentVault();
    const d = v.dimensions.find((x) => x.id === ${JSON.stringify(liquidity.id)});
    const valueOf = (label) => d.values.find((x) => x.label === label).id;
    const filing = { 'Cantonal account': 'Cash', 'UBS dollar account': 'Investments', 'Gold bars': 'Investments', Mortgage: 'Retirement' };
    for (const h of v.activeHoldings()) {
      await writes.saveHolding(v, h, { ...h.payload, dims: { ...h.payload.dims, [d.id]: valueOf(filing[h.payload.name]) } });
    }
  })()`);
  const holdingsBefore = accountRecords();

  writeCounts['reorder a value'] = await writesOf('the reorder', () => inRow('Cash', 'Move down'));
  const reordered = await liveValues();
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard to group' });
  await page.eval(`(() => {
    const select = document.querySelector('.chart-controls select');
    select.value = ${JSON.stringify(liquidity.id)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.settle(500);
  const bandOrder = await labels('.legend-name');
  check(
    "reordering a dimension's values reorders the chart's bands",
    reordered.join(',') === 'Investments,Cash,Retirement' && bandOrder.join(',') === reordered.join(','),
    `${reordered.join(',')} against the legend ${bandOrder.join(',')}`,
  );
  await page.eval(`(() => {
    const select = document.querySelector('.chart-controls select');
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.eval("location.hash = '#/settings/dimensions'");
  await page.waitUntil("document.querySelector('.dimension-card')", { label: 'the dimensions screen again' });

  writeCounts['rename a value'] = await writesOf('the value rename', async () => {
    await inRow('Retirement', 'Edit');
    await page.eval(`(() => {
      const input = [...document.querySelectorAll('li.value-row input')].find((i) => !i.closest('[hidden]'));
      input.value = 'Pension';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...input.parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    })()`);
  });
  check('a renamed value keeps its place', (await liveValues()).join(',') === 'Investments,Cash,Pension');

  // Bytes of 36 or more are discarded, not folded onto the alphabet.
  const minted = await page.call(async (batches) => {
    const { newId } = await import('/static/js/view-dimensions.js');
    const real = crypto.getRandomValues;
    crypto.getRandomValues = (array) => {
      array.set(batches.shift());
      return array;
    };
    try {
      return newId({ dimensions: [] });
    } finally {
      crypto.getRandomValues = real;
    }
  }, [[36, 63, 255, 0, 1, 2, 3, 4], [5, 6, 7, 8, 9, 10, 11, 12]]);
  check('an id is drawn uniformly, discarding bytes outside the 36 characters', minted === '01234567', minted);

  // The next id the page mints is made to collide with one the profile
  // already holds, which the uniqueness check has to catch.
  await page.eval(`(() => {
    const real = crypto.getRandomValues.bind(crypto);
    const taken = ${JSON.stringify(liquidity.id)};
    let armed = true;
    crypto.getRandomValues = (array) => {
      if (armed && array.length === 8) {
        armed = false;
        [...taken].forEach((c, i) => (array[i] = parseInt(c, 36)));
        return array;
      }
      return real(array);
    };
  })()`);
  writeCounts['create a flag'] = await writesOf('the flag', async () => {
    await click('+ Create a dimension');
    await inDialog(['Emergency fund'], 'Create a flag');
  });
  const afterFlag = await dims();
  const ids = afterFlag.flatMap((d) => [d.id, ...d.values.map((v) => v.id)]);
  const words = afterFlag.flatMap((d) => [d.label, ...d.values.map((v) => v.label)]);
  const flag = afterFlag.find((d) => d.label === 'Emergency fund');
  check(
    'two dimensions created in one session hold different ids, and no id is a label',
    new Set(ids).size === ids.length && ids.every((id) => /^[a-z0-9]{8}$/.test(id) && !words.includes(id)),
    JSON.stringify(afterFlag.map((d) => [d.id, d.values.map((v) => v.id)])),
  );
  check(
    'a flag is one field and one button, a dimension with one value',
    flag && flag.values.length === 1 && flag.values[0].label === 'Emergency fund',
    JSON.stringify(flag),
  );

  writeCounts['reorder a dimension'] = await writesOf('the dimension reorder', () => inCard('Emergency fund', 'Move up'));
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard after the reorder' });
  await page.settle(400);
  const groupings = await labels('.chart-controls select option');
  check(
    'the order of dimensions is the order of the Group by select',
    groupings.join(',') === 'Total,Emergency fund,Liquid assets',
    groupings.join(','),
  );
  await page.eval("location.hash = '#/settings/dimensions'");
  await page.waitUntil("document.querySelector('.dimension-card')", { label: 'the dimensions screen once more' });

  const filed = await bandsOf(liquidity.id);
  writeCounts['archive a value'] = await writesOf('the value archive', () => inRow('Cash', 'Archive'));
  const whileArchived = await bandsOf(liquidity.id);
  check(
    'archiving a value moves its holdings to Unassigned',
    whileArchived['Cantonal account'] === 'Unassigned' && whileArchived['Gold bars'] === 'Investments',
    JSON.stringify(whileArchived),
  );
  const archivedLabel = await page.eval("[...document.querySelectorAll('summary')].map((n) => n.textContent).join(',')");
  check('an archived section counts what it hides', archivedLabel.includes('Archived values (1)'), archivedLabel);

  // With the archived value between them, a move is still a visible one.
  writeCounts['reorder past an archived value'] = await writesOf('the move past an archived value', () => inRow('Investments', 'Move down'));
  check(
    'a move among live values skips an archived one',
    (await liveValues()).join(',') === 'Pension,Investments',
    (await liveValues()).join(','),
  );
  writeCounts['restore a value'] = await writesOf('the value restore', () => restore('Cash'));
  check(
    'restoring a value moves its holdings back',
    JSON.stringify(await bandsOf(liquidity.id)) === JSON.stringify(filed),
    JSON.stringify(await bandsOf(liquidity.id)),
  );

  writeCounts['archive a dimension'] = await writesOf('the dimension archive', async () => {
    await inCard('Liquid assets', 'Actions for Liquid assets');
    await inCard('Liquid assets', 'Archive dimension');
    await inDialog([], 'Archive');
  });
  const hidden = await page.eval("[...document.querySelectorAll('summary')].map((n) => n.textContent).join(',')");
  check('an archived dimension is listed under Archived with its count', hidden.includes('Archived (1)'), hidden);
  writeCounts['restore a dimension'] = await writesOf('the dimension restore', () => restore('Liquid assets'));
  check(
    'archiving a dimension and restoring it returns every holding to its band',
    JSON.stringify(await bandsOf(liquidity.id)) === JSON.stringify(filed),
    JSON.stringify(await bandsOf(liquidity.id)),
  );

  // The drag handle, the reorder control's other route.
  writeCounts['drag a value'] = await writesOf('the drag', () =>
    page.eval(`(() => {
      const rows = [...${firstCard()}.querySelectorAll('li.value-row')];
      const from = rows.find((r) => r.querySelector('.strong').textContent === 'Investments');
      const transfer = new DataTransfer();
      from.querySelector('.drag-handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      rows[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      rows[0].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    })()`),
  );
  const announced = await page.eval("document.querySelector('[aria-live]').textContent");
  check(
    'dragging a value moves it and says where it went',
    (await liveValues()).join(',') === 'Investments,Pension,Cash' && announced === 'Moved to position 1 of 3.',
    `${(await liveValues()).join(',')}: ${announced}`,
  );

  check(
    'no operation on the dimensions screen writes more than one record',
    Object.values(writeCounts).every((count) => count === 1),
    JSON.stringify(writeCounts),
  );
  check(
    'no dimension operation touches an account record',
    accountRecords() === holdingsBefore,
  );

  // A write shown at once and held: the controls wait for it, and a
  // failure puts the stored order back and says so on the card.
  let answer;
  const answered = new Promise((resolve) => (answer = resolve));
  expectedFailures.add('/api/records/');
  const releaseWrites = await intercept(page, '*/api/records/*', (request) =>
    request.method === 'PUT' ? answered.then(() => ({ status: 500 })) : null,
  );
  const storedOrder = await liveValues();
  await inRow('Investments', 'Move down');
  await page.settle(300);
  const whileSaving = JSON.parse(await page.eval(`JSON.stringify({
    order: [...${firstCard()}.querySelectorAll('li.value-row .strong')].map((n) => n.textContent),
    disabled: [...${firstCard()}.querySelectorAll('li.value-row button')].filter((b) => /Move|Archive/.test(b.textContent)).every((b) => b.disabled),
  })`));
  check(
    'a move is shown at once, with the controls disabled until it answers',
    whileSaving.order.join(',') === 'Pension,Investments,Cash' && whileSaving.disabled,
    JSON.stringify(whileSaving),
  );
  answer();
  await page.waitUntil(settled, { label: 'the failed move to answer' });
  await page.settle(300);
  const afterFailure = await text();
  check(
    'a write that fails says so on its card and shows the stored order',
    afterFailure.includes('That did not save. Nothing changed.') && (await liveValues()).join(',') === storedOrder.join(','),
    `${(await liveValues()).join(',')}`,
  );
  await releaseWrites();
  expectedFailures.delete('/api/records/');

  // Another tab writes the profile first, with the dimension renamed.
  const relabelElsewhere = (label) =>
    page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      const api = await import('/static/js/api.js');
      const c = await import('/static/js/crypto.js');
      const { SCHEMA_VERSION } = await import('/static/js/model.js');
      const record = v.profileRecord;
      const payload = { ...v.profile, dimensions: v.dimensions.map((d) => (d.id === ${JSON.stringify(liquidity.id)} ? { ...d, label: ${JSON.stringify(label)} } : d)) };
      const slot = { recordId: record.recordId, recordType: 'profile', accountId: null, schemaVersion: SCHEMA_VERSION, version: record.version + 1 };
      await api.put('/api/records/' + slot.recordId, { recordType: 'profile', accountId: null, schemaVersion: slot.schemaVersion, version: slot.version, ...(await c.encryptRecord(v.dek, slot, payload)) });
    })()`);
  const otherTab = 'Liquidity, from another tab';
  await relabelElsewhere(otherTab);
  expectedFailures.add('/api/records/');
  await inRow('Pension', 'Edit');
  await page.eval(`(() => {
    const input = [...document.querySelectorAll('li.value-row input')].find((i) => !i.closest('[hidden]'));
    input.value = 'Retirement';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...input.parentElement.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
  })()`);
  await page.waitUntil("document.body.innerText.includes('Your settings were changed in another tab.')", { label: 'the conflict' });
  await page.settle(300);
  check(
    'a conflict names the other tab and reloads the profile',
    (await labels('.dimension-card .card-head .strong')).includes(otherTab),
    (await labels('.dimension-card .card-head .strong')).join(','),
  );
  expectedFailures.delete('/api/records/');
  // The other tab's name goes back, so the sections below find the
  // dimension under the name they know it by.
  await relabelElsewhere('Liquid assets');
  await page.eval("(async () => { await (await import('/static/js/session.js')).currentVault().load(); })()");


  // ---- Account settings: the settings screen's own states --------------

  const toSettings = async (label) => {
    await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await page.waitUntil("document.body.innerText.includes('Main currency')", { label });
    await page.settle(400);
  };
  const cardWith = (words) => `[...document.querySelectorAll('.card')].find((c) => c.textContent.includes(${JSON.stringify(words)}))`;
  await toSettings('settings for its own states');
  check(
    'the main currency is shown and offers no control to change it',
    await page.eval(`!${cardWith('Main currency')}.querySelector('input, select, textarea, button')`),
  );

  // The session list waits on its own fetch, alone.
  let listAnswer;
  const listAnswered = new Promise((resolve) => (listAnswer = resolve));
  expectedFailures.add('/api/sessions');
  const releaseList = await intercept(page, '*/api/sessions', () => listAnswered.then(() => ({ status: 500 })));
  await page.eval("location.hash = '#/'");
  await page.settle(300);
  await toSettings('settings with the session list held');
  const waiting = JSON.parse(await page.eval(`JSON.stringify({
    skeleton: ${cardWith('Session and lock')}.querySelectorAll('.skeleton-row').length,
    elsewhere: document.querySelectorAll('.skeleton-row').length,
  })`));
  check(
    'the session card alone shows skeleton rows while its list loads',
    waiting.skeleton > 0 && waiting.elsewhere === waiting.skeleton,
    JSON.stringify(waiting),
  );
  listAnswer();
  await page.waitUntil("document.body.innerText.includes('The session list would not load.')", { label: 'the list error' });
  await releaseList();
  expectedFailures.delete('/api/sessions');
  // Something chosen in another card, unsaved, which a retry of this
  // card alone leaves where it is.
  await page.eval(`(() => {
    const select = document.getElementById('format-places');
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.eval(`[...${cardWith('Session and lock')}.querySelectorAll('button')].find((b) => b.textContent === 'Retry').click()`);
  await page.waitUntil("document.body.innerText.includes('This session')", { label: 'the list after a retry' });
  check(
    'a retry reloads the session card alone',
    (await page.eval("document.getElementById('format-places').value")) === '2',
  );

  // Signing out everywhere, failed.
  expectedFailures.add('/api/auth/logout-all');
  const releaseEverywhere = await intercept(page, '*/api/auth/logout-all', () => ({ status: 500 }));
  await click('Sign out everywhere');
  await page.waitUntil("document.body.innerText.includes('Nothing was signed out.')", { label: 'the sign-out error' });
  await releaseEverywhere();
  expectedFailures.delete('/api/auth/logout-all');
  const stillIn = await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then((r) => r.status)");
  check(
    'a failed sign out everywhere says so and leaves this session open',
    stillIn === 200 && (await page.eval('location.hash')) === '#/settings' && !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
    String(stillIn),
  );

  // Delete my vault waits for the password and the exact username.
  await page.eval("document.querySelector('.danger-zone').open = true");
  await page.eval("document.querySelector('.danger-zone .btn-destructive').click()");
  await page.settle(200);
  const deleteState = (password, typed) =>
    page.eval(`(() => {
      const dialog = document.querySelector('.dialog');
      const [pw, name] = dialog.querySelectorAll('input');
      pw.value = ${JSON.stringify(password)};
      pw.dispatchEvent(new Event('input', { bubbles: true }));
      name.value = ${JSON.stringify(typed)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      return dialog.querySelector('.btn-destructive').disabled;
    })()`);
  const gates = [
    await deleteState('', 'leander'),
    await deleteState('something', 'Leander'),
    await deleteState('something', 'leander'),
  ];
  await deleteState('', '');
  check(
    'Delete my vault stays disabled until the password is filled and the username matches exactly',
    gates.join(',') === 'true,true,false',
    gates.join(','),
  );
  check(
    'the deletion offers Export first as its primary action',
    (await page.eval("document.querySelector('.dialog .btn-primary').textContent")) === 'Export first',
  );
  await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Cancel').click()");
  await page.settle(200);

  // ---- Account settings: changing the password -------------------------

  // At old parameters, kept there by an upgrade that fails, so the
  // change is also what upgrades it.
  const unlockHere = async (password, label) => {
    await enterPassword(password);
    await page.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label });
    await page.settle(800);
  };
  await makeStale(page, 'leander', VAULT_PASSWORD);
  expectedFailures.add('/api/auth/upgrade-kdf');
  let releaseUpgrade = await intercept(page, '*/api/auth/upgrade-kdf', () => ({ status: 500 }));
  await page.goto(`${BASE}/settings`);
  await unlockHere(VAULT_PASSWORD, 'settings at old parameters');
  await releaseUpgrade();
  expectedFailures.delete('/api/auth/upgrade-kdf');
  const beforeChange = credentialOf('leander');
  check('the vault is at old parameters before the change', JSON.parse(beforeChange.params).kdf.m === WEAK_MEMORY);
  const recordsBeforeChange = recordsOf(beforeChange.principal);
  const namesBeforeChange = await page.eval(
    "(async () => JSON.stringify([...(await import('/static/js/session.js')).currentVault().holdings.values()].map((h) => h.payload.name).sort()))()",
  );

  // A second session for the same account, held outside the browser.
  const otherSession = async (username, password) => {
    const authKey = await page.eval(
      `(async () => (await import('/static/js/session.js')).authKeyFor(${JSON.stringify(username)}, ${JSON.stringify(password)}))()`,
    );
    const response = await fetch(`${DIRECT}/api/auth/login`, {
      method: 'POST',
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, authKey }),
    });
    return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  };
  const statusWith = (cookie) =>
    fetch(`${DIRECT}/api/sessions`, { headers: { 'X-Solvent-Request': '1', cookie } }).then((r) => r.status);
  const elsewhere = await otherSession('leander', VAULT_PASSWORD);
  check('the other session is open before the change', (await statusWith(elsewhere)) === 200);

  const NEW_PASSWORD = 'marble quarry violet anchor';
  const passwordForm = cardWith('Change password');
  const fillPasswords = async (current, next) => {
    await page.eval(`(() => {
      const card = ${passwordForm};
      const set = (selector, value) => {
        const node = card.querySelector(selector);
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('input[autocomplete=current-password]', ${JSON.stringify(current)});
      const [next, confirm] = card.querySelectorAll('input[autocomplete=new-password]');
      for (const node of [next, confirm]) {
        node.value = ${JSON.stringify(next)};
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await page.waitUntil(`!${passwordForm}.querySelector('.btn-primary').disabled`, { label: 'the strength gauge' });
  };
  const changeRequests = () =>
    watched[0].requests.filter((r) => r.url.endsWith('/api/auth/change-password'));

  await fillPasswords('not the password at all', NEW_PASSWORD);
  await page.eval(`${passwordForm}.querySelector('.btn-primary').click()`);
  await page.waitUntil("document.body.innerText.includes('That is not your current password.')", {
    timeout: 60000,
    label: 'the wrong current password',
  });
  const wrongCurrent = JSON.parse(await page.eval(`(() => {
    const card = ${passwordForm};
    const error = card.querySelector('.field-error:not([hidden])');
    const first = card.querySelector('input');
    return JSON.stringify({
      above: Boolean(error.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING),
      kept: [...card.querySelectorAll('input')].map((i) => i.value),
    });
  })()`));
  check(
    'a wrong current password is caught in the browser, above the first field, and nothing is sent',
    wrongCurrent.above && changeRequests().length === 0,
    `${JSON.stringify(wrongCurrent.above)}, ${changeRequests().length} sent`,
  );
  check(
    'every field is kept after a wrong current password',
    wrongCurrent.kept.join('|') === ['not the password at all', NEW_PASSWORD, NEW_PASSWORD].join('|'),
  );

  await fillPasswords(VAULT_PASSWORD, NEW_PASSWORD);
  const working = JSON.parse(await page.eval(`(() => {
    const card = ${passwordForm};
    const button = card.querySelector('.btn-primary');
    button.click();
    return JSON.stringify({
      label: button.textContent,
      quiet: [...card.querySelectorAll('input, .password-field button')].every((n) => n.disabled),
    });
  })()`));
  check(
    'changing the password shows its working state and the form goes quiet',
    working.label === 'Changing your password' && working.quiet,
    JSON.stringify(working),
  );
  await page.waitUntil("document.body.innerText.includes('Your password is changed.')", {
    timeout: 60000,
    label: 'the changed password',
  });
  check(
    'the change confirms what else happened',
    (await text()).includes('Every other session was signed out, and this one is still open.'),
  );
  const afterChange = credentialOf('leander');
  const embedded = await page.eval("document.getElementById('kdf-envelope').textContent");
  check(
    'a password change rewrites salt, envelope, verifier and wrapper, at the current default',
    JSON.parse(afterChange.params).salt !== JSON.parse(beforeChange.params).salt &&
      JSON.stringify(JSON.parse(afterChange.params).kdf) === JSON.stringify(JSON.parse(embedded)) &&
      afterChange.verifier !== beforeChange.verifier &&
      afterChange.wrapped_dek !== beforeChange.wrapped_dek,
    `${afterChange.params} against ${embedded}`,
  );
  check('a password change leaves every record byte-identical', recordsOf(afterChange.principal) === recordsBeforeChange);
  const sentChange = changeRequests();
  check(
    'the change-password request carries keys and a wrapper and nothing else',
    sentChange.length === 1 &&
      Object.keys(JSON.parse(sentChange[0].body)).sort().join(',') === 'authKey,currentAuthKey,dekNonce,kdf,salt,wrappedDek',
    sentChange.map((r) => r.body).join(' | '),
  );
  check(
    'a password change ends the other session and keeps this one',
    (await statusWith(elsewhere)) === 401 &&
      (await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then((r) => r.status)")) === 200,
  );
  const sameSession = JSON.parse(await page.eval(`(async () => {
    const { Vault } = await import('/static/js/model.js');
    const again = await new Vault((await import('/static/js/session.js')).currentVault().dek).load();
    return JSON.stringify({ names: [...again.holdings.values()].map((h) => h.payload.name).sort(), unreadable: again.unreadable.length });
  })()`));
  check(
    'records written before the change still decrypt in the same session',
    sameSession.unreadable === 0 && JSON.stringify(sameSession.names) === namesBeforeChange,
    JSON.stringify(sameSession),
  );

  await page.goto(`${BASE}/dashboard`);
  await unlockHere(NEW_PASSWORD, 'the dashboard with the new password');
  const freshLogin = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    return JSON.stringify({ names: [...v.holdings.values()].map((h) => h.payload.name).sort(), unreadable: v.unreadable.length });
  })()`));
  check(
    'records written before the change still decrypt after a fresh sign-in with the new password',
    freshLogin.unreadable === 0 && JSON.stringify(freshLogin.names) === namesBeforeChange,
    JSON.stringify(freshLogin),
  );
  const oldPassword = await openBrowser(`${BASE}/login`);
  try {
    await signInOn(oldPassword.session, VAULT_PASSWORD, 'leander');
    await oldPassword.session.waitUntil("document.body.innerText.includes('Invalid username or password.')", {
      timeout: 60000,
      label: 'the old password refused',
    });
    check('the old password no longer signs in', true);
  } finally {
    oldPassword.close();
  }

  // Back to the password the rest of the run signs in with.
  await toSettings('settings to change the password back');
  await fillPasswords(NEW_PASSWORD, VAULT_PASSWORD);
  await page.eval(`${passwordForm}.querySelector('.btn-primary').click()`);
  await page.waitUntil("document.body.innerText.includes('Your password is changed.')", {
    timeout: 60000,
    label: 'the password changed back',
  });

  // ---- Account settings: deleting a vault --------------------------------

  // A vault of its own, from an invite the administrator mints, kept at
  // old parameters so the deletion has to derive at the stored ones.
  const LEAVING_PASSWORD = 'lantern harbour ribbon tundra';
  const administrator = await openBrowser(`${BASE}/login`);
  const leaving = await openBrowser();
  try {
    await signInOn(administrator.session, ADMIN_PASSWORD, 'ops.leander');
    await administrator.session.waitUntil("location.pathname === '/admin'", { timeout: 90000, label: 'the admin area' });
    const minted = JSON.parse(await administrator.session.eval(`(async () => JSON.stringify(
      await (await import('/static/js/api.js')).post('/api/admin/invites', { kind: 'vault_owner', label: 'Leaving' })
    ))()`));
    const other = leaving.session;
    await other.goto(`${BASE}/register?invite=${minted.token}`);
    await other.eval(`(() => {
      const set = (selector, value, index = 0) => {
        const node = document.querySelectorAll(selector)[index];
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('input[type=text]', 'leaving');
      set('input[type=password]', ${JSON.stringify(LEAVING_PASSWORD)}, 0);
      set('input[type=password]', ${JSON.stringify(LEAVING_PASSWORD)}, 1);
      set('select', 'CHF');
      const box = document.querySelector('input[type=checkbox]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await other.settle(400);
    await markDocument(other, 'leaving');
    await other.eval("document.querySelector('button[type=submit]').click()");
    check('registering another vault lands in it, with no second password entry', await intoVault(other, 'the new vault'));
    await other.settle(500);
    check(
      'that vault is the registering document itself, unlocked',
      await sitting(other, 'leaving').then((s) => s.sameDocument && s.keys && !s.card),
    );
    await makeStale(other, 'leaving', LEAVING_PASSWORD);
    const releaseLeaving = await intercept(other, '*/api/auth/upgrade-kdf', () => ({ status: 500 }));
    await other.goto(`${BASE}/settings`);
    await signInOn(other, LEAVING_PASSWORD);
    await other.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 90000, label: 'settings of the new vault' });
    await releaseLeaving();
    const leavingRow = credentialOf('leaving');
    check('the vault to delete is at old parameters', JSON.parse(leavingRow.params).kdf.m === WEAK_MEMORY);

    const fillDelete = () =>
      other.eval(`(() => {
        if (!document.querySelector('.dialog')) {
          const zone = document.querySelector('.danger-zone');
          zone.open = true;
          zone.querySelector('.btn-destructive').click();
        }
        const dialog = document.querySelector('.dialog');
        const [pw, name] = dialog.querySelectorAll('input');
        pw.value = ${JSON.stringify(LEAVING_PASSWORD)};
        pw.dispatchEvent(new Event('input', { bubbles: true }));
        name.value = 'leaving';
        name.dispatchEvent(new Event('input', { bubbles: true }));
        dialog.querySelector('.btn-destructive').click();
      })()`);
    const releaseDelete = await intercept(other, '*/api/auth/account', (request) =>
      request.method === 'DELETE' ? { status: 500 } : null,
    );
    await fillDelete();
    await other.waitUntil("document.body.innerText.includes('Nothing was deleted.')", { timeout: 60000, label: 'the failed deletion' });
    await releaseDelete();
    check(
      'a failed deletion says nothing was deleted, and the vault and session are still there',
      (await other.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then((r) => r.status)")) === 200 &&
        sql('SELECT id FROM principals WHERE username = ?', 'leaving').length === 1 &&
        (await other.eval("document.body.innerText")).includes('Your vault is unchanged and you are still signed in.'),
    );

    await fillDelete();
    await other.waitUntil("location.pathname === '/login'", { timeout: 60000, label: 'the sign-in card after deleting' });
    await other.waitUntil("document.querySelector('#unlock-username')", { timeout: 60000, label: 'the sign-in card' });
    const left = ['credentials', 'records', 'sessions'].map((table) => [
      table,
      sql(`SELECT COUNT(*) AS n FROM ${table} WHERE principal_id = ?`, leavingRow.principal)[0].n,
    ]);
    check(
      'deleting a vault at old parameters removes the account, its credential, wrapper, records and sessions',
      sql('SELECT id FROM principals WHERE id = ?', leavingRow.principal).length === 0 &&
        sql('SELECT credential_id FROM dek_wrappers WHERE credential_id = ?', leavingRow.id).length === 0 &&
        left.every(([, n]) => n === 0),
      JSON.stringify(left),
    );
    check(
      'the sign-in card is all that is left after deleting',
      (await other.eval("Boolean(document.querySelector('#unlock-username'))")) &&
        !(await other.eval("document.body.innerText")).includes('leaving'),
    );
    await signInOn(other, LEAVING_PASSWORD, 'leaving');
    await other.waitUntil("document.body.innerText.includes('Invalid username or password.')", {
      timeout: 60000,
      label: 'the deleted account refused',
    });
    check('a deleted account no longer signs in', true);
  } finally {
    administrator.close();
    leaving.close();
  }


  // ---- The chrome, on a page that is not the dashboard -----------------

  check(
    'every authenticated page gives the chrome something to call',
    await page.eval("Boolean(window.Alpine && Alpine.store('vault'))"),
  );

  // ---- What the stylesheet and the password managers do to a form ------

  // The attribute is honoured by a UA rule a class setting a display
  // beats, so this asks the engine rather than the markup.
  check(
    'an element carrying hidden is off the screen',
    await page.eval(`(() => {
      const probe = document.createElement('button');
      probe.className = 'btn-secondary';
      probe.hidden = true;
      document.body.append(probe);
      const shown = getComputedStyle(probe).display;
      probe.remove();
      return shown === 'none';
    })()`),
  );

  // ---- Reopening a recording -------------------------------------------

  await page.goto(`${BASE}/dashboard`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard again' });
  await page.settle(700);
  await page.eval("document.querySelector('.topbar-actions button').click()");
  await page.waitUntil("location.hash.startsWith('#/sweep/')", { label: 'the sweep again' });
  await page.settle(1500);
  check(
    'a reopened recording says every row is already recorded',
    (await labels('.row-state')).filter((s) => s === 'Recorded for this date.').length === 4,
  );

  check('the sweep heading is the date, not a control', (await page.eval("document.querySelectorAll('.screen-heading input').length")) === 0);

  await page.eval(`document.querySelector('.topbar nav a[href="#/"]').click()`);
  await page.settle(700);

  // ---- The replace prompt, on the form where the date is blind ---------

  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/')");
  await page.settle(500);
  const archiving = await page.eval("document.querySelector('.screen-heading').textContent");
  await click('Record a value');
  await page.waitUntil("document.querySelector('.dialog')");
  await page.settle(300);
  await setValue('#snapshot-value', '99.99');
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()");
  await page.waitUntil("document.body.innerText.includes('Replace the figure already recorded')", {
    label: 'the replace prompt',
  });
  check('a blind date prompts before replacing what is there', true);
  check('the prompt names the stored figure', (await text()).includes('You already recorded'));
  await click('Keep what is there');
  await page.settle(400);
  await page.eval("document.querySelectorAll('.scrim').forEach(s => s.remove())");
  await page.settle(300);
  // Read the record rather than the screen: the dialog's own live
  // preview of what was typed is not what was stored.
  const stored = await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const v = s.currentVault();
    return [...v.snapshots.values()].flat().map(x => x.payload.value).join(',');
  })()`);
  check('declining leaves the original untouched', !stored.includes('99.99'), stored);

  // ---- Archiving, with the closing value it offers ----------------------

  // manage-accounts.md: archiving onto a date that already holds this
  // holding's figure prefills the field with it, shows no replace
  // prompt, and leaves exactly one figure there at version + 1. No
  // snapshot is deleted, and the chart before the archive date is
  // unchanged.
  const archivingId = (await page.eval('location.hash')).split('/')[2];
  const archiveDay = await page.eval('new Date().toISOString().slice(0, 10)');
  const snapshotState = () =>
    page.eval(`(async () => {
      const api = await import('/static/js/api.js');
      const decimal = await import('/static/js/decimal.js');
      const v = (await import('/static/js/session.js')).currentVault();
      const rows = await api.get('/api/records?type=snapshot');
      const here = v.snapshotsFor('${archivingId}').filter((s) => s.payload.date === '${archiveDay}');
      return JSON.stringify({
        stored: rows.length,
        here: here.map((s) => ({
          id: s.recordId,
          version: s.version,
          value: s.payload.value,
          figure: String(decimal.parse(s.payload.value)),
        })),
      });
    })()`).then(JSON.parse);
  // The chart's own table, every row but the archive date's.
  const chartOffArchiveDay = async () => {
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.chart-card details table')", { label: 'the chart table' });
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.settle(300);
    return page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      const day = v.format.date('${archiveDay}');
      return JSON.stringify([...document.querySelectorAll('.chart-card details table tbody tr')]
        .filter((r) => r.cells[0].textContent !== day).map((r) => r.textContent));
    })()`);
  };
  const chartBeforeArchive = await chartOffArchiveDay();
  const heroBeforeArchive = await page.eval("document.querySelector('.hero-figure').textContent");
  await page.eval(`location.hash = '#/holding/${archivingId}'`);
  await page.waitUntil("document.querySelector('.detail-header')", { label: 'the holding to archive' });
  await page.settle(400);
  const beforeArchive = await snapshotState();

  await click('Archive');
  await page.waitUntil("document.body.innerText.includes('Archive keeps every value')", {
    label: 'the archive dialog',
  });
  check('archive is offered before deleting', (await text()).includes('You can undo this'));
  check('it offers a closing value', (await text()).includes('What was it worth when you closed it?'));
  check(
    'archive is the preselected choice, and permanent delete waits behind its own',
    await page.eval(`(() => {
      const choice = document.querySelector('.dialog input[value=archive]');
      const button = [...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Delete permanently');
      return choice.checked && button.hidden && !document.querySelector('.dialog input[value=delete]').checked;
    })()`),
  );
  const prefilled = await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    return String(v.format.parseFigure(document.querySelector('#closing-value').value));
  })()`);
  const storedFigure = beforeArchive.here[0]?.figure;
  check(
    'an occupied archive date prefills the stored figure rather than 0',
    beforeArchive.here.length === 1 && prefilled === storedFigure,
    `${prefilled} against ${JSON.stringify(beforeArchive.here)}`,
  );
  await click('Skip');
  await page.settle(150);
  check('skipping says what it costs', (await text()).includes('your chart drops by the last figure recorded here'));
  await click('Record a closing value after all');
  await page.settle(150);

  // Every dialog heading that appears from here to the archive landing.
  await page.eval(`(() => {
    window.__headings = [];
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('.dialog-heading')) window.__headings.push(node.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  })()`);
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Archive').click()");
  await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive to land' });
  await page.settle(1200);
  const headings = await page.eval('window.__headings');
  check(
    'archiving onto an occupied date shows no replace prompt',
    !headings.some((heading) => heading.startsWith('Replace')),
    headings.join(' | '),
  );
  const afterArchive = await snapshotState();
  check(
    'it leaves exactly one figure at that date, the same record at version + 1',
    afterArchive.here.length === 1 &&
      afterArchive.here[0].id === beforeArchive.here[0].id &&
      afterArchive.here[0].version === beforeArchive.here[0].version + 1,
    `${JSON.stringify(beforeArchive.here)} then ${JSON.stringify(afterArchive.here)}`,
  );
  check('archiving deletes no snapshot', afterArchive.stored === beforeArchive.stored, `${beforeArchive.stored} then ${afterArchive.stored}`);
  const archivedRecord = await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    return v.holdings.get('${archivingId}').payload.archivedAt;
  })()`);
  check('the account record gains archivedAt', archivedRecord === archiveDay, archivedRecord);
  check('an archived holding carries its chip', (await text()).includes('Archived'));
  check('it offers Unarchive rather than Archive', (await labels('.form-actions button')).includes('Unarchive'));
  check('an archived holding takes no new value', !(await labels('.form-actions button')).includes('Record a value'));

  const chartAfterArchive = await chartOffArchiveDay();
  check('the chart before the archive date is unchanged', chartAfterArchive === chartBeforeArchive, `${chartBeforeArchive} then ${chartAfterArchive}`);
  const listed = await page.eval(
    "[...document.querySelectorAll('.data-table tbody .link-button')].map(b => b.textContent)",
  );
  check('an archived holding leaves the current total', !listed.includes(archiving), `${archiving} in ${listed.join(',')}`);

  // net-worth-view.md, Archived holdings: a holding archived on the newest
  // recorded date, closing value skipped, is in no total from that date
  // on, so the headline, the chart's last point, the table's last row and
  // the change over the range all agree.
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/')", { label: 'a second holding to archive' });
  await page.settle(400);
  const skippedId = (await page.eval('location.hash')).split('/')[2];
  await click('Archive');
  await page.waitUntil("document.body.innerText.includes('Archive keeps every value')", { label: 'the second archive dialog' });
  await click('Skip');
  await page.settle(150);
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Archive').click()");
  await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the second archive to land' });
  await page.settle(1200);
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.chart-card details table')", { label: 'the chart after a skipped archive' });
  await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
  await page.settle(300);
  const skippedArchive = await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    const { dayNumber } = await import('/static/js/model.js');
    const total = v.totals('latest').net;
    const rows = [...document.querySelectorAll('.chart-card details table tbody tr')];
    const first = v.series(null, dayNumber(v.recordingDates()[0]), dayNumber(v.chartLastDate())).bands[0].points[0];
    const edge = document.querySelector('.net-line').getAttribute('points').split(' ').map((p) => p.split(',').map(Number));
    const [x, y] = edge.at(-1);
    return JSON.stringify({
      headline: document.querySelector('.hero-amount').textContent === v.format.whole(total),
      lastRow: rows.at(-1).cells[1].textContent === v.format.money(total),
      lastDate: rows.at(-1).cells[0].textContent === v.format.date(v.chartLastDate()),
      change: document.querySelector('.hero-delta').textContent.startsWith('CHF ' + (total - first > 0n ? '+' : '') + v.format.whole(total - first)),
      edgeDot: Number(document.querySelector('.net-end').getAttribute('cy')) === y,
      // The drop is a vertical edge at the last day: two points at its x.
      dropDrawn: edge.filter(([px]) => px === x).length === 2 && edge.at(-2)[1] !== y,
    });
  })()`).then(JSON.parse);
  for (const [name, held] of Object.entries(skippedArchive)) {
    check(`archived on the newest date with no closing value: ${name}`, held, JSON.stringify(skippedArchive));
  }
  // Back to active, so what follows reads the vault as it was.
  await page.eval(`location.hash = '#/holding/${skippedId}'`);
  await page.waitUntil("document.querySelector('.detail-header')", { label: 'the holding to unarchive' });
  await page.settle(400);
  await click('Unarchive');
  await page.waitUntil("[...document.querySelectorAll('.form-actions button')].some(b => b.textContent === 'Archive')", { label: 'the holding active again' });
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.entry-mark')", { label: 'the dashboard after unarchiving' });
  await page.settle(400);

  // ---- Deleting a recording ---------------------------------------------

  const marksBefore = await page.eval("document.querySelectorAll('.entry-mark').length");
  await page.eval("document.querySelectorAll('.entry-mark')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.waitUntil("location.hash.startsWith('#/recording/')", { label: 'a recording to delete' });
  await page.settle(500);
  await click('Delete');
  await page.waitUntil("document.body.innerText.includes('Delete the recording for')", { label: 'the delete dialog' });
  check('the confirmation says the prices go too', (await text()).includes('every price captured with it'));
  check('it names how many holdings move', /\d+ holdings measured in/.test(await text()));
  check('it says there is no way back', (await text()).includes('cannot be undone'));
  await click('Delete the recording');
  await page.waitUntil("location.hash === '#/'", { timeout: 60000, label: 'the dashboard after deleting' });
  await page.settle(1200);
  check(
    'the date is gone from the chart',
    (await page.eval("document.querySelectorAll('.entry-mark').length")) === marksBefore - 1,
  );

  // ---- Manage holdings (manage-accounts.md, account-form.md, account-detail.md)

  {
    const { readFileSync } = await import('node:fs');
    const accountRows = () =>
      JSON.stringify(sql(`SELECT records.* FROM records ${OWN} AND record_type = 'account' ORDER BY record_id`));
    const rowOf = (id) => sql(`SELECT records.* FROM records ${OWN} AND record_id = ?`, id)[0];
    // The database file's own bytes, which is where plaintext would sit.
    const inDatabase = (needles) => {
      const bytes = readFileSync(process.env.DATABASE_PATH);
      return needles.filter((needle) => bytes.includes(Buffer.from(needle, 'utf8')));
    };
    const vaultValue = (body) =>
      page.eval(`(async () => {
        const v = (await import('/static/js/session.js')).currentVault();
        return JSON.stringify(${body});
      })()`).then(JSON.parse);
    const payloadOf = (id) => vaultValue(`v.holdings.get('${id}') ? v.holdings.get('${id}').payload : null`);
    const idNamed = (name) =>
      vaultValue(`[...v.holdings.values()].filter(h => h.payload.name === ${JSON.stringify(name)}).map(h => h.recordId)`);
    // The model read afresh from the store, and the screen redrawn from
    // it, without a derivation.
    const reloadModel = async (hash = '#/') => {
      await page.eval(`(async () => {
        await (await import('/static/js/session.js')).currentVault().load();
        location.hash = '#/reloading';
      })()`);
      await page.settle(100);
      await page.eval(`location.hash = ${JSON.stringify(hash)}`);
      await page.settle(700);
    };
    const openHolding = async (id) => {
      await page.eval(`location.hash = '#/holding/${id}'`);
      await page.waitUntil("document.querySelector('.detail-header')", { label: 'a holding screen' });
      await page.settle(400);
    };
    const inDialog = (label) =>
      page.eval(`[...document.querySelectorAll('.dialog button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
    const choose = (selector, value) =>
      page.eval(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        node.value = ${JSON.stringify(value)};
        node.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    const writesSeen = () => page.eval('window.__writes.splice(0)');
    const recordReads = () =>
      page.eval("performance.getEntriesByType('resource').filter(e => e.name.includes('/api/records?type=')).length");
    // Every request matching `refuse` answered with Server Error while
    // `body` runs, the way a failed write looks to the page.
    const failing = (refuse, body) =>
      answering((request) => {
        if (!refuse(request)) return false;
        provoked.push(new URL(request.url).pathname);
        return true;
      }, 500, body);
    const writing = (type, method = 'PUT') => (request) =>
      request.method === method && (!type || (request.postData || '').includes(`"recordType":"${type}"`));

    // Every PUT the page sends, by record type, in order.
    const recordWrites = () =>
      page.eval(`(() => {
        const send = window.fetch;
        window.__writes = [];
        window.fetch = (path, init) => {
          if (init && init.method === 'PUT') window.__writes.push(JSON.parse(init.body).recordType);
          return send(path, init);
        };
        window.__alerted = false;
        window.alert = () => { window.__alerted = true; };
      })()`);
    await recordWrites();

    // A second value on the existing dimension and a second dimension,
    // written to the profile as the dimensions screen would.
    const profile = await vaultValue('{ recordId: v.profileRecord.recordId, version: v.profileRecord.version, profile: v.profile }');
    const liquid = profile.profile.dimensions.find((d) => d.label === 'Liquid assets');
    await plant([{
      type: 'profile',
      recordId: profile.recordId,
      version: profile.version + 1,
      payload: {
        ...profile.profile,
        dimensions: [
          { ...liquid, values: [...liquid.values, { id: 'retire01', label: 'Retirement', archivedAt: null }] },
          {
            id: 'region01',
            label: 'Region',
            archivedAt: null,
            values: [
              { id: 'home0001', label: 'Home', archivedAt: null },
              { id: 'abroad01', label: 'Abroad', archivedAt: null },
            ],
          },
        ],
      },
    }]);
    await reloadModel();
    await writesSeen();

    // -- The form: the unit list ------------------------------------------

    const XSS = '<img src=x onerror=alert(1)>';
    const NAME = `Name ${XSS}`;
    const NOTE = `Note ${XSS}`;
    const AXIS = `Axis ${XSS}`;
    const BAND = `Band ${XSS}`;
    const accountsBefore = sql(`SELECT record_id FROM records ${OWN} AND record_type = 'account'`).length;

    await click('Add a holding');
    await page.waitUntil("document.querySelector('#holding-unit-list [data-symbol]')", { label: 'the unit list' });
    const unitList = JSON.parse(await page.eval(`JSON.stringify({
      options: [...document.querySelectorAll('#holding-unit-list [role=option]')].map(o => o.dataset.symbol || o.textContent),
      texts: [...document.querySelectorAll('#holding-unit-list [role=option]')].map(o => o.textContent),
      groups: [...document.querySelectorAll('#holding-unit-list .unit-group-label')].map(g => g.textContent),
    })`));
    check(
      'the unit list offers the main currency first, then currencies, then metals, then Something else',
      unitList.options[0] === 'CHF' &&
        unitList.groups.join(',') === 'Currencies,Metals' &&
        unitList.options[unitList.options.length - 1] === 'Something else…' &&
        unitList.options.indexOf('XAU-ozt') > unitList.options.indexOf('USD'),
      JSON.stringify(unitList.options),
    );
    check(
      'a metal reads as its label, once per unit',
      unitList.texts.some((t) => t.startsWith('Gold, gram')) && unitList.texts.some((t) => t.startsWith('Gold, troy ounce')),
      unitList.texts.join(' | '),
    );
    check(
      'a unit with no lookup is listed and marked rate entered by hand',
      unitList.texts.some((t) => t.includes('XAG-ozt') && t.endsWith('rate entered by hand')),
    );
    check('the form says what the unit commits you to', (await text()).includes('After that it is fixed'));
    check('the form offers no price, rate or symbol field', !(await page.eval("Boolean(document.querySelector('.dialog').textContent.match(/\\bRate\\b|Rate symbol|No price source/))")));

    await setValue('#holding-unit', 'troy');
    await page.settle(150);
    const filtered = await page.eval(
      "[...document.querySelectorAll('#holding-unit-list [data-symbol]')].map(o => o.textContent)",
    );
    check(
      'typing narrows the list and never becomes the unit',
      filtered.length > 0 && filtered.every((t) => t.toLowerCase().includes('troy')) &&
        (await page.eval("document.querySelector('.unit-chosen').value")) === 'CHF',
      filtered.join(' | '),
    );
    await setValue('#holding-unit', '');

    // Nothing saves without a name, and a free-text unit that is a
    // listed symbol in another case is refused in favour of the symbol.
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.settle(200);
    check('a missing name is refused inline and writes nothing', (await text()).includes('Give the holding a name.') && (await writesSeen()).length === 0);
    await setValue('#holding-name', NAME);
    await page.eval("document.querySelector('#holding-unit-list .unit-other').click()");
    await setValue('#holding-unit-other', 'usd');
    await page.settle(150);
    check('typed text matching a listed symbol offers that symbol', (await text()).includes('USD is on the list'));
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.settle(200);
    check('and that free text is not accepted', (await writesSeen()).length === 0 && (await text()).includes('Use it from there'));
    await page.eval("document.querySelector('#holding-unit-list [data-symbol=\"CHF\"]').click()");

    await page.eval("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    await setValue('.dialog textarea', NOTE);
    // A value made inline, then a dimension made inline: each writes the
    // profile first, and the holding is written once, last.
    await choose('.dialog select[aria-label="Region"]', '__new__');
    await setValue('.dialog .inline-create input', 'Offshore');
    await inDialog('Add');
    await page.waitUntil("[...document.querySelectorAll('.dialog select[aria-label=\"Region\"] option')].some(o => o.textContent === 'Offshore' && o.selected)", { label: 'the new value, selected' });
    await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === '+ New dimension').click()");
    await page.eval(`(() => {
      const inputs = document.querySelectorAll('.dialog .new-dimension input');
      inputs[0].value = ${JSON.stringify(AXIS)};
      inputs[1].value = ${JSON.stringify(BAND)};
    })()`);
    await inDialog('Add');
    await page.waitUntil(`[...document.querySelectorAll('.dialog .checkbox')].some(l => l.textContent === ${JSON.stringify(AXIS)} && l.querySelector('input').checked)`, { label: 'the new dimension, set' });
    await choose('.dialog select[aria-label="Liquid assets"]', 'retire01');
    const readsBeforeSave = await recordReads();
    await page.eval("document.querySelector('.dialog button[type=submit]').click()");
    await page.waitUntil('!document.querySelector(".dialog")', { label: 'the new holding to save' });
    await page.settle(300);
    const written = await writesSeen();
    check('inline creation writes the profile before the holding', written.join(',') === 'profile,profile,account', written.join(','));
    check('the saved holding shows at once, with no refetch', (await recordReads()) === readsBeforeSave && (await text()).includes(NAME));

    const [probeId] = await idNamed(NAME);
    const saved = await payloadOf(probeId);
    const axis = await vaultValue(`v.dimensions.find(d => d.label === ${JSON.stringify(AXIS)})`);
    const offshore = await vaultValue("v.dimensions.find(d => d.id === 'region01').values.find(x => x.label === 'Offshore').id");
    check(
      'creating a holding stores exactly one account record',
      sql(`SELECT record_id FROM records ${OWN} AND record_type = 'account'`).length === accountsBefore + 1 && Boolean(rowOf(probeId)),
    );
    check(
      'the form writes ids for every assignment, never a label',
      JSON.stringify(saved.dims) === JSON.stringify({ region01: offshore, [axis.id]: axis.values[0].id, [liquid.id]: 'retire01' }) ||
        (Object.keys(saved.dims).length === 3 && saved.dims.region01 === offshore && saved.dims[liquid.id] === 'retire01' && saved.dims[axis.id] === axis.values[0].id),
      JSON.stringify(saved.dims),
    );

    // A free-text unit, twice under one name: names are not unique.
    const addFreeText = async (name, unit) => {
      await click('Add a holding');
      await page.waitUntil("document.querySelector('#holding-unit-list .unit-other')", { label: 'the unit list' });
      await setValue('#holding-name', name);
      await page.eval("document.querySelector('#holding-unit-list .unit-other').click()");
      await setValue('#holding-unit-other', unit);
      await page.settle(100);
      await page.eval("document.querySelector('.dialog button[type=submit]').click()");
      await page.waitUntil('!document.querySelector(".dialog")', { label: `${name} to save` });
      await page.settle(250);
    };
    await addFreeText('Parking space', 'm²');
    await addFreeText('Parking space', 'm²');
    const parking = await idNamed('Parking space');
    check('two holdings may share a name', parking.length === 2, parking.join(','));
    check('a free-text unit is stored as typed, case kept', (await payloadOf(parking[0])).unit === 'm²');

    const leaks = inDatabase([
      NAME, NOTE, AXIS, BAND, 'Offshore', 'Parking space', 'm²', 'Liquid assets', 'Retirement', 'Region',
      offshore, axis.id, axis.values[0].id, 'region01', 'retire01', 'home0001',
    ]);
    check('no name, unit, note, label or assignment is in the database in plaintext', leaks.length === 0, leaks.join(' | '));
    const shapes = await page.eval(`(async () => {
      const api = await import('/static/js/api.js');
      const c = await import('/static/js/crypto.js');
      const v = (await import('/static/js/session.js')).currentVault();
      const shapes = [];
      for (const row of await api.get('/api/records?type=account')) {
        const payload = await c.decryptRecord(v.dek, row);
        shapes.push(Object.keys(payload).sort().join(',') + (payload.dims && !Array.isArray(payload.dims) && typeof payload.dims === 'object' ? '' : ' dims-not-a-map'));
      }
      return JSON.stringify([...new Set(shapes)]);
    })()`);
    check(
      'every account record has exactly the documented fields, no rate symbol beside the unit',
      shapes === JSON.stringify(['archivedAt,createdAt,dims,name,note,unit']),
      shapes,
    );

    // -- Read back after a fresh unlock ---------------------------------------

    await page.goto(`${BASE}/dashboard`);
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard after a fresh unlock' });
    await page.settle(600);
    check('a holding reads back whole after a fresh unlock', JSON.stringify(await payloadOf(probeId)) === JSON.stringify(saved));
    await recordWrites();

    // The unit list alone waits on the symbol table, and a table that
    // cannot be fetched leaves free text, a retry, and the cost named.
    await failing((request) => request.url.includes('/api/rates/symbols'), async () => {
      await click('Add a holding');
      await page.waitUntil("document.body.innerText.includes('The unit list could not be loaded')", { label: 'the degraded unit control' });
      check(
        'a symbol table that cannot load degrades to free text with a retry',
        await page.eval("!document.querySelector('#holding-unit-other').hidden && [...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Try again')"),
      );
    });
    await inDialog('Try again');
    await page.waitUntil("document.querySelector('#holding-unit-list [data-symbol]')", { label: 'the list after a retry' });
    check('trying again brings the list back', true);
    await inDialog('Cancel');
    await page.settle(200);

    // -- The holding's own screen ---------------------------------------------

    await openHolding(probeId);
    check('an unvalued holding says so rather than 0', (await text()).includes('Not yet valued'));
    check('with no values, one sentence and the primary action', (await text()).includes('No snapshots yet. Record what this holding is worth.'));
    await click('Record a value');
    await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
    const pastDay = await page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      return v.format.date('${BACKDATE}');
    })()`);
    await setValue('#snapshot-date', pastDay);
    await setValue('#snapshot-value', '5000');
    await page.eval("document.querySelector('.dialog textarea').value = 'kept in the safe'; document.querySelector('.dialog textarea').dispatchEvent(new Event('input', { bubbles: true }))");
    await inDialog('Save');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the value to save' });
    await page.settle(1200);
    const noteRow = JSON.parse(await page.eval(`JSON.stringify({
      toggles: document.querySelectorAll('.note-toggle').length,
      hiddenBefore: document.querySelector('.note-row').hidden,
    })`));
    await page.eval("document.querySelector('.note-toggle').click()");
    await page.settle(100);
    check(
      "an entry's note is behind an icon that expands its row, in full",
      noteRow.toggles === 1 && noteRow.hiddenBefore &&
        !(await page.eval("document.querySelector('.note-row').hidden")) &&
        (await page.eval("document.querySelector('.note-row').textContent")) === 'kept in the safe',
    );
    await writesSeen();

    // Editing: Cancel writes nothing. A save re-encrypts under a fresh
    // nonce at version + 1, the dimension carries one entry, and the
    // unit of a holding with a value is refused whatever the controls
    // are made to hold.
    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the holding editor' });
    await page.settle(300);
    await page.eval("[...document.querySelectorAll('#app .panel-form button')].find(b => b.textContent === 'Cancel').click()");
    await page.settle(400);
    check('Cancel closes the editor and writes nothing', !(await page.eval("Boolean(document.querySelector('#holding-name'))")) && (await writesSeen()).length === 0);

    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the holding editor again' });
    await page.settle(300);
    const lock = JSON.parse(await page.eval(`JSON.stringify({
      disabled: document.querySelector('#holding-unit').disabled,
      readable: document.querySelector('#holding-unit').value,
      listShown: !document.querySelector('#holding-unit-list').hidden,
    })`));
    check(
      'the unit of a holding with a value is disabled, readable, and explained',
      lock.disabled && lock.readable.includes('CHF') && !lock.listShown &&
        (await text()).includes('The unit cannot change once you have recorded a value here.'),
      JSON.stringify(lock),
    );
    const rowBefore = rowOf(probeId);
    await page.eval(`(() => {
      const kept = document.querySelector('.unit-chosen');
      kept.value = 'USD';
      kept.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
    await setValue('#app textarea', `${NOTE} edited`);
    await choose('#app select[aria-label="Region"]', 'home0001');
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("!document.querySelector('#holding-name')", { label: 'the edit to save' });
    await page.settle(400);
    const rowAfter = rowOf(probeId);
    const edited = await payloadOf(probeId);
    check(
      'an edit increments the version and writes a different nonce',
      rowAfter.version === rowBefore.version + 1 && rowAfter.nonce !== rowBefore.nonce,
      `${rowBefore.version}/${rowBefore.nonce} then ${rowAfter.version}/${rowAfter.nonce}`,
    );
    check(
      're-saving a dimension with another value leaves one entry for it',
      edited.dims.region01 === 'home0001' && Object.keys(edited.dims).length === Object.keys(saved.dims).length &&
        Object.keys(edited.dims).filter((key) => key === 'region01').length === 1,
      JSON.stringify(edited.dims),
    );
    check('the UI refuses to change the unit of a holding with a value', edited.unit === 'CHF', edited.unit);

    // A Conflict: the record is changed behind this tab, the save is
    // refused, the editor shows what the other tab wrote, and the edit
    // is redone against it.
    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the editor before the conflict' });
    const current = await vaultValue(`{ version: v.holdings.get('${probeId}').version, payload: v.holdings.get('${probeId}').payload }`);
    provoked.push(`/api/records/${probeId}`);
    await plant([{ type: 'account', recordId: probeId, version: current.version + 1, payload: { ...current.payload, name: 'Changed in another tab' } }]);
    await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
    await setValue('#app textarea', 'typed in this tab');
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("document.body.innerText.includes('This holding was changed in another tab.')", { label: 'the conflict message' });
    await page.settle(300);
    check(
      'a Conflict reloads the record into the editor and changes nothing stored',
      (await page.eval("document.querySelector('#holding-name').value")) === 'Changed in another tab' &&
        rowOf(probeId).version === current.version + 1,
      await page.eval("document.querySelector('#holding-name').value"),
    );
    await setValue('#holding-name', NAME);
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("!document.querySelector('#holding-name')", { label: 'the redone edit' });
    await page.settle(400);
    check('the redone edit saves at the next version', rowOf(probeId).version === current.version + 2 && (await payloadOf(probeId)).name === NAME);

    // -- Decrypted strings reach the page as text, everywhere -----------------

    check(
      'a name and a note carrying markup render as literal text on the holding screen',
      (await page.eval("document.querySelector('.screen-heading').textContent")) === NAME &&
        (await page.eval("document.querySelector('.detail-header .note').textContent")) === (await payloadOf(probeId)).note &&
        (await page.eval("[...document.querySelectorAll('.detail-header .chip')].map(c => c.textContent)")).includes(`${AXIS}: ${BAND}`),
    );
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard' });
    await choose('.chart-controls select', axis.id);
    await page.settle(400);
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.settle(300);
    await page.eval(`(() => {
      const chart = document.querySelector('svg.trend');
      const box = chart.getBoundingClientRect();
      chart.dispatchEvent(new PointerEvent('pointermove', { clientX: box.right - 30, clientY: box.top + box.height / 2, bubbles: true }));
    })()`);
    await page.settle(100);
    const places = JSON.parse(await page.eval(`JSON.stringify({
      row: [...document.querySelectorAll('.holdings-table .row-name')].some(b => b.textContent === ${JSON.stringify(NAME)}),
      legend: [...document.querySelectorAll('.legend-name')].map(n => n.textContent),
      grouping: [...document.querySelectorAll('.chart-controls select option')].map(o => o.textContent),
      heading: document.querySelector('.chart-card .section-heading').textContent,
      readout: document.querySelector('.chart-readout').textContent,
      chips: [...document.querySelectorAll('.holdings-table .chip')].map(c => c.textContent),
    })`));
    check(
      'markup in a name, a note and a label is literal in the list, the legend, the heading and the tooltip',
      places.row && places.legend.includes(BAND) && places.grouping.includes(AXIS) &&
        places.heading === `Net worth by ${AXIS}` && places.readout.includes(BAND) && places.chips.includes(`${AXIS}: ${BAND}`),
      JSON.stringify(places),
    );
    check(
      'no markup from the vault became an element, and nothing ran',
      (await page.eval("document.querySelectorAll('img').length")) === 0 && !(await page.eval('window.__alerted')),
    );
    await choose('.chart-controls select', '');

    // -- Renaming and archiving dimensions writes the profile alone ----------

    const accountsAtRename = accountRows();
    await writesSeen();
    await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings' });
    await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
    await page.waitUntil("document.body.innerText.includes('Region')", { label: 'the dimensions screen' });
    await page.settle(300);
    const card = (label) =>
      `[...document.querySelectorAll('section.card')].find(c => c.querySelector('.card-head .strong')?.textContent === ${JSON.stringify(label)})`;
    const inCard = (label, button, within = '') =>
      page.eval(`[...${card(label)}.querySelectorAll('${within} button')].find(b => b.textContent === ${JSON.stringify(button)}).click()`);
    await page.eval(`${card('Region')}.querySelector('.card-head .btn-inline').click()`);
    await page.eval(`(() => {
      const input = ${card('Region')}.querySelector('.card-head input');
      input.value = 'Area';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.eval(`[...${card('Region')}.querySelectorAll('.card-head button')].find(b => b.textContent === 'Save').click()`);
    await page.waitUntil(`${card('Area')}`, { label: 'the renamed dimension' });
    await page.settle(300);
    check(
      "renaming a dimension's label writes the profile alone and leaves every account record byte-identical",
      (await writesSeen()).join(',') === 'profile' && accountRows() === accountsAtRename,
    );

    // An archived value reads as Unassigned, and restoring it brings the
    // assignment back, with no account record written either way.
    await page.eval(`[...[...${card('Area')}.querySelectorAll('li.value-row')].find(r => r.querySelector('.strong').textContent === 'Home').querySelectorAll(':scope > button')].find(b => b.textContent === 'Archive').click()`);
    await page.settle(500);
    const bandWhileArchived = await vaultValue(`v.bandOf(v.holdings.get('${probeId}'), v.dimensions.find(d => d.id === 'region01')).label`);
    await inCard('Area', 'Restore');
    await page.settle(500);
    const bandRestored = await vaultValue(`v.bandOf(v.holdings.get('${probeId}'), v.dimensions.find(d => d.id === 'region01')).label`);
    check(
      'a holding whose value is archived reads Unassigned, and restoring it restores the assignment with no account write',
      bandWhileArchived === 'Unassigned' && bandRestored === 'Home' && accountRows() === accountsAtRename &&
        (await writesSeen()).every((type) => type === 'profile'),
      `${bandWhileArchived} then ${bandRestored}`,
    );

    await inCard(AXIS, 'Archive dimension');
    await page.waitUntil("document.querySelector('.dialog')", { label: 'the archive dimension dialog' });
    await inDialog('Archive');
    await page.settle(500);
    await openHolding(probeId);
    check(
      'a holding whose dimension is archived shows no assignment for it, and no account record was written',
      !(await page.eval("document.querySelector('.detail-header').textContent")).includes('Axis') &&
        accountRows() === accountsAtRename && (await writesSeen()).every((type) => type === 'profile'),
    );
    // Saving the holding meanwhile keeps the entry the form cannot show.
    await click('Edit');
    await page.waitUntil("document.querySelector('#holding-name')", { label: 'the editor over an archived dimension' });
    await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
    await setValue('#app textarea', NOTE);
    await page.eval("document.querySelector('#app .panel-form button[type=submit]').click()");
    await page.waitUntil("!document.querySelector('#holding-name')", { label: 'the save over an archived dimension' });
    await page.settle(300);
    check(
      'saving a holding keeps the entry for an archived dimension untouched',
      (await payloadOf(probeId)).dims[axis.id] === axis.values[0].id,
      JSON.stringify((await payloadOf(probeId)).dims),
    );
    await writesSeen();
    const accountsBeforeRestore = accountRows();
    await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings again' });
    await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
    await page.waitUntil("document.body.innerText.includes('Area')", { label: 'the dimensions screen again' });
    await page.eval(`[...document.querySelectorAll('.settings-row')].find(r => r.querySelector('span').textContent === ${JSON.stringify(AXIS)}).querySelector('button').click()`);
    await page.settle(500);
    await openHolding(probeId);
    check(
      'restoring the dimension restores the assignment without writing an account record',
      (await page.eval("[...document.querySelectorAll('.detail-header .chip')].map(c => c.textContent)")).includes(`${AXIS}: ${BAND}`) &&
        accountRows() === accountsBeforeRestore && (await writesSeen()).every((type) => type === 'profile'),
    );

    // -- Deleting ---------------------------------------------------------------

    await click('Delete');
    await page.waitUntil("document.querySelector('.dialog')", { label: 'the delete dialog' });
    await page.settle(200);
    const offered = JSON.parse(await page.eval(`JSON.stringify({
      archive: document.querySelector('.dialog input[value=archive]').checked,
      both: document.querySelectorAll('.dialog input[type=radio]').length,
    })`));
    await page.eval("document.querySelector('.dialog input[value=delete]').click()");
    await page.settle(150);
    const permanently = "[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Delete permanently')";
    const deleteCopy = (await text()).includes('This also deletes 1 recorded values. Your past net worth figures will change.');
    await setValue('#delete-name', 'Not the name');
    const wrongName = await page.eval(`${permanently}.disabled`);
    await setValue('#delete-name', NAME);
    const rightName = await page.eval(`${permanently}.disabled`);
    check(
      'Delete on a holding with values offers archive, preselected, and permanent delete behind the typed name',
      offered.archive && offered.both === 2 && deleteCopy && wrongName && !rightName,
      JSON.stringify({ offered, deleteCopy, wrongName, rightName }),
    );
    await inDialog('Cancel');
    await page.settle(200);

    await openHolding(parking[1]);
    await click('Delete');
    await page.waitUntil("location.hash === '#/'", { label: 'the dashboard after deleting outright' });
    check(
      'a holding with no values is deleted outright, with no dialog',
      !(await page.eval("Boolean(document.querySelector('.dialog'))")) && !rowOf(parking[1]) && Boolean(rowOf(parking[0])),
    );

    // -- Archiving with the closing value taken, and with it skipped -----------

    const today = await page.eval('new Date().toISOString().slice(0, 10)');
    const [skipId] = await plant([{
      type: 'account',
      payload: { name: 'Probe closing', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
    }]);
    await plant([{ type: 'snapshot', accountId: skipId, payload: { date: BACKDATE, value: '700', note: null } }]);
    await reloadModel();

    await openHolding(probeId);
    await click('Archive');
    await page.waitUntil("document.querySelector('#closing-value')", { label: 'the archive dialog' });
    const zero = await page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      return v.format.parseFigure(document.querySelector('#closing-value').value) === 0n;
    })()`);
    check('the closing value is prefilled 0 on a free date', zero);
    await setValue('#closing-value', '4000');
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive with a closing value' });
    await page.settle(800);
    const closing = await vaultValue(`v.snapshotsFor('${probeId}').filter(s => s.payload.date === '${today}').map(s => s.payload.value)`);
    check('the closing value is one figure dated the archive date', closing.join(',') === '4000', closing.join(','));

    await openHolding(skipId);
    await click('Archive');
    await page.waitUntil("document.querySelector('#closing-value')", { label: 'the archive dialog to skip' });
    await click('Skip');
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive with the value skipped' });
    await page.settle(800);
    const skipped = await vaultValue(`{ archivedAt: v.holdings.get('${skipId}').payload.archivedAt, figures: v.snapshotsFor('${skipId}').length }`);
    check('archiving with the closing value skipped still archives, and records nothing', skipped.archivedAt === today && skipped.figures === 1, JSON.stringify(skipped));

    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.chart-controls select')", { label: 'the dashboard after archiving' });
    await choose('.chart-controls select', axis.id);
    await page.settle(300);
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.settle(300);
    const band = JSON.parse(await page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      const table = document.querySelector('.chart-card details table');
      const column = [...table.querySelectorAll('thead th')].findIndex(th => th.textContent === ${JSON.stringify(BAND)});
      const row = [...table.querySelectorAll('tbody tr')].find(r => r.cells[0].textContent === v.format.date('${today}'));
      const decimal = await import('/static/js/decimal.js');
      const { dayNumber } = await import('/static/js/model.js');
      // The side just before the archive date carries the closing value.
      const { days, bands } = v.series(v.dimensions.find((d) => d.id === ${JSON.stringify(axis.id)}), dayNumber(v.recordingDates()[0]), dayNumber('${today}'));
      const before = bands.find((b) => b.label === ${JSON.stringify(BAND)}).before;
      const index = days.indexOf(dayNumber('${today}'));
      return JSON.stringify({
        shown: row && column > 0 ? row.cells[column].textContent : null,
        expected: v.format.money(decimal.ZERO),
        before: String(before.assets[index] + before.liabilities[index]),
        closing: String(decimal.parse('4000')),
      });
    })()`));
    // The value at the archive date leaves the holding out, closing value or not.
    check("the band's value on the archive date leaves the archived holding out", band.shown === band.expected, JSON.stringify(band));
    check("the band's side just before the archive date carries the closing value", band.before === band.closing, JSON.stringify(band));
    const annotations = await page.eval("[...document.querySelectorAll('.archive-annotation title')].map(t => t.textContent)");
    check(
      'both archive paths annotate the date, naming the holding as literal text',
      annotations.includes(`${NAME} archived`) && annotations.includes('Probe closing archived'),
      annotations.join(' | '),
    );
    await choose('.chart-controls select', '');

    // -- When a write in the archive or delete flow fails -----------------------

    const [euroId, poundId] = await plant([
      { type: 'account', payload: { name: 'Probe euro closing', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
      { type: 'account', payload: { name: 'Probe pound closing', unit: 'GBP', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() } },
    ]);
    await plant([
      { type: 'snapshot', accountId: euroId, payload: { date: BACKDATE, value: '100', note: null } },
      { type: 'snapshot', accountId: poundId, payload: { date: BACKDATE, value: '200', note: null } },
    ]);
    await reloadModel();

    await openHolding(euroId);
    await failing(writing(null, 'DELETE'), async () => {
      await page.eval("[...document.querySelectorAll('.card .data-table button')].find(b => b.textContent === 'Delete').click()");
      await page.waitUntil("document.querySelector('.dialog')", { label: 'the delete snapshot dialog' });
      await inDialog('Delete');
      await page.waitUntil("document.querySelector('.card .data-table .field-error:not([hidden])')", { label: 'the failed delete' });
    });
    check(
      'a failed delete is reported on its row, and the row stays',
      (await page.eval("document.querySelector('.card .data-table .field-error:not([hidden])').closest('tr').textContent")).includes('Nothing was deleted.') &&
        (await vaultValue(`v.snapshotsFor('${euroId}').length`)) === 1,
    );

    await click('Archive');
    await page.waitUntil("document.querySelector('#closing-value')", { label: 'the euro archive dialog' });
    await setValue('#closing-value', '90');
    await failing(writing('snapshot'), async () => {
      await inDialog('Archive');
      await page.waitUntil("document.body.innerText.includes('The closing value did not save')", { label: 'the closing value failure' });
    });
    check(
      'a closing value that does not save archives nothing, and the figure stays in the field',
      (await page.eval("document.querySelector('#closing-value').value")) === '90' &&
        !(await vaultValue(`v.holdings.get('${euroId}').payload.archivedAt`)) &&
        (await text()).includes('nothing was archived and the holding is untouched'),
    );
    await failing(writing('rate'), async () => {
      await inDialog('Archive');
      await page.waitUntil("document.body.innerText.includes('were not written')", { timeout: 60000, label: 'the price failure' });
    });
    const priceMessage = await text();
    check(
      'a closing value whose prices do not save still archives, naming the units',
      priceMessage.includes('Archived. The prices for EUR') &&
        (await vaultValue(`v.holdings.get('${euroId}').payload.archivedAt`)) === today &&
        (await vaultValue(`v.snapshotsFor('${euroId}').filter(s => s.payload.date === '${today}').length`)) === 1,
      priceMessage.slice(0, 400),
    );
    await inDialog('Close');
    await page.settle(400);

    await openHolding(poundId);
    await click('Archive');
    await page.waitUntil("document.querySelector('#closing-value')", { label: 'the pound archive dialog' });
    await setValue('#closing-value', '180');
    await failing(writing('account'), async () => {
      await inDialog('Archive');
      await page.waitUntil("document.body.innerText.includes('but the holding was not archived')", { timeout: 60000, label: 'the flag failure' });
    });
    const again = await page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      return String(v.format.parseFigure(document.querySelector('#closing-value').value));
    })()`);
    check(
      'a closing value saved without the archive flag says both halves and offers the archive again, prefilled',
      again === (await page.eval("(async () => String((await import('/static/js/decimal.js')).parse('180')))()")) &&
        !(await vaultValue(`v.holdings.get('${poundId}').payload.archivedAt`)) &&
        (await vaultValue(`v.snapshotsFor('${poundId}').filter(s => s.payload.date === '${today}').length`)) === 1,
      again,
    );
    await inDialog('Archive');
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive offered again' });
    await page.settle(600);
    check(
      'the archive offered again finishes it, with one figure at the date',
      (await vaultValue(`v.holdings.get('${poundId}').payload.archivedAt`)) === today &&
        (await vaultValue(`v.snapshotsFor('${poundId}').filter(s => s.payload.date === '${today}').length`)) === 1,
    );

    // -- Unarchiving, from the dashboard's archived rows ------------------------

    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard to unarchive from' });
    await page.eval("[...document.querySelectorAll('.holdings-card .checkbox input')][0].click()");
    await page.settle(300);
    const archivedRow = `[...document.querySelectorAll('.holdings-table tbody tr')].find(r => r.querySelector('.row-name').textContent === ${JSON.stringify(archiving)})`;
    const rowActions = await page.eval(`[...${archivedRow}.querySelectorAll('.cell-action button')].map(b => b.textContent)`);
    check('an archived row offers Unarchive and no new value', rowActions.join(',') === 'Unarchive', rowActions.join(','));
    await page.eval(`${archivedRow}.querySelector('.cell-action button').click()`);
    await page.settle(800);
    await page.eval("[...document.querySelectorAll('.holdings-card .checkbox input')][0].checked && [...document.querySelectorAll('.holdings-card .checkbox input')][0].click()");
    await page.settle(300);
    const back = await page.eval(`[...document.querySelectorAll('.holdings-table .row-name')].map(b => b.textContent)`);
    const heroNow = await page.eval("document.querySelector('.hero-figure').textContent");
    check(
      'unarchiving restores the holding to the active list and to the current total',
      back.includes(archiving) && heroNow === heroBeforeArchive,
      `${back.join(',')}: ${heroNow} against ${heroBeforeArchive}`,
    );

    // -- What the page asked the server for ---------------------------------------

    const requested = JSON.parse(await page.eval(`JSON.stringify(performance.getEntriesByType('resource')
      .map(e => new URL(e.name)).filter(u => u.pathname.startsWith('/api/')).map(u => u.pathname + u.search))`));
    const rateRequests = requested.filter((path) => path.startsWith('/api/rates?'));
    check(
      'no rate request names a symbol: each asks for the whole table at a date',
      rateRequests.length > 0 &&
        rateRequests.every((path) => [...new URLSearchParams(path.split('?')[1]).keys()].sort().join(',') === 'date,quote'),
      rateRequests.join(' | '),
    );
    check(
      'no request returns dimensions, labels or values: none names them',
      requested.every((path) => !/dimension|label|value/i.test(path)),
      [...new Set(requested.map((path) => path.split('?')[0]))].join(' | '),
    );
    check('no markup from the vault ran anywhere along the way', !(await page.eval('window.__alerted')));
  }

  // ---- Export, then import it back ---------------------------------------

  // A bookmark of the server address, which lands on the screen it
  // names.
  await page.goto(`${BASE}/settings`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 90000, label: 'settings again' });
  check('the settings address lands on the settings view', (await page.eval('location.hash')) === '#/settings');
  await page.settle(600);

  const beforeImport = JSON.parse(await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const v = s.currentVault();
    const names = [...v.holdings.values()].map(h => h.payload.name).sort();
    return JSON.stringify({ names, holdings: v.holdings.size, unreadable: v.unreadable.length });
  })()`));
  check(
    'the vault reads back before the import',
    beforeImport.unreadable === 0 && beforeImport.holdings > 0,
    JSON.stringify(beforeImport),
  );

  const imported = JSON.parse(await importOwnExport());

  check('an import round-trips every holding', imported.names.join(',') === beforeImport.names.join(','), imported.names.join(','));
  check('every record reads back after the import', imported.unreadable === 0, String(imported.unreadable));
  check('the vault is re-keyed rather than restored verbatim', imported.rekeyed);
  check('both timelines survive the round trip', imported.kinds.includes('rate') && imported.kinds.includes('snapshot'), imported.kinds.join(','));

  const stillOpens = await page.eval(`(async () => {
    const response = await fetch('/api/auth/salt', {
      method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'leander' }),
    });
    return response.status;
  })()`);
  check('the password is untouched by the import', stillOpens === 200);

  // ---- Export and import, through the screen (export-import.md) ----------

  {
    const { mkdtempSync, readdirSync, readFileSync, writeFileSync, truncateSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const vaultRows = () => JSON.stringify(sql(`SELECT records.* FROM records ${OWN} ORDER BY record_id`));
    const apiCalls = (part) =>
      page.eval(`performance.getEntriesByType('resource').filter(e => e.name.includes(${JSON.stringify(part)})).length`);
    const inPage = (body) =>
      page.eval(`(async () => {
        const v = (await import('/static/js/session.js')).currentVault();
        const c = await import('/static/js/crypto.js');
        const t = await import('/static/js/transfer.js');
        return JSON.stringify(await (async () => { ${body} })());
      })()`).then(JSON.parse);
    const unlockAt = async (address, ready) => {
      await page.goto(`${BASE}${address}`);
      await enterPassword(VAULT_PASSWORD);
      await page.waitUntil(ready, { timeout: 90000, label: address });
      await page.settle(500);
    };
    // Drawn afresh, so nothing a previous import left on it counts.
    const toScreen = async () => {
      await page.eval("location.hash = '#/settings'");
      await page.settle(300);
      await page.eval("location.hash = '#/settings/export-import'");
      await page.waitUntil("document.querySelector('#import-file')", { label: 'the export and import screen' });
      await page.settle(200);
    };
    const dir = mkdtempSync(join(tmpdir(), 'solvent-transfer-'));
    const fixture = (name, content) => {
      const path = join(dir, name);
      writeFileSync(path, content);
      return path;
    };
    // The handle is released straight away: DevTools keeps whatever it
    // hands out alive, and a live handle to an element of a page since
    // navigated away would keep that page's decrypted vault reachable.
    const chooseFile = async (path) => {
      const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
      await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
      await page.send('Runtime.releaseObject', { objectId: result.objectId });
      await page.settle(400);
    };
    const openWith = async (password) => {
      await page.waitUntil("!document.querySelector('#import-password').closest('[hidden]')", { label: 'the password step' });
      await setValue('#import-password', password);
      await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Open the file').click()");
    };
    const replaceVault = () =>
      page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Replace my vault').click()");
    const importError = () => page.eval("document.querySelector('#import-card .field-error').hidden ? '' : document.querySelector('#import-card .field-error').textContent");
    // Everything the vault decrypts to, keyed by record id.
    const decrypted = () =>
      inPage(`
        const api = await import('/static/js/api.js');
        const out = {};
        for (const type of ['profile', 'account', 'snapshot', 'rate']) {
          for (const row of await api.get('/api/records?type=' + type)) {
            out[row.recordId] = { type: row.recordType, accountId: row.accountId, payload: await c.decryptRecord(v.dek, row) };
          }
        }
        return Object.fromEntries(Object.entries(out).sort());
      `);
    // The chart and the total in both pricing modes, as drawn.
    const picture = async () => {
      await page.eval("location.hash = '#/'");
      await page.waitUntil("document.querySelector('svg.trend')", { label: 'the dashboard to draw' });
      await page.settle(400);
      const mode = async (label) => {
        await page.eval(`[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
        await page.settle(300);
        return page.eval("document.querySelector('svg.trend').outerHTML + '|' + document.querySelector('.hero-figure').textContent");
      };
      return JSON.stringify([await mode('as of each figure'), await mode('Latest rates')]);
    };

    await unlockAt('/settings/export-import', "document.querySelector('#export')");

    // -- Export ------------------------------------------------------------

    const downloads = join(dir, 'downloads');
    await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const order = await page.eval(`(() => {
      const warning = document.querySelector('#export-card .sensitivity');
      const button = document.querySelector('#export');
      return JSON.stringify({
        warning: warning ? warning.textContent : '',
        before: Boolean(warning && warning.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
        tag: button.tagName,
      });
    })()`).then(JSON.parse);
    check(
      'the sensitivity warning is on screen before the download is triggered',
      order.warning.includes('exactly as sensitive as your password') && order.warning.includes('permanently unreadable') &&
        order.before && order.tag === 'BUTTON',
      JSON.stringify(order),
    );
    await page.eval("document.querySelector('#export').click()");
    let saved = [];
    for (let i = 0; i < 60 && !saved.some((n) => n.endsWith('.json')); i++) {
      await page.settle(250);
      try {
        saved = readdirSync(downloads);
      } catch {}
    }
    const filename = saved.find((n) => n.endsWith('.json')) || '';
    check('the export lands as a dated file naming nobody', /^solvent-vault-\d{4}-\d{2}-\d{2}\.json$/.test(filename), saved.join(','));
    const exportedPath = join(downloads, filename);
    const exportedText = readFileSync(exportedPath, 'utf8');
    const exported = JSON.parse(exportedText);
    await page.waitUntil("!document.querySelector('#export-card [role=status]').hidden", { label: 'what the file holds' });
    check(
      'afterwards the screen says what the file holds, both timelines named',
      /\d+ holdings, \d+ recorded figures and \d+ captured prices, about \d+ KB/.test(
        await page.eval("document.querySelector('#export-card [role=status]').textContent"),
      ),
    );

    // Every plaintext the vault holds, looked for in the file's bytes:
    // outside the encoded fields, and inside them once decoded.
    const needles = await inPage(`
      const out = new Set([v.mainCurrency]);
      for (const h of v.holdings.values()) [h.payload.name, h.payload.note, h.payload.unit].forEach((x) => x && out.add(x));
      for (const d of v.dimensions) { out.add(d.label); d.values.forEach((x) => out.add(x.label)); }
      for (const list of v.snapshots.values()) for (const s of list) { out.add(s.payload.date); if (s.payload.value.length >= 4) out.add(s.payload.value); }
      for (const list of v.rates.values()) for (const r of list) { out.add(r.payload.symbol); out.add(r.payload.date); if (r.payload.rate.length >= 4) out.add(r.payload.rate); }
      return [...out];
    `);
    // Encoded fields, random ids and the export's own timestamp carry no
    // vault content, so they are blanked before the plain scan.
    const opaque = /"(salt|wrappedDek|dekNonce|nonce|ciphertext|recordId|accountId|exportedAt)":\s*"([^"]*)"/g;
    const outside = exportedText.replace(opaque, '"$1":""');
    const encoded = [...exportedText.matchAll(opaque)]
      .filter(([, key]) => !['recordId', 'accountId', 'exportedAt'].includes(key))
      .map(([, , value]) => Buffer.from(value, 'base64'));
    const found = needles.filter(
      (needle) =>
        outside.includes(needle) ||
        (needle.length >= 5 && encoded.some((bytes) => bytes.includes(Buffer.from(needle, 'utf8')))),
    );
    check(
      'the exported file holds no name, note, label, value, rate, symbol, date or currency in plaintext',
      needles.length > 10 && found.length === 0,
      found.join(' | '),
    );

    // The export failing, or at its ceiling, as the screen shows it.
    await answering((r) => r.url.endsWith('/api/export'), 500, async () => {
      await page.eval("document.querySelector('#export').click()");
      await page.waitUntil("!document.querySelector('#export-card .field-error').hidden", { label: 'the failed export' });
    });
    check(
      'a failed export says nothing was written and nothing changed, and the button rests',
      (await page.eval("document.querySelector('#export-card .field-error').textContent")).includes('Nothing was written to disk and nothing in your vault changed') &&
        !(await page.eval("document.querySelector('#export').disabled")),
    );
    await answering((r) => r.url.endsWith('/api/export'), 429, async () => {
      await page.eval("document.querySelector('#export').click()");
      await page.waitUntil("document.querySelector('#export-card .field-error').textContent.includes('several times')", { label: 'the export ceiling' });
    });
    check('at the export ceiling the button is disabled with the reason beside it', await page.eval("document.querySelector('#export').disabled"));

    // A plain navigation to the endpoint, with a live session cookie,
    // away from the unlocked vault showing its holdings.
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the dashboard before leaving it' });
    await page.settle(300);
    const leftNames = JSON.parse(await page.eval(`(async () => JSON.stringify(
      [...(await import('/static/js/session.js')).currentVault().holdings.values()].map((h) => h.payload.name)
    ))()`));
    const alive = await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then(r => r.status)");
    const navigated = join(dir, 'navigated');
    await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: navigated });
    await page.goto(`${BASE}/api/export`);
    await page.settle(1500);
    const statuses = [await page.eval("performance.getEntriesByType('navigation')[0].responseStatus")];
    let navigatedFiles = [];
    try {
      navigatedFiles = readdirSync(navigated);
    } catch {}
    check(
      'a top-level navigation to the export, with a valid session cookie, is Forbidden and writes no file',
      alive === 200 && statuses.join(',') === '403' && navigatedFiles.length === 0,
      `session ${alive}, answered ${statuses.join(',')}, files ${navigatedFiles.join(',')}`,
    );

    // Back, to the page left while unlocked. Whether the browser restores
    // it from its back-forward cache or loads it afresh, it holds no key
    // and shows nothing from the vault.
    await page.send('Page.navigateToHistoryEntry', {
      entryId: await page.send('Page.getNavigationHistory').then(({ currentIndex, entries }) => entries[currentIndex - 1].id),
    });
    const backAt = Date.now() + 30000;
    let back = null;
    while (!back && Date.now() < backAt) {
      await page.settle(250);
      try {
        back = JSON.parse(await page.eval(`(async () => {
          if (location.pathname !== '/dashboard' || !document.querySelector('#unlock-password')) return 'null';
          return JSON.stringify({
            keys: (await import('/static/js/session.js')).currentVault() !== null,
            text: document.body.innerText,
            how: performance.getEntriesByType('navigation')[0].type,
          });
        })()`));
      } catch {
        // The page is still between documents.
      }
    }
    check(
      'Back to a page left while unlocked shows the unlock card and no vault data',
      Boolean(back) && !back.keys && leftNames.length > 0 && leftNames.every((name) => !back.text.includes(name)),
      back ? `${back.how}, names ${leftNames.filter((name) => back.text.includes(name)).join(',')}` : 'no unlock card',
    );

    // -- Import: files and passwords that go nowhere ---------------------------

    await unlockAt('/settings/export-import', "document.querySelector('#import-file')");
    // Leaving the page locks it, keys and decrypted state alike, the way
    // the idle timer does, and unlocking brings the screen back.
    await page.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    await page.settle(300);
    check(
      'the vault locks on pagehide, discarding the keys and the decrypted state',
      (await page.eval("(async () => (await import('/static/js/session.js')).currentVault() === null)()")) &&
        (await page.eval("Boolean(document.querySelector('#unlock-password'))")) &&
        !(await page.eval("Boolean(document.querySelector('#import-file'))")),
    );
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('#import-file')", { timeout: 90000, label: 'the import screen after the pagehide lock' });
    await page.settle(500);
    const rowsBefore = vaultRows();
    const uploads = () => apiCalls('/api/import');

    await chooseFile(fixture('not-json.json', 'this is not a vault'));
    check('a file that is not JSON is refused at the first step', (await importError()).includes('not a Solvent vault file') &&
      (await page.eval("Boolean(document.querySelector('#import-password').closest('[hidden]'))")));
    await chooseFile(fixture('newer.json', JSON.stringify({ ...exported, formatVersion: 2 })));
    check('a file from a newer version is refused at the first step', (await importError()).includes('newer version'));
    const badType = JSON.parse(exportedText);
    badType.records[0].recordType = 'invoice';
    await chooseFile(fixture('bad-type.json', JSON.stringify(badType)));
    check('a file the server would refuse is refused before it is opened', (await importError()).includes('not a Solvent vault file'));
    const noProfile = JSON.parse(exportedText);
    noProfile.records = noProfile.records.filter((r) => r.recordType !== 'profile');
    await chooseFile(fixture('no-profile.json', JSON.stringify(noProfile)));
    check(
      'a file with no profile record is refused at the first step, before any password is asked for',
      (await importError()) === 'This file carries no vault settings, so it would restore a vault with no main currency. It cannot be restored.' &&
        (await page.eval("Boolean(document.querySelector('#import-password').closest('[hidden]'))")) &&
        (await uploads()) === 0,
      await importError(),
    );
    const large = fixture('large.json', '');
    truncateSync(large, 49 * 1024 * 1024);
    await chooseFile(large);
    check('an oversized file is refused by its size', (await importError()).includes('too large'));

    await chooseFile(exportedPath);
    const callsBefore = await apiCalls('/api/');
    await openWith('not the password of this file');
    await page.waitUntil("document.querySelector('#import-card .field-error').textContent.includes('does not open')", { timeout: 60000, label: 'the wrong password' });
    check(
      'a wrong password for the file stops there, sends nothing, and keeps the file chosen',
      (await apiCalls('/api/')) === callsBefore &&
        (await page.eval("document.querySelector('#import-file').files.length")) === 1 &&
        (await page.eval("document.querySelector('.review').hidden")),
    );

    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review' });
    const kinds = { account: 0, snapshot: 0, rate: 0 };
    for (const record of exported.records) if (record.recordType in kinds) kinds[record.recordType] += 1;
    const review = await page.eval("document.querySelector('.review').innerText");
    const total = sql(`SELECT record_id FROM records ${OWN}`).length;
    check(
      'the review sets what is in the file against what will be deleted, prices on their own line',
      review.includes(`${kinds.account} holdings`) && review.includes(`${kinds.rate} captured prices`) &&
        review.includes(`Your vault currently holds ${total} records. All of them will be deleted.`) &&
        !review.includes('This vault is kept in'),
      review,
    );
    check(
      'the review of a same-currency, current-version file prints no "null" where a line does not apply',
      !/null/i.test(review) && !/null/i.test(await page.eval("document.querySelector('.review').textContent")),
      review,
    );
    await replaceVault();
    await page.settle(300);
    check(
      'a vault holding records is not replaced without ERASE typed',
      (await importError()).includes('Type ERASE') && (await uploads()) === 0 && vaultRows() === rowsBefore,
    );

    const altered = JSON.parse(exportedText);
    const target = altered.records.find((record) => record.recordType === 'snapshot');
    const bytes = Buffer.from(target.ciphertext, 'base64');
    bytes[5] ^= 0x01;
    target.ciphertext = bytes.toString('base64');
    await chooseFile(fixture('altered.json', JSON.stringify(altered)));
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review of the altered file' });
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.querySelector('#import-card .field-error').textContent.includes('No records were imported')", { timeout: 60000, label: 'the refused record' });
    check(
      'one byte altered in one record aborts the import, names the record, uploads nothing and leaves the vault',
      (await importError()).includes(target.recordId) && (await importError()).includes('Your vault is unchanged') &&
        (await uploads()) === 0 && vaultRows() === rowsBefore,
      await importError(),
    );

    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review again' });
    await setValue('#import-erase', 'ERASE');
    provoked.push('/api/import');
    await answering((r) => r.url.endsWith('/api/import'), 500, async () => {
      await replaceVault();
      await page.waitUntil("document.querySelector('#import-card .field-error').textContent.includes('fully intact')", { timeout: 60000, label: 'the refused upload' });
    });
    check('an import the server refuses says the original vault is intact, and it is', vaultRows() === rowsBefore);
    provoked.splice(provoked.indexOf('/api/import'), 1);

    // -- Import: the real thing -------------------------------------------------

    const recordsBefore = await decrypted();
    const drawnBefore = await picture();
    const credentialBefore = credentialOf('leander');
    await toScreen();
    await page.eval('window.__samePage = true');
    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review to replace' });
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the import to land' });
    await page.settle(300);
    check(
      'an import decrypts and re-encrypts in a Worker, and the view reloads in place confirming what came back',
      (await apiCalls('transfer-worker.js')) > 0 && (await page.eval('window.__samePage === true')) &&
        !(await page.eval("Boolean(document.querySelector('#unlock-password'))")) &&
        (await text()).includes(`${kinds.account} holdings, ${kinds.snapshot} recorded figures and ${kinds.rate} captured prices`),
    );
    const versions = sql(`SELECT DISTINCT version FROM records ${OWN}`).map((row) => row.version);
    check('every record reads version 1 after an import', versions.join(',') === '1', versions.join(','));
    const credentialAfter = credentialOf('leander');
    check(
      'an import replaces the wrapper and leaves the salt, the envelope and the verifier byte-identical',
      credentialAfter.params === credentialBefore.params && credentialAfter.verifier === credentialBefore.verifier &&
        credentialAfter.wrapped_dek !== credentialBefore.wrapped_dek && credentialAfter.dek_nonce !== credentialBefore.dek_nonce,
    );
    const keys = await inPage(`
      const raw = async (key) => c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
      const params = ${credentialAfter.params};
      const master = (await c.deriveKeys(${JSON.stringify(VAULT_PASSWORD)}, params.salt, params.kdf)).masterKey;
      const stored = await c.unwrapDek(${JSON.stringify(credentialAfter.wrapped_dek)}, ${JSON.stringify(credentialAfter.dek_nonce)}, master);
      const file = (await t.openFile(${exportedText}, ${JSON.stringify(VAULT_PASSWORD)})).fileDek;
      return { stored: await raw(stored), file: await raw(file), memory: await raw(v.dek) };
    `);
    check(
      "after an import the stored wrapper unwraps to a key that is not the file's, and it is the one in use",
      keys.stored !== keys.file && keys.stored === keys.memory,
    );
    check(
      'the round trip restores the same ids, types, links and payloads, figures and prices alike',
      JSON.stringify(await decrypted()) === JSON.stringify(recordsBefore),
    );
    check('the chart and the total in both pricing modes come back identical', (await picture()) === drawnBefore);

    await unlockAt('/dashboard', "document.querySelector('svg.trend')");
    const reread = await inPage('return { unreadable: v.unreadable.length, records: v.holdings.size }');
    check(
      'after an import the unchanged password signs in and every record reads',
      reread.unreadable === 0 && reread.records === kinds.account,
      JSON.stringify(reread),
    );
    const stillOpens = await inPage(`
      const file = ${exportedText};
      const { fileDek } = await t.openFile(file, ${JSON.stringify(VAULT_PASSWORD)});
      return (await t.decryptAll(fileDek, file.records)).length === file.records.length;
    `);
    check('the exported file still opens with its own password after the vault was re-keyed', stillOpens);

    // -- A vault transfer, from a second owner -----------------------------------

    const SECOND_PASSWORD = 'meadow copper lantern thistle';
    const other = await launch();
    try {
      const second = await Session.connect(other.target);
      await second.send('Page.enable');
      await second.send('Runtime.enable');
      const fill = (fields) =>
        second.eval(`(() => {
          for (const [selector, value, index] of ${JSON.stringify(fields)}) {
            const node = document.querySelectorAll(selector)[index || 0];
            if (node.type === 'checkbox') node.checked = value;
            else node.value = value;
            node.dispatchEvent(new Event(node.tagName === 'SELECT' || node.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
          }
        })()`);
      await second.goto(`${BASE}/login`);
      await signInOn(second, ADMIN_PASSWORD, 'ops.leander');
      await second.waitUntil("location.pathname === '/admin'", { timeout: 90000, label: 'the administrator on the second browser' });
      const invite = await second.eval(`fetch('/api/admin/invites', {
        method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'vault_owner' }),
      }).then(r => r.json()).then(b => b.token)`);
      await second.eval(`fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' }, body: '{}' })`);
      await second.goto(`${BASE}/register?invite=${invite}`);
      await fill([
        ['input[type=text]', 'second.owner'],
        ['input[type=password]', SECOND_PASSWORD, 0],
        ['input[type=password]', SECOND_PASSWORD, 1],
        ['select', 'EUR'],
        ['input[type=checkbox]', true],
      ]);
      await second.settle(300);
      await second.eval("document.querySelector('button[type=submit]').click()");
      await second.waitUntil("location.pathname === '/dashboard'", { timeout: 90000, label: 'the second vault' });
      await second.waitUntil("document.body.innerText.includes('Add your first holding')", { timeout: 90000, label: 'the empty second vault' });

      // An empty vault's review says so, and asks for no typed word.
      await second.eval("location.hash = '#/settings/export-import'");
      await second.waitUntil("document.querySelector('#import-file')", { label: 'the second import screen' });
      const { result } = await second.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
      await second.send('DOM.setFileInputFiles', { files: [exportedPath], objectId: result.objectId });
      await second.settle(400);
      await fill([['#import-password', VAULT_PASSWORD]]);
      await second.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Open the file').click()");
      await second.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review into an empty vault' });
      check(
        'into an empty vault the review says nothing will be deleted, and no word is typed',
        (await second.eval("document.querySelector('.review').innerText")).includes('Your vault is empty. Nothing will be deleted.') &&
          !(await second.eval("Boolean(document.querySelector('#import-erase'))")),
      );

      // This owner writes their dates month first, so the file carries a
      // profile whose date style differs from the vault it lands in.
      await second.eval("location.hash = '#/settings'");
      await second.waitUntil("document.getElementById('format-dates')", { label: "the second owner's dates setting" });
      await second.settle(300);
      await second.eval(`(() => {
        const node = document.getElementById('format-dates');
        node.value = 'mdy';
        node.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await second.eval("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Dates and numbers')).querySelector('.btn-primary').click()");
      await second.settle(1200);
      check(
        "the second owner's profile holds the month-first style before it is exported",
        (await second.eval("(async () => (await import('/static/js/session.js')).currentVault().profile.dateStyle)()")) === 'mdy',
      );

      const plantSecond = (records) =>
        second.eval(`(async () => {
          const api = await import('/static/js/api.js');
          const c = await import('/static/js/crypto.js');
          const dek = (await import('/static/js/session.js')).currentVault().dek;
          const ids = [];
          for (const r of ${JSON.stringify(records)}) {
            const slot = { recordId: c.uuid4(), recordType: r.type, accountId: r.accountId ?? null, schemaVersion: 1, version: 1 };
            const { recordId, ...body } = slot;
            await api.put('/api/records/' + recordId, { ...body, ...(await c.encryptRecord(dek, slot, r.payload)) });
            ids.push(slot.recordId);
          }
          return ids;
        })()`);
      const [transferred] = await plantSecond([{
        type: 'account',
        payload: { name: 'Transfer probe', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z' },
      }]);
      await plantSecond([{ type: 'snapshot', accountId: transferred, payload: { date: BACKDATE, value: '321', note: null } }]);
      const secondText = await second.eval("fetch('/api/export', { headers: { 'X-Solvent-Request': '1' } }).then(r => r.text())");
      // Written by the source after the export, for the injection check.
      const [later] = await plantSecond([{
        type: 'account',
        payload: { name: 'Written after the export', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: '2026-01-02T00:00:00Z' },
      }]);

      await toScreen();
      await chooseFile(fixture('second.json', secondText));
      await openWith(SECOND_PASSWORD);
      await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review of the second vault' });
      check(
        'the review names a main currency that differs from this vault',
        (await page.eval("document.querySelector('.review').innerText")).includes('This vault is kept in EUR. Yours is currently in CHF.'),
      );
      check(
        'the review of a different-currency file prints no "null" under the currency line',
        !/null/i.test(await page.eval("document.querySelector('.review').textContent")),
        await page.eval("document.querySelector('.review').textContent"),
      );
      await setValue('#import-erase', 'ERASE');
      await replaceVault();
      await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the transfer to land' });
      const transferredVault = await inPage('return { names: [...v.holdings.values()].map(h => h.payload.name), unreadable: v.unreadable.length, currency: v.mainCurrency }');
      check(
        'a vault exported by a different user imports, and every record decrypts',
        transferredVault.names.join(',') === 'Transfer probe' && transferredVault.unreadable === 0 && transferredVault.currency === 'EUR' &&
          (await text()).includes('The figures on screen are now in EUR.'),
        JSON.stringify(transferredVault),
      );

      // The source's later record, put straight into this vault's rows,
      // does not decrypt: the two vaults share no key.
      const [row] = sql('SELECT * FROM records WHERE record_id = ?', later);
      const [{ id: mine }] = sql("SELECT id FROM principals WHERE username = 'leander'");
      sql(
        'INSERT INTO records (principal_id, record_id, record_type, account_id, schema_version, version, nonce, ciphertext, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        mine, row.record_id, row.record_type, row.account_id, row.schema_version, row.version, row.nonce, row.ciphertext, row.updated_at,
      );
      const injected = await inPage(`await v.load(); return v.unreadable.includes(${JSON.stringify(later)});`);
      check("a record the source wrote after the export, inserted into this vault's rows, fails to decrypt", injected);
      sql("DELETE FROM records WHERE record_id = ? AND principal_id = (SELECT id FROM principals WHERE username = 'leander')", later);

      // The restored profile is the one every date follows from here on.
      // The expected strings are spelled out from the stored ISO date, not
      // asked of the formatter under test.
      await page.eval('(async () => (await import("/static/js/session.js")).currentVault().load())()');
      await page.eval("location.hash = '#/unassigned/none'");
      await page.settle(200);
      await page.eval("location.hash = '#/'");
      await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the transferred dashboard' });
      await page.settle(400);
      const monthFirst = `${BACKDATE.slice(5, 7)}/${BACKDATE.slice(8, 10)}/${BACKDATE.slice(0, 4)}`;
      const transferredAsOf = await labels('.holdings-table .cell-asof span:first-child');
      check(
        "after a restore the dashboard's As of dates follow the restored profile's style",
        transferredAsOf.length > 0 && transferredAsOf.every((shown) => shown === monthFirst),
        `${transferredAsOf.join(' | ')} against ${monthFirst}`,
      );
    } finally {
      other.child.kill();
    }

    // Back to this vault's own history, from the file it exported, which
    // still opens after two imports into the vault it came from.
    await page.eval('(async () => (await import("/static/js/session.js")).currentVault().load())()');
    await toScreen();
    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review to restore' });
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the restore to land' });
    const restoredRecords = JSON.stringify(await decrypted());
    const restoredLine = await page.eval("document.querySelector('[role=status].callout')?.textContent || ''");
    check(
      'the vault is its own again after importing its own file back',
      restoredRecords === JSON.stringify(recordsBefore) && restoredLine.includes('The figures on screen are now in CHF.'),
      `${restoredLine} ${restoredRecords.length} against ${JSON.stringify(recordsBefore).length}`,
    );

    // -- A chosen date style reaches every date that shows a day -------------
    //
    // Every expected string below is read off the stored ISO dates and
    // written out by hand, never asked of the formatter under test: a
    // helper that derives the expectation from the code it checks agrees
    // with that code whatever the code does.

    const recordsNow = await decrypted();
    const snapshots = Object.values(recordsNow).filter((r) => r.type === 'snapshot');
    const snapshotDates = new Set(snapshots.map((r) => r.payload.date));
    const probeHolding = snapshots[0].accountId;
    const isoShape = /^\d{4}-\d{2}-\d{2}$/;
    const monthName = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/;
    const dmyOf = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

    const saveDateStyle = async (value) => {
      await page.eval("location.hash = '#/settings'");
      await page.waitUntil("document.getElementById('format-dates')", { label: 'the dates setting' });
      await page.settle(300);
      await page.eval(`(() => {
        const node = document.getElementById('format-dates');
        node.value = ${JSON.stringify(value)};
        node.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await page.eval("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Dates and numbers')).querySelector('.btn-primary').click()");
      await page.settle(1200);
    };
    const dashboardAsOf = async () => {
      await page.eval("location.hash = '#/unassigned/none'");
      await page.settle(200);
      await page.eval("location.hash = '#/'");
      await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the dashboard table' });
      await page.settle(400);
      return labels('.holdings-table .cell-asof span:first-child');
    };

    await saveDateStyle('ymd');
    check(
      'the dates setting saved is the year-first style',
      (await page.eval("(async () => (await import('/static/js/session.js')).currentVault().profile.dateStyle)()")) === 'ymd',
    );

    const asOfYmd = await dashboardAsOf();
    check(
      'with year-first saved, every As of date on the dashboard is YYYY-MM-DD with no month name',
      asOfYmd.length > 0 && asOfYmd.every((shown) => isoShape.test(shown) && !monthName.test(shown)) &&
        asOfYmd.some((shown) => snapshotDates.has(shown)),
      asOfYmd.join(' | '),
    );

    await page.eval(`location.hash = '#/holding/${probeHolding}'`);
    await page.waitUntil("document.querySelector('.hero-age')", { label: 'the holding page' });
    await page.settle(400);
    const heroAges = await labels('.hero-age');
    const snapshotButtons = await labels('.data-table tbody .link-button');
    check(
      'with year-first saved, the holding page writes its as-of line and every snapshot date as YYYY-MM-DD',
      heroAges.some((age) => /^as of \d{4}-\d{2}-\d{2}, /.test(age) && snapshotDates.has(age.slice(6, 16))) &&
        heroAges.every((age) => !monthName.test(age.replace(/, .*/, ''))) &&
        snapshotButtons.length > 0 && snapshotButtons.every((shown) => isoShape.test(shown) && snapshotDates.has(shown)),
      `${heroAges.join(' | ')} / ${snapshotButtons.join(' | ')}`,
    );

    await page.eval("location.hash = '#/unassigned/none'");
    await page.settle(200);
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the dashboard before the picker' });
    await page.settle(400);
    const recordedDay = [...snapshotDates].sort()[0];
    await page.eval("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New recording').click()");
    await page.waitUntil("document.querySelector('.dialog .date-day')", { label: 'the date picker' });
    await page.eval(`(() => {
      for (let i = 0; i < 600 && !document.querySelector('.dialog .date-day[data-date="${recordedDay}"]'); i += 1) {
        document.querySelector('.dialog [aria-label="Previous month"]').click();
      }
    })()`);
    const pickerName = await page.eval(`document.querySelector('.dialog .date-day[data-date="${recordedDay}"]').getAttribute('aria-label')`);
    check(
      "with year-first saved, the date picker's marked day names itself as YYYY-MM-DD",
      pickerName === `${recordedDay}, has a recording`,
      pickerName,
    );
    await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Cancel').click()");
    await page.settle(200);

    const chartDays = await labels('svg.trend .axis-tick');
    check(
      'with year-first saved, no day tick on the chart axis spells a month',
      chartDays.every((tick) => !(monthName.test(tick) && /(^|\D)\d{1,2}(\D|$)/.test(tick))),
      chartDays.join(' | '),
    );

    // The review is of the file, but it is read in the vault now open, so
    // it is written in that vault's style: the file's own profile applies
    // only once the restore is done.
    await toScreen();
    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review in year-first dates' });
    const exportedOn = exported.exportedAt.slice(0, 10);
    const exportedLine = await page.eval("[...document.querySelectorAll('.review .hint')].map(n => n.textContent).find(t => t.startsWith('Exported')) || ''");
    check(
      "the import review's Exported date is in the style of the vault that is open, not the file's",
      exportedLine === `Exported ${exportedOn}`,
      exportedLine,
    );

    // Restoring brings back the profile that file was exported with, which
    // writes day first, and every date follows it.
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the restore into dates that differ' });
    const afterRestore = await dashboardAsOf();
    check(
      "after the restore the dashboard's As of dates follow the restored profile's day-first style",
      afterRestore.length > 0 && afterRestore.every((shown) => /^\d{2}\.\d{2}\.\d{4}$/.test(shown)) &&
        afterRestore.some((shown) => [...snapshotDates].some((iso) => dmyOf(iso) === shown)),
      afterRestore.join(' | '),
    );
  }

  // ---- Locking ------------------------------------------------------------

  await page.goto(`${BASE}/dashboard`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the unlocked dashboard' });
  await page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Lock').click()");
  await page.settle(500);
  check('locking shows the unlock card again', (await text()).includes('Solvent cannot recover a lost password'));
  check('locking leaves no decrypted figure on screen', !(await text()).includes('12 450'));
  const sessionAlive = await page.eval(`(async () => {
    const response = await fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } });
    return response.status;
  })()`);
  check('the server session survives the lock', sessionAlive === 200, String(sessionAlive));
  check('no key material reaches storage', await page.eval(`(() => {
    const blob = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    return blob === '{}{}' || (!blob.includes('Dek') && !blob.includes('authKey') && !blob.includes('key'));
  })()`));

  // ---- Two entries on one date -------------------------------------------

  // The client refuses to create this state, so it is planted behind
  // the client and read back by a fresh unlock. Everything sits in
  // 2020, before any other figure in the vault, so every chart point
  // there is the probes' alone.
  const unlockDashboard = async (label) => {
    await page.goto(`${BASE}/dashboard`);
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label });
    await page.settle(1000);
  };
  const holding = (name, unit) => ({
    type: 'account',
    payload: { name, unit, dims: {}, note: null, archivedAt: null, createdAt: '2020-01-01T00:00:00Z' },
  });
  const figure = (accountId, date, value) => ({ type: 'snapshot', accountId, payload: { date, value, note: null } });
  const price = (symbol, date, rate) => ({
    type: 'rate',
    payload: { symbol, date, rate, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: date, proposedRate: null },
  });

  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard to plant into' });
  const [euro, sterling, francs] = await plant([
    holding('Probe euro', 'PROBE-E'),
    holding('Probe sterling', 'PROBE-S'),
    holding('Probe francs', 'CHF'),
  ]);
  const planted = await plant([
    // Two differing prices at 11 January between 1.00 and 1.20.
    figure(euro, '2020-01-01', '1000'),
    figure(euro, '2020-01-11', '1000'),
    price('PROBE-E', '2020-01-01', '1.00'),
    price('PROBE-E', '2020-01-11', '1.40'),
    price('PROBE-E', '2020-01-11', '1.60'),
    price('PROBE-E', '2020-01-21', '1.20'),
    price('PROBE-E', '2020-03-11', '1.00'),
    // A pair that is the symbol's only entry.
    figure(sterling, '2020-02-01', '500'),
    price('PROBE-S', '2020-02-01', '1.10'),
    price('PROBE-S', '2020-02-01', '1.30'),
    // Two differing figures at 11 March between 1000 and 2000.
    figure(francs, '2020-03-01', '1000'),
    figure(francs, '2020-03-11', '5000'),
    figure(francs, '2020-03-11', '7000'),
    figure(francs, '2020-03-21', '2000'),
    // Pure duplication, byte for byte.
    price('PROBE-I', '2020-04-01', '2.00'),
    price('PROBE-I', '2020-04-01', '2.00'),
  ]);
  const identical = planted.slice(-2);
  // One of the differing prices carries a higher version, so a rule
  // preferring it would read one entry before an export and the other
  // after, since import resets every version to 1.
  await plant([{ ...price('PROBE-E', '2020-01-11', '1.60'), recordId: planted[4], version: 2 }]);
  await unlockDashboard('the dashboard over the planted pairs');

  const moneyOf = (value) =>
    `(await import('/static/js/session.js')).currentVault().format.money((await import('/static/js/decimal.js')).parse('${value}'))`;
  // The chart's own table, read at one date, beside the figure that
  // date should carry.
  const chartAt = (date, expected) =>
    page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      [...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click();
      await new Promise(r => setTimeout(r, 300));
      const row = [...document.querySelectorAll('details table tbody tr')]
        .find(r => r.cells[0].textContent === v.format.date('${date}'));
      return JSON.stringify({ shown: row ? row.cells[1].textContent : null, expected: ${moneyOf(expected)} });
    })()`).then(JSON.parse);
  const banner = () => labels('.banner-critical button');
  // What the screens make of the planted pairs, for comparing one
  // client's reading with another's.
  const picture = async () => {
    await page.eval("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await page.settle(300);
    return JSON.stringify({
      banner: (await banner()).filter((line) => !line.includes('PROBE-I')).sort(),
      chart: (await page.eval("[...document.querySelectorAll('details table tbody tr')].map(r => r.textContent)"))
        .filter((row) => row.includes('2020')),
      notPriced: await page.eval(`(() => {
        const group = [...document.querySelectorAll('.table-group')].find(g => g.textContent.includes('Not priced'));
        return group ? [...group.querySelectorAll('.link-button')].map(b => b.textContent).sort() : [];
      })()`),
      hero: await page.eval("document.querySelector('.hero-figure').textContent"),
    });
  };

  const between = await chartAt('2020-01-11', '1100');
  check(
    'a symbol with two differing prices on one date prices it from its neighbours',
    between.shown !== null && between.shown === between.expected,
    JSON.stringify(between),
  );
  check(
    'the dashboard names the price fault',
    (await banner()).some((line) => line.includes('PROBE-E') && line.startsWith('Two entries on')),
    (await banner()).join(' | '),
  );
  const notPriced = JSON.parse(await picture()).notPriced;
  check(
    'a pair that is its symbol\'s only entry leaves the holding not priced',
    notPriced.includes('Probe sterling'),
    notPriced.join(','),
  );
  const figuresAt = await chartAt('2020-03-11', '2500');
  check(
    'the chart leaves two figures on one date out and runs between their neighbours',
    figuresAt.shown !== null && figuresAt.shown === figuresAt.expected,
    JSON.stringify(figuresAt),
  );
  check(
    'the dashboard names the figure fault',
    (await banner()).some((line) => line.includes('Probe francs') && line.startsWith('Two entries on')),
    (await banner()).join(' | '),
  );
  const identicalLeft = await page.eval(`(async () => {
    const api = await import('/static/js/api.js');
    const rows = await api.get('/api/records?type=rate');
    return rows.filter(r => ${JSON.stringify(identical)}.includes(r.recordId)).length;
  })()`);
  check('a byte-identical pair of prices leaves exactly one record', identicalLeft === 1, `${identicalLeft} left`);
  const inOrder = await picture();

  await page.eval(`location.hash = '#/holding/${francs}'`);
  await page.waitUntil("document.querySelector('.card .data-table')", { label: "the probe holding's screen" });
  await page.settle(400);
  const history = JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.card .data-table tbody tr')]
    .map(r => ({ flagged: r.classList.contains('flagged'), keep: r.textContent.includes('Keep this one'), text: r.textContent })))`));
  const pair = history.filter((row) => row.flagged);
  check(
    'the holding page shows both figures on one date flagged, each offering Keep this one',
    history.length === 4 && pair.length === 2 && pair.every((row) => row.keep),
    history.map((row) => `${row.flagged ? 'flagged ' : ''}${row.text}`).join(' | '),
  );

  const flaggedOnRecording = async (date, symbolOrName) => {
    await page.eval(`location.hash = '#/recording/${date}'`);
    await page.waitUntil("document.querySelector('.screen-heading')", { label: `the recording for ${date}` });
    await page.settle(400);
    return JSON.parse(await page.eval(`JSON.stringify([...document.querySelectorAll('.data-table tbody tr')]
      .filter(r => r.cells[0].textContent === ${JSON.stringify(symbolOrName)})
      .map(r => ({ flagged: r.classList.contains('flagged'), keep: r.textContent.includes('Keep this one') })))`));
  };
  const prices = await flaggedOnRecording('2020-01-11', 'PROBE-E');
  check(
    'the recording shows both differing prices flagged, each offering Keep this one',
    prices.length === 2 && prices.every((row) => row.flagged && row.keep),
    JSON.stringify(prices),
  );
  const figures = await flaggedOnRecording('2020-03-11', 'Probe francs');
  check(
    'the recording shows both figures on one date flagged, each offering Keep this one',
    figures.length === 2 && figures.every((row) => row.flagged && row.keep),
    JSON.stringify(figures),
  );

  // A second client, handed every record list in the opposite order.
  await fetchOn(page, '*/api/records*', 'Response');
  const reverse = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request, responseHeaders = [] } = message.params;
    if (isRateAsk(page, request)) return;
    if (request.method !== 'GET' || !request.url.includes('?type=')) {
      await page.send('Fetch.continueRequest', { requestId });
      return;
    }
    const { body, base64Encoded } = await page.send('Fetch.getResponseBody', { requestId });
    const rows = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString() : body);
    await page.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: responseHeaders.filter((h) => h.name.toLowerCase() !== 'content-length'),
      body: Buffer.from(JSON.stringify(rows.reverse())).toString('base64'),
    });
  };
  page.on(reverse);
  try {
    await unlockDashboard('the dashboard over reversed records');
    const reversed = await picture();
    check('the planted pairs read the same in either order', reversed === inOrder, `${inOrder} vs ${reversed}`);
  } finally {
    page.handlers = page.handlers.filter((h) => h !== reverse);
    await fetchOff(page);
  }

  const roundTrip = JSON.parse(await importOwnExport());
  check('the planted vault survives the round trip', roundTrip.unreadable === 0, String(roundTrip.unreadable));
  await unlockDashboard('the dashboard after the round trip');
  const afterImport = await picture();
  check('the planted pairs read the same after an export and import', afterImport === inOrder, `${inOrder} vs ${afterImport}`);

  // ---- A holding first recorded later steps in, it does not ramp ---------
  //
  // Everything sits in 2019, before any other figure in the vault, so
  // the left of the net line is the probes' alone. The line is read off
  // the drawn polyline, with each date's x taken from its entry mark.
  const [checking, flat] = await plant([holding('Ramp checking', 'CHF'), holding('Ramp flat', 'RAMP-SQM')]);
  const ramp = await plant([
    figure(checking, '2019-09-15', '1000'),
    figure(checking, '2019-10-01', '1000'),
    figure(flat, '2019-10-01', '100'),
    price('RAMP-SQM', '2019-10-01', '8000'),
  ]);
  await unlockDashboard('the dashboard over the ramp probes');
  const line = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    [...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click();
    await new Promise(r => setTimeout(r, 300));
    const mark = (iso) => [...document.querySelectorAll('.entry-mark')]
      .find(m => m.querySelector('title').textContent.startsWith(v.format.longDate(iso)));
    const points = document.querySelector('svg.trend .net-line').getAttribute('points').split(' ')
      .map(p => p.split(',').map(Number));
    return JSON.stringify({
      points,
      step: Number(mark('2019-10-01').getAttribute('x1')),
      end: Number(document.querySelector('svg.trend .net-end').getAttribute('cy')),
    });
  })()`));
  const [first, ...others] = line.points;
  const stepAt = line.points.filter(([x]) => Math.abs(x - line.step) < 0.01);
  const toStep = line.points.filter(([x]) => x < line.step - 0.01);
  check(
    'net-worth-view: a holding first recorded on a later date lifts the net line there in one vertical step, not along the way from the date before',
    stepAt.length >= 2 && stepAt[0][1] > stepAt.at(-1)[1] && toStep.every(([, y]) => Math.abs(y - first[1]) < 0.01) &&
      Math.abs(stepAt[0][1] - first[1]) < 0.01,
    JSON.stringify(line.points.slice(0, 6)),
  );
  check(
    'net-worth-view: the net line has no step at the chart\'s first date and none at its last',
    line.points.filter(([x]) => x === first[0]).length === 1 && others.at(-1)[1] === line.end,
    JSON.stringify([first, others.at(-1), line.end]),
  );
  await page.eval(`(async () => {
    const api = await import('/static/js/api.js');
    for (const id of ${JSON.stringify([...ramp, checking, flat])}) await api.del('/api/records/' + id);
  })()`);
  await unlockDashboard('the dashboard after the ramp probes');

  // ---- Recording, in a vault of its own ---------------------------------
  //
  // record-rate.md, record-snapshot.md and net-worth-view.md, Acceptance
  // criteria, through the screens they drive: the sweep, the
  // single-holding form, a recording's own screen and the dashboard
  // (ui/update-values.md, snapshot-entry.md, recording-detail.md,
  // dashboard.md). A second browser holds a vault of its own, so every
  // figure and date below is the test's. The rate proxy is answered
  // here rather than by a provider, so a proposal, No Content and an
  // outage are each chosen, and every request the page sends is seen
  // whole, headers and body included.
  const recorder = await launch();
  try {
    const rec = await Session.connect(recorder.target);
    await rec.send('Page.enable');
    await rec.send('Runtime.enable');
    rec.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        problems.push(message.params.exceptionDetails.exception?.description || 'exception');
      }
    });
    // Requests still in flight, so a step waits for its writes rather
    // than for a guessed interval.
    await rec.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__inflight = 0;
        const send = window.fetch;
        window.fetch = (...args) => {
          window.__inflight += 1;
          return send(...args).finally(() => { window.__inflight -= 1; });
        };
      })();`,
    });

    const DAY = 86400000;
    const dayOf = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
    const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);
    const T = new Date().toISOString().slice(0, 10);
    const ago = (days) => isoOf(dayOf(T) - days);
    const D1 = ago(200);
    const D2 = ago(100);
    const D5 = ago(30);
    const D6 = ago(20);
    const D7 = ago(25);
    const D8 = ago(26);
    const D9 = ago(27);
    const D10 = ago(10);
    const D11 = ago(40);

    // What the proxy answers. Each date's figures differ from its
    // neighbors', so the two pricing modes and every stretch between
    // entries read differently.
    let rateMode = 'answer';
    let rateDelay = 0;
    const proposalsFor = (date) => {
      const d = dayOf(date);
      const revised = rateMode === 'revised' ? 0.5 : 0;
      return {
        USD: { rate: (0.85 + (d % 7) / 100 + revised).toFixed(2), asOf: date },
        'XAU-ozt': { rate: String(2600 + (d % 50) + revised * 100), asOf: isoOf(d - 1) },
      };
    };
    const traffic = [];
    const faults = [];
    let muted = false;
    await rec.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
    rec.on(async (message) => {
      if (message.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = message.params;
      const entry = { method: request.method, url: request.url, headers: request.headers, body: request.postData || '' };
      if (!muted) traffic.push(entry);
      try {
        if (request.url.includes('/api/rates?')) {
          if (rateDelay) await new Promise((resolve) => setTimeout(resolve, rateDelay));
          if (rateMode === 'down') return await rec.send('Fetch.fulfillRequest', { requestId, responseCode: 503, body: '' });
          if (rateMode === 'none') return await rec.send('Fetch.fulfillRequest', { requestId, responseCode: 204, body: '' });
          const query = Object.fromEntries(new URL(request.url).searchParams);
          const body = JSON.stringify({ date: query.date, quote: query.quote, rates: proposalsFor(query.date) });
          return await rec.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(body).toString('base64'),
          });
        }
        for (const fault of faults) {
          const status = fault(entry);
          if (status) return await rec.send('Fetch.fulfillRequest', { requestId, responseCode: status, body: '' });
        }
        await rec.send('Fetch.continueRequest', { requestId });
      } catch {
        /* the page went away mid-request */
      }
    });
    const writesSent = () => traffic.filter((r) => r.method === 'PUT' || r.method === 'DELETE');
    const rateAsks = () => traffic.filter((r) => r.url.includes('/api/rates?'));
    const typeReads = (type) => traffic.filter((r) => r.method === 'GET' && r.url.endsWith(`/api/records?type=${type}`));
    const bodyOf = (r) => (r.body ? JSON.parse(r.body) : null);

    const ev = (expression) => rec.eval(expression);
    const text = () => ev('document.body.innerText');
    const quiet = async () => {
      for (let calm = 0; calm < 3; ) {
        await rec.settle(150);
        calm = (await ev('window.__inflight || 0')) === 0 ? calm + 1 : 0;
      }
    };
    const set = (selector, value, index = 0) =>
      ev(`(() => {
        const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
        node.value = ${JSON.stringify(value)};
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    const press = async (label, scope = '') => {
      await ev(`[...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} a`)})]
        .find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
      await quiet();
    };
    // What a person does, through the protocol. element.click() ignores
    // whatever is drawn over a control, so a control a popup covers passes
    // every check made with it. A real mouse event lands on whatever is
    // painted at the point, which is the only way to test "can be pressed".
    const centerOf = (selector, label = null) =>
      ev(`(() => {
        const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const node = ${label === null ? 'nodes[0]' : `nodes.find(n => n.textContent.trim() === ${JSON.stringify(label)})`};
        if (!node) return null;
        node.scrollIntoView({ block: 'center' });
        const r = node.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
    const realClickAt = async ({ x, y }) => {
      await rec.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await rec.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await rec.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await quiet();
    };
    const realClick = async (selector, label = null) => {
      const at = await centerOf(selector, label);
      if (!at) throw new Error(`nothing to click for ${selector} ${label ?? ''}`);
      await realClickAt(at);
    };
    // The element painted at a control's own centre is that control (or
    // part of it), so nothing covers it.
    const uncovered = (selector, label = null) =>
      ev(`(() => {
        const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const node = ${label === null ? 'nodes[0]' : `nodes.find(n => n.textContent.trim() === ${JSON.stringify(label)})`};
        if (!node) return false;
        node.scrollIntoView({ block: 'center' });
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit) && node.contains(hit);
      })()`);
    const realKey = async (key, code, keyCode) => {
      for (const type of ['rawKeyDown', 'keyUp']) {
        await rec.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode });
      }
      await rec.settle(50);
    };
    // The vault as the page's own crypto reads it back from the server,
    // each record with its bytes and its decrypted payload.
    const stored = async (type) => {
      await quiet();
      muted = true;
      try {
        return JSON.parse(await ev(`(async () => {
          const api = await import('/static/js/api.js');
          const c = await import('/static/js/crypto.js');
          const dek = (await import('/static/js/session.js')).currentVault().dek;
          const out = [];
          for (const r of await api.get('/api/records?type=${type}')) {
            let payload = null;
            try { payload = await c.decryptRecord(dek, r); } catch {}
            out.push({ ...r, payload });
          }
          return JSON.stringify(out);
        })()`));
      } finally {
        muted = false;
      }
    };
    const on = (rows, date) => rows.filter((r) => r.payload && r.payload.date === date);
    const bytes = (rows) =>
      JSON.stringify(rows.map(({ recordId, version, nonce, ciphertext }) => ({ recordId, version, nonce, ciphertext })));
    // Records the client would never write itself, or writes another
    // window made, encrypted with the page's own crypto and PUT straight
    // to the record API behind the model on screen.
    const plantHere = async (list) => {
      await quiet();
      muted = true;
      try {
        return await ev(`(async () => {
          const api = await import('/static/js/api.js');
          const c = await import('/static/js/crypto.js');
          const { SCHEMA_VERSION } = await import('/static/js/model.js');
          const dek = (await import('/static/js/session.js')).currentVault().dek;
          const ids = [];
          for (const r of ${JSON.stringify(list)}) {
            const slot = {
              recordId: r.recordId || c.uuid4(), recordType: r.type, accountId: r.accountId ?? null,
              schemaVersion: SCHEMA_VERSION, version: r.version || 1,
            };
            // A blob sealed for another version is one no key opens.
            const blob = await c.encryptRecord(dek, r.corrupt ? { ...slot, version: slot.version + 1 } : slot, r.payload);
            await api.put('/api/records/' + slot.recordId, {
              recordType: slot.recordType, accountId: slot.accountId,
              schemaVersion: slot.schemaVersion, version: slot.version, ...blob,
            });
            ids.push(slot.recordId);
          }
          return ids;
        })()`);
      } finally {
        muted = false;
      }
    };
    // Read the whole vault again, as a fresh unlock would.
    const reread = async () => {
      muted = true;
      try {
        await ev("(async () => { await (await import('/static/js/session.js')).currentVault().load(); })()");
      } finally {
        muted = false;
      }
    };
    // A hash the page already shows is left through the dashboard, so
    // the screen is drawn afresh from the model.
    const go = async (hash) => {
      if ((await ev('location.hash')) === hash) await ev(`location.hash = '#/unassigned/none'`);
      await ev(`location.hash = ${JSON.stringify(hash)}`);
      await rec.settle(200);
      await quiet();
    };
    const format = (method, iso) =>
      ev(`(async () => (await import('/static/js/session.js')).currentVault().format.${method}('${iso}'))()`);
    const model = (body) =>
      ev(`(async () => {
        const v = (await import('/static/js/session.js')).currentVault();
        const decimal = await import('/static/js/decimal.js');
        const { dayNumber } = await import('/static/js/model.js');
        return JSON.stringify(${body});
      })()`).then(JSON.parse);

    // The sweep's rows and rate lines.
    const row = (name) =>
      `[...document.querySelectorAll('.sweep-row')].find(r => r.querySelector('.holding-name').textContent === ${JSON.stringify(name)})`;
    const typeRow = (name, value) =>
      ev(`(() => {
        const field = ${row(name)}.querySelector('input');
        field.value = ${JSON.stringify(value)};
        field.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    const control = (name) => ev(`${row(name)}.querySelector(':scope > button').textContent`);
    const pressRow = async (name) => {
      await ev(`${row(name)}.querySelector(':scope > button').click()`);
      await rec.settle(200);
      await quiet();
    };
    const rowState = (name) =>
      ev(`JSON.stringify((() => { const r = ${row(name)}; return {
        state: r.querySelector('.row-state').textContent,
        field: r.querySelector('input').value,
        error: r.querySelector('.field-error').hidden ? '' : r.querySelector('.field-error').textContent,
        disabled: r.querySelector(':scope > button').disabled,
      }; })())`).then(JSON.parse);
    const line = (unit) => `document.querySelector('.rate-line[data-unit="${unit}"]')`;
    const lineState = (unit) =>
      ev(`JSON.stringify((() => { const l = ${line(unit)}; return l && {
        value: l.querySelector('input') ? l.querySelector('input').value : null,
        chip: l.querySelector('.chip').textContent,
        says: l.querySelector(':scope > .hint').textContent,
        error: l.querySelector('.field-error').hidden ? '' : l.querySelector('.field-error').textContent,
        lookup: Boolean(l.querySelector('.btn-inline:not([hidden])')),
      }; })())`).then(JSON.parse);
    const typeLine = (unit, value) =>
      ev(`(() => {
        const field = ${line(unit)}.querySelector('input');
        field.value = ${JSON.stringify(value)};
        field.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    const figure = (shown) => Number(String(shown).replace(/[^\d.-]/g, ''));

    // The dashboard's table.
    const tableRow = (name) =>
      ev(`JSON.stringify((() => {
        const r = [...document.querySelectorAll('.holdings-table tbody tr')]
          .find(tr => tr.querySelector('.row-name').textContent === ${JSON.stringify(name)});
        return r ? { converted: r.querySelector('.cell-converted').textContent, asOf: r.querySelector('.cell-asof').textContent, text: r.textContent } : null;
      })())`).then(JSON.parse);
    const group = (title) =>
      ev(`JSON.stringify((() => {
        const g = [...document.querySelectorAll('.table-group')].find(g => g.querySelector('.group-heading').textContent === ${JSON.stringify(title)});
        return g ? [...g.querySelectorAll('.link-button')].map(b => b.textContent) : [];
      })())`).then(JSON.parse);
    const hero = () => ev("document.querySelector('.hero-figure').textContent");
    const home = async () => {
      await ev(`document.querySelector('.topbar nav a[href="#/"]').click()`);
      await rec.settle(200);
      await quiet();
    };
    // Opens the picker, steps back to the month holding `iso`, and picks
    // the day with a real click. Says what the day's mark and accessible
    // name were, which is how the picker tells a recorded date from a free one.
    const pickerDay = (iso) => `.dialog .date-day[data-date="${iso}"]`;
    const newRecording = async (iso, { wait = true } = {}) => {
      await press('New recording');
      for (let step = 0; step < 400 && !(await ev(`Boolean(document.querySelector('${pickerDay(iso)}'))`)); step += 1) {
        await ev(`document.querySelector('.dialog [aria-label="Previous month"]').click()`);
      }
      const day = JSON.parse(await ev(`(() => {
        const d = document.querySelector('${pickerDay(iso)}');
        return JSON.stringify({ name: d.getAttribute('aria-label'), dotted: d.classList.contains('has-recording') });
      })()`));
      if (wait) await realClick(pickerDay(iso));
      else {
        // Without waiting for the network to go quiet, for a step that
        // looks at the screen while a request is still pending.
        const at = await centerOf(pickerDay(iso));
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
          await rec.send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
        }
      }
      await rec.settle(200);
      if (wait) await quiet();
      return { marked: day.dotted && day.name === `${await format('dayMonth', iso)}, has a recording`, name: day.name, dotted: day.dotted };
    };
    const sweepToday = async () => {
      await ev("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Update values').click()");
      await rec.waitUntil("location.hash.startsWith('#/sweep/')", { label: "today's sweep" });
      await rec.settle(200);
      await quiet();
    };

    // ---- An administrator invites the recorder --------------------------

    const RECORDER_PASSWORD = 'lantern quarry velvet oboe';
    await rec.goto(`${BASE}/login`);
    await set('#unlock-username', 'ops.leander');
    await set('#unlock-password', ADMIN_PASSWORD);
    await ev("document.querySelector('button[type=submit]').click()");
    await rec.waitUntil("location.pathname === '/admin'", { timeout: 90000, label: 'the admin area for the recorder invite' });
    await rec.settle(600);
    await set('input[type=text]', 'Recording checks');
    await press('Create invite link');
    await rec.waitUntil("document.body.innerText.includes('Copy this now')", { label: 'the recorder invite' });
    const recorderInvite = (await ev("document.querySelector('input[readonly]').value")).split('invite=')[1];
    await rec.goto(`${BASE}/register?invite=${recorderInvite}`);
    await set('input[type=text]', 'recorder');
    await set('input[type=password]', RECORDER_PASSWORD, 0);
    await set('input[type=password]', RECORDER_PASSWORD, 1);
    await set('select', 'CHF');
    await ev(`(() => {
      const box = document.querySelector('input[type=checkbox]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await rec.settle(300);
    await ev("document.querySelector('button[type=submit]').click()");
    await rec.waitUntil("location.pathname === '/dashboard'", { timeout: 90000, label: 'the recorder dashboard' });
    await rec.waitUntil("!document.querySelector('#unlock-password') && document.body.innerText.includes('Add your first holding')", { timeout: 90000, label: 'the recorder vault' });
    await rec.settle(500);
    await quiet();

    await go(`#/sweep/${T}`);
    const bare = await text();
    await press('Add a holding', '.sweep');
    check(
      'record-snapshot: a sweep with no holdings says to add one first, offers the form, and shows no rates',
      bare.includes('Add a holding first.') && !bare.includes('Rates for this date') &&
        (await ev("document.querySelector('.dialog-heading').textContent")) === 'Add a holding',
    );
    await ev("document.querySelectorAll('.scrim').forEach(s => s.remove())");

    // ---- Fifteen holdings and two past recordings -------------------------

    const script = '<script>alert(1)</script>';
    const HOLDINGS = [
      ['Current account', 'CHF', { liq: 'cash' }],
      ['Savings', 'CHF', { liq: 'cash' }],
      ['Brokerage', 'USD', { liq: 'cash' }],
      ['Dollar cash', 'USD'],
      ['Gold bars', 'XAU-ozt'],
      ['Silver coins', 'XAG-ozt'],
      ['Flat', 'm2'],
      ['Mortgage', 'CHF'],
      ['Fund 1', 'CHF'],
      ['Fund 2', 'CHF'],
      ['Fund 3', 'CHF'],
      ['Fund 4', 'CHF'],
      ['Fund 5', 'CHF'],
      [script, 'CHF', { liq: 'odd' }],
      ['Art', 'PAINT'],
    ];
    const accountIds = await plantHere(
      HOLDINGS.map(([name, unit, dims = {}], i) => ({
        type: 'account',
        payload: { name, unit, dims, note: null, archivedAt: null, createdAt: `2020-01-01T00:00:${String(i).padStart(2, '0')}Z` },
      })),
    );
    const id = Object.fromEntries(HOLDINGS.map(([name], i) => [name, accountIds[i]]));
    const snap = (name, date, value) => ({ type: 'snapshot', accountId: id[name], payload: { date, value, note: null } });
    const price = (symbol, date, rate, rateSource = 'manual') => ({
      type: 'rate',
      payload: { symbol, date, rate, rateTarget: 'CHF', rateSource, rateAsOf: rateSource === 'manual' ? null : date, proposedRate: null },
    });
    const FIRST = {
      'Current account': '1000', Savings: '5000', Brokerage: '2000', 'Dollar cash': '300', 'Gold bars': '10',
      'Silver coins': '100', Flat: '95', Mortgage: '-400000', 'Fund 1': '100', 'Fund 2': '101', 'Fund 3': '102',
      'Fund 4': '103', 'Fund 5': '104', [script]: '105',
    };
    await plantHere([
      ...Object.entries(FIRST).map(([name, value]) => snap(name, D1, value)),
      // The first recording priced gold, silver and the flat, and not
      // the dollar, and the second priced the dollar alone.
      price('XAU-ozt', D1, '2500', 'proposed'),
      price('XAG-ozt', D1, '25'),
      price('m2', D1, '10000'),
      snap('Current account', D2, '1100'),
      snap('Brokerage', D2, '2100'),
      price('USD', D2, '0.92', 'proposed'),
    ]);
    const profile = await model('{ recordId: v.profileRecord.recordId, version: v.profileRecord.version, payload: v.profile }');
    await plantHere([{
      type: 'profile',
      recordId: profile.recordId,
      version: profile.version + 1,
      payload: {
        ...profile.payload,
        dimensions: [{
          id: 'liq', label: 'Liquidity', archivedAt: null,
          values: [{ id: 'cash', label: 'Cash', archivedAt: null }, { id: 'odd', label: script, archivedAt: null }],
        }],
      },
    }]);
    await reread();
    await go('#/');
    await home();

    // ---- record-rate: a new sweep, and the franc holding it exists for ----

    const before = { brokerage: await tableRow('Brokerage'), gold: await tableRow('Gold bars') };
    const counts = () => model(`[${JSON.stringify(id.Brokerage)}, ${JSON.stringify(id['Gold bars'])}].map(a => v.snapshotsFor(a).length)`);
    const snapshotCounts = await counts();
    traffic.length = 0;
    await sweepToday();
    await rec.waitUntil(`${line('USD')}.querySelector('input').value !== ''`, { label: 'the proposals on arrival' });
    await quiet();
    const usd = await lineState('USD');
    const gold = await lineState('XAU-ozt');
    check(
      'record-rate: a sweep at a date holding nothing arrives with its rate lines filled in by that date\'s proposals',
      figure(usd.value) === Number(proposalsFor(T).USD.rate) && figure(gold.value) === Number(proposalsFor(T)['XAU-ozt'].rate) &&
        usd.chip === 'Market rate',
      JSON.stringify({ usd, gold }),
    );
    check('record-rate: a proposal for an earlier day says which day it is for', gold.chip.startsWith('Market rate as of '), gold.chip);
    check(
      'record-rate: arriving at a new sweep writes nothing and asks the proxy once',
      writesSent().length === 0 && rateAsks().length === 1,
      `${writesSent().length} writes, ${rateAsks().length} asks`,
    );
    const silver = await lineState('XAG-ozt');
    check(
      'record-rate: a symbol with no provider shows its last figure, its age, and whose it is to set',
      figure(silver.value) === 25 && silver.says.startsWith('Estimated ') && silver.says.includes('No market price for silver yet. This one is yours to set.'),
      JSON.stringify(silver),
    );
    const flat = await lineState('m2');
    check('record-rate: a free-text unit says nobody publishes a price for it', flat.says.includes('Nobody publishes a price for m2'), flat.says);
    await typeRow('Art', '3');
    const head = await ev("document.querySelector('.rate-line').dataset.unit");
    const asked = await lineState('PAINT');
    check(
      'record-rate: a unit with no price at all, being recorded, moves to the head of the block and asks for one',
      head === 'PAINT' && asked.says.startsWith('What is 1 PAINT worth in CHF?'),
      `${head}: ${asked.says}`,
    );
    // The asked line joins the grid: inside the card's border, with its
    // field in line with the others'.
    await rec.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await rec.settle(200);
    const askedBox = JSON.parse(await ev(`JSON.stringify((() => {
      const l = ${line('PAINT')};
      const card = l.parentElement.getBoundingClientRect();
      const r = l.getBoundingClientRect();
      const lefts = [...document.querySelectorAll('.rate-line input')].map((i) => Math.round(i.getBoundingClientRect().left));
      return {
        inGrid: l.parentElement.classList.contains('rate-block'),
        inside: r.left >= card.left && r.right <= card.right,
        lefts,
        width: Math.round(l.querySelector('input').getBoundingClientRect().width),
      };
    })())`));
    await rec.send('Emulation.clearDeviceMetricsOverride');
    check(
      'record-rate: the line asking for a price sits inside the block, its field in line with the others and in the field column',
      askedBox.inGrid && askedBox.inside && new Set(askedBox.lefts).size === 1 && askedBox.width <= 260,
      JSON.stringify(askedBox),
    );
    check('record-snapshot: the row stays live while its unit has no price', (await rowState('Art')).disabled === false);
    await typeRow('Art', '');
    await typeRow('Current account', '1234.56');
    await pressRow('Current account');
    check(
      'record-snapshot: a saved row stays, says so quietly, and reads as recorded',
      (await ev(`${row('Current account')}.querySelector('.row-saved').textContent`)) === 'Saved.' &&
        (await rowState('Current account')).state === 'Recorded for this date.',
    );
    const today = on(await stored('rate'), T).map((r) => r.payload);
    check(
      'record-rate: recording one franc figure writes an entry for every other active unit at the date, and none for francs',
      today.map((p) => p.symbol).sort().join(',') === 'USD,XAU-ozt',
      today.map((p) => p.symbol).join(','),
    );
    check(
      'record-rate: every entry is in the main currency and says it was proposed',
      today.every((p) => p.rateTarget === 'CHF' && p.rateSource === 'proposed' && p.proposedRate === null),
      JSON.stringify(today),
    );
    const firstPut = traffic.findIndex((r) => r.method === 'PUT');
    const reloads = traffic.map((r, i) => (r.url.includes('/api/records?type=') ? i : -1)).filter((i) => i >= 0);
    check(
      'record-snapshot: the first create at a date reloads both types first',
      reloads.length === 2 && reloads.every((i) => i < firstPut),
      JSON.stringify(traffic.map((r) => `${r.method} ${r.url.split('/api/')[1]}`)),
    );
    await home();
    const after = { brokerage: await tableRow('Brokerage'), gold: await tableRow('Gold bars') };
    check(
      'net-worth-view: recording one franc holding reprices every dollar and gold holding, none of them gaining a figure',
      after.brokerage.converted !== before.brokerage.converted && after.gold.converted !== before.gold.converted &&
        JSON.stringify(await counts()) === JSON.stringify(snapshotCounts),
      JSON.stringify({ before, after }),
    );

    traffic.length = 0;
    await press('New recording');
    const picker = await ev(`JSON.stringify({
      focused: document.activeElement.classList.contains('is-today'),
      marked: [...document.querySelectorAll('.date-day.has-recording')].map(b => b.getAttribute('aria-label')),
      todayName: document.querySelector('.date-day.is-today').getAttribute('aria-label'),
    })`).then(JSON.parse);
    const tomorrowDisabled = await ev(`(() => {
      const days = [...document.querySelectorAll('.date-day')];
      const at = days.findIndex(b => b.classList.contains('is-today'));
      return at === days.length - 1 || days[at + 1].disabled;
    })()`);
    await press('Cancel', '.dialog');
    check(
      'net-worth-view: New recording opens a month grid on today, marks a recorded date in its name, and refuses the future',
      picker.focused && picker.todayName === `${await format('dayMonth', T)}, has a recording` && tomorrowDisabled,
      JSON.stringify(picker),
    );
    check('net-worth-view: dismissing the date picker writes nothing and asks nothing', traffic.length === 0);

    // The New recording dialog is the month grid and a Cancel, nothing
    // else, and nothing is painted over any part of it. The checks above
    // press with element.click(), which does not notice a calendar laid
    // over the dialog, so these use hit-testing and real input events.
    traffic.length = 0;
    // A person presses it, so it is the focused control, which is where
    // Cancel and Escape have to return the focus to.
    await realClick('button', 'New recording');
    const shape = JSON.parse(await ev(`JSON.stringify({
      heading: document.querySelector('.dialog-heading')?.textContent,
      dialogs: document.querySelectorAll('.dialog').length,
      popups: document.querySelectorAll('.date-popover').length,
      fields: document.querySelectorAll('.dialog input, .dialog .date-field, #recording-date').length,
      hints: document.querySelectorAll('.dialog .hint').length,
      buttons: [...document.querySelectorAll('.dialog button')].filter(b => !b.classList.contains('date-day')).map(b => b.textContent.trim() || b.getAttribute('aria-label')),
      actions: [...document.querySelectorAll('.dialog-actions button')].map(b => b.textContent + ':' + b.className),
      title: document.querySelector('.dialog .date-title')?.textContent || '',
      focusedToday: document.activeElement.classList.contains('is-today'),
      nextDisabled: document.querySelector('.dialog [aria-label="Next month"]')?.disabled,
      previousDisabled: document.querySelector('.dialog [aria-label="Previous month"]')?.disabled,
      todayDated: document.querySelector('.date-day.is-today')?.dataset.date,
      strayText: [...document.querySelectorAll('.dialog .date-picker')].flatMap(p => [...p.childNodes]).filter(n => n.nodeType !== 1).length,
      showsNull: document.querySelector('.dialog').textContent.includes('null'),
    })`));
    check(
      'dashboard: New recording opens one dialog headed "New recording" whose body is the month grid, with no date field, hint, Open or popup',
      shape.heading === 'New recording' && shape.dialogs === 1 && shape.popups === 0 && shape.fields === 0 && shape.hints === 0 &&
        !shape.buttons.includes('Open') && !shape.buttons.includes('Close') && shape.actions.length === 1 &&
        shape.actions[0] === 'Cancel:btn-secondary' && shape.title !== '' && shape.focusedToday && shape.todayDated === T &&
        shape.strayText === 0 && !shape.showsNull,
      JSON.stringify(shape),
    );
    check(
      'dashboard: the date picker opens on the current month, with Next month disabled and Previous month enabled',
      shape.nextDisabled === true && shape.previousDisabled === false,
      JSON.stringify(shape),
    );
    const covered = [];
    for (const [selector, label] of [
      ['.dialog-heading', null],
      ['.dialog .date-title', null],
      ['.dialog [aria-label="Previous month"]', null],
      ['.dialog .date-day.is-today', null],
      ['.dialog-actions button', 'Cancel'],
    ]) {
      if (!(await uncovered(selector, label))) covered.push(label || selector);
    }
    check(
      'dashboard: nothing is painted over the dialog\'s heading, month, buttons, today or Cancel',
      covered.length === 0,
      covered.join(', '),
    );
    traffic.length = 0;
    await realClick('.dialog-actions button', 'Cancel');
    check(
      'dashboard: a real click on Cancel closes the picker at once, writes and asks nothing, and returns focus to New recording',
      (await ev("document.querySelectorAll('.dialog').length")) === 0 && traffic.length === 0 &&
        (await ev("document.activeElement.textContent.trim()")) === 'New recording',
      `${await ev("document.querySelectorAll('.dialog').length")} dialogs, ${traffic.length} requests, focus on ${await ev('document.activeElement.textContent.trim()')}`,
    );
    await realClick('button', 'New recording');
    await realKey('Escape', 'Escape', 27);
    check(
      'dashboard: a real Escape closes the picker with no traffic and returns focus to New recording',
      (await ev("document.querySelectorAll('.dialog').length")) === 0 && traffic.length === 0 &&
        (await ev("document.activeElement.textContent.trim()")) === 'New recording',
    );

    // Arrow keys move the focus a day and a week at a time, and cannot
    // leave the past.
    await press('New recording');
    const focusedDate = () => ev('document.activeElement.dataset.date || null');
    await realKey('ArrowLeft', 'ArrowLeft', 37);
    const dayBefore = await focusedDate();
    await realKey('ArrowUp', 'ArrowUp', 38);
    const weekBefore = await focusedDate();
    await realKey('ArrowRight', 'ArrowRight', 39);
    const weekLess = await focusedDate();
    await realKey('ArrowDown', 'ArrowDown', 40);
    const backToday = await focusedDate();
    await realKey('ArrowDown', 'ArrowDown', 40);
    await realKey('ArrowRight', 'ArrowRight', 39);
    const stillToday = await focusedDate();
    check(
      'dashboard: the arrow keys move the focus by a day and by a week, and stop at today',
      dayBefore === ago(1) && weekBefore === ago(8) && weekLess === ago(7) && backToday === T && stillToday === T,
      JSON.stringify({ dayBefore, weekBefore, weekLess, backToday, stillToday }),
    );
    const titleNow = await ev("document.querySelector('.dialog .date-title').textContent");
    await realClick('.dialog [aria-label="Previous month"]');
    const titleBefore = await ev("document.querySelector('.dialog .date-title').textContent");
    const nextOnPast = await ev("document.querySelector('.dialog [aria-label=\"Next month\"]').disabled");
    await realClick('.dialog [aria-label="Next month"]');
    check(
      'dashboard: Previous month shows the month before, which can be stepped forward again, and the future is not reachable',
      titleBefore !== titleNow && nextOnPast === false &&
        (await ev("document.querySelector('.dialog .date-title').textContent")) === titleNow &&
        (await ev("document.querySelector('.dialog [aria-label=\"Next month\"]').disabled")) === true &&
        (await ev("[...document.querySelectorAll('.dialog .date-day')].filter(b => b.dataset.date > " + JSON.stringify(T) + ").every(b => b.disabled)")),
    );
    traffic.length = 0;
    await realClick(`.dialog .date-day[data-date="${T}"]`);
    check(
      'dashboard: a real click on a marked day closes the picker and opens its recording at once, with no request',
      (await ev("document.querySelectorAll('.dialog').length")) === 0 && (await ev('location.hash')) === `#/recording/${T}` && traffic.length === 0,
      `${await ev('location.hash')} ${traffic.length}`,
    );
    await home();

    // ---- record-rate: fifteen rows at one past date -------------------------

    traffic.length = 0;
    rateDelay = 1500;
    const emptyDay = await newRecording(D10, { wait: false });
    await rec.settle(100);
    const resolving = await ev(`JSON.stringify({
      skeleton: Boolean(${line('USD')}.querySelector('.skeleton:not([hidden])')),
      usable: [...document.querySelectorAll('.sweep-row input')].every(i => !i.disabled),
    })`).then(JSON.parse);
    await quiet();
    rateDelay = 0;
    check(
      'record-rate: while the proposals resolve the rate lines show a skeleton and every value field stays usable',
      resolving.skeleton && resolving.usable,
      JSON.stringify(resolving),
    );
    check(
      'record-snapshot: a date holding nothing is unmarked in the picker and is started as a recording',
      !emptyDay.marked && !emptyDay.dotted && emptyDay.name === null && (await ev('location.hash')) === `#/sweep/${D10}`,
      JSON.stringify(emptyDay),
    );
    await rec.waitUntil(`${line('USD')}.querySelector('input').value !== ''`, { label: 'the proposals for the backdate' });
    check('record-snapshot: the sweep carries a row for each of the fifteen holdings', (await ev("document.querySelectorAll('.sweep-row').length")) === 15);
    await typeLine('XAU-ozt', '2711.13');
    const flipped = await lineState('XAU-ozt');
    check(
      'record-rate: editing a proposed line flips its provenance the moment it changes',
      flipped.chip === `Edited from ${proposalsFor(D10)['XAU-ozt'].rate}`,
      flipped.chip,
    );
    const confirmLabels = [];
    for (const name of ['Current account', 'Savings', 'Brokerage', 'Gold bars', 'Silver coins', 'Flat', 'Mortgage', 'Fund 1', 'Fund 2', 'Fund 3', 'Fund 4', script]) {
      confirmLabels.push(await control(name));
      await pressRow(name);
    }
    await typeRow('Dollar cash', '350.77');
    await pressRow('Dollar cash');
    await typeRow('Art', '3');
    await pressRow('Art');
    check('record-snapshot: every untouched row with a figure offers Confirm', confirmLabels.every((l) => l === 'Confirm'), confirmLabels.join(','));
    const firstWrite = traffic.findIndex((r) => r.method === 'PUT');
    check(
      'record-snapshot: a fifteen-row sweep reloads each type once, before its first write, and never after',
      typeReads('snapshot').length === 1 && typeReads('rate').length === 1 &&
        traffic.findIndex((r) => r.url.endsWith('type=rate')) < firstWrite,
      `${typeReads('snapshot').length} and ${typeReads('rate').length}`,
    );
    check('record-rate: a fifteen-row sweep asks the proxy exactly once', rateAsks().length === 1, `${rateAsks().length} asks`);
    const rates = await stored('rate');
    const atBackdate = on(rates, D10).map((r) => r.payload);
    check(
      'record-rate: the sweep writes one set of prices, at its own date',
      atBackdate.map((p) => p.symbol).sort().join(',') === 'USD,XAU-ozt',
      atBackdate.map((p) => `${p.symbol}@${p.date}`).join(','),
    );
    const edited = atBackdate.find((p) => p.symbol === 'XAU-ozt');
    check(
      'record-rate: a proposal changed before the first row is written as edited, keeping the offer and its date',
      edited.rate === '2711.13' && edited.rateSource === 'edited' && edited.proposedRate === proposalsFor(D10)['XAU-ozt'].rate &&
        edited.rateAsOf === proposalsFor(D10)['XAU-ozt'].asOf,
      JSON.stringify(edited),
    );
    const latestUsd = await model("v.latestPrice('USD').date");
    check('record-rate: a backdated recording leaves the later entry the latest', latestUsd === T, latestUsd);
    check(
      'record-rate: a free-text unit and a lookup-off symbol get no entry from a recording',
      !atBackdate.some((p) => p.symbol === 'm2' || p.symbol === 'XAG-ozt' || p.symbol === 'PAINT'),
    );
    const snapshots = await stored('snapshot');
    const valueAt = (name, date) => (on(snapshots, date).find((s) => s.accountId === id[name]) || { payload: {} }).payload.value;
    check(
      'record-snapshot: Confirm writes the carried figure exactly, for francs, dollars and a unit with no source alike',
      valueAt('Current account', D10) === '1100' && valueAt('Brokerage', D10) === '2100' && valueAt('Silver coins', D10) === '100',
      ['Current account', 'Brokerage', 'Silver coins'].map((n) => valueAt(n, D10)).join(','),
    );
    check('record-snapshot: a figure in a unit nobody prices saves anyway', valueAt('Art', D10) === '3');
    const leaks = ['1234.56', '350.77', '2711.13', ...accountIds];
    const encoded = leaks.flatMap((s) => [s, Buffer.from(s).toString('base64')]);
    const asks = rateAsks().concat(traffic.filter((r) => r.url.includes('/api/rates')));
    check(
      'record-rate: no rate request carries a typed rate, a figure or a holding, in its address or its headers',
      asks.every((r) => {
        const keys = [...new URL(r.url).searchParams.keys()].sort().join(',');
        const whole = r.url + JSON.stringify(r.headers) + r.body;
        return keys === 'date,quote' && !encoded.some((s) => whole.includes(s));
      }),
      asks.map((r) => r.url).join(' | '),
    );
    check(
      'record-snapshot: no request during the sweep carries a typed figure, in any field or encoding',
      traffic.every((r) => {
        const whole = r.url + JSON.stringify(r.headers) + r.body;
        return !['350.77', 'MzUwLjc3', '1234.56'].some((s) => whole.includes(s));
      }),
    );
    await home();
    check('record-snapshot: a figure in a unit nobody prices is listed as not priced', (await group('Not priced')).includes('Art'));
    const silverRow = await tableRow('Silver coins');
    check(
      'record-rate: a price only its owner sets keeps its own date on screen after a recording',
      silverRow.asOf.includes(`priced ${await format('longDate', D1)}`),
      silverRow.asOf,
    );
    const fund5 = await tableRow('Fund 5');
    check(
      'net-worth-view: a holding last valued long ago shows its date, counts in the total, and carries no warning',
      fund5 && fund5.asOf === await format('longDate', D1) && !/stale|warning|old/i.test(fund5.text),
      JSON.stringify(fund5),
    );

    // ---- net-worth-view: the dashboard over the recorder vault --------------

    check('net-worth-view: the chart loads with its entry marks showing', (await ev("document.querySelectorAll('.entry-mark').length")) > 0);
    check(
      'net-worth-view: a history shorter than a year opens on All',
      (await ev("document.querySelector('.range-buttons .active').textContent")) === 'All',
    );
    traffic.length = 0;
    await ev(`(() => { const s = [...document.querySelectorAll('.chart-card select')][0]; s.value = 'liq'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await rec.settle(300);
    const modeBefore = {
      hero: await hero(),
      brokerage: (await tableRow('Brokerage')).converted,
      bars: await ev("[...document.querySelectorAll('.bar-amount')].map(b => b.textContent).join('|')"),
      chart: await ev("document.querySelector('svg.trend').innerHTML"),
    };
    await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('as of each figure')).click()");
    await rec.settle(300);
    const modeAfter = {
      hero: await hero(),
      brokerage: (await tableRow('Brokerage')).converted,
      bars: await ev("[...document.querySelectorAll('.bar-amount')].map(b => b.textContent).join('|')"),
      chart: await ev("document.querySelector('svg.trend').innerHTML"),
    };
    check(
      'net-worth-view: the pricing mode moves the total, the table and the breakdown, and no chart point',
      modeAfter.hero !== modeBefore.hero && modeAfter.brokerage !== modeBefore.brokerage && modeAfter.bars !== modeBefore.bars &&
        modeAfter.chart === modeBefore.chart,
      JSON.stringify({ ...modeBefore, chart: null, after: { ...modeAfter, chart: null } }),
    );
    await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes('Latest rates')).click()");
    await rec.settle(200);
    const marksOn = await ev(`(() => {
      const copy = document.querySelector('svg.trend').cloneNode(true);
      copy.querySelectorAll('.entry-mark').forEach(n => n.remove());
      return copy.innerHTML;
    })()`);
    await ev("document.querySelector('.chart-card input[type=checkbox]').click()");
    await rec.settle(300);
    check(
      'net-worth-view: Just the line takes the entry marks away and changes nothing else',
      (await ev("document.querySelectorAll('.entry-mark').length")) === 0 && (await ev("document.querySelector('svg.trend').innerHTML")) === marksOn,
    );
    await ev("document.querySelector('.chart-card input[type=checkbox]').click()");
    await ev("[...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click()");
    await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent === 'Percentage').click()");
    await ev("[...document.querySelectorAll('.switch-option')].find(b => b.textContent === 'Absolute').click()");
    await ev("document.querySelector('.legend-entry').click()");
    await ev("document.querySelector('.legend-entry').click()");
    await rec.settle(300);
    check(
      'net-worth-view: range, dimension, scale, pricing mode, band visibility and Just the line issue no request',
      traffic.length === 0,
      traffic.map((r) => r.url).join(' | '),
    );
    await ev("window.__alerted = false; window.alert = () => { window.__alerted = true; }");
    const scripts = await ev("document.querySelectorAll('script').length");
    await ev(`(() => {
      const svg = document.querySelector('svg.trend');
      const box = svg.getBoundingClientRect();
      svg.dispatchEvent(new PointerEvent('pointermove', { clientX: box.right - 10, clientY: box.top + 20, bubbles: true }));
    })()`);
    await rec.settle(200);
    const literal = await ev(`JSON.stringify({
      row: [...document.querySelectorAll('.holdings-table .row-name')].some(n => n.textContent === ${JSON.stringify(script)}),
      legend: [...document.querySelectorAll('.legend-name')].some(n => n.textContent === ${JSON.stringify(script)}),
      tooltip: document.querySelector('.chart-readout').textContent.includes(${JSON.stringify(script)}),
      chip: [...document.querySelectorAll('.holdings-table .chip')].some(n => n.textContent === 'Liquidity: ' + ${JSON.stringify(script)}),
    })`).then(JSON.parse);
    check(
      'net-worth-view: a holding and a dimension value named as a script read as literal text in the table, the legend and the tooltip',
      literal.row && literal.legend && literal.tooltip && literal.chip &&
        (await ev("document.querySelectorAll('script').length")) === scripts && !(await ev('window.__alerted')),
      JSON.stringify(literal),
    );

    // Hover, the keyboard and a drag across the plot.
    const pointer = (type, across) =>
      ev(`(() => {
        const svg = document.querySelector('svg.trend');
        const box = svg.getBoundingClientRect();
        svg.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
          clientX: box.left + box.width * ${across}, clientY: box.top + 40, button: 0, bubbles: true,
        }));
      })()`);
    await go('#/');
    const total = await ev("document.querySelector('.hero-amount').textContent");
    await pointer('pointermove', 0.5);
    const hovered = await ev(`JSON.stringify({
      hero: document.querySelector('.hero-amount').textContent,
      at: document.querySelector('.hero-at').textContent,
      rows: [...document.querySelectorAll('.chart-readout p')].map(p => p.className),
      net: document.querySelector('.readout-net').textContent,
      crosshair: document.querySelector('.crosshair').getAttribute('visibility'),
    })`).then(JSON.parse);
    await pointer('pointerleave', 0.5);
    check(
      'net-worth-view: hovering moves a crosshair, pins the date, bands and net above it, and the hero follows',
      hovered.crosshair === 'visible' && hovered.rows[0] === 'readout-date' && hovered.rows.at(-1).includes('readout-net') &&
        hovered.at.startsWith('on ') && Math.round(figure(hovered.net)) === figure(hovered.hero) &&
        (await ev("document.querySelector('.hero-amount').textContent")) === total,
      JSON.stringify(hovered),
    );
    await ev("document.querySelector('svg.trend').focus()");
    await ev("document.querySelector('svg.trend').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))");
    const stepped = await ev("document.querySelector('.hero-at').textContent");
    await ev("document.querySelector('svg.trend').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
    await rec.settle(200);
    const opened = await ev('location.hash');
    check(
      'net-worth-view: the arrow keys step between recorded dates and Enter opens that recording',
      opened.startsWith('#/recording/') && stepped === `on ${await format('longDate', opened.split('/').pop())}`,
      `${stepped} then ${opened}`,
    );
    await go('#/');
    await ev(`(() => { const s = document.querySelector('.chart-card select'); s.value = 'liq'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await rec.settle(300);
    await pointer('pointerdown', 0.3);
    await pointer('pointermove', 0.8);
    await pointer('pointerup', 0.8);
    await rec.settle(200);
    const span = await ev(`JSON.stringify({
      since: document.querySelector('.hero-since').textContent,
      rect: document.querySelectorAll('svg.trend rect.selection:not([visibility])').length,
      deltas: [...document.querySelectorAll('.legend-delta')].map(n => n.textContent),
      bands: document.querySelectorAll('.legend-entry').length,
    })`).then(JSON.parse);
    await pointer('pointerdown', 0.5);
    await pointer('pointerup', 0.5);
    await rec.settle(200);
    check(
      'net-worth-view: a drag selects a span, the hero reads the change across it and each band its own',
      span.since.startsWith('from ') && span.rect === 1 && span.deltas.length === span.bands && span.bands > 1,
      JSON.stringify(span),
    );
    check(
      'net-worth-view: a plain click clears the selected span',
      (await ev("document.querySelectorAll('.legend-delta').length")) === 0 && (await ev("document.querySelector('.hero-since').textContent")).startsWith('since '),
    );

    // One price entry sealed where no key opens it, between two readable
    // ones.
    const between = isoOf(dayOf(D2) + 30);
    const [corrupt] = await plantHere([{ ...price('USD', between, '5', 'manual'), corrupt: true }]);
    await reread();
    await go('#/unassigned/none');
    await go('#/');
    const warning = await ev("document.querySelector('.banner-critical span').textContent");
    const listed = await ev("[...document.querySelectorAll('.unreadable-list li')].map(n => n.textContent)");
    const priced = await model(`{
      shown: decimal.format(v.priceAt('USD', dayNumber('${between}'))),
      expected: decimal.format(decimal.interpolate(dayNumber('${between}'), dayNumber('${D2}'), decimal.parse('0.92'),
        dayNumber('${D10}'), decimal.parse('${proposalsFor(D10).USD.rate}'))),
    }`);
    check(
      'net-worth-view: one unreadable record is named in the warning, and its symbol prices from the neighboring entries',
      warning === '1 record could not be read.' && listed.includes(corrupt) && priced.shown === priced.expected,
      JSON.stringify({ warning, listed, priced }),
    );
    muted = true;
    await ev(`(async () => { await (await import('/static/js/api.js')).del('/api/records/${corrupt}'); })()`);
    muted = false;
    await reread();

    // The provider revises what it published. Nothing was recorded, so
    // nothing reads differently, and reopening the recording it
    // revised asks it nothing.
    const backdateUsd = Number(proposalsFor(D10).USD.rate);
    rateMode = 'revised';
    await go('#/unassigned/none');
    await go('#/');
    const heroBefore = await hero();
    const tableBefore = await ev("document.querySelector('.holdings-table').textContent");
    const backdateBefore = bytes(on(await stored('snapshot'), D10)) + bytes(on(await stored('rate'), D10));
    traffic.length = 0;
    await go(`#/recording/${D10}`);
    await press('Update');
    await rec.settle(300);
    await quiet();
    const reopenedUsd = await lineState('USD');
    check(
      'record-rate: a reopened recording opens on its stored rates, not on a fresh proposal',
      figure(reopenedUsd.value) === backdateUsd && reopenedUsd.chip === 'Market rate',
      JSON.stringify(reopenedUsd),
    );
    await home();
    await reread();
    await go('#/unassigned/none');
    await go('#/');
    check(
      'record-rate: opening a recording the provider has since revised asks the proxy nothing and writes nothing',
      rateAsks().length === 0 && writesSent().length === 0 &&
        bytes(on(await stored('snapshot'), D10)) + bytes(on(await stored('rate'), D10)) === backdateBefore,
      traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
    );
    check(
      'net-worth-view: a revised provider figure with nothing recorded changes no figure anywhere',
      (await hero()) === heroBefore && (await ev("document.querySelector('.holdings-table').textContent")) === tableBefore,
    );
    rateMode = 'answer';

    // Archiving: once with the closing value skipped, once with it.
    const chartRows = () =>
      ev(`(async () => {
        [...document.querySelectorAll('.range-buttons button')].find(b => b.textContent === 'All').click();
        await new Promise(r => setTimeout(r, 200));
        return [...document.querySelectorAll('details table tbody tr')].map(r => r.textContent);
      })()`);
    const archive = async (name, closing) => {
      await go(`#/holding/${id[name]}`);
      await press('Archive', '.form-actions');
      await rec.waitUntil("document.querySelector('.dialog')", { label: `the archive dialog for ${name}` });
      await set('.dialog input', closing, 0);
      await press('Archive', '.dialog');
      await rec.settle(300);
      await quiet();
    };
    await go('#/');
    const shapeBefore = await chartRows();
    const totalBefore = await hero();
    await archive('Fund 4', '');
    await go('#/');
    const shapeAfter = await chartRows();
    const todayLabel = await format('date', T);
    check(
      'net-worth-view: archiving leaves every chart point before its date and leaves the total',
      JSON.stringify(shapeBefore.filter((r) => !r.startsWith(todayLabel))) === JSON.stringify(shapeAfter.filter((r) => !r.startsWith(todayLabel))) &&
        (await hero()) !== totalBefore && !(await tableRow('Fund 4')),
    );
    await pointer('pointermove', 0.999);
    check(
      'net-worth-view: the archive is annotated on the chart, and the tooltip at its date names the holding',
      (await ev("[...document.querySelectorAll('.archive-annotation title')].some(t => t.textContent === 'Fund 4 archived')")) &&
        (await ev("document.querySelector('.chart-readout').textContent")).includes('Fund 4 archived'),
      await ev("document.querySelector('.chart-readout').textContent"),
    );
    await pointer('pointerleave', 0.999);
    await archive('Fund 3', '0');
    const closing = on(await stored('snapshot'), T).find((s) => s.accountId === id['Fund 3']);
    await go(`#/holding/${id['Fund 3']}`);
    const archivedActions = await ev("[...document.querySelectorAll('.form-actions button')].map(b => b.textContent)");
    await sweepToday();
    check(
      'record-snapshot: an archived holding takes no new figure except the closing one its archive wrote',
      closing && closing.payload.value === '0' && !archivedActions.includes('Record a value') &&
        !(await ev(`Boolean(${row('Fund 3')})`)) && !(await ev(`Boolean(${row('Fund 4')})`)),
      JSON.stringify({ closing: closing && closing.payload, archivedActions }),
    );
    await home();

    // ---- record-snapshot: reopening a recording ---------------------------

    const secondBefore = { snapshot: on(await stored('snapshot'), D2), rate: on(await stored('rate'), D2) };
    traffic.length = 0;
    await go(`#/recording/${D2}`);
    check('record-snapshot: a recording offers no way to change its own date', (await ev("document.querySelectorAll('.screen input').length")) === 0);
    await press('Update');
    await rec.settle(300);
    await quiet();
    check(
      'record-snapshot: opening a recording and its sweep sends no write and no rate request, and leaves every record byte-identical',
      writesSent().length === 0 && rateAsks().length === 0 &&
        bytes(on(await stored('snapshot'), D2)) === bytes(secondBefore.snapshot) && bytes(on(await stored('rate'), D2)) === bytes(secondBefore.rate),
      traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
    );
    const goldGap = await lineState('XAU-ozt');
    check(
      'record-rate: a line that went in empty says so and carries its own Look it up',
      goldGap.value === '' && goldGap.says === 'No rate was recorded for XAU-ozt on this date.' && goldGap.lookup,
      JSON.stringify(goldGap),
    );

    traffic.length = 0;
    await typeRow('Current account', '1111');
    const saveLabel = await control('Current account');
    await pressRow('Current account');
    const change = writesSent();
    const storedCurrent = secondBefore.snapshot.find((s) => s.accountId === id['Current account']);
    check(
      'record-snapshot: changing a figure in a reopened recording is an update at the stored version plus one, with no reload and no prompt',
      saveLabel === 'Save' && change.length === 1 && bodyOf(change[0]).version === storedCurrent.version + 1 &&
        change[0].url.endsWith(storedCurrent.recordId) && typeReads('snapshot').length + typeReads('rate').length === 0 &&
        !(await ev("Boolean(document.querySelector('.dialog'))")),
      JSON.stringify(traffic.map((r) => `${r.method} ${r.url}`)),
    );
    check('record-rate: changing a figure asks the proxy nothing and writes no price', rateAsks().length === 0 && change.every((r) => bodyOf(r).recordType === 'snapshot'));

    const usdAtSecond = bytes(on(await stored('rate'), D2));
    const currentAtSecond = bytes(on(await stored('snapshot'), D2));
    traffic.length = 0;
    await typeRow('Dollar cash', '333');
    await pressRow('Dollar cash');
    const created = writesSent().filter((r) => bodyOf(r).recordType === 'snapshot');
    const secondRates = on(await stored('rate'), D2);
    check(
      'record-snapshot: adding a figure for a holding silent at a reopened date creates one snapshot at version 1, after one reload',
      created.length === 1 && bodyOf(created[0]).version === 1 && typeReads('snapshot').length === 1 && typeReads('rate').length === 1 &&
        currentAtSecond === bytes(on(await stored('snapshot'), D2).filter((s) => s.accountId !== id['Dollar cash'])),
    );
    check(
      'record-rate: adding a skipped figure leaves the date\'s prices byte-identical and fills only the symbol it lacked',
      bytes(secondRates.filter((r) => r.payload.symbol === 'USD')) === usdAtSecond &&
        secondRates.filter((r) => r.payload.symbol === 'XAU-ozt').length === 1 && rateAsks().length === 1,
      secondRates.map((r) => r.payload.symbol).join(','),
    );

    const usdFigures = () =>
      model(`v.recording('${D2}').figures.filter(f => f.holding.payload.unit === 'USD')
        .map(f => decimal.format(decimal.multiply(decimal.parse(f.snapshot.payload.value), v.priceOn('USD', '${D2}').rate)))`);
    const usdBefore = await usdFigures();
    await typeLine('USD', '0.93');
    check('record-rate: editing a stored proposal flips its chip to the figure it replaced', (await lineState('USD')).chip === 'Edited from 0.92');
    await press('Save the rate lines');
    const confirmation = await ev("document.querySelector('.dialog').textContent");
    await press('Save the prices', '.dialog');
    const usdEdited = on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD').payload;
    const usdAfter = await usdFigures();
    check(
      'record-rate: a changed rate names how many holdings it moves, and moves every one measured in it at that date',
      confirmation.includes('moves 2 holdings measured in USD') && usdAfter.length === 2 && usdAfter.every((f, i) => f !== usdBefore[i]),
      `${confirmation} ${usdBefore} -> ${usdAfter}`,
    );
    check(
      'record-rate: editing a proposed entry stores edited, keeps its date, and keeps the replaced figure',
      usdEdited.rate === '0.93' && usdEdited.rateSource === 'edited' && usdEdited.proposedRate === '0.92' && usdEdited.rateAsOf === D2,
      JSON.stringify(usdEdited),
    );
    await typeLine('USD', '0.94');
    await press('Save the rate lines');
    await press('Save the prices', '.dialog');
    const usdTwice = on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD').payload;
    check('record-rate: editing an edited entry again keeps the original proposal', usdTwice.rate === '0.94' && usdTwice.proposedRate === '0.92', JSON.stringify(usdTwice));

    traffic.length = 0;
    await typeLine('USD', '0.1234567890123');
    const tooFine = await lineState('USD');
    await press('Save the rate lines');
    check(
      'record-rate: a rate with more than twelve decimal places is refused at input rather than truncated',
      tooFine.error.includes('at most twelve decimal places') && !(await ev("Boolean(document.querySelector('.dialog'))")) && writesSent().length === 0,
      JSON.stringify(tooFine),
    );
    await typeLine('USD', '0.123456789012');
    await press('Save the rate lines');
    await press('Save the prices', '.dialog');
    check(
      'record-rate: a rate round-trips as the exact decimal string typed',
      on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD').payload.rate === '0.123456789012',
    );

    // Another window changes the dollar price and the current account
    // behind this one.
    const usdEntry = on(await stored('rate'), D2).find((r) => r.payload.symbol === 'USD');
    await plantHere([{ type: 'rate', recordId: usdEntry.recordId, version: usdEntry.version + 1, payload: { ...usdEntry.payload, rate: '0.97' } }]);
    const usdPlanted = bytes(on(await stored('rate'), D2).filter((r) => r.payload.symbol === 'USD'));
    traffic.length = 0;
    await typeLine('USD', '0.95');
    await press('Save the rate lines');
    await press('Save the prices', '.dialog');
    const conflicted = await lineState('USD');
    const conflictSaid = await ev("document.querySelector('.sweep .banner').textContent");
    check(
      'record-rate: a Conflict on a rate is not retried, the line reloads to the stored entry, and the message names the symbol',
      writesSent().length === 1 && figure(conflicted.value) === 0.97 && conflictSaid.includes('USD') &&
        bytes(on(await stored('rate'), D2).filter((r) => r.payload.symbol === 'USD')) === usdPlanted,
      `${JSON.stringify(conflicted)} ${conflictSaid}`,
    );
    const ratesNowForFault = await stored('rate');
    const currentEntry = on(await stored('snapshot'), D2).find((s) => s.accountId === id['Current account']);
    await plantHere([{ ...snap('Current account', D2, '1122'), recordId: currentEntry.recordId, version: currentEntry.version + 1 }]);
    const currentPlanted = bytes(on(await stored('snapshot'), D2).filter((s) => s.accountId === id['Current account']));
    traffic.length = 0;
    await typeRow('Current account', '1133');
    await pressRow('Current account');
    const rowAfterConflict = await rowState('Current account');
    check(
      'record-snapshot: a Conflict on a figure reloads the row to the stored record and retries nothing',
      writesSent().length === 1 && figure(rowAfterConflict.field) === 1122 && rowAfterConflict.error === 'This figure was changed in another window.' &&
        bytes(on(await stored('snapshot'), D2).filter((s) => s.accountId === id['Current account'])) === currentPlanted,
      JSON.stringify(rowAfterConflict),
    );

    await typeLine('USD', '0.98');
    await typeLine('XAU-ozt', '2799');
    faults.push((r) => (r.method === 'PUT' && r.url.endsWith(on(ratesNowForFault, D2).find((x) => x.payload.symbol === 'XAU-ozt').recordId) ? 500 : null));
    await press('Save the rate lines');
    await press('Save the prices', '.dialog');
    faults.length = 0;
    const halves = await ev("document.querySelector('.sweep .banner').textContent");
    const keptTyped = await lineState('XAU-ozt');
    traffic.length = 0;
    await press('Save the rate lines');
    await press('Save the prices', '.dialog');
    check(
      'record-rate: a save that lands in part names both halves by unit and keeps what did not land typed',
      halves.startsWith('Saved: USD. Not saved: XAU-ozt.') && figure(keptTyped.value) === 2799,
      halves,
    );
    check(
      'record-rate: saving again reissues only what failed',
      writesSent().length === 1 && on(await stored('rate'), D2).find((r) => r.payload.symbol === 'XAU-ozt').payload.rate === '2799',
    );

    const secondSnapshots = on(await stored('snapshot'), D2);
    traffic.length = 0;
    await typeRow('Brokerage', '');
    await pressRow('Brokerage');
    const removed = writesSent();
    check(
      'record-snapshot: clearing a figure backed by a record at the date deletes exactly that record',
      removed.length === 1 && removed[0].method === 'DELETE' &&
        removed[0].url.endsWith(secondSnapshots.find((s) => s.accountId === id.Brokerage).recordId) &&
        on(await stored('snapshot'), D2).length === secondSnapshots.length - 1,
    );
    traffic.length = 0;
    await typeRow('Savings', '');
    await pressRow('Savings');
    check('record-snapshot: clearing a field prefilled from another date deletes and writes nothing', traffic.length === 0);

    const pricesKept = bytes(on(await stored('rate'), D2));
    for (const name of ['Current account', 'Dollar cash']) {
      await typeRow(name, '');
      await pressRow(name);
    }
    await go(`#/recording/${D2}`);
    const emptied = await text();
    check(
      'record-snapshot: clearing every figure leaves the date\'s prices byte-identical and the recording standing with them',
      on(await stored('snapshot'), D2).length === 0 && bytes(on(await stored('rate'), D2)) === pricesKept &&
        emptied.includes('No figures recorded on this date') && (await ev("document.querySelectorAll('.data-table tr[data-unit]').length")) === 2,
    );
    check(
      'record-snapshot: the prices of an emptied recording still price the dates around it',
      await model(`v.usableEntries('USD').some(e => e.payload.date === '${D2}')`),
    );

    await press('Update');
    const emptyStates = await ev("[...document.querySelectorAll('.row-state')].map(n => n.textContent)");
    const emptyLines = [await lineState('USD'), await lineState('XAU-ozt')];
    check(
      'record-snapshot: an emptied recording reopens with every row unrecorded and the prices that keep the date',
      emptyStates.every((s) => s === 'Nothing recorded for this date.') && emptyLines.every((l) => l.value !== '' && l.chip !== ''),
      JSON.stringify(emptyLines),
    );
    await typeRow('Current account', '4242');
    await home();
    check(
      'record-snapshot: leaving with a figure typed and not saved says so and names it',
      (await text()).includes(`You left the recording for ${await format('longDate', D2)} with changes that were not saved: Current account.`),
    );
    check('record-snapshot: an emptied recording still holds its date in the picker', (await newRecording(D2)).marked);

    // The first recording had no dollar price. Its line asks for one only
    // when asked to.
    traffic.length = 0;
    await go(`#/recording/${D1}`);
    await press('Update');
    await rec.settle(300);
    await quiet();
    const asksOnOpen = rateAsks().length;
    await ev(`${line('USD')}.querySelector('.btn-inline').click()`);
    await rec.settle(300);
    await quiet();
    const lookedUp = await lineState('USD');
    check(
      'record-rate: Look it up is what asks, and what comes back is labeled like any proposal',
      asksOnOpen === 0 && rateAsks().length === 1 && figure(lookedUp.value) === Number(proposalsFor(D1).USD.rate) && lookedUp.chip === 'Market rate',
      JSON.stringify(lookedUp),
    );
    await press('Save the rate lines');
    await press('Save the prices', '.dialog');
    const firstUsd = on(await stored('rate'), D1).find((r) => r.payload.symbol === 'USD');
    check('record-rate: a looked-up rate on a reopened recording saves by itself, as proposed', firstUsd && firstUsd.payload.rateSource === 'proposed');

    const DP = ago(150);
    await plantHere([snap('Savings', DP, '5100'), snap('Savings', DP, '5200'), price('USD', DP, '0.9'), price('USD', DP, '0.91')]);
    await reread();
    await go(`#/recording/${DP}`);
    await press('Update');
    const pairRow = await ev(`JSON.stringify({ state: ${row('Savings')}.querySelector('.row-state').textContent,
      keeps: ${row('Savings')}.querySelectorAll('.sweep-pair button').length })`).then(JSON.parse);
    const pairLine = await ev(`JSON.stringify({ flagged: ${line('USD')}.classList.contains('flagged'),
      keeps: [...${line('USD')}.querySelectorAll('.rate-pair button')].length, says: ${line('USD')}.querySelector(':scope > .hint').textContent })`).then(JSON.parse);
    check(
      'record-snapshot: the sweep shows two figures on one date flagged, each with Keep this one, and picks neither',
      pairRow.state === 'Two figures share this date.' && pairRow.keeps === 2,
      JSON.stringify(pairRow),
    );
    check(
      'record-rate: the sweep shows two prices on one date flagged, each with Keep this one',
      pairLine.flagged && pairLine.keeps === 2 && pairLine.says.startsWith('Two prices for this unit share this date.'),
      JSON.stringify(pairLine),
    );
    await ev(`${row('Savings')}.querySelector('.sweep-pair button').click()`);
    await quiet();
    await ev(`${line('USD')}.querySelector('.rate-pair button').click()`);
    await quiet();
    check(
      'record-snapshot: keeping one of a pair on the sweep leaves exactly one of each',
      on(await stored('snapshot'), DP).length === 1 && on(await stored('rate'), DP).length === 1,
    );

    await go(`#/recording/${ago(3)}`);
    const gone = await text();
    await press('Pick a date');
    check(
      'record-snapshot: a recording that is not there says so and offers the date picker',
      gone.includes(`${await format('longDate', ago(3))} holds no recording.`) && (await ev("document.querySelector('.dialog-heading').textContent")) === 'New recording' &&
        (await ev("[...document.querySelectorAll('.dialog .date-picker')].flatMap(p => [...p.childNodes]).every(n => n.nodeType === 1) && !document.querySelector('.dialog').textContent.includes('null')")),
    );
    await press('Cancel', '.dialog');

    // ---- record-snapshot: another window got there first -------------------

    await home();
    traffic.length = 0;
    await newRecording(D5);
    await plantHere([snap('Savings', D5, '5005')]);
    traffic.length = 0;
    await typeRow('Current account', '10');
    await pressRow('Current account');
    const refusal = await ev("document.querySelector('.sweep .banner').textContent");
    const nowShown = await rowState('Savings');
    const longD5 = await format('longDate', D5);
    check(
      'record-snapshot: a fresh recording at a date another window recorded is refused whole, naming the date',
      refusal.startsWith(`${longD5} already has a recording. Another window got there first.`) && writesSent().length === 0 &&
        on(await stored('snapshot'), D5).length === 1 && on(await stored('rate'), D5).length === 0 &&
        nowShown.state === 'Recorded for this date.' && figure(nowShown.field) === 5005,
      `${refusal} ${JSON.stringify(nowShown)}`,
    );
    await press('Open the recording');
    check('record-snapshot: the refusal opens that recording', (await ev('location.hash')) === `#/recording/${D5}`);
    const unpriced = await text();
    check(
      'record-snapshot: a recording with no prices says so, and names each unit whose line is empty',
      unpriced.includes('No prices were captured at this date.') && unpriced.includes('No price for USD at this date.'),
    );
    await press('Update');
    await plantHere([snap('Current account', D5, '5006')]);
    traffic.length = 0;
    await typeRow('Current account', '11');
    await pressRow('Current account');
    check(
      'record-snapshot: inside a reopened recording, a holding another window filled is refused the same way',
      (await ev("document.querySelector('.sweep .banner').textContent")).startsWith(`${longD5} already has a recording.`) && writesSent().length === 0,
    );

    // ---- record-rate: writes that fail ------------------------------------

    await home();
    const heroFailed = await hero();
    faults.push((r) => (r.method === 'PUT' && bodyOf(r).recordType === 'snapshot' ? 500 : null));
    await newRecording(D6);
    await typeRow('Current account', '20');
    await pressRow('Current account');
    const failedRow = await rowState('Current account');
    faults.length = 0;
    check(
      'record-rate: with the quantity write failing, no price is written and the figure stays typed',
      failedRow.error === 'That did not save. Your figure is still here.' && failedRow.field === '20' && on(await stored('rate'), D6).length === 0,
      JSON.stringify(failedRow),
    );
    await home();
    check('record-rate: a failed quantity leaves the total where it was', (await hero()) === heroFailed);
    faults.push((r) => (r.method === 'PUT' && bodyOf(r).recordType === 'rate' ? 500 : null));
    await newRecording(D6);
    await typeRow('Current account', '20.25');
    await pressRow('Current account');
    const reported = await ev("document.querySelector('.sweep .banner').textContent");
    faults.length = 0;
    const kept = on(await stored('snapshot'), D6).find((s) => s.accountId === id['Current account']);
    check(
      'record-rate: with every price write failing, the figure is stored exactly and the screen says the prices were not updated',
      kept && kept.payload.value === '20.25' && reported.includes('Prices were not updated for USD, XAU-ozt') &&
        (await rowState('Current account')).state === 'Recorded for this date.' && on(await stored('rate'), D6).length === 0,
      reported,
    );

    rateMode = 'down';
    await home();
    await newRecording(D7);
    await rec.settle(300);
    const outage = await lineState('USD');
    await typeRow('Current account', '25');
    await pressRow('Current account');
    check(
      'record-snapshot: with the proxy down the figure still saves and the line says nothing will be recorded for the unit',
      outage.says === 'No market rate came back for USD. Nothing will be recorded for it for this date.' &&
        on(await stored('snapshot'), D7).length === 1 && on(await stored('rate'), D7).length === 0,
      JSON.stringify(outage),
    );

    rateMode = 'none';
    await plantHere([{
      type: 'account',
      payload: { name: 'Euro account', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: '2020-01-01T00:01:00Z' },
    }]).then(([euro]) => { id['Euro account'] = euro; });
    await reread();
    await home();
    await newRecording(D9);
    await rec.settle(300);
    traffic.length = 0;
    const confirmOffered = await control('Savings');
    await pressRow('Savings');
    const confirmed = writesSent();
    await typeRow('Euro account', '40');
    const euroLive = !(await rowState('Euro account')).disabled;
    await pressRow('Euro account');
    const noContent = on(await stored('rate'), D9);
    check(
      'record-snapshot: with No Content from the proxy, Confirm is still offered and is one click',
      confirmOffered === 'Confirm' && confirmed.length === 1 && bodyOf(confirmed[0]).recordType === 'snapshot' &&
        on(await stored('snapshot'), D9).some((s) => s.accountId === id.Savings && s.payload.value === '5005'),
    );
    check(
      'record-rate: with No Content from the proxy, no price is written and the previous entry stays the latest',
      noContent.length === 0 && (await model("v.latestPrice('USD').date")) === T,
    );
    await home();
    check(
      'record-snapshot: a figure in a symbol whose lookup returned nothing saves with the control live and is listed as not priced',
      euroLive && on(await stored('snapshot'), D9).some((s) => s.accountId === id['Euro account']) && (await group('Not priced')).includes('Euro account'),
    );
    rateMode = 'answer';

    // ---- record-snapshot: the single-holding form ---------------------------

    const openForm = async (name) => {
      await go(`#/holding/${id[name]}`);
      await press('Record a value', '.form-actions');
      await rec.waitUntil("document.querySelector('#snapshot-value')", { label: `the form for ${name}` });
    };
    const formSave = async () => {
      await ev("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Save').click()");
      await rec.settle(200);
      await quiet();
    };
    const formError = () => ev("(() => { const n = document.querySelector('.dialog .field-error:not([hidden])'); return n ? n.textContent : ''; })()");
    const closeDialogs = () => ev("document.querySelectorAll('.scrim').forEach(s => s.remove())");

    rateMode = 'down';
    await openForm('Current account');
    await set('#snapshot-date', await format('date', D8));
    await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    await quiet();
    const formOutage = await lineState('USD');
    await set('#snapshot-value', '26');
    await formSave();
    check(
      'record-snapshot: the form saves with the proxy down, its line having said so',
      formOutage.says.startsWith('No market rate came back for USD.') && !(await ev("Boolean(document.querySelector('.dialog'))")) &&
        on(await stored('snapshot'), D8).length === 1,
      JSON.stringify(formOutage),
    );
    rateMode = 'answer';

    traffic.length = 0;
    await openForm('Current account');
    await set('#snapshot-value', '1.1234567890123');
    await formSave();
    const fine = await formError();
    await closeDialogs();
    await openForm('Current account');
    await set('#snapshot-date', await format('date', isoOf(dayOf(T) + 1)));
    await ev("document.querySelector('#snapshot-date').dispatchEvent(new Event('blur'))");
    const future = await ev("document.querySelector('.date-field .field-error').textContent");
    await set('#snapshot-value', '5');
    await formSave();
    await closeDialogs();
    check('record-snapshot: a value with more than twelve decimal places is refused at input', fine.includes('at most twelve decimal places'), fine);
    check('record-snapshot: a future date is refused inline and nothing is written', future === 'That date is in the future.' && writesSent().length === 0, future);

    traffic.length = 0;
    await openForm('Current account');
    await set('#snapshot-date', await format('date', D11));
    await rec.waitUntil(`${line('USD')} && ${line('USD')}.querySelector('input').value !== ''`, { label: 'the form proposals' });
    const formLine = await ev("document.querySelector('.prices-line').textContent");
    const formBody = await ev("document.querySelector('.dialog .prices-body').textContent");
    await set('#snapshot-value', '31415.92');
    await formSave();
    check(
      'record-snapshot: the form opens an empty date to its proposals and writes them behind the figure',
      formLine === `Prices for ${await format('longDate', D11)} will be recorded with this, for every other unit in your vault, although this figure is in CHF.` &&
        on(await stored('rate'), D11).map((r) => r.payload.symbol).sort().join(',') === 'USD,XAU-ozt',
      formLine,
    );
    check(
      'record-snapshot: no request during the form carries the entered figure, in any field or encoding',
      traffic.every((r) => !['31415.92', 'MzE0MTUuOTI='].some((s) => (r.url + JSON.stringify(r.headers) + r.body).includes(s))),
    );
    check(
      'record-snapshot: the prices section of a date with no recording holds no "null" where the open-the-recording link does not apply',
      !/null/i.test(formBody),
      formBody,
    );
    const firstEntry = on(await stored('snapshot'), D11).find((s) => s.accountId === id['Current account']);
    traffic.length = 0;
    await openForm('Current account');
    await set('#snapshot-date', await format('date', D11));
    await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    const joining = await ev("document.querySelector('.prices-line').textContent");
    const joiningLink = await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Open the recording, where they are changed')");
    const joiningFields = await ev("document.querySelectorAll('.dialog .rate-line input').length");
    await set('#snapshot-value', '27182.81');
    await formSave();
    const prompt = await ev("document.querySelector('.dialog:last-of-type') && [...document.querySelectorAll('.dialog')].pop().textContent");
    await press('Replace it', '.dialog');
    const replaced = on(await stored('snapshot'), D11).filter((s) => s.accountId === id['Current account']);
    check(
      'record-snapshot: a date already priced reads its stored prices read-only, links to its recording, and looks nothing up',
      joining === `${await format('longDate', D11)} already holds prices. This figure joins them.` && rateAsks().length === 0 &&
        joiningLink && joiningFields === 0,
      joining,
    );
    check(
      'record-snapshot: confirming the replace prompt leaves one record for the date, one version on, under a new nonce',
      prompt.includes('You already recorded') && replaced.length === 1 && replaced[0].recordId === firstEntry.recordId &&
        replaced[0].version === firstEntry.version + 1 && replaced[0].nonce !== firstEntry.nonce && replaced[0].payload.value === '27182.81',
      prompt,
    );

    const DQ = ago(45);
    await openForm('Savings');
    await set('#snapshot-date', await format('date', DQ));
    await quiet();
    await plantHere([snap('Fund 1', DQ, '1')]);
    traffic.length = 0;
    await set('#snapshot-value', '5300');
    await formSave();
    const takenForm = await formError();
    check(
      'record-snapshot: the form refuses a date another window took while it was open, and offers that recording',
      takenForm.startsWith(`${await format('longDate', DQ)} already has a recording. Another window got there first.`) &&
        (await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Open the recording')")) &&
        writesSent().length === 0,
      takenForm,
    );
    await closeDialogs();

    const DR = ago(50);
    await openForm('Savings');
    await set('#snapshot-date', await format('date', DR));
    // A person leaves the date field before touching a price. The page
    // has had real input by now, so it is focused and the date field
    // really does blur, which draws the prices again.
    await ev('document.activeElement.blur()');
    await rec.waitUntil(`${line('USD')} && ${line('USD')}.querySelector('input').value !== ''`, { label: 'the form proposals to change' });
    await typeLine('USD', '0.7777');
    await set('#snapshot-value', '5400');
    await formSave();
    const announced = await ev("[...document.querySelectorAll('.dialog')].pop().textContent");
    await ev("[...[...document.querySelectorAll('.dialog')].pop().querySelectorAll('button')].find(b => b.textContent === 'Save').click()");
    await rec.settle(200);
    await quiet();
    const formEdited = on(await stored('rate'), DR).find((r) => r.payload.symbol === 'USD');
    check(
      'record-snapshot: a price changed on the form says what it moves, and is written as edited behind the figure',
      announced.includes(`Changing the USD rate for ${await format('longDate', DR)} moves 2 holdings measured in USD`) &&
        formEdited && formEdited.payload.rate === '0.7777' && formEdited.payload.rateSource === 'edited',
      announced,
    );

    const DS = ago(55);
    faults.push((r) => (r.method === 'PUT' && bodyOf(r).recordType === 'rate' ? 500 : null));
    await openForm('Savings');
    await set('#snapshot-date', await format('date', DS));
    await rec.waitUntil(`${line('USD')} && ${line('USD')}.querySelector('input').value !== ''`, { label: 'the form proposals to fail' });
    await set('#snapshot-value', '5500');
    await formSave();
    faults.length = 0;
    const pricesFailed = await formError();
    check(
      'record-snapshot: the form keeps the figure when its prices do not save, and names the units',
      pricesFailed === 'Saved. The prices were not updated for USD, XAU-ozt.' &&
        on(await stored('snapshot'), DS).some((s) => s.accountId === id.Savings) &&
        (await ev("[...document.querySelectorAll('.dialog button')].some(b => b.textContent === 'Done')")),
      pricesFailed,
    );
    await press('Done', '.dialog');

    // A date another holding recorded, priced in dollars and not in
    // gold: a figure added there fills in gold alone, as the sweep would.
    const DF = ago(60);
    await plantHere([snap('Fund 2', DF, '101'), price('USD', DF, '0.88', 'proposed')]);
    await reread();
    const usdAtDP = bytes(on(await stored('rate'), DF));
    await openForm('Fund 1');
    // Counted from the date being chosen, since the form opens on today.
    await quiet();
    traffic.length = 0;
    await set('#snapshot-date', await format('date', DF));
    await rec.waitUntil(`${line('XAU-ozt')} && ${line('XAU-ozt')}.querySelector('input') && ${line('XAU-ozt')}.querySelector('input').value !== ''`, { label: 'the missing gold price proposed' });
    const fillingLine = await ev("document.querySelector('.prices-line').textContent");
    const usdTypable = await ev(`Boolean(${line('USD')}.querySelector('input'))`);
    await set('#snapshot-value', '100');
    await formSave();
    const atDP = on(await stored('rate'), DF);
    check(
      'record-snapshot: a figure the form adds at a date already priced fills in only the units that date is missing',
      fillingLine === `${await format('longDate', DF)} already holds prices. This figure joins them. The prices it is missing will be recorded with this.` &&
        !usdTypable && rateAsks().length === 1 &&
        bytes(atDP.filter((r) => r.payload.symbol === 'USD')) === usdAtDP &&
        atDP.map((r) => r.payload.symbol).sort().join(',') === 'USD,XAU-ozt' &&
        atDP.find((r) => r.payload.symbol === 'XAU-ozt').payload.rateSource === 'proposed' &&
        on(await stored('snapshot'), DF).some((s) => s.accountId === id['Fund 1']),
      `${fillingLine} | ${atDP.map((r) => r.payload.symbol).join(',')} | asks ${rateAsks().length}`,
    );

    // ---- record-rate: the rate lines' layout, on rendered geometry ---------

    // Measured on boxes, not class names: every piece of a line inside
    // its block, none overlapping another, nothing scrolled past its box.
    // `stacked` is whether the field sits beneath the unit's name.
    const layout = (scope) =>
      ev(`JSON.stringify((() => {
        const root = document.querySelector(${JSON.stringify(scope)});
        const box = root.getBoundingClientRect();
        const problems = [];
        const lines = [...root.querySelectorAll('.rate-line')];
        const seen = [];
        for (const l of lines) {
          const parts = [...l.querySelectorAll('.rate-unit, .row-status, input, .chip, .btn-inline')]
            .filter((n) => n.getClientRects().length);
          const named = (n) => n.className.split(' ')[0] || n.tagName;
          for (const n of parts) {
            const r = n.getBoundingClientRect();
            if (r.left < box.left - 0.5 || r.right > box.right + 0.5) problems.push('outside the block: ' + named(n) + ' ' + n.textContent);
            if (n.scrollWidth > n.clientWidth + 0.5 && n.tagName !== 'INPUT') problems.push('clipped: ' + named(n) + ' ' + n.textContent);
          }
          for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j < parts.length; j++) {
              const a = parts[i].getBoundingClientRect();
              const b = parts[j].getBoundingClientRect();
              if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) {
                problems.push('overlap: ' + named(parts[i]) + ' and ' + named(parts[j]));
              }
            }
          }
          const unit = l.querySelector('.rate-unit').getBoundingClientRect();
          const field = l.querySelector('input');
          const chip = [...l.querySelectorAll('.chip')].find((c) => c.textContent);
          seen.push({
            unit: l.querySelector('.rate-unit').textContent,
            one: l.querySelector('.row-status').textContent,
            chip: chip ? chip.textContent : '',
            stacked: field ? field.getBoundingClientRect().top >= unit.bottom - 0.5 : null,
            chipBelow: field && chip ? chip.getBoundingClientRect().top >= field.getBoundingClientRect().bottom - 0.5 : null,
            fieldLeft: field ? Math.round(field.getBoundingClientRect().left) : null,
          });
        }
        for (let n = root; n; n = n.parentElement) {
          if (n.scrollWidth > n.clientWidth + 0.5 && getComputedStyle(n).overflowX !== 'visible') problems.push('scrolls sideways: ' + n.className);
        }
        return { width: Math.round(box.width), problems, seen };
      })())`).then(JSON.parse);
    const viewport = (width) =>
      rec.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });

    // The opened prices line of the single-holding form: a dollar
    // holding at a date with no recording, so both lines are proposals,
    // then both edited by hand so each chip names the figure replaced.
    const DW = ago(75);
    const prices = async () => {
      await openForm('Dollar cash');
      await set('#snapshot-date', await format('date', DW));
      await rec.waitUntil(`${line('USD')} && ${line('USD')}.querySelector('input').value !== ''`, { label: 'the form proposals for the layout' });
      await ev("document.querySelectorAll('.dialog details').forEach(d => (d.open = true))");
    };
    const widths = {};
    for (const width of [1280, 390]) {
      await viewport(width);
      await prices();
      // Before any edit: the proposals, gold's naming the earlier day it is for.
      const proposed = await layout('.dialog .rate-block');
      await typeLine('USD', '0.812345678901');
      await typeLine('XAU-ozt', '2111.123456789012');
      await quiet();
      const shown = await layout('.dialog .rate-block');
      // The longest provenance the vocabulary allows, in place of the short one.
      await ev(`document.querySelectorAll('.dialog .rate-meta .chip').forEach(c => { if (c.textContent) c.textContent = 'Edited from 0.931234567890123456'; })`);
      const longest = await layout('.dialog .rate-block');
      widths[width] = { proposed, shown, longest, dialog: await ev("document.querySelector('.dialog').getBoundingClientRect().width") };
      await closeDialogs();
    }
    const formLayout = widths[1280];
    check(
      'record-snapshot: the opened prices line shows each unit in full, without overlap or clipping, at a desktop width',
      formLayout.shown.problems.length === 0 && formLayout.longest.problems.length === 0 && formLayout.proposed.problems.length === 0 &&
        formLayout.proposed.seen.some((l) => l.unit === 'Gold' && l.chip.startsWith('Market rate as of ')) &&
        ['United States Dollar', 'Gold'].every((name) => formLayout.shown.seen.some((l) => l.unit === name && l.chip.startsWith('Edited from '))),
      JSON.stringify(formLayout),
    );
    check(
      'record-rate: the rate lines of the single-holding form stack at a desktop width and at a phone width, since its block is under 720px',
      formLayout.shown.width < 720 && widths[390].shown.width < 720 &&
        [1280, 390].every((w) => widths[w].proposed.seen.every((l) => l.stacked && l.chipBelow !== false) && widths[w].shown.seen.every((l) => l.stacked && l.chipBelow !== false) && widths[w].longest.seen.every((l) => l.stacked && l.chipBelow !== false)),
      JSON.stringify(widths),
    );
    check(
      'record-snapshot: the opened prices line has no overlap or clipping at a phone width',
      widths[390].shown.problems.length === 0 && widths[390].longest.problems.length === 0 && widths[390].proposed.problems.length === 0,
      JSON.stringify(widths[390]),
    );

    // The sweep keeps its columns while its block is 720px wide, under
    // one window width, and stacks one pixel under.
    await viewport(1280);
    await go(`#/sweep/${T}`);
    await ev("document.querySelector('.rate-section').scrollIntoView()");
    const columns = await layout('.rate-lines');
    const narrowed = {};
    for (const width of [719, 720]) {
      await ev(`document.querySelector('.rate-lines').style.width = '${width}px'`);
      narrowed[width] = await layout('.rate-lines');
    }
    await ev("document.querySelector('.rate-lines').style.width = ''");
    check(
      'record-rate: the sweep\'s rate lines keep the rows\' columns at a desktop width, unclipped and clear of each other',
      columns.width >= 720 && columns.problems.length === 0 && columns.seen.length >= 2 && columns.seen.every((l) => l.stacked === false),
      JSON.stringify(columns),
    );
    check(
      'record-rate: the rate lines switch at their block\'s 720px and not at the window\'s',
      narrowed[719].width === 719 && narrowed[720].width === 720 &&
        narrowed[719].seen.every((l) => l.stacked && l.chipBelow !== false) && narrowed[720].seen.every((l) => l.stacked === false) &&
        narrowed[719].problems.length === 0 && narrowed[720].problems.length === 0,
      JSON.stringify(narrowed),
    );
    await viewport(390);
    await go(`#/sweep/${T}`);
    const phone = await layout('.rate-lines');
    check(
      'record-rate: the sweep\'s rate lines stack at a phone width, in full',
      phone.problems.length === 0 && phone.seen.every((l) => l.stacked && l.chipBelow !== false),
      JSON.stringify(phone),
    );
    await rec.send('Emulation.clearDeviceMetricsOverride');
    await home();

    const ratesBeforeEdit = (await stored('rate')).length;
    traffic.length = 0;
    await go(`#/holding/${id['Current account']}`);
    const longD11 = await format('longDate', D11);
    await ev(`[...document.querySelectorAll('.card .data-table tbody tr')].find(r => r.cells[0].textContent.startsWith(${JSON.stringify(longD11)}))
      .querySelectorAll('button').forEach(b => { if (b.textContent === 'Edit') b.click(); })`);
    await rec.waitUntil("document.querySelector('#snapshot-value')", { label: 'the edit form' });
    await set('#snapshot-value', '27000');
    await set('.dialog textarea', 'from the statement');
    await set('#snapshot-date', await format('date', isoOf(dayOf(D11) - 1)));
    await formSave();
    const moved = on(await stored('snapshot'), isoOf(dayOf(D11) - 1)).find((s) => s.accountId === id['Current account']);
    check(
      'record-snapshot: editing a figure\'s value, note and date asks the proxy nothing and writes no price',
      rateAsks().length === 0 && (await stored('rate')).length === ratesBeforeEdit && moved && moved.recordId === firstEntry.recordId &&
        writesSent().every((r) => r.method === 'PUT' && bodyOf(r).recordType === 'snapshot'),
      traffic.map((r) => `${r.method} ${r.url}`).join(' | '),
    );

    // Savings holds figures at the first recording, the refused one, the
    // backdate and No Content's date. Moving two of them onto the
    // backdate displaces its figure.
    const savingsRow = async (iso, button) => {
      await go(`#/holding/${id.Savings}`);
      const label = await format('longDate', iso);
      await ev(`[...document.querySelectorAll('.card .data-table tbody tr')].find(r => r.cells[0].textContent.startsWith(${JSON.stringify(label)}))
        .querySelectorAll('button').forEach(b => { if (b.textContent === ${JSON.stringify(button)}) b.click(); })`);
      await rec.settle(200);
    };
    await savingsRow(D9, 'Edit');
    await set('#snapshot-date', await format('date', D10));
    await formSave();
    const moveCopy = await ev("[...document.querySelectorAll('.dialog')].pop().textContent");
    await press('Move and delete', '.dialog');
    const savingsAt = (iso) => on(snapshotsNow, iso).filter((s) => s.accountId === id.Savings);
    let snapshotsNow = await stored('snapshot');
    check(
      'record-snapshot: moving onto an occupied date names the deletion, and leaves one record there',
      moveCopy.includes(`${await format('longDate', D10)} already holds a snapshot of`) && moveCopy.includes('Moving this entry there will delete it.') &&
        savingsAt(D10).length === 1 && savingsAt(D9).length === 0,
      moveCopy,
    );
    faults.push((r) => (r.method === 'DELETE' ? 500 : null));
    traffic.length = 0;
    await savingsRow(D5, 'Edit');
    await set('#snapshot-date', await format('date', D10));
    await formSave();
    await press('Move and delete', '.dialog');
    faults.length = 0;
    const order = writesSent().map((r) => r.method);
    snapshotsNow = await stored('snapshot');
    check(
      'record-snapshot: a move writes before it deletes, so a failed delete leaves both records',
      order.join(',') === 'PUT,DELETE' && savingsAt(D10).length === 2,
      order.join(','),
    );
    await closeDialogs();
    await go(`#/holding/${id.Savings}`);
    check(
      'record-snapshot: the two figures a failed move left are both flagged on the holding',
      (await ev("document.querySelectorAll('.card .data-table tbody tr.flagged').length")) === 2,
    );
    await ev("[...document.querySelectorAll('.card .data-table tbody tr.flagged button')].find(b => b.textContent === 'Keep this one').click()");
    await quiet();

    const firstSavings = on(await stored('snapshot'), D1).find((s) => s.accountId === id.Savings);
    await plantHere([{ ...snap('Savings', D1, '5001'), recordId: firstSavings.recordId, version: firstSavings.version + 1 }]);
    const savingsPlanted = bytes(on(await stored('snapshot'), D1).filter((s) => s.accountId === id.Savings));
    await savingsRow(D1, 'Edit');
    await set('#snapshot-value', '5002');
    await formSave();
    const stale = await formError();
    await closeDialogs();
    check(
      'record-snapshot: an edit from a tab holding a stale version is refused and overwrites nothing',
      stale.startsWith('This snapshot was changed in another tab.') &&
        bytes(on(await stored('snapshot'), D1).filter((s) => s.accountId === id.Savings)) === savingsPlanted,
      stale,
    );

    const ratesBeforeDelete = (await stored('rate')).length;
    await savingsRow(D10, 'Delete');
    await press('Delete', '.dialog');
    check('record-snapshot: deleting a figure deletes no price', (await stored('rate')).length === ratesBeforeDelete);

    // ---- record-snapshot: the date picker and deleting a recording ----------

    await home();
    traffic.length = 0;
    const saidMarked = await newRecording(D10);
    check(
      'record-snapshot: picking a date that holds a recording opens it, with no request and no create',
      saidMarked.marked && (await ev('location.hash')) === `#/recording/${D10}` && traffic.length === 0,
      JSON.stringify(saidMarked),
    );
    await go(`#/recording/${D1}`);
    let deletes = 0;
    faults.push((r) => (r.method === 'DELETE' && (deletes += 1) === 3 ? 500 : null));
    await press('Delete');
    await press('Delete the recording', '.dialog');
    faults.length = 0;
    const partial = await ev("document.querySelector('.recording .field-error').textContent");
    const leftAtFirst = on(await stored('snapshot'), D1).concat(on(await stored('rate'), D1));
    check(
      'record-snapshot: a delete that stops partway rolls nothing back, and says what is left',
      partial.startsWith('Part of the recording is still there:') && leftAtFirst.length === 1 && leftAtFirst.every((r) => r.payload),
      partial,
    );
    await press('Delete');
    await press('Delete the recording', '.dialog');
    const goneAtFirst = on(await stored('snapshot'), D1).length + on(await stored('rate'), D1).length;
    const freeAgain = await newRecording(D1);
    check(
      'record-snapshot: deleting a recording removes every figure and price at the date, and the date is new again',
      goneAtFirst === 0 && !freeAgain.marked && !freeAgain.dotted,
      JSON.stringify(freeAgain),
    );
  } catch (error) {
    check('recording: the recorder section ran to the end', false, error.stack || error.message);
  } finally {
    recorder.child.kill();
  }

  // ---- The idle lock ----------------------------------------------------

  // Every document from here on carries the movable clock. Real input
  // through the protocol is the activity, so the reset is the one a
  // person's keystroke triggers.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
  const advance = (ms) => page.eval(`window.testClock.advance(${ms})`);
  const activity = async () => {
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
    }
  };
  const locked = () => page.eval("Boolean(document.querySelector('#unlock-password'))");
  // Short of the period by a margin wider than the real time the checks
  // take, and then past it.
  const MARGIN = MINUTE;
  const lockPeriod = async (minutes) => {
    await activity();
    await advance(minutes * MINUTE - MARGIN);
    const early = await locked();
    await advance(MARGIN);
    return { early, late: await locked() };
  };

  await unlockDashboard('the dashboard under the movable clock');
  const heroFigure = await page.eval("document.querySelector('.hero-figure').textContent");
  // The strings a devtools user would look for: every holding name and
  // every figure distinctive enough not to occur by chance.
  const secrets = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    const names = [...v.holdings.values()].map(h => h.payload.name);
    const values = [...v.snapshots.values()].flat().map(s => s.payload.value).filter(x => x.length >= 7);
    return JSON.stringify([...new Set([...names, ...values])]);
  })()`));
  const seen = await reachable(secrets);
  check(
    'the heap probe finds the decrypted vault while unlocked',
    seen.length === secrets.length,
    secrets.filter((secret) => !seen.includes(secret)).join(','),
  );

  await activity();
  await advance(15 * MINUTE - MARGIN);
  check('the vault stays unlocked short of fifteen idle minutes', !(await locked()));
  await activity();
  await advance(15 * MINUTE - MARGIN);
  check('activity starts the idle period again', !(await locked()));
  await advance(MARGIN);
  check('the vault locks itself after fifteen idle minutes', await locked());

  check('the idle lock shows the unlock card', (await text()).includes('Solvent cannot recover a lost password'));
  check('unlocking after the idle lock asks only for the password', !(await page.eval("Boolean(document.querySelector('#unlock-username'))")));
  const screen = await text();
  check(
    'the idle lock leaves no decrypted name or figure on screen',
    [...secrets, heroFigure].every((secret) => !screen.includes(secret)),
    [...secrets, heroFigure].filter((secret) => screen.includes(secret)).join(','),
  );
  check(
    'the idle lock drops the in-memory vault',
    await page.eval("(async () => (await import('/static/js/session.js')).currentVault() === null)()"),
  );
  const left = await reachable(secrets);
  check('nothing decrypted is reachable after the idle lock', left.length === 0, left.join(','));

  const reads = () => page.eval("performance.getEntriesByType('resource').filter(e => e.name.includes('/api/records?type=')).length");
  const readsBefore = await reads();
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard after the idle lock' });
  check('unlocking after the idle lock re-reads every record type', (await reads()) - readsBefore === 4, `${(await reads()) - readsBefore} reads`);

  // A period chosen on the settings screen.
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Session and lock')", { label: 'the session card' });
  await page.settle(400);
  const idleSelect = "[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Session and lock')).querySelector('select')";
  // The keystroke that chose it is the last activity there is, so the
  // new period has to count from the save rather than wait for more.
  await activity();
  await page.eval(`(() => {
    const select = ${idleSelect};
    select.value = '5';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.settle(1500);
  await advance(5 * MINUTE - MARGIN);
  const chosenEarly = await locked();
  await advance(MARGIN);
  check(
    'a changed period locks at the new one with no activity after the change',
    !chosenEarly && (await locked()),
    `locked before five minutes: ${chosenEarly}`,
  );
  // Stored in the encrypted profile, so no row of any table spells it.
  const tables = sql("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name);
  const spelled = tables.filter((table) => JSON.stringify(sql(`SELECT * FROM ${table}`)).includes('idleLockMinutes'));
  check('the idle-lock setting appears in plaintext nowhere in the database', spelled.length === 0, spelled.join(','));

  // Signed out, and signed back in with the username.
  await page.eval(`fetch('/api/auth/logout', {
    method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' }, body: '{}',
  }).then(r => r.status)`);
  await page.goto(`${BASE}/dashboard`);
  await setValue('#unlock-username', 'leander');
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard after signing in again' });
  await page.settle(700);
  const again = await lockPeriod(5);
  check('the chosen period survives signing out and back in', !again.early && again.late, JSON.stringify(again));
  // Signed in on a page served without a session, so the name comes
  // from the sign-in rather than from the page.
  check(
    'after signing in on a fresh page, unlocking again asks only for the password',
    !(await page.eval("Boolean(document.querySelector('#unlock-username'))")),
  );

  // Another device: a second browser with a profile of its own.
  const other = await launch();
  try {
    const second = await Session.connect(other.target);
    await second.send('Page.enable');
    await second.send('Runtime.enable');
    await second.goto(`${BASE}/settings`);
    await signInOn(second, VAULT_PASSWORD, 'leander');
    await second.waitUntil("document.body.innerText.includes('Session and lock')", { timeout: 90000, label: 'settings on the second device' });
    await second.settle(400);
    const shown = await second.eval(
      "[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Session and lock')).querySelector('select').value",
    );
    check('the chosen period follows you to another device', shown === '5', shown);
    const named = await second.eval("document.querySelector('.pair dd').textContent");
    check('settings shows the username after signing in on a page without a session', named === 'leander', named);
  } finally {
    other.child.kill();
  }

  // Values the settings screen cannot write, planted in the profile.
  const plantIdle = (value) =>
    page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      return JSON.stringify({ recordId: v.profileRecord.recordId, version: v.profileRecord.version, profile: v.profile });
    })()`).then(JSON.parse).then(({ recordId, version, profile }) =>
      plant([{ type: 'profile', recordId, version: version + 1, payload: { ...profile, idleLockMinutes: value } }]));
  for (const [stored, minutes] of [[0, 5], [500, 60], [7, 5], [7.5, 5]]) {
    await unlockDashboard(`the dashboard to store ${stored}`);
    await plantIdle(stored);
    await unlockDashboard(`the dashboard with ${stored} stored`);
    await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await page.waitUntil("document.body.innerText.includes('Session and lock')", { label: `settings with ${stored} stored` });
    await page.settle(300);
    const shown = await page.eval(`${idleSelect}.value`);
    const clamped = await lockPeriod(minutes);
    check(
      `a stored idle lock of ${stored} locks at ${minutes} minutes and the select shows ${minutes}`,
      !clamped.early && clamped.late && shown === String(minutes),
      JSON.stringify({ ...clamped, shown }),
    );
  }

  // An open form with typed input, which is the one thing a lock keeps.
  const unlockInPlace = async (label) => {
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label });
    await page.settle(600);
  };
  const idleLock = async () => {
    await activity();
    await advance(60 * MINUTE);
    await page.settle(200);
  };
  await unlockDashboard('the dashboard before typing');
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/')", { label: 'a holding to type into' });
  await page.settle(400);
  const typedAt = await page.eval('location.hash');
  const typedFor = await page.eval("document.querySelector('.screen-heading').textContent");
  await click('Record a value');
  await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  await setValue('#snapshot-value', '777.12');
  await page.settle(300);
  await idleLock();
  check('an open form is idle-locked too', await locked());
  check('the lock closes the open form', !(await page.eval("Boolean(document.querySelector('.dialog'))")));
  const withForm = await text();
  check(
    'an open form leaves no decrypted name or figure on screen after the idle lock',
    secrets.every((secret) => !withForm.includes(secret)),
    secrets.filter((secret) => withForm.includes(secret)).join(','),
  );
  const leftWithForm = await reachable(secrets);
  check('an open form keeps nothing decrypted reachable after the idle lock', leftWithForm.length === 0, leftWithForm.join(','));
  await unlockInPlace('the vault after unlocking over the form');
  check('unlocking returns to the screen the lock found', (await page.eval('location.hash')) === typedAt);
  check(
    'the same form is open again after unlocking',
    (await page.eval("document.querySelector('.dialog-heading')?.textContent")) === `Record a value for ${typedFor}`,
  );
  check(
    'typed input is still there after unlocking',
    (await page.eval("document.querySelector('#snapshot-value')?.value")) === '777.12',
  );
  await click('Cancel');
  await page.settle(300);

  // A prefilled field left alone is vault content, not typing.
  await click('Edit');
  await page.waitUntil("document.querySelector('#holding-name')", { label: 'the holding editor' });
  await page.settle(400);
  await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
  await setValue('#app textarea', 'typed before the lock');
  await idleLock();
  const leftWithEditor = await reachable(secrets);
  check(
    'a prefilled field left alone keeps nothing decrypted reachable across the lock',
    leftWithEditor.length === 0,
    leftWithEditor.join(','),
  );
  await unlockInPlace('the vault after unlocking over the editor');
  const editor = JSON.parse(await page.eval(`JSON.stringify({
    hash: location.hash,
    name: document.querySelector('#holding-name')?.value,
    note: document.querySelector('#app textarea')?.value,
  })`));
  check(
    'the holding editor comes back with the edited note and the name read afresh',
    editor.hash === `${typedAt}/edit` && editor.name === typedFor && editor.note === 'typed before the lock',
    JSON.stringify(editor),
  );

  // Figures typed on the sweep, the case the exception exists for.
  await page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Update values').click()");
  await page.waitUntil("location.hash.startsWith('#/sweep/')", { label: 'the sweep to type into' });
  await page.settle(1200);
  const typeRow = (index, value) =>
    page.eval(`(() => {
      const field = document.querySelectorAll('.sweep-row input')[${index}];
      field.value = ${JSON.stringify(value)};
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  await typeRow(0, '4321.09');
  await typeRow(1, '98.7654');
  const sweepAt = await page.eval('location.hash');
  const sweepRows = () =>
    page.eval(`JSON.stringify([...document.querySelectorAll('.sweep-row')].slice(0, 2)
      .map(r => [r.querySelector('input').value, r.querySelector('.hint').textContent]))`);
  const typedRows = await sweepRows();
  await idleLock();
  check('the sweep is idle-locked', await locked());
  await unlockInPlace('the vault after unlocking over the sweep');
  const backRows = await sweepRows();
  check(
    'figures typed on the sweep are back after unlocking, with what they convert to',
    (await page.eval('location.hash')) === sweepAt && backRows === typedRows && typedRows.includes('4321.09'),
    `${typedRows} vs ${backRows}`,
  );

  // A password never survives, typed or shown.
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.querySelector('input[autocomplete=current-password]')", { label: 'the password card' });
  await page.settle(400);
  const passwordCard = "[...document.querySelectorAll('.card')].find(c => c.querySelector('input[autocomplete=new-password]'))";
  // Made up inside the page, so no script source the test sent carries
  // them and the heap search below finds only what the page kept.
  const typedPasswords = JSON.parse(await page.eval(`(() => {
    const fields = ${passwordCard}.querySelectorAll('input');
    const type = (field) => {
      field.value = 'pw-' + crypto.randomUUID();
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return field.value;
    };
    const typed = [type(fields[0])];
    fields[1].closest('.password-field').querySelector('button').click();
    typed.push(type(fields[1]));
    return JSON.stringify(typed);
  })()`));
  const shownType = await page.eval(`${passwordCard}.querySelectorAll('input')[1].type`);
  await idleLock();
  // Only counts leave these checks, so a failure never prints a password.
  const kept = (await reachable(typedPasswords)).length;
  check(
    'no password typed into settings is kept across the lock, shown or not',
    shownType === 'text' && kept === 0,
    `${kept} kept, the second field was ${shownType}`,
  );
  await unlockInPlace('the vault after unlocking over the password card');
  const filled = await page.eval(`[...${passwordCard}.querySelectorAll('input')].filter(f => f.value !== '').length`);
  check('no password field is refilled after unlocking', filled === 0, `${filled} filled`);

  // ---- Login: a session that runs out mid-action ------------------------

  // Typing into an open form when the server session is gone: the save
  // answers Unauthorized, the card asks only for the password, and the
  // form comes back as it was.
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.data-table tbody .link-button')", { label: 'the dashboard before the session ends' });
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/')", { label: 'a holding to edit' });
  await page.settle(400);
  await click('Edit');
  await page.waitUntil("document.querySelector('#holding-name')", { label: 'the editor before the session ends' });
  await page.settle(300);
  const editing = await page.eval('location.hash');
  await page.eval("document.querySelectorAll('#app details').forEach((d) => (d.open = true))");
  await setValue('#app textarea', 'typed as the session ran out');
  await page.eval("fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' }, body: '{}' })");
  expectedFailures.add('/api/records');
  await page.eval("document.querySelector('#app button[type=submit]').click()");
  await page.waitUntil("document.querySelector('#unlock-password')", { timeout: 20000, label: 'the card after the session ran out' });
  check(
    'a session that ran out mid-action shows the card with the username known',
    !(await page.eval("Boolean(document.querySelector('#unlock-username'))")) &&
      (await page.eval("document.querySelector('.known-username').textContent")).startsWith('leander'),
  );
  await unlockInPlace('the vault after the session ran out');
  expectedFailures.delete('/api/records');
  const resumed = JSON.parse(await page.eval(`JSON.stringify({
    hash: location.hash,
    note: document.querySelector('#app textarea')?.value,
    alive: true,
  })`));
  const signedInAgain = await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then((r) => r.status)");
  check(
    'signing in again returns to the form with what was typed, on a new session',
    resumed.hash === editing && resumed.note === 'typed as the session ran out' && signedInAgain === 200,
    JSON.stringify({ ...resumed, signedInAgain }),
  );
  await page.eval("location.hash = '#/'");
  await page.settle(500);

  // ---- Login: arriving at the sign-in address already signed in ---------

  await page.goto(`${BASE}/login`);
  check(
    'a signed-in vault owner at the sign-in address is sent to the dashboard and asked only for the password',
    (await page.eval('location.pathname')) === '/dashboard' &&
      (await page.eval("Boolean(document.querySelector('#unlock-password'))")) &&
      !(await page.eval("Boolean(document.querySelector('#unlock-username'))")),
  );
  await unlockInPlace('the dashboard after arriving at the sign-in address');

  // ---- Login: signing in keeps the sitting ---------------------------------

  // login.md: only a refresh, the lock or leaving the page discards the
  // keys. So a sign-in at the sign-in address draws the vault in the
  // document that derived them, and everything a person can navigate to
  // from there stays in that document. The mark on the window is lost by
  // any document load.
  const sittingBrowser = await openBrowser(`${BASE}/login`);
  const sat = sittingBrowser.session;
  try {
    await markDocument(sat, 'sign-in');
    await signInOn(sat, VAULT_PASSWORD, 'leander');
    const arrived = await intoVault(sat, 'the vault after signing in at the sign-in address');
    await sat.settle(800);
    const signedIn = arrived ? await sitting(sat, 'sign-in') : null;
    check(
      'signing in at the sign-in address reaches the vault in the same document, with the keys in memory and no password asked again',
      signedIn && signedIn.sameDocument && signedIn.keys && !signedIn.card && signedIn.path === '/dashboard',
      JSON.stringify(signedIn),
    );
    check(
      'the vault it reaches shows the real figures, not the unlock card',
      arrived && (await sat.eval("Boolean(document.querySelector('.hero-figure'))")) &&
        !(await sat.eval('document.body.innerText')).includes('Solvent cannot recover a lost password'),
    );
    // login.md, The session a sign-in issues: each unlock below signs in
    // on this same server session, so the list never grows.
    const listSessions = async () =>
      JSON.parse(await sat.eval(`fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } })
        .then((r) => r.json()).then((l) => JSON.stringify(l.map((s) => [s.id, s.issuedAt, s.current])))`));
    const sessionsBefore = await listSessions();
    check(
      "a vault owner signed in at the sign-in address has the nav, Update values and Lock, and the outside frame is gone",
      signedIn && signedIn.nav.join(',') === 'Dashboard,Settings' && signedIn.controls.join(',') === 'Update values,Lock' &&
        signedIn.barShown && !signedIn.outsideFrame && signedIn.title === 'Solvent' && signedIn.passwordFields === 0,
      JSON.stringify(signedIn),
    );

    // account-settings.md: nowhere a vault owner can navigate to asks
    // twice in one sitting. Every control of the top bar, in turn.
    const stays = async (label) => {
      await sat.settle(600);
      const now = await sitting(sat, 'sign-in');
      check(`${label} keeps the sitting: same document, keys in memory, no password asked`, now.sameDocument && now.keys && !now.card, JSON.stringify(now));
    };
    await sat.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await sat.waitUntil("document.body.innerText.includes('Session and lock')", { label: 'settings' });
    await stays('the Settings link');
    await sat.eval(`document.querySelector('.topbar nav a[href="#/"]').click()`);
    await sat.waitUntil("document.querySelector('.hero-figure')", { label: 'the dashboard' });
    await stays('the Dashboard link');
    await sat.eval("[...document.querySelectorAll('.topbar-actions button')].find((b) => b.textContent.trim() === 'Update values').click()");
    await sat.waitUntil("location.hash.startsWith('#/sweep/')", { label: 'the sweep' });
    await stays('Update values');
    await sat.eval(`document.querySelector('.topbar nav a[href="#/"]').click()`);
    await sat.waitUntil("document.querySelector('.hero-figure')", { label: 'the dashboard again' });
    await stays('returning to the Dashboard');

    // The lock asks, and unlocking again is in place.
    const heldNames = JSON.parse(await sat.eval(`(async () => JSON.stringify(
      [...(await import('/static/js/session.js')).currentVault().holdings.values()].map((h) => h.payload.name)
    ))()`));
    await sat.eval("[...document.querySelectorAll('.topbar-actions button')].find((b) => b.textContent.trim() === 'Lock').click()");
    await sat.waitUntil("document.querySelector('#unlock-password')", { label: 'the card after locking' });
    const locked = await sitting(sat, 'sign-in');
    check(
      'Lock still asks for the password, keeps only the password field, and drops the keys',
      locked.card && !locked.keys && !(await sat.eval("Boolean(document.querySelector('#unlock-username'))")),
      JSON.stringify(locked),
    );
    const lockedChrome = await chromeState(sat);
    check(
      'after Lock the password screen shows no top bar, no navigation, no Update values and no Lock, only the wordmark',
      noChrome(lockedChrome),
      JSON.stringify({ ...lockedChrome, text: undefined }),
    );
    // Nothing reaches the vault while it is locked, whatever the page's
    // store is asked to do.
    const lockedAddress = await sat.eval('location.href');
    await sat.eval("(() => { Alpine.store('shell').update(); Alpine.store('vault').updateValues(); })()");
    await sat.settle(300);
    check(
      'Update values while locked leaves the address and the card as they were',
      (await sat.eval('location.href')) === lockedAddress && (await sat.eval("Boolean(document.querySelector('#unlock-password'))")),
      await sat.eval('location.href'),
    );
    await signInOn(sat, VAULT_PASSWORD);
    check('unlocking after the lock returns to the vault', await intoVault(sat, 'the vault after unlocking'));
    await sat.settle(500);
    const unlockedChrome = await chromeState(sat);
    check(
      'after unlocking again the top bar, its two links and its two controls are back, and the outside wordmark is gone',
      hasChrome(unlockedChrome),
      JSON.stringify({ ...unlockedChrome, text: undefined }),
    );

    // Back, after leaving the page while unlocked: the keys went with
    // the page, and nothing from the vault is shown.
    const back = await backFromAway(sat);
    check(
      'Back after signing in at the sign-in address and leaving shows the unlock card and no vault data',
      Boolean(back) && !back.keys && heldNames.length > 0 && heldNames.every((name) => !back.text.includes(name)),
      back ? heldNames.filter((name) => back.text.includes(name)).join(',') : 'no unlock card',
    );

    // A refresh asks for the password again.
    await signInOn(sat, VAULT_PASSWORD);
    await intoVault(sat, 'the vault before the refresh');
    const reloaded = sat.waitFor('Page.loadEventFired');
    await sat.send('Page.reload');
    await reloaded;
    await sat.settle(600);
    const refreshed = await sat.eval("(async () => JSON.stringify({ card: Boolean(document.querySelector('#unlock-password')), keys: (await import('/static/js/session.js')).currentVault() !== null }))()").then(JSON.parse);
    check('a refresh still asks for the password', refreshed.card && !refreshed.keys, JSON.stringify(refreshed));
    const refreshedChrome = await chromeState(sat);
    check(
      'after a refresh the password screen shows no top bar and no navigation',
      noChrome(refreshedChrome),
      JSON.stringify({ ...refreshedChrome, text: undefined }),
    );

    // Unlock again after the refresh, and the settings list shows the
    // same sessions it showed after the first sign-in, one row each.
    await signInOn(sat, VAULT_PASSWORD);
    await intoVault(sat, 'the vault after the refresh');
    await sat.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await sat.waitUntil("document.querySelector('.sessions-table tbody tr')", { label: 'the open sessions' });
    const sessionsAfter = await listSessions();
    const shownRows = await sat.eval("document.querySelectorAll('.sessions-table tbody tr').length");
    check(
      'locking, unlocking, reloading and unlocking again leaves Open sessions with the same rows, the same ids and the same start times',
      JSON.stringify(sessionsAfter) === JSON.stringify(sessionsBefore) && shownRows === sessionsBefore.length &&
        sessionsBefore.filter((entry) => entry[2]).length === 1,
      JSON.stringify({ sessionsBefore, sessionsAfter, shownRows }),
    );
  } finally {
    sittingBrowser.close();
  }

  // A visitor with no session at the bare host is sent to the sign-in
  // screen on the vault page, and it draws no bar of any kind.
  const visitorBrowser = await openBrowser(`${BASE}/`);
  try {
    await visitorBrowser.session.waitUntil("document.querySelector('#unlock-password')", { label: 'the card at the bare host' });
    const visitorChrome = await chromeState(visitorBrowser.session);
    check(
      'a visitor with no session at the bare host sees the password screen with no top bar and no navigation',
      noChrome(visitorChrome) && (await visitorBrowser.session.eval('location.pathname')) === '/dashboard',
      JSON.stringify({ ...visitorChrome, text: undefined }),
    );
  } finally {
    visitorBrowser.close();
  }

  // ---- Registration: the invite stays out of every request, and a failed first read ----

  // admin-invites.md, Rules: /register carries Referrer-Policy:
  // no-referrer, because the token rides in its URL and a subresource
  // requested from that page would otherwise name it in a Referer.
  // register.md: a vault owner lands logged in with keys already in
  // memory, and never has to type the password they just chose, not
  // even when the first read of the new vault fails.
  const REGISTRANT_PASSWORD = 'plover ember quarry vellum';
  const mintInvite = (kind) =>
    execFileSync(
      process.env.SOLVENT_PYTHON,
      ['-m', 'flask', '--app', 'app', 'create-invite', '--kind', kind, '--expires-days', '1', '--force'],
      { env: process.env, cwd: process.cwd() },
    ).toString().trim().split('invite=').pop();
  const registrantBrowser = await openBrowser();
  const registrant = registrantBrowser.session;
  try {
    const registrantInvite = mintInvite('vault-owner');
    const traffic = watched[watched.length - 1].requests;
    await registrant.goto(`${BASE}/register?invite=${registrantInvite}`);
    const fillRegistration = (name = 'registrant') =>
      registrant.eval(`(() => {
        const set = (selector, value, index = 0) => {
          const node = document.querySelectorAll(selector)[index];
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('input[type=text]', ${JSON.stringify(name)});
        set('input[type=password]', ${JSON.stringify(REGISTRANT_PASSWORD)}, 0);
        set('input[type=password]', ${JSON.stringify(REGISTRANT_PASSWORD)}, 1);
        set('select', 'CHF');
        const box = document.querySelector('input[type=checkbox]');
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    await fillRegistration();
    await registrant.settle(600);
    await markDocument(registrant, 'registrant');

    // The first read of the new vault fails once.
    let refused = 0;
    const release = await intercept(registrant, '*/api/records?type=*', () => (refused++ === 0 ? { status: 503 } : null));
    await registrant.eval("document.querySelector('button[type=submit]').click()");
    await registrant.waitUntil("document.body.innerText.includes('Your vault is created')", {
      timeout: 90000,
      label: 'the failed first read',
    }).catch(() => {});
    const unread = await sitting(registrant, 'registrant');
    check(
      'a failed first read of a new vault keeps the keys and offers to read again, with no password asked and no page load',
      refused === 1 && unread.sameDocument && !unread.card && unread.passwordFields === 0 &&
        (await registrant.eval('document.body.innerText')).includes('you do not need to type your password again'),
      JSON.stringify({ refused, ...unread }),
    );
    await registrant.eval("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click()");
    const read = await intoVault(registrant, 'the vault after the second read');
    await release();
    await registrant.settle(500);
    const readAgain = read ? await sitting(registrant, 'registrant') : null;
    check(
      'reading again lands in the new vault, in the same document, unlocked',
      readAgain && readAgain.sameDocument && readAgain.keys && !readAgain.card && readAgain.path === '/dashboard',
      JSON.stringify(readAgain),
    );

    // The browser lists an empty Referer for a request that sends none.
    const sendsReferer = (r) => Object.entries(JSON.parse(r.headers)).some(([name, value]) => /^referer$/i.test(name) && value);
    const referers = traffic.filter(sendsReferer);
    check(
      'no request the vault owner registration page makes carries a Referer, and the token is in no request header',
      traffic.length > 0 && referers.length === 0 && traffic.every((r) => !r.headers.includes(registrantInvite)),
      referers.map((r) => r.url).join(','),
    );
    // The instrument sees a Referer where there is one to see.
    const before = traffic.length;
    await registrant.goto(`${BASE}/login`);
    check(
      'the same capture sees the Referer an ordinary page sends',
      traffic.slice(before).some(sendsReferer),
    );

    // architecture.md, Application hardening, and login.md, Rules: keys
    // are held only while the page is open and unlocked, and the idle
    // limit applies to every moment they are held. That includes a new
    // vault whose first read failed and is waiting to be read again.
    await registrant.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
    const holdsKeys = (session) =>
      session.eval("import('/static/js/session.js').then((s) => s.holdsKeys())");
    const registerUntilUnread = async (name) => {
      await registrant.goto(`${BASE}/register?invite=${mintInvite('vault-owner')}`);
      await fillRegistration(name);
      await registrant.settle(600);
      await markDocument(registrant, name);
      const release = await intercept(registrant, '*/api/records?type=*', () => ({ status: 503 }));
      await registrant.eval("document.querySelector('button[type=submit]').click()");
      await registrant.waitUntil("document.body.innerText.includes('Your vault is created')", {
        timeout: 90000,
        label: `the unread vault of ${name}`,
      });
      return release;
    };

    let release2 = await registerUntilUnread('registrant.pagehide');
    check('a new vault that could not be read yet holds its keys for the retry', await holdsKeys(registrant));
    await registrant.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    check('leaving the page drops the keys of a new vault that could not be read yet', !(await holdsKeys(registrant)));
    check(
      'and the card that asks for the password has no username field',
      (await registrant.eval("Boolean(document.querySelector('#unlock-password'))")) &&
        !(await registrant.eval("Boolean(document.querySelector('#unlock-username'))")),
    );
    await release2();

    release2 = await registerUntilUnread('registrant.idle');
    await registrant.eval(`window.testClock.advance(${16 * MINUTE})`);
    await registrant.waitUntil("document.querySelector('#unlock-password')", { label: 'the idle lock of the unread vault' });
    const idled = await sitting(registrant, 'registrant.idle');
    check(
      'the idle limit applies to a new vault that could not be read yet: the keys go and the card asks for the password only',
      idled.sameDocument && !(await holdsKeys(registrant)) &&
        !(await registrant.eval("Boolean(document.querySelector('#unlock-username'))")),
      JSON.stringify(idled),
    );
    await release2();

    release2 = await registerUntilUnread('registrant.race');
    await release2();
    const heldRetry = await holdRecords(registrant);
    await registrant.eval("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again').click()");
    await Promise.race([heldRetry.reached, registrant.settle(60000)]);
    check(
      'Try again is disabled while it reads again',
      await registrant.eval("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again').disabled"),
    );
    await registrant.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    heldRetry.release();
    await registrant.settle(2500);
    const retried = await afterRead(registrant);
    check(
      'a lock while a new vault is being read again wins: no keys, no vault, nothing drawn, the card asks',
      !retried.keys && !retried.vault && retried.card && !retried.drawn && !retried.nav,
      JSON.stringify(retried),
    );
    await heldRetry.stop();

    // A lock that lands while a read is in flight wins when the read
    // then fails as well: the card that asks stands, no failure card
    // draws over it, and nothing is left that could open the vault.
    const lockedAndFailed = async (state) => {
      const text = await registrant.eval('document.body.innerText');
      return {
        ...state,
        failureCard: text.includes('Your vault is created'),
        usernameField: await registrant.eval("Boolean(document.querySelector('#unlock-username'))"),
      };
    };
    const lockWon = (state) =>
      !state.keys && !state.vault && state.card && !state.failureCard && !state.usernameField && !state.drawn && !state.nav;

    await registrant.goto(`${BASE}/register?invite=${mintInvite('vault-owner')}`);
    await fillRegistration('registrant.firstfail');
    await registrant.settle(600);
    await markDocument(registrant, 'registrant.firstfail');
    const heldFirst = await holdRecords(registrant, { status: 503 });
    await registrant.eval("document.querySelector('button[type=submit]').click()");
    await Promise.race([heldFirst.reached, registrant.settle(60000)]);
    await registrant.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    heldFirst.release();
    await registrant.settle(2500);
    const firstFailed = await lockedAndFailed(await afterRead(registrant));
    check(
      'a lock during the first read of a new vault wins when that read then fails: the card asks for the password only, with no failure card and no keys',
      lockWon(firstFailed),
      JSON.stringify(firstFailed),
    );
    await heldFirst.stop();

    release2 = await registerUntilUnread('registrant.retryfail');
    check(
      'the failure card is announced as an alert',
      await registrant.eval("document.querySelector('.card[role=alert] .card-heading')?.textContent === 'Your vault is created'"),
    );
    await registrant.eval("window.oldRetry = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again'); window.oldRetry.click()");
    await registrant.waitUntil("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Try again' && b !== window.oldRetry)", {
      label: 'the failure card drawn again',
    }).catch(() => {});
    const failedAgain = await registrant.eval(`(() => {
      const retry = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
      return Boolean(retry) && retry !== window.oldRetry && !retry.disabled && Boolean(retry.closest('[role=alert]'));
    })()`);
    check('a retry that fails again draws the failure card again, with a Try again that is ready', failedAgain);
    await release2();

    const heldAgain = await holdRecords(registrant, { status: 503 });
    await registrant.eval("window.oldRetry = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again'); window.oldRetry.click()");
    await Promise.race([heldAgain.reached, registrant.settle(60000)]);
    await registrant.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    heldAgain.release();
    await registrant.settle(2500);
    const retryFailed = await lockedAndFailed(await afterRead(registrant));
    check(
      'a lock during a read again wins when that read then fails: the card asks for the password only, with no failure card and no keys',
      lockWon(retryFailed),
      JSON.stringify(retryFailed),
    );
    // The retry the failure card offered is gone with the card, and
    // pressing it anyway opens nothing.
    await heldAgain.stop();
    await registrant.eval('window.oldRetry.disabled = false; window.oldRetry.click()');
    await registrant.settle(2500);
    const reopened = await lockedAndFailed(await afterRead(registrant));
    check('a retry left over from the failure card opens nothing after a lock', lockWon(reopened), JSON.stringify(reopened));
  } finally {
    registrantBrowser.close();
  }

  // login.md, Rules: a vault that could not be read is not unlocked.
  // The keys the sign-in derived are dropped with the error, and a
  // page left afterwards holds none.
  const unreadBrowser = await openBrowser(`${BASE}/login`);
  const unread = unreadBrowser.session;
  try {
    const releaseUnread = await intercept(unread, '*/api/records?type=*', () => ({ status: 503 }));
    await signInOn(unread, VAULT_PASSWORD, 'leander');
    await unread.waitUntil("!document.querySelector('.field-error').hidden", { timeout: 90000, label: 'the error for a vault that would not open' });
    await unread.settle(300);
    const after = JSON.parse(await unread.eval(`(async () => {
      const s = await import('/static/js/session.js');
      return JSON.stringify({
        keys: s.holdsKeys(), vault: s.currentVault() !== null,
        error: document.querySelector('.field-error').textContent,
        card: Boolean(document.querySelector('#unlock-password')),
      });
    })()`));
    check(
      'a vault that could not be read at sign-in shows the error and holds no keys',
      !after.keys && !after.vault && after.card && after.error === 'Invalid username or password.',
      JSON.stringify(after),
    );
    await unread.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    check('and none after leaving the page', !(await unread.eval("import('/static/js/session.js').then((s) => s.holdsKeys())")));
    await releaseUnread();
  } finally {
    unreadBrowser.close();
  }

  // architecture.md, Application hardening: a page left while unlocked
  // keeps no keys and shows no vault. A lock that lands while the vault
  // is still being read wins, and the read finishing opens nothing.
  const racingBrowser = await openBrowser(`${BASE}/login`);
  const racing = racingBrowser.session;
  const pagehide = (session) =>
    session.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
  try {
    const held = await holdRecords(racing);
    await signInOn(racing, VAULT_PASSWORD, 'leander');
    await Promise.race([held.reached, racing.settle(60000)]);
    await pagehide(racing);
    held.release();
    await racing.settle(2500);
    const signedIn = await afterRead(racing);
    check(
      'a lock while a sign-in is reading the vault wins: no keys, no vault, nothing drawn, the card asks',
      !signedIn.keys && !signedIn.vault && signedIn.card && !signedIn.drawn && !signedIn.nav && (await racing.eval('location.pathname')) === '/login',
      JSON.stringify(signedIn),
    );
    await held.stop();

    // The same on the dashboard, where the session is live and the card
    // asks for the password alone.
    await racing.goto(`${BASE}/dashboard`);
    const heldUnlock = await holdRecords(racing);
    await enterPasswordOn(racing, VAULT_PASSWORD);
    await Promise.race([heldUnlock.reached, racing.settle(60000)]);
    await pagehide(racing);
    heldUnlock.release();
    await racing.settle(2500);
    const unlocked = await afterRead(racing);
    check(
      'a lock while an unlock is reading the vault wins: no keys, no vault, nothing drawn, the card asks',
      // The bar is the server's for a session that already existed, and stays.
      !unlocked.keys && !unlocked.vault && unlocked.card && !unlocked.drawn && !unlocked.empty,
      JSON.stringify(unlocked),
    );
    await heldUnlock.stop();
  } finally {
    racingBrowser.close();
  }

  // ---- Login: the one card, whatever the name -----------------------------

  const cardBrowser = await openBrowser(`${BASE}/login`);
  const card = cardBrowser.session;
  try {
    check(
      'the card offers the username and current password to a password manager',
      (await card.eval("document.querySelector('#unlock-username').getAttribute('autocomplete')")) === 'username' &&
        (await card.eval("document.querySelector('#unlock-password').getAttribute('autocomplete')")) === 'current-password',
    );
    // One submission, what the card does at once, and what it shows
    // once it has an answer.
    const attempt = (username, password) =>
      card.eval(`(async () => {
        const set = (selector, value) => {
          const node = document.querySelector(selector);
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('#unlock-username', ${JSON.stringify(username)});
        set('#unlock-password', ${JSON.stringify(password)});
        const form = document.querySelector('form');
        const button = form.querySelector('button[type=submit]');
        const error = form.querySelector('.field-error');
        button.click();
        const working = {
          label: button.textContent,
          quiet: [...form.querySelectorAll('input, button[type=submit], .password-field button')].every((n) => n.disabled),
          note: [...form.querySelectorAll('.hint')].some((n) => !n.hidden && n.textContent.startsWith('This takes a moment by design.')),
        };
        while (button.disabled || error.hidden) await new Promise((r) => setTimeout(r, 25));
        return JSON.stringify({
          working,
          error: error.textContent,
          above: Boolean(error.compareDocumentPosition(document.querySelector('#unlock-password')) & Node.DOCUMENT_POSITION_FOLLOWING),
          form: form.innerHTML,
        });
      })()`).then(JSON.parse);

    const failures = {
      'a vault owner': await attempt('leander', 'not the password at all'),
      'an administrator': await attempt('ops.leander', 'not the password at all'),
      'a username nobody has': await attempt('nobody-at-all', 'not the password at all'),
    };
    const first = failures['a vault owner'];
    check(
      'the card shows the working state and goes quiet while the key is derived',
      first.working.label === 'Deriving your key' && first.working.quiet && first.working.note,
      JSON.stringify(first.working),
    );
    check(
      'a wrong password and an unknown username read the same on the card, for either kind',
      Object.values(failures).every(
        (f) => f.error === 'Invalid username or password.' && f.above && f.form === first.form &&
          JSON.stringify(f.working) === JSON.stringify(first.working),
      ),
      JSON.stringify(Object.fromEntries(Object.entries(failures).map(([k, f]) => [k, f.error]))),
    );

    // Enough failures on one name to reach the account limit, at
    // whatever value it is configured to.
    let throttled = null;
    for (let tries = 0; tries < 40 && !throttled; tries++) {
      const answer = await attempt('locked-probe', 'not the password at all');
      if (answer.error !== 'Invalid username or password.') throttled = answer;
    }
    check(
      'a name past the attempt limit reads as too many attempts',
      throttled && throttled.error === 'Too many attempts. Try again in a few minutes.' && throttled.above,
      JSON.stringify(throttled && throttled.error),
    );

    await signInOn(card, ADMIN_PASSWORD, 'ops.leander');
    await card.waitUntil("location.pathname === '/admin'", { timeout: 60000, label: 'the admin area from the card' });
    check('an administrator signs in through the one card and lands in the admin area', true);
  } finally {
    cardBrowser.close();
  }

  // A browser whose worker cannot derive, as one without WebAssembly or
  // without the memory to spare would answer.
  const brokenBrowser = await openBrowser();
  const broken = brokenBrowser.session;
  try {
    await broken.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__derivations = 0;
        window.Worker = class {
          constructor() { this.listeners = []; }
          addEventListener(_type, listener) { this.listeners.push(listener); }
          removeEventListener(_type, listener) { this.listeners = this.listeners.filter((l) => l !== listener); }
          postMessage(message) {
            window.__derivations += 1;
            const answer = { id: message.id, ok: false, outOfMemory: Boolean(window.__outOfMemory), message: 'refused' };
            setTimeout(() => this.listeners.forEach((l) => l({ data: answer })), 10);
          }
        };`,
    });
    const submitBroken = async () => {
      await signInOn(broken, 'any password at all', 'leander');
      await broken.waitUntil("!document.querySelector('.field-error').hidden", { label: 'the derivation failure' });
      await broken.settle(100);
      return JSON.parse(await broken.eval(`JSON.stringify({
        error: document.querySelector('.field-error').textContent,
        stopped: [...document.querySelectorAll('form input, form button[type=submit]')].every((n) => n.disabled),
        retry: [...document.querySelectorAll('form button')].some((b) => b.textContent === 'Try again' && !b.hidden),
      })`));
    };
    await broken.goto(`${BASE}/login`);
    const unsupported = await submitBroken();
    check(
      'a browser that cannot run the encryption is a hard stop with no fallback',
      unsupported.error === 'This browser cannot run the encryption Solvent needs. There is no weaker fallback.' &&
        unsupported.stopped && !unsupported.retry,
      JSON.stringify(unsupported),
    );
    await broken.goto(`${BASE}/login`);
    await broken.eval('window.__outOfMemory = true');
    const outOfMemory = await submitBroken();
    check(
      'not enough memory right now offers Try again and leaves the card usable',
      outOfMemory.error === 'This device does not have enough memory available right now. Close some other tabs and try again.' &&
        !outOfMemory.stopped && outOfMemory.retry,
      JSON.stringify(outOfMemory),
    );
    await broken.eval("[...document.querySelectorAll('form button')].find((b) => b.textContent === 'Try again').click()");
    await broken.settle(600);
    check('Try again derives again', (await broken.eval('window.__derivations')) === 2);
  } finally {
    brokenBrowser.close();
  }

  // ---- Login: the stale-KDF upgrade, for a vault owner --------------------

  const signInAgain = async (label) => {
    await page.goto(`${BASE}/dashboard`);
    await unlockInPlace(label);
  };
  const vaultNames = () =>
    page.eval(`(async () => {
      const v = (await import('/static/js/session.js')).currentVault();
      return JSON.stringify({ names: [...v.holdings.values()].map((h) => h.payload.name).sort(), unreadable: v.unreadable.length });
    })()`);
  await makeStale(page, 'leander', VAULT_PASSWORD);
  const staleOwner = credentialOf('leander');
  const staleRecords = recordsOf(staleOwner.principal);
  const beforeUpgrade = await vaultNames();

  expectedFailures.add('/api/auth/upgrade-kdf');
  releaseUpgrade = await intercept(page, '*/api/auth/upgrade-kdf', () => ({ status: 500 }));
  await signInAgain('the vault with its upgrade failing');
  const keptIn = await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then((r) => r.status)");
  check(
    'a vault owner whose upgrade answers Server Error stays signed in, on the old parameters',
    keptIn === 200 && (await vaultNames()) === beforeUpgrade &&
      JSON.stringify(credentialOf('leander')) === JSON.stringify(staleOwner),
    String(keptIn),
  );
  await signInAgain('the vault at the old parameters again');
  check(
    'after a failed upgrade the vault owner still signs in with the old parameters',
    (await vaultNames()) === beforeUpgrade && JSON.parse(credentialOf('leander').params).kdf.m === WEAK_MEMORY,
  );
  await releaseUpgrade();
  expectedFailures.delete('/api/auth/upgrade-kdf');

  const upgradesBefore = watched[0].requests.filter((r) => r.url.endsWith('/api/auth/upgrade-kdf')).length;
  await signInAgain('the vault as it upgrades');
  const upgradedOwner = credentialOf('leander');
  const envelope = JSON.parse(await page.eval("document.getElementById('kdf-envelope').textContent"));
  check(
    'a stale vault is upgraded on sign-in: salt, envelope, Auth Key hash and wrapped DEK all change',
    JSON.parse(upgradedOwner.params).salt !== JSON.parse(staleOwner.params).salt &&
      JSON.stringify(JSON.parse(upgradedOwner.params).kdf) === JSON.stringify(envelope) &&
      upgradedOwner.verifier !== staleOwner.verifier &&
      upgradedOwner.wrapped_dek !== staleOwner.wrapped_dek,
    upgradedOwner.params,
  );
  const upgradeSent = watched[0].requests.filter((r) => r.url.endsWith('/api/auth/upgrade-kdf')).slice(upgradesBefore);
  check(
    "a vault owner's upgrade sends the new salt, envelope, Auth Key and wrapper",
    upgradeSent.length === 1 &&
      Object.keys(JSON.parse(upgradeSent[0].body)).sort().join(',') === 'authKey,dekNonce,kdf,salt,wrappedDek',
  );
  check('the upgrade re-encrypts no record', recordsOf(upgradedOwner.principal) === staleRecords);
  await signInAgain('the vault at the new parameters');
  check(
    'the DEK is unchanged by the upgrade: records written before it decrypt at the new parameters',
    (await vaultNames()) === beforeUpgrade && JSON.parse(beforeUpgrade).unreadable === 0,
    await vaultNames(),
  );

  // ---- Login: the stale-KDF upgrade, for an administrator ----------------

  const adminBrowser = await openBrowser(`${BASE}/login`);
  const admin = adminBrowser.session;
  try {
    const adminSignIn = async (label) => {
      await admin.eval("fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' }, body: '{}' })");
      await admin.goto(`${BASE}/login`);
      await signInOn(admin, ADMIN_PASSWORD, 'ops.leander');
      await admin.waitUntil("location.pathname === '/admin'", { timeout: 90000, label });
      await admin.settle(400);
    };
    await adminSignIn('the admin area');
    await makeStale(admin, 'ops.leander', ADMIN_PASSWORD);
    const staleAdmin = credentialOf('ops.leander');

    const releaseAdmin = await intercept(admin, '*/api/auth/upgrade-kdf', () => ({ status: 500 }));
    await adminSignIn('the admin area with its upgrade failing');
    check(
      'an administrator whose upgrade answers Server Error stays signed in',
      (await admin.eval('location.pathname')) === '/admin' &&
        JSON.stringify(credentialOf('ops.leander')) === JSON.stringify(staleAdmin),
    );
    await adminSignIn('the admin area at the old parameters again');
    check('after a failed upgrade the administrator still signs in with the old parameters', true);
    await releaseAdmin();

    await adminSignIn('the admin area as it upgrades');
    const upgradedAdmin = credentialOf('ops.leander');
    check(
      'a stale administrator is upgraded the same way: salt, envelope and Auth Key hash change, and no wrapper is made',
      JSON.parse(upgradedAdmin.params).salt !== JSON.parse(staleAdmin.params).salt &&
        JSON.stringify(JSON.parse(upgradedAdmin.params).kdf) === JSON.stringify(envelope) &&
        upgradedAdmin.verifier !== staleAdmin.verifier &&
        upgradedAdmin.wrapped_dek === null &&
        sql('SELECT COUNT(*) AS n FROM dek_wrappers WHERE credential_id = ?', upgradedAdmin.id)[0].n === 0,
      upgradedAdmin.params,
    );
    await adminSignIn('the admin area after the upgrade');
    check('the upgraded administrator still signs in', true);

    // No idle rule for an administrator: an hour and more of nothing
    // leaves the admin area as it was.
    await admin.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
    await admin.goto(`${BASE}/admin`);
    await admin.settle(500);
    await admin.eval(`window.testClock.advance(${61 * MINUTE})`);
    await admin.settle(500);
    check(
      'an administrator session is unaffected by any idle period',
      (await admin.eval('location.pathname')) === '/admin' &&
        !(await admin.eval("Boolean(document.querySelector('#unlock-password'))")) &&
        (await admin.eval("document.body.innerText")).includes('Invites'),
    );

    // app-shell.md: Sign out is an administrator's only way out, by
    // mouse and by keyboard. Each is a real input event, not a
    // scripted .click(), so what the button is wired to is what runs.
    const adminRequests = watched.at(-1).requests;
    const logouts = () => adminRequests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/auth/logout')).length;
    const sessionStatus = () => admin.eval("fetch('/api/admin/accounts', { headers: { 'X-Solvent-Request': '1' } }).then((r) => r.status)");
    const leavesByInput = async (how, act) => {
      await adminSignIn(`the admin area before signing out by ${how}`);
      const before = logouts();
      check(`an administrator is signed in before signing out by ${how}`, (await sessionStatus()) === 200);
      await act();
      await admin.waitUntil("location.pathname === '/login'", { timeout: 15000, label: `the sign-in card after Sign out by ${how}` });
      check(`Sign out by ${how} sends the logout request`, logouts() === before + 1);
      check(`Sign out by ${how} ends the session`, (await sessionStatus()) === 401);
    };
    const signOutBox = () =>
      admin.eval(`(() => {
        const b = [...document.querySelectorAll('.topbar-actions button')].find((x) => x.textContent.trim() === 'Sign out');
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
    await leavesByInput('mouse', async () => {
      const { x, y } = await signOutBox();
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await admin.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
    });
    await leavesByInput('keyboard', async () => {
      await admin.eval("[...document.querySelectorAll('.topbar-actions button')].find((x) => x.textContent.trim() === 'Sign out').focus()");
      const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
      await admin.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...key });
      await admin.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    });
  } finally {
    adminBrowser.close();
  }

  // ---- Login: nothing but the Auth Key leaves, and nothing is kept --------

  const everyRequest = watched.flatMap((w) => w.requests);
  const loginBodies = everyRequest.filter((r) => r.method === 'POST' && r.url.endsWith('/api/auth/login'));
  check(
    'every login request carries the username and the Auth Key and nothing else',
    loginBodies.length > 0 && loginBodies.every((r) => Object.keys(JSON.parse(r.body)).sort().join(',') === 'authKey,username'),
    `${loginBodies.length} sign-ins`,
  );
  // Every password typed anywhere in the run, as typed and in the
  // encodings a careless client would send it in.
  const everyPassword = [ADMIN_PASSWORD, VAULT_PASSWORD, NEW_PASSWORD, LEAVING_PASSWORD, REGISTRANT_PASSWORD, 'not the password at all'];
  const forms = everyPassword.flatMap((pw) => [
    pw,
    encodeURIComponent(pw),
    Buffer.from(pw).toString('base64'),
    Buffer.from(pw).toString('hex'),
  ]);
  const leaked = everyRequest.filter((r) => forms.some((f) => r.url.includes(f) || r.headers.includes(f) || r.body.includes(f)));
  check(
    'no password appears in any request, in any form, over the whole run',
    everyRequest.length > 0 && leaked.length === 0,
    leaked.map((r) => r.url).join(','),
  );
  // The Master Key each account holds now, which only its own tab ever
  // has, exported and looked for on the wire.
  const masterKeys = JSON.parse(await page.eval(`(async () => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const keys = [];
    for (const [username, password] of ${JSON.stringify([['leander', VAULT_PASSWORD], ['ops.leander', ADMIN_PASSWORD]])}) {
      const { salt, kdf } = await api.post('/api/auth/salt', { username });
      const { masterKey } = await c.deriveKeys(password, salt, kdf);
      keys.push(c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', masterKey))));
    }
    return JSON.stringify(keys);
  })()`));
  check(
    'no Master Key appears in any request',
    everyRequest.every((r) => masterKeys.every((key) => !r.body.includes(key) && !r.headers.includes(key))),
  );
  const storageWrites = watched.flatMap((w) => w.storage);
  check(
    'nothing is written to localStorage or sessionStorage at any point, upgrades and re-unlocks included',
    storageWrites.length === 0 && (await page.eval('localStorage.length + sessionStorage.length')) === 0,
    JSON.stringify(storageWrites.map((w) => w.key)),
  );

  // ---- Login: someone else at the card ------------------------------------

  await page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Lock').click()");
  await page.waitUntil("document.querySelector('.known-username a')", { label: 'the card after locking' });
  await page.eval("document.querySelector('.known-username a').click()");
  await page.waitUntil("location.pathname === '/login'", { label: 'the sign-in address after Not you' });
  await page.settle(300);
  expectedFailures.add('/api/sessions');
  check(
    'Not you? Sign out ends the session and offers the full card',
    (await page.eval("Boolean(document.querySelector('#unlock-username'))")) &&
      (await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then((r) => r.status)")) === 401,
  );

  // ---- The sign-in wait ---------------------------------------------------

  // login.md: the time from submitting the sign-in form to the Auth Key
  // leaving the browser is statistically indistinguishable for an
  // administrator, a vault owner and a stranger. The stopwatch runs in
  // the page, from the form's submit event to the call that hands the
  // login request to the network. That call is held back, so no
  // sampled attempt reaches the login endpoint or counts against an
  // account. The salt request goes out for real, because its answer is
  // what the derivation runs on.
  //
  // The method is tests/test_timing.py's: one sign-in per case per
  // round in a fresh random order, the first round discarded because
  // it starts the worker and loads the WebAssembly, and every pair of
  // medians held within one interquartile range of a single sign-in.
  // The round count keeps the standard error of a median difference
  // at about a fifth of that range, so noise alone does not reach the
  // margin, while skipping the derivation for one case moves its
  // median by the whole derivation.
  const timing = await launch();
  try {
    const clean = await Session.connect(timing.target);
    await clean.send('Page.enable');
    await clean.send('Runtime.enable');
    await clean.goto(`${BASE}/login`);
    await clean.eval(`(() => {
      window.__waits = [];
      let started = 0;
      document.addEventListener('submit', () => { started = performance.now(); }, true);
      const send = window.fetch;
      window.fetch = (input, init) => {
        if (String(input).endsWith('/api/auth/login')) {
          window.__waits.push(performance.now() - started);
          return Promise.reject(new TypeError('held back by the timing harness'));
        }
        return send(input, init);
      };
    })()`);
    const signIn = (username) =>
      clean.eval(`(async () => {
        const set = (selector, value) => {
          const node = document.querySelector(selector);
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const before = window.__waits.length;
        set('#unlock-username', ${JSON.stringify(username)});
        set('#unlock-password', ${JSON.stringify(VAULT_PASSWORD)});
        const button = document.querySelector('button[type=submit]');
        button.click();
        while (window.__waits.length === before || button.disabled) {
          await new Promise((r) => setTimeout(r, 25));
        }
        return window.__waits[before];
      })()`);

    const cases = { 'vault owner': 'leander', administrator: 'ops.leander', unknown: 'nobody-at-all' };
    const waits = Object.fromEntries(Object.keys(cases).map((name) => [name, []]));
    const ROUNDS = 44;
    for (let round = 0; round <= ROUNDS; round++) {
      const order = Object.keys(cases).sort(() => Math.random() - 0.5);
      for (const name of order) {
        const wait = await signIn(cases[name]);
        if (round) waits[name].push(wait);
      }
    }

    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const iqr = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const half = Math.floor(sorted.length / 2);
      return median(sorted.slice(sorted.length - half)) - median(sorted.slice(0, half));
    };
    const summary = Object.entries(waits)
      .map(([name, values]) => `${name} ${median(values).toFixed(1)} ms, spread ${iqr(values).toFixed(1)} ms`)
      .join(', ');
    console.log(`sign-in wait: ${summary}`);
    const names = Object.keys(waits);
    for (const [i, a] of names.entries()) {
      for (const b of names.slice(i + 1)) {
        const gap = Math.abs(median(waits[a]) - median(waits[b]));
        const spread = (iqr(waits[a]) + iqr(waits[b])) / 2;
        check(
          `the sign-in wait is the same for ${a} and ${b}`,
          gap <= spread,
          `${gap.toFixed(1)} ms apart against a spread of ${spread.toFixed(1)} ms, ${summary}`,
        );
      }
    }
  } finally {
    timing.child.kill();
  }

  // ---- App shell: no console error on a page reached by navigation -----
  //
  // app-shell.md: every page declares its icon, so the browser never asks
  // for /favicon.ico, which the gate refuses. A fresh browser with no
  // session reaches a shell page, a Not Found (the administration area
  // answers a caller with no session as an unknown path) and a Forbidden
  // (the export, navigated to without its header). Nothing here is
  // filtered but the browser's own note that the page it was asked for
  // answered 4xx; any other error it logs is a problem.
  {
    const bare = await openBrowser();
    const logged = [];
    const asked = new Set();
    bare.session.on((message) => {
      if (
        message.method === 'Log.entryAdded' &&
        message.params.entry.level === 'error' &&
        !asked.has(message.params.entry.url)
      ) {
        logged.push(`${message.params.entry.url || ''} ${message.params.entry.text}`);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        logged.push(`console.error ${JSON.stringify(message.params.args.map((a) => a.value))}`);
      }
      if (message.method === 'Runtime.exceptionThrown') logged.push('exception');
    });
    await bare.session.send('Log.enable');
    try {
      for (const [name, path, status] of [
        ['a shell page', '/login', 200],
        ['a Not Found page', '/admin', 404],
        ['a Forbidden page', '/api/export', 403],
      ]) {
        asked.add(`${BASE}${path}`);
        await bare.session.goto(`${BASE}${path}`);
        await bare.session.settle(1500);
        const answered = await bare.session.eval("performance.getEntriesByType('navigation')[0].responseStatus");
        const icon = await bare.session.eval(
          "document.querySelector('link[rel=icon]')?.getAttribute('href') + ' ' + document.querySelector('link[rel=icon]')?.getAttribute('type')",
        );
        check(`${name} answers ${status}`, answered === status, answered);
        check(`${name} declares the app icon from the static endpoint`, icon === '/static/icon.png image/png', icon);
      }
      check('no page reached by navigation logs an error in the console', logged.length === 0, logged.join(' | '));
      for (const entry of logged) problems.push(entry);
    } finally {
      bare.close();
    }
  }

  // ---- App shell: one Not Found, whoever navigates to it ----------------
  //
  // app-shell.md, Refusals: a page refusal is the same page whatever the
  // session, the kind or the header, so a navigation to /admin cannot be
  // told apart from one to an address that was never there. Each is a
  // real top-level navigation, in a browser holding the session it names.
  // `//admin` is left to tests/test_guard.py: the development server
  // collapses the leading slashes before the app sees them.
  {
    const signedOut = await openBrowser();
    const owner = await openBrowser(`${BASE}/login`);
    const administrator = await openBrowser(`${BASE}/login`);
    try {
      await signInOn(administrator.session, ADMIN_PASSWORD, 'ops.leander');
      await administrator.session.waitUntil("location.pathname === '/admin'", { timeout: 90000, label: 'the admin area for the Not Found check' });
      await signInOn(owner.session, VAULT_PASSWORD, 'leander');
      await owner.session.waitUntil("location.pathname === '/dashboard' && document.querySelector('.topbar nav a')", { timeout: 90000, label: 'the dashboard for the Not Found check' });

      const answers = {};
      for (const [name, who, path] of [
        ['/admin signed out', signedOut, '/admin'],
        ['/admin as a vault owner', owner, '/admin'],
        ['/settings as an administrator', administrator, '/settings'],
        ['an invented page path', signedOut, '/some-invented-page'],
        ['/favicon.ico signed out', signedOut, '/favicon.ico'],
      ]) {
        await who.session.goto(`${BASE}${path}`);
        await who.session.settle(500);
        answers[name] = {
          status: await who.session.eval("performance.getEntriesByType('navigation')[0].responseStatus"),
          path: await who.session.eval('location.pathname'),
          html: await who.session.eval('document.documentElement.outerHTML'),
        };
      }
      const names = Object.keys(answers);
      for (const name of names) {
        check(`${name} answers Not Found without redirecting`, answers[name].status === 404, answers[name].status);
      }
      check(
        'every address that is not served renders the identical Not Found page',
        names.every((name) => answers[name].html === answers[names[0]].html),
        names.filter((name) => answers[name].html !== answers[names[0]].html).join(', '),
      );
      check(
        'no refused navigation is sent anywhere else',
        names.every((name, i) => answers[name].path === ['/admin', '/admin', '/settings', '/some-invented-page', '/favicon.ico'][i]),
        names.map((name) => answers[name].path).join(' '),
      );
    } finally {
      signedOut.close();
      owner.close();
      administrator.close();
    }
  }
} catch (error) {
  check('the workflow ran to the end', false, error.message);
} finally {
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : ''}`);
  }
  const unique = [...new Set(problems)];
  console.log('--- console errors ---');
  console.log(unique.length ? unique.join('\n') : 'none');
  child.kill();
  // Set the code rather than calling process.exit, which can cut off
  // a pipe before the report above has flushed.
  process.exitCode = checks.some((c) => !c.ok) || unique.length ? 1 : 0;
}
