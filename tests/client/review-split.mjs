// Runs the page's own derivation on the password, salt and KDF envelope
// given as arguments, and prints the Auth Key and the Master Key's raw
// bytes as base64, for tests/test_review_login.py to check against an
// independent HKDF.
const JS = new URL('../../solvent/static/js/', import.meta.url);
const argon2id = async () => (await import(new URL('../vendor/argon2id/1.0.1/argon2id.js', JS).href)).default();

// A Worker stand-in that runs the vendored Argon2id in this process.
globalThis.Worker = class {
  constructor() {
    this.listeners = [];
  }
  addEventListener(type, listener) {
    if (type === 'message') this.listeners.push(listener);
  }
  removeEventListener(_type, listener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  async postMessage(message) {
    const raw = (await argon2id())({
      password: new TextEncoder().encode(message.password),
      salt: message.salt,
      parallelism: message.kdf.p,
      passes: message.kdf.t,
      memorySize: message.kdf.m,
      tagLength: 32,
    });
    for (const listener of [...this.listeners]) {
      listener({ data: { id: message.id, ok: true, raw } });
    }
  }
};

const [password, salt, kdf] = process.argv.slice(2);
const { b64encode, deriveKeys } = await import(new URL('crypto.js', JS).href);
const { authKey, masterKey } = await deriveKeys(password, salt, JSON.parse(kdf));
const master = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', masterKey));
process.stdout.write(JSON.stringify({ authKey, masterKey: b64encode(master) }));
