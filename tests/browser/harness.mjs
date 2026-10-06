// What every part under tests/browser/parts/ shares: one headless Chrome
// per part, the checks and what they are reported with, the stub for the
// rate proxy, the database as an operator's shell reads it, and the
// helpers that make a part's accounts and records through the app's own
// modules in the page.
//
// A part is run by tests/test_browser.py against a server and a database
// of its own, so it signs up the accounts it needs and shares nothing
// with another part.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { launch as launchChrome, Session } from './cdp.mjs';

export { Session };

export const BASE = process.env.SOLVENT_BASE;
export const BOOTSTRAP = process.env.SOLVENT_INVITE;
// Set by tests/test_browser.py, which also checks the stored verifiers
// against them once a part has run.
export const ADMIN_PASSWORD = process.env.SOLVENT_ADMIN_PASSWORD;
export const VAULT_PASSWORD = process.env.SOLVENT_VAULT_PASSWORD;
export const BACKDATE = process.env.SOLVENT_BACKDATE;
// Passwords a part types besides those two. Every one is looked for on
// the wire, in every part.
export const NEW_PASSWORD = 'marble quarry violet anchor';
export const LEAVING_PASSWORD = 'lantern harbour ribbon tundra';
export const REGISTRANT_PASSWORD = 'plover ember quarry vellum';
export const SECOND_PASSWORD = 'meadow copper lantern thistle';
export const RECORDER_PASSWORD = 'lantern quarry velvet oboe';
const WRONG_PASSWORD = 'not the password at all';
// The same server as Node reaches it: the loopback address it is bound
// to, which Node does not always resolve localhost to first.
export const DIRECT = BASE.replace('//localhost', '//[::1]');

const checks = [];
export const problems = [];
// Addresses a check fails on purpose, whose refusal the browser logs.
export const provoked = [];
// A request a section fails on purpose, by path, for as long as it is
// listed. The browser logs each failed response as an error.
export const expectedFailures = new Set();

export function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail: String(detail) });
}

// Every Chrome this part starts, so none outlives it.
const browsers = new Set();
export async function launch() {
  const opened = await launchChrome();
  browsers.add(opened.child);
  return opened;
}

const { target, port } = await launch();
export const page = await Session.connect(target);
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

// Every request a page sends, with its body, and every write to web
// storage, over the whole run. Read back in the run-wide checks, since
// login.md asks it of the whole flow and not only the first sign-in.
export async function watch(session) {
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
  await session.track();
  return { requests, storage };
}
export const watched = [await watch(page)];

// Another browser with a profile of its own, watched like the first.
export async function openBrowser(url) {
  const opened = await launch();
  const session = await Session.connect(opened.target);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  watched.push(await watch(session));
  if (url) await session.goto(url);
  return { session, close: () => opened.child.kill() };
}

