// The client-side rules a wrong implementation would break silently:
// the AAD bytes, the decimal arithmetic, and the key derivation.
//
// Run by tests/test_client.py, so one `pytest` covers both halves.
import assert from 'node:assert/strict';

const JS = new URL('../../solvent/static/js/', import.meta.url);
const load = (name) => import(new URL(name, JS).href);
const argon2id = async () => (await import(new URL('../vendor/argon2id/1.0.1/argon2id.js', JS).href)).default();

const results = [];
async function check(name, body) {
  try {
    await body();
    results.push(['ok', name]);
  } catch (error) {
    results.push(['FAIL', `${name}: ${error.message}`]);
  }
}

// When set, every step the sign-in takes is appended here: each call
// into WebCrypto, each derivation handed to the worker, and each
// request, by its shape and never its bytes.
let trace = null;

// A Worker stand-in, so the derivation under test is the real one
// rather than a second copy of it written for the test.
globalThis.Worker = class {
  constructor() {
    this.listeners = [];
  }
  addEventListener(_type, listener) {
    this.listeners.push(listener);
  }
  removeEventListener(_type, listener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  async postMessage(message) {
    trace?.push(['worker', Object.keys(message).sort().join(','), JSON.stringify(message.kdf), message.salt.length]);
    const hash = await argon2id();
    const raw = hash({
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

const decimal = await load('decimal.js');
const cryptoModule = await load('crypto.js');
const { migrate, SCHEMA_VERSION, Vault, dayNumber, isoFromDay } = await load('model.js');
const rawKey = async (key) =>
  cryptoModule.b64encode(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key)));

// ---- Decimal ----------------------------------------------------------

await check('an exact decimal string survives addition', () => {
  assert.equal(
    decimal.format(decimal.parse('0.1') + decimal.parse('0.2')),
    '0.3',
  );
});

await check('multiplication rounds half-even in both directions', () => {
  const ulp = decimal.parse('0.000000000001');
  const half = decimal.parse('0.5');
  // 0.5 ulp sits exactly on the midpoint and rounds to the even 0.
  assert.equal(decimal.format(decimal.multiply(ulp, half)), '0');
  // 1.5 ulp sits exactly on the midpoint and rounds to the even 2.
  assert.equal(
    decimal.format(decimal.multiply(ulp * 3n, half)),
    '0.000000000002',
  );
  assert.equal(
    decimal.format(decimal.multiply(-ulp * 3n, half)),
    '-0.000000000002',
  );
});

await check('more than twelve decimal places is refused, not truncated', () => {
  assert.equal(decimal.parse('0.1234567890123'), null);
  assert.equal(decimal.parse('0.123456789012'), 123456789012n);
});

await check('a non-numeric value is refused', () => {
  for (const bad of ['', '.', '12x', '1.2.3', 'NaN', '1e3']) {
    assert.equal(decimal.parse(bad), null, bad);
  }
});

await check('zero and negative round-trip', () => {
  for (const value of ['0', '-1234.5', '-0.000000000001']) {
    assert.equal(decimal.format(decimal.parse(value)), value);
  }
});

await check('interpolation is exact at the midpoint', () => {
  assert.equal(
    decimal.format(
      decimal.interpolate(15, 0, decimal.parse('100'), 30, decimal.parse('200')),
    ),
    '150',
  );
});

// ---- The AAD ----------------------------------------------------------

const encoder = new TextEncoder();
const AAD_FIXTURE = Uint8Array.from(
  encoder.encode('\u001fsnapshot\u001f8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11\u001f1\u001f3'),
);

await check('the AAD matches the stored fixture byte for byte', () => {
  const built = cryptoModule.aad({
    accountId: null,
    recordType: 'snapshot',
    recordId: '8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11',
    schemaVersion: 1,
    version: 3,
  });
  assert.deepEqual([...built], [...AAD_FIXTURE]);
});

await check('an empty accountId is the empty string and keeps its separator', () => {
  const built = cryptoModule.aad({
    accountId: null,
    recordType: 'account',
    recordId: 'x',
    schemaVersion: 1,
    version: 1,
  });
  assert.equal(built[0], 0x1f);
  assert.equal([...built].filter((b) => b === 0x1f).length, 4);
});

await check('the rate type moves no byte of the encoding', () => {
  const asRate = cryptoModule.aad({
    accountId: null,
    recordType: 'rate',
    recordId: '8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11',
    schemaVersion: 1,
    version: 3,
  });
  const expected = new TextDecoder()
    .decode(AAD_FIXTURE)
    .replace('snapshot', 'rate');
  assert.equal(new TextDecoder().decode(asRate), expected);
});

// ---- Encryption -------------------------------------------------------

await check('a record round-trips under its own AAD', async () => {
  const dek = await cryptoModule.generateDek();
  const slot = {
    recordId: '8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11',
    recordType: 'snapshot',
    accountId: '3f0d1b2a-0000-4000-8000-000000000001',
    schemaVersion: 1,
    version: 2,
  };
  const payload = { date: '2026-07-31', value: '12450.00', note: null };
  const blob = await cryptoModule.encryptRecord(dek, slot, payload);
  assert.deepEqual(
    await cryptoModule.decryptRecord(dek, { ...slot, ...blob }),
    payload,
  );
});

await check('a blob moved to another slot fails to decrypt', async () => {
  const dek = await cryptoModule.generateDek();
  const slot = {
    recordId: '8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11',
    recordType: 'snapshot',
    accountId: '3f0d1b2a-0000-4000-8000-000000000001',
    schemaVersion: 1,
    version: 2,
  };
  const blob = await cryptoModule.encryptRecord(dek, slot, { value: '1' });
  await assert.rejects(
    cryptoModule.decryptRecord(dek, { ...slot, ...blob, version: 3 }),
  );
  await assert.rejects(
    cryptoModule.decryptRecord(dek, { ...slot, ...blob, accountId: null }),
  );
});

await check('a record encrypted under one DEK fails under another', async () => {
  const mine = await cryptoModule.generateDek();
  const theirs = await cryptoModule.generateDek();
  const slot = {
    recordId: '8f14e45f-ceea-4e0a-b1c1-6d9a0c2c4a11',
    recordType: 'account',
    accountId: null,
    schemaVersion: 1,
    version: 1,
  };
  const blob = await cryptoModule.encryptRecord(mine, slot, { name: 'x' });
  await assert.rejects(cryptoModule.decryptRecord(theirs, { ...slot, ...blob }));
});

await check('two encryptions of one payload carry different nonces', async () => {
  const dek = await cryptoModule.generateDek();
  const slot = {
    recordId: 'a',
    recordType: 'account',
    accountId: null,
    schemaVersion: 1,
    version: 1,
  };
  const first = await cryptoModule.encryptRecord(dek, slot, { name: 'x' });
  const second = await cryptoModule.encryptRecord(dek, slot, { name: 'x' });
  assert.notEqual(first.nonce, second.nonce);
});

// ---- Derivation -------------------------------------------------------

const KDF = { alg: 'argon2id', v: 19, m: 64, t: 1, p: 1 };
const SALT = cryptoModule.b64encode(new Uint8Array(16).fill(7));

await check('the derivation is deterministic and splits into two keys', async () => {
  const first = await cryptoModule.deriveKeys('correct horse battery', SALT, KDF);
  const second = await cryptoModule.deriveKeys('correct horse battery', SALT, KDF);
  assert.equal(first.authKey, second.authKey);

  const masterRaw = await rawKey(first.masterKey);
  // The Auth Key cannot derive the Master Key: they are two HKDF
  // outputs under different info strings.
  assert.notEqual(masterRaw, first.authKey);
});

await check('a different password gives a different Auth Key', async () => {
  const first = await cryptoModule.deriveKeys('correct horse battery', SALT, KDF);
  const other = await cryptoModule.deriveKeys('correct horse batterz', SALT, KDF);
  assert.notEqual(first.authKey, other.authKey);
});

await check('the derivation is identical whatever kind of account it is for', async () => {
  // There is no branch to take: the same call produces the same
  // bytes, which is what keeps the sign-in wait from reading out
  // which usernames administer the instance.
  const a = await cryptoModule.deriveKeys('shared password', SALT, KDF);
  const b = await cryptoModule.deriveKeys('shared password', SALT, KDF);
  assert.equal(a.authKey, b.authKey);
});

await check('a DEK wraps and unwraps under the Master Key', async () => {
  const { masterKey } = await cryptoModule.deriveKeys('a password', SALT, KDF);
  const dek = await cryptoModule.generateDek();
  const wrapped = await cryptoModule.wrapDek(dek, masterKey);
  const back = await cryptoModule.unwrapDek(
    wrapped.wrappedDek,
    wrapped.dekNonce,
    masterKey,
  );
  const before = await globalThis.crypto.subtle.exportKey('raw', dek);
  const after = await globalThis.crypto.subtle.exportKey('raw', back);
  assert.deepEqual([...new Uint8Array(before)], [...new Uint8Array(after)]);
});

await check('unwrapping with the wrong Master Key fails', async () => {
  const right = await cryptoModule.deriveKeys('a password', SALT, KDF);
  const wrong = await cryptoModule.deriveKeys('another password', SALT, KDF);
  const wrapped = await cryptoModule.wrapDek(
    await cryptoModule.generateDek(),
    right.masterKey,
  );
  await assert.rejects(
    cryptoModule.unwrapDek(wrapped.wrappedDek, wrapped.dekNonce, wrong.masterKey),
  );
});

await check('the vendored library answers the RFC 9106 test vector', async () => {
  const hash = await argon2id();
  const out = hash({
    password: new Uint8Array(32).fill(1),
    salt: new Uint8Array(16).fill(2),
    parallelism: 4,
    passes: 3,
    memorySize: 32,
    tagLength: 32,
    secret: new Uint8Array(8).fill(3),
    ad: new Uint8Array(12).fill(4),
  });
  assert.equal(
    [...out].map((b) => b.toString(16).padStart(2, '0')).join(''),
    '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
  );
});

// ---- One sign-in for both kinds -----------------------------------------

// Every WebCrypto call, by method, algorithm and HKDF info string.
for (const method of ['importKey', 'deriveBits', 'decrypt', 'encrypt', 'exportKey']) {
  const real = globalThis.crypto.subtle[method].bind(globalThis.crypto.subtle);
  globalThis.crypto.subtle[method] = (...args) => {
    const algorithm = args.find((a) => typeof a === 'string' && a !== 'raw') ?? args.find((a) => a && a.name);
    trace?.push([
      'subtle',
      method,
      typeof algorithm === 'string' ? algorithm : algorithm?.name,
      algorithm?.info ? new TextDecoder().decode(algorithm.info) : '',
    ]);
    return real(...args);
  };
}

// A server answering the salt the way the real one does for each case:
// the account's own salt and envelope, or a decoy with the default one.
// The login is refused, which is where the kind would first be known.
const serve = (salt) => async (url, init) => {
  const body = JSON.parse(init.body);
  trace?.push(['fetch', url, Object.keys(body).sort().join(',')]);
  if (url === '/api/auth/salt') {
    return { ok: true, status: 200, json: async () => ({ salt, kdf: KDF }) };
  }
  return { ok: false, status: 401, json: async () => ({}) };
};

await check('the sign-in takes one code path whatever kind the username has', async () => {
  const session = await load('session.js');
  const salts = {
    administrator: cryptoModule.b64encode(new Uint8Array(16).fill(1)),
    'vault owner': cryptoModule.b64encode(new Uint8Array(16).fill(2)),
    unknown: cryptoModule.b64encode(new Uint8Array(16).fill(3)),
  };
  const paths = {};
  for (const [name, salt] of Object.entries(salts)) {
    trace = [];
    globalThis.fetch = serve(salt);
    await assert.rejects(session.signIn(name.replace(' ', '-'), 'shared password'), session.SignInError);
    paths[name] = JSON.stringify(trace);
    trace = null;
  }
  // The trace holds the derivation and the HKDF split, not only its
  // endpoints, so a shortcut for one kind is a different path.
  assert.ok(paths.administrator.includes('solvent/master-key'), paths.administrator);
  assert.ok(paths.administrator.includes('solvent/auth-key'), paths.administrator);
  assert.ok(paths.administrator.includes('"worker"'), paths.administrator);
  assert.equal(paths.administrator, paths['vault owner']);
  assert.equal(paths.administrator, paths.unknown);
});

await check('an administrator whose upgrade fails is still signed in', async () => {
  // login.md: a failed upgrade must never lock anyone out.
  const session = await load('session.js');
  const posted = [];
  globalThis.fetch = async (url, init) => {
    posted.push(url);
    if (url === '/api/auth/salt') {
      return { ok: true, status: 200, json: async () => ({ salt: SALT, kdf: KDF }) };
    }
    if (url === '/api/auth/login') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ kind: 'administrator', kdfStale: true, kdf: { ...KDF, m: KDF.m * 2 } }),
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const result = await session.signIn('root', 'a password');
  assert.equal(result.kind, 'administrator');
  assert.deepEqual(posted, ['/api/auth/salt', '/api/auth/login', '/api/auth/upgrade-kdf']);
});

await check('a locked account reads as too many attempts at the salt request too', async () => {
  // The limiter answers the salt request before the derivation, so
  // that is where a locked account is usually met.
  const session = await load('session.js');
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(session.signIn('anyone', 'a password'), (error) =>
    error instanceof session.SignInError && error.message === 'throttled');
});

// ---- The vault epoch ---------------------------------------------------

// A BroadcastChannel that delivers to the other instances of the same
// name at once, so the check needs no timer and leaves no handle open.
const channels = [];
globalThis.BroadcastChannel = class {
  constructor(name) {
    this.name = name;
    this.listeners = [];
    channels.push(this);
  }
  addEventListener(type, listener) {
    this.listeners.push(listener);
  }
  postMessage(data) {
    for (const other of channels) {
      if (other !== this && other.name === this.name) for (const listener of other.listeners) listener({ data });
    }
  }
};

const EPOCH = 'a'.repeat(32);
const answering = (status, body) => async (url, init) => {
  headersSent.push(init.headers);
  return { ok: status < 400, status, json: async () => body };
};
let headersSent = [];

await check('every request carries the vault epoch once the page holds one, and none before', async () => {
  const api = await load('api.js');
  globalThis.fetch = answering(200, {});
  await api.get('/api/records?type=profile');
  api.setVaultEpoch(EPOCH);
  await api.get('/api/records?type=profile');
  api.setVaultEpoch(null);
  assert.equal(headersSent.at(-2)['X-Solvent-Vault'], undefined);
  assert.equal(headersSent.at(-1)['X-Solvent-Vault'], EPOCH);
  assert.equal(headersSent.at(-1)['X-Solvent-Request'], '1');
});

await check('a vault-replaced Conflict reaches no caller and asks the page to tell the channel, a plain Conflict reaches the caller', async () => {
  const api = await load('api.js');
  const told = [];
  api.whenReplaced((announce) => told.push(announce));
  api.setVaultEpoch(EPOCH);

  globalThis.fetch = answering(409, { refused: 'vault-replaced' });
  const settled = await Promise.race([
    api.put('/api/records/x', {}).then(() => 'answered', () => 'rejected'),
    new Promise((resolve) => setImmediate(() => resolve('pending'))),
  ]);
  assert.equal(settled, 'pending');
  assert.deepEqual(told, [true]);

  globalThis.fetch = answering(409, {});
  await assert.rejects(api.put('/api/records/x', {}), (error) => error.status === 409);
  assert.deepEqual(told, [true]);
  api.setVaultEpoch(null);
  api.whenReplaced(() => {});
});

await check('a message closes a page only when it names exactly the epoch the page holds', async () => {
  const api = await load('api.js');
  const told = [];
  api.whenReplaced((announce) => told.push(announce));
  api.setVaultEpoch(EPOCH);
  api.setVaultEpoch(null);
  const sender = new BroadcastChannel('solvent-vault');

  // A page holding no epoch acts on nothing.
  sender.postMessage({ replaced: EPOCH });
  assert.deepEqual(told, []);

  api.setVaultEpoch(EPOCH);
  for (const message of [{ replaced: 'b'.repeat(32) }, { replaced: EPOCH, extra: 1 }, { other: EPOCH }, EPOCH, null]) {
    sender.postMessage(message);
  }
  assert.deepEqual(told, []);
  sender.postMessage({ replaced: EPOCH });
  assert.deepEqual(told, [false]);

  // The page that announces posts the one key.
  const heard = [];
  sender.addEventListener('message', ({ data }) => heard.push(data));
  api.announce(EPOCH);
  assert.deepEqual(heard, [{ replaced: EPOCH }]);
  api.setVaultEpoch(null);
  api.whenReplaced(() => {});
});

// ---- Migration --------------------------------------------------------

await check('migration is a pure function on decrypted plaintext', () => {
  const payload = { mainCurrency: 'CHF', createdAt: '2026-01-01T00:00:00Z' };
  assert.deepEqual(migrate('profile', SCHEMA_VERSION, payload), payload);
});

// ---- The write path ---------------------------------------------------

await check('a record written through the write path carries its payload', async () => {
  // The record store is the one place a dropped argument is invisible:
  // an empty payload encrypts, stores and decrypts without error, and
  // surfaces only as a vault that reads back blank.
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const writes = await load('writes.js');

  const vault = new Vault(await cryptoModule.generateDek());
  vault.profileRecord = null;
  const payload = { name: 'UBS dollar account', unit: 'USD', dims: {}, note: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z' };
  const entry = await writes.saveHolding(vault, null, payload);

  const stored = sent[0].body;
  assert.deepEqual(
    await cryptoModule.decryptRecord(vault.dek, { ...entry, ...stored }),
    payload,
  );
  assert.ok(
    cryptoModule.b64decode(stored.ciphertext).length > 16,
    'an empty payload encrypts to the authentication tag alone',
  );
});

// ---- Dates and numbers -------------------------------------------------

await check('the locale supplies the defaults and each control overrules it', async () => {
  const { formatter } = await load('format.js');
  const million = 1234567890000000000n;
  assert.equal(formatter({ locale: 'de-DE' }).money(million), '1.234.567,89');
  assert.equal(formatter({ locale: 'en-US' }).money(million), '1,234,567.89');
  assert.equal(
    formatter({ locale: 'de-CH', groupSeparator: 'apostrophe', moneyPlaces: '0' }).money(million),
    '1\u2019234\u2019568',
  );
  assert.equal(formatter({ locale: 'en-US', groupSeparator: 'none' }).money(million), '1234567.89');
});

await check('a quantity shows digit for digit whatever money is set to', async () => {
  const { formatter } = await load('format.js');
  for (const moneyPlaces of ['0', '2']) {
    const shape = formatter({ locale: 'en-US', moneyPlaces });
    // Rounding 12.125 ounces would misstate the holding, padding 80 m2
    // would claim a precision nobody measured.
    assert.equal(shape.quantity('12.125'), '12.125');
    assert.equal(shape.quantity('12.50'), '12.50');
    assert.equal(shape.quantity('12.5'), '12.5');
    assert.equal(shape.quantity('80'), '80');
    assert.equal(shape.quantity('1234567.000000000001'), '1,234,567.000000000001');
    assert.equal(shape.quantity('-1234.5'), '−1,234.5');
    assert.equal(shape.quantity('0.10'), '0.10');
  }
  // 12 rather than 13: display rounding is half-even like every other
  // rounding in the product, and 12.5 lies on the tie.
  const shape = formatter({ locale: 'en-US', moneyPlaces: '0' });
  assert.equal(shape.money(12500000000000n), '12');
  assert.equal(shape.money(12600000000000n), '13');
  assert.equal(formatter({ locale: 'de-DE', groupSeparator: 'apostrophe' }).quantity('1234.5'), '1’234,5');
  assert.equal(formatter({ locale: 'de-CH', groupSeparator: 'apostrophe' }).quantity('1234567'), '1’234’567');
});

await check('a holding in any currency follows money places and one in any other unit shows its stored digits', () => {
  const vault = new Vault(null);
  vault.profile = { mainCurrency: 'CHF', locale: 'en-US', groupSeparator: 'apostrophe', moneyPlaces: '0' };
  vault.symbols = new Map([
    ['CHF', { symbol: 'CHF', label: 'Swiss Franc', kind: 'currency' }],
    ['USD', { symbol: 'USD', label: 'United States Dollar', kind: 'currency' }],
    ['XAU-ozt', { symbol: 'XAU-ozt', label: 'Gold, troy ounce', kind: 'metal' }],
  ]);
  assert.equal(vault.amount('200.00', 'CHF'), 'CHF 200');
  assert.equal(vault.amount('1000.40', 'USD'), 'USD 1’000');
  assert.equal(vault.amount('12.125', 'XAU-ozt'), '12.125 ozt');
  assert.equal(vault.amount('12.50', 'XAU-ozt'), '12.50 ozt');
  assert.equal(vault.amount('80', 'm²'), '80 m²');
  assert.equal(vault.figure('1000.40', 'USD'), '1’000');
  assert.equal(vault.figure('12.125', 'XAU-ozt'), '12.125');
  // Back at two places every currency keeps its cents, and a quantity
  // is the same.
  vault.profile = { ...vault.profile, moneyPlaces: '2' };
  assert.equal(vault.amount('1000.40', 'USD'), 'USD 1’000.40');
  assert.equal(vault.amount('12.125', 'XAU-ozt'), '12.125 ozt');
  assert.equal(vault.amount('80', 'm²'), '80 m²');
});

await check('a typed quantity is read to its canonical decimal string', async () => {
  const { formatter } = await load('format.js');
  const shape = formatter({ locale: 'en-US' });
  const canonical = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/;
  for (const [typed, stored] of [
    ['12.50', '12.50'],
    ['007', '7'],
    ['.5', '0.5'],
    ['12.', '12'],
    ['-0.00', '0.00'],
    ['-0', '0'],
    ['1,234.50', '1234.50'],
    ['−5', '-5'],
    ['0.123456789012', '0.123456789012'],
  ]) {
    const read = shape.parseQuantity(typed);
    assert.equal(read, stored, typed);
    assert.match(read, canonical);
  }
  for (const typed of ['', '-', '.', 'abc', '1.0000000000001', '1.2.3', '12,34.5', '1,23']) {
    assert.equal(shape.parseQuantity(typed), null, typed);
  }
  // The configured point, and a period wherever a period is not the
  // group mark.
  const swissGerman = formatter({ locale: 'de-DE', groupSeparator: 'apostrophe' });
  assert.equal(swissGerman.parseQuantity('1’234,50'), '1234.50');
  assert.equal(swissGerman.parseQuantity('12.5'), '12.5');
  // A period group mark is never dropped: 12.5 is refused, not read as 125.
  const german = formatter({ locale: 'de-DE', groupSeparator: 'period' });
  assert.equal(german.parseQuantity('1.234,5'), '1234.5');
  assert.equal(german.parseQuantity('12.5'), null);
  assert.equal(german.parseQuantity('1.234'), '1234');
});

await check('a field that edits a stored figure reads back the stored string itself while untouched', async () => {
  const { formatter } = await load('format.js');
  const swiss = formatter({ locale: 'de-CH', groupSeparator: 'apostrophe', moneyPlaces: '0' });
  for (const stored of ['1000.40', '12.125', '12.5', '80', '-1234567.50', '0.000000000001']) {
    const prefill = swiss.quantity(stored);
    assert.equal(swiss.readField(prefill, stored), stored, prefill);
    assert.equal(swiss.parseQuantity(prefill), stored, prefill);
  }
  assert.equal(swiss.quantity('1000.40'), '1’000.40');
  // Typed over, the field is read as typed: 12.50 over "12.5" is an edit.
  assert.equal(swiss.readField('12.50', '12.5'), '12.50');
  assert.equal(swiss.readField('abc', '12.5'), null);
  assert.equal(swiss.readField('12.5', null), '12.5');
});

await check('a thousands separator never collides with the decimal point', async () => {
  const { formatter } = await load('format.js');
  // German writes 1.234,56, so a period between thousands would make
  // the figure ambiguous. The locale's own pairing wins.
  const shape = formatter({ locale: 'de-DE', groupSeparator: 'period' });
  assert.notEqual(shape.group, shape.point);
  assert.equal(shape.money(1234567890000000000n), '1.234.567,89');
});

await check('a date round-trips through the format the reader types', async () => {
  const { formatter } = await load('format.js');
  for (const settings of [
    { locale: 'de-CH' },
    { locale: 'en-US' },
    { locale: 'en-GB' },
    { locale: 'de-DE', dateStyle: 'ymd' },
  ]) {
    const shape = formatter(settings);
    const written = shape.date('2026-09-20');
    assert.equal(shape.parseDate(written), '2026-09-20', `${JSON.stringify(settings)} wrote ${written}`);
  }
});

await check('an explicit date style reaches every writer that shows a day, in literal strings', async () => {
  const { formatter } = await load('format.js');
  const iso = '2026-09-20';
  // Noon local time, so the browser's own zone cannot move the day.
  const moment = new Date(2026, 8, 20, 14, 5).getTime();
  const written = { dmy: '20.09.2026', ymd: '2026-09-20', mdy: '09/20/2026' };
  for (const [dateStyle, expected] of Object.entries(written)) {
    const shape = formatter({ locale: 'en-US', dateStyle });
    assert.equal(shape.date(iso), expected, `${dateStyle} date`);
    assert.equal(shape.longDate(iso), expected, `${dateStyle} longDate`);
    assert.equal(shape.fullDate(iso), expected, `${dateStyle} fullDate`);
    // A slot with no year still shows the full date: a rate delay can
    // cross New Year, and the setting offers no yearless shape.
    assert.equal(shape.dayMonth(iso), expected, `${dateStyle} dayMonth`);
    assert.equal(shape.dayMonth(iso, 'short'), expected, `${dateStyle} short dayMonth`);
    assert.ok(shape.dateTime(moment).startsWith(`${expected}, `), `${dateStyle} dateTime: ${shape.dateTime(moment)}`);
    assert.ok(!/[A-Za-z]/.test(shape.longDate(iso)), `${dateStyle} longDate has no month name`);
  }
  // The style outranks the language, whichever language it is.
  assert.equal(formatter({ locale: 'de-DE', dateStyle: 'ymd' }).longDate(iso), '2026-09-20');
  assert.equal(formatter({ locale: 'en-GB', dateStyle: 'mdy' }).fullDate(iso), '09/20/2026');
  assert.equal(formatter({ locale: 'en-GB', dateStyle: 'dmy' }).dayMonth('2026-01-05', 'short'), '05.01.2026');
  assert.equal(formatter({ dateStyle: 'ymd' }).longDate(''), '');
});

await check('under the language’s own order the spelled dates stay as they were', async () => {
  const { formatter } = await load('format.js');
  const iso = '2026-09-20';
  for (const settings of [{ locale: 'en-US' }, { locale: 'en-US', dateStyle: 'locale' }]) {
    const shape = formatter(settings);
    assert.equal(shape.longDate(iso), 'Sep 20, 2026');
    assert.equal(shape.fullDate(iso), 'September 20, 2026');
    assert.equal(shape.dayMonth(iso), 'September 20');
    assert.equal(shape.dayMonth(iso, 'short'), 'Sep 20');
    assert.equal(shape.monthYear(iso), 'September 2026');
    assert.ok(/^Sep 20, 2026, \d{1,2}:\d{2}/.test(shape.dateTime(new Date(2026, 8, 20, 14, 5).getTime())));
  }
  const german = formatter({ locale: 'de-DE', dateStyle: 'locale' });
  assert.equal(german.fullDate(iso), '20. September 2026');
});

await check('a month alone or a year alone keeps its spelling whatever the style', async () => {
  const { formatter } = await load('format.js');
  assert.equal(formatter({ locale: 'en-US', dateStyle: 'ymd' }).monthYear('2026-07-01'), 'July 2026');
});

await check('a date that does not exist is refused rather than rolled forward', async () => {
  const { formatter } = await load('format.js');
  const shape = formatter({ locale: 'de-CH' });
  assert.equal(shape.parseDate('31.02.2026'), null);
  assert.equal(shape.parseDate('20.13.2026'), null);
  assert.equal(shape.parseDate('20.09.26'), null);
  assert.equal(shape.parseDate('nonsense'), null);
  assert.equal(shape.parseDate(''), null);
});

await check('an unknown language falls back rather than throwing', async () => {
  const { formatter } = await load('format.js');
  const shape = formatter({ locale: 'not-a-language-tag' });
  assert.equal(typeof shape.money(1000000000000n), 'string');
  assert.equal(shape.date('2026-09-20').length, 10);
});

await check('a negative figure takes the true minus sign', async () => {
  const { formatter } = await load('format.js');
  assert.equal(formatter({ locale: 'en-GB' }).money(-18400000000000000n), '\u221218,400.00');
});

// ---- Figures typed into a field ------------------------------------------

await check('a field shows a figure grouped and reads it back exactly', async () => {
  const { formatter } = await load('format.js');
  for (const settings of [
    { locale: 'en-GB', groupSeparator: 'apostrophe' },
    { locale: 'de-DE' },
    { locale: 'fr-CH' },
    { locale: 'en-US', groupSeparator: 'none' },
  ]) {
    const shape = formatter(settings);
    for (const stored of ['48210.35', '-780000', '1150000.5', '0.000000000001', '12.5', '0']) {
      const value = decimal.parse(stored);
      const shown = shape.editable(value);
      assert.equal(shape.parseFigure(shown), value, `${JSON.stringify(settings)} showed ${shown}`);
    }
  }
  const swiss = formatter({ locale: 'en-GB', groupSeparator: 'apostrophe' });
  assert.equal(swiss.editable(decimal.parse('48210.35')), '48\u2019210.35');
  assert.equal(swiss.editable(decimal.parse('12.5')), '12.50');
  assert.equal(swiss.editable(decimal.parse('0.797'), 6), '0.797000');
  assert.equal(swiss.editable(decimal.parse('-18400')), '\u221218\u2019400.00');
});

await check('a typed figure is read with or without group marks', async () => {
  const { formatter } = await load('format.js');
  const swiss = formatter({ locale: 'en-GB', groupSeparator: 'apostrophe' });
  const expected = decimal.parse('221304.5');
  for (const typed of ['221304.50', '221\u2019304.50', "221'304.50", ' 221304.5 ']) {
    assert.equal(swiss.parseFigure(typed), expected, typed);
  }
  assert.equal(swiss.parseFigure('-780\u2019000'), decimal.parse('-780000'));
  assert.equal(swiss.parseFigure('\u2212780000'), decimal.parse('-780000'));
  assert.equal(swiss.parseFigure('1\u2019234\u2019567.891234567891'), decimal.parse('1234567.891234567891'));
  const german = formatter({ locale: 'de-DE' });
  assert.equal(german.parseFigure('1.234,5'), decimal.parse('1234.5'));
  assert.equal(german.parseFigure('1234,5'), decimal.parse('1234.5'));
  const spaced = formatter({ locale: 'en-GB', groupSeparator: 'thin' });
  assert.equal(spaced.parseFigure('1 234 567'), decimal.parse('1234567'));
});

await check('a typed figure that could mean two things is refused', async () => {
  const { formatter } = await load('format.js');
  const swiss = formatter({ locale: 'en-GB', groupSeparator: 'apostrophe' });
  // A group mark that does not sit between groups of three.
  assert.equal(swiss.parseFigure("12'34.50"), null);
  assert.equal(swiss.parseFigure('1.2.3'), null);
  assert.equal(swiss.parseFigure('12,50'), null);
  assert.equal(swiss.parseFigure(''), null);
  assert.equal(swiss.parseFigure('abc'), null);
  assert.equal(swiss.parseFigure('1.0000000000001'), null);
  // German reads a period as a thousands mark, so a period typed as a
  // decimal point is refused rather than taken for 123'450.
  assert.equal(formatter({ locale: 'de-DE' }).parseFigure('1234.50'), null);
});

// ---- The trend chart ------------------------------------------------------

await check('a band holding a liability draws both sides instead of their net', async () => {
  const { stack } = await load('chart.js');
  const money = (n) => decimal.parse(String(n));
  const property = {
    id: 'property',
    points: [money(370000)],
    assets: [money(1150000)],
    liabilities: [money(-780000)],
  };
  const cash = { id: 'cash', points: [money(100000)], assets: [money(100000)], liabilities: [money(0)] };
  const { layers, net } = stack([cash, property]);
  assert.deepEqual(layers[0].upper[0], [0, 100000]);
  assert.deepEqual(layers[1].upper[0], [100000, 1250000]);
  assert.deepEqual(layers[1].lower[0], [0, -780000]);
  assert.deepEqual(layers[0].lower[0], [0, 0]);
  assert.equal(net[0], 470000);
});

await check('percentage mode normalizes each side against itself', async () => {
  const { stack } = await load('chart.js');
  const money = (n) => decimal.parse(String(n));
  const band = (a, l) => ({ id: String(a), points: [money(a + l)], assets: [money(a)], liabilities: [money(l)] });
  const { layers } = stack([band(300, -100), band(100, -300)], true);
  assert.deepEqual(layers[0].upper[0], [0, 75]);
  assert.deepEqual(layers[1].upper[0], [75, 100]);
  assert.deepEqual(layers[0].lower[0], [0, -25]);
  assert.deepEqual(layers[1].lower[0], [-25, -100]);
});

// ---- Export and import ----------------------------------------------------

// A file written at formatVersion 1, checked in and never regenerated,
// so it still has to import once the format has moved on. Its KDF
// envelope is below the server's minimum on purpose: the file's
// envelope only opens the file.
const FIXTURE = JSON.parse(
  await (await import('node:fs/promises')).readFile(
    new URL('../fixtures/vault-format-1.json', import.meta.url),
    'utf8',
  ),
);
const FIXTURE_PASSWORD = 'fixture lantern orchard';
const FIXTURE_PAYLOADS = {
  profile: {
    mainCurrency: 'EUR',
    createdAt: '2026-08-01T09:14:00Z',
    dimensions: [{ id: 'd7f3a1b2', label: 'Liquidity', archivedAt: null, values: [{ id: '9c4e0f11', label: 'Cash', archivedAt: null }] }],
  },
  account: { name: 'Fixture savings', unit: 'USD', dims: { d7f3a1b2: '9c4e0f11' }, note: 'kept from format 1', archivedAt: null, createdAt: '2026-08-01T09:15:00Z' },
  snapshot: { date: '2026-07-31', value: '12450', note: null },
  rate: { symbol: 'USD', date: '2026-07-31', rate: '0.8', rateTarget: 'EUR', rateSource: 'proposed', rateAsOf: '2026-07-31', proposedRate: null },
};
const transfer = await load('transfer.js');
const copyOf = (value) => JSON.parse(JSON.stringify(value));
// Every request the code under test makes, so a check can say none went.
const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  throw new Error('no request belongs here');
};

await check('a formatVersion 1 file still opens, decrypts and re-keys', async () => {
  const file = transfer.checkFile(copyOf(FIXTURE));
  assert.equal(file.formatVersion, 1);
  const { fileDek, profile } = await transfer.openFile(file, FIXTURE_PASSWORD);
  assert.deepEqual(profile, FIXTURE_PAYLOADS.profile);

  const { dek, records } = await transfer.rekey(fileDek, file.records);
  assert.notEqual(await rawKey(dek), await rawKey(fileDek));
  assert.deepEqual(
    records.map((r) => [r.recordId, r.recordType, r.accountId]),
    file.records.map((r) => [r.recordId, r.recordType, r.accountId]),
  );
  for (const record of records) {
    assert.equal(record.version, 1, record.recordType);
    assert.deepEqual(await cryptoModule.decryptRecord(dek, record), FIXTURE_PAYLOADS[record.recordType]);
    // Nothing the new key encrypted opens under the file's.
    await assert.rejects(cryptoModule.decryptRecord(fileDek, record));
  }
  assert.deepEqual(requests, []);
});

// ---- Recording: the model --------------------------------------------
//
// spec/features/net-worth-view.md and record-snapshot.md, Acceptance
// criteria. The model is built in memory, record by record, exactly as
// a load indexes what it decrypts.

let nextId = 0;
function model({ main = 'CHF', holdings = [], figures = [], prices = [], dimensions = [] }) {
  const vault = new Vault(null);
  vault.profile = { mainCurrency: main, dimensions };
  const ids = {};
  for (const h of holdings) {
    const recordId = `h${(nextId += 1)}`;
    ids[h.name] = recordId;
    vault._index({
      recordId,
      recordType: 'account',
      version: 1,
      payload: { name: h.name, unit: h.unit, dims: h.dims || {}, note: null, archivedAt: h.archivedAt || null, createdAt: h.createdAt || '2020-01-01T00:00:00Z' },
    });
  }
  for (const [name, date, value] of figures) {
    vault._index({ recordId: `s${(nextId += 1)}`, recordType: 'snapshot', accountId: ids[name], version: 1, payload: { date, value, note: null } });
  }
  for (const [symbol, date, rate, rateSource = 'manual'] of prices) {
    vault._index({
      recordId: `r${(nextId += 1)}`,
      recordType: 'rate',
      version: 1,
      payload: { symbol, date, rate, rateTarget: main, rateSource, rateAsOf: date, proposedRate: null },
    });
  }
  vault._sortSeries();
  vault.ids = ids;
  return vault;
}

const day = (iso) => dayNumber(iso);
/** Net worth on every day from `from` to `to`, one exact figure a day,
 *  each drawn by the chart's own series at that single day. */
function curve(vault, from, to, dimension = null) {
  const out = new Map();
  for (let d = day(from); d <= day(to); d += 1) {
    const { bands } = vault.series(dimension, d, d);
    out.set(isoFromDay(d), bands.reduce((sum, band) => sum + band.points[0], 0n));
  }
  return out;
}
/** The days on which two curves differ. */
function moved(before, after) {
  return [...before.keys()].filter((d) => before.get(d) !== after.get(d));
}
const within = (dates, lo, hi) => dates.every((d) => d > lo && d < hi);
const money = (text) => decimal.parse(text);

// Three units, a figure each, and the prices that make the two pricing
// modes answer differently.
const threeUnits = () =>
  model({
    holdings: [
      { name: 'Francs', unit: 'CHF' },
      { name: 'Dollars', unit: 'USD' },
      { name: 'Gold', unit: 'XAU-ozt' },
    ],
    figures: [
      ['Francs', '2026-03-31', '1000.10'],
      ['Dollars', '2026-03-31', '2500.5'],
      ['Gold', '2026-06-30', '12.5'],
    ],
    prices: [
      ['USD', '2026-03-31', '0.9'],
      ['USD', '2026-09-20', '0.8123'],
      ['XAU-ozt', '2026-06-30', '2700.25'],
      ['XAU-ozt', '2026-09-20', '2800.5'],
    ],
  });

await check('net-worth-view: the total is the hand-computed sum, exactly, in both modes, and the modes differ', () => {
  const vault = threeUnits();
  // 1000.10 + 2500.5 x 0.8123 + 12.5 x 2800.5
  assert.equal(decimal.format(vault.totals('latest').net), '38037.50615');
  // 1000.10 + 2500.5 x 0.9 + 12.5 x 2700.25
  assert.equal(decimal.format(vault.totals('asRecorded').net), '37003.675');
});

await check('net-worth-view: a March figure takes this week\'s price by default and March\'s in the other mode', () => {
  const vault = threeUnits();
  const dollars = vault.holdings.get(vault.ids.Dollars);
  assert.equal(decimal.format(vault.valueOf(dollars, 'latest').converted), '2031.15615');
  assert.equal(decimal.format(vault.valueOf(dollars, 'asRecorded').converted), '2250.45');
  assert.equal(vault.valueOf(dollars, 'latest').asOf, '2026-03-31');
});

await check('record-snapshot: 0.1 plus 0.2 in a total is 0.3, and zero and a negative figure both count', () => {
  const vault = model({
    holdings: [
      { name: 'A', unit: 'CHF' },
      { name: 'B', unit: 'CHF' },
      { name: 'Closed', unit: 'CHF' },
      { name: 'Loan', unit: 'CHF' },
      { name: 'Never', unit: 'CHF' },
    ],
    figures: [
      ['A', '2026-01-01', '0.1'],
      ['B', '2026-01-01', '0.2'],
      ['Closed', '2026-01-01', '0'],
      ['Loan', '2026-01-01', '-0.25'],
    ],
  });
  const totals = vault.totals();
  assert.equal(decimal.format(totals.net), '0.05');
  assert.equal(decimal.format(totals.assets), '0.3');
  assert.equal(decimal.format(totals.liabilities), '-0.25');
  // The zero figure is valued, the holding with no figure is not.
  assert.equal(totals.valued, 4);
  assert.equal(vault.valueOf(vault.holdings.get(vault.ids.Never)).state, 'unvalued');
});

await check('net-worth-view: a figure with no price for its unit is not priced and never counted bare', () => {
  const vault = model({
    holdings: [
      { name: 'Francs', unit: 'CHF' },
      { name: 'Flat', unit: 'm2' },
    ],
    figures: [
      ['Francs', '2026-01-01', '100'],
      ['Flat', '2026-01-01', '95'],
    ],
  });
  assert.equal(vault.valueOf(vault.holdings.get(vault.ids.Flat)).state, 'unpriced');
  assert.equal(decimal.format(vault.totals().net), '100');
  const { bands } = vault.series(null, day('2026-01-01'), day('2026-01-01'));
  assert.equal(decimal.format(bands[0].points[0]), '100');
});

await check('net-worth-view: a change to an interior entry moves only the stretch between its neighbors, in either series', () => {
  const base = {
    holdings: [{ name: 'Dollars', unit: 'USD' }],
    figures: [
      ['Dollars', '2026-01-01', '100'],
      ['Dollars', '2026-02-01', '150'],
      ['Dollars', '2026-03-01', '120'],
    ],
    prices: [
      ['USD', '2026-01-01', '1'],
      ['USD', '2026-01-21', '1.2'],
      ['USD', '2026-02-10', '1.1'],
    ],
  };
  const before = curve(model(base), '2025-12-01', '2026-04-01');
  const cases = {
    'adding a price': { ...base, prices: [...base.prices, ['USD', '2026-01-15', '1.5']], lo: '2026-01-01', hi: '2026-01-21' },
    'changing a price': { ...base, prices: base.prices.map((p) => (p[1] === '2026-01-21' ? ['USD', '2026-01-21', '1.3'] : p)), lo: '2026-01-01', hi: '2026-02-10' },
    'deleting a price': { ...base, prices: base.prices.filter((p) => p[1] !== '2026-01-21'), lo: '2026-01-01', hi: '2026-02-10' },
    'adding a figure': { ...base, figures: [...base.figures, ['Dollars', '2026-02-15', '200']], lo: '2026-02-01', hi: '2026-03-01' },
    'changing a figure': { ...base, figures: base.figures.map((f) => (f[1] === '2026-02-01' ? ['Dollars', '2026-02-01', '170'] : f)), lo: '2026-01-01', hi: '2026-03-01' },
    'deleting a figure': { ...base, figures: base.figures.filter((f) => f[1] !== '2026-02-01'), lo: '2026-01-01', hi: '2026-03-01' },
  };
  for (const [name, spec] of Object.entries(cases)) {
    const changed = moved(before, curve(model(spec), '2025-12-01', '2026-04-01'));
    assert.ok(changed.length > 0, `${name} moved nothing`);
    assert.ok(within(changed, spec.lo, spec.hi), `${name} moved ${changed[0]} to ${changed[changed.length - 1]}`);
  }
});

await check('net-worth-view: deleting the newest entry moves every point after the previous one and none before', () => {
  const base = {
    holdings: [{ name: 'Dollars', unit: 'USD' }],
    figures: [['Dollars', '2026-01-01', '100']],
    prices: [
      ['USD', '2026-01-01', '1'],
      ['USD', '2026-02-01', '1.2'],
      ['USD', '2026-03-01', '1.5'],
    ],
  };
  const before = curve(model(base), '2025-12-01', '2026-04-01');
  const after = curve(model({ ...base, prices: base.prices.slice(0, 2) }), '2025-12-01', '2026-04-01');
  const changed = moved(before, after);
  assert.equal(changed[0], '2026-02-02');
  assert.equal(changed[changed.length - 1], '2026-04-01');
  assert.equal(changed.length, day('2026-04-01') - day('2026-02-02') + 1);
});

await check('net-worth-view: deleting a whole recording moves every band in its symbols, across those stretches only', () => {
  const base = {
    holdings: [
      { name: 'Recorded', unit: 'USD', dims: { d: 'a' } },
      { name: 'Silent', unit: 'USD', dims: { d: 'b' } },
      { name: 'Francs', unit: 'CHF', dims: { d: 'c' } },
    ],
    figures: [
      ['Recorded', '2026-01-01', '100'],
      ['Recorded', '2026-02-01', '100'],
      ['Recorded', '2026-03-01', '100'],
      ['Silent', '2026-01-01', '50'],
      ['Francs', '2026-01-01', '10'],
      ['Francs', '2026-02-01', '20'],
    ],
    prices: [
      ['USD', '2026-01-01', '1'],
      ['USD', '2026-02-01', '2'],
      ['USD', '2026-03-01', '1'],
    ],
    dimensions: [{ id: 'd', label: 'D', values: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] }],
  };
  const dimension = base.dimensions[0];
  const without = {
    ...base,
    figures: base.figures.filter((f) => f[1] !== '2026-02-01'),
    prices: base.prices.filter((p) => p[1] !== '2026-02-01'),
  };
  const bandCurve = (spec, id) => {
    const vault = model(spec);
    const out = new Map();
    for (let d = day('2025-12-01'); d <= day('2026-04-01'); d += 1) {
      const band = vault.series(dimension, d, d).bands.find((b) => b.id === id);
      out.set(isoFromDay(d), band ? band.points[0] : 0n);
    }
    return out;
  };
  for (const id of ['a', 'b']) {
    const changed = moved(bandCurve(base, id), bandCurve(without, id));
    assert.ok(changed.length > 0, `band ${id} did not move`);
    assert.ok(within(changed, '2026-01-01', '2026-03-01'), `band ${id} moved outside the stretch`);
  }
  // The franc band moves only by the figure deleted with the date.
  assert.ok(within(moved(bandCurve(base, 'c'), bandCurve(without, 'c')), '2026-01-01', '2026-04-02'));
});

await check('the file keeps opening under its own key after a re-key', async () => {
  const { fileDek } = await transfer.openFile(copyOf(FIXTURE), FIXTURE_PASSWORD);
  await transfer.rekey(fileDek, FIXTURE.records);
  const again = await transfer.openFile(copyOf(FIXTURE), FIXTURE_PASSWORD);
  const plain = await transfer.decryptAll(again.fileDek, FIXTURE.records);
  assert.equal(plain.length, FIXTURE.records.length);
});

await check('a wrong password for the file stops at the unwrap and sends nothing', async () => {
  await assert.rejects(
    transfer.openFile(copyOf(FIXTURE), 'not the fixture password'),
    transfer.WrongPassword,
  );
  assert.deepEqual(requests, []);
});

await check('one byte altered in one record aborts the import and names that record', async () => {
  const file = copyOf(FIXTURE);
  const target = file.records.find((r) => r.recordType === 'snapshot');
  const bytes = cryptoModule.b64decode(target.ciphertext);
  bytes[3] ^= 0x01;
  target.ciphertext = cryptoModule.b64encode(bytes);
  const { fileDek } = await transfer.openFile(transfer.checkFile(file), FIXTURE_PASSWORD);
  await assert.rejects(transfer.rekey(fileDek, file.records), (error) => {
    assert.ok(error instanceof transfer.RecordUnreadable);
    assert.equal(error.recordId, target.recordId);
    return true;
  });
  assert.deepEqual(requests, []);
});

await check('the file is checked before it is decrypted, as the server checks the upload', () => {
  const refused = (change) => {
    const file = copyOf(FIXTURE);
    change(file);
    try {
      transfer.checkFile(file);
    } catch (error) {
      return error instanceof transfer.FileRefused ? error.reason : error.message;
    }
    return 'accepted';
  };
  assert.equal(refused(() => {}), 'accepted');
  assert.equal(refused((f) => { f.formatVersion = 2; }), 'newer');
  assert.equal(refused((f) => { f.formatVersion = 0; }), 'format');
  assert.equal(refused((f) => { f.format = 'something-else'; }), 'format');
  assert.equal(refused((f) => { f.records[1].recordType = 'invoice'; }), 'format');
  assert.equal(refused((f) => { f.records[1].recordId = 'not-a-uuid'; }), 'format');
  assert.equal(refused((f) => { f.records[1].accountId = ''; }), 'format');
  assert.equal(refused((f) => { f.records[2].accountId = null; }), 'format');
  assert.equal(refused((f) => { f.records[2].accountId = cryptoModule.uuid4(); }), 'format');
  assert.equal(refused((f) => { f.records[3].nonce = 'not base64!'; }), 'format');
  assert.equal(refused((f) => { f.records.push(copyOf(f.records[0])); }), 'format');
  assert.equal(refused((f) => { delete f.wrappedDek; }), 'format');
  // A vault restored without its profile would have no main currency.
  assert.equal(refused((f) => { f.records = f.records.filter((r) => r.recordType !== 'profile'); }), 'noProfile');
});

await check('net-worth-view: a date with prices and no figures still bends the bands', () => {
  const base = {
    holdings: [{ name: 'Dollars', unit: 'USD' }],
    figures: [
      ['Dollars', '2026-01-01', '100'],
      ['Dollars', '2026-03-01', '100'],
    ],
    prices: [
      ['USD', '2026-01-01', '1'],
      ['USD', '2026-02-01', '3'],
      ['USD', '2026-03-01', '1'],
    ],
  };
  const withEntry = curve(model(base), '2026-01-01', '2026-03-01');
  const withoutEntry = curve(model({ ...base, prices: base.prices.filter((p) => p[1] !== '2026-02-01') }), '2026-01-01', '2026-03-01');
  assert.equal(decimal.format(withEntry.get('2026-02-01')), '300');
  assert.equal(decimal.format(withoutEntry.get('2026-02-01')), '100');
  // And it takes no tick: a tick means a quantity was recorded.
  assert.deepEqual(model(base).quantityDates(), ['2026-01-01', '2026-03-01']);
});

await check('net-worth-view: interpolation is linear by day between entries, in both factors, and the band bends', () => {
  // The span from 1 January to 31 January 2026 has thirty days, so its
  // midpoint by day is 16 January.
  const vault = model({
    holdings: [
      { name: 'Francs', unit: 'CHF' },
      { name: 'Units', unit: 'PROBE' },
    ],
    figures: [
      ['Francs', '2026-01-01', '100'],
      ['Francs', '2026-01-31', '200'],
      ['Units', '2026-01-01', '100'],
      ['Units', '2026-01-31', '200'],
    ],
    prices: [
      ['PROBE', '2026-01-01', '1.00'],
      ['PROBE', '2026-01-31', '2.00'],
    ],
  });
  const at = (name, iso) => {
    const holding = vault.holdings.get(vault.ids[name]);
    return decimal.multiply(vault.quantityAt(holding.recordId, day(iso)), vault.priceAt(holding.payload.unit, day(iso)));
  };
  assert.equal(decimal.format(at('Francs', '2026-01-16')), '150');
  // 150 x 1.50, not the chord between 100 and 400.
  assert.equal(decimal.format(at('Units', '2026-01-16')), '225');
  // Only the two figures carry an entry mark.
  assert.deepEqual(vault.quantityDates(), ['2026-01-01', '2026-01-31']);
});

await check('net-worth-view: before a symbol\'s first price the band takes that first price', () => {
  const vault = model({
    holdings: [{ name: 'Dollars', unit: 'USD' }],
    figures: [['Dollars', '2026-01-01', '100']],
    prices: [['USD', '2026-03-01', '0.9']],
  });
  assert.equal(decimal.format(curve(vault, '2026-01-01', '2026-01-01').get('2026-01-01')), '90');
});

await check('net-worth-view: a price entry adds no tick, and a figure contributes nothing before its date', () => {
  const spec = {
    holdings: [
      { name: 'Old', unit: 'CHF' },
      { name: 'Later', unit: 'CHF' },
    ],
    figures: [
      ['Old', '2016-01-01', '100'],
      ['Old', '2026-01-01', '300'],
      ['Later', '2026-06-01', '50'],
    ],
  };
  const vault = model(spec);
  const ticks = vault.quantityDates();
  vault._index({ recordId: 'extra', recordType: 'rate', version: 1, payload: { symbol: 'USD', date: '2026-07-01', rate: '1', rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null } });
  assert.deepEqual(vault.quantityDates(), ticks);
  // Before its first figure a holding is absent rather than zero, and
  // after it the figure stands from its own date.
  const later = vault.ids.Later;
  assert.equal(vault.quantityAt(later, day('2026-05-31')), null);
  assert.equal(decimal.format(vault.quantityAt(later, day('2026-06-01'))), '50');
  // Ten years of an old holding's history, seen through a one-year
  // range, meets the range's left edge already interpolated: no step.
  const edge = curve(vault, '2025-06-01', '2025-06-02');
  const slope = decimal.format(edge.get('2025-06-02') - edge.get('2025-06-01'));
  assert.ok(Number(slope) > 0 && Number(slope) < 1, `the edge moved by ${slope} in a day`);
});

await check('net-worth-view: a holding recorded later raises only its own band', () => {
  const dimension = { id: 'd', label: 'D', values: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
  const early = { name: 'Early', unit: 'CHF', dims: { d: 'a' } };
  const spec = {
    dimensions: [dimension],
    holdings: [early],
    figures: [
      ['Early', '2016-01-01', '100'],
      ['Early', '2026-01-01', '200'],
    ],
  };
  const bandA = (vault) => {
    const out = [];
    for (let d = day('2019-06-01'); d <= day('2026-02-01'); d += 7) {
      out.push(vault.series(dimension, d, d).bands.find((b) => b.id === 'a').points[0]);
    }
    return out;
  };
  const alone = model(spec);
  const joined = model({
    ...spec,
    holdings: [early, { name: 'Late', unit: 'CHF', dims: { d: 'b' } }],
    figures: [...spec.figures, ['Late', '2020-01-01', '5000']],
  });
  assert.deepEqual(bandA(joined), bandA(alone));
});

await check('net-worth-view: archiving leaves every earlier point and drops the holding after its date', () => {
  const spec = (archivedAt) => ({
    holdings: [
      { name: 'Kept', unit: 'CHF' },
      { name: 'Closed', unit: 'CHF', archivedAt },
    ],
    figures: [
      ['Kept', '2026-01-01', '100'],
      ['Closed', '2026-01-01', '40'],
      ['Closed', '2026-03-01', '0'],
    ],
  });
  const open = curve(model(spec(null)), '2026-01-01', '2026-04-01');
  const archived = model(spec('2026-03-01'));
  const shut = curve(archived, '2026-01-01', '2026-04-01');
  const changed = moved(open, shut);
  // The zero archiving writes is the last figure, so the band has already run down to it.
  assert.deepEqual(changed, []);
  const skipped = model({ ...spec('2026-02-01'), figures: spec().figures.slice(0, 2) });
  const skippedCurve = curve(skipped, '2026-01-01', '2026-04-01');
  // It counts on every date before the archive date and on none from it on.
  assert.equal(decimal.format(skippedCurve.get('2026-01-31')), '140');
  assert.equal(decimal.format(skippedCurve.get('2026-02-01')), '100');
  assert.equal(decimal.format(skippedCurve.get('2026-02-02')), '100');
  assert.equal(decimal.format(archived.totals().net), '100');
});

// A holding's first recording, or its archive, is a step at its own date,
// so each sample also carries the stack just before it.
const justBefore = async (bands, index) => (await load('chart.js')).stack(bands, false, 'before').net[index];

const flatLater = () =>
  model({
    dimensions: [{ id: 'd', label: 'D', values: [{ id: 'p', label: 'Property' }, { id: 'c', label: 'Cash' }] }],
    holdings: [
      { name: 'Checking', unit: 'CHF', dims: { d: 'c' } },
      { name: 'Brokerage', unit: 'USD', dims: { d: 'c' } },
      { name: 'Gold', unit: 'ozt', dims: { d: 'c' } },
      { name: 'Flat', unit: 'sqm', dims: { d: 'p' } },
      { name: 'Mortgage', unit: 'CHF', dims: { d: 'p' } },
    ],
    figures: [
      ...['2026-09-15', '2026-10-01'].flatMap((date) => [
        ['Checking', date, '10000'],
        ['Brokerage', date, '5000'],
        ['Gold', date, '2'],
        ['Mortgage', date, '-300000'],
      ]),
      ['Flat', '2026-10-01', '100'],
    ],
    prices: [
      ['USD', '2026-09-15', '0.9'],
      ['ozt', '2026-09-15', '2000'],
      ['sqm', '2026-10-01', '8000'],
    ],
  });

await check('net-worth-view: a holding first recorded on a later date steps in at that date and does not ramp from the one before', async () => {
  const vault = flatLater();
  const { days, bands } = vault.series(null, day('2026-09-15'), day('2026-10-01'));
  assert.deepEqual(days, [day('2026-09-15'), day('2026-10-01')]);
  const [total] = bands;
  // One sample per date stays: the table and the hover read these.
  assert.equal(decimal.format(total.points[1] - total.points[0]), '800000');
  // Just before 1 October the flat is not there, so the line stays level.
  assert.equal(await justBefore(bands, 1), Number(decimal.format(total.points[0])));
});

await check('net-worth-view: grouped by a dimension, the later holding\'s band starts at its first date and the others do not move', async () => {
  const vault = flatLater();
  const { stack } = await load('chart.js');
  const { bands } = vault.series(vault.dimensions[0], day('2026-09-15'), day('2026-10-01'));
  const before = stack(bands, false, 'before');
  const main = stack(bands, false);
  const at = (layers, id) => layers.find((layer) => layer.band.id === id);
  // Property is first in the configured order and holds the flat and the
  // mortgage: the flat is not there just before and is there at the date.
  assert.deepEqual(at(before.layers, 'p').upper[1], [0, 0]);
  assert.deepEqual(at(main.layers, 'p').upper[1], [0, 800000]);
  // Cash is the same height just before and at the date, stacked above.
  assert.deepEqual(at(before.layers, 'c').upper[1], [0, 18500]);
  assert.deepEqual(at(main.layers, 'c').upper[1], [800000, 818500]);
  // The mortgage is not new on that date, so it stays in the liabilities.
  assert.deepEqual(at(before.layers, 'p').lower[1], at(main.layers, 'p').lower[1]);
});

await check('net-worth-view: a holding archived without a zero at D is on the side just before archivedAt and off the value at it', async () => {
  const vault = model({
    holdings: [
      { name: 'Kept', unit: 'CHF' },
      { name: 'Closed', unit: 'CHF', archivedAt: '2026-02-01' },
    ],
    figures: [
      ['Kept', '2026-01-01', '100'],
      ['Kept', '2026-04-01', '100'],
      ['Closed', '2026-01-01', '40'],
    ],
  });
  const { days, bands } = vault.series(null, day('2026-01-01'), day('2026-04-01'));
  const index = days.indexOf(day('2026-02-01'));
  assert.equal(decimal.format(bands[0].points[index - 1]), '140');
  assert.equal(decimal.format(bands[0].points[index]), '100');
  assert.equal(await justBefore(bands, index), 140);
  assert.equal(decimal.format(bands[0].points[index + 1]), '100');
});

await check('net-worth-view: a holding archived without a zero at D, with a non-zero figure at D, steps from that figure', () => {
  const vault = model({
    holdings: [{ name: 'Closed', unit: 'CHF', archivedAt: '2026-02-01' }],
    figures: [
      ['Closed', '2026-01-01', '100'],
      ['Closed', '2026-02-01', '10'],
    ],
  });
  const { days, bands } = vault.series(null, day('2026-01-01'), day('2026-02-01'));
  const index = days.indexOf(day('2026-02-01'));
  assert.equal(bands[0].points[index], 0n);
  assert.equal(decimal.format(bands[0].before.assets[index]), '10');
});

await check('net-worth-view: the archive\'s zero runs the band down to nothing with no edge at D', async () => {
  const vault = model({
    holdings: [{ name: 'Closed', unit: 'CHF', archivedAt: '2026-01-31' }],
    figures: [
      ['Closed', '2026-01-01', '100'],
      ['Closed', '2026-01-31', '0'],
    ],
  });
  const shown = curve(vault, '2026-01-01', '2026-01-31');
  assert.equal(decimal.format(shown.get('2026-01-16')), '50');
  const { days, bands } = vault.series(null, day('2026-01-01'), day('2026-01-31'));
  const index = days.indexOf(day('2026-01-31'));
  assert.equal(bands[0].points[index], 0n);
  // The side just before D is zero, so the step is no edge.
  assert.equal(await justBefore(bands, index), 0);
});

await check('net-worth-view: an unarchived holding whose zero sits at D contributes zero from D and interpolates up to its next figure', () => {
  const vault = model({
    holdings: [{ name: 'Back', unit: 'CHF' }],
    figures: [
      ['Back', '2026-01-01', '100'],
      ['Back', '2026-01-11', '0'],
      ['Back', '2026-01-21', '50'],
    ],
  });
  const shown = curve(vault, '2026-01-01', '2026-01-21');
  assert.equal(decimal.format(shown.get('2026-01-11')), '0');
  assert.equal(decimal.format(shown.get('2026-01-16')), '25');
  assert.equal(decimal.format(vault.totals().net), '50');
});

await check('net-worth-view: archived on the newest recorded date, the chart edge and every reading equal the total', async () => {
  const vault = model({
    holdings: [
      { name: 'Kept', unit: 'CHF' },
      { name: 'Gold', unit: 'XAU-ozt', archivedAt: '2026-10-01' },
    ],
    figures: [
      ['Kept', '2026-09-15', '1000'],
      ['Kept', '2026-10-01', '1000'],
      ['Gold', '2026-09-15', '2'],
      ['Gold', '2026-10-01', '0'],
    ],
    prices: [['XAU-ozt', '2026-09-15', '2000']],
  });
  assert.equal(vault.chartLastDate(), '2026-10-01');
  const { days, bands } = vault.series(null, day('2026-09-15'), day(vault.chartLastDate()));
  const edge = bands.reduce((sum, band) => sum + band.points.at(-1), 0n);
  assert.equal(edge, vault.totals('latest').net);
  assert.equal(decimal.format(edge), '1000');
  // The change over the range reads the same last point.
  assert.equal(decimal.format(edge - bands[0].points[0]), '-4000');
  // The zero is the side just before the date, so the line runs down
  // into it: 1000 just before it and at it, with no drop at the date.
  assert.equal(await justBefore(bands, days.length - 1), 1000);
});

await check('net-worth-view: archived after the newest recording, the chart extends to the archive date through its zero and its edge is the total', () => {
  const vault = model({
    holdings: [
      { name: 'Kept', unit: 'CHF' },
      { name: 'Gold', unit: 'XAU-ozt', archivedAt: '2026-10-05' },
    ],
    figures: [
      ['Kept', '2026-09-15', '1000'],
      ['Gold', '2026-09-15', '2'],
      ['Gold', '2026-10-05', '0'],
    ],
    prices: [['XAU-ozt', '2026-09-15', '2000']],
  });
  assert.equal(vault.chartLastDate(), '2026-10-05');
  const { days, bands } = vault.series(null, day('2026-09-15'), day(vault.chartLastDate()));
  assert.deepEqual(days, [day('2026-09-15'), day('2026-10-05')]);
  assert.equal(bands.reduce((sum, band) => sum + band.points.at(-1), 0n), vault.totals('latest').net);
  assert.equal(decimal.format(vault.totals('latest').net), '1000');
});

await check('net-worth-view: without a zero at D, a price entry at the archive date moves the side just before it and leaves the value at it unchanged', async () => {
  const at = (rate) => {
    const vault = model({
      holdings: [{ name: 'Gold', unit: 'XAU-ozt', archivedAt: '2026-10-01' }],
      figures: [['Gold', '2026-09-15', '2']],
      prices: [['XAU-ozt', '2026-09-15', '2000'], ['XAU-ozt', '2026-10-01', rate]],
    });
    const { days, bands } = vault.series(null, day('2026-09-15'), day('2026-10-01'));
    return { value: bands[0].points.at(-1), before: justBefore(bands, days.length - 1) };
  };
  const [low, high] = [at('2100'), at('2400')];
  assert.equal(low.value, 0n);
  assert.equal(high.value, 0n);
  // The quantity is carried forward and D's own price values it.
  assert.equal(await low.before, 4200);
  assert.equal(await high.before, 4800);
});

await check('net-worth-view: with the zero at D, a price entry at the archive date leaves the holding at zero on both sides', async () => {
  const vault = model({
    holdings: [{ name: 'Gold', unit: 'XAU-ozt', archivedAt: '2026-10-01' }],
    figures: [['Gold', '2026-09-15', '2'], ['Gold', '2026-10-01', '0']],
    prices: [['XAU-ozt', '2026-09-15', '2000'], ['XAU-ozt', '2026-10-01', '2400']],
  });
  const { days, bands } = vault.series(null, day('2026-09-15'), day('2026-10-01'));
  assert.equal(bands[0].points.at(-1), 0n);
  assert.equal(await justBefore(bands, days.length - 1), 0);
});

await check('net-worth-view: a holding first valued and archived on the same date is on neither side of its step', async () => {
  const vault = model({
    holdings: [
      { name: 'Kept', unit: 'CHF' },
      { name: 'Blip', unit: 'CHF', archivedAt: '2026-02-01' },
    ],
    figures: [
      ['Kept', '2026-01-01', '100'],
      ['Kept', '2026-03-01', '100'],
      ['Blip', '2026-02-01', '7'],
    ],
  });
  const { days, bands } = vault.series(null, day('2026-01-01'), day('2026-03-01'));
  const index = days.indexOf(day('2026-02-01'));
  assert.equal(decimal.format(bands[0].points[index]), '100');
  assert.equal(await justBefore(bands, index), 100);
});

await check('net-worth-view: the first sample has no side before it and every later one steps from its before side to its own value', async () => {
  const { outline } = await load('chart.js');
  const at = (value) => value;
  const points = outline([0, 10, 20], [[99, 1, 7], [0, 3, 5]], at, at);
  assert.deepEqual(points, ['0,0', '10,1', '10,3', '20,7', '20,5']);
});

await check('net-worth-view: on latest rates the chart\'s right edge is the total, and the other mode is not', () => {
  const vault = threeUnits();
  const last = day(vault.recordingDates().at(-1));
  const { bands } = vault.series(null, day('2026-01-01'), last);
  const edge = bands.reduce((sum, band) => sum + band.points.at(-1), 0n);
  assert.equal(edge, vault.totals('latest').net);
  assert.notEqual(edge, vault.totals('asRecorded').net);
});

await check('net-worth-view: every chart sample is the sum of its holdings, and each band the sum of its two sides', () => {
  const vault = model({
    dimensions: [{ id: 'd', label: 'D', values: [{ id: 'a', label: 'A' }] }],
    holdings: [
      { name: 'Flat', unit: 'CHF', dims: { d: 'a' } },
      { name: 'Mortgage', unit: 'CHF', dims: { d: 'a' } },
      { name: 'Dollars', unit: 'USD' },
    ],
    figures: [
      ['Flat', '2026-01-01', '1150000'],
      ['Mortgage', '2026-01-01', '-780000'],
      ['Mortgage', '2026-05-01', '-760000.33'],
      ['Dollars', '2026-02-01', '1000.07'],
    ],
    prices: [
      ['USD', '2026-01-01', '0.91'],
      ['USD', '2026-04-01', '0.87'],
    ],
  });
  const { days, bands } = vault.series(vault.dimensions[0], day('2026-01-01'), day('2026-06-01'));
  days.forEach((d, index) => {
    let expected = 0n;
    for (const holding of vault.holdings.values()) {
      const quantity = vault.quantityAt(holding.recordId, d);
      if (quantity !== null) expected += decimal.multiply(quantity, vault.priceAt(holding.payload.unit, d));
    }
    assert.equal(bands.reduce((sum, band) => sum + band.points[index], 0n), expected);
    for (const band of bands) assert.equal(band.assets[index] + band.liabilities[index], band.points[index]);
  });
});

await check('net-worth-view: the value model reads every calendar day, matches the drawing on each sample, and puts the archive on the side at it', () => {
  const vault = model({
    dimensions: [{ id: 'd', label: 'D', values: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
    holdings: [
      { name: 'Flat', unit: 'CHF', dims: { d: 'a' } },
      { name: 'Mortgage', unit: 'CHF', dims: { d: 'a' } },
      { name: 'Dollars', unit: 'USD', dims: { d: 'b' } },
      { name: 'Old', unit: 'CHF', archivedAt: '2026-04-01' },
    ],
    figures: [
      ['Flat', '2026-01-15', '1150000'],
      ['Mortgage', '2026-01-15', '-780000'],
      ['Mortgage', '2026-06-30', '-760000.33'],
      ['Dollars', '2026-04-10', '1000.07'],
      ['Old', '2026-01-15', '50'],
      ['Old', '2026-04-01', '0'],
    ],
    prices: [
      ['USD', '2026-01-15', '0.91'],
      ['USD', '2026-06-30', '0.87'],
    ],
  });
  for (const dimension of [null, vault.dimensions[0]]) {
    const { days, bands } = vault.series(dimension, day('2026-01-15'), day('2026-06-30'));
    // The range's every day, drawing sample or not.
    for (let d = day('2026-01-15'); d <= day('2026-06-30'); d += 1) {
      const read = vault.valuesAt(dimension, d);
      assert.deepEqual(read.map((b) => b.id), bands.map((b) => b.id));
      let expected = 0n;
      for (const holding of vault.holdings.values()) {
        const quantity = vault.quantityAt(holding.recordId, d);
        if (quantity === null || (holding.payload.archivedAt && d >= day(holding.payload.archivedAt))) continue;
        expected += decimal.multiply(quantity, vault.priceAt(holding.payload.unit, d));
      }
      assert.equal(read.reduce((sum, b) => sum + b.value, 0n), expected, isoFromDay(d));
      const at = days.indexOf(d);
      if (at >= 0) bands.forEach((band, i) => assert.equal(read[i].value, band.points[at]));
    }
  }
  // 5 February and 3 June are samples of nothing, and read by the model.
  const { days } = vault.series(null, day('2026-01-15'), day('2026-06-30'));
  assert.ok(!days.includes(day('2026-02-05')) && !days.includes(day('2026-06-03')));
  // The archive date reads the side at it: Old, alone in Unassigned, is
  // gone on its archive date and still there the day before.
  const unassigned = (iso) => vault.valuesAt(vault.dimensions[0], day(iso)).find((b) => b.id === 'unassigned').value;
  assert.equal(unassigned('2026-04-01'), 0n);
  assert.ok(unassigned('2026-03-31') > 0n);
});

await check('net-worth-view: the pointer rounds to the nearest day, a half to the later one, and clamps at both ends', async () => {
  const { dayAt } = await load('chart.js');
  // Days 0 to 4 across x 10 to 50: a day every 10.
  const at = (x) => dayAt(x, 10, 50, 100, 104);
  assert.deepEqual([10, 14, 15, 16, 25, 35, 49, 50].map(at), [100, 100, 101, 101, 102, 103, 104, 104]);
  assert.equal(at(-20), 100);
  assert.equal(at(900), 104);
  // One column at a time: never backward, first to last, and every day read.
  const read = Array.from({ length: 41 }, (_, c) => at(10 + c));
  assert.deepEqual(read, [...read].sort((a, b) => a - b));
  assert.equal(read[0], 100);
  assert.equal(read.at(-1), 104);
  assert.equal(new Set(read).size, 5);
  // A range of one day reads that day at every x.
  assert.deepEqual([0, 10, 33, 50, 99].map((x) => dayAt(x, 10, 50, 7, 7)), [7, 7, 7, 7, 7]);
});

// The step the rule names, found by walking the 1, 2, 5 series up from
// 1 rather than by the logarithm the chart takes.
const niceAtLeast = (rough) => {
  for (let n = 0; n < 15; n += 1) {
    for (const f of [1, 2, 5]) if (f * 10 ** n >= rough) return f * 10 ** n;
  }
  throw new Error(`no step for ${rough}`);
};
const unitOf = { '': 1, k: 1e3, M: 1e6, B: 1e9 };
/** A label read back to its value, in the exact scale-12 decimal, so
 *  "1.1k" is 1100 and not the float 1100.0000000000002. */
const readTick = (text, group, point) => {
  const [, minus, digits, suffix] = /^(−?)([\d., ]+?)([kMB]?)$/.exec(text);
  const plain = digits.split(group).join('').replace(point, '.');
  return (minus ? -1n : 1n) * decimal.parse(plain) * BigInt(unitOf[suffix]);
};

await check('net-worth-view: value ticks over the sweep are exact, whole, counted from zero and never read alike', async () => {
  const { valueTicks, tickLabel } = await load('chart.js');
  const totals = new Set([0.4]);
  for (let e = -1; e <= 10; e += 1) {
    for (const m of [1, 2, 2.5, 5, 7.5]) {
      const v = Number((m * 10 ** e).toPrecision(12));
      for (const near of [v, Math.floor(v) - 1, Math.floor(v), Math.ceil(v), Math.ceil(v) + 1]) {
        if (near > 0) totals.add(near);
      }
    }
  }
  assert.ok(totals.size > 100);
  for (const [group, point] of [[',', '.'], ['.', ',']]) {
    for (const total of totals) {
      for (const signed of [total, -total]) {
        const bottom = Math.min(0, signed);
        const top = Math.max(0, signed);
        for (const count of [6, 3]) {
          const where = `${signed} in ${count}`;
          const ticks = valueTicks(bottom, top, count);
          const labels = ticks.map((tick) => tickLabel(tick, group, point));
          assert.ok(ticks.includes(0), where);
          assert.equal(new Set(labels).size, labels.length, `${where}: ${labels}`);
          const step = niceAtLeast((top - bottom) / count);
          assert.ok(step >= 1, where);
          ticks.forEach((tick, at) => {
            assert.ok(tick % step === 0, `${where}: ${tick} is no multiple of ${step}`);
            assert.ok(tick >= bottom && tick <= top, where);
            assert.equal(Object.is(tick, -0), false, where);
            if (at) assert.equal(tick - ticks[at - 1], step, where);
            assert.equal(readTick(labels[at], group, point), BigInt(tick) * 10n ** 12n, `${where}: ${labels[at]} is not ${tick}`);
          });
          // Every multiple inside the domain is there.
          assert.equal(ticks.length, Math.floor(top / step) - Math.ceil(bottom / step) + 1, where);
        }
      }
    }
  }
  // A domain with no extent runs from 0 to 1.
  assert.deepEqual(valueTicks(0, 1, 6), [0, 1]);
});

await check('net-worth-view: one holding at 2500 has ticks 0 to 2500 by 500, reading 1.5k and 2.5k, or 1,5k and 2,5k under a decimal comma', async () => {
  const { valueTicks, tickLabel } = await load('chart.js');
  const ticks = valueTicks(0, 2500, 6);
  assert.deepEqual(ticks, [0, 500, 1000, 1500, 2000, 2500]);
  assert.deepEqual(ticks.map((t) => tickLabel(t, ',', '.')), ['0', '500', '1k', '1.5k', '2k', '2.5k']);
  assert.deepEqual(ticks.map((t) => tickLabel(t, '.', ',')), ['0', '500', '1k', '1,5k', '2k', '2,5k']);
  assert.deepEqual(valueTicks(0, 2500, 3), [0, 1000, 2000]);
  assert.equal(tickLabel(-1500, ',', '.'), '−1.5k');
  assert.equal(tickLabel(2500000, ',', '.'), '2.5M');
  assert.equal(tickLabel(3e9, ',', '.'), '3B');
});

await check('net-worth-view: a range starts no earlier than the oldest snapshot, whatever price entry is older', () => {
  const vault = model({
    holdings: [{ name: 'Cash', unit: 'CHF' }],
    figures: [['Cash', '2026-03-01', '100'], ['Cash', '2026-04-10', '200']],
    prices: [['USD', '2026-01-15', '0.9']],
  });
  const last = day('2026-04-10');
  for (const span of [183, 365, null]) {
    assert.deepEqual(vault.chartRange(span), { fromDay: day('2026-03-01'), lastDay: last }, String(span));
  }
  assert.equal(vault.chartRange(30).fromDay, last - 30);
  const single = model({
    holdings: [{ name: 'Cash', unit: 'CHF' }],
    figures: [['Cash', '2026-04-10', '200']],
    prices: [['USD', '2025-01-15', '0.9']],
  });
  for (const span of [30, 183, 365, null]) {
    assert.deepEqual(single.chartRange(span), { fromDay: last, lastDay: last }, String(span));
  }
});

await check('net-worth-view: stepping a day is calendar arithmetic and skips or repeats none across a clock change in any zone', () => {
  const zone = process.env.TZ;
  try {
    for (const tz of ['Europe/Zurich', 'America/New_York', 'Australia/Sydney', 'Pacific/Apia']) {
      process.env.TZ = tz;
      const seen = [];
      for (let d = day('2024-12-25'); d <= day('2026-01-05'); d += 1) seen.push(isoFromDay(d));
      assert.equal(new Set(seen).size, seen.length, tz);
      seen.forEach((iso, i) => {
        assert.equal(day(iso), day('2024-12-25') + i, tz);
        if (i) assert.equal(new Date(Date.parse(iso) - Date.parse(seen[i - 1])).getTime(), 86400000, tz);
      });
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

await check('net-worth-view: each holding falls in exactly one band, and an archived or unknown value is Unassigned', () => {
  const dimension = {
    id: 'd',
    label: 'D',
    values: [
      { id: 'a', label: 'A' },
      { id: 'gone', label: 'Gone', archivedAt: '2026-01-01' },
    ],
  };
  const vault = model({
    dimensions: [dimension],
    holdings: [
      { name: 'One', unit: 'CHF', dims: { d: 'a' } },
      { name: 'Two', unit: 'CHF', dims: { d: 'gone' } },
      { name: 'Three', unit: 'CHF', dims: { d: 'nowhere' } },
      { name: 'Four', unit: 'CHF' },
    ],
  });
  const bands = [...vault.holdings.values()].map((h) => vault.bandOf(h, dimension).id);
  assert.deepEqual(bands, ['a', 'unassigned', 'unassigned', 'unassigned']);
  assert.deepEqual(vault.coverage(dimension), { assigned: 1, total: 4 });
});

await check('net-worth-view: the breakdown sums to the total exactly, in both modes, with Other folding the fifth band on', async () => {
  const { breakdownTotals } = await load('view-dashboard.js');
  const values = ['a', 'b', 'c', 'e', 'f', 'g'].map((id) => ({ id, label: id.toUpperCase() }));
  const dimension = { id: 'd', label: 'D', values };
  const vault = model({
    dimensions: [dimension],
    holdings: [
      ...values.map((v) => ({ name: v.id, unit: 'USD', dims: { d: v.id } })),
      { name: 'loan', unit: 'CHF', dims: { d: 'a' } },
      { name: 'loose', unit: 'CHF' },
    ],
    figures: [
      ...values.map((v, i) => [v.id, '2026-01-01', `${100 + i}.333`]),
      ['loan', '2026-01-01', '-5000.01'],
      ['loose', '2026-01-01', '77.7'],
    ],
    prices: [
      ['USD', '2026-01-01', '0.917'],
      ['USD', '2026-09-01', '0.8']
    ],
  });
  for (const mode of ['latest', 'asRecorded']) {
    const bars = breakdownTotals(vault, dimension, mode);
    assert.deepEqual(bars.map((b) => b.label), ['A', 'B', 'C', 'E', 'Unassigned', 'Other']);
    assert.equal(bars.reduce((sum, b) => sum + b.total, 0n), vault.totals(mode).net);
  }
});

await check('net-worth-view: an archived holding is a row whatever its figures, and both groups list active holdings only', async () => {
  const { holdingGroups } = await load('view-dashboard.js');
  const vault = model({
    holdings: [
      { name: 'cash', unit: 'CHF' },
      { name: 'cellar', unit: 'bottles' },
      { name: 'new', unit: 'CHF' },
      { name: 'old cellar', unit: 'bottles', archivedAt: '2026-02-01' },
      { name: 'old empty', unit: 'CHF', archivedAt: '2026-02-01' },
    ],
    figures: [
      ['cash', '2026-01-01', '10'],
      ['cellar', '2026-01-01', '12'],
      ['old cellar', '2026-01-01', '6'],
    ],
  });
  const names = (list) => list.map((r) => (r.holding || r).payload.name).sort();
  for (const mode of ['latest', 'asRecorded']) {
    const shown = holdingGroups(vault, { mode, showArchived: true }, null);
    assert.deepEqual(names(shown.rows), ['cash', 'old cellar', 'old empty']);
    assert.deepEqual(names(shown.unpriced), ['cellar']);
    assert.deepEqual(names(shown.unvalued), ['new']);
    const archived = Object.fromEntries(shown.rows.map((r) => [r.holding.payload.name, r.value.state]));
    assert.deepEqual([archived['old cellar'], archived['old empty']], ['unpriced', 'unvalued']);

    const hidden = holdingGroups(vault, { mode, showArchived: false }, null);
    assert.deepEqual(names(hidden.rows), ['cash']);
    assert.deepEqual(names(hidden.unpriced), ['cellar']);
    assert.deepEqual(names(hidden.unvalued), ['new']);
  }
});

// ---- Recording: the write path -----------------------------------------
//
// spec/features/record-rate.md and record-snapshot.md, Acceptance
// criteria. The record store here follows the record API's version
// rule, and every request is logged in the order it was sent.

const writes = await load('writes.js');
const views = await load('view-sweep.js');

const SYMBOLS = [
  { symbol: 'CHF', label: 'Swiss Franc', kind: 'currency', lookup: true },
  { symbol: 'USD', label: 'United States Dollar', kind: 'currency', lookup: true },
  { symbol: 'XAU-ozt', label: 'Gold, troy ounce', kind: 'metal', lookup: true },
  { symbol: 'XAG-ozt', label: 'Silver, troy ounce', kind: 'metal', lookup: false },
];

function recordServer(rates = () => null) {
  const rows = new Map();
  const log = [];
  const faults = [];
  const reply = (status, body = null) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const target = new URL(url, 'http://solvent.test');
    const body = init.body ? JSON.parse(init.body) : null;
    const request = { method, path: target.pathname, query: Object.fromEntries(target.searchParams), headers: init.headers || {}, body, url: String(url) };
    log.push(request);
    for (const fault of faults) {
      const status = fault(request);
      if (status) return reply(status);
    }
    if (target.pathname === '/api/rates/symbols') return reply(200, SYMBOLS);
    if (target.pathname === '/api/rates') {
      const answer = rates(request.query);
      if (answer === null) return reply(204);
      if (typeof answer === 'number') return reply(answer);
      return reply(200, { date: request.query.date, quote: request.query.quote, rates: answer });
    }
    if (target.pathname === '/api/records' && method === 'GET') {
      return reply(200, [...rows.values()].filter((row) => row.recordType === request.query.type).map((row) => ({ ...row })));
    }
    const id = target.pathname.split('/').pop();
    if (method === 'PUT') {
      const stored = rows.get(id);
      if (stored ? body.version !== stored.version + 1 : body.version !== 1) return reply(409);
      rows.set(id, { recordId: id, ...body });
      return reply(200, { recordId: id, version: body.version });
    }
    if (method === 'DELETE') return rows.delete(id) ? reply(204) : reply(404);
    return reply(400);
  };
  const writesIn = () => log.filter((r) => r.method === 'PUT' || r.method === 'DELETE');
  return { rows, log, faults, writesIn, reset: () => log.splice(0) };
}

/** A vault written through the real write path into the store above,
 *  then read back as an unlock reads it. */
async function storedVault(server, { holdings = [], figures = [], prices = [] }) {
  const vault = new Vault(await cryptoModule.generateDek());
  await writes.putRecord(
    vault,
    { recordId: cryptoModule.uuid4(), recordType: 'profile', accountId: null, schemaVersion: SCHEMA_VERSION, version: 1 },
    { mainCurrency: 'CHF', createdAt: '2026-01-01T00:00:00Z' },
  );
  const ids = {};
  for (const [name, unit] of holdings) {
    ids[name] = (await writes.saveHolding(vault, null, { name, unit, dims: {}, note: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z' })).recordId;
  }
  for (const [name, date, value] of figures) await writes.saveSnapshot(vault, ids[name], null, { date, value, note: null });
  for (const [symbol, date, rate, rateSource = 'manual'] of prices) {
    await writes.saveRate(vault, null, { symbol, date, rate, rateTarget: 'CHF', rateSource, rateAsOf: rateSource === 'manual' ? null : date, proposedRate: null });
  }
  const fresh = new Vault(vault.dek);
  await fresh.load();
  fresh.ids = ids;
  server.reset();
  return fresh;
}

const PROPOSALS = {
  USD: { rate: '0.9312', asOf: '2026-07-31' },
  'XAU-ozt': { rate: '2700.25', asOf: '2026-07-30' },
};
const ratesAt = (vault, date) => vault.recording(date).prices;

await check('record-rate: recording one franc figure prices every other active unit once, the main currency never', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, {
    holdings: [['Francs', 'CHF'], ['Dollars', 'USD'], ['More dollars', 'USD'], ['Gold', 'XAU-ozt']],
  });
  await writes.saveSnapshot(vault, vault.ids.Francs, null, { date: '2026-07-31', value: '10', note: null });
  const proposals = await writes.fetchProposals(vault, '2026-07-31');
  await writes.refreshPrices(vault, '2026-07-31', proposals);
  const written = ratesAt(vault, '2026-07-31').map((e) => e.payload);
  assert.deepEqual(written.map((p) => p.symbol).sort(), ['USD', 'XAU-ozt']);
  // The quantity went first, then one request, then the prices.
  const order = server.log.map((r) => `${r.method} ${r.path}`);
  assert.equal(order[0].startsWith('PUT'), true);
  assert.equal(order.filter((r) => r.startsWith('GET /api/rates')).length, 1);
  for (const payload of written) {
    assert.equal(payload.rateTarget, 'CHF');
    assert.equal(payload.rateSource, 'proposed');
    assert.equal(payload.proposedRate, null);
  }
  assert.equal(written.find((p) => p.symbol === 'XAU-ozt').rateAsOf, '2026-07-30');
  // Twice at one date is a no-op the second time.
  server.reset();
  await writes.refreshPrices(vault, '2026-07-31', proposals);
  assert.equal(server.writesIn().length, 0);
  assert.equal(writes.needsLookup(vault, '2026-07-31'), false);
});

await check('record-rate: a rate record carries nothing in its plaintext columns but type, ids and versions', async () => {
  const server = recordServer();
  const vault = await storedVault(server, { holdings: [['Dollars', 'USD']] });
  await writes.saveRate(vault, null, writes.rateEntry(vault, 'USD', '2026-07-31', writes.ratePart({ figure: money('0.9312') })));
  const [put] = server.writesIn();
  assert.deepEqual(Object.keys(put.body).sort(), ['accountId', 'ciphertext', 'nonce', 'recordType', 'schemaVersion', 'version']);
  assert.equal(put.body.accountId, null);
  assert.equal(put.body.recordType, 'rate');
  assert.equal(put.path.split('/').pop().length, 36);
});

await check('record-snapshot: a snapshot carries its holding in the clear and no date, value or rate', async () => {
  const server = recordServer();
  const vault = await storedVault(server, { holdings: [['Dollars', 'USD']] });
  await writes.saveSnapshot(vault, vault.ids.Dollars, null, { date: '2026-07-31', value: '12450.00', note: null });
  const [put] = server.writesIn();
  assert.deepEqual(Object.keys(put.body).sort(), ['accountId', 'ciphertext', 'nonce', 'recordType', 'schemaVersion', 'version']);
  assert.equal(put.body.accountId, vault.ids.Dollars);
  const payload = await cryptoModule.decryptRecord(vault.dek, { ...put.body, recordId: put.path.split('/').pop() });
  assert.deepEqual(Object.keys(payload).sort(), ['date', 'note', 'value']);
});

await check('record-rate: a past date is priced at that date and the latest entry stays the latest', async () => {
  const server = recordServer(() => ({ USD: { rate: '0.95', asOf: '2026-03-31' } }));
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD']],
    prices: [['USD', '2026-09-01', '0.8', 'proposed']],
  });
  await writes.refreshPrices(vault, '2026-03-31', await writes.fetchProposals(vault, '2026-03-31'));
  assert.deepEqual(ratesAt(vault, '2026-03-31').map((e) => e.payload.rate), ['0.95']);
  assert.equal(vault.latestPrice('USD').date, '2026-09-01');
});

await check('record-rate: with no proposal, or no source at all, a previous entry stays the latest and nothing is written', async () => {
  const server = recordServer(() => null);
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD'], ['Flat', 'm2'], ['Silver', 'XAG-ozt']],
    prices: [
      ['USD', '2026-01-31', '0.9', 'proposed'],
      ['m2', '2025-06-30', '11000'],
      ['XAG-ozt', '2025-06-30', '30'],
    ],
  });
  // Neither free text nor a lookup-off symbol is anything to ask for.
  assert.equal(vault.quotable('m2'), false);
  assert.equal(vault.quotable('XAG-ozt'), false);
  await writes.refreshPrices(vault, '2026-07-31', await writes.fetchProposals(vault, '2026-07-31'));
  assert.equal(server.writesIn().length, 0);
  assert.equal(vault.latestPrice('USD').date, '2026-01-31');
  // A line still showing the carried estimate writes nothing either.
  assert.equal(writes.ratePart({ figure: money('11000'), carried: vault.carriedRate('m2', '2026-07-31') }), null);
});

const recordTrace = (server) =>
  server.log
    .filter((r) => r.path.startsWith('/api/records'))
    .map((r) => (r.method === 'GET' ? `GET ${r.query.type}` : r.method === 'PUT' ? `PUT ${r.body.recordType}` : r.method));

await check('record-rate: the price at a date is the exact day for a sourced unit and the newest estimate at or before it for an owner-priced one', async () => {
  const vault = await storedVault(recordServer(), {
    holdings: [['Dollars', 'USD'], ['Silver', 'XAG-ozt'], ['Flat', 'm2'], ['Francs', 'CHF']],
    prices: [
      ['USD', '2010-01-05', '1.0287'],
      ['XAG-ozt', '2024-01-15', '25'],
      ['m2', '2024-01-15', '10000'],
    ],
  });
  // A rate source: that day or not priced, however old the entry before it.
  assert.equal(decimal.format(vault.priceAtDate('USD', '2010-01-05').rate), '1.0287');
  assert.equal(vault.priceAtDate('USD', '2026-04-10'), null);
  assert.equal(vault.priceAtDate('USD', '2009-12-31'), null);
  // No rate source: the owner's estimate stands, and says how old it is.
  for (const unit of ['XAG-ozt', 'm2']) {
    const aged = vault.priceAtDate(unit, '2026-04-10');
    assert.equal(aged.date, '2024-01-15');
    assert.equal(vault.priceAtDate(unit, '2024-01-15').date, '2024-01-15');
    assert.equal(vault.priceAtDate(unit, '2023-12-31'), null);
  }
  assert.deepEqual(vault.priceAtDate('CHF', '2026-04-10'), { rate: decimal.ONE, date: null });
  // A flagged pair is no entry at its date.
  await writes.saveRate(vault, null, writes.rateEntry(vault, 'USD', '2010-01-05', writes.ratePart({ figure: money('1.1') })));
  assert.equal(vault.priceAtDate('USD', '2010-01-05'), null);
});

await check('record-snapshot: a date move writes the snapshot, then the new date\'s prices, then the displaced record\'s delete', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD'], ['Gold', 'XAU-ozt']],
    figures: [['Dollars', '2010-01-05', '100'], ['Dollars', '2026-04-10', '7']],
    prices: [['USD', '2010-01-05', '1.0287', 'proposed']],
  });
  const [moving, displaced] = vault.snapshotsFor(vault.ids.Dollars);
  const holding = vault.holdings.get(vault.ids.Dollars);
  const sit = writes.sitting(vault, '2026-04-10');
  const before = JSON.stringify(ratesAt(vault, '2010-01-05').map((e) => e.payload));
  const proposals = await writes.fetchProposals(vault, '2026-04-10');
  server.reset();
  let ratePuts = 0;
  server.faults.push((r) => (r.method === 'PUT' && r.body.recordType === 'rate' && (ratePuts += 1) === 1 ? 500 : null));
  const result = await writes.editSnapshot(vault, holding, moving, { date: '2026-04-10', value: '100', note: null }, { sit, displaced, proposals });
  // The reload that claims the date, the quantity, every rate (the one
  // that failed included), and the deletion after the last of them.
  assert.deepEqual(recordTrace(server), ['GET snapshot', 'GET rate', 'PUT snapshot', 'PUT rate', 'PUT rate', 'DELETE']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.undeleted, false);
  assert.equal(ratesAt(vault, '2026-04-10').length, 1);
  assert.equal(JSON.stringify(ratesAt(vault, '2010-01-05').map((e) => e.payload)), before);
  assert.equal(vault.snapshotsFor(vault.ids.Dollars).length, 1);
  assert.equal(result.moved.recordId, moving.recordId);
});

await check('record-snapshot: a move onto a date whose prices are complete asks for nothing and writes no price, and an edit in place claims nothing', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD']],
    figures: [['Dollars', '2010-01-05', '100']],
    prices: [['USD', '2026-04-10', '0.9', 'proposed']],
  });
  const [entry] = vault.snapshotsFor(vault.ids.Dollars);
  const holding = vault.holdings.get(vault.ids.Dollars);
  assert.equal(writes.needsLookup(vault, '2026-04-10'), false);
  const moved = await writes.editSnapshot(vault, holding, entry, { date: '2026-04-10', value: '100', note: null }, {});
  assert.deepEqual(server.writesIn().map((r) => r.body.recordType), ['snapshot']);
  assert.equal(server.log.some((r) => r.path === '/api/rates'), false);
  server.reset();
  await writes.editSnapshot(vault, holding, moved.moved, { date: '2026-04-10', value: '101', note: 'again' }, {});
  assert.deepEqual(recordTrace(server), ['PUT snapshot']);
});

