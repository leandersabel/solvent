// The vault form's main currency, written from spec/features/register.md
// (Register, Main currency; acceptance criteria 49 and 50) and
// design-system.md, Components, "Combobox, searchable", without reading
// how the form is built.
//
// The form must open with nothing chosen and keep Create vault unusable
// until a currency is picked from the list. Typing narrows the list by
// code or name, ignoring case, and never chooses, Enter included. A
// click, or Enter or Space on an option reached with the arrow keys,
// chooses, and the vault is made in the currency chosen last.
import { BASE, VAULT_PASSWORD, check, intoVault, mintInvite, page, run, vaultValue } from '../harness.mjs';

const SEARCH = 'input[placeholder="Search by code or name"]';
const NONE_YET = 'No currency chosen yet.';
const NO_MATCH = 'No currency matches.';

const requests = [];
page.on((message) => {
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request);
});
const registrations = () => requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/register')).length;
const workerAsks = () => requests.filter((r) => r.url.includes('kdf-worker')).length;

// Every option of the list, as shown: "Name (CODE)", whether it is
// showing now, and whether it shows selected.
const options = () =>
  page.call(() => {
    const shape = /^(.+) \(([A-Z]{3})\)$/;
    // The list's options by their role, or else the innermost nodes
    // carrying the text, so a wrapper is not an option.
    const roled = [...document.querySelectorAll('[role=option]')].filter((n) => shape.test(n.textContent.trim()));
    const matching = [...document.querySelectorAll('li, button, div, span')]
      .filter((n) => shape.test(n.textContent.trim()));
    const leaves = roled.length ? roled : matching.filter((n) => !matching.some((m) => m !== n && n.contains(m)));
    return leaves.map((n) => {
      const [, name, code] = n.textContent.trim().match(shape);
      const holder = n.closest('[role=option]') || n;
      return {
        name,
        code,
        shown: holder.getClientRects().length > 0 && getComputedStyle(holder).visibility !== 'hidden',
        selected: holder.getAttribute('aria-selected') === 'true',
      };
    });
  });
const shownCodes = async () => (await options()).filter((o) => o.shown).map((o) => o.code).sort();
const status = () =>
  page.call((none) => {
    const text = document.body.innerText;
    const chosen = text.match(/Chosen: (.+ \([A-Z]{3}\))/);
    return { none: text.includes(none), chosen: chosen ? chosen[1] : null, text: text.slice(0, 600) };
  }, NONE_YET);
const button = () =>
  page.eval("JSON.stringify({ disabled: document.querySelector('button[type=submit]').disabled, text: document.querySelector('button[type=submit]').textContent.trim() })")
    .then(JSON.parse);