// Another tab of the first browser, which shares its cookies and its
// BroadcastChannel. `before` is a script run in the tab ahead of the
// page's own.
export async function openTab(url, before = null) {
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const session = await Session.connect(tab);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  const { requests } = await watch(session).then((seen) => (watched.push(seen), seen));
  if (before) await session.send('Page.addScriptToEvaluateOnNewDocument', { source: before });
  if (url) await session.goto(url);
  return { session, requests, close: () => fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`) };
}

// The database the server runs on, read and written the way an
// operator's shell would.
export function sql(statement, ...args) {
  const db = new DatabaseSync(process.env.DATABASE_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return db.prepare(statement).all(...args);
  } finally {
    db.close();
  }
}
export const credentialOf = (username) =>
  sql(
    `SELECT c.id, c.params, c.verifier, w.wrapped_dek, w.dek_nonce, p.id AS principal
     FROM credentials c JOIN principals p ON p.id = c.principal_id
     LEFT JOIN dek_wrappers w ON w.credential_id = c.id WHERE p.username = ?`,
    username,
  )[0];
export const recordsOf = (principal) =>
  JSON.stringify(sql('SELECT * FROM records WHERE principal_id = ? ORDER BY record_id', principal));
export const OWN = "JOIN principals ON principals.id = records.principal_id WHERE principals.username = 'leander'";

// An invite as an operator's shell mints it, which needs no
// administrator to be signed in.
export const mintInvite = (kind) =>
  execFileSync(
    process.env.SOLVENT_PYTHON,
    ['-m', 'flask', '--app', 'app', 'create-invite', '--kind', kind, '--expires-days', '1', '--force'],
    { env: process.env, cwd: process.cwd() },
  ).toString().trim().split('invite=').pop();

// The rate proxy as the main page sees it. It is answered here, so no
// check waits on a live provider, and every ask is kept for the checks
// that count them. Fetch.enable replaces the patterns in force and
// Fetch.disable drops them all, so the helpers below keep this one in
// force on the page and skip its requests.
const RATES = { urlPattern: '*/api/rates\\?*', requestStage: 'Request' };
export const proxyAsks = [];
export const isRateAsk = (session, request) => session === page && request.url.includes('/api/rates?');
export const fetchOn = (session, urlPattern, requestStage = 'Request') =>
  session.send('Fetch.enable', {
    patterns: [{ urlPattern, requestStage }, ...(session === page ? [RATES] : [])],
  });
export const fetchOff = (session) =>
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
export async function intercept(session, pattern, respond) {
  const handler = async (message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    if (isRateAsk(session, request)) return;
    const answer = await respond(request);
    if (!answer) {
      await session.send('Fetch.continueRequest', { requestId });
      return;
    }
    if (answer.drop) {
      await session.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' });
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
export const answering = async (match, status, body) => {
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

// The holding screens' shared helpers: the database as an operator reads it,
// the vault model in the page, and the writes the page sends.
export const accountRows = () =>
  JSON.stringify(sql(`SELECT records.* FROM records ${OWN} AND record_type = 'account' ORDER BY record_id`));
export const rowOf = (id) => sql(`SELECT records.* FROM records ${OWN} AND record_id = ?`, id)[0];
// The database file's own bytes, which is where plaintext would sit.
export const inDatabase = (needles) => {
  const bytes = readFileSync(process.env.DATABASE_PATH);
  return needles.filter((needle) => bytes.includes(Buffer.from(needle, 'utf8')));
};
// `read` is a function of the page's vault and then `args`, which reach
// it as data. Its source is the only code text built here.
export const vaultValue = (read, ...args) =>
  page.call(`async (...args) => {
    const v = (await import('/static/js/session.js')).currentVault();
    return JSON.stringify((${read})(v, ...args));
  }`, ...args).then(JSON.parse);
export const payloadOf = (id) => vaultValue((v, at) => (v.holdings.get(at) ? v.holdings.get(at).payload : null), id);
export const idNamed = (name) =>
  vaultValue((v, wanted) => [...v.holdings.values()].filter((h) => h.payload.name === wanted).map((h) => h.recordId), name);
// The model read afresh from the store, and the screen redrawn from
// it, without a derivation.
export const reloadModel = async (hash = '#/') => {
  await page.eval(`(async () => {
    await (await import('/static/js/session.js')).currentVault().load();
    location.hash = '#/reloading';
  })()`);
  await page.frames();
  await page.call((next) => { location.hash = next; }, hash);
  await page.frames();
};
export const openHolding = async (id) => {
  await page.call((at) => { location.hash = `#/holding/${at}`; }, id);
  await page.waitUntil("document.querySelector('.detail-header')", { label: 'a holding screen' });
  await page.frames();
};
export const inDialog = (label) =>
  page.call((name) => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === name).click(), label);
