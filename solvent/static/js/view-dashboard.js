// The core payoff screen: what you are worth right now, how it got
// there, and how it splits (spec/features/net-worth-view.md, Dashboard).
//
// No control here issues a network request. Range, dimension, mode,
// band visibility and selection all read a model already in memory.
import * as decimal from './decimal.js';
import { chartTable, fillFor, trendChart } from './chart.js';
import { counted, dialog, el, icon, mount, priceDateLine, REPLACED_SINCE_OPEN, replacedCallout, resumable, today } from './dom.js';
import { dateGrid } from './datepicker.js';
import { isoFromDay } from './model.js';
import * as writes from './writes.js';
import { snapshotDialog } from './view-forms.js';

const RANGES = [
  ['1M', 30],
  ['6M', 183],
  ['1Y', 365],
  ['All', null],
];

/** `unassignedOf` opens the screen grouped by that dimension with the
 *  table filtered to the holdings it leaves unassigned, which is where
 *  a coverage link elsewhere lands (account-settings.md, Dimensions). */
/** `replaced`, `{ dropped }`, adds the Replaced since last open notice
 *  above everything else: the vault was replaced from a file while this
 *  page was locked or its session had ended. */
export function dashboardView(vault, actions, { unassignedOf = null, replaced = null } = {}) {
  const known = unassignedOf && vault.activeDimensions().some((d) => d.id === unassignedOf);
  // A year of history or more opens on a year, anything shorter on all
  // of it. History is what the chart draws, from the oldest snapshot.
  const history = vault.chartRange(null);
  const short = !history || history.lastDay - history.fromDay < 365;
  const state = {
    range: short ? 'All' : '1Y',
    dimensionId: known ? unassignedOf : '',
    percentage: false,
    justTheLine: false,
    mode: 'latest',
    showArchived: false,
    hidden: new Set(),
    unassignedOnly: Boolean(known),
    // A span dragged across the chart, as its earlier and later day.
    selection: null,
  };

  const root = el('section', { class: 'screen screen-wide dashboard' });

  const notice = replaced ? replacedCallout(REPLACED_SINCE_OPEN, replaced.dropped) : null;

  const render = () => {
    const holdings = [...vault.holdings.values()];
    if (!holdings.length) {
      mount(root, [notice, emptyVault(vault, actions)]);
      return;
    }
    const dimension = vault
      .activeDimensions()
      .find((d) => d.id === state.dimensionId) || null;
    const history = chartSeries(vault, state, dimension);

    mount(root, [
      notice,
      vault.unreadable.length ? decryptionBanner(vault) : null,
      duplicateBanner(vault, actions),
      hero(vault, state, render, actions, history, dimension),
      history ? chartSection(vault, state, render, dimension, actions, history) : null,
      dimension ? breakdown(vault, dimension, state) : null,
      holdingsTable(vault, state, render, actions, dimension),
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
  const count = vault.unreadable.length;
  return el('div', { class: 'banner banner-critical', role: 'alert' }, [
    el('span', {
      text: `${counted(count, 'record', 'records')} could not be read.`,
    }),
    el('details', { class: 'unreadable-list' }, [
      el('summary', { text: 'Which records' }),
      el('ul', { class: 'plain-list' }, vault.unreadable.map((id) => el('li', { class: 'record-id', text: id }))),
    ]),
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
      faults.push({ date, label: vault.unitName(symbol) });
    }
  }
  const misdated = vault.misdated();
  if (!faults.length && !misdated.length) return null;
  const line = (fault, text) =>
    el('button', { class: 'link-button', text, onclick: () => actions.openRecording(fault.date) });
  return el('div', { class: 'banner banner-critical', role: 'alert' }, [
    ...faults.map((fault) =>
      line(fault, `Two entries on ${vault.format.longDate(fault.date)} for ${fault.label}. Open the recording.`),
    ),
    ...misdated.map((fault) =>
      line(fault, `The entry for ${fault.label} is dated ${vault.format.longDate(fault.date)}, which is not a day that has passed. It counts toward nothing. Open the recording.`),
    ),
  ]);
}

function hero(vault, state, render, actions, history, dimension) {
  const totals = vault.totals(state.mode);
  const [assets, liabilities] = heroParts(totals);
  const net = vault.format.whole(totals.net);
  const rateDate = vault.newestRateDate();

  const figure = totals.valued
    ? el('p', { class: 'hero-figure' }, [
        el('span', { class: 'hero-code', text: vault.mainCurrency }),
        ' ',
        el('span', { class: 'hero-amount', text: net, dataset: { total: net } }),
      ])
    : el('p', { class: 'hero-figure', text: '—' });

  return el('section', { class: 'hero' }, [
    el('div', { class: 'hero-main' }, [
      el('p', { class: 'eyebrow', text: 'Net worth' }),
      figure,
      history ? heroChange(vault, history, state.range, state.selection, dimension) : null,
      // The line keeps its height while empty, so the date the chart
      // reads never moves the chart under the pointer.
      el('p', { class: 'hero-at-line' }, [el('span', { class: 'hero-at', hidden: true })]),
    ]),
    el('div', { class: 'hero-parts' }, [
      heroPart('Assets', vault.mainWhole(assets)),
      heroPart('Liabilities', vault.mainWhole(liabilities)),
    ]),
    el('div', { class: 'hero-action' }, [
      el('button', {
        class: 'btn-primary btn-large',
        text: 'New recording',
        onclick: () => datePicker(vault, actions),
      }),
    ]),
    el('div', { class: 'hero-rates' }, [
      el('div', { class: 'switch', role: 'group', 'aria-label': 'Which rates' }, [
        switchButton(
          rateDate
            ? [
                'Latest rates, ',
                el('span', { class: 'wide-only', text: vault.format.dayMonth(rateDate) }),
                el('span', { class: 'narrow-only', text: vault.format.dayMonth(rateDate, 'short') }),
              ]
            : 'Latest rates',
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
    ]),
  ]);
}

function heroPart(label, figure) {
  return el('div', { class: 'hero-part' }, [
    el('p', { class: 'eyebrow', text: label }),
    el('p', { class: 'hero-part-value', text: figure }),
  ]);
}

const abs = (n) => (n < 0n ? -n : n);

/** The change over the chart's selected range, or across a selected
 *  span, read at its two days from the value model. The arrow carries
 *  the sign as well as the color does. A year or more back is named by
 *  its month, a shorter range by its day. */
function heroChange(vault, { days }, range, selection, dimension) {
  if (days.length < 2) return null;
  const netAt = (day) => vault.valuesAt(dimension, day).reduce((sum, band) => sum + band.value, 0n);
  const [from, to] = selection || [days[0], days[days.length - 1]];
  const start = netAt(from);
  const change = netAt(to) - start;
  // The sign is the amount's own and the figures after it are
  // magnitudes, so the arrow, the amount and the percentage agree.
  const sign = change > 0n ? '+' : change < 0n ? '\u2212' : '';
  const percentage = start === 0n
    ? ''
    : ` \u00b7 ${sign}${vault.format.percent(decimal.divide(abs(change) * 100n, abs(start)), 1)}`;
  const tone = change > 0n ? 'good' : change < 0n ? 'critical' : 'flat';
  return el('p', { class: `hero-change ${tone}` }, [
    change === 0n ? null : icon(change > 0n ? 'up' : 'down'),
    el('span', {
      class: 'hero-delta',
      text: `${vault.mainCurrency} ${sign}${vault.format.whole(abs(change))}${percentage}`,
    }),
    el('span', {
      class: 'hero-since',
      text: selection
        ? `from ${vault.format.longDate(isoFromDay(from))} to ${vault.format.longDate(isoFromDay(to))}`
        : `since ${(range === '1Y' || range === 'All' ? vault.format.monthYear : vault.format.longDate)(isoFromDay(days[0]))}`,
    }),
  ]);
}

function switchButton(label, active, onclick) {
  return el('button', {
    class: active ? 'switch-option active' : 'switch-option',
    'aria-pressed': String(active),
    onclick,
  }, label);
}

/** The marked date picker: a dialog whose body is the month grid and
 *  nothing else. Picking a day closes it and routes at once. A date
 *  holding no recording goes straight to the sweep; a marked one opens
 *  that recording's own screen, with no warning and nothing to confirm,
 *  because the picker can see what is there (net-worth-view.md, Dashboard). */
export function datePicker(vault, actions) {
  const marked = new Set(vault.recordingDates());
  const host = el('div', { class: 'date-picker' });
  const grid = dateGrid(host, vault.format, today(), {
    max: today(),
    marked,
    onPick: (iso) => {
      close();
      if (marked.has(iso)) actions.openRecording(iso);
      else actions.openSweep(iso);
    },
  });

  const close = dialog({
    heading: 'New recording',
    resume: resumable(reopenDatePicker),
    body: [host],
    actions: [el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() })],
  });
  // The marked picker opens on today, with today focused.
  grid.focus();
}

function reopenDatePicker(context) {
  datePicker(context.vault, context);
}

/** The series the chart draws over the selected range, or null before
 *  anything has been recorded. */
function chartSeries(vault, state, dimension) {
  const range = vault.chartRange(RANGES.find(([label]) => label === state.range)[1]);
  return range && vault.series(dimension, range.fromDay, range.lastDay);
}

function chartSection(vault, state, render, dimension, actions, { days, bands }) {
  const coverage = dimension ? vault.coverage(dimension) : null;
  const annotations = [...vault.holdings.values()]
    .filter((h) => h.payload.archivedAt)
    .map((h) => ({ date: h.payload.archivedAt, label: h.payload.name }));

  // Pinned to the top of the plot above the crosshair: the date, every
  // visible band with its value, then the net total on a row of its own.
  const readout = el('div', { class: 'chart-readout', role: 'status', hidden: true });

  return el('section', { class: 'card chart-card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {
        class: 'section-heading',
        text: dimension ? `Net worth by ${dimension.label}` : 'Net worth',
      }),
      el('div', { class: 'chart-controls' }, [
        el(
          'div',
          { class: 'switch range-buttons', role: 'group', 'aria-label': 'Range' },
          RANGES.map(([label]) =>
            switchButton(label, state.range === label, () => {
              state.range = label;
              state.selection = null;
              render();
            }),
          ),
        ),
        el('label', { class: 'field-inline' }, [
          el('span', { class: 'group-by-label', text: 'Group by' }),
          groupBySelect(vault, state, render),
        ]),
        coverage
          ? coverage.assigned < coverage.total
            ? el('button', {
                class: 'link-button coverage',
                'aria-label': `${coverage.assigned} of ${counted(coverage.total, 'holding', 'holdings')} assigned. Show the unassigned ones.`,
                onclick: () => {
                  state.unassignedOnly = true;
                  render();
                  const table = document.querySelector('.holdings-card');
                  if (table) table.scrollIntoView({ block: 'start' });
                },
              }, coverageText(coverage))
            // Nothing is left to filter to, so it is only a count.
            : el('span', { class: 'coverage' }, coverageText(coverage))
          : null,
        el('div', { class: 'switch', role: 'group', 'aria-label': 'Scale' }, [
          switchButton('Absolute', !state.percentage, () => {
            state.percentage = false;
            render();
          }),
          switchButton('Percentage', state.percentage, () => {
            state.percentage = true;
            render();
          }),
        ]),
        el('label', { class: 'checkbox checkbox-inline' }, [
          checkbox(state.justTheLine, (on) => {
            state.justTheLine = on;
            render();
          }),
          el('span', { text: 'Just the line' }),
        ]),
      ]),
    ]),
    state.percentage
      ? el('p', {
          class: 'hint',
          text: 'Each side is normalized against itself, assets against total assets and liabilities against total liabilities.',
        })
      : null,
    el('div', { class: 'chart-stage' }, [
      trendChart({
        days,
        bands,
        hidden: state.hidden,
        selection: state.selection,
        marks: vault.quantityDates(),
        annotations,
        percentage: state.percentage,
        justTheLine: state.justTheLine,
        locale: vault.format.locale,
        format: vault.format,
        formatDay: (iso) => vault.format.dayMonth(iso, 'short'),
        formatDate: vault.format.longDate,
        onPickDate: (date) => actions.openRecording(date),
        onSelect: (span) => {
          state.selection = span;
          render();
        },
        onHover: (day, across) => {
          const heroAt = document.querySelector('.dashboard .hero-at');
          const heroAmount = document.querySelector('.dashboard .hero-amount');
          if (day === null) {
            readout.hidden = true;
            if (heroAt) heroAt.hidden = true;
            if (heroAmount) heroAmount.textContent = heroAmount.dataset.total;
            return;
          }
          const shown = vault.valuesAt(dimension, day).filter((band) => !state.hidden.has(band.id));
          const figures = decimal.apportion(shown.map((band) => band.value), vault.format.places);
          const net = shown.reduce((sum, band) => sum + band.value, 0n);
          const date = vault.format.longDate(isoFromDay(day));
          readout.replaceChildren(
            el('p', { class: 'readout-date', text: date }),
            ...shown.map((band, i) =>
              el('p', { class: 'readout-row' }, [
                el('span', { text: band.label }),
                el('span', { class: 'numeric', text: vault.format.money(figures[i]) }),
              ]),
            ),
            el('p', { class: 'readout-row readout-net' }, [
              el('span', { text: 'Net' }),
              el('span', { class: 'numeric', text: vault.format.money(net) }),
            ]),
            // A drop at an archive is named, so it never reads as a bad
            // figure.
            ...annotations
              .filter((a) => a.date === isoFromDay(day))
              .map((a) => el('p', { class: 'readout-archive', text: `${a.label} archived` })),
          );
          readout.style.setProperty('--at', String(across));
          readout.hidden = false;
          // The hero follows the cursor: the value first, its date
          // beneath it.
          if (heroAmount) heroAmount.textContent = vault.format.whole(net);
          if (heroAt) {
            heroAt.textContent = `on ${date}`;
            heroAt.hidden = false;
          }
        },
      }),
      readout,
    ]),
    state.hidden.size
      ? el('p', { class: 'hint hidden-bands', text: 'The total drawn here covers only the visible bands.' })
      : null,
    legend(vault, bands, state, render, dimension),
    state.selection
      ? el('p', { class: 'hint' }, [
          'A span is selected. ',
          el('button', {
            class: 'link-button',
            text: 'Clear it',
            onclick: () => {
              state.selection = null;
              render();
            },
          }),
        ])
      : null,
    el('details', {}, [el('summary', { text: 'View as table' }), chartTable(days, bands, vault.format, !dimension)]),
  ]);
}

