// How figures and dates are written for one reader
// (spec/ui/settings.md, Dates and numbers).
//
// The locale supplies defaults and the reader overrides what they
// care about, because a locale is a coarse guess about taste: a Swiss
// reader may want an apostrophe between thousands and no centimes at
// all, which no locale tag expresses. Every setting here is display
// only. Stored figures stay exact at scale 12 and stored dates stay
// ISO, so changing any of this rewrites nothing.
import * as decimal from './decimal.js';

export const GROUPS = [
  { value: 'locale', label: "Whatever the language does" },
  { value: 'thin', label: "1 234 567", separator: ' ' },
  { value: 'apostrophe', label: "1'234'567", separator: "'" },
  { value: 'comma', label: '1,234,567', separator: ',' },
  { value: 'period', label: '1.234.567', separator: '.' },
  { value: 'none', label: '1234567', separator: '' },
];

export const PLACES = [
  { value: 'locale', label: 'Whatever the currency does' },
  { value: '0', label: 'None, rounded to whole units' },
  { value: '2', label: 'Two' },
];

export const DATE_STYLES = [
  { value: 'locale', label: "Whatever the language does" },
  { value: 'dmy', label: '20.09.2026', order: ['day', 'month', 'year'], sep: '.' },
  { value: 'ymd', label: '2026-09-20', order: ['year', 'month', 'day'], sep: '-' },
  { value: 'mdy', label: '09/20/2026', order: ['month', 'day', 'year'], sep: '/' },
];

/** What the browser says the reader reads, which is the default for
 *  every setting below and the only one available before a vault is
 *  open. */
export function browserLocale() {
  const tag = (navigator.languages && navigator.languages[0]) || navigator.language;
  return supported(tag) ? tag : 'en-US';
}

function supported(tag) {
  if (!tag) return false;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0;
  } catch {
    return false;
  }
}

/** The separators a locale itself uses, read out of Intl rather than
 *  tabulated here: a table of them would be a second, staler copy of
 *  what the engine already knows. */
function localeParts(locale) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.8);
  const find = (type) => (parts.find((p) => p.type === type) || {}).value;
  return { group: find('group') || ' ', point: find('decimal') || '.' };
}

/** The order and separator a locale writes a plain numeric date in,
 *  which is what the picker has to accept back. */
function localeOrder(locale) {
  const parts = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(Date.UTC(2026, 8, 20));
  const order = parts.filter((p) => p.type !== 'literal').map((p) => p.type);
  const literal = parts.find((p) => p.type === 'literal');
  const sep = literal ? literal.value.trim() || '.' : '.';
  const known = ['day', 'month', 'year'];
  if (order.length !== 3 || !order.every((t) => known.includes(t))) {
    return { order: known, sep: '.' };
  }
  return { order, sep };
}

/** Everything a screen needs to write a figure or a date, built once
 *  per read of the profile. `profile` may be null, before a vault is
 *  open or during registration. */
export function formatter(profile) {
  const settings = profile || {};
  const locale = supported(settings.locale) ? settings.locale : browserLocale();
  const fromLocale = localeParts(locale);

  const chosen = GROUPS.find((g) => g.value === settings.groupSeparator);
  const group = chosen && chosen.value !== 'locale' ? chosen.separator : fromLocale.group;
  // A separator that is also the decimal point would make 1.234
  // ambiguous, so the locale's own pairing wins over the override.
  const point = group === fromLocale.point ? otherPoint(fromLocale.point) : fromLocale.point;

  const places = settings.moneyPlaces === '0' || settings.moneyPlaces === '2'
    ? Number(settings.moneyPlaces)
    : 2;

  const style = DATE_STYLES.find((d) => d.value === settings.dateStyle);
  const date = style && style.value !== 'locale'
    ? { order: style.order, sep: style.sep }
    : localeOrder(locale);

  return {
    locale,
    group,
    point,
    places,
    dateOrder: date.order,
    dateSeparator: date.sep,

    /** A figure denominated in a currency, at the reader's precision. */
    money: (value) => decimal.toDisplay(value, places, group, point),

    /** A quantity of something that is not money: ounces of gold,
     *  square metres. Its precision is the unit's, never the money
     *  setting, because rounding 12.5 ounces to 13 loses the holding.
     */
    quantity: (value) => decimal.toDisplay(value, 2, group, point),

    /** A rate, which needs more places than money: a currency pair
     *  moves in the fourth decimal. */
    rate: (value) => decimal.toDisplay(value, 6, group, point),

    /** A stored ISO date, written the way this reader reads one. */
    date: (iso) => writeDate(iso, date.order, date.sep),

    /** The same date with the month spelled, for prose where a run of
     *  digits would read as a figure. */
    longDate: (iso) =>
      iso
        ? new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : '',

    /** What an empty date field should show it expects. */
    datePlaceholder: () =>
      date.order.map((part) => (part === 'year' ? 'yyyy' : part === 'month' ? 'mm' : 'dd')).join(date.sep),

    /** The reverse of `date`, for what the reader types. Returns an
     *  ISO date or null, and never guesses: a two-digit year and an
     *  impossible day are both refused. */
    parseDate: (typed) => readDate(typed, date.order),
  };
}

function otherPoint(point) {
  return point === '.' ? ',' : '.';
}

function writeDate(iso, order, sep) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  const by = { year, month, day };
  return order.map((part) => by[part]).join(sep);
}

function readDate(typed, order) {
  const digits = String(typed).trim().split(/[^0-9]+/).filter(Boolean);
  if (digits.length !== 3) return null;
  const by = {};
  order.forEach((part, index) => (by[part] = digits[index]));
  if (by.year.length !== 4) return null;
  const year = Number(by.year);
  const month = Number(by.month);
  const day = Number(by.day);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const iso = `${by.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Round-tripped through Date so that 31.02 is refused rather than
  // silently landing in March.
  const parsed = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}
