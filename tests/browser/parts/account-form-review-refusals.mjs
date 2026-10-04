// The Account form's refusals, written from spec/features/manage-accounts.md
// (Account form, States, "Error, validation", and acceptance criteria 12,
// 17 and 60) and design-system.md (Components, Input, The message line)
// without reading how the form is built. A field's message line is found
// through the input's own aria-describedby, as the design system names it,
// and every keystroke and click is real input.
import {
  accountRows, check, holdings, openHolding, page, recording, run, vaultOwner,
} from '../harness.mjs';

const XSS = '<img src=x onerror=alert(1)>';

const visible = (selector) =>
  page.call((query) => {
    const n = document.querySelector(query);
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && n.closest('[hidden]') === null && getComputedStyle(n).visibility !== 'hidden';
  }, selector);

// The input's message line as a person and a screen reader meet it.
const lineOf = (id) =>
  page.call((at) => {
    const input = document.getElementById(at);
    const lineId = (input.getAttribute('aria-describedby') || '').split(/\s+/).find(Boolean);
    const line = lineId ? document.getElementById(lineId) : null;
    const shown = (n) => n && n.closest('[hidden]') === null && n.getBoundingClientRect().height > 0;
    const critical = (() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--status-critical)';
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    })();
    return {
      invalid: input.getAttribute('aria-invalid'),
      line: Boolean(line),
      live: line ? line.getAttribute('aria-live') : null,
      shown: Boolean(shown(line)),
      text: line && shown(line) ? line.textContent.trim() : '',
      red: Boolean(line && shown(line) && getComputedStyle(line).color === critical),
    };
  }, id);
// Where the input and its message line are drawn.
const placed = (id) =>
  page.call((at) => {
    const input = document.getElementById(at);
    const line = document.getElementById((input.getAttribute('aria-describedby') || '').split(/\s+/)[0]);
    // From the form's own top, so a scroll in between changes nothing.
    const top = input.form.getBoundingClientRect().top;
    const r = input.getBoundingClientRect();
    const l = line.getBoundingClientRect();
    return { inputTop: r.top - top, inputBottom: r.bottom - top, lineTop: l.top - top, lineHeight: l.height };
  }, id);
const refused = (state) => state.invalid === 'true' && state.shown && state.text !== '' && state.red;
const cleared = (state) => state.invalid !== 'true' && !state.red;

