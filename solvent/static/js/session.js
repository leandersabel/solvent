// Turning a password into a session, and holding what comes out of it
// for exactly as long as the tab is open and unlocked
// (spec/features/login.md).
//
// Master Key and DEK live in these module variables and nowhere else:
// not localStorage, not sessionStorage, not a cookie. A refresh
// discards them by definition and requires the password again.
import * as api from './api.js';
import * as crypto from './crypto.js';
import { Vault } from './model.js';
import { deleteRecord } from './writes.js';

const DEFAULT_IDLE_MINUTES = 15;

let masterKey = null;
// The password credential as this tab last knew it: `{ salt, kdf }` and,
// for a vault owner, the DEK's wrapper `{ wrappedDek, dekNonce }` under
// the Master Key. A password change derives from the salt and unwraps
// the wrapper to prove the current password before sending anything
// (account-settings.md, The held credential). Public or ciphertext, as
// the rows they came from.
let held = null;
let vault = null;
let idleTimer = null;
const lockListeners = [];

export function currentVault() {
  return vault;
}

export function isUnlocked() {
  return vault !== null;
}

/** Whether any key material is held, which is wider than being
 *  unlocked: a registration whose first read failed holds the keys
 *  with no vault yet. What leaves a page must drop them all
 *  (architecture.md, Application hardening). */
export function holdsKeys() {
  return masterKey !== null || vault !== null;
}

export function onLock(listener) {
  lockListeners.push(listener);
}

export class SignInError extends Error {}

// ---- A vault replaced elsewhere (login.md, A vault replaced elsewhere) ----
let replacedListener = () => {};

/** `listener` draws what the page shows once its vault is closed
 *  because it was replaced. It runs after the keys are gone. */
export function onReplaced(listener) {
  replacedListener = listener;
}

/** The page learned its epoch was replaced, by an answer or by a
 *  message. */
function closeReplaced(tellOthers) {
  if (tellOthers) api.announce(api.vaultEpoch());
  api.setVaultEpoch(null);
  discardKeys();
  replacedListener();
}

api.whenReplaced(closeReplaced);

/** A lock came while the vault was being read, so the vault is not
 *  opened: the lock wins, and the caller shows the card the lock drew
 *  rather than the vault or an error. */
export class LockedWhileOpeningError extends Error {}

// Counts every discard of the keys. A read in flight compares it with
// the count it began at, so a lock that lands while it awaits the
// network is not undone by the read finishing.
let generation = 0;

/** The current password did not open the vault, found in the browser
 *  before anything was sent (account-settings.md, Change password). */
export class WrongPasswordError extends Error {}

/** The sign-in flow, identical for both kinds until a credential
 *  verifies.
 *
 *  Both halves of the derivation are built every time, including for
 *  an administrator, who then discards the Master Key. Skipping it for
 *  them would turn the sign-in screen into a stopwatch reading out
 *  which usernames administer the instance, to an attacker who never
 *  has to guess a password (login.md, Rules, The sign-in wait).
 */
export async function signIn(username, password) {
  let salt, kdf;
  try {
    ({ salt, kdf } = await api.post('/api/auth/salt', { username }));
  } catch (error) {
    // The limiter answers the salt request too, and a locked account
    // reads the same there as at the login.
    throw new SignInError(error.status === 429 ? 'throttled' : 'invalid');
  }
  const keys = await crypto.deriveKeys(password, salt, kdf);

  let answer;
  try {
    answer = await api.post('/api/auth/login', {
      username,
      authKey: keys.authKey,
    });
  } catch (error) {
    if (error.status === 429) throw new SignInError('throttled');
    throw new SignInError('invalid');
  }

  // A client that branches on a missing field treats a truncated
  // response as an administrator login, which is the one wrong guess
  // that must not be cheap to make.
  if (answer.kind !== 'vault_owner' && answer.kind !== 'administrator') {
    throw new SignInError('invalid');
  }

  if (answer.kind === 'administrator') {
    held = { salt, kdf };
    if (answer.kdfStale) await upgradeQuietly(password, answer.kdf, null);
    return { kind: 'administrator' };
  }
  // A page without an epoch could send no vault request.
  if (typeof answer.vaultEpoch !== 'string' || !answer.vaultEpoch) {
    throw new SignInError('invalid');
  }

  let dek;
  try {
    dek = await crypto.unwrapDek(answer.wrappedDek, answer.dekNonce, keys.masterKey);
  } catch {
    // A failed unwrap is itself an authentication failure. It means
    // corruption or tampering rather than a typo, so it is logged
    // server-side and surfaced as the same generic error.
    throw new SignInError('invalid');
  }

  // The page's epoch moves to the vault's before the vault is read,
  // since the read carries it. A different one means the vault was
  // replaced while this page was locked or its session had ended.
  const previous = api.vaultEpoch();
  api.setVaultEpoch(answer.vaultEpoch);
  const began = generation;
  try {
    await openVault(
      keys.masterKey,
      dek,
      { salt, kdf, wrappedDek: answer.wrappedDek, dekNonce: answer.dekNonce },
      began,
    );
  } catch (error) {
    // A vault that could not be read is not unlocked, and nothing
    // keeps the keys it was opened with: the card shows its error and
    // a page left now carries nothing. The epoch goes back to the one
    // the held input was typed against, unless the vault was found
    // replaced meanwhile and the page already dropped it.
    discardKeys();
    if (api.vaultEpoch() === answer.vaultEpoch) api.setVaultEpoch(previous);
    throw error;
  }

  if (answer.kdfStale) await upgradeQuietly(password, answer.kdf, dek);
  // The upgrade is another wait on the network, and may have put the
  // new Master Key in after a lock took the old one out.
  stillOpen(began);

  const replacedSince = previous !== null && previous !== answer.vaultEpoch;
  if (replacedSince) api.announce(previous);
  return { ...begin(username), replacedSince };
}

