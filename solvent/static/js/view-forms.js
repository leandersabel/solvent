// The single-holding value form and the prompts it raises
// (spec/ui/snapshot-entry.md).
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { dialog, el, resumable, today } from './dom.js';
import { dateField } from './datepicker.js';

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
        : vault.mainMoney(decimal.multiply(quantity, price.rate));
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
        confirmReplace(atDate, holding, vault, () => write(atDate));
        return;
      }
      if (atDate && existing) {
        confirmMove(atDate, holding, vault, () => write(atDate));
        return;
      }
      await write(null);
    },
  });

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
      el('details', {}, [el('summary', { text: 'Prices' }), pricesLine]),
      error,
    ],
    actions: [el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }), submit],
  });
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
