// Export and import (spec/features/export-import.md, Export / import): the
// vault written to a file that opens with its own password, and restored
// from one, into the same vault, an empty one or another person's, with
// every refusal on the way.
// Templates: dashboard.html. Modules: page-transfer.js, transfer.js,
// transfer-worker.js, api.js, crypto.js, session.js, format.js.
import {
  BASE, BACKDATE, HANDS, enterPasswordOn, SECOND_PASSWORD, Session, VAULT_PASSWORD, answering, check, credentialOf, enterPassword,
  importOwnExport, intoVault, labels, launch, mintInvite, occurring, openBrowser, openTab, OWN, page, provoked, run, setProfile, setValue, redraw,
  signInOn, sql, story, text, vaultOwner, watched, within,
} from '../harness.mjs';

await run(async () => {
  await vaultOwner();
  await story();
  // The way this vault's owner writes dates and numbers, which a restore
  // brings back.
  await setProfile({ locale: 'de-CH', groupSeparator: 'apostrophe', moneyPlaces: '0', dateStyle: 'dmy' });

  // ---- Export, then import it back ---------------------------------------

  // A bookmark of the server address, which lands on the screen it
  // names.
  await page.goto(`${BASE}/settings`);
  await enterPassword(VAULT_PASSWORD);
  await page.waitUntil("document.body.innerText.includes('Main currency')", { timeout: 90000, label: 'settings again' });
  check('the settings address lands on the settings view', (await page.eval('location.hash')) === '#/settings');

  const beforeImport = JSON.parse(await page.eval(`(async () => {
    const s = await import('/static/js/session.js');
    const v = s.currentVault();
    const names = [...v.holdings.values()].map(h => h.payload.name).sort();
    return JSON.stringify({ names, holdings: v.holdings.size, unreadable: v.unreadable.length });
  })()`));
  check(
    'the vault reads back before the import',
    beforeImport.unreadable === 0 && beforeImport.holdings > 0,
    JSON.stringify(beforeImport),
  );

  const imported = JSON.parse(await importOwnExport());

  check('an import round-trips every holding', imported.names.join(',') === beforeImport.names.join(','), imported.names.join(','));
  check('every record reads back after the import', imported.unreadable === 0, String(imported.unreadable));
  check('the vault is re-keyed rather than restored verbatim', imported.rekeyed);
  check('both timelines survive the round trip', imported.kinds.includes('rate') && imported.kinds.includes('snapshot'), imported.kinds.join(','));

  const stillOpens = await page.eval(`(async () => {
    const response = await fetch('/api/auth/salt', {
      method: 'POST', headers: { 'X-Solvent-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'leander' }),
    });
    return response.status;
  })()`);
  check('the password is untouched by the import', stillOpens === 200);

  // ---- Export and import, through the screen (export-import.md) ----------

  {
    const { mkdtempSync, readdirSync, readFileSync, writeFileSync, truncateSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const vaultRows = () => JSON.stringify(sql(`SELECT records.* FROM records ${OWN} ORDER BY record_id`));
    const apiCalls = (part) =>
      page.call((name) => performance.getEntriesByType('resource').filter(e => e.name.includes(name)).length, part);
    // `read` is an async function of `{ v, c, t }` and then `args`, which
    // reach it as data. Its source is the only code text built here.
    const inPage = (read, ...args) =>
      page.call(`async (...args) => {
        const v = (await import('/static/js/session.js')).currentVault();
        const c = await import('/static/js/crypto.js');
        const t = await import('/static/js/transfer.js');
        return JSON.stringify(await (${read})({ v, c, t }, ...args));
      }`, ...args).then(JSON.parse);
    const unlockAt = async (address, ready) => {
      await page.goto(`${BASE}${address}`);
      await enterPassword(VAULT_PASSWORD);
      await page.waitUntil(ready, { timeout: 90000, label: address });
      await page.idle();
    };
    // Drawn afresh, so nothing a previous import left on it counts.
    const toScreen = async () => {
      await page.eval("location.hash = '#/settings'");
      await page.waitUntil("document.body.innerText.includes('Main currency')", { label: 'settings' });
      await page.eval("location.hash = '#/settings/export-import'");
      await page.waitUntil("document.querySelector('#import-file')", { label: 'the export and import screen' });
      await page.frames();
    };
    const dir = mkdtempSync(join(tmpdir(), 'solvent-transfer-'));
    const fixture = (name, content) => {
      const path = join(dir, name);
      writeFileSync(path, content);
      return path;
    };
    // The handle is released straight away: DevTools keeps whatever it
    // hands out alive, and a live handle to an element of a page since
    // navigated away would keep that page's decrypted vault reachable.
    // The screen has taken the file once it shows why it will not, or asks
    // for the password. The page's own listener runs first, so the mark
    // set after it says the screen has reacted.
    const chooseFile = async (path) => {
      await page.eval("window.__taken = false; document.querySelector('#import-file').addEventListener('change', () => { window.__taken = true; }, { once: true })");
      const { result } = await page.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
      await page.send('DOM.setFileInputFiles', { files: [path], objectId: result.objectId });
      await page.send('Runtime.releaseObject', { objectId: result.objectId });
      await page.waitUntil("window.__taken && (!document.querySelector('#import-card .field-error').hidden || !document.querySelector('#import-password').closest('[hidden]'))", { label: 'the file to be taken' });
    };
    const openWith = async (password) => {
      await page.waitUntil("!document.querySelector('#import-password').closest('[hidden]')", { label: 'the password step' });
      await setValue('#import-password', password);
      await page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Open the file').click()");
    };
    const replaceVault = () =>
      page.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Replace my vault').click()");
    const importError = () => page.eval("document.querySelector('#import-card .field-error').hidden ? '' : document.querySelector('#import-card .field-error').textContent");
    // Everything the vault decrypts to, keyed by record id.
    const decrypted = () =>
      inPage(async ({ v, c }) => {
        const api = await import('/static/js/api.js');
        const out = {};
        for (const type of ['profile', 'account', 'snapshot', 'rate']) {
          for (const row of await api.get('/api/records?type=' + type)) {
            out[row.recordId] = { type: row.recordType, accountId: row.accountId, payload: await c.decryptRecord(v.dek, row) };
          }
        }
        return Object.fromEntries(Object.entries(out).sort());
      });
    // The chart and the total in both pricing modes, as drawn.
    const picture = async () => {
      await page.eval("location.hash = '#/'");
      await page.waitUntil("document.querySelector('svg.trend')", { label: 'the dashboard to draw' });
      await page.frames();
      const mode = async (label) => {
        await page.call((name) => [...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes(name)).click(), label);
        await page.frames();
        return page.eval("document.querySelector('svg.trend').outerHTML + '|' + document.querySelector('.hero-figure').textContent");
      };
      return JSON.stringify([await mode('as of each figure'), await mode('Latest rates')]);
    };

    await unlockAt('/settings/export-import', "document.querySelector('#export')");

    // -- Export ------------------------------------------------------------

    const downloads = join(dir, 'downloads');
    await page.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const order = await page.eval(`(() => {
      const warning = document.querySelector('#export-card .sensitivity');
      const button = document.querySelector('#export');
      return JSON.stringify({
        warning: warning ? warning.textContent : '',
        before: Boolean(warning && warning.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
        tag: button.tagName,
      });
    })()`).then(JSON.parse);
    check(
      'the sensitivity warning is on screen before the download is triggered',
      order.warning.includes('exactly as sensitive as your password') && order.warning.includes('permanently unreadable') &&
        order.before && order.tag === 'BUTTON',
      JSON.stringify(order),
    );
    const downloaded = new Promise((resolve) => {
      const done = (message) => {
        if (message.method !== 'Page.downloadProgress' || message.params.state !== 'completed') return;
        page.handlers = page.handlers.filter((h) => h !== done);
        resolve();
      };
      page.on(done);
    });
    await page.eval("document.querySelector('#export').click()");
    await within(downloaded, 30000);
    let saved = [];
    try {
      saved = readdirSync(downloads);
    } catch {}
    const filename = saved.find((n) => n.endsWith('.json')) || '';
    check('the export lands as a dated file naming nobody', /^solvent-vault-\d{4}-\d{2}-\d{2}\.json$/.test(filename), saved.join(','));
    const exportedPath = join(downloads, filename);
    const exportedText = readFileSync(exportedPath, 'utf8');
    const exported = JSON.parse(exportedText);
    // What the file seals, opened with its password.
    const contents = await inPage(async ({ t }, file, password) => {
      const { exportedAt, records } = await t.openFile(file, password);
      return { exportedAt, records };
    }, exported, VAULT_PASSWORD);
    // The same contents as a format 1 file, which keeps its records in
    // the open, for the refusals checked before a password is asked for.
    const formatOne = (change = () => {}) => {
      const { nonce, ciphertext, ...header } = exported;
      const file = { ...header, formatVersion: 1, ...JSON.parse(JSON.stringify(contents)) };
      change(file);
      return JSON.stringify(file);
    };
    check(
      'the exported file shows no record id, holding id, edit counter or timestamp',
      !('records' in exported) && !('exportedAt' in exported) &&
        contents.records.every((r) => !exportedText.includes(r.recordId)) &&
        !exportedText.includes(contents.exportedAt.slice(0, 10)),
      Object.keys(exported).join(','),
    );
    await page.waitUntil("!document.querySelector('#export-card [role=status]').hidden", { label: 'what the file holds' });
    check(
      'afterwards the screen says what the file holds, both timelines named',
      /\d+ holdings, \d+ recorded figures and \d+ captured prices, about \d+ KB/.test(
        await page.eval("document.querySelector('#export-card [role=status]').textContent"),
      ),
    );

    // Every plaintext the vault holds, looked for in the file's bytes:
    // outside the encoded fields, and inside them once decoded.
    const needles = await inPage(({ v }) => {
      const out = new Set([v.mainCurrency]);
      for (const h of v.holdings.values()) [h.payload.name, h.payload.note, h.payload.unit].forEach((x) => x && out.add(x));
      for (const d of v.dimensions) { out.add(d.label); d.values.forEach((x) => out.add(x.label)); }
      for (const list of v.snapshots.values()) for (const s of list) { out.add(s.payload.date); if (s.payload.value.length >= 4) out.add(s.payload.value); }
      for (const list of v.rates.values()) for (const r of list) { out.add(r.payload.symbol); out.add(r.payload.date); if (r.payload.rate.length >= 4) out.add(r.payload.rate); }
      return [...out];
    });
    // Encoded fields, random ids and the export's own timestamp carry no
    // vault content, so they are blanked before the plain scan.
    const opaque = /"(salt|wrappedDek|dekNonce|nonce|ciphertext|recordId|accountId|exportedAt)":\s*"([^"]*)"/g;
    const outside = exportedText.replace(opaque, '"$1":""');
    const encoded = [...exportedText.matchAll(opaque)]
      .filter(([, key]) => !['recordId', 'accountId', 'exportedAt'].includes(key))
      .map(([, , value]) => Buffer.from(value, 'base64'));
    const found = needles.filter(
      (needle) =>
        outside.includes(needle) ||
        (needle.length >= 5 && encoded.some((bytes) => bytes.includes(Buffer.from(needle, 'utf8')))),
    );
    check(
      'the exported file holds no name, note, label, value, rate, symbol, date or currency in plaintext',
      needles.length > 10 && found.length === 0,
      found.join(' | '),
    );

    // The export failing, or at its ceiling, as the screen shows it.
    await answering((r) => r.url.endsWith('/api/export'), 500, async () => {
      await page.eval("document.querySelector('#export').click()");
      await page.waitUntil("!document.querySelector('#export-card .field-error').hidden", { label: 'the failed export' });
    });
    check(
      'a failed export says nothing was written and nothing changed, and the button rests',
      (await page.eval("document.querySelector('#export-card .field-error').textContent")).includes('Nothing was written to disk and nothing in your vault changed') &&
        !(await page.eval("document.querySelector('#export').disabled")),
    );
    await answering((r) => r.url.endsWith('/api/export'), 429, async () => {
      await page.eval("document.querySelector('#export').click()");
      await page.waitUntil("document.querySelector('#export-card .field-error').textContent.includes('several times')", { label: 'the export ceiling' });
    });
    check('at the export ceiling the button is disabled with the reason beside it', await page.eval("document.querySelector('#export').disabled"));

    // A plain navigation to the endpoint, with a live session cookie,
    // away from the unlocked vault showing its holdings.
    await page.eval("location.hash = '#/'");
    await page.waitUntil("document.querySelector('.holdings-table')", { label: 'the dashboard before leaving it' });
    await page.frames();
    const leftNames = JSON.parse(await page.eval(`(async () => JSON.stringify(
      [...(await import('/static/js/session.js')).currentVault().holdings.values()].map((h) => h.payload.name)
    ))()`));
    const alive = await page.eval(`(async () => (await fetch('/api/sessions', { headers: ${HANDS} })).status)()`);
    // A download this page starts is what writes a file. The browser's
    // own background downloads reach the same folder and are not the
    // page's, so the page's downloads are what is counted.
    const started = [];
    const noteDownload = (message) => {
      if (message.method === 'Page.downloadWillBegin') started.push(message.params.url);
    };
    page.on(noteDownload);
    await page.goto(`${BASE}/api/export`);
    await page.idle();
    page.handlers = page.handlers.filter((h) => h !== noteDownload);
    const statuses = [await page.eval("performance.getEntriesByType('navigation')[0].responseStatus")];
    check(
      'a top-level navigation to the export, with a valid session cookie, is Forbidden and writes no file',
      alive === 200 && statuses.join(',') === '403' && started.length === 0,
      `session ${alive}, answered ${statuses.join(',')}, downloads started ${started.join(',')}`,
    );

    // Back, to the page left while unlocked. Whether the browser restores
    // it from its back-forward cache or loads it afresh, it holds no key
    // and shows nothing from the vault.
    await page.send('Page.navigateToHistoryEntry', {
      entryId: await page.send('Page.getNavigationHistory').then(({ currentIndex, entries }) => entries[currentIndex - 1].id),
    });
    let back = null;
    if (await page.holds("location.pathname === '/dashboard' && document.querySelector('#unlock-password')")) {
      back = JSON.parse(await page.eval(`(async () => JSON.stringify({
        keys: (await import('/static/js/session.js')).currentVault() !== null,
        text: document.body.innerText,
        how: performance.getEntriesByType('navigation')[0].type,
      }))()`));
    }
    const shownAgain = back ? occurring(leftNames, (name) => back.text.includes(name)) : 0;
    check(
      'Back to a page left while unlocked shows the unlock card and no vault data',
      Boolean(back) && !back.keys && leftNames.length > 0 && shownAgain === 0,
      back ? `${back.how}, ${shownAgain} names shown` : 'no unlock card',
    );

    // -- Import: files and passwords that go nowhere ---------------------------

    await unlockAt('/settings/export-import', "document.querySelector('#import-file')");
    // Leaving the page locks it, keys and decrypted state alike, the way
    // the idle timer does, and unlocking brings the screen back.
    await page.eval("window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))");
    await page.holds("document.querySelector('#unlock-password')");
    check(
      'the vault locks on pagehide, discarding the keys and the decrypted state',
      (await page.eval("(async () => (await import('/static/js/session.js')).currentVault() === null)()")) &&
        (await page.eval("Boolean(document.querySelector('#unlock-password'))")) &&
        !(await page.eval("Boolean(document.querySelector('#import-file'))")),
    );
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('#import-file')", { timeout: 90000, label: 'the import screen after the pagehide lock' });
    await page.idle();
    const rowsBefore = vaultRows();
    const uploads = () => apiCalls('/api/import');

    await chooseFile(fixture('not-json.json', 'this is not a vault'));
    check('a file that is not JSON is refused at the first step', (await importError()).includes('not a Solvent vault file') &&
      (await page.eval("Boolean(document.querySelector('#import-password').closest('[hidden]'))")));
    await chooseFile(fixture('newer.json', JSON.stringify({ ...exported, formatVersion: exported.formatVersion + 1 })));
    check('a file from a newer version is refused at the first step', (await importError()).includes('newer version'));
    await chooseFile(fixture('bad-type.json', formatOne((f) => { f.records[0].recordType = 'invoice'; })));
    check('a file the server would refuse is refused before it is opened', (await importError()).includes('not a Solvent vault file'));
    const withoutProfile = (f) => { f.records = f.records.filter((r) => r.recordType !== 'profile'); };
    await chooseFile(fixture('no-profile.json', formatOne(withoutProfile)));
    check(
      'a file with no profile record is refused at the first step, before any password is asked for',
      (await importError()) === 'This file carries no vault settings, so it would restore a vault with no main currency. It cannot be restored.' &&
        (await page.eval("Boolean(document.querySelector('#import-password').closest('[hidden]'))")) &&
        (await uploads()) === 0,
      await importError(),
    );
    const large = fixture('large.json', '');
    truncateSync(large, 65 * 1024 * 1024);
    await chooseFile(large);
    check('an oversized file is refused by its size', (await importError()).includes('too large'));

    // A sealed file shows its records only once its password opens it,
    // so these are refused there, still before any request.
    const sealedWithoutProfile = await inPage(async ({ t }, file, password) => {
      const opened = await t.openFile(file, password);
      const records = opened.records.filter((r) => r.recordType !== 'profile');
      return t.sealFile(opened.fileDek, { ...file, exportedAt: opened.exportedAt, records });
    }, exported, VAULT_PASSWORD);
    const envelope = Buffer.from(exported.ciphertext, 'base64');
    envelope[5] ^= 0x01;
    const damaged = { ...exported, ciphertext: envelope.toString('base64') };
    for (const [name, file, says] of [
      ['sealed-no-profile.json', sealedWithoutProfile, 'carries no vault settings'],
      ['damaged.json', damaged, 'has been damaged'],
    ]) {
      await chooseFile(fixture(name, JSON.stringify(file)));
      await openWith(VAULT_PASSWORD);
      await page.waitUntil((words) => document.querySelector('#import-card .field-error').textContent.includes(words), { args: [says], timeout: 60000, label: name });
      check(
        `a sealed file that ${says} is refused once its password opens it, uploading nothing`,
        (await uploads()) === 0 && (await page.eval("document.querySelector('.review').hidden")) && vaultRows() === rowsBefore,
        await importError(),
      );
    }

    await chooseFile(exportedPath);
    const callsBefore = await apiCalls('/api/');
    await openWith('not the password of this file');
    await page.waitUntil("document.querySelector('#import-card .field-error').textContent.includes('does not open')", { timeout: 60000, label: 'the wrong password' });
    check(
      'a wrong password for the file stops there, sends nothing, and keeps the file chosen',
      (await apiCalls('/api/')) === callsBefore &&
        (await page.eval("document.querySelector('#import-file').files.length")) === 1 &&
        (await page.eval("document.querySelector('.review').hidden")),
    );

    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review' });
    const kinds = { account: 0, snapshot: 0, rate: 0 };
    for (const record of contents.records) if (record.recordType in kinds) kinds[record.recordType] += 1;
    const review = await page.eval("document.querySelector('.review').innerText");
    const total = sql(`SELECT record_id FROM records ${OWN}`).length;
    check(
      'the review sets what is in the file against what will be deleted, prices on their own line',
      review.includes(`${kinds.account} holdings`) && review.includes(`${kinds.rate} captured prices`) &&
        review.includes(`Your vault currently holds ${total} records. All of them will be deleted.`) &&
        !review.includes('This vault is kept in'),
      review,
    );
    check(
      'the review of a same-currency, current-version file prints no "null" where a line does not apply',
      !/null/i.test(review) && !/null/i.test(await page.eval("document.querySelector('.review').textContent")),
      review,
    );
    await replaceVault();
    await page.holds("!document.querySelector('#import-card .field-error').hidden");
    check(
      'a vault holding records is not replaced without ERASE typed',
      (await importError()).includes('Type ERASE') && (await uploads()) === 0 && vaultRows() === rowsBefore,
    );

    const altered = JSON.parse(formatOne());
    const target = altered.records.find((record) => record.recordType === 'snapshot');
    const bytes = Buffer.from(target.ciphertext, 'base64');
    bytes[5] ^= 0x01;
    target.ciphertext = bytes.toString('base64');
    await chooseFile(fixture('altered.json', JSON.stringify(altered)));
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('#import-card .field-error').textContent.includes('damaged')", { timeout: 60000, label: 'the refused record' });
    check(
      'one byte altered in one record is refused before the review, counted and not named, uploading nothing',
      (await importError()) === 'This file is damaged and cannot be restored. 1 record in it could not be read. Your vault is unchanged.' &&
        (await page.eval("document.querySelector('.review').hidden && document.querySelector('.confirm-step').hidden")) &&
        (await uploads()) === 0 && vaultRows() === rowsBefore,
      await importError(),
    );

    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review before the lock' });
    await setValue('#import-erase', 'ERASE');
    await page.eval("document.querySelector('.btn-lock').click()");
    await page.waitUntil("document.querySelector('#unlock-password')", { timeout: 20000, label: 'the lock during the import' });
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('#import-file')", { timeout: 90000, label: 'the import screen after the lock' });
    check(
      'a lock during the import starts it again at the first step, with no review and no typed ERASE',
      await page.eval("document.querySelector('.review').hidden && Boolean(document.querySelector('#import-password').closest('[hidden]')) && document.querySelector('#import-erase').value === '' && document.querySelector('#import-file').files.length === 0"),
      await page.eval("document.querySelector('#import-card').innerText"),
    );

    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review again' });
    await setValue('#import-erase', 'ERASE');
    provoked.push('/api/import');
    await answering((r) => r.url.endsWith('/api/import'), 500, async () => {
      await replaceVault();
      await page.waitUntil("document.querySelector('#import-card .field-error').textContent.includes('fully intact')", { timeout: 60000, label: 'the refused upload' });
    });
    check('an import the server refuses says the original vault is intact, and it is', vaultRows() === rowsBefore);

    // The password changes in another tab: the credential's salt moves on
    // while this page holds the Master Key from before.
    const ownCredential = 'principal_id = (SELECT id FROM principals WHERE username = ?)';
    const [{ params: paramsBefore }] = sql(`SELECT params FROM credentials WHERE ${ownCredential}`, 'leander');
    sql(`UPDATE credentials SET params = json_set(params, '$.salt', ?) WHERE ${ownCredential}`, 'AAAAAAAAAAAAAAAAAAAAAA==', 'leander');
    await toScreen();
    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review after the password changed' });
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.querySelector('#unlock-password')", { timeout: 60000, label: 'the lock after the password changed' });
    check(
      'an import after the password changed elsewhere writes nothing, locks the page and says why',
      vaultRows() === rowsBefore &&
        (await page.eval("document.querySelector('.signin-card .callout')?.textContent ?? ''")).includes('Unlock with your current password, then restore again.'),
      await page.eval('document.body.innerText'),
    );
    sql(`UPDATE credentials SET params = ? WHERE ${ownCredential}`, paramsBefore, 'leander');
    await enterPassword(VAULT_PASSWORD);
    await page.waitUntil("document.querySelector('#import-file')", { timeout: 90000, label: 'the import screen after unlocking' });
    check(
      'unlocking returns to the import screen without the notice',
      !(await page.eval("Boolean(document.querySelector('.signin-card'))")),
    );
    provoked.splice(provoked.indexOf('/api/import'), 1);

    // -- Import: the real thing -------------------------------------------------

    const recordsBefore = await decrypted();
    const drawnBefore = await picture();
    const credentialBefore = credentialOf('leander');
    await toScreen();
    await page.eval('window.__samePage = true');
    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review to replace' });
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the import to land' });
    await page.idle();
    check(
      'an import decrypts and re-encrypts in a Worker, and the view reloads in place confirming what came back',
      (await apiCalls('transfer-worker.js')) > 0 && (await page.eval('window.__samePage === true')) &&
        !(await page.eval("Boolean(document.querySelector('#unlock-password'))")) &&
        (await text()).includes(`${kinds.account} holdings, ${kinds.snapshot} recorded figures and ${kinds.rate} captured prices`),
    );
    const versions = sql(`SELECT DISTINCT version FROM records ${OWN}`).map((row) => row.version);
    check('every record reads version 1 after an import', versions.join(',') === '1', versions.join(','));
    const credentialAfter = credentialOf('leander');
    check(
      'an import replaces the wrapper and leaves the salt, the envelope and the verifier byte-identical',
      credentialAfter.params === credentialBefore.params && credentialAfter.verifier === credentialBefore.verifier &&
        credentialAfter.wrapped_dek !== credentialBefore.wrapped_dek && credentialAfter.dek_nonce !== credentialBefore.dek_nonce,
    );
    const keys = await inPage(async ({ v, c, t }, params, password, wrapped, nonce, fileText) => {
      const raw = async (key) => c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
      const master = (await c.deriveKeys(password, params.salt, params.kdf)).masterKey;
      const stored = await c.unwrapDek(wrapped, nonce, master);
      const file = (await t.openFile(fileText, password)).fileDek;
      return { stored: await raw(stored), file: await raw(file), memory: await raw(v.dek) };
    }, JSON.parse(credentialAfter.params), VAULT_PASSWORD, credentialAfter.wrapped_dek, credentialAfter.dek_nonce, exported);
    check(
      "after an import the stored wrapper unwraps to a key that is not the file's, and it is the one in use",
      keys.stored !== keys.file && keys.stored === keys.memory,
    );
    check(
      'the round trip restores the same ids, types, links and payloads, figures and prices alike',
      JSON.stringify(await decrypted()) === JSON.stringify(recordsBefore),
    );
    check('the chart and the total in both pricing modes come back identical', (await picture()) === drawnBefore);

    await unlockAt('/dashboard', "document.querySelector('svg.trend')");
    const reread = await inPage(({ v }) => ({ unreadable: v.unreadable.length, records: v.holdings.size }));
    check(
      'after an import the unchanged password signs in and every record reads',
      reread.unreadable === 0 && reread.records === kinds.account,
      JSON.stringify(reread),
    );
    const stillOpens = await inPage(async ({ t }, file, password) => {
      const { fileDek, records } = await t.openFile(file, password);
      return (await t.decryptAll(fileDek, records)).length === records.length;
    }, exported, VAULT_PASSWORD);
    check('the exported file still opens with its own password after the vault was re-keyed', stillOpens);

    // -- A vault transfer, from a second owner -----------------------------------

      const other = await launch();
    try {
      const second = await Session.connect(other.target);
      await second.send('Page.enable');
      await second.send('Runtime.enable');
      const fill = (fields) =>
        second.call((entries) => {
          for (const [selector, value, index] of entries) {
            const node = document.querySelectorAll(selector)[index || 0];
            if (node.type === 'checkbox') node.checked = value;
            else node.value = value;
            node.dispatchEvent(new Event(node.tagName === 'SELECT' || node.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
          }
        }, fields);
      const invite = mintInvite('vault-owner');
      await second.goto(`${BASE}/register?invite=${invite}`);
      await fill([
        ['input[type=text]', 'second.owner'],
        ['input[type=password]', SECOND_PASSWORD, 0],
        ['input[type=password]', SECOND_PASSWORD, 1],
        ['select', 'EUR'],
        ['input[type=checkbox]', true],
      ]);
      await second.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
      await second.eval("document.querySelector('button[type=submit]').click()");
      await second.waitUntil("location.pathname === '/dashboard'", { timeout: 90000, label: 'the second vault' });
      await second.waitUntil("document.body.innerText.includes('Add your first holding')", { timeout: 90000, label: 'the empty second vault' });

      // An empty vault's review says so, and asks for no typed word.
      await second.eval("location.hash = '#/settings/export-import'");
      await second.waitUntil("document.querySelector('#import-file')", { label: 'the second import screen' });
      const { result } = await second.send('Runtime.evaluate', { expression: "document.querySelector('#import-file')" });
      await second.send('DOM.setFileInputFiles', { files: [exportedPath], objectId: result.objectId });
      await second.waitUntil("!document.querySelector('#import-password').closest('[hidden]')", { label: 'the password step' });
      await fill([['#import-password', VAULT_PASSWORD]]);
      await second.eval("[...document.querySelectorAll('#import-card button')].find(b => b.textContent === 'Open the file').click()");
      await second.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review into an empty vault' });
      check(
        'into an empty vault the review says nothing will be deleted, and no word is typed',
        (await second.eval("document.querySelector('.review').innerText")).includes('Your vault is empty. Nothing will be deleted.') &&
          !(await second.eval("Boolean(document.querySelector('#import-erase'))")),
      );

      // This owner writes their dates month first, so the file carries a
      // profile whose date style differs from the vault it lands in.
      await second.eval("location.hash = '#/settings'");
      await second.waitUntil("document.getElementById('format-dates')", { label: "the second owner's dates setting" });
      await second.eval(`(() => {
        const node = document.getElementById('format-dates');
        node.value = 'mdy';
        node.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await second.eval("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Dates and numbers')).querySelector('.btn-primary').click()");
      await second.waitUntil(async () => (await import('/static/js/session.js')).currentVault().profile.dateStyle === 'mdy', { label: 'the month-first style to be saved' });
      check(
        "the second owner's profile holds the month-first style before it is exported",
        (await second.eval("(async () => (await import('/static/js/session.js')).currentVault().profile.dateStyle)()")) === 'mdy',
      );

      const plantSecond = (records) =>
        second.call(async (planted) => {
          const api = await import('/static/js/api.js');
          const c = await import('/static/js/crypto.js');
          const dek = (await import('/static/js/session.js')).currentVault().dek;
          const ids = [];
          for (const r of planted) {
            const slot = { recordId: c.uuid4(), recordType: r.type, accountId: r.accountId ?? null, schemaVersion: 1, version: 1 };
            const { recordId, ...body } = slot;
            await api.put('/api/records/' + recordId, { ...body, ...(await c.encryptRecord(dek, slot, r.payload)) });
            ids.push(slot.recordId);
          }
          return ids;
        }, records);
      const [transferred] = await plantSecond([{
        type: 'account',
        payload: { name: 'Transfer probe', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z' },
      }]);
      await plantSecond([{ type: 'snapshot', accountId: transferred, payload: { date: BACKDATE, value: '321', note: null } }]);
      const secondText = await second.eval("(async () => JSON.stringify((await (await import('/static/js/session.js')).exportFile()).file))()");
      // Written by the source after the export, for the injection check.
      const [later] = await plantSecond([{
        type: 'account',
        payload: { name: 'Written after the export', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: '2026-01-02T00:00:00Z' },
      }]);

      await toScreen();
      await chooseFile(fixture('second.json', secondText));
      await openWith(SECOND_PASSWORD);
      await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review of the second vault' });
      check(
        'the review names a main currency that differs from this vault',
        (await page.eval("document.querySelector('.review').innerText")).includes('This vault is kept in EUR. Yours is currently in CHF.'),
      );
      check(
        'the review of a different-currency file prints no "null" under the currency line',
        !/null/i.test(await page.eval("document.querySelector('.review').textContent")),
        await page.eval("document.querySelector('.review').textContent"),
      );
      await setValue('#import-erase', 'ERASE');
      await replaceVault();
      await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the transfer to land' });
      const transferredVault = await inPage(({ v }) => ({ names: [...v.holdings.values()].map(h => h.payload.name), unreadable: v.unreadable.length, currency: v.mainCurrency }));
      check(
        'a vault exported by a different user imports, and every record decrypts',
        transferredVault.names.join(',') === 'Transfer probe' && transferredVault.unreadable === 0 && transferredVault.currency === 'EUR' &&
          (await text()).includes('The figures on screen are now in EUR.'),
        JSON.stringify(transferredVault),
      );

      // The source's later record, put straight into this vault's rows,
      // does not decrypt: the two vaults share no key.
      const [row] = sql('SELECT * FROM records WHERE record_id = ?', later);
      const [{ id: mine }] = sql("SELECT id FROM principals WHERE username = 'leander'");
      sql(
        'INSERT INTO records (principal_id, record_id, record_type, account_id, schema_version, version, nonce, ciphertext, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        mine, row.record_id, row.record_type, row.account_id, row.schema_version, row.version, row.nonce, row.ciphertext, row.updated_at,
      );
      const injected = await inPage(async ({ v }, id) => { await v.load(); return v.unreadable.includes(id); }, later);
      check("a record the source wrote after the export, inserted into this vault's rows, fails to decrypt", injected);
      sql("DELETE FROM records WHERE record_id = ? AND principal_id = (SELECT id FROM principals WHERE username = 'leander')", later);

      // The restored profile is the one every date follows from here on.
      // The expected strings are spelled out from the stored ISO date, not
      // asked of the formatter under test.
      await page.eval('(async () => (await import("/static/js/session.js")).currentVault().load())()');
      await redraw();
      const monthFirst = `${BACKDATE.slice(5, 7)}/${BACKDATE.slice(8, 10)}/${BACKDATE.slice(0, 4)}`;
      const transferredAsOf = await labels('.holdings-table .cell-asof span:first-child');
      check(
        "after a restore the dashboard's As of dates follow the restored profile's style",
        transferredAsOf.length > 0 && transferredAsOf.every((shown) => shown === monthFirst),
        `${transferredAsOf.join(' | ')} against ${monthFirst}`,
      );
    } finally {
      other.child.kill();
    }

    // Back to this vault's own history, from the file it exported, which
    // still opens after two imports into the vault it came from.
    await page.eval('(async () => (await import("/static/js/session.js")).currentVault().load())()');
    await toScreen();
    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review to restore' });
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the restore to land' });
    const restoredRecords = JSON.stringify(await decrypted());
    const restoredLine = await page.eval("document.querySelector('[role=status].callout')?.textContent || ''");
    check(
      'the vault is its own again after importing its own file back',
      restoredRecords === JSON.stringify(recordsBefore) && restoredLine.includes('The figures on screen are now in CHF.'),
      `${restoredLine} ${restoredRecords.length} against ${JSON.stringify(recordsBefore).length}`,
    );

    // -- A chosen date style reaches every date that shows a day -------------
    //
    // Every expected string below is read off the stored ISO dates and
    // written out by hand, never asked of the formatter under test: a
    // helper that derives the expectation from the code it checks agrees
    // with that code whatever the code does.

    const recordsNow = await decrypted();
    const snapshots = Object.values(recordsNow).filter((r) => r.type === 'snapshot');
    const snapshotDates = new Set(snapshots.map((r) => r.payload.date));
    const probeHolding = snapshots[0].accountId;
    const isoShape = /^\d{4}-\d{2}-\d{2}$/;
    const monthName = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/;
    const dmyOf = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

    const saveDateStyle = async (value) => {
      await page.eval("location.hash = '#/settings'");
      await page.waitUntil("document.getElementById('format-dates')", { label: 'the dates setting' });
      await page.call((style) => {
        const node = document.getElementById('format-dates');
        node.value = style;
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await page.eval("[...document.querySelectorAll('.card')].find(c => c.textContent.includes('Dates and numbers')).querySelector('.btn-primary').click()");
      await page.waitUntil(async (style) => (await import('/static/js/session.js')).currentVault().profile.dateStyle === style, { args: [value], label: 'the date style to be saved' });
      await page.idle();
    };
    const dashboardAsOf = async () => {
      await redraw();
      return labels('.holdings-table .cell-asof span:first-child');
    };

    await saveDateStyle('ymd');
    check(
      'the dates setting saved is the year-first style',
      (await page.eval("(async () => (await import('/static/js/session.js')).currentVault().profile.dateStyle)()")) === 'ymd',
    );

    const asOfYmd = await dashboardAsOf();
    check(
      'with year-first saved, every As of date on the dashboard is YYYY-MM-DD with no month name',
      asOfYmd.length > 0 && asOfYmd.every((shown) => isoShape.test(shown) && !monthName.test(shown)) &&
        asOfYmd.some((shown) => snapshotDates.has(shown)),
      asOfYmd.join(' | '),
    );

    await page.call((id) => { location.hash = `#/holding/${id}`; }, probeHolding);
    await page.waitUntil("document.querySelector('.hero-age')", { label: 'the holding page' });
    await page.frames();
    const heroAges = await labels('.hero-age');
    const snapshotButtons = await labels('.data-table tbody .link-button');
    check(
      'with year-first saved, the holding page writes its as-of line and every snapshot date as YYYY-MM-DD',
      heroAges.some((age) => /^as of \d{4}-\d{2}-\d{2}, /.test(age) && snapshotDates.has(age.slice(6, 16))) &&
        heroAges.every((age) => !monthName.test(age.replace(/, .*/, ''))) &&
        snapshotButtons.length > 0 && snapshotButtons.every((shown) => isoShape.test(shown) && snapshotDates.has(shown)),
      `${heroAges.join(' | ')} / ${snapshotButtons.join(' | ')}`,
    );

    await redraw();
    const recordedDay = [...snapshotDates].sort()[0];
    await page.eval("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New recording').click()");
    await page.waitUntil("document.querySelector('.dialog .date-day')", { label: 'the date picker' });
    await page.call((day) => {
      for (let i = 0; i < 600 && !document.querySelector(`.dialog .date-day[data-date="${day}"]`); i += 1) {
        document.querySelector('.dialog [aria-label="Previous month"]').click();
      }
    }, recordedDay);
    const pickerName = await page.call((day) => document.querySelector(`.dialog .date-day[data-date="${day}"]`).getAttribute('aria-label'), recordedDay);
    check(
      "with year-first saved, the date picker's marked day names itself as YYYY-MM-DD",
      pickerName === `${recordedDay}, has a recording`,
      pickerName,
    );
    await page.eval("[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Cancel').click()");
    await page.waitUntil("!document.querySelector('.dialog')", { label: 'the picker to close' });

    const chartDays = await labels('svg.trend .axis-tick');
    check(
      'with year-first saved, no day tick on the chart axis spells a month',
      chartDays.every((tick) => !(monthName.test(tick) && /(^|\D)\d{1,2}(\D|$)/.test(tick))),
      chartDays.join(' | '),
    );

    // The review is of the file, but it is read in the vault now open, so
    // it is written in that vault's style: the file's own profile applies
    // only once the restore is done.
    await toScreen();
    await chooseFile(exportedPath);
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review in year-first dates' });
    const exportedOn = contents.exportedAt.slice(0, 10);
    const exportedLine = await page.eval("[...document.querySelectorAll('.review .hint')].map(n => n.textContent).find(t => t.startsWith('Exported')) || ''");
    check(
      "the import review's Exported date is in the style of the vault that is open, not the file's",
      exportedLine === `Exported ${exportedOn}`,
      exportedLine,
    );

    // Restoring brings back the profile that file was exported with, which
    // writes day first, and every date follows it.
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the restore into dates that differ' });
    const afterRestore = await dashboardAsOf();
    check(
      "after the restore the dashboard's As of dates follow the restored profile's day-first style",
      afterRestore.length > 0 && afterRestore.every((shown) => /^\d{2}\.\d{2}\.\d{4}$/.test(shown)) &&
        afterRestore.some((shown) => [...snapshotDates].some((iso) => dmyOf(iso) === shown)),
      afterRestore.join(' | '),
    );

    // -- Two tabs of one browser (export-import.md, What it does) -------------
    //
    // Both tabs share one session cookie, so the server cannot tell them
    // apart: the vault epoch is what closes the tab that did not restore.
    // `quiet` stubs the broadcast channel, so that tab learns only from the
    // answer to its own request.
    const quiet = 'window.BroadcastChannel = class { postMessage() {} close() {} addEventListener() {} };';
    const typedIn = async (session, name) => {
      await session.waitUntil("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add a holding')", { label: 'the add button' });
      await session.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add a holding').click()");
      await session.waitUntil("document.querySelector('.dialog #holding-name')", { label: 'the holding form' });
      await session.call((value) => {
        const node = document.querySelector('#holding-name');
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }, name);
    };
    const held = (session) =>
      session.eval(`(async () => {
        const s = await import('/static/js/session.js');
        return JSON.stringify({ keys: s.holdsKeys(), vault: s.currentVault() !== null, dialog: Boolean(document.querySelector('.dialog')),
          card: Boolean(document.querySelector('#unlock-password')), text: document.body.innerText });
      })()`).then(JSON.parse);
    const watcher = await openTab(`${BASE}/dashboard`);
    const stubbed = await openTab('about:blank', quiet).then(async (tab) => (await tab.session.goto(`${BASE}/dashboard`), tab));
    try {
      for (const { session } of [watcher, stubbed]) {
        await enterPasswordOn(session, VAULT_PASSWORD);
        check('another tab of the browser opens the same vault', await intoVault(session, 'the other tab'));
      }
      await typedIn(watcher.session, 'Typed in the watching tab');
      await typedIn(stubbed.session, 'Typed in the quiet tab');
      const sentBefore = watcher.requests.length;

      await toScreen();
      await chooseFile(exportedPath);
      await openWith(VAULT_PASSWORD);
      await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review of the restore the other tabs meet' });
      await setValue('#import-erase', 'ERASE');
      await replaceVault();
      await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the restore the other tabs meet' });
      const restoredIds = sql(`SELECT record_id FROM records ${OWN} ORDER BY record_id`).map((r) => r.record_id);
      check('the restore leaves exactly the file\'s records', JSON.stringify(restoredIds) === JSON.stringify(contents.records.map((r) => r.recordId).sort()));

      // The tab that was not used closes the vault before it sends a request.
      await watcher.session.waitUntil("document.body.innerText.includes('Your vault was replaced from a file in another tab')", { label: 'the other tab to close its vault' });
      const closed = await held(watcher.session);
      check(
        'another tab of the browser holds no key and no vault, shows no dialog or typed name, and says what was lost',
        !closed.keys && !closed.vault && !closed.dialog && closed.card && !closed.text.includes('Typed in the watching tab') &&
          closed.text.includes('Your vault was replaced from a file in another tab, window or device. What you had typed here and not saved is gone.'),
        JSON.stringify(closed),
      );
      check('that tab sent no request between the restore and closing', watcher.requests.length === sentBefore, `${watcher.requests.length - sentBefore} sent`);
      check('this tab stays open on the restored vault', (await held(page)).vault);

      // The tab that cannot hear the channel meets the refusal at its save.
      const writesBefore = stubbed.requests.length;
      await stubbed.session.eval("document.querySelector('.dialog button[type=submit]').click()");
      await stubbed.session.waitUntil("document.querySelector('#unlock-password')", { label: 'the quiet tab to close on the refusal' });
      const refused = stubbed.requests.slice(writesBefore).filter((r) => r.method === 'PUT');
      check('a save from the tab that learned nothing is sent once', refused.length === 1, String(refused.length));
      const quietState = await held(stubbed.session);
      check(
        'its save is refused as a replaced vault, never as a version conflict, and the tab asks for the password',
        !quietState.vault && quietState.card && quietState.text.includes('Your vault was replaced from a file in another tab, window or device.') &&
          !quietState.text.includes('changed in another'),
        quietState.text,
      );
      check(
        'neither tab put anything into the vault',
        JSON.stringify(sql(`SELECT record_id FROM records ${OWN} ORDER BY record_id`).map((r) => r.record_id)) === JSON.stringify(restoredIds),
      );

      // Unlocking either one opens the restored dashboard with every record readable.
      await enterPasswordOn(watcher.session, VAULT_PASSWORD);
      check('unlocking the closed tab opens the restored vault', await intoVault(watcher.session, 'the closed tab to unlock'));
      const reopened = await watcher.session.eval(`(async () => {
        const s = await import('/static/js/session.js');
        return JSON.stringify({ unreadable: s.currentVault().unreadable.length, holdings: s.currentVault().holdings.size, notice: document.body.innerText.includes('since you last opened it') });
      })()`).then(JSON.parse);
      check(
        'every restored record reads in that tab and it shows no notice of its own',
        reopened.unreadable === 0 && reopened.holdings === contents.records.filter((r) => r.recordType === 'account').length && !reopened.notice,
        JSON.stringify(reopened),
      );

      // A message a page does not act on: another epoch, another shape.
      await watcher.session.eval("window.__heard = []; new BroadcastChannel('solvent-vault').onmessage = (e) => window.__heard.push(e.data); true");
      const mine = await watcher.session.eval("import('/static/js/api.js').then((api) => api.vaultEpoch())");
      await page.call((epoch) => {
        const channel = new BroadcastChannel('solvent-vault');
        channel.postMessage({ replaced: '0'.repeat(32) });
        channel.postMessage({ replaced: epoch, also: 1 });
        channel.postMessage({ other: epoch });
        channel.postMessage(epoch);
      }, mine);
      await watcher.session.waitUntil('window.__heard.length === 4', { label: 'the messages to arrive' });
      check(
        'a message naming another epoch, or of another shape, closes no page',
        (await held(watcher.session)).vault && (await held(page)).vault,
      );
    } finally {
      await watcher.close();
      await stubbed.close();
    }

    // -- Another browser, which no channel reaches ----------------------------
    //
    // Its own profile, so its own session. It learns of a restore made here
    // by a request, on coming back into view, or at its next sign-in.
    const restoreHere = async () => {
      await toScreen();
      await chooseFile(exportedPath);
      await openWith(VAULT_PASSWORD);
      await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review of a restore the other browser meets' });
      await setValue('#import-erase', 'ERASE');
      await replaceVault();
      await page.waitUntil("document.body.innerText.includes('Your vault was replaced from the file')", { timeout: 90000, label: 'the restore the other browser meets' });
    };
    const posts = `window.__posted = []; const post = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (message) { window.__posted.push(message); return post.call(this, message); };
      window.__visibility = 'visible'; Object.defineProperty(document, 'visibilityState', { get: () => window.__visibility });`;
    const elsewhere = await openBrowser();
    const far = elsewhere.session;
    await far.send('Page.addScriptToEvaluateOnNewDocument', { source: posts });
    const sent = () => watched[watched.length - 1].requests;
    const posted = () => far.eval('JSON.stringify(window.__posted)').then(JSON.parse);
    const see = (visibility) =>
      far.call((state) => { window.__visibility = state; document.dispatchEvent(new Event('visibilitychange')); }, visibility);
    const heldEpoch = () => far.eval("import('/static/js/api.js').then((api) => api.vaultEpoch())");
    const typedInto = (name) =>
      far.call(async (value) => {
        [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add a holding').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const node = document.querySelector('#holding-name');
        node.value = value;
        node.dispatchEvent(new Event('input', { bubbles: true }));
      }, name);
    const lockButton = () => far.eval("document.querySelector('.btn-lock').click()");
    try {
      await far.goto(`${BASE}/login`);
      await signInOn(far, VAULT_PASSWORD, 'leander');
      check('a second browser opens the vault on a session of its own', await intoVault(far, 'the second browser'));
      const epochHeld = await heldEpoch();

      // Hidden through a restore made here, then back in view.
      await see('hidden');
      await restoreHere();
      const sessionRows = sql("SELECT id FROM sessions WHERE principal_id = (SELECT id FROM principals WHERE username = 'leander')").length;
      const before = sent().length;
      check('a page hidden through the restore is still showing the vault', (await held(far)).vault);
      await see('visible');
      await far.waitUntil("document.body.innerText.includes('Your vault was replaced from a file in another tab')", { label: 'the hidden page to close on coming back' });
      const after = sent().slice(before);
      check(
        'coming back into view sends one read of the profile and nothing else, and the page shows Replaced elsewhere',
        after.length === 1 && after[0].method === 'GET' && after[0].url.endsWith('/api/records?type=profile') &&
          (await held(far)).text.includes('Nothing you had typed here was lost.') && !(await held(far)).vault,
        after.map((r) => `${r.method} ${r.url}`).join(', '),
      );
      check('its session row still exists', sql("SELECT id FROM sessions WHERE principal_id = (SELECT id FROM principals WHERE username = 'leander')").length === sessionRows);
      check('it told the other pages of its browser which epoch it held', JSON.stringify(await posted()) === JSON.stringify([{ replaced: epochHeld }]), JSON.stringify(await posted()));

      // Unlocking from Replaced elsewhere opens the restored dashboard with no notice.
      await enterPasswordOn(far, VAULT_PASSWORD);
      check('unlocking from Replaced elsewhere opens the dashboard', await intoVault(far, 'the vault after Replaced elsewhere'));
      const reopened = await far.eval(`(async () => JSON.stringify({ hash: location.hash, notice: document.body.innerText.includes('since you last opened it'), unreadable: (await import('/static/js/session.js')).currentVault().unreadable.length }))()`).then(JSON.parse);
      check('and shows no notice and no unreadable record', reopened.hash === '#/' && !reopened.notice && reopened.unreadable === 0, JSON.stringify(reopened));

      // Locked through the restore, with input held.
      await typedInto('Typed before the lock');
      await lockButton();
      await far.waitUntil("document.querySelector('#unlock-password')", { label: 'the lock' });
      const lockedEpoch = await heldEpoch();
      await restoreHere();
      await enterPasswordOn(far, VAULT_PASSWORD);
      await far.waitUntil("document.body.innerText.includes('since you last opened it')", { timeout: 90000, label: 'the notice after unlocking' });
      const landed = await far.eval(`JSON.stringify({ hash: location.hash, dialog: Boolean(document.querySelector('.dialog')), notice: document.querySelector('[role=status].callout').textContent, typed: document.body.innerText.includes('Typed before the lock') })`).then(JSON.parse);
      check(
        'a page locked through the restore drops its held input and shows Replaced since last open for dropped input, on the dashboard',
        landed.hash === '#/' && !landed.dialog && !landed.typed &&
          landed.notice.includes('Your vault was replaced from a file since you last opened it here. What you had typed here and not saved is gone.'),
        JSON.stringify(landed),
      );
      check('and it posted the epoch it held', JSON.stringify((await posted()).slice(1)) === JSON.stringify([{ replaced: lockedEpoch }]), JSON.stringify(await posted()));

      // Nothing held, locked through a restore.
      await lockButton();
      await far.waitUntil("document.querySelector('#unlock-password')", { label: 'the second lock' });
      await restoreHere();
      await enterPasswordOn(far, VAULT_PASSWORD);
      await far.waitUntil("document.body.innerText.includes('since you last opened it')", { timeout: 90000, label: 'the notice with nothing dropped' });
      check(
        'with nothing held, the notice says nothing was lost',
        (await far.eval("document.querySelector('[role=status].callout').textContent")).includes('Nothing you had typed here was lost.'),
      );

      // Signing out and in again after a restore shows no notice.
      await restoreHere();
      await lockButton();
      await far.waitUntil("document.querySelector('.known-username a')", { label: 'the lock before signing out' });
      await far.eval("document.querySelector('.known-username a').click()");
      await far.waitUntil("location.pathname === '/login'", { label: 'the sign-out' });
      await signInOn(far, VAULT_PASSWORD, 'leander');
      check('signing out and in again after a restore shows no notice', (await intoVault(far, 'the vault after signing out')) && !(await held(far)).text.includes('since you last opened it'));

      // A session that ended for its own reason, with input held.
      await typedInto('Typed as the session ended');
      await page.eval("(async () => (await import('/static/js/api.js')).post('/api/auth/logout-all', {}))()");
      await page.goto(`${BASE}/login`);
      await signInOn(page, VAULT_PASSWORD, 'leander');
      await intoVault(page, 'the vault after signing in again');
      await restoreHere();
      await far.eval("import('/static/js/api.js').then((api) => api.get('/api/records?type=profile'))", { awaitPromise: false });
      await far.waitUntil("document.querySelector('#unlock-password') && !document.body.innerText.includes('Your vault was replaced')", { label: 'the session-ran-out card' });
      check('the page whose session ended asks for the password and says nothing of a restore', !(await far.eval("Boolean(document.querySelector('.callout'))")));
      await enterPasswordOn(far, VAULT_PASSWORD);
      await far.waitUntil("document.body.innerText.includes('since you last opened it')", { timeout: 90000, label: 'the notice after the session ended' });
      const ended = await far.eval(`JSON.stringify({ hash: location.hash, notice: document.querySelector('[role=status].callout').textContent, typed: document.body.innerText.includes('Typed as the session ended') })`).then(JSON.parse);
      check(
        'signing in after the session ended drops the input and shows Replaced since last open for dropped input',
        ended.hash === '#/' && !ended.typed && ended.notice.includes('What you had typed here and not saved is gone.'),
        JSON.stringify(ended),
      );
    } finally {
      elsewhere.close();
    }
  }
});