await check('record-snapshot: a move is refused whole when another session took the slot with a record the confirmation did not name', async () => {
  const server = recordServer();
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD']],
    figures: [['Dollars', '2010-03-31', '100'], ['Dollars', '2026-04-10', '7']],
    prices: [['USD', '2026-04-10', '0.8']],
  });
  const [moving, displaced] = vault.snapshotsFor(vault.ids.Dollars);
  const other = new Vault(vault.dek);
  await other.load();
  await writes.saveSnapshot(other, vault.ids.Dollars, null, { date: '2026-04-10', value: '9', note: null });
  server.reset();
  const result = await writes.editSnapshot(vault, vault.holdings.get(vault.ids.Dollars), moving, { date: '2026-04-10', value: '100', note: null }, { displaced });
  assert.equal(result.refused, true);
  assert.equal(server.writesIn().length, 0);
});

await check('record-snapshot: a move is refused whole when another session recorded at its empty date', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD'], ['Francs', 'CHF']],
    figures: [['Dollars', '2010-03-31', '100']],
  });
  const sit = writes.sitting(vault, '2026-04-10');
  const other = new Vault(vault.dek);
  await other.load();
  await writes.saveSnapshot(other, vault.ids.Francs, null, { date: '2026-04-10', value: '9', note: null });
  server.reset();
  const result = await writes.editSnapshot(vault, vault.holdings.get(vault.ids.Dollars), vault.snapshotsFor(vault.ids.Dollars)[0], { date: '2026-04-10', value: '100', note: null }, { sit });
  assert.equal(result.refused, true);
  assert.equal(server.writesIn().length, 0);
});

