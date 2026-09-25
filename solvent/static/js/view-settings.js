// A vault owner's own account (spec/ui/settings.md).
//
// Nothing here is about the instance or about anybody else. An
// administrator never reaches this address at all.
import * as api from './api.js';
import * as crypto from './crypto.js';
import * as writes from './writes.js';
import { el, mount } from './dom.js';
import * as format from './format.js';
import { changePassword, restartIdleTimer, signOut } from './session.js';
import { IDLE_LOCK_PERIODS } from './model.js';
import { passwordWithToggle } from './unlock.js';
import { strengthGauge } from './strength.js';
import { exportCard, importCard } from './page-transfer.js';

export function settingsView(vault, { username, kdf, reload, openDimensions }) {
  return [
    el('h1', { class: 'screen-heading', text: 'Settings' }),
    profileCard(vault, username),
    formatCard(vault, reload),
    organizingCard(vault, openDimensions),
    changePasswordCard(vault, kdf),
    sessionCard(vault, reload),
    exportCard(vault),
    importCard(vault, reload),
    dangerZone(vault, username),
  ];
}

function profileCard(vault, username) {
  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Profile' }),
    row('Username', username),
    row('Main currency', vault.mainCurrency),
    el('p', {
      class: 'hint',
      text: 'Fixed when you created your vault. Every rate you have recorded converts into it, so changing it would mix two currencies in your history.',
    }),
  ]);
}

/** Dates and numbers (spec/ui/settings.md, Dates and numbers).
 *
 *  The language supplies the defaults and each control can overrule
 *  it, because a locale tag is a coarse guess about taste: a Swiss
 *  reader may want an apostrophe between thousands and no centimes,
 *  and no tag says that. Saved into the profile record, so the
 *  settings follow the vault to any browser rather than staying on
 *  one machine.
 */
function formatCard(vault, reload) {
  const settings = vault.profile || {};
  const error = el('p', { class: 'field-error', hidden: true });
  const sample = el('p', { class: 'hint' });

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
    sample.textContent = `${shape.money(1234567890000000000n)} ${vault.mainCurrency} on ${shape.date('2026-09-20')}`;
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
    } catch (failure) {
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
    field('Language', language),
    field('Dates', dates),
    field('Thousands', group),
    field('Decimals on money', places),
    sample,
    error,
    el('div', { class: 'form-actions' }, [save]),
  ]);
}

/** Offered rather than free text, because a tag nobody can spell is
 *  worse than a short list. An empty value means the browser's. */
const LANGUAGES = [
  { value: '', label: "Whatever this browser is set to" },
  { value: 'de-CH', label: 'Deutsch (Schweiz)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'fr-CH', label: 'Fran\u00e7ais (Suisse)' },
  { value: 'it-CH', label: 'Italiano (Svizzera)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
];

function row(label, value) {
  return el('p', { class: 'settings-row' }, [
    el('span', { class: 'settings-label', text: label }),
    el('span', { text: value }),
  ]);
}

function organizingCard(vault, openDimensions) {
  const count = vault.activeDimensions().length;
  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Organizing' }),
    el('a', {
      class: 'link-row',
      href: '/settings/dimensions',
      onclick: (event) => {
        event.preventDefault();
        openDimensions();
      },
    }, [
      el('span', { text: 'Dimensions' }),
      el('span', {
        class: 'hint',
        text: count
          ? `How your holdings split up in the chart. ${count} configured.`
          : 'How your holdings split up in the chart. None yet.',
      }),
    ]),
  ]);
}

