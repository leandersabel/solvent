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
import { el, today } from './dom.js';

const WEEK_START_MONDAY = 1;

/** `value` is an ISO date or the empty string. `max` and `min` are ISO
 *  dates. `marked` is a set of ISO dates the calendar marks as holding
 *  a recording (design-system.md, Components, Date picker, marked). */
export function dateField(format, { id, value = '', min = null, max = null, onChange = null, marked = null } = {}) {
  let current = value;

  const text = el('input', {
    type: 'text',
    id,
    class: 'date-text',
    inputmode: 'numeric',
    placeholder: format.datePlaceholder(),
    'aria-describedby': id ? `${id}-format` : null,
    value: format.date(current),
  });
  const hint = el('span', {
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
  const error = el('p', { class: 'field-error', hidden: true });
  const popover = el('div', { class: 'date-popover', hidden: true });
  const wrap = el('div', { class: 'date-field' }, [text, open, popover, hint, error]);

  const settle = (iso, { redraw = true } = {}) => {
    current = iso;
    if (redraw) text.value = format.date(iso);
    if (onChange) onChange(iso);
  };

  text.addEventListener('input', () => {
    error.hidden = true;
    const iso = format.parseDate(text.value);
    // Typing is not finished until it parses, so an unparseable field
    // reports no value rather than an old one.
    settle(iso && inRange(iso, min, max) ? iso : '', { redraw: false });
  });

  text.addEventListener('blur', () => {
    if (!text.value.trim()) {
      error.hidden = true;
      settle('');
      return;
    }
    const iso = format.parseDate(text.value);
    if (!iso) {
      error.textContent = `That is not a date. Write it as ${format.datePlaceholder()}.`;
      error.hidden = false;
      return;
    }
    if (!inRange(iso, min, max)) {
      error.textContent = max && iso > max ? 'That date is in the future.' : 'That date is out of range.';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    settle(iso);
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
    drawCalendar(popover, format, current || today(), {
      min,
      max,
      marked,
      selected: current,
      onPick: (iso) => {
        settle(iso);
        error.hidden = true;
        closeCalendar();
        text.focus();
      },
      onClose: closeCalendar,
    });
  });

  return {
    element: wrap,
    input: text,
    /** Open the month grid with today's date focused. */
    openCalendar() {
      if (popover.hidden) open.click();
      const day = popover.querySelector('.date-day.is-today') || popover.querySelector('.date-day');
      if (day) day.focus();
    },
    get value() {
      return current;
    },
    set(iso) {
      settle(iso);
    },
  };
}

function inRange(iso, min, max) {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

function drawCalendar(host, format, anchor, { min, max, marked, selected, onPick, onClose }) {
  let [year, month] = anchor.split('-').map(Number);

  const render = () => {
    const title = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(format.locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const grid = el('div', { class: 'date-grid', role: 'grid' });
    for (const name of weekdayNames(format.locale)) {
      grid.append(el('span', { class: 'date-weekday', text: name }));
    }
    const first = new Date(Date.UTC(year, month - 1, 1));
    const lead = (first.getUTCDay() - WEEK_START_MONDAY + 7) % 7;
    for (let i = 0; i < lead; i += 1) grid.append(el('span', {}));
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day += 1) {
      const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const usable = inRange(iso, min, max);
      // A dot is a color, so a marked date says so in its name as well.
      const recorded = Boolean(marked && marked.has(iso));
      grid.append(
        el('button', {
          type: 'button',
          class: `date-day${iso === selected ? ' is-selected' : ''}${iso === today() ? ' is-today' : ''}${recorded ? ' has-recording' : ''}`,
          text: String(day),
          'aria-label': recorded ? `${format.dayMonth(iso)}, has a recording` : null,
          disabled: !usable,
          'aria-current': iso === today() ? 'date' : null,
          onclick: () => onPick(iso),
        }),
      );
    }

    host.replaceChildren(
      el('div', { class: 'date-head' }, [
        el('button', {
          type: 'button',
          class: 'date-step',
          'aria-label': 'Previous month',
          text: '‹',
          onclick: () => {
            month -= 1;
            if (month === 0) {
              month = 12;
              year -= 1;
            }
            render();
          },
        }),
        el('span', { class: 'date-title', text: title }),
        el('button', {
          type: 'button',
          class: 'date-step',
          'aria-label': 'Next month',
          text: '›',
          onclick: () => {
            month += 1;
            if (month === 13) {
              month = 1;
              year += 1;
            }
            render();
          },
        }),
      ]),
      grid,
      el('button', { type: 'button', class: 'link-button', text: 'Close', onclick: onClose }),
    );
  };
  render();
}

function weekdayNames(locale) {
  const shape = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  // 4 January 1970 was a Sunday, so this walks a whole week from the
  // configured start day without depending on the current date.
  return Array.from({ length: 7 }, (_, i) =>
    shape.format(new Date(Date.UTC(1970, 0, 4 + WEEK_START_MONDAY + i))),
  );
}
