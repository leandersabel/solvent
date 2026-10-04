// A date field in the reader's own format (spec/ui/design-system.md,
// Date field).
//
// Not `input type=date`: that control is written in the browser's
// locale and no page can change it, so a reader whose browser is in
// English cannot be given the dates they asked for. This is the only
// reason to hand-build a control the platform already has, and the
// field keeps the platform's behaviour where it can: a typed date is
// accepted without opening anything, and the calendar is reachable
// from the keyboard.
import { el, mount, today } from './dom.js';

const WEEK_START_MONDAY = 1;

/** `value` is an ISO date or the empty string. `max` and `min` are ISO
 *  dates. A screen whose upper limit has a reason of its own gives it as
 *  `maxReason`, and `hint` is what the message line says until a date is
 *  refused. */
export function dateField(
  format,
  { id, value = '', min = null, max = null, maxReason = 'That date is in the future.', hint = '', onChange = null } = {},
) {
  let current = value;

  const text = el('input', {
    type: 'text',
    id,
    class: 'date-text',
    inputmode: 'numeric',
    placeholder: format.datePlaceholder(),
    'aria-describedby': id ? `${id}-format ${id}-line` : null,
    value: format.date(current),
  });
  const formatHint = el('span', {
    id: id ? `${id}-format` : null,
    class: 'visually-hidden',
    text: `Date, written ${format.datePlaceholder()}`,
  });
  const open = el('button', {
    type: 'button',
    class: 'date-open',
    'aria-label': 'Choose from a calendar',
    'aria-expanded': 'false',
    text: '\u{1F4C5}',
  });
  // The one message line: the hint until a date is refused, and the
  // refusal until the value fits, so the form never shifts.
  const line = el('p', { id: id ? `${id}-line` : null, class: 'date-line hint', 'aria-live': 'polite', text: hint });
  const popover = el('div', { class: 'date-popover', hidden: true });
  const wrap = el('div', { class: 'date-field' }, [text, open, popover, formatHint, line]);

  const show = (reason) => {
    line.textContent = reason ?? hint;
    line.className = `date-line ${reason ? 'field-error' : 'hint'}`;
    if (reason) text.setAttribute('aria-invalid', 'true');
    else text.removeAttribute('aria-invalid');
  };
  // Why the text in the field is refused, or null when it fits.
  const refusal = () => {
    if (!text.value.trim()) return 'Enter a date.';
    const iso = format.parseDate(text.value);
    if (!iso) return `Enter the date as ${format.datePlaceholder()}.`;
    if (max && iso > max) return maxReason;
    if (min && iso < min) return 'That date is out of range.';
    return null;
  };

  const settle = (iso, { redraw = true } = {}) => {
    current = iso;
    if (redraw) text.value = format.date(iso);
    if (onChange) onChange(iso);
  };

  text.addEventListener('input', () => {
    const iso = format.parseDate(text.value);
    // Typing is not finished until it parses, so an unparseable field
    // reports no value rather than an old one. A refusal on show stays
    // until the value fits, and a new one waits for blur.
    if (line.classList.contains('field-error')) show(refusal());
    settle(iso && inRange(iso, min, max) ? iso : '', { redraw: false });
  });

  text.addEventListener('blur', () => {
    const refused = refusal();
    show(refused);
    if (refused) {
      if (!text.value.trim()) settle('');
      return;
    }
    settle(format.parseDate(text.value));
  });

  const closeCalendar = () => {
    popover.hidden = true;
    popover.replaceChildren();
    open.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') {
      closeCalendar();
      open.focus();
    }
  };

  open.addEventListener('click', () => {
    if (!popover.hidden) {
      closeCalendar();
      return;
    }
    popover.hidden = false;
    open.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
    dateGrid(popover, format, current || today(), {
      min,
      max,
      selected: current,
      onPick: (iso) => {
        settle(iso);
        show(null);
        closeCalendar();
        text.focus();
      },
      onClose: closeCalendar,
    });
  });

  return {
    element: wrap,
    input: text,
    get value() {
      return current;
    },
    set(iso) {
      settle(iso);
    },
    /** Whether the text fits. A refusal shows on the field's own line
     *  and takes the focus. */
    validate() {
      const refused = refusal();
      show(refused);
      if (refused) text.focus();
      return !refused;
    },
  };
}