const centerOf = (selector) =>
  page.call((query) => {
    const n = document.querySelector(query);
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
const press = async (selector) => {
  const { x, y } = await centerOf(selector);
  await page.mouseClick(x, y);
  await page.frames();
};
const backspace = async () => {
  const key = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
};
// Replaces what `selector` holds with `text`, typed.
const type = async (selector, text) => {
  await press(selector);
  await page.call((query) => document.querySelector(query).select(), selector);
  await backspace();
  if (text) await page.send('Input.insertText', { text });
  await page.frames();
};
const save = async () => {
  await press('form button[type=submit]');
  await page.idle();
};
const accounts = () => JSON.parse(accountRows()).length;
const unitOf = (name) =>
  page.call(async (wanted) => {
    const v = (await import('/static/js/session.js')).currentVault();
    const h = [...v.holdings.values()].find((x) => x.payload.name === wanted);
    return h ? h.payload.unit : null;
  }, name);
const openAdd = async () => {
  await page.eval("location.hash = '#/'");
  await page.waitUntil("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add a holding')", { label: 'Add a holding' });
  await page.call(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add a holding').click());
  await page.waitUntil("document.querySelector('#holding-name') && document.querySelector('.unit-option')", { label: 'the holding form' });
  await page.frames();
};
const closeDialog = async () => {
  await page.call(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel').click());
  await page.frames();
};

await run(async () => {
  await vaultOwner();
  page.call(() => { window.__alerted = false; window.alert = () => { window.__alerted = true; }; });

  // --- Criterion 60, the name, on Add a holding.
  await openAdd();
  let before = accounts();
  let name = await lineOf('holding-name');
  check('the name input names a message line in aria-describedby', name.line);
  check('the name message line is a polite live region', name.live === 'polite', name.live);
  await save();
  name = await lineOf('holding-name');
  check('Save with no name refuses it on its own line, critical, with aria-invalid', refused(name), JSON.stringify(name));
  check('Save with no name writes nothing', accounts() === before);

  // A name of spaces: whatever the line says must be what Save does.
  await type('#holding-name', '   ');
  const spaces = await lineOf('holding-name');
  await save();
  const wroteSpaces = accounts() !== before;
  check(
    'a name of spaces is refused on the line exactly when Save refuses it',
    (cleared(spaces) && wroteSpaces) || (refused(spaces) && !wroteSpaces),
    `line ${JSON.stringify(spaces)}, wrote ${wroteSpaces}`,
  );
  if (wroteSpaces) {
    await openAdd();
    await save();
  }
  before = accounts();

  const whileRefused = await placed('holding-name');
  check('the name refusal sits directly under the name input', whileRefused.lineHeight > 0 && whileRefused.lineTop >= whileRefused.inputBottom - 0.5, JSON.stringify(whileRefused));
  await type('#holding-name', 'Z');
  const afterTyping = await placed('holding-name');
  check('the name input does not move as its refusal goes', Math.abs(afterTyping.inputTop - whileRefused.inputTop) < 0.5, `${whileRefused.inputTop} then ${afterTyping.inputTop}`);
  name = await lineOf('holding-name');
  check('the name refusal goes the moment a name is typed, before Save', cleared(name), JSON.stringify(name));
  check('the name line no longer shows the refusal text', !/name/i.test(name.text), name.text);
  await type('#holding-name', '');
  await type('#holding-name', 'Zurich savings');
  name = await lineOf('holding-name');
  check('a name typed after being emptied is not refused', cleared(name), JSON.stringify(name));

  // --- Criterion 60, the unit: Something else with nothing typed.
  await press('.unit-option.unit-other');
  check('Something else opens its free-text field', await visible('#holding-unit-other'));
  await save();
  let unit = await lineOf('holding-unit-other');
  check('Save with Something else empty refuses the unit on its line, with aria-invalid', refused(unit), JSON.stringify(unit));
  check('Save with the unit refused writes nothing', accounts() === before);
  const emptyText = unit.text;
  const unitPlaced = await placed('holding-unit-other');
  check('the unit refusal sits directly under the field it refuses', unitPlaced.lineTop >= unitPlaced.inputBottom - 0.5 && unitPlaced.lineTop - unitPlaced.inputBottom < 16, JSON.stringify(unitPlaced));

  // A listed symbol typed in another case is still refused, now for that reason.
  await type('#holding-unit-other', 'usd');
  unit = await lineOf('holding-unit-other');
  check('a typed listed symbol keeps the unit refused, before Save', refused(unit), JSON.stringify(unit));
  check('the refusal now says why the typed unit does not fit', unit.text !== emptyText && unit.text.includes('USD'), unit.text);

  await type('#holding-unit-other', 'bottles');
  unit = await lineOf('holding-unit-other');
  check('the unit refusal goes the moment the typed unit fits, before Save', cleared(unit), JSON.stringify(unit));

  await type('#holding-unit-other', '');
  await type('#holding-unit-other', 'bottles');
  await save();
  check('the form saves once both fields fit', accounts() === before + 1);
  check('the saved unit is the typed one, case kept', (await unitOf('Zurich savings')) === 'bottles');
  before = accounts();

  // A typed listed symbol refused on Save, then the listed one picked.
  await openAdd();
  await type('#holding-name', 'Dollar cash');
  await press('.unit-option.unit-other');
  await type('#holding-unit-other', 'Usd');
  await save();
  unit = await lineOf('holding-unit-other');
  check('Save with a listed symbol typed refuses it, naming the listed one', refused(unit) && unit.text.includes('USD'), JSON.stringify(unit));
  check('that refusal writes nothing', accounts() === before);
  await press('#holding-unit');
  await page.waitUntil("document.querySelector('.unit-option[data-symbol=USD]') && document.querySelector('.unit-option[data-symbol=USD]').getBoundingClientRect().height > 0", { label: 'the unit list' });
  await press('.unit-option[data-symbol=USD]');
  const combo = await lineOf('holding-unit');
  const other = await lineOf('holding-unit-other');
  check('picking the listed symbol clears the unit refusal before Save', cleared(combo) && cleared(other) && !combo.text && !other.text, JSON.stringify([combo, other]));
  await save();
  check('the form saves with the picked symbol', accounts() === before + 1 && (await unitOf('Dollar cash')) === 'USD');
  before = accounts();

  // Both refused at once: fixing one leaves the other.
  await openAdd();
  await press('.unit-option.unit-other');
  await save();
  check('both fields are refused together', refused(await lineOf('holding-name')) && refused(await lineOf('holding-unit-other')));
  await type('#holding-name', 'Wine cellar');
  check('fixing the name leaves the unit refused', cleared(await lineOf('holding-name')) && refused(await lineOf('holding-unit-other')));
  await type('#holding-unit-other', 'bottles');
  check('fixing the unit then clears it too', cleared(await lineOf('holding-unit-other')));
  await closeDialog();
  check('Cancel writes nothing', accounts() === before);

  // --- Criterion 60 on the edit panel, reached from Account detail.
  const { 'Bond fund': bond } = await holdings([['Bond fund', 'CHF']]);
  before = accounts();
  await openHolding(bond);
  await page.call(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === 'Edit').click());
  await page.waitUntil("document.querySelector('#holding-name')", { label: 'the edit panel' });
  await page.frames();
  await type('#holding-name', '');
  await save();
  check('the edit panel refuses an emptied name on Save', refused(await lineOf('holding-name')));
  await type('#holding-name', 'Bond fund B');
  check('the edit panel clears the name refusal the moment a name is typed', cleared(await lineOf('holding-name')));
  await press('.unit-option.unit-other');
  await save();
  check('the edit panel refuses an empty typed unit on Save', refused(await lineOf('holding-unit-other')));
  await type('#holding-unit-other', 'm²');
  check('the edit panel clears the unit refusal the moment the unit fits', cleared(await lineOf('holding-unit-other')));
  await save();
  check('the edited holding saves with both fixes', (await unitOf('Bond fund B')) === 'm²' && accounts() === before);

  // --- Criterion 12 (blind): a holding with a snapshot keeps its unit, and the UI says why.
  const { Pension: pension } = await holdings([['Pension', 'EUR']]);
  await recording(new Date().toISOString().slice(0, 10), { Pension: '1000' });
  await openHolding(pension);
  await page.call(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === 'Edit').click());
  await page.waitUntil("document.querySelector('#holding-name')", { label: 'the edit panel' });
  await page.frames();
  const locked = await page.call(() => {
    const combo = document.getElementById('holding-unit');
    const options = [...document.querySelectorAll('.unit-option')].filter((o) => o.getBoundingClientRect().height > 0 && o.getAttribute('aria-disabled') !== 'true');
    return {
      disabled: Boolean(combo && (combo.disabled || combo.getAttribute('aria-disabled') === 'true')),
      readable: Boolean(combo && combo.getBoundingClientRect().height > 0),
      reads: combo ? `${combo.value} ${combo.getAttribute('aria-label') || ''}` : '',
      pickable: options.length,
      text: document.body.innerText,
    };
  });
  check('the unit control is disabled on a holding with a value', locked.disabled, JSON.stringify(locked.disabled));
  check('the disabled unit control is still shown and names the unit', locked.readable && locked.reads.includes('EUR'), locked.reads);
  check('no unit option can be picked', locked.pickable === 0, `${locked.pickable} options`);
  check('the form says why the unit cannot change', locked.text.includes('The unit cannot change once a value is recorded here'));
  await save();
  check('saving the locked form leaves the unit as it was', (await unitOf('Pension')) === 'EUR');

  // --- Criterion 17 (blind): markup in a name, a note and a typed unit is text.
  before = accounts();
  await openAdd();
  await type('#holding-name', XSS);
  await press('.unit-option.unit-other');
  await type('#holding-unit-other', XSS);
  await press('form details summary');
  await type('form textarea', XSS);
  await save();
  check('a holding named with markup saves', accounts() === before + 1);
  const { [XSS]: tagged } = await page.call(async (wanted) => {
    const v = (await import('/static/js/session.js')).currentVault();
    const h = [...v.holdings.values()].find((x) => x.payload.name === wanted);
    return { [wanted]: h ? h.recordId : null };
  }, XSS);
  await recording(new Date().toISOString().slice(0, 10), { [XSS]: '5' });
  const noMarkup = () => page.call((needle) => ({
    img: document.querySelectorAll('img[src=x], img[src$="/x"]').length,
    alerted: window.__alerted,
    literal: document.body.innerText.includes(needle),
  }), XSS);
  await page.eval("location.hash = '#/unassigned/none'");
  await page.frames();
  await page.eval("location.hash = '#/'");
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard' });
  await page.idle();
  let seen = await noMarkup();
  check('the dashboard list shows the markup name as literal text and builds no image', seen.literal && seen.img === 0 && !seen.alerted, JSON.stringify(seen));
  // Every chart point hovered, which is where its tooltip and legend show.
  const points = await page.call(() => {
    const svg = document.querySelector('svg.trend');
    if (!svg) return [];
    const r = svg.getBoundingClientRect();
    return [0.1, 0.3, 0.5, 0.7, 0.9, 0.99].map((f) => ({ x: r.left + r.width * f, y: r.top + r.height / 2 }));
  });
  for (const { x, y } of points) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await page.frames();
    seen = await noMarkup();
    check(`hovering the chart builds no image from the name (at ${Math.round(x)})`, seen.img === 0 && !seen.alerted, JSON.stringify(seen));
  }
  await openHolding(tagged);
  seen = await noMarkup();
  check('Account detail shows the name and note as literal text and builds no image', seen.literal && seen.img === 0 && !seen.alerted, JSON.stringify(seen));
  await page.call(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === 'Edit').click());
  await page.waitUntil("document.querySelector('#holding-name')", { label: 'the edit panel' });
  await page.frames();
  // A typed unit that matches nothing listed, refused or not, is echoed as text.
  await type('#holding-name', '');
  await save();
  seen = await noMarkup();
  check('the edit form with refusals showing builds no image from markup', seen.img === 0 && !seen.alerted, JSON.stringify(seen));
}, { signsIn: false });
