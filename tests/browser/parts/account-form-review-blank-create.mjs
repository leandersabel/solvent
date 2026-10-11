// Reviewer's part for issue #546, written from spec/features/manage-accounts.md
// (Account form, Fields, Dimensions; acceptance criterion 68) and
// spec/design-system.md (Components, Input: the message line) blind to the
// change. On Add a holding, Add under `+ New value` with a blank or
// whitespace-only field, or under `+ New dimension` with a blank Dimension
// name or First value, writes nothing and refuses each blank field on the
// message line it names in aria-describedby: in critical ink, under the
// field, in a polite live region, with aria-invalid, and nowhere else on
// the form. The first refused field takes focus, the form does not shift,
// and typing in a field clears its own error and no other. A filled Add
// after a refusal then creates what it was asked to.
//
// Every round runs at the default window, where the form is its full
// width, and at phone width.
//
// Fields are found by the names a screen reader gives them, text goes in
// as real typing and Add is pressed with the mouse, so the checks hold
// whichever event the form listens to.
import { check, holdings, page, recording, run, setProfile, unlockDashboard, vaultOwner, watched } from '../harness.mjs';

const VALUE_BLANK = 'A value needs a name.';
const NAME_BLANK = 'A dimension needs a name.';
const FIRST_BLANK = 'A dimension needs a first value.';
const NEW_VALUE = 'New Liquidity value';
const DIMENSION_NAME = 'Dimension name';
const FIRST_VALUE = 'First value';
const LIQUIDITY = {
  id: 'liq00001', label: 'Liquidity', archivedAt: null,
  values: [{ id: 'cash0001', label: 'Cash', archivedAt: null }, { id: 'inv00001', label: 'Invested', archivedAt: null }],
};

const puts = () => watched[0].requests.filter((r) => r.method === 'PUT').length;
const profileNow = () =>
  page.call(async () => JSON.stringify((await import('/static/js/session.js')).currentVault().profile.dimensions));

// Keeps the visible form field whose accessible name is `name` as `window.__field`.
const pick = (name) =>
  page.call((wanted) => {
    const form = document.querySelector('#holding-name').form;
    const named = (f) => (f.getAttribute('aria-label') || f.labels?.[0]?.textContent || '').trim();
    window.__field = [...form.querySelectorAll('input')].find((f) => f.checkVisibility() && named(f) === wanted);
    return Boolean(window.__field);
  }, name);

const centerOf = (js) =>
  page.call((code) => {
    const n = (0, eval)(code);
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, js);
const pressAt = async (js) => {
  const { x, y } = await centerOf(js);
  await page.mouseClick(x, y);
  await page.idle();
};

// Presses the first visible Add that follows the field named `name`.
const addAfter = async (name) => {
  await pick(name);
  await pressAt(`[...window.__field.form.querySelectorAll('button')].find((b) => b.checkVisibility()
    && b.textContent.trim() === 'Add' && (window.__field.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))`);
};

// Replaces what the field named `name` holds with `text`, typed.
const typeOver = async (name, text) => {
  await pick(name);
  await pressAt('window.__field');
  await page.call(() => window.__field.select());
  const key = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  if (text !== '') await page.send('Input.insertText', { text });
  await page.frames();
};

// The field named `name` and the message line it names, against `copy`.
const fieldState = async (name, copy) => {
  await pick(name);
  return page.call((words) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--status-critical)';
    document.body.append(probe);
    const critical = getComputedStyle(probe).color;
    probe.remove();
    const f = window.__field;
    const lines = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map((id) => document.getElementById(id)).filter(Boolean);
    const line = lines.find((l) => l.checkVisibility() && l.textContent.includes(words));
    const box = f.getBoundingClientRect();
    const formText = f.form.innerText;
    return {
      value: f.value,
      focused: document.activeElement === f,
      invalid: f.getAttribute('aria-invalid') === 'true',
      onLine: Boolean(line),
      critical: Boolean(line) && getComputedStyle(line).color === critical,
      polite: Boolean(line) && (line.closest('[aria-live="polite"]') !== null || line.closest('[role="status"]') !== null),
      under: Boolean(line) && line.getBoundingClientRect().top >= box.bottom - 1 && line.getBoundingClientRect().top - box.bottom < 24,
      // The copy shows once on the form, on this field's line, and in no
      // form-level or shared line besides.
      once: formText.split(words).length - 1 === 1,
      elsewhere: [...f.form.querySelectorAll('[role="alert"], .field-error')]
        .some((n) => !lines.includes(n) && n.checkVisibility() && n.textContent.includes(words)),
    };
  }, copy);
};

