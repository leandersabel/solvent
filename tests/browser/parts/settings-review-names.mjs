// Reviewer's checks of the names a screen reader gives Settings' lists
// and password fields, written from spec/features/account-settings.md
// (Settings: Dates and numbers, Change password, Session and lock, Delete
// my account; criterion 85) and spec/design-system.md (Accessibility: a
// form control's visible label is its accessible name) without reading
// how the screen is built. The name is read from the browser's
// accessibility tree, which is what a screen reader hears.
import { check, page, run, vaultOwner } from '../harness.mjs';

const LISTS = ['Language', 'Dates', 'Thousands', 'Decimals on money', 'Idle lock'];
const PASSWORD_CARD = 'Change password';
const DIALOG = 'Delete your account';

// The controls `select` finds in the page, each with the accessibility
// tree's name for it and the lines of visible text around it: those of
// the nearest card or dialog holding it.
const named = async (select, ...args) => {
  const { result: global } = await page.send('Runtime.evaluate', { expression: 'globalThis' });
  const { result: list } = await page.send('Runtime.callFunctionOn', {
    objectId: global.objectId,
    functionDeclaration: select.toString(),
    arguments: args.map((value) => ({ value })),
  });
  const { result: props } = await page.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true });
  const out = [];
  for (const prop of props.filter((p) => /^\d+$/.test(p.name))) {
    const { objectId } = prop.value;
    const { nodes } = await page.send('Accessibility.getPartialAXTree', { objectId, fetchRelatives: false });
    const { result } = await page.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: function () {
        const around = this.closest('.dialog') || this.closest('.card');
        return {
          lines: around.innerText.split('\n').map((l) => l.trim()).filter(Boolean),
          kind: this.tagName === 'SELECT' ? 'select' : this.type,
          visible: this.checkVisibility(),
        };
      }.toString(),
      returnByValue: true,
    });
    out.push({ ...result.value, ignored: nodes[0].ignored, name: nodes[0].name?.value ?? '' });
  }
  return out;
};

// The name is one whole line of the visible text beside the control, so a
// name the eye cannot see, or one with a button's word run into it, fails.
const beside = (c) => !c.ignored && c.name !== '' && c.lines.includes(c.name);

await run(async () => {
  await vaultOwner();
  await page.send('Accessibility.enable');
  await page.eval("location.hash = '#/settings'");
  await page.waitUntil(
    (words) => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes(words)),
    { args: [PASSWORD_CARD], label: 'the password card' },
  );
  await page.idle();

  // ---- The lists ------------------------------------------------------------
  const lists = await named(() => [...document.querySelectorAll('select')].filter((n) => n.checkVisibility()));
  for (const name of LISTS) {
    const found = lists.filter((c) => c.name === name);
    check(`review 85: a screen reader names one list "${name}"`, found.length === 1, JSON.stringify(lists.map((c) => c.name)));
    check(`review 85: the list "${name}" is named by the label beside it`, found.length === 1 && beside(found[0]), JSON.stringify(found));
  }
  check(
    'review 85: every list on Settings has a name shown beside it',
    lists.length >= LISTS.length && lists.every(beside),
    JSON.stringify(lists.filter((c) => !beside(c))),
  );

  // ---- Change password -------------------------------------------------------
  const passwordsIn = (words) => [...[...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words))
    .querySelectorAll('input')].filter((n) => n.checkVisibility());
  const fields = await named(passwordsIn, PASSWORD_CARD);
  const names = fields.map((c) => c.name);
  check('review 85: the Change password card shows three password fields', fields.length === 3 && fields.every((c) => c.kind === 'password'), JSON.stringify(fields));
  check('review 85: each Change password field is named by the label beside it', fields.length === 3 && fields.every(beside), JSON.stringify(fields));
  check(
    'review 85: the fields read as current password, new password and confirm, in that order',
    /current password/i.test(names[0] || '') && /new password/i.test(names[1] || '') && /confirm/i.test(names[2] || ''),
    JSON.stringify(names),
  );
  check('review 85: no two Change password fields share a name', new Set(names).size === names.length, JSON.stringify(names));

  // Show turns a field into text, and the field keeps its name.
  await page.call((words) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Show').click();
  }, PASSWORD_CARD);
  await page.idle();
  const shown = await named(passwordsIn, PASSWORD_CARD);
  check(
    'review 85: a password field shown as text keeps its name',
    shown.some((c) => c.kind === 'text') && JSON.stringify(shown.map((c) => c.name)) === JSON.stringify(names),
    JSON.stringify(shown),
  );

  // ---- Delete my account -----------------------------------------------------
  await page.call(() => {
    const own = (n) => [...n.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent).join('').trim();
    [...document.querySelectorAll('*')].find((n) => own(n) === 'Danger zone').click();
  });
  await page.waitUntil(
    "[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Delete my account' && b.checkVisibility())",
    { label: 'the Delete my account button' },
  );
  await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete my account').click()");
  await page.waitUntil(
    (words) => [...document.querySelectorAll('.dialog')].some((d) => d.textContent.includes(words) && d.checkVisibility()),
    { args: [DIALOG], label: 'the delete dialog' },
  );
  await page.idle();
  const dialog = await named((words) => [...[...document.querySelectorAll('.dialog')].find((d) => d.textContent.includes(words))
    .querySelectorAll('input')].filter((n) => n.checkVisibility()), DIALOG);
  check('review 85: the delete dialog shows two fields', dialog.length === 2, JSON.stringify(dialog));
  check('review 85: both delete dialog fields are named by the label beside them', dialog.length === 2 && dialog.every(beside), JSON.stringify(dialog));
  check(
    'review 85: one delete dialog field reads as the password and the other as the username',
    dialog.some((c) => c.kind === 'password' && /password/i.test(c.name)) && dialog.some((c) => c.kind !== 'password' && /username/i.test(c.name)),
    JSON.stringify(dialog),
  );
  await page.key('Escape');
  await page.idle();
}, { signsIn: false });
