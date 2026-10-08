// Money, as BigInt at a fixed scale of twelve decimal places
// (spec/features/record-snapshot.md, Record shape).
//
// No IEEE-754 float touches a value, a rate, or a total at any point.
// Scale 12 covers a rate at eight significant decimals, a holding in
// troy ounces or m², and a currency amount at two, so there is one
// scale rather than a factor per quantity, which would be a decimal
// library written here and worse.

export const SCALE = 12;
const UNIT = 10n ** BigInt(SCALE);

export const ZERO = 0n;
export const ONE = UNIT;

export function parse(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (!match[2] && !match[3])) return null;
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > SCALE) return null;
  const digits = (whole || '0') + fraction.padEnd(SCALE, '0');
  const value = BigInt(digits);
  return sign === '-' ? -value : value;
}

export function format(value) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return (negative ? '-' : '') + whole + (fraction ? '.' + fraction : '');
}

// The integer product of two scale-12 values is scale 24, divided back
// by 10^12 with round-half-even. Addition and subtraction need no
// rescale, which is why a sum of snapshots is exact by construction.
export function multiply(a, b) {
  return rescale(a * b, UNIT);
}

// The quotient of two scale-12 values is a ratio, rescaled up by 10^12
// before the division so it comes back at scale 12, round-half-even.
export function divide(a, b) {
  return rescale(a * UNIT, b);
}

function rescale(numerator, denominator) {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const twiceRemainder = (n % d) * 2n;
  let rounded = quotient;
  if (twiceRemainder > d || (twiceRemainder === d && quotient % 2n === 1n)) {
    rounded += 1n;
  }
  return negative ? -rounded : rounded;
}

// Linear interpolation between two (x, y) points, where x is a day
// number and y a scale-12 value. Used per holding and never on an
// already-summed series (net-worth-view.md, Values between entries).
export function interpolate(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  const span = BigInt(x1 - x0);
  const along = BigInt(x - x0);
  return y0 + rescale((y1 - y0) * along, span);
}

// Display rounding is a separate, later step applied to a figure
// already exact at scale 12. The separators are the reader's, from
// static/js/format.js, and a negative figure takes the true minus
// sign.
export function toDisplay(value, places, group = '\u2009', point = '.') {
  const factor = 10n ** BigInt(SCALE - places);
  const rounded = rescale(value, factor);
  const negative = rounded < 0n;
  const digits = (negative ? -rounded : rounded)
    .toString()
    .padStart(places + 1, '0');
  const whole = places ? digits.slice(0, -places) : digits;
  const fraction = places ? digits.slice(-places) : '';
  return (negative ? '\u2212' : '') + grouped(whole, group) + (fraction ? point + fraction : '');
}

// A chart's value tick: its magnitude over the largest of a thousand, a
// million and a billion that does not exceed it, at most one decimal
// and no trailing zero, then that unit's suffix
// (spec/features/net-worth-view.md, Value ticks).
const SHORT_UNITS = [[10n ** 9n, 'B'], [10n ** 6n, 'M'], [1000n, 'k']];

export function toCompact(value, group, point) {
  const magnitude = value < 0n ? -value : value;
  const [size, suffix] = SHORT_UNITS.find(([unit]) => magnitude >= unit * UNIT) || [1n, ''];
  const tenths = rescale(magnitude * 10n, UNIT * size);
  const fraction = tenths % 10n;
  return (value < 0n && tenths ? '\u2212' : '') + grouped(String(tenths / 10n), group) +
    (fraction ? point + fraction : '') + suffix;
}

function grouped(whole, group) {
  return group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, group) : whole;
}

// A stored decimal string, digit for digit: never rounded, never
// padded (spec/features/account-settings.md, Dates and numbers).
export function toStoredDisplay(stored, group, point) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(stored);
  if (!match) return String(stored);
  const [, sign, whole, fraction] = match;
  return (sign ? '\u2212' : '') + grouped(whole, group) + (fraction ? point + fraction : '');
}

// The form a figure takes in a field the reader edits, which
// static/js/format.js parses back. Every stored digit is kept rather
// than rounded, and the fraction is padded to at least `minPlaces`.
export function toEditable(value, minPlaces, group, point) {
  const [whole, fraction = ''] = format(value < 0n ? -value : value).split('.');
  const places = Math.max(minPlaces, fraction.length);
  const digits = fraction.padEnd(places, '0');
  return (value < 0n ? '\u2212' : '') + grouped(whole, group) + (digits ? point + digits : '');
}
