// The vault application: the unlock gate, and every view behind it.
//
// Everything past the gate is client-rendered from decrypted records,
// so the views are hash routes rather than server routes: the server
// has no plaintext to render at any of them (spec/features/
// app-shell.md, Rules).
//
// One page holds all of them, settings and dimensions included,
// because the keys live in this page's memory and nothing else. A
// second server page would mean a second derivation, and the wait is
// long by design (ui/unlock.md).
import {
  clear,
  closeDialogsForLock,
  dialog,
  editedFields,
  el,
  enterOutsideFrame,
  markCurrentNav,
  mount,
  reopenDialogs,
  restoreFields,
  resumable,
  revealChrome,
  today,
  trackEdits,
} from './dom.js';
import { whenUnauthorized } from './api.js';
import { onLock, currentVault, isUnlocked, holdsKeys, lock, signOut, startRegistered, LockedWhileOpeningError } from './session.js';
import { registerForm } from './register-form.js';
import { unlockCard } from './unlock.js';
import { dashboardView, datePicker as pickDate } from './view-dashboard.js';
import { holdingForm } from './view-holding-form.js';
import { holdingView } from './view-holding.js';
import { recordingView } from './view-recording.js';
import { resetSweepState, sweepView, unsavedOnSweep } from './view-sweep.js';
import { settingsView } from './view-settings.js';
import { dimensionsView } from './view-dimensions.js';
import { transferView } from './page-transfer.js';

const container = document.getElementById('app');
// Who is signed in. The server writes it into a page it served with a
// session, and a sign-in on a page served without one supplies it,
// because the person just typed it (ui/settings.md, Profile).
let username = container ? container.dataset.username || null : null;
const kdfNode = document.getElementById('kdf-envelope');
const kdf = kdfNode ? JSON.parse(kdfNode.textContent) : null;

// A vault owner's invite is served this page, in the outside frame,
// with what the form needs. The keys the form makes are in this
// document's memory, so this document draws the vault once they exist
// (ui/register.md). Null everywhere else, and again once it is used.
let registration = null;
let registrationForm = null;
if (container && container.dataset.kind === 'vault_owner') {
  registration = {
    token: container.dataset.token,
    currencies: JSON.parse(container.dataset.currencies || '[]'),
  };
  // The form holds the token, so the address bar drops it: a bookmark,
  // a shared screen or a synced history afterwards carries nothing
  // (admin-invites.md, Rules).
  history.replaceState(null, '', window.location.pathname);
  delete container.dataset.token;
}

// What the person was typing when the vault locked: plain field values,
// the address they were typed at, and the way back into each open
// form. Never the screen or the vault they were typed against
// (login.md, Rules, the one named exception).
let held = null;
let vaultShown = false;

function render() {
  const left = unsavedOnSweep();
  draw();
  leftUnsaved(left);
  markCurrentNav();
  vaultShown = isUnlocked();
  if (vaultShown) trackEdits(container);
}

/** Leaving a sweep with typed figures says so and names them, on the
 *  screen that replaced it. Nothing in the vault records them, because
 *  the unsaved half existed only in the screen that is gone
 *  (record-rate.md, Saving an edited recording). */
function leftUnsaved({ date, names }) {
  if (!names.length || !isUnlocked()) return;
  const vault = currentVault();
  container.prepend(
    el('p', { class: 'banner banner-critical', role: 'status' }, [
      `You left the recording for ${vault.format.longDate(date)} with changes that were not saved: ${names.join(', ')}.`,
    ]),
  );
}

// Each screen's own content width (spec/ui/*.md, Layout), set on the
// region every view mounts into.
function width(name) {
  container.className = `app-${name}`;
}

/** The keys exist and this document holds them: show the chrome and
 *  draw the vault, in place. A page served at the sign-in or
 *  registration address moves to the dashboard's address without
 *  loading it, which would find no keys and ask for the password
 *  again. Where the page was already the dashboard, its address
 *  stands, whatever view it named. */
function enterVault(name) {
  username = name;
  if (window.location.pathname !== '/dashboard') {
    history.replaceState(null, '', '/dashboard#/');
  }
  revealChrome('vault_owner', {
    onUpdate: () => openSweep(today()),
    onLock: lock,
    onSignOut: signOut,
  });
  render();
  resumeHeld();
}

async function registered(created) {
  registration = null;
  registrationForm = null;
  // Who the card asks for if an idle lock comes before the vault is read.
  username = created.username;
  await readRegistered(created);
}

/** Reads the new vault, in this document. The account exists, its
 *  session is live and the keys are held, so a read that fails is
 *  offered again here: loading a page, or locking, would ask for the
 *  password the person has just chosen (ui/register.md, States). */
async function readRegistered(created) {
  let result;
  try {
    result = await startRegistered(created);
  } catch (failure) {
    // A lock came while the vault was being read. It has drawn the
    // card that asks for the password, and that stands.
    if (failure instanceof LockedWhileOpeningError) return;
    width('outside');
    const retry = el('button', { type: 'button', class: 'btn-primary', text: 'Try again' });
    retry.addEventListener('click', () => {
      retry.disabled = true;
      readRegistered(created);
    });
    mount(
      container,
      el('div', { class: 'outside' }, [
        el('div', { class: 'card card-narrow', role: 'alert' }, [
          el('h1', { class: 'card-heading', text: 'Your vault is created' }),
          el('p', {
            class: 'hint',
            text: 'It could not be read just now. Nothing was lost, and you do not need to type your password again.',
          }),
          retry,
        ]),
      ]),
    );
    return;
  }
  enterVault(result.username);
}

