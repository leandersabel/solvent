// The holding form, the single-holding value form, and the two
// destructive dialogs they launch (spec/ui/account-form.md,
// spec/ui/snapshot-entry.md).
import * as api from './api.js';
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { dialog, el, resumable, today } from './dom.js';
import { dateField } from './datepicker.js';
import { rateBlock, rateChangeCopy } from './view-sweep.js';

let symbolTable = null;

/** The unit picker's list. Ordinary answers first: the vault's main
 *  currency, then the other currencies, then the metals, then free
 *  text, because nearly every holding is a bank account or a depot in
 *  a currency (ui/account-form.md). */
export async function units(vault) {
  if (!symbolTable) {
    try {
      symbolTable = await api.get('/api/rates/symbols');
    } catch {
      return null;
    }
  }
  const main = symbolTable.filter((s) => s.symbol === vault.mainCurrency);
  const currencies = symbolTable.filter(
    (s) => s.kind === 'currency' && s.symbol !== vault.mainCurrency,
  );
  const metals = symbolTable.filter((s) => s.kind === 'metal');
  return [...main, ...currencies, ...metals];
}

export function holdingForm(vault, existing, onSaved) {
  const payload = existing
    ? { ...existing.payload }
    : { name: '', unit: vault.mainCurrency, dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() };

  const name = el('input', { type: 'text', id: 'holding-name', value: payload.name, required: true });
  const unitSelect = el('select', { id: 'holding-unit' });
  const freeText = el('input', { type: 'text', hidden: true, placeholder: 'm²' });
  const unitNote = el('p', { class: 'hint' });
  const note = el('textarea', { rows: '3', text: payload.note || '' });
  const error = el('p', { class: 'field-error', hidden: true });

  const hasSnapshots = existing && vault.snapshotsFor(existing.recordId).length > 0;

  units(vault).then((list) => {
    if (!list) {
      unitSelect.hidden = true;
      freeText.hidden = false;
      freeText.value = payload.unit;
      unitNote.textContent =
        'The unit list could not be loaded. Try again, or type a unit. A typed "dollars" is a free-text unit rather than the USD run of prices, and the choice is fixed once you record a value.';
      return;
    }
    for (const symbol of list) {
      unitSelect.append(
        el('option', {
          value: symbol.symbol,
          text: symbol.lookup
            ? `${symbol.label} (${symbol.symbol})`
            : `${symbol.label} (${symbol.symbol}), rate entered by hand`,
        }),
      );
    }
    // A unit the table no longer offers still shows as the current
    // choice: a retired symbol keeps pricing, so nothing is wrong.
    if (payload.unit && !list.some((s) => s.symbol === payload.unit)) {
      unitSelect.append(el('option', { value: payload.unit, text: payload.unit }));
    }
    unitSelect.append(el('option', { value: '__other__', text: 'Something else…' }));
    unitSelect.value = payload.unit;
    unitSelect.disabled = hasSnapshots;
    describeUnit();
  });

  const describeUnit = () => {
    if (hasSnapshots) {
      unitNote.textContent =
        'The unit cannot change once you have recorded a value here. Your figures are counted in this unit, and the prices that value them belong to it. Archive this holding and create a new one instead.';
      return;
    }
    if (unitSelect.value === '__other__') {
      freeText.hidden = false;
      unitNote.textContent =
        'You enter the price yourself each time you record a value. Not listed? This list is set up for the whole instance by an administrator, not per vault.';
      return;
    }
    freeText.hidden = true;
    unitNote.textContent =
      'You can change this until you record a value for this holding. After that it is fixed, and the only way to a different unit is to archive this holding and start a new one.';
  };
  unitSelect.addEventListener('change', describeUnit);

  const dimensionFields = vault.activeDimensions().map((dimension) => {
    const live = dimension.values.filter((v) => !v.archivedAt);
    if (live.length === 1) {
      // A flag: a dimension with one value, rendered as a checkbox
      // rather than a select. Unchecked means unassigned.
      const box = el('input', {
        type: 'checkbox',
        checked: payload.dims[dimension.id] === live[0].id,
      });
      box.dataset.dimension = dimension.id;
      box.dataset.value = live[0].id;
      return { dimension, control: box, element: el('label', { class: 'checkbox' }, [box, el('span', { text: dimension.label })]) };
    }
    const select = el('select', {}, [
      el('option', { value: '', text: 'Unassigned' }),
      ...live.map((value) => el('option', { value: value.id, text: value.label })),
    ]);
    select.value = payload.dims[dimension.id] || '';
    return {
      dimension,
      control: select,
      element: el('div', { class: 'field' }, [
        el('label', { text: dimension.label }),
        select,
      ]),
    };
  });

  const save = el('button', { type: 'submit', class: 'btn-primary', text: 'Save' });
  const form = el('form', { class: 'panel-form' }, [
    el('div', { class: 'field' }, [el('label', { for: 'holding-name', text: 'Name' }), name]),
    el('div', { class: 'field' }, [
      el('label', { for: 'holding-unit', text: 'Measured in' }),
      unitSelect,
      freeText,
      unitNote,
    ]),
    ...dimensionFields.map((f) => f.element),
    el('details', {}, [el('summary', { text: 'Add a note' }), note]),
    error,
    el('div', { class: 'form-actions' }, [save]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const chosen =
      unitSelect.hidden || unitSelect.value === '__other__'
        ? freeText.value.trim()
        : unitSelect.value;
    if (!name.value.trim() || !chosen) {
      error.textContent = 'A name and a unit are both required.';
      error.hidden = false;
      return;
    }
    const dims = {};
    for (const field of dimensionFields) {
      if (field.control.type === 'checkbox') {
        if (field.control.checked) dims[field.dimension.id] = field.control.dataset.value;
      } else if (field.control.value) {
        dims[field.dimension.id] = field.control.value;
      }
    }
    save.disabled = true;
    try {
      const saved = await writes.saveHolding(vault, existing, {
        ...payload,
        name: name.value.trim(),
        unit: chosen,
        dims,
        note: note.value.trim() || null,
      });
      onSaved(saved);
    } catch (failure) {
      error.textContent =
        failure.status === 409
          ? 'This holding was changed in another tab. Reload and redo the edit.'
          : 'That did not save. Nothing was changed.';
      error.hidden = false;
      save.disabled = false;
    }
  });

  return form;
}

/** One holding, one date: the small form for an odd date or a
 *  backfill. There is no rate field on it, because a price belongs to
 *  a unit rather than to a holding. Its prices line says what the save
 *  writes for the date, which is about the date rather than about this
 *  holding (ui/snapshot-entry.md). */
export function snapshotDialog(vault, holding, existing, onSaved, onOpenRecording = null) {
  const value = el('input', {
    type: 'text',
    inputmode: 'decimal',
    value: existing ? existing.payload.value : '',
    id: 'snapshot-value',
  });
  const note = el('textarea', { rows: '2', text: existing ? existing.payload.note || '' : '' });
  const converted = el('p', { class: 'hint' });
  const error = el('p', { class: 'field-error', hidden: true });
  const pricesLine = el('p', { class: 'hint prices-line' });
  const pricesBody = el('div', { class: 'prices-body' });
  let block = null;
  let sit = null;

  // An empty date opens to its proposals, fetched for that date, and
  // its lines are the ones the save writes. A date already priced, and
  // every edit of an existing entry, reads the stored prices and looks
  // nothing up.
  const describePrices = () => {
    const on = date.value;
    if (!on) {
      pricesLine.textContent = '';
      pricesBody.replaceChildren();
      block = null;
      return;
    }
    const occupied = vault.holdsRecording(on);
    const joining = existing || occupied;
    sit = joining ? null : writes.sitting(vault, on);
    block = rateBlock(vault, on, { sit, readOnly: Boolean(joining), onChange: describeConverted });
    const main = holding.payload.unit === vault.mainCurrency;
    if (existing) {
      pricesLine.textContent = `The prices stored for ${vault.format.longDate(on)}. Editing this entry changes none of them.`;
    } else if (occupied) {
      pricesLine.textContent = vault.recording(on).prices.length
        ? `${vault.format.longDate(on)} already holds prices. This figure joins them.`
        : `${vault.format.longDate(on)} already holds a recording. This figure joins it.`;
    } else {
      pricesLine.textContent = main && block.lines.length
        ? `Prices for ${vault.format.longDate(on)} will be recorded with this, for every other unit in your vault, although this figure is in ${vault.mainCurrency}.`
        : `Prices for ${vault.format.longDate(on)} will be recorded with this.`;
    }
    pricesBody.replaceChildren(
      block.element,
      joining && onOpenRecording && occupied
        ? el('button', {
            class: 'link-button',
            text: 'Open the recording, where they are changed',
            onclick: () => {
              close();
              onOpenRecording(on);
            },
          })
        : null,
    );
    if (sit && writes.needsLookup(vault, on)) {
      sit.proposals = writes.fetchProposals(vault, on);
      block.waiting();
      const shownFor = block;
      sit.proposals.then((proposals) => {
        if (block === shownFor) block.showProposals(proposals);
      });
    }
  };
  // The live result converts at the price for the date on the form: the
  // date's own price where one exists, and the proposal for it
  // otherwise.
  const describeConverted = () => {
    const quantity = decimal.parse(value.value);
    const price = block ? block.figureFor(holding.payload.unit) : null;
    converted.textContent =
      quantity === null || price === null || holding.payload.unit === vault.mainCurrency
        ? ''
        : vault.mainMoney(decimal.multiply(quantity, price));
  };
  const date = dateField(vault.format, {
    id: 'snapshot-date',
    max: today(),
    value: existing ? existing.payload.date : today(),
    onChange: () => {
      describePrices();
      describeConverted();
    },
  });
  value.addEventListener('input', describeConverted);

  const fail = (text, children = []) => {
    error.replaceChildren(text, ...children);
    error.hidden = false;
  };
  const refusedAt = (on) =>
    fail(`${vault.format.longDate(on)} already has a recording. Another window got there first. `, [
      onOpenRecording
        ? el('button', {
            class: 'link-button',
            text: 'Open the recording',
            onclick: () => {
              close();
              onOpenRecording(on);
            },
          })
        : null,
    ]);
  // Saved, with something the person must still be told: the dialog
  // stays up with the message until they close it.
  const finishWith = (text) => {
    fail(text);
    submit.hidden = true;
    cancel.textContent = 'Done';
    cancel.onclick = () => {
      close();
      onSaved();
    };
  };

  const create = async (on, quantity) => {
    const claim = sit || writes.sitting(vault, on);
    const refusal = await writes.claimDate(vault, claim, {
      snapshots: [holding.recordId],
      rates: sit ? vault.missingUnits(on) : [],
    });
    if (refusal) {
      describePrices();
      return refusedAt(on);
    }
    await writes.saveSnapshot(vault, holding.recordId, null, {
      date: on,
      value: decimal.format(quantity),
      note: note.value.trim() || null,
    });
    if (!sit) return done();
    // The quantity went first. Now the date's prices, from what the
    // lines show, on their own requests.
    if (sit.proposals) block.showProposals(await sit.proposals);
    const { failed } = await writes.refreshPrices(vault, on, {}, (unit) => block.partFor(unit));
    if (failed.length) return finishWith(`Saved. The prices were not updated for ${failed.join(', ')}.`);
    return done();
  };

  const done = () => {
    close();
    onSaved();
  };

  const submit = el('button', {
    class: 'btn-primary',
    text: 'Save',
    onclick: async () => {
      error.hidden = true;
      const quantity = decimal.parse(value.value);
      if (quantity === null) {
        return fail('Enter a number, with at most twelve decimal places.');
      }
      if (!date.value) {
        return fail(`Enter a date, written ${vault.format.datePlaceholder()}. A snapshot describes what was, so it cannot be in the future.`);
      }
      if (date.value > today()) {
        return fail('A snapshot describes what was. Pick today or earlier.');
      }
      const on = date.value;
      const atDate = vault
        .snapshotsFor(holding.recordId)
        .find((s) => s.payload.date === on && s !== existing);
      const payload = { date: on, value: decimal.format(quantity), note: note.value.trim() || null };

      const attempt = async (step) => {
        submit.disabled = true;
        try {
          await step();
        } catch (failure) {
          if (failure.status === 409) {
            await writes.reloadType(vault, 'snapshot').catch(() => {});
            fail('This snapshot was changed in another tab. Nothing was overwritten. Close this and redo the edit.');
          } else {
            fail('That did not save.');
          }
        } finally {
          submit.disabled = false;
        }
      };

      if (existing) {
        // An edit is an ordinary versioned write of this record, its
        // date included. Moving it onto a date the holding already
        // holds writes the move first and deletes the displaced record
        // after, so a failure leaves two entries on one date rather
        // than none: a visible fault beats silent loss.
        const move = async () => {
          await writes.saveSnapshot(vault, holding.recordId, existing, payload);
          if (!atDate) return done();
          try {
            await writes.deleteRecord(vault, atDate);
          } catch {
            return finishWith(
              `Moved. The entry already on ${vault.format.longDate(on)} could not be deleted, so the date holds both until you keep one.`,
            );
          }
          return done();
        };
        if (atDate) return confirmMove(atDate, holding, vault, () => attempt(move));
        return attempt(move);
      }
      if (atDate) {
        // The date here is chosen blind, so the stored figure is put
        // in front of the person before anything is written.
        return confirmReplace(atDate, holding, vault, () =>
          attempt(async () => {
            await writes.saveSnapshot(vault, holding.recordId, atDate, payload);
            done();
          }),
        );
      }
      if (block && block.lines.some((line) => line.invalid())) {
        return fail('A price on the prices line does not read as a number. Nothing was saved.');
      }
      const changedLines = block ? block.lines.filter((line) => line.changed()) : [];
      if (!changedLines.length) return attempt(() => create(on, quantity));
      // A line changed here is the same act as one changed on the
      // sweep, and says what it moves before anything goes through.
      const confirm = dialog({
        heading: 'Changing a price moves the holdings measured in it',
        body: rateChangeCopy(vault, on, changedLines.map((line) => ({ unit: line.unit, clearing: false }))).map(
          (text) => el('p', { text }),
        ),
        actions: [
          el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => confirm() }),
          el('button', {
            class: 'btn-primary',
            text: 'Save',
            onclick: () => {
              confirm();
              attempt(() => create(on, quantity));
            },
          }),
        ],
      });
      return null;
    },
  });
  const cancel = el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() });

  const close = dialog({
    heading: existing ? 'Edit this value' : `Record a value for ${holding.payload.name}`,
    resume: resumable(reopenSnapshot, holding.recordId, existing ? existing.recordId : null),
    body: [
      el('div', { class: 'field' }, [
        el('label', { for: 'snapshot-date', text: 'Date' }),
        date.element,
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'snapshot-value', text: `Value in ${holding.payload.unit}` }),
        value,
        converted,
      ]),
      el('details', {}, [el('summary', { text: 'Add a note' }), note]),
      el('details', { class: 'prices-fold' }, [el('summary', { text: 'Prices' }), pricesLine, pricesBody]),
      error,
    ],
    actions: [cancel, submit],
  });
  describePrices();
  describeConverted();
}