await check('record-snapshot: a move whose displaced record cannot be deleted still gets its prices, and an archived holding\'s unit is priced at the new date', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, {
    holdings: [['Francs', 'CHF'], ['Dollars', 'USD']],
    figures: [['Dollars', '2010-01-05', '100'], ['Dollars', '2026-04-10', '7'], ['Francs', '2026-04-11', '1']],
  });
  const holding = vault.holdings.get(vault.ids.Dollars);
  await writes.saveHolding(vault, holding, { ...holding.payload, archivedAt: '2026-04-11' });
  // The archived holding's unit is no longer among the active ones.
  assert.deepEqual(vault.unitsToRefresh(), []);
  assert.deepEqual(vault.unitsToRefresh('USD'), ['USD']);
  const [moving, displaced] = vault.snapshotsFor(vault.ids.Dollars);
  const sit = writes.sitting(vault, '2026-04-10');
  const proposals = await writes.fetchProposals(vault, '2026-04-10');
  server.faults.push((r) => (r.method === 'DELETE' ? 500 : null));
  const result = await writes.editSnapshot(vault, vault.holdings.get(vault.ids.Dollars), moving, { date: '2026-04-10', value: '100', note: null }, { sit, displaced, proposals });
  assert.equal(result.undeleted, true);
  assert.deepEqual(ratesAt(vault, '2026-04-10').map((e) => e.payload.symbol), ['USD']);
  assert.equal(vault.snapshotsFor(vault.ids.Dollars).length, 2);
});

