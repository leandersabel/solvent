// The holding form and the archive or delete decision for a holding
// that already has history (spec/ui/account-form.md).
//
// Names, notes, labels and unit text are decrypted or server-supplied
// strings and reach the page through `textContent` only.
import * as api from './api.js';
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { dialog, el, resumable, today } from './dom.js';
import { newId } from './view-dimensions.js';

let symbolTable = null;

/** The operator's symbol table, fetched once per page. A failure is
 *  not kept, so a retry asks again. */
async function symbols() {
  if (!symbolTable) symbolTable = await api.get('/api/rates/symbols');
  return symbolTable;
}

/** The unit picker's groups, ordinary answers first: the vault's main
 *  currency, then the other currencies, then the metals, because nearly
 *  every holding is a bank account or a depot in a currency. Currencies
 *  and metals sit in one list, grouped by kind. */
function groupsOf(table, mainCurrency) {
  const main = table.filter((s) => s.symbol === mainCurrency);
  const currencies = table.filter((s) => s.kind === 'currency' && s.symbol !== mainCurrency);
  const metals = table.filter((s) => s.kind === 'metal');
  return [
    { label: 'Currencies', rows: [...main, ...currencies] },
    { label: 'Metals', rows: metals },
  ];
}

const optionText = (row) =>
  row.lookup ? `${row.label} (${row.symbol})` : `${row.label} (${row.symbol}), rate entered by hand`;

/** Measured in: one searchable list over the symbol table, with
 *  "Something else…" at its foot opening a free-text field
 *  (design-system.md, Combobox, searchable). The typed search narrows
 *  the list and never becomes the unit on its own.
 *
 *  `locked` is a holding with at least one recorded value: the control
 *  stays on screen, readable and disabled. */
