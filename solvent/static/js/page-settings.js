// A vault owner's own account (spec/ui/settings.md).
//
// Nothing here is about the instance or about anybody else. An
// administrator never reaches this address at all.
import * as api from './api.js';
import * as crypto from './crypto.js';
import * as writes from './writes.js';
import { el, mount, shortDate } from './dom.js';
import { changePassword, currentVault, isUnlocked, onLock, signOut } from './session.js';
import { unlockCard, passwordWithToggle } from './unlock.js';
import { strengthGauge } from './strength.js';
import { exportCard, importCard } from './page-transfer.js';

const container = document.getElementById('app');
const username = container.dataset.username;
const kdf = JSON.parse(document.getElementById('kdf-envelope').textContent);

function render() {
  if (!isUnlocked()) {
    mount(container, unlockCard({ knownUsername: username, onUnlocked: render }));
    return;
  }
  const vault = currentVault();
  mount(container, [
    el('h1', { class: 'screen-heading', text: 'Settings' }),
    profileCard(vault),
    organizingCard(vault),
    changePasswordCard(vault),
    sessionCard(vault, render),
    exportCard(vault),
    importCard(vault, render),
    dangerZone(vault),
  ]);
}

function profileCard(vault) {
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

function row(label, value) {
  return el('p', { class: 'settings-row' }, [
    el('span', { class: 'settings-label', text: label }),
    el('span', { text: value }),
  ]);
}

function organizingCard(vault) {
  const count = vault.activeDimensions().length;
  return el('section', { class: 'card' }, [
    el('h2', { class: 'section-heading', text: 'Organizing' }),
    el('a', { class: 'link-row', href: '/settings/dimensions' }, [
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

function changePasswordCard(vault) {
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

  const idle = el('select', {}, [5, 10, 15, 30, 45, 60].map((minutes) =>
    el('option', { value: String(minutes), text: `${minutes} minutes` }),
  ));
  idle.value = String(vault.idleLockMinutes);
  idle.addEventListener('change', async () => {
    try {
      await writes.saveProfile(vault, {
        ...vault.profile,
        idleLockMinutes: Number(idle.value),
      });
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
              text: `Started ${shortDate(session.issuedAt.slice(0, 10))}, last used ${shortDate(session.lastActiveAt.slice(0, 10))}`,
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
function dangerZone(vault) {
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

onLock(render);
render();
