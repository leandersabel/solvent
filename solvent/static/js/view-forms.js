// The single-holding value form and the prompts it raises
// (spec/features/record-snapshot.md, Snapshot entry).
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { dialog, el, mount, resumable, today } from './dom.js';
import { dateField } from './datepicker.js';
import { dayNumber, isoFromDay } from './model.js';
import { closedCopy, describeConverted as showConverted, rateBlock, rateChangeCopy } from './view-sweep.js';

/** One holding, one date: the small form for an odd date or a
 *  backfill. There is no rate field on it, because a price belongs to
 *  a unit rather than to a holding. Its prices line says what the save
 *  writes for the date, which is about the date rather than about this
 *  holding (record-snapshot.md, Snapshot entry). */
export function snapshotDialog(vault, holding, existing, onSaved, onOpenRecording = null) {
  const value = el('input', {
    type: 'text',
    inputmode: 'decimal',
    value: existing ? vault.format.quantity(existing.payload.value) : '',
    id: 'snapshot-value',
  });
  const note = el('textarea', { rows: '2', text: existing ? existing.payload.note || '' : '' });
  const unit = holding.payload.unit;
  const converted = el('p', { class: 'hint numeric' });
  const error = el('p', { class: 'field-error', hidden: true });
  const pricesLine = el('p', { class: 'hint prices-line' });
  const pricesBody = el('div', { class: 'prices-body' });
  let block = null;
  let sit = null;
  // Set once a move whose prices did not save has been reported: Save
  // waits for the next change.
  let spent = false;
  const changed = () => {
    spent = false;
    submit.disabled = false;
  };

  // An empty date opens to its proposals, fetched for that date, and
  // its lines are the ones the save writes. A figure added at a date
  // already priced fills in only the units that date is missing, as the
  // sweep does (record-rate.md, The refresh), and looks up nothing when
  // none is. Moving an existing entry to another date is the same act
  // as adding it there. Every other edit of an existing entry, and a
  // figure replacing this holding's own at that date, changes a figure,
  // which ensures no price: those read the stored prices and look
  // nothing up.
  const moving = () => Boolean(existing) && date.value !== existing.payload.date;
  const describePrices = () => {
    const on = date.value;
    if (!on) {
      pricesLine.textContent = '';
      pricesBody.replaceChildren();
      block = null;
      return;
    }
    const occupied = vault.holdsRecording(on);
    const staying = Boolean(existing) && !moving();
    const adding = moving() || (!existing && !vault.snapshotsFor(holding.recordId).some((s) => s.payload.date === on));
    const filling = occupied && adding && vault.missingUnits(on, unit).length > 0;
    const joining = staying || occupied;
    sit = staying || (occupied && !filling) ? null : writes.sitting(vault, on);
    block = rateBlock(vault, on, {
      sit,
      readOnly: joining && !filling,
      fillMissing: filling,
      also: unit,
      onChange: describeConverted,
    });
    const main = unit === vault.mainCurrency;
    if (staying) {
      pricesLine.textContent = `The prices stored for ${vault.format.longDate(on)}. Editing this entry changes none of them.`;
    } else if (occupied) {
      const joins = vault.recording(on).prices.length
        ? `${vault.format.longDate(on)} already holds prices. This figure joins them.`
        : `${vault.format.longDate(on)} already holds a recording. This figure joins it.`;
      pricesLine.textContent = filling ? `${joins} The prices it is missing will be recorded with this.` : joins;
    } else {
      pricesLine.textContent = main && block.lines.length
        ? `Prices for ${vault.format.longDate(on)} will be recorded with this, for every other unit in your vault, although this figure is in ${vault.mainCurrency}.`
        : `Prices for ${vault.format.longDate(on)} will be recorded with this.`;
    }
    mount(pricesBody, [
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
    ]);
    if (sit && writes.needsLookup(vault, on, unit)) {
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
  // What the field saves: the stored string while it is untouched,
  // never its text read again (record-snapshot.md, Confirming).
  const typedValue = () => vault.format.readField(value.value, existing ? existing.payload.value : null);
  const describeConverted = () => {
    const stored = typedValue();
    if (!block || unit === vault.mainCurrency) return converted.replaceChildren();
    showConverted(vault, converted, stored === null ? null : decimal.parse(stored), block.figureFor(unit), date.value);
  };
  // An archived holding's entry moves only to a date before its archive
  // date: onto it the move would displace the archive's zero, and after
  // it the entry would be a figure after the archive. A figure already
  // on or after that date keeps its own date.
  const archivedAt = holding.payload.archivedAt;
  const archivedOn = archivedAt && `Archived on ${vault.format.fullDate(archivedAt)}.`;
  const date = dateField(vault.format, {
    id: 'snapshot-date',
    max: archivedAt ? isoFromDay(dayNumber(archivedAt) - 1) : today(),
    keep: existing ? existing.payload.date : null,
    maxReason: archivedAt ? `${archivedOn} Enter an earlier date.` : undefined,
    hint: archivedOn || '',
    value: existing ? existing.payload.date : today(),
    onChange: () => {
      if (moving()) changed();
      describePrices();
      describeConverted();
    },
  });
  value.addEventListener('input', describeConverted);
  value.addEventListener('input', changed);
  note.addEventListener('input', changed);

  const fail = (text, children = []) => {
    mount(error, [text, ...children]);
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
    cancel.onclick = done;
  };

  const create = async (on, stored) => {
    const claim = sit || writes.sitting(vault, on);
    const refusal = await writes.claimDate(vault, claim, {
      snapshots: [holding.recordId],
      rates: sit ? vault.missingUnits(on) : [],
    });
    if (refusal) {
      if (refusal.closed) return finishWith(closedCopy(refusal, 'saved'));
      describePrices();
      return refusedAt(on);
    }
    await writes.saveSnapshot(vault, holding.recordId, null, {
      date: on,
      value: stored,
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

  // A line changed here is the same act as one changed on the sweep,
  // and says what it moves before anything goes through.
  const confirmPrices = (changedLines, proceed) => {
    const on = date.value;
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
            proceed();
          },
        }),
      ],
    });
    return null;
  };

  // Saves the edit and reports what a move must still say. The prices
  // are the lines' own, after the quantity: a proposal still in flight
  // is waited for here, and Save never waited on it.
  const editEntry = async (on, payload, displaced) => {
    if (sit && sit.proposals) block.showProposals(await sit.proposals);
    const result = await writes.editSnapshot(vault, holding, existing, payload, {
      sit,
      displaced,
      choose: (priced) => block.partFor(priced),
    });
    if (result.refused) {
      if (result.closed) return finishWith(closedCopy(result, 'moved'));
      describePrices();
      return refusedAt(on);
    }
    existing = result.moved;
    const { failed, undeleted } = result;
    const left = `The entry already on ${vault.format.longDate(on)} could not be deleted, so the date holds both until you keep one.`;
    if (!failed.length) return undeleted ? finishWith(`Moved. ${left}`) : done();
    const units = failed.length > 1 ? `${failed.slice(0, -1).join(', ')} and ${failed.at(-1)}` : failed[0];
    const lost = `${failed.length > 1 ? 'The prices' : 'The price'} for ${units} on that date did not save.`;
    // The entry has moved: what the dialog shows follows it, Save stays
    // inert until something changes, and the date's own screen is where
    // the empty lines are filled.
    spent = true;
    cancel.textContent = 'Done';
    cancel.onclick = done;
    describePrices();
    describeConverted();
    return fail(`Moved to ${vault.format.fullDate(on)}. ${lost}${undeleted ? ` ${left}` : ''}`, [
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
  };

  const submit = el('button', {
    class: 'btn-primary',
    text: 'Save',
    onclick: async () => {
      error.hidden = true;
      const stored = typedValue();
      if (stored === null) {
        return fail('Enter a number, with at most twelve decimal places.');
      }
      if (!date.validate()) return;
      const on = date.value;
      const atDate = vault
        .snapshotsFor(holding.recordId)
        .find((s) => s.payload.date === on && s !== existing);
      const payload = { date: on, value: stored, note: note.value.trim() || null };

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
          submit.disabled = spent;
        }
      };

      if (block && block.lines.some((line) => line.invalid())) {
        return fail('A price on the prices line does not read as a number. Nothing was saved.');
      }
      const changedLines = block ? block.lines.filter((line) => line.changed()) : [];
      if (existing) {
        // An edit is an ordinary versioned write of this record, its
        // date included. Moving it onto a date the holding already
        // holds writes the move first and deletes the displaced record
        // after, so a failure leaves two entries on one date rather
        // than none: a visible fault beats silent loss.
        const edit = () => attempt(() => editEntry(on, payload, atDate));
        const priced = () => (changedLines.length ? confirmPrices(changedLines, edit) : edit());
        return atDate ? confirmMove(atDate, holding, vault, priced) : priced();
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
      const createEntry = () => attempt(() => create(on, stored));
      return changedLines.length ? confirmPrices(changedLines, createEntry) : createEntry();
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
        text: `You already recorded ${vault.amount(stored.payload.value, holding.payload.unit)} for ${vault.format.longDate(stored.payload.date)}. Replace it?`,
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
        text: `${vault.format.longDate(stored.payload.date)} already holds a snapshot of ${vault.amount(stored.payload.value, holding.payload.unit)}. Moving this entry there will delete it.`,
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
