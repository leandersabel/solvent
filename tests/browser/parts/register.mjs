// Registration (spec/ui/register.md): the administrator form, the vault
// owner form and what each leaves behind, and the invite staying out of
// every request.
// Templates: register.html. Modules: page-register.js, register-form.js,
// username.js, strength.js, crypto.js, kdf-worker.js, session.js.
import {
  ADMIN_PASSWORD, BASE, BOOTSTRAP, CLOCK, MINUTE, REGISTRANT_PASSWORD, VAULT_PASSWORD, afterRead, check, chromeState,
  enterPassword, holdRecords, intercept, intoVault, markDocument, mintInvite, noChrome, openBrowser, page, run,
  setValue, sitting, submit, text, watched, within,
} from '../harness.mjs';

await run(async () => {
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
  check('the button unlocks once the bar is met', await page.holds("!document.querySelector('button[type=submit]').disabled"));
  await submit();
  await page.waitUntil("location.pathname === '/admin'", { timeout: 90000, label: 'the admin area' });
  await page.waitUntil("document.querySelector('#app .section-switcher')", { label: 'the admin area to render' });

  check('an administrator lands in the admin area', (await page.eval('location.pathname')) === '/admin');
  // ---- The vault owner --------------------------------------------

  const vaultInvite = mintInvite('vault-owner');
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
  await page.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
  await markDocument(page, 'registration');
  await submit();
  const registered = await intoVault(page, 'the vault after registering');
  await page.holds("document.body.innerText.includes('Add your first holding')");

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
  // ---- Registration: the invite stays out of every request, and a failed first read ----

  // admin-invites.md, Rules: /register carries Referrer-Policy:
  // no-referrer, because the token rides in its URL and a subresource
  // requested from that page would otherwise name it in a Referer.
  // register.md: a vault owner lands logged in with keys already in
  // memory, and never has to type the password they just chose, not
  // even when the first read of the new vault fails.
  const buttonUnlocked = (session) =>
    session.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
  const registrantBrowser = await openBrowser();
  const registrant = registrantBrowser.session;
  try {
    const registrantInvite = mintInvite('vault-owner');
    const traffic = watched[watched.length - 1].requests;
    await registrant.goto(`${BASE}/register?invite=${registrantInvite}`);
    const fillRegistration = (name = 'registrant') =>
      registrant.call((username, password) => {
        const set = (selector, value, index = 0) => {
          const node = document.querySelectorAll(selector)[index];
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('input[type=text]', username);
        set('input[type=password]', password, 0);
        set('input[type=password]', password, 1);
        set('select', 'CHF');
        const box = document.querySelector('input[type=checkbox]');
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }, name, REGISTRANT_PASSWORD);
    await fillRegistration();
    await buttonUnlocked(registrant);
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
    await registrant.frames();
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
      await buttonUnlocked(registrant);
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
    await registrant.call((ms) => window.testClock.advance(ms), 16 * MINUTE);
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
    await within(heldRetry.reached, 60000);
    check(
      'Try again is disabled while it reads again',
      await registrant.eval("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Try again').disabled"),
    );
    await registrant.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    heldRetry.release();
    await registrant.idle();
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
    await buttonUnlocked(registrant);
    await markDocument(registrant, 'registrant.firstfail');
    const heldFirst = await holdRecords(registrant, { status: 503 });
    await registrant.eval("document.querySelector('button[type=submit]').click()");
    await within(heldFirst.reached, 60000);
    await registrant.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    heldFirst.release();
    await registrant.idle();
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
    await within(heldAgain.reached, 60000);
    await registrant.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    heldAgain.release();
    await registrant.idle();
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
    await registrant.idle();
    const reopened = await lockedAndFailed(await afterRead(registrant));
    check('a retry left over from the failure card opens nothing after a lock', lockWon(reopened), JSON.stringify(reopened));
  } finally {
    registrantBrowser.close();
  }
});
