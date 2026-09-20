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
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function mount(node, children) {
  node.replaceChildren(...[].concat(children).filter(Boolean));
  return node;
}

export function byId(id) {
  return document.getElementById(id);
}

/** A focus-trapping dialog with the Escape and restore behaviour every
 *  one in the product shares (spec/ui/design-system.md, Components). */
export function dialog({ heading, body, actions }) {
  const opener = document.activeElement;
  const panel = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
    el('h2', { class: 'dialog-heading', text: heading }),
    el('div', { class: 'dialog-body' }, body),
    el('div', { class: 'dialog-actions' }, actions),
  ]);
  const scrim = el('div', { class: 'scrim' }, [panel]);

  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    if (opener && opener.focus) opener.focus();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
    if (event.key !== 'Tab') return;
    const focusable = panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  };

  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  const focusTarget = panel.querySelector('input, button');
  if (focusTarget) focusTarget.focus();
  return close;
}

/** "3 weeks ago", "about a year ago" (spec/ui/update-values.md, Age).
 *  Relative, because the question is how long this has been sitting
 *  and a date makes the reader do the arithmetic. */
export function ageInWords(isoDate, today = new Date()) {
  if (!isoDate) return 'never valued';
  const days = Math.round(
    (today - new Date(isoDate + 'T00:00:00Z')) / 86400000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 330) return `${Math.round(days / 30)} months ago`;
  const years = days / 365;
  if (years < 1.5) return 'about a year ago';
  return `about ${Math.round(years)} years ago`;
}

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
  if (!bar || bar.querySelector('nav')) return;

  if (kind === 'vault_owner') {
    bar.append(
      el('nav', { 'aria-label': 'Primary' }, [
        el('ul', {}, [
          el('li', {}, [el('a', { href: '/dashboard', text: 'Dashboard' })]),
          el('li', {}, [el('a', { href: '/settings', text: 'Settings' })]),
        ]),
      ]),
      el('div', { class: 'topbar-actions' }, [
        el('button', { type: 'button', class: 'btn-chrome', text: 'Update values', onclick: onUpdate }),
        el('button', { type: 'button', class: 'btn-chrome', text: 'Lock', onclick: onLock }),
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
