// Export and import (spec/features/export-import.md, Export / import).
//
// The file names nobody and opens with its own password, so it moves:
// to a new machine, to a fresh install, or into another person's
// account on the instance. Neither card treats that as a hazard.
import * as api from './api.js';
import { el, icon, mount } from './dom.js';
import { exportFile, heldSalt, lockForChangedCredential, replaceDek, wrapForMaster } from './session.js';
import * as transfer from './transfer.js';
import { passwordWithToggle } from './unlock.js';

// What the last import restored, by kind, shown once by the screen it
// reloads into. Counts and a currency code, never a record.
let restored = null;

/** The screen, reached from Settings at an in-page address like
 *  dimensions, because the keys live in this page's memory. */
export function transferView(vault, { reload }) {
  const done = restored;
  restored = null;
  return [
    el('h1', { class: 'screen-heading', text: 'Export and import' }),
    done ? confirmation(done) : null,
    exportCard(),
    importCard(vault, reload),
  ];
}

function confirmation({ counts, currency, currencyChanged }) {
  return el('p', { class: 'callout', role: 'status' }, [
    `Your vault was replaced from the file: ${kinds(counts)}.`,
    currencyChanged ? ` The figures on screen are now in ${currency}.` : '',
  ]);
}

/** Holdings, recorded figures and captured prices, in one line. Both
 *  timelines are named, because a file carrying only one of them would
 *  restore a vault that reprices its whole history. */
function kinds(counts) {
  return `${counts.account} holdings, ${counts.snapshot} recorded figures and ${counts.rate} captured prices`;
}

function exportCard() {
  const status = el('p', { class: 'hint', hidden: true, role: 'status' });
  const error = el('p', { class: 'field-error', hidden: true, role: 'alert' });

  const button = el('button', {
    class: 'btn-primary',
    text: 'Export vault',
    id: 'export',
    onclick: async () => {
      error.hidden = true;
      status.hidden = true;
      button.disabled = true;
      button.textContent = 'Exporting…';
      let ceiling = false;
      try {
        // Not a link: the endpoint requires a header a navigation
        // cannot send, so it is fetched, sealed and saved through a
        // blob.
        const { file, filename, records } = await exportFile();
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = el('a', { href: url, download: filename });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        const counts = transfer.countKinds(records);
        const size = `about ${Math.max(1, Math.round(blob.size / 1024))} KB`;
        status.textContent =
          counts.account + counts.snapshot + counts.rate
            ? `The file holds ${kinds(counts)}, ${size}.`
            : `Your vault is empty, so the file holds its settings and no holdings, figures or prices, ${size}.`;
        status.hidden = false;
      } catch (failure) {
        ceiling = failure.status === 429;
        error.textContent = ceiling
          ? 'You have downloaded your vault several times in the last hour. You can do it again shortly.'
          : 'The export failed. Nothing was written to disk and nothing in your vault changed.';
        error.hidden = false;
      } finally {
        button.textContent = 'Export vault';
        // The ceiling keeps the button disabled with its reason beside
        // it, rather than letting it fail again.
        button.disabled = ceiling;
      }
    },
  });

  return el('section', { class: 'card', id: 'export-card' }, [
    el('h2', { class: 'section-heading', text: 'Export' }),
    el('p', {
      text: 'Every holding, every figure recorded for it, and every price captured alongside them, plus the salt, key settings and wrapped key needed to open it. Encrypted throughout.',
    }),
    el('p', {
      class: 'hint',
      text: 'The file holds one way in, your password. No device, no second method, no recovery key.',
    }),
    el('p', { class: 'callout callout-critical sensitivity' }, [
      icon('alert'),
      ' This file is exactly as sensitive as your password. Anyone who has both owns your vault. It stays locked with the password you have right now, even if you change it later, and if you lose that password the file is permanently unreadable.',
    ]),
    button,
    status,
    error,
  ]);
}

/** Replace-only. There is no merge, and the UI must not imply one
 *  exists. Each step is revealed as the previous one completes. */
