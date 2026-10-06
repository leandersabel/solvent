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
// long by design (login.md, Unlock).
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
import { get, whenUnauthorized } from './api.js';
import { onLock, onReplaced, currentVault, isUnlocked, holdsKeys, lock, signOut, startRegistered, LockedWhileOpeningError } from './session.js';
import { registerForm } from './register-form.js';
import { unlockCard } from './unlock.js';
import { dashboardView, datePicker as pickDate } from './view-dashboard.js';
import { holdingForm } from './view-holding-form.js';
import { holdingView } from './view-holding.js';
import { recordingView } from './view-recording.js';
import { resetSweepState, sweepView, unsavedOnSweep } from './view-sweep.js';
import { settingsView } from './view-settings.js';
import { dimensionsView, resetDimensionsState } from './view-dimensions.js';
import { transferView } from './page-transfer.js';

const container = document.getElementById('app');
// Who is signed in. The server writes it into a page it served with a
// session, and a sign-in on a page served without one supplies it,
// because the person just typed it (account-settings.md, Settings, Profile).
let username = container ? container.dataset.username || null : null;
const kdfNode = document.getElementById('kdf-envelope');
const kdf = kdfNode ? JSON.parse(kdfNode.textContent) : null;

// A vault owner's invite is served this page, in the outside frame,
// with what the form needs. The keys the form makes are in this
// document's memory, so this document draws the vault once they exist
// (register.md, Register). Null everywhere else, and again once it is used.
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

// A vault replaced from a file elsewhere (login.md, A vault replaced
// elsewhere). Each is `{ dropped }`, whether typed input went with it.
// `elsewhere` is the unlock card's state for a page that learned while
// it held the vault, and `sinceOpen` the dashboard's notice for a page
// that learned only at unlock. Nothing is kept for either beyond that.
let elsewhere = null;
let sinceOpen = null;
// Whether the page locked because a write found the password changed
// elsewhere (login.md, A credential changed elsewhere). The unlock
// card says so until it is left.
let credentialChanged = false;

// The address the vault was last drawn at. Arriving at a sweep from
// another screen begins a new sitting, while a redraw of the sweep on
// screen, or its return after a lock, continues it
// (record-snapshot.md, Update values).
let drawnHash = null;

/** Drops everything a lock keeps, from the screen as it stands or from
 *  what a lock already took, and says whether there was any. A replaced
 *  vault keeps no input, no dialog and no view. */
function dropKept() {
  const kept = vaultShown
    ? { fields: editedFields(container), dialogs: closeDialogsForLock() }
    : held;
  held = null;
  resetSweepState();
  resetDimensionsState();
  return Boolean(kept && (kept.fields.length || kept.dialogs.length));
}

// What a form closed with unsaved while navigating away, for the screen
// it went to. A form that navigates does so before it closes.
let leftOnForm = null;
document.addEventListener('leftunsaved', ({ detail }) => {
  if (window.location.hash === drawnHash) leftUnsaved(detail);
  else leftOnForm = detail;
});

// Where each history entry was left scrolled, by the key the entry
// carries in its state. A screen opened anew starts at its top, and
// Back or Forward returns to where its entry was left
// (app-shell.md, Where a screen opens). The browser's own restoring
// would measure against the screen being left.
history.scrollRestoration = 'manual';
const scrolled = new Map();
let shownEntry = null;

function render() {
  const left = unsavedOnSweep();
  const fromForm = leftOnForm;
  leftOnForm = null;
  const arriving = isUnlocked() && drawnHash !== window.location.hash;
  if (arriving && shownEntry) scrolled.set(shownEntry, window.scrollY);
  draw();
  if (arriving) {
    if (!history.state?.entry) history.replaceState({ entry: crypto.randomUUID() }, '');
    shownEntry = history.state.entry;
    scrollBack(scrolled.get(shownEntry) ?? 0);
  }
  leftUnsaved(left);
  if (fromForm) leftUnsaved(fromForm);
  markCurrentNav();
  vaultShown = isUnlocked();
  if (vaultShown) trackEdits(container);
}

/** Scrolls to `y`, and again whenever the screen grows before its
 *  second frame: the trend chart draws itself at its first layout, so
 *  the page reaches its full height only then (static/js/chart.js). */
function scrollBack(y) {
  window.scrollTo(0, y);
  const growing = new ResizeObserver(() => window.scrollTo(0, y));
  growing.observe(container);
  requestAnimationFrame(() => requestAnimationFrame(() => growing.disconnect()));
}

/** Leaving a sweep or the single-holding form with typed figures says
 *  so and names them, on the screen beneath or the one that replaced
 *  it. Nothing in the vault records them, because the unsaved half
 *  existed only in the screen that is gone (record-rate.md, Saving at
 *  a date that holds a recording). */
function leftUnsaved({ of = 'recording', date, names }) {
  if (!names.length || !isUnlocked()) return;
  const vault = currentVault();
  const on = date ? ` for ${vault.format.longDate(date)}` : '';
  container.prepend(
    el('p', { class: 'banner banner-critical', role: 'status' }, [
      `You left the ${of}${on} with changes that were not saved: ${names.join(', ')}.`,
    ]),
  );
}

// Each screen's own content width (spec/features/*.md, Screens), set on the
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
 *  password the person has just chosen (register.md, Register, States). */
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
      // A lock took the keys this card was offering to read with.
      if (!holdsKeys()) return;
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
        replaced: elsewhere,
        credentialChanged: credentialChanged && !elsewhere,
        onUnlocked: (result) => {
          credentialChanged = false;
          if (result.kind === 'administrator') {
            window.location.href = '/admin';
            return;
          }
          // The restored vault opens on the dashboard, never on a view
          // that can name a record the restore removed.
          if (result.replacedSince) sinceOpen = { dropped: dropKept() };
          if (result.replacedSince || elsewhere) {
            history.replaceState(null, '', '/dashboard#/');
            elsewhere = null;
          }
          enterVault(result.username);
        },
      }),
    );
    return;
  }
  const vault = currentVault();
  const arrived = drawnHash !== window.location.hash;
  drawnHash = window.location.hash;
  const [, view, argument, mode] = (window.location.hash || '#/').split('/');
  // The notice is the dashboard's, and goes once the person leaves it.
  if (['settings', 'holding', 'recording', 'sweep'].includes(view)) sinceOpen = null;

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
    if (arrived) resetSweepState();
    mount(container, sweepView(vault, argument, actions));
    return;
  }
  mount(container, dashboardView(vault, actions, {
    unassignedOf: view === 'unassigned' ? argument : null,
    replaced: sinceOpen,
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
  });
}

if (window.Alpine) registerVaultStore();
else document.addEventListener('alpine:init', registerVaultStore);

// A session that ran out mid-action is met by the lock: the card in its
// unlocking-again shape, with what was typed held until it is answered
// (login.md, Unlock, States).
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

// A page whose vault was replaced elsewhere learns it from a refused
// request, from a message of the restoring page, or on coming back into
// view, and draws the card at once, before anything more is sent.
onReplaced(() => {
  elsewhere = { dropped: dropKept() };
  sinceOpen = null;
  if (container) clear(container);
  render();
});

// How a page in another browser, or on another device, notices before
// it is used. The answer goes through the API module like any other and
// the body is discarded.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isUnlocked()) {
    get('/api/records?type=profile').catch(() => {});
  }
});

onLock((reason) => {
  credentialChanged = reason.credentialChanged;
  elsewhere = null;
  sinceOpen = null;
  resetDimensionsState();
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
