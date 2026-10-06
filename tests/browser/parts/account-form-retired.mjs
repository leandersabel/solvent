// The Account form's unit picker after an administrator retired a unit
// (spec/features/manage-accounts.md, Account form, Fields): nobody
// choosing afresh is offered it, a holding already in it keeps it under
// its name, and typing it is refused.
// Modules: view-holding-form.js.
import { check, holdings, openHolding, page, run, sql, vaultOwner } from '../harness.mjs';

const options = () =>
  page.call(() => [...document.querySelectorAll('#holding-unit-list [role=option]')].map((o) => o.textContent.trim()));
const click = (text) =>
  page.call((label) => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === label).click(), text);
const fill = (selector, text) =>
  page.call((query, value) => {
    const field = document.querySelector(query);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, text);
const unitLine = () => page.call(() => {
  const line = document.getElementById('holding-unit-line');
  return line.hidden ? '' : line.textContent.trim();
}, { signsIn: false });

await run(async () => {
  await vaultOwner();
  const { 'Silver coins': silver } = await holdings([['Silver coins', 'XAG-ozt']]);
  sql("UPDATE symbols SET retired = 1 WHERE symbol = 'XAG-ozt'");

  await openHolding(silver);
  await click('Edit');
  await page.waitUntil("document.querySelector('#holding-unit-list [role=option]')", { label: 'the unit list' });
  const kept = await options();
  check(
    'a holding in a retired unit keeps it as its choice, named in full',
    kept.filter((t) => t.includes('XAG-ozt')).length === 1 && kept[0].startsWith('Silver, troy ounce (XAG-ozt)'),
    JSON.stringify(kept.slice(0, 3)),
  );
  await click('Cancel');

  await page.eval("location.hash = '#/'");
  await page.waitUntil("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add a holding')", { label: 'Add a holding' });
  await click('Add a holding');
  await page.waitUntil("document.querySelector('#holding-unit-list [role=option]')", { label: 'the unit list' });
  const offered = await options();
  check(
    'a retired unit is not offered for a new holding',
    !offered.some((t) => t.includes('XAG-ozt')) && offered.some((t) => t.includes('XAG-g')),
    JSON.stringify(offered),
  );

  await fill('#holding-name', 'More silver');
  await page.call(() => document.querySelector('.unit-option.unit-other').click());
  await fill('#holding-unit-other', 'xag-ozt');
  check(
    'a retired unit typed as free text is not offered back',
    await page.eval("document.querySelector('.listed-offer').hidden"),
  );
  await page.call(() => document.querySelector('form button[type=submit]').click());
  await page.idle();
  check(
    'a retired unit typed as free text is refused',
    (await unitLine()) === 'XAG-ozt is no longer offered for new holdings.',
    await unitLine(),
  );
}, { signsIn: false });
