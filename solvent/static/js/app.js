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
  markCurrentNav,
  mount,
  reopenDialogs,
  restoreFields,
  resumable,
  revealChrome,
  trackEdits,
} from './dom.js';
import { onLock, currentVault, isUnlocked, lock, signOut } from './session.js';
import { unlockCard } from './unlock.js';
import { dashboardView, datePicker as pickDate } from './view-dashboard.js';
import { holdingForm } from './view-forms.js';
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

function draw() {
  if (!isUnlocked()) {
    width('outside');
    mount(
      container,
      unlockCard({
        knownUsername: username,
        onUnlocked: (result) => {
          if (result.kind === 'administrator') {
            window.location.href = '/admin';
            return;
          }
          username = result.username;
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
