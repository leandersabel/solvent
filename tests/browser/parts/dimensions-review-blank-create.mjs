// Reviewer's part for issue #540, written from spec/features/account-settings.md
// (Dimensions, Creating; criteria 70 and 87) and spec/design-system.md
// (Components, Input: the message line) blind to the change. Create,
// Create a flag or Add with a blank or whitespace-only field keeps the
// dialog open and writes nothing. Each refused field shows its error on
// the message line it names in aria-describedby, in critical ink, polite,
// with aria-invalid, and the first refused field takes focus. Typing in a
// field clears its own error and no other. A filled dialog then writes
// one record.
//
// Text goes in as real typing, through the browser's own input pipeline,
// so the checks hold whichever event the screen listens to.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner, watched } from '../harness.mjs';

const NAME_BLANK = 'A name cannot be blank.';
const VALUE_BLANK = 'A value cannot be blank.';
const LIQUIDITY = { id: 'liq00001', label: 'Liquidity', archivedAt: null, values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }] };
const DIALOG = '.dialog, dialog, [role="dialog"]';

const puts = () => watched[0].requests.filter((r) => r.method === 'PUT').length;

const dialogOpen = () =>
  page.call((dialogs) => [...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), DIALOG);

const openDialog = async (words, label) => {
  await page.call((name) => [...document.querySelectorAll('button, a')]
    .find((b) => b.checkVisibility() && b.textContent.trim() === name).click(), words);
  await page.waitUntil((dialogs) => [...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label });
  await page.idle();
};
const closeDialog = async () => {
  await page.key('Escape');
  await page.waitUntil((dialogs) => ![...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label: 'the dialog closed' });
  await page.idle();
};

// Presses the open dialog's visible button named `name`.
const press = async (name) => {
  await page.call((dialogs, words) => {
    const dialog = [...document.querySelectorAll(dialogs)].find((d) => d.checkVisibility());
    [...dialog.querySelectorAll('button')].find((b) => b.checkVisibility() && b.textContent.trim() === words).click();
  }, DIALOG, name);
  await page.idle();
};

// Keeps the open dialog's field labelled `label` as `window.__field`.
const pick = (label) =>
  page.call((dialogs, name) => {
    const dialog = [...document.querySelectorAll(dialogs)].find((d) => d.checkVisibility());
    window.__field = [...dialog.querySelectorAll('label')].find((l) => l.checkVisibility() && l.textContent.trim() === name).control;
  }, DIALOG, label);

// Replaces what the field labelled `label` holds with `text`, typed. A
// fresh dialog's field is empty, so an empty `text` leaves it as it is.
const typeOver = async (label, text) => {
  await pick(label);
  await page.call(() => { window.__field.focus(); window.__field.select(); });
  if (text !== '') await page.send('Input.insertText', { text });
  await page.frames();
};

// The field labelled `label` and the message line it names.
const fieldState = async (label, copy) => {
  await pick(label);
  return page.call((dialogs, words) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--status-critical)';
    document.body.append(probe);
    const critical = getComputedStyle(probe).color;
    probe.remove();
    const f = window.__field;
    const lines = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)).filter(Boolean);
    const errorLine = lines.find((l) => l.textContent.includes(words));
    const box = f.getBoundingClientRect();
    return {
      value: f.value,
      focused: document.activeElement === f,
      invalid: f.getAttribute('aria-invalid') === 'true',
      onLine: Boolean(errorLine),
      critical: Boolean(errorLine) && getComputedStyle(errorLine).color === critical,
      polite: Boolean(errorLine) && (errorLine.closest('[aria-live="polite"]') !== null || errorLine.closest('[role="status"]') !== null),
      under: Boolean(errorLine) && errorLine.getBoundingClientRect().top >= box.bottom - 1
        && errorLine.getBoundingClientRect().top - box.bottom < 24,
      shown: f.closest(dialogs).innerText.includes(words),
    };
  }, DIALOG, copy);
};

// The field is refused: its error on its own line, wired as the design
// system says.
const refused = (s) => s.invalid && s.onLine && s.critical && s.polite && s.under;
const clear = (s) => !s.invalid && !s.onLine;