function unitPicker(vault, current, locked) {
  let value = current || null;
  let table = null;
  let other = false;

  const search = el('input', {
    type: 'text',
    id: 'holding-unit',
    role: 'combobox',
    'aria-controls': 'holding-unit-list',
    'aria-autocomplete': 'list',
    'aria-expanded': 'true',
    placeholder: 'Search the list',
    disabled: locked,
  });
  const list = el('ul', { id: 'holding-unit-list', role: 'listbox', class: 'unit-list', 'aria-label': 'Units' }, [
    el('li', { class: 'skeleton', 'aria-hidden': 'true' }),
    el('li', { class: 'skeleton', 'aria-hidden': 'true' }),
    el('li', { class: 'skeleton', 'aria-hidden': 'true' }),
  ]);
  // The choice itself, as a field, so a lock keeps it the way it keeps
  // anything else the person chose.
  const chosen = el('input', { type: 'hidden', class: 'unit-chosen', value: value || '' });
  const freeText = el('input', { type: 'text', id: 'holding-unit-other', hidden: true, placeholder: 'm²', 'aria-label': 'Unit' });
  const freeNote = el('p', { class: 'hint', hidden: true });
  const listed = el('p', { class: 'hint listed-offer', hidden: true });
  const commitment = el('p', { class: 'hint' });
  const notice = el('p', { class: 'field-error', hidden: true });
  const retry = el('button', { type: 'button', class: 'btn-inline', text: 'Try again', hidden: true });
  const error = el('p', { class: 'field-error', hidden: true });

  const rowFor = (symbol) => (table || []).find((row) => row.symbol === symbol);
  const matchIgnoringCase = (text) =>
    (table || []).find((row) => row.symbol.toLowerCase() === text.toLowerCase());
  const describe = (symbol) => {
    const row = rowFor(symbol);
    return row ? optionText(row) : symbol || '';
  };

  const setValue = (next, announce = true) => {
    value = next;
    chosen.value = next || '';
    if (announce) chosen.dispatchEvent(new Event('change', { bubbles: true }));
    draw();
  };

  const offerListed = () => {
    const typed = freeText.value.trim();
    const match = typed && matchIgnoringCase(typed);
    // Case is kept, because m² is not M². What is not kept is a unit
    // that is a listed symbol spelled another way: usd and USD would
    // look identical on every later screen and only one is ever priced.
    if (!match) {
      listed.hidden = true;
      return null;
    }
    listed.replaceChildren(
      `${match.symbol} is on the list as ${match.label}. `,
      el('button', {
        type: 'button',
        class: 'btn-inline',
        text: `Use ${match.symbol}`,
        onclick: () => {
          other = false;
          freeText.value = '';
          setValue(match.symbol);
        },
      }),
    );
    listed.hidden = false;
    return match;
  };

  const option = (text, onPick, selected, extra = {}) =>
    el('li', {
      role: 'option',
      tabindex: '-1',
      class: selected ? 'unit-option is-selected' : 'unit-option',
      'aria-selected': selected ? 'true' : 'false',
      text,
      onclick: onPick,
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const options = [...list.querySelectorAll('[role=option]')];
          const at = options.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1);
          if (at < 0) search.focus();
          else if (options[at]) options[at].focus();
        }
      },
      ...extra,
    });

  function draw() {
    if (locked) {
      search.value = describe(value);
      list.hidden = true;
      commitment.textContent =
        'The unit cannot change once you have recorded a value here. Your figures are counted in this unit, and the prices that value them belong to it. Archive this holding and create a new one instead.';
      return;
    }
    if (!table) return;
    const needle = search.value.trim().toLowerCase();
    const shows = (row) =>
      !needle || row.symbol.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle);
    const children = [];
    // A unit the table does not offer, a retired symbol or free text,
    // stays the current choice with its stored text. Nobody choosing
    // afresh is offered it.
    if (current && !rowFor(current) && (!needle || current.toLowerCase().includes(needle))) {
      children.push(
        el('li', { role: 'group', 'aria-label': 'Now', class: 'unit-group' }, [
          el('span', { class: 'unit-group-label', 'aria-hidden': 'true', text: 'Now' }),
          el('ul', { role: 'presentation' }, [
            option(current, () => {
              other = false;
              setValue(current);
            }, !other && value === current, { dataset: { symbol: current } }),
          ]),
        ]),
      );
    }
    for (const group of groupsOf(table, vault.mainCurrency)) {
      const rows = group.rows.filter(shows);
      if (!rows.length) continue;
      children.push(
        el('li', { role: 'group', 'aria-label': group.label, class: 'unit-group' }, [
          el('span', { class: 'unit-group-label', 'aria-hidden': 'true', text: group.label }),
          el(
            'ul',
            { role: 'presentation' },
            rows.map((row) =>
              option(optionText(row), () => {
                other = false;
                setValue(row.symbol);
              }, !other && value === row.symbol, { dataset: { symbol: row.symbol } }),
            ),
          ),
        ]),
      );
    }
    children.push(
      option('Something else…', () => {
        other = true;
        // What was being searched for is the likeliest answer, and it
        // is only ever committed from this field.
        if (search.value.trim() && !freeText.value) freeText.value = search.value.trim();
        setValue(freeText.value.trim() || null);
        freeText.focus();
      }, other, { class: other ? 'unit-option unit-other is-selected' : 'unit-option unit-other' }),
    );
    list.replaceChildren(...children);
    list.hidden = false;
    freeText.hidden = !other;
    freeNote.hidden = !other;
    freeNote.textContent =
      'You enter the price yourself each time you record a value. Not listed? This list is set up for the whole instance by an administrator, not per vault.';
    if (other) offerListed();
    else listed.hidden = true;
    commitment.textContent =
      'You can change this until you record a value for this holding. After that it is fixed, and the only way to a different unit is to archive this holding and start a new one.';
    const shown = value && !other ? describe(value) : '';
    search.setAttribute('aria-label', shown ? `Measured in, now ${shown}` : 'Measured in');
  }

  const load = async () => {
    retry.hidden = true;
    notice.hidden = true;
    try {
      table = await symbols();
    } catch {
      // Degraded to free text, with the cost named: a typed "dollars"
      // is a free-text unit rather than the USD run of prices.
      table = null;
      list.hidden = true;
      other = true;
      freeText.hidden = false;
      if (!freeText.value) freeText.value = value || '';
      notice.textContent =
        'The unit list could not be loaded. Try again, or type a unit. A typed unit such as "dollars" is not the USD run of prices, and the unit is fixed once you record a value.';
      notice.hidden = false;
      retry.hidden = false;
      return;
    }
    // Something typed while the list was away stays typed.
    other = Boolean(value) && !rowFor(value) && value !== current;
    if (other) freeText.value = value;
    draw();
  };
  retry.addEventListener('click', () => {
    setValue(freeText.value.trim() || null, false);
    load();
  });

  search.addEventListener('input', draw);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const first = list.querySelector('[role=option]');
      if (first) first.focus();
    }
  });
  freeText.addEventListener('input', () => {
    setValue(freeText.value.trim() || null);
  });
  // A kept choice written back after a lock.
  chosen.addEventListener('change', (event) => {
    if (event.isTrusted === false && chosen.value !== (value || '')) {
      value = chosen.value || null;
      other = Boolean(value) && Boolean(table) && !rowFor(value) && value !== current;
      if (other) freeText.value = value;
      draw();
    }
  });

  if (locked) draw();
  else load();

  return {
    element: el('div', { class: 'field unit-field' }, [
      el('label', { for: 'holding-unit', text: 'Measured in' }),
      error,
      search,
      list,
      chosen,
      freeText,
      freeNote,
      listed,
      notice,
      retry,
      commitment,
    ]),
    /** The unit to save, or a reason there is none. */
    read() {
      error.hidden = true;
      // Locked by construction: whatever the controls hold, a holding
      // with a recorded value keeps its unit.
      if (locked) return { unit: current };
      const unit = other ? freeText.value.trim() : value;
      if (!unit) return { problem: 'Choose a unit, or type one under Something else.' };
      if (other && table && matchIgnoringCase(unit) && unit !== current) {
        offerListed();
        return { problem: `${matchIgnoringCase(unit).symbol} is on the list. Use it from there.` };
      }
      return { unit };
    },
    refuse(text) {
      error.textContent = text;
      error.hidden = false;
    },
  };
}

