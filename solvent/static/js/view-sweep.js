// The sweep: one date, every holding you could record against, on one
// screen (spec/features/record-snapshot.md, Update values).
//
// Nothing counts what was left alone. A partial update is the ordinary
// case, so the screen scores nothing, marks no row outstanding, and
// never comes back to the rows that were skipped. Each row states its
// own age in plain language instead.
import * as decimal from './decimal.js';
import * as writes from './writes.js';
import { ageInWords, counted, dialog, el, icon, mount, priceDateLine } from './dom.js';
import { dayNumber } from './model.js';

// One sitting per date, kept across redraws of the sweep on screen and
// dropped whenever a sweep is arrived at from another screen (app.js).
let sittings = new Map();
// The sweep on screen, so leaving it can name what it held unsaved.
let current = null;

export function resetSweepState() {
  sittings = new Map();
}

function sittingFor(vault, date) {
  if (!sittings.has(date)) sittings.set(date, writes.sitting(vault, date));
  return sittings.get(date);
}

/** What the sweep on screen holds that was typed and not saved, by
 *  holding name and by unit. Empty once it has left the page. */
export function unsavedOnSweep() {
  if (!current || !current.element.isConnected) return { date: null, names: [] };
  return { date: current.date, names: current.unsaved() };
}

export function sweepView(vault, date, actions = {}) {
  const sit = sittingFor(vault, date);
  const banner = el('div', { class: 'banner', hidden: true, role: 'status' });
  const say = (text, { critical = false, children = [] } = {}) => {
    banner.className = critical ? 'banner banner-critical' : 'banner';
    mount(banner, [el('span', { text }), ...children]);
    banner.hidden = false;
  };
  // Refused whole: the screen shows the recording as it now stands, and
  // what was typed into the refused attempt is gone.
  const refused = () => {
    for (const row of rows) row.reset();
    block.refresh();
    syncSave();
    say(`${vault.format.longDate(date)} already has a recording. Another window got there first.`, {
      critical: true,
      children: [
        el('button', {
          class: 'btn-secondary',
          text: 'Open the recording',
          onclick: () => actions.openRecording && actions.openRecording(date),
        }),
      ],
    });
  };

  // Another window deleted the recording before a rate-lines save: the
  // screen shows the empty date, and what was typed stays for the first
  // row recorded to carry.
  const callout = el('p', { class: 'callout callout-critical', role: 'status', hidden: true });
  const emptied = (restore) => {
    restore();
    sit.dateWasEmpty = true;
    syncSave();
    mount(callout, [
      icon('alert'),
      ` Another window deleted the recording for ${vault.format.dayMonth(date)}. Your prices were not saved. They are still here and are saved with the first holding you record for this date.`,
    ]);
    callout.hidden = false;
  };
  const keepTyped = () => {
    const restores = [...rows.map((row) => row.keep()), ...block.lines.map((line) => line.keep())];
    return () => {
      restores.forEach((restore) => restore());
      for (const row of rows) row.describe();
    };
  };

  // An archived holding has a row only where the recording already
  // holds a figure for it: it takes no new one.
  const holdings = [...vault.holdings.values()].filter(
    (h) => !h.payload.archivedAt || vault.snapshotsFor(h.recordId).some((s) => s.payload.date === date),
  );
  if (!holdings.length) {
    return el('section', { class: 'screen sweep' }, [
      heading(vault, date),
      el('div', { class: 'card card-centered' }, [
        el('p', { class: 'empty-line', text: 'Add a holding first.' }),
        el('button', {
          class: 'btn-primary',
          text: 'Add a holding',
          onclick: () => actions.addHolding && actions.addHolding(),
        }),
      ]),
    ]);
  }

  const saveAll = el('button', { class: 'btn-primary', text: 'Save the rate lines', hidden: true });
  // Offered only while the date holds a recording, because a price
  // alone must never make one: a price typed before then waits for the
  // first row recorded.
  const syncSave = () => {
    saveAll.hidden = !vault.holdsRecording(date) || !block.lines.some((line) => line.changed());
  };
  const block = rateBlock(vault, date, {
    sit,
    onChange: () => {
      syncSave();
      for (const row of rows) row.describe();
    },
    lookUp: (pressed) => lookUp(pressed),
  });
  // One lookup fills every empty line it answers for and saves them at
  // once, with no confirmation: a missing price filled in changes none
  // (record-rate.md, Saving at a date that holds a recording). An answer
  // arriving after the screen was left writes nothing.
  const lookUp = async (pressed) => {
    const proposals = await writes.fetchProposals(vault, date);
    if (!element.isConnected) return false;
    const filling = block.lines.filter((line) => line.fillable() && proposals[line.unit]);
    for (const line of filling) line.lookedUpAs(proposals[line.unit]);
    if (!filling.length) return false;
    const restore = keepTyped();
    const result = await writes.fillRates(vault, date, Object.fromEntries(filling.map((line) => [line.unit, line.part()])));
    if (result.emptied) {
      emptied(restore);
    } else {
      for (const line of filling) if (!result.failed.includes(line.unit)) line.reset();
      syncSave();
      for (const row of rows) row.describe();
      const notes = [
        ...result.taken.map((unit) => `The ${vault.unitName(unit)} rate was filled in another window, and the line shows what is stored now.`),
        ...result.failed.map((unit) => `The ${vault.unitName(unit)} rate did not save. Save the rate lines to try again.`),
      ];
      if (notes.length) say(notes.join(' '), { critical: result.failed.length > 0 });
    }
    return Boolean(proposals[pressed.unit]);
  };
  saveAll.addEventListener('click', () => saveRates(vault, sit, block, { say, refused, syncSave, emptied, keepTyped }));

  // A date holding nothing arrives with its rate lines filled in by the
  // proposals for it. A reopened recording asks the source nothing on
  // arrival: the figures there may be ones the person chose.
  if (sit.dateWasEmpty && !sit.proposals && writes.needsLookup(vault, date)) {
    sit.proposals = writes.fetchProposals(vault, date);
  }
  if (sit.proposals) {
    block.waiting();
    sit.proposals.then((proposals) => block.showProposals(proposals));
  }

  const ensurePrices = async () => {
    if (sit.refreshed) return;
    sit.refreshed = true;
    const missing = vault.missingUnits(date);
    if (!missing.length) return;
    const unanswered = missing.some((unit) => vault.quotable(unit, date) && !block.lineFor(unit)?.typed);
    if (!sit.proposals && unanswered) sit.proposals = writes.fetchProposals(vault, date);
    if (sit.proposals) block.showProposals(await sit.proposals);
    const { failed } = await writes.refreshPrices(vault, date, {}, (unit) => block.partFor(unit));
    // A line that did not save keeps what it shows, for the lines' own
    // save to retry.
    for (const line of block.lines) {
      if (failed.includes(line.unit)) line.unsaved = true;
      else line.reset();
    }
    syncSave();
    if (failed.length) {
      say(`Recorded. Prices were not updated for ${failed.map((unit) => vault.unitName(unit)).join(', ')}.`, { critical: true });
    }
  };

  const rows = holdings.map((holding) =>
    sweepRow(vault, holding, date, {
      sit,
      block,
      refused,
      closed: (refusal, row) => {
        // The holding takes no figure here any more, so its row goes, as
        // it would from a sweep drawn now.
        rows.splice(rows.indexOf(row), 1);
        row.element.remove();
        block.refresh();
        syncSave();
        say(closedCopy(row.holding, refusal, 'saved'), { critical: true });
      },
      ensurePrices,
      onSaved: syncSave,
      onTyped: () => block.ask(holding.payload.unit),
    }),
  );

  const element = el('section', { class: 'screen sweep' }, [
    heading(vault, date),
    callout,
    banner,
    el('div', { class: 'sweep-rows' }, rows.map((row) => row.element)),
    el('section', { class: 'rate-section' }, [
      el('h2', { class: 'section-heading', text: 'Rates for this date' }),
      block.element,
      saveAll,
    ]),
  ]);
  current = {
    date,
    element,
    unsaved: () => [
      ...rows.filter((row) => row.changed()).map((row) => row.name),
      ...block.lines.filter((line) => line.changed()).map((line) => `the ${vault.unitName(line.unit)} rate`),
    ],
  };
  return element;
}

