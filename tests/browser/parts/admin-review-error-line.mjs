// Where the Your password card reports what went wrong, written from
// spec/features/admin-invites.md (Admin, Your password, its States, and
// acceptance criterion 49) and spec/design-system.md (States, Error),
// without reading how the card is built.
//
// Each of the card's errors shows its copy once, in a line above the
// Current password field and its label, which is the card's first field.
// The new-is-current refusal sends nothing, and a failed change keeps
// every field.
import {
  ADMIN_PASSWORD, NEW_PASSWORD, REGISTRANT_PASSWORD, administrator, check, click, intercept, page, provoked, run,
  watched,
} from '../harness.mjs';

const CARD = 'same bar as anybody';
const WRONG = 'That is not your current password.';
const SAME = 'The new password is your current one.';
const FAILED = 'Nothing was changed. Your current password still works.';

const fill = (current, next) =>
  page.call((words, currentValue, nextValue) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(card.querySelector('input[autocomplete=current-password]'), currentValue);
    for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
  }, CARD, current, next);

// The card's submit, by its label. The Show toggles beside the fields
// are buttons too.
const submit = async () => {
  await page.waitUntil(
    (words) => ![...[...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelectorAll('button')]
      .find((b) => b.textContent === 'Change password').disabled,
    { args: [CARD], label: 'the button enabled' },
  );
  await page.call((words) => {
    [...[...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelectorAll('button')]
      .find((b) => b.textContent === 'Change password').click();
  }, CARD);
};

// Where the message stands relative to the card's first field: the
// visible elements that hold it as their own text, and whether the
// first of them ends above the Current password field's label and
// input and comes before both in the document.
const placement = (message) =>
  page.call((words, text) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const shown = (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const lines = [...card.querySelectorAll('*')].filter(
      (n) => n.textContent.includes(text) && shown(n) && ![...n.children].some((c) => c.textContent.includes(text)),
    );
    const inputs = [...card.querySelectorAll('input')].filter(shown);
    const current = card.querySelector('input[autocomplete=current-password]');
    const label = [...card.querySelectorAll('*')].find(
      (n) => shown(n) && n.children.length === 0 && n.textContent.trim() === 'Current password',
    );
    if (!label) return { count: -1 };
    const line = lines[0];
    if (!line) return { count: 0 };
    const bottom = line.getBoundingClientRect().bottom;
    return {
      count: lines.length,
      firstFieldIsCurrent: inputs[0] === current,
      aboveLabel: bottom <= label.getBoundingClientRect().top + 0.5,
      aboveInput: bottom <= current.getBoundingClientRect().top + 0.5,
      beforeInDocument: Boolean(line.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING),
      detail: `line ${Math.round(line.getBoundingClientRect().top)}-${Math.round(bottom)}, label ${Math.round(label.getBoundingClientRect().top)}, input ${Math.round(current.getBoundingClientRect().top)}`,
    };
  }, CARD, message);

const above = (name, at) => {
  check(`${name}: shown once in the card`, at.count === 1, String(at.count));
  check(`${name}: the card's first field is Current password`, at.firstFieldIsCurrent);
  check(`${name}: the line sits above the Current password field and its label`, at.aboveLabel && at.aboveInput, at.detail);
  check(`${name}: the line comes before the Current password field in the document`, at.beforeInDocument);
};

const appears = (message, timeout = 30000) =>
  page.waitUntil(
    (words, text) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).innerText.includes(text),
    { args: [CARD, message], timeout, label: message },
  );

await run(async () => {
  await administrator();
  await click('Your password');
  await page.waitUntil((text) => document.body.innerText.includes(text), { args: [CARD], label: 'the password card' });

  // The new password is the current one: refused before anything is sent.
  const before = watched[0].requests.length;
  await fill(ADMIN_PASSWORD, ADMIN_PASSWORD);
  await submit();
  await appears(SAME);
  const sent = watched[0].requests.slice(before).filter((r) => r.url.includes('/api/auth/'));
  check('the new-is-current refusal sends nothing', sent.length === 0, sent.map((r) => r.url).join(','));
  above('new is current', await placement(SAME));

  // The change failed: every field is kept.
  provoked.push('/api/auth/change-password');
  const stop = await intercept(page, '*/api/auth/change-password', async () => ({ status: 500, body: '{}' }));
  await fill(ADMIN_PASSWORD, NEW_PASSWORD);
  await submit();
  await appears(FAILED, 90000);
  await stop();
  above('change failed', await placement(FAILED));
  const kept = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    return [...card.querySelectorAll('input[type=password]')].map((n) => n.value);
  }, CARD);
  check(
    'a failed change keeps every field',
    kept.length === 3 && kept[0] === ADMIN_PASSWORD && kept[1] === NEW_PASSWORD && kept[2] === NEW_PASSWORD,
    String(kept.length),
  );

  // A wrong current password, answered by the real server.
  await fill(REGISTRANT_PASSWORD, NEW_PASSWORD);
  await submit();
  await appears(WRONG, 90000);
  above('wrong current password', await placement(WRONG));
}, { signsIn: false });
