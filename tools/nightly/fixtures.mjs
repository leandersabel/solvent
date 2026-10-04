// Writes the prepared data through the app's own browser code
// (spec/features/nightly-harness.md, fixtures.mjs).
//
//   node tools/nightly/fixtures.mjs --base <url> --invite <path> --plan <plan> --out <dir>
//
// CHROME names the browser. Reads <dir>/script.json and
// <dir>/expected.json, which prices.py prepare wrote, and writes the
// manifest, each current backup, patches.json and storage-state.json
// into <dir>.
//
// Every record is written by the served modules (session.js, writes.js,
// crypto.js, api.js) in a page of the app. The two exceptions, the
// damaged record and the pair, are planted the way
// tests/browser/harness.mjs plants records, because the client's own
// rules would never write them. Nothing here encrypts a record itself.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { launch, Session } from '../../tests/browser/cdp.mjs';

const GENERATED = 'tools/nightly/fixtures/out';
const COMMITTED = 'tools/nightly/fixtures';
const REGISTRATION_MS = 180000;

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      base: { type: 'string' },
      invite: { type: 'string' },
      plan: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  }));
  for (const name of ['base', 'invite', 'plan', 'out']) if (!args[name]) throw new Error(`--${name} is required`);
  if (!args.invite.startsWith('/register?invite=')) throw new Error('--invite is the path the CLI prints, /register?invite=<token>');
} catch (error) {
  console.error(`usage: node fixtures.mjs --base <url> --invite <path> --plan <plan> --out <dir>\n${error.message}`);
  process.exit(2);
}

