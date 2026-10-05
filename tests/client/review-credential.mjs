// Reviewer's checks of the page's half of a credential changed
// elsewhere, written from spec/features/account-settings.md (Change
// password steps 2 and 5, Edge cases, criteria 7, 9 and 80) and
// spec/features/login.md (Stale-KDF upgrade step 4, A credential changed
// elsewhere, criterion 83), without reading how the page does it.
//
// The server below holds one password credential and answers the way
// architecture.md, Credentials and vault key wrappers, says: a write
// naming a salt that is not the credential's is a `credential-changed`
// Conflict, and one naming none is a Bad Request.
//
// Run by tests/test_review_account_settings.py.
import assert from 'node:assert/strict';

const JS = new URL('../../solvent/static/js/', import.meta.url);
const load = (name) => import(new URL(name, JS).href);
const argon2id = async () => (await import(new URL('../vendor/argon2id/1.0.1/argon2id.js', JS).href)).default();

// A Worker stand-in running the vendored Argon2id in this process.
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
    for (const listener of [...this.listeners]) listener({ data: { id: message.id, ok: true, raw } });
  }
};
globalThis.document ??= { addEventListener() {} };

const c = await load('crypto.js');
const session = await load('session.js');

const KDF = { alg: 'argon2id', v: 19, m: 64, t: 1, p: 1 };
const STRONGER = { ...KDF, m: 128 };
const EPOCH = 'e'.repeat(32);
const PASSWORD = 'a long enough password';
const NEXT = 'another long enough password';
const THIRD = 'a third long enough password';

const results = [];
async function check(name, body) {
  try {
    await body();
    results.push(['ok', name]);
  } catch (error) {
    results.push(['FAIL', `${name}: ${error.message}`]);
  }
  session.lock();
}

const raw = async (key) => c.b64encode(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key)));

