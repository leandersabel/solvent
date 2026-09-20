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
import { clear, dialog, el, mount, revealChrome } from './dom.js';
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

function render() {
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
        },
      }),
    );
    return;
  }
  const vault = currentVault();
  const [, view, argument] = (window.location.hash || '#/').split('/');

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

  const actions = {
    reload: render,
    openHolding: (id) => go(`#/holding/${id}`),
    openRecording: (date) => go(`#/recording/${date}`),
    openSweep: (date) => {
      resetSweepState();
      go(`#/sweep/${date}`);
    },
    addHolding: () => addHoldingDialog(vault),
  };

  if (view === 'holding') {
    mount(container, [
      backLink(),
      holdingView(vault, argument, {
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
    body: [
      holdingForm(vault, null, () => {
        close();
        render();
      }),
    ],
    actions: [el('button', { class: 'btn-secondary', text: 'Cancel', onclick: () => close() })],
  });
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
      signOut().finally(() => {
        window.location.href = '/login';
      });
    },
  });
}

if (window.Alpine) registerVaultStore();
else document.addEventListener('alpine:init', registerVaultStore);

onLock(() => {
  if (container) clear(container);
  render();
});

if (container) render();
