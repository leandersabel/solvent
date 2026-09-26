// Export and import (spec/ui/export-import.md).
//
// The file names nobody and opens with its own password, so it moves:
// to a new machine, to a fresh install, or into another person's
// account on the instance. Neither card treats that as a hazard.
import * as api from './api.js';
import * as crypto from './crypto.js';
import { el } from './dom.js';
import { wrapForMaster } from './session.js';
import { SCHEMA_VERSION, migrate } from './model.js';

/** The screen, reached from Settings at an in-page address like
 *  dimensions, because the keys live in this page's memory. */
export function transferView(vault, { reload }) {
  return [
    el('h1', { class: 'screen-heading', text: 'Export and import' }),
    exportCard(vault),
    importCard(vault, reload),
  ];
}

function exportCard(vault) {
  const status = el('p', { class: 'hint', hidden: true });
  const error = el('p', { class: 'field-error', hidden: true });

  const button = el('button', {
    class: 'btn-primary',
    text: 'Export vault',
    id: 'export',
    onclick: async () => {
      error.hidden = true;
      button.disabled = true;
      try {
        // Not a link: the endpoint requires a header a navigation
        // cannot send, so it is fetched and saved through a blob.
        const { blob, filename } = await api.downloadExport();
        const url = URL.createObjectURL(blob);
        const anchor = el('a', { href: url, download: filename });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        status.textContent = `${vault.holdings.size} holdings, ${countOf(vault.snapshots)} recorded figures and ${countOf(vault.rates)} captured prices, about ${Math.round(blob.size / 1024)} KB.`;
        status.hidden = false;
      } catch (failure) {
        error.textContent =
          failure.status === 429
            ? 'You have downloaded your vault several times in the last hour. You can do it again shortly.'
            : 'Nothing was written to disk and nothing in your vault changed.';
        error.hidden = false;
      } finally {
        button.disabled = false;
      }
    },
  });

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Export' }),
    el('p', {
      text: 'Every holding, every figure recorded for it, and every price captured alongside them, plus the salt, key settings and wrapped key needed to open it. Encrypted throughout.',
    }),
    el('p', {
      class: 'hint',
      text: 'The file holds one way in, your password. No device, no second method, no recovery key.',
    }),
    el('p', {
      class: 'callout callout-critical',
      text: 'This file is exactly as sensitive as your password. Anyone who has both owns your vault. It stays locked with the password you have right now, even if you change it later, and if you lose that password the file is permanently unreadable.',
    }),
    button,
    status,
    error,
  ]);
}

function countOf(map) {
  let total = 0;
  for (const list of map.values()) total += list.length;
  return total;
}

/** Replace-only. There is no merge, and the UI must not imply one
 *  exists. */
