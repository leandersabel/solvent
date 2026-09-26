// The axes holdings are classified along (spec/ui/dimensions.md).
//
// Every operation here writes at most one record, the profile.
// Nothing on this screen reads or writes an account record, so no
// operation can fail partway across several of them.
import * as writes from './writes.js';
import { dialog, el, inlineRename, resumable } from './dom.js';

const CONFLICT = 'Your settings were changed in another tab.';
const SAVE_FAILED = 'That did not save. Nothing changed.';

/** Opaque and immutable, never shown and never derived from a label,
 *  and checked against every id the profile in memory already holds. */
function newId(vault, minted = []) {
  const taken = new Set([
    ...minted,
    ...vault.dimensions.flatMap((d) => [d.id, ...d.values.map((v) => v.id)]),
  ]);
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = [...bytes].map((byte) => (byte % 36).toString(36)).join('');
    if (!taken.has(id)) return id;
  }
}

// Set when the screen is built and read by the write helpers below,
// which are reached from a dozen controls and would otherwise all
// have to carry it. One screen is on at a time, so there is one.
let reload = () => {};
let openUnassigned = () => {};
// A write in flight is drawn at once from this copy, with every
// control disabled until it answers. A failure puts the stored list
// back and says so on the card that made it.
let pending = null;
let failure = null;
let announcement = '';

export function dimensionsView(vault, { reload: onChanged, openUnassigned: onOpen }) {
  reload = onChanged;
  openUnassigned = onOpen;
  const dimensions = pending || vault.dimensions;
  const busy = pending !== null;
  const live = dimensions.filter((d) => !d.archivedAt);
  const archived = dimensions.filter((d) => d.archivedAt);
  const onCard = failure && live.some((d) => d.id === failure.id) ? failure : null;
  const onScreen = failure && !onCard ? failure : null;
  const said = announcement;
  if (!busy) {
    failure = null;
    announcement = '';
  }

  return [
    el('h1', { class: 'screen-heading', text: 'Dimensions' }),
    el('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', text: said }),
    onScreen ? errorLine(onScreen.text) : null,
    live.length
      ? el(
          'div',
          { class: 'dimension-list', 'aria-busy': busy ? 'true' : null },
          live.map((dimension, index) =>
            dimensionCard(vault, dimension, {
              index,
              count: live.length,
              busy,
              failed: onCard && onCard.id === dimension.id ? onCard.text : null,
            }),
          ),
        )
      : emptyState(vault, busy),
    // The empty state carries the one primary action on its own.
    live.length
      ? el('button', {
          class: 'btn-secondary',
          text: '+ Create a dimension',
          disabled: busy,
          onclick: () => createDimension(vault),
        })
      : null,
    archived.length
      ? el('details', { class: 'card archived-dimensions' }, [
          el('summary', { text: `Archived (${archived.length})` }),
          ...archived.map((dimension) =>
            el('p', { class: 'settings-row' }, [
              el('span', { text: dimension.label }),
              el('button', {
                class: 'btn-inline',
                text: 'Restore',
                disabled: busy,
                onclick: () =>
                  patch(vault, dimension.id, (d) => ({ ...d, archivedAt: null })),
              }),
            ]),
          ),
        ])
      : null,
  ];
}

function errorLine(text) {
  return el('p', { class: 'field-error', role: 'alert', text });
}

function emptyState(vault, busy) {
  return el('div', { class: 'card' }, [
    el('p', {
      text: 'Dimensions are how your net worth splits up. Give one a name, "Liquidity", and values like Cash, Investments, Retirement. Each holding gets one value, so the bands of your chart add up to exactly your net worth.',
    }),
    el('button', {
      class: 'btn-primary',
      text: 'Create a dimension',
      disabled: busy,
      onclick: () => createDimension(vault),
    }),
  ]);
}