function reopenSnapshot({ vault, reload }, holdingId, snapshotId) {
  const holding = vault.holdings.get(holdingId);
  const existing = snapshotId
    ? vault.snapshotsFor(holdingId).find((s) => s.recordId === snapshotId)
    : null;
  if (!holding || (snapshotId && !existing)) return;
  snapshotDialog(vault, holding, existing, reload);
}

function confirmReplace(stored, holding, vault, onConfirm) {
  const close = dialog({
    heading: 'Replace the figure already recorded?',
    body: [
      el('p', {
        text: `You already recorded ${vault.amount(decimal.parse(stored.payload.value), holding.payload.unit)} for ${vault.format.longDate(stored.payload.date)}. Replace it?`,
      }),
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Keep what is there', onclick: () => close() }),
      el('button', {
        class: 'btn-primary',
        text: 'Replace it',
        onclick: () => {
          close();
          onConfirm();
        },
      }),
    ],
  });
}

function confirmMove(stored, holding, vault, onConfirm) {
  const close = dialog({
    heading: 'Move this entry onto an occupied date?',
    body: [
      el('p', {
        text: `${vault.format.longDate(stored.payload.date)} already holds a snapshot of ${vault.amount(decimal.parse(stored.payload.value), holding.payload.unit)}. Moving this entry there will delete it.`,
      }),
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-destructive',
        text: 'Move and delete',
        onclick: () => {
          close();
          onConfirm();
        },
      }),
    ],
  });
}