function heading(vault, date) {
  return el('header', { class: 'sweep-head' }, [
    el('p', { class: 'eyebrow', text: 'Recording' }),
    el('h1', { class: 'screen-heading', text: vault.format.fullDate(date) }),
  ]);
}

function sweepRow(vault, holding, date, { sit, block, refused, closed, ensurePrices, onSaved, onTyped }) {
  const { format } = vault;
  const atDate = () => vault.snapshotsFor(holding.recordId).filter((s) => s.payload.date === date);
  // On a reopened recording, the figure a holding carried into that
  // date is its last figure before then, not the newest in its
  // history.
  const carriedInto = () =>
    [...vault.usableSnapshots(holding.recordId)].reverse().find((s) => s.payload.date < date) || null;
  // Untouched, or typed to the stored string itself: compared as
  // strings, so 12.50 over a stored "12.5" is an edit.
  const same = (stored) => format.readField(field.value, stored) === stored;

  const field = el('input', { type: 'text', inputmode: 'decimal', class: 'quantity' });
  const unit = vault.unitOf(holding.payload.unit);
  const suffix = el('span', { class: 'unit-suffix', text: unit.currency ? unit.symbol : unit.short });
  const converted = el('p', { class: 'hint numeric' });
  const status = el('span', { class: 'row-state' });
  const age = el('span', { class: 'row-age' });
  const message = el('p', { class: 'field-error', hidden: true });
  const savedNote = el('p', { class: 'row-saved', hidden: true, role: 'status' });
  const pair = el('div', { class: 'sweep-pair', hidden: true });
  const control = el('button', { class: 'btn-secondary' });
  const fieldColumn = el('div', { class: 'quantity-field' }, [field, suffix]);
  // The archive's zero shows as text: it is read-only until the
  // holding is unarchived.
  const zeroText = el('span', { class: 'archive-zero numeric', hidden: true });
  const input = el('div', { class: 'sweep-input' }, [
    fieldColumn,
    zeroText,
    converted,
    message,
    savedNote,
  ]);

  const row = { name: holding.payload.name, holding };

  /** Put the field back to what the vault holds for this row. */
  const reset = (row.reset = () => {
    const [stored] = atDate();
    const reference = stored || carriedInto();
    field.value = reference ? format.quantity(reference.payload.value) : '';
    field.className = stored ? 'quantity recorded' : 'quantity carried';
    row.describe();
  });

  /** What was typed here, put back after the vault's records were
   *  replaced under the screen. A figure that was not typed shows what
   *  the vault holds now. */
  row.keep = () => {
    const text = field.value;
    const typed = row.changed();
    return () => {
      reset();
      if (typed) field.value = text;
    };
  };

  row.describe = () => {
    const entries = atDate();
    // Two figures on one date: both shown, flagged, and neither picked.
    const flagged = entries.length > 1;
    pair.hidden = !flagged;
    input.hidden = flagged;
    control.hidden = flagged;
    if (flagged) {
      status.textContent = 'Two figures share this date.';
      age.textContent = 'Keep one.';
      pair.replaceChildren(
        ...entries.map((entry) =>
          el('p', { class: 'flag-note' }, [
            `${vault.amount(entry.payload.value, holding.payload.unit)} `,
            el('button', {
              class: 'btn-inline',
              text: 'Keep this one',
              onclick: async () => {
                try {
                  for (const other of entries) if (other !== entry) await writes.deleteRecord(vault, other);
                } catch {
                  showError(message, 'That did not save.');
                }
                reset();
              },
            }),
          ]),
        ),
      );
      return;
    }
    const [stored] = entries;
    const locked = Boolean(stored) && vault.isArchiveZero(holding, stored);
    fieldColumn.hidden = locked;
    zeroText.hidden = !locked;
    control.hidden = locked;
    if (locked) {
      zeroText.textContent = vault.amount(stored.payload.value, holding.payload.unit);
      status.textContent = 'Archived at zero on this date.';
      status.classList.add('is-recorded');
      age.textContent = '';
      converted.replaceChildren();
      return;
    }
    // An archived holding whose figure here is gone takes no new one.
    const gone = Boolean(holding.payload.archivedAt) && !stored;
    if (row.element) row.element.hidden = gone;
    const carried = carriedInto();
    const reference = stored || carried;
    if (stored) {
      status.textContent = 'Recorded for this date.';
      control.textContent = 'Save';
      control.disabled = same(stored.payload.value);
    } else {
      status.textContent = 'Nothing recorded for this date.';
      const untouched = carried && same(carried.payload.value);
      control.textContent = untouched ? 'Confirm' : 'Record';
      // Nothing to confirm where the holding was never valued: the
      // field is the only control until something is typed in it.
      control.disabled = gone || (!carried && !field.value.trim());
    }
    // The two row states differ in wording and in ink weight, never in
    // color alone. A changed figure puts the brass on the row's control.
    status.classList.toggle('is-recorded', Boolean(stored));
    control.className = row.changed() ? 'btn-primary' : 'btn-secondary';
    age.textContent = !reference
      ? 'Never valued.'
      : stored
        ? `${capitalized(ageInWords(reference.payload.date))}.`
        : `Last figure ${vault.format.longDate(reference.payload.date)}, ${ageInWords(reference.payload.date)}.`;
    // A holding in the main currency converts to itself, so the line
    // under its field stays empty.
    if (holding.payload.unit === vault.mainCurrency) converted.replaceChildren();
    else describeConverted(vault, converted, vault.format.parseFigure(field.value), block.figureFor(holding.payload.unit), date);
  };

  /** Typed and not saved: what leaving the screen would lose. */
  row.changed = () => {
    if (atDate().length > 1) return false;
    const [stored] = atDate();
    if (stored) return !same(stored.payload.value);
    const carried = carriedInto();
    return Boolean(field.value.trim()) && !(carried && same(carried.payload.value));
  };

  field.addEventListener('input', () => {
    savedNote.hidden = true;
    if (field.value.trim()) onTyped();
    row.describe();
  });
  // Leaving the field groups what was typed, once it reads as a figure.
  field.addEventListener('blur', () => {
    const typed = format.parseQuantity(field.value);
    if (typed !== null) field.value = format.quantity(typed);
  });

  const saved = () => {
    savedNote.textContent = 'Saved.';
    savedNote.hidden = false;
    reset();
    onSaved();
  };

  const failedWith = async (failure) => {
    if (failure.status === 409) {
      // Nothing is retried and nothing merged: the row shows what is
      // stored now, and the person redoes the edit against it.
      await writes.reloadType(vault, 'snapshot').catch(() => {});
      reset();
      onSaved();
      showError(message, 'This figure was changed in another window.');
      return;
    }
    showError(message, 'That did not save. Your figure is still here.');
  };

  control.addEventListener('click', async () => {
    message.hidden = true;
    savedNote.hidden = true;
    const [stored] = atDate();
    const text = field.value.trim();

    if (!text) {
      // Only a field backed by a record at this date can be cleared.
      // What the screen chose to prefill never decides whether a
      // record dies. The stored record does.
      if (!stored) return row.describe();
      control.disabled = true;
      try {
        await writes.deleteRecord(vault, stored);
        saved();
      } catch (failure) {
        await failedWith(failure);
      }
      return;
    }

    const carried = carriedInto();
    const reference = stored || carried;
    const value = format.readField(text, reference ? reference.payload.value : null);
    if (value === null) {
      showError(message, 'Enter a number, with at most twelve decimal places.');
      return;
    }
    control.disabled = true;
    try {
      if (stored) {
        // Changing a figure is not recording a quantity, so it ensures
        // no price and asks the proxy nothing.
        await writes.saveSnapshot(vault, holding.recordId, stored, {
          ...stored.payload,
          value,
        });
        saved();
        return;
      }
      // A create: the date is claimed for this sitting before the first
      // one, and the whole save is refused if another window got there
      // first.
      const refusal = await writes.claimDate(vault, sit, {
        snapshots: [holding.recordId],
        rates: sit.refreshed ? [] : vault.missingUnits(date),
      });
      if (refusal) {
        if (refusal.closed) closed(refusal, row);
        else refused();
        return;
      }
      // The quantity goes first and the prices after, on their own
      // requests, so a price write can never fail a quantity write.
      const claimed = carriedInto();
      if (claimed && value === claimed.payload.value) {
        await writes.confirmFigure(vault, holding, date);
      } else {
        await writes.saveSnapshot(vault, holding.recordId, null, {
          date,
          value,
          note: null,
        });
      }
      saved();
      await ensurePrices();
    } catch (failure) {
      await failedWith(failure);
    } finally {
      row.describe();
    }
  });

  reset();

  row.element = el('div', { class: 'sweep-row', 'data-holding': holding.recordId }, [
    el('div', { class: 'sweep-name' }, [
      el('span', { class: 'holding-name', text: holding.payload.name }),
      el('p', { class: 'row-status' }, [status, ' ', age]),
    ]),
    input,
    pair,
    control,
  ]);
  return row;
}