await check('record-rate: a proposal left alone is proposed, a changed one edited, and a typed one manual', () => {
  const proposal = { rate: '0.9312', asOf: '2026-07-29' };
  assert.deepEqual(writes.ratePart({ figure: money('0.9312'), proposal }), { rate: '0.9312', rateSource: 'proposed', rateAsOf: '2026-07-29', proposedRate: null });
  assert.deepEqual(writes.ratePart({ figure: money('0.95'), proposal }), { rate: '0.95', rateSource: 'edited', rateAsOf: '2026-07-29', proposedRate: '0.9312' });
  assert.deepEqual(writes.ratePart({ figure: money('12') }), { rate: '12', rateSource: 'manual', rateAsOf: null, proposedRate: null });
  assert.equal(writes.ratePart({ figure: null, proposal }), null);
});

await check('record-rate: editing a proposed entry keeps the offer once, and editing it again keeps the original', () => {
  const stored = { symbol: 'USD', date: '2026-07-31', rate: '0.9312', rateTarget: 'CHF', rateSource: 'proposed', rateAsOf: '2026-07-29', proposedRate: null };
  const once = writes.editedRatePayload(stored, '0.95');
  assert.deepEqual(once, { ...stored, rate: '0.95', rateSource: 'edited', proposedRate: '0.9312' });
  const twice = writes.editedRatePayload(once, '0.96');
  assert.equal(twice.proposedRate, '0.9312');
  assert.equal(twice.rateAsOf, '2026-07-29');
  const typed = writes.editedRatePayload({ ...stored, rateSource: 'manual', rateAsOf: null }, '1.1');
  assert.equal(typed.rateSource, 'manual');
  assert.equal(typed.proposedRate, null);
});

