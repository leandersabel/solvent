// Every call the browser makes, carrying the header that makes it a
// same-origin fetch rather than something a navigation could trigger
// (spec/architecture.md, Application hardening).
//
// A cross-origin page cannot set this header without a preflight, and
// the preflight fails because no CORS headers are served. That is the
// whole CSRF control, GET /api/export included.

const HEADER = { 'X-Solvent-Request': '1' };

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
  const init = { method, headers: { ...HEADER }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) {
    const error = failed(response.status, path);
    error.body = await jsonOrNull(response);
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

export const get = (path) => call('GET', path);
export const post = (path, body) => call('POST', path, body);
export const put = (path, body) => call('PUT', path, body);
export const patch = (path, body) => call('PATCH', path, body);
export const del = (path, body) => call('DELETE', path, body);

// The one call whose No Content is an answer rather than an error: a
// rate with no proposal available (architecture.md, Status codes).
export async function getRates(params) {
  const response = await fetch('/api/rates?' + new URLSearchParams(params), {
    headers: { ...HEADER },
    credentials: 'same-origin',
  });
  if (response.status === 204) return null;
  if (!response.ok) throw failed(response.status, '/api/rates');
  return response.json();
}

// Export requires the header despite being a GET, so it is fetched and
// saved through a blob rather than pointed at by an <a href>
// (export-import.md, Export).
export async function downloadExport() {
  const response = await fetch('/api/export', {
    headers: { ...HEADER },
    credentials: 'same-origin',
  });
  if (!response.ok) throw failed(response.status, '/api/export');
  const disposition = response.headers.get('Content-Disposition') || '';
  const named = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: named ? named[1] : 'solvent-vault.json' };
}
