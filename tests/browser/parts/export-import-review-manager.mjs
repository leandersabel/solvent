// The import file's password refusing password managers, written from
// spec/design-system.md (Components, Input: every field refuses password
// managers unless it is a credential) and spec/features/export-import.md
// (Restore, step 2: the file's password is not your password) without
// reading how the screen is built.
import { check, page, run, vaultOwner } from '../harness.mjs';

const CREDENTIAL = ['username', 'current-password', 'new-password'];

await run(async () => {
  await vaultOwner();
  await page.eval("location.hash = '#/settings/export-import'");
  await page.waitUntil("document.querySelector('#import-password')", { label: 'the export and import screen' });
  await page.idle();

  const fields = await page.call((credential) =>
    [...document.querySelectorAll('input, textarea, select')].map((f) => ({
      id: f.id || f.type,
      type: f.type,
      autocomplete: f.getAttribute('autocomplete'),
      refuses:
        f.getAttribute('autocomplete') === 'off' &&
        f.hasAttribute('data-1p-ignore') &&
        f.getAttribute('data-lpignore') === 'true' &&
        f.hasAttribute('data-bwignore') &&
        f.getAttribute('data-form-type') === 'other',
      credential: credential.includes(f.getAttribute('autocomplete')),
    })), CREDENTIAL);
  const password = fields.find((f) => f.id === 'import-password');
  check("the file's password names no credential autocomplete token", password && !password.credential, JSON.stringify(password));
  check("the file's password refuses every major password manager", password && password.refuses, JSON.stringify(password));
  const offered = fields.filter((f) => f.type !== 'file' && !f.credential && !f.refuses);
  check('every field on the screen refuses password managers', offered.length === 0, JSON.stringify(offered));
}, { signsIn: false });
