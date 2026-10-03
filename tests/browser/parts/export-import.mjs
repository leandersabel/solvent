// Export and import (spec/ui/export-import.md): the vault written to a
// file that opens with its own password, and restored from one, into the
// same vault, an empty one or another person's, with every refusal on
// the way.
// Templates: dashboard.html. Modules: page-transfer.js, transfer.js,
// transfer-worker.js, api.js, crypto.js, session.js, format.js.
import {
  BASE, BACKDATE, SECOND_PASSWORD, Session, VAULT_PASSWORD, answering, check, credentialOf, enterPassword,
  importOwnExport, labels, launch, mintInvite, occurring, OWN, page, provoked, run, setProfile, setValue, redraw,
  sql, story, text, vaultOwner, within,
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
      page.eval(`performance.getEntriesByType('resource').filter(e => e.name.includes(${JSON.stringify(part)})).length`);
    const inPage = (body) =>
      page.eval(`(async () => {
        const v = (await import('/static/js/session.js')).currentVault();
        const c = await import('/static/js/crypto.js');
        const t = await import('/static/js/transfer.js');
        return JSON.stringify(await (async () => { ${body} })());
      })()`).then(JSON.parse);
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
      inPage(`
        const api = await import('/static/js/api.js');
        const out = {};
        for (const type of ['profile', 'account', 'snapshot', 'rate']) {
          for (const row of await api.get('/api/records?type=' + type)) {
            out[row.recordId] = { type: row.recordType, accountId: row.accountId, payload: await c.decryptRecord(v.dek, row) };
          }
        }
        return Object.fromEntries(Object.entries(out).sort());
      `);
    // The chart and the total in both pricing modes, as drawn.
    const picture = async () => {
      await page.eval("location.hash = '#/'");
      await page.waitUntil("document.querySelector('svg.trend')", { label: 'the dashboard to draw' });
      await page.frames();
      const mode = async (label) => {
        await page.eval(`[...document.querySelectorAll('.switch-option')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
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
    await page.waitUntil("!document.querySelector('#export-card [role=status]').hidden", { label: 'what the file holds' });
    check(
      'afterwards the screen says what the file holds, both timelines named',
      /\d+ holdings, \d+ recorded figures and \d+ captured prices, about \d+ KB/.test(
        await page.eval("document.querySelector('#export-card [role=status]').textContent"),
      ),
    );

    // Every plaintext the vault holds, looked for in the file's bytes:
    // outside the encoded fields, and inside them once decoded.
    const needles = await inPage(`
      const out = new Set([v.mainCurrency]);
      for (const h of v.holdings.values()) [h.payload.name, h.payload.note, h.payload.unit].forEach((x) => x && out.add(x));
      for (const d of v.dimensions) { out.add(d.label); d.values.forEach((x) => out.add(x.label)); }
      for (const list of v.snapshots.values()) for (const s of list) { out.add(s.payload.date); if (s.payload.value.length >= 4) out.add(s.payload.value); }
      for (const list of v.rates.values()) for (const r of list) { out.add(r.payload.symbol); out.add(r.payload.date); if (r.payload.rate.length >= 4) out.add(r.payload.rate); }
      return [...out];
    `);
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
    const alive = await page.eval("fetch('/api/sessions', { headers: { 'X-Solvent-Request': '1' } }).then(r => r.status)");
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
    await chooseFile(fixture('newer.json', JSON.stringify({ ...exported, formatVersion: 2 })));
    check('a file from a newer version is refused at the first step', (await importError()).includes('newer version'));
    const badType = JSON.parse(exportedText);
    badType.records[0].recordType = 'invoice';
    await chooseFile(fixture('bad-type.json', JSON.stringify(badType)));
    check('a file the server would refuse is refused before it is opened', (await importError()).includes('not a Solvent vault file'));
    const noProfile = JSON.parse(exportedText);
    noProfile.records = noProfile.records.filter((r) => r.recordType !== 'profile');
    await chooseFile(fixture('no-profile.json', JSON.stringify(noProfile)));
    check(
      'a file with no profile record is refused at the first step, before any password is asked for',
      (await importError()) === 'This file carries no vault settings, so it would restore a vault with no main currency. It cannot be restored.' &&
        (await page.eval("Boolean(document.querySelector('#import-password').closest('[hidden]'))")) &&
        (await uploads()) === 0,
      await importError(),
    );
    const large = fixture('large.json', '');
    truncateSync(large, 49 * 1024 * 1024);
    await chooseFile(large);
    check('an oversized file is refused by its size', (await importError()).includes('too large'));

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
    for (const record of exported.records) if (record.recordType in kinds) kinds[record.recordType] += 1;
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

    const altered = JSON.parse(exportedText);
    const target = altered.records.find((record) => record.recordType === 'snapshot');
    const bytes = Buffer.from(target.ciphertext, 'base64');
    bytes[5] ^= 0x01;
    target.ciphertext = bytes.toString('base64');
    await chooseFile(fixture('altered.json', JSON.stringify(altered)));
    await openWith(VAULT_PASSWORD);
    await page.waitUntil("!document.querySelector('.review').hidden", { timeout: 60000, label: 'the review of the altered file' });
    await setValue('#import-erase', 'ERASE');
    await replaceVault();
    await page.waitUntil("document.querySelector('#import-card .field-error').textContent.includes('No records were imported')", { timeout: 60000, label: 'the refused record' });
    check(
      'one byte altered in one record aborts the import, names the record, uploads nothing and leaves the vault',
      (await importError()).includes(target.recordId) && (await importError()).includes('Your vault is unchanged') &&
        (await uploads()) === 0 && vaultRows() === rowsBefore,
      await importError(),
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
    const keys = await inPage(`
      const raw = async (key) => c.b64encode(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
      const params = ${credentialAfter.params};
      const master = (await c.deriveKeys(${JSON.stringify(VAULT_PASSWORD)}, params.salt, params.kdf)).masterKey;
      const stored = await c.unwrapDek(${JSON.stringify(credentialAfter.wrapped_dek)}, ${JSON.stringify(credentialAfter.dek_nonce)}, master);
      const file = (await t.openFile(${exportedText}, ${JSON.stringify(VAULT_PASSWORD)})).fileDek;
      return { stored: await raw(stored), file: await raw(file), memory: await raw(v.dek) };
    `);
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
    const reread = await inPage('return { unreadable: v.unreadable.length, records: v.holdings.size }');
    check(
      'after an import the unchanged password signs in and every record reads',
      reread.unreadable === 0 && reread.records === kinds.account,
      JSON.stringify(reread),
    );
    const stillOpens = await inPage(`
      const file = ${exportedText};
      const { fileDek } = await t.openFile(file, ${JSON.stringify(VAULT_PASSWORD)});
      return (await t.decryptAll(fileDek, file.records)).length === file.records.length;
    `);
    check('the exported file still opens with its own password after the vault was re-keyed', stillOpens);

    // -- A vault transfer, from a second owner -----------------------------------

      const other = await launch();
    try {
      const second = await Session.connect(other.target);
      await second.send('Page.enable');
      await second.send('Runtime.enable');
      const fill = (fields) =>
        second.eval(`(() => {
          for (const [selector, value, index] of ${JSON.stringify(fields)}) {
            const node = document.querySelectorAll(selector)[index || 0];
            if (node.type === 'checkbox') node.checked = value;
            else node.value = value;
            node.dispatchEvent(new Event(node.tagName === 'SELECT' || node.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
          }
        })()`);
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
        second.eval(`(async () => {
          const api = await import('/static/js/api.js');
          const c = await import('/static/js/crypto.js');
          const dek = (await import('/static/js/session.js')).currentVault().dek;
          const ids = [];
          for (const r of ${JSON.stringify(records)}) {
            const slot = { recordId: c.uuid4(), recordType: r.type, accountId: r.accountId ?? null, schemaVersion: 1, version: 1 };
            const { recordId, ...body } = slot;
            await api.put('/api/records/' + recordId, { ...body, ...(await c.encryptRecord(dek, slot, r.payload)) });
            ids.push(slot.recordId);
          }
          return ids;
        })()`);
      const [transferred] = await plantSecond([{
        type: 'account',
        payload: { name: 'Transfer probe', unit: 'EUR', dims: {}, note: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z' },
      }]);
      await plantSecond([{ type: 'snapshot', accountId: transferred, payload: { date: BACKDATE, value: '321', note: null } }]);
      const secondText = await second.eval("fetch('/api/export', { headers: { 'X-Solvent-Request': '1' } }).then(r => r.text())");
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
      const transferredVault = await inPage('return { names: [...v.holdings.values()].map(h => h.payload.name), unreadable: v.unreadable.length, currency: v.mainCurrency }');
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
      const injected = await inPage(`await v.load(); return v.unreadable.includes(${JSON.stringify(later)});`);
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
      await page.eval(`(() => {
        const node = document.getElementById('format-dates');
        node.value = ${JSON.stringify(value)};
        node.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
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

    await page.eval(`location.hash = '#/holding/${probeHolding}'`);
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
    await page.eval(`(() => {
      for (let i = 0; i < 600 && !document.querySelector('.dialog .date-day[data-date="${recordedDay}"]'); i += 1) {
        document.querySelector('.dialog [aria-label="Previous month"]').click();
      }
    })()`);
    const pickerName = await page.eval(`document.querySelector('.dialog .date-day[data-date="${recordedDay}"]').getAttribute('aria-label')`);
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
    const exportedOn = exported.exportedAt.slice(0, 10);
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
  }
});
