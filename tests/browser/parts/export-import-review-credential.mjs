// A restore from a page whose password changed in another tab, written
// from spec/features/export-import.md (Screens, States, "Error, the
// password changed elsewhere"; Edge cases; criterion 52) and
// spec/features/login.md (Unlock, States, "Password changed elsewhere";
// A credential changed elsewhere; criterion 84), without reading how the
// screen is built.
//
// Two tabs of one browser share one session. The second changes the
// password while the first holds the vault open on the export and import
// screen. The first's restore must then lock it, say why, store nothing,
// and come back to the screen once unlocked with the current password,
// where a restore goes through.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASE, NEW_PASSWORD, VAULT_PASSWORD, check, enterPassword, enterPasswordOn, expectedFailures, holdings, openTab,
  page, run, setValue, sql, vaultOwner, watched,
} from '../harness.mjs';

const CALLOUT =
  'Your password was changed, or its protection strengthened, in another tab, window or device after this page was unlocked. ' +
  'Nothing was restored, and your vault is unchanged. Unlock with your current password, then restore again.';
const OWNER = "(SELECT id FROM principals WHERE username = 'leander')";

// Every vault row of the account, as the database holds it.
const vaultRows = () =>
  JSON.stringify({
    records: sql(`SELECT * FROM records WHERE principal_id = ${OWNER} ORDER BY record_id`),
    wrapper: sql(`SELECT * FROM dek_wrappers WHERE credential_id = (SELECT id FROM credentials WHERE principal_id = ${OWNER})`),
    epoch: sql(`SELECT * FROM vault_epochs WHERE principal_id = ${OWNER}`),
    credential: sql(`SELECT params, verifier FROM credentials WHERE principal_id = ${OWNER}`),
  });

const PASSWORD_CARD = 'Change password';
const changePasswordOn = async (session, current, next) => {
  await session.call((words, currentValue, nextValue) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words));
    const set = (node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(card.querySelector('input[autocomplete=current-password]'), currentValue);
    for (const node of card.querySelectorAll('input[autocomplete=new-password]')) set(node, nextValue);
  }, PASSWORD_CARD, current, next);
  await session.waitUntil(
    (words) => ![...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').disabled,
    { args: [PASSWORD_CARD], label: 'the strength gauge' },
  );
  await session.call((words) => {
    [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(words)).querySelector('.btn-primary').click();
  }, PASSWORD_CARD);
  await session.waitUntil("document.body.innerText.includes('Your password is changed.')", {
    timeout: 90000,
    label: 'the password change',
  });
};

const chooseFile = async (path) => {
  await page.waitUntil("document.querySelector('#import-file')", { label: 'the import step' });
  const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
  await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
  await page.send('Runtime.releaseObject', { objectId: result.objectId });
};

// The flow on the screen, from the file to Replace my vault.
const restore = async (path) => {
  await chooseFile(path);
  await page.waitUntil("!document.querySelector('#import-password').closest('[hidden]')", { label: 'the password step' });
  await setValue('#import-password', VAULT_PASSWORD);
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Open the file').click()");
  await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 90000, label: 'the review' });
  await setValue('#import-erase', 'ERASE');
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Replace my vault').click()");
};

const imports = () => watched[0].requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/import'));

