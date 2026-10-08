// The summary figures each round on their own, written from
// spec/features/net-worth-view.md (Hero figure, Breakdown by dimension
// and acceptance criterion 66) without reading how the screen is built
// or tested. The total rounds the exact sum once, half-even, to whole
// units, and each bar and each of gross assets and gross liabilities
// rounds its own exact figure the same way, so the parts as shown need
// not add up to the total as shown.
// Templates: dashboard.html. Modules: view-dashboard.js, decimal.js,
// format.js.
import { check, holdings, page, plant, reloadModel, run, setProfile, vaultOwner } from '../harness.mjs';

// Exact figures are integers in millionths of a unit.
const PLACES = 6;
const UNIT = 10n ** BigInt(PLACES);
const floorDiv = (a, b) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
const halfEven = (exact) => {
  const q = floorDiv(exact, UNIT);
  const twice = (exact - q * UNIT) * 2n;
  return twice > UNIT || (twice === UNIT && q % 2n !== 0n) ? q + 1n : q;
};
const exactOf = (decimal) => {
  const [whole, frac = ''] = decimal.replace('-', '').split('.');
  const n = BigInt(whole) * UNIT + BigInt(frac.padEnd(PLACES, '0'));
  return decimal.startsWith('-') ? -n : n;
};
const asDecimal = (n) => `${n < 0n ? '-' : ''}${(n < 0n ? -n : n) / UNIT}.${String((n < 0n ? -n : n) % UNIT).padStart(PLACES, '0')}`;

// A figure as shown, back to an integer: digits and the true minus only.
// `null` when it carries a sign on zero or reads as something else.
const shownValue = (text) => {
  const digits = text.replace(/[^0-9−-]/g, '');
  if (!/^[−-]?[0-9]+$/.test(digits)) return null;
  const n = BigInt(digits.replace(/^[−-]/, ''));
  if (n === 0n && digits !== '0' && !/^0+$/.test(digits)) return null;
  return /^[−-]/.test(digits) ? -n : n;
};

const read = () =>
  page.call(() => {
    const t = (node) => (node ? node.textContent : null);
    return {
      total: t(document.querySelector('.dashboard .hero-amount')),
      parts: [...document.querySelectorAll('.dashboard .hero-part-value')].map(t),
      bars: [...document.querySelectorAll('.dashboard .bars .bar-label')].map((b) => [t(b.querySelector('.bar-name')), t(b.querySelector('.bar-amount'))]),
    };
  });

