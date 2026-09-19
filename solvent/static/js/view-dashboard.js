// The core payoff screen: what you are worth right now, how it got
// there, and how it splits (spec/ui/dashboard.md).
//
// No control here issues a network request. Range, dimension, mode,
// band visibility and selection all read a model already in memory.
import * as decimal from './decimal.js';
import { chartTable, drawChart, fillFor } from './chart.js';
import { ageInWords, dialog, el, mount, shortDate, today } from './dom.js';
import { dayNumber, isoFromDay } from './model.js';
import { holdingForm, snapshotDialog } from './view-forms.js';

const RANGES = [
  ['1M', 30],
  ['6M', 183],
  ['1Y', 365],
  ['All', null],
];

export function dashboardView(vault, actions) {
  const state = {
    range: '1Y',
    dimensionId: '',
    percentage: false,
    justTheLine: false,
    mode: 'latest',
    showArchived: false,
  };

  const root = el('section', { class: 'screen screen-wide' });

  const render = () => {
    const holdings = [...vault.holdings.values()];
    if (!holdings.length) {
      mount(root, emptyVault(vault, actions));
      return;
    }
    const dimension = vault
      .activeDimensions()
      .find((d) => d.id === state.dimensionId) || null;

    mount(root, [
      vault.unreadable.length ? decryptionBanner(vault) : null,
      duplicateBanner(vault, actions),
      hero(vault, state, render, actions),
      chartSection(vault, state, render, dimension, actions),
      holdingsTable(vault, state, render, actions),
      dimension ? breakdown(vault, dimension, state) : null,
    ]);
  };

  render();
  return root;
}

function emptyVault(vault, actions) {
  return el('div', { class: 'card card-centered' }, [
    el('h1', { class: 'card-heading', text: 'Add your first holding' }),
    el('p', {
      class: 'hint',
      text: 'A holding is anything you own money in: a bank account, a depot, gold, a flat.',
    }),
    el('button', {
      class: 'btn-primary',
      text: 'Add a holding',
      onclick: () => actions.addHolding(),
    }),
  ]);
}

function decryptionBanner(vault) {
  return el('div', { class: 'banner banner-critical', role: 'alert' }, [
    el('span', {
      text: `${vault.unreadable.length} records could not be read.`,
    }),
  ]);
}

function duplicateBanner(vault, actions) {
  const faults = [];
  for (const [accountId] of vault.snapshots) {
    for (const date of vault.duplicateSnapshotDates(accountId)) {
      const holding = vault.holdings.get(accountId);
      faults.push({ date, label: holding ? holding.payload.name : accountId });
    }
  }
  for (const [symbol] of vault.rates) {
    for (const date of vault.duplicateRateDates(symbol)) {
      faults.push({ date, label: symbol });
    }
  }
  if (!faults.length) return null;
  return el(
    'div',
    { class: 'banner banner-critical', role: 'alert' },
    faults.map((fault) =>
      el('button', {
        class: 'link-button',
        text: `Two entries on ${shortDate(fault.date)} for ${fault.label}. Open the recording.`,
        onclick: () => actions.openRecording(fault.date),
      }),
    ),
  );
}

function hero(vault, state, render, actions) {
  const totals = vault.totals(state.mode);
  const rateDate = vault.newestRateDate();

  return el('section', { class: 'hero' }, [
    el('p', {
      class: 'hero-figure',
      text: totals.valued
        ? `${decimal.toDisplay(totals.net, 2)} ${vault.mainCurrency}`
        : '—',
    }),
    el('div', { class: 'hero-side' }, [
      el('span', {
        class: 'hero-part',
        text: `Assets ${decimal.toDisplay(totals.assets, 2)}`,
      }),
      el('span', {
        class: 'hero-part',
        text: `Liabilities ${decimal.toDisplay(totals.liabilities, 2)}`,
      }),
    ]),
    el('div', { class: 'switch', role: 'group', 'aria-label': 'Which rates' }, [
      switchButton(
        rateDate ? `Latest rates, ${shortDate(rateDate)}` : 'Latest rates',
        state.mode === 'latest',
        () => {
          state.mode = 'latest';
          render();
        },
      ),
      switchButton('Rates as of each figure', state.mode === 'asRecorded', () => {
        state.mode = 'asRecorded';
        render();
      }),
    ]),
    el('button', {
      class: 'btn-primary',
      text: 'New recording',
      onclick: () => datePicker(vault, actions),
    }),
  ]);
}