function changePasswordCard(vault, kdf) {
  const current = el('input', { type: 'password', autocomplete: 'current-password' });
  const next = el('input', { type: 'password', autocomplete: 'new-password' });
  const confirm = el('input', { type: 'password', autocomplete: 'new-password' });
  const error = el('p', { class: 'field-error', hidden: true });
  const done = el('p', { class: 'banner', hidden: true, role: 'status' });
  const button = el('button', { class: 'btn-primary', text: 'Change password', disabled: true });
  const gauge = strengthGauge(next, (ok) => {
    button.disabled = !ok;
  });

  button.addEventListener('click', async () => {
    error.hidden = true;
    done.hidden = true;
    if (next.value !== confirm.value) {
      error.textContent = 'The two new passwords do not match.';
      error.hidden = false;
      return;
    }
    if (next.value === current.value) {
      error.textContent = 'The new password is your current one.';
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Changing your password';
    try {
      await changePassword(username, current.value, next.value, kdf);
      current.value = next.value = confirm.value = '';
      done.textContent =
        'Your password is changed. Every other session was signed out, and this one is still open.';
      done.hidden = false;
    } catch (failure) {
      error.textContent =
        failure.status === 400
          ? 'That is not your current password.'
          : 'Nothing was changed. Your current password still works.';
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Change password';
    }
    void vault;
  });

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Change password' }),
    el('p', {
      class: 'callout',
      text: 'Your data is not re-encrypted. Only the lock around your key is rebuilt, which is why this is fast even on a large vault.',
    }),
    field('Current password', passwordWithToggle(current)),
    field('New password', passwordWithToggle(next)),
    gauge.element,
    field('Confirm new password', passwordWithToggle(confirm)),
    error,
    done,
    button,
    el('p', {
      class: 'callout callout-critical',
      text: 'Export files you have already saved still open with your old password. They carry their own copy of the lock, and changing it here does not reach back and protect them.',
    }),
  ]);
}

function field(label, control) {
  return el('div', { class: 'field' }, [el('label', { text: label }), control]);
}

function sessionCard(vault, rerender) {
  const list = el('div', {}, [el('p', { class: 'hint', text: 'Loading…' })]);
  const error = el('p', { class: 'field-error', hidden: true });

  const idle = el('select', {}, IDLE_LOCK_PERIODS.map((minutes) =>
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

  api
    .get('/api/sessions')
    .then((sessions) => {
      mount(
        list,
        sessions.map((session) =>
          el('p', { class: 'settings-row' }, [
            el('span', {
              text: `Started ${vault.format.longDate(session.issuedAt.slice(0, 10))}, last used ${vault.format.longDate(session.lastActiveAt.slice(0, 10))}`,
            }),
            session.current ? el('span', { class: 'chip', text: 'This one' }) : null,
          ]),
        ),
      );
    })
    .catch(() => {
      mount(list, [
        el('p', { class: 'field-error', text: 'The session list would not load.' }),
        el('button', { class: 'btn-secondary', text: 'Retry', onclick: rerender }),
      ]);
    });

  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Session and lock' }),
    field('Idle lock', idle),
    el('p', {
      class: 'hint',
      text: 'Shorter is safer. Every unlock costs the deliberate wait while your password becomes a key.',
    }),
    el('p', {
      class: 'hint',
      text: 'You are signed out 12 hours after signing in, however busy you have been.',
    }),
    error,
    list,
    el('p', { class: 'hint', text: 'Solvent records no IP addresses and no devices.' }),
    el('div', { class: 'form-actions' }, [
      el('button', {
        class: 'btn-secondary',
        text: 'Sign out',
        onclick: () => signOut().finally(() => (window.location.href = '/login')),
      }),
      el('button', {
        class: 'btn-secondary',
        text: 'Sign out everywhere',
        onclick: () =>
          api
            .post('/api/auth/logout-all', {})
            .finally(() => (window.location.href = '/login')),
      }),
    ]),
  ]);
}

/** Deleting takes the account, everything in the vault, and every
 *  session. The dialog's primary action is Export first: somebody who
 *  came here wanting a backup and left with a wiped vault has been
 *  failed by the dialog. */
function dangerZone(vault, username) {
  const password = el('input', { type: 'password', autocomplete: 'current-password' });
  const typed = el('input', { type: 'text' });
  const error = el('p', { class: 'field-error', hidden: true });
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
      const authKey = await crypto
        .deriveKeys(password.value, (await api.post('/api/auth/salt', { username })).salt, kdf)
        .then((keys) => keys.authKey);
      await api.del('/api/auth/account', { authKey, confirmUsername: username });
      window.location.href = '/login';
    } catch {
      error.textContent = 'Nothing was deleted. Your vault is unchanged and you are still signed in.';
      error.hidden = false;
      remove.disabled = false;
    }
    void vault;
  });

  return el('details', { class: 'card danger-zone' }, [
    el('summary', { text: 'Danger zone' }),
    el('p', {
      text: 'Deleting takes the account, everything in the vault, and every session you have open. It happens all at once and it cannot be undone. Nothing is kept in reserve, and there is no vault left for anybody to recover.',
    }),
    field('Your password', passwordWithToggle(password)),
    field('Type your username to confirm', typed),
    error,
    el('div', { class: 'form-actions' }, [
      el('a', { class: 'btn-primary', href: '#export', text: 'Export first' }),
      remove,
    ]),
  ]);
}
