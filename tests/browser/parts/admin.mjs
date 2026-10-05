// The administration area (spec/features/admin-invites.md, Admin): its
// four sections, the dialog over it, and the only way out of it.
// Templates: admin.html. Modules: page-admin.js, dom.js, shell.js.
import {
  ADMIN_PASSWORD, BASE, CLOCK, MINUTE, SECOND_PASSWORD, administrator, check, click, confirmLook, labels, looksDisabled,
  intoVault, looksEnabledRed, mintInvite, openBrowser, register, setValue, signInOn, text, page, run, VAULT_PASSWORD,
  watched,
} from '../harness.mjs';

await run(async () => {
  await administrator();

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

  await page.waitUntil("document.querySelector('input[type=text]')", { label: 'the invite form' });
  await page.waitUntil("document.querySelector('#app .empty-line, #app table.data-table')", { label: 'the outstanding invites' });
  check(
    'the outstanding invites sit in a card of their own, opening on their heading',
    await page.eval(`(() => {
      const card = document.querySelector('#app .empty-line, #app table.data-table').closest('.card');
      return !!card && card !== document.querySelector('input[type=text]').closest('.card')
        && card.firstElementChild.matches('h2.section-heading');
    })()`),
  );
  await setValue('input[type=text]', 'Sprint test');
  await click('Create invite link');
  await page.waitUntil("document.body.innerText.includes('Copy this now')", { label: 'the one-time link' });
  const inviteUrl = await page.eval("document.querySelector('input[readonly]').value");
  check('the invite link is shown once', inviteUrl.includes('/register?invite='));

  // A user account, so the list holds a count beside the No vault.
  const { session: owner, close: closeOwner } = await openBrowser();
  await register(owner, mintInvite('vault-owner'), 'leander', VAULT_PASSWORD);
  await intoVault(owner, 'the user account');
  closeOwner();
  await click('Accounts');
  await page.waitUntil("document.body.innerText.includes('ops.leander') && [...document.querySelectorAll('td')].some((td) => td.textContent === 'leander')", {
    label: 'the account list',
  });
  check('an administrator row reads No vault, never a zero', (await text()).includes('No vault'));
  const itemsInk = JSON.parse(await page.eval(`JSON.stringify((() => {
    const row = (name) => [...document.querySelectorAll('tr')].find((r) => r.cells[0]?.textContent === name);
    const ink = (name) => [...row(name).cells].map((td) => getComputedStyle(td).color);
    const items = [...document.querySelectorAll('th')].findIndex((th) => th.textContent === 'Items');
    return { owner: ink('leander'), admin: ink('ops.leander'), items };
  })())`));
  check(
    "a user account's Items count is as dark as its username, and only No vault is ink-muted",
    itemsInk.owner[itemsInk.items] === itemsInk.owner[0] && itemsInk.admin[itemsInk.items] !== itemsInk.admin[0],
    JSON.stringify(itemsInk),
  );
  check(
    'the only administrator has no Remove control',
    (await text()).includes('The only administrator'),
  );

  // A second administrator, so the first has an account to remove.
  const { session: second, close: closeSecond } = await openBrowser();
  await register(second, mintInvite('administrator'), 'ops.second', SECOND_PASSWORD);
  await second.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
    timeout: 90000,
    label: 'the second administrator',
  });
  closeSecond();
  await click('Invites');
  await click('Accounts');
  await page.waitUntil("document.body.innerText.includes('ops.second')", { label: 'the second administrator in the list' });
  await page.eval(`[...document.querySelectorAll('tr')].find((r) => r.textContent.includes('ops.second')).querySelector('button').click()`);
  await page.waitUntil("document.querySelector('.dialog input')", { label: 'the removal dialog' });
  const removeDisabled = await confirmLook('Remove account');
  await setValue('.dialog input', 'ops.second');
  const removeEnabled = await confirmLook('Remove account');
  check(
    'a disabled Remove account is petrol-200 with an ink-secondary label at full opacity, a default cursor and no red, and turns red once the username matches',
    looksDisabled(removeDisabled) && looksEnabledRed(removeEnabled),
    JSON.stringify({ removeDisabled, removeEnabled }),
  );
  await click('Cancel');
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

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
  check(
    "the password card's error sits above the current password field",
    await page.eval(`(() => {
      const card = document.querySelector('input[autocomplete=current-password]').closest('.card');
      const first = card.querySelector('input[autocomplete=current-password]');
      return Boolean(card.querySelector('.field-error').compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
    })()`),
  );

  // ---- A dialog over the area --------------------------------------

  // app-shell.md, The bar above a dialog: an administrator's dialog is
  // the opposite case. Nothing is decrypted on this surface, so the
  // scrim covers the viewport from its top and the bar is inert.
  const adminDialogOpen = async () => {
    await page.eval(`(async () => {
      const { dialog, el } = await import('/static/js/dom.js');
      dialog({ heading: 'Probe', body: [el('p', { text: 'Probe' })], actions: [el('button', { type: 'button', text: 'Close' })] });
    })()`);
    return JSON.parse(await page.eval(`JSON.stringify({
      scrimTop: document.querySelector('.scrim').getBoundingClientRect().top,
      topLeft: document.elementFromPoint(4, 4).classList.contains('scrim'),
      barInert: document.querySelector('.topbar').inert,
      mainInert: document.querySelector('main').inert,
      locks: document.querySelectorAll('.btn-lock').length,
      height: document.documentElement.style.getPropertyValue('--chrome-height'),
      modal: document.querySelectorAll('[aria-modal]').length,
    })`));
  };
  const adminOpen = await adminDialogOpen();
  await page.key('Escape');
  await page.holds("!document.querySelector('.scrim')");
  check(
    "an administrator's dialog covers the viewport from its top with the bar inert, and there is no Lock",
    adminOpen.scrimTop === 0 && adminOpen.topLeft && adminOpen.barInert && adminOpen.mainInert &&
      adminOpen.locks === 0 && adminOpen.height === '' && adminOpen.modal === 0 &&
      !(await page.eval("Boolean(document.querySelector('.scrim'))")) &&
      !(await page.eval("document.querySelector('.topbar').inert || document.querySelector('main').inert")),
    JSON.stringify(adminOpen),
  );


  // ---- Signing out, and an area that never idles --------------------

  const { session: admin } = await openBrowser(`${BASE}/login`);
  const adminSignIn = async (label) => {
    await admin.eval("fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' }, body: '{}' })");
    await admin.goto(`${BASE}/login`);
    await signInOn(admin, ADMIN_PASSWORD, 'ops.leander');
    await admin.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", { timeout: 90000, label });
  };
  await adminSignIn('the admin area');

  // No idle rule for an administrator: an hour and more of nothing
  // leaves the admin area as it was.
  await admin.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
  await admin.goto(`${BASE}/admin`);
  await admin.waitUntil("document.querySelector('#app .section-switcher')", { label: 'the admin area to render' });
  await admin.call((ms) => window.testClock.advance(ms), 61 * MINUTE);
  await admin.frames();
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
});
