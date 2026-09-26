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

await check('a locked account reads as too many attempts at the salt request too', async () => {
  // The limiter answers the salt request before the derivation, so
  // that is where a locked account is usually met.
  const session = await load('session.js');
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(session.signIn('anyone', 'a password'), (error) =>
    error instanceof session.SignInError && error.message === 'throttled');
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
const rawKey = async (key) =>
  cryptoModule.b64encode(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key)));
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

const { Vault, dayNumber, isoFromDay } = await load('model.js');

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
  // The span from 1 January to 1 March 2024 has sixty days, so its
  // midpoint is 31 January.
  const vault = model({
    holdings: [
      { name: 'Francs', unit: 'CHF' },
      { name: 'Units', unit: 'PROBE' },
    ],
    figures: [
      ['Francs', '2024-01-01', '100'],
      ['Francs', '2024-03-01', '200'],
      ['Units', '2024-01-01', '100'],
      ['Units', '2024-03-01', '200'],
    ],
    prices: [
      ['PROBE', '2024-01-01', '1.00'],
      ['PROBE', '2024-03-01', '2.00'],
    ],
  });
  const at = (name, iso) => {
    const holding = vault.holdings.get(vault.ids[name]);
    return decimal.multiply(vault.quantityAt(holding.recordId, day(iso)), vault.priceAt(holding.payload.unit, day(iso)));
  };
  assert.equal(decimal.format(at('Francs', '2024-01-31')), '150');
  assert.equal(decimal.format(at('Units', '2024-01-31')), '225');
  // Linear by day, so 1 February sits one day past the midpoint.
  assert.equal(decimal.format(at('Francs', '2024-02-01')), '151.666666666667');
  assert.deepEqual(vault.quantityDates(), ['2024-01-01', '2024-03-01']);
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
  // The closing figure is zero, so the band has already run down to it.
  assert.deepEqual(changed, []);
  const skipped = model({ ...spec('2026-02-01'), figures: spec().figures.slice(0, 2) });
  const skippedCurve = curve(skipped, '2026-01-01', '2026-04-01');
  assert.equal(decimal.format(skippedCurve.get('2026-02-01')), '140');
  assert.equal(decimal.format(skippedCurve.get('2026-02-02')), '100');
  assert.equal(decimal.format(archived.totals().net), '100');
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

await check('record-rate: a save writes the quantity, then the rates, then deletes, and a failed rate is named', async () => {
  const server = recordServer();
  const vault = await storedVault(server, {
    holdings: [['Dollars', 'USD'], ['Gold', 'XAU-ozt'], ['Francs', 'CHF']],
    figures: [['Dollars', '2026-07-31', '100'], ['Francs', '2026-07-31', '5']],
    prices: [['USD', '2026-07-31', '0.9', 'proposed'], ['XAU-ozt', '2026-07-31', '2700', 'proposed']],
  });
  const at = vault.recording('2026-07-31');
  const figure = (name) => at.figures.find((f) => f.holding.payload.name === name).snapshot;
  const price = (symbol) => at.prices.find((e) => e.payload.symbol === symbol);
  const plan = () => ({
    quantities: [{ accountId: vault.ids.Dollars, existing: figure('Dollars'), payload: { ...figure('Dollars').payload, value: '110' }, name: 'Dollars' }],
    rates: [
      { existing: price('USD'), payload: writes.editedRatePayload(price('USD').payload, '0.91') },
      { existing: price('XAU-ozt'), payload: writes.editedRatePayload(price('XAU-ozt').payload, '2710') },
    ],
    deletes: [{ entry: figure('Francs'), name: 'Francs' }],
  });
  // The second rate fails, and nothing about the rest changes for it.
  let rateWrites = 0;
  server.faults.push((r) => (r.method === 'PUT' && r.body.recordType === 'rate' && (rateWrites += 1) === 2 ? 500 : null));
  const result = await writes.saveRecording(vault, writes.sitting(vault, '2026-07-31'), plan());
  const order = server.writesIn().map((r) => `${r.method} ${r.body ? r.body.recordType : 'record'}`);
  assert.deepEqual(order, ['PUT snapshot', 'PUT rate', 'PUT rate', 'DELETE record']);
  // Only updates, so no reload ran.
  assert.equal(server.log.filter((r) => r.method === 'GET').length, 0);
  assert.deepEqual(result.failed.map((f) => f.name), ['XAU-ozt']);
  const reread = new Vault(vault.dek);
  await reread.load();
  const back = reread.recording('2026-07-31');
  assert.equal(back.figures.find((f) => f.holding.payload.name === 'Dollars').snapshot.payload.value, '110');
  assert.equal(back.prices.find((e) => e.payload.symbol === 'USD').payload.rate, '0.91');
  assert.equal(back.prices.find((e) => e.payload.symbol === 'XAU-ozt').payload.rate, '2700');
  assert.equal(back.figures.some((f) => f.holding.payload.name === 'Francs'), false);
  const copy = views.partialCopy(result);
  assert.ok(copy.includes('Not saved: XAU-ozt'), copy);
  assert.ok(copy.includes('Saved: Dollars, USD, Francs'), copy);
});

