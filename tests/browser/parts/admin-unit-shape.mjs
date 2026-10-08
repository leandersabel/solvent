// Add a unit's metal naming line (spec/features/admin-invites.md, Admin,
// Units): it shows beneath Code only while Kind is Metal.
// Modules: page-admin.js.
import { administrator, check, click, page, run } from '../harness.mjs';

const SHAPE = 'Metals are named <code>-ozt or <code>-g, such as XAU-ozt.';

// Whether the naming line shows in the add form.
const shows = () =>
  page.call((line) => {
    const form = [...document.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent === 'Add a unit');
    return [...form.querySelectorAll('.hint')].some((hint) => hint.textContent === line && hint.checkVisibility());
  }, SHAPE);

const choose = (kind) =>
  page.call((value) => {
    const select = document.querySelector('#unit-kind');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, kind);

await run(async () => {
  await administrator();
  await click('Units');
  await page.waitUntil("document.body.innerText.includes('XAU-ozt')", { label: 'the unit table' });
  await page.eval("[...document.querySelectorAll('summary')].find((s) => s.textContent === 'Add a unit').parentElement.open = true");

  check('Add a unit opens on Currency without the metal naming line', !(await shows()));
  await choose('metal');
  check('choosing Metal shows the metal naming line', await shows());
  await choose('currency');
  check('choosing Currency again hides it', !(await shows()));
}, { signsIn: false });