// Real input, as a person gives it: a click where the node is drawn, and
// keys and text through the browser's input pipeline.
const clickOn = async (selectorOrFn, ...args) => {
  const box = await page.call(selectorOrFn, ...args);
  await page.mouseClick(box.x, box.y);
};
const KEYS = {
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  ' ': { code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
};
const press = async (key) => {
  const { text, ...rest } = KEYS[key];
  await page.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, text, ...rest });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...rest });
};
const focusSearch = () =>
  clickOn((query) => {
    const node = document.querySelector(query);
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, SEARCH);
// Empties the search field with keys and types `query` into it.
const search = async (query) => {
  await focusSearch();
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await press('Backspace');
  if (query) await page.send('Input.insertText', { text: query });
  await page.frames();
};
// Types into a field the way a person does, or only focuses it when
// `value` is empty.
const typeInto = async (selector, index, value) => {
  await clickOn((query, at) => {
    const node = document.querySelectorAll(query)[at];
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector, index);
  if (value) await page.send('Input.insertText', { text: value });
};

await run(async () => {
  await page.goto(`${BASE}/register?invite=${mintInvite('vault-owner')}`);
  const form = await page.holds('document.querySelector(\'input[type=password]\') && document.querySelector(\'input[placeholder="Search by code or name"]\')',
    { label: 'the vault form with its currency search' });
  check('the vault form has a currency search field with its placeholder', form);
  if (!form) return;

  // Criterion 49: nothing chosen when the form opens.
  const opened = await status();
  const all = await options();
  check('the list offers currencies, each as its name and code', all.length > 1 && all.some((o) => o.code === 'CHF' && o.name === 'Swiss Franc'),
    JSON.stringify(all.slice(0, 5)));
  check('the form opens with no currency chosen and says so', opened.none && opened.chosen === null, opened.text);
  check('no option shows selected when the form opens', all.every((o) => !o.selected), JSON.stringify(all.filter((o) => o.selected)));
  check('"This cannot be changed later." stands at the choice',
    (await page.eval('document.body.innerText')).includes('This cannot be changed later.'));

  // Every other field filled by typing, and the box ticked by a click.
  await typeInto('input[type=text]', 0, 'leander');
  await typeInto('input[type=password]', 0, VAULT_PASSWORD);
  await typeInto('input[type=password]', 1, VAULT_PASSWORD);
  await clickOn(() => {
    const box = document.querySelector('input[type=checkbox]');
    box.scrollIntoView({ block: 'center' });
    const r = box.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // The gauge scores asynchronously, so give it its time to unlock the
  // button if it is going to.
  const unlockedEarly = await page.holds("!document.querySelector('button[type=submit]').disabled", { timeout: 8000, label: 'the button' });
  check('with every other field filled and no currency, Create vault stays unusable', !unlockedEarly, JSON.stringify(await button()));

  // Enter in the password field derives nothing and sends nothing.
  const sentBefore = registrations();
  const asksBefore = workerAsks();
  await typeInto('input[type=password]', 1, '');
  await press('Enter');
  const left = await page.holds((copy) => document.body.innerText.includes(copy), { args: ['Setting up your vault'], timeout: 3000, label: 'working state' });
  await page.frames();
  check('Enter with no currency chosen starts no setup', !left);
  check('Enter with no currency chosen sends nothing and loads no derivation', registrations() === sentBefore && workerAsks() === asksBefore,
    `${registrations() - sentBefore} sent, ${workerAsks() - asksBefore} worker asks`);

  // Criterion 50: typing narrows by code or name, ignoring case, and
  // chooses none.
  const codesOf = (q) => all.filter((o) => o.code.toLowerCase().includes(q.toLowerCase()) || o.name.toLowerCase().includes(q.toLowerCase()))
    .map((o) => o.code).sort();
  for (const query of ['chf', 'CHF', 'sWiSs', 'fr', 'DOLLAR', 'u', 'Swiss Franc']) {
    await search(query);
    const shown = await shownCodes();
    const want = codesOf(query);
    check(`searching "${query}" shows exactly the currencies whose code or name contains it`,
      want.length > 0 && JSON.stringify(shown) === JSON.stringify(want), `shown ${shown} want ${want}`);
    const now = await status();
    check(`searching "${query}" chooses none`, now.none && now.chosen === null && (await options()).every((o) => !o.selected), now.text);
    check(`searching "${query}" leaves Create vault unusable`, (await button()).disabled);
  }

  // A code typed in full and Enter in the search field still chooses
  // nothing, because typed text never chooses.
  await search('EUR');
  await press('Enter');
  await page.frames();
  const typedEnter = await status();
  check('a code typed in full and Enter in the search chooses nothing', typedEnter.none && typedEnter.chosen === null, typedEnter.text);
  check('a code typed in full and Enter in the search sends nothing', registrations() === sentBefore, `${registrations() - sentBefore} sent`);
  check('a code typed in full and Enter leaves Create vault unusable', (await button()).disabled);

  await search('zzzz');
  const none = await page.eval('document.body.innerText');
  check('a search that matches nothing says "No currency matches."', none.includes(NO_MATCH), none.slice(0, 600));
  check('a search that matches nothing shows no option', (await shownCodes()).length === 0, String(await shownCodes()));
  check('a search that matches nothing chooses none', (await status()).none);
  await search('');
  check('an emptied search shows the whole list again', (await shownCodes()).length === all.length,
    `${(await shownCodes()).length} of ${all.length}`);

  // A click on an option chooses it.
  await search('swiss');
  await clickOn(() => {
    const node = [...document.querySelectorAll('[role=option], li, button, div, span')]
      .filter((n) => n.textContent.trim() === 'Swiss Franc (CHF)' && n.getClientRects().length)
      .pop();
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.frames();
  const clicked = await status();
  check('a click on Swiss Franc chooses it and says "Chosen: Swiss Franc (CHF)"', clicked.chosen === 'Swiss Franc (CHF)' && !clicked.none, clicked.text);
  check('the clicked option shows selected', (await options()).some((o) => o.code === 'CHF' && o.selected));
  check('with a currency chosen, Create vault becomes usable',
    await page.holds("!document.querySelector('button[type=submit]').disabled", { timeout: 30000, label: 'the button' }));

  // Enter on an option reached with the arrow keys chooses it.
  const euro = all.find((o) => o.code === 'EUR');
  const other = all.find((o) => !['CHF', 'EUR'].includes(o.code) && all.filter((p) => p.name.toLowerCase().includes(o.name.toLowerCase())).length === 1);
  if (euro) {
    await search(euro.name);
    check(`searching "${euro.name}" leaves only it`, JSON.stringify(await shownCodes()) === JSON.stringify(['EUR']), String(await shownCodes()));
    await press('ArrowDown');
    await press('Enter');
    await page.frames();
    const entered = await status();
    check('Enter on the option the arrow keys reach chooses it', entered.chosen === `${euro.name} (EUR)`, entered.text);
    check('Enter on an option sends nothing', registrations() === sentBefore, `${registrations() - sentBefore} sent`);
  }
  if (other) {
    await search(other.name);
    await press('ArrowDown');
    await press(' ');
    await page.frames();
    const spaced = await status();
    check('Space on the option the arrow keys reach chooses it', spaced.chosen === `${other.name} (${other.code})`, spaced.text);
  }
  const finalStatus = await status();
  const final = finalStatus.chosen && finalStatus.chosen.match(/\(([A-Z]{3})\)$/)[1];

  // The vault is made in the currency chosen last.
  const usable = await page.holds("!document.querySelector('button[type=submit]').disabled", { timeout: 30000, label: 'the button' });
  check('Create vault is usable once a currency is chosen by keyboard', usable);
  if (!usable || !final) return;
  await page.eval("document.querySelector('button[type=submit]').click()");
  const landed = await intoVault(page, 'the new vault');
  check('the vault is created and opened', landed);
  if (landed) {
    const main = await vaultValue((v) => v.mainCurrency);
    check('the vault counts in the currency chosen last', main === final, `${main} vs ${final}`);
  }
}, { signsIn: false });
