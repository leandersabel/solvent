// The vault application: the unlock gate, and the views behind it.
//
// Everything past the gate is client-rendered from decrypted records,
// so the views are hash routes rather than server routes: the server
// has no plaintext to render at any of them (spec/features/
// app-shell.md, Rules).
import { clear, dialog, el, mount } from './dom.js';
import { onLock, currentVault, isUnlocked, lock, signOut } from './session.js';
import { unlockCard } from './unlock.js';
import { dashboardView } from './view-dashboard.js';
import { holdingForm } from './view-forms.js';
import { holdingView } from './view-holding.js';
import { recordingView } from './view-recording.js';
import { resetSweepState, sweepView } from './view-sweep.js';

const container = document.getElementById('app');
const username = container ? container.dataset.username : null;

function render() {
  if (!isUnlocked()) {
    mount(container, unlockCard({ knownUsername: username, onUnlocked: render }));
    return;
  }
  const vault = currentVault();
  const [, view, argument] = (window.location.hash || '#/').split('/');

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
document.addEventListener('alpine:init', () => {
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
});

onLock(() => {
  if (container) clear(container);
  render();
});

if (container) render();
