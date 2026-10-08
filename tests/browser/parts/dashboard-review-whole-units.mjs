// Money in whole units, each figure rounded on its own, written from
// spec/requirements.md (Dates and numbers), design-system.md (Figures),
// net-worth-view.md (Hero figure, Holdings table, View as table;
// criteria 31 and 64), manage-accounts.md (Account detail) and
// account-settings.md (criteria 22 and 41) without reading how the
// screens are built or tested.
// Templates: dashboard.html. Modules: view-dashboard.js, view-holding.js,
// format.js, decimal.js, model.js.
import { check, openHolding, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

const BIG = '4503599627370496.4';
const D0 = '2026-08-01';
const D1 = '2026-09-01';
const D2 = '2026-09-15';

const holding = (name, unit, dims = {}) => ({
  type: 'account',
  payload: { name, unit, dims, note: null, archivedAt: null, createdAt: new Date().toISOString() },
});
const snap = (accountId, date, value) => ({ type: 'snapshot', accountId, payload: { date, value, note: null } });
const price = (symbol, date, rate) => ({
  type: 'rate', payload: { symbol, date, rate, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: date, proposedRate: null },
});

const dashboard = async () => {
  await reloadModel('#/');
  await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
};
// A table's cells by its header's text, for every body row.
const tableIn = (scope) => page.call((where) => {
  const table = document.querySelector(where);
  if (!table) return [];
  const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent.trim());
  return [...table.querySelectorAll('tbody tr')].map((tr) =>
    Object.fromEntries([...tr.children].map((td, i) => [heads[i], td.innerText.trim().split('\n')[0].trim()])));
}, scope);
// The column a table header "In CHF" names, which design-system.md,
// Units, gives the main currency's figures.
const IN_MAIN = 'In CHF';
// The holdings table by name: its native and converted figures.
const holdingsTable = async () => Object.fromEntries((await tableIn('.holdings-card table'))
  .map((row) => [row.Name, { native: row['Latest value'], converted: row[IN_MAIN] }]));
// A converted figure without the currency code a cell may carry.
const bare = (s) => (s || '').replace(/^CHF\s?/, '');
// Account detail: its header's text and its list of values.
const detail = async (id) => {
  await openHolding(id);
  return {
    header: await page.eval("document.querySelector('.detail-header').innerText"),
    rows: await tableIn('main table'),
  };
};

