// Everything that writes to the vault, and the order it writes in
// (spec/features/record-rate.md, The write path and Saving an edited
// recording).
//
// No transaction spans two records, so the order is the whole of the
// guarantee: the quantity the person went and looked up goes first,
// prices after it, and deletions last, so a save that fails partway
// has destroyed nothing.
import * as api from './api.js';
import * as crypto from './crypto.js';
import { SCHEMA_VERSION } from './model.js';

export async function putRecord(vault, slot, payload) {
  const blob = await crypto.encryptRecord(vault.dek, slot);
  await api.put(`/api/records/${slot.recordId}`, {
    recordType: slot.recordType,
    accountId: slot.accountId ?? null,
    schemaVersion: slot.schemaVersion,
    version: slot.version,
    ...blob,
  });
  const entry = { ...slot, ...blob, payload };
  applyWrite(vault, entry);
  return entry;
}

export async function deleteRecord(vault, entry) {
  try {
    await api.del(`/api/records/${entry.recordId}`);
  } catch (error) {
    // Gone is what was asked for, and another session having got
    // there first is not a failure the person can act on.
    if (error.status !== 404) throw error;
  }
  applyDelete(vault, entry);
}

function applyWrite(vault, entry) {
  if (entry.recordType === 'profile') {
    vault.profileRecord = entry;
    vault.profile = entry.payload;
    return;
  }
  if (entry.recordType === 'account') {
    vault.holdings.set(entry.recordId, entry);
    return;
  }
  const map = entry.recordType === 'snapshot' ? vault.snapshots : vault.rates;
  const key = entry.recordType === 'snapshot' ? entry.accountId : entry.payload.symbol;
  const list = map.get(key) || [];
  const at = list.findIndex((row) => row.recordId === entry.recordId);
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  list.sort((a, b) => (a.payload.date < b.payload.date ? -1 : 1));
  map.set(key, list);
}

function applyDelete(vault, entry) {
  if (entry.recordType === 'account') {
    vault.holdings.delete(entry.recordId);
    vault.snapshots.delete(entry.recordId);
    return;
  }
  const map = entry.recordType === 'snapshot' ? vault.snapshots : vault.rates;
  for (const [key, list] of map) {
    const at = list.findIndex((row) => row.recordId === entry.recordId);
    if (at >= 0) {
      list.splice(at, 1);
      if (!list.length) map.delete(key);
      return;
    }
  }
}

export function saveProfile(vault, payload) {
  const record = vault.profileRecord;
  return putRecord(
    vault,
    {
      recordId: record.recordId,
      recordType: 'profile',
      accountId: null,
      schemaVersion: SCHEMA_VERSION,
      version: record.version + 1,
    },
    payload,
  );
}

export function saveHolding(vault, existing, payload) {
  return putRecord(
    vault,
    {
      recordId: existing ? existing.recordId : crypto.uuid4(),
      recordType: 'account',
      accountId: null,
      schemaVersion: SCHEMA_VERSION,
      version: existing ? existing.version + 1 : 1,
    },
    payload,
  );
}

export function saveSnapshot(vault, accountId, existing, payload) {
  return putRecord(
    vault,
    {
      recordId: existing ? existing.recordId : crypto.uuid4(),
      recordType: 'snapshot',
      accountId,
      schemaVersion: SCHEMA_VERSION,
      version: existing ? existing.version + 1 : 1,
    },
    payload,
  );
}

export function saveRate(vault, existing, payload) {
  return putRecord(
    vault,
    {
      recordId: existing ? existing.recordId : crypto.uuid4(),
      recordType: 'rate',
      accountId: null,
      schemaVersion: SCHEMA_VERSION,
      version: existing ? existing.version + 1 : 1,
    },
    payload,
  );
}

/** The whole quotable table for one date, in one request.
 *
 *  The client never names a symbol: recording anything refreshes every
 *  price, so a per-symbol fan-out would hand the proxy a complete,
 *  repeating list of what this person holds, on the schedule they do
 *  their books (rate-lookup.md, The client never names a symbol). */
export async function fetchProposals(vault, date) {
  try {
    const answer = await api.getRates({ date, quote: vault.mainCurrency });
    return answer ? answer.rates : {};
  } catch {
    return {};
  }
}

/** The pre-create reload (record-snapshot.md, Creating and reopening
 *  are distinct acts).
 *
 *  Once per sitting, before the first record it creates at a date, and
 *  never against the model in memory: a session open since this
 *  morning is exactly the session whose model says the date is free.
 *  It returns the freshly loaded types, so the caller can refuse the
 *  whole save rather than claiming a slot somebody else took. */
export async function reloadCreateTypes(vault) {
  const fresh = { snapshot: await api.get('/api/records?type=snapshot'), rate: await api.get('/api/records?type=rate') };
  const decoded = { snapshot: [], rate: [] };
  for (const type of ['snapshot', 'rate']) {
    for (const record of fresh[type]) {
      try {
        decoded[type].push({
          ...record,
          payload: await crypto.decryptRecord(vault.dek, record),
        });
      } catch {
        // An unreadable record carries no readable date, so it shapes
        // no slot check. It is already counted in the load's warning.
      }
    }
  }
  return decoded;
}

