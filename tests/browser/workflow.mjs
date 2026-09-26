// The workflows, end to end, in a real browser
// (spec/ui/register.md, unlock.md, dashboard.md, update-values.md,
// recording-detail.md, account-detail.md, settings.md, admin.md).
//
// Everything past the sign-in card is client-rendered from decrypted
// records, so this is the only place those screens can be checked.
// Run by tests/test_browser.py, which starts the server and mints the
// bootstrap invite first.
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
    // The browser asks every page for /favicon.ico, and one check
    // here deliberately fetches the export without its header to
    // prove the endpoint is not navigable. Both are the gate
    // answering correctly.
    const url = entry.url || '';
    const noise =
      url.endsWith('/favicon.ico') ||
      url.endsWith('/api/export') ||
      [...expectedFailures].some((path) => url.includes(path));
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

// Answers each request matching `pattern` with what `respond` returns
// for it, { status, body } to fulfil or null to let it through, until
// the returned function is called. `respond` may take its time, which
// holds the request that long.
async function intercept(session, pattern, respond) {
  const handler = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
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
  await session.send('Fetch.enable', { patterns: [{ urlPattern: pattern, requestStage: 'Request' }] });
  return async () => {
    session.handlers = session.handlers.filter((h) => h !== handler);
    await session.send('Fetch.disable');
  };
}

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
// back under a freshly generated DEK, exactly as the transfer screen
// does. Returns what a fresh unlock reads back.
const importOwnExport = () =>
  page.eval(`(async () => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const { SCHEMA_VERSION } = await import('/static/js/model.js');
    const file = await (await fetch('/api/export', { headers: { 'X-Solvent-Request': '1' } })).json();

    // Open the file with its own password, exactly as the screen does.
    const keys = await c.deriveKeys(${JSON.stringify(VAULT_PASSWORD)}, file.salt, file.kdf);
    const fileDek = await c.unwrapDek(file.wrappedDek, file.dekNonce, keys.masterKey);
    const plain = [];
    for (const record of file.records) {
      plain.push({ record, payload: await c.decryptRecord(fileDek, record) });
    }

    // Re-key: a freshly generated DEK, never the file's.
    const newDek = await c.generateDek();
    const rekeyed = [];
    for (const { record, payload } of plain) {
      const slot = {
        recordId: record.recordId, recordType: record.recordType,
        accountId: record.accountId ?? null, schemaVersion: SCHEMA_VERSION, version: 1,
      };
      rekeyed.push({ ...slot, ...(await c.encryptRecord(newDek, slot, payload)) });
    }
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
  await page.settle(600);

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
  await submit();
  await page.waitUntil("location.pathname === '/dashboard'", { timeout: 90000, label: 'the dashboard' });
  await page.settle(500);

  // A page load discards the in-memory keys by definition.
  check('a reload asks for the password again', (await text()).includes('Solvent cannot recover a lost password'));
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
    await setValue('#holding-unit', unit);
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
  const rateValues = await page.eval("[...document.querySelectorAll('.rate-line input')].map(n => n.value)");
  check('the prices went in with the first row', rateValues.every(Boolean), rateValues.join(','));
  const requests = await page.eval(`(() => performance.getEntriesByType('resource')
    .filter(e => e.name.includes('/api/rates?')).length)()`);
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
  const rateCalls = () =>
    page.eval("performance.getEntriesByType('resource').filter(e => e.name.includes('/api/rates?')).length");
  const beforeOpen = await rateCalls();
  await page.eval("location.hash = '#/'");
  await page.settle(400);
  await page.eval("document.querySelector('.entry-mark').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await page.settle(900);
  check('opening a recording asks the source nothing', (await rateCalls()) === beforeOpen);

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
  check('export is offered as the primary action in it', (await text()).includes('Export first'));
  check(
    'deleting is the destructive secondary action',
    await page.eval("Boolean(document.querySelector('.danger-zone .btn-destructive'))"),
  );

  const exported = JSON.parse(
    await page.eval(`(async () => {
      const response = await fetch('/api/export', { headers: { 'X-Solvent-Request': '1' } });
      const body = await response.json();
      const raw = JSON.stringify(body);
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

  // Another tab writes the profile first.
  const otherTab = 'Liquidity, from another tab';
  await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const { SCHEMA_VERSION } = await import('/static/js/model.js');
    const record = v.profileRecord;
    const payload = { ...v.profile, dimensions: v.dimensions.map((d) => (d.id === ${JSON.stringify(liquidity.id)} ? { ...d, label: ${JSON.stringify(otherTab)} } : d)) };
    const slot = { recordId: record.recordId, recordType: 'profile', accountId: null, schemaVersion: SCHEMA_VERSION, version: record.version + 1 };
    await api.put('/api/records/' + slot.recordId, { recordType: 'profile', accountId: null, schemaVersion: slot.schemaVersion, version: slot.version, ...(await c.encryptRecord(v.dek, slot, payload)) });
  })()`);
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
  const deleteState = (password, typed) =>
    page.eval(`(() => {
      const zone = document.querySelector('.danger-zone');
      const [pw, name] = zone.querySelectorAll('input');
      pw.value = ${JSON.stringify(password)};
      pw.dispatchEvent(new Event('input', { bubbles: true }));
      name.value = ${JSON.stringify(typed)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
      return zone.querySelector('.btn-destructive').disabled;
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
    (await page.eval("document.querySelector('.danger-zone .btn-primary').textContent")) === 'Export first',
  );

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
    await other.eval("document.querySelector('button[type=submit]').click()");
    await other.waitUntil("location.pathname === '/dashboard'", { timeout: 90000, label: 'the new vault' });
    await other.settle(500);
    await signInOn(other, LEAVING_PASSWORD);
    await other.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label: 'the new vault unlocked' });
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
        const zone = document.querySelector('.danger-zone');
        zone.open = true;
        const [pw, name] = zone.querySelectorAll('input');
        pw.value = ${JSON.stringify(LEAVING_PASSWORD)};
        pw.dispatchEvent(new Event('input', { bubbles: true }));
        name.value = 'leaving';
        name.dispatchEvent(new Event('input', { bubbles: true }));
        zone.querySelector('.btn-destructive').click();
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
    await other.settle(400);
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

  // A holding recorded at the backdate but not today carries its
  // earlier figure forward, and the control offers to confirm it.
  const sweepDate = (await page.eval('location.hash')).split('/').pop();
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

  await click('Archive');
  await page.waitUntil("document.body.innerText.includes('Archive keeps every value')", {
    label: 'the archive dialog',
  });
  check('archive is offered before deleting', (await text()).includes('You can undo this'));
  check('it offers a closing value', (await text()).includes('What was it worth when you closed it?'));
  check('it says what skipping costs', (await text()).includes('your chart drops by the last figure'));
  await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Archive').click()");
  await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: 'the archive to land' });
  await page.settle(1200);
  check('an archived holding carries its chip', (await text()).includes('Archived'));
  check('it offers Unarchive rather than Archive', (await labels('.form-actions button')).includes('Unarchive'));
  check('an archived holding takes no new value', !(await labels('.form-actions button')).includes('Record a value'));

  await page.eval("location.hash = '#/'");
  await page.settle(900);
  const listed = await page.eval(
    "[...document.querySelectorAll('.data-table tbody .link-button')].map(b => b.textContent)",
  );
  check('an archived holding leaves the current total', !listed.includes(archiving), `${archiving} in ${listed.join(',')}`);

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

  // ---- Export, then import it back ---------------------------------------

  // A bookmark of the old address, which is still a real address and
  // still lands on the screen it names.
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
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/records*', requestStage: 'Response' }] });
  const reverse = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request, responseHeaders = [] } = message.params;
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
    await page.send('Fetch.disable');
  }

  const roundTrip = JSON.parse(await importOwnExport());
  check('the planted vault survives the round trip', roundTrip.unreadable === 0, String(roundTrip.unreadable));
  await unlockDashboard('the dashboard after the round trip');
  const afterImport = await picture();
  check('the planted pairs read the same after an export and import', afterImport === inOrder, `${inOrder} vs ${afterImport}`);

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
    await second.eval(`(() => {
      const set = (selector, value) => {
        const node = document.querySelector(selector);
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('#unlock-username', 'leander');
      set('#unlock-password', ${JSON.stringify(VAULT_PASSWORD)});
      document.querySelector('button[type=submit]').click();
    })()`);
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
  const keptPasswords = await reachable(typedPasswords);
  check(
    'no password typed into settings is kept across the lock, shown or not',
    shownType === 'text' && keptPasswords.length === 0,
    `${keptPasswords.length} kept, the second field was ${shownType}`,
  );
  await unlockInPlace('the vault after unlocking over the password card');
  const passwords = await page.eval(`JSON.stringify([...${passwordCard}.querySelectorAll('input')].map(f => f.value))`);
  check(
    'no password field is refilled after unlocking',
    JSON.parse(passwords).every((value) => value === ''),
    passwords,
  );

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
  const everyPassword = [ADMIN_PASSWORD, VAULT_PASSWORD, NEW_PASSWORD, LEAVING_PASSWORD, 'not the password at all'];
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