const refused = (s) => s.invalid && s.onLine && s.critical && s.polite && s.under && s.once && !s.elsewhere;
const clear = (s) => !s.invalid && !s.onLine;

// The top edge of Save, below every field: an error that comes or goes
// moves nothing beneath it (design-system.md, Components, Input).
const saveTop = () =>
  page.call(() => {
    // From the form's own top, so a scroll in between changes nothing.
    const form = document.querySelector('#holding-name').form;
    return Math.round(form.querySelector('button[type=submit]').getBoundingClientRect().top - form.getBoundingClientRect().top);
  });

const openAdd = async () => {
  await page.eval("location.hash = '#/'");
  await page.waitUntil("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add a holding')", { label: 'Add a holding' });
  await page.call(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add a holding').click());
  await page.waitUntil("document.querySelector('#holding-name') && document.querySelector('.unit-option')", { label: 'the holding form' });
  await page.idle();
};
const closeForm = async () => {
  await page.key('Escape');
  await page.waitUntil("!document.querySelector('#holding-name')", { label: 'the holding form closed' });
  await page.idle();
};
const chooseNewValue = async () => {
  await page.call(() => {
    const select = [...document.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Liquidity'
      || s.labels?.[0]?.textContent.trim() === 'Liquidity');
    select.value = [...select.options].find((o) => o.textContent.trim() === '+ New value').value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.idle();
};
const openNewDimension = () => pressAt("[...document.querySelectorAll('button')].find((b) => b.checkVisibility() && b.textContent.trim() === '+ New dimension')");

// Each round at window width `width`, or at the default window with null.
const rounds = async (width) => {
  const at = width ? `${width}px` : 'default width';
  if (width) await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: false });
  await page.frames();
  const startProfile = await profileNow();

  // ---- + New value, blank then whitespace ----------------------------------
  for (const [what, text] of [['blank', ''], ['whitespace-only', '   ']]) {
    await openAdd();
    await chooseNewValue();
    check(`${at}: review 68: + New value opens a field named "${NEW_VALUE}"`, await pick(NEW_VALUE));
    const still = await saveTop();
    await typeOver(NEW_VALUE, text);
    const before = puts();
    await addAfter(NEW_VALUE);
    const value = await fieldState(NEW_VALUE, VALUE_BLANK);
    check(`${at}: review 68: Add with a ${what} + New value writes nothing`,
      puts() === before && (await profileNow()) === startProfile, String(puts() - before));
    check(`${at}: review 68: Add with a ${what} + New value shows "${VALUE_BLANK}" on the field's own message line with aria-invalid`,
      refused(value), JSON.stringify(value));
    check(`${at}: manage-accounts Fields: Add with a ${what} + New value focuses the refused field`, value.focused, JSON.stringify(value));
    check(`${at}: design-system Input: the ${what} + New value refusal moves nothing beneath it`, (await saveTop()) === still, `${still} -> ${await saveTop()}`);
    await typeOver(NEW_VALUE, 'L');
    const typed = await fieldState(NEW_VALUE, VALUE_BLANK);
    check(`${at}: design-system Input: typing in + New value clears its error after a ${what} Add`, clear(typed) && typed.value === 'L', JSON.stringify(typed));
    await closeForm();
  }

  // A refused Add, then the field filled, creates the value.
  await openAdd();
  await chooseNewValue();
  await typeOver(NEW_VALUE, ' ');
  await addAfter(NEW_VALUE);
  await typeOver(NEW_VALUE, `Locked ${at}`);
  await addAfter(NEW_VALUE);
  await page.waitUntil(async (wanted) => (await import('/static/js/session.js')).currentVault().profile.dimensions
    .some((d) => d.values.some((v) => v.label === wanted)), { args: [`Locked ${at}`], label: 'the new value in the profile' });
  check(`${at}: review 68: a + New value Add filled in after a refusal adds the value and selects it`,
    await page.call((wanted) => [...document.querySelectorAll('select')].some((s) => s.selectedOptions[0]?.textContent.trim() === wanted), `Locked ${at}`));
  await closeForm();

  // ---- + New dimension, both blank then both whitespace --------------------
  for (const [what, text] of [['blank', ''], ['whitespace-only', '  ']]) {
    await openAdd();
    await openNewDimension();
    check(`${at}: review 68: + New dimension opens fields named "${DIMENSION_NAME}" and "${FIRST_VALUE}"`,
      (await pick(DIMENSION_NAME)) && (await pick(FIRST_VALUE)));
    const still = await saveTop();
    const profileBefore = await profileNow();
    await typeOver(DIMENSION_NAME, text);
    await typeOver(FIRST_VALUE, text);
    const before = puts();
    await addAfter(FIRST_VALUE);
    const name = await fieldState(DIMENSION_NAME, NAME_BLANK);
    const first = await fieldState(FIRST_VALUE, FIRST_BLANK);
    check(`${at}: review 68: Add with a ${what} Dimension name and First value writes nothing`,
      puts() === before && (await profileNow()) === profileBefore, String(puts() - before));
    check(`${at}: review 68: Add with a ${what} Dimension name shows "${NAME_BLANK}" on its own message line with aria-invalid`,
      refused(name), JSON.stringify(name));
    check(`${at}: review 68: Add with a ${what} First value shows "${FIRST_BLANK}" on its own message line with aria-invalid`,
      refused(first), JSON.stringify(first));
    check(`${at}: manage-accounts Fields: Add with both fields ${what} focuses Dimension name, the first refused field`, name.focused, JSON.stringify(name));
    check(`${at}: design-system Input: the ${what} + New dimension refusals move nothing beneath them`, (await saveTop()) === still, `${still} -> ${await saveTop()}`);

    await typeOver(DIMENSION_NAME, 'G');
    const typedName = await fieldState(DIMENSION_NAME, NAME_BLANK);
    const standing = await fieldState(FIRST_VALUE, FIRST_BLANK);
    check(`${at}: design-system Input: typing in Dimension name clears its error after a ${what} Add`, clear(typedName) && typedName.value === 'G', JSON.stringify(typedName));
    check(`${at}: design-system Input: typing in Dimension name leaves the First value error standing after a ${what} Add`, refused(standing), JSON.stringify(standing));
    await typeOver(FIRST_VALUE, 'S');
    const typedFirst = await fieldState(FIRST_VALUE, FIRST_BLANK);
    check(`${at}: design-system Input: typing in First value clears its error after a ${what} Add`, clear(typedFirst) && typedFirst.value === 'S', JSON.stringify(typedFirst));
    await closeForm();
  }

  // ---- + New dimension, one field blank ------------------------------------
  await openAdd();
  await openNewDimension();
  const profileBefore = await profileNow();
  await typeOver(DIMENSION_NAME, `Growth ${at}`);
  let before = puts();
  await addAfter(FIRST_VALUE);
  let name = await fieldState(DIMENSION_NAME, NAME_BLANK);
  let first = await fieldState(FIRST_VALUE, FIRST_BLANK);
  check(`${at}: review 68: Add with only First value blank writes nothing`, puts() === before && (await profileNow()) === profileBefore, String(puts() - before));
  check(`${at}: review 68: Add with only First value blank refuses First value alone`,
    refused(first) && clear(name) && name.value === `Growth ${at}`, JSON.stringify({ name, first }));
  check(`${at}: manage-accounts Fields: Add with only First value blank focuses First value`, first.focused, JSON.stringify(first));

  await typeOver(DIMENSION_NAME, '');
  await typeOver(FIRST_VALUE, 'Stable');
  before = puts();
  await addAfter(FIRST_VALUE);
  name = await fieldState(DIMENSION_NAME, NAME_BLANK);
  first = await fieldState(FIRST_VALUE, FIRST_BLANK);
  check(`${at}: review 68: Add with only Dimension name blank writes nothing`, puts() === before && (await profileNow()) === profileBefore, String(puts() - before));
  check(`${at}: review 68: Add with only Dimension name blank refuses Dimension name alone`,
    refused(name) && clear(first) && first.value === 'Stable', JSON.stringify({ name, first }));
  check(`${at}: manage-accounts Fields: Add with only Dimension name blank focuses Dimension name`, name.focused, JSON.stringify(name));

  // A refused Add, then the name typed, creates the dimension.
  await typeOver(DIMENSION_NAME, `Growth ${at}`);
  await addAfter(FIRST_VALUE);
  await page.waitUntil(async (wanted) => (await import('/static/js/session.js')).currentVault().profile.dimensions
    .some((d) => d.label === wanted && d.values.some((v) => v.label === 'Stable')), { args: [`Growth ${at}`], label: 'the new dimension in the profile' });
  check(`${at}: review 68: a + New dimension Add filled in after a refusal adds the dimension with its first value`, true);
  await closeForm();
};

await run(async () => {
  await vaultOwner();
  await holdings([['Lone account', 'CHF']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Lone account': '100.00' });
  await setProfile({ dimensions: [LIQUIDITY] });
  await unlockDashboard('the dashboard');
  for (const width of [null, 390, 320]) await rounds(width);
});
