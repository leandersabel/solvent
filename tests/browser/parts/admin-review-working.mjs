// The administrator's password card while the change runs, written
// from spec/features/admin-invites.md (Your password, its States,
// criteria 49, 52 and 58) and spec/design-system.md (Components,
// Password field) without reading how the card is built.
//
// The change-password request is held until the part has looked, then
// answered as a failure, so the credential never changes.
import { ADMIN_PASSWORD, NEW_PASSWORD, administrator, check, click, intercept, page, provoked, run } from '../harness.mjs';

const CARD = 'same bar as anybody';
const WORKING = 'Changing your password';
const FAILED = 'Nothing was changed. Your current password still works.';
const TYPED = 'zz';

// The card's state, read in the page with the card's words as data.
const stateOf = (words) => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
  const fields = [...card.querySelectorAll('input[autocomplete=current-password], input[autocomplete=new-password]')];
  const button = card.querySelector('.btn-primary');
  const toggles = [...card.querySelectorAll('button')].filter((b) => b !== button);
  const username = card.querySelector('input[autocomplete=username]');
  const error = [...card.querySelectorAll('.field-error, [role=alert]')].find((n) => n.checkVisibility() && n.textContent.trim());
  return {
    fields: fields.map((f) => ({ disabled: f.disabled, value: f.value, type: f.type })),
    toggles: toggles.map((t) => ({ disabled: t.disabled, text: t.textContent.trim() })),
    button: { disabled: button.disabled, text: button.textContent.trim() },
    username: username ? { value: username.value, inForm: username.form === fields[0].form } : null,
    error: error ? { text: error.textContent.trim(), bottom: error.getBoundingClientRect().bottom } : null,
    currentTop: fields[0].getBoundingClientRect().top,
  };
};
const quiet = (state) => state.fields.every((f) => f.disabled) && state.toggles.every((t) => t.disabled) && state.button.disabled;
const centerOf = (words, selector) =>
  page.call((w, s) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(w));
    const node = s === 'toggle'
      ? [...card.querySelectorAll('button')].find((b) => !b.classList.contains('btn-primary'))
      : [...card.querySelectorAll(s)].at(0);
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, words, selector);

await run(async () => {
  await administrator();
  await click('Your password');
  await page.waitUntil((words) => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes(words)), {
    args: [CARD], label: 'the password card',
  });
  await page.idle();

  await page.call((words, currentValue, nextValue) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(card.querySelector('input[autocomplete=current-password]'), currentValue);
    for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
  }, CARD, ADMIN_PASSWORD, NEW_PASSWORD);
  await page.waitUntil(
    (words) => ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled,
    { args: [CARD], label: 'the strength gauge' },
  );
  const before = await page.call(stateOf, CARD);
  check('the card has three password fields and at least one Show toggle', before.fields.length === 3 && before.toggles.length >= 1, JSON.stringify(before));

  // Every quiet state seen from the first frame of the working label,
  // through the derivation, to the held request.
  await page.call((words) => {
    window.__seen = [];
    const card = () => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const look = () => {
      const button = card().querySelector('.btn-primary');
      if (!button.textContent.includes('Changing your password')) return;
      const fields = [...card().querySelectorAll('input[autocomplete=current-password], input[autocomplete=new-password]')];
      const toggles = [...card().querySelectorAll('button')].filter((b) => b !== button);
      window.__seen.push(fields.every((f) => f.disabled) && toggles.every((t) => t.disabled) && button.disabled);
    };
    new MutationObserver(look).observe(card(), { subtree: true, childList: true, characterData: true, attributes: true });
  }, CARD);

  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const sent = [];
  provoked.push('/api/auth/change-password');
  const stop = await intercept(page, '*/api/auth/change-password', async (request) => {
    sent.push(request.url);
    await held;
    return { status: 500, body: '{}' };
  });

  await page.call(
    (words) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click(),
    CARD,
  );
  await page.waitUntil(() => window.__seen.length > 0, { timeout: 30000, label: 'the working state' });
  const waiting = await page.call(stateOf, CARD);
  check('the button reads "Changing your password"', waiting.button.text === WORKING, waiting.button.text);
  check('58: the fields, Show toggles and button are disabled as the work starts', quiet(waiting), JSON.stringify(waiting));

  const start = Date.now();
  while (!sent.length && Date.now() - start < 90000) await page.frames(2);
  check('the change reaches the server', sent.length === 1, String(sent.length));
  const atServer = await page.call(stateOf, CARD);
  check('58: still quiet while the server is asked', atServer.button.text === WORKING && quiet(atServer), JSON.stringify(atServer));
  check(
    '58: every moment the card read "Changing your password", it was quiet',
    (await page.eval('window.__seen.every(Boolean)')),
    await page.eval('JSON.stringify(window.__seen)'),
  );

  // A person typing into New password, clicking a Show toggle and
  // pressing Enter, by real input.
  const field = await centerOf(CARD, 'input[autocomplete=new-password]');
  await page.mouseClick(field.x, field.y);
  await page.send('Input.insertText', { text: TYPED });
  await page.frames(2);
  const toggle = await centerOf(CARD, 'toggle');
  await page.mouseClick(toggle.x, toggle.y);
  await page.key('Enter');
  await page.frames(4);
  const typed = await page.call(stateOf, CARD);
  check('58: typing into New password enables nothing', typed.button.text === WORKING && quiet(typed), JSON.stringify(typed));
  check('58: typing into New password changes nothing in it', typed.fields[1].value === NEW_PASSWORD, typed.fields[1].value);
  check('58: a Show toggle reveals nothing while it works', typed.fields.every((f) => f.type === 'password'), JSON.stringify(typed.fields));
  check('58: Enter sends no second change', sent.length === 1, String(sent.length));

  release();
  await page.waitUntil(
    (words, failed) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).textContent.includes(failed),
    { args: [CARD, FAILED], timeout: 30000, label: 'the failure' },
  );
  await stop();
  await page.idle();
  const after = await page.call(stateOf, CARD);
  check(
    'after a failed change every field is kept and can be edited again',
    after.fields.every((f) => !f.disabled) && after.fields.map((f) => f.value).join() === [ADMIN_PASSWORD, NEW_PASSWORD, NEW_PASSWORD].join(),
    JSON.stringify(after),
  );
  check('after a failed change the Show toggles work again', after.toggles.every((t) => !t.disabled), JSON.stringify(after.toggles));
  check('after a failed change the button reads as it did and can be pressed', after.button.text === before.button.text && !after.button.disabled, JSON.stringify(after.button));
  check('49: the error line sits above the Current password field', after.error && after.error.bottom <= after.currentTop, JSON.stringify(after));
  check(
    "52: the form still holds the administrator's username",
    after.username && after.username.value === 'ops.leander' && after.username.inForm,
    JSON.stringify(after.username),
  );
}, { signsIn: false });
