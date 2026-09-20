// The holding form, the single-holding value form, and the two
// destructive dialogs they launch (spec/ui/account-form.md,
// spec/ui/snapshot-entry.md).
import * as api from './api.js';
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { dialog, el, today } from './dom.js';
import { dateField } from './datepicker.js';

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
 *  a unit rather than to a holding. */
export function snapshotDialog(vault, holding, existing, onSaved) {
  const value = el('input', {
    type: 'text',
    inputmode: 'decimal',
    value: existing ? existing.payload.value : '',
    id: 'snapshot-value',
  });
  const date = dateField(vault.format, {
    id: 'snapshot-date',
    max: today(),
    value: existing ? existing.payload.date : today(),
    onChange: () => {
      describePrices();
      describeConverted();
    },
  });
  const note = el('textarea', { rows: '2', text: existing ? existing.payload.note || '' : '' });
  const converted = el('p', { class: 'hint' });
  const error = el('p', { class: 'field-error', hidden: true });
  const pricesLine = el('p', { class: 'hint' });

  const describePrices = () => {
    const recording = vault.recording(date.value);
    pricesLine.textContent = recording.prices.length
      ? `${vault.format.longDate(date.value)} already holds prices. This figure joins them.`
      : `Prices for ${vault.format.longDate(date.value)} will be recorded with this.`;
  };
  const describeConverted = () => {
    const quantity = decimal.parse(value.value);
    const price = vault.priceOn(holding.payload.unit, date.value);
    converted.textContent =
      quantity === null || !price
        ? ''
        : `${vault.format.money(decimal.multiply(quantity, price.rate))} ${vault.mainCurrency}`;
  };
  value.addEventListener('input', describeConverted);
  describePrices();
  describeConverted();

  const submit = el('button', {
    class: 'btn-primary',
    text: 'Save',
    onclick: async () => {
      error.hidden = true;
      const quantity = decimal.parse(value.value);
      if (quantity === null) {
        error.textContent = 'Enter a number, with at most twelve decimal places.';
        error.hidden = false;
        return;
      }
      if (!date.value) {
        error.textContent = `Enter a date, written ${vault.format.datePlaceholder()}.`;
        error.hidden = false;
        return;
      }
      if (date.value > today()) {
        error.textContent = 'A snapshot describes what was. Pick today or earlier.';
        error.hidden = false;
        return;
      }
      const atDate = vault
        .snapshotsFor(holding.recordId)
        .find((s) => s.payload.date === date.value && s !== existing);

      const write = async (replacing) => {
        try {
          await writes.saveSnapshot(vault, holding.recordId, replacing || (existing && existing.payload.date === date.value ? existing : null), {
            date: date.value,
            value: decimal.format(quantity),
            note: note.value.trim() || null,
          });
          // Moving an entry writes before deleting the displaced one,
          // so a failure leaves two entries on one date rather than
          // none: a visible fault beats silent loss.
          if (existing && existing.payload.date !== date.value) {
            if (replacing) await writes.deleteRecord(vault, replacing);
            await writes.deleteRecord(vault, existing);
          }
          if (!existing) {
            const proposals = await writes.fetchProposals(vault, date.value);
            await writes.refreshPrices(vault, date.value, proposals);
          }
          close();
          onSaved();
        } catch (failure) {
          error.textContent =
            failure.status === 409
              ? 'This snapshot was changed in another tab.'
              : 'That did not save.';
          error.hidden = false;
        }
      };

      if (atDate && !existing) {
        // The date here is chosen blind, so the stored figure is put
        // in front of the person before anything is written.
        confirmReplace(atDate, holding, vault.format, () => write(atDate));
        return;
      }
      if (atDate && existing) {
        confirmMove(atDate, holding, vault.format, () => write(atDate));
        return;
      }
      await write(null);
    },
  });

  const close = dialog({
    heading: existing ? 'Edit this value' : `Record a value for ${holding.payload.name}`,
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
      el('details', {}, [el('summary', { text: 'Prices' }), pricesLine]),
      error,
    ],
    actions: [el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }), submit],
  });
}

function confirmReplace(stored, holding, format, onConfirm) {
  const close = dialog({
    heading: 'Replace the figure already recorded?',
    body: [
      el('p', {
        text: `You already recorded ${format.quantity(decimal.parse(stored.payload.value))} ${holding.payload.unit} for ${format.longDate(stored.payload.date)}. Replace it?`,
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

function confirmMove(stored, holding, format, onConfirm) {
  const close = dialog({
    heading: 'Move this entry onto an occupied date?',
    body: [
      el('p', {
        text: `${format.longDate(stored.payload.date)} already holds a snapshot of ${format.quantity(decimal.parse(stored.payload.value))} ${holding.payload.unit}. Moving this entry there will delete it.`,
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
 *  and is deleted outright. */
export function deleteHoldingDialog(vault, holding, onDone) {
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
