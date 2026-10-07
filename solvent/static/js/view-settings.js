// A vault owner's own account (spec/features/account-settings.md, Settings).
//
// Nothing here is about the instance or about anybody else. An
// administrator never reaches this address at all.
import * as api from './api.js';
import * as writes from './writes.js';
import { counted, dialog, el, icon, mount, resumable, today } from './dom.js';
import * as format from './format.js';
import {
  WrongPasswordError,
  authKeyFor,
  changePassword,
  restartIdleTimer,
  signOut,
} from './session.js';
import { IDLE_LOCK_PERIODS } from './model.js';
import { knownUsernameField, passwordWithToggle, show } from './unlock.js';
import { strengthGauge } from './strength.js';

/** `open` goes to one of the screens reached from here, by the last
 *  part of its address. */
export function settingsView(vault, { username, kdf, reload, open }) {
  const sessions = sessionCard(vault);
  return [
    el('h1', { class: 'screen-heading', text: 'Settings' }),
    profileCard(vault, username),
    formatCard(vault, reload),
    organizingCard(vault, open),
    changePasswordCard(kdf, username, () => sessions.load()),
    sessions.card,
    dangerZone(username, open),
  ];
}

function profileCard(vault, username) {
  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Profile' }),
    el('dl', { class: 'pairs' }, [
      pair('Username', [el('span', { text: username })]),
      pair('Main currency', [
        el('span', { class: 'strong', text: vault.mainCurrency }),
        el('p', {
          class: 'hint',
          text: 'Fixed when you created your vault. Every rate you have recorded converts into it, so changing it would mix two currencies in your history.',
        }),
      ]),
    ]),
  ]);
}

/** Dates and numbers (spec/features/account-settings.md, Settings,
 *  Dates and numbers), whose defaults and overrides static/js/format.js
 *  explains. Saved into the profile record, so the settings follow the
 *  vault to any browser rather than staying on one machine.
 */
function formatCard(vault, reload) {
  const settings = vault.profile || {};
  const error = el('p', { class: 'field-error', hidden: true });
  const sampleFigure = el('span', { class: 'sample-figure' });
  const sampleDate = el('span', { class: 'sample-date' });

  const language = el('select', { id: 'format-locale' });
  for (const tag of LANGUAGES) {
    language.append(
      el('option', {
        value: tag.value,
        text: tag.label,
        selected: (settings.locale || '') === tag.value,
      }),
    );
  }

  const choose = (id, options, chosen) => {
    const select = el('select', { id });
    for (const option of options) {
      select.append(
        el('option', {
          value: option.value,
          text: option.label,
          selected: (chosen || 'locale') === option.value,
        }),
      );
    }
    return select;
  };
  const group = choose('format-group', format.GROUPS, settings.groupSeparator);
  const places = choose('format-places', format.PLACES, settings.moneyPlaces);
  const dates = choose('format-dates', format.DATE_STYLES, settings.dateStyle);

  const preview = () => {
    const shape = format.formatter({
      locale: language.value || undefined,
      groupSeparator: group.value,
      moneyPlaces: places.value,
      dateStyle: dates.value,
    });
    sampleFigure.textContent = `${vault.mainCurrency} ${shape.money(1234567890000000000n)}`;
    sampleDate.textContent = shape.longDate(today());
  };
  for (const control of [language, group, places, dates]) {
    control.addEventListener('change', preview);
  }
  preview();

  const save = el('button', { class: 'btn-primary', text: 'Save' });
  save.addEventListener('click', async () => {
    error.hidden = true;
    save.disabled = true;
    try {
      await writes.saveProfile(vault, {
        ...vault.profile,
        locale: language.value || null,
        groupSeparator: group.value,
        moneyPlaces: places.value,
        dateStyle: dates.value,
      });
      reload();
    } catch {
      error.textContent = 'That did not save. Nothing changed.';
      error.hidden = false;
      save.disabled = false;
    }
  });

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Dates and numbers' }),
    el('p', {
      class: 'hint',
      text: 'Display only. Every figure is stored exactly as you entered it, and every date is stored the same way for everyone, so changing any of this rewrites nothing.',
    }),
    el('div', { class: 'format-grid' }, [
      field('Language', 'format-locale', language),
      field('Dates', 'format-dates', dates),
      field('Thousands', 'format-group', group),
      field('Decimals on money', 'format-places', places),
    ]),
    el('div', { class: 'sample-strip' }, [
      el('p', { class: 'sample' }, [
        el('span', { class: 'eyebrow', text: 'Sample' }),
        sampleFigure,
        sampleDate,
      ]),
      save,
    ]),
    error,
  ]);
}