function inRange(iso, min, max) {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

const pad = (n, width) => String(n).padStart(width, '0');
const isoOf = (year, month, day) => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

function shiftDay(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return isoOf(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** A month grid drawn inside `host`, not a popup over a field: the
 *  marked date picker's body (design-system.md, Components, Date
 *  picker, marked). `anchor` is an ISO date whose month opens, and
 *  `onClose`, when given, adds the Close link the field's popup needs.
 *
 *  Arrow keys move the focus by a day and by a week, across a month
 *  edge, and never onto a date outside `min` and `max`. Next month is
 *  disabled on the month holding `max`. Each day carries its ISO date
 *  as `data-date`. */
export function dateGrid(host, format, anchor, { min = null, max = null, marked = null, selected = '', onPick, onClose = null }) {
  let [year, month] = anchor.split('-').map(Number);
  const reaches = (iso) => inRange(iso, min, max);

  const title = el('span', { class: 'date-title', 'aria-live': 'polite' });
  const grid = el('div', { class: 'date-grid', role: 'group' });
  const previous = el('button', {
    type: 'button',
    class: 'date-step',
    'aria-label': 'Previous month',
    text: '\u2039',
    onclick: () => step(-1),
  });
  const next = el('button', {
    type: 'button',
    class: 'date-step',
    'aria-label': 'Next month',
    text: '\u203A',
    onclick: () => step(1),
  });

  const lastMonth = () => {
    if (!max) return false;
    const [maxYear, maxMonth] = max.split('-').map(Number);
    return year * 12 + month >= maxYear * 12 + maxMonth;
  };
  const step = (by) => {
    const had = document.activeElement;
    month += by;
    if (month === 0) {
      month = 12;
      year -= 1;
    } else if (month === 13) {
      month = 1;
      year += 1;
    }
    render();
    // A button that disables itself drops focus, so it passes to the other.
    if (had === next && next.disabled) previous.focus();
  };

  const focusDay = (iso) => {
    const [y, m] = iso.split('-').map(Number);
    if (y !== year || m !== month) {
      year = y;
      month = m;
      render();
    }
    const day = grid.querySelector(`[data-date="${iso}"]`);
    if (day) day.focus();
  };
  const onArrow = (event) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!by) return;
    event.preventDefault();
    const to = shiftDay(event.currentTarget.dataset.date, by);
    if (reaches(to)) focusDay(to);
  };

  const render = () => {
    title.textContent = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(format.locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    grid.setAttribute('aria-label', title.textContent);
    next.disabled = lastMonth();

    const here = today();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    // One day is in the tab order, so Tab leaves the grid in one press:
    // the selected day, else today, else the first day that can be chosen.
    const monthDays = Array.from({ length: days }, (_, i) => isoOf(year, month, i + 1));
    const stop = [selected, here, ...monthDays].find((iso) => monthDays.includes(iso) && reaches(iso));

    grid.replaceChildren();
    for (const name of weekdayNames(format.locale)) {
      grid.append(el('span', { class: 'date-weekday', text: name }));
    }
    const first = new Date(Date.UTC(year, month - 1, 1));
    const lead = (first.getUTCDay() - WEEK_START_MONDAY + 7) % 7;
    for (let i = 0; i < lead; i += 1) grid.append(el('span', {}));
    for (const iso of monthDays) {
      // A dot is a color, so a marked date says so in its name as well.
      const recorded = Boolean(marked && marked.has(iso));
      grid.append(
        el('button', {
          type: 'button',
          class: `date-day${iso === selected ? ' is-selected' : ''}${iso === here ? ' is-today' : ''}${recorded ? ' has-recording' : ''}`,
          text: String(Number(iso.slice(8))),
          dataset: { date: iso },
          'aria-label': recorded ? `${format.dayMonth(iso)}, has a recording` : null,
          disabled: !reaches(iso),
          tabindex: iso === stop ? '0' : '-1',
          'aria-current': iso === here ? 'date' : null,
          onclick: () => onPick(iso),
          onkeydown: onArrow,
        }),
      );
    }
  };

  mount(host, [
    el('div', { class: 'date-head' }, [previous, title, next]),
    grid,
    onClose && el('button', { type: 'button', class: 'link-button', text: 'Close', onclick: onClose }),
  ]);
  render();
  return {
    /** Focus today, or the first day that can be chosen. */
    focus() {
      const day = grid.querySelector('.date-day.is-today:not(:disabled)') || grid.querySelector('.date-day[tabindex="0"]');
      if (day) day.focus();
    },
  };
}

function weekdayNames(locale) {
  const shape = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  // 4 January 1970 was a Sunday, so this walks a whole week from the
  // configured start day without depending on the current date.
  return Array.from({ length: 7 }, (_, i) =>
    shape.format(new Date(Date.UTC(1970, 0, 4 + WEEK_START_MONDAY + i))),
  );
}
