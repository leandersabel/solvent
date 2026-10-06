// The idle lock (spec/features/login.md, Unlock): the vault locks itself
// after its idle period, whatever is open, and what a person had typed is
// the one thing a lock keeps.
// Templates: dashboard.html, shell/. Modules: session.js, unlock.js,
// view-settings.js, app.js, dom.js.
import {
  BASE, CLOCK, MINUTE, VAULT_PASSWORD, check, click, enterPassword, occurring, page, plant, reachable, run, Session,
  launch, setValue, signInOn, sql, story, text, unlockDashboard, unlockInPlace, vaultOwner,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await story();

  // ---- The idle lock ----------------------------------------------------

  // Every document from here on carries the movable clock. Real input
  // through the protocol is the activity, so the reset is the one a
  // person's keystroke triggers.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
  const advance = (ms) => page.call((milliseconds) => window.testClock.advance(milliseconds), ms);
  // The two settings cards the checks work on, each found once. `onCard`
  // runs `act` on one in the page, where the finder's source travels with
  // it and the values reach `act` as arguments.
  const idleSelect = () => [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Session and lock')).querySelector('select');
  const passwordCard = () => [...document.querySelectorAll('.card')].find(c => c.querySelector('input[autocomplete=new-password]'));
  const onCard = (find, act, ...args) => page.call(`(...args) => (${act})((${find})(), ...args)`, ...args);
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
  const probes = JSON.parse(await page.eval(`(async () => {
    const v = (await import('/static/js/session.js')).currentVault();
    const names = [...v.holdings.values()].map(h => h.payload.name);
    const values = [...v.snapshots.values()].flat().map(s => s.payload.value).filter(x => x.length >= 7);
    return JSON.stringify([...new Set([...names, ...values])]);
  })()`));
  const seen = await reachable(probes);
  check(
    'the heap probe finds the decrypted vault while unlocked',
    seen === probes.length,
    `${probes.length - seen} of ${probes.length} not found`,
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
  const onScreen = occurring([...probes, heroFigure], (probe) => screen.includes(probe));
  check(
    'the idle lock leaves no decrypted name or figure on screen',
    onScreen === 0,
    `${onScreen} on screen`,
  );
  check(
    'the idle lock drops the in-memory vault',
    await page.eval("(async () => (await import('/static/js/session.js')).currentVault() === null)()"),
  );
  const left = await reachable(probes);
  check('nothing decrypted is reachable after the idle lock', left === 0, `${left} reachable`);

  const reads = () => page.eval("performance.getEntriesByType('resource').filter(e => e.name.includes('/api/records?type=')).length");
  const readsBefore = await reads();
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the dashboard after the idle lock' });
  check('unlocking after the idle lock re-reads every record type', (await reads()) - readsBefore === 4, `${(await reads()) - readsBefore} reads`);

  // A period chosen on the settings screen.
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil(idleSelect, { label: 'the session card' });
  await page.idle();
  // The keystroke that chose it is the last activity there is, so the
  // new period has to count from the save rather than wait for more.
  await activity();
  await onCard(idleSelect, (select) => {
    select.value = '5';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.idle();
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
  await page.idle();
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
    await second.frames();
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
    await page.idle();
    const shown = await onCard(idleSelect, (select) => select.value);
    const clamped = await lockPeriod(minutes);
    check(
      `a stored idle lock of ${stored} locks at ${minutes} minutes and the select shows ${minutes}`,
      !clamped.early && clamped.late && shown === String(minutes),
      JSON.stringify({ ...clamped, shown }),
    );
  }

  // An open form with typed input, which is the one thing a lock keeps.
  const idleLock = async () => {
    await activity();
    await advance(60 * MINUTE);
    await page.holds("document.querySelector('#unlock-password')", { timeout: 10000 });
  };
  await unlockDashboard('the dashboard before typing');
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: 'a holding to type into' });
  const typedAt = await page.eval('location.hash');
  const typedFor = await page.eval("document.querySelector('.screen-heading').textContent");
  await click('Record a value');
  await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
  await page.idle();
  await setValue('#snapshot-value', '777.12');
  await idleLock();
  check('an open form is idle-locked too', await locked());
  check('the lock closes the open form', !(await page.eval("Boolean(document.querySelector('.dialog'))")));
  const withForm = await text();
  const onScreenWithForm = occurring(probes, (probe) => withForm.includes(probe));
  check(
    'an open form leaves no decrypted name or figure on screen after the idle lock',
    onScreenWithForm === 0,
    `${onScreenWithForm} on screen`,
  );
  const leftWithForm = await reachable(probes);
  check('an open form keeps nothing decrypted reachable after the idle lock', leftWithForm === 0, `${leftWithForm} reachable`);
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
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the form to close' });

  // A prefilled field left alone is vault content, not typing.
  await click('Edit');
  await page.waitUntil("document.querySelector('#holding-name')", { label: 'the holding editor' });
  await page.idle();
  await page.eval("document.querySelectorAll('#app details').forEach(d => (d.open = true))");
  await setValue('#app textarea', 'typed before the lock');
  await idleLock();
  const leftWithEditor = await reachable(probes);
  check(
    'a prefilled field left alone keeps nothing decrypted reachable across the lock',
    leftWithEditor === 0,
    `${leftWithEditor} reachable`,
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
  await page.waitUntil("document.querySelector('.sweep-row input')", { label: 'the sweep rows' });
  await page.idle();
  const typeRow = (index, value) =>
    page.call((at, next) => {
      const field = document.querySelectorAll('.sweep-row input')[at];
      field.value = next;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, index, value);
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
  await page.idle();
  // Made up inside the page, so no script source the test sent carries
  // them and the heap search below finds only what the page kept.
  const typedValues = JSON.parse(await onCard(passwordCard, (card) => {
    const fields = card.querySelectorAll('.password-field input');
    const type = (field) => {
      field.value = 'pw-' + crypto.randomUUID();
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return field.value;
    };
    const typed = [type(fields[0])];
    fields[1].closest('.password-field').querySelector('button').click();
    typed.push(type(fields[1]));
    return JSON.stringify(typed);
  }));
  const shownType = await onCard(passwordCard, (card) => card.querySelectorAll('.password-field input')[1].type);
  await idleLock();
  // Only counts leave these checks, so a failure never prints a password.
  const kept = await reachable(typedValues);
  check(
    'no password typed into settings is kept across the lock, shown or not',
    shownType === 'text' && kept === 0,
    `${kept} kept, the second field was ${shownType}`,
  );
  await unlockInPlace('the vault after unlocking over the password card');
  const filled = await onCard(passwordCard, (card) => [...card.querySelectorAll('.password-field input')].filter(f => f.value !== '').length);
  check('no password field is refilled after unlocking', filled === 0, `${filled} filled`);
  check('no password field is refilled after unlocking', filled === 0, `${filled} filled`);
});
