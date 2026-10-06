// Everything about one holding: what it is, what it is worth, and its
// own list of values (spec/features/manage-accounts.md, Account detail).
//
// No request is issued by opening this screen, and no price is ever
// looked up from it, at any age. Every figure comes from the model.
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { ageInWords, dialog, el, icon, priceDateLine, trackEdits } from './dom.js';
import { snapshotDialog } from './view-forms.js';
import { archiveHoldingDialog, deleteHoldingDialog, holdingForm } from './view-holding-form.js';

// A Conflict on saving the editor reloads the record and redraws the
// screen, and the reopened editor says why it is showing other values.
let conflictNotice = null;

export function holdingView(vault, accountId, { editing = false, onOpenRecording, onChanged, onGone }) {
  const holding = vault.holdings.get(accountId);
  if (!holding) return el('p', { class: 'empty-line', text: 'That holding is gone.' });

  const value = vault.valueOf(holding, 'latest');
  const error = el('p', { class: 'field-error', hidden: true });
  const panel = el('div', {});

  // The open editor is part of the address, so a lock taken mid-edit
  // comes back to it rather than to the bare holding. Written without
  // a hashchange, because nothing needs to redraw.
  const address = `#/holding/${accountId}`;
  const closeEditor = () => {
    window.history.replaceState(null, '', address);
    onChanged();
  };
  const openEditor = () => {
    window.history.replaceState(null, '', `${address}/edit`);
    const notice = conflictNotice;
    conflictNotice = null;
    panel.replaceChildren(
      holdingForm(vault, holding, closeEditor, {
        onCancel: closeEditor,
        notice,
        onConflict: (text) => {
          conflictNotice = text;
          onChanged();
        },
      }),
    );
  };

  const header = el('header', { class: 'detail-header' }, [
    el('h1', { class: 'screen-heading', text: holding.payload.name }),
    el('div', { class: 'chips' }, chipsFor(vault, holding)),
    holding.payload.note ? el('p', { class: 'note', text: holding.payload.note }) : null,
    el('p', { class: 'hero-line' }, [
      el('span', {
        class: 'hero-figure',
        text:
          value.state === 'unvalued'
            ? 'Not yet valued'
            : vault.amount(value.stored, holding.payload.unit),
      }),
      // A holding in the main currency converts to itself, so the
      // figure is not repeated.
      value.state === 'valued' && holding.payload.unit !== vault.mainCurrency
        ? el('span', {
            class: 'hero-converted',
            text: vault.mainMoney(value.converted),
          })
        : value.state === 'unpriced'
          ? el('span', { class: 'hero-converted', text: 'Not priced' })
          : null,
      value.asOf
        ? el('span', {
            class: 'hero-age',
            text: `as of ${vault.format.longDate(value.asOf)}, ${ageInWords(value.asOf)}`,
          })
        : null,
      value.state === 'valued' && value.priceDate
        ? el('span', { class: 'hero-age', text: `priced at ${vault.format.longDate(value.priceDate)}` })
        : null,
    ]),
  ]);

  const actions = el('div', { class: 'form-actions' }, [
    holding.payload.archivedAt
      ? null
      : el('button', {
          class: 'btn-primary',
          text: 'Record a value',
          onclick: () => snapshotDialog(vault, holding, null, onChanged, onOpenRecording),
        }),
    el('button', {
      class: 'btn-secondary',
      text: 'Edit',
      onclick: () => {
        openEditor();
        trackEdits(panel);
      },
    }),
    holding.payload.archivedAt
      ? el('button', {
          class: 'btn-secondary',
          text: 'Unarchive',
          onclick: async () => {
            error.hidden = true;
            try {
              await writes.saveHolding(vault, holding, {
                ...holding.payload,
                archivedAt: null,
              });
              onChanged();
            } catch {
              error.textContent = 'The holding is still archived. Nothing changed.';
              error.hidden = false;
            }
          },
        })
      : el('button', {
          class: 'btn-secondary',
          text: 'Archive',
          onclick: () => archiveHoldingDialog(vault, holding, onChanged, 'reload', null, onOpenRecording),
        }),
    el('button', {
      class: 'btn-destructive',
      text: 'Delete',
      onclick: () => deleteHoldingDialog(vault, holding, onGone, 'home', null, onOpenRecording),
    }),
  ]);

  const flagged = vault.duplicateSnapshotDates(accountId);
  const history = vault.snapshotsFor(accountId).slice().reverse();

  if (editing) openEditor();

  return el('section', { class: 'screen' }, [
    header,
    error,
    actions,
    panel,
    el('section', { class: 'card' }, [
      el('h2', { class: 'section-heading', text: 'Values' }),
      history.length
        ? el('table', { class: 'data-table values-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Date' }),
                el('th', { class: 'numeric', text: 'Value' }),
                el('th', { class: 'numeric', text: `In ${vault.mainCurrency}` }),
                el('th', { text: '' }),
              ]),
            ]),
            el(
              'tbody',
              {},
              history.flatMap((snapshot) =>
                historyRow(vault, holding, snapshot, flagged, {
                  onOpenRecording,
                  onChanged,
                }),
              ),
            ),
          ])
        : el('p', {
            class: 'empty-line',
            text: 'No snapshots yet. Record what this holding is worth.',
          }),
    ]),
  ]);
}