/** The classification block: one single-select per configured
 *  dimension, a checkbox for a flag, and inline creation of a value or
 *  a dimension. `dims` starts as the holding's own map and keeps every
 *  entry no control shows, such as one naming an archived value, so a
 *  save never strips an assignment that restoring would bring back. */
function dimensionBlock(vault, dims) {
  const block = el('div', { class: 'dimension-block' });
  const error = el('p', { class: 'field-error', hidden: true });

  const said = (text) => {
    error.textContent = text;
    error.hidden = false;
  };

  /** Write the profile first. If that fails nothing else happens, and
   *  the form keeps every field. */
  const addToProfile = async (change) => {
    error.hidden = true;
    try {
      await writes.saveProfile(vault, { ...vault.profile, dimensions: change(vault.dimensions) });
      return true;
    } catch {
      return false;
    }
  };

  const newValue = (dimension, select) => {
    const label = el('input', { type: 'text', 'aria-label': `New ${dimension.label} value` });
    const row = el('div', { class: 'inline-create' }, [
      label,
      el('button', {
        type: 'button',
        class: 'btn-inline',
        text: 'Add',
        onclick: async () => {
          const text = label.value.trim();
          if (!text) {
            said('A value needs a name.');
            return;
          }
          const id = newId();
          const ok = await addToProfile((all) =>
            all.map((d) =>
              d.id === dimension.id ? { ...d, values: [...d.values, { id, label: text, archivedAt: null }] } : d,
            ),
          );
          if (!ok) {
            said(`The value ${text} was not created. Nothing else changed.`);
            return;
          }
          dims[dimension.id] = id;
          draw();
        },
      }),
      el('button', {
        type: 'button',
        class: 'btn-inline',
        text: 'Cancel',
        onclick: () => {
          row.remove();
          select.value = dims[dimension.id] && isLive(dimension, dims[dimension.id]) ? dims[dimension.id] : '';
        },
      }),
    ]);
    return row;
  };

  const isLive = (dimension, valueId) =>
    dimension.values.some((v) => v.id === valueId && !v.archivedAt);

  const control = (dimension) => {
    const live = dimension.values.filter((v) => !v.archivedAt);
    if (live.length === 1) {
      // A flag: one value, one click. Unchecked means unassigned.
      const box = el('input', { type: 'checkbox', checked: dims[dimension.id] === live[0].id });
      box.addEventListener('change', () => {
        if (box.checked) dims[dimension.id] = live[0].id;
        else delete dims[dimension.id];
      });
      return el('label', { class: 'checkbox' }, [box, el('span', { text: dimension.label })]);
    }
    const select = el('select', { 'aria-label': dimension.label }, [
      el('option', { value: '', text: 'Unassigned' }),
      ...live.map((value) => el('option', { value: value.id, text: value.label })),
      el('option', { value: '__new__', text: '+ New value' }),
    ]);
    select.value = isLive(dimension, dims[dimension.id]) ? dims[dimension.id] : '';
    const field = el('div', { class: 'field' }, [el('label', { text: dimension.label }), select]);
    select.addEventListener('change', () => {
      if (select.value === '__new__') {
        if (!field.querySelector('.inline-create')) field.append(newValue(dimension, select));
        field.querySelector('.inline-create input').focus();
        return;
      }
      if (select.value) dims[dimension.id] = select.value;
      else delete dims[dimension.id];
    });
    return field;
  };

  const newDimension = () => {
    const label = el('input', { type: 'text', 'aria-label': 'Dimension name', placeholder: 'Liquidity' });
    const first = el('input', { type: 'text', 'aria-label': 'First value', placeholder: 'Cash' });
    const row = el('div', { class: 'inline-create' }, [
      label,
      first,
      el('button', {
        type: 'button',
        class: 'btn-inline',
        text: 'Add',
        onclick: async () => {
          if (!label.value.trim() || !first.value.trim()) {
            said('A dimension needs a name and a first value.');
            return;
          }
          const dimension = {
            id: newId(),
            label: label.value.trim(),
            archivedAt: null,
            values: [{ id: newId(), label: first.value.trim(), archivedAt: null }],
          };
          const ok = await addToProfile((all) => [...all, dimension]);
          if (!ok) {
            said(`The dimension ${dimension.label} was not created. Nothing else changed.`);
            return;
          }
          dims[dimension.id] = dimension.values[0].id;
          draw();
        },
      }),
      el('button', { type: 'button', class: 'btn-inline', text: 'Cancel', onclick: () => row.remove() }),
    ]);
    return row;
  };

  function draw() {
    const adder = el('button', {
      type: 'button',
      class: 'link-button',
      text: '+ New dimension',
      onclick: () => {
        if (!block.querySelector('.new-dimension .inline-create')) {
          holder.append(newDimension());
          holder.querySelector('input').focus();
        }
      },
    });
    const holder = el('div', { class: 'new-dimension' }, [adder]);
    block.replaceChildren(...vault.activeDimensions().map(control), holder, error);
  }

  draw();
  return block;
}

