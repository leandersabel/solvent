// Settings' password change refusing what it should refuse in the
// browser, written from spec/features/account-settings.md (Settings,
// States: "the new password is the current one" and "fails the policy",
// Change password step 1, and acceptance criterion 82) without reading
// how the card is built.
//
// "Nothing is derived" is read off the page's workers: Argon2id runs
// in a Web Worker (login.md, Unlock), so a derivation posts to one.
import { VAULT_PASSWORD, check, page, run, vaultOwner, watched } from '../harness.mjs';

const SAME = 'The new password is your current one.';
const CARD = 'Change password';
const WEAK = 'password1234';

// Types into the card and presses its primary button, counting what
// the page posts to a worker and whether the working state ever shows.
const attempt = (current, next) =>
  page.call((words, currentValue, nextValue) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(card.querySelector('input[autocomplete=current-password]'), currentValue);
    for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
    window.__posted = 0;
    window.__working = false;
    if (!window.__counting) {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function counted(...args) {
        window.__posted += 1;
        return post.apply(this, args);
      };
      window.__counting = true;
    }
    new MutationObserver(() => {
      if (card.textContent.includes('Changing your password')) window.__working = true;
    }).observe(card, { subtree: true, childList: true, characterData: true });
  }, CARD, current, next);

const press = () =>
  page.call((words) => {
    [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click();
  }, CARD);

const changeRequests = () => watched[0].requests.filter((r) => r.url.includes('/api/auth/')).length;

await run(async () => {
  await vaultOwner();
  await page.eval("location.hash = '#/settings'");
  await page.waitUntil((words) => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes(words)), {
    args: [CARD],
    label: 'the password card',
  });

  // The new password is the current one.
  const before = changeRequests();
  await attempt(VAULT_PASSWORD, VAULT_PASSWORD);
  await page.waitUntil(
    (words) => ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled,
    { args: [CARD], label: 'the strength gauge' },
  );
  await press();
  await page.waitUntil(
    (words, copy) => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).textContent.includes(copy),
    { args: [CARD, SAME], timeout: 60000, label: 'the same-password error' },
  );
  await page.idle();
  const same = await page.call((words, copy) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const error = [...card.querySelectorAll('*')].find((n) => n.textContent.trim() === copy && ![...n.children].some((c) => c.textContent.trim() === copy));
    const first = card.querySelector('input');
    return {
      found: Boolean(error),
      before: Boolean(error && error.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING),
      above: Boolean(error && error.getBoundingClientRect().bottom <= first.getBoundingClientRect().top + 0.5),
      kept: [...card.querySelectorAll('input')].map((i) => i.value),
      posted: window.__posted,
      working: window.__working,
    };
  }, CARD, SAME);
  check('the same-password error reads exactly as the screen states it', same.found);
  check('the same-password error sits above the first field', same.before && same.above, JSON.stringify(same));
  check(
    'every field is kept after the same-password error',
    same.kept.join('|') === [VAULT_PASSWORD, VAULT_PASSWORD, VAULT_PASSWORD].join('|'),
    `${same.kept.length} fields`,
  );
  check('nothing is sent for a new password equal to the current one', changeRequests() === before, `${changeRequests() - before} sent`);
  check('nothing is derived for a new password equal to the current one', same.posted === 0 && !same.working, JSON.stringify(same));

  // The new password fails the policy: refused before anything is derived.
  const beforeWeak = changeRequests();
  await attempt(VAULT_PASSWORD, WEAK);
  await press();
  await page.idle();
  const weak = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    return { posted: window.__posted, working: window.__working, kept: [...card.querySelectorAll('input')].map((i) => i.value) };
  }, CARD);
  check('nothing is derived for a new password that fails the policy', weak.posted === 0 && !weak.working, JSON.stringify(weak));
  check('nothing is sent for a new password that fails the policy', changeRequests() === beforeWeak, `${changeRequests() - beforeWeak} sent`);
}, { signsIn: false });
