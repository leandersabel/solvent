// The sweep: one date, every holding you could record against, on one
// screen (spec/ui/update-values.md).
//
// Nothing counts what was left alone. A partial update is the ordinary
// case, so the screen scores nothing, marks no row outstanding, and
// never comes back to the rows that were skipped. Each row states its
// own age in plain language instead.
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { ageInWords, dialog, el } from './dom.js';

export function sweepView(vault, date) {
  const banner = el('p', { class: 'banner', hidden: true, role: 'status' });
  const rows = [];
  const rateLines = [];

  const holdings = vault.activeHoldings();
  const table = el('div', { class: 'sweep-rows' });

  for (const holding of holdings) {
    const row = sweepRow(vault, holding, date, () => ensurePricesOnce(vault, date, rateLines, banner));
    rows.push(row);
    table.append(row.element);
  }

  // The save for the rate lines appears once one of them has changed,
  // and one confirmation covers every changed line.
  const saveAll = el('button', {
    class: 'btn-primary',
    text: 'Save the rate lines',
    hidden: true,
    onclick: () => saveRates(vault, date, rateLines, banner, showSave),
  });
  const showSave = () => {
    saveAll.hidden = !rateLines.some((line) => line.changed());
  };
  const rateBlock = el('div', { class: 'rate-block' });
  buildRateLines(vault, date, rateLines, rateBlock, showSave);

  return el('section', { class: 'screen sweep' }, [
    el('header', { class: 'sweep-head' }, [
      el('p', { class: 'eyebrow', text: 'Recording' }),
      el('h1', { class: 'screen-heading', text: vault.format.fullDate(date) }),
    ]),
    banner,
    holdings.length
      ? table
      : el('p', { class: 'empty-line', text: 'Add a holding first.' }),
    holdings.length
      ? el('section', { class: 'rate-section' }, [
          el('h2', { class: 'section-heading', text: 'Rates for this date' }),
          rateBlock,
          saveAll,
        ])
      : null,
  ]);
}

function sweepRow(vault, holding, date, ensurePrices) {
  const stored = vault
    .snapshotsFor(holding.recordId)
    .find((s) => s.payload.date === date);
  const history = vault.usableSnapshots(holding.recordId);
  // On a reopened recording, the figure a holding carried into that
  // date is its last figure before then, not the newest in its
  // history.
  const carried = [...history].reverse().find((s) => s.payload.date < date) || null;
  const reference = stored || carried;
  const { format } = vault;
  // The field shows a figure grouped, the way the reader reads one, and
  // takes it back typed with or without the marks.
  const same = (figure) => {
    const typed = format.parseFigure(field.value);
    return typed !== null && typed === decimal.parse(figure);
  };

  const field = el('input', {
    type: 'text',
    inputmode: 'decimal',
    class: stored ? 'quantity recorded' : 'quantity carried',
    value: reference ? format.editable(decimal.parse(reference.payload.value)) : '',
  });
  const unit = vault.unitOf(holding.payload.unit);
  const suffix = el('span', { class: 'unit-suffix', text: unit.currency ? unit.symbol : unit.short });
  const converted = el('p', { class: 'hint' });
  const status = el('span', { class: 'row-state' });
  const age = el('span', { class: 'row-age' });
  const message = el('p', { class: 'field-error', hidden: true });

  const control = el('button', { class: 'btn-secondary' });

  const describe = () => {
    const current = vault
      .snapshotsFor(holding.recordId)
      .find((s) => s.payload.date === date);
    if (current) {
      status.textContent = 'Recorded for this date.';
      control.textContent = 'Save';
      control.disabled = same(current.payload.value);
    } else {
      status.textContent = 'Nothing recorded for this date.';
      const untouched = reference && same(reference.payload.value);
      control.textContent = untouched && reference ? 'Confirm' : 'Record';
      control.disabled = !history.length && !field.value.trim();
    }
    // The two row states differ in wording and in ink weight, never in
    // color alone. A changed figure puts the brass on the row's control.
    status.classList.toggle('is-recorded', Boolean(current));
    const changed = current ? !control.disabled : control.textContent === 'Record' && !control.disabled;
    control.className = changed ? 'btn-primary' : 'btn-secondary';
    age.textContent = !reference
      ? 'Never valued.'
      : current
        ? `${capitalized(ageInWords(reference.payload.date))}.`
        : `Last figure ${vault.format.longDate(reference.payload.date)}, ${ageInWords(reference.payload.date)}.`;
    // A holding in the main currency converts to itself, so the line
    // under its field stays empty.
    converted.textContent = holding.payload.unit === vault.mainCurrency
      ? ''
      : describeConverted(vault, holding, date, field.value);
  };

  field.addEventListener('input', describe);
  // Leaving the field groups what was typed, once it reads as a figure.
  field.addEventListener('blur', () => {
    const typed = format.parseFigure(field.value);
    if (typed !== null) field.value = format.editable(typed);
  });

  control.addEventListener('click', async () => {
    message.hidden = true;
    const current = vault
      .snapshotsFor(holding.recordId)
      .find((s) => s.payload.date === date);
    const text = field.value.trim();

    // Only a field backed by a record at this date can be cleared.
    // What the screen chose to prefill never decides whether a record
    // dies; the stored record does.
    if (!text) {
      if (!current) {
        describe();
        return;
      }
      try {
        await writes.deleteRecord(vault, current);
        describe();
      } catch {
        showError(message, 'That did not save.');
      }
      return;
    }

    const quantity = format.parseFigure(text);
    if (quantity === null) {
      showError(message, 'Enter a number, with at most twelve decimal places.');
      return;
    }
    control.disabled = true;
    try {
      // The quantity goes first and the prices after, on their own
      // requests, so a price write can never fail a quantity write.
      await writes.saveSnapshot(vault, holding.recordId, current || null, {
        date,
        value: decimal.format(quantity),
        note: current ? current.payload.note : null,
      });
      await ensurePrices();
      describe();
    } catch (failure) {
      showError(
        message,
        failure.status === 409
          ? 'This figure was changed in another window.'
          : 'That did not save. Your figure is still here.',
      );
    } finally {
      control.disabled = false;
    }
  });

  describe();

  return {
    element: el('div', { class: 'sweep-row' }, [
      el('div', { class: 'sweep-name' }, [
        el('span', { class: 'holding-name', text: holding.payload.name }),
        el('p', { class: 'row-status' }, [status, ' ', age]),
      ]),
      el('div', { class: 'sweep-input' }, [
        el('div', { class: 'quantity-field' }, [field, suffix]),
        converted,
        message,
      ]),
      control,
    ]),
  };
}