function importCard(vault, onDone) {
  const file = el('input', { type: 'file', accept: 'application/json' });
  const password = el('input', { type: 'password', autocomplete: 'off' });
  const erase = el('input', { type: 'text', placeholder: 'ERASE' });
  const review = el('div', { class: 'review', hidden: true });
  const progress = el('p', { class: 'hint', hidden: true, role: 'status' });
  const error = el('p', { class: 'field-error', hidden: true });

  let parsed = null;

  file.addEventListener('change', async () => {
    error.hidden = true;
    review.hidden = true;
    parsed = null;
    const chosen = file.files[0];
    if (!chosen) return;
    if (chosen.size > 48 * 1024 * 1024) {
      fail(error, 'That file is too large to be a Solvent vault.');
      return;
    }
    try {
      const body = JSON.parse(await chosen.text());
      if (body.format !== 'solvent-vault') throw new Error('format');
      if (body.formatVersion > 1) throw new Error('newer');
      parsed = body;
    } catch (failure) {
      fail(
        error,
        failure.message === 'newer'
          ? 'This file was written by a newer version of Solvent. Update before restoring it.'
          : 'That is not a Solvent vault file.',
      );
    }
  });

  const button = el('button', {
    class: 'btn-destructive',
    text: 'Replace my vault',
    onclick: async () => {
      error.hidden = true;
      if (!parsed) {
        fail(error, 'Choose a file first.');
        return;
      }
      const existing = countOf(vault.snapshots) + countOf(vault.rates) + vault.holdings.size + 1;
      if (existing > 1 && erase.value !== 'ERASE') {
        fail(error, 'Type ERASE to confirm that your current vault is replaced.');
        return;
      }
      button.disabled = true;
      try {
        progress.hidden = false;
        progress.textContent = 'Opening the file…';
        const keys = await crypto.deriveKeys(password.value, parsed.salt, parsed.kdf);
        let fileDek;
        try {
          fileDek = await crypto.unwrapDek(parsed.wrappedDek, parsed.dekNonce, keys.masterKey);
        } catch {
          throw new Error('password');
        }

        // Nothing is uploaded until every record has decrypted
        // successfully. A partial restore is worse than none.
        const plain = [];
        for (const [index, record] of parsed.records.entries()) {
          progress.textContent = `Decrypting ${index + 1} of ${parsed.records.length}…`;
          const payload = migrate(
            record.recordType,
            record.schemaVersion,
            await crypto.decryptRecord(fileDek, record),
          );
          plain.push({ record, payload });
        }

        // A freshly generated DEK rather than the file's, so the two
        // vaults share no key material and the exporter's later
        // records cannot be injected into this one.
        const newDek = await crypto.generateDek();
        const rekeyed = [];
        for (const [index, { record, payload }] of plain.entries()) {
          progress.textContent = `Re-encrypting ${index + 1} of ${plain.length}…`;
          const slot = {
            recordId: record.recordId,
            recordType: record.recordType,
            accountId: record.accountId ?? null,
            schemaVersion: SCHEMA_VERSION,
            version: 1,
          };
          rekeyed.push({ ...slot, ...(await crypto.encryptRecord(newDek, slot, payload)) });
        }

        progress.textContent = 'Uploading…';
        const wrapper = await wrapForMaster(newDek);
        await api.post('/api/import', { ...wrapper, records: rekeyed });
        progress.hidden = true;
        window.location.reload();
        void onDone;
      } catch (failure) {
        progress.hidden = true;
        fail(
          error,
          failure.message === 'password'
            ? 'That password does not open this file.'
            : 'No records were imported. Your vault is unchanged.',
        );
        button.disabled = false;
      }
    },
  });

  password.addEventListener('input', () => {
    if (!parsed) return;
    review.hidden = false;
    const kinds = countKinds(parsed.records);
    const mine = countOf(vault.snapshots) + countOf(vault.rates) + vault.holdings.size + 1;
    review.replaceChildren(
      el('p', {
        text: `In the file: ${kinds.account} holdings, ${kinds.snapshot} recorded figures, ${kinds.rate} captured prices. Exported ${parsed.exportedAt.slice(0, 10)}.`,
      }),
      el('p', {
        text:
          mine > 1
            ? `Your vault currently holds ${mine} records. All of them will be deleted.`
            : 'Your vault is empty. Nothing will be deleted.',
      }),
      parsed.formatVersion < 1
        ? null
        : el('p', {
            class: 'hint',
            text: 'Your password stays the same and your login is unaffected. Only the contents of your vault are replaced. You are signed out anywhere else you are signed in.',
          }),
    );
  });

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Import' }),
    el('div', { class: 'field' }, [el('label', { text: 'Choose file' }), file]),
    el('div', { class: 'field' }, [
      el('label', { text: 'The password this file was exported under' }),
      password,
    ]),
    review,
    el('div', { class: 'field' }, [
      el('label', { text: 'Type ERASE to confirm' }),
      erase,
    ]),
    progress,
    error,
    button,
  ]);
}

function countKinds(records) {
  const counts = { account: 0, snapshot: 0, rate: 0, profile: 0 };
  for (const record of records) counts[record.recordType] += 1;
  return counts;
}

function fail(node, text) {
  node.textContent = text;
  node.hidden = false;
}
