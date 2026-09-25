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
  mount,
  reopenDialogs,
  restoreFields,
  resumable,
  revealChrome,
  trackEdits,
} from './dom.js';
import { onLock, currentVault, isUnlocked, lock, signOut } from './session.js';
import { unlockCard } from './unlock.js';
import { dashboardView } from './view-dashboard.js';
import { holdingForm } from './view-forms.js';
import { holdingView } from './view-holding.js';
import { recordingView } from './view-recording.js';
import { resetSweepState, sweepView } from './view-sweep.js';
import { settingsView } from './view-settings.js';
import { dimensionsView } from './view-dimensions.js';

const container = document.getElementById('app');
const username = container ? container.dataset.username : null;
const kdfNode = document.getElementById('kdf-envelope');
const kdf = kdfNode ? JSON.parse(kdfNode.textContent) : null;

// What the person was typing when the vault locked: plain field values,
// the address they were typed at, and the way back into each open
// form. Never the screen or the vault they were typed against
// (login.md, Rules, the one named exception).
let held = null;
let vaultShown = false;

function render() {
  draw();
  vaultShown = isUnlocked();
  if (vaultShown) trackEdits(container);
}

function draw() {
  if (!isUnlocked()) {
    mount(
      container,
      unlockCard({
        knownUsername: username,
        onUnlocked: (result) => {
          if (result.kind === 'administrator') {
            window.location.href = '/admin';
            return;
          }
          revealChrome('vault_owner', {
            onUpdate: () => {
              resetSweepState();
              go(`#/sweep/${new Date().toISOString().slice(0, 10)}`);
            },
            onLock: lock,
            onSignOut: signOut,
          });
          render();
          resumeHeld();
        },
      }),
    );
    return;
  }
  const vault = currentVault();
  const [, view, argument, mode] = (window.location.hash || '#/').split('/');

  if (view === 'settings' && argument === 'dimensions') {
    mount(container, [backLink(), ...dimensionsView(vault, { reload: render })]);
    return;
  }
  if (view === 'settings') {
    mount(container, [
      backLink(),
      ...settingsView(vault, {
        username,
        kdf,
        reload: render,
        openDimensions: () => go('#/settings/dimensions'),
      }),
    ]);
    return;
  }

  const actions = actionsFor(vault);

  if (view === 'holding') {
    mount(container, [
      backLink(),
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
      backLink(),
      recordingView(vault, argument, {
        onUpdate: actions.openSweep,
        onOpenHolding: actions.openHolding,
        onDeleted: () => go('#/'),
        onChanged: render,
      }),
    ]);
    return;
  }
  if (view === 'sweep') {
    mount(container, [
      backLink(),
      sweepView(vault, argument, { onDone: () => go('#/') }),
    ]);
    return;
  }
  mount(container, dashboardView(vault, actions));
}

function actionsFor(vault) {
  return {
    reload: render,
    home: () => go('#/'),
    openHolding: (id) => go(`#/holding/${id}`),
    openRecording: (date) => go(`#/recording/${date}`),
    openSweep: (date) => {
      resetSweepState();
      go(`#/sweep/${date}`);
    },
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

function backLink() {
  return el('button', {
    class: 'link-button back',
    text: '← Dashboard',
    onclick: () => go('#/'),
  });
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
    clear: lock,
    updateValues() {
      resetSweepState();
      go(`#/sweep/${new Date().toISOString().slice(0, 10)}`);
    },
    signOut() {
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