/** What a vault owner's registration hands over: the keys the form
 *  made, which the server never saw, and the name it just created.
 *
 *  Registration is the other way keys come to exist in a document, and
 *  it ends the way a sign-in does: the vault is read, the idle timer
 *  starts, and the document that holds the keys is the one that goes on
 *  to draw the vault. A page load here would drop them. The keys come
 *  in as arguments from the form in the same document and are not
 *  stored anywhere but the variables above. */
export async function startRegistered({ username, masterKey: key, dek, wrapper, salt, kdf }) {
  const began = generation;
  try {
    await openVault(key, dek, { salt, kdf, ...wrapper }, began);
  } catch (error) {
    // The keys are held for the retry, so the idle limit runs from now
    // as it would on an open vault. A lock during the read took them
    // already, and stays the last word.
    if (!(error instanceof LockedWhileOpeningError)) startIdleTimer();
    throw error;
  }
  return begin(username);
}

// Where both ways in meet: the keys are held, and the vault is read
// with them. The vault is open only once it has been read whole, and
// only if nothing locked it meanwhile.
async function openVault(key, dek, credential, began) {
  masterKey = key;
  held = credential;
  const next = new Vault(dek);
  try {
    await next.load();
  } catch (error) {
    // A lock during the read wins over the read failing.
    stillOpen(began);
    throw error;
  }
  stillOpen(began);
  vault = next;
  // A byte-identical pair loses nothing by going (record-rate.md, Two
  // entries on one date). One that fails to go is still read as a
  // pair, and tried again next unlock.
  for (const extra of next.redundantRateEntries()) {
    await deleteRecord(next, extra).catch(() => {});
  }
  stillOpen(began);
}

function stillOpen(began) {
  if (generation === began) return;
  discardKeys();
  throw new LockedWhileOpeningError();
}

function begin(username) {
  startIdleTimer();
  // The name that just verified, for every screen that shows or sends
  // it, since a page served without a session was never told it.
  return { kind: 'vault_owner', vault, username };
}

// A failed upgrade must never lock anyone out, of either kind: the
// session continues on the old parameters and retries next sign-in.
async function upgradeQuietly(password, targetKdf, dek) {
  try {
    await upgradeKdf(password, targetKdf, dek);
  } catch {
    /* retried on the next sign-in */
  }
}

async function upgradeKdf(password, targetKdf, dek) {
  const salt = crypto.b64encode(crypto.randomBytes(16));
  const keys = await crypto.deriveKeys(password, salt, targetKdf);
  const body = { salt, kdf: targetKdf, authKey: keys.authKey };
  const rewrapped = dek ? await crypto.wrapDek(dek, keys.masterKey) : null;
  Object.assign(body, rewrapped);
  await api.post('/api/auth/upgrade-kdf', body);
  held = { salt, kdf: targetKdf, ...rewrapped };
  if (dek) masterKey = keys.masterKey;
}

const sameEnvelope = (a, b) =>
  a.salt === b.salt && JSON.stringify(Object.entries(a.kdf).sort()) === JSON.stringify(Object.entries(b.kdf).sort());

