// Reviewer's part for issue #185, written from spec/features/admin-invites.md
// (Admin, Units, its States, criteria 54 and 55) and rate-lookup.md
// (Seeded symbols), blind to the change: adding a metal that names no
// weight is refused in the add form with the metal copy, every field
// kept and nothing added, an invalid currency gets the currency copy,
// and a retired metal that names no weight has Restore disabled with
// its reason in ink-secondary while a retired XAG-g and a retired
// currency are restored.
//
// The weightless metal is written to the database retired, as the
// server leaves one at start.
import { administrator, check, click, expectedFailures, page, run, sql, watched } from '../harness.mjs';

const METAL_REFUSAL = 'That is not a valid metal code. Metals are named <code>-ozt or <code>-g, such as XAU-ozt.';
const CODE_REFUSAL = 'That is not a valid code. Use letters, digits, dots, dashes and underscores, starting with a letter or digit.';
const NO_WEIGHT = 'It names no weight, so it cannot be restored. Metals are named <code>-ozt or <code>-g, such as XAU-ozt.';

// The add form, installed on the page as `__addForm`: the nearest
// element around the Add the unit button holding the Code and Name
// fields.
const installAddForm = () =>
  page.call(() => {
    window.__addForm = () => {
      let form = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add the unit');
      while (form && form.querySelectorAll('input').length < 2) form = form.parentElement;
      return form;
    };
  });

const fillAdd = (code, name, kind) =>
  page.call(
    (values) => {
      const form = window.__addForm();
      if (form.tagName === 'DETAILS') form.open = true;
      const [codeField, nameField] = form.querySelectorAll('input');
      const set = (field, value) => {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(codeField, values.code);
      set(nameField, values.name);
      set(form.querySelector('select'), values.kind);
    },
    { code, name, kind },
  );

const addFormState = () =>
  page.call(() => {
    const form = window.__addForm();
    const [codeField, nameField] = form.querySelectorAll('input');
    return { text: form.innerText, code: codeField.value, name: nameField.value, kind: form.querySelector('select').value };
  });

// Each table row keyed by its code: whether its Restore or Retire
// button is disabled, the row's text, and the color of the element
// holding the no-weight reason, if any.
const unitRows = () =>
  page.call((reason) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--ink-secondary)';
    document.body.append(probe);
    const secondary = getComputedStyle(probe).color;
    probe.remove();
    const out = {};
    for (const tr of document.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('td');
      if (!cells.length) continue;
      const code = cells[0].textContent.replace('Retired', '').trim();
      const button = [...tr.querySelectorAll('button')].find((b) => ['Restore', 'Retire'].includes(b.textContent.trim()));
      const holder = [...tr.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.includes(reason.slice(0, 20)));
      out[code] = {
        action: button && button.textContent.trim(),
        disabled: button ? button.disabled : null,
        text: tr.textContent,
        reasonInk: holder ? getComputedStyle(holder).color === secondary : null,
      };
    }
    return out;
  }, NO_WEIGHT);

const openUnits = async () => {
  await click('Invites');
  await click('Units');
  await page.waitUntil(
    () => [...document.querySelectorAll('td')].some((td) => td.textContent.trim() === 'XAU-ozt')
      && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add the unit'),
    { timeout: 60000, label: 'the units table' },
  );
  await page.call(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await installAddForm();
};

const restore = async (code) => {
  await page.call((name) => {
    const tr = [...document.querySelectorAll('tr')].find((row) => row.querySelector('td') && row.querySelector('td').textContent.includes(name));
    [...tr.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Restore').click();
  }, code);
  await page.waitUntil(() => [...document.querySelectorAll('.dialog button')].some((b) => b.textContent.trim() === 'Restore'), {
    label: `the restore dialog for ${code}`,
  });
  await page.call(() => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Restore').click());
};

const retiredIn = (code) => sql('SELECT retired FROM symbols WHERE symbol = ?', code)[0].retired;
const restored = async (code) => {
  const deadline = Date.now() + 10000;
  while (retiredIn(code) !== 0 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
};

await run(async () => {
  await administrator();
  await openUnits();

  // Criterion 54: XYZ as a metal.
  const before = sql('SELECT COUNT(*) AS n FROM symbols')[0].n;
  expectedFailures.add('/api/admin/symbols');
  await fillAdd('XYZ', 'Test', 'metal');
  await click('Add the unit');
  await page.waitUntil((words) => window.__addForm().innerText.includes(words), {
    args: [METAL_REFUSAL],
    label: 'the metal refusal in the add form',
  });
  const refused = await addFormState();
  check('adding XYZ as a metal shows the metal refusal in the add form', refused.text.includes(METAL_REFUSAL), refused.text);
  check(
    'every field of the refused metal is kept',
    refused.code === 'XYZ' && refused.name === 'Test' && refused.kind === 'metal',
    JSON.stringify(refused),
  );
  check(
    'the refused metal is in neither the unit list nor the database',
    !('XYZ' in (await unitRows())) && sql('SELECT COUNT(*) AS n FROM symbols')[0].n === before,
  );

  // Units, States: an invalid currency code reads the currency copy.
  await fillAdd('xyz', 'Test', 'currency');
  await click('Add the unit');
  await page.waitUntil((words) => window.__addForm().innerText.includes(words), {
    args: [CODE_REFUSAL],
    label: 'the currency refusal in the add form',
  });
  const currency = await addFormState();
  check(
    'an invalid currency code reads the currency refusal and not the metal one',
    currency.text.includes(CODE_REFUSAL) && !currency.text.includes('not a valid metal code'),
    currency.text,
  );
  expectedFailures.delete('/api/admin/symbols');

  // Criterion 55.
  sql("INSERT INTO symbols (symbol, label, kind, lookup, retired) VALUES ('XRH', 'Rhodium', 'metal', 0, 1)");
  sql("UPDATE symbols SET retired = 1 WHERE symbol IN ('XAG-g', 'USD')");
  await openUnits();
  const rows = await unitRows();
  check(
    'a retired metal that names no weight has Restore disabled',
    rows.XRH && rows.XRH.action === 'Restore' && rows.XRH.disabled === true,
    JSON.stringify(rows.XRH),
  );
  check(
    'its reason stands beside it in ink-secondary',
    rows.XRH && rows.XRH.text.includes(NO_WEIGHT) && rows.XRH.reasonInk === true,
    JSON.stringify(rows.XRH),
  );
  check(
    'a retired XAG-g and a retired currency offer Restore, enabled and with no such reason',
    ['XAG-g', 'USD'].every((code) => rows[code] && rows[code].action === 'Restore' && rows[code].disabled === false
      && !rows[code].text.includes('names no weight')),
    JSON.stringify([rows['XAG-g'], rows.USD]),
  );

  const patches = () => watched[0].requests.filter((r) => r.method === 'PATCH' && r.url.includes('/api/admin/symbols/')).length;
  const sent = patches();
  await restore('XAG-g');
  await restored('XAG-g');
  await openUnits();
  await restore('USD');
  await restored('USD');
  check(
    'restoring XAG-g and the currency puts both back',
    retiredIn('XAG-g') === 0 && retiredIn('USD') === 0 && patches() === sent + 2,
    `${retiredIn('XAG-g')} ${retiredIn('USD')} ${patches() - sent}`,
  );
  check('the weightless metal is still retired', retiredIn('XRH') === 1);
}, { signsIn: false });
