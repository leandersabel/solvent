// Every call the browser makes, carrying the header that makes it a
// same-origin fetch rather than something a navigation could trigger
// (spec/architecture.md, Application hardening).
//
// A cross-origin page cannot set this header without a preflight, and
// the preflight fails because no CORS headers are served. That is the
// whole CSRF control, GET /api/export included.

const HEADER = { 'X-Solvent-Request': '1' };

// The vault epoch this page holds, sent on every request once it holds
// one (architecture.md, Vault epoch). Page memory only: never storage.
// It outlives a lock, because the next sign-in compares it
// (login.md, A vault replaced elsewhere).
let epoch = null;

export const vaultEpoch = () => epoch;

export function setVaultEpoch(value) {
  epoch = value;
  if (value) listen();
}

// An import gives the vault a new DEK, so every other page holding the
// old one closes the vault. The message names the replaced epoch and
// nothing else: no key, no new epoch, nothing decrypted. The channel
// opens once the page holds an epoch, because a page holding none acts
// on no message.
let channel = null;

function listen() {
  if (channel || typeof BroadcastChannel !== 'function') return;
  channel = new BroadcastChannel('solvent-vault');
  channel.addEventListener('message', ({ data }) => {
    const shaped = data && typeof data === 'object' && Object.keys(data).join() === 'replaced';
    if (epoch && shaped && data.replaced === epoch) replaced(false);
  });
}

/** Tells the other pages of this browser that `replacedEpoch` was
 *  replaced. */
export function announce(replacedEpoch) {
  if (channel && replacedEpoch) channel.postMessage({ replaced: replacedEpoch });
}

const headers = () => (epoch ? { ...HEADER, 'X-Solvent-Vault': epoch } : { ...HEADER });

// The routes that answer without an epoch, and so ignore this page
// losing it: a sign-out discards it, and its answer still arrives.
const PUBLIC = new Set(['/api/auth/salt', '/api/auth/login', '/api/auth/logout', '/api/register']);

// The vault this page holds was replaced from a file elsewhere. Set by
// session.js, which owns the keys the page then drops. Told whether to
// announce it on the channel: a page that learned from an answer does,
// and one that learned from a message does not, since every page on the
// channel got the same message.
let replaced = () => {};

export function whenReplaced(listener) {
  replaced = listener;
}

// A request that finds the vault replaced, or answers after the page
// closed it, draws nothing: no caller sees it, so no screen runs its
// own version-conflict reload on it.
const never = () => new Promise(() => {});

const isReplaced = (error) => error.status === 409 && error.body?.refused === 'vault-replaced';

// A session that ran out mid-action answers Unauthorized, and the vault
// asks for the password again rather than losing what was typed
// (spec/ui/unlock.md, States). A wrong password at sign-in answers
// Unauthorized too, which is that screen's own answer and not this.
let unauthorized = () => {};

export function whenUnauthorized(listener) {
  unauthorized = listener;
}

function failed(status, path) {
  if (status === 401 && path !== '/api/auth/login') unauthorized();
  return new ApiError(status);
}

// `body` is the answer's JSON, or null when it was not JSON. Only a
// caller that reads a reason from it looks (register-form.js).
class ApiError extends Error {
  constructor(status) {
    super(`request failed with status ${status}`);
    this.status = status;
    this.body = null;
  }
}

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function call(method, path, body) {
  const init = { method, headers: headers(), credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const sent = epoch;
  const response = await fetch(path, init);
  return settle(response, path, sent, async () => {
    if (response.status === 204) return null;
    return response.json();
  });
}

// What a response becomes once the page has checked it is still about
// the vault the page holds: its body, an error, or nothing at all.
async function settle(response, path, sent, read) {
  if (sent !== epoch && !PUBLIC.has(path.split('?')[0])) return never();
  if (!response.ok) {
    const error = failed(response.status, path);
    error.body = await jsonOrNull(response);
    if (isReplaced(error)) {
      replaced(true);
      return never();
    }
    throw error;
  }
  return read();
}

export const get = (path) => call('GET', path);
export const post = (path, body) => call('POST', path, body);
export const put = (path, body) => call('PUT', path, body);
export const patch = (path, body) => call('PATCH', path, body);
export const del = (path, body) => call('DELETE', path, body);

// The one call whose No Content is an answer rather than an error: a
// rate with no proposal available (architecture.md, Status codes).
export async function getRates(params) {
  const sent = epoch;
  const response = await fetch('/api/rates?' + new URLSearchParams(params), {
    headers: headers(),
    credentials: 'same-origin',
  });
  return settle(response, '/api/rates', sent, async () => (response.status === 204 ? null : response.json()));
}

// Export requires the header despite being a GET, so it is fetched and
// saved through a blob rather than pointed at by an <a href>
// (export-import.md, Export).
export async function downloadExport() {
  const sent = epoch;
  const response = await fetch('/api/export', {
    headers: headers(),
    credentials: 'same-origin',
  });
  return settle(response, '/api/export', sent, () => exportOf(response));
}

async function exportOf(response) {
  const disposition = response.headers.get('Content-Disposition') || '';
  const named = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: named ? named[1] : 'solvent-vault.json' };
}
