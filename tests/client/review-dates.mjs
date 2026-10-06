// Reviewer's checks on the dates a figure or price may carry and the
// addresses inside the vault, written from the spec alone:
// app-shell.md, Addresses inside the vault (criterion 83);
// record-snapshot.md, A recording is a date (criteria 98 to 100);
// rate-lookup.md, SSRF and egress hardening, the `date` bullet.
//
// Run by tests/test_review_app_shell.py and
// tests/test_review_record_snapshot.py, one group of checks each.
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

// The device's clock and zone, held at `instant` in `zone` while `body`
// runs. Every `new Date()` and `Date.now()` reads the instant.
const RealDate = Date;
async function at(instant, zone, body) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [instant]));
    }
    static now() {
      return new RealDate(instant).getTime();
    }
  };
  try {
    return await body();
  } finally {
    globalThis.Date = RealDate;
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

// A record store answering as the server does, logging every request.
function server(rates = {}) {
  const rows = new Map();
  const log = [];
  const reply = (status, body = null) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const target = new URL(url, 'http://solvent.test');
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ method, path: target.pathname, query: Object.fromEntries(target.searchParams) });
    if (target.pathname === '/api/rates/symbols') {
      return reply(200, [
        { symbol: 'CHF', label: 'Swiss franc', kind: 'currency', lookup: true, since: '1999-01-04' },
        { symbol: 'USD', label: 'US dollar', kind: 'currency', lookup: true, since: '1999-01-04' },
      ]);
    }
    if (target.pathname === '/api/rates') {
      return reply(200, { date: target.searchParams.get('date'), quote: target.searchParams.get('quote'), rates });
    }
    if (target.pathname === '/api/records' && method === 'GET') {
      return reply(200, [...rows.values()].filter((row) => row.recordType === target.searchParams.get('type')));
    }
    const id = target.pathname.split('/').pop();
    if (method === 'PUT') {
      rows.set(id, { recordId: id, ...body });
      return reply(200, { recordId: id, version: body.version });
    }
    if (method === 'DELETE') return rows.delete(id) ? reply(204) : reply(404);
    return reply(400);
  };
  return { rows, log, sent: () => log.filter((r) => r.method !== 'GET').length };
}

// Every AES-GCM encryption WebCrypto performs, counted.
let encryptions = 0;
const realEncrypt = globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.encrypt = (...args) => {
  encryptions += 1;
  return realEncrypt(...args);
};

const group = process.argv[2];
const { route } = await load('routes.js');
const { Vault, SCHEMA_VERSION, dayNumber } = await load('model.js');

if (group === 'addresses') {
  const TODAY = '2026-09-30';
  // Dates a stored record carries, misdated ones among them.
  const stored = new Set(['2026-09-01', '2099-01-01', '2026-02-30', 'garbage']);
  const carries = (date) => stored.has(date);

  await check('app-shell 83: every address in the route table names a screen', () => {
    const named = [
      '', '#/', '#/unassigned/d1', '#/settings', '#/settings/dimensions', '#/settings/export-import',
      '#/holding/7f3c', '#/holding/7f3c/edit',
      `#/sweep/${TODAY}`, '#/sweep/2026-09-29', '#/sweep/2024-02-29', '#/sweep/2000-01-01',
      '#/recording/2026-09-01', `#/recording/${TODAY}`,
    ];
    const missing = named.filter((hash) => !route(hash, TODAY, carries));
    assert.deepEqual(missing, []);
  });

  await check('app-shell 83: an address outside the table names no screen and never falls to the dashboard', () => {
    const unnamed = [
      '#/nonsense', '#/holdings', '#/admin', '#/dashboard', '#nonsense', '#/reloading',
      '#/settings/other', '#/settings/dimensions/x', '#/settings/export-import/x',
      '#/holding', '#/holding/7f3c/delete', '#/holding/7f3c/edit/x',
      '#/unassigned', '#/unassigned/d1/x',
      '#/sweep', '#/sweep/', `#/sweep/${TODAY}/x`,
      '#/recording', '#/recording/2026-09-01/x',
    ];
    const opened = unnamed.filter((hash) => route(hash, TODAY, carries));
    assert.deepEqual(opened, []);
  });

  await check('app-shell 83: a sweep opens only at a recorded day, whatever a stored record carries', () => {
    const refused = [
      '2026-10-01', '2099-01-01', '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-09-00',
      '2026-9-30', '20260930', '+02026-09-30', '2026-09-30T00:00', 'garbage', '%20', '2026-09-30%20',
    ];
    const opened = refused.filter((date) => route(`#/sweep/${date}`, TODAY, carries));
    assert.deepEqual(opened, []);
  });

  await check('app-shell 83: a recording opens at a recorded day or at a date a stored record carries, and nowhere else', () => {
    for (const date of ['2099-01-01', '2026-02-30', 'garbage', '2026-08-15']) {
      assert.ok(route(`#/recording/${date}`, TODAY, carries), date);
    }
    for (const date of ['2026-10-01', '2098-01-01', '2026-02-31', 'nonsense']) {
      assert.equal(route(`#/recording/${date}`, TODAY, carries), null, date);
    }
  });

  await check("app-shell 83: the device's today decides whether a sweep opens", () => {
    assert.equal(route('#/sweep/2026-10-01', '2026-09-30', carries), null);
    assert.ok(route('#/sweep/2026-10-01', '2026-10-01', carries));
  });
}

