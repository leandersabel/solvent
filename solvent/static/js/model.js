// The decrypted vault, in memory (spec/features/net-worth-view.md,
// Data flow).
//
// Every record is fetched once on unlock and kept. Writes update this
// model directly rather than refetching, and the one read in the write
// path is the pre-create reload, which a stale model cannot substitute
// for (record-snapshot.md, Creating and reopening are distinct acts).
import * as api from './api.js';
import * as crypto from './crypto.js';
import * as decimal from './decimal.js';
import { formatter as makeFormatter } from './format.js';

export const RECORD_TYPES = ['profile', 'account', 'snapshot', 'rate'];
export const SCHEMA_VERSION = 1;
export const IDLE_LOCK_PERIODS = [5, 10, 15, 30, 45, 60];

export function dayNumber(isoDate) {
  return Math.round(Date.parse(isoDate + 'T00:00:00Z') / 86400000);
}

export function isoFromDay(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

function byDate(a, b) {
  return a.payload.date < b.payload.date ? -1 : a.payload.date > b.payload.date ? 1 : 0;
}

export class Vault {
  constructor(dek) {
    this.dek = dek;
    this.profile = null;
    this.profileRecord = null;
    this.holdings = new Map();
    this.snapshots = new Map();
    this.rates = new Map();
    // The operator's symbol table, which says of each unit whether it
    // is a currency and what it is called (rate-lookup.md).
    this.symbols = new Map();
    // Skipped and counted rather than guessed at: an unreadable record
    // is the AAD-binding tripwire firing, and it is surfaced rather
    // than swallowed (net-worth-view.md).
    this.unreadable = [];
  }

  async load() {
    const byType = {};
    for (const type of RECORD_TYPES) {
      byType[type] = await api.get(`/api/records?type=${type}`);
    }
    // A table that would not load leaves every unit read as typed,
    // which costs its name and nothing else.
    const symbols = await api.get('/api/rates/symbols').catch(() => []);
    this.symbols = new Map(symbols.map((row) => [row.symbol, row]));
    this.profile = null;
    this.profileRecord = null;
    this.holdings.clear();
    this.snapshots.clear();
    this.rates.clear();
    this.unreadable = [];

    for (const type of RECORD_TYPES) {
      for (const record of byType[type]) {
        const entry = await this._decrypt(record);
        if (entry) this._index(entry);
      }
    }
    this._sortSeries();
    // Oldest first, so every list of holdings reads in the order they
    // were added.
    this.holdings = new Map(
      [...this.holdings].sort(([idA, a], [idB, b]) =>
        (a.payload.createdAt || '').localeCompare(b.payload.createdAt || '') || idA.localeCompare(idB),
      ),
    );
    return this;
  }

  /** The profile record alone, read again after a write lost to
   *  another tab (design-system.md, States, A conflict). */
  async reloadProfile() {
    for (const record of await api.get('/api/records?type=profile')) {
      const entry = await this._decrypt(record);
      if (entry) this._index(entry);
    }
  }

  async _decrypt(record) {
    // A schema_version above what this client knows is unreadable
    // rather than guessed at: guessing at a future shape is how data
    // gets silently corrupted.
    if (record.schemaVersion > SCHEMA_VERSION) {
      this.unreadable.push(record.recordId);
      return null;
    }
    try {
      const payload = migrate(record.recordType, record.schemaVersion, await crypto.decryptRecord(this.dek, record));
      return { ...record, payload };
    } catch {
      this.unreadable.push(record.recordId);
      return null;
    }
  }

  _index(entry) {
    if (entry.recordType === 'profile') {
      // A second profile is a client bug the API does not police, so
      // the highest version is authoritative.
      if (!this.profileRecord || entry.version > this.profileRecord.version) {
        this.profileRecord = entry;
        this.profile = entry.payload;
      }
      return;
    }
    if (entry.recordType === 'account') {
      this.holdings.set(entry.recordId, entry);
      return;
    }
    if (entry.recordType === 'snapshot') {
      push(this.snapshots, entry.accountId, entry);
      return;
    }
    push(this.rates, entry.payload.symbol, entry);
  }

  _sortSeries() {
    for (const list of this.snapshots.values()) list.sort(byDate);
    for (const list of this.rates.values()) list.sort(byDate);
  }

  get mainCurrency() {
    return this.profile ? this.profile.mainCurrency : null;
  }

  /** How this reader writes figures and dates (static/js/format.js).
   *  Rebuilt whenever the profile record changes, because every
   *  setting behind it lives in that record. */
  get format() {
    if (!this._format || this._formatFrom !== this.profile) {
      this._format = makeFormatter(this.profile);
      this._formatFrom = this.profile;
    }
    return this._format;
  }

  /** A figure in the main currency, the code ahead of the amount. */
  mainMoney(value) {
    return `${this.mainCurrency} ${this.format.money(value)}`;
  }

  /** The same, rounded to whole units for a summary figure. */
  mainWhole(value) {
    return `${this.mainCurrency} ${this.format.whole(value)}`;
  }

  /** How a unit reads, from the symbol table. A currency is written
   *  by its code ahead of a figure, anything else by its short unit
   *  after it: the part of the canonical symbol after the hyphen
   *  ("XAU-ozt" reads "ozt"). The table's label names it, the part
   *  before a comma being the thing and the part after the unit it is
   *  counted in ("Gold, troy ounce"). A unit the table does not list
   *  is free text and reads exactly as typed. */
  unitOf(symbol) {
    const row = this.symbols.get(symbol);
    const currency = row ? row.kind === 'currency' : symbol === this.mainCurrency;
    const [name, counted] = row ? row.label.split(', ') : [symbol];
    const short = row && !currency && symbol.includes('-') ? symbol.split('-').pop() : symbol;
    return { symbol, currency, name, short, one: currency ? `1 ${symbol}` : `1 ${counted || short}` };
  }

  /** A quantity with its unit: "CHF 48’210.35", "12.50 ozt". */
  amount(value, symbol) {
    const unit = this.unitOf(symbol);
    const figure = this.format.quantity(value);
    return unit.currency ? `${unit.symbol} ${figure}` : `${figure} ${unit.short}`;
  }

  /** The offered period nearest the stored one, the shorter on a tie
   *  (account-settings.md, Session and lock). */
  get idleLockMinutes() {
    const stored = this.profile && this.profile.idleLockMinutes;
    if (typeof stored !== 'number' || !Number.isFinite(stored)) return 15;
    return IDLE_LOCK_PERIODS.reduce((best, period) =>
      Math.abs(period - stored) < Math.abs(best - stored) ? period : best,
    );
  }

  get dimensions() {
    return (this.profile && this.profile.dimensions) || [];
  }

  activeDimensions() {
    return this.dimensions.filter((d) => !d.archivedAt);
  }

  activeHoldings() {
    return [...this.holdings.values()].filter((h) => !h.payload.archivedAt);
  }

  /** The distinct units the next recording refreshes: every active
   *  holding's unit, minus the main currency, whose rate is 1 by
   *  definition and is stored nowhere (record-rate.md, The refresh). */
  unitsToRefresh() {
    const units = new Set(this.activeHoldings().map((h) => h.payload.unit));
    units.delete(this.mainCurrency);
    return [...units].sort();
  }

  /** The units a recording at `date` would still price: those the
   *  refresh covers with no entry at that date. A date whose prices are
   *  complete asks the proxy nothing (record-rate.md, The refresh). */
  missingUnits(date) {
    return this.unitsToRefresh().filter(
      (unit) => !this.entriesFor(unit).some((entry) => entry.payload.date === date),
    );
  }

  /** Whether the proxy can propose a price for this unit at all. A
   *  free-text unit, or a symbol with lookup off, has no rate source,
   *  so nothing is ever requested for it. */
  quotable(unit) {
    const row = this.symbols.get(unit);
    return Boolean(row && row.lookup);
  }

  /** The unit's last usable entry before `date`: the figure a line with
   *  nothing at its own date carries. */
  carriedRate(unit, date) {
    return [...this.usableEntries(unit)].reverse().find((e) => e.payload.date < date) || null;
  }

  /** Replace every record of one type with a fresh read of it: the
   *  reload a Conflict costs (record-api.md, Endpoints), and the one a
   *  refused create shows the person. */
  replaceType(type, entries) {
    const map = type === 'snapshot' ? this.snapshots : this.rates;
    map.clear();
    for (const entry of entries) this._index(entry);
    this._sortSeries();
  }

  snapshotsFor(accountId) {
    return this.snapshots.get(accountId) || [];
  }

  entriesFor(symbol) {
    return this.rates.get(symbol) || [];
  }

  /** Entries that are safe to read: a (symbol, date) carrying two
   *  differing figures drops out of the series until it is answered,
   *  rather than the chart picking a number nobody chose. */
  usableEntries(symbol) {
    const flagged = this.duplicateRateDates(symbol);
    if (!flagged.size) return this.entriesFor(symbol);
    return this.entriesFor(symbol).filter((e) => !flagged.has(e.payload.date));
  }

  usableSnapshots(accountId) {
    const flagged = this.duplicateSnapshotDates(accountId);
    if (!flagged.size) return this.snapshotsFor(accountId);
    return this.snapshotsFor(accountId).filter((s) => !flagged.has(s.payload.date));
  }

  duplicateSnapshotDates(accountId) {
    return duplicateDates(this.snapshotsFor(accountId));
  }

  duplicateRateDates(symbol) {
    return duplicateDates(this.entriesFor(symbol));
  }

  /** Every (symbol, date) holding two entries whose payloads are
   *  byte-identical: pure duplication the client may resolve, because
   *  nothing can be lost (record-rate.md, Two entries on one date). */
  redundantRateEntries() {
    const extra = [];
    for (const entries of this.rates.values()) {
      const seen = new Map();
      for (const entry of entries) {
        const key = JSON.stringify(entry.payload);
        if (seen.has(key)) extra.push(entry);
        else seen.set(key, entry);
      }
    }
    return extra;
  }

  latestSnapshot(accountId) {
    const list = this.usableSnapshots(accountId);
    return list.length ? list[list.length - 1] : null;
  }

  /** The greatest `date` in the symbol's series, never the most
   *  recently written (record-rate.md, Reading). */
  latestPrice(unit) {
    if (unit === this.mainCurrency) return { rate: decimal.ONE, date: null };
    const entries = this.usableEntries(unit);
    if (!entries.length) return null;
    const last = entries[entries.length - 1];
    return { rate: decimal.parse(last.payload.rate), date: last.payload.date };
  }

  /** The greatest `date` at or before `on`: what the holding was
   *  priced at when its quantity was last recorded. */
  priceOn(unit, on) {
    if (unit === this.mainCurrency) return { rate: decimal.ONE, date: null };
    const entries = this.usableEntries(unit);
    let found = null;
    for (const entry of entries) {
      if (entry.payload.date <= on) found = entry;
    }
    if (!found) return null;
    return { rate: decimal.parse(found.payload.rate), date: found.payload.date };
  }

  /** The newest rate date anywhere in the vault, which is the date the
   *  hero's "Latest rates" label carries: recording anything refreshes
   *  every rate, so there is one such date rather than one per
   *  holding (ui/dashboard.md). */
  newestRateDate() {
    let newest = null;
    for (const entries of this.rates.values()) {
      for (const entry of entries) {
        if (!newest || entry.payload.date > newest) newest = entry.payload.date;
      }
    }
    return newest;
  }

  /** One holding's contribution, or a reason it has none. `mode` is
   *  'latest' or 'asRecorded' (net-worth-view.md, Current net worth). */
  valueOf(holding, mode = 'latest') {
    const snapshot = this.latestSnapshot(holding.recordId);
    if (!snapshot) return { state: 'unvalued' };
    const quantity = decimal.parse(snapshot.payload.value);
    const price =
      mode === 'asRecorded'
        ? this.priceOn(holding.payload.unit, snapshot.payload.date)
        : this.latestPrice(holding.payload.unit);
    if (!price) {
      return { state: 'unpriced', quantity, asOf: snapshot.payload.date };
    }
    return {
      state: 'valued',
      quantity,
      asOf: snapshot.payload.date,
      priceDate: price.date,
      converted: decimal.multiply(quantity, price.rate),
    };
  }

  /** A signed sum. Gross assets and gross liabilities are carried
   *  separately, because net worth hides both sides in one figure. */
  totals(mode = 'latest') {
    let assets = decimal.ZERO;
    let liabilities = decimal.ZERO;
    let valued = 0;
    for (const holding of this.activeHoldings()) {
      const value = this.valueOf(holding, mode);
      if (value.state !== 'valued') continue;
      valued += 1;
      if (value.converted < 0n) liabilities += value.converted;
      else assets += value.converted;
    }
    return { assets, liabilities, net: assets + liabilities, valued };
  }

  /** Every date carrying at least one snapshot: the chart's entry
   *  marks. A tick means a quantity, never a price. */
  quantityDates() {
    const dates = new Set();
    for (const list of this.snapshots.values()) {
      for (const snapshot of list) dates.add(snapshot.payload.date);
    }
    return [...dates].sort();
  }

  /** Every date carrying any record of the person's: what the date
   *  picker marks, including a recording whose figures were all
   *  cleared but whose prices are still captured. */
  recordingDates() {
    const dates = new Set(this.quantityDates());
    for (const list of this.rates.values()) {
      for (const entry of list) dates.add(entry.payload.date);
    }
    return [...dates].sort();
  }

  /** Whether any record carries this date. A recording exists exactly
   *  as long as one does (record-snapshot.md, A recording is a date). */
  holdsRecording(date) {
    const { figures, prices } = this.recording(date);
    return figures.length > 0 || prices.length > 0;
  }

  /** Everything bearing one date: a client-side index over the model,
   *  never a stored thing (record-snapshot.md, A recording is a
   *  date). */
  recording(date) {
    const figures = [];
    for (const [accountId, list] of this.snapshots) {
      for (const snapshot of list) {
        if (snapshot.payload.date === date) {
          figures.push({ holding: this.holdings.get(accountId), snapshot });
        }
      }
    }
    const prices = [];
    for (const list of this.rates.values()) {
      for (const entry of list) {
        if (entry.payload.date === date) prices.push(entry);
      }
    }
    return { date, figures, prices };
  }

  /** A holding's quantity at a chart date: linearly interpolated
   *  between its own snapshots, nothing before its first, carried
   *  forward after its last. */
  quantityAt(accountId, day) {
    const list = this.usableSnapshots(accountId);
    if (!list.length) return null;
    let previous = null;
    for (const snapshot of list) {
      const at = dayNumber(snapshot.payload.date);
      if (at === day) return decimal.parse(snapshot.payload.value);
      if (at > day) {
        if (!previous) return null;
        return decimal.interpolate(
          day,
          dayNumber(previous.payload.date),
          decimal.parse(previous.payload.value),
          at,
          decimal.parse(snapshot.payload.value),
        );
      }
      previous = snapshot;
    }
    return decimal.parse(previous.payload.value);
  }

  /** A unit's price at a chart date: interpolated between entries,
   *  carried forward after the last and **backward** before the
   *  first. The asymmetry with quantity is deliberate: a price series
   *  samples something that existed before anyone started sampling
   *  it. */
  priceAt(unit, day) {
    if (unit === this.mainCurrency) return decimal.ONE;
    const list = this.usableEntries(unit);
    if (!list.length) return null;
    let previous = null;
    for (const entry of list) {
      const at = dayNumber(entry.payload.date);
      if (at === day) return decimal.parse(entry.payload.rate);
      if (at > day) {
        if (!previous) return decimal.parse(entry.payload.rate);
        return decimal.interpolate(
          day,
          dayNumber(previous.payload.date),
          decimal.parse(previous.payload.rate),
          at,
          decimal.parse(entry.payload.rate),
        );
      }
      previous = entry;
    }
    return decimal.parse(previous.payload.rate);
  }

  /** Which band a holding falls in for a dimension. A holding with no
   *  entry, or one naming an archived or unknown value, is
   *  "Unassigned": a real band, never hidden, or the bands would not
   *  sum to the total. */
  bandOf(holding, dimension) {
    if (!dimension) return { id: 'total', label: 'Total' };
    const valueId = (holding.payload.dims || {})[dimension.id];
    const value = dimension.values.find((v) => v.id === valueId && !v.archivedAt);
    if (!value) return { id: 'unassigned', label: 'Unassigned' };
    return { id: value.id, label: value.label };
  }

  /** Coverage: how many active holdings carry a value for this
   *  dimension. A dimension covering three of ten produces a chart
   *  that is correct and useless, and this is what says why. */
  coverage(dimension) {
    const holdings = this.activeHoldings();
    const assigned = holdings.filter(
      (h) => this.bandOf(h, dimension).id !== 'unassigned',
    );
    return { assigned: assigned.length, total: holdings.length };
  }

  /** Per-holding interpolation summed into bands, never interpolation
   *  of an already-summed series: holdings start at different dates
   *  and summing first would smear one holding's first snapshot across
   *  the rest.
   *
   *  Each band carries its two sides apart as well as its net:
   *  `assets` sums the holdings standing above zero on a day and
   *  `liabilities` those below it, so a mortgage and the flat it is
   *  secured on are both drawn rather than cancelling into one
   *  figure (net-worth-view.md, Assets and liabilities). */
  series(dimension, fromDay, toDay) {
    const holdings = [...this.holdings.values()];
    const sampleDays = new Set([fromDay, toDay]);
    for (const holding of holdings) {
      for (const snapshot of this.usableSnapshots(holding.recordId)) {
        sampleDays.add(dayNumber(snapshot.payload.date));
      }
      for (const entry of this.usableEntries(holding.payload.unit)) {
        sampleDays.add(dayNumber(entry.payload.date));
      }
      if (holding.payload.archivedAt) {
        sampleDays.add(dayNumber(holding.payload.archivedAt));
      }
    }
    const days = [...sampleDays]
      .filter((day) => day >= fromDay && day <= toDay)
      .sort((a, b) => a - b);

    const bands = new Map();
    for (const holding of holdings) {
      const band = this.bandOf(holding, dimension);
      if (!bands.has(band.id)) {
        bands.set(band.id, {
          ...band,
          points: days.map(() => decimal.ZERO),
          assets: days.map(() => decimal.ZERO),
          liabilities: days.map(() => decimal.ZERO),
        });
      }
      const { points, assets, liabilities } = bands.get(band.id);
      const archived = holding.payload.archivedAt
        ? dayNumber(holding.payload.archivedAt)
        : null;
      days.forEach((day, index) => {
        if (archived !== null && day > archived) return;
        const quantity = this.quantityAt(holding.recordId, day);
        if (quantity === null) return;
        const price = this.priceAt(holding.payload.unit, day);
        if (price === null) return;
        const value = decimal.multiply(quantity, price);
        points[index] += value;
        if (value < 0n) liabilities[index] += value;
        else assets[index] += value;
      });
    }

    return { days, bands: orderBands(bands, dimension) };
  }
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function duplicateDates(entries) {
  const seen = new Set();
  const twice = new Set();
  for (const entry of entries) {
    if (seen.has(entry.payload.date)) twice.add(entry.payload.date);
    seen.add(entry.payload.date);
  }
  return twice;
}

/** Band order is the dimension's configured value order, never sorted
 *  by size: a stack whose bands reorder over time cannot be read.
 *  Past four, the remainder folds into "Other". */
function orderBands(bands, dimension) {
  if (!dimension) return [...bands.values()];
  const ordered = [];
  for (const value of dimension.values) {
    if (value.archivedAt) continue;
    if (bands.has(value.id)) ordered.push(bands.get(value.id));
  }
  const rest = ordered.splice(4);
  if (bands.has('unassigned')) ordered.push(bands.get('unassigned'));
  if (rest.length) {
    const sum = (side) =>
      rest[0][side].map((_, index) => rest.reduce((total, band) => total + band[side][index], 0n));
    const other = {
      id: 'other',
      label: 'Other',
      points: sum('points'),
      assets: sum('assets'),
      liabilities: sum('liabilities'),
    };
    ordered.push(other);
  }
  return ordered;
}

/** The ordered chain of pure migration functions, run in memory on
 *  read and never written back (record-api.md, Schema migration).
 *  Version 1 is the current shape and there is nothing below it, so
 *  the chain is empty and the same chain is reused by import. */
const MIGRATIONS = {};

export function migrate(recordType, fromVersion, payload) {
  let current = payload;
  for (let version = fromVersion; version < SCHEMA_VERSION; version++) {
    const step = (MIGRATIONS[recordType] || {})[version];
    if (step) current = step(current);
  }
  return current;
}