await check('record-snapshot: a delete answering Not Found during a save counts as saved', async () => {
  const server = recordServer();
  const vault = await storedVault(server, { holdings: [['Francs', 'CHF']], figures: [['Francs', '2026-07-31', '5']] });
  const [gone] = vault.snapshotsFor(vault.ids.Francs);
  server.rows.delete(gone.recordId);
  const result = await writes.saveRecording(vault, writes.sitting(vault, '2026-07-31'), { deletes: [{ entry: gone, name: 'Francs' }] });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.saved.map((s) => s.name), ['Francs']);
  assert.equal(vault.snapshotsFor(vault.ids.Francs).length, 0);
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
  const result = await writes.saveRecording(vault, sit, {
    quantities: [{ accountId: vault.ids.Francs, existing: null, payload: { date: '2026-07-31', value: '5', note: null }, name: 'Francs' }],
  });
  assert.equal(result.refused, true);
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
  const result = await writes.saveRecording(vault, writes.sitting(vault, '2026-07-31'), {
    rates: [{ existing: stale, payload: writes.editedRatePayload(stale.payload, '0.5') }],
  });
  assert.deepEqual(result.failed.map((f) => f.status), [409]);
  assert.equal(server.writesIn().length, 1);
  assert.deepEqual(server.rows.get(stale.recordId), stored);
  await writes.reloadType(vault, 'rate');
  assert.equal(vault.entriesFor('USD')[0].payload.rate, '0.99');
});

await check('record-rate: the confirmation names each unit, how many holdings move, and a unit\'s only price', () => {
  const vault = model({
    holdings: [
      { name: 'A', unit: 'USD' },
      { name: 'B', unit: 'USD' },
      { name: 'Gold', unit: 'XAU-ozt' },
    ],
    prices: [
      ['USD', '2026-07-31', '0.9'],
      ['USD', '2026-06-30', '0.91'],
      ['XAU-ozt', '2026-07-31', '2700'],
    ],
  });
  vault.profile.locale = 'en-GB';
  const copy = views.rateChangeCopy(vault, '2026-07-31', [{ unit: 'USD' }, { unit: 'XAU-ozt', clearing: true }]);
  assert.ok(copy[0].includes('moves 2 holdings measured in USD'), copy[0]);
  assert.ok(copy[1].includes('Clearing the XAU-ozt price'), copy[1]);
  assert.ok(copy[2].startsWith('This is the only price recorded for XAU-ozt.'), copy[2]);
});

// ---- Report -----------------------------------------------------------

for (const [state, name] of results) console.log(`${state} ${name}`);
const failed = results.filter(([state]) => state !== 'ok');
if (failed.length) process.exit(1);