function switchButton(label, active, onclick) {
  return el('button', {
    class: active ? 'switch-option active' : 'switch-option',
    'aria-pressed': String(active),
    text: label,
    onclick,
  });
}

/** The marked date picker. A date holding no recording goes straight
 *  to the sweep; a marked one opens that recording's own screen, with
 *  no warning and nothing to confirm, because the picker can see what
 *  is there (ui/dashboard.md). */
function datePicker(vault, actions) {
  const marked = new Set(vault.recordingDates());
  const input = el('input', { type: 'date', max: today(), value: today() });
  const note = el('p', { class: 'hint' });

  const describe = () => {
    note.textContent = marked.has(input.value)
      ? `${shortDate(input.value)} already holds a recording. Opening it.`
      : `${shortDate(input.value)} holds nothing yet. Starting a recording there.`;
  };
  input.addEventListener('change', describe);
  describe();

  const close = dialog({
    heading: 'New recording',
    body: [
      input,
      note,
      marked.size
        ? el('p', {
            class: 'hint',
            text: `Dates already holding a recording: ${[...marked].map(shortDate).join(', ')}`,
          })
        : null,
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      el('button', {
        class: 'btn-primary',
        text: 'Open',
        onclick: () => {
          close();
          if (marked.has(input.value)) actions.openRecording(input.value);
          else actions.openSweep(input.value);
        },
      }),
    ],
  });
}

function chartSection(vault, state, render, dimension, actions) {
  const dates = vault.recordingDates();
  if (!dates.length) return null;

  const lastDay = dayNumber(dates[dates.length - 1]);
  const firstRecorded = dayNumber(dates[0]);
  const span = RANGES.find(([label]) => label === state.range)[1];
  const fromDay = span === null ? firstRecorded : Math.max(firstRecorded, lastDay - span);
  const { days, bands } = vault.series(dimension, fromDay, lastDay);

  const coverage = dimension ? vault.coverage(dimension) : null;
  const annotations = [...vault.holdings.values()]
    .filter((h) => h.payload.archivedAt)
    .map((h) => ({ date: h.payload.archivedAt, label: h.payload.name }));

  const readout = el('p', { class: 'hint', role: 'status' });

  return el('section', { class: 'card' }, [
    el('div', { class: 'chart-controls' }, [
      el(
        'div',
        { class: 'range-buttons', role: 'group', 'aria-label': 'Range' },
        RANGES.map(([label]) =>
          switchButton(label, state.range === label, () => {
            state.range = label;
            render();
          }),
        ),
      ),
      el('label', { class: 'field-inline' }, [
        el('span', { text: 'Group by' }),
        groupBySelect(vault, state, render),
      ]),
      coverage
        ? el('span', {
            class: 'hint',
            text: `${coverage.assigned} of ${coverage.total} holdings assigned`,
          })
        : null,
      el('label', { class: 'checkbox' }, [
        checkbox(state.percentage, (on) => {
          state.percentage = on;
          render();
        }),
        el('span', { text: 'Percentage' }),
      ]),
      el('label', { class: 'checkbox' }, [
        checkbox(state.justTheLine, (on) => {
          state.justTheLine = on;
          render();
        }),
        el('span', { text: 'Just the line' }),
      ]),
    ]),
    state.percentage
      ? el('p', {
          class: 'hint',
          text: 'Each side is normalized against itself, assets against total assets and liabilities against total liabilities.',
        })
      : null,
    drawChart({
      days,
      bands,
      marks: vault.quantityDates(),
      annotations,
      percentage: state.percentage,
      justTheLine: state.justTheLine,
      onPickDate: (date) => actions.openRecording(date),
      onHover: (index) => {
        if (index === null || typeof index !== 'number') {
          readout.textContent = '';
          return;
        }
        const parts = bands.map(
          (band) => `${band.label} ${decimal.toDisplay(band.points[index], 2)}`,
        );
        const net = bands.reduce((sum, band) => sum + band.points[index], 0n);
        readout.textContent = `${isoFromDay(days[index])} · ${parts.join(' · ')} · Net ${decimal.toDisplay(net, 2)}`;
      },
    }),
    readout,
    bands.length > 1 ? legend(bands) : null,
    el('details', {}, [el('summary', { text: 'View as table' }), chartTable(days, bands)]),
  ]);
}

