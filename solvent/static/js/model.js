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
import { today } from './dom.js';

export const RECORD_TYPES = ['profile', 'account', 'snapshot', 'rate'];
export const SCHEMA_VERSION = 1;
export const IDLE_LOCK_PERIODS = [5, 10, 15, 30, 45, 60];

export function dayNumber(isoDate) {
  return Math.round(Date.parse(isoDate + 'T00:00:00Z') / 86400000);
}

export function isoFromDay(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

/** Whether a figure or a price may carry `date`: a calendar day that
 *  exists, written `YYYY-MM-DD`, and not after `on`, the device's
 *  today (record-snapshot.md, A recording is a date). A figure says
 *  what something was worth on a day that has passed. */
export function isRecordedDay(date, on) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > on) return false;
  const day = dayNumber(date);
  return Number.isFinite(day) && isoFromDay(day) === date;
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
    // Of those, the profile records: settings still, readable or not.
    this.unreadableProfiles = 0;
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
    this.unreadableProfiles = 0;

    for (const type of RECORD_TYPES) {
      for (const record of byType[type]) {
        const entry = await this._decrypt(record);
        if (entry) this._index(entry);
      }
    }
    this._sortSeries();
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
    if (record.schemaVersion > SCHEMA_VERSION) return this._unreadable(record);
    try {
      const payload = migrate(record.recordType, record.schemaVersion, await crypto.decryptRecord(this.dek, record));
      return { ...record, payload };
    } catch {
      return this._unreadable(record);
    }
  }

  _unreadable(record) {
    this.unreadable.push(record.recordId);
    if (record.recordType === 'profile') this.unreadableProfiles += 1;
    return null;
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
    // Oldest first, so every list of holdings reads in the order they
    // were added.
    this.holdings = new Map(
      [...this.holdings].sort(([idA, a], [idB, b]) =>
        (a.payload.createdAt || '').localeCompare(b.payload.createdAt || '') || idA.localeCompare(idB),
      ),
    );
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

  /** How a unit reads, from the symbol table (design-system.md,
   *  Units). A currency is named by its code, written ahead of a
   *  figure. Any other listed unit is named by its whole label ("Gold,
   *  troy ounce"), so grams and troy ounces never read alike, and
   *  written after a figure by the part of the symbol after the hyphen
   *  ("12.5 ozt"). A unit the table does not list is free text and
   *  reads exactly as typed. */
  unitOf(symbol) {
    const row = this.symbols.get(symbol);
    const currency = row ? row.kind === 'currency' : symbol === this.mainCurrency;
    const counted = row && row.label.split(', ')[1];
    const short = row && !currency && symbol.includes('-') ? symbol.split('-').pop() : symbol;
    const name = row && !currency ? row.label : symbol;
    return { symbol, currency, name, short, one: currency ? `1 ${symbol}` : `1 ${counted || short}` };
  }

  /** A unit as a sentence names it. */
  unitName(symbol) {
    return this.unitOf(symbol).name;
  }

  /** A stored value as its unit shows it: money places for a currency,
   *  and for any other unit exactly the stored digits, where rounding
   *  12.125 ounces would misstate the holding. */
  figure(stored, symbol) {
    return this.unitOf(symbol).currency
      ? this.format.money(decimal.parse(stored))
      : this.format.quantity(stored);
  }

  /** A stored value with its unit: "CHF 48’210.35", "12.125 ozt". */
  amount(stored, symbol) {
    const unit = this.unitOf(symbol);
    const figure = this.figure(stored, symbol);
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

  /** The archive's zero: the zero-valued snapshot at an archived
   *  holding's `archivedAt`, in any canonical form of zero. Nothing in
   *  the record marks it, so it is read off the holding
   *  (manage-accounts.md, Archiving). */
  isArchiveZero(holding, snapshot) {
    return (
      Boolean(holding && holding.payload.archivedAt) &&
      snapshot.payload.date === holding.payload.archivedAt &&
      decimal.parse(snapshot.payload.value) === decimal.ZERO
    );
  }

  /** The distinct units the next recording refreshes: every active
   *  holding's unit, minus the main currency, whose rate is 1 by
   *  definition and is stored nowhere (record-rate.md, The refresh).
   *  `also` is a moved entry's own unit, which an archived holding's
   *  entry brings with it. */
  unitsToRefresh(also = null) {
    const units = new Set(this.activeHoldings().map((h) => h.payload.unit));
    if (also) units.add(also);
    units.delete(this.mainCurrency);
    return [...units].sort();
  }

  /** The units a recording at `date` would still price: those the
   *  refresh covers with no entry at that date. A date whose prices are
   *  complete asks the proxy nothing (record-rate.md, The refresh). */
  missingUnits(date, also = null) {
    return this.unitsToRefresh(also).filter(
      (unit) => !this.entriesFor(unit).some((entry) => entry.payload.date === date),
    );
  }

  /** The first date a published price exists for this unit in the main
   *  currency: the later of its `since` and the main currency's, which
   *  Frankfurter's Not Found before its start makes the quote's too.
   *  Null for a unit with no rate source at any date, which is every
   *  unit when no source quotes into the main currency, and '' for one
   *  whose table row carries no date (record-rate.md, Reading). */
  publishedFrom(unit) {
    const row = this.symbols.get(unit);
    const main = this.symbols.get(this.mainCurrency);
    if (!row || !row.lookup || (main && main.since === null)) return null;
    return [row.since, main && main.since].filter(Boolean).sort().pop() || '';
  }

  /** Whether the proxy can propose a price for this unit at `date`. A
   *  free-text unit, a symbol with lookup off, or a date before the
   *  unit's published prices begin has no rate source, so nothing is
   *  ever requested for it. */
  quotable(unit, date) {
    const from = this.publishedFrom(unit);
    return from !== null && date >= from;
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
    ({ account: this.holdings, snapshot: this.snapshots, rate: this.rates })[type].clear();
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
   *  rather than the chart picking a number nobody chose, and so does
   *  an entry at a date that is no recorded day. */
  usableEntries(symbol) {
    return usable(this.entriesFor(symbol), this.duplicateRateDates(symbol));
  }

  usableSnapshots(accountId) {
    return usable(this.snapshotsFor(accountId), this.duplicateSnapshotDates(accountId));
  }

  /** Every figure and price whose date is no recorded day, as
   *  `{ date, label }`: kept where it is, counted in nothing, and
   *  listed so it can be moved or deleted. */
  misdated() {
    const on = today();
    const found = [];
    for (const [accountId, list] of this.snapshots) {
      const holding = this.holdings.get(accountId);
      for (const s of list) {
        if (!isRecordedDay(s.payload.date, on)) found.push({ date: s.payload.date, label: holding ? holding.payload.name : accountId });
      }
    }
    for (const [symbol, list] of this.rates) {
      for (const e of list) {
        if (!isRecordedDay(e.payload.date, on)) found.push({ date: e.payload.date, label: this.unitName(symbol) });
      }
    }
    return found;
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

  /** The price a figure shown at its own date `on` takes
   *  (record-rate.md, Reading). A unit with a rate source has the entry
   *  at exactly that date or none, so a published price is never read
   *  from another day. One without takes its owner's newest estimate at
   *  or before the date, and the `date` it returns says how old that
   *  is. */
  priceAtDate(unit, on) {
    if (unit === this.mainCurrency) return { rate: decimal.ONE, date: null };
    if (!this.quotable(unit, on)) return this.priceOn(unit, on);
    const found = this.usableEntries(unit).find((entry) => entry.payload.date === on);
    return found ? { rate: decimal.parse(found.payload.rate), date: on } : null;
  }

  /** The greatest `date` at or before `on`, whatever the symbol: what
   *  the holding was priced at when its quantity was last recorded
   *  (record-rate.md, Reading, the price as recorded). */
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
   *  holding (net-worth-view.md, Dashboard). */
  newestRateDate() {
    let newest = null;
    for (const symbol of this.rates.keys()) {
      for (const entry of this.usableEntries(symbol)) {
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
      return { state: 'unpriced', quantity, stored: snapshot.payload.value, asOf: snapshot.payload.date };
    }
    return {
      state: 'valued',
      quantity,
      stored: snapshot.payload.value,
      asOf: snapshot.payload.date,
      priceDate: price.date,
      converted: decimal.multiply(quantity, price.rate),
    };
  }

  /** Each valued active holding's converted figure as shown, at the
   *  money places, shared out so the figures add up to the net as
   *  shown (net-worth-view.md, Shown figures). Keyed by holding. */
  shownFigures(mode = 'latest') {
    const valued = this.activeHoldings()
      .map((holding) => [holding, this.valueOf(holding, mode)])
      .filter(([, value]) => value.state === 'valued');
    const shown = decimal.apportion(valued.map(([, value]) => value.converted), this.format.places);
    return new Map(valued.map(([holding], i) => [holding, shown[i]]));
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
    const on = today();
    const dates = new Set();
    for (const list of this.snapshots.values()) {
      for (const snapshot of list) {
        if (isRecordedDay(snapshot.payload.date, on)) dates.add(snapshot.payload.date);
      }
    }
    return [...dates].sort();
  }

  /** Every date carrying any record of the person's: what the date
   *  picker marks, including a recording whose figures were all
   *  cleared but whose prices are still captured. */
  recordingDates() {
    const on = today();
    const dates = new Set(this.quantityDates());
    for (const list of this.rates.values()) {
      for (const entry of list) {
        if (isRecordedDay(entry.payload.date, on)) dates.add(entry.payload.date);
      }
    }
    return [...dates].sort();
  }

  /** The chart's last day: today, or a later archive date, since
   *  every holding is carried forward after its last figure
   *  (net-worth-view.md, Ranges and modes). */
  chartLastDate() {
    const archives = [...this.holdings.values()].map((h) => h.payload.archivedAt).filter(Boolean);
    return [today(), ...archives].sort().at(-1);
  }

  /** The days a range of `span` days shows, counted back from the
   *  chart's last day and stopping at the oldest snapshot, whatever
   *  price entry is older: no band has a value before it. Null while
   *  no snapshot exists (net-worth-view.md, Ranges and modes). */
  chartRange(span) {
    const [oldest] = this.quantityDates();
    if (!oldest) return null;
    const lastDay = dayNumber(this.chartLastDate());
    const firstDay = dayNumber(oldest);
    return { fromDay: span === null ? firstDay : Math.max(firstDay, lastDay - span), lastDay };
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
   *  figure (net-worth-view.md, Assets and liabilities).
   *
   *  A holding's first recording and its archive are steps, not slopes.
   *  A holding archived on D counts on every day before D and on none
   *  from D on, so `points` at D leave it out. Each band also carries
   *  the side `before` a day: without the holdings first recorded on
   *  it, and with the holdings archived on it, at its quantity and
   *  price. The chart draws the step from `before` to the day's value at
   *  that day's x. */
  series(dimension, fromDay, toDay) {
    const sampleDays = new Set([fromDay, toDay]);
    for (const holding of this.holdings.values()) {
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
    return { days, bands: this._bandsAt(dimension, days) };
  }

  /** Each band's value on one calendar day, the side at it: what the
   *  tooltip, the hero under the crosshair and a selection's change
   *  read. Any day is readable, sample or not, from the same model the
   *  drawing is built on (net-worth-view.md, Reading a date). */
  valuesAt(dimension, day) {
    return this._bandsAt(dimension, [day]).map(({ id, label, points }) => ({ id, label, value: points[0] }));
  }

  _bandsAt(dimension, days) {
    const bands = new Map();
    const sides = () => ({ assets: days.map(() => decimal.ZERO), liabilities: days.map(() => decimal.ZERO) });
    for (const holding of this.holdings.values()) {
      const band = this.bandOf(holding, dimension);
      if (!bands.has(band.id)) {
        bands.set(band.id, { ...band, points: days.map(() => decimal.ZERO), ...sides(), before: sides() });
      }
      const { points, assets, liabilities, before } = bands.get(band.id);
      const archived = holding.payload.archivedAt
        ? dayNumber(holding.payload.archivedAt)
        : null;
      const first = this.usableSnapshots(holding.recordId)[0];
      const firstDay = first ? dayNumber(first.payload.date) : null;
      days.forEach((day, index) => {
        if (archived !== null && day > archived) return;
        const quantity = this.quantityAt(holding.recordId, day);
        if (quantity === null) return;
        const price = this.priceAt(holding.payload.unit, day);
        if (price === null) return;
        const value = decimal.multiply(quantity, price);
        const side = value < 0n ? 'liabilities' : 'assets';
        if (day !== firstDay) before[side][index] += value;
        if (day === archived) return;
        points[index] += value;
        ({ assets, liabilities })[side][index] += value;
      });
    }
    return orderBands(bands, dimension);
  }
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function usable(entries, duplicated) {
  const on = today();
  return entries.filter((e) => !duplicated.has(e.payload.date) && isRecordedDay(e.payload.date, on));
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
    const sum = (pick) =>
      rest[0].points.map((_, index) => rest.reduce((total, band) => total + pick(band)[index], 0n));
    const other = {
      id: 'other',
      label: 'Other',
      points: sum((band) => band.points),
      assets: sum((band) => band.assets),
      liabilities: sum((band) => band.liabilities),
      before: { assets: sum((band) => band.before.assets), liabilities: sum((band) => band.before.liabilities) },
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
