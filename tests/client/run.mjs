// The client-side rules a wrong implementation would break silently:
// the AAD bytes, the decimal arithmetic, and the key derivation.
//
// Run by tests/test_client.py, so one `pytest` covers both halves.
import assert from 'node:assert/strict';

const JS = new URL('../../solvent/static/js/', import.meta.url);
const load = (name) => import(new URL(name, JS).href);

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
    const { default: loadArgon2id } = await import(
      new URL('../vendor/argon2id/1.0.1/argon2id.js', JS).href
    );
    const hash = await loadArgon2id();
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
const { migrate, SCHEMA_VERSION } = await load('model.js');

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

  const masterRaw = cryptoModule.b64encode(
    new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', first.masterKey)),
  );
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
  const { default: loadArgon2id } = await import(
    new URL('../vendor/argon2id/1.0.1/argon2id.js', JS).href
  );
  const hash = await loadArgon2id();
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
  const { Vault } = await load('model.js');

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

await check('a quantity keeps its places whatever money is set to', async () => {
  const { formatter } = await load('format.js');
  // Rounding 12.5 ounces of gold to 13 would lose the holding.
  const shape = formatter({ locale: 'en-US', moneyPlaces: '0' });
  assert.equal(shape.quantity(12500000000000n), '12.50');
  // 12 rather than 13: display rounding is half-even like every other
  // rounding in the product, and 12.5 lies on the tie.
  assert.equal(shape.money(12500000000000n), '12');
  assert.equal(shape.money(12600000000000n), '13');
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

// ---- Report -----------------------------------------------------------

for (const [state, name] of results) console.log(`${state} ${name}`);
const failed = results.filter(([state]) => state !== 'ok');
if (failed.length) process.exit(1);
