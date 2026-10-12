// The holdings list's Sort, written from spec/features/net-worth-view.md
// (Holdings table, its Sort bullet and head row, and acceptance
// criterion 83) without reading how the screen is built or tested. Each
// order is read at 1280px and at 375px: As of from the oldest or the
// newest, a tie in the order added either way, an archived row with no
// As of last in both, and Order added as the screen opens. The groups
// keep the order added under every sort.
// Templates: dashboard.html. Modules: view-dashboard.js.
import { check, page, plant, reloadModel, run, unlockDashboard, vaultOwner } from '../harness.mjs';

// Added in this order. `asOf` is each holding's latest quantity date,
// and `earlier` a date before it, so a sort that read the first figure
// rather than the latest would misplace the row.
const HOLDINGS = [
  { name: 'Alder', unit: 'CHF', asOf: '2025-03-01' },
  { name: 'Birch', unit: 'CHF', asOf: '2024-01-01' },
  { name: 'Cedar', unit: 'CHF', asOf: '2025-03-01' },
  { name: 'Dogwood', unit: 'CHF', archived: true },
  { name: 'Elm', unit: 'CHF', asOf: '2026-01-01', earlier: '2020-01-01' },
  { name: 'Fir', unit: 'CHF', asOf: '2023-06-01', archived: true },
  // No dollar price is ever written, so both stay under Not priced,
  // added newest first.
  { name: 'Gorse', unit: 'USD', asOf: '2026-02-01' },
  { name: 'Hazel', unit: 'USD', asOf: '2022-01-01' },
  { name: 'Ivy', unit: 'CHF' },
];
const LISTED = ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir'];
const ORDERS = {
  'Order added': ['Alder', 'Birch', 'Cedar', 'Dogwood', 'Elm', 'Fir'],
  'As of, oldest first': ['Fir', 'Birch', 'Alder', 'Cedar', 'Elm', 'Dogwood'],
  'As of, newest first': ['Elm', 'Alder', 'Cedar', 'Birch', 'Fir', 'Dogwood'],
};
const ACTIVE = (order) => order.filter((name) => !HOLDINGS.find((h) => h.name === name).archived);

// Installs a finder for the select in the holdings card that a label
// reading "Sort" names, its own option texts aside, or an aria-label.
// A fresh load needs it installed again.
const findSort = () =>
  page.call(() => {
    window.__sortSelect = () => {
      const card = document.querySelector('.holdings-card');
      const labelText = (l) => {
        const copy = l.cloneNode(true);
        copy.querySelectorAll('select').forEach((n) => n.remove());
        return copy.textContent.trim();
      };
      return card && [...card.querySelectorAll('select')].find(
        (s) => (s.getAttribute('aria-label') || '').trim() === 'Sort' || [...(s.labels || [])].some((l) => labelText(l) === 'Sort'),
      );
    };
  });

// The comboboxes Chrome's accessibility tree names exactly "Sort".
const namedSort = async () => {
  const { root } = await page.send('DOM.getDocument', { depth: 0 });
  const { nodes } = await page.send('Accessibility.queryAXTree', { nodeId: root.nodeId, accessibleName: 'Sort', role: 'combobox' });
  return nodes.length;
};

// The Sort select's options as read and the one selected.
const sortControl = () =>
  page.call(() => {
    const select = window.__sortSelect();
    if (!select) return null;
    return {
      options: [...select.options].map((o) => o.textContent.trim()),
      selected: select.selectedOptions[0] ? select.selectedOptions[0].textContent.trim() : null,
    };
  });

const sortBy = (label) =>
  page.call((wanted) => {
    const select = window.__sortSelect();
    select.value = [...select.options].find((o) => o.textContent.trim() === wanted).value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, label);

// The names as a person reads them down the card, by where each is
// drawn: those in the table or list, and those in each group.
const readOrder = (names) =>
  page.call((all) => {
    const card = document.querySelector('.holdings-card');
    const shown = (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && n.closest('[hidden]') === null;
    };
    const order = (root, skip) => {
      const tops = new Map();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!shown(node.parentElement) || (skip && node.parentElement.closest(skip))) continue;
        const name = all.find((n) => node.textContent.trim() === n);
        if (name && !tops.has(name)) tops.set(name, node.parentElement.getBoundingClientRect().top);
      }
      return [...tops].sort((a, b) => a[1] - b[1]).map(([name]) => name);
    };
    return {
      rows: order(card, '.table-group'),
      groups: [...card.querySelectorAll('.table-group')].map((g) => order(g, null)),
    };
  }, names);

