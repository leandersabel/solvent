// Everything the browser does with keys (spec/architecture.md, Key
// management).
//
// The password becomes an Argon2id hash, which HKDF splits into a
// Master Key that never leaves this tab and an Auth Key that is the
// only half the server ever sees. The Master Key wraps a per-vault
// DEK, and the DEK encrypts every record. Nothing here is written to
// localStorage or sessionStorage: a refresh re-derives from the
// password, by design.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function b64decode(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function uuid4() {
  return crypto.randomUUID();
}

// One worker per tab, started on the first derivation and kept, so a
// re-unlock after an idle lock does not pay to load the WASM again.
let worker = null;
let nextCall = 0;

export class DerivationError extends Error {
  constructor(message, outOfMemory) {
    super(message);
    this.outOfMemory = outOfMemory;
  }
}

function runArgon2id(password, salt, kdf) {
  worker ??= new Worker('/static/js/kdf-worker.js', { type: 'module' });
  const id = ++nextCall;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (event.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      if (event.data.ok) resolve(event.data.raw);
      else reject(new DerivationError(event.data.message, event.data.outOfMemory));
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, password, salt, kdf });
  });
}

// Both halves, always. The client does not yet know whether it will
// need the Master Key, and a derivation that branched on kind would
// have to be told the kind by an endpoint that answers anyone.
export async function deriveKeys(password, saltB64, kdf) {
  const raw = await runArgon2id(password, b64decode(saltB64), kdf);
  const ikm = await crypto.subtle.importKey('raw', raw, 'HKDF', false, [
    'deriveBits',
  ]);
  const split = async (info) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(0),
          info: encoder.encode(info),
        },
        ikm,
        256,
      ),
    );
  const masterKeyBytes = await split('solvent/master-key');
  const authKeyBytes = await split('solvent/auth-key');
  raw.fill(0);
  return {
    masterKey: await importAesKey(masterKeyBytes),
    authKey: b64encode(authKeyBytes),
  };
}

function importAesKey(bytes) {
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ]);
}

export function generateDek() {
  return importAesKey(randomBytes(32));
}

export async function wrapDek(dek, masterKey) {
  const nonce = randomBytes(12);
  const raw = await crypto.subtle.exportKey('raw', dek);
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    masterKey,
    raw,
  );
  return { wrappedDek: b64encode(new Uint8Array(wrapped)), dekNonce: b64encode(nonce) };
}

export async function unwrapDek(wrappedDekB64, dekNonceB64, masterKey) {
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(dekNonceB64) },
    masterKey,
    b64decode(wrappedDekB64),
  );
  return importAesKey(new Uint8Array(raw));
}

// record-api.md, The AAD encoding. Byte-exact and pinned: two
// implementations that disagree produce a vault that never decrypts.
// `principal_id` is deliberately absent, which is what lets a vault be
// encrypted before the server has assigned an identity.
export function aad({ accountId, recordType, recordId, schemaVersion, version }) {
  const fields = [
    accountId ?? '',
    recordType,
    recordId,
    String(schemaVersion),
    String(version),
  ];
  const parts = fields.map((field) => encoder.encode(field));
  const total = parts.reduce((n, p) => n + p.length, 0) + parts.length - 1;
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((part, index) => {
    if (index > 0) out[at++] = 0x1f;
    out.set(part, at);
    at += part.length;
  });
  return out;
}

export async function encryptRecord(dek, slot, payload) {
  const nonce = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(slot) },
    dek,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    nonce: b64encode(nonce),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
}

export async function decryptRecord(dek, record) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(record.nonce), additionalData: aad(record) },
    dek,
    b64decode(record.ciphertext),
  );
  return JSON.parse(decoder.decode(plain));
}
