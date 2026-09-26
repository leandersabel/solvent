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

let masterKey = null;
// The DEK as the server holds it, wrapped under the Master Key: what a
// password change unwraps to prove the current password before sending
// anything. Ciphertext, as public as the row it came from.
let wrapper = null;
let vault = null;
let idleTimer = null;
const lockListeners = [];

export function currentVault() {
  return vault;
}

export function isUnlocked() {
  return vault !== null;
}

export function onLock(listener) {
  lockListeners.push(listener);
}

export class SignInError extends Error {}

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
    if (answer.kdfStale) await upgradeQuietly(password, answer.kdf, null);
    return { kind: 'administrator' };
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

  masterKey = keys.masterKey;
  wrapper = { wrappedDek: answer.wrappedDek, dekNonce: answer.dekNonce };
  vault = new Vault(dek);
  await vault.load();
  // A byte-identical pair loses nothing by going (record-rate.md, Two
  // entries on one date). One that fails to go is still read as a
  // pair, and tried again next unlock.
  for (const extra of vault.redundantRateEntries()) {
    await deleteRecord(vault, extra).catch(() => {});
  }

  if (answer.kdfStale) await upgradeQuietly(password, answer.kdf, dek);

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
  if (dek) {
    masterKey = keys.masterKey;
    wrapper = rewrapped;
  }
}

/** Change password: the DEK does not change, so no vault record is
 *  re-encrypted. Only the envelope around the key is rebuilt, which is
 *  the whole reason the Master Key wraps a DEK instead of encrypting
 *  records directly (account-settings.md). */
export async function changePassword(username, currentPassword, newPassword, kdf) {
  const { salt: currentSalt, kdf: currentKdf } = await api.post('/api/auth/salt', {
    username,
  });
  const current = await crypto.deriveKeys(currentPassword, currentSalt, currentKdf);
  // For a vault owner the unwrap is the first of the two checks, and
  // a failure stops here with nothing sent. An administrator has
  // nothing to unwrap, so the server's check is their only one.
  if (wrapper) {
    try {
      await crypto.unwrapDek(wrapper.wrappedDek, wrapper.dekNonce, current.masterKey);
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
  await api.post('/api/auth/change-password', body);
  if (vault) {
    masterKey = next.masterKey;
    wrapper = rewrapped;
  }
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

/** After an import: the in-memory DEK becomes the new one and the model
 *  is read again under it. The Master Key stays, because the password
 *  did not change (export-import.md, The re-key step). */
export async function replaceDek(dek) {
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
  masterKey = null;
  wrapper = null;
  vault = null;
  clearTimeout(idleTimer);
  idleTimer = null;
  for (const listener of lockListeners) listener();
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
  if (!vault) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(lock, vault.idleLockMinutes * 60000);
}

export function signOut() {
  lock();
  return api.post('/api/auth/logout', {});
}