function dimensionCard(vault, dimension, { index, count, busy, failed }) {
  const coverage = vault.coverage(dimension);
  const live = dimension.values.filter((v) => !v.archivedAt);
  const archived = dimension.values.filter((v) => v.archivedAt);
  const moveDimension = (to) =>
    reorder(vault, dimension.id, to, count, () =>
      placeAmongLive(vault.dimensions, (d) => !d.archivedAt, dimension.id, to),
    );

  const card = el('section', { class: 'card dimension-card', dataset: { dimension: dimension.id } }, [
    failed ? errorLine(failed) : null,
    el('div', { class: 'card-head' }, [
      dragHandle(dimension.label, busy),
      inlineLabel(vault, dimension.id, dimension.label, (label) =>
        saveDimensions(vault, vault.dimensions.map((d) => (d.id === dimension.id ? { ...d, label } : d))),
      ),
      el('button', {
        class: 'btn-inline',
        text: 'Move up',
        disabled: busy || index === 0,
        onclick: () => moveDimension(index - 1),
      }),
      el('button', {
        class: 'btn-inline',
        text: 'Move down',
        disabled: busy || index === count - 1,
        onclick: () => moveDimension(index + 1),
      }),
      overflowMenu(dimension.label, busy, [
        ['Archive dimension', () => archiveDimension(vault, dimension)],
      ]),
    ]),
    // A count with a link out to the holdings it leaves unassigned,
    // never their names listed here.
    el('p', { class: 'hint' }, [
      coverage.assigned < coverage.total
        ? el('button', {
            class: 'link-button',
            text: `${coverage.assigned} of ${coverage.total} holdings assigned`,
            onclick: () => openUnassigned(dimension.id),
          })
        : `${coverage.assigned} of ${coverage.total} holdings assigned`,
    ]),
    el(
      'ul',
      { class: 'plain-list value-list' },
      live.map((value, at) => {
        const moveValue = (to) =>
          reorder(vault, dimension.id, to, live.length, () =>
            vault.dimensions.map((d) =>
              d.id === dimension.id
                ? { ...d, values: placeAmongLive(d.values, (v) => !v.archivedAt, value.id, to) }
                : d,
            ),
          );
        const row = el('li', { class: 'value-row', dataset: { value: value.id } }, [
          dragHandle(value.label, busy),
          inlineLabel(vault, dimension.id, value.label, (label) =>
            saveDimensions(
              vault,
              vault.dimensions.map((d) =>
                d.id === dimension.id
                  ? { ...d, values: d.values.map((v) => (v.id === value.id ? { ...v, label } : v)) }
                  : d,
              ),
            ),
          ),
          el('button', {
            class: 'btn-inline',
            text: 'Move up',
            disabled: busy || at === 0,
            onclick: () => moveValue(at - 1),
          }),
          el('button', {
            class: 'btn-inline',
            text: 'Move down',
            disabled: busy || at === live.length - 1,
            onclick: () => moveValue(at + 1),
          }),
          el('button', {
            class: 'btn-inline',
            text: 'Archive',
            disabled: busy,
            onclick: () =>
              patchValue(vault, dimension.id, value.id, (v) => ({
                ...v,
                archivedAt: new Date().toISOString(),
              })),
          }),
        ]);
        dropTarget(row, 'value', moveValue);
        return row;
      }),
    ),
    live.length > 4
      ? el('p', {
          class: 'hint',
          text: 'The chart shows the first four values and folds the rest into "Other". All five are still tracked.',
        })
      : null,
    archived.length
      ? el('details', {}, [
          el('summary', { text: `Archived values (${archived.length})` }),
          ...archived.map((value) =>
            el('p', { class: 'settings-row' }, [
              el('span', { text: value.label }),
              el('button', {
                class: 'btn-inline',
                text: 'Restore',
                disabled: busy,
                onclick: () =>
                  patchValue(vault, dimension.id, value.id, (v) => ({
                    ...v,
                    archivedAt: null,
                  })),
              }),
            ]),
          ),
        ])
      : null,
    el('button', {
      class: 'btn-inline',
      text: '+ Add value',
      disabled: busy,
      onclick: () => addValue(vault, dimension),
    }),
  ]);
  dropTarget(card, 'dimension', moveDimension);
  return card;
}

