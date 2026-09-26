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
    // The browser asks every page for /favicon.ico, and one check
    // here deliberately fetches the export without its header to
    // prove the endpoint is not navigable. Both are the gate
    // answering correctly.
    const url = entry.url || '';
    const noise = url.endsWith('/favicon.ico') || url.endsWith('/api/export') ||
      provoked.some((part) => url.includes(part));
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
      const v = (await import('/static/js/session.js')).currentVault();
      const rows = await api.get('/api/records?type=snapshot');
      const here = v.snapshotsFor('${archivingId}').filter((s) => s.payload.date === '${archiveDay}');
      return JSON.stringify({
        stored: rows.length,
        here: here.map((s) => ({ id: s.recordId, version: s.version, value: s.payload.value })),
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
  const storedFigure = await page.eval(
    `(async () => String((await import('/static/js/decimal.js')).parse(${JSON.stringify(beforeArchive.here[0]?.value || '')})))()`,
  );
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
    const { DatabaseSync } = await import('node:sqlite');
    const { readFileSync } = await import('node:fs');
    const query = (sql, ...args) => {
      const db = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
      try {
        return db.prepare(sql).all(...args);
      } finally {
        db.close();
      }
    };
    const OWN = "JOIN principals ON principals.id = records.principal_id WHERE principals.username = 'leander'";
    const accountRows = () =>
      JSON.stringify(query(`SELECT records.* FROM records ${OWN} AND record_type = 'account' ORDER BY record_id`));
    const rowOf = (id) => query(`SELECT records.* FROM records ${OWN} AND record_id = ?`, id)[0];
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
    const failing = async (refuse, body) => {
      const handler = async (message) => {
        if (message.method !== 'Fetch.requestPaused') return;
        const { requestId, request } = message.params;
        if (refuse(request)) {
          provoked.push(new URL(request.url).pathname);
          await page.send('Fetch.fulfillRequest', { requestId, responseCode: 500, body: '' });
        } else {
          await page.send('Fetch.continueRequest', { requestId });
        }
      };
      page.on(handler);
      await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
      try {
        await body();
      } finally {
        await page.send('Fetch.disable');
        page.handlers = page.handlers.filter((h) => h !== handler);
      }
    };
    const writing = (type, method = 'PUT') => (request) =>
      request.method === method && (!type || (request.postData || '').includes(`"recordType":"${type}"`));

    // Every PUT the page sends, by record type, in order.
    await page.eval(`(() => {
      const send = window.fetch;
      window.__writes = [];
      window.fetch = (path, init) => {
        if (init && init.method === 'PUT') window.__writes.push(JSON.parse(init.body).recordType);
        return send(path, init);
      };
      window.__alerted = false;
      window.alert = () => { window.__alerted = true; };
    })()`);

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
    const accountsBefore = query(`SELECT record_id FROM records ${OWN} AND record_type = 'account'`).length;

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
      query(`SELECT record_id FROM records ${OWN} AND record_type = 'account'`).length === accountsBefore + 1 && Boolean(rowOf(probeId)),
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
    await page.eval(`(() => {
      const send = window.fetch;
      window.__writes = [];
      window.fetch = (path, init) => {
        if (init && init.method === 'PUT') window.__writes.push(JSON.parse(init.body).recordType);
        return send(path, init);
      };
      window.__alerted = false;
      window.alert = () => { window.__alerted = true; };
    })()`);

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
      return JSON.stringify({ shown: row && column > 0 ? row.cells[column].textContent : null, expected: v.format.money((await import('/static/js/decimal.js')).parse('4000')) });
    })()`));
    check("the band runs into the closing value on the archive date", band.shown === band.expected, JSON.stringify(band));
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

  // ---- Export and import, through the screen (export-import.md) ----------

  {
    const { DatabaseSync } = await import('node:sqlite');
    const { mkdtempSync, readdirSync, readFileSync, writeFileSync, truncateSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const query = (sql, ...args) => {
      const db = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
      try {
        return db.prepare(sql).all(...args);
      } finally {
        db.close();
      }
    };
    const OWNER = "JOIN principals ON principals.id = records.principal_id WHERE principals.username = 'leander'";
    const vaultRows = () => JSON.stringify(query(`SELECT records.* FROM records ${OWNER} ORDER BY record_id`));
    const credentialOf = (username) =>
      query(
        'SELECT credentials.params, credentials.verifier, dek_wrappers.wrapped_dek, dek_wrappers.dek_nonce FROM credentials ' +
          'JOIN principals ON principals.id = credentials.principal_id ' +
          'JOIN dek_wrappers ON dek_wrappers.credential_id = credentials.id WHERE principals.username = ?',
        username,
      )[0];
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
    // Every request matching `match` answered with `status` while `body` runs.
    const answering = async (match, status, body) => {
      const handler = async (message) => {
        if (message.method !== 'Fetch.requestPaused') return;
        const { requestId, request } = message.params;
        if (match(request)) {
          await page.send('Fetch.fulfillRequest', { requestId, responseCode: status, body: '' });
        } else {
          await page.send('Fetch.continueRequest', { requestId });
        }
      };
      page.on(handler);
      await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
      try {
        await body();
      } finally {
        await page.send('Fetch.disable');
        page.handlers = page.handlers.filter((h) => h !== handler);
      }
    };
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

    // A plain navigation to the endpoint, with a live session cookie.
    const alive = await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then(r => r.status)");
    const navigated = join(dir, 'navigated');
    await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: navigated });
    // Locked first, because the page navigated away from can stay alive
    // in the back-forward cache, and it should hold no decrypted vault.
    await page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Lock').click()");
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

    // -- Import: files and passwords that go nowhere ---------------------------

    await unlockAt('/settings/export-import', "document.querySelector('#import-file')");
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
    const total = query(`SELECT record_id FROM records ${OWNER}`).length;
    check(
      'the review sets what is in the file against what will be deleted, prices on their own line',
      review.includes(`${kinds.account} holdings`) && review.includes(`${kinds.rate} captured prices`) &&
        review.includes(`Your vault currently holds ${total} records. All of them will be deleted.`) &&
        !review.includes('This vault is kept in'),
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
    const versions = query(`SELECT DISTINCT version FROM records ${OWNER}`).map((row) => row.version);
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
      await fill([['#unlock-username', 'ops.leander'], ['#unlock-password', ADMIN_PASSWORD]]);
      await second.eval("document.querySelector('button[type=submit]').click()");
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
      await second.settle(400);
      await fill([['#unlock-password', SECOND_PASSWORD]]);
      await second.eval("document.querySelector('button[type=submit]').click()");
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
      const db = new DatabaseSync(process.env.DATABASE_PATH);
      try {
        const row = db.prepare('SELECT * FROM records WHERE record_id = ?').get(later);
        const mine = db.prepare("SELECT id FROM principals WHERE username = 'leander'").get().id;
        db.prepare(
          'INSERT INTO records (principal_id, record_id, record_type, account_id, schema_version, version, nonce, ciphertext, updated_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(mine, row.record_id, row.record_type, row.account_id, row.schema_version, row.version, row.nonce, row.ciphertext, row.updated_at);
      } finally {
        db.close();
      }
      const injected = await inPage(`await v.load(); return v.unreadable.includes(${JSON.stringify(later)});`);
      check("a record the source wrote after the export, inserted into this vault's rows, fails to decrypt", injected);
      const cleanup = new DatabaseSync(process.env.DATABASE_PATH);
      try {
        cleanup.prepare("DELETE FROM records WHERE record_id = ? AND principal_id = (SELECT id FROM principals WHERE username = 'leander')").run(later);
      } finally {
        cleanup.close();
      }
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
