// A damaged or newer backup refused at its password, and a restore that
// keeps nothing over a lock, written from spec/features/export-import.md
// (Screens, Import steps 2 to 4 and the paragraph after them; The
// decryption wait; States; criteria 11, 15, 16, 22, 56, 57),
// spec/features/login.md (Unlock, Rules: a restore from a file keeps
// nothing) and spec/architecture.md (Session key handling), without
// reading how the screen is built.
//
// The files are made from the one the Export vault button saves: its
// envelope opened and resealed under the vault's own key and the AAD the
// spec pins, by WebCrypto. A record the file adds is sealed under its own
// AAD by the page's record encryption, so it is one the file could carry.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASE, VAULT_PASSWORD, check, enterPassword, expectedFailures, occurring, page, run, setProfile, setValue, sql, story,
  unlockInPlace, vaultOwner, vaultValue, watched, within,
} from '../harness.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'solvent-review-damaged-'));
const OWNER = "(SELECT id FROM principals WHERE username = 'leander')";
const AAD = 'solvent-vault\u001f2';
const DAMAGED_HEAD = 'This file is damaged and cannot be restored.';
const UNCHANGED = 'Your vault is unchanged.';
const ONE_DAMAGED = `${DAMAGED_HEAD} 1 record in it could not be read. ${UNCHANGED}`;
const NOT_A_FILE = 'That is not a Solvent vault file, or it has been damaged.';
const WRONG_PASSWORD = 'That password does not open this file.';
const REPLACED = 'Your vault was replaced from the file';
// A holding only the files carry, so finding its name in the page's heap
// means the page kept a payload it decrypted from the file.
const MARKER = 'Quillfeather reserve 7Q3';
// A dimension label only the file's profile carries, once the vault's
// own profile has dropped it.
const SETTING = 'Marlinspike provision 4K';
const FILE_ONLY = [MARKER, SETTING];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// A step-2 run over this many figures lasts long enough to lock during.
const MANY = 3000;

const vaultRows = () =>
  sql(`SELECT record_id, record_type, account_id, schema_version, version, nonce, ciphertext FROM records WHERE principal_id = ${OWNER} ORDER BY record_id`);
const apiRequests = () => watched[0].requests.filter((r) => new URL(r.url).pathname.startsWith('/api/')).length;
const imports = () => watched[0].requests.filter((r) => new URL(r.url).pathname === '/api/import').length;
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

const exportFile = async () => {
  const downloads = join(DIR, 'downloads');
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
  check('the export saves one file', saved.length === 1, saved.join(','));
  return saved.length ? JSON.parse(readFileSync(join(downloads, saved[0]), 'utf8')) : {};
};

// The envelope's payload, opened with the open vault's DEK.
const openEnvelope = (file) =>
  page.call(async (nonce, ciphertext, label) => {
    const dek = (await import('/static/js/session.js')).currentVault().dek;
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(nonce), additionalData: new TextEncoder().encode(label) }, dek, bytes(ciphertext),
    );
    return new TextDecoder().decode(plain);
  }, file.nonce, file.ciphertext, AAD).then(JSON.parse);

// `payload` sealed under the open vault's DEK, beside `file`'s header.
const reseal = async (file, payload) => {
  const sealed = await page.call(async (body, label) => {
    const dek = (await import('/static/js/session.js')).currentVault().dek;
    const b64 = (buffer) => btoa(Array.from(new Uint8Array(buffer), (b) => String.fromCharCode(b)).join(''));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(label) }, dek, new TextEncoder().encode(body),
    );
    return JSON.stringify({ nonce: b64(nonce), ciphertext: b64(ciphertext) });
  }, JSON.stringify(payload), AAD).then(JSON.parse);
  return { ...file, ...sealed };
};

// Records as an export carries them, each sealed under its own AAD with
// the open vault's DEK. Each spec is { recordType, accountId, schemaVersion, payload }.
const sealRecords = (specs) =>
  page.call(async (list) => {
    const c = await import('/static/js/crypto.js');
    const dek = (await import('/static/js/session.js')).currentVault().dek;
    const out = [];
    for (const { payload, ...fields } of list) {
      const slot = { recordId: c.uuid4(), version: 1, ...fields };
      out.push({ ...slot, ...(await c.encryptRecord(dek, slot, payload)) });
    }
    return JSON.stringify(out);
  }, specs).then(JSON.parse);