/** Offered rather than free text, because a tag nobody can spell is
 *  worse than a short list. An empty value means the browser's. */
const LANGUAGES = [
  { value: '', label: 'Browser setting' },
  { value: 'de-CH', label: 'Deutsch (Schweiz)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'fr-CH', label: 'Fran\u00e7ais (Suisse)' },
  { value: 'it-CH', label: 'Italiano (Svizzera)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
];

function pair(label, value) {
  return el('div', { class: 'pair' }, [el('dt', { text: label }), el('dd', {}, value)]);
}

function organizingCard(vault, open) {
  const count = vault.activeDimensions().length;
  // Link rows rather than a section, so the card carries no heading.
  // Each href is the real address, which a new tab or a bookmark
  // follows, and a click stays on this page.
  const row = (address, title, explanation, aside = null) =>
    el('a', {
      class: 'link-row',
      href: `/settings/${address}`,
      onclick: (event) => {
        event.preventDefault();
        open(address);
      },
    }, [
      el('span', { class: 'link-row-text' }, [
        el('span', { class: 'link-row-title', text: title }),
        el('span', { class: 'hint', text: explanation }),
      ]),
      aside ? el('span', { class: 'link-row-aside', text: aside }) : null,
      icon('chevron'),
    ]);
  return el('section', { class: 'card link-list' }, [
    row('dimensions', 'Dimensions', 'How your holdings split up in the chart.',
      count ? counted(count, 'dimension', 'dimensions') : 'None yet'),
    row('export-import', 'Export and import', 'Download your vault, or restore one from a file.'),
  ]);
}

/** `sessions` fetches the session list again: the server ends every
 *  other session before it answers a change, so the rows shown are stale. */
function changePasswordCard(kdf, username, sessions) {
  const current = el('input', { id: 'password-current', type: 'password', autocomplete: 'current-password' });
  const next = el('input', { id: 'password-new', type: 'password', autocomplete: 'new-password' });
  const confirm = el('input', { id: 'password-confirm', type: 'password', autocomplete: 'new-password' });
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const done = el('p', { class: 'banner', hidden: true, role: 'status' });
  const button = el('button', { type: 'submit', class: 'btn-primary', text: 'Change password', disabled: true });
  let strong = false;
  const gauge = strengthGauge(next, (ok) => {
    strong = ok;
    button.disabled = !ok;
  });
  const fields = [
    field('Current password', 'password-current', passwordWithToggle(current)),
    field('New password', 'password-new', passwordWithToggle(next), gauge.element),
    field('Confirm new password', 'password-confirm', passwordWithToggle(confirm)),
  ];
  // The form goes quiet while both keys are derived.
  const quiet = (on) => {
    for (const control of fields.flatMap((f) => [...f.querySelectorAll('input, button')])) {
      control.disabled = on;
    }
    button.disabled = on || !strong;
  };

  const submit = async (event) => {
    event.preventDefault();
    error.hidden = true;
    done.hidden = true;
    if (next.value !== confirm.value) {
      show(error, 'The two new passwords do not match.');
      return;
    }
    if (next.value === current.value) {
      show(error, 'The new password is your current one.');
      return;
    }
    quiet(true);
    button.textContent = 'Changing your password';
    try {
      await changePassword(username, current.value, next.value, kdf);
      current.value = next.value = confirm.value = '';
      gauge.evaluate();
      show(done, 'Your password is changed. Every other session was signed out, and this one is still open.');
      sessions();
    } catch (failure) {
      // Every field is kept, so nothing is typed or derived twice.
      show(
        error,
        failure instanceof WrongPasswordError
          ? 'That is not your current password.'
          : 'Nothing was changed. Your current password still works.',
      );
    } finally {
      button.textContent = 'Change password';
      quiet(false);
    }
  };

  // A form with the username, so a password manager offers to update
  // the saved login. Enter submits it.
  return el('form', { class: 'card', novalidate: true, onsubmit: submit }, [
    el('h2', { class: 'section-heading', text: 'Change password' }),
    el('p', {
      class: 'callout',
      text: 'Your data is not re-encrypted. Only the lock around your key is rebuilt, which is why this is fast even on a large vault.',
    }),
    // An error sits above the first field (design-system.md, States).
    el('div', { class: 'form-narrow' }, [error, knownUsernameField(username), ...fields, done, button]),
    el('p', { class: 'warning-line' }, [
      icon('alert', 18),
      el('span', {
        text: 'Export files you have already saved still open with your old password. They carry their own copy of the lock, and changing it here does not reach back and protect them.',
      }),
    ]),
  ]);
}

/** `id` is the control's own, or the input's inside a wrapper, so the
 *  visible label is the control's accessible name. */
function field(label, id, control, ...after) {
  return el('div', { class: 'field' }, [el('label', { for: id, text: label }), control, ...after]);
}

function sessionCard(vault) {
  const list = el('div', { class: 'session-list' });
  const error = el('p', { class: 'field-error', hidden: true });
  const everywhereError = el('p', { class: 'field-error', role: 'alert', hidden: true });

  const idle = el('select', { id: 'idle-lock' }, IDLE_LOCK_PERIODS.map((minutes) =>
    el('option', { value: String(minutes), text: `${minutes} minutes` }),
  ));
  idle.value = String(vault.idleLockMinutes);
  idle.addEventListener('change', async () => {
    try {
      await writes.saveProfile(vault, {
        ...vault.profile,
        idleLockMinutes: Number(idle.value),
      });
      restartIdleTimer();
    } catch {
      idle.value = String(vault.idleLockMinutes);
      error.textContent = 'That did not save. The lock keeps running at its stored value.';
      error.hidden = false;
    }
  });

  // Fetched, so this card alone waits, on skeleton rows, and a retry
  // reloads this card alone.
  const load = () => {
    mount(list, [1, 2].map(() => el('div', { class: 'skeleton-row', 'aria-hidden': 'true' })));
    list.setAttribute('aria-busy', 'true');
    return api
    .get('/api/sessions')
    .then((listed) => {
      // The session reading this first, then the rest by when each
      // was last used.
      const sessions = [...listed].sort((a, b) =>
        Number(b.current) - Number(a.current) || String(b.lastActiveAt).localeCompare(String(a.lastActiveAt)),
      );
      mount(list, el('table', { class: 'data-table sessions-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: '' }),
            el('th', { text: 'Started' }),
            el('th', { text: 'Last used' }),
          ]),
        ]),
        el('tbody', {}, sessions.map((session) =>
          el('tr', {}, [
            el('td', {}, [session.current ? el('span', { class: 'chip', text: 'This session' }) : null]),
            el('td', { text: vault.format.dateTime(session.issuedAt) }),
            el('td', { text: session.current ? 'Just now' : vault.format.dateTime(session.lastActiveAt) }),
          ]),
        )),
      ]));
    })
    .catch(() => {
      mount(list, [
        el('p', { class: 'field-error', text: 'The session list would not load.' }),
        el('button', { class: 'btn-secondary', text: 'Retry', onclick: load }),
      ]);
    })
    .finally(() => list.removeAttribute('aria-busy'));
  };
  load();

  const card = el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Session and lock' }),
    el('div', { class: 'idle-grid' }, [
      field('Idle lock', 'idle-lock', idle),
      el('p', {
        class: 'hint',
        text: 'Shorter is safer. Every unlock costs the deliberate wait while your password becomes a key.',
      }),
    ]),
    error,
    el('p', { text: 'You are signed out 12 hours after signing in, however busy you have been.' }),
    el('div', { class: 'sessions' }, [
      el('p', { class: 'eyebrow', text: 'Open sessions' }),
      list,
      el('p', { class: 'hint', text: 'Solvent keeps no IP address readable and records no devices.' }),
    ]),
    el('div', { class: 'form-actions' }, [
      el('button', {
        class: 'btn-secondary',
        text: 'Sign out',
        onclick: () => signOut().finally(() => (window.location.href = '/login')),
      }),
      el('button', {
        class: 'btn-secondary',
        text: 'Sign out everywhere',
        onclick: async () => {
          everywhereError.hidden = true;
          try {
            await api.post('/api/auth/logout-all', {});
          } catch {
            show(everywhereError, 'Nothing was signed out. Every session is still open, this one included.');
            return;
          }
          await signOut().catch(() => {});
          window.location.href = '/login';
        },
      }),
    ]),
    everywhereError,
  ]);
  return { card, load };
}