await run(async () => {
  await vaultOwner();
  await holdings([['Cantonal account', 'CHF']]);

  // The file this page restores, sealed by the page's own session as
  // the Export vault button seals it.
  const dir = mkdtempSync(join(tmpdir(), 'solvent-review-credential-'));
  const file = join(dir, 'vault.json');
  writeFileSync(file, await page.call(async () => {
    const s = await import('/static/js/session.js');
    return JSON.stringify((await s.exportFile()).file);
  }));

  await page.goto(`${BASE}/settings/export-import`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('#import-file')", { timeout: 90000, label: 'the export and import screen' });
  await page.idle();

  // Another tab of this browser changes the password.
  const other = await openTab(`${BASE}/settings`);
  await enterPasswordOn(other.session, VAULT_PASSWORD);
  await other.session.waitUntil("document.body.innerText.includes('Change password')", { timeout: 90000, label: 'settings in the other tab' });
  await changePasswordOn(other.session, VAULT_PASSWORD, NEW_PASSWORD);

  // This tab restores on the Master Key from before.
  expectedFailures.add('/api/import');
  const before = vaultRows();
  const sentBefore = imports().length;
  await restore(file);
  const locked = await page
    .waitUntil("document.querySelector('#unlock-password')", { timeout: 90000, label: 'the Unlock card' })
    .then(() => true, () => false);
  check('a restore after a password change in another tab locks the page', locked);
  check('the refused restore was sent once', imports().length === sentBefore + 1, String(imports().length - sentBefore));
  check('the refused restore wrote no vault row, wrapper, epoch or credential', vaultRows() === before);

  const card = JSON.parse(await page.call((copy) => {
    const nodes = [...document.querySelectorAll('*')].filter((n) => n.textContent.trim() === copy);
    const callout = nodes[0] ? nodes[0].closest('.callout') || nodes[0] : null;
    const live = callout && (callout.closest('[aria-live=polite]') || callout.querySelector('[aria-live=polite]') || callout.closest('[role=status]'));
    const password = document.querySelector('#unlock-password');
    const username = [...document.querySelectorAll('.card *')].find((n) => n.children.length === 0 && n.textContent.trim() === 'leander');
    return JSON.stringify({
      shown: Boolean(callout) && callout.offsetParent !== null,
      live: Boolean(live),
      icon: Boolean(callout && callout.querySelector('svg, img, .icon, [class*=icon]')),
      abovePassword: Boolean(callout && password && callout.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING),
      aboveUsername: Boolean(callout && username && callout.compareDocumentPosition(username) & Node.DOCUMENT_POSITION_FOLLOWING),
      unlockingAgain: !document.querySelector('#unlock-username') && document.body.innerText.includes('Not you?'),
    });
  }, CALLOUT));
  check('the Unlock card shows the Password changed elsewhere callout', card.shown, JSON.stringify(card));
  check('the callout is a polite live region', card.live, JSON.stringify(card));
  check('the callout carries no icon', !card.icon, JSON.stringify(card));
  check('the callout sits above the username and the password', card.aboveUsername && card.abovePassword, JSON.stringify(card));
  check('the card is in its unlocking-again shape', card.unlockingAgain, JSON.stringify(card));
  const held = JSON.parse(await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    return JSON.stringify({ keys: s.holdsKeys(), vault: s.currentVault() !== null });
  })()`));
  check('the locked page holds no key and no vault', !held.keys && !held.vault, JSON.stringify(held));

  // Unlocking with the current password returns to the screen.
  await enterPassword(NEW_PASSWORD);
  const back = await page
    .waitUntil("document.querySelector('#import-file') && !document.querySelector('#unlock-password')", { timeout: 90000, label: 'the screen after unlocking' })
    .then(() => true, () => false);
  await page.idle();
  check('unlocking with the current password returns to the export and import screen', back, await page.eval('location.hash'));
  check('the callout is gone once unlocked', !(await page.eval('document.body.innerText')).includes(CALLOUT));

  // And a restore from it goes through.
  await restore(file);
  const restored = await page
    .waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the restore after unlocking' })
    .then(() => true, () => false);
  check('after unlocking, the restore goes through', restored);
  check('the restore after unlocking stored a new epoch', vaultRows() !== before);

  // The password the run-wide checks sign in with.
  await page.eval("location.hash = '#/settings'");
  await page.waitUntil("document.body.innerText.includes('Change password')", { label: 'settings' });
  await changePasswordOn(page, NEW_PASSWORD, VAULT_PASSWORD);
  await other.close();
});
