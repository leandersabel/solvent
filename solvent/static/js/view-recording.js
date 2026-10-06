// One date, and everything recorded at it
// (spec/features/record-snapshot.md, Recording detail).
//
// It is for looking. Opening it issues no write and no price request,
// however old the day is, because a screen that repriced March by
// being opened is the one thing this screen must not be.
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { counted, dialog, el, priceDateLine } from './dom.js';
import { holdingsIn, provenanceChip } from './view-sweep.js';

export function recordingView(vault, date, { onUpdate, onOpenHolding, onDeleted, onChanged, onPickDate }) {
  const root = el('section', { class: 'screen recording' });
  const draw = (notice = null) => {
    // Another window deleted this date: the screen says so rather than
    // rendering a shell of a recording it no longer has.
    if (!vault.holdsRecording(date)) {
      root.replaceChildren(
        el('h1', { class: 'screen-heading', text: vault.format.longDate(date) }),
        el('div', { class: 'card card-centered' }, [
          el('p', { class: 'empty-line', text: `${vault.format.longDate(date)} holds no recording.` }),
          el('button', { class: 'btn-primary', text: 'Pick a date', onclick: () => onPickDate && onPickDate() }),
        ]),
      );
      return;
    }
    const { figures, prices } = vault.recording(date);
    const priced = new Set(prices.map((entry) => entry.payload.symbol));
    // A unit the vault holds with nothing at this date: the source did
    // not answer that day, and filling it in is done after Update.
    const empty = vault.unitsToRefresh().filter((unit) => !priced.has(unit));
    const error = el('p', { class: 'field-error', role: 'alert', hidden: !notice, text: notice || '' });

    root.replaceChildren(
      el('h1', { class: 'screen-heading', text: vault.format.longDate(date) }),
      error,
      el('section', { class: 'card' }, [
        el('h2', { class: 'section-heading', text: 'Figures' }),
        figures.length
          ? el('table', { class: 'data-table recording-table' }, [
              el('tbody', {}, figures.map((figure) => figureRow(vault, figure, onOpenHolding, onChanged))),
            ])
          : el('p', { class: 'empty-line', text: 'No figures recorded on this date' }),
      ]),
      el('section', { class: 'card' }, [
        el('h2', { class: 'section-heading', text: 'Prices' }),
        prices.length
          ? el('table', { class: 'data-table recording-table' }, [
              el('tbody', {}, prices.map((entry) => priceRow(vault, entry, onChanged))),
            ])
          : el('p', { class: 'empty-line', text: 'No prices were captured at this date.' }),
        ...empty.map((unit) =>
          el('p', {
            class: 'hint missing-price',
            text: `No price for ${vault.unitName(unit)} at this date. The line is empty, and it is filled in after Update.`,
          }),
        ),
      ]),
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn-primary', text: 'Update', onclick: () => onUpdate(date) }),
        // Nothing to remove where the date holds only archives' zeros.
        !prices.length && figures.every((f) => vault.isArchiveZero(f.holding, f.snapshot))
          ? null
          : el('button', {
              class: 'btn-destructive',
              text: 'Delete',
              onclick: () => confirmDelete(vault, date, onDeleted, draw),
            }),
      ]),
    );
  };
  draw();
  return root;
}

function figureRow(vault, { holding, snapshot }, onOpenHolding, onChanged) {
  const quantity = decimal.parse(snapshot.payload.value);
  const price = vault.priceAtDate(holding.payload.unit, snapshot.payload.date);
  const rivals = vault
    .snapshotsFor(holding.recordId)
    .filter((s) => s.payload.date === snapshot.payload.date && s.recordId !== snapshot.recordId);
  return el('tr', { class: rivals.length ? 'flagged' : null }, [
    el('td', {}, [
      el('button', {
        class: 'link-button',
        text: holding.payload.name,
        onclick: () => onOpenHolding(holding.recordId),
      }),
    ]),
    el('td', {
      class: 'numeric',
      text: vault.amount(snapshot.payload.value, holding.payload.unit),
    }),
    el('td', { class: 'numeric' }, price
      ? [vault.mainMoney(decimal.multiply(quantity, price.rate)), priceDateLine(vault, price.date, snapshot.payload.date)]
      : 'not priced'),
    keepCell(vault, rivals, 'Two figures for this holding share this date. Keep one.', onChanged),
  ]);
}

