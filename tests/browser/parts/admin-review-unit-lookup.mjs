// Reviewer's part for issue #186, written from spec/features/admin-invites.md
// (Admin, Units, criterion 56) and rate-lookup.md (Maintaining the
// table), blind to the change: the add form's Rate lookup is disabled
// at Entered by hand with the no-source reason beneath it, whichever
// kind is chosen, and a currency it adds that no source serves, XTS,
// lists disabled at Entered by hand with the reason in ink-secondary,
// before and after a reload, stored with lookup off. A seeded row with
// no source reads the same, and a row with a source can be turned off.
import { administrator, check, click, page, run, sql, watched } from '../harness.mjs';

const NO_SOURCE = 'No source for this unit yet. Rate lookup can be turned on once one is configured on the server.';

// Installed on the page: `__addForm`, the nearest element around the
// Add the unit button holding the Code and Name fields, and `__lookup`,
// the state of the Automatic / Entered by hand control inside an
// element, as a select or a pair of radios, with the no-source reason
// found there.
const install = () =>
  page.call((reason) => {
    window.__addForm = () => {
      let form = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add the unit');
      while (form && form.querySelectorAll('input').length < 2) form = form.parentElement;
      return form;
    };
    window.__lookup = (root) => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--ink-secondary)';
      document.body.append(probe);
      const secondary = getComputedStyle(probe).color;
      probe.remove();
      const holder = [...root.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.includes(reason));
      const select = [...root.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.trim() === 'Automatic'));
      const radios = [...root.querySelectorAll('input[type=radio]')];
      const labelOf = (input) => (input.closest('label') || input.labels[0] || input.parentElement).textContent.trim();
      let control = null;
      let at = null;
      let disabled = null;
      if (select) {
        control = select;
        at = select.options[select.selectedIndex].textContent.trim();
        disabled = select.disabled;
      } else if (radios.length) {
        control = radios[0].closest('fieldset') || radios[0].parentElement.parentElement;
        const chosen = radios.find((r) => r.checked);
        at = chosen ? labelOf(chosen) : null;
        disabled = radios.every((r) => r.disabled);
      }
      return {
        found: Boolean(control),
        at,
        disabled,
        reason: Boolean(holder),
        reasonInk: holder ? getComputedStyle(holder).color === secondary : null,
        beneath: holder && control ? holder.getBoundingClientRect().top >= control.getBoundingClientRect().bottom - 1 : null,
      };
    };
  }, NO_SOURCE);

const openUnits = async () => {
  await click('Invites');
  await click('Units');
  await page.waitUntil(
    () => [...document.querySelectorAll('td')].some((td) => td.textContent.trim() === 'XAU-ozt')
      && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add the unit'),
    { timeout: 60000, label: 'the units table' },
  );
  await page.call(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await install();
};

const formLookup = () =>
  page.call(() => {
    const form = window.__addForm();
    if (form.tagName === 'DETAILS') form.open = true;
    return { ...window.__lookup(form), labelled: form.innerText.includes('Rate lookup') };
  });

const rowLookup = (code) =>
  page.call((name) => {
    const tr = [...document.querySelectorAll('tr')].find((row) => row.querySelector('td') && row.querySelector('td').textContent.replace('Retired', '').trim() === name);
    return tr ? window.__lookup(tr) : null;
  }, code);

const setKind = (kind) =>
  page.call((value) => {
    const select = [...window.__addForm().querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'metal'));
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

const disabledByHand = (state) => state && state.found && state.disabled === true && state.at === 'Entered by hand';

await run(async () => {
  await administrator();
  await openUnits();

  // Criterion 56, the add form.
  const currencyForm = await formLookup();
  check('the add form has a Rate lookup control', currencyForm.found && currencyForm.labelled, JSON.stringify(currencyForm));
  check('the add form\'s Rate lookup is disabled at Entered by hand', disabledByHand(currencyForm), JSON.stringify(currencyForm));
  check('the no-source reason stands beneath it', currencyForm.reason && currencyForm.beneath === true, JSON.stringify(currencyForm));
  await setKind('metal');
  const metalForm = await formLookup();
  check(
    'for a metal it is still disabled at Entered by hand with the reason',
    disabledByHand(metalForm) && metalForm.reason,
    JSON.stringify(metalForm),
  );
  await setKind('currency');

  // Criterion 56, the currency it adds.
  await fillAdd('XTS', 'Testing code');
  await click('Add the unit');
  await page.waitUntil(() => [...document.querySelectorAll('td')].some((td) => td.textContent.trim() === 'XTS'), {
    label: 'the added XTS row',
  });
  const posted = watched[0].requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/admin/symbols'));
  check(
    'the add form sends lookup off',
    posted.length === 1 && JSON.parse(posted[0].body).lookup === false,
    posted.map((r) => r.body).join(' '),
  );
  check(
    'XTS is stored as a currency with lookup off',
    JSON.stringify(sql('SELECT kind, lookup FROM symbols WHERE symbol = ?', 'XTS')) === '[{"kind":"currency","lookup":0}]',
  );
  const added = await rowLookup('XTS');
  check('the added XTS row is disabled at Entered by hand at once', disabledByHand(added), JSON.stringify(added));
  check('the added XTS row carries the reason in ink-secondary', added && added.reason && added.reasonInk === true, JSON.stringify(added));

  await page.eval('location.reload()');
  await page.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
    timeout: 90000,
    label: 'the admin area again',
  });
  await openUnits();
  const reloaded = await rowLookup('XTS');
  check(
    'after a reload XTS still lists disabled at Entered by hand with the reason',
    disabledByHand(reloaded) && reloaded.reason && reloaded.reasonInk === true,
    JSON.stringify(reloaded),
  );

  // Units: a seeded row with no source reads the same, and turning off
  // stays available where there is one.
  const silver = await rowLookup('XAG-g');
  check('XAG-g is disabled at Entered by hand with the reason', disabledByHand(silver) && silver.reason, JSON.stringify(silver));
  const gold = await rowLookup('XAU-ozt');
  check(
    'XAU-ozt is enabled at Automatic with no reason',
    gold && gold.found && gold.disabled === false && gold.at === 'Automatic' && !gold.reason,
    JSON.stringify(gold),
  );
}, { signsIn: false });
