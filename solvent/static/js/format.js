// How figures and dates are written for one reader
// (spec/features/account-settings.md, Settings, Dates and numbers).
//
// The locale supplies defaults and the reader overrides what they
// care about, because a locale is a coarse guess about taste: a Swiss
// reader may want an apostrophe between thousands and no centimes at
// all, which no locale tag expresses. Every setting here is display
// only. Stored figures stay exact at scale 12 and stored dates stay
// ISO, so changing any of this rewrites nothing.
import * as decimal from './decimal.js';

export const GROUPS = [
  { value: 'locale', label: 'The language\u2019s own mark' },
  { value: 'thin', label: "1 234 567", separator: ' ' },
  { value: 'apostrophe', label: '1\u2019234\u2019567', separator: '\u2019' },
  { value: 'comma', label: '1,234,567', separator: ',' },
  { value: 'period', label: '1.234.567', separator: '.' },
  { value: 'none', label: '1234567', separator: '' },
];

export const PLACES = [
  { value: 'locale', label: 'The currency\u2019s own' },
  { value: '0', label: 'None' },
  { value: '2', label: 'Two' },
];

export const DATE_STYLES = [
  { value: 'locale', label: 'The language\u2019s own order' },
  { value: 'dmy', label: '20.09.2026', order: ['day', 'month', 'year'], sep: '.' },
  { value: 'ymd', label: '2026-09-20', order: ['year', 'month', 'day'], sep: '-' },
  { value: 'mdy', label: '09/20/2026', order: ['month', 'day', 'year'], sep: '/' },
];

/** What the browser says the reader reads, which is the default for
 *  every setting below and the only one available before a vault is
 *  open. */