function priceRow(vault, entry, onChanged) {
  const rivals = vault
    .entriesFor(entry.payload.symbol)
    .filter((e) => e.payload.date === entry.payload.date && e.recordId !== entry.recordId);
  return el('tr', { class: rivals.length ? 'flagged' : null, 'data-unit': entry.payload.symbol }, [
    el('td', { text: vault.unitName(entry.payload.symbol) }),
    el('td', {
      class: 'numeric',
      text: `${vault.mainCurrency} ${vault.format.editable(decimal.parse(entry.payload.rate), 6)}`,
    }),
    el('td', {}, [el('span', { class: 'chip', text: provenanceChip(entry.payload, vault.format) })]),
    keepCell(vault, rivals, 'Two prices for this unit share this date. Keep one.', onChanged),
  ]);
}

/** The fault named, and the one way out of it: keeping this entry
 *  deletes the others for its date (record-snapshot.md, Recording detail,
 *  two entries at this date). */
function keepCell(vault, rivals, note, onChanged) {
  if (!rivals.length) return el('td', {});
  return el('td', {}, [
    el('span', { class: 'flag-note', text: note }),
    el('button', {
      class: 'btn-inline',
      text: 'Keep this one',
      onclick: async () => {
        for (const rival of rivals) await writes.deleteRecord(vault, rival);
        onChanged();
      },
    }),
  ]);
}

/** What a recording still holds, by holding name and by unit. */
function named(vault, entries) {
  return entries
    .map((entry) =>
      entry.recordType === 'snapshot'
        ? (vault.holdings.get(entry.accountId) || { payload: { name: 'a holding' } }).payload.name
        : `the ${vault.unitName(entry.payload.symbol)} price`,
    )
    .join(', ');
}

/** One confirmation, naming the two things that make this
 *  destructive: the prices go too, so every holding measured in those
 *  units moves on that date and not only the ones that had a figure,
 *  and there is no way back. */
function confirmDelete(vault, date, onDeleted, redraw) {
  const { figures, prices } = vault.recording(date);
  const kept = figures.filter((f) => vault.isArchiveZero(f.holding, f.snapshot));
  const units = [...new Set(prices.map((entry) => entry.payload.symbol))];
  const affected = units.reduce((sum, unit) => sum + holdingsIn(vault, unit, date), 0);

  let first = 'Every figure recorded that day goes, and so does every price captured with it.';
  if (!figures.length) first = 'It holds no figures, and the prices captured that day go with it.';
  else if (kept.length === figures.length) first = 'Only the prices captured that day go.';
  const body = [el('p', { text: first })];
  if (kept.length) {
    const names = kept.map((f) => f.holding.payload.name).join(', ');
    body.push(el('p', { text: `The zero recorded when you archived ${names} stays, and so does this recording, holding it.` }));
  }
  if (units.length) {
    body.push(
      el('p', {
        text: `${counted(affected, 'holding', 'holdings')} measured in ${units.map((unit) => vault.unitName(unit)).join(' and ')} move on that date, including ones you recorded nothing for.`,
      }),
    );
  }
  body.push(el('p', { text: 'This cannot be undone.' }));

  const close = dialog({
    heading: `Delete the recording for ${vault.format.longDate(date)}?`,
    body,
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-destructive',
        text: 'Delete the recording',
        onclick: async () => {
          close();
          const before = figures.length - kept.length + prices.length;
          const remaining = await writes.deleteRecording(vault, date);
          // The date stays a recording where an archive's zero keeps it.
          if (!remaining.length) return vault.holdsRecording(date) ? redraw() : onDeleted();
          // Nothing is rolled back and nothing marks the date as half
          // deleted. The screen shows what is actually left, names it,
          // and offers Delete again.
          redraw(
            remaining.length === before
              ? 'Nothing was deleted. The recording is unchanged.'
              : `Part of the recording is still there: ${named(vault, remaining)}. Nothing was rolled back, and what is left reads normally. Delete again to remove it.`,
          );
          return null;
        },
      }),
    ],
  });
}
