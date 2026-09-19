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

let masterKey = null;
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
  const { salt, kdf } = await api.post('/api/auth/salt', { username });
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
    if (answer.kdfStale) await upgradeKdf(password, answer.kdf, null);
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
  vault = new Vault(dek);
  await vault.load();

  if (answer.kdfStale) {
    // A failed upgrade must never lock anyone out: the session
    // continues on the old parameters and retries next sign-in.
    try {
      await upgradeKdf(password, answer.kdf, dek);
    } catch {
      /* retried on the next sign-in */
    }
  }

  startIdleTimer();
  return { kind: 'vault_owner', vault };
}

async function upgradeKdf(password, targetKdf, dek) {
  const salt = crypto.b64encode(crypto.randomBytes(16));
  const keys = await crypto.deriveKeys(password, salt, targetKdf);
  const body = { salt, kdf: targetKdf, authKey: keys.authKey };
  if (dek) Object.assign(body, await crypto.wrapDek(dek, keys.masterKey));
  await api.post('/api/auth/upgrade-kdf', body);
  if (dek) masterKey = keys.masterKey;
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

  const salt = crypto.b64encode(crypto.randomBytes(16));
  const next = await crypto.deriveKeys(newPassword, salt, kdf);
  const body = {
    currentAuthKey: current.authKey,
    salt,
    kdf,
    authKey: next.authKey,
  };
  if (vault) Object.assign(body, await crypto.wrapDek(vault.dek, next.masterKey));
  await api.post('/api/auth/change-password', body);
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

/** The lock, by hand or by the idle timer.
 *
 *  It discards the keys **and every decrypted value derived from
 *  them**, because dropping the keys alone would leave the lock
 *  cosmetic against the threat it exists for: another household member
 *  at the unlocked machine, who can open devtools. */
export function lock() {
  masterKey = null;
  vault = null;
  clearTimeout(idleTimer);
  idleTimer = null;
  for (const listener of lockListeners) listener();
}

function startIdleTimer() {
  const reset = () => {
    if (!vault) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(lock, vault.idleLockMinutes * 60000);
  };
  for (const event of ['pointerdown', 'keydown', 'scroll']) {
    document.addEventListener(event, reset, { passive: true });
  }
  reset();
}

export function restartIdleTimer() {
  if (vault) startIdleTimer();
}

export function signOut() {
  lock();
  return api.post('/api/auth/logout', {});
}