// How many of `needles` the page itself still reaches, after a
// collection. The harness's own scan counts every string in the heap,
// and DevTools keeps nodes a test touched, which would hold a card's
// closures past a lock in a way no person's browser does, so what only
// a DevTools handle reaches is left out.
const heldByPage = async (needles) => {
  await page.frames();
  const chunks = [];
  const collect = (message) => {
    if (message.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(message.params.chunk);
  };
  page.on(collect);
  await page.send('HeapProfiler.enable');
  await page.send('HeapProfiler.collectGarbage');
  await page.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await page.send('HeapProfiler.disable');
  page.handlers = page.handlers.filter((h) => h !== collect);
  const { snapshot: { meta }, nodes, edges, strings } = JSON.parse(chunks.join(''));
  const width = meta.node_fields.length;
  const edgeWidth = meta.edge_fields.length;
  const [nodeTypes] = meta.node_types;
  const [edgeTypes] = meta.edge_types;
  const firstEdge = [];
  for (let node = 0, edge = 0; node < nodes.length / width; node++) {
    firstEdge.push(edge);
    edge += nodes[node * width + 4] * edgeWidth;
  }
  const reached = new Uint8Array(nodes.length / width);
  const queue = [0];
  reached[0] = 1;
  while (queue.length) {
    const node = queue.pop();
    for (let edge = firstEdge[node]; edge < firstEdge[node] + nodes[node * width + 4] * edgeWidth; edge += edgeWidth) {
      const type = edgeTypes[edges[edge]];
      if (type === 'weak') continue;
      if (type !== 'element' && type !== 'hidden' && String(strings[edges[edge + 1]]).includes('DevTools')) continue;
      const to = edges[edge + 2] / width;
      if (!reached[to]) {
        reached[to] = 1;
        queue.push(to);
      }
    }
  }
  const texts = [];
  reached.forEach((on, node) => {
    if (on && nodeTypes[nodes[node * width]].includes('string')) texts.push(strings[nodes[node * width + 1]]);
  });
  return occurring(needles, (needle) => texts.some((t) => t.includes(needle)));
};

const shown = (selector) => page.call((query) => {
  const node = document.querySelector(query);
  return Boolean(node) && !node.closest('[hidden]') && node.offsetParent !== null;
}, selector);
const reviewShown = () => shown('.review');
const showsText = (copy, timeout = 90000) =>
  page.waitUntil((words) => document.body.innerText.includes(words), { args: [copy], timeout, label: copy })
    .then(() => true, () => false);
const bodyText = () => page.eval('document.body.innerText');

const chooseFile = async (path) => {
  await page.waitUntil("document.querySelector('#import-file')", { label: 'the import step' });
  const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
  await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
  await page.send('Runtime.releaseObject', { objectId: result.objectId });
};
const passwordAsked = () =>
  page.waitUntil("(() => { const n = document.querySelector('#import-password'); return n && !n.closest('[hidden]') && n.offsetParent !== null; })()", {
    timeout: 30000, label: 'the password step',
  }).then(() => true, () => false);
const toPasswordStep = (path) => chooseFile(path).then(passwordAsked);
const openWith = async (password) => {
  await setValue('#import-password', password);
  await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent.trim() === 'Open the file').click()");
};
const toReview = () =>
  page.waitUntil("(() => { const n = document.querySelector('.review'); return n && !n.closest('[hidden]') && n.offsetParent !== null; })()", {
    timeout: 90000, label: 'the review',
  }).then(() => true, () => false);
const replace = () =>
  page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent.trim() === 'Replace my vault')?.click()");
const lock = () =>
  page.eval("[...document.querySelectorAll('.topbar-actions button')].find(b => b.textContent.trim() === 'Lock').click()");

// What the import card holds: a chosen file, a password, a review, a typed word.
const flowState = () => page.call(() => {
  const visible = (node) => Boolean(node) && !node.closest('[hidden]') && node.offsetParent !== null;
  const file = document.querySelector('#import-file');
  const password = document.querySelector('#import-password');
  const erase = document.querySelector('#import-erase');
  return JSON.stringify({
    files: file ? file.files.length : -1,
    passwordAsked: visible(password),
    password: password ? password.value : '',
    review: visible(document.querySelector('.review')),
    erase: erase ? erase.value : '',
  });
}).then(JSON.parse);
const atStepOne = (state) => state.files === 0 && !state.passwordAsked && state.password === '' && !state.review && state.erase === '';

const unlockScreen = async () => {
  await page.goto(`${BASE}/settings/export-import`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.querySelector('#export') && document.querySelector('#import-file')", {
    timeout: 90000, label: 'the export and import screen',
  });
  await page.idle();
};
const backToScreen = () =>
  page.waitUntil("document.querySelector('#import-file') && !document.querySelector('#unlock-password')", {
    timeout: 90000, label: 'the export and import screen again',
  }).then(() => page.idle());

