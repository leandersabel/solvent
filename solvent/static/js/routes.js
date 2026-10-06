// The addresses inside the vault page (spec/features/app-shell.md,
// Addresses inside the vault). An address is typed or pasted input
// like any other, so it is read against this table before any screen
// draws, and anything outside the table is no page.
import { isRecordedDay } from './model.js';

const SETTINGS = new Set([undefined, 'dimensions', 'export-import']);

/** The screen `hash` names, as `{ view, argument, mode }`, or null when
 *  it names none. `today` is the device's calendar day. `recorded`
 *  says whether a stored record carries a date, so a recording whose
 *  date is not a recorded day can still be opened to move or delete
 *  what it holds. */
export function route(hash, today, recorded) {
  const [root, view = '', argument, mode, ...rest] = (hash || '#/').split('/');
  if (root !== '#' || rest.length) return null;
  const one = (ok) => (ok && mode === undefined ? { view, argument } : null);
  switch (view) {
    case '':
      return argument === undefined ? { view: 'dashboard' } : null;
    case 'unassigned':
      return one(Boolean(argument));
    case 'settings':
      return mode === undefined && SETTINGS.has(argument) ? { view, argument } : null;
    case 'holding':
      return argument && (mode === undefined || mode === 'edit') ? { view, argument, mode } : null;
    case 'sweep':
      return one(isRecordedDay(argument, today));
    case 'recording':
      return one(isRecordedDay(argument, today) || (Boolean(argument) && recorded(argument)));
    default:
      return null;
  }
}
