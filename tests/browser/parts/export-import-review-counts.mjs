// Counts of one on the export and import screen, written from
// spec/features/export-import.md (Export / import: Export, Import step
// 3, States, Populated) and spec/design-system.md (Typography, Figures:
// a count agrees with its noun, and a unit symbol never changes)
// without reading how the screen is built.
//
// The vault first holds one holding and nothing else, so every count
// the screen shows is 1 or 0. Then a second holding in dollars with one
// figure and its price, so the figures and prices count 1 and the
// holdings 2. Each time the vault is exported, and its own file walked
// through to the review and restored.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASE, VAULT_PASSWORD, check, enterPassword, holdings, page, recording, run, setValue, vaultOwner, within,
} from '../harness.mjs';
import { disagreeing } from '../counts.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'solvent-review-counts-'));
const REPLACED = 'Your vault was replaced from the file';
const cardText = (selector) => page.call((query) => document.querySelector(query)?.innerText || '', selector);

const unlockScreen = async () => {
  await page.goto(`${BASE}/settings/export-import`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('#export') && document.querySelector('#import-file')", {
    timeout: 90000, label: 'the export and import screen',
  });
  await page.idle();
};

// Saves the export into a folder of its own and returns the file's path
// and what the export card says once it has.
const exportVault = async (name) => {
  const downloads = join(DIR, name);
  await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  const downloaded = new Promise((resolve) => {
    const done = (message) => {
      if (message.method !== 'Page.downloadProgress' || message.params.state !== 'completed') return;
      page.handlers = page.handlers.filter((h) => h !== done);
      resolve(true);
    };
    page.on(done);
  });
  const before = await page.call(() => document.querySelector('#export').closest('.card').innerText);
  await page.eval("document.querySelector('#export').click()");
  const landed = await within(downloaded, 60000);
  const saved = landed ? readdirSync(downloads).filter((n) => n.endsWith('.json')) : [];
  check(`${name}: the export saves one file`, saved.length === 1, saved.join(','));
  await page.waitUntil(
    (was) => document.querySelector('#export').closest('.card').innerText !== was,
    { args: [before], timeout: 30000, label: 'the export summary' },
  ).catch(() => {});
  const summary = await page.call(() => document.querySelector('#export').closest('.card').innerText);
  return { path: saved.length ? join(downloads, saved[0]) : null, summary };
};

const toReview = async (path) => {
  await page.waitUntil("document.querySelector('#import-file')", { label: 'the import step' });
  const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
  await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
  await page.send('Runtime.releaseObject', { objectId: result.objectId });
  await page.waitUntil("(() => { const n = document.querySelector('#import-password'); return n && n.offsetParent !== null; })()", {
    timeout: 30000, label: 'the password step',
  });
  await setValue('#import-password', VAULT_PASSWORD);
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent.trim() === 'Open the file').click()");
  return page.waitUntil("(() => { const n = document.querySelector('.review'); return n && n.offsetParent !== null; })()", {
    timeout: 90000, label: 'the review',
  }).then(() => cardText('#import-card'), () => '');
};

const restore = async () => {
  await setValue('#import-erase', 'ERASE');
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent.trim() === 'Replace my vault').click()");
  return page.waitUntil((words) => document.body.innerText.includes(words), { args: [REPLACED], timeout: 90000, label: 'the restore' })
    .then(() => page.eval('document.body.innerText'), () => '');
};

const agrees = (what, shown) => {
  const wrong = disagreeing(shown);
  check(`design-system: no count ${what} disagrees with its noun`, shown !== '' && wrong.length === 0, wrong.join(' | ') || shown.slice(0, 400));
};

await run(async () => {
  await vaultOwner();

  // -- One holding, nothing else ------------------------------------------

  await holdings([['Lone account', 'CHF']]);
  await unlockScreen();
  const first = await exportVault('one-holding');
  agrees('in the summary after exporting one holding', first.summary);
  check('export-import: the summary after an export counts "1 holding"', /\b1 holding\b(?!s)/.test(first.summary), first.summary);
  check('design-system: a size in kilobytes keeps its symbol', !/\bKBs\b/.test(first.summary), first.summary);

  const review = await toReview(first.path);
  agrees('in the review of a file holding one holding', review);
  check('export-import: the review counts the file\'s "1 holding"', /\b1 holding\b(?!s)/.test(review), review);
  check(
    'export-import: the review says the vault currently holds "1 record."',
    review.includes('Your vault currently holds 1 record.'),
    review,
  );

  const restored = await restore();
  agrees('in the confirmation of a restore of one holding', restored);
  check('export-import: the restore confirms "1 holding"', /\b1 holding\b(?!s)/.test(restored), restored.slice(0, 600));

  // -- Two holdings, one figure and one price -----------------------------

  await holdings([['Dollar account', 'USD']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Dollar account': '100.00' });
  await unlockScreen();
  const second = await exportVault('one-figure');
  agrees('in the summary after exporting one figure and one price', second.summary);
  check('export-import: the summary after an export counts "1 recorded figure"', /\b1 recorded figure\b(?!s)/.test(second.summary), second.summary);

  const secondReview = await toReview(second.path);
  agrees('in the review of a file holding one figure and one price', secondReview);
  check('export-import: the review counts "1 recorded figure"', /\b1 recorded figure\b(?!s)/.test(secondReview), secondReview);
  check('export-import: the review counts the file\'s "2 holdings"', /\b2 holdings\b/.test(secondReview), secondReview);
  agrees('in the confirmation of a restore of one figure and one price', await restore());

  rmSync(DIR, { recursive: true, force: true });
});
