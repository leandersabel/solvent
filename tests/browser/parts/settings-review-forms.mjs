// Settings' password fields in forms with the username, written from
// spec/design-system.md (Components, Password field),
// spec/features/account-settings.md (Change password, Delete my
// account, criterion 84) and spec/features/app-shell.md (criterion 29)
// without reading how the screen is built.
//
// The password is changed by Enter and changed back the same way, so
// the part leaves the credential the runner checks.
import { NEW_PASSWORD, VAULT_PASSWORD, check, expectedFailures, page, run, sql, vaultOwner, watched } from '../harness.mjs';

const CARD = 'Change password';
const CHANGED = 'Your password is changed.';
const WRONG = 'That is not your current password.';
const WEAK = 'password1234';
const MARKER = 'not-the-username-zq';
// Chrome's notes on a password field outside a form, or in one with no
// username, which a password manager reads the same way.
const UNPAIRED = ['not contained in a form', 'should have (optionally hidden) username'];

// Everything the page logs, at any level and by any route.
const logged = [];
page.on((message) => {
  if (message.method === 'Log.entryAdded') {
    const { level, source, text, url } = message.params.entry;
    logged.push({ level, source, text, url: url || '' });
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    logged.push({ level: message.params.type, source: 'console', text: JSON.stringify(message.params.args.map((a) => a.value)), url: '' });
  }
  if (message.method === 'Runtime.exceptionThrown') {
    logged.push({ level: 'error', source: 'exception', text: message.params.exceptionDetails.text, url: '' });
  }
});
const unpaired = () => logged.filter((e) => UNPAIRED.some((note) => e.text.includes(note)));

// The form around `scope`'s password fields, and its hidden username.
const formOf = (scopeSelector, words) =>
  page.call((selector, text) => {
    const scope = [...document.querySelectorAll(selector)].find((n) => n.textContent.includes(text));
    const passwords = [...scope.querySelectorAll('input[type=password]')];
    const forms = new Set(passwords.map((p) => p.closest('form')));
    const form = passwords[0] && passwords[0].closest('form');
    const named = form ? [...form.querySelectorAll('input[autocomplete=username]')] : [];
    const credential = ['username', 'current-password', 'new-password'];
    return {
      passwords: passwords.length,
      // design-system.md, Input: a field that is no credential refuses
      // every major password manager.
      offered: [...scope.querySelectorAll('input')]
        .filter((n) => !credential.includes(n.getAttribute('autocomplete')))
        .filter((n) => !(n.getAttribute('autocomplete') === 'off' && n.hasAttribute('data-1p-ignore') && n.getAttribute('data-lpignore') === 'true' && n.hasAttribute('data-bwignore') && n.getAttribute('data-form-type') === 'other'))
        .map((n) => n.outerHTML),
      oneForm: forms.size === 1 && !forms.has(null),
      usernames: named.map((n) => ({
        type: n.getAttribute('type'),
        value: n.value,
        visible: n.checkVisibility(),
        name: n.name,
      })),
    };
  }, scopeSelector, words);

// Each runs in the page with the card's words as data.
const shown = (words) => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes(words));
const enabled = (words) =>
  ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled;
