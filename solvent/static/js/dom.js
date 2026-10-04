// Building elements, the only way decrypted content reaches the page.
//
// Text is set through `textContent` without exception
// (spec/architecture.md, Application hardening): holding names, notes
// and dimension labels are attacker-influenceable, and here XSS means
// Master Key capture rather than session theft. There is no helper
// that takes markup, so there is nothing to reach for by mistake.

// Password managers fill any text field they like the look of, and
// almost every field here holds vault content rather than a credential:
// a manager that fills one writes a stored login into an encrypted
// record, and its inline button invites exactly that. Marked off for
// each of the major managers, which read their own attribute and not
// `autocomplete`. A field that really is a credential sets
// `autocomplete` itself and keeps its offer.
const NOT_A_CREDENTIAL = {
  autocomplete: 'off',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-bwignore': '',
  'data-form-type': 'other',
};
const FILLABLE = new Set(['input', 'textarea', 'select']);

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (FILLABLE.has(tag) && !('autocomplete' in props)) {
    props = { ...NOT_A_CREDENTIAL, ...props };
  }
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    // Through the CSSOM, one property at a time: the policy's
    // `style-src 'self'` refuses a style attribute however it is set.
    else if (key === 'style') for (const [name, v] of Object.entries(value)) node.style.setProperty(name, v);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// An inline rename (spec/ui/design-system.md, Components): the label
// with an Edit action that reveals an ordinary input in place. Only
// Save or Enter writes, so clicking away never does. A blank name is
// refused, and a rejected `save` keeps the field open with what was
// typed and the message `failed` gives for the failure.
//
// `disabled` holds Edit, Save, Cancel and the keys while a write the
// caller started is outstanding, as a save of its own does. A caller
// that redraws around the field passes the same `draft` object each
// time, and the field is rebuilt open with what was typed and its
// message. The draft holds only that, and nothing once the field closes.
export function inlineRename(text, save, failed, { disabled = false, draft = {} } = {}) {
  const label = el('span', { class: 'strong', text });
  const input = el('input', { type: 'text', 'aria-label': 'Name' });
  const error = el('p', { class: 'field-error', hidden: true });
  const view = el('span', { class: 'value-row' }, [
    label,
    el('button', { class: 'btn-inline', text: 'Edit', disabled, onclick: () => open(true) }),
  ]);
  const saveButton = el('button', { class: 'btn-inline', text: 'Save', disabled, onclick: () => commit() });
  const cancelButton = el('button', { class: 'btn-inline', text: 'Cancel', disabled, onclick: () => open(false) });
  const editor = el('span', { class: 'value-row', hidden: true }, [input, saveButton, cancelButton]);

  function open(editing, typed = text) {
    view.hidden = editing;
    editor.hidden = !editing;
    error.hidden = true;
    for (const key of Object.keys(draft)) delete draft[key];
    if (editing) {
      draft.open = true;
      input.value = typed;
      input.select();
    }
  }

  function refuse(message) {
    error.textContent = message;
    error.hidden = false;
    draft.error = message;
  }

  async function commit() {
    if (saveButton.disabled) return;
    const next = input.value.trim();
    if (!next) return refuse('A name cannot be blank.');
    if (next === text) return open(false);
    saveButton.disabled = cancelButton.disabled = true;
    try {
      await save(next);
      text = next;
      label.textContent = next;
      open(false);
    } catch (failure) {
      refuse(failed(failure));
    } finally {
      saveButton.disabled = cancelButton.disabled = false;
    }
  }

  input.addEventListener('input', () => (draft.value = input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape' && !cancelButton.disabled) open(false);
  });
  if (draft.open) {
    const { value, error: message } = draft;
    open(true, value);
    if (value !== undefined) draft.value = value;
    if (message) refuse(message);
  }
  return el('div', {}, [view, editor, error]);
}

// Line icons, drawn as SVG so no image request and no font is needed.
// Each is decorative: the text beside it or the button's own label
// carries the meaning.
const ICONS = {
  lock: ['M8 11V7a4 4 0 0 1 8 0v4', { rect: { x: 4, y: 11, width: 16, height: 10, rx: 2 } }],
  up: ['M12 19V5', 'M5 12l7-7 7 7'],
  down: ['M12 5v14', 'M19 12l-7 7-7-7'],
  chevron: ['M9 6l6 6-6 6'],
  alert: ['M12 3l9.5 17h-19z', 'M12 10v4', 'M12 17.5v.01'],
  note: [{ rect: { x: 5, y: 3, width: 14, height: 18, rx: 2 } }, 'M9 8h6', 'M9 12h6', 'M9 16h4'],
};