/** Deleting a holding is the user's choice between two real options,
 *  archive preselected. A holding with no snapshots skips the dialog
 *  and is deleted outright. `then` names where a dialog reopened after
 *  a lock goes when it is done, `onDone` being gone with the old
 *  screen by then. */
export function deleteHoldingDialog(vault, holding, onDone, then = 'reload') {
  const snapshots = vault.snapshotsFor(holding.recordId);
  if (!snapshots.length) {
    writes.purgeHolding(vault, holding).then(onDone);
    return;
  }

  const archiveDate = today();
  const atDate = snapshots.find((s) => s.payload.date === archiveDate);
  const closing = el('input', {
    type: 'text',
    inputmode: 'decimal',
    value: atDate ? atDate.payload.value : '0',
  });
  const typed = el('input', { type: 'text', placeholder: holding.payload.name });
  const error = el('p', { class: 'field-error', hidden: true });

  const permanently = el('button', {
    class: 'btn-destructive',
    text: 'Delete permanently',
    disabled: true,
    onclick: async () => {
      try {
        await writes.purgeHolding(vault, holding);
        close();
        onDone();
      } catch {
        error.textContent = 'Nothing was deleted.';
        error.hidden = false;
      }
    },
  });
  typed.addEventListener('input', () => {
    permanently.disabled = typed.value !== holding.payload.name;
  });

  const archive = el('button', {
    class: 'btn-primary',
    text: 'Archive',
    onclick: async () => {
      error.hidden = true;
      const quantity = closing.value.trim() ? decimal.parse(closing.value) : null;
      try {
        // The order is load-bearing: the closing value, then that
        // date's prices over the holdings as they stand with this one
        // still among them, and the archive flag last. The refresh
        // covers active holdings only, so setting the flag first
        // would archive a position at a price nobody captured.
        if (quantity !== null) {
          await writes.saveSnapshot(vault, holding.recordId, atDate || null, {
            date: archiveDate,
            value: decimal.format(quantity),
            note: null,
          });
          const proposals = await writes.fetchProposals(vault, archiveDate);
          await writes.refreshPrices(vault, archiveDate, proposals);
        }
        await writes.saveHolding(vault, vault.holdings.get(holding.recordId), {
          ...vault.holdings.get(holding.recordId).payload,
          archivedAt: archiveDate,
        });
        close();
        onDone();
      } catch {
        error.textContent =
          'Nothing was archived and the holding is untouched. The figure is still in the field.';
        error.hidden = false;
      }
    },
  });

  const close = dialog({
    heading: `Archive or delete ${holding.payload.name}?`,
    resume: resumable(reopenDeleteHolding, holding.recordId, then),
    body: [
      el('p', {
        text: 'Archive keeps every value you recorded. Your past net worth stays accurate. You can undo this.',
      }),
      el('p', { class: 'hint', text: `Archive date: ${vault.format.longDate(archiveDate)}` }),
      el('div', { class: 'field' }, [
        el('label', { text: 'What was it worth when you closed it?' }),
        closing,
        el('p', {
          class: 'hint',
          text: 'Leave it empty to skip. Without this, your chart drops by the last figure recorded here, with nothing recorded on that date to explain it.',
        }),
      ]),
      el('hr'),
      el('p', {
        text: `This also deletes ${snapshots.length} recorded values. Your past net worth figures will change.`,
      }),
      el('div', { class: 'field' }, [
        el('label', { text: 'Type the holding’s name to delete it permanently' }),
        typed,
      ]),
      error,
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      permanently,
      archive,
    ],
  });
}

function reopenDeleteHolding(context, holdingId, then) {
  const holding = context.vault.holdings.get(holdingId);
  if (holding) deleteHoldingDialog(context.vault, holding, context[then], then);
}