await run(async () => {
  await vaultOwner();
  await story();
  await setProfile({ dimensions: [{ id: 'c3d4e5f6', label: SETTING, archivedAt: null, values: [] }] });
  await unlockScreen();

  const file = await exportFile();
  const inside = await openEnvelope(file);
  await setProfile({ dimensions: [] });
  const holdingId = inside.records.find((r) => r.recordType === 'account').recordId;
  const [marker] = await sealRecords([{
    recordType: 'account', accountId: null, schemaVersion: 1,
    payload: { name: MARKER, unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
  }]);
  const records = [...inside.records, marker];
  const fileIds = records.flatMap((r) => [r.recordId, r.accountId]).filter(Boolean);
  const header = { salt: file.salt, kdf: file.kdf, wrappedDek: file.wrappedDek, dekNonce: file.dekNonce };
  const formatOne = (list) => ({ format: 'solvent-vault', formatVersion: 1, exportedAt: inside.exportedAt, ...header, records: list });
  const sealedWith = (list) => reseal(file, { exportedAt: inside.exportedAt, records: list });
  // The records at `at` with one byte altered, in the body or in the tag.
  const damage = (list, at) => list.map((r, i) =>
    (at.includes(i) ? { ...r, ciphertext: flipped(r.ciphertext, (n) => (i % 2 ? n - 1 : n >> 1)) } : r));

  const good = writeFile('good.json', await sealedWith(records));
  const before = vaultRows();
  expectedFailures.add('/api/import');

  // -- A record that does not decrypt is refused at step 2 (criterion 15) --

  const refusedAtStepTwo = async (what, path, copy) => {
    const sent = apiRequests();
    const asked = await toPasswordStep(path);
    check(`${what} passes step 1 to the password`, asked);
    if (!asked) return '';
    check(`${what} shows no refusal before its password`, !(await bodyText()).includes(DAMAGED_HEAD));
    await openWith(VAULT_PASSWORD);
    const said = await showsText(copy);
    check(`${what} is refused at step 2 with its message`, said, (await bodyText()).slice(-600));
    check(`${what} reaches no review`, !(await reviewShown()));
    check(`${what} asks for no ERASE`, !(await shown('#import-erase')));
    check(`${what} sends no request at all`, apiRequests() === sent, String(apiRequests() - sent));
    return bodyText();
  };
  const namesNoRecord = async (what, shownText) => {
    const html = await page.eval('document.documentElement.outerHTML');
    check(`${what} names no record: no id of the file and no UUID on the page`,
      !UUID.test(shownText) && !fileIds.some((id) => html.includes(id) || shownText.includes(id)));
  };

  let said = await refusedAtStepTwo('a sealed file with one byte altered in one record', writeFile('one.json',
    await sealedWith(records.map((r) => (r.recordId === holdingId ? { ...r, ciphertext: flipped(r.ciphertext, (n) => n >> 1) } : r)))),
  ONE_DAMAGED);
  await namesNoRecord('the one-record refusal', said);

  said = await refusedAtStepTwo('a sealed file with three records altered', writeFile('three.json', await sealedWith(damage(records, [0, records.length >> 1, records.length - 1]))),
    DAMAGED_HEAD);
  check('the refusal counts every record that failed, three of them',
    /\b3 records in it could not be read\b/.test(said) && said.includes(UNCHANGED), said.slice(-600));
  check('the record refusal is not the damaged-envelope message', !said.includes(NOT_A_FILE));
  await namesNoRecord('the three-record refusal', said);

  said = await refusedAtStepTwo('a format 1 file with one byte altered in one record',
    writeFile('format-1-one.json', formatOne(damage(records, [1]))), ONE_DAMAGED);
  await namesNoRecord('the format 1 refusal', said);

  said = await refusedAtStepTwo("a format 1 file with one record's nonce altered",
    writeFile('format-1-nonce.json', formatOne(records.map((r, i) => (i === 2 ? { ...r, nonce: flipped(r.nonce, () => 0) } : r)))),
    ONE_DAMAGED);
  await namesNoRecord('the nonce refusal', said);

  check('nothing a damaged file did changed the vault', JSON.stringify(vaultRows()) === JSON.stringify(before));
  const intact = await vaultValue((v) => ({ holdings: v.holdings.size, unreadable: v.unreadable.length }));
  check('the vault still reads whole after the refusals', intact.holdings === 4 && intact.unreadable === 0, JSON.stringify(intact));

  // -- A record at a newer schemaVersion is a newer file (criterion 56) -----

  await unlockScreen();
  const rest = new Set((await page.eval("document.querySelector('#import-card').innerText")).split('\n'));
  await chooseFile(writeFile('newer-format.json', { ...file, formatVersion: 3 }));
  await page.waitUntil(
    (was) => document.querySelector('#import-card').innerText.split('\n').some((l) => l.trim() && !was.includes(l)),
    { args: [[...rest]], timeout: 30000, label: 'the newer-file refusal' },
  ).catch(() => {});
  const newerCopy = (await page.eval("document.querySelector('#import-card').innerText")).split('\n')
    .filter((l) => l.trim() && !rest.has(l) && !l.includes('.json'));
  check('a newer formatVersion is refused at step 1 with a message', newerCopy.length > 0 && !(await shown('#import-password')),
    newerCopy.join(' | '));

  const [newer] = await sealRecords([{
    recordType: 'account', accountId: null, schemaVersion: 2,
    payload: { name: 'Later shape', unit: 'CHF', dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() },
  }]);
  const asNewer = (what, text) => {
    check(`${what} is refused as a newer file`, newerCopy.length > 0 && newerCopy.every((l) => text.includes(l)), text.slice(-600));
    check(`${what} is not called damaged`, !text.includes(DAMAGED_HEAD) && !text.includes(NOT_A_FILE));
  };

  let sent = apiRequests();
  await chooseFile(writeFile('format-1-newer.json', formatOne([...records, newer])));
  const refusedFirst = await page.waitUntil(
    (lines) => lines.every((l) => document.body.innerText.includes(l)), { args: [newerCopy], timeout: 30000, label: 'newer schema at step 1' },
  ).then(() => true, () => false);
  check('a format 1 file with a record at a newer schemaVersion is refused at step 1, before its password',
    refusedFirst && !(await shown('#import-password')));
  asNewer('the format 1 file with a newer record', await bodyText());
  check('the format 1 file with a newer record sends no request', apiRequests() === sent);

  sent = apiRequests();
  check('a sealed file with a record at a newer schemaVersion passes step 1',
    await toPasswordStep(writeFile('sealed-newer.json', await sealedWith([...records, newer]))));
  await openWith(VAULT_PASSWORD);
  const refusedSecond = await page.waitUntil(
    (lines) => lines.every((l) => document.body.innerText.includes(l)) || document.body.innerText.includes('damaged')
      || Boolean(document.querySelector('.review') && !document.querySelector('.review').closest('[hidden]')),
    { args: [newerCopy], timeout: 90000, label: 'newer schema at step 2' },
  ).then(() => true, () => false);
  check('the sealed file with a newer record is refused at step 2', refusedSecond && !(await reviewShown()));
  asNewer('the sealed file with a newer record', await bodyText());
  check('the sealed file with a newer record sends no request', apiRequests() === sent);
  check('nothing a newer file did changed the vault', JSON.stringify(vaultRows()) === JSON.stringify(before));

  // -- A wrong password keeps the file chosen (criterion 16) ----------------

  await unlockScreen();
  check("before the file is opened the page holds none of the file's payloads", (await heldByPage(FILE_ONLY)) === 0);
  sent = apiRequests();
  check('the good file reaches the password step', await toPasswordStep(good));
  await openWith('not the password of this file');
  check('a wrong password says it does not open this file', await showsText(WRONG_PASSWORD));
  let state = await flowState();
  check('after a wrong password the flow is back at step 2 with the file still chosen',
    state.files === 1 && state.passwordAsked && !state.review, JSON.stringify(state));
  check('a wrong password sends no request', apiRequests() === sent, String(apiRequests() - sent));
  await openWith(VAULT_PASSWORD);
  check('the right password then opens the file still chosen, to the review', await toReview());

  // -- The review holds no plaintext of the file (The decryption wait) ------

  check('during the review the page holds no payload decrypted from the file', (await heldByPage(FILE_ONLY)) === 0);

  // -- No ERASE, no restore (criterion 22) ----------------------------------

  check('the review of a non-empty vault asks for ERASE', await shown('#import-erase'));
  for (const typed of ['', 'erase', 'ERAS']) {
    await setValue('#import-erase', typed);
    await replace();
    check(`"Replace my vault" with "${typed}" typed sends no import`, imports() === 0);
  }
  check('without ERASE the vault is unchanged', JSON.stringify(vaultRows()) === JSON.stringify(before));

  // -- A lock at the review keeps nothing (criterion 57; login.md Rules) ---

  await setValue('#import-erase', 'ERASE');
  await lock();
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the unlock card' });
  check('the locked page holds no payload decrypted from the file', (await heldByPage(FILE_ONLY)) === 0);
  await unlockInPlace('unlocked after a lock at the review');
  await backToScreen();
  state = await flowState();
  check('a lock at the review starts the restore again at step 1: no file, no password, no review, no ERASE',
    atStepOne(state), JSON.stringify(state));
  check('after the lock and unlock the page holds no payload decrypted from the file', (await heldByPage(FILE_ONLY)) === 0);
  check('a lock at the review sends no import', imports() === 0);

  // -- Leaving the screen, choosing again ------------------------------------

  check('the good file reaches the password step again', await toPasswordStep(good));
  await openWith(VAULT_PASSWORD);
  check('and the review', await toReview());
  await setValue('#import-erase', 'ERASE');
  await page.eval("location.hash = '#/'");
  await page.waitUntil("!document.querySelector('#import-file')", { label: 'away from the screen' });
  await page.eval("location.hash = '#/settings/export-import'");
  await backToScreen();
  state = await flowState();
  check('leaving the screen at the review starts the restore again at step 1', atStepOne(state), JSON.stringify(state));

  check('the good file reaches the password step once more', await toPasswordStep(good));
  await openWith(VAULT_PASSWORD);
  check('and the review once more', await toReview());
  await setValue('#import-erase', 'ERASE');
  await chooseFile(writeFile('other.json', await sealedWith(inside.records)));
  await page.waitUntil(
    "(() => { const p = document.querySelector('#import-password'); return p && p.value === '' && !document.querySelector('.review').offsetParent; })()",
    { timeout: 10000, label: 'the earlier password and review to go' },
  ).catch(() => {});
  state = await flowState();
  check('choosing another file at the review drops the review, the password and ERASE',
    state.files === 1 && state.passwordAsked && state.password === '' && !state.review && state.erase === '', JSON.stringify(state));

  // -- A lock while step 2 runs stops it -------------------------------------

  const day = (n) => new Date(Date.UTC(2000, 0, 1) + n * 86400000).toISOString().slice(0, 10);
  const figures = await sealRecords(Array.from({ length: MANY }, (_, n) => ({
    recordType: 'snapshot', accountId: holdingId, schemaVersion: 1, payload: { date: day(n), value: String(n + 1), note: null },
  })));
  const big = writeFile('big.json', await sealedWith([...inside.records, ...figures]));
  check('the large file reaches the password step', await toPasswordStep(big));
  await openWith(VAULT_PASSWORD);
  const counted = await page.waitUntil("/Decrypting\\s.*\\bof\\b/.test(document.body.innerText)", {
    timeout: 60000, label: 'the decryption count',
  }).then(() => true, () => false);
  check('step 2 counts its records as it decrypts them', counted);
  await lock();
  await page.waitUntil("document.querySelector('#unlock-password')", { label: 'the unlock card mid-step' });
  await unlockInPlace('unlocked after a lock mid-step');
  await backToScreen();
  state = await flowState();
  check('a lock while step 2 runs starts the restore again at step 1', atStepOne(state), JSON.stringify(state));
  check('the good file reaches the password step after the stopped run', await toPasswordStep(good));
  await openWith(VAULT_PASSWORD);
  check('and its review', await toReview());
  const review = await page.eval("document.querySelector('.review').innerText");
  check("the review is the good file's, not the stopped run's", !/3[\s\u202f\u00a0',.’]?0\d\d/.test(review), review);

  // -- The restore that is confirmed goes through, re-keyed ---------------

  await setValue('#import-erase', 'ERASE');
  await replace();
  check('the confirmed restore replaces the vault', await showsText(REPLACED));
  check('the confirmed restore sends one import', imports() === 1, String(imports()));
  const restored = await vaultValue((v) => ({ names: [...v.holdings.values()].map((h) => h.payload.name), unreadable: v.unreadable.length }));
  check('the restored vault holds the file\'s holdings, the marker among them, all readable',
    restored.names.includes(MARKER) && restored.names.length === 5 && restored.unreadable === 0, JSON.stringify(restored));
  const fileKeyOpens = await page.call(async (record) => {
    const c = await import('/static/js/crypto.js');
    try {
      await c.decryptRecord((await import('/static/js/session.js')).currentVault().dek, record);
      return true;
    } catch {
      return false;
    }
  }, marker);
  check("the page's key after the restore is not the file's: a record of the file does not open under it", fileKeyOpens === false);
  const epoch = await page.eval("import('/static/js/api.js').then((a) => a.vaultEpoch())");
  check('the restoring page holds the epoch the vault now has',
    epoch === sql(`SELECT epoch FROM vault_epochs WHERE principal_id = ${OWNER}`)[0].epoch);
});
