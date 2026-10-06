// The administrator's password card in a form with the username,
// written from spec/design-system.md (Components, Password field),
// spec/features/admin-invites.md (Your password, criterion 52) and
// spec/features/app-shell.md (criterion 29) without reading how the
// card is built.
//
// The password is changed by Enter and changed back the same way, so
// the part leaves the credential it signed in with.
import { ADMIN_PASSWORD, NEW_PASSWORD, administrator, check, click, expectedFailures, page, run, watched } from '../harness.mjs';

const CARD = 'same bar as anybody';
const CHANGED = 'Your password is changed.';
const WRONG = 'That is not your current password.';
const WEAK = 'password1234';
const MARKER = 'not-the-username-zq';
const UNPAIRED = ['not contained in a form', 'should have (optionally hidden) username'];

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

const card = `[...document.querySelectorAll('.card')].find((c) => c.textContent.includes(${JSON.stringify(CARD)}))`;
const confirmField = `[...${card}.querySelectorAll('input[autocomplete=new-password]')].at(-1)`;
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
const enterIn = async (selector) => {
  await page.eval(`${selector}.focus()`);
  await page.key('Enter');
};
const authRequests = () => watched[0].requests.filter((r) => r.url.includes('/api/auth/')).length;

const changeByEnter = async (current, next) => {
  await fill(current, next);
  await page.waitUntil(`!${card}.querySelector('.btn-primary').disabled`, { label: 'the strength gauge' });
  await page.eval(`window.__working = false; new MutationObserver(() => { if (${card}.textContent.includes('Changing your password')) window.__working = true; }).observe(${card}, { subtree: true, childList: true, characterData: true })`);
  await enterIn(confirmField);
  return page
    .waitUntil(`window.__working && ${card}.textContent.includes(${JSON.stringify(CHANGED)}) && !${card}.textContent.includes('Changing your password')`, {
      timeout: 90000,
      label: 'the password changed by Enter',
    })
    .then(() => true, () => false);
};

await run(async () => {
  await administrator();
  await click('Your password');
  await page.waitUntil(`${card}`, { label: 'the password card' });
  await page.idle();

  const form = await page.call((words) => {
    const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const passwords = [...found.querySelectorAll('input[type=password]')];
    const forms = new Set(passwords.map((p) => p.closest('form')));
    const named = passwords[0] && passwords[0].form ? [...passwords[0].form.querySelectorAll('input[autocomplete=username]')] : [];
    return {
      passwords: passwords.length,
      oneForm: forms.size === 1 && !forms.has(null),
      usernames: named.map((n) => ({ type: n.getAttribute('type'), value: n.value, visible: n.checkVisibility() })),
    };
  }, CARD);
  check('the password card holds three password fields', form.passwords === 3, JSON.stringify(form));
  check("the password card's fields sit in one form", form.oneForm, JSON.stringify(form));
  check(
    "that form holds one hidden text field with autocomplete username and the administrator's username",
    form.usernames.length === 1 && form.usernames[0].type === 'text' && form.usernames[0].value === 'ops.leander' && !form.usernames[0].visible,
    JSON.stringify(form),
  );

  // Enter while the button is disabled does nothing.
  const location = await page.eval('location.href');
  const beforeWeak = authRequests();
  await fill(ADMIN_PASSWORD, WEAK);
  await page.idle();
  const disabled = await page.eval(`${card}.querySelector('.btn-primary').disabled`);
  await enterIn(confirmField);
  await page.idle();
  check('with the button disabled, Enter sends nothing', disabled && authRequests() === beforeWeak, `${authRequests() - beforeWeak} sent`);
  check('Enter never navigates the page', (await page.eval('location.href')) === location, await page.eval('location.href'));

  // Another name in the hidden field: the change still goes through, and
  // no request carries it.
  await page.eval(`${card}.querySelector('input[type=password]').form.querySelector('input[autocomplete=username]').value = ${JSON.stringify(MARKER)}`);
  const sentBefore = watched[0].requests.length;
  check('Enter submits the change once the button is enabled', await changeByEnter(ADMIN_PASSWORD, NEW_PASSWORD));
  check(
    'no request carries the hidden username field',
    !watched[0].requests.slice(sentBefore).some((r) => r.url.includes(MARKER) || r.body.includes(MARKER)),
  );
  check('the change by Enter left the page where it was', (await page.eval('location.href')) === location, await page.eval('location.href'));
  check('the change by Enter changed the password back', await changeByEnter(NEW_PASSWORD, ADMIN_PASSWORD));

  // app-shell.md 29: a wrong current password logs only the browser's
  // line for the refused request.
  expectedFailures.add('/api/auth/');
  const fromWrong = logged.length;
  await fill(NEW_PASSWORD, 'quartz meridian lantern obelisk');
  await page.waitUntil(`!${card}.querySelector('.btn-primary').disabled`, { label: 'the strength gauge' });
  await page.eval(`${card}.querySelector('.btn-primary').click()`);
  await page.waitUntil(`${card}.textContent.includes(${JSON.stringify(WRONG)})`, { timeout: 90000, label: 'the wrong password' });
  await page.idle();
  expectedFailures.delete('/api/auth/');
  const errors = logged.slice(fromWrong).filter((e) => e.level === 'error');
  check(
    'a wrong current password logs no error but the browser line for a refused request',
    errors.every((e) => e.source === 'network' && e.url.includes('/api/auth/')),
    JSON.stringify(errors),
  );

  check('Chrome notes no password field without a form or a username in the admin area', unpaired().length === 0, JSON.stringify(unpaired()));
}, { signsIn: false });