const groupBy = async (dimension) => {
  await page.call((id) => {
    const s = document.querySelector('.chart-card select');
    s.value = id;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, dimension);
  await page.frames();
  await page.waitUntil("document.querySelectorAll('.dashboard .bars .bar-label').length > 0", { label: 'the breakdown' });
};

// Checks one screen against exact band values, by band label, and exact
// gross assets and liabilities.
const verify = (where, shown, bands, assets, liabilities) => {
  const total = Object.values(bands).reduce((a, b) => a + b, 0n);
  const wantTotal = halfEven(total);
  const gotTotal = shownValue(shown.total || '');
  check(`net-worth-view: the total rounds once, half-even, ${where}`, gotTotal === wantTotal,
    `shows ${shown.total}, exact ${asDecimal(total)}, wants ${wantTotal}`);

  // A band at exactly zero may draw no bar. It takes no unit either way,
  // since its remainder is zero, so the rest share out the same.
  const names = shown.bars.map(([name]) => name);
  const known = names.every((n) => n in bands) &&
    Object.keys(bands).every((n) => names.includes(n) || bands[n] === 0n);
  check(`net-worth-view: the breakdown shows a bar for every band not at zero ${where}`, known,
    `bars ${JSON.stringify(names)}, bands ${JSON.stringify(Object.keys(bands))}`);
  if (known) {
    const got = shown.bars.map(([, amount]) => shownValue(amount));
    const want = names.map((n) => halfEven(bands[n]));
    check(`net-worth-view: each bar reads its own exact figure rounded half-even ${where}`,
      got.every((g, i) => g === want[i]),
      `shows ${JSON.stringify(shown.bars)}, exact ${JSON.stringify(names.map((n) => asDecimal(bands[n])))}, wants ${want.join(', ')}`);
  }

  // Gross liabilities may be written signed or as a magnitude.
  const [a, l] = shown.parts.map((p) => shownValue(p || ''));
  const magnitude = (n) => (n < 0n ? -n : n);
  check(`net-worth-view: gross assets and liabilities each read their own exact figure rounded half-even ${where}`,
    a === halfEven(assets) && l !== null && magnitude(l) === magnitude(halfEven(liabilities)),
    `shows ${JSON.stringify(shown.parts)}, exact ${asDecimal(assets)} and ${asDecimal(liabilities)}`);
};

// A seeded generator, so a failing round is the same round next time.
let seed = 130;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

await run(async () => {
  await vaultOwner();
  const fourBands = { id: 'four', label: 'Four', values: ['a', 'b', 'c', 'd'].map((v) => ({ id: v, label: `Band ${v.toUpperCase()}` })) };
  const sixValues = { id: 'six', label: 'Six', values: ['p', 'q', 'r', 's', 't', 'u'].map((v) => ({ id: v, label: `Value ${v.toUpperCase()}` })) };
  await setProfile({ dimensions: [fourBands, sixValues], locale: 'de-CH', groupSeparator: 'apostrophe' });

  const first = await holdings([
    ['Holding A', 'CHF', { four: 'a', six: 'p' }],
    ['Holding B', 'CHF', { four: 'b', six: 'q' }],
    ['Holding C', 'CHF', { four: 'c', six: 'r' }],
    ['Holding D', 'CHF', { four: 'd', six: 's' }],
  ]);
  let day = 0;
  const record = async (figures) => {
    day += 1;
    const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    await plant(Object.entries(figures).map(([id, value]) => ({ type: 'snapshot', accountId: id, payload: { date, value, note: null } })));
    await reloadModel('#/');
    await page.waitUntil("document.querySelector('.dashboard .hero-amount')", { label: 'the dashboard' });
  };
  const byName = (ids) => (named) => Object.fromEntries(Object.entries(named).map(([n, v]) => [ids[n], v]));
  const gross = (values) => [
    values.filter((v) => v > 0n).reduce((a, b) => a + b, 0n),
    values.filter((v) => v < 0n).reduce((a, b) => a + b, 0n),
  ];

  // Criterion 66, under de-CH with an apostrophe.
  const c66 = { 'Holding A': '1234.50', 'Holding B': '4133.26', 'Holding C': '41373.46', 'Holding D': '340000' };
  await record(byName(first)(c66));
  await groupBy('four');
  const shown66 = await read();
  const plain = (s) => (s || '').replace(/[’']/g, "'").replace(/^[^0-9−-]*/, '').trim();
  check('net-worth-view: criterion 66 reads 1\'234, 4\'133, 41\'373 and 340\'000 under 386\'741',
    JSON.stringify(shown66.bars.map(([, amount]) => plain(amount))) === JSON.stringify(["1'234", "4'133", "41'373", "340'000"]) &&
      plain(shown66.total) === "386'741",
    JSON.stringify(shown66));
  const values66 = Object.values(c66).map(exactOf);
  verify('in criterion 66', shown66, Object.fromEntries(values66.map((v, i) => [`Band ${'ABCD'[i]}`, v])), ...gross(values66));

  // The spec's own example: three bands of 0.40 each read 0 under a
  // total of 1.
  await record(byName(first)({ 'Holding A': '0.40', 'Holding B': '0.40', 'Holding C': '0.40', 'Holding D': '0' }));
  await groupBy('four');
  const forties = await read();
  const exactly = (named) => Object.fromEntries(Object.entries(named).map(([n, v]) => [n, exactOf(v)]));
  verify('with three bands of 0.40', forties, exactly({ 'Band A': '0.40', 'Band B': '0.40', 'Band C': '0.40', 'Band D': '0' }),
    exactOf('1.20'), 0n);

  // Gross figures alone: 3.10 of assets and 2.80 of liabilities show 3
  // and 3 under a total of 0, with no minus on a zero.
  await record(byName(first)({ 'Holding A': '0.60', 'Holding B': '-0.30', 'Holding C': '2.50', 'Holding D': '-2.50' }));
  await groupBy('four');
  verify('with assets and liabilities under a unit apart', await read(),
    exactly({ 'Band A': '0.60', 'Band B': '-0.30', 'Band C': '2.50', 'Band D': '-2.50' }), exactOf('3.10'), exactOf('-2.80'));

  // A total of exactly 3.50 shows 4 over bars of 2, 2, 0 and 0.
  await record(byName(first)({ 'Holding A': '1.75', 'Holding B': '1.75', 'Holding C': '-0.25', 'Holding D': '0.25' }));
  await groupBy('four');
  verify('with a total of exactly 3.50', await read(),
    exactly({ 'Band A': '1.75', 'Band B': '1.75', 'Band C': '-0.25', 'Band D': '0.25' }), exactOf('3.75'), exactOf('-0.25'));

  // Random vaults over more holdings: the fifth and sixth values fold
  // into Other, one holding is Unassigned, and two share a band.
  const more = await holdings([
    ['Holding E', 'CHF', { four: 'a', six: 't' }],
    ['Holding F', 'CHF', { four: 'b', six: 'u' }],
    ['Holding G', 'CHF', {}],
    ['Holding H', 'CHF', { four: 'c', six: 'p' }],
  ]);
  const ids = { ...first, ...more };
  const bandOf = {
    four: { 'Holding A': 'Band A', 'Holding B': 'Band B', 'Holding C': 'Band C', 'Holding D': 'Band D', 'Holding E': 'Band A', 'Holding F': 'Band B', 'Holding G': 'Unassigned', 'Holding H': 'Band C' },
    six: { 'Holding A': 'Value P', 'Holding B': 'Value Q', 'Holding C': 'Value R', 'Holding D': 'Value S', 'Holding E': 'Other', 'Holding F': 'Other', 'Holding G': 'Unassigned', 'Holding H': 'Value P' },
  };
  const figure = () => {
    const scale = [1, 10, 100, 100000][Math.floor(random() * 4)];
    const n = Math.floor(random() * 2 * scale * 100) - scale * 100;
    return random() < 0.25 ? n - (n % 50) : n;
  };
  for (let round = 0; round < 24; round += 1) {
    const exact = Object.fromEntries(Object.keys(ids).map((name) => [name, BigInt(figure()) * (UNIT / 100n)]));
    await record(Object.fromEntries(Object.entries(exact).map(([name, c]) => [ids[name], asDecimal(c)])));
    for (const dimension of ['four', 'six']) {
      await groupBy(dimension);
      const bands = {};
      for (const [name, c] of Object.entries(exact)) bands[bandOf[dimension][name]] = (bands[bandOf[dimension][name]] || 0n) + c;
      verify(`in round ${round} grouped by ${dimension}`, await read(), bands, ...gross(Object.values(exact)));
    }
  }

  // A dollar holding priced differently at its figure's date and after,
  // so both pricing modes give figures finer than a cent.
  const [dollar] = Object.values(await holdings([['Holding U', 'USD', { four: 'd', six: 's' }]]));
  const fixed = {
    'Holding A': '10.45', 'Holding B': '-3.45', 'Holding C': '0.30', 'Holding D': '0.15',
    'Holding E': '7.49', 'Holding F': '-0.49', 'Holding G': '0.05', 'Holding H': '0.20',
  };
  const dated = (offset) => new Date(Date.UTC(2026, 0, day + offset)).toISOString().slice(0, 10);
  await plant(['0.9', '0.8555'].map((rate, i) => ({
    type: 'rate',
    payload: { symbol: 'USD', date: dated(1 + i), rate, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: dated(1 + i), proposedRate: null },
  })));
  await record({ ...byName(ids)(fixed), [dollar]: '333.33' });
  const pricing = async (label) => {
    await page.call((name) => [...document.querySelectorAll('.hero-rates button')].find((b) => b.textContent.trim().startsWith(name)).click(), label);
    await page.frames();
  };
  for (const [label, converted] of [['Latest rates', '285.163815'], ['Rates as of each figure', '299.997']]) {
    await pricing(label);
    const exact = { ...exactly(fixed), 'Holding U': exactOf(converted) };
    for (const dimension of ['four', 'six']) {
      await groupBy(dimension);
      const bands = {};
      for (const [name, value] of Object.entries(exact)) {
        const band = name === 'Holding U' ? { four: 'Band D', six: 'Value S' }[dimension] : bandOf[dimension][name];
        bands[band] = (bands[band] || 0n) + value;
      }
      verify(`on ${label.toLowerCase()} grouped by ${dimension}`, await read(), bands, ...gross(Object.values(exact)));
    }
  }
}, { signsIn: false });