export const choose = (selector, value) =>
  page.call((query, next) => {
    const node = document.querySelector(query);
    node.value = next;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
export const writesSeen = () => page.eval('window.__writes.splice(0)');
export const recordReads = () =>
  page.eval("performance.getEntriesByType('resource').filter(e => e.name.includes('/api/records?type=')).length");
// Every request matching `refuse` answered with Server Error while
// `body` runs, the way a failed write looks to the page.
export const failing = (refuse, body) =>
  answering((request) => {
    if (!refuse(request)) return false;
    provoked.push(new URL(request.url).pathname);
    return true;
  }, 500, body);
export const writing = (type, method = 'PUT') => (request) =>
  request.method === method && (!type || (request.postData || '').includes(`"recordType":"${type}"`));

// Every PUT the page sends, by record type, in order.
export const recordWrites = () =>
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

// Runs `act` and waits for the write it starts to land.
export const landing = async (act) => {
  const before = await page.eval('window.__writes.length');
  await act();
  await page.waitUntil((n) => window.__writes.length > n, { args: [before], label: 'the write to be sent' });
  await page.idle();
};

// An account at a KDF envelope below the server default, the state of
// one registered before the default was raised. No endpoint stores a
// weak envelope, so the credential is rotated through the upgrade
// endpoint with its salt, Auth Key and wrapper all made at the weak
// memory parameter, and the database then records that parameter. It
// signs in exactly as such an account would. Run in a page signed in
// as `username`, which for a vault owner must hold the unlocked vault.
export const WEAK_MEMORY = 32768;
export async function makeStale(session, username, password) {
  await session.call(async (secret, memory, name) => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const kdf = JSON.parse(document.getElementById('kdf-envelope').textContent);
    const salt = c.b64encode(c.randomBytes(16));
    const keys = await c.deriveKeys(secret, salt, { ...kdf, m: memory });
    const { salt: currentSalt } = await api.post('/api/auth/salt', { username: name });
    const body = { currentSalt, salt, kdf, authKey: keys.authKey };
    const vault = s.currentVault();
    if (vault) Object.assign(body, await c.wrapDek(vault.dek, keys.masterKey));
    await api.post('/api/auth/upgrade-kdf', body);
  }, password, WEAK_MEMORY, username);
  sql(
    `UPDATE credentials SET params = json_set(params, '$.kdf.m', ?)
     WHERE principal_id = (SELECT id FROM principals WHERE username = ?)`,
    WEAK_MEMORY,
    username,
  );
}

// The sign-in card on any page, filled and submitted. The username is
// typed only where the card asks for it.
export const signInOn = async (session, password, username = null) => {
  await session.waitUntil("document.querySelector('#unlock-password')", { label: 'the sign-in card' });
  await session.call((secret, name) => {
    const set = (selector, value) => {
      const node = document.querySelector(selector);
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (name && document.querySelector('#unlock-username')) {
      set('#unlock-username', name);
    }
    set('#unlock-password', secret);
    document.querySelector('button[type=submit]').click();
  }, password, username);
};

// The password alone, on a card that knows the username.
export const enterPasswordOn = async (session, password) => {
  await session.waitUntil("document.querySelector('#unlock-password')", { label: 'the password card' });
  await session.call((secret) => {
    const node = document.querySelector('#unlock-password');
    node.value = secret;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('button[type=submit]').click();
  }, password);
};

// The headers of a request a check sends by hand from a page that holds a
// vault: the CSRF header and the vault epoch the page holds, as api.js
// sends them (architecture.md, Vault epoch). For an expression run in the
// page's own async function.
export const HANDS = `{ 'X-Solvent-Request': '1', 'X-Solvent-Vault': (await import('/static/js/api.js')).vaultEpoch() }`;

// The settled computed look of the dialog button `label` on `session`,
// read against the design tokens (design-system.md, Components): whether it
// wears the disabled look (petrol-200 fill and border, ink-secondary
// label, opacity 1), and whether any red shows on it.
export const confirmLook = (label, session = page) =>
  session.call((name) => {
    const token = (property, variable) => {
      const probe = document.createElement('div');
      probe.style[property] = `var(${variable})`;
      document.body.append(probe);
      const value = getComputedStyle(probe)[property];
      probe.remove();
      return value;
    };
    const petrol = token('backgroundColor', '--petrol-200');
    const critical = token('backgroundColor', '--status-critical');
    const ink = token('color', '--ink-secondary');
    const button = [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === name);
    // Ends the 150ms color transition, so the computed look is the settled one.
    button.style.transition = 'none';
    const style = getComputedStyle(button);
    return {
      cursor: style.cursor,
      opacity: style.opacity,
      petrolFill: style.backgroundColor === petrol,
      petrolBorder: style.borderTopColor === petrol,
      inkLabel: style.color === ink,
      red: [style.backgroundColor, style.borderTopColor, style.color].includes(critical),
      redFill: style.backgroundColor === critical,
    };
  }, label);
export const looksDisabled = (look) =>
  look.cursor === 'default' && look.opacity === '1' && look.petrolFill && look.petrolBorder && look.inkLabel && !look.red;
export const looksEnabledRed = (look) => look.redFill && look.opacity === '1';
export const text = () => page.eval('document.body.innerText');
export const labels = (selector) =>
  page.call((query) => [...document.querySelectorAll(query)].map((n) => n.textContent.trim()), selector);
export const click = async (label) => {
  await page.waitUntil(
    (name) => [...document.querySelectorAll('button, a')].some((b) => b.textContent.trim() === name),
    { args: [label], label: `the ${label} control` },
  );
  await page.call(
    (name) => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === name).click(),
    label,
  );
};
export const setValue = async (selector, value, index = 0) => {
  await page.waitUntil((query, at) => document.querySelectorAll(query).length > at, { args: [selector, index], label: selector });
  await page.call((query, at, next) => {
    const el = document.querySelectorAll(query)[at];
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, index, value);
};
export const submit = () => page.eval("document.querySelector('button[type=submit]').click()");
export const enterPassword = async (password) => {
  await setValue('input[type=password]', password);
  await submit();
};

// Export the vault, open the file with its own password, and import it
// back under a freshly generated DEK, through the module the transfer
// screen runs. Returns what a fresh unlock reads back.
export const importOwnExport = () =>
  page.call(async (password) => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const t = await import('/static/js/transfer.js');
    const file = t.checkFile((await s.exportFile()).file);

    const { fileDek, records } = await t.openFile(file, password);
    // Re-key: a freshly generated DEK, never the file's.
    const { dek: newDek, records: rekeyed } = await t.rekey(fileDek, records);
    const wrapper = await s.wrapForMaster(newDek);
    const answered = await api.post('/api/import', { ...wrapper, currentSalt: s.heldSalt(), records: rekeyed });

    // The page takes the new key and epoch and reads the vault back, as
    // the import screen does.
    const reopened = await s.replaceDek(newDek, answered.vaultEpoch);
    const fileRaw = c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', fileDek)));
    const newRaw = c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', newDek)));
    return JSON.stringify({
      names: [...reopened.holdings.values()].map(h => h.payload.name).sort(),
      unreadable: reopened.unreadable.length,
      rekeyed: fileRaw !== newRaw,
      kinds: [...new Set(records.map(r => r.recordType))].sort(),
    });
  }, VAULT_PASSWORD);

// Records the client's own rules would never write, encrypted with the
// page's own crypto under the unlocked vault's DEK and PUT straight to
// the record API. Each is { type, payload, accountId?, recordId?,
// version? }; the ids come back in order.
export const plant = (records) =>
  page.call(async (planted) => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const { SCHEMA_VERSION } = await import('/static/js/model.js');
    const dek = s.currentVault().dek;
    const ids = [];
    for (const r of planted) {
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
  }, records);

// A clock the test can move, installed before any page script runs.
// Every timer still fires on its own in real time; `advance` moves the
// clock forward and fires whatever has fallen due, so a fifteen-minute
// idle period passes in a call.
export const CLOCK = `(() => {
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
export const MINUTE = 60000;

// How many of `needles` satisfy `found`. Only this count leaves a probe,
// so a failing check never prints what it searched for.
export const occurring = (needles, found) => {
  let count = 0;
  for (const needle of needles) {
    if (found(needle)) count += 1;
  }
  return count;
};

// How many of `needles` a devtools user could still find: every string
// reachable from the page's heap, after a collection. The page keeps what
// it last drew until it draws again, so frames come first.
export const reachable = async (needles) => {
  await page.frames();
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
  return occurring(needles, (needle) => strings.some((s) => s.includes(needle)));
};

// A document the test has marked, so a document load is told from a
// change inside the page: a new document has no mark. Registration and
// sign-in must reach the vault without one, because the keys live in
// the document's memory and a new document has none (login.md, Rules;
// register.md, Flow).
export const markDocument = (session, name) => session.call((sitting) => { window.__sitting = sitting; }, name);

// Whether `session` is in the vault, in the document marked `name`:
// the keys in memory, no card asking for a password, and the chrome a
// vault owner has.
export const sitting = async (session, name) =>
  JSON.parse(await session.call(async (marked) => {
    const s = await import('/static/js/session.js');
    const bar = document.querySelector('.topbar');
    return JSON.stringify({
      sameDocument: window.__sitting === marked,
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
  }, name));

// What chrome a person can see, by what is rendered and not by what is
// in the DOM: a bar with `hidden` is present and not drawn. Outside the
// shell (password and registration screens) there is no top bar, no
// navigation, no Update values and no Lock, only the wordmark above the
// card (app-shell.md, Acceptance criteria).
export const chromeState = async (session) =>
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
export const noChrome = (state) =>
  !state.bar && state.barParts === 0 && state.navs === 0 && state.links === 0 && state.buttons === 0 &&
  state.topbarWordmark === 0 && state.outsideWordmark === 1 &&
  !/Update values|Dashboard|Settings|\bLock\b/.test(state.text);
export const hasChrome = (state) =>
  state.bar && state.navs === 1 && state.links === 2 && state.buttons === 2 && state.topbarWordmark === 1 && state.outsideWordmark === 0;

// Whichever settles first, `promise` or `ms` running out.
export const within = async (promise, ms) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]);
  } finally {
    clearTimeout(timer);
  }
};

// The dashboard drawn afresh from the model, by leaving it for another
// address and coming back.
export const redraw = async () => {
  await page.eval("location.hash = '#/unassigned/none'");
  await page.frames();
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard table' });
  await page.frames();
};

// The password card answered in place, and the vault it opens.
export const unlockInPlace = async (label) => {
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label });
  await page.idle();
};

// Waits for the vault to be showing, without throwing, so that a
// failure is one failed check and the run goes on.
export const intoVault = (session, label, timeout = 90000) =>
  session
    .waitUntil("location.pathname === '/dashboard' && document.querySelector('#app').children.length > 0 && !document.querySelector('#unlock-password') && document.querySelector('.topbar nav a')", { timeout, label })
    .then(() => true, () => false);

// Holds the first read of the vault's records on its way to the server
// until `release()`, so a test can act while the vault is being read.
// `reached` resolves when the read is waiting. `stop()` removes it. The
// read then goes on to the server, or is answered with `answer` when given.
export const holdRecords = async (session, answer = null) => {
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
export const afterRead = (session) =>
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

// Where Back lands from a page left while unlocked, or null when the
// card does not come back.
export const backFromAway = async (session) => {
  await session.goto('about:blank');
  await session.send('Page.navigateToHistoryEntry', {
    entryId: await session.send('Page.getNavigationHistory').then(({ currentIndex, entries }) => entries[currentIndex - 1].id),
  });
  const back = await session
    .waitUntil("document.querySelector('#unlock-password')", { timeout: 30000, label: 'the card after Back' })
    .then(() => true, () => false);
  if (!back) return null;
  return JSON.parse(await session.eval(`(async () => JSON.stringify({
    keys: (await import('/static/js/session.js')).currentVault() !== null,
    text: document.body.innerText,
  }))()`));
};

// ---- Accounts and records every part starts from ----------------------

// Fills a registration form that is showing, whichever kind it is, and
// submits it once its button has unlocked.
export async function register(session, invite, username, password, currency = 'CHF') {
  await session.goto(`${BASE}/register?invite=${invite}`);
  await session.waitUntil("document.querySelector('input[type=password]')", { label: 'the registration form' });
  await session.call((name, secret, money) => {
    const set = (selector, value, index = 0) => {
      const node = document.querySelectorAll(selector)[index];
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('input[type=text]', name);
    set('input[type=password]', secret, 0);
    set('input[type=password]', secret, 1);
    if (document.querySelector('select')) set('select', money);
    const box = document.querySelector('input[type=checkbox]');
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, username, password, currency);
  await session.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
  await markDocument(session, 'registration');
  await session.eval("document.querySelector('button[type=submit]').click()");
}

// The bootstrap administrator, signed in and in the admin area on
// `session`.
export async function administrator(session = page) {
  await register(session, BOOTSTRAP, 'ops.leander', ADMIN_PASSWORD);
  await session.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
    timeout: 90000,
    label: 'the admin area',
  });
}

// The vault owner `leander`, registered on the main page and showing
// an empty vault.
export async function vaultOwner() {
  await register(page, mintInvite('vault-owner'), 'leander', VAULT_PASSWORD);
  if (!(await intoVault(page, 'the new vault'))) throw new Error('the new vault did not open');
  await page.waitUntil("document.body.innerText.includes('Add your first holding')", { label: 'the empty vault' });
}

// Writes through the page's own modules, in the vault that is open: the
// holdings as the holding form writes them, and a recording as the
// sweep does, with the figures first and the proxy's prices after.
export const holdings = (specs) =>
  page.call(async (list) => {
    const s = await import('/static/js/session.js');
    const writes = await import('/static/js/writes.js');
    const v = s.currentVault();
    const ids = {};
    for (const [name, unit, dims = {}] of list) {
      const entry = await writes.saveHolding(v, null, {
        name, unit, dims, note: null, archivedAt: null, createdAt: new Date().toISOString(),
      });
      ids[name] = entry.recordId;
    }
    return ids;
  }, specs);

// `figures` is { holding name: value }.
export const recording = (date, figures) =>
  page.call(async (day, values) => {
    const s = await import('/static/js/session.js');
    const writes = await import('/static/js/writes.js');
    const v = s.currentVault();
    const named = (name) => [...v.holdings.values()].find((h) => h.payload.name === name);
    for (const [name, value] of Object.entries(values)) {
      await writes.saveSnapshot(v, named(name).recordId, null, { date: day, value, note: null });
    }
    await writes.refreshPrices(v, day, await writes.fetchProposals(v, day));
  }, date, figures);

// The vault's settings as the settings screen writes them.
export const setProfile = (patch) =>
  page.call(async (changes) => {
    const s = await import('/static/js/session.js');
    const writes = await import('/static/js/writes.js');
    const v = s.currentVault();
    await writes.saveProfile(v, { ...v.profile, ...changes });
  }, patch);

// What the first sitting of the story leaves: four holdings valued
// today, and a second figure for the first of them at the backdate.
export const HOLDINGS = [
  ['Cantonal account', 'CHF'],
  ['UBS dollar account', 'USD'],
  ['Gold bars', 'XAU-ozt'],
  ['Mortgage', 'CHF'],
];
export const TODAY_FIGURES = {
  'Cantonal account': '12450.00',
  'UBS dollar account': '8300.50',
  'Gold bars': '12.125',
  Mortgage: '-410000.00',
};
export async function story({ backdated = true } = {}) {
  await holdings(HOLDINGS);
  await recording(new Date().toISOString().slice(0, 10), TODAY_FIGURES);
  if (backdated) await recording(BACKDATE, { 'Cantonal account': '11000.00' });
}

// A page at the dashboard of a vault that is already open and drawn
// again, as a person who unlocks it afresh sees it.
export async function unlockDashboard(label) {
  await page.goto(`${BASE}/dashboard`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label });
  await page.idle();
}

// ---- The end of a part -------------------------------------------------

// Runs `body`, then the checks that hold for every part, and reports:
// no secret left the browser, and no console error was logged. A part
// that never signs in at the card says so with `signsIn: false`, since
// there is then no login request for the first check to read.
export async function run(body, { signsIn = true } = {}) {
  try {
    await body();
    await runWide(signsIn);
  } catch (error) {
    check('the part ran to the end', false, error.stack || error.message);
  } finally {
    for (const { name, ok, detail } of checks) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` (${detail})` : ''}`);
    }
    const unique = [...new Set(problems)];
    console.log('--- console errors ---');
    console.log(unique.length ? unique.join('\n') : 'none');
    for (const child of browsers) child.kill();
    // Set the code rather than calling process.exit, which can cut off
    // a pipe before the report above has flushed.
    process.exitCode = checks.some((c) => !c.ok) || unique.length ? 1 : 0;
  }
}

