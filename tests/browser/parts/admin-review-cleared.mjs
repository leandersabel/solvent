// An administrator's password card after a successful change, written
// from spec/features/account-settings.md (the fields clear, and the
// gauge describes what is in them) and register.md (The strength gauge).
// The password is changed and changed back, so the part leaves the
// credential it signed in with.
import { ADMIN_PASSWORD, NEW_PASSWORD, administrator, check, click, page, run } from '../harness.mjs';

const CARD = 'same bar as anybody';

const change = async (current, next) => {
  await page.call((words, currentValue, nextValue) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    card.querySelector('.banner').hidden = true;
    set(card.querySelector('input[autocomplete=current-password]'), currentValue);
    for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
  }, CARD, current, next);
  await page.waitUntil(
    (words) => ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled,
    { args: [CARD], label: 'the strength gauge' },
  );
  await page.call((words) => {
    [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click();
  }, CARD);
  await page.waitUntil(
    (words) => {
      const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
      return !card.querySelector('.banner').hidden && card.querySelector('.btn-primary').textContent === 'Change password';
    },
    { args: [CARD], timeout: 60000, label: 'the changed password' },
  );
  return page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    return {
      fields: [...card.querySelectorAll('input[type=password]')].map((n) => n.value),
      filled: card.querySelectorAll('.gauge-segment.filled').length,
      rating: card.querySelector('.gauge-label').textContent,
      disabled: card.querySelector('.btn-primary').disabled,
    };
  }, CARD);
};

await run(async () => {
  await administrator();
  await click('Your password');
  await page.waitUntil((text) => document.body.innerText.includes(text), { args: [CARD], label: 'the password card' });

  const cleared = await change(ADMIN_PASSWORD, NEW_PASSWORD);
  check(
    "after an administrator's change the fields are empty, the gauge reads nothing and Change password is disabled",
    cleared.fields.every((v) => v === '') && cleared.filled === 0 && cleared.rating === '' && cleared.disabled,
    JSON.stringify(cleared),
  );
  await change(NEW_PASSWORD, ADMIN_PASSWORD);
}, { signsIn: false });
