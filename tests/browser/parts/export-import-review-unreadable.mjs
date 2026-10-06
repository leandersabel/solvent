// What the restore review says will be deleted, written from
// spec/features/export-import.md (Import step 3, criteria 21, 22, 23
// and 58) without reading how the screen is built: the total is every
// record but the profile, unreadable ones included, and the sum of the
// lines above it, and records the vault cannot read get a line of
// their own after the prices, shown only above zero.
//
// One clean export is made first, then the vault is damaged step by
// step in the database, the way a failing disk or a bad write would
// leave it, and the same file walked to the review each time.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASE, OWN, VAULT_PASSWORD, check, enterPassword, holdings, page, recording, run, setValue, sql, vaultOwner, within,
} from '../harness.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'solvent-review-unreadable-'));
const EMPTY = 'Your vault is empty. Nothing will be deleted.';
const TOTAL = /^Your vault currently holds (\d+) records?\. All of them will be deleted\.$/;
const UNREADABLE = /^(\d+) records? that could not be read$/;
const PRICES = /^\d+ captured prices?$/;

const unlockScreen = async () => {
  await page.goto(`${BASE}/settings/export-import`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('#export') && document.querySelector('#import-file')", {
    timeout: 90000, label: 'the export and import screen',
  });
  await page.idle();
};

const exportVault = async () => {
  await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DIR });
  const downloaded = new Promise((resolve) => {
    const done = (message) => {
      if (message.method !== 'Page.downloadProgress' || message.params.state !== 'completed') return;
      page.handlers = page.handlers.filter((h) => h !== done);
      resolve(true);
    };
    page.on(done);
  });
  await page.eval("document.querySelector('#export').click()");
  await within(downloaded, 60000);
  const saved = readdirSync(DIR).filter((n) => n.endsWith('.json'));
  check('the clean vault exports one file', saved.length === 1, saved.join(','));
  return join(DIR, saved[0]);
};

// The review's two sides, each as the lines it shows in order, read
// once the file is opened on a freshly unlocked screen.
const review = async (path) => {
  await unlockScreen();
  const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
  await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
  await page.send('Runtime.releaseObject', { objectId: result.objectId });
  await page.waitUntil("(() => { const n = document.querySelector('#import-password'); return n && n.offsetParent !== null; })()", {
    timeout: 30000, label: 'the password step',
  });
  await setValue('#import-password', VAULT_PASSWORD);
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent.trim() === 'Open the file').click()");
  await page.waitUntil("(() => { const n = document.querySelector('.review'); return n && n.offsetParent !== null; })()", {
    timeout: 90000, label: 'the review',
  });
  return page.call(() => {
    const shown = (node) => node.offsetParent !== null;
    const sides = [...document.querySelectorAll('.review .review-side')].map((side) =>
      [...side.querySelectorAll('p')].filter(shown).map((p) => p.innerText.trim()));
    const erase = document.querySelector('#import-erase');
    return { file: sides[0] || [], deleted: sides[1] || [], asksErase: Boolean(erase && shown(erase)) };
  });
};

const leading = (line) => Number((line.match(/^(\d+) /) || [])[1]);
const nonProfile = () => sql(`SELECT COUNT(*) AS n FROM records ${OWN} AND record_type <> 'profile'`)[0].n;

// The deleted side read against the rows the vault holds: its total is
// every row but the profile and the sum of the lines above it, and the
// unreadable line, after the prices, shows `unreadable` or is absent.
const totals = (stage, deleted, unreadable) => {
  const totalLine = deleted.find((line) => TOTAL.test(line));
  const total = totalLine ? Number(totalLine.match(TOTAL)[1]) : NaN;
  const above = deleted.slice(0, deleted.indexOf(totalLine));
  const sum = above.reduce((acc, line) => acc + leading(line), 0);
  const detail = JSON.stringify({ deleted, rows: nonProfile() });
  check(`export-import 58, ${stage}: the total counts every record but the profile`, total === nonProfile(), detail);
  check(`export-import 58, ${stage}: the total is the sum of the lines above it`, above.length > 0 && sum === total, detail);
  const line = above.find((l) => UNREADABLE.test(l));
  if (unreadable === 0) {
    check(`export-import 58, ${stage}: no line counts unreadable records`, !deleted.some((l) => /could not be read/.test(l)), detail);
    return;
  }
  const want = unreadable === 1 ? '1 record that could not be read' : `${unreadable} records that could not be read`;
  check(`export-import 58, ${stage}: the unreadable records read "${want}"`, line === want, detail);
  const prices = above.findIndex((l) => PRICES.test(l));
  check(`export-import 58, ${stage}: the unreadable line comes after the prices`,
    prices === -1 || above.indexOf(line) > prices, detail);
};

// One byte of a stored ciphertext changed, so it no longer
// authenticates.
const damage = (recordId) =>
  sql(`UPDATE records SET ciphertext = (CASE substr(ciphertext, 1, 1) WHEN 'A' THEN 'B' ELSE 'A' END) || substr(ciphertext, 2)
       WHERE record_id = ?`, recordId);

