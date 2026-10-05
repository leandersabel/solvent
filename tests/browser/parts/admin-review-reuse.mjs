// An administrator's new password equal to the current one, written
// from spec/features/admin-invites.md (Admin, States, Your password:
// "the new password is the current one", inline, refused before
// anything is sent) and account-settings.md (Change password step 1:
// refused before any derivation), without reading how the card is
// built.
//
// "Nothing is derived" is read off the page's workers: Argon2id runs
// in a Web Worker (login.md, Unlock), so a derivation posts to one.
import { ADMIN_PASSWORD, administrator, check, click, page, run, watched } from '../harness.mjs';

const SAME = 'The new password is your current one.';
const CARD = 'same bar as anybody';

await run(async () => {
  await administrator();
  await click('Your password');
  await page.waitUntil((text) => document.body.innerText.includes(text), { args: [CARD], label: 'the password card' });

  await page.call((words, password) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(card.querySelector('input[autocomplete=current-password]'), password);
    for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, password);
    window.__posted = 0;
    window.__working = false;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function counted(...args) {
      window.__posted += 1;
      return post.apply(this, args);
    };
    new MutationObserver(() => {
      if (card.textContent.includes('Changing your password')) window.__working = true;
    }).observe(card, { subtree: true, childList: true, characterData: true });
  }, CARD, ADMIN_PASSWORD);
  await page.waitUntil(
    (words) => ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled,
    { args: [CARD], label: 'the strength gauge' },
  );
  const before = watched[0].requests.length;
  await page.call((words) => {
    [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click();
  }, CARD);
  await page.waitUntil(
    (words, copy) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).textContent.includes(copy),
    { args: [CARD, SAME], timeout: 60000, label: 'the same-password error' },
  );
  await page.idle();
  const seen = await page.call((words, copy) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const error = [...card.querySelectorAll('*')].find((n) => n.textContent.trim() === copy && ![...n.children].some((c) => c.textContent.trim() === copy));
    const shown = error && error.getBoundingClientRect().height > 0 && error.closest('[hidden]') === null;
    return {
      shown: Boolean(shown),
      posted: window.__posted,
      working: window.__working,
    };
  }, CARD, SAME);
  const sent = watched[0].requests.slice(before).filter((r) => r.url.includes('/api/'));
  check('an administrator sees the same-password error inline in the card, in its stated words', seen.shown);
  check('nothing is sent for an administrator\'s new password equal to the current one', sent.length === 0, sent.map((r) => r.url).join(' | '));
  check('nothing is derived for an administrator\'s new password equal to the current one', seen.posted === 0 && !seen.working, JSON.stringify(seen));
}, { signsIn: false });