/** Change password: the DEK does not change, so no vault record is
 *  re-encrypted. Only the envelope around the key is rebuilt, which is
 *  the whole reason the Master Key wraps a DEK instead of encrypting
 *  records directly (account-settings.md).
 *
 *  The current password is checked against the credential this tab
 *  holds, so a vault owner's wrong one sends nothing, a salt lookup
 *  included. */
export async function changePassword(username, currentPassword, newPassword, kdf) {
  const lookup = () => api.post('/api/auth/salt', { username });
  const credential = held ?? (await lookup());
  const derive = ({ salt, kdf: envelope }) => crypto.deriveKeys(currentPassword, salt, envelope);
  const current = await derive(credential);
  // For a vault owner the unwrap is the first of the two checks, and
  // a failure stops here with nothing sent. An administrator has
  // nothing to unwrap, so the server's check is their only one.
  if (held?.wrappedDek) {
    try {
      await crypto.unwrapDek(held.wrappedDek, held.dekNonce, current.masterKey);
    } catch {
      throw new WrongPasswordError();
    }
  }

  const salt = crypto.b64encode(crypto.randomBytes(16));
  const next = await crypto.deriveKeys(newPassword, salt, kdf);
  const body = {
    currentAuthKey: current.authKey,
    salt,
    kdf,
    authKey: next.authKey,
  };
  const rewrapped = vault ? await crypto.wrapDek(vault.dek, next.masterKey) : null;
  Object.assign(body, rewrapped);
  try {
    await api.post('/api/auth/change-password', body);
  } catch (failure) {
    if (failure.status !== 400) throw failure;
    // Another live session may have upgraded the credential since this
    // tab opened the vault. One lookup, and one resend when it differs.
    const fresh = await lookup();
    if (sameEnvelope(fresh, credential)) throw failure;
    body.currentAuthKey = (await derive(fresh)).authKey;
    await api.post('/api/auth/change-password', body);
  }
  held = { salt, kdf, ...rewrapped };
  if (vault) masterKey = next.masterKey;
}

export function authKeyFor(username, password) {
  return api
    .post('/api/auth/salt', { username })
    .then(({ salt, kdf }) => crypto.deriveKeys(password, salt, kdf))
    .then((keys) => keys.authKey);
}

export function wrapForMaster(dek) {
  return crypto.wrapDek(dek, masterKey);
}

/** After an import: the in-memory DEK becomes the new one, the page's
 *  epoch the one the import answered with, and every other page of this
 *  browser is told its epoch was replaced. The model is read again
 *  under the new DEK. The Master Key stays, because the password
 *  did not change (export-import.md, The re-key step). */
export async function replaceDek(dek, vaultEpoch, wrapped) {
  api.announce(api.vaultEpoch());
  api.setVaultEpoch(vaultEpoch);
  held = { ...held, ...wrapped };
  const next = new Vault(dek);
  await next.load();
  vault = next;
  return vault;
}

/** The lock, by hand or by the idle timer.
 *
 *  It discards the keys **and every decrypted value derived from
 *  them**, because dropping the keys alone would leave the lock
 *  cosmetic against the threat it exists for: another household member
 *  at the unlocked machine, who can open devtools. */
export function lock() {
  discardKeys();
  for (const listener of lockListeners) listener();
}

// The keys and the model, with nobody told: for a failure the screen
// that asked is already reporting, and a redraw would take its message
// away.
function discardKeys() {
  generation += 1;
  masterKey = null;
  held = null;
  vault = null;
  clearTimeout(idleTimer);
  idleTimer = null;
}

let listening = false;

function startIdleTimer() {
  if (!listening) {
    for (const event of ['pointerdown', 'keydown', 'scroll']) {
      document.addEventListener(event, restartIdleTimer, { passive: true });
    }
    listening = true;
  }
  restartIdleTimer();
}

/** Counts the period from now, at whatever the profile holds now. */
export function restartIdleTimer() {
  if (!holdsKeys()) return;
  clearTimeout(idleTimer);
  // A vault not read yet has no profile to name a period, so it has
  // the one a profile with no stored choice has (model.js).
  const minutes = vault ? vault.idleLockMinutes : DEFAULT_IDLE_MINUTES;
  idleTimer = setTimeout(lock, minutes * 60000);
}

export function signOut() {
  api.setVaultEpoch(null);
  lock();
  return api.post('/api/auth/logout', {});
}
