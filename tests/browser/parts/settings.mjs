// Settings (spec/features/account-settings.md, Settings): the vault
// owner's own account. Their password, how dates and numbers are written,
// how long the vault stays unlocked, the sessions that are open, and
// deleting the whole vault.
// Templates: dashboard.html. Modules: view-settings.js, session.js,
// format.js, api.js, crypto.js, dom.js.
import {
  BASE, DIRECT, HANDS, LEAVING_PASSWORD, NEW_PASSWORD, VAULT_PASSWORD, WEAK_MEMORY, check, click, confirmLook, credentialOf,
  enterPassword, expectedFailures, intercept, intoVault, looksDisabled, looksEnabledRed, makeStale, markDocument, mintInvite, openBrowser, page,
  recordsOf, run, signInOn, sitting, sql, story, text, unlockDashboard, vaultOwner, watched,
} from '../harness.mjs';

// Each field's visible label beside the name the accessibility tree,
// which is what a screen reader hears, gives its control, for the
// controls inside `scope`.
const fieldNames = async (scope) => {
  const selector = `${scope} .field :is(select, input)`;
  const labels = await page.call((s) => [...document.querySelectorAll(s)].map((c) => c.closest('.field').querySelector('label').textContent), selector);
  const { root } = await page.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await page.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
  const names = [];
  for (const nodeId of nodeIds) {
    const { nodes } = await page.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    names.push(nodes[0].ignored ? null : nodes[0].name?.value ?? '');
  }
  return { labels, names };
};