/** A holding archived or deleted in another window since this one read
 *  it: what was typed is not written (record-snapshot.md, Update values
 *  and Snapshot entry, States). */
export function closedCopy(holding, { closed }, act) {
  return `${holding.payload.name} was ${closed} in another window. Nothing was ${act}.`;
}

/** What a quantity converts to at `price` (`{ rate, date }`, or null for
 *  not priced), for the figure shown at `on`: the converted figure, and
 *  beneath it the date of a price older than `on`. */
export function describeConverted(vault, node, quantity, price, on) {
  if (quantity === null) node.replaceChildren();
  else if (price === null) node.replaceChildren('not priced');
  else node.replaceChildren(vault.mainMoney(decimal.multiply(quantity, price.rate)), priceDateLine(vault, price.date, on) ?? '');
}

function capitalized(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function showError(node, text) {
  node.textContent = text;
  node.hidden = false;
}

/** The units a date's rate block shows: every unit an active holding
 *  is measured in, and any unit already priced at that date. The main
 *  currency has no line, because there is nothing to convert. */
function blockUnits(vault, date, also) {
  const units = new Set(vault.unitsToRefresh(also));
  for (const entry of vault.recording(date).prices) units.add(entry.payload.symbol);
  units.delete(vault.mainCurrency);
  return [...units].sort();
}

/** One line per unit, for one date. No holding's row ever carries a
 *  rate: one price belongs to a unit and is shared by every holding
 *  measured in it.
 *
 *  `readOnly` shows the stored prices and nothing to type into, which
 *  is what the single-holding form shows for a date already priced.
 *  `fillMissing` shows a unit the date holds a price for read only and
 *  offers a proposal for each unit it is missing, as a date with no
 *  recording does, which is what the form shows when a figure it adds
 *  fills in the date's missing prices. `lookUp(line)` is what a line's
 *  Look it up runs, and resolves to whether an answer came back for it. */
export function rateBlock(
  vault,
  date,
  { sit = null, readOnly = false, fillMissing = false, also = null, onChange = () => {}, lookUp = async () => false } = {},
) {
  // The wrapper is the container the lines' breakpoint measures, because
  // a container query cannot style the container itself.
  const grid = el('div', { class: 'rate-block' });
  const element = el('div', { class: 'rate-lines' }, [grid]);
  const units = blockUnits(vault, date, also);
  if (!units.length) {
    grid.append(
      el('p', { class: 'hint', text: 'Everything here is counted in your main currency, so there is nothing to convert.' }),
    );
  }
  const lines = units.map((unit) => rateLine(vault, unit, date, { sit, readOnly, fillMissing, onChange, lookUp }));
  grid.append(...lines.map((line) => line.element));

  const lineFor = (unit) => lines.find((line) => line.unit === unit) || null;
  return {
    element,
    lines,
    lineFor,
    refresh: () => lines.forEach((line) => line.reset()),
    waiting: () => lines.forEach((line) => line.wait()),
    showProposals: (proposals) => lines.forEach((line) => line.propose(proposals[line.unit] || null)),
    /** What the refresh writes for a unit, from what its line shows. */
    partFor: (unit) => {
      const line = lineFor(unit);
      return line ? line.part() : null;
    },
    /** The price a row converts at, as `{ rate, date }`: what the line
     *  shows for this date, or else the unit's price at this date
     *  (record-rate.md, Reading). Null is not priced. */
    figureFor: (unit) => {
      const line = lineFor(unit);
      const shown = line ? line.figure() : null;
      if (shown === null) return vault.priceAtDate(unit, date);
      // A line still showing the estimate carried from an earlier entry
      // is that day's price.
      const carried = line.prefilled && shown === decimal.parse(line.carried.payload.rate);
      return { rate: shown, date: carried ? line.carried.payload.date : date };
    },
    /** A row in this unit is being recorded. A unit with no price at
     *  all asks for one, at the head of the block, and never blocks the
     *  row. */
    ask: (unit) => {
      const line = lineFor(unit);
      if (!line || !line.ask()) return;
      grid.prepend(line.element);
    },
  };
}

function rateLine(vault, unit, date, { sit, readOnly: blockReadOnly, fillMissing, onChange, lookUp }) {
  const { format } = vault;
  const readOnly = blockReadOnly || (fillMissing && vault.entriesFor(unit).some((e) => e.payload.date === date));
  const described = vault.unitOf(unit);
  const quotable = vault.quotable(unit, date);
  // Published, but not yet at this date: nothing failed and nobody is
  // asked, so the line reads as one only its owner can price.
  const publishedFrom = vault.publishedFrom(unit);
  const early = !quotable && Boolean(publishedFrom);
  const field = el('input', {
    type: 'text',
    inputmode: 'decimal',
    class: 'quantity',
    'aria-label': `${described.name} rate`,
  });
  const shown = el('span', { class: 'rate-figure' });
  const provenance = el('span', { class: 'chip' });
  const skeleton = el('span', { class: 'skeleton', hidden: true, 'aria-label': 'Looking up the rate' });
  const explanation = el('p', { class: 'hint' });
  const error = el('p', { class: 'field-error', hidden: true });
  const pair = el('div', { class: 'rate-pair', hidden: true });
  const lookup = el('button', { class: 'btn-inline', text: 'Look it up', hidden: true });
  const box = el('div', { class: 'quantity-field' }, [
    readOnly ? shown : field,
    el('span', { class: 'unit-suffix', text: vault.mainCurrency }),
  ]);

  const line = {
    unit,
    stored: null,
    rivals: [],
    proposal: null,
    carried: null,
    prefilled: false,
    typed: false,
    lookedUp: false,
    // Its write failed: what it shows waits for the lines' own save.
    unsaved: false,
    asked: false,
    pending: false,
  };
  // A line filled in on arrival reads as one on a date with no
  // recording: what did not come back is an outage, not a gap left
  // from an earlier sitting.
  const reopened = () => !fillMissing && (!sit || !sit.dateWasEmpty);
  const parsed = (text) => decimal.parse(text);

  line.value = () => field.value.trim();
  /** The figure the line shows, or null for an empty field or one that
   *  does not read as a number. */
  line.figure = () => (readOnly ? (line.stored ? parsed(line.stored.payload.rate) : null) : format.parseFigure(field.value));
  line.invalid = () => !readOnly && line.value() !== '' && line.figure() === null;

  line.changed = () => {
    if (readOnly || line.rivals.length) return false;
    if (line.stored) return !line.value() || line.figure() !== parsed(line.stored.payload.rate);
    if (!line.value()) return false;
    if (line.invalid() || line.unsaved) return true;
    if (line.proposal) return line.lookedUp || line.figure() !== parsed(line.proposal.rate);
    return !line.prefilled || line.figure() !== parsed(line.carried.payload.rate);
  };

  /** The same, for a line: a typed figure survives the reset. */
  line.keep = () => {
    const text = field.value;
    const typed = line.changed();
    return () => {
      line.reset();
      if (typed) {
        field.value = text;
        line.typed = true;
        line.describe();
      }
    };
  };

  /** What the refresh writes for this unit, where the date has no
   *  entry for it. */
  line.part = () => {
    if (readOnly || line.stored || line.rivals.length || line.invalid()) return null;
    return writes.ratePart({
      figure: line.figure(),
      proposal: line.proposal,
      carried: line.prefilled ? line.carried : null,
    });
  };

  /** The save of this line on its own, for the rate-lines save:
   *  `{ existing, payload }` to write, `{ remove }` to delete, or null. */
  line.change = () => {
    if (!line.changed() || line.invalid()) return null;
    if (line.stored && !line.value()) return { remove: line.stored };
    if (line.stored) {
      return {
        existing: line.stored,
        payload: writes.editedRatePayload(line.stored.payload, decimal.format(line.figure())),
      };
    }
    const part = line.part();
    return part ? { existing: null, payload: writes.rateEntry(vault, unit, date, part) } : null;
  };

  // No source quotes into the main currency (record-rate.md, Reading).
  const unquoted = () =>
    vault.symbols.get(vault.mainCurrency)?.since === null && Boolean(vault.symbols.get(unit)?.lookup);
  const unquotedCopy = `No price source quotes in ${vault.mainCurrency}, your main currency.`;

  const ownCopy = () => {
    const row = vault.symbols.get(unit);
    if (unquoted()) return `${unquotedCopy} This one is yours to set.`;
    return row
      ? `No market price for ${described.name} yet. This one is yours to set.`
      : `Nobody publishes a price for ${described.name}. This one is yours to set.`;
  };

  const earlyCopy = (yours = true) =>
    `Published prices for ${described.name} begin on ${format.fullDate(publishedFrom)}.${yours ? ' This one is yours to set.' : ''}`;

  /** Chip and wording for what the field holds now. Never touches the
   *  field itself, so typing is never overwritten. */
  line.describe = () => {
    error.hidden = !line.invalid();
    if (line.invalid()) error.textContent = 'Enter a number, with at most twelve decimal places.';
    skeleton.hidden = !line.pending;
    provenance.hidden = line.pending;
    lookup.hidden = true;
    if (line.rivals.length) {
      provenance.textContent = '';
      explanation.textContent = 'Two prices for this unit share this date. Keep one.';
      return;
    }
    const figure = line.figure();
    if (line.stored) {
      const stored = line.stored.payload;
      const original = stored.rateSource === 'edited' ? stored.proposedRate : stored.rateSource === 'proposed' ? stored.rate : null;
      // Editing a filled line flips its provenance the moment it
      // changes. The proposed badge is never silently kept.
      provenance.textContent =
        figure !== null && figure !== parsed(stored.rate) && original !== null
          ? editedFrom(original, format)
          : provenanceChip(stored, format);
      explanation.textContent = !readOnly && !line.value() ? 'Cleared. Saving removes this price.' : '';
      return;
    }
    if (line.pending) {
      provenance.textContent = '';
      explanation.textContent = '';
      return;
    }
    if (line.proposal) {
      provenance.textContent =
        figure === parsed(line.proposal.rate)
          ? provenanceChip({ rateSource: 'proposed', rateAsOf: line.proposal.asOf, date }, format)
          : figure !== null
            ? editedFrom(line.proposal.rate, format)
            : '';
      explanation.textContent = '';
      return;
    }
    provenance.textContent = line.changed() ? 'Typed by you' : '';
    if (readOnly) {
      explanation.textContent = `No price for ${described.name} at this date.`;
      return;
    }
    if (early) {
      explanation.textContent = line.carried
        ? `Set on ${format.fullDate(line.carried.payload.date)}. ${earlyCopy()}`
        : line.asked
          ? `What was ${described.one} worth in ${vault.mainCurrency} on ${format.fullDate(date)}? ${earlyCopy(false)} The figure records either way, and until a price exists the holding is listed as not priced.`
          : earlyCopy();
      return;
    }
    if (!quotable) {
      explanation.textContent = line.carried
        ? `Estimated ${ageInWords(line.carried.payload.date)}. ${ownCopy()}`
        : line.asked
          ? askCopy()
          : `No price for ${described.name} yet. ${ownCopy()}`;
      return;
    }
    if (line.asked && !line.carried) {
      explanation.textContent = askCopy();
    } else if (reopened()) {
      explanation.textContent = `No rate was recorded for ${described.name} on this date.`;
    } else {
      explanation.textContent = `No market rate came back for ${described.name}. Nothing will be recorded for it for this date.`;
    }
    // A line that went in empty carries its own lookup, since the
    // outage that emptied it is the reason for coming back.
    lookup.hidden = !reopened() || line.lookedUp;
  };

  const askCopy = () => {
    const why = unquoted() ? unquotedCopy : `Nothing prices ${described.name} yet.`;
    return `What is ${described.one} worth in ${vault.mainCurrency}? ${why} The figure records either way, and until a price exists the holding is listed as not priced.`;
  };

  /** Back to what the vault holds for this date. */
  line.reset = () => {
    const entries = vault.entriesFor(unit).filter((e) => e.payload.date === date);
    line.rivals = entries.length > 1 && vault.duplicateRateDates(unit).has(date) ? entries : [];
    line.stored = line.rivals.length ? null : entries[0] || null;
    line.carried = vault.carriedRate(unit, date);
    line.typed = false;
    line.unsaved = false;
    // A unit only its owner can price shows its last figure as the
    // starting point. One somebody publishes stays empty until a
    // proposal fills it.
    line.prefilled = !line.stored && !line.proposal && !quotable && Boolean(line.carried);
    const figure = line.stored
      ? line.stored.payload.rate
      : line.proposal
        ? line.proposal.rate
        : line.prefilled
          ? line.carried.payload.rate
          : null;
    field.value = figure === null ? '' : format.editable(parsed(figure), 6);
    field.className = line.prefilled ? 'quantity carried' : 'quantity';
    shown.textContent = line.stored ? format.editable(parsed(line.stored.payload.rate), 6) : '';
    box.hidden = line.rivals.length > 0;
    pair.hidden = !line.rivals.length;
    if (line.element) line.element.classList.toggle('flagged', line.rivals.length > 0);
    pair.replaceChildren(
      ...line.rivals.map((entry) =>
        el('p', { class: 'flag-note' }, [
          `${vault.mainCurrency} ${format.editable(parsed(entry.payload.rate), 6)}, ${provenanceChip(entry.payload, format)} `,
          readOnly
            ? null
            : el('button', {
                class: 'btn-inline',
                text: 'Keep this one',
                onclick: async () => {
                  try {
                    for (const other of line.rivals) if (other !== entry) await writes.deleteRecord(vault, other);
                  } catch {
                    showError(error, 'That did not save.');
                  }
                  line.reset();
                  onChange();
                },
              }),
        ]),
      ),
    );
    line.describe();
  };

  line.wait = () => {
    if (line.stored || line.rivals.length || !quotable) return;
    line.pending = true;
    line.describe();
  };

  /** A proposal for this line's unit at this date, or null when none
   *  came back. Never replaces what the person typed. */
  line.propose = (proposal) => {
    line.pending = false;
    if (!line.stored && !line.rivals.length && quotable) {
      line.proposal = proposal;
      if (!line.typed) {
        field.value = proposal ? format.editable(parsed(proposal.rate), 6) : '';
      }
    }
    line.describe();
    onChange();
  };

  line.ask = () => {
    if (line.asked || line.stored || line.rivals.length || line.proposal || line.carried || line.pending) return false;
    line.asked = true;
    line.describe();
    return true;
  };

  field.addEventListener('input', () => {
    line.typed = true;
    line.describe();
    onChange();
  });
  field.addEventListener('blur', () => {
    const typed = format.parseFigure(field.value);
    if (typed !== null) field.value = format.editable(typed, 6);
  });
  /** An empty line Look it up may fill and save: published at this
   *  date, holding no entry and nothing typed. */
  line.fillable = () => !readOnly && reopened() && quotable && !line.stored && !line.rivals.length && !line.value();

  /** What Look it up brought back for this line, shown as a proposal
   *  that waits to be written. */
  line.lookedUpAs = (proposal) => {
    line.lookedUp = true;
    line.typed = false;
    line.propose(proposal);
  };

  // Opening a recording fetches nothing. Pressing this is what issues
  // the request (record-snapshot.md, Update values, Rate lines on a
  // reopened recording).
  lookup.addEventListener('click', async () => {
    lookup.disabled = true;
    const answered = await lookUp(line);
    lookup.disabled = false;
    if (!answered) explanation.textContent = `No market rate came back for ${described.name}.`;
  });

  line.reset();

  // Headed by the unit's name from the symbol table, with what one of
  // it is worth beneath.
  line.element = el('div', { class: line.rivals.length ? 'rate-line flagged' : 'rate-line', 'data-unit': unit }, [
    el('div', { class: 'rate-name' }, [
      el('span', { class: 'rate-unit', text: described.name }),
      el('p', { class: 'row-status', text: `${described.one} in ${vault.mainCurrency}` }),
    ]),
    box,
    el('div', { class: 'rate-meta' }, [skeleton, provenance, readOnly ? null : lookup]),
    explanation,
    pair,
    error,
  ]);
  return line;
}

/** The note naming the figure an edit replaced, written as a rate is
 *  everywhere: every digit kept, at least six places. */
function editedFrom(rate, format) {
  return `Edited from ${format.editable(decimal.parse(rate), 6)}`;
}

export function provenanceChip(payload, format) {
  if (payload.rateSource === 'manual') return 'Typed by you';
  if (payload.rateSource === 'edited') return editedFrom(payload.proposedRate, format);
  return payload.rateAsOf && payload.rateAsOf !== payload.date
    ? `Market rate as of ${format.dayMonth(payload.rateAsOf, 'short')}`
    : 'Market rate';
}

/** How many holdings a change to one unit's price on `date` moves:
 *  those whose value that day actually changes, meaning holdings
 *  measured in the unit, not archived before the date, holding a
 *  figure at or before it, and whose quantity on it is not zero, the
 *  archive's zero included (record-snapshot.md, Update values,
 *  Changing or clearing a rate says what it moves). */
export function holdingsIn(vault, unit, date) {
  const day = dayNumber(date);
  return [...vault.holdings.values()].filter((h) => {
    if (h.payload.unit !== unit || (h.payload.archivedAt && h.payload.archivedAt.slice(0, 10) < date)) return false;
    const quantity = vault.quantityAt(h.recordId, day);
    return quantity !== null && quantity !== decimal.ZERO;
  }).length;
}

/** The confirmation for a save of rate lines: one per save, naming each
 *  unit and how many holdings move, and nothing for a changed price that
 *  moves none on that date (record-snapshot.md, Update values, Changing
 *  or clearing a rate says what it moves). */
export function rateChangeCopy(vault, date, changes) {
  const on = vault.format.longDate(date);
  const lines = [];
  for (const { unit, clearing } of changes) {
    const name = vault.unitName(unit);
    const count = holdingsIn(vault, unit, date);
    const holdings = `${counted(count, 'holding', 'holdings')} measured in ${name}`;
    if (!clearing) {
      if (count) lines.push(`Changing the ${name} rate for ${on} moves ${holdings} on that date. Your net worth on that day changes with them.`);
      continue;
    }
    lines.push(`Clearing the ${name} price for ${on} leaves that date with no price for it. ${holdings} ${count === 1 ? 'moves' : 'move'} on that date.`);
    if (vault.entriesFor(unit).length === 1) {
      lines.push(`This is the only price recorded for ${name}. Clearing it leaves every holding measured in it with no price at all, and they leave the total until one exists.`);
    }
  }
  return lines;
}

/** Both halves of a save that landed in part, by holding name and by
 *  unit: a count alone leaves the vault in a state nobody can see. */
export function partialCopy(vault, result) {
  const named = (list) => list.map((change) => vault.unitName(change.name)).join(', ');
  if (!result.failed.length) return 'Saved.';
  const landed = result.saved.length ? `Saved: ${named(result.saved)}. ` : '';
  return `${landed}Not saved: ${named(result.failed)}. Nothing was rolled back, and saving again retries only what did not land.`;
}

/** A rate line on a reopened recording saves by itself: filling in the
 *  price that was missing is a complete act and needs no holding
 *  touched alongside it. One confirmation covers every line it updates
 *  or clears. */
function saveRates(vault, sit, block, { say, refused, syncSave, emptied, keepTyped }) {
  const changed = block.lines.filter((line) => line.changed());
  if (changed.some((line) => line.invalid())) {
    for (const line of changed) line.describe();
    return;
  }
  const planned = changed.map((line) => ({ line, change: line.change() })).filter(({ change }) => change);
  if (!planned.length) return;

  const save = async () => {
    const plan = {
      rates: planned.filter(({ change }) => !change.remove).map(({ change }) => change),
      deletes: planned
        .filter(({ change }) => change.remove)
        .map(({ line, change }) => ({ entry: change.remove, name: line.unit })),
    };
    const restore = keepTyped();
    const result = await writes.saveRateLines(vault, sit, plan);
    if (result.refused) {
      if (result.emptied) emptied(restore);
      else refused();
      return;
    }
    const conflicts = result.failed.filter((f) => f.status === 409).map((f) => f.name);
    if (conflicts.length) await writes.reloadType(vault, 'rate').catch(() => {});
    const failed = new Set(result.failed.map((f) => f.name));
    // What landed shows what is stored. What did not keeps what
    // was typed, except after a Conflict, where the line shows the
    // figure another window wrote.
    for (const { line } of planned) {
      if (!failed.has(line.unit) || conflicts.includes(line.unit)) line.reset();
    }
    syncSave();
    const conflictCopy = conflicts.map((unit) => `The ${vault.unitName(unit)} rate was changed in another window, and the line shows what is stored now.`).join(' ');
    say([partialCopy(vault, result), conflictCopy].filter(Boolean).join(' '), { critical: result.failed.length > 0 });
  };

  // Filling a missing price changes none, so only an update that moves a
  // holding, or a clear, asks first.
  const copy = rateChangeCopy(
    vault,
    sit.date,
    planned
      .filter(({ change }) => change.existing || change.remove)
      .map(({ line, change }) => ({ unit: line.unit, clearing: Boolean(change.remove) })),
  );
  if (!copy.length) return save();
  const close = dialog({
    heading: 'Changing a price moves the holdings measured in it',
    body: copy.map((text) => el('p', { text })),
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-primary',
        text: 'Save the prices',
        onclick: () => {
          close();
          save();
        },
      }),
    ],
  });
}