export function occupiedSlots(reloaded) {
  const snapshots = new Set(
    reloaded.snapshot.map((r) => `${r.accountId}\u001f${r.payload.date}`),
  );
  const rates = new Set(
    reloaded.rate.map((r) => `${r.payload.symbol}\u001f${r.payload.date}`),
  );
  return { snapshots, rates };
}

/** Ensure the recording date's prices: write where the date has no
 *  entry for a symbol and leave every entry that is there alone, so
 *  running it twice at one date is a no-op the second time.
 *
 *  Issued after the quantity, on its own requests, so a price write
 *  can never fail a quantity write. What did not land is returned and
 *  named rather than swallowed. */
export async function refreshPrices(vault, date, proposals) {
  const written = [];
  const failed = [];
  for (const unit of vault.unitsToRefresh()) {
    const already = vault
      .entriesFor(unit)
      .some((entry) => entry.payload.date === date);
    if (already) continue;
    const proposal = proposals[unit];
    // No proposal and a previous entry: nothing is written, the
    // previous entry stays the symbol's latest. Degraded, not wrong.
    if (!proposal) continue;
    try {
      written.push(
        await saveRate(vault, null, {
          symbol: unit,
          date,
          rate: proposal.rate,
          rateTarget: vault.mainCurrency,
          rateSource: 'proposed',
          rateAsOf: proposal.asOf,
          proposedRate: null,
        }),
      );
    } catch {
      failed.push(unit);
    }
  }
  return { written, failed };
}

/** Editing a captured rate by hand moves `proposed` to `edited` and
 *  captures the replaced figure, once. Editing an `edited` one a
 *  second time leaves it alone: the provider's number did not change,
 *  only the person's did. */
export function editedRatePayload(stored, rate) {
  if (!stored) return null;
  if (stored.rateSource === 'proposed') {
    return { ...stored, rate, rateSource: 'edited', proposedRate: stored.rate };
  }
  return { ...stored, rate };
}

/** One save of a reopened recording, in the fixed order: the
 *  pre-create reload if anything is being created, then quantities,
 *  then rates, then deletions.
 *
 *  No step is skipped because an earlier one failed. Each record is
 *  independent, and abandoning the rest would turn one failed write
 *  into several unattempted ones. */
export async function saveRecording(vault, date, plan) {
  const creating =
    plan.quantities.some((q) => !q.existing) || plan.rates.some((r) => !r.existing);

  if (creating) {
    const taken = occupiedSlots(await reloadCreateTypes(vault));
    const clash =
      plan.quantities.some(
        (q) => !q.existing && taken.snapshots.has(`${q.accountId}\u001f${date}`),
      ) ||
      plan.rates.some(
        (r) => !r.existing && taken.rates.has(`${r.payload.symbol}\u001f${date}`),
      );
    if (clash) {
      // Refused whole, before a single write. The person is looking at
      // a screen that no longer describes the vault.
      return { refused: true, date, saved: [], failed: [] };
    }
  }

  const saved = [];
  const failed = [];

  for (const change of plan.quantities) {
    try {
      await saveSnapshot(vault, change.accountId, change.existing, change.payload);
      saved.push({ kind: 'quantity', name: change.name });
    } catch (error) {
      failed.push({ kind: 'quantity', name: change.name, status: error.status });
    }
  }
  for (const change of plan.rates) {
    try {
      await saveRate(vault, change.existing, change.payload);
      saved.push({ kind: 'rate', name: change.payload.symbol });
    } catch (error) {
      failed.push({ kind: 'rate', name: change.payload.symbol, status: error.status });
    }
  }
  // Deletions last, so a save that fails partway has destroyed
  // nothing and the person still holds everything the screen offered
  // to remove. Quantities before rates, so a run that stops partway
  // leaves the date priced rather than leaving quantities nothing can
  // value.
  const ordered = [...plan.deletes].sort(
    (a, b) => (a.recordType === 'snapshot' ? 0 : 1) - (b.recordType === 'snapshot' ? 0 : 1),
  );
  for (const entry of ordered) {
    try {
      await deleteRecord(vault, entry);
      saved.push({ kind: 'deleted', name: entry.recordType });
    } catch {
      failed.push({ kind: 'deleted', name: entry.recordType });
    }
  }
  return { refused: false, saved, failed };
}

/** Every record bearing one date, quantities first and rates after.
 *  A partial delete leaves a recording, not a broken one: nothing is
 *  rolled back and nothing marks the date as half deleted. */
export async function deleteRecording(vault, date) {
  const { figures, prices } = vault.recording(date);
  const remaining = [];
  for (const entry of [...figures.map((f) => f.snapshot), ...prices]) {
    try {
      await deleteRecord(vault, entry);
    } catch {
      remaining.push(entry);
    }
  }
  return remaining;
}

export async function purgeHolding(vault, holding) {
  await api.del(`/api/accounts/${holding.recordId}?mode=purge`);
  applyDelete(vault, holding);
}
