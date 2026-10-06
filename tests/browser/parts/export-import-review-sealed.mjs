// A backup file that shows nothing but what opens it, written from
// spec/features/export-import.md (What it does; Export; Rules; Screens,
// Import steps 1 and 2 and States; criteria 4, 19, 20, 41, 53, 54, 55)
// and spec/architecture.md (Key management, Data integrity), without
// reading how the file is sealed or opened.
//
// The file is the one the Export vault button saves. Its envelope is
// opened here with the vault's own key and the AAD the spec pins, by
// WebCrypto and nothing of the app's, and resealed the same way to make
// the files a restore must refuse once the envelope opens.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASE, HOLDINGS, VAULT_PASSWORD, check, credentialOf, enterPassword, expectedFailures, page, run, setProfile,
  setValue, sql, story, vaultOwner, vaultValue, watched, within,
} from '../harness.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'solvent-review-sealed-'));
const OWNER = "(SELECT id FROM principals WHERE username = 'leander')";
const AAD = 'solvent-vault\u001f2';
const KEYS = ['ciphertext', 'dekNonce', 'format', 'formatVersion', 'kdf', 'nonce', 'salt', 'wrappedDek'];
const NO_PROFILE =
  'This file carries no vault settings, so it would restore a vault with no main currency. It cannot be restored.';
const DAMAGED = 'That is not a Solvent vault file, or it has been damaged.';
const OLDER = 'This file was written by an earlier version. It is brought up to date as it goes in.';
const REPLACED = 'Your vault was replaced from the file';
const FIXTURE = new URL('../../fixtures/vault-format-1.json', import.meta.url);
const FIXTURE_PASSWORD = 'fixture lantern orchard';
const DIMENSIONS = [{
  id: 'a1b2c3d4', label: 'Liquidity reserve', archivedAt: null,
  values: [{ id: 'e5f6a7b8', label: 'Emergency cash', archivedAt: null }],
}];

const vaultRows = () =>
  sql(`SELECT record_id, record_type, account_id, schema_version, version FROM records WHERE principal_id = ${OWNER} ORDER BY record_id`)
    .map((r) => ({
      recordId: r.record_id, recordType: r.record_type, accountId: r.account_id || null,
      schemaVersion: r.schema_version, version: r.version,
    }));
const apiRequests = () => watched[0].requests.filter((r) => new URL(r.url).pathname.startsWith('/api/')).length;
const flipped = (b64, at) => {
  const bytes = Buffer.from(b64, 'base64');
  bytes[at(bytes.length)] ^= 0x01;
  return bytes.toString('base64');
};
const writeFile = (name, content) => {
  const path = join(DIR, name);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
};

// The file the Export vault button saves, as text.
let exports = 0;
const exportFile = async () => {
  const downloads = join(DIR, `downloads-${++exports}`);
  await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  const downloaded = new Promise((resolve) => {
    const done = (message) => {
      if (message.method !== 'Page.downloadProgress' || message.params.state !== 'completed') return;
      page.handlers = page.handlers.filter((h) => h !== done);
      resolve(true);
    };
    page.on(done);
  });
  await page.eval("document.querySelector('#export').click()");
  const landed = await within(downloaded, 60000);
  const saved = landed ? readdirSync(downloads).filter((n) => n.endsWith('.json')) : [];
  check(`export ${exports} saves one dated file naming nobody`, saved.length === 1 && /^solvent-vault-\d{4}-\d{2}-\d{2}\.json$/.test(saved[0]), saved.join(','));
  return saved.length ? readFileSync(join(downloads, saved[0]), 'utf8') : '{}';
};

// The envelope opened with the open vault's DEK under `aad`: the parsed
// payload, or null when it does not authenticate.
const openEnvelope = (file, aad) =>
  page.call(async (nonce, ciphertext, label) => {
    const dek = (await import('/static/js/session.js')).currentVault().dek;
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes(nonce), additionalData: new TextEncoder().encode(label) }, dek, bytes(ciphertext),
      );
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }, file.nonce, file.ciphertext, aad).then((plain) => (plain === null ? null : JSON.parse(plain)));