function describeConverted(vault, holding, date, text) {
  const quantity = vault.format.parseFigure(text);
  if (quantity === null) return '';
  const price = vault.priceOn(holding.payload.unit, date);
  if (!price) return 'not priced';
  return vault.mainMoney(decimal.multiply(quantity, price.rate));
}

function capitalized(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function showError(node, text) {
  node.textContent = text;
  node.hidden = false;
}

let refreshedDates = new Set();

/** The rates go in with the first row recorded, once for the whole
 *  sitting rather than once per row, so a fifteen-row sweep writes one
 *  set of prices and asks the proxy once. */
async function ensurePricesOnce(vault, date, rateLines, banner) {
  if (refreshedDates.has(date)) return;
  refreshedDates.add(date);
  const proposals = await writes.fetchProposals(vault, date);
  const { failed } = await writes.refreshPrices(vault, date, proposals);
  if (failed.length) {
    banner.textContent = `Recorded. Prices were not updated for ${failed.join(', ')}.`;
    banner.hidden = false;
  }
  for (const line of rateLines) line.refresh();
}

export function resetSweepState() {
  refreshedDates = new Set();
}

/** One line per unit anything in the vault is measured in. No
 *  holding's row ever carries a rate: one price belongs to a unit and
 *  is shared by every holding measured in it. The main currency has no
 *  line, because there is nothing to convert. */
function buildRateLines(vault, date, rateLines, container, onChange) {
  const unitsInVault = new Set(
    [...vault.holdings.values()].map((h) => h.payload.unit),
  );
  unitsInVault.delete(vault.mainCurrency);

  if (!unitsInVault.size) {
    container.append(
      el('p', { class: 'hint', text: 'Everything here is counted in your main currency, so there is nothing to convert.' }),
    );
    return;
  }

  for (const unit of [...unitsInVault].sort()) {
    const line = rateLine(vault, unit, date, onChange);
    rateLines.push(line);
    container.append(line.element);
  }
}

function rateLine(vault, unit, date, onChange) {
  const { format } = vault;
  const described = vault.unitOf(unit);
  const field = el('input', {
    type: 'text',
    inputmode: 'decimal',
    class: 'quantity',
    'aria-label': `${described.name} rate`,
  });
  field.addEventListener('input', onChange);
  field.addEventListener('blur', () => {
    const typed = format.parseFigure(field.value);
    if (typed !== null) field.value = format.editable(typed, 6);
  });
  const provenance = el('span', { class: 'chip' });
  const explanation = el('p', { class: 'hint' });
  const lookup = el('button', {
    class: 'btn-inline',
    text: 'Look it up',
    hidden: true,
    onclick: async () => {
      // Opening a recording fetches nothing. Pressing this is what
      // issues the request (ui/update-values.md, Rate lines on a
      // reopened recording).
      const proposals = await writes.fetchProposals(vault, date);
      const proposal = proposals[unit];
      if (!proposal) {
        explanation.textContent = `No market rate came back for ${unit}.`;
        return;
      }
      field.value = format.editable(decimal.parse(proposal.rate), 6);
      line.proposal = proposal;
      provenance.textContent =
        proposal.asOf === date ? 'Market rate' : `Market rate as of ${format.dayMonth(proposal.asOf, 'short')}`;
      onChange();
    },
  });

  const line = { unit, stored: null, proposal: null };

  line.refresh = () => {
    const stored = vault.entriesFor(unit).find((e) => e.payload.date === date);
    line.stored = stored || null;
    if (stored) {
      field.value = format.editable(decimal.parse(stored.payload.rate), 6);
      provenance.textContent = provenanceChip(stored.payload, vault.format);
      lookup.hidden = true;
      const previous = vault.entriesFor(unit).filter((e) => e.payload.date < date);
      explanation.textContent = '';
      void previous;
      return;
    }
    field.value = '';
    provenance.textContent = '';
    lookup.hidden = false;
    const previous = [...vault.entriesFor(unit)].reverse().find((e) => e.payload.date < date);
    if (previous && previous.payload.rateSource === 'manual') {
      explanation.textContent = `No market price for ${unit} yet. This one is yours to set. Last estimated ${ageInWords(previous.payload.date)}.`;
    } else if (previous) {
      explanation.textContent = `No market rate came back for ${unit}. Nothing will be recorded for it today, and the total carries on at the most recent rate it has.`;
    } else {
      explanation.textContent = `No price recorded for ${unit} at this date. Holdings measured in it are listed as not priced until one exists.`;
    }
  };
  line.value = () => field.value.trim();
  /** The line's figure, or null for an empty field or one that does
   *  not read as a number. */
  line.figure = () => format.parseFigure(field.value);
  line.changed = () => {
    if (!line.value()) return Boolean(line.stored);
    return !line.stored || line.figure() !== decimal.parse(line.stored.payload.rate);
  };
  line.refresh();

  // Headed by the unit's name from the symbol table, with what one of
  // it is worth beneath.
  line.element = el('div', { class: 'rate-line', 'data-unit': unit }, [
    el('div', { class: 'rate-name' }, [
      el('span', { class: 'rate-unit', text: described.name }),
      el('p', { class: 'row-status', text: `${described.one} in ${vault.mainCurrency}` }),
    ]),
    el('div', { class: 'quantity-field' }, [
      field,
      el('span', { class: 'unit-suffix', text: vault.mainCurrency }),
    ]),
    el('div', { class: 'rate-meta' }, [provenance, lookup]),
    explanation,
  ]);
  return line;
}

export function provenanceChip(payload, format) {
  if (payload.rateSource === 'manual') return 'Typed by you';
  if (payload.rateSource === 'edited') return `Edited from ${payload.proposedRate}`;
  return payload.rateAsOf && payload.rateAsOf !== payload.date
    ? `Market rate as of ${format.dayMonth(payload.rateAsOf, 'short')}`
    : 'Market rate';
}

/** A rate line on a reopened recording saves by itself: filling in the
 *  price that was missing is a complete act and needs no holding
 *  touched alongside it. Changing one says what it moves, once per
 *  save rather than a dialog per line. */
async function saveRates(vault, date, rateLines, banner, onSaved) {
  const changes = [];
  for (const line of rateLines) {
    if (!line.changed()) continue;
    const stored = line.stored;
    if (!line.value()) {
      changes.push({ line, unit: line.unit, clearing: true, stored });
      continue;
    }
    const parsed = line.figure();
    if (parsed === null) continue;
    changes.push({ line, unit: line.unit, rate: decimal.format(parsed), stored, proposal: line.proposal });
  }
  if (!changes.length) return;

  const counts = changes.map((change) => {
    const holdings = [...vault.holdings.values()].filter(
      (h) => h.payload.unit === change.unit,
    ).length;
    return { ...change, holdings };
  });

  const close = dialog({
    heading: 'Changing a price moves the holdings measured in it',
    body: counts.map((change) =>
      el('p', {
        text: change.clearing
          ? `Clearing the ${change.unit} price for ${vault.format.longDate(date)} leaves that date with no price for it. ${change.holdings} holdings measured in ${change.unit} move on that date.`
          : `Changing the ${change.unit} rate for ${vault.format.longDate(date)} moves ${change.holdings} holdings measured in ${change.unit} on that date. Your net worth on that day changes with them.`,
      }),
    ),
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-primary',
        text: 'Save the prices',
        onclick: async () => {
          close();
          const failed = [];
          for (const change of counts) {
            try {
              if (change.clearing) {
                await writes.deleteRecord(vault, change.stored);
              } else if (change.stored) {
                await writes.saveRate(
                  vault,
                  change.stored,
                  writes.editedRatePayload(change.stored.payload, change.rate),
                );
              } else {
                await writes.saveRate(vault, null, {
                  symbol: change.unit,
                  date,
                  rate: change.rate,
                  rateTarget: vault.mainCurrency,
                  rateSource: change.proposal ? 'edited' : 'manual',
                  rateAsOf: change.proposal ? change.proposal.asOf : null,
                  proposedRate: change.proposal ? change.proposal.rate : null,
                });
              }
            } catch {
              failed.push(change.unit);
            }
          }
          for (const line of rateLines) line.refresh();
          onSaved();
          banner.textContent = failed.length
            ? `Saved, except for ${failed.join(', ')}, which did not land.`
            : 'Prices saved.';
          banner.hidden = false;
        },
      }),
    ],
  });
}