function browserLocale() {
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
  const picked = chosen && chosen.value !== 'locale' ? chosen.separator : fromLocale.group;
  // The point is always the language's. A mark that is also that point
  // would make 1.234 ambiguous, so the language's own group mark stands
  // in for it.
  const point = fromLocale.point;
  const group = picked === point ? fromLocale.group : picked;

  const places = settings.moneyPlaces === '0' || settings.moneyPlaces === '2'
    ? Number(settings.moneyPlaces)
    : 2;

  const style = DATE_STYLES.find((d) => d.value === settings.dateStyle);
  // A style the reader chose applies to every date that shows a day,
  // prose and headings included. Only under the language's own order
  // does a date keep its spelled month.
  const chosenStyle = Boolean(style && style.value !== 'locale');
  const date = chosenStyle ? { order: style.order, sep: style.sep } : localeOrder(locale);

  return {
    locale,
    group,
    point,
    places,
    dateOrder: date.order,
    dateSeparator: date.sep,

    /** A figure denominated in a currency, at the reader's precision. */
    money: (value) => decimal.toDisplay(value, places, group, point),

    /** A summary figure, rounded to whole units: the hero, the gross
     *  sides, the legend and the breakdown, where the tables beneath
     *  carry the exact amounts. */
    whole: (value) => decimal.toDisplay(value, 0, group, point),

    /** A percentage at `places`, already a percentage: 12.5 writes
     *  12.5%. It keeps the places its caller asks for, because Decimals
     *  covers money only. */
    percent: (value, places) => decimal.toDisplay(value, places, group, point) + '%',

    /** A value tick on the trend chart, in its short form. */
    compact: (value) => decimal.toCompact(value, group, point),

    /** A rate as a field shows it for editing: grouped, every stored
     *  digit kept, and read back exactly by `parseFigure`. */
    editable: (value, minPlaces = 2) => decimal.toEditable(value, minPlaces, group, point),

    /** What the reader typed into a figure field, with or without
     *  group marks, as an exact scale-12 value, or null. A group mark
     *  counts only between groups of three digits, so a mark typed as
     *  a decimal point is refused rather than read as a thousand. */
    parseFigure: (typed) => {
      const read = readDecimal(typed, group, point);
      return read === null ? null : decimal.parse(read);
    },

    /** A stored decimal string, digit for digit: ounces of gold,
     *  square metres, and every figure a field prefills for editing,
     *  money included. Its digits are what was typed, never the money
     *  setting's, because rounding 12.125 ounces misstates the holding
     *  and a prefill at money places, saved untouched, writes the
     *  rounding. */
    quantity: (stored) => decimal.toStoredDisplay(stored, group, point),

    /** What the reader typed into a quantity field, as the canonical
     *  decimal string, or null. */
    parseQuantity: (typed) => readDecimal(typed, group, point),

    /** What a field that edits a stored figure saves: the stored string
     *  itself while the text still equals its prefill, so nothing is
     *  reparsed and rounded, and what was typed, read, otherwise. */
    readField: (typed, stored) =>
      stored != null && String(typed).trim() === decimal.toStoredDisplay(stored, group, point)
        ? stored
        : readDecimal(typed, group, point),

    /** A stored ISO date, written the way this reader reads one. */
    date: (iso) => writeDate(iso, date.order, date.sep),

    /** The same date with the month spelled, for prose where a run of
     *  digits would read as a figure. Under a chosen style it is the
     *  date in that style, since the style is what the reader asked
     *  every date to look like. */
    longDate: (iso) =>
      chosenStyle ? writeDate(iso, date.order, date.sep) : spelled(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' }),

    /** The month spelled out and the year alone: how far back a
     *  long chart range reaches. */
    monthYear: (iso) => spelled(iso, locale, { month: 'long', year: 'numeric' }),

    /** A date with its month spelled out in full, for a heading. */
    fullDate: (iso) =>
      chosenStyle ? writeDate(iso, date.order, date.sep) : spelled(iso, locale, { day: 'numeric', month: 'long', year: 'numeric' }),

    /** A day and its month, for a label that already implies the year.
     *  A chosen style has no shape without a year, and a rate delay can
     *  cross New Year, so it writes the whole date. */
    dayMonth: (iso, month = 'long') =>
      chosenStyle ? writeDate(iso, date.order, date.sep) : spelled(iso, locale, { day: 'numeric', month }),

    /** A moment, such as when a session started, in this browser's
     *  time zone. */
    dateTime: (timestamp) => {
      const at = new Date(timestamp);
      const day = chosenStyle
        ? writeDate(
            `${String(at.getFullYear()).padStart(4, '0')}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
            date.order,
            date.sep,
          )
        : at.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
      const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      return `${day}, ${time}`;
    },

    /** What an empty date field should show it expects. */
    datePlaceholder: () =>
      date.order.map((part) => (part === 'year' ? 'yyyy' : part === 'month' ? 'mm' : 'dd')).join(date.sep),

    /** The reverse of `date`, for what the reader types. Returns an
     *  ISO date or null, and never guesses: a two-digit year and an
     *  impossible day are both refused. */
    parseDate: (typed) => readDate(typed, date.order),
  };
}

function spelled(iso, locale, parts) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, { ...parts, timeZone: 'UTC' });
}

// Marks a reader types for the one they see: a plain apostrophe for
// the typographic one, and any space for a narrow one.
const SPACES = [' ', '\u2009', '\u202f', '\u00a0'];
const APOSTROPHES = ["'", '\u2019'];

/** The canonical decimal string for what was typed
 *  (spec/features/record-snapshot.md, Record shape), or null. The
 *  point is the configured one, and a period too wherever a period is
 *  not the group mark. */
function readDecimal(typed, group, point) {
  let text = String(typed).trim();
  const negative = /^[-\u2212]/.test(text);
  if (negative) text = text.slice(1);
  const marks = SPACES.includes(group) ? SPACES : APOSTROPHES.includes(group) ? APOSTROPHES : group ? [group] : [];
  if (point !== '.' && !marks.includes('.')) text = text.replaceAll('.', point);
  const [whole, fraction, extra] = text.split(point);
  if (extra !== undefined) return null;
  let digits = whole;
  if (marks.some((mark) => whole.includes(mark))) {
    const grouped = marks.reduce((acc, mark) => acc.split(mark).join('_'), whole);
    if (!/^\d{1,3}(_\d{3})+$/.test(grouped)) return null;
    digits = grouped.replaceAll('_', '');
  }
  if (!/^\d*$/.test(digits) || (fraction !== undefined && !/^\d*$/.test(fraction))) return null;
  if ((!digits && !fraction) || (fraction ?? '').length > decimal.SCALE) return null;
  const canonical = (digits.replace(/^0+(?=\d)/, '') || '0') + (fraction ? '.' + fraction : '');
  return negative && /[1-9]/.test(canonical) ? '-' + canonical : canonical;
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