// The top edge of the dialog's buttons, which sit below every field: an
// error that comes or goes moves none of them (design-system.md,
// Components, Input: the form never grows or shifts).
const buttonsTop = () =>
  page.call((dialogs) => {
    const dialog = [...document.querySelectorAll(dialogs)].find((d) => d.checkVisibility());
    return Math.round(Math.min(...[...dialog.querySelectorAll('button')].filter((b) => b.checkVisibility())
      .map((b) => b.getBoundingClientRect().top)));
  }, DIALOG);

const dimensionLabels = () =>
  page.call(async () => (await import('/static/js/session.js')).currentVault().profile.dimensions.map((d) => d.label));

await run(async () => {
  await vaultOwner();
  await holdings([['Lone account', 'CHF']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Lone account': '100.00' });
  await setProfile({ dimensions: [LIQUIDITY] });
  await unlockDashboard('the dashboard');
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.querySelector('.link-row[href=\"/settings/dimensions\"]')", { label: 'settings' });
  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Liquidity') && document.body.innerText.includes('assigned')", {
    timeout: 20000, label: 'the dimensions screen',
  });
  await page.idle();
  const startLabels = JSON.stringify(await dimensionLabels());

  // ---- Create, both fields blank, then whitespace -------------------------
  for (const [what, text] of [['blank', ''], ['whitespace-only', '   ']]) {
    await openDialog('+ Create a dimension', 'the create dialog');
    const still = await buttonsTop();
    await typeOver('Name', text);
    await typeOver('First value', text);
    const before = puts();
    await press('Create');
    const name = await fieldState('Name', NAME_BLANK);
    const value = await fieldState('First value', VALUE_BLANK);
    check(`review 87: Create with a ${what} Name and First value keeps the dialog open and writes nothing`,
      (await dialogOpen()) && puts() === before && JSON.stringify(await dimensionLabels()) === startLabels, String(puts() - before));
    check(`review 87: Create with a ${what} Name shows "${NAME_BLANK}" on the Name field's message line with aria-invalid`,
      refused(name), JSON.stringify(name));
    check(`review 87: Create with a ${what} First value shows "${VALUE_BLANK}" on the First value field's message line with aria-invalid`,
      refused(value), JSON.stringify(value));
    check(`review 87: Create with both fields ${what} focuses Name, the first refused field`, name.focused, JSON.stringify(name));
    check(`design-system Input: the ${what} Create's errors move none of the dialog's buttons`, (await buttonsTop()) === still, `${still} -> ${await buttonsTop()}`);

    await typeOver('Name', 'G');
    const typedName = await fieldState('Name', NAME_BLANK);
    const otherValue = await fieldState('First value', VALUE_BLANK);
    check(`review 87: typing in Name clears its error after a ${what} Create`, clear(typedName) && typedName.value === 'G', JSON.stringify(typedName));
    check(`review 87: typing in Name leaves the First value error standing after a ${what} Create`, refused(otherValue), JSON.stringify(otherValue));
    await typeOver('First value', 'S');
    const typedValue = await fieldState('First value', VALUE_BLANK);
    check(`review 87: typing in First value clears its error after a ${what} Create`, clear(typedValue) && typedValue.value === 'S', JSON.stringify(typedValue));
    check(`review 87: no error is left once both fields are typed after a ${what} Create`, puts() === before && (await buttonsTop()) === still);
    await closeDialog();
  }

  // ---- Create, Name filled and First value blank ---------------------------
  await openDialog('+ Create a dimension', 'the create dialog');
  await typeOver('Name', 'Growth');
  await typeOver('First value', ' ');
  let before = puts();
  await press('Create');
  const keptName = await fieldState('Name', NAME_BLANK);
  const onlyValue = await fieldState('First value', VALUE_BLANK);
  check('review 87: Create with only First value blank keeps the dialog open and writes nothing',
    (await dialogOpen()) && puts() === before, String(puts() - before));
  check('review 87: Create with only First value blank refuses First value alone',
    refused(onlyValue) && clear(keptName) && keptName.value === 'Growth', JSON.stringify({ keptName, onlyValue }));
  check('review 87: Create with only First value blank focuses First value, the first refused field', onlyValue.focused, JSON.stringify(onlyValue));

  // A refused Create, then the field filled, writes one record.
  await typeOver('First value', 'Stable');
  await press('Create');
  await page.waitUntil((dialogs) => ![...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label: 'the create dialog closed' });
  await page.idle();
  check('review 70: a Create filled in after a refusal writes one record', puts() === before + 1, String(puts() - before));
  check('review 87: a Create filled in after a refusal adds the dimension', (await dimensionLabels()).includes('Growth'), JSON.stringify(await dimensionLabels()));

  // ---- Create a flag, Name blank -------------------------------------------
  for (const [what, text] of [['blank', ''], ['whitespace-only', '  ']]) {
    await openDialog('+ Create a dimension', 'the create dialog');
    await typeOver('Name', text);
    before = puts();
    const labelsBefore = JSON.stringify(await dimensionLabels());
    await press('Create a flag');
    const name = await fieldState('Name', NAME_BLANK);
    const value = await fieldState('First value', VALUE_BLANK);
    check(`review 87: Create a flag with a ${what} Name keeps the dialog open and writes nothing`,
      (await dialogOpen()) && puts() === before && JSON.stringify(await dimensionLabels()) === labelsBefore, String(puts() - before));
    check(`review 87: Create a flag with a ${what} Name shows "${NAME_BLANK}" on the Name field's message line with aria-invalid`,
      refused(name), JSON.stringify(name));
    check(`review 87: Create a flag with a ${what} Name focuses Name`, name.focused, JSON.stringify(name));
    check(`account-settings Creating: Create a flag, which needs one field, refuses no blank First value`, clear(value), JSON.stringify(value));
    await typeOver('Name', 'E');
    const typed = await fieldState('Name', NAME_BLANK);
    check(`review 87: typing in Name clears its error after a ${what} Create a flag`, clear(typed), JSON.stringify(typed));
    await closeDialog();
  }

  // ---- Add value, Label blank ----------------------------------------------
  for (const [what, text] of [['blank', ''], ['whitespace-only', ' \t ']]) {
    await page.call(() => [...document.querySelectorAll('button')]
      .find((b) => b.checkVisibility() && b.textContent.trim() === '+ Add value').click());
    await page.waitUntil((dialogs) => [...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label: 'the add value dialog' });
    await page.idle();
    const still = await buttonsTop();
    await typeOver('Label', text);
    before = puts();
    await press('Add');
    const label = await fieldState('Label', NAME_BLANK);
    check(`review 87: Add with a ${what} Label keeps the dialog open and writes nothing`,
      (await dialogOpen()) && puts() === before, String(puts() - before));
    check(`review 87: Add with a ${what} Label shows "${NAME_BLANK}" on the Label field's message line with aria-invalid`,
      refused(label), JSON.stringify(label));
    check(`review 87: Add with a ${what} Label focuses Label`, label.focused, JSON.stringify(label));
    check(`design-system Input: the ${what} Add's error moves none of the dialog's buttons`, (await buttonsTop()) === still, `${still} -> ${await buttonsTop()}`);
    await typeOver('Label', 'B');
    const typed = await fieldState('Label', NAME_BLANK);
    check(`review 87: typing in Label clears its error after a ${what} Add`, clear(typed) && typed.value === 'B', JSON.stringify(typed));
    await closeDialog();
  }

  // A refused Add, then a label typed, writes one record, shown as text.
  await page.call(() => [...document.querySelectorAll('button')]
    .find((b) => b.checkVisibility() && b.textContent.trim() === '+ Add value').click());
  await page.waitUntil((dialogs) => [...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label: 'the add value dialog' });
  await page.idle();
  await typeOver('Label', ' ');
  before = puts();
  await press('Add');
  const markup = '<img src=x onerror="window.__injected=1">';
  await typeOver('Label', markup);
  await press('Add');
  await page.waitUntil((dialogs) => ![...document.querySelectorAll(dialogs)].some((d) => d.checkVisibility()), { args: [DIALOG], label: 'the add value dialog closed' });
  await page.idle();
  check('review 70: an Add filled in after a refusal writes one record', puts() === before + 1, String(puts() - before));
  check('architecture: a value label typed as markup renders as text',
    (await page.call((words) => document.body.innerText.includes(words) && !document.querySelector('#app img[src="x"]') && !window.__injected, markup)));
});