function coverageText(coverage) {
  return [
    `${coverage.assigned} of ${coverage.total} `,
    el('span', { class: 'wide-only', text: coverage.total === 1 ? 'holding ' : 'holdings ' }),
    'assigned',
  ];
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
    state.hidden.clear();
    state.selection = null;
    if (!select.value) state.unassignedOnly = false;
    render();
  });
  return select;
}

/** Under the plot, beneath a hairline: each band with its swatch and
 *  its figure at the right-hand edge, and the key to the entry marks
 *  while they are drawn. One band needs no legend, since the heading
 *  names it.
 *
 *  Each entry is a button that hides or shows its band. Hovering or
 *  focusing one highlights its band and dims the rest, by class alone,
 *  so nothing is redrawn. */
function legend(vault, bands, state, render, dimension) {
  const marksShown = !state.justTheLine;
  if (bands.length < 2 && !marksShown) return null;
  const last = bands.length ? bands[0].points.length - 1 : 0;
  const values = decimal.apportion(bands.map((band) => band.points[last]), 0);
  // Each band's value at the two days of a selected span.
  const [early, late] = state.selection
    ? state.selection.map((day) => new Map(vault.valuesAt(dimension, day).map((band) => [band.id, band.value])))
    : [];
  const deltas = state.selection
    ? decimal.apportion(bands.map((band) => late.get(band.id) - early.get(band.id)), 0)
    : [];
  const highlight = (entry, id) => {
    const chart = entry.closest('.chart-card').querySelector('svg.trend');
    if (!chart) return;
    chart.classList.toggle('highlighting', id !== null);
    for (const path of chart.querySelectorAll('.band')) {
      path.classList.toggle('is-highlighted', path.dataset.band === id);
    }
  };
  return el('div', { class: 'legend-row' }, [
    bands.length > 1
      ? el(
          'div',
          { class: 'legend' },
          bands.map((band, index) => {
            const hidden = state.hidden.has(band.id);
            const entry = el('button', {
              type: 'button',
              class: hidden ? 'legend-entry is-hidden' : 'legend-entry',
              'aria-pressed': String(!hidden),
              title: hidden ? `Show ${band.label}` : `Hide ${band.label}`,
              onclick: () => {
                if (hidden) state.hidden.delete(band.id);
                else state.hidden.add(band.id);
                render();
              },
              onmouseenter: () => highlight(entry, band.id),
              onmouseleave: () => highlight(entry, null),
              onfocus: () => highlight(entry, band.id),
              onblur: () => highlight(entry, null),
            }, [
              el('span', { class: 'swatch', style: { background: fillFor(band, index) } }),
              el('span', { class: 'legend-name', text: band.label }),
              el('span', { class: 'legend-value', text: vault.format.whole(values[index]) }),
              // Each band's own change across a selected span.
              state.selection
                ? el('span', { class: 'legend-delta', text: signed(vault, deltas[index]) })
                : null,
            ]);
            return entry;
          }),
        )
      : null,
    marksShown
      ? el('span', { class: 'legend-key' }, [
          el('span', { class: 'legend-tick', 'aria-hidden': 'true' }),
          el('span', { text: 'A date you recorded' }),
        ])
      : null,
  ]);
}