function importCard(vault, reload) {
  const error = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  const fail = (text) => {
    error.textContent = text;
    error.hidden = false;
  };

  // What the vault holds now, in the same kinds as the file, so the
  // review reads what is being traded for what.
  const mine = {
    account: vault.holdings.size,
    snapshot: countOf(vault.snapshots),
    rate: countOf(vault.rates),
  };
  const total = mine.account + mine.snapshot + mine.rate + vault.unreadable.length + (vault.profileRecord ? 1 : 0);
  // The profile is the vault's settings, not something the person put
  // in it, so a vault holding nothing else holds nothing to erase.
  const holdsData = total > (vault.profileRecord ? 1 : 0);

  let parsed = null;
  let opened = null;
  // The attempt to open the file in flight, and its re-key, both ended
  // whenever the step they serve is reset.
  let attempt = null;
  let worker = null;

  // 1. Choose file.
  const file = el('input', { type: 'file', accept: 'application/json,.json', id: 'import-file' });
  const stepFile = el('div', { class: 'field drop-zone' }, [
    el('label', { for: 'import-file', text: 'Choose file' }),
    el('p', { class: 'hint', text: 'Drop the file here, or pick it.' }),
    file,
  ]);

  // 2. The password for that file.
  const password = el('input', { type: 'password', id: 'import-password' });
  const openButton = el('button', { class: 'btn-secondary', text: 'Open the file', type: 'button' });
  const stepPassword = el('div', { class: 'field', hidden: true }, [
    el('label', { for: 'import-password', text: 'The password this file was exported under' }),
    passwordWithToggle(password),
    el('div', { class: 'form-actions' }, [openButton]),
  ]);

  const phase = el('p', { class: 'progress-label', hidden: true, role: 'status' });
  const bar = el('progress', { class: 'progress', hidden: true, max: '1', value: '0' });

  // 3. Review, and 4. Confirm.
  const review = el('div', { class: 'review', hidden: true });
  const erase = el('input', { type: 'text', id: 'import-erase', placeholder: 'ERASE' });
  const replace = el('button', { class: 'btn-destructive', text: 'Replace my vault', type: 'button' });
  const stepConfirm = el('div', { class: 'confirm-step', hidden: true }, [
    holdsData
      ? el('div', { class: 'field' }, [el('label', { for: 'import-erase', text: 'Type ERASE to confirm' }), erase])
      : null,
    replace,
  ]);

  const reset = (from) => {
    error.hidden = true;
    if (from <= 1) {
      parsed = null;
      stepPassword.hidden = true;
    }
    if (from <= 2) {
      attempt = null;
      worker?.terminate();
      worker = null;
      openButton.disabled = false;
      opened = null;
      erase.value = '';
      review.hidden = true;
      stepConfirm.hidden = true;
      phase.hidden = true;
      bar.hidden = true;
    }
  };

  const take = async (chosen) => {
    reset(1);
    if (!chosen) return;
    // By size first, before the file is read at all.
    if (chosen.size > transfer.MAX_FILE_BYTES) {
      fail('That file is too large to be a Solvent vault file.');
      return;
    }
    try {
      parsed = transfer.checkFile(JSON.parse(await chosen.text()));
    } catch (failure) {
      parsed = null;
      fail(refusal(failure));
      return;
    }
    stepPassword.hidden = false;
    password.focus();
  };
  file.addEventListener('change', () => take(file.files[0]));
  stepFile.addEventListener('dragover', (event) => event.preventDefault());
  stepFile.addEventListener('drop', (event) => {
    event.preventDefault();
    take(event.dataTransfer.files[0]);
  });

  // The whole file is decrypted and re-keyed before the review, so a
  // file that cannot be restored never reaches the step where a person
  // decides. Only the wrap and the upload wait for the confirmation.
  const open = async () => {
    reset(2);
    if (!parsed) return;
    openButton.disabled = true;
    const mine = {};
    attempt = mine;
    // Superseded by another file or another attempt, or the card gone
    // with a lock or the screen left, which starts the restore again
    // from the first step.
    const current = () => attempt === mine && review.isConnected;
    let file;
    let rekeyed;
    try {
      file = await transfer.openFile(parsed, password.value);
      if (!current()) return;
      worker = new Worker('/static/js/transfer-worker.js', { type: 'module' });
      rekeyed = await inWorker(worker, file.fileDek, file.records, (step, done, of) => {
        if (!review.isConnected) return reset(2);
        progress(`${step === 'decrypt' ? 'Decrypting' : 'Re-encrypting'} ${done} of ${of}…`, done, of);
      });
    } catch (failure) {
      if (!current()) return;
      reset(2);
      fail(
        failure instanceof transfer.WrongPassword
          ? 'That password does not open this file.'
          : failure instanceof transfer.FileRefused
            ? refusal(failure)
            : failure.unreadable
              ? `This file is damaged and cannot be restored. ${failure.unreadable === 1 ? '1 record' : `${failure.unreadable} records`} in it could not be read. Your vault is unchanged.`
              : 'This file could not be opened. Your vault is unchanged.',
      );
      return;
    } finally {
      if (attempt === mine) openButton.disabled = false;
    }
    if (!current()) return;
    reset(2);
    // What the review and the upload need, and no key to the file.
    opened = { profile: file.profile, records: file.records, exportedAt: file.exportedAt, rekeyed };
    showReview();
  };
  openButton.addEventListener('click', open);
  password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      open();
    }
  });

  const showReview = () => {
    const counts = transfer.countKinds(opened.records);
    const theirs = opened.profile ? opened.profile.mainCurrency : null;
    mount(review, [
      el('div', { class: 'review-side' }, [
        el('h3', { class: 'group-heading', text: 'In the file' }),
        el('p', { text: `${counts.account} holdings` }),
        el('p', { text: `${counts.snapshot} recorded figures` }),
        el('p', { text: `${counts.rate} captured prices` }),
        el('p', { class: 'hint', text: `Exported ${vault.format.longDate(opened.exportedAt.slice(0, 10))}` }),
      ]),
      el('div', { class: 'review-side' }, [
        el('h3', { class: 'group-heading', text: 'What will be deleted' }),
        ...(holdsData
          ? [
              el('p', { text: `${mine.account} holdings` }),
              el('p', { text: `${mine.snapshot} recorded figures` }),
              el('p', { text: `${mine.rate} captured prices` }),
              el('p', { class: 'strong', text: `Your vault currently holds ${total} records. All of them will be deleted.` }),
            ]
          : [el('p', { text: 'Your vault is empty. Nothing will be deleted.' })]),
      ]),
      theirs && theirs !== vault.mainCurrency
        ? el('p', { class: 'review-line', text: `This vault is kept in ${theirs}. Yours is currently in ${vault.mainCurrency}.` })
        : null,
      parsed.formatVersion < transfer.FORMAT_VERSION
        ? el('p', { class: 'review-line', text: 'This file was written by an earlier version. It is brought up to date as it goes in.' })
        : null,
    ]);
    review.hidden = false;
    stepConfirm.hidden = false;
  };

  const progress = (label, done = null, of = null) => {
    phase.textContent = label;
    phase.hidden = false;
    bar.hidden = done === null;
    if (done !== null) {
      bar.max = String(of || 1);
      bar.value = String(done);
    }
  };

  replace.addEventListener('click', async () => {
    error.hidden = true;
    if (!parsed || !opened) return;
    // Required whenever the vault holds anything, and never skipped.
    if (holdsData && erase.value !== 'ERASE') {
      fail('Type ERASE to confirm that your current vault is replaced.');
      return;
    }
    replace.disabled = true;
    const { rekeyed } = opened;
    let answered;
    let wrapper;
    try {
      progress('Uploading…');
      wrapper = await wrapForMaster(rekeyed.dek);
      answered = await api.post('/api/import', { ...wrapper, currentSalt: heldSalt(), records: rekeyed.records });
    } catch (failure) {
      // The new wrapper is under a Master Key the current password no
      // longer gives, and nothing was written (login.md, A credential
      // changed elsewhere).
      if (failure.body?.refused === 'credential-changed') {
        lockForChangedCredential();
        return;
      }
      phase.hidden = true;
      fail('The import did not go through, and it was undone whole. Your original vault is fully intact and readable.');
      replace.disabled = false;
      return;
    }

    const theirs = opened.profile ? opened.profile.mainCurrency : null;
    const before = vault.mainCurrency;
    let next;
    try {
      next = await replaceDek(rekeyed.dek, answered.vaultEpoch, wrapper);
    } catch {
      // A lock during the upload already took the keys and the screen.
      return;
    }
    restored = {
      counts: transfer.countKinds(opened.records),
      currency: next.mainCurrency,
      currencyChanged: Boolean(theirs) && theirs !== before,
    };
    reload();
  });

  // A lock starts the restore again from the first step, so not even
  // the typed ERASE outlives it (export-import.md, Import).
  return el('section', { class: 'card', id: 'import-card', 'data-keeps-nothing': '' }, [
    el('h2', { class: 'section-heading', text: 'Import' }),
    stepFile,
    stepPassword,
    review,
    stepConfirm,
    phase,
    bar,
    error,
    el('p', {
      class: 'hint',
      text: 'Your password stays the same and your login is unaffected. Only the contents of your vault are replaced: your holdings, your history, your main currency, your dimensions and your idle lock all become the file’s. Every other tab and window of this browser, and every other device where your vault is open, closes it and asks for your password. Anything typed there and not yet saved is lost. From this moment the two vaults are independent, so anything the file’s author records in their own vault afterwards never appears here.',
    }),
  ]);
}

/** The decrypt and re-encrypt, in a Worker so the tab stays responsive.
 *  Resolves to the new DEK and the re-encrypted records, or rejects
 *  counting the records that would not decrypt. */
function inWorker(worker, fileDek, records, onProgress) {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.phase === 'done') {
        worker.terminate();
        resolve({ dek: data.dek, records: data.records });
      } else if (data.phase === 'failed') {
        worker.terminate();
        reject(Object.assign(new Error('unreadable'), { unreadable: data.unreadable }));
      } else {
        onProgress(data.phase, data.done, data.total);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('worker'));
    };
    worker.postMessage({ fileDek, records });
  });
}

/** What the screen says of a file `checkFile` or `openFile` refused. */
function refusal(failure) {
  const reason = failure instanceof transfer.FileRefused ? failure.reason : 'format';
  if (reason === 'newer') return 'This file was written by a newer version of Solvent. Update Solvent before restoring it.';
  if (reason === 'noProfile') {
    return 'This file carries no vault settings, so it would restore a vault with no main currency. It cannot be restored.';
  }
  return 'That is not a Solvent vault file, or it has been damaged.';
}

function countOf(map) {
  let total = 0;
  for (const list of map.values()) total += list.length;
  return total;
}
