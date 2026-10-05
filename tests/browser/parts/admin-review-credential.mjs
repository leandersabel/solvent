// An administrator's password change on a credential that keeps moving,
// written from spec/features/account-settings.md (Edge cases,
// "Credential changed by another page since this tab opened the vault":
// a Bad Request, or a second Conflict, is final, and an administrator
// sees the wrong-password error), without reading how the card is built.
//
// The change-password request is answered `credential-changed` every
// time, the way a salt that moves again between the lookup and the
// resend answers it. The salt lookup goes through to the server.
import {
  ADMIN_PASSWORD, NEW_PASSWORD, administrator, check, click, intercept, page, provoked, run,
} from '../harness.mjs';

const WRONG = 'That is not your current password.';
const CARD = 'same bar as anybody';

await run(async () => {
  await administrator();
  await click('Your password');
  await page.waitUntil((text) => document.body.innerText.includes(text), { args: [CARD], label: 'the password card' });

  const sent = [];
  provoked.push('/api/auth/change-password');
  const stop = await intercept(page, '*/api/auth/change-password', async (request) => {
    sent.push(request.url);
    return { status: 409, body: JSON.stringify({ refused: 'credential-changed' }) };
  });
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
  await page.call((words) => {
    [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click();
  }, CARD);
  await page.waitUntil(
    (words) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.field-error:not([hidden])'),
    { args: [CARD], timeout: 90000, label: 'the error' },
  );
  await stop();
  const shown = await page.call((words) =>
    [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.field-error:not([hidden])').textContent, CARD);
  check('a second Conflict is final after one resend', sent.length === 2, String(sent.length));
  check("a second Conflict shows an administrator the wrong-password error", shown === WRONG, shown);
}, { signsIn: false });