await run(async () => {
  await vaultOwner();
  await setProfile({ locale: 'en-US', dimensions: [{ id: 'side', label: 'Side', values: [{ id: 'x', label: 'Band X' }, { id: 'y', label: 'Band Y' }] }] });

  // ---- Criterion 31: two holdings past a double's precision -----------------
  const [bigX, bigY] = await plant([holding('Big X', 'CHF', { side: 'x' }), holding('Big Y', 'CHF', { side: 'y' })]);
  await plant([snap(bigX, D0, BIG), snap(bigY, D0, BIG)]);
  await dashboard();
  await page.call(() => {
    const s = document.querySelector('.chart-card select');
    s.value = 'side';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.frames();
  await page.call(() => [...document.querySelectorAll('.range-buttons button')].find((b) => b.textContent.trim() === 'All').click());
  await page.frames();
  await page.call(() => [...document.querySelectorAll('summary, button')].find((b) => b.textContent.trim() === 'View as table').click());
  await page.waitUntil("[...document.querySelectorAll('table th')].some((h) => h.textContent.trim() === 'Net worth')", { label: 'the data table' });
  const dataRows = await page.call(() => {
    const table = [...document.querySelectorAll('table')].find((t) => [...t.querySelectorAll('th')].some((h) => h.textContent.trim() === 'Net worth'));
    const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent.trim());
    return [...table.querySelectorAll('tbody tr')].map((tr) => Object.fromEntries([...tr.children].map((td, i) => [heads[i], td.textContent.trim()])));
  });
  const onD0 = dataRows.find((row) => row.Date === 'Aug 1, 2026');
  check('review net-worth-view 31: under en-US each band cell reads 4,503,599,627,370,496 and Net worth 9,007,199,254,740,993',
    onD0 && onD0['Band X'] === '4,503,599,627,370,496' && onD0['Band Y'] === '4,503,599,627,370,496' && onD0['Net worth'] === '9,007,199,254,740,993',
    JSON.stringify(dataRows));
  check('review net-worth-view View as table: no figure in the data table carries cents',
    dataRows.length > 0 && dataRows.every((row) => Object.entries(row).every(([head, cell]) => head === 'Date' || !/\.\d/.test(cell))),
    JSON.stringify(dataRows));
  // Both leave the total, so the rest of the part reads small figures.
  await plant([snap(bigX, D1, '0'), snap(bigY, D1, '0')]);

  // ---- The gold of the report, among figures that share out otherwise -----
  // 2.5 ozt at 1,688.254004 is CHF 4,220.63501. Three holdings of 0.90 and
  // the others put the total's 3 shared-out units on the 0.90s, so a
  // screen that shares the total out shows the gold as 4,220 where it
  // reads 4,221 on its own.
  const ids = Object.fromEntries((await plant([
    holding('Gold bars', 'XAU-ozt'), holding('Pocket A', 'CHF'), holding('Pocket B', 'CHF'), holding('Pocket C', 'CHF'),
    holding('Gold coins', 'XAU-ozt'), holding('Flat', 'm²'),
  ])).map((id, i) => [['Gold bars', 'Pocket A', 'Pocket B', 'Pocket C', 'Gold coins', 'Flat'][i], id]));
  await plant([
    price('XAU-ozt', D1, '1688.254004'), price('m²', D1, '5000'),
    snap(ids['Gold bars'], D1, '2.5'), snap(ids['Pocket A'], D1, '0.90'), snap(ids['Pocket B'], D1, '0.90'),
    snap(ids['Pocket C'], D1, '0.90'), snap(ids['Gold coins'], D1, '12.125'), snap(ids.Flat, D1, '80'),
  ]);
  await dashboard();
  const table = await holdingsTable();
  const want = {
    'Gold bars': ['2.5 ozt', 'CHF 4,221'],
    'Pocket A': ['CHF 1', 'CHF 1'],
    'Gold coins': ['12.125 ozt', 'CHF 20,470'],
    Flat: ['80 m²', 'CHF 400,000'],
  };
  const flat = (s) => (s || '').replace(/\s+/g, ' ');
  for (const [name, [native, converted]] of Object.entries(want)) {
    check(`review net-worth-view Holdings table: ${name} reads ${native} as entered and ${converted} in whole units`,
      table[name] && flat(table[name].native) === native && bare(flat(table[name].converted)) === bare(converted), JSON.stringify(table[name]));
  }
  const total = await page.eval("document.querySelector('.dashboard .hero-amount').textContent");
  check('review net-worth-view Hero figure: the total is the exact sum 424,693.4148085 rounded, 424,693',
    /^(CHF\s?)?424,693$/.test(total.trim()), total);

  // The holding's own page shows the same converted figure as the table,
  // in its header and in its list of values.
  for (const name of ['Gold bars', 'Gold coins', 'Flat']) {
    const seen = await detail(ids[name]);
    const converted = want[name][1];
    const header = flat(seen.header);
    const cell = seen.rows[0] && bare(flat(seen.rows[0][IN_MAIN]));
    check(`review manage-accounts Account detail: ${name}'s header shows ${converted}, as the dashboard's holdings table does`,
      header.includes(converted) && !new RegExp(`${converted.replace(/[.,]/g, '\\$&')}[.,]\\d`).test(header), header);
    check(`review manage-accounts Account detail: ${name}'s list of values shows ${converted} for ${D1}, as the dashboard's holdings table does`,
      cell === bare(converted), JSON.stringify(seen.rows));
  }

  // ---- Criterion 22: under an apostrophe, money whole and quantities as typed
  const [dollars, goldSmall] = await plant([holding('Dollar account', 'USD'), holding('Gold small', 'XAU-ozt')]);
  await plant([price('USD', D2, '0.8'), snap(dollars, D2, '1000.40'), snap(goldSmall, D2, '12.50')]);
  await setProfile({ groupSeparator: 'apostrophe' });
  await dashboard();
  const apostrophe = await holdingsTable();
  const shown22 = { 'Dollar account': 'USD 1’000', 'Gold coins': '12.125 ozt', 'Gold small': '12.50 ozt', Flat: '80 m²' };
  const listed22 = { 'Dollar account': dollars, 'Gold coins': ids['Gold coins'], 'Gold small': goldSmall, Flat: ids.Flat };
  for (const [name, figure] of Object.entries(shown22)) {
    check(`review account-settings 22: the holdings table shows ${name} as ${figure}`,
      apostrophe[name] && flat(apostrophe[name].native) === figure, JSON.stringify(apostrophe[name]));
    const seen = await detail(listed22[name]);
    check(`review account-settings 22: ${name}'s list of values shows ${figure}`,
      seen.rows[0] && flat(seen.rows[0].Value) === figure, JSON.stringify(seen.rows));
  }

  // ---- Criterion 41: the edit dialog prefills what was entered -------------
  // The apostrophe stays, so the group mark is the criterion's ’ whatever
  // this engine's de-CH default is.
  await setProfile({ locale: 'de-CH' });
  const editFirst = async (id) => {
    await reloadModel(`#/holding/${id}`);
    await page.waitUntil("document.querySelector('main tbody tr')", { label: 'the list of values' });
    await page.call(() => [...document.querySelector('main tbody tr').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click());
    await page.waitUntil("document.querySelector('.dialog input')", { label: 'the edit dialog' });
    return page.call(() => {
      const field = [...document.querySelectorAll('.dialog .field')].find((f) => /^Value\b/.test(f.querySelector('label')?.textContent.trim()));
      return field ? field.querySelector('input').value : null;
    });
  };
  const dollarsPrefill = await editFirst(dollars);
  check('review account-settings 41: under de-CH with an apostrophe the edit dialog of a USD value stored as "1000.40" prefills 1’000.40',
    dollarsPrefill === '1’000.40', JSON.stringify(dollarsPrefill));
  await page.call(() => {
    const opener = [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Add a note');
    if (opener) opener.click();
  });
  await page.waitUntil("document.querySelector('.dialog textarea')", { label: 'the note' });
  await page.call(() => {
    const note = document.querySelector('.dialog textarea');
    note.value = 'Statement checked';
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.call(() => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Save').click());
  await page.holds("!document.querySelector('.dialog')", { timeout: 20000, label: 'the dialog to close' });
  // Read back from the server, not the screen.
  const stored = await page.call(async (account) => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const { dek } = (await import('/static/js/session.js')).currentVault();
    const mine = (await api.get('/api/records?type=snapshot')).filter((r) => r.accountId === account);
    return Promise.all(mine.map((r) => c.decryptRecord(dek, r)));
  }, dollars);
  check('review account-settings 41: changing only the note writes value "1000.40", character for character',
    stored.length === 1 && stored[0].value === '1000.40' && stored[0].note === 'Statement checked', JSON.stringify(stored));
  const goldPrefill = await editFirst(ids['Gold coins']);
  check('review account-settings 41: the edit dialog of an XAU-ozt value stored as "12.125" prefills 12.125',
    goldPrefill === '12.125', JSON.stringify(goldPrefill));
  await page.key('Escape');
}, { signsIn: false });