await check('record-rate: the rate-lines save writes the rates, then deletes, and a failed rate is named', async () => {
  const server = recordServer();
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD'], ['Gold', 'XAU-ozt'], ['Silver', 'XAG-ozt']],
    figures: [['Dollars', '2026-07-31', '100']],
    prices: [
      ['USD', '2026-07-31', '0.9', 'proposed'],
      ['XAU-ozt', '2026-07-31', '2700', 'proposed'],
      ['XAG-ozt', '2026-07-31', '30', 'proposed'],
    ],
  });
  const at = vault.recording('2026-07-31');
  const price = (symbol) => at.prices.find((e) => e.payload.symbol === symbol);
  const plan = {
    rates: [
      { existing: price('USD'), payload: writes.editedRatePayload(price('USD').payload, '0.91') },
      { existing: price('XAU-ozt'), payload: writes.editedRatePayload(price('XAU-ozt').payload, '2710') },
    ],
    deletes: [{ entry: price('XAG-ozt'), name: 'XAG-ozt' }],
  };
  // The second rate fails, and nothing about the rest changes for it.
  let rateWrites = 0;
  server.faults.push((r) => (r.method === 'PUT' && r.body.recordType === 'rate' && (rateWrites += 1) === 2 ? 500 : null));
  const result = await writes.saveRateLines(vault, writes.sitting(vault, '2026-07-31'), plan);
  const order = server.writesIn().map((r) => `${r.method} ${r.body ? r.body.recordType : 'record'}`);
  assert.deepEqual(order, ['PUT rate', 'PUT rate', 'DELETE record']);
  // Only updates, so no reload ran.
  assert.equal(server.log.filter((r) => r.method === 'GET').length, 0);
  assert.deepEqual(result.failed.map((f) => f.name), ['XAU-ozt']);
  const reread = new Vault(vault.dek);
  await reread.load();
  const back = reread.recording('2026-07-31');
  assert.equal(back.prices.find((e) => e.payload.symbol === 'USD').payload.rate, '0.91');
  assert.equal(back.prices.find((e) => e.payload.symbol === 'XAU-ozt').payload.rate, '2700');
  assert.equal(back.prices.some((e) => e.payload.symbol === 'XAG-ozt'), false);
  // The figure beside them is not part of the save.
  assert.equal(back.figures.find((f) => f.holding.payload.name === 'Dollars').snapshot.version, 1);
  const copy = views.partialCopy(result);
  assert.ok(copy.includes('Not saved: XAU-ozt'), copy);
  assert.ok(copy.includes('Saved: USD, XAG-ozt'), copy);
});

