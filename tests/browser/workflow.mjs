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
  const rateUnits = await labels('.rate-unit');
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

  await click('Done');
  await page.settle(900);

  // ---- The dashboard -------------------------------------------------

  const hero = await page.eval("document.querySelector('.hero-figure').textContent");
  check('the hero carries a total in the main currency', hero.includes('CHF'), hero);
  check('gross assets and liabilities are both shown', (await text()).includes('Liabilities'));
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
  await setValue('#snapshot-date', BACKDATE);
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

  await page.goto(`${BASE}/settings`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 90000, label: 'settings' });
  await page.settle(700);
  check('the main currency is shown and fixed', (await text()).includes('Fixed when you created your vault'));
  check('the change-password card explains the speed', (await text()).includes('Your data is not re-encrypted'));
  check('it warns that old export files still open', (await text()).includes('still open with your old password'));
  check('the absence of IP records is volunteered', (await text()).includes('Solvent records no IP addresses'));
  check('the session list marks this one', (await text()).includes('This one'));
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

  await page.goto(`${BASE}/settings/dimensions`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.body.innerText.includes('Dimensions are how')", {
    timeout: 90000,
    label: 'the dimensions empty state',
  });
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

  await click('Done');
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

  await page.goto(`${BASE}/settings`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 90000, label: 'settings again' });
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

  const imported = JSON.parse(await page.eval(`(async () => {
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
      versions: [...new Set(file.records.map(() => 1))],
      rekeyed: fileRaw !== newRaw,
      kinds: [...new Set(file.records.map(r => r.recordType))].sort(),
    });
  })()`));

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
