// The axes holdings are classified along (spec/ui/dimensions.md).
//
// Every operation here writes at most one record, the profile.
// Nothing on this screen reads or writes an account record, so no
// operation can fail partway across several of them.
import * as writes from './writes.js';
import { dialog, el, mount, revealChrome } from './dom.js';
import { currentVault, isUnlocked, onLock, signOut } from './session.js';
import { unlockCard } from './unlock.js';

const container = document.getElementById('app');
const username = container.dataset.username;

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => (byte % 36).toString(36)).join('');
}

function render() {
  if (!isUnlocked()) {
    mount(
      container,
      unlockCard({
        knownUsername: username,
        onUnlocked: (result) => {
          if (result.kind === 'administrator') {
            window.location.href = '/admin';
            return;
          }
          // These two screens hold no sweep of their own, so the
          // top bar's Update values goes to the dashboard's.
          revealChrome('vault_owner', {
            onUpdate: () => (window.location.href = '/dashboard'),
            onLock: () => window.location.reload(),
            onSignOut: () => signOut().finally(() => (window.location.href = '/login')),
          });
          render();
        },
      }),
    );
    return;
  }
  const vault = currentVault();
  const live = vault.dimensions.filter((d) => !d.archivedAt);
  const archived = vault.dimensions.filter((d) => d.archivedAt);

  mount(container, [
    el('h1', { class: 'screen-heading', text: 'Dimensions' }),
    live.length
      ? el('div', {}, live.map((dimension) => dimensionCard(vault, dimension)))
      : emptyState(vault),
    el('button', {
      class: 'btn-secondary',
      text: '+ Create a dimension',
      onclick: () => createDimension(vault),
    }),
    archived.length
      ? el('details', { class: 'card' }, [
          el('summary', { text: 'Archived' }),
          ...archived.map((dimension) =>
            el('p', { class: 'settings-row' }, [
              el('span', { text: dimension.label }),
              el('button', {
                class: 'btn-inline',
                text: 'Restore',
                onclick: () => patch(vault, dimension.id, (d) => ({ ...d, archivedAt: null })),
              }),
            ]),
          ),
        ])
      : null,
  ]);
}

function emptyState(vault) {
  return el('div', { class: 'card' }, [
    el('p', {
      text: 'Dimensions are how your net worth splits up. Give one a name, "Liquidity", and values like Cash, Investments, Retirement. Each holding gets one value, so the bands of your chart add up to exactly your net worth.',
    }),
    el('button', {
      class: 'btn-primary',
      text: 'Create a dimension',
      onclick: () => createDimension(vault),
    }),
  ]);
}

function dimensionCard(vault, dimension) {
  const coverage = vault.coverage(dimension);
  const live = dimension.values.filter((v) => !v.archivedAt);
  const archived = dimension.values.filter((v) => v.archivedAt);

  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      inlineLabel(dimension.label, (label) =>
        patch(vault, dimension.id, (d) => ({ ...d, label })),
      ),
      el('button', {
        class: 'btn-inline',
        text: 'Archive dimension',
        onclick: () => archiveDimension(vault, dimension),
      }),
    ]),
    el('p', {
      class: 'hint',
      text: `${coverage.assigned} of ${coverage.total} holdings assigned`,
    }),
    el(
      'ul',
      { class: 'plain-list' },
      live.map((value, index) =>
        el('li', { class: 'value-row' }, [
          inlineLabel(value.label, (label) =>
            patchValue(vault, dimension.id, value.id, (v) => ({ ...v, label })),
          ),
          el('button', {
            class: 'btn-inline',
            text: 'Move up',
            disabled: index === 0,
            onclick: () => move(vault, dimension.id, value.id, -1),
          }),
          el('button', {
            class: 'btn-inline',
            text: 'Move down',
            disabled: index === live.length - 1,
            onclick: () => move(vault, dimension.id, value.id, 1),
          }),
          el('button', {
            class: 'btn-inline',
            text: 'Archive',
            onclick: () =>
              patchValue(vault, dimension.id, value.id, (v) => ({
                ...v,
                archivedAt: new Date().toISOString(),
              })),
          }),
        ]),
      ),
    ),
    live.length > 4
      ? el('p', {
          class: 'hint',
          text: 'The chart shows the first four values and folds the rest into "Other". All five are still tracked.',
        })
      : null,
    archived.length
      ? el('details', {}, [
          el('summary', { text: 'Archived values' }),
          ...archived.map((value) =>
            el('p', { class: 'settings-row' }, [
              el('span', { text: value.label }),
              el('button', {
                class: 'btn-inline',
                text: 'Restore',
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
      onclick: () => addValue(vault, dimension),
    }),
  ]);
}

function inlineLabel(text, onCommit) {
  const input = el('input', { type: 'text', value: text, class: 'inline-input' });
  const commit = () => {
    if (!input.value.trim()) {
      input.value = text;
      return;
    }
    if (input.value !== text) onCommit(input.value.trim());
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      input.value = text;
      input.blur();
    }
  });
  return input;
}

async function writeProfile(vault, dimensions) {
  await writes.saveProfile(vault, { ...vault.profile, dimensions });
  render();
}

function patch(vault, dimensionId, change) {
  return writeProfile(
    vault,
    vault.dimensions.map((d) => (d.id === dimensionId ? change(d) : d)),
  );
}

function patchValue(vault, dimensionId, valueId, change) {
  return patch(vault, dimensionId, (d) => ({
    ...d,
    values: d.values.map((v) => (v.id === valueId ? change(v) : v)),
  }));
}

function move(vault, dimensionId, valueId, direction) {
  return patch(vault, dimensionId, (d) => {
    const values = [...d.values];
    const at = values.findIndex((v) => v.id === valueId);
    const to = at + direction;
    if (to < 0 || to >= values.length) return d;
    [values[at], values[to]] = [values[to], values[at]];
    return { ...d, values };
  });
}

function createDimension(vault) {
  const label = el('input', { type: 'text' });
  const first = el('input', { type: 'text' });
  const close = dialog({
    heading: 'Create a dimension',
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
      el('button', {
        class: 'btn-primary',
        text: 'Create',
        onclick: () => {
          if (!label.value.trim() || !first.value.trim()) return;
          close();
          writeProfile(vault, [
            ...vault.dimensions,
            {
              id: newId(),
              label: label.value.trim(),
              archivedAt: null,
              values: [{ id: newId(), label: first.value.trim(), archivedAt: null }],
            },
          ]);
        },
      }),
    ],
  });
}

function addValue(vault, dimension) {
  const label = el('input', { type: 'text' });
  const close = dialog({
    heading: `Add a value to ${dimension.label}`,
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
            values: [...d.values, { id: newId(), label: label.value.trim(), archivedAt: null }],
          }));
        },
      }),
    ],
  });
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

onLock(render);
render();