await check('record-rate: the rate-lines save at a date holding no recording issues no request and writes nothing', async () => {
  const server = recordServer();
  const vault = await storedVault(server, { holdings: [['Francs', 'CHF'], ['Dollars', 'USD']], prices: [['USD', '2026-06-30', '0.9']] });
  server.reset();
  const sit = writes.sitting(vault, '2026-07-31');
  const typed = { rate: '0.9', rateSource: 'manual', rateAsOf: null, proposedRate: null };
  const result = await writes.saveRateLines(vault, sit, { rates: [{ existing: null, payload: writes.rateEntry(vault, 'USD', '2026-07-31', typed) }] });
  assert.equal(result.refused, true);
  assert.deepEqual(result.saved, []);
  assert.equal(server.log.length, 0);
  assert.equal(vault.holdsRecording('2026-07-31'), false);
  // A date holding a recording is saved as before.
  const at = writes.sitting(vault, '2026-06-30');
  const [entry] = vault.entriesFor('USD');
  const done = await writes.saveRateLines(vault, at, { rates: [{ existing: entry, payload: writes.editedRatePayload(entry.payload, '0.95') }] });
  assert.equal(done.refused, false);
  assert.equal(server.writesIn().length, 1);
});

await check('record-rate: a rate-lines save at a date another session emptied since the sitting began creates nothing', async () => {
  const server = recordServer();
  const vault = await storedVault(server, {
    holdings: [['Francs', 'CHF'], ['Dollars', 'USD'], ['Gold', 'XAU-ozt']],
    figures: [['Francs', '2026-07-31', '5']],
    prices: [['USD', '2026-07-31', '0.9']],
  });
  const sit = writes.sitting(vault, '2026-07-31');
  assert.equal(sit.dateWasEmpty, false);
  const other = new Vault(vault.dek);
  await other.load();
  assert.deepEqual(await writes.deleteRecording(other, '2026-07-31'), []);
  server.reset();
  const typed = { rate: '2700', rateSource: 'manual', rateAsOf: null, proposedRate: null };
  const result = await writes.saveRateLines(vault, sit, { rates: [{ existing: null, payload: writes.rateEntry(vault, 'XAU-ozt', '2026-07-31', typed) }] });
  assert.equal(result.refused, true);
  assert.equal(result.emptied, true);
  assert.equal(server.writesIn().length, 0);
  assert.equal([...server.rows.values()].filter((r) => r.recordType === 'rate').length, 0);
  // The model now shows the date as it stands.
  assert.equal(vault.holdsRecording('2026-07-31'), false);
});