if (group === 'records') {
  const writes = await load('writes.js');
  const dom = await load('dom.js');
  const cryptoModule = await load('crypto.js');

  // A vault with its profile and holdings written and read back, as
  // an unlock leaves it.
  async function storedVault(store, holdings) {
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
    const fresh = new Vault(vault.dek);
    await fresh.load();
    fresh.ids = ids;
    return fresh;
  }
  const figure = (date) => ({ date, value: '1', note: null });
  const price = (date) => ({ symbol: 'USD', date, rate: '0.9', rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null });
  // Runs `write` and says what reached the wire and the model.
  async function attempt(store, vault, write) {
    const sentBefore = store.sent();
    const encryptedBefore = encryptions;
    const outcome = await write().then((value) => ({ value }), (error) => ({ error }));
    return { outcome, sent: store.sent() - sentBefore, encrypted: encryptions - encryptedBefore };
  }

  const BAD = [
    '2026-10-01', '2099-01-01', '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-09-00',
    '2026-9-30', '20260930', '+02026-09-30', '2026-09-30T00:00', ' 2026-09-30', '2026-09-30 ', 'garbage', '',
    null, undefined, 20260930,
  ];

  await check('record-snapshot 98: a figure or price at a date that does not exist or is to come is refused before encrypting or sending', async () => {
    await at('2026-09-30T12:00:00Z', 'UTC', async () => {
      const store = server();
      const vault = await storedVault(store, [['Cash', 'CHF']]);
      const leaked = [];
      for (const date of BAD) {
        for (const [kind, write] of [
          ['figure', () => writes.saveSnapshot(vault, vault.ids.Cash, null, figure(date))],
          ['price', () => writes.saveRate(vault, null, price(date))],
        ]) {
          const { outcome, sent, encrypted } = await attempt(store, vault, write);
          if (sent || encrypted || (outcome.value && !outcome.error)) leaked.push(`${kind} ${JSON.stringify(date)}`);
        }
      }
      assert.deepEqual(leaked, []);
      assert.equal(vault.recording('2099-01-01').figures.length + vault.recording('2099-01-01').prices.length, 0);
    });
  });

  await check('record-snapshot 98: moving a stored figure or price onto a date to come is refused before encrypting or sending', async () => {
    await at('2026-09-30T12:00:00Z', 'UTC', async () => {
      const store = server();
      const vault = await storedVault(store, [['Cash', 'CHF']]);
      const snapshot = await writes.saveSnapshot(vault, vault.ids.Cash, null, figure('2026-09-01'));
      const rate = await writes.saveRate(vault, null, price('2026-09-01'));
      for (const write of [
        () => writes.saveSnapshot(vault, vault.ids.Cash, snapshot, figure('2099-01-01')),
        () => writes.saveRate(vault, rate, price('2026-02-30')),
        () => writes.refreshPrices(vault, '2099-01-01', { USD: { rate: '0.9', asOf: '2026-09-30' } }),
      ]) {
        const { sent, encrypted } = await attempt(store, vault, write);
        assert.equal(sent, 0, 'requests sent');
        assert.equal(encrypted, 0, 'records encrypted');
      }
      assert.deepEqual(vault.recordingDates(), ['2026-09-01']);
    });
  });

  await check('record-snapshot 98: today and any calendar day before it are written', async () => {
    await at('2026-09-30T12:00:00Z', 'UTC', async () => {
      const store = server();
      const vault = await storedVault(store, [['Cash', 'CHF']]);
      for (const date of ['2026-09-30', '2026-09-29', '2024-02-29', '2000-01-01']) {
        const { outcome, sent } = await attempt(store, vault, () => writes.saveSnapshot(vault, vault.ids.Cash, null, figure(date)));
        assert.ok(!outcome.error && sent === 1, date);
      }
    });
  });

  await check('record-snapshot 99: a misdated record can always be deleted', async () => {
    await at('2026-09-30T12:00:00Z', 'UTC', async () => {
      const store = server();
      const vault = await storedVault(store, [['Cash', 'CHF']]);
      // Planted the way an older client or another device could have left it.
      const slot = { recordId: cryptoModule.uuid4(), recordType: 'snapshot', accountId: vault.ids.Cash, schemaVersion: SCHEMA_VERSION, version: 1 };
      const blob = await cryptoModule.encryptRecord(vault.dek, slot, figure('2099-01-01'));
      store.rows.set(slot.recordId, { recordId: slot.recordId, recordType: 'snapshot', accountId: vault.ids.Cash, schemaVersion: SCHEMA_VERSION, version: 1, ...blob });
      await vault.load();
      const [{ snapshot }] = vault.recording('2099-01-01').figures;
      await writes.deleteRecord(vault, snapshot);
      assert.equal(store.rows.has(slot.recordId), false);
      assert.equal(vault.recording('2099-01-01').figures.length, 0);
    });
  });

  // A model built in memory, record by record, as a load indexes it.
  function model() {
    const vault = new Vault(null);
    vault.profile = { mainCurrency: 'CHF', dimensions: [] };
    let n = 0;
    const holding = (name, unit) => {
      vault._index({ recordId: name, recordType: 'account', version: 1, payload: { name, unit, dims: {}, note: null, archivedAt: null, createdAt: '2026-01-01T00:00:00Z' } });
    };
    const snap = (id, date, value) => vault._index({ recordId: `s${(n += 1)}`, recordType: 'snapshot', accountId: id, version: 1, payload: { date, value, note: null } });
    const rate = (date, value) => vault._index({ recordId: `r${(n += 1)}`, recordType: 'rate', version: 1, payload: { symbol: 'USD', date, rate: value, rateTarget: 'CHF', rateSource: 'manual', rateAsOf: null, proposedRate: null } });
    holding('Cash', 'CHF');
    holding('Dollars', 'USD');
    holding('Later', 'CHF');
    snap('Cash', '2026-09-01', '100');
    snap('Cash', '2099-01-01', '999999');
    snap('Cash', '2026-02-30', '5555');
    snap('Cash', 'garbage', '7777');
    snap('Dollars', '2026-09-01', '10');
    snap('Later', '2026-10-01', '3');
    rate('2026-09-01', '0.9');
    rate('2099-01-01', '100');
    rate('2026-02-30', '50');
    vault._sortSeries();
    return vault;
  }

  await check('record-snapshot 99: a misdated figure or price counts toward no figure, age or chart range', async () => {
    const decimal = await load('decimal.js');
    await at('2026-09-30T12:00:00Z', 'UTC', () => {
      const vault = model();
      const holding = (id) => vault.holdings.get(id);
      assert.deepEqual(vault.usableSnapshots('Cash').map((s) => s.payload.date), ['2026-09-01']);
      assert.deepEqual(vault.usableSnapshots('Later').map((s) => s.payload.date), []);
      assert.deepEqual(vault.usableEntries('USD').map((e) => e.payload.date), ['2026-09-01']);
      assert.equal(vault.valueOf(holding('Cash')).asOf, '2026-09-01', 'the age');
      assert.equal(vault.valueOf(holding('Later')).state, 'unvalued');
      assert.equal(vault.latestPrice('USD').date, '2026-09-01', 'the latest price');
      assert.equal(vault.newestRateDate(), '2026-09-01', "the vault's one rate date");
      assert.equal(decimal.format(vault.totals().net), '109', 'the total');
      assert.deepEqual(vault.quantityDates(), ['2026-09-01']);
      assert.deepEqual(vault.recordingDates(), ['2026-09-01']);
      // The chart ends today, never at a misdated record after it.
      assert.equal(vault.chartLastDate(), '2026-09-30', "the chart's last day");
      const first = dayNumber('2026-09-01');
      const last = dayNumber('2026-09-30');
      assert.deepEqual(vault.chartRange(null), { fromDay: first, lastDay: last });
      const { bands } = vault.series(null, first, last);
      for (const at of [0, -1]) {
        assert.equal(decimal.format(bands.reduce((sum, band) => sum + band.points.at(at), 0n)), '109');
      }
    });
  });

  await check('record-snapshot 99: a misdated recording still holds its records and opens at its date', async () => {
    await at('2026-09-30T12:00:00Z', 'UTC', () => {
      const vault = model();
      const today = dom.today();
      for (const date of ['2099-01-01', '2026-02-30', 'garbage', '2026-10-01']) {
        assert.ok(vault.holdsRecording(date), date);
        assert.ok(route(`#/recording/${date}`, today, (d) => vault.holdsRecording(d)), date);
        assert.equal(route(`#/sweep/${date}`, today, (d) => vault.holdsRecording(d)), null, date);
      }
      assert.equal(vault.recording('2099-01-01').figures.length, 1);
      assert.equal(vault.recording('2099-01-01').prices.length, 1);
    });
  });

  // Instants at which the device's calendar day and UTC's differ.
  const AHEAD = [
    ['2026-09-30T22:30:00Z', 'Europe/Zurich', '2026-10-01'],
    ['2026-09-30T13:00:00Z', 'Pacific/Auckland', '2026-10-01'],
    ['2026-09-30T23:30:00Z', 'Pacific/Kiritimati', '2026-10-01'],
  ];
  const BEHIND = [
    ['2026-10-01T03:00:00Z', 'America/Los_Angeles', '2026-09-30'],
    ['2026-10-01T09:00:00Z', 'Pacific/Pago_Pago', '2026-09-30'],
  ];

  await check("record-snapshot 100: today is the device's calendar day in any time zone", async () => {
    for (const [instant, zone, local] of [...AHEAD, ...BEHIND]) {
      await at(instant, zone, () => {
        assert.equal(dom.today(), local, zone);
        assert.equal(dom.ageInWords(local), 'today', zone);
      });
    }
  });

  await check("record-snapshot 100: the device's today is written and the day after it refused, in any time zone", async () => {
    for (const [instant, zone, local] of [...AHEAD, ...BEHIND]) {
      await at(instant, zone, async () => {
        const store = server();
        const vault = await storedVault(store, [['Cash', 'CHF']]);
        const allowed = await attempt(store, vault, () => writes.saveSnapshot(vault, vault.ids.Cash, null, figure(local)));
        assert.ok(!allowed.outcome.error && allowed.sent === 1, `${zone} ${local}`);
        const next = new RealDate(`${local}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        const tomorrow = next.toISOString().slice(0, 10);
        const refused = await attempt(store, vault, () => writes.saveSnapshot(vault, vault.ids.Cash, null, figure(tomorrow)));
        assert.equal(refused.sent + refused.encrypted, 0, `${zone} ${tomorrow}`);
      });
    }
  });

  await check("record-snapshot 100: a figure at the device's today counts, in a zone ahead of UTC", async () => {
    await at('2026-09-30T22:30:00Z', 'Europe/Zurich', () => {
      const vault = model();
      assert.deepEqual(vault.usableSnapshots('Later').map((s) => s.payload.date), ['2026-10-01']);
      assert.equal(vault.valueOf(vault.holdings.get('Later')).asOf, '2026-10-01');
    });
  });

  await check("rate-lookup: a device already on the next UTC day asks for the server's UTC today, and the prices land on its own date", async () => {
    for (const [instant, zone, local] of AHEAD) {
      await at(instant, zone, async () => {
        const utc = instant.slice(0, 10);
        const store = server({ USD: { rate: '0.93', asOf: utc } });
        const vault = await storedVault(store, [['Cash', 'CHF'], ['Dollars', 'USD']]);
        await writes.saveSnapshot(vault, vault.ids.Cash, null, figure(local));
        const proposals = await writes.fetchProposals(vault, local);
        const asked = store.log.filter((r) => r.path === '/api/rates').map((r) => r.query.date);
        assert.deepEqual(asked, [utc], zone);
        await writes.refreshPrices(vault, local, proposals);
        assert.deepEqual(vault.recording(local).prices.map((e) => e.payload.symbol), ['USD'], zone);
      });
    }
  });

  await check('rate-lookup: any other date is asked for as it is', async () => {
    for (const [instant, zone, local] of [['2026-09-30T12:00:00Z', 'UTC', '2026-09-30'], ...BEHIND]) {
      await at(instant, zone, async () => {
        const store = server({});
        const vault = await storedVault(store, [['Cash', 'CHF'], ['Dollars', 'USD']]);
        for (const date of [local, '2026-09-01']) await writes.fetchProposals(vault, date);
        const asked = store.log.filter((r) => r.path === '/api/rates').map((r) => r.query.date);
        assert.deepEqual(asked, [local, '2026-09-01'], zone);
      });
    }
  });
}

if (!results.length) results.push(['FAIL', `no checks in group ${group}`]);
for (const [status, name] of results) console.log(`${status} ${name}`);
process.exitCode = results.some(([status]) => status === 'FAIL') ? 1 : 0;
