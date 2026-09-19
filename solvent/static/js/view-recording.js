// One date, and everything recorded at it (spec/ui/recording-detail.md).
//
// It is for looking. Opening it issues no write and no price request,
// however old the day is, because a screen that repriced March by
// being opened is the one thing this screen must not be.
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { dialog, el, shortDate } from './dom.js';
import { provenanceChip } from './view-sweep.js';

export function recordingView(vault, date, { onUpdate, onOpenHolding, onDeleted }) {
  const { figures, prices } = vault.recording(date);
  const error = el('p', { class: 'field-error', hidden: true });

  return el('section', { class: 'screen' }, [
    el('h1', { class: 'screen-heading', text: shortDate(date) }),
    error,
    el('section', { class: 'card' }, [
      el('h2', { class: 'section-heading', text: 'Figures' }),
      figures.length
        ? el('table', { class: 'data-table' }, [
            el('tbody', {}, figures.map((figure) => figureRow(vault, figure, onOpenHolding))),
          ])
        : el('p', { class: 'empty-line', text: 'No figures recorded on this date' }),
    ]),
    el('section', { class: 'card' }, [
      el('h2', { class: 'section-heading', text: 'Prices' }),
      prices.length
        ? el('table', { class: 'data-table' }, [
            el('tbody', {}, prices.map((entry) => priceRow(vault, entry))),
          ])
        : el('p', {
            class: 'empty-line',
            text: 'No prices were captured at this date.',
          }),
    ]),
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn-primary', text: 'Update', onclick: () => onUpdate(date) }),
      el('button', {
        class: 'btn-destructive',
        text: 'Delete',
        onclick: () => confirmDelete(vault, date, error, onDeleted),
      }),
    ]),
  ]);
}

function figureRow(vault, { holding, snapshot }, onOpenHolding) {
  const quantity = decimal.parse(snapshot.payload.value);
  const price = vault.priceOn(holding.payload.unit, snapshot.payload.date);
  return el('tr', {}, [
    el('td', {}, [
      el('button', {
        class: 'link-button',
        text: holding.payload.name,
        onclick: () => onOpenHolding(holding.recordId),
      }),
    ]),
    el('td', {
      class: 'numeric',
      text: `${decimal.toDisplay(quantity, 2)} ${holding.payload.unit}`,
    }),
    el('td', {
      class: 'numeric',
      text: price
        ? `${decimal.toDisplay(decimal.multiply(quantity, price.rate), 2)} ${vault.mainCurrency}`
        : 'not priced',
    }),
  ]);
}

function priceRow(vault, entry) {
  return el('tr', {}, [
    el('td', { text: entry.payload.symbol }),
    el('td', { class: 'numeric', text: entry.payload.rate }),
    el('td', {}, [el('span', { class: 'chip', text: provenanceChip(entry.payload) })]),
  ]);
}

/** One confirmation, naming the two things that make this
 *  destructive: the prices go too, so every holding measured in those
 *  units moves on that date and not only the ones that had a figure,
 *  and there is no way back. */
function confirmDelete(vault, date, error, onDeleted) {
  const { figures, prices } = vault.recording(date);
  const units = [...new Set(prices.map((entry) => entry.payload.symbol))];
  const affected = [...vault.holdings.values()].filter((h) =>
    units.includes(h.payload.unit),
  ).length;

  const body = [
    el('p', {
      text: figures.length
        ? 'Every figure recorded that day goes, and so does every price captured with it.'
        : 'It holds no figures, and the prices captured that day go with it.',
    }),
  ];
  if (units.length) {
    body.push(
      el('p', {
        text: `${affected} holdings measured in ${units.join(' and ')} move on that date, including ones you recorded nothing for.`,
      }),
    );
  }
  body.push(el('p', { text: 'This cannot be undone.' }));

  const close = dialog({
    heading: `Delete the recording for ${shortDate(date)}?`,
    body,
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-destructive',
        text: 'Delete the recording',
        onclick: async () => {
          close();
          const remaining = await writes.deleteRecording(vault, date);
          if (remaining.length) {
            error.textContent = `Part of the recording is still there. Nothing was rolled back; ${remaining.length} records remain and read normally.`;
            error.hidden = false;
            return;
          }
          onDeleted();
        },
      }),
    ],
  });
}