await check('record-snapshot: a delete answering Not Found during a save counts as saved', async () => {
  const server = recordServer();
  const vault = await storedVault(server, { holdings: [['Dollars', 'USD']], prices: [['USD', '2026-07-31', '0.9']] });
  const [gone] = vault.entriesFor('USD');
  server.rows.delete(gone.recordId);
  const result = await writes.saveRateLines(vault, writes.sitting(vault, '2026-07-31'), { deletes: [{ entry: gone, name: 'USD' }] });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.saved.map((s) => s.name), ['USD']);
  assert.equal(vault.entriesFor('USD').length, 0);
});

await check('record-snapshot: a create at a date another session recorded is refused whole, and the claim runs once', async () => {
  const server = recordServer();
  const vault = await storedVault(server, { holdings: [['Francs', 'CHF'], ['Dollars', 'USD']] });
  const sit = writes.sitting(vault, '2026-07-31');
  assert.equal(sit.dateWasEmpty, true);
  // Another session records the date behind this one's model.
  const other = new Vault(vault.dek);
  await other.load();
  await writes.saveSnapshot(other, vault.ids.Dollars, null, { date: '2026-07-31', value: '1', note: null });
  server.reset();
  const result = await writes.claimDate(vault, sit, { rates: ['USD'] });
  assert.deepEqual(result, { refused: true, date: '2026-07-31' });
  assert.equal(server.writesIn().length, 0);
  assert.deepEqual(server.log.map((r) => r.query.type), ['snapshot', 'rate']);
  // The screen now describes the vault as it stands.
  assert.equal(vault.holdsRecording('2026-07-31'), true);

  // A sitting that claimed its date reloads nothing more.
  const fresh = writes.sitting(vault, '2026-08-31');
  assert.equal(await writes.claimDate(vault, fresh, { snapshots: [vault.ids.Francs] }), null);
  server.reset();
  assert.equal(await writes.claimDate(vault, fresh, { snapshots: [vault.ids.Dollars] }), null);
  assert.equal(server.log.length, 0);
});

await check('record-snapshot: inside a reopened date, a slot another session filled refuses the create', async () => {
  const server = recordServer();
  const vault = await storedVault(server, {
    holdings: [['Francs', 'CHF'], ['Dollars', 'USD']],
    figures: [['Francs', '2026-07-31', '5']],
  });
  const sit = writes.sitting(vault, '2026-07-31');
  assert.equal(sit.dateWasEmpty, false);
  const other = new Vault(vault.dek);
  await other.load();
  await writes.saveSnapshot(other, vault.ids.Dollars, null, { date: '2026-07-31', value: '1', note: null });
  server.reset();
  assert.deepEqual(await writes.claimDate(vault, sit, { snapshots: [vault.ids.Dollars] }), { refused: true, date: '2026-07-31' });
  assert.equal(server.writesIn().length, 0);
});

await check('record-snapshot: confirming records the carried figure exactly, and is refused with nothing to confirm', async () => {
  const server = recordServer();
  const vault = await storedVault(server, {
    holdings: [['Francs', 'CHF'], ['Dollars', 'USD'], ['Flat', 'm2'], ['New', 'CHF']],
    figures: [['Francs', '2026-06-30', '1000.10'], ['Dollars', '2026-06-30', '12.500'], ['Flat', '2026-06-30', '95']],
  });
  for (const name of ['Francs', 'Dollars', 'Flat']) {
    const entry = await writes.confirmFigure(vault, vault.holdings.get(vault.ids[name]), '2026-07-31');
    const carried = vault.snapshotsFor(vault.ids[name]).find((s) => s.payload.date === '2026-06-30');
    assert.equal(entry.payload.value, carried.payload.value);
    assert.equal(entry.payload.date, '2026-07-31');
  }
  server.reset();
  assert.throws(() => writes.confirmFigure(vault, vault.holdings.get(vault.ids.New), '2026-07-31'));
  assert.equal(server.log.length, 0);
});

await check('record-rate: a Conflict reloads the whole type and overwrites nothing', async () => {
  const server = recordServer();
  const vault = await storedVault(server, { holdings: [['Dollars', 'USD']], prices: [['USD', '2026-07-31', '0.9', 'proposed']] });
  const [stale] = vault.entriesFor('USD');
  // A second tab writes first.
  const other = new Vault(vault.dek);
  await other.load();
  await writes.saveRate(other, other.entriesFor('USD')[0], writes.editedRatePayload(other.entriesFor('USD')[0].payload, '0.99'));
  const stored = { ...server.rows.get(stale.recordId) };
  server.reset();
  const result = await writes.saveRateLines(vault, writes.sitting(vault, '2026-07-31'), {
    rates: [{ existing: stale, payload: writes.editedRatePayload(stale.payload, '0.5') }],
  });
  assert.deepEqual(result.failed.map((f) => f.status), [409]);
  assert.equal(server.writesIn().length, 1);
  assert.deepEqual(server.rows.get(stale.recordId), stored);
  await writes.reloadType(vault, 'rate');
  assert.equal(vault.entriesFor('USD')[0].payload.rate, '0.99');
});

// ---- Archiving: the zero, the prices, the flag ------------------------
//
// spec/features/manage-accounts.md, Archiving and Acceptance criteria.

const D = '2026-08-15';
const kinds = (server) => server.log.map((r) => `${r.method} ${r.body ? r.body.recordType : r.path}${r.query && r.query.type ? ` ${r.query.type}` : ''}`);
const snapshotRows = (server) =>
  JSON.stringify([...server.rows.values()].filter((r) => r.recordType === 'snapshot').sort((a, b) => (a.recordId < b.recordId ? -1 : 1)));
const archiveWorld = (extra = {}) => ({
  holdings: [['Dollars', 'USD'], ['Gold', 'XAU-ozt'], ['Francs', 'CHF']],
  figures: [['Dollars', '2026-07-31', '120.50'], ['Gold', '2026-07-31', '2'], ...(extra.figures || [])],
  prices: extra.prices || [],
});
const accountPuts = (server) => server.writesIn().filter((r) => r.body && r.body.recordType === 'account');

await check('manage-accounts: archiving a date holding nothing writes the zero, then the missing prices with this unit among them, then the flag', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld());
  const earlier = snapshotRows(server);
  const holding = vault.holdings.get(vault.ids.Dollars);
  const result = await writes.archiveHolding(vault, holding, D);
  assert.deepEqual(result, { status: 'archived', unpriced: [] });
  // One reload of both types, before the first create, and never again.
  assert.deepEqual(kinds(server).slice(0, 3), ['GET /api/records snapshot', 'GET /api/records rate', 'PUT snapshot']);
  assert.equal(server.log.filter((r) => r.method === 'GET' && r.query.type).length, 2);
  assert.deepEqual(
    kinds(server).filter((k) => k.startsWith('PUT') || k.includes('/api/rates')),
    ['PUT snapshot', 'GET /api/rates', 'PUT rate', 'PUT rate', 'PUT account'],
  );
  const zero = vault.snapshotsFor(vault.ids.Dollars).find((x) => x.payload.date === D);
  assert.deepEqual(zero.payload, { date: D, value: '0', note: null });
  assert.equal(zero.version, 1);
  assert.deepEqual(ratesAt(vault, D).map((e) => e.payload.symbol).sort(), ['USD', 'XAU-ozt']);
  const put = accountPuts(server);
  assert.equal(put.length, 1);
  assert.equal(put[0].body.version, 2);
  assert.equal(vault.holdings.get(vault.ids.Dollars).payload.archivedAt, D);
  // Every figure before D is as it was, and none is deleted.
  const now = JSON.parse(snapshotRows(server)).filter((r) => r.recordId !== zero.recordId);
  assert.equal(JSON.stringify(now), earlier);
  assert.equal(server.writesIn().some((r) => r.method === 'DELETE'), false);
});

await check('manage-accounts: archiving onto a date whose prices are complete asks the proxy nothing and rewrites no price', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(
    server,
    archiveWorld({ prices: [['USD', D, '0.9'], ['XAU-ozt', D, '2700']], figures: [['Francs', D, '5']] }),
  );
  const rates = JSON.stringify([...server.rows.values()].filter((r) => r.recordType === 'rate'));
  await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(server.log.some((r) => r.path === '/api/rates'), false);
  assert.equal(server.writesIn().filter((r) => r.body.recordType === 'rate').length, 0);
  assert.equal(JSON.stringify([...server.rows.values()].filter((r) => r.recordType === 'rate')), rates);
  // The recording at D belongs to the Francs figure: joining it is no refusal.
  assert.equal(vault.holdings.get(vault.ids.Dollars).payload.archivedAt, D);
});

await check('manage-accounts: a non-zero figure at D is replaced in place, and a zero in any form is left byte-identical', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld({ figures: [['Dollars', D, '300.5']] }));
  const before = vault.snapshotsFor(vault.ids.Dollars).find((x) => x.payload.date === D);
  const stored = { ...server.rows.get(before.recordId) };
  await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  const after = server.rows.get(before.recordId);
  assert.equal(after.version, stored.version + 1);
  assert.notEqual(after.nonce, stored.nonce);
  assert.equal(vault.snapshotsFor(vault.ids.Dollars).filter((x) => x.payload.date === D).length, 1);
  assert.deepEqual(vault.snapshotsFor(vault.ids.Dollars).find((x) => x.payload.date === D).payload, { date: D, value: '0', note: null });

  const kept = recordServer(() => PROPOSALS);
  const other = await storedVault(kept, archiveWorld({ figures: [['Dollars', D, '0.00']], prices: [['USD', D, '0.9'], ['XAU-ozt', D, '2700']] }));
  const zero = other.snapshotsFor(other.ids.Dollars).find((x) => x.payload.date === D);
  const row = { ...kept.rows.get(zero.recordId) };
  await writes.archiveHolding(other, other.holdings.get(other.ids.Dollars), D);
  assert.deepEqual(kept.rows.get(zero.recordId), row);
  // Nothing created, so no reload: one account write and nothing else.
  assert.deepEqual(kinds(kept), ['PUT account']);
});

