// Dialogs across a lock, written from spec/features/login.md (Unlock,
// Rules; acceptance criterion 56), app-shell.md (The bar above a
// dialog; acceptance criteria 11 to 13) and manage-accounts.md (Delete:
// the user chooses), without reading how the dialogs are built.
//
// Every press of Lock is a real click or tap at Lock's center, and
// every typed character a real key event, as a person does it.
import {
  HOLDINGS, OWN, VAULT_PASSWORD, check, confirmLook, idNamed, inDialog, looksDisabled, looksEnabledRed, openHolding, page, rowOf, run,
  setValue, sql, story, vaultOwner,
} from '../harness.mjs';

const NAME = 'Cantonal account';
const PARTIAL = 'Cantonal ac';
const FIGURE = '13579.24';
// Typed into the deletion dialog. Not the whole username, which the
// unlock card holds in a field of its own.
const TYPED_NAME = 'leand';

// The center of the first element `find` returns in the page, or null.
const centerOf = (find, ...args) =>
  page.call(`(...args) => {
    const node = (${find})(...args);
    if (!node) return null;
    node.scrollIntoView({ block: 'center' });
    const box = node.getBoundingClientRect();
    return JSON.stringify({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }`, ...args).then((at) => (at ? JSON.parse(at) : null));

const press = async (find, touch, ...args) => {
  const at = await centerOf(find, ...args);
  if (!at) return false;
  await (touch ? page.tap(at.x, at.y) : page.mouseClick(at.x, at.y));
  await page.frames();
  return true;
};

const button = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name && b.offsetParent);
const dialogButton = (name) => [...document.querySelectorAll('.dialog button, [role=dialog] button')].find((b) => b.textContent.trim() === name);

// Focuses `selector` with a real click and types `typed` as key events.
const type = async (selector, typed) => {
  await press((query) => document.querySelector(query), false, selector);
  await page.send('Input.insertText', { text: typed });
  await page.frames();
};

const disabled = () =>
  page.call((name) => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === name).disabled, 'Delete permanently');

const lock = (touch = false) => press(button, touch, 'Lock');

// What the page shows and holds once locked: the card, any dialog,
// the keys, and whether `needles` are anywhere in the DOM or in a
// field's value.
const lockedState = (needles) =>
  page.call(async (wanted) => {
    const s = await import('/static/js/session.js');
    const values = [...document.querySelectorAll('input, textarea, select')].map((i) => i.value);
    const html = document.documentElement.outerHTML;
    return JSON.stringify({
      card: Boolean(document.querySelector('#unlock-password')),
      dialogs: document.querySelectorAll('.dialog, [role=dialog]').length,
      keys: s.holdsKeys(),
      vault: s.currentVault() !== null,
      found: wanted.filter((n) => html.includes(n) || values.some((v) => v.includes(n))),
    });
  }, needles).then(JSON.parse);

const lockedClean = (label, state) =>
  check(`${label}: Lock leaves the password card, no dialog, no key and none of the vault or the typed input in the DOM`,
    state.card && state.dialogs === 0 && !state.keys && !state.vault && state.found.length === 0, JSON.stringify(state));

const unlock = async (label) => {
  await setValue('#unlock-password', VAULT_PASSWORD);
  await page.eval("document.querySelector('button[type=submit]').click()");
  const back = await page.holds("!document.querySelector('#unlock-password') && document.querySelector('.topbar')",
    { timeout: 90000, label });
  await page.idle();
  return back;
};

const dialogs = () =>
  page.eval(`JSON.stringify([...document.querySelectorAll('.dialog, [role=dialog]')].filter((d) => d.offsetParent || d.getClientRects().length)
    .map((d) => d.innerText))`).then(JSON.parse);

// The bar as a dialog leaves it: nav and Update values hidden, Lock shown.
const barOverDialog = () =>
  page.eval(`(() => {
    const shown = (n) => n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const nav = document.querySelector('.topbar nav');
    const lock = [...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === 'Lock');
    return !shown(nav) && shown(lock) && !document.querySelector('.topbar').inert;
  })()`);

const snapshots = () => JSON.stringify(sql(`SELECT records.* FROM records ${OWN} AND record_type = 'snapshot' ORDER BY record_id`));

const toSettings = async () => {
  await page.eval("location.hash = '#/settings'");
  await page.waitUntil("document.querySelector('.danger-zone')", { label: 'settings' });
};

