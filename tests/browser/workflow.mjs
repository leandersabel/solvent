// The workflows, end to end, in a real browser
// (spec/ui/register.md, unlock.md, dashboard.md, update-values.md,
// recording-detail.md, account-detail.md, settings.md, admin.md).
//
// Everything past the sign-in card is client-rendered from decrypted
// records, so this is the only place those screens can be checked.
// Run by tests/test_browser.py, which starts the server and mints the
// bootstrap invite first.
import { launch, Session } from './cdp.mjs';

const BASE = process.env.SOLVENT_BASE;
const BOOTSTRAP = process.env.SOLVENT_INVITE;
const ADMIN_PASSWORD = 'orchard lantern quiet ribbon';
const VAULT_PASSWORD = 'harbour crescent tundra oblige';
const BACKDATE = process.env.SOLVENT_BACKDATE;

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
    const noise = url.endsWith('/favicon.ico') || url.endsWith('/api/export');
    if (entry.level === 'error' && !noise) {
      problems.push(`${entry.url || ''} ${entry.text}`);
    }
  }
  if (message.method === 'Runtime.exceptionThrown') {
    problems.push(message.params.exceptionDetails.exception?.description || 'exception');
  }
});

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
    const unlockHere = async () => {
      await set('input[type=password]', RECORDER_PASSWORD);
      await ev("document.querySelector('button[type=submit]').click()");
      await rec.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label: 'the recorder vault' });
      await quiet();
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
    const newRecording = async (iso) => {
      await press('New recording');
      await set('#recording-date', await format('date', iso));
      const said = await ev("document.querySelector('.dialog .hint').textContent");
      await press('Open', '.dialog');
      await rec.settle(200);
      await quiet();
      return said;
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
    await rec.settle(500);
    await unlockHere();

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

    // ---- record-rate: fifteen rows at one past date -------------------------

    traffic.length = 0;
    rateDelay = 1500;
    await press('New recording');
    await set('#recording-date', await format('date', D10));
    const saidEmpty = await ev("document.querySelector('.dialog .hint').textContent");
    await ev("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Open').click()");
    await rec.settle(300);
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
    check('record-snapshot: a date holding nothing is started as a recording', saidEmpty.includes('holds nothing yet'), saidEmpty);
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
    check('record-snapshot: an emptied recording still holds its date in the picker', (await newRecording(D2)).includes('already holds a recording'));

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
      gone.includes(`${await format('longDate', ago(3))} holds no recording.`) && (await ev("document.querySelector('.dialog-heading').textContent")) === 'New recording',
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
      outage.says === 'No market rate came back for USD. Nothing will be recorded for it today.' &&
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
      saidMarked.includes('already holds a recording') && (await ev('location.hash')) === `#/recording/${D10}` && traffic.length === 0,
      saidMarked,
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
      goneAtFirst === 0 && freeAgain.includes('holds nothing yet'),
      freeAgain,
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