/** Create a holding, or edit one. `onCancel` puts a Cancel beside Save
 *  where the form is not already inside a dialog that carries one. */
export function holdingForm(vault, existing, onSaved, { onCancel = null, onConflict = null, notice = null } = {}) {
  const payload = existing
    ? { ...existing.payload }
    : { name: '', unit: vault.mainCurrency, dims: {}, note: null, archivedAt: null, createdAt: new Date().toISOString() };
  const dims = { ...(payload.dims || {}) };
  const locked = Boolean(existing) && vault.snapshotsFor(existing.recordId).length > 0;

  const name = el('input', { type: 'text', id: 'holding-name', value: payload.name, required: true });
  const nameError = el('p', { class: 'field-error', hidden: true });
  const unit = unitPicker(vault, payload.unit, locked);
  const note = el('textarea', { rows: '3', text: payload.note || '' });
  const error = el('p', { class: 'field-error', hidden: true, role: 'alert' });

  const save = el('button', { type: 'submit', class: 'btn-primary', text: 'Save' });
  const form = el('form', { class: 'panel-form', novalidate: true }, [
    notice ? el('p', { class: 'field-error', role: 'alert', text: notice }) : null,
    el('div', { class: 'field' }, [
      el('label', { for: 'holding-name', text: 'Name' }),
      nameError,
      name,
    ]),
    unit.element,
    dimensionBlock(vault, dims),
    el('details', {}, [el('summary', { text: 'Add a note' }), note]),
    error,
    el('div', { class: 'form-actions' }, [
      onCancel ? el('button', { type: 'button', class: 'btn-secondary', text: 'Cancel', onclick: onCancel }) : null,
      save,
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    nameError.hidden = true;
    // Inline per field: a name is required, and a unit is required
    // whether picked or typed. Nothing else is.
    const chosen = unit.read();
    let refused = false;
    if (!name.value.trim()) {
      nameError.textContent = 'Give the holding a name.';
      nameError.hidden = false;
      refused = true;
    }
    if (chosen.problem) {
      unit.refuse(chosen.problem);
      refused = true;
    }
    if (refused) return;

    save.disabled = true;
    try {
      const saved = await writes.saveHolding(vault, existing ? vault.holdings.get(existing.recordId) || existing : null, {
        ...payload,
        name: name.value.trim(),
        unit: chosen.unit,
        dims: { ...dims },
        note: note.value.trim() || null,
      });
      onSaved(saved);
    } catch (failure) {
      save.disabled = false;
      if (failure.status === 409 && existing) {
        // Never a merge and never a silent clobber: the record another
        // tab wrote is read back, and the edit is redone against it.
        try {
          await writes.reloadRecord(vault, existing);
        } catch {
          /* the message below still holds */
        }
        if (onConflict) {
          onConflict('This holding was changed in another tab. It now shows what was saved there. Make your change again.');
          return;
        }
      }
      error.textContent =
        failure.status === 409
          ? 'This holding was changed in another tab. Make your change again.'
          : 'That did not save. Nothing was changed, and everything you typed is still here.';
      error.hidden = false;
    }
  });

  return form;
}

/** Deleting a holding is the user's choice between two real options,
 *  archive preselected. A holding with no snapshots skips the dialog
 *  and is deleted outright. `then` names where a dialog reopened after
 *  a lock goes when it is done, `onDone` being gone with the old
 *  screen by then. `said` is a line the dialog opens with. */
export function deleteHoldingDialog(vault, holding, onDone, then = 'reload', said = null) {
  const snapshots = vault.snapshotsFor(holding.recordId);
  if (!snapshots.length) {
    writes.purgeHolding(vault, holding).then(onDone, () => {
      deleteFailed(holding);
    });
    return;
  }

  const archiveDate = today();
  const atDate = snapshots.find((s) => s.payload.date === archiveDate);
  // The field shows the stored figure where the date already holds one,
  // and saving replaces that record in place. No replace prompt: the
  // figure the prompt would name is the one in the field.
  const closing = el('input', {
    type: 'text',
    inputmode: 'decimal',
    id: 'closing-value',
    value: vault.format.editable(atDate ? decimal.parse(atDate.payload.value) : decimal.ZERO),
  });
  let skipped = false;
  const skipNote = el('p', {
    class: 'hint',
    hidden: true,
    text: 'Without this, your chart drops by the last figure recorded here, with nothing recorded on that date to explain it.',
  });
  const skip = el('button', {
    type: 'button',
    class: 'link-button',
    text: 'Skip',
    onclick: () => {
      skipped = !skipped;
      closing.disabled = skipped;
      skipNote.hidden = !skipped;
      skip.textContent = skipped ? 'Record a closing value after all' : 'Skip';
    },
  });

  const typed = el('input', { type: 'text', id: 'delete-name', placeholder: holding.payload.name });
  const error = el('p', { class: 'field-error', hidden: true, role: 'alert' });
  const opening = el('p', { class: 'field-error', hidden: !said, role: 'status', text: said || '' });

  const choice = (value, label, checked) =>
    el('label', { class: 'checkbox' }, [
      el('input', { type: 'radio', name: 'holding-delete-choice', value, checked }),
      el('span', { text: label }),
    ]);
  const choices = el('div', { class: 'choice-group', role: 'radiogroup', 'aria-label': 'What to do' }, [
    choice('archive', 'Archive', true),
    choice('delete', 'Delete permanently', false),
  ]);

  const archiveSection = el('div', { class: 'choice-section' }, [
    el('p', {
      text: 'Archive keeps every value you recorded. Your past net worth stays accurate. You can undo this.',
    }),
    el('p', { class: 'hint', text: `Archive date: ${vault.format.longDate(archiveDate)}` }),
    el('div', { class: 'field' }, [
      el('label', { for: 'closing-value', text: 'What was it worth when you closed it?' }),
      closing,
      skip,
      skipNote,
    ]),
  ]);
  const deleteSection = el('div', { class: 'choice-section', hidden: true }, [
    el('p', {
      text: `This also deletes ${snapshots.length} recorded values. Your past net worth figures will change.`,
    }),
    el('div', { class: 'field' }, [
      el('label', { for: 'delete-name', text: 'Type the holding’s name to delete it permanently' }),
      typed,
    ]),
  ]);

  const permanently = el('button', {
    class: 'btn-destructive',
    text: 'Delete permanently',
    disabled: true,
    hidden: true,
    onclick: async () => {
      error.hidden = true;
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
      let quantity = null;
      if (!skipped) {
        quantity = vault.format.parseFigure(closing.value);
        if (quantity === null) {
          error.textContent = 'Enter the closing value as a number, or skip it.';
          error.hidden = false;
          return;
        }
      }
      archive.disabled = true;
      // The order is load-bearing: the closing value, then that date's
      // prices over the holdings as they stand with this one still
      // among them, and the archive flag last. The refresh covers
      // active holdings only, so setting the flag first would archive
      // a position at a price nobody captured.
      let unpriced = [];
      if (quantity !== null) {
        try {
          await writes.saveSnapshot(vault, holding.recordId, atDate || null, {
            date: archiveDate,
            value: decimal.format(quantity),
            note: atDate ? atDate.payload.note : null,
          });
        } catch {
          error.textContent =
            'The closing value did not save, so nothing was archived and the holding is untouched. The figure is still in the field.';
          error.hidden = false;
          archive.disabled = false;
          return;
        }
        const proposals = await writes.fetchProposals(vault, archiveDate);
        unpriced = (await writes.refreshPrices(vault, archiveDate, proposals)).failed;
      }
      try {
        const current = vault.holdings.get(holding.recordId);
        await writes.saveHolding(vault, current, { ...current.payload, archivedAt: archiveDate });
      } catch {
        close();
        // Both halves, and the archive offered again, prefilled now
        // with the figure stored at that date.
        deleteHoldingDialog(
          vault,
          vault.holdings.get(holding.recordId),
          onDone,
          then,
          quantity === null
            ? 'The holding was not archived and is still active.'
            : `The closing value is recorded for ${vault.format.longDate(archiveDate)}, but the holding was not archived and is still active. Archive it again to finish.`,
        );
        return;
      }
      if (unpriced.length) {
        // The figure is recorded and the archive went through. Nothing
        // is rolled back, and the units left without a price are named.
        done(`Archived. The prices for ${unpriced.join(', ')} were not written for ${vault.format.longDate(archiveDate)}. Add them on that date's recording.`);
        return;
      }
      close();
      onDone();
    },
  });

  const done = (text) => {
    panel.replaceChildren(el('p', { role: 'status', text }));
    archive.parentElement.replaceChildren(
      el('button', {
        class: 'btn-primary',
        text: 'Close',
        onclick: () => {
          close();
          onDone();
        },
      }),
    );
  };

  choices.addEventListener('change', () => {
    const deleting = choices.querySelector('input:checked').value === 'delete';
    archiveSection.hidden = deleting;
    deleteSection.hidden = !deleting;
    archive.hidden = deleting;
    permanently.hidden = !deleting;
    error.hidden = true;
  });

  const panel = el('div', { class: 'choice-body' }, [opening, choices, archiveSection, deleteSection, error]);
  const close = dialog({
    heading: `Archive or delete ${holding.payload.name}?`,
    resume: resumable(reopenDeleteHolding, holding.recordId, then),
    body: [panel],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      permanently,
      archive,
    ],
  });
}

function deleteFailed(holding) {
  const close = dialog({
    heading: `${holding.payload.name} was not deleted`,
    body: [el('p', { text: 'Nothing was deleted. Try again.' })],
    actions: [el('button', { class: 'btn-primary', text: 'Close', onclick: () => close() })],
  });
}

function reopenDeleteHolding(context, holdingId, then) {
  const holding = context.vault.holdings.get(holdingId);
  if (holding) deleteHoldingDialog(context.vault, holding, context[then], then);
}