async function runWide(signsIn) {
  // login.md: nothing but the Auth Key leaves, and nothing is kept.
  const everyRequest = watched.flatMap((w) => w.requests);
  const loginBodies = everyRequest.filter((r) => r.method === 'POST' && r.url.endsWith('/api/auth/login'));
  check(
    'every login request carries the username and the Auth Key and nothing else',
    (loginBodies.length > 0 || !signsIn) &&
      loginBodies.every((r) => Object.keys(JSON.parse(r.body)).sort().join(',') === 'authKey,username'),
    `${loginBodies.length} sign-ins`,
  );
  // Every password typed anywhere in the run, as typed and in the
  // encodings a careless client would send it in.
  const everyPassword = [
    ADMIN_PASSWORD, VAULT_PASSWORD, NEW_PASSWORD, LEAVING_PASSWORD, REGISTRANT_PASSWORD, SECOND_PASSWORD,
    RECORDER_PASSWORD, WRONG_PASSWORD,
  ];
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
  // The Master Key each of the part's accounts holds now, which only
  // its own tab ever has, exported and looked for on the wire.
  const accounts = [['leander', VAULT_PASSWORD], ['ops.leander', ADMIN_PASSWORD]].filter(
    ([username]) => sql('SELECT id FROM principals WHERE username = ?', username).length,
  );
  await page.goto(`${BASE}/login`);
  const masterKeys = JSON.parse(await page.call(async (list) => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const keys = [];
    for (const [username, password] of list) {
      const { salt, kdf } = await api.post('/api/auth/salt', { username });
      const { masterKey } = await c.deriveKeys(password, salt, kdf);
      keys.push(c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', masterKey))));
    }
    return JSON.stringify(keys);
  }, accounts));
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
}
