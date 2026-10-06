// The invite form's expiry, written from spec/features/admin-invites.md
// (Admin, Invites: "This link stops working after") and
// spec/design-system.md (Typography, Figures: a count agrees with its
// noun) without reading how the form is built.
import { administrator, check, page, run } from '../harness.mjs';
import { disagreeing } from '../counts.mjs';

const ASKED = 'This link stops working after';

await run(async () => {
  await administrator();
  await page.waitUntil((words) => document.body.innerText.includes(words), { args: [ASKED], label: 'the invite form' });
  const expiry = await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const select = card && card.querySelector('select');
    return select && {
      options: [...select.options].map((o) => o.textContent.trim()),
      chosen: select.selectedOptions[0]?.textContent.trim(),
    };
  }, ASKED);
  check(
    'admin-invites: the expiry is a select from "1 day" to "30 days", each option agreeing with its count',
    expiry && expiry.options[0] === '1 day' && expiry.options.at(-1) === '30 days' && disagreeing(expiry.options.join('\n')).length === 0,
    JSON.stringify(expiry),
  );
  check('admin-invites: the expiry opens on "7 days"', expiry && expiry.chosen === '7 days', JSON.stringify(expiry));
  const wrong = disagreeing(await page.eval('document.body.innerText'));
  check('design-system: no count on the admin area disagrees with its noun', wrong.length === 0, wrong.join(' | '));
}, { signsIn: false });
