// Reviewer's checks of the names a screen reader gives the fields of the
// Dimensions dialogs, written from spec/features/account-settings.md
// (Dimensions, Creating; criterion 86) and spec/design-system.md
// (Accessibility: a form control's visible label is its accessible name)
// without reading how the screen is built. The name is read from the
// browser's accessibility tree, which is what a screen reader hears.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner } from '../harness.mjs';

const LIQUIDITY = { id: 'liq00001', label: 'Liquidity', archivedAt: null, values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }] };
const DIALOG = '.dialog, dialog, [role="dialog"]';

// The open dialog's visible fields, each with the accessibility tree's
// name for it and the lines of the dialog's visible text.
const fields = async () => {
  const { result: global } = await page.send('Runtime.evaluate', { expression: 'globalThis' });
  const { result: list } = await page.send('Runtime.callFunctionOn', {
    objectId: global.objectId,
    functionDeclaration: ((dialogs) => [...document.querySelectorAll(dialogs)].filter((d) => d.checkVisibility())
      .flatMap((d) => [...d.querySelectorAll('input, select, textarea')]).filter((n) => n.checkVisibility())).toString(),
    arguments: [{ value: DIALOG }],
  });
  const { result: props } = await page.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true });
  const out = [];
  for (const prop of props.filter((p) => /^\d+$/.test(p.name))) {
    const { objectId } = prop.value;
    const { nodes } = await page.send('Accessibility.getPartialAXTree', { objectId, fetchRelatives: false });
    const { result } = await page.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: function (dialogs) {
        return {
          lines: this.closest(dialogs).innerText.split('\n').map((l) => l.trim()).filter(Boolean),
          kind: this.tagName === 'INPUT' ? this.type : this.tagName.toLowerCase(),
        };
      }.toString(),
      arguments: [{ value: DIALOG }],
      returnByValue: true,
    });
    out.push({ ...result.value, ignored: nodes[0].ignored, name: nodes[0].name?.value ?? '' });
  }
  return out;
};

// A field a person types into, as opposed to a choice between options.
const typed = (c) => !['radio', 'checkbox', 'button', 'submit', 'hidden'].includes(c.kind);
// The name is one whole line of the dialog's visible text, so a name the
// eye cannot see, or one with other words run into it, fails.
const beside = (c) => !c.ignored && c.name !== '' && c.lines.includes(c.name);
// A choice's label may carry a line of explanation, so its name need only
// be text the dialog shows.
const shown = (c) => !c.ignored && c.name !== '' && c.lines.join('\n').includes(c.name);

const openDialog = async (words, label) => {
  await page.call((name) => [...document.querySelectorAll('button, a')]
    .find((b) => b.textContent.trim().replace(/^\+\s*/, '') === name && b.checkVisibility()).click(), words);
  await page.waitUntil((dialogs) => [...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label });
  await page.idle();
};
const closeDialog = async () => {
  await page.key('Escape');
  await page.waitUntil((dialogs) => ![...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label: 'the dialog closed' });
  await page.idle();
};

const expect = (dialog, list, wanted) => {
  for (const name of wanted) {
    const found = list.filter((c) => c.name === name);
    check(`review 86: the ${dialog} has one field a screen reader names "${name}"`, found.length === 1, JSON.stringify(list.map((c) => c.name)));
    check(`review 86: the ${dialog}'s "${name}" field is named by the label beside it`, found.length === 1 && beside(found[0]), JSON.stringify(found));
  }
  const fieldsTyped = list.filter(typed);
  check(`review 86: every field typed into in the ${dialog} is named by the label beside it`,
    fieldsTyped.length >= wanted.length && fieldsTyped.every(beside), JSON.stringify(fieldsTyped.filter((c) => !beside(c))));
  check(`design-system: every choice in the ${dialog} is named by text it shows`,
    list.filter((c) => !typed(c)).every(shown), JSON.stringify(list.filter((c) => !typed(c) && !shown(c))));
};

await run(async () => {
  await vaultOwner();
  await holdings([['Lone account', 'CHF']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Lone account': '100.00' });
  await setProfile({ dimensions: [LIQUIDITY] });
  await unlockDashboard('the dashboard');
  await page.send('Accessibility.enable');

  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings' });
  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Liquidity') && document.body.innerText.includes('assigned')", {
    timeout: 20000, label: 'the dimensions screen',
  });
  await page.idle();

  // ---- Create a dimension ---------------------------------------------------
  await openDialog('Create a dimension', 'the create dialog');
  expect('create dialog', await fields(), ['Name', 'First value']);
  await closeDialog();

  // ---- Add value ------------------------------------------------------------
  await openDialog('Add value', 'the add value dialog');
  expect('add value dialog', await fields(), ['Label']);
  await closeDialog();
});