await run(async () => {
  await vaultOwner();
  await story();
  const vaultNames = HOLDINGS.map(([name]) => name);
  const [id] = await idNamed(NAME);
  const others = (await Promise.all(vaultNames.filter((n) => n !== NAME).map(idNamed))).flat();

  // ---- app-shell.md 11 and 12: a form with a figure typed --------------

  for (const touch of [false, true]) {
    const width = touch ? 'phone width, by tap' : 'desktop width, by click';
    if (touch) {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 760, deviceScaleFactor: 2, mobile: true });
    }
    await openHolding(id);
    await press(button, touch, 'Record a value');
    await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form' });
    await type('#snapshot-value', FIGURE);
    check(`${width}: Lock is pressable above the open form`, await lock(touch));
    lockedClean(`${width}, the value form`, await lockedState([FIGURE, ...vaultNames]));
    check(`${width}: unlocking returns`, await unlock(`the vault after locking over the form, ${width}`));
    const open = await dialogs();
    check(`${width}: unlocking reopens the value form, alone, with the typed figure`,
      open.length === 1 && (await page.eval("document.querySelector('#snapshot-value')?.value")) === FIGURE,
      JSON.stringify({ open, value: await page.eval("document.querySelector('#snapshot-value')?.value") }));
    check(`${width}: the reopened form sits over the holding it was opened on`,
      (await page.eval('location.hash')) === `#/holding/${id}` && (await page.eval('Boolean(document.querySelector(".detail-header"))')));
    check(`${width}: a dialog that comes back puts the bar back above it`, await barOverDialog());
    await inDialog('Cancel');
    await page.waitUntil("!document.querySelector('.dialog, [role=dialog]')", { label: 'the form to close' });
    if (touch) {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.clearDeviceMetricsOverride');
    }
  }

  // ---- app-shell.md 13, login.md 56: a yes-or-no over a form -----------

  await openHolding(id);
  await press(button, false, 'Record a value');
  await page.waitUntil("document.querySelector('#snapshot-value')", { label: 'the value form for the replace prompt' });
  await type('#snapshot-value', FIGURE);
  const before = snapshots();
  await press(dialogButton, false, 'Save');
  const prompted = await page.holds("document.querySelectorAll('.dialog, [role=dialog]').length === 2", { label: 'the replace prompt over the form' });
  check('saving onto today\'s figure asks yes or no over the form', prompted, JSON.stringify(await dialogs()));
  check('Lock is pressable above the confirmation', await lock());
  lockedClean('the confirmation over the form', await lockedState([FIGURE, ...vaultNames]));
  check('unlocking over the confirmation returns', await unlock('the vault after locking over the confirmation'));
  const afterConfirm = await dialogs();
  check('unlocking brings back the form alone, with the typed figure, and no confirmation',
    afterConfirm.length === 1 && !/Replace it\?/.test(afterConfirm[0] || '') &&
      (await page.eval("document.querySelector('#snapshot-value')?.value")) === FIGURE,
    JSON.stringify(afterConfirm));
  check('the act waits for the form\'s own button: no snapshot was written across the lock', snapshots() === before);
  await inDialog('Cancel');
  await page.waitUntil("!document.querySelector('.dialog, [role=dialog]')", { label: 'the form to close after the confirmation' });

  // ---- login.md 56: a destructive dialog with a password field ---------

  await toSettings();
  await page.eval("document.querySelector('.danger-zone').open = true");
  await press(button, false, 'Delete my account');
  await page.waitUntil("document.querySelector('.dialog input[type=password]')", { label: 'the deletion dialog' });
  const nameField = '.dialog input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio])';
  await type(nameField, TYPED_NAME);
  await type('.dialog input[type=password]', VAULT_PASSWORD);
  check('Lock is pressable above the deletion dialog', await lock());
  const lockedDeletion = await lockedState(vaultNames);
  lockedClean('the deletion dialog', lockedDeletion);
  check('the deletion dialog\'s typed username is gone from the DOM',
    (await page.call((typed) => [...document.querySelectorAll('input')].filter((i) => i.value === typed).length, TYPED_NAME)) === 0);
  check('unlocking over the deletion dialog returns', await unlock('the vault after locking over the deletion dialog'));
  const deletion = await page.call((query) => JSON.stringify({
    open: document.querySelectorAll('.dialog, [role=dialog]').length,
    name: document.querySelector(query)?.value,
    password: document.querySelector('.dialog input[type=password]')?.value,
    passwords: [...document.querySelectorAll('input[type=password]')].map((i) => i.value),
    disabled: [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Delete my vault')?.disabled,
  }), nameField).then(JSON.parse);
  check('a destructive dialog comes back with the typed username, its password field empty and its delete disabled',
    deletion.open === 1 && deletion.name === TYPED_NAME && deletion.password === '' && deletion.passwords.every((v) => v === '') &&
      deletion.disabled === true,
    JSON.stringify({ ...deletion, password: deletion.password === '' ? '' : 'refilled', passwords: deletion.passwords.map((v) => (v ? 'filled' : '')) }));
  await inDialog('Cancel');
  await page.waitUntil("!document.querySelector('.dialog, [role=dialog]')", { label: 'the deletion dialog to close' });

  // ---- login.md 56, manage-accounts.md: Archive or delete --------------

  await openHolding(id);
  await press(button, false, 'Delete');
  await page.waitUntil("document.querySelector('.dialog input[value=delete]')", { label: 'the archive or delete dialog' });
  await press((value) => {
    const input = document.querySelector(`.dialog input[value=${value}]`);
    return input.closest('label') || input;
  }, false, 'delete');
  await page.waitUntil("document.querySelector('#delete-name') && document.querySelector('#delete-name').offsetParent", { label: 'the name box' });
  await type('#delete-name', PARTIAL);
  check('with part of the name typed, Delete permanently is disabled before the lock', await disabled());
  check('Lock is pressable above the Archive or delete dialog', await lock());
  lockedClean('the Archive or delete dialog', await lockedState([PARTIAL, ...vaultNames]));
  check('unlocking over the Archive or delete dialog returns', await unlock('the vault after locking over Archive or delete'));

  const archive = await page.eval(`JSON.stringify({
    open: document.querySelectorAll('.dialog, [role=dialog]').length,
    hash: location.hash,
    header: Boolean(document.querySelector('.detail-header')),
    del: document.querySelector('.dialog input[value=delete]')?.checked,
    arch: document.querySelector('.dialog input[value=archive]')?.checked,
    typed: document.querySelector('#delete-name')?.value,
    shown: Boolean(document.querySelector('#delete-name')?.offsetParent),
    copy: document.querySelector('.dialog')?.innerText.includes('This also deletes 2 recorded values. Your past net worth figures will change.'),
    button: (() => {
      const b = [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Delete permanently');
      return b ? { disabled: b.disabled, hidden: b.hidden || !b.offsetParent } : null;
    })(),
  })`).then(JSON.parse);
  check('the Archive or delete dialog comes back, alone, over the holding it was opened on',
    archive.open === 1 && archive.hash === `#/holding/${id}` && archive.header, JSON.stringify(archive));
  check('it comes back with Delete permanently chosen and Archive not', archive.del === true && archive.arch === false, JSON.stringify(archive));
  check('it comes back with the partly typed name in a visible name box', archive.typed === PARTIAL && archive.shown, JSON.stringify(archive));
  check('it comes back counting the values from the re-read vault', archive.copy, JSON.stringify(archive));
  check('a partly typed name leaves Delete permanently disabled after unlocking',
    archive.button && archive.button.disabled === true && !archive.button.hidden, JSON.stringify(archive.button));
  check('disabled after unlocking, it wears the shared disabled look', looksDisabled(await confirmLook('Delete permanently')));
  check('a dialog that comes back puts the bar back above it', await barOverDialog());

  await type('#delete-name', NAME.slice(PARTIAL.length));
  check('typing the rest of the name enables Delete permanently, in red',
    (await page.eval("document.querySelector('#delete-name').value")) === NAME && !(await disabled()) &&
      looksEnabledRed(await confirmLook('Delete permanently')));
  await type('#delete-name', 't');
  check('one character past the name disables it again', await disabled());
  await setValue('#delete-name', NAME.slice(0, -1));
  check('the name less its last character leaves it disabled', await disabled());
  await setValue('#delete-name', NAME);
  check('the whole name enables it again', !(await disabled()));

  check('Delete permanently is pressable in the dialog that came back', await press(dialogButton, false, 'Delete permanently'));
  const gone = await page.holds("!document.querySelector('.dialog, [role=dialog]')", { timeout: 30000, label: 'the dialog to close after deleting' });
  await page.idle();
  check('the dialog that came back deletes the holding it was opened on, and no other',
    gone && !rowOf(id) && others.every((other) => Boolean(rowOf(other))),
    JSON.stringify({ gone, deleted: !rowOf(id), others: others.map((other) => Boolean(rowOf(other))) }));
});
