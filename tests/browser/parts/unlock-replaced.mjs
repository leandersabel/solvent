// A vault replaced from a file elsewhere (spec/features/login.md, Unlock,
// Replaced elsewhere and Rules): the page that held it keeps nothing,
// including the state of a write that never answered, and a dialog a lock
// keeps comes back with nothing typed in it.
// Templates: dashboard.html. Modules: app.js, api.js, session.js,
// view-dimensions.js, dom.js.
import {
  VAULT_PASSWORD, check, click, enterPasswordOn, expectedFailures, intoVault, page, run, sql, unlockInPlace,
  vaultOwner,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();

  // ---- A dialog with nothing typed in it ---------------------------------

  const openForm = async () => {
    await click('Add a holding');
    await page.waitUntil("document.querySelector('.dialog #holding-name')", { label: 'the holding form' });
  };
  await openForm();
  await page.eval("document.querySelector('.btn-lock').click()");
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the lock' });
  await unlockInPlace('the vault after locking over an empty form');
  check(
    'a fill-in dialog with nothing typed in it comes back after a lock',
    await page.holds("document.querySelector('.dialog #holding-name')", { timeout: 10000 }),
  );

  // The vault is replaced while that dialog is open: the server's epoch
  // moves on, as an import elsewhere moves it.
  sql("UPDATE vault_epochs SET epoch = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'");
  expectedFailures.add('/api/records');
  await page.eval("import('/static/js/api.js').then((api) => api.get('/api/records?type=profile'))", { awaitPromise: false });
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the replaced card' });
  check(
    'a kept dialog counts as typed input lost, though nothing was typed in it',
    (await page.eval('document.body.innerText')).includes('What you had typed here and not saved is gone.'),
  );
  await enterPasswordOn(page, VAULT_PASSWORD);
  check('unlocking opens the restored vault', await intoVault(page, 'the vault after Replaced elsewhere'));
  check('and no dialog comes back', !(await page.eval("Boolean(document.querySelector('.dialog'))")));

  // ---- A write that never answers ------------------------------------------

  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { label: 'settings' });
  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Dimensions are how')", { timeout: 20000, label: 'dimensions' });

  sql("UPDATE vault_epochs SET epoch = 'ffffffffffffffffffffffffffffffff'");
  await click('Create a dimension');
  await page.waitUntil("document.querySelector('.dialog input')", { label: 'the dimension form' });
  await page.eval(`(() => {
    const inputs = document.querySelectorAll('.dialog input');
    inputs[0].value = 'Typed against the old vault';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'Cash';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === 'Create').click();
  })()`);
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the replaced card after the write' });
  check(
    'the page closes on the replaced answer, and nothing was stored',
    (await page.eval('document.body.innerText')).includes('Your vault was replaced') &&
      sql("SELECT count(*) AS n FROM records WHERE record_type = 'profile'")[0].n === 1,
  );

  await enterPasswordOn(page, VAULT_PASSWORD);
  check('unlock opens the restored vault', await intoVault(page, 'the vault after the write was refused'));
  await page.eval(`document.querySelector('.topbar nav a[href="#/settings"]').click()`);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { label: 'settings again' });
  await page.eval(`document.querySelector('.link-row[href="/settings/dimensions"]').click()`);
  await page.waitUntil("document.querySelector('#app').innerText.includes('imension')", { timeout: 20000, label: 'dimensions again' });
  await page.idle();
  const state = JSON.parse(await page.eval(`JSON.stringify({
    text: document.body.innerText,
    disabled: [...document.querySelectorAll('#app button')].filter((b) => b.disabled).map((b) => b.textContent.trim()),
    busy: Boolean(document.querySelector('[aria-busy=true]')),
  })`));
  check(
    'the restored dimensions screen shows nothing typed against the old vault',
    !state.text.includes('Typed against the old vault'),
    state.text.slice(0, 400),
  );
  check('and its controls are not left disabled', !state.busy && state.disabled.length === 0, JSON.stringify(state.disabled));
});