function checkbox(checked, onchange) {
  const box = el('input', { type: 'checkbox', checked });
  box.addEventListener('change', () => onchange(box.checked));
  return box;
}

function groupBySelect(vault, state, render) {
  const select = el('select', {}, [
    el('option', { value: '', text: 'Total' }),
    ...vault.activeDimensions().map((d) => el('option', { value: d.id, text: d.label })),
  ]);
  select.value = state.dimensionId;
  select.addEventListener('change', () => {
    state.dimensionId = select.value;
    render();
  });
  return select;
}

function legend(bands) {
  return el(
    'ul',
    { class: 'legend' },
    bands.map((band, index) =>
      el('li', {}, [
        el('span', { class: 'swatch', style: `background:${fillFor(band, index)}` }),
        el('span', { text: band.label }),
      ]),
    ),
  );
}

function holdingsTable(vault, state, render, actions) {
  const dimensions = vault.activeDimensions();
  const rows = [];
  const unvalued = [];
  const unpriced = [];
  const newestRate = vault.newestRateDate();

  for (const holding of vault.holdings.values()) {
    if (holding.payload.archivedAt && !state.showArchived) continue;
    const value = vault.valueOf(holding, state.mode);
    if (value.state === 'unvalued') unvalued.push(holding);
    else if (value.state === 'unpriced') unpriced.push({ holding, value });
    else rows.push({ holding, value });
  }

  const header = el('tr', {}, [
    el('th', { text: 'Name' }),
    dimensions.length ? el('th', { text: 'Dimensions' }) : null,
    el('th', { class: 'numeric', text: 'Latest value' }),
    el('th', { class: 'numeric', text: `In ${vault.mainCurrency}` }),
    el('th', { text: 'As of' }),
    el('th', { text: '' }),
  ]);

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Holdings' }),
    el('table', { class: 'data-table' }, [
      el('thead', {}, [header]),
      el(
        'tbody',
        {},
        rows.map(({ holding, value }) =>
          el('tr', { class: holding.payload.archivedAt ? 'dimmed' : null }, [
            el('td', {}, [
              el('button', {
                class: 'link-button',
                text: holding.payload.name,
                onclick: () => actions.openHolding(holding.recordId),
              }),
              holding.payload.archivedAt
                ? el('span', { class: 'chip chip-archived', text: 'Archived' })
                : null,
            ]),
            dimensions.length
              ? el(
                  'td',
                  {},
                  dimensions
                    .map((dimension) => {
                      const band = vault.bandOf(holding, dimension);
                      if (band.id === 'unassigned') return null;
                      return el('span', {
                        class: 'chip',
                        text: `${dimension.label}: ${band.label}`,
                      });
                    })
                    .filter(Boolean),
                )
              : null,
            el('td', {
              class: 'numeric',
              text: `${decimal.toDisplay(value.quantity, 2)} ${holding.payload.unit}`,
            }),
            el('td', { class: 'numeric', text: decimal.toDisplay(value.converted, 2) }),
            el('td', {}, [
              el('span', { text: `${shortDate(value.asOf)} · ${ageInWords(value.asOf)}` }),
              // A row priced older than the vault's newest rate
              // carries that price's date too, because "latest rates"
              // is not true of that row.
              value.priceDate && newestRate && value.priceDate < newestRate
                ? el('span', {
                    class: 'hint',
                    text: `priced ${shortDate(value.priceDate)}`,
                  })
                : null,
            ]),
            el('td', {}, [
              el('button', {
                class: 'btn-inline',
                text: 'Record a value',
                onclick: () => snapshotDialog(vault, holding, null, actions.reload),
              }),
            ]),
          ]),
        ),
      ),
    ]),
    unpriced.length
      ? group('Not priced', unpriced.map((r) => r.holding), vault, actions,
          'Their unit has no price at all, so they are excluded from the total rather than counted at their bare quantity.')
      : null,
    unvalued.length
      ? group('Not yet valued', unvalued, vault, actions,
          'Nothing has been recorded for these yet.')
      : null,
    el('div', { class: 'table-actions' }, [
      el('label', { class: 'checkbox' }, [
        checkbox(state.showArchived, (on) => {
          state.showArchived = on;
          render();
        }),
        el('span', { text: 'Show archived' }),
      ]),
      el('button', {
        class: 'btn-secondary',
        text: 'Add a holding',
        onclick: () => actions.addHolding(),
      }),
    ]),
  ]);
}