/** The handle half of the reorder control (design-system.md,
 *  Components). It is never the only route: Move up and Move down sit
 *  beside it for touch and the keyboard, which is also why it is
 *  hidden from assistive technology. */
function dragHandle(label, busy) {
  const handle = el('span', {
    class: 'drag-handle',
    'aria-hidden': 'true',
    title: `Drag ${label}`,
    text: '≡',
  });
  handle.draggable = !busy;
  handle.addEventListener('dragstart', (event) => {
    const item = handle.closest('[data-value], [data-dimension]');
    const kind = item.dataset.value ? 'value' : 'dimension';
    event.dataTransfer.setData('text/plain', `${kind}:${item.dataset[kind]}`);
    event.dataTransfer.effectAllowed = 'move';
  });
  return handle;
}

/** A row that takes a drop of its own kind. The dragged row moves to
 *  this row's position through its own control, which is what its Move
 *  buttons would have done step by step. */
function dropTarget(node, kind, moveHere) {
  node.addEventListener('dragover', (event) => event.preventDefault());
  node.addEventListener('drop', (event) => {
    const [dragged, id] = (event.dataTransfer.getData('text/plain') || '').split(':');
    if (dragged !== kind) return;
    event.preventDefault();
    event.stopPropagation();
    const list = [...node.parentElement.children];
    const from = list.find((item) => item.dataset[kind] === id);
    const to = list.indexOf(node);
    if (from && from !== node) from.dispatchEvent(new CustomEvent('reorder-to', { detail: to }));
  });
  node.addEventListener('reorder-to', (event) => moveHere(event.detail));
}

/** The item with `id` moved to position `to` among the live items,
 *  with archived items keeping their places around them. Order is only
 *  visible among live items, so a move is counted there and never
 *  spent swapping with an archived one. */
function placeAmongLive(all, isLive, id, to) {
  const live = all.filter(isLive);
  const order = live.filter((item) => item.id !== id);
  order.splice(to, 0, live.find((item) => item.id === id));
  let next = 0;
  return all.map((item) => (isLive(item) ? order[next++] : item));
}

/** Actions that do not earn a place on the card head. */
function overflowMenu(label, busy, items) {
  const menu = el('div', { class: 'overflow-items', role: 'menu', hidden: true });
  const toggle = el('button', {
    class: 'btn-inline overflow-toggle',
    text: '…',
    'aria-label': `Actions for ${label}`,
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    disabled: busy,
  });
  const set = (open) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => set(menu.hidden));
  for (const [text, act] of items) {
    menu.append(
      el('button', {
        class: 'btn-inline',
        role: 'menuitem',
        text,
        onclick: () => {
          set(false);
          act();
        },
      }),
    );
  }
  return el('div', { class: 'overflow-menu' }, [toggle, menu]);
}

function inlineLabel(vault, cardId, text, save) {
  return inlineRename(
    text,
    async (label) => {
      try {
        await save(label);
      } catch (error) {
        if (error.status === 409) conflict(vault, cardId);
        throw error;
      }
    },
    (error) => (error.status === 409 ? CONFLICT : 'That rename did not save.'),
  );
}

/** A rename, whose own field stays open with what was typed on a
 *  failure. */
async function saveDimensions(vault, dimensions) {
  await writes.saveProfile(vault, { ...vault.profile, dimensions });
  reload();
}

/** Another tab wrote the profile first: read it again, say so on the
 *  card, and let the person redo the edit on what is stored now. */
async function conflict(vault, cardId) {
  await vault.reloadProfile().catch(() => {});
  failure = { id: cardId, text: CONFLICT };
  reload();
}