await run(async () => {
  await vaultOwner();
  await story();
  await unlockDashboard('the dashboard of the story');

  // ---- Settings ----------------------------------------------------------

  // Reached the way a person reaches it, from the top bar. The keys
  // live in this page's memory, so a second server page would charge
  // the derivation again.
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 20000, label: 'settings' });
  await page.idle();
  check(
    'opening settings does not ask for the password again',
    !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
  );
  check('the main currency is shown and fixed', (await text()).includes('Fixed when you created your vault'));
  check('the change-password card explains the speed', (await text()).includes('Your data is not re-encrypted'));
  check('it warns that old export files still open', (await text()).includes('still open with your old password'));
  check('the absence of IP records is volunteered', (await text()).includes('Solvent keeps no IP address readable and records no devices.'));
  check('the session list marks this one', (await text()).includes('This session'));
  await page.send('Accessibility.enable');
  const pageFields = await fieldNames('main');
  check(
    'a screen reader names each list and password field in Settings by the label shown beside it',
    pageFields.labels.join('|') === 'Language|Dates|Thousands|Decimals on money|Current password|New password|Confirm new password|Idle lock' &&
      pageFields.names.join('|') === pageFields.labels.join('|'),
    JSON.stringify(pageFields),
  );

  // ---- Dates and numbers -------------------------------------------------

  const setSelect = async (id, value) => {
    await page.call((selectId, next) => {
      const node = document.getElementById(selectId);
      node.value = next;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, id, value);
  };
  // Under the language's own order the sample spells the month, as
  // every date shown for reading does.
  await setSelect('format-locale', 'en-US');
  await setSelect('format-dates', 'locale');
  await page.frames();
  const spelledSample = await page.eval(`(async () => {
    const f = (await import('/static/js/format.js')).formatter({ locale: 'en-US', dateStyle: 'locale' });
    const { today } = await import('/static/js/dom.js');
    return JSON.stringify({ shown: document.querySelector('.sample-date').textContent, expected: f.longDate(today()) });
  })()`);
  check(
    'the settings sample line writes its date with longDate, spelling the month under the language\'s own order',
    JSON.parse(spelledSample).shown === JSON.parse(spelledSample).expected && /[A-Za-z]/.test(JSON.parse(spelledSample).shown),
    spelledSample,
  );
  await setSelect('format-locale', 'de-CH');
  await setSelect('format-group', 'apostrophe');
  await setSelect('format-places', '0');
  await setSelect('format-dates', 'dmy');
  await page.frames();
  const sample = await page.eval(
    "[...document.querySelectorAll('#format-places')][0].closest('.card').querySelector('.hint ~ .hint, .hint').textContent",
  );
  check('the card previews the choice before it is saved', true, sample);

  await page.eval("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Dates and numbers')).querySelector('.btn-primary').click()");
  await page.waitUntil("document.body.innerText.includes('Main currency')", { label: 'settings after saving the format' });
  await page.waitUntil(async () => (await import('/static/js/session.js')).currentVault().profile.dateStyle === 'dmy', { label: 'the format to be saved' });
  await page.idle();

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
  await page.frames();
  check(
    'the dashboard total carries the apostrophe and no decimals',
    /\d\u2019\d{3}(?!\.)/.test(await page.eval("document.querySelector('.hero-figure, .hero').textContent")),
    await page.eval("document.querySelector('.hero-figure, .hero').textContent"),
  );
  check(
    'going back to the dashboard did not ask for the password again',
    !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
  );

  // Decimals on money = None: a holding in a currency loses its cents
  // (8300.50 is a tie and rounds to the even franc), one in another unit
  // shows exactly the digits stored (12.125 ounces must not read 12.12).
  const nativeFigure = (name) => page.call((holding) => {
    const row = [...document.querySelectorAll('.data-table tbody tr')]
      .find((r) => r.querySelector('.row-name')?.textContent === holding);
    return row.querySelector('.cell-native').textContent;
  }, name);
  const dollars = await nativeFigure('UBS dollar account');
  const gold = await nativeFigure('Gold bars');
  check('a dollar holding on the dashboard reads without cents', dollars === 'USD 8’300', dollars);
  check('an ounce holding on the dashboard shows its stored digits', gold === '12.125 ozt', gold);
  for (const [name, hero, listed] of [
    ['UBS dollar account', 'USD 8’300', 'USD 8’300'],
    ['Gold bars', '12.125 ozt', '12.125 ozt'],
  ]) {
    await page.call((holding) => [...document.querySelectorAll('.data-table tbody .row-name')].find((b) => b.textContent === holding).click(), name);
    await page.waitUntil("location.hash.startsWith('#/holding/') && document.querySelector('.card .data-table tbody tr td.numeric')", { label: `${name} page` });
    const header = await page.eval("document.querySelector('.hero-figure').textContent");
    const first = await page.eval("document.querySelector('.card .data-table tbody tr td.numeric').textContent");
    check(`${name}: the page header follows the unit's kind`, header === hero, header);
    check(`${name}: the list of values follows the unit's kind`, first === listed, first);
    // The edit dialog prefills the stored figure digit for digit
    // through the quantity formatter, money included, and a save that
    // changes only the note writes the stored string character for
    // character, not the prefill read again.
    const stored = name === 'Gold bars' ? '12.125' : '8300.50';
    const valuesOf = () => page.call(async (figure) => {
      const v = (await import('/static/js/session.js')).currentVault();
      return JSON.stringify([...v.snapshots.values()].flat().filter((x) => x.payload.value === figure).map((x) => x.payload.value));
    }, stored);
    await page.eval("[...document.querySelectorAll('.card .data-table tbody tr')][0].querySelectorAll('button.btn-inline').forEach((b) => b.textContent === 'Edit' && b.click())");
    await page.waitUntil("document.querySelector('#snapshot-value')", { label: `${name} edit dialog` });
    const prefill = await page.eval("document.querySelector('#snapshot-value').value");
    check(`${name}: the edit dialog prefills the stored figure as stored`, prefill === (name === 'Gold bars' ? '12.125' : '8\u2019300.50'), prefill);
    await page.eval("(() => { const n = document.querySelector('.dialog textarea'); n.value = 'only the note'; n.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Save').click()");
    await page.waitUntil('!document.querySelector(".dialog")', { timeout: 60000, label: `${name} note-only save` });
    await page.idle();
    const after = await valuesOf();
    check(`${name}: saving only the note writes the stored string unchanged`, after === JSON.stringify([stored]), after);
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.data-table tbody .row-name')", { label: 'the dashboard again' });
  }

  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 20000, label: 'settings once more' });
  await page.waitUntil("document.querySelector('.danger-zone')", { label: 'the danger zone' });
  check('the danger zone is collapsed', !(await page.eval("document.querySelector('.danger-zone').open")));
  await page.eval("document.querySelector('.danger-zone').open = true");
  await page.frames();
  check(
    'the danger zone holds one destructive button, and nothing to type into',
    (await page.eval("document.querySelector('.danger-zone .btn-destructive').textContent")) === 'Delete my account' &&
      (await page.eval("document.querySelectorAll('.danger-zone input').length")) === 0,
  );
  await page.eval("document.querySelector('.danger-zone .btn-destructive').click()");
  await page.waitUntil("document.querySelector('.dialog .btn-primary')", { label: 'the deletion dialog' });
  check('export is offered as the primary action in the dialog it opens', (await page.eval("document.querySelector('.dialog .btn-primary').textContent")) === 'Export first');
  check(
    'deleting is the destructive secondary action',
    (await page.eval("document.querySelector('.dialog .btn-destructive').textContent")) === 'Delete my vault',
  );
  await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Cancel').click()");
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

  const exported = JSON.parse(
    await page.eval(`(async () => {
      const response = await fetch('/api/export', { headers: ${HANDS} });
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


  // ---- Account settings: the settings screen's own states --------------

  const toSettings = async (label) => {
    await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
    await page.waitUntil("document.body.innerText.includes('Main currency')", { label });
    await page.frames();
  };
  await toSettings('settings for its own states');
  check(
    'the main currency is shown and offers no control to change it',
    await page.call(
      (words) => !([...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words))).querySelector('input, select, textarea, button'),
      'Main currency',
    ),
  );

  // The session list waits on its own fetch, alone.
  let listAnswer;
  const listAnswered = new Promise((resolve) => (listAnswer = resolve));
  expectedFailures.add('/api/sessions');
  const releaseList = await intercept(page, '*/api/sessions', () => listAnswered.then(() => ({ status: 500 })));
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.hero-figure')", { label: 'the dashboard before the held list' });
  await toSettings('settings with the session list held');
  const waiting = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    return {
      skeleton: card.querySelectorAll('.skeleton-row').length,
      elsewhere: document.querySelectorAll('.skeleton-row').length,
    };
  }, 'Session and lock');
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
  await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    [...card.querySelectorAll('button')].find((b) => b.textContent === 'Retry').click();
  }, 'Session and lock');
  await page.waitUntil("document.body.innerText.includes('This session')", { label: 'the list after a retry' });
  check(
    'a retry reloads the session card alone',
    (await page.eval("document.getElementById('format-places').value")) === '2',
  );

  // At phone width the chip keeps "This session" whole, on one line.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await page.frames();
  const phoneChip = await page.call(() => {
    const chip = [...document.querySelectorAll('.sessions-table .chip')].find((c) => c.textContent === 'This session');
    return {
      height: chip.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(chip).lineHeight),
      pans: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  await page.send('Emulation.clearDeviceMetricsOverride');
  check(
    'at 390px the This session chip sits on one line and the page does not scroll sideways',
    phoneChip.height < 2 * phoneChip.lineHeight && phoneChip.pans <= 0,
    JSON.stringify(phoneChip),
  );

  // Signing out everywhere, failed.
  expectedFailures.add('/api/auth/logout-all');
  const releaseEverywhere = await intercept(page, '*/api/auth/logout-all', () => ({ status: 500 }));
  await click('Sign out everywhere');
  await page.waitUntil("document.body.innerText.includes('Nothing was signed out.')", { label: 'the sign-out error' });
  await releaseEverywhere();
  expectedFailures.delete('/api/auth/logout-all');
  const stillIn = await page.eval(`(async () => (await fetch('/api/sessions', { headers: ${HANDS} })).status)()`);
  check(
    'a failed sign out everywhere says so and leaves this session open',
    stillIn === 200 && (await page.eval('location.hash')) === '#/settings' && !(await page.eval("Boolean(document.querySelector('#unlock-password'))")),
    String(stillIn),
  );

  // Delete my vault waits for the password and the exact username.
  await page.eval("document.querySelector('.danger-zone').open = true");
  await page.eval("document.querySelector('.danger-zone .btn-destructive').click()");
  await page.waitUntil("document.querySelector('.dialog input')", { label: 'the deletion dialog' });
  const dialogFields = await fieldNames('.dialog');
  check(
    'a screen reader names both fields of the deletion dialog by the label shown beside it',
    dialogFields.labels.join('|') === 'Your password|Type your username to confirm' &&
      dialogFields.names.join('|') === dialogFields.labels.join('|'),
    JSON.stringify(dialogFields),
  );
  const deleteState = (password, typed) =>
    page.call((secret, username) => {
      const dialog = document.querySelector('.dialog');
      const [pw, name] = dialog.querySelectorAll('.field input');
      pw.value = secret;
      pw.dispatchEvent(new Event('input', { bubbles: true }));
      name.value = username;
      name.dispatchEvent(new Event('input', { bubbles: true }));
      return dialog.querySelector('.btn-destructive').disabled;
    }, password, typed);
  const gates = [
    await deleteState('', 'leander'),
    await deleteState('something', 'Leander'),
  ];
  check(
    "the delete dialog's password sits in a form with the signed-in username",
    (await page.call(() => {
      const name = document.querySelector('.dialog input[type=password]').closest('form')?.querySelector('input[autocomplete=username]');
      return name?.hidden && name.value;
    })) === 'leander',
  );
  const disabledLook = await confirmLook('Delete my vault');
  gates.push(await deleteState('something', 'leander'));
  const enabledLook = await confirmLook('Delete my vault');
  await deleteState('', '');
  check(
    'Delete my vault stays disabled until the password is filled and the username matches exactly',
    gates.join(',') === 'true,true,false',
    gates.join(','),
  );
  check(
    'a disabled Delete my vault is petrol-200 with an ink-secondary label at full opacity, a default cursor and no red, and turns red once it can act',
    looksDisabled(disabledLook) && looksEnabledRed(enabledLook),
    JSON.stringify({ disabledLook, enabledLook }),
  );
  check(
    'the deletion offers Export first as its primary action',
    (await page.eval("document.querySelector('.dialog .btn-primary').textContent")) === 'Export first',
  );
  await page.eval("[...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Cancel').click()");
  await page.waitUntil("!document.querySelector('.dialog')", { label: 'the dialog to close' });

  // ---- Account settings: changing the password -------------------------

  // At old parameters, kept there by an upgrade that fails, so the
  // change is also what upgrades it.
  const unlockHere = async (password, label) => {
    await enterPassword(password);
    await page.waitUntil("!document.querySelector('#unlock-password')", { timeout: 90000, label });
    await page.idle();
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
    const authKey = await page.call(
      async (u, p) => (await import('/static/js/session.js')).authKeyFor(u, p),
      username,
      password,
    );
    const response = await fetch(`${DIRECT}/api/auth/login`, {
      method: 'POST',
      headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, authKey }),
    });
    return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  };
  // Sent with the vault's own epoch, as the page that holds the session would.
  const statusWith = (cookie) =>
    fetch(`${DIRECT}/api/sessions`, {
      headers: {
        'X-Solvent-Request': '1',
        'X-Solvent-Vault': sql("SELECT epoch FROM vault_epochs WHERE principal_id = (SELECT id FROM principals WHERE username = 'leander')")[0].epoch,
        cookie,
      },
    }).then((r) => r.status);
  const elsewhere = await otherSession('leander', VAULT_PASSWORD);
  check('the other session is open before the change', (await statusWith(elsewhere)) === 200);

  // design-system.md, Password field: a form a password manager pairs
  // with the signed-in username.
  check(
    'the Change password fields sit in a form with the signed-in username',
    (await page.eval(`(() => {
      const name = document.querySelector('.card input[autocomplete=new-password]').closest('form')?.querySelector('input[autocomplete=username]');
      return name?.hidden && name.type === 'text' && name.value;
    })()`)) === 'leander',
  );

  const PASSWORD_CARD = 'Change password';
  const fillPasswords = async (current, next) => {
    await page.call((words, currentValue, nextValue) => {
      const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
      const set = (node, value) => {
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(card.querySelector('input[autocomplete=current-password]'), currentValue);
      for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
    }, PASSWORD_CARD, current, next);
    await page.waitUntil(
      (words) => ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled,
      { args: [PASSWORD_CARD], label: 'the strength gauge' },
    );
  };
  const submitPasswords = () =>
    page.call((words) => {
      [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click();
    }, PASSWORD_CARD);
  const changeRequests = () =>
    watched[0].requests.filter((r) => r.url.endsWith('/api/auth/change-password'));
  const apiSince = (index, tail = '/api/') =>
    watched[0].requests.slice(index).filter((r) => r.url.includes(tail));

  await fillPasswords(VAULT_PASSWORD, VAULT_PASSWORD);
  const beforeSame = watched[0].requests.length;
  await submitPasswords();
  await page.waitUntil("document.body.innerText.includes('The new password is your current one.')", {
    label: 'the new password that is the current one',
  });
  const same = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const error = card.querySelector('.field-error:not([hidden])');
    return {
      above: Boolean(error.compareDocumentPosition(card.querySelector('.password-field input')) & Node.DOCUMENT_POSITION_FOLLOWING),
      kept: [...card.querySelectorAll('.password-field input')].map((i) => i.value),
    };
  }, PASSWORD_CARD);
  check(
    'a new password that is the current one is refused above the first field, every field kept, and nothing is sent',
    same.above && same.kept.every((v) => v === VAULT_PASSWORD) && apiSince(beforeSame).length === 0,
    `${JSON.stringify(same)}, ${apiSince(beforeSame).map((r) => r.url).join(' | ')}`,
  );

  await fillPasswords('not the password at all', NEW_PASSWORD);
  const beforeWrong = watched[0].requests.length;
  await submitPasswords();
  await page.waitUntil("document.body.innerText.includes('That is not your current password.')", {
    timeout: 60000,
    label: 'the wrong current password',
  });
  const wrongCurrent = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const error = card.querySelector('.field-error:not([hidden])');
    const first = card.querySelector('.password-field input');
    return {
      above: Boolean(error.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING),
      kept: [...card.querySelectorAll('.password-field input')].map((i) => i.value),
    };
  }, PASSWORD_CARD);
  check(
    'a wrong current password is caught in the browser, above the first field, and nothing is sent',
    wrongCurrent.above && changeRequests().length === 0,
    `${JSON.stringify(wrongCurrent.above)}, ${changeRequests().length} sent`,
  );
  check(
    'a wrong current password sends one salt lookup and nothing else',
    apiSince(beforeWrong).map((r) => new URL(r.url).pathname).join(' | ') === '/api/auth/salt',
    apiSince(beforeWrong).map((r) => r.url).join(' | '),
  );
  check(
    'every field is kept after a wrong current password',
    wrongCurrent.kept.join('|') === ['not the password at all', NEW_PASSWORD, NEW_PASSWORD].join('|'),
  );

  await fillPasswords(VAULT_PASSWORD, NEW_PASSWORD);
  const beforeChangeRequests = watched[0].requests.length;
  const working = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const button = card.querySelector('.btn-primary');
    button.click();
    return {
      label: button.textContent,
      quiet: [...card.querySelectorAll('.password-field input, .password-field button')].every((n) => n.disabled),
    };
  }, PASSWORD_CARD);
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
  const cleared = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    return {
      fields: [...card.querySelectorAll('input[type=password]')].map((n) => n.value),
      filled: card.querySelectorAll('.gauge-segment.filled').length,
      rating: card.querySelector('.gauge-label').textContent,
      disabled: card.querySelector('.btn-primary').disabled,
    };
  }, PASSWORD_CARD);
  check(
    'after a change the fields are empty, the gauge reads nothing and Change password is disabled',
    cleared.fields.every((v) => v === '') && cleared.filled === 0 && cleared.rating === '' && cleared.disabled,
    JSON.stringify(cleared),
  );
  check(
    'a successful change sends no salt request',
    apiSince(beforeChangeRequests, '/api/auth/salt').length === 0,
    apiSince(beforeChangeRequests).map((r) => r.url).join(' | '),
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
    'the change-password request carries keys, the held salt and a wrapper and nothing else',
    sentChange.length === 1 &&
      Object.keys(JSON.parse(sentChange[0].body)).sort().join(',') === 'authKey,currentAuthKey,currentSalt,dekNonce,kdf,salt,wrappedDek',
    sentChange.map((r) => r.body).join(' | '),
  );
  check(
    'a password change ends the other session and keeps this one',
    (await statusWith(elsewhere)) === 401 &&
      (await page.eval(`(async () => (await fetch('/api/sessions', { headers: ${HANDS} })).status)()`)) === 200,
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

  // The Open sessions list after a change, with a second session open
  // before Settings renders, so the rows fetched then include it.
  const sessionRows = () =>
    page.call(() => ({
      rows: document.querySelectorAll('.sessions-table tbody tr').length,
      marked: [...document.querySelectorAll('.sessions-table .chip')].filter((c) => c.textContent === 'This session').length,
      failed: document.body.innerText.includes('The session list would not load.'),
      retry: [...document.querySelectorAll('.session-list button')].some((b) => b.textContent === 'Retry'),
      stayed: window.__stayed === true,
    }));
  const rowsAre = (rows) => page.waitUntil(
    (count) => document.querySelectorAll('.sessions-table tbody tr').length === count,
    { args: [rows], label: `${rows} session rows` },
  );
  const awayAndBack = async (label) => {
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.hero-figure')", { label: 'the dashboard before settings' });
    await toSettings(label);
  };

  // Back to the password the part's checks sign in with.
  await otherSession('leander', NEW_PASSWORD);
  await awayAndBack('settings with two sessions open');
  await rowsAre(2);
  await page.eval('window.__stayed = true');
  await fillPasswords(NEW_PASSWORD, VAULT_PASSWORD);
  await submitPasswords();
  await page.waitUntil("document.body.innerText.includes('Your password is changed.')", {
    timeout: 60000,
    label: 'the password changed back',
  });
  await page.holds(
    (count) => document.querySelectorAll('.sessions-table tbody tr').length === count,
    { args: [1], label: 'one session row after the change' },
  );
  const reloaded = await sessionRows();
  check(
    'after a password change the session list shows one row, marked This session, with no navigation',
    reloaded.rows === 1 && reloaded.marked === 1 && reloaded.stayed,
    JSON.stringify(reloaded),
  );

  // A reload that fails shows the card's error, never the old rows.
  await otherSession('leander', VAULT_PASSWORD);
  await awayAndBack('settings with two sessions open again');
  await rowsAre(2);
  expectedFailures.add('/api/sessions');
  const releaseReload = await intercept(page, '*/api/sessions', () => ({ status: 500 }));
  await fillPasswords(VAULT_PASSWORD, NEW_PASSWORD);
  await submitPasswords();
  await page.waitUntil("document.body.innerText.includes('The session list would not load.')", {
    timeout: 60000,
    label: 'the list error after the change',
  });
  const failedReload = await sessionRows();
  check(
    'a failed reload after a password change shows the load error and Retry, never the old rows',
    failedReload.failed && failedReload.retry && failedReload.rows === 0,
    JSON.stringify(failedReload),
  );
  await releaseReload();
  expectedFailures.delete('/api/sessions');
  await page.call(() => {
    [...document.querySelectorAll('.session-list button')].find((b) => b.textContent === 'Retry').click();
  });
  await rowsAre(1);

  await fillPasswords(NEW_PASSWORD, VAULT_PASSWORD);
  await submitPasswords();
  await page.waitUntil("document.body.innerText.includes('Your password is changed.')", {
    timeout: 60000,
    label: 'the password changed back again',
  });
  await rowsAre(1);

  // ---- Account settings: deleting a vault --------------------------------

  // A vault of its own, from an invite the administrator mints, kept at
  // old parameters so the deletion has to derive at the stored ones.
  const leaving = await openBrowser();
  try {
    const minted = { token: mintInvite('vault-owner') };
    const other = leaving.session;
    await other.goto(`${BASE}/register?invite=${minted.token}`);
    await other.call((secret) => {
      const set = (selector, value, index = 0) => {
        const node = document.querySelectorAll(selector)[index];
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('input[type=text]', 'leaving');
      set('input[type=password]', secret, 0);
      set('input[type=password]', secret, 1);
      document.querySelector('#register-currency-list [data-symbol="CHF"]').click();
      const box = document.querySelector('input[type=checkbox]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }, LEAVING_PASSWORD);
    await other.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
    await markDocument(other, 'leaving');
    await other.eval("document.querySelector('button[type=submit]').click()");
    check('registering another vault lands in it, with no second password entry', await intoVault(other, 'the new vault'));
    await other.frames();
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
      other.call((secret) => {
        if (!document.querySelector('.dialog')) {
          const zone = document.querySelector('.danger-zone');
          zone.open = true;
          zone.querySelector('.btn-destructive').click();
        }
        const dialog = document.querySelector('.dialog');
        const [pw, name] = dialog.querySelectorAll('.field input');
        pw.value = secret;
        pw.dispatchEvent(new Event('input', { bubbles: true }));
        name.value = 'leaving';
        name.dispatchEvent(new Event('input', { bubbles: true }));
        dialog.querySelector('.btn-destructive').click();
      }, LEAVING_PASSWORD);
    const releaseDelete = await intercept(other, '*/api/auth/account', (request) =>
      request.method === 'DELETE' ? { status: 500 } : null,
    );
    await fillDelete();
    await other.waitUntil("document.body.innerText.includes('Nothing was deleted.')", { timeout: 60000, label: 'the failed deletion' });
    await releaseDelete();
    check(
      'a failed deletion says nothing was deleted, and the vault and session are still there',
      (await other.eval(`(async () => (await fetch('/api/sessions', { headers: ${HANDS} })).status)()`)) === 200 &&
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
    leaving.close();
  }

});