function group(title, holdings, vault, actions, explanation) {
  return el('div', { class: 'table-group' }, [
    el('h3', { class: 'group-heading', text: title }),
    el('p', { class: 'hint', text: explanation }),
    el(
      'ul',
      { class: 'plain-list' },
      holdings.map((holding) =>
        el('li', {}, [
          el('button', {
            class: 'link-button',
            text: holding.payload.name,
            onclick: () => actions.openHolding(holding.recordId),
          }),
        ]),
      ),
    ),
  ]);
}

/** Where the chart shows how composition moved, this shows what it is
 *  made of right now. Every bar takes chart slot 1: these are nominal
 *  categories and the bar length already carries the value. */
function breakdown(vault, dimension, state) {
  const bands = new Map();
  for (const value of dimension.values.filter((v) => !v.archivedAt)) {
    bands.set(value.id, { label: value.label, total: decimal.ZERO });
  }
  bands.set('unassigned', { label: 'Unassigned', total: decimal.ZERO });

  for (const holding of vault.activeHoldings()) {
    const figure = vault.valueOf(holding, state.mode);
    if (figure.state !== 'valued') continue;
    const band = vault.bandOf(holding, dimension);
    const target = bands.get(band.id) || bands.get('unassigned');
    target.total += figure.converted;
  }

  const rows = [...bands.values()].filter((band) => band.total !== 0n);
  if (!rows.length) return null;
  const widest = rows.reduce(
    (max, band) => (band.total > max ? band.total : band.total < 0n && -band.total > max ? -band.total : max),
    1n,
  );

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: `By ${dimension.label}` }),
    el(
      'ul',
      { class: 'bars' },
      rows.map((band) => {
        const negative = band.total < 0n;
        const magnitude = negative ? -band.total : band.total;
        const width = Number((magnitude * 100n) / widest);
        return el('li', { class: negative ? 'bar negative' : 'bar' }, [
          el('span', {
            class: 'bar-fill',
            style: `width:${width}%;background:${fillFor({ id: 'slot' }, 0)};opacity:${negative ? 0.45 : 0.85}`,
          }),
          el('span', {
            class: 'bar-label',
            text: `${band.label} · ${decimal.toDisplay(band.total, 2)}`,
          }),
        ]);
      }),
    ),
  ]);
}

export { holdingForm };
