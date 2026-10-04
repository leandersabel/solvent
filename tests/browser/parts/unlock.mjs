// Signing in and out, and the card that asks (spec/ui/unlock.md): the one
// card for both kinds of account, what it shows while it works and when
// it refuses, the sitting that survives a sign-in, a vault that cannot
// be read, a session that ends mid-action, and the upgrade of an old
// key-derivation envelope on sign-in.
// Templates: dashboard.html, shell/. Modules: unlock.js, session.js,
// api.js, crypto.js, kdf-worker.js, app.js.
import {
  ADMIN_PASSWORD, BASE, HANDS, VAULT_PASSWORD, administrator, afterRead, backFromAway, check, chromeState, click,
  credentialOf, enterPassword, enterPasswordOn, expectedFailures, hasChrome, holdRecords, intercept, intoVault,
  makeStale, markDocument, noChrome, occurring, openBrowser, page, recordsOf, run, setValue, signInOn, sitting, sql, story,
  text, unlockDashboard, unlockInPlace, vaultOwner, watched, within, WEAK_MEMORY,
} from '../harness.mjs';

await run(async () => {
  await administrator();
  await vaultOwner();
  await story();

  // ---- Locking ------------------------------------------------------------

  await page.goto(`${BASE}/dashboard`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('svg.trend')", { timeout: 90000, label: 'the unlocked dashboard' });
  await page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Lock').click()");
  await page.holds("document.querySelector('#unlock-password')");
  check('locking shows the unlock card again', (await text()).includes('Solvent cannot recover a lost password'));
  check('locking leaves no decrypted figure on screen', !(await text()).includes('12 450'));
  const sessionAlive = await page.eval(`(async () => {
    const response = await fetch('/api/sessions', { headers: ${HANDS} });
    return response.status;
  })()`);
  check('the server session survives the lock', sessionAlive === 200, String(sessionAlive));
  check('no key material reaches storage', await page.eval(`(() => {
    const blob = JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
    return blob === '{}{}' || (!blob.includes('Dek') && !blob.includes('authKey') && !blob.includes('key'));
  })()`));

  await unlockDashboard('the dashboard after the lock');

  // ---- Login: a session that runs out mid-action ------------------------

  // Typing into an open form when the server session is gone: the save
  // answers Unauthorized, the card asks only for the password, and the
  // form comes back as it was.
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.data-table tbody .link-button')", { label: 'the dashboard before the session ends' });
  await page.eval("document.querySelector('.data-table tbody .link-button').click()");
  await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.detail-header')", { label: 'a holding to edit' });
  await click('Edit');
  await page.waitUntil("document.querySelector('#holding-name')", { label: 'the editor before the session ends' });
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
  const signedInAgain = await page.eval(`(async () => (await fetch('/api/sessions', { headers: ${HANDS} })).status)()`);
  check(
    'signing in again returns to the form with what was typed, on a new session',
    resumed.hash === editing && resumed.note === 'typed as the session ran out' && signedInAgain === 200,
    JSON.stringify({ ...resumed, signedInAgain }),
  );
  await page.eval("location.hash = '#/'");

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
    await sat.holds("document.querySelector('.hero-figure')");
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
      JSON.parse(await sat.eval(`(async () => fetch('/api/sessions', { headers: ${HANDS} }))()
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
      await sat.idle();
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
    await sat.idle();
    check(
      'Update values while locked leaves the address and the card as they were',
      (await sat.eval('location.href')) === lockedAddress && (await sat.eval("Boolean(document.querySelector('#unlock-password'))")),
      await sat.eval('location.href'),
    );
    await signInOn(sat, VAULT_PASSWORD);
    check('unlocking after the lock returns to the vault', await intoVault(sat, 'the vault after unlocking'));
    await sat.frames();
    const unlockedChrome = await chromeState(sat);
    check(
      'after unlocking again the top bar, its two links and its two controls are back, and the outside wordmark is gone',
      hasChrome(unlockedChrome),
      JSON.stringify({ ...unlockedChrome, text: undefined }),
    );

    // Back, after leaving the page while unlocked: the keys went with
    // the page, and nothing from the vault is shown.
    const back = await backFromAway(sat);
    const shownAfterAway = back ? occurring(heldNames, (name) => back.text.includes(name)) : 0;
    check(
      'Back after signing in at the sign-in address and leaving shows the unlock card and no vault data',
      Boolean(back) && !back.keys && heldNames.length > 0 && shownAfterAway === 0,
      back ? `${shownAfterAway} names shown` : 'no unlock card',
    );

    // A refresh asks for the password again.
    await signInOn(sat, VAULT_PASSWORD);
    await intoVault(sat, 'the vault before the refresh');
    const reloaded = sat.waitFor('Page.loadEventFired');
    await sat.send('Page.reload');
    await reloaded;
    await sat.holds("document.querySelector('#unlock-password')");
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

  // login.md, Rules: a vault that could not be read is not unlocked.
  // The keys the sign-in derived are dropped with the error, and a
  // page left afterwards holds none.
  const unreadBrowser = await openBrowser(`${BASE}/login`);
  const unread = unreadBrowser.session;
  try {
    const releaseUnread = await intercept(unread, '*/api/records?type=*', () => ({ status: 503 }));
    await signInOn(unread, VAULT_PASSWORD, 'leander');
    await unread.waitUntil("!document.querySelector('.field-error').hidden", { timeout: 90000, label: 'the error for a vault that would not open' });
    await unread.frames();
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
    await within(held.reached, 60000);
    await pagehide(racing);
    held.release();
    await racing.idle();
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
    await within(heldUnlock.reached, 60000);
    await pagehide(racing);
    heldUnlock.release();
    await racing.idle();
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
      card.call(async (name, secret) => {
        const set = (selector, value) => {
          const node = document.querySelector(selector);
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('#unlock-username', name);
        set('#unlock-password', secret);
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
      }, username, password).then(JSON.parse);

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
      await broken.frames();
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
    await broken.holds('window.__derivations === 2');
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
  let releaseUpgrade;
  await makeStale(page, 'leander', VAULT_PASSWORD);
  const staleOwner = credentialOf('leander');
  const staleRecords = recordsOf(staleOwner.principal);
  const beforeUpgrade = await vaultNames();

  expectedFailures.add('/api/auth/upgrade-kdf');
  releaseUpgrade = await intercept(page, '*/api/auth/upgrade-kdf', () => ({ status: 500 }));
  await signInAgain('the vault with its upgrade failing');
  const keptIn = await page.eval(`(async () => (await fetch('/api/sessions', { headers: ${HANDS} })).status)()`);
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
      await admin.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", { timeout: 90000, label });
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
  } finally {
    adminBrowser.close();
  }

  // ---- Login: someone else at the card ------------------------------------

  await page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Lock').click()");
  await page.waitUntil("document.querySelector('.known-username a')", { label: 'the card after locking' });
  await page.eval("document.querySelector('.known-username a').click()");
  await page.waitUntil("location.pathname === '/login'", { label: 'the sign-in address after Not you' });
  await page.holds("document.querySelector('#unlock-username')");
  expectedFailures.add('/api/sessions');
  check(
    'Not you? Sign out ends the session and offers the full card',
    (await page.eval("Boolean(document.querySelector('#unlock-username'))")) &&
      (await page.eval(`(async () => (await fetch('/api/sessions', { headers: ${HANDS} })).status)()`)) === 401,
  );

});