// `set(password, fill, kdf)` is a change or upgrade made on another
// page: a fresh salt, and the same DEK under the new Master Key.
async function server(kind, password) {
  const s = { log: [], bodies: [], dek: await c.generateDek(), kdfStale: false, refuse: null };
  s.set = async (pass, fill, kdf = KDF) => {
    s.salt = c.b64encode(new Uint8Array(16).fill(fill));
    s.kdf = kdf;
    const keys = await c.deriveKeys(pass, s.salt, kdf);
    s.authKey = keys.authKey;
    s.wrapper = kind === 'vault_owner' ? await c.wrapDek(s.dek, keys.masterKey) : null;
  };
  await s.set(password, 31);
  const reply = (status, body = {}) => ({ ok: status < 400, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    s.log.push(url);
    s.bodies.push(body);
    if (url === '/api/auth/salt') return reply(200, { salt: s.salt, kdf: s.kdf });
    if (url === '/api/auth/login') {
      if (body.authKey !== s.authKey) return reply(401);
      return reply(200, {
        kind,
        ...(kind === 'vault_owner' ? { vaultEpoch: EPOCH, ...s.wrapper } : {}),
        kdfStale: s.kdfStale,
        ...(s.kdfStale ? { kdf: STRONGER } : {}),
      });
    }
    if (url === '/api/auth/upgrade-kdf' || url === '/api/auth/change-password') {
      if (s.refuse) return reply(...s.refuse);
      if (typeof body.currentSalt !== 'string') return reply(400);
      if (body.currentSalt !== s.salt) return reply(409, { refused: 'credential-changed' });
      if (url.endsWith('change-password') && body.currentAuthKey !== s.authKey) return reply(400);
      Object.assign(s, { salt: body.salt, kdf: body.kdf, authKey: body.authKey });
      if (body.wrappedDek) s.wrapper = { wrappedDek: body.wrappedDek, dekNonce: body.dekNonce };
      return reply(200);
    }
    return reply(200, []);
  };
  s.since = () => {
    s.log.length = 0;
    s.bodies.length = 0;
  };
  return s;
}

// The password `pass` opens the vault the server holds, with its DEK.
async function opens(s, pass) {
  session.lock();
  const kind = (await session.signIn('leander', pass)).kind;
  if (kind === 'vault_owner') assert.equal(await raw(session.currentVault().dek), await raw(s.dek));
}

await check('criterion 7: a wrong current password sends one salt lookup and nothing else', async () => {
  const s = await server('vault_owner', PASSWORD);
  await session.signIn('leander', PASSWORD);
  s.since();
  await assert.rejects(session.changePassword('leander', 'not it at all', NEXT, KDF), session.WrongPasswordError);
  assert.deepEqual(s.log, ['/api/auth/salt']);
});

await check('a change names the salt the sign-in derived from', async () => {
  const s = await server('vault_owner', PASSWORD);
  const signedInWith = s.salt;
  await session.signIn('leander', PASSWORD);
  s.since();
  await session.changePassword('leander', PASSWORD, NEXT, KDF);
  assert.deepEqual(s.log, ['/api/auth/change-password']);
  assert.equal(s.bodies[0].currentSalt, signedInWith);
  await opens(s, NEXT);
});

await check('criterion 80: after a change in another tab, one salt lookup and one change, and the new password opens the vault', async () => {
  const s = await server('vault_owner', PASSWORD);
  await session.signIn('leander', PASSWORD);
  // Another tab of this browser changed the password: one session, so
  // this tab is still signed in and holds the credential from before.
  await s.set(NEXT, 32);
  s.since();
  await session.changePassword('leander', NEXT, THIRD, KDF);
  assert.deepEqual(s.log, ['/api/auth/salt', '/api/auth/change-password']);
  await opens(s, THIRD);
});

await check('criterion 80: the change names the fresh salt it derived the current key from', async () => {
  const s = await server('vault_owner', PASSWORD);
  await session.signIn('leander', PASSWORD);
  await s.set(NEXT, 32);
  const fresh = s.salt;
  s.since();
  await session.changePassword('leander', NEXT, THIRD, KDF);
  assert.equal(s.bodies[1].currentSalt, fresh);
  assert.equal(s.bodies[1].currentAuthKey, (await c.deriveKeys(NEXT, fresh, KDF)).authKey);
});

await check('criterion 9: after an upgrade elsewhere, one salt lookup and two changes differing only in currentAuthKey and currentSalt', async () => {
  const s = await server('vault_owner', PASSWORD);
  const signedInWith = s.salt;
  await session.signIn('leander', PASSWORD);
  await s.set(PASSWORD, 33, STRONGER);
  const fresh = s.salt;
  s.since();
  await session.changePassword('leander', PASSWORD, NEXT, KDF);
  assert.deepEqual(s.log, ['/api/auth/change-password', '/api/auth/salt', '/api/auth/change-password']);
  const [first, , second] = s.bodies;
  assert.equal(first.currentSalt, signedInWith);
  assert.equal(second.currentSalt, fresh);
  assert.equal(second.currentAuthKey, (await c.deriveKeys(PASSWORD, fresh, STRONGER)).authKey);
  const rest = (b) => ({ ...b, currentAuthKey: null, currentSalt: null });
  assert.deepEqual(rest(first), rest(second));
  await opens(s, NEXT);
});

await check('after a resent change the tab holds what it sent, so the next change looks nothing up', async () => {
  const s = await server('vault_owner', PASSWORD);
  await session.signIn('leander', PASSWORD);
  await s.set(PASSWORD, 33, STRONGER);
  await session.changePassword('leander', PASSWORD, NEXT, KDF);
  s.since();
  await session.changePassword('leander', NEXT, THIRD, KDF);
  assert.deepEqual(s.log, ['/api/auth/change-password']);
  await opens(s, THIRD);
});

await check('a second Conflict is final: one salt lookup, one resend, never a loop', async () => {
  const s = await server('vault_owner', PASSWORD);
  await session.signIn('leander', PASSWORD);
  s.refuse = [409, { refused: 'credential-changed' }];
  s.since();
  await assert.rejects(session.changePassword('leander', PASSWORD, NEXT, KDF));
  assert.deepEqual(s.log, ['/api/auth/change-password', '/api/auth/salt', '/api/auth/change-password']);
});

await check('an administrator on a superseded salt looks it up once and resends', async () => {
  const s = await server('administrator', PASSWORD);
  await session.signIn('root', PASSWORD);
  await s.set(PASSWORD, 34, STRONGER);
  const fresh = s.salt;
  s.since();
  await session.changePassword('root', PASSWORD, NEXT, KDF);
  assert.deepEqual(s.log, ['/api/auth/change-password', '/api/auth/salt', '/api/auth/change-password']);
  assert.equal(s.bodies[2].currentSalt, fresh);
  await opens(s, NEXT);
});

await check('criterion 83: the stale-KDF upgrade carries the salt the sign-in derived from', async () => {
  const s = await server('vault_owner', PASSWORD);
  s.kdfStale = true;
  const signedInWith = s.salt;
  await session.signIn('leander', PASSWORD);
  const sent = s.bodies[s.log.indexOf('/api/auth/upgrade-kdf')];
  assert.ok(sent, s.log.join(' '));
  assert.equal(sent.currentSalt, signedInWith);
  assert.notEqual(sent.salt, signedInWith);
});

await check('criterion 83: an administrator\'s upgrade carries the salt the sign-in derived from', async () => {
  const s = await server('administrator', PASSWORD);
  s.kdfStale = true;
  const signedInWith = s.salt;
  await session.signIn('root', PASSWORD);
  const sent = s.bodies[s.log.indexOf('/api/auth/upgrade-kdf')];
  assert.ok(sent, s.log.join(' '));
  assert.equal(sent.currentSalt, signedInWith);
});

await check('an upgrade refused as credential-changed leaves the session going and the tab holding the sign-in\'s credential', async () => {
  const s = await server('vault_owner', PASSWORD);
  s.kdfStale = true;
  const signedInWith = s.salt;
  s.refuse = [409, { refused: 'credential-changed' }];
  const result = await session.signIn('leander', PASSWORD);
  assert.equal(result.kind, 'vault_owner');
  assert.ok(session.currentVault(), 'the vault is open');
  s.refuse = null;
  s.kdfStale = false;
  s.since();
  // The credential the server holds is still the sign-in's here, so the
  // change goes through on the salt the tab holds.
  await session.changePassword('leander', PASSWORD, NEXT, KDF);
  assert.deepEqual(s.log, ['/api/auth/change-password']);
  assert.equal(s.bodies[0].currentSalt, signedInWith);
});

for (const [state, name] of results) console.log(`${state} ${name}`);
process.exit(results.some(([state]) => state !== 'ok') ? 1 : 0);