function draw() {
  if (!isUnlocked()) {
    enterOutsideFrame();
    width('outside');
    if (registration) {
      // Built once, so a redraw does not take away what was typed.
      registrationForm ??= registerForm({
        kind: 'vault_owner',
        token: registration.token,
        currencies: registration.currencies,
        kdf,
        onCreated: registered,
      });
      mount(container, registrationForm);
      return;
    }
    mount(
      container,
      unlockCard({
        knownUsername: username,
        onUnlocked: (result) => {
          if (result.kind === 'administrator') {
            window.location.href = '/admin';
            return;
          }
          enterVault(result.username);
        },
      }),
    );
    return;
  }
  const vault = currentVault();
  const [, view, argument, mode] = (window.location.hash || '#/').split('/');

  if (view === 'settings' && argument === 'dimensions') {
    width('narrow');
    mount(container, dimensionsView(vault, {
      reload: render,
      openUnassigned: (dimensionId) => go(`#/unassigned/${dimensionId}`),
    }));
    return;
  }
  if (view === 'settings' && argument === 'export-import') {
    width('narrow');
    mount(container, transferView(vault, { reload: render }));
    return;
  }
  if (view === 'settings') {
    width('narrow');
    mount(container, settingsView(vault, {
      username,
      kdf,
      reload: render,
      open: (address) => go(`#/settings/${address}`),
    }));
    return;
  }

  const actions = actionsFor(vault);
  width(['holding', 'recording', 'sweep'].includes(view) ? 'medium' : 'wide');

  if (view === 'holding') {
    mount(container, [
      holdingView(vault, argument, {
        editing: mode === 'edit',
        onOpenRecording: actions.openRecording,
        onChanged: render,
        onGone: () => go('#/'),
      }),
    ]);
    return;
  }
  if (view === 'recording') {
    mount(container, [
      recordingView(vault, argument, {
        onUpdate: actions.openSweep,
        onOpenHolding: actions.openHolding,
        onDeleted: () => go('#/'),
        onChanged: render,
        onPickDate: () => pickDate(vault, actions),
      }),
    ]);
    return;
  }
  if (view === 'sweep') {
    mount(container, sweepView(vault, argument, actions));
    return;
  }
  mount(container, dashboardView(vault, actions, {
    unassignedOf: view === 'unassigned' ? argument : null,
  }));
}

function actionsFor(vault) {
  return {
    reload: render,
    home: () => go('#/'),
    openHolding: (id) => go(`#/holding/${id}`),
    openRecording: (date) => go(`#/recording/${date}`),
    openSweep,
    addHolding: () => addHoldingDialog(vault),
  };
}

/** Back where the lock found the person: the same screen, which the
 *  address already restores, with what they had typed into it, and
 *  each form they had open reopened against the new vault. The values
 *  wait a turn for the parts of a form that fill in asynchronously,
 *  such as the unit list. */
function resumeHeld() {
  if (!held) return;
  const { hash, fields, dialogs } = held;
  held = null;
  const vault = currentVault();
  setTimeout(() => {
    if (!isUnlocked()) return;
    if (hash === window.location.hash) restoreFields(container, fields);
    reopenDialogs(dialogs, { vault, ...actionsFor(vault) });
  }, 0);
}

function openSweep(date) {
  resetSweepState();
  go(`#/sweep/${date}`);
}

function go(hash) {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

function addHoldingDialog(vault) {
  const close = dialog({
    heading: 'Add a holding',
    resume: resumable(reopenAddHolding),
    body: [
      holdingForm(vault, null, () => {
        close();
        render();
      }),
    ],
    actions: [el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() })],
  });
}

function reopenAddHolding({ vault }) {
  addHoldingDialog(vault);
}

window.addEventListener('hashchange', render);

// The chrome reaches the data layer through this store and knows
// nothing of what it holds (static/js/shell.js).
//
// Registered either way round: this is a module script, so it runs
// after the deferred classic scripts that boot Alpine, and whether
// `alpine:init` has already fired depends on when Alpine starts. A
// listener alone would silently miss it and leave the top bar's two
// controls doing nothing.
function registerVaultStore() {
  window.Alpine.store('vault', {
    // Nothing here acts on a vault that is locked: the bar is not on
    // screen then, and a stray call must not reach one.
    clear() {
      if (isUnlocked()) lock();
    },
    updateValues() {
      if (isUnlocked()) openSweep(today());
    },
    signOut() {
      if (!isUnlocked()) return;
      const leaving = signOut();
      held = null;
      leaving.finally(() => {
        window.location.href = '/login';
      });
    },
  });
}

if (window.Alpine) registerVaultStore();
else document.addEventListener('alpine:init', registerVaultStore);

// A session that ran out mid-action is met by the lock: the card in its
// unlocking-again shape, with what was typed held until it is answered
// (ui/unlock.md, States).
whenUnauthorized(() => {
  if (isUnlocked()) lock();
});

// A page left while unlocked keeps no keys. The browser may hold it for
// Back in its back-forward cache, so leaving locks it the way the idle
// timer does, and Back finds the unlock card (architecture.md,
// Application hardening).
window.addEventListener('pagehide', () => {
  if (holdsKeys()) lock();
});

onLock(() => {
  if (container && vaultShown) {
    held = {
      hash: window.location.hash,
      fields: editedFields(container),
      dialogs: closeDialogsForLock(),
    };
    clear(container);
  }
  render();
});

if (container) render();
