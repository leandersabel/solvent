// The sweep: one date, every holding you could record against, on one
// screen (spec/ui/update-values.md).
//
// Nothing counts what was left alone. A partial update is the ordinary
// case, so the screen scores nothing, marks no row outstanding, and
// never comes back to the rows that were skipped. Each row states its
// own age in plain language instead.
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { ageInWords, dialog, el, shortDate } from './dom.js';

export function sweepView(vault, date, { onDone }) {
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

  const rateBlock = el('div', { class: 'rate-block' });
  buildRateLines(vault, date, rateLines, rateBlock);

  const saveAll = el('button', {
    class: 'btn-primary',
    text: 'Save the rate lines',
    hidden: !vault.recording(date).prices.length && !rateLines.some((line) => line.stored),
    onclick: () => saveRates(vault, date, rateLines, banner),
  });

  return el('section', { class: 'screen' }, [
    el('h1', { class: 'screen-heading', text: shortDate(date) }),
    banner,
    holdings.length
      ? table
      : el('p', { class: 'empty-line', text: 'Add a holding first.' }),
    holdings.length
      ? el('section', { class: 'card' }, [
          el('h2', { class: 'section-heading', text: 'Prices for this date' }),
          rateBlock,
          saveAll,
        ])
      : null,
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn-secondary', text: 'Done', onclick: onDone }),
    ]),
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

  const field = el('input', {
    type: 'text',
    inputmode: 'decimal',
    class: stored ? 'quantity recorded' : 'quantity carried',
    value: reference ? reference.payload.value : '',
  });
  const suffix = el('span', { class: 'unit-suffix', text: holding.payload.unit });
  const converted = el('p', { class: 'hint' });
  const status = el('p', { class: 'row-state' });
  const message = el('p', { class: 'field-error', hidden: true });

  const control = el('button', { class: 'btn-secondary' });

  const describe = () => {
    const current = vault
      .snapshotsFor(holding.recordId)
      .find((s) => s.payload.date === date);
    if (current) {
      status.textContent = 'Recorded for this date.';
      control.textContent = 'Save';
      control.disabled = field.value === current.payload.value;
    } else {
      status.textContent = 'Nothing recorded for this date.';
      const untouched = reference && field.value === reference.payload.value;
      control.textContent = untouched && reference ? 'Confirm' : 'Record';
      control.disabled = !history.length && !field.value.trim();
    }
    const age = reference
      ? `${ageInWords(reference.payload.date)}${current ? '' : `, from ${shortDate(reference.payload.date)}`}`
      : 'never valued';
    converted.textContent = describeConverted(vault, holding, date, field.value) + ' · ' + age;
  };

  field.addEventListener('input', describe);

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

    const quantity = decimal.parse(text);
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
        status,
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
  const quantity = decimal.parse(text);
  if (quantity === null) return '';
  const price = vault.priceOn(holding.payload.unit, date);
  if (!price) return 'not priced';
  return `${decimal.toDisplay(decimal.multiply(quantity, price.rate), 2)} ${vault.mainCurrency}`;
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
function buildRateLines(vault, date, rateLines, container) {
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
    const line = rateLine(vault, unit, date);
    rateLines.push(line);
    container.append(line.element);
  }
}

function rateLine(vault, unit, date) {
  const field = el('input', { type: 'text', inputmode: 'decimal', class: 'quantity' });
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
      field.value = proposal.rate;
      line.proposal = proposal;
      provenance.textContent =
        proposal.asOf === date ? 'Market rate' : `Market rate as of ${shortDate(proposal.asOf)}`;
    },
  });

  const line = { unit, stored: null, proposal: null };

  line.refresh = () => {
    const stored = vault.entriesFor(unit).find((e) => e.payload.date === date);
    line.stored = stored || null;
    if (stored) {
      field.value = stored.payload.rate;
      provenance.textContent = provenanceChip(stored.payload);
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
  line.refresh();

  line.element = el('div', { class: 'rate-line' }, [
    el('span', { class: 'rate-unit', text: unit }),
    field,
    provenance,
    lookup,
    explanation,
  ]);
  return line;
}

export function provenanceChip(payload) {
  if (payload.rateSource === 'manual') return 'Typed by you';
  if (payload.rateSource === 'edited') return `Edited from ${payload.proposedRate}`;
  return payload.rateAsOf && payload.rateAsOf !== payload.date
    ? `Market rate as of ${shortDate(payload.rateAsOf)}`
    : 'Market rate';
}

/** A rate line on a reopened recording saves by itself: filling in the
 *  price that was missing is a complete act and needs no holding
 *  touched alongside it. Changing one says what it moves, once per
 *  save rather than a dialog per line. */
async function saveRates(vault, date, rateLines, banner) {
  const changes = [];
  for (const line of rateLines) {
    const typed = line.value();
    const stored = line.stored;
    if (!typed && !stored) continue;
    if (stored && typed === stored.payload.rate) continue;
    if (!typed && stored) {
      changes.push({ line, unit: line.unit, clearing: true, stored });
      continue;
    }
    const parsed = decimal.parse(typed);
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
          ? `Clearing the ${change.unit} price for ${shortDate(date)} leaves that date with no price for it. ${change.holdings} holdings measured in ${change.unit} move on that date.`
          : `Changing the ${change.unit} rate for ${shortDate(date)} moves ${change.holdings} holdings measured in ${change.unit} on that date. Your net worth on that day changes with them.`,
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
          banner.textContent = failed.length
            ? `Saved, except for ${failed.join(', ')}, which did not land.`
            : 'Prices saved.';
          banner.hidden = false;
        },
      }),
    ],
  });
}