/** Every other write: drawn at once, controls disabled until it
 *  answers, and put back with a message on the card if it fails. */
async function writeProfile(vault, dimensions, cardId) {
  pending = dimensions;
  reload();
  try {
    await writes.saveProfile(vault, { ...vault.profile, dimensions });
    pending = null;
    reload();
  } catch (error) {
    pending = null;
    announcement = '';
    if (error.status === 409) {
      await conflict(vault, cardId);
      return;
    }
    failure = { id: cardId, text: SAVE_FAILED };
    reload();
  }
}

function patch(vault, dimensionId, change) {
  return writeProfile(
    vault,
    vault.dimensions.map((d) => (d.id === dimensionId ? change(d) : d)),
    dimensionId,
  );
}

function patchValue(vault, dimensionId, valueId, change) {
  return patch(vault, dimensionId, (d) => ({
    ...d,
    values: d.values.map((v) => (v.id === valueId ? change(v) : v)),
  }));
}

/** One write on the drop or the key press, announced so the result is
 *  available without sight. */
function reorder(vault, cardId, to, count, build) {
  announcement = `Moved to position ${to + 1} of ${count}.`;
  return writeProfile(vault, build(), cardId);
}

function createDimension(vault) {
  const label = el('input', { type: 'text' });
  const first = el('input', { type: 'text' });
  const create = (valueLabel) => {
    close();
    const id = newId(vault);
    const value = { id: newId(vault, [id]), label: valueLabel, archivedAt: null };
    writeProfile(vault, [...vault.dimensions, { id, label: label.value.trim(), archivedAt: null, values: [value] }], id);
  };
  const close = dialog({
    heading: 'Create a dimension',
    resume: resumable(reopenCreateDimension),
    body: [
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), label]),
      el('div', { class: 'field' }, [el('label', { text: 'First value' }), first]),
      el('p', {
        class: 'hint',
        text: 'A dimension with one value is a flag, which the holding form renders as a checkbox.',
      }),
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      // A flag is a dimension whose one value carries its own name:
      // one field and one button, as fast as typing a tag once was.
      el('button', {
        class: 'btn-secondary',
        text: 'Create a flag',
        onclick: () => {
          if (label.value.trim()) create(label.value.trim());
        },
      }),
      el('button', {
        class: 'btn-primary',
        text: 'Create',
        onclick: () => {
          if (label.value.trim() && first.value.trim()) create(first.value.trim());
        },
      }),
    ],
  });
}

function addValue(vault, dimension) {
  const label = el('input', { type: 'text' });
  const close = dialog({
    heading: `Add a value to ${dimension.label}`,
    resume: resumable(reopenAddValue, dimension.id),
    body: [el('div', { class: 'field' }, [el('label', { text: 'Label' }), label])],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-primary',
        text: 'Add',
        onclick: () => {
          if (!label.value.trim()) return;
          close();
          patch(vault, dimension.id, (d) => ({
            ...d,
            values: [...d.values, { id: newId(vault), label: label.value.trim(), archivedAt: null }],
          }));
        },
      }),
    ],
  });
}

function reopenCreateDimension({ vault }) {
  createDimension(vault);
}

function reopenAddValue({ vault }, dimensionId) {
  const dimension = vault.dimensions.find((d) => d.id === dimensionId);
  if (dimension) addValue(vault, dimension);
}

function archiveDimension(vault, dimension) {
  const close = dialog({
    heading: `Archive ${dimension.label}?`,
    body: [
      el('p', {
        text: 'Archiving keeps your holdings’ assignments. Restore it and every holding returns to the band it was in.',
      }),
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-primary',
        text: 'Archive',
        onclick: () => {
          close();
          patch(vault, dimension.id, (d) => ({
            ...d,
            archivedAt: new Date().toISOString(),
          }));
        },
      }),
    ],
  });
}