// Where the heading, Sort and Show archived sit in the head row.
const headRow = () =>
  page.call(() => {
    const card = document.querySelector('.holdings-card');
    const box = (n) => n && n.getBoundingClientRect();
    const heading = box(card.querySelector('h2, h3'));
    const select = window.__sortSelect();
    const toggle = [...card.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Show archived');
    const sort = box(select && (select.closest('label') || select));
    const shownArchived = box(toggle);
    if (!heading || !sort || !shownArchived) return null;
    const mid = (r) => r.top + r.height / 2;
    return {
      heading: [heading.left, heading.right, mid(heading)],
      sort: [sort.left, sort.right, mid(sort)],
      archived: [shownArchived.left, shownArchived.right, mid(shownArchived)],
      cardRight: card.getBoundingClientRect().right,
    };
  });

const NAMES = HOLDINGS.map((h) => h.name);
const NOT_PRICED = ['Gorse', 'Hazel'];

const showArchived = (on) =>
  page.call((wanted) => {
    const input = document.querySelector('.holdings-card .checkbox input');
    if (input.checked !== wanted) input.click();
  }, on);

const readEvery = async (where) => {
  for (const [label, expected] of Object.entries(ORDERS)) {
    await sortBy(label);
    await page.frames();
    const seen = await readOrder(NAMES);
    check(`net-worth-view: criterion 83, "${label}" lists ${expected.join(', ')} ${where}`,
      JSON.stringify(seen.rows) === JSON.stringify(expected), JSON.stringify(seen));
    const priced = seen.groups.find((g) => g.some((n) => NOT_PRICED.includes(n))) || [];
    check(`net-worth-view: under "${label}" the Not priced group keeps the order added ${where}`,
      JSON.stringify(priced) === JSON.stringify(NOT_PRICED), JSON.stringify(seen));
  }
};

await run(async () => {
  await vaultOwner();
  const ids = await plant(HOLDINGS.map((h, i) => ({
    type: 'account',
    payload: {
      name: h.name, unit: h.unit, dims: {}, note: null,
      archivedAt: h.archived ? '2026-01-15' : null,
      createdAt: new Date(Date.UTC(2019, 0, 1 + i)).toISOString(),
    },
  })));
  const figures = [];
  HOLDINGS.forEach((h, i) => {
    for (const date of [h.earlier, h.asOf].filter(Boolean)) {
      figures.push({ type: 'snapshot', accountId: ids[i], payload: { date, value: String(1000 + i), note: null } });
    }
  });
  await plant(figures);
  await reloadModel();
  await page.waitUntil("document.querySelector('.holdings-card')", { timeout: 90000, label: 'the dashboard' });

  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.frames();
  await findSort();
  const accessible = await namedSort();
  check('net-worth-view: a screen reader names the Sort select "Sort"', accessible === 1, String(accessible));
  const opened = await sortControl();
  check('net-worth-view: the holdings card holds a select labeled "Sort"', opened !== null, '');
  check('net-worth-view: Sort offers Order added, As of, oldest first and As of, newest first, in that order',
    opened && JSON.stringify(opened.options) === JSON.stringify(Object.keys(ORDERS)), JSON.stringify(opened));
  check('net-worth-view: criterion 83, the screen opens on Order added', opened && opened.selected === 'Order added',
    JSON.stringify(opened));

  const head = await headRow();
  check('net-worth-view: at 1280px the heading sits left, then Sort, then Show archived, on one row',
    head !== null && head.heading[1] <= head.sort[0] && head.sort[1] <= head.archived[0] &&
      Math.abs(head.sort[2] - head.archived[2]) < 12 && Math.abs(head.heading[2] - head.sort[2]) < 24,
    JSON.stringify(head));

  // Archived hidden: the archived rows are absent, the rest keep their order.
  for (const [label, expected] of Object.entries(ORDERS)) {
    await sortBy(label);
    await page.frames();
    const seen = await readOrder(NAMES);
    check(`net-worth-view: "${label}" with archived rows hidden lists ${ACTIVE(expected).join(', ')} at 1280px`,
      JSON.stringify(seen.rows) === JSON.stringify(ACTIVE(expected)), JSON.stringify(seen));
  }

  await showArchived(true);
  await page.frames();
  await readEvery('at 1280px');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 2, mobile: false });
  await page.frames();
  await readEvery('at 375px');

  // Opened again, in the app and from a fresh load, the screen is back on
  // Order added.
  await sortBy('As of, newest first');
  await page.frames();
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard again' });
  const again = await sortControl();
  check('net-worth-view: criterion 83, the dashboard opened again in the app opens on Order added',
    again && again.selected === 'Order added', JSON.stringify(again));
  await sortBy('As of, oldest first');
  await page.frames();
  await page.send('Emulation.clearDeviceMetricsOverride');
  await unlockDashboard('the dashboard after a fresh load');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the holdings card after a fresh load' });
  await findSort();
  const fresh = await sortControl();
  check('net-worth-view: criterion 83, a fresh load of the dashboard opens on Order added',
    fresh && fresh.selected === 'Order added', JSON.stringify(fresh));

  // Under Order added, a newer figure for the first holding moves
  // nothing.
  await plant([{ type: 'snapshot', accountId: ids[0], payload: { date: '2026-03-01', value: '1', note: null } }]);
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.holdings-card')", { label: 'the dashboard with a newer figure' });
  const kept = await readOrder(NAMES);
  check('net-worth-view: under Order added a row never moves because its figure changed',
    JSON.stringify(kept.rows) === JSON.stringify(ACTIVE(ORDERS['Order added'])), JSON.stringify(kept));
}, { signsIn: false });
