// Opening an export file and re-keying what it holds
// (spec/features/export-import.md, The re-key step).
//
// Free of the page, so the import screen's Worker and the tests run the
// one implementation rather than each keeping a copy of it.
import * as crypto from './crypto.js';
import { RECORD_TYPES, SCHEMA_VERSION, migrate } from './model.js';

const FORMAT = 'solvent-vault';
export const FORMAT_VERSION = 1;

// Refused by size before the file is read at all. The server's own cap
// is on the ciphertext it stores, and a file carries that ciphertext
// base64 encoded inside JSON, so this sits above it rather than on it.
export const MAX_FILE_BYTES = 48 * 1024 * 1024;
const MAX_RECORDS = 50_000;

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class FileRefused extends Error {
  /** `reason` is 'format' for anything that is not a vault file this
   *  build reads, 'newer' for a file from a later version, and
   *  'noProfile' for a file that would restore a vault with no main
   *  currency. */
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export class WrongPassword extends Error {}

export class RecordUnreadable extends Error {
  constructor(recordId) {
    super(`record ${recordId} does not decrypt`);
    this.recordId = recordId;
  }
}

function isBase64(value, bytes = null) {
  if (typeof value !== 'string' || !value || !BASE64.test(value)) return false;
  if (bytes === null) return true;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding === bytes;
}

const positive = (value) => Number.isInteger(value) && value >= 1;

/** The same rules the server applies to the upload, applied to the file
 *  before anything is decrypted, so a bad file fails fast without a
 *  large upload (export-import.md, Rules). Throws FileRefused. */
export function checkFile(body) {
  if (!body || typeof body !== 'object' || body.format !== FORMAT) {
    throw new FileRefused('format');
  }
  if (!Number.isInteger(body.formatVersion) || body.formatVersion < 1) {
    throw new FileRefused('format');
  }
  // A newer file in an older app is not something to guess at.
  if (body.formatVersion > FORMAT_VERSION) throw new FileRefused('newer');

  const shaped =
    isBase64(body.salt) &&
    isBase64(body.wrappedDek) &&
    isBase64(body.dekNonce, 12) &&
    body.kdf &&
    typeof body.kdf === 'object' &&
    Array.isArray(body.records) &&
    body.records.length <= MAX_RECORDS;
  if (!shaped) throw new FileRefused('format');

  const accounts = new Set(
    body.records.filter((r) => r && r.recordType === 'account').map((r) => r.recordId),
  );
  const seen = new Set();
  for (const record of body.records) {
    const fine =
      record &&
      typeof record === 'object' &&
      typeof record.recordId === 'string' &&
      UUID4.test(record.recordId) &&
      !seen.has(record.recordId) &&
      RECORD_TYPES.includes(record.recordType) &&
      positive(record.schemaVersion) &&
      positive(record.version) &&
      isBase64(record.nonce, 12) &&
      isBase64(record.ciphertext) &&
      // Present exactly for a snapshot, and naming an account in the
      // same file. Absence has one spelling, and it is null.
      (record.recordType === 'snapshot'
        ? accounts.has(record.accountId)
        : record.accountId === null);
    if (!fine) throw new FileRefused('format');
    seen.add(record.recordId);
  }
  // The profile holds the main currency every price is denominated in,
  // so a file without one would restore a vault nothing can value.
  if (!body.records.some((r) => r.recordType === 'profile')) throw new FileRefused('noProfile');
  return body;
}

/** How many of each kind the records hold. */
export function countKinds(records) {
  const counts = { profile: 0, account: 0, snapshot: 0, rate: 0 };
  for (const record of records) counts[record.recordType] += 1;
  return counts;
}

async function decryptOne(dek, record) {
  // A schema version above what this client knows is unreadable rather
  // than guessed at, as it is on an ordinary read.
  if (record.schemaVersion > SCHEMA_VERSION) throw new RecordUnreadable(record.recordId);
  try {
    return migrate(record.recordType, record.schemaVersion, await crypto.decryptRecord(dek, record));
  } catch {
    throw new RecordUnreadable(record.recordId);
  }
}

/** Derive the file's own Master Key from the password it was exported
 *  under, unwrap its DEK, and decrypt the profile alone: all the review
 *  needs, and a wrong password is caught before any other record is
 *  touched and before any request is sent. */
export async function openFile(body, password) {
  const keys = await crypto.deriveKeys(password, body.salt, body.kdf);
  let fileDek;
  try {
    fileDek = await crypto.unwrapDek(body.wrappedDek, body.dekNonce, keys.masterKey);
  } catch {
    throw new WrongPassword('that password does not open this file');
  }
  const record = body.records.find((r) => r.recordType === 'profile');
  const profile = record ? await decryptOne(fileDek, record) : null;
  return { fileDek, profile };
}

/** Every record decrypted under the file's DEK and its own AAD, and
 *  migrated to the current shape by the same chain an ordinary read
 *  uses. The first failure aborts the whole import, naming the record:
 *  a partial restore is worse than none. */
export async function decryptAll(fileDek, records, onProgress = () => {}) {
  const plain = [];
  for (const [index, record] of records.entries()) {
    plain.push({ record, payload: await decryptOne(fileDek, record) });
    onProgress(index + 1, records.length);
  }
  return plain;
}

/** Each record encrypted under `dek` with a fresh nonce, at version 1,
 *  its AAD rebuilt for that version. */
async function reencryptAll(plain, dek, onProgress = () => {}) {
  const records = [];
  for (const [index, { record, payload }] of plain.entries()) {
    const slot = {
      recordId: record.recordId,
      recordType: record.recordType,
      accountId: record.accountId ?? null,
      schemaVersion: SCHEMA_VERSION,
      version: 1,
    };
    records.push({ ...slot, ...(await crypto.encryptRecord(dek, slot, payload)) });
    onProgress(index + 1, plain.length);
  }
  return records;
}

/** The whole re-key: a freshly generated DEK rather than the file's, so
 *  the two vaults share no key material and the exporter's later
 *  records cannot be injected into this one. */
export async function rekey(fileDek, records, onProgress = () => {}) {
  const plain = await decryptAll(fileDek, records, (done, total) =>
    onProgress('decrypt', done, total),
  );
  const dek = await crypto.generateDek();
  const rekeyed = await reencryptAll(plain, dek, (done, total) =>
    onProgress('encrypt', done, total),
  );
  return { dek, records: rekeyed };
}
