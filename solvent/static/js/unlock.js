// The one sign-in card, at one address, for both kinds of account
// (spec/features/login.md, Unlock).
//
// It looks and behaves identically for both until a correct password
// has been given: same fields, same wording, same button, same wait,
// same failures. Nothing on it announces, before then, that a username
// belongs to an administrator, and nothing hints that an admin area
// exists.
import { el, REPLACED_ELSEWHERE, replacedCallout } from './dom.js';
import { DerivationError } from './crypto.js';
import { LockedWhileOpeningError, SignInError, signIn, signOut } from './session.js';

export const WAIT_NOTE =
  'This takes a moment by design. It is what makes your password hard to attack.';

/** `replaced`, `{ dropped }`, draws the Replaced elsewhere state: the
 *  vault was replaced from a file while this page held it. */
export function unlockCard({ knownUsername = null, replaced = null, onUnlocked }) {
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const password = el('input', {
    type: 'password',
    id: 'unlock-password',
    autocomplete: 'current-password',
    required: true,
  });
  const username = el('input', {
    type: 'text',
    id: 'unlock-username',
    autocomplete: 'username',
    required: true,
    autocapitalize: 'none',
    spellcheck: 'false',
  });
  const button = el('button', { type: 'submit', class: 'btn-primary btn-block', text: 'Unlock' });
  const note = el('p', { class: 'hint', hidden: true, text: WAIT_NOTE });
  // Closing other tabs genuinely can free the memory, so this runs the
  // derivation again rather than only clearing the message.
  const retry = el('button', {
    type: 'button',
    class: 'btn-secondary',
    text: 'Try again',
    hidden: true,
    onclick: () => form.requestSubmit(),
  });

  // Unlocking again, a hidden text field carries the known username so a
  // password manager can pair it with the password. `type=hidden` would
  // not be read as a username. Sign-in never reads it.
  const identity = knownUsername
    ? el('p', { class: 'known-username' }, [
        el('input', { type: 'text', autocomplete: 'username', value: knownUsername, hidden: true }),
        el('span', { text: knownUsername }),
        el('a', { href: '/api/auth/logout', class: 'link-quiet', text: 'Not you? Sign out', onclick: signOutLink }),
      ])
    : el('div', { class: 'field' }, [
        el('label', { for: 'unlock-username', text: 'Username' }),
        username,
      ]);

  // The wordmark sits above the card: in the page's own markup outside
  // the shell, and in the top bar inside it.
  const form = el('form', { class: 'card signin-card', novalidate: true, 'aria-label': 'Unlock' }, [
    replaced ? replacedCallout(REPLACED_ELSEWHERE, replaced.dropped) : null,
    identity,
    error,
    el('div', { class: 'field' }, [
      el('label', { for: 'unlock-password', text: 'Password' }),
      passwordWithToggle(password),
    ]),
    button,
    note,
    retry,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    retry.hidden = true;
    const name = knownUsername || username.value.trim().toLowerCase();
    if (!name || !password.value) return;

    // The button becomes a working state and the form goes quiet. The
    // wait is the screen's defining moment and it must never look like
    // a hang.
    const typed = password.value;
    quiet(true);
    button.textContent = 'Deriving your key';
    note.hidden = false;

    let stopped = false;
    try {
      const result = await signIn(name, typed);
      password.value = '';
      onUnlocked(result);
    } catch (failure) {
      // The page was locked while the vault was being read. The lock
      // has drawn its own card, and this one is no longer on screen.
      if (failure instanceof LockedWhileOpeningError) return;
      show(error, messageFor(failure));
      if (failure instanceof DerivationError) {
        // Out of memory is a moment, and Try again can meet it. A
        // browser that cannot run the encryption at all is a hard
        // stop, because there is no weaker unlock to fall back to.
        if (failure.outOfMemory) retry.hidden = false;
        else stopped = true;
      }
    } finally {
      button.textContent = 'Unlock';
      note.hidden = true;
      quiet(stopped);
    }
  });

  function quiet(on) {
    for (const control of [username, password, button, ...form.querySelectorAll('.password-field button')]) {
      control.disabled = on;
    }
  }

  return el('div', { class: 'outside' }, [
    form,
    el('p', {
      class: 'outside-footnote',
      text: 'Solvent cannot recover a lost password.',
    }),
  ]);
}

function signOutLink(event) {
  event.preventDefault();
  signOut().finally(() => {
    window.location.href = '/login';
  });
}

function messageFor(failure) {
  if (failure instanceof SignInError && failure.message === 'throttled') {
    return 'Too many attempts. Try again in a few minutes.';
  }
  if (failure instanceof SignInError && failure.message === 'unreachable') {
    return 'That did not go through. Everything you typed is still here, so you can try again.';
  }
  if (failure instanceof DerivationError) {
    return failure.outOfMemory
      ? 'This device does not have enough memory available right now. Close some other tabs and try again.'
      : 'This browser cannot run the encryption Solvent needs. There is no weaker fallback.';
  }
  // Wrong password, a username nobody has, and a vault that would not
  // open are one message, one placement and one speed. The screen must
  // not distinguish them, including by how fast it gives up.
  return 'Invalid username or password.';
}

export function show(node, text) {
  node.textContent = text;
  node.hidden = false;
}

export function passwordWithToggle(input) {
  const toggle = el('button', {
    type: 'button',
    class: 'btn-inline',
    text: 'Show',
    'aria-pressed': 'false',
    onclick: () => {
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      toggle.textContent = shown ? 'Show' : 'Hide';
      toggle.setAttribute('aria-pressed', String(!shown));
    },
  });
  return el('div', { class: 'password-field' }, [input, toggle]);
}