// A holding that authenticates but is written at a schema version past
// the one this client knows, which record-api.md, Schema migration,
// makes unreadable.
const plantFuture = () =>
  page.call(async () => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const { SCHEMA_VERSION } = await import('/static/js/model.js');
    const slot = { recordId: c.uuid4(), recordType: 'account', accountId: null, schemaVersion: SCHEMA_VERSION + 1, version: 1 };
    const blob = await c.encryptRecord(s.currentVault().dek, slot, { name: 'From a later version', unit: 'CHF' });
    await api.put('/api/records/' + slot.recordId, {
      recordType: slot.recordType, accountId: null, schemaVersion: slot.schemaVersion, version: 1, ...blob,
    });
    return slot.recordId;
  });

const rows = () => JSON.stringify(sql(`SELECT records.* FROM records ${OWN} ORDER BY record_id`));

await run(async () => {
  await vaultOwner();
  const ids = await holdings([['Franc account', 'CHF'], ['Dollar account', 'USD']]);
  await recording(new Date().toISOString().slice(0, 10), { 'Franc account': '10.00', 'Dollar account': '20.00' });
  await unlockScreen();
  const file = await exportVault();
  const snapshotOf = (account) =>
    sql(`SELECT record_id FROM records ${OWN} AND record_type = 'snapshot' AND account_id = ?`, account)[0].record_id;

  // -- Every record reads ---------------------------------------------------

  const clean = await review(file);
  totals('a vault that reads whole', clean.deleted, 0);
  const kinds = (side) => side.filter((l) => /^\d+ /.test(l) && !UNREADABLE.test(l)).map((l) => l.replace(/^\d+ /, '').replace(/s$/, ''));
  check('export-import 23: both sides count the same kinds, prices on a line of their own',
    JSON.stringify(kinds(clean.file)) === JSON.stringify(kinds(clean.deleted)) && clean.deleted.some((l) => PRICES.test(l)),
    JSON.stringify(clean));

  // -- One figure no longer reads -------------------------------------------

  damage(snapshotOf(ids['Franc account']));
  totals('one damaged figure', (await review(file)).deleted, 1);

  // -- A holding damaged, its figure still readable, one from a later version

  damage(ids['Dollar account']);
  await plantFuture();
  const damaged = await review(file);
  totals('three records the vault cannot read', damaged.deleted, 3);

  // -- Criterion 22: no ERASE, no restore ------------------------------------

  const before = rows();
  check('export-import 22: a vault with records asks for ERASE', damaged.asksErase, JSON.stringify(damaged));
  for (const typed of ['', 'erase']) {
    await setValue('#import-erase', typed);
    await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent.trim() === 'Replace my vault').click()");
    await page.idle();
    check(`export-import 22: "${typed}" in place of ERASE changes nothing`, rows() === before);
  }

  // -- Only the profile and records it cannot read --------------------------

  sql(`DELETE FROM records WHERE record_id IN (?, ?, ?)`,
    ids['Franc account'], snapshotOf(ids['Dollar account']),
    sql(`SELECT record_id FROM records ${OWN} AND record_type = 'rate'`)[0].record_id);
  const unreadableOnly = await review(file);
  check('export-import step 3: a vault holding records it cannot read is not called empty',
    !unreadableOnly.deleted.includes(EMPTY), JSON.stringify(unreadableOnly));
  totals('only records the vault cannot read', unreadableOnly.deleted, 3);
  check('export-import step 4: a vault holding records it cannot read still asks for ERASE',
    unreadableOnly.asksErase, JSON.stringify(unreadableOnly));

  // -- Criterion 21: the profile alone --------------------------------------

  sql(`DELETE FROM records WHERE principal_id = (SELECT id FROM principals WHERE username = 'leander') AND record_type <> 'profile'`);
  const empty = await review(file);
  check('export-import 21: a vault holding only its profile says nothing will be deleted',
    empty.deleted.includes(EMPTY) && !empty.deleted.some((l) => TOTAL.test(l) || /^\d+ /.test(l)), JSON.stringify(empty));
  check('export-import 21: a vault holding only its profile asks for no ERASE', !empty.asksErase, JSON.stringify(empty));

  // -- The profile alone, and it cannot be read -------------------------------

  // Its type is stored in the clear, so it is still the vault's
  // settings, which are never counted, read or not.
  damage(sql(`SELECT record_id FROM records ${OWN} AND record_type = 'profile'`)[0].record_id);
  const unreadProfile = await review(file);
  check('export-import 58: a profile that cannot be read is still settings, and the vault is empty',
    unreadProfile.deleted.includes(EMPTY) && !unreadProfile.deleted.some((l) => /^\d+ /.test(l)), JSON.stringify(unreadProfile));
  check('export-import 21: a vault whose only record is its unreadable profile asks for no ERASE',
    !unreadProfile.asksErase, JSON.stringify(unreadProfile));
  const said = await page.call(() => document.querySelector('.review').parentElement.innerText);
  check('export-import step 3: no line of the review prints "undefined" or "null"', !/\b(undefined|null)\b/.test(said), said);

  rmSync(DIR, { recursive: true, force: true });
});