// `payload` sealed under the open vault's DEK with a fresh nonce and
// `aad`, beside the header fields of `file`.
const reseal = async (file, payload, aad = AAD) => {
  const sealed = await page.call(async (body, label) => {
    const dek = (await import('/static/js/session.js')).currentVault().dek;
    const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(label) }, dek, new TextEncoder().encode(body),
    );
    return JSON.stringify({ nonce: b64(nonce), ciphertext: b64(ciphertext) });
  }, JSON.stringify(payload), aad).then(JSON.parse);
  return { ...file, ...sealed };
};

const shown = (selector) => page.call((query) => {
  const node = document.querySelector(query);
  return Boolean(node) && !node.closest('[hidden]') && node.offsetParent !== null;
}, selector);
const passwordStep = () => shown('#import-password');
const showsText = (copy, timeout = 90000) =>
  page.waitUntil((words) => document.body.innerText.includes(words), { args: [copy], timeout, label: copy })
    .then(() => true, () => false);

const chooseFile = async (path) => {
  await page.waitUntil("document.querySelector('#import-file')", { label: 'the import step' });
  const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
  await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
  await page.send('Runtime.releaseObject', { objectId: result.objectId });
};
const toPasswordStep = (path) =>
  chooseFile(path).then(() =>
    page.waitUntil("(() => { const n = document.querySelector('#import-password'); return n && !n.closest('[hidden]'); })()", {
      timeout: 30000, label: 'the password step',
    }).then(() => true, () => false));
const openWith = async (password) => {
  await setValue('#import-password', password);
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Open the file').click()");
};
const reviewShown = () => page.eval("Boolean(document.querySelector('.review')) && !document.querySelector('.review').hidden");

const unlockScreen = async () => {
  await page.goto(`${BASE}/settings/export-import`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('#export') && document.querySelector('#import-file')", {
    timeout: 90000, label: 'the export and import screen',
  });
  await page.idle();
};