export function icon(name, size = 16) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const attrs = {
    class: `icon icon-${name}`, width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  };
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
  for (const part of ICONS[name]) {
    const [tag, props] = typeof part === 'string' ? ['path', { d: part }] : Object.entries(part)[0];
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(props)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

/** What a page says when its vault was replaced from a file elsewhere
 *  (ui/unlock.md, Replaced elsewhere; ui/dashboard.md, Replaced since
 *  last open). Whether typed input was dropped decides the icon and the
 *  second sentence. A polite live region, so a screen reader hears it. */
export function replacedCallout(first, dropped) {
  const second = dropped
    ? 'What you had typed here and not saved is gone.'
    : 'Nothing you had typed here was lost.';
  return el('p', { class: dropped ? 'callout callout-critical' : 'callout', role: 'status' }, [
    dropped ? icon('alert') : null,
    `${dropped ? ' ' : ''}${first} ${second}`,
  ]);
}

export const REPLACED_ELSEWHERE = 'Your vault was replaced from a file in another tab, window or device.';
export const REPLACED_SINCE_OPEN = 'Your vault was replaced from a file since you last opened it here.';

/** The top bar's Lock button: the padlock and its word, the word
 *  dropped from sight at phone width and still read aloud. */
function lockButton(onclick) {
  return el('button', { type: 'button', class: 'btn-chrome btn-lock', onclick }, [
    icon('lock', 14),
    el('span', { class: 'btn-label', text: 'Lock' }),
  ]);
}

/** Mark the nav entry for the view on screen, so the bar can underline
 *  it. Settings covers the screens reached from it, and Dashboard its
 *  filtered table. */
export function markCurrentNav() {
  const hash = window.location.hash || '#/';
  for (const link of document.querySelectorAll('.topbar nav a')) {
    const href = link.getAttribute('href');
    const current = href === '#/'
      ? hash === '#/' || hash === '#' || hash.startsWith('#/unassigned/')
      : hash.startsWith(href);
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/** The price date line (design-system.md, Components): the day a
 *  converted figure's price is from, beneath the figure, when that day
 *  is earlier than the figure's own. Null otherwise. */
export function priceDateLine(vault, priceDate, figureDate) {
  if (!priceDate || !figureDate || priceDate >= figureDate) return null;
  return el('span', { class: 'price-date', text: `priced ${vault.format.longDate(priceDate)}` });
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function mount(node, children) {
  node.replaceChildren(...[].concat(children).filter(Boolean));
  return node;
}

// Every dialog open right now, bottom to top: a Set keeps insertion
// order, so the last is the topmost.
const openDialogs = new Set();
const topmost = () => [...openDialogs].pop();
const FOCUSABLE = 'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
let barWatch = null;

/** The bar's rendered height, which the scrim and the phone sheet start
 *  below. Measured rather than fixed, because it changes with the width
 *  and with what the bar wraps. Set through the CSSOM, which
 *  `style-src 'self'` allows. */
function measureBar() {
  const bar = document.querySelector('.topbar');
  document.documentElement.style.setProperty('--chrome-height', `${bar.getBoundingClientRect().height}px`);
}

/** Put the page in the state the open dialogs call for (spec/features/
 *  app-shell.md, The bar above a dialog). A vault owner's bar stays
 *  above the scrim with Lock operable and everything else outside the
 *  topmost dialog inert. An administrator's has no Lock and nothing to
 *  protect, so the scrim covers it and it goes inert with the rest. */
function syncPage() {
  const open = openDialogs.size > 0;
  const bar = document.querySelector('.topbar');
  const vaultBar = bar?.querySelector('.btn-lock') ? bar : null;
  for (const entry of openDialogs) entry.scrim.inert = entry !== topmost();
  const content = document.querySelector('main');
  if (content) content.inert = open;
  if (bar && !vaultBar) bar.inert = open;
  if (!vaultBar) return;

  vaultBar.classList.toggle('over-dialog', open);
  // Hidden rather than inert: an inert control still looks pressable.
  for (const part of vaultBar.querySelectorAll('nav, .topbar-actions > :not(.btn-lock)')) part.hidden = open;
  if (open) {
    measureBar();
    barWatch ??= new ResizeObserver(measureBar);
    barWatch.observe(vaultBar);
  } else {
    barWatch?.disconnect();
    document.documentElement.style.removeProperty('--chrome-height');
  }
}

/** Escape closes the topmost dialog only. Tab cycles Lock, where there
 *  is one, and the topmost dialog's controls: the one control outside a
 *  dialog that acts is Lock. */
function onKey(event) {
  const top = topmost();
  if (!top) return;
  if (event.key === 'Escape') top.close();
  if (event.key !== 'Tab') return;
  const lock = document.querySelector('.topbar .btn-lock');
  const cycle = [
    ...(lock ? [lock] : []),
    ...[...top.panel.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled && node.checkVisibility()),
  ];
  if (!cycle.length) return;
  const at = cycle.indexOf(document.activeElement);
  const last = cycle.length - 1;
  if (at < 0) cycle[event.shiftKey ? last : 0].focus();
  else if (event.shiftKey && at === 0) cycle[last].focus();
  else if (!event.shiftKey && at === last) cycle[0].focus();
  else return;
  event.preventDefault();
}

/** A focus-trapping dialog with the Escape and restore behaviour every
 *  one in the product shares (spec/ui/design-system.md, Components).
 *
 *  `resume`, from `resumable` below, reopens the same form against the
 *  vault a later unlock builds. A dialog without one is closed by a
 *  lock and not reopened, which is right for a confirmation: it holds
 *  nothing the person typed. A dialog that has come to show an outcome
 *  rather than a form calls `close.stopResuming()`, so a lock no longer
 *  keeps it. */
export function dialog({ heading, body, actions, resume = null }) {
  const opener = document.activeElement;
  // No `aria-modal`: it hides everything outside the dialog from a
  // screen reader, Lock included. `inert` does the modal's work.
  const panel = el('div', { class: 'dialog', role: 'dialog' }, [
    el('h2', { class: 'dialog-heading', text: heading }),
    el('div', { class: 'dialog-body' }, body),
    el('div', { class: 'dialog-actions' }, actions),
  ]);
  const scrim = el('div', { class: 'scrim' }, [panel]);

  const entry = { panel, scrim, resume, close: null };
  const close = ({ refocus = true } = {}) => {
    openDialogs.delete(entry);
    scrim.remove();
    // Before focus returns: it cannot land in an inert region.
    syncPage();
    if (!openDialogs.size) document.removeEventListener('keydown', onKey);
    if (refocus && opener && opener.focus) opener.focus();
  };
  entry.close = close;
  close.stopResuming = () => {
    entry.resume = null;
  };

  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  openDialogs.add(entry);
  syncPage();
  trackEdits(panel);
  const focusTarget = panel.querySelector('input, button');
  if (focusTarget) focusTarget.focus();
  return close;
}

/** A dialog's way back after a lock: `reopen(context, ...ids)`, called
 *  with the vault the next unlock builds.
 *
 *  Built here rather than as an arrow at the call site on purpose. V8
 *  gives every closure in one function the same scope object, so an
 *  arrow written beside a handler that uses `vault` would keep the old
 *  vault, keys and all, alive across the lock. This scope holds the
 *  function and the ids and nothing else, and the ids are record ids
 *  and dates, never plaintext. */
export function resumable(reopen, ...ids) {
  return (context) => reopen(context, ...ids);
}

// ---- What a lock keeps --------------------------------------------------
//
// Unsaved input is the one thing a lock keeps (spec/features/login.md,
// Rules). That means what the person typed or chose, and only where it
// differs from what the form was built with: a field prefilled from the
// vault and left alone is vault content read back, and goes with the
// rest. A password never survives, shown or not.

const edited = new WeakSet();
const baselines = new WeakMap();
const watched = new WeakSet();

function fieldsOf(root) {
  return [...root.querySelectorAll('input, select, textarea')];
}

function valueOf(field) {
  return field.type === 'checkbox' || field.type === 'radio' ? String(field.checked) : field.value;
}

function kindOf(field) {
  return `${field.tagName}:${field.type}`;
}

function markEdited(event) {
  edited.add(event.target);
}

/** Note what every field under `root` holds now, as the form was
 *  built. Called for each dialog and after each screen is mounted. */
export function trackEdits(root) {
  for (const field of fieldsOf(root)) baselines.set(field, valueOf(field));
  if (watched.has(root)) return;
  root.addEventListener('input', markEdited, true);
  root.addEventListener('change', markEdited, true);
  watched.add(root);
}

/** The fields under `root` the person changed, as plain values keyed
 *  by position. Nothing in the result refers to the form or the vault
 *  it was built from. */
export function editedFields(root) {
  const kept = [];
  fieldsOf(root).forEach((field, index) => {
    if (!edited.has(field)) return;
    if (field.type === 'password' || field.type === 'file' || field.closest('.password-field')) return;
    const value = valueOf(field);
    if (value === baselines.get(field)) return;
    kept.push({ index, kind: kindOf(field), value });
  });
  return kept;
}

/** Put kept values back into a form rebuilt the same way, announcing
 *  each so whatever is derived from a field (the converted figure under
 *  a quantity) follows it. A field that is no longer the same kind at
 *  that position is left alone rather than guessed at. */
export function restoreFields(root, kept) {
  const fields = fieldsOf(root);
  for (const { index, kind, value } of kept) {
    const field = fields[index];
    if (!field || kindOf(field) !== kind) continue;
    if (field.type === 'checkbox' || field.type === 'radio') field.checked = value === 'true';
    else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/** On a lock: close every dialog without handing focus back to a
 *  screen that is about to go, and keep each that can be reopened with
 *  its edited fields, of which there may be none. */
export function closeDialogsForLock() {
  const kept = [];
  for (const entry of [...openDialogs]) {
    if (entry.resume) kept.push({ resume: entry.resume, fields: editedFields(entry.panel) });
    entry.close({ refocus: false });
  }
  return kept;
}

/** After an unlock: reopen each kept dialog against the new vault and
 *  write its kept values back. */
export function reopenDialogs(kept, context) {
  for (const { resume, fields } of kept) {
    const before = new Set(openDialogs);
    resume(context);
    const reopened = [...openDialogs].find((entry) => !before.has(entry));
    if (reopened) restoreFields(reopened.panel, fields);
  }
}

/** "3 weeks ago", "about a year ago" (spec/ui/update-values.md, Age).
 *  Relative, because the question is how long this has been sitting
 *  and a date makes the reader do the arithmetic. Both ends are
 *  calendar dates with no hour, so the count is whole calendar days
 *  and the time of day never changes the wording. */
export function ageInWords(isoDate, reference = today()) {
  if (!isoDate) return 'never valued';
  const day = (iso) => {
    const [year, month, date] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, date) / 86400000;
  };
  const days = day(reference) - day(isoDate);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 330) return `${Math.round(days / 30)} months ago`;
  const years = days / 365;
  if (years < 1.5) return 'about a year ago';
  return `about ${Math.round(years)} years ago`;
}

/** A date for the administration surface, which has no vault and so
 *  no settings to read: the browser's own locale is all there is.
 *  Everything behind a vault goes through `vault.format`
 *  (static/js/format.js) instead. */
export function shortDate(isoDate) {
  const date = new Date(isoDate + 'T00:00:00Z');
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** The sign-in and registration addresses serve this page in the
 *  outside frame: the wordmark above one card, the bar hidden. Once
 *  the keys exist the same document becomes the vault, so the frame is
 *  taken down and the bar shown. A page served inside the shell has no
 *  frame to leave. */
function leaveOutsideFrame(bar) {
  if (!document.body.classList.contains('outside-body')) return;
  document.body.classList.remove('outside-body');
  document.querySelector('.outside-wordmark')?.remove();
  if (bar) bar.hidden = false;
  document.title = 'Solvent';
}

/** The password screen and the registration screen sit outside the
 *  shell: the wordmark above one card, and no bar at all. The vault
 *  page loads locked and returns here on every lock, so the bar goes
 *  back to hidden and the frame is put back, the inverse of
 *  `leaveOutsideFrame`. Safe to call when the frame is already up. */
export function enterOutsideFrame() {
  const bar = document.querySelector('.topbar');
  if (bar) bar.hidden = true;
  if (document.body.classList.contains('outside-body')) return;
  document.body.classList.add('outside-body');
  document.body.prepend(el('p', { class: 'outside-wordmark', text: 'Solvent' }));
}

/** Draw the chrome the server had no kind to draw.
 *
 *  A page reached without a session carries the wordmark alone, so
 *  that one derivation buys both the session and the keys
 *  (spec/features/app-shell.md, The chrome). Once the kind is known
 *  the rest of the bar goes in, carrying the same entries and the
 *  same controls the server renders for a session it already had.
 *  It holds no plaintext either way: nav labels and the wordmark.
 */
export function revealChrome(kind, { onUpdate, onLock, onSignOut }) {
  const bar = document.querySelector('.topbar');
  leaveOutsideFrame(bar);
  if (!bar || bar.querySelector('nav')) return;

  if (kind === 'vault_owner') {
    bar.append(
      el('nav', { 'aria-label': 'Primary' }, [
        el('ul', {}, [
          el('li', {}, [el('a', { href: '#/', text: 'Dashboard' })]),
          el('li', {}, [el('a', { href: '#/settings', text: 'Settings' })]),
        ]),
      ]),
      el('div', { class: 'topbar-actions' }, [
        el('button', { type: 'button', class: 'btn-chrome', text: 'Update values', onclick: onUpdate }),
        lockButton(onLock),
      ]),
    );
    return;
  }
  bar.append(
    el('div', { class: 'topbar-actions' }, [
      el('button', { type: 'button', class: 'btn-chrome', text: 'Sign out', onclick: onSignOut }),
    ]),
  );
}