/** The Danger zone holds one destructive button, and the deletion is
 *  its dialog (spec/features/account-settings.md, Settings, Delete my
 *  account). */
function dangerZone(username, open) {
  return el('details', { class: 'card danger-zone' }, [
    el('summary', { text: 'Danger zone' }),
    el('div', { class: 'form-actions' }, [
      el('button', {
        class: 'btn-destructive',
        text: 'Delete my account',
        onclick: () => deleteAccountDialog(username, open),
      }),
    ]),
  ]);
}

/** Deleting takes the account, everything in the vault, and every
 *  session. The dialog's primary action is Export first: somebody who
 *  came here wanting a backup and left with a wiped vault has been
 *  failed by the dialog. The typed username is one of the few typed
 *  confirmations the product asks for, because nothing could bring the
 *  vault back (spec/design-system.md, Dialog). */
function deleteAccountDialog(username, open) {
  const password = el('input', { id: 'delete-password', type: 'password', autocomplete: 'current-password' });
  const typed = el('input', { id: 'delete-username', type: 'text', spellcheck: 'false' });
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const remove = el('button', { class: 'btn-destructive', text: 'Delete my vault', disabled: true });

  const check = () => {
    remove.disabled = !password.value || typed.value !== username;
  };
  password.addEventListener('input', check);
  typed.addEventListener('input', check);

  remove.addEventListener('click', async () => {
    error.hidden = true;
    remove.disabled = true;
    try {
      // Derived at the account's own stored envelope, which is what its
      // verifier was made at, not at the default the page embeds.
      const authKey = await authKeyFor(username, password.value);
      await api.del('/api/auth/account', { authKey, confirmUsername: username });
      signOut().catch(() => {});
      window.location.href = '/login';
    } catch {
      error.textContent = 'Nothing was deleted. Your vault is unchanged and you are still signed in.';
      error.hidden = false;
      check();
    }
  });

  const close = dialog({
    heading: 'Delete your account',
    resume: resumable(reopenDeleteAccount, username),
    body: [
      el('p', {
        text: 'Deleting takes the account, everything in the vault, and every session you have open. It happens all at once and it cannot be undone. Nothing is kept in reserve, and there is no vault left for anybody to recover.',
      }),
      // A form with the username, so a password manager can fill the
      // password. Enter does nothing: only Delete my vault deletes.
      el('form', { novalidate: true, onsubmit: (event) => event.preventDefault() }, [
        error,
        knownUsernameField(username),
        field('Your password', 'delete-password', passwordWithToggle(password)),
        field('Type your username to confirm', 'delete-username', typed),
      ]),
    ],
    actions: [
      el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() }),
      remove,
      el('a', {
        class: 'btn-primary',
        href: '/settings/export-import',
        text: 'Export first',
        onclick: (event) => {
          event.preventDefault();
          close();
          open('export-import');
        },
      }),
    ],
  });
}

/** After an unlock, back into the dialog the lock closed. The username
 *  is the signed-in account's own, which the page already holds. */
function reopenDeleteAccount(_context, username) {
  deleteAccountDialog(username, (address) => {
    window.location.hash = `#/settings/${address}`;
  });
}
