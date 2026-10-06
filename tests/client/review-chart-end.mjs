// Reviewer's checks on where the trend chart ends, written from
// spec/features/net-worth-view.md alone: Ranges and modes (the chart's
// last day is today, or a later `archivedAt`, every range counts back
// from it and starts no earlier than the oldest snapshot), States (a
// one-day history) and acceptance criteria 48, 49 and 76.
//
// Run by tests/test_review_net_worth_view.py.
import assert from 'node:assert/strict';

const JS = new URL('../../solvent/static/js/', import.meta.url);
const load = (name) => import(new URL(name, JS).href);
const { Vault, dayNumber } = await load('model.js');
const decimal = await load('decimal.js');

const results = [];
async function check(name, body) {
  try {
    await body();
    results.push(['ok', name]);
  } catch (error) {
    results.push(['FAIL', `${name}: ${error.message}`]);
  }
}

// The device's clock and zone, held at `instant` in `zone` while `body`
// runs. Every `new Date()` and `Date.now()` reads the instant.
const RealDate = Date;
async function at(instant, zone, body) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
    static now() {
      return new RealDate(instant).getTime();
    }
  };
  try {
    return await body();
  } finally {
    globalThis.Date = RealDate;
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

// Noon on `iso` in Zurich, so the device's calendar day is `iso`.
const noon = (iso, body) => at(`${iso}T10:00:00Z`, 'Europe/Zurich', body);

// A model built in memory, record by record, as a load indexes it.
// `holdings` is [name, unit, archivedAt], `figures` [name, date, value],
// `prices` [symbol, date, rate].
function model({ holdings, figures = [], prices = [] }) {
  const vault = new Vault(null);
  vault.profile = { mainCurrency: 'CHF', dimensions: [] };
  let n = 0;
  for (const [name, unit, archivedAt = null] of holdings) {
    vault._index({ recordId: name, recordType: 'account', version: 1, payload: { name, unit, dims: {}, note: null, archivedAt, createdAt: '2026-01-01T00:00:00Z' } });
  }
  for (const [id, date, value] of figures) {
    vault._index({ recordId: `s${(n += 1)}`, recordType: 'snapshot', accountId: id, version: 1, payload: { date, value, note: null } });
  }
  for (const [symbol, date, rate] of prices) {
    vault._index({ recordId: `r${(n += 1)}`, recordType: 'rate', version: 1, payload: { symbol, date, rate, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null } });
  }
  vault._sortSeries();
  return vault;
}

const SPANS = { '1M': 30, '6M': 183, '1Y': 365, All: null };
const day = dayNumber;
const net = (vault, at) => decimal.format(vault.valuesAt(null, at).reduce((sum, band) => sum + band.value, 0n));
// The net worth line's last point under a range.
const edge = (vault, range) => {
  const { days, bands } = vault.series(null, range.fromDay, range.lastDay);
  return { last: days.at(-1), net: decimal.format(bands.reduce((sum, band) => sum + band.points.at(-1), 0n)) };
};

// Criterion 76's history: a first recording on 2026-06-01, the last on
// 2026-09-15, in francs and in dollars priced on both days.
const ISSUE = {
  holdings: [['Cash', 'CHF'], ['Dollars', 'USD']],
  figures: [['Cash', '2026-06-01', '100'], ['Cash', '2026-09-15', '250'], ['Dollars', '2026-06-01', '10'], ['Dollars', '2026-09-15', '20']],
  prices: [['USD', '2026-06-01', '0.9'], ['USD', '2026-09-15', '0.8']],
};

await check('net-worth-view 76: with the last recording on 2026-09-15 and today 2026-10-03 the chart ends on 2026-10-03', () =>
  noon('2026-10-03', () => {
    const vault = model(ISSUE);
    assert.equal(vault.chartLastDate(), '2026-10-03');
    for (const [label, span] of Object.entries(SPANS)) {
      const range = vault.chartRange(span);
      assert.equal(range.lastDay, day('2026-10-03'), label);
      assert.equal(edge(vault, range).last, day('2026-10-03'), `${label}: the line's last point`);
    }
  }));

await check('net-worth-view 76: 1M starts on 2026-09-03, 6M and 1Y and All on the first recording', () =>
  noon('2026-10-03', () => {
    const vault = model(ISSUE);
    assert.equal(vault.chartRange(SPANS['1M']).fromDay, day('2026-09-03'));
    for (const label of ['6M', '1Y', 'All']) assert.equal(vault.chartRange(SPANS[label]).fromDay, day('2026-06-01'), label);
  }));

await check('net-worth-view 76: the last figure runs level from the last recording to today, and today is the total', () =>
  noon('2026-10-03', () => {
    const vault = model(ISSUE);
    const total = decimal.format(vault.totals().net);
    assert.equal(total, '266');
    const off = [];
    for (let d = day('2026-09-15'); d <= day('2026-10-03'); d += 1) if (net(vault, d) !== total) off.push(d);
    assert.deepEqual(off, []);
    assert.equal(edge(vault, vault.chartRange(SPANS['1M'])).net, total);
  }));

await check("net-worth-view: today is the device's calendar day, ahead of UTC or behind it", async () => {
  for (const [instant, zone, local] of [
    ['2026-10-03T22:30:00Z', 'Europe/Zurich', '2026-10-04'],
    ['2026-10-03T13:00:00Z', 'Pacific/Auckland', '2026-10-04'],
    ['2026-10-04T03:00:00Z', 'America/Los_Angeles', '2026-10-03'],
  ]) {
    await at(instant, zone, () => {
      const vault = model(ISSUE);
      assert.equal(vault.chartLastDate(), local, zone);
      assert.equal(vault.chartRange(SPANS['1M']).lastDay, day(local), zone);
    });
  }
});

await check('net-worth-view: a misdated figure or price leaves the chart ending today', () =>
  noon('2026-10-03', () => {
    const vault = model({
      ...ISSUE,
      figures: [...ISSUE.figures, ['Cash', '2026-10-04', '9'], ['Cash', '2099-01-01', '9'], ['Cash', '2026-02-30', '9']],
      prices: [...ISSUE.prices, ['USD', '2026-10-04', '5'], ['USD', '2099-01-01', '5']],
    });
    assert.equal(vault.chartLastDate(), '2026-10-03');
    assert.equal(vault.chartRange(null).lastDay, day('2026-10-03'));
    assert.equal(net(vault, day('2026-10-03')), '266');
  }));

await check('net-worth-view: an archive dated after today ends the chart at the archive, and its point is the total', () =>
  noon('2026-10-03', () => {
    // Archived on a device already on 2026-10-05, its zero at a date
    // this device has not reached.
    const vault = model({
      holdings: [['Cash', 'CHF'], ['Old', 'CHF', '2026-10-05']],
      figures: [['Cash', '2026-06-01', '100'], ['Old', '2026-06-01', '40'], ['Old', '2026-10-05', '0']],
    });
    assert.equal(vault.chartLastDate(), '2026-10-05');
    const range = vault.chartRange(SPANS['1M']);
    assert.deepEqual(range, { fromDay: day('2026-09-05'), lastDay: day('2026-10-05') });
    assert.equal(edge(vault, range).net, decimal.format(vault.totals().net));
    assert.equal(edge(vault, range).net, '100');
  }));

await check('net-worth-view 49: an archive after the newest recording and before today falls inside the chart, the point there equals the total, and the chart still ends today', () =>
  noon('2026-10-03', () => {
    const vault = model({
      holdings: [['Cash', 'CHF'], ['Old', 'CHF', '2026-09-20']],
      figures: [['Cash', '2026-06-01', '100'], ['Cash', '2026-09-15', '250'], ['Old', '2026-06-01', '40'], ['Old', '2026-09-20', '0']],
    });
    const total = decimal.format(vault.totals().net);
    assert.equal(total, '250');
    const range = vault.chartRange(SPANS['1M']);
    assert.equal(range.lastDay, day('2026-10-03'));
    const { days, bands } = vault.series(null, range.fromDay, range.lastDay);
    const at = days.indexOf(day('2026-09-20'));
    assert.ok(at >= 0, 'the archive date is a sample');
    assert.equal(decimal.format(bands.reduce((sum, band) => sum + band.points[at], 0n)), total);
    // Through its zero: the day before the archive still holds part of it.
    const before = Number(net(vault, day('2026-09-19')));
    assert.ok(before > 250 && before < 290, String(before));
    assert.equal(edge(vault, range).net, total);
  }));

await check("net-worth-view 48: a holding archived on the chart's last day, today, leaves its last point and the value there equal to the total on latest rates", () =>
  noon('2026-10-03', () => {
    const vault = model({
      holdings: [['Cash', 'CHF'], ['Dollars', 'USD'], ['Old', 'USD', '2026-10-03']],
      figures: [['Cash', '2026-06-01', '100'], ['Dollars', '2026-06-01', '10'], ['Old', '2026-06-01', '40'], ['Old', '2026-10-03', '0']],
      prices: [['USD', '2026-06-01', '0.9'], ['USD', '2026-10-03', '0.85']],
    });
    const total = decimal.format(vault.totals('latest').net);
    assert.equal(total, '108.5');
    for (const [label, span] of Object.entries(SPANS)) {
      const range = vault.chartRange(span);
      assert.equal(range.lastDay, day('2026-10-03'), label);
      assert.equal(edge(vault, range).net, total, label);
      assert.equal(net(vault, range.lastDay), total, label);
    }
  }));

await check('net-worth-view: a history recorded only today is that one day under every range', () =>
  noon('2026-10-03', () => {
    const vault = model({ holdings: [['Cash', 'CHF']], figures: [['Cash', '2026-10-03', '100']] });
    for (const [label, span] of Object.entries(SPANS)) {
      assert.deepEqual(vault.chartRange(span), { fromDay: day('2026-10-03'), lastDay: day('2026-10-03') }, label);
    }
  }));

await check('net-worth-view: a single recording before today runs from its day to today, never further back', () =>
  noon('2026-10-03', () => {
    const vault = model({
      holdings: [['Cash', 'CHF'], ['Dollars', 'USD']],
      figures: [['Cash', '2026-09-15', '100']],
      prices: [['USD', '2025-01-15', '0.9']],
    });
    for (const [label, span] of Object.entries(SPANS)) {
      assert.deepEqual(vault.chartRange(span), { fromDay: day('2026-09-15'), lastDay: day('2026-10-03') }, label);
    }
  }));

await check('net-worth-view: a range shorter than the history counts back from today, whatever the newest recording', () =>
  noon('2027-03-01', () => {
    const vault = model(ISSUE);
    assert.deepEqual(vault.chartRange(SPANS['1M']), { fromDay: day('2027-03-01') - 30, lastDay: day('2027-03-01') });
    assert.deepEqual(vault.chartRange(SPANS['6M']), { fromDay: day('2027-03-01') - 183, lastDay: day('2027-03-01') });
    assert.deepEqual(vault.chartRange(SPANS['1Y']), { fromDay: day('2026-06-01'), lastDay: day('2027-03-01') });
    // The whole 1M range lies after the last recording, level at the total.
    const range = vault.chartRange(SPANS['1M']);
    const { bands } = vault.series(null, range.fromDay, range.lastDay);
    const sums = bands[0].points.map((_, i) => decimal.format(bands.reduce((s, b) => s + b.points[i], 0n)));
    assert.deepEqual([...new Set(sums)], ['266']);
  }));

await check('net-worth-view: with no snapshot there is no chart range', () =>
  noon('2026-10-03', () => {
    const vault = model({ holdings: [['Cash', 'CHF']], prices: [['USD', '2026-09-15', '0.9']] });
    assert.equal(vault.chartRange(null), null);
  }));

for (const [status, name] of results) console.log(`${status} ${name}`);
process.exitCode = results.some(([status]) => status === 'FAIL') ? 1 : 0;