const focusConfirm = (words) =>
  [...[...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelectorAll('input[autocomplete=new-password]')]
    .at(-1)
    .focus();
const fill = (current, next) =>
  page.call((words, currentValue, nextValue) => {
    const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(found.querySelector('input[autocomplete=current-password]'), currentValue);
    for (const node of found.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
  }, CARD, current, next);
const enterIn = async (focus, ...args) => {
  await page.call(focus, ...args);
  await page.key('Enter');
};
const authRequests = () => watched[0].requests.filter((r) => r.url.includes('/api/auth/')).length;

// Changes the password by pressing Enter in the confirm field.
const changeByEnter = async (current, next) => {
  await fill(current, next);
  await page.waitUntil(enabled, { args: [CARD], label: 'the strength gauge' });
  await page.call((words) => {
    const cardOf = () => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    window.__working = false;
    new MutationObserver(() => {
      if (cardOf().textContent.includes('Changing your password')) window.__working = true;
    }).observe(cardOf(), { subtree: true, childList: true, characterData: true });
  }, CARD);
  await enterIn(focusConfirm, CARD);
  return page
    .waitUntil(
      (words, done) => {
        const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
        return window.__working && found.textContent.includes(done) && !found.textContent.includes('Changing your password');
      },
      { args: [CARD, CHANGED], timeout: 90000, label: 'the password changed by Enter' },
    )
    .then(() => true, () => false);
};

await run(async () => {
  await vaultOwner();
  await page.eval("location.hash = '#/settings'");
  await page.waitUntil(shown, { args: [CARD], label: 'the password card' });
  await page.idle();

  // ---- Change password ----------------------------------------------------
  const change = await formOf('.card', CARD);
  check('the Change password card holds three password fields', change.passwords === 3, JSON.stringify(change));
  check('the Change password fields sit in one form', change.oneForm, JSON.stringify(change));
  check(
    'that form holds one hidden text field with autocomplete username and the signed-in username',
    change.usernames.length === 1 &&
      change.usernames[0].type === 'text' &&
      change.usernames[0].value === 'leander' &&
      !change.usernames[0].visible,
    JSON.stringify(change),
  );

  // Enter while the button is disabled does nothing.
  const location = await page.eval('location.href');
  const beforeWeak = authRequests();
  await fill(VAULT_PASSWORD, WEAK);
  await page.idle();
  const disabled = !(await page.call(enabled, CARD));
  await enterIn(focusConfirm, CARD);
  await page.idle();
  check('with the button disabled, Enter sends nothing', disabled && authRequests() === beforeWeak, `${authRequests() - beforeWeak} sent`);
  check('Enter never navigates the page', (await page.eval('location.href')) === location, await page.eval('location.href'));

  // Nothing sends or reads the hidden username: another name in it, and
  // the change still goes through as this account, with the name on no
  // request.
  await page.call((words, marker) => {
    const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    found.querySelector('input[type=password]').form.querySelector('input[autocomplete=username]').value = marker;
  }, CARD, MARKER);
  const sentBefore = watched[0].requests.length;
  check('Enter submits the change once the button is enabled', await changeByEnter(VAULT_PASSWORD, NEW_PASSWORD));
  check(
    'no request carries the hidden username field',
    !watched[0].requests.slice(sentBefore).some((r) => r.url.includes(MARKER) || r.body.includes(MARKER)),
  );
  check('the change by Enter left the page where it was', (await page.eval('location.href')) === location, await page.eval('location.href'));
  check('the change by Enter changed the password', await changeByEnter(NEW_PASSWORD, VAULT_PASSWORD));

  // ---- app-shell.md 29: a refused request the person made -----------------
  //
  // A wrong current password is the product answering. The browser's line
  // for that response is the only error the page may log.
  expectedFailures.add('/api/auth/');
  const fromWrong = logged.length;
  await fill(NEW_PASSWORD, 'quartz meridian lantern obelisk');
  await page.waitUntil(enabled, { args: [CARD], label: 'the strength gauge' });
  await page.call(
    (words) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click(),
    CARD,
  );
  await page.waitUntil(
    (words, refused) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).textContent.includes(refused),
    { args: [CARD, WRONG], timeout: 90000, label: 'the wrong password' },
  );
  await page.idle();
  expectedFailures.delete('/api/auth/');
  const errors = logged.slice(fromWrong).filter((e) => e.level === 'error');
  check(
    'a wrong current password logs no error but the browser line for a refused request',
    errors.every((e) => e.source === 'network' && e.url.includes('/api/auth/')),
    JSON.stringify(errors),
  );

  // ---- Delete your account ------------------------------------------------
  await page.call(() => {
    const own = (n) => [...n.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent).join('').trim();
    [...document.querySelectorAll('*')].find((n) => own(n) === 'Danger zone').click();
  });
  await page.waitUntil(
    "[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Delete my account' && b.checkVisibility())",
    { label: 'the Delete my account button' },
  );
  await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete my account').click()");
  await page.waitUntil("[...document.querySelectorAll('.dialog')].some((d) => d.textContent.includes('Delete your account'))", {
    label: 'the delete dialog',
  });
  await page.idle();
  const dialog = await formOf('.dialog', 'Delete your account');
  check('the delete dialog holds one password field', dialog.passwords === 1, JSON.stringify(dialog));
  check('the delete dialog password field sits in a form', dialog.oneForm, JSON.stringify(dialog));
  check('the typed username in the delete dialog refuses password managers', dialog.offered.length === 0, JSON.stringify(dialog.offered));
  check(
    'that form holds a hidden text field with autocomplete username and the signed-in username',
    dialog.usernames.some((u) => u.type === 'text' && u.value === 'leander' && !u.visible),
    JSON.stringify(dialog),
  );

  // Enter never submits it, even with everything filled.
  await page.call((secret) => {
    const d = [...document.querySelectorAll('.dialog')].find((n) => n.textContent.includes('Delete your account'));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(d.querySelector('input[type=password]'), secret);
    set([...d.querySelectorAll('input[type=text]')].find((n) => n.checkVisibility()), 'leander');
  }, VAULT_PASSWORD);
  await page.idle();
  const armed = await page.call(() => {
    const d = [...document.querySelectorAll('.dialog')].find((d) => d.textContent.includes('Delete your account'));
    return ![...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete my vault').disabled;
  });
  const writesBefore = watched[0].requests.filter((r) => r.method !== 'GET').length;
  await enterIn(() => {
    const d = [...document.querySelectorAll('.dialog')].find((d) => d.textContent.includes('Delete your account'));
    d.querySelector('input[type=password]').focus();
  });
  await page.idle();
  await enterIn(() => {
    const d = [...document.querySelectorAll('.dialog')].find((d) => d.textContent.includes('Delete your account'));
    [...d.querySelectorAll('input[type=text]')].find((n) => n.checkVisibility()).focus();
  });
  await page.idle();
  const writesAfter = watched[0].requests.filter((r) => r.method !== 'GET').length;
  check('Delete my vault is enabled once the dialog is filled', armed);
  check('Enter in the delete dialog sends nothing', writesAfter === writesBefore, `${writesAfter - writesBefore} sent`);
  check('the account is still there after Enter in the delete dialog', sql("SELECT count(*) AS n FROM principals WHERE username = 'leander'")[0].n === 1);
  check(
    'the delete dialog stays open after Enter',
    await page.call(() => [...document.querySelectorAll('.dialog')].some((d) => d.textContent.includes('Delete your account'))),
  );
  check('Enter in the delete dialog left the page where it was', (await page.eval('location.href')) === location, await page.eval('location.href'));
  await page.key('Escape');
  await page.idle();

  check('Chrome notes no password field without a form or a username on Settings', unpaired().length === 0, JSON.stringify(unpaired()));
}, { signsIn: false });
