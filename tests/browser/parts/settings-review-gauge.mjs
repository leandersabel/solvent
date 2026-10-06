// A vault owner's password card after a successful change, written
// from spec/features/register.md (Register, The strength gauge: it
// reads what the field holds now) and account-settings.md (acceptance
// criterion 83) without reading how the card is built.
//
// The password is changed and then changed back, so the part leaves
// the credential the runner checks, and the second change shows the
// emptied gauge still scores what is typed next.
import { NEW_PASSWORD, VAULT_PASSWORD, check, page, run, vaultOwner } from '../harness.mjs';

const CARD = 'Change password';
const CHANGED = 'Your password is changed.';

// Fills the card, waits for the gauge to pass it, presses the button
// and waits for its working state to show and end. The confirmation
// alone would not do, because the first change leaves it on the card.
const change = async (current, next) => {
  await page.call((words, currentValue, nextValue) => {
    const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(found.querySelector('input[autocomplete=current-password]'), currentValue);
    for (const node of found.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
  }, CARD, current, next);
  await page.waitUntil(
    (words) => {
      const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
      return found.querySelectorAll('.gauge-segment.filled').length > 0 && !found.querySelector('.btn-primary').disabled;
    },
    { args: [CARD], label: 'the gauge passing the new password' },
  );
  await page.call((words) => {
    const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    window.__working = false;
    new MutationObserver(() => {
      if (found.textContent.includes('Changing your password')) window.__working = true;
    }).observe(found, { subtree: true, childList: true, characterData: true, attributes: true });
    found.querySelector('.btn-primary').click();
  }, CARD);
  await page.waitUntil(
    (words, copy) => {
      const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
      return window.__working && found.textContent.includes(copy) && !found.textContent.includes('Changing your password');
    },
    { args: [CARD, CHANGED], timeout: 90000, label: 'the password changed' },
  );
  await page.idle();
};

const after = () =>
  page.call((words) => {
    const found = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    return {
      values: [...found.querySelectorAll('input[type=password]')].map((i) => i.value),
      filled: found.querySelectorAll('.gauge-segment.filled').length,
      rating: [...found.querySelectorAll('.gauge-label')].map((l) => l.textContent.trim()).join(''),
      disabled: found.querySelector('.btn-primary').disabled,
    };
  }, CARD);

const cleared = (seen) => seen.values.length === 3 && seen.values.every((v) => v === '');

await run(async () => {
  await vaultOwner();
  await page.eval("location.hash = '#/settings'");
  await page.waitUntil((words) => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes(words)), {
    args: [CARD],
    label: 'the password card',
  });

  for (const [current, next, round] of [[VAULT_PASSWORD, NEW_PASSWORD, 'first'], [NEW_PASSWORD, VAULT_PASSWORD, 'second']]) {
    await change(current, next);
    const seen = await after();
    check(`after the ${round} change every field of a vault owner's card is empty`, cleared(seen), JSON.stringify(seen.values.map((v) => v.length)));
    check(`after the ${round} change a vault owner's gauge fills no segment`, seen.filled === 0, `${seen.filled} filled`);
    check(`after the ${round} change a vault owner's gauge shows no rating`, seen.rating === '', JSON.stringify(seen.rating));
    check(`after the ${round} change a vault owner's Change password is disabled`, seen.disabled);
  }
}, { signsIn: false });