await run(async () => {
  await vaultOwner();
  await setProfile({ dimensions: DIMENSIONS });
  await story();
  await unlockScreen();

  // -- The file the button saves (criteria 4, 53) ----------------------------

  const before = vaultRows();
  const text = await exportFile();
  const second = JSON.parse(await exportFile());
  const file = JSON.parse(text);

  check('the file shows format, formatVersion, salt, KDF envelope, wrapper and nonce, and nothing else outside its envelope',
    JSON.stringify(Object.keys(file).sort()) === JSON.stringify(KEYS), Object.keys(file).sort().join(','));
  check('the file is format solvent-vault at formatVersion 2', file.format === 'solvent-vault' && file.formatVersion === 2,
    `${file.format} ${file.formatVersion}`);
  check("the envelope's nonce is 96 bits", Buffer.from(file.nonce || '', 'base64').length === 12);
  check('two exports seal under different nonces', file.nonce !== second.nonce && file.ciphertext !== second.ciphertext);

  const credential = credentialOf('leander');
  const params = JSON.parse(credential.params);
  check("the file's salt, KDF envelope and wrapper are the password credential's",
    file.salt === params.salt && JSON.stringify(file.kdf) === JSON.stringify(params.kdf) &&
      file.wrappedDek === credential.wrapped_dek && file.dekNonce === credential.dek_nonce);

  // What the bytes may not show: an id, a counter, a timestamp, a record.
  const ids = [...new Set(before.flatMap((r) => [r.recordId, r.accountId]).filter(Boolean))];
  // The base64 fields are read decoded only, since their text is random
  // letters. Every other byte of the file is read as text.
  const BASE64 = ['salt', 'wrappedDek', 'dekNonce', 'nonce', 'ciphertext'];
  check('the salt, wrapper and envelope are canonical base64, so decoding reads all they hold',
    BASE64.every((k) => typeof file[k] === 'string' && Buffer.from(file[k], 'base64').toString('base64') === file[k]));
  const decoded = BASE64.map((k) => Buffer.from(file[k] || '', 'base64'));
  const open = BASE64.reduce((rest, k) => rest.replaceAll(JSON.stringify(file[k] || ''), ''), text);
  // A needle under four bytes occurs in random bytes by chance, so inside
  // them it is sought as the JSON string a sealed record would hold.
  const anywhere = (needle) => open.includes(needle) ||
    decoded.some((b) => b.includes(needle.length < 4 ? JSON.stringify(needle) : needle));
  check('no record id or holding id appears in the file, in the open or decoded', ids.length > 4 && !ids.some(anywhere),
    `${ids.filter(anywhere).length} of ${ids.length}`);
  const fields = ['"recordId"', '"accountId"', '"recordType"', '"version"', '"schemaVersion"', '"exportedAt"', '"records"'];
  check('no record field, edit counter or timestamp field appears in the file, in the open or decoded',
    !fields.some(anywhere), fields.filter(anywhere).join(','));
  check('no date or time appears in the file', !/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/.test(text));

  const needles = await vaultValue((v) => {
    const out = new Set([v.mainCurrency]);
    for (const h of v.holdings.values()) [h.payload.name, h.payload.note, h.payload.unit].forEach((x) => x && out.add(x));
    for (const d of v.dimensions) { out.add(d.label); d.values.forEach((x) => out.add(x.label)); }
    for (const list of v.snapshots.values()) for (const s of list) { out.add(s.payload.date); if (s.payload.value.length >= 4) out.add(s.payload.value); }
    for (const list of v.rates.values()) for (const r of list) { out.add(r.payload.symbol); out.add(r.payload.date); if (r.payload.rate.length >= 4) out.add(r.payload.rate); }
    return [...out];
  });
  check('the scan covers names, units, dimension labels, figures, dates and prices',
    needles.includes('Gold bars') && needles.includes('Emergency cash') && needles.length > 10, String(needles.length));
  check('no plaintext name, note, dimension label, value, rate, symbol, date or currency is in the file, in the open or decoded',
    !needles.some(anywhere), `${needles.filter(anywhere).length} found`);

  // -- The envelope, opened by the spec (architecture.md, Data integrity) ---

  const sealed = await openEnvelope(file, AAD);
  check('the envelope opens with the vault key under the AAD solvent-vault 0x1F 2', sealed !== null);
  const inside = sealed || { records: [] };
  check('the envelope seals exportedAt and records and nothing else',
    JSON.stringify(Object.keys(inside).sort()) === '["exportedAt","records"]', Object.keys(inside).join(','));
  check('the sealed timestamp is the moment of the export',
    Math.abs(Date.parse(inside.exportedAt) - Date.now()) < 10 * 60000, String(inside.exportedAt));
  const sealedRows = inside.records.map(({ recordId, recordType, accountId, schemaVersion, version }) =>
    ({ recordId, recordType, accountId, schemaVersion, version })).sort((a, b) => a.recordId.localeCompare(b.recordId));
  check('the envelope holds every record of the vault, ids, holding links and counters as stored',
    JSON.stringify(sealedRows) === JSON.stringify(before));
  check('the sealed records carry all four kinds',
    JSON.stringify([...new Set(inside.records.map((r) => r.recordType))].sort()) === '["account","profile","rate","snapshot"]');
  check('the envelope does not open under another format version', (await openEnvelope(file, 'solvent-vault\u001f1')) === null);
  check('the envelope does not open without its AAD', (await openEnvelope(file, '')) === null);

  // -- A wrapper that does not open with the page's Master Key -------------

  const wrapper = credential.wrapped_dek;
  sql('UPDATE dek_wrappers SET wrapped_dek = ? WHERE credential_id = ?', flipped(wrapper, (n) => n >> 1), credential.id);
  const started = [];
  const noteDownload = (message) => {
    if (message.method === 'Page.downloadWillBegin') started.push(message.params.url);
  };
  page.on(noteDownload);
  const restBefore = await page.eval("document.querySelector('#export-card').innerText");
  await page.eval("document.querySelector('#export').click()");
  const settled = await page.waitUntil(
    (was) => !document.querySelector('#export').disabled && document.querySelector('#export-card').innerText !== was,
    { args: [restBefore], timeout: 60000, label: 'the export to fail' },
  ).then(() => true, () => false);
  page.handlers = page.handlers.filter((h) => h !== noteDownload);
  sql('UPDATE dek_wrappers SET wrapped_dek = ? WHERE credential_id = ?', wrapper, credential.id);
  const failed = await page.eval("document.querySelector('#export-card').innerText");
  check('a wrapper that does not open with the Master Key writes no file', settled && started.length === 0, started.join(','));
  check('the failed export says nothing was written to disk and the vault did not change',
    /nothing/i.test(failed) && /disk/i.test(failed), failed);

  // -- Refused at step 1 (criteria 19, 20) ----------------------------------

  const good = writeFile('good.json', text);
  const { records: plainRecords, exportedAt } = inside;
  const header = { salt: file.salt, kdf: file.kdf, wrappedDek: file.wrappedDek, dekNonce: file.dekNonce };
  const formatOne = (records) => ({ format: 'solvent-vault', formatVersion: 1, exportedAt, ...header, records });
  const firstStep = {
    'a file that is not JSON': writeFile('not-json.json', text.slice(0, text.length >> 1)),
    'a file of the wrong format': writeFile('wrong-format.json', { ...file, format: 'solvent-ledger' }),
    'a file of a newer formatVersion': writeFile('newer.json', { ...file, formatVersion: 3 }),
    'a file over 64 MiB': writeFile('oversized.json', text + ' '.repeat(64 * 1024 * 1024 + 1 - Buffer.byteLength(text))),
    'a format 1 file with no profile record': writeFile('format-1-no-profile.json',
      formatOne(plainRecords.filter((r) => r.recordType !== 'profile'))),
  };
  for (const [what, path] of Object.entries(firstStep)) {
    const opened = await toPasswordStep(good);
    const sent = apiRequests();
    await chooseFile(path);
    const refused = await page.waitUntil(
      "(() => { const n = document.querySelector('#import-password'); return !n || Boolean(n.closest('[hidden]')); })()",
      { timeout: 30000, label: `${what} refused` },
    ).then(() => true, () => false);
    check(`${what} is refused at the first step, before a password is asked for`, opened && refused);
    check(`${what} sends no request`, apiRequests() === sent, String(apiRequests() - sent));
    if (what.includes('no profile')) check(`${what} says it carries no vault settings`, await showsText(NO_PROFILE, 10000));
  }
  check('a format 1 file with its profile reaches the password step',
    await toPasswordStep(writeFile('format-1.json', formatOne(plainRecords))));

  // -- Refused at step 2, once the password opens the wrapper (19, 55) ------

  const resealed = await reseal(file, inside);
  const control = writeFile('resealed.json', resealed);
  check('a file sealed as the spec says reaches the password step', await toPasswordStep(control));
  await openWith(VAULT_PASSWORD);
  check('a file sealed as the spec says opens to the review',
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 90000, label: 'the review' }).then(() => true, () => false));

  const orphan = plainRecords.map((r) => (r.recordType === 'snapshot' ? { ...r, accountId: crypto.randomUUID() } : r));
  const secondStep = {
    'a byte altered in the envelope ciphertext': [{ ...file, ciphertext: flipped(file.ciphertext, (n) => n >> 1) }, DAMAGED],
    'a byte altered in the envelope tag': [{ ...file, ciphertext: flipped(file.ciphertext, (n) => n - 1) }, DAMAGED],
    "a byte altered in the envelope's nonce": [{ ...file, nonce: flipped(file.nonce, () => 0) }, DAMAGED],
    'an envelope sealed under format version 1': [await reseal(file, inside, 'solvent-vault\u001f1'), DAMAGED],
    'a sealed snapshot naming no holding in the file': [await reseal(file, { exportedAt, records: orphan }), DAMAGED],
    'a sealed file with no profile record': [
      await reseal(file, { exportedAt, records: plainRecords.filter((r) => r.recordType !== 'profile') }), NO_PROFILE],
  };
  expectedFailures.add('/api/import');
  for (const [what, [content, copy]] of Object.entries(secondStep)) {
    const path = writeFile(`${what.replace(/[^a-z0-9]+/gi, '-')}.json`, content);
    const sent = apiRequests();
    const asked = await toPasswordStep(path);
    check(`${what} passes the first step`, asked);
    if (!asked) continue;
    check(`${what} shows no refusal before its password`, !(await page.eval('document.body.innerText')).includes(copy));
    await openWith(VAULT_PASSWORD);
    check(`${what} is refused at the second step with its message`, await showsText(copy));
    check(`${what} reaches no review`, !(await reviewShown()));
    check(`${what} sends no request`, apiRequests() === sent, String(apiRequests() - sent));
  }
  check('nothing a refused file did changed the vault', JSON.stringify(vaultRows()) === JSON.stringify(before));

  // -- A sealed file restores (criterion 54) --------------------------------

  await unlockScreen();
  check('the saved file reaches the password step', await toPasswordStep(good));
  await openWith(VAULT_PASSWORD);
  const review = await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 90000, label: 'the review' })
    .then(() => page.eval("document.querySelector('.review').innerText"), () => '');
  check('the review of a sealed file names when it was exported, and prints no blank',
    review.includes(String(new Date().getUTCFullYear())) && !/null|undefined|Invalid|NaN/.test(review), review);
  check('the review of the current format says nothing of an earlier version', review !== '' && !review.includes(OLDER));
  await setValue('#import-erase', 'ERASE');
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Replace my vault').click()");
  check('the sealed file restores', await showsText(REPLACED));
  const after = vaultRows();
  check('the restore brings back every record by id, kind and holding link, each at version 1',
    JSON.stringify(after.map(({ version, ...r }) => r)) === JSON.stringify(before.map(({ version, ...r }) => r)) &&
      after.every((r) => r.version === 1));
  const read = await vaultValue((v) => ({ names: [...v.holdings.values()].map((h) => h.payload.name).sort(), unreadable: v.unreadable.length }));
  check('every restored holding reads', JSON.stringify(read.names) === JSON.stringify(HOLDINGS.map(([n]) => n).sort()) && read.unreadable === 0,
    JSON.stringify(read));

  // -- The format 1 fixture still restores (criterion 41) -------------------

  await unlockScreen();
  check('the format 1 fixture reaches the password step', await toPasswordStep(FIXTURE.pathname));
  await openWith(FIXTURE_PASSWORD);
  const older = await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 90000, label: 'the fixture review' })
    .then(() => page.eval("document.querySelector('.review').innerText"), () => '');
  check('the review says a format 1 file was written by an earlier version', older.includes(OLDER), older);
  await setValue('#import-erase', 'ERASE');
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Replace my vault').click()");
  check('the format 1 fixture restores', await showsText(REPLACED));
  const fixtureIds = JSON.parse(readFileSync(FIXTURE, 'utf8')).records.map((r) => r.recordId).sort();
  check('the vault holds the fixture records', JSON.stringify(vaultRows().map((r) => r.recordId)) === JSON.stringify(fixtureIds));
  const fixtureRead = await vaultValue((v) => ({ names: [...v.holdings.values()].map((h) => h.payload.name), unreadable: v.unreadable.length }));
  check('the fixture holding reads', JSON.stringify(fixtureRead) === JSON.stringify({ names: ['Fixture savings'], unreadable: 0 }),
    JSON.stringify(fixtureRead));
});