function signed(vault, value) {
  return `${value > 0n ? '+' : ''}${vault.format.whole(value)}`;
}

/** The holdings the table lists. Archived comes first: an archived
 *  holding is a row whatever its figures, because being archived is why
 *  it is out of the total. Only active holdings reach the two groups
 *  that say why a holding is missing from it. */
export function holdingGroups(vault, state, grouping) {
  const rows = [];
  const unvalued = [];
  const unpriced = [];
  const filtering = state.unassignedOnly && grouping;

  for (const holding of vault.holdings.values()) {
    const archived = holding.payload.archivedAt;
    if (archived && !state.showArchived) continue;
    if (filtering && vault.bandOf(holding, grouping).id !== 'unassigned') continue;
    const value = vault.valueOf(holding, state.mode);
    if (archived || value.state === 'valued') rows.push({ holding, value });
    else if (value.state === 'unvalued') unvalued.push(holding);
    else unpriced.push({ holding, value });
  }
  return { rows, unpriced, unvalued };
}

function holdingsTable(vault, state, render, actions, grouping) {
  const dimensions = vault.activeDimensions();
  const { rows, unpriced, unvalued } = holdingGroups(vault, state, grouping);
  const newestRate = vault.newestRateDate();
  const shown = vault.shownFigures(state.mode);
  const filtering = state.unassignedOnly && grouping;
  const listed = rows.length + unpriced.length + unvalued.length > 0;

  const header = el('tr', {}, [
    el('th', { text: 'Name' }),
    dimensions.length ? el('th', { text: 'Dimensions' }) : null,
    el('th', { class: 'numeric', text: 'Latest value' }),
    el('th', { class: 'numeric', text: `In ${vault.mainCurrency}` }),
    el('th', { text: 'As of' }),
    el('th', { text: '' }),
  ]);

  return el('section', { class: 'card holdings-card' }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'section-heading', text: 'Holdings' }),
      el('label', { class: 'checkbox checkbox-inline' }, [
        checkbox(state.showArchived, (on) => {
          state.showArchived = on;
          render();
        }),
        el('span', { text: 'Show archived' }),
      ]),
    ]),
    filtering
      ? el('p', { class: 'filter-line', role: 'status' }, [
          el('span', {
            text: listed
              ? `Showing the holdings with no ${grouping.label} value.`
              : `Every holding has a ${grouping.label} value.`,
          }),
          el('button', {
            class: 'link-button',
            text: 'Show all holdings',
            onclick: () => {
              state.unassignedOnly = false;
              if (window.location.hash.startsWith('#/unassigned')) {
                window.history.replaceState(window.history.state, '', '#/');
              }
              render();
            },
          }),
        ])
      : null,
    // Without a filter nothing listed means every holding is archived.
    !filtering && !listed ? el('p', { class: 'hint', text: 'Every holding is archived.' }) : null,
    // A table of headings alone reads as a fault.
    rows.length ? el('table', { class: 'data-table holdings-table' }, [
      el('thead', {}, [header]),
      el(
        'tbody',
        {},
        rows.map(({ holding, value }) =>
          el('tr', {
            class: [holding.payload.archivedAt && 'dimmed', value.state === 'unpriced' && 'unpriced'].filter(Boolean).join(' ') || null,
            // The whole row opens the holding, which is how a phone,
            // with no row action, reaches Record a value or Unarchive.
            onclick: (event) => {
              if (!event.target.closest('button')) actions.openHolding(holding.recordId);
            },
          }, [
            el('td', { class: 'cell-name' }, [
              el('button', {
                class: 'link-button row-name',
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
                  { class: 'cell-dims' },
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
            // At phone width the native figure is dropped where it
            // would only repeat the converted one.
            el('td', {
              class: holding.payload.unit === vault.mainCurrency && value.state !== 'unvalued' ? 'numeric cell-native same-unit' : 'numeric cell-native',
              text: value.state === 'unvalued' ? 'not yet valued' : vault.amount(value.stored, holding.payload.unit),
            }),
            // A price older than the date the row is shown for carries
            // its own date, because the screen's rate date is not true
            // of that row: the rate date on latest rates, the row's
            // own date on rates as of each figure. An archived row can
            // hold no price or no figure at all.
            el('td', { class: 'numeric cell-converted' }, value.state === 'valued'
              ? [
                  vault.format.money(shown.get(holding) ?? value.converted),
                  priceDateLine(vault, value.priceDate, state.mode === 'latest' ? newestRate : value.asOf),
                ]
              : value.state === 'unpriced' ? ['not priced'] : []),
            el('td', { class: 'cell-asof' }, value.state === 'unvalued' ? [] : [el('span', { text: vault.format.longDate(value.asOf) })]),
            // An archived row takes no new value, and unarchiving it is
            // one action with no dialog (manage-accounts.md, Account form).
            el('td', { class: 'cell-action' }, [
              holding.payload.archivedAt
                ? el('button', {
                    class: 'btn-secondary btn-small',
                    text: 'Unarchive',
                    onclick: async (event) => {
                      try {
                        await writes.saveHolding(vault, holding, { ...holding.payload, archivedAt: null });
                        actions.reload();
                      } catch {
                        event.target.textContent = 'Still archived. Try again';
                      }
                    },
                  })
                : el('button', {
                    class: 'btn-secondary btn-small',
                    text: 'Record a value',
                    onclick: () => snapshotDialog(vault, holding, null, actions.reload, actions.openRecording),
                  }),
            ]),
          ]),
        ),
      ),
    ]) : null,
    unpriced.length
      ? group('Not priced', unpriced.map((r) => r.holding), vault, actions,
          'Their unit has no price at all, so they are excluded from the total rather than counted at their bare quantity.')
      : null,
    unvalued.length
      ? group('Not yet valued', unvalued, vault, actions,
          'Nothing has been recorded for these yet.')
      : null,
    el('div', { class: 'table-actions' }, [
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

/** Gross assets and liabilities as shown, adding up to the net as the
 *  hero shows it. */
export function heroParts(totals) {
  return decimal.apportion([totals.assets, totals.liabilities], 0);
}

/** Each band's signed total right now, in the dimension's configured
 *  order with "Unassigned" last, and `shown`, its whole-unit figure.
 *  Summed from the same per-holding figures as the hero, so the bars
 *  add up to the total exactly, and shared out so their shown figures
 *  add up to the total as shown. */
export function breakdownTotals(vault, dimension, mode) {
  const bands = new Map();
  for (const value of dimension.values.filter((v) => !v.archivedAt)) {
    bands.set(value.id, { label: value.label, total: decimal.ZERO });
  }
  bands.set('unassigned', { label: 'Unassigned', total: decimal.ZERO });

  for (const holding of vault.activeHoldings()) {
    const figure = vault.valueOf(holding, mode);
    if (figure.state !== 'valued') continue;
    const band = vault.bandOf(holding, dimension);
    const target = bands.get(band.id) || bands.get('unassigned');
    target.total += figure.converted;
  }
  // Past four, the rest fold into "Other", after "Unassigned", which is
  // the order the chart stacks them in.
  const all = [...bands.values()];
  const unassigned = all.pop();
  const rest = all.splice(4);
  const other = rest.length
    ? [{ label: 'Other', total: rest.reduce((sum, band) => sum + band.total, decimal.ZERO) }]
    : [];
  const result = [...all, unassigned, ...other];
  const shown = decimal.apportion(result.map((band) => band.total), 0);
  return result.map((band, i) => ({ ...band, shown: shown[i] }));
}

/** Where the chart shows how composition moved, this shows what it is
 *  made of right now. Every bar takes chart slot 1: these are nominal
 *  categories and the bar length already carries the value. */
function breakdown(vault, dimension, state) {
  const rows = breakdownTotals(vault, dimension, state.mode).filter((band) => band.total !== 0n);
  if (!rows.length) return null;

  // One scale for every bar: the widest negative band to the left of
  // the shared zero baseline, the widest positive one to its right.
  const most = (pick) => rows.reduce((max, band) => (pick(band.total) > max ? pick(band.total) : max), 0n);
  const left = most((total) => -total);
  const right = most((total) => total);
  const span = Number(decimal.format(left + right)) || 1;
  const share = (value) => Number(decimal.format(value)) / span;
  const zero = share(left);

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: `${dimension.label} today` }),
    el(
      'ul',
      {
        class: left > 0n ? 'bars has-negative' : 'bars',
        style: { '--zero': String(zero) },
      },
      rows.map((band) => {
        const negative = band.total < 0n;
        const length = share(negative ? -band.total : band.total);
        return el('li', {
          class: negative ? 'bar negative' : 'bar',
          style: { '--start': String(negative ? zero - length : zero), '--len': String(length) },
        }, [
          el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill' })]),
          el('span', { class: 'bar-label' }, [
            el('span', { class: 'bar-name', text: band.label }),
            ' ',
            el('span', { class: 'bar-amount', text: vault.mainWhole(band.shown) }),
          ]),
        ]);
      }),
    ),
  ]);
}