const base = args.base.replace(/\/$/, '');
const script = JSON.parse(readFileSync(join(args.out, 'script.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(args.out, 'expected.json'), 'utf8'));
const plan = JSON.parse(readFileSync(args.plan, 'utf8'));
// The script is only good for the plan it was prepared from.
if (JSON.stringify(plan.accounts.map((a) => a.username)) !== JSON.stringify(script.accounts.map((a) => a.username))) {
  console.error('script.json was not prepared from this plan');
  process.exit(2);
}
const invitePath = args.invite;

const browsers = [];
// Every request to the rate proxy any page sends. There must be none: the
// proposals come from the script, so the generator spends no part of any
// limit. The symbol table the vault loads is another endpoint.
const lookups = [];

async function openBrowser() {
  const opened = await launch();
  browsers.push(opened.child);
  const session = await Session.connect(opened.target);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Network.enable');
  await session.track();
  session.on((message) => {
    if (message.method === 'Network.requestWillBeSent' && /\/api\/rates\?/.test(message.params.request.url)) {
      lookups.push(message.params.request.url);
    }
  });
  return { session, close: () => opened.child.kill() };
}

// The registration form, filled and submitted as a person does.
async function register(session, path, account) {
  await session.goto(`${base}${path}`);
  const refused = await session.eval("Boolean(document.querySelector('.error, .callout-critical')) && !document.querySelector('input[type=password]')");
  if (refused) throw new Error(`the invite for ${account.username} was refused`);
  await session.call((name, secret, money) => {
    const set = (selector, value, index = 0) => {
      const node = document.querySelectorAll(selector)[index];
      node.value = value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('input[type=text]', name);
    set('input[type=password]', secret, 0);
    set('input[type=password]', secret, 1);
    if (document.querySelector('select')) set('select', money);
    const box = document.querySelector('input[type=checkbox]');
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, account.username, account.password, account.mainCurrency);
  await session.waitUntil("!document.querySelector('button[type=submit]').disabled", { label: 'the registration button' });
  await session.eval("document.querySelector('button[type=submit]').click()");
  if (account.kind === 'administrator') {
    await session.waitUntil("location.pathname === '/admin' && document.querySelector('#app .section-switcher')", {
      timeout: REGISTRATION_MS,
      label: `the admin area of ${account.username}`,
    });
    return;
  }
  await session.waitUntil(async () => {
    const s = await import('/static/js/session.js');
    return location.pathname === '/dashboard' && s.currentVault() !== null && !document.querySelector('#unlock-password');
  }, { timeout: REGISTRATION_MS, label: `the new vault of ${account.username}` });
}

// One write, through the served modules. Self-contained, because the
// browser receives its source and its argument and nothing else.
async function inPage(op) {
  const s = await import('/static/js/session.js');
  const c = await import('/static/js/crypto.js');
  const api = await import('/static/js/api.js');
  const decimal = await import('/static/js/decimal.js');
  const writes = await import('/static/js/writes.js');
  const { SCHEMA_VERSION } = await import('/static/js/model.js');
  const v = s.currentVault();
  const holding = (name) => [...v.holdings.values()].find((h) => h.payload.name === name);

  // A record the client's rules would never write: encrypted under the
  // AAD of `aadId`, and stored under `id`.
  const plant = async (type, accountId, id, aadId, payload) => {
    const slot = { recordId: aadId, recordType: type, accountId, schemaVersion: SCHEMA_VERSION, version: 1 };
    const blob = await c.encryptRecord(v.dek, slot, payload);
    await api.put(`/api/records/${id}`, { recordType: type, accountId, schemaVersion: SCHEMA_VERSION, version: 1, ...blob });
  };

  if (op.op === 'profile') {
    await writes.saveProfile(v, { ...v.profile, ...op.patch });
  } else if (op.op === 'holding') {
    await writes.saveHolding(v, null, {
      name: op.name, unit: op.unit, dims: op.dims, note: op.note ?? null, archivedAt: null, createdAt: op.createdAt,
    });
  } else if (op.op === 'recording') {
    for (const [name, value] of Object.entries(op.figures)) {
      await writes.saveSnapshot(v, holding(name).recordId, null, { date: op.date, value, note: null });
    }
    const choose = (unit) => {
      const proposal = op.proposals[unit];
      if (proposal) return writes.ratePart({ figure: decimal.parse(proposal.rate), proposal });
      if (op.manual[unit]) return writes.ratePart({ figure: decimal.parse(op.manual[unit]) });
      return null;
    };
    const { failed } = await writes.refreshPrices(v, op.date, op.proposals, choose);
    if (failed.length) throw new Error(`prices did not land at ${op.date}: ${failed.join(', ')}`);
  } else if (op.op === 'editRate') {
    const entry = v.entriesFor(op.unit).find((e) => e.payload.date === op.date);
    await writes.saveRate(v, entry, writes.editedRatePayload(entry.payload, op.rate));
  } else if (op.op === 'archive') {
    const { status, unpriced } = await writes.archiveHolding(v, holding(op.name), op.date);
    if (status !== 'archived' || unpriced.length) throw new Error(`archiving ${op.name}: ${status}`);
  } else if (op.op === 'clear') {
    // The figures go and the date's rates stay, as clearing every figure
    // on Recording detail leaves them.
    for (const { snapshot } of v.recording(op.date).figures) await writes.deleteRecord(v, snapshot);
  } else if (op.op === 'deleteRecording') {
    const remaining = await writes.deleteRecording(v, op.date);
    if (remaining.length) throw new Error(`deleting the recording at ${op.date} left ${remaining.length} records`);
  } else if (op.op === 'pair') {
    const id = holding(op.name).recordId;
    for (const value of op.values) {
      const record = c.uuid4();
      await plant('snapshot', id, record, record, { date: op.date, value, note: null });
    }
  } else if (op.op === 'damaged') {
    await plant('snapshot', holding(op.name).recordId, c.uuid4(), c.uuid4(), { date: op.date, value: op.value, note: null });
  } else {
    throw new Error(`unknown op ${op.op}`);
  }
}

// An account at a KDF envelope below the server default: rotated
// through the upgrade endpoint with its salt, Auth Key and wrapper all
// made at the weak memory parameter, as harness.mjs makeStale does.
// patch.py then records that parameter.
const makeOlder = (session, password, memory) =>
  session.call(async (secret, m) => {
    const api = await import('/static/js/api.js');
    const c = await import('/static/js/crypto.js');
    const s = await import('/static/js/session.js');
    const kdf = JSON.parse(document.getElementById('kdf-envelope').textContent);
    const salt = c.b64encode(c.randomBytes(16));
    const keys = await c.deriveKeys(secret, salt, { ...kdf, m });
    const body = { salt, kdf, authKey: keys.authKey };
    const vault = s.currentVault();
    if (vault) Object.assign(body, await c.wrapDek(vault.dek, keys.masterKey));
    await api.post('/api/auth/upgrade-kdf', body);
  }, password, memory);

const exportBody = (session) =>
  session.call(async () => {
    const api = await import('/static/js/api.js');
    return (await api.downloadExport()).blob.text();
  });

async function run() {
  const manifest = {
    app: base,
    today: script.today,
    accounts: [],
    invites: [],
    browserSession: null,
    backups: [],
    expected,
  };
  let storage = { cookies: [], origins: [] };
  const tokens = new Map();

  const [admin, ...owners] = script.accounts;
  if (admin?.kind !== 'administrator') throw new Error('the plan opens with no administrator');
  const first = await openBrowser();
  try {
    await register(first.session, invitePath, admin);
    const mint = (kind, label) =>
      first.session.call(async (k, name) => {
        const api = await import('/static/js/api.js');
        return (await api.post('/api/admin/invites', { kind: k, label: name, expiresInDays: 7 })).token;
      }, kind, label);
    for (const account of owners) tokens.set(account.username, await mint('vault_owner', account.username));
    for (const invite of script.invites) {
      manifest.invites.push({ path: `/register?invite=${await mint(invite.kind, invite.label)}`, covers: invite.covers });
    }
  } finally {
    first.close();
  }
  manifest.accounts.push(summary(admin));

  for (const account of owners) {
    const { session, close } = await openBrowser();
    try {
      await register(session, `/register?invite=${tokens.get(account.username)}`, account);
      if (account.agedSession) {
        const { cookies } = await session.send('Network.getCookies', { urls: [base] });
        storage = {
          cookies: cookies.map(({ name, value, domain, path, expires, httpOnly, secure, sameSite }) => (
            { name, value, domain, path, expires, httpOnly, secure, sameSite }
          )),
          origins: [],
        };
        manifest.browserSession = { username: account.username, covers: ['aged-session'], about: account.about };
      }
      for (const op of account.ops) await session.call(inPage, op);
      if (account.olderVault) await makeOlder(session, account.password, script.patches.credentials.find((c) => c.username === account.username).kdfMemory);
      if (account.backup) {
        const text = await exportBody(session);
        writeFileSync(join(args.out, `backup-${account.username}.json`), text);
        manifest.backups.push({
          file: `${GENERATED}/backup-${account.username}.json`,
          password: account.password,
          formatVersion: JSON.parse(text).formatVersion,
          covers: ['current-backup'],
        });
      }
    } finally {
      close();
    }
    manifest.accounts.push(summary(account));
  }

  for (const backup of script.backups) {
    manifest.backups.push({
      file: `${COMMITTED}/${backup.file}`,
      password: backup.password,
      formatVersion: backup.formatVersion,
      covers: backup.covers,
    });
  }

  if (lookups.length) throw new Error(`the generator asked the rate proxy ${lookups.length} times`);
  const covered = new Set([
    ...manifest.accounts.flatMap((a) => a.covers),
    ...manifest.invites.flatMap((i) => i.covers),
    ...(manifest.browserSession?.covers ?? []),
    ...manifest.backups.flatMap((b) => b.covers),
  ]);
  const missing = script.coverage.filter((name) => !covered.has(name));
  if (missing.length) throw new Error(`the manifest covers nothing for: ${missing.join(', ')}`);

  writeFileSync(join(args.out, 'patches.json'), JSON.stringify(script.patches, null, 1));
  writeFileSync(join(args.out, 'storage-state.json'), JSON.stringify(storage, null, 1));
  writeFileSync(join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 1));
}

const summary = ({ username, password, kind, mainCurrency, covers, about }) => ({ username, password, kind, mainCurrency, covers, about });

try {
  await run();
  process.exitCode = 0;
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  for (const child of browsers) child.kill();
}