function chipsFor(vault, holding) {
  const chips = vault.activeDimensions().map((dimension) => {
    const band = vault.bandOf(holding, dimension);
    if (band.id === 'unassigned') return null;
    return el('span', { class: 'chip', text: `${dimension.label}: ${band.label}` });
  });
  if (holding.payload.archivedAt) {
    chips.push(
      el('span', {
        class: 'chip chip-archived',
        text: `Archived ${vault.format.longDate(holding.payload.archivedAt)}`,
      }),
    );
  }
  return chips.filter(Boolean);
}

/** A row, and beneath it the entry's note when it has one: shown in
 *  full when its icon expands the row, never truncated into the table.
 *  A failed delete is reported on the row it was asked of. */
function historyRow(vault, holding, snapshot, flagged, { onOpenRecording, onChanged }) {
  const quantity = decimal.parse(snapshot.payload.value);
  const price = vault.priceAtDate(holding.payload.unit, snapshot.payload.date);
  const duplicate = flagged.has(snapshot.payload.date);
  const failed = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  const noteRow = snapshot.payload.note
    ? el('tr', { class: 'note-row', hidden: true }, [
        el('td', { colspan: '4' }, [el('p', { class: 'note', text: snapshot.payload.note })]),
      ])
    : null;
  const noteToggle = noteRow
    ? el('button', {
        type: 'button',
        class: 'btn-icon note-toggle',
        'aria-expanded': 'false',
        'aria-label': 'Show the note',
        title: 'Show the note',
        onclick: () => {
          noteRow.hidden = !noteRow.hidden;
          noteToggle.setAttribute('aria-expanded', String(!noteRow.hidden));
          noteToggle.setAttribute('aria-label', noteRow.hidden ? 'Show the note' : 'Hide the note');
        },
      }, [icon('note', 14)])
    : null;

  const row = el('tr', { class: duplicate ? 'flagged' : null }, [
    el('td', {}, [
      el('button', {
        class: 'link-button',
        text: vault.format.longDate(snapshot.payload.date),
        onclick: () => onOpenRecording(snapshot.payload.date),
      }),
      noteToggle,
      duplicate
        ? el('span', {
            class: 'flag-note',
            text: 'Two entries share this date. Keep one.',
          })
        : null,
    ]),
    el('td', { class: 'numeric', text: vault.amount(snapshot.payload.value, holding.payload.unit) }),
    el('td', { class: 'numeric' }, price
      ? [vault.format.money(decimal.multiply(quantity, price.rate)), priceDateLine(vault, price.date, snapshot.payload.date)]
      : 'not priced'),
    el('td', {}, vault.isArchiveZero(holding, snapshot) ? [] : [
      duplicate
        ? el('button', {
            class: 'btn-inline',
            text: 'Keep this one',
            onclick: async () => {
              const others = vault
                .snapshotsFor(holding.recordId)
                .filter(
                  (s) =>
                    s.payload.date === snapshot.payload.date &&
                    s.recordId !== snapshot.recordId,
                );
              for (const other of others) await writes.deleteRecord(vault, other);
              onChanged();
            },
          })
        : null,
      el('button', {
        class: 'btn-inline',
        text: 'Edit',
        onclick: () => snapshotDialog(vault, holding, snapshot, onChanged, onOpenRecording),
      }),
      el('button', {
        class: 'btn-inline',
        text: 'Delete',
        onclick: () => confirmDeleteSnapshot(vault, holding, snapshot, failed, onChanged),
      }),
      failed,
    ]),
  ]);
  return noteRow ? [row, noteRow] : [row];
}

/** Deleting a value deletes no price. A price belongs to a unit, not
 *  to the holding that happened to prompt it, so the copy does not
 *  mention prices: none of them move. */
function confirmDeleteSnapshot(vault, holding, snapshot, error, onChanged) {
  const only = vault.snapshotsFor(holding.recordId).length === 1;
  const close = dialog({
    heading: 'Delete this snapshot?',
    body: [
      el('p', {
        text: `Delete the snapshot of ${vault.amount(snapshot.payload.value, holding.payload.unit)} for ${vault.format.longDate(snapshot.payload.date)}?`,
      }),
      el('p', {
        text: only
          ? 'This is the only value recorded here, so the holding returns to not yet valued and leaves the current total. That is not the same as being worth zero.'
          : 'Your net worth for the period around this date will change.',
      }),
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-destructive',
        text: 'Delete',
        onclick: async () => {
          close();
          try {
            await writes.deleteRecord(vault, snapshot);
            onChanged();
          } catch {
            error.textContent = 'Nothing was deleted.';
            error.hidden = false;
          }
        },
      }),
    ],
  });
}
