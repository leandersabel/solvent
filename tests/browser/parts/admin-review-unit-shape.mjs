// Reviewer's part for issue #454, written from spec/features/admin-invites.md
// (Admin, Units, Add a unit; criteria 54, 59 and 63), blind to the
// change: the metal naming line stands beneath Code, after the line
// that a code is permanent, only while Kind is Metal, whichever way
// Kind gets there. A screen reader still names Code by its label alone,
// and a metal code that names no weight is refused in the form with the
// unit list left without it.
import { administrator, check, click, expectedFailures, page, run, sql } from '../harness.mjs';

const SHAPE = 'Metals are named <code>-ozt or <code>-g, such as XAU-ozt.';
const PERMANENT = 'A code is permanent.';
const REFUSED = `That is not a valid metal code. ${SHAPE}`;

// Installed on the page: `__addForm`, the nearest element around the
// Add the unit button holding the Code and Name fields, and `__shape`,
// what of the naming line a person sees in it and where.
const install = () =>
  page.call((shape, permanent) => {
    const flat = (n) => n.textContent.replace(/\s+/g, ' ').trim();
    window.__addForm = () => {
      let form = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add the unit');
      while (form && form.querySelectorAll('input').length < 2) form = form.parentElement;
      return form;
    };
    window.__kind = () => [...window.__addForm().querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'metal'));
    window.__shape = () => {
      const form = window.__addForm();
      if (form.tagName === 'DETAILS') form.open = true;
      const [code] = form.querySelectorAll('input:not([type=radio])');
      code.dataset.reviewCode = '';
      const seen = (n) => n.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && n.getClientRects().length > 0;
      // The smallest elements reading the line exactly, so an error
      // that quotes it is not taken for it.
      const lines = [...form.querySelectorAll('*')].filter((n) => flat(n) === shape && ![...n.children].some((c) => flat(c) === shape));
      const shown = lines.filter(seen);
      const above = [...form.querySelectorAll('*')].find((n) => n.children.length === 0 && seen(n) && flat(n).startsWith(permanent));
      const box = (n) => n.getBoundingClientRect();
      const line = shown[0];
      return {
        kind: window.__kind().value,
        shown: shown.length,
        beneathCode: line ? box(line).top >= box(code).bottom - 1 && box(line).left < box(code).right && box(line).right > box(code).left : null,
        afterPermanent: line && above ? box(line).top >= box(above).bottom - 1 : null,
        // Whether anything a person sees in the form mentions the shape.
        mentioned: form.innerText.includes('Metals are named'),
      };
    };
  }, SHAPE, PERMANENT);

const shape = () => page.call(() => window.__shape());

const setKind = (kind) =>
  page.call((value) => {
    const select = window.__kind();
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, kind);

const fillAdd = (code, name) =>
  page.call((values) => {
    const [codeField, nameField] = window.__addForm().querySelectorAll('input:not([type=radio])');
    for (const [field, value] of [[codeField, values.code], [nameField, values.name]]) {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { code, name });

// The name the accessibility tree gives the Code field.
const codeName = async () => {
  await page.send('Accessibility.enable');
  const { root } = await page.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-review-code]' });
  const { nodes } = await page.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  return nodes[0].ignored ? null : (nodes[0].name?.value ?? '').trim();
};

const showsOnce = (s) => s.shown === 1 && s.beneathCode === true && s.afterPermanent === true;

await run(async () => {
  await administrator();
  await click('Invites');
  await click('Units');
  await page.waitUntil(
    () => [...document.querySelectorAll('td')].some((td) => td.textContent.trim() === 'XAU-ozt')
      && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add the unit'),
    { timeout: 60000, label: 'the units table' },
  );
  await install();

  // Criterion 63, the form as it opens.
  const opened = await shape();
  check(
    'as the form opens, the naming line shows exactly when Kind is Metal',
    opened.kind === 'metal' ? showsOnce(opened) : !opened.mentioned && opened.shown === 0,
    JSON.stringify(opened),
  );

  await setKind('currency');
  const currency = await shape();
  check('with Kind Currency the naming line is not shown', currency.shown === 0 && !currency.mentioned, JSON.stringify(currency));
  check('with Kind Currency a screen reader names Code "Code"', (await codeName()) === 'Code');

  await setKind('metal');
  const metal = await shape();
  check('with Kind Metal the naming line shows once', metal.shown === 1, JSON.stringify(metal));
  check('it stands beneath Code', metal.beneathCode === true, JSON.stringify(metal));
  check('it follows the line that a code is permanent', metal.afterPermanent === true, JSON.stringify(metal));
  check('with Kind Metal a screen reader still names Code "Code"', (await codeName()) === 'Code');

  await setKind('currency');
  const back = await shape();
  check('back at Currency the naming line goes again', back.shown === 0 && !back.mentioned, JSON.stringify(back));

  // Criterion 54, with the line shown.
  await setKind('metal');
  await fillAdd('XYZ', 'Not a weight');
  expectedFailures.add('/api/admin/symbols');
  await click('Add the unit');
  await page.waitUntil(
    (refused) => window.__addForm().innerText.replace(/\s+/g, ' ').includes(refused),
    { args: [REFUSED], label: 'the refusal in the add form' },
  );
  expectedFailures.delete('/api/admin/symbols');
  const refused = await shape();
  check('beside the refusal the naming line still shows once', showsOnce(refused), JSON.stringify(refused));
  check(
    'the unit list stays without XYZ',
    await page.call(() => ![...document.querySelectorAll('td')].some((td) => td.textContent.trim() === 'XYZ')),
  );
  check('XYZ is not stored', sql('SELECT symbol FROM symbols WHERE symbol = ?', 'XYZ').length === 0);

  // The line goes with the kind even while the refusal stands.
  await setKind('currency');
  const after = await shape();
  check('switching to Currency after the refusal hides the naming line', after.shown === 0, JSON.stringify(after));
}, { signsIn: false });