await check('manage-accounts: a replaced figure that changed elsewhere is a Conflict, surfaced and never retried', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld({ figures: [['Dollars', D, '300.5']] }));
  const other = new Vault(vault.dek);
  await other.load();
  const theirs = other.snapshotsFor(vault.ids.Dollars).find((x) => x.payload.date === D);
  await writes.saveSnapshot(other, vault.ids.Dollars, theirs, { ...theirs.payload, value: '9' });
  server.reset();
  const result = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(result.status, 'conflict');
  assert.equal(server.writesIn().length, 1);
  assert.equal(vault.holdings.get(vault.ids.Dollars).payload.archivedAt, null);
});

await check('manage-accounts: the flag failing leaves the zero and prices, and archiving again writes only the flag', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld());
  let fail = true;
  server.faults.push((r) => (fail && r.method === 'PUT' && r.body.recordType === 'account' ? 500 : null));
  const first = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(first.status, 'flagFailed');
  assert.equal(vault.holdings.get(vault.ids.Dollars).payload.archivedAt, null);
  assert.equal(vault.snapshotsFor(vault.ids.Dollars).filter((x) => x.payload.date === D).length, 1);
  assert.equal(ratesAt(vault, D).length, 2);
  assert.equal(vault.activeHoldings().some((h) => h.recordId === vault.ids.Dollars), true);
  server.reset();
  fail = false;
  const again = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(again.status, 'archived');
  assert.deepEqual(kinds(server), ['PUT account']);
});

await check('manage-accounts: the zero failing writes no price and no flag', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld());
  server.faults.push((r) => (r.method === 'PUT' && r.body.recordType === 'snapshot' ? 500 : null));
  const result = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(result.status, 'zeroFailed');
  assert.equal(server.log.some((r) => r.path === '/api/rates'), false);
  assert.equal(server.log.some((r) => r.method === 'PUT' && r.body.recordType !== 'snapshot'), false);
  assert.equal(vault.holdings.get(vault.ids.Dollars).payload.archivedAt, null);
});

await check('manage-accounts: a price failing does not stop the archive, and the retry after a failed flag writes only that unit', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld());
  let failRate = true;
  let failFlag = true;
  server.faults.push((r) => {
    if (r.method !== 'PUT') return null;
    if (failRate && r.body.recordType === 'rate' && ratesAt(vault, D).length === 1) return 500;
    return failFlag && r.body.recordType === 'account' ? 500 : null;
  });
  // The first rate written lands and the second fails.
  const first = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(first.status, 'flagFailed');
  assert.equal(first.unpriced.length, 1);
  const missing = first.unpriced[0];
  assert.equal(ratesAt(vault, D).length, 1);
  server.reset();
  failRate = false;
  failFlag = false;
  const again = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.deepEqual(again, { status: 'archived', unpriced: [] });
  const writesNow = server.writesIn().map((r) => `${r.body.recordType}`);
  assert.deepEqual(writesNow, ['rate', 'account']);
  assert.equal(ratesAt(vault, D).some((e) => e.payload.symbol === missing), true);
  // The second attempt reloads once, before its first create.
  assert.equal(server.log.filter((r) => r.method === 'GET' && r.query.type).length, 2);
});

await check('manage-accounts: an archived holding is not archived again, and nothing is written', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld({ figures: [['Dollars', '2026-08-01', '0']] }));
  const holding = vault.holdings.get(vault.ids.Dollars);
  await writes.saveHolding(vault, holding, { ...holding.payload, archivedAt: '2026-08-01' });
  const rows = JSON.stringify([...server.rows.values()]);
  server.reset();
  assert.deepEqual(await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D), { status: 'alreadyArchived' });
  assert.equal(server.log.length, 0);
  assert.equal(JSON.stringify([...server.rows.values()]), rows);
  assert.equal(vault.holdings.get(vault.ids.Dollars).payload.archivedAt, '2026-08-01');
});

await check('manage-accounts: a Conflict on the flag reloads the account record, and archiving again finishes against it', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld());
  const other = new Vault(vault.dek);
  await other.load();
  const theirs = other.holdings.get(vault.ids.Dollars);
  await writes.saveHolding(other, theirs, { ...theirs.payload, name: 'Renamed elsewhere' });
  server.reset();
  const first = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(first.status, 'flagConflict');
  const reloaded = vault.holdings.get(vault.ids.Dollars);
  assert.equal(reloaded.payload.name, 'Renamed elsewhere');
  assert.equal(reloaded.version, 2);
  assert.equal(reloaded.payload.archivedAt, null);
  server.reset();
  const again = await writes.archiveHolding(vault, reloaded, D);
  assert.equal(again.status, 'archived');
  assert.deepEqual(kinds(server), ['PUT account']);
  assert.equal(accountPuts(server)[0].body.version, 3);
  assert.equal(vault.holdings.get(vault.ids.Dollars).payload.name, 'Renamed elsewhere');
});

await check('manage-accounts: a flag that failed names the units whose price did not save, a Conflict included', async () => {
  const { flagFailedCopy } = await load('view-holding-form.js');
  for (const status of ['flagFailed', 'flagConflict']) {
    assert.ok(flagFailedCopy(status, '3 October 2026', ['USD', 'XAU-ozt']).endsWith(' The prices for USD and XAU-ozt did not save.'), status);
    assert.ok(!flagFailedCopy(status, '3 October 2026', []).includes('prices'), status);
  }
  assert.ok(flagFailedCopy('flagConflict', 'D', []).startsWith('This holding was changed in another tab.'));

  // The writes layer hands the units over with the Conflict.
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld());
  const other = new Vault(vault.dek);
  await other.load();
  const theirs = other.holdings.get(vault.ids.Dollars);
  await writes.saveHolding(other, theirs, { ...theirs.payload, name: 'Renamed elsewhere' });
  server.faults.push((r) => (r.method === 'PUT' && r.body.recordType === 'rate' ? 500 : null));
  const result = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.equal(result.status, 'flagConflict');
  assert.deepEqual([...result.unpriced].sort(), ['USD', 'XAU-ozt']);
});

await check('manage-accounts: with the proxy answering 503 the archive still goes through', async () => {
  const server = recordServer(() => 503);
  const vault = await storedVault(server, archiveWorld());
  const result = await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  assert.deepEqual(result, { status: 'archived', unpriced: [] });
  assert.equal(ratesAt(vault, D).length, 0);
});

await check('manage-accounts: the reload refuses only when this holding\'s own slot at D was taken since', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld());
  const rival = new Vault(vault.dek);
  await rival.load();
  // Another session records only another holding at D: the zero joins it.
  await writes.saveSnapshot(rival, vault.ids.Francs, null, { date: D, value: '1', note: null });
  server.reset();
  assert.equal((await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D)).status, 'archived');

  const second = recordServer(() => PROPOSALS);
  const mine = await storedVault(second, archiveWorld());
  const taker = new Vault(mine.dek);
  await taker.load();
  await writes.saveSnapshot(taker, mine.ids.Dollars, null, { date: D, value: '7', note: null });
  second.reset();
  assert.deepEqual(await writes.archiveHolding(mine, mine.holdings.get(mine.ids.Dollars), D), { status: 'refused' });
  assert.equal(second.writesIn().length, 0);
  // The model now shows what D holds.
  assert.equal(mine.snapshotsFor(mine.ids.Dollars).find((x) => x.payload.date === D).payload.value, '7');
});

await check('manage-accounts: a holding with no snapshots archives to a zero at version 1, and reads zero once unarchived', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, { holdings: [['Empty', 'USD']] });
  await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Empty), D);
  const [zero] = vault.snapshotsFor(vault.ids.Empty);
  assert.equal(zero.version, 1);
  assert.deepEqual(zero.payload, { date: D, value: '0', note: null });
  server.reset();
  const archived = vault.holdings.get(vault.ids.Empty);
  await writes.saveHolding(vault, archived, { ...archived.payload, archivedAt: null });
  assert.deepEqual(kinds(server), ['PUT account']);
  assert.equal(vault.valueOf(vault.holdings.get(vault.ids.Empty)).state, 'valued');
  assert.equal(vault.valueOf(vault.holdings.get(vault.ids.Empty)).stored, '0');
});

await check('manage-accounts: the archive\'s zero is read off the holding, and deleting the recording at D keeps it', async () => {
  const server = recordServer(() => PROPOSALS);
  const vault = await storedVault(server, archiveWorld({ figures: [['Francs', D, '5']] }));
  await writes.archiveHolding(vault, vault.holdings.get(vault.ids.Dollars), D);
  const holding = vault.holdings.get(vault.ids.Dollars);
  const zero = vault.snapshotsFor(vault.ids.Dollars).find((x) => x.payload.date === D);
  const bytes = { ...server.rows.get(zero.recordId) };
  assert.equal(vault.isArchiveZero(holding, zero), true);
  // Not the archive's: another holding's zero, or a non-zero figure at D.
  assert.equal(vault.isArchiveZero(vault.holdings.get(vault.ids.Francs), { payload: { date: D, value: '0' } }), false);
  assert.equal(vault.isArchiveZero(holding, { payload: { date: D, value: '1' } }), false);
  assert.equal(vault.isArchiveZero(holding, { payload: { date: '2026-07-31', value: '0' } }), false);
  server.reset();
  assert.deepEqual(await writes.deleteRecording(vault, D), []);
  assert.deepEqual(server.rows.get(zero.recordId), bytes);
  assert.equal(vault.holdsRecording(D), true);
  assert.deepEqual(vault.recording(D).figures.map((f) => f.snapshot.recordId), [zero.recordId]);
  assert.equal(vault.recording(D).prices.length, 0);
  // Unarchived, the zero is a figure like any other.
  const archived = vault.holdings.get(vault.ids.Dollars);
  await writes.saveHolding(vault, archived, { ...archived.payload, archivedAt: null });
  assert.equal(vault.isArchiveZero(vault.holdings.get(vault.ids.Dollars), zero), false);
});

await check('manage-accounts: loading a holding archived without a zero at D writes nothing', async () => {
  const server = recordServer();
  const vault = await storedVault(server, archiveWorld());
  const gone = vault.holdings.get(vault.ids.Dollars);
  await writes.saveHolding(vault, gone, { ...gone.payload, archivedAt: D });
  const rows = JSON.stringify([...server.rows.values()]);
  server.reset();
  const fresh = new Vault(vault.dek);
  await fresh.load();
  assert.equal(server.writesIn().length, 0);
  assert.equal(JSON.stringify([...server.rows.values()]), rows);
});

await check('record-rate: the confirmation does not count a holding at zero that day, the archive\'s zero included', () => {
  const vault = model({
    holdings: [
      { name: 'A', unit: 'USD' },
      { name: 'Archived at zero', unit: 'USD', archivedAt: '2026-07-31' },
      { name: 'Archived without', unit: 'USD', archivedAt: '2026-07-31' },
      { name: 'Back at zero', unit: 'USD' },
    ],
    figures: [
      ['A', '2026-06-30', '100'],
      ['Archived at zero', '2026-06-30', '10'],
      ['Archived at zero', '2026-07-31', '0.00'],
      ['Archived without', '2026-06-30', '10'],
      ['Back at zero', '2026-07-31', '0'],
    ],
  });
  const copy = views.rateChangeCopy(vault, '2026-07-31', [{ unit: 'USD' }]);
  assert.ok(copy[0].includes('moves 2 holdings measured in USD'), copy[0]);
});

await check('record-rate: the confirmation names each unit, how many holdings move, and a unit\'s only price', () => {
  const vault = model({
    holdings: [
      { name: 'A', unit: 'USD' },
      { name: 'B', unit: 'USD' },
      // Archived on the date itself, so that day's price still values it.
      { name: 'Closed that day', unit: 'USD', archivedAt: '2026-07-31' },
      // Archived before the date, so that day's price values nothing.
      { name: 'Closed earlier', unit: 'USD', archivedAt: '2026-07-01' },
      // First valued after the date, so it held nothing then.
      { name: 'Opened later', unit: 'USD' },
      // Never valued at all.
      { name: 'Empty', unit: 'USD' },
      { name: 'Gold', unit: 'XAU-ozt' },
    ],
    figures: [
      ['A', '2026-06-30', '100'],
      ['B', '2026-07-31', '50'],
      ['Closed that day', '2026-05-31', '10'],
      ['Closed earlier', '2026-05-31', '10'],
      ['Opened later', '2026-08-31', '10'],
      ['Gold', '2026-06-30', '2'],
    ],
    prices: [
      ['USD', '2026-07-31', '0.9'],
      ['USD', '2026-06-30', '0.91'],
      ['XAU-ozt', '2026-07-31', '2700'],
    ],
  });
  vault.profile.locale = 'en-GB';
  const copy = views.rateChangeCopy(vault, '2026-07-31', [{ unit: 'USD' }, { unit: 'XAU-ozt', clearing: true }]);
  assert.ok(copy[0].includes('moves 3 holdings measured in USD on that date'), copy[0]);
  assert.ok(copy[1].includes('Clearing the XAU-ozt price'), copy[1]);
  assert.ok(copy[1].endsWith('1 holding measured in XAU-ozt moves on that date.'), copy[1]);
  assert.ok(copy[2].startsWith('This is the only price recorded for XAU-ozt.'), copy[2]);
});

// ---- Age in words ------------------------------------------------------
//
// spec/features/record-snapshot.md: a figure's date is a calendar date
// with no time or timezone, so its age is a count of calendar days and
// the hour the reader looks at it never changes the wording.

await check('a figure dated today is "today" at any hour, not "yesterday"', async () => {
  const dom = await load('dom.js');
  const RealDate = Date;
  const at = (iso) => {
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [iso]));
      }
      static now() {
        return new RealDate(iso).getTime();
      }
    };
  };
  try {
    for (const hour of ['00:00:00Z', '11:59:59Z', '12:00:00Z', '15:00:00Z', '23:59:59Z']) {
      at(`2026-09-30T${hour}`);
      assert.equal(dom.today(), '2026-09-30');
      assert.equal(dom.ageInWords('2026-09-30'), 'today', hour);
      assert.equal(dom.ageInWords('2026-09-29'), 'yesterday', hour);
      assert.equal(dom.ageInWords('2026-09-20'), '10 days ago', hour);
      assert.equal(dom.ageInWords('2026-08-31'), '4 weeks ago', hour);
      assert.equal(dom.ageInWords(null), 'never valued', hour);
      assert.equal(dom.ageInWords(undefined), 'never valued', hour);
    }
  } finally {
    globalThis.Date = RealDate;
  }
});

// ---- The username rule -------------------------------------------------

// The same file the server's normalization is run over
// (tests/test_register_refusals.py), through the real check.
const usernames = JSON.parse(
  await (await import('node:fs/promises')).readFile(new URL('../fixtures/usernames.json', import.meta.url), 'utf8'),
);
const username = await load('username.js');

await check('the browser accepts what the shared fixture accepts, normalized the same', () => {
  for (const { raw, normalized } of usernames.accept) {
    assert.equal(username.normalizeUsername(raw), normalized, JSON.stringify(raw));
  }
});

await check('the browser refuses what the shared fixture refuses', () => {
  for (const raw of usernames.refuse) {
    assert.equal(username.normalizeUsername(raw), null, JSON.stringify(raw));
  }
});

await check('a username error names the character before the length, and short only once left', () => {
  assert.match(username.usernameProblem('Bo b!', false), /^Only letters/);
  assert.match(username.usernameProblem('a'.repeat(32) + '!', false), /^Only letters/);
  assert.equal(username.usernameProblem('a'.repeat(33), false), 'That is more than 32 characters.');
  assert.equal(username.usernameProblem('ab', false), null);
  assert.equal(username.usernameProblem('ab', true), 'Use at least 3 characters.');
  assert.equal(username.usernameProblem('', true), null);
  assert.equal(username.usernameProblem('  Bob  ', true), null);
});

// ---- Report -----------------------------------------------------------

for (const [state, name] of results) console.log(`${state} ${name}`);
const failed = results.filter(([state]) => state !== 'ok');
if (failed.length) process.exit(1);
