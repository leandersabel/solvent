// Everything that writes to the vault, and the order it writes in
// (spec/features/record-rate.md, The write path and Saving at a date
// that holds a recording).
//
// No transaction spans two records, so the order is the whole of the
// guarantee: the quantity the person went and looked up goes before
// the prices it brings, and a save's deletions go last, so a save that
// fails partway has destroyed nothing.
import * as api from './api.js';
import * as crypto from './crypto.js';
import * as decimal from './decimal.js';
import { today } from './dom.js';
import { SCHEMA_VERSION, isRecordedDay, migrate } from './model.js';

export async function putRecord(vault, slot, payload) {
  // A figure or a price at a date that is no recorded day is refused
  // before anything is encrypted or sent (record-snapshot.md, A
  // recording is a date).
  if ((slot.recordType === 'snapshot' || slot.recordType === 'rate') && !isRecordedDay(payload.date, today())) {
    throw new Error(`${payload.date} is not a day that has passed.`);
  }
  const blob = await crypto.encryptRecord(vault.dek, slot, payload);
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

function slotFor(recordType, accountId, existing) {
  return {
    recordId: existing ? existing.recordId : crypto.uuid4(),
    recordType,
    accountId,
    schemaVersion: SCHEMA_VERSION,
    version: existing ? existing.version + 1 : 1,
  };
}

export function saveHolding(vault, existing, payload) {
  return putRecord(vault, slotFor('account', null, existing), payload);
}

export function saveSnapshot(vault, accountId, existing, payload) {
  return putRecord(vault, slotFor('snapshot', accountId, existing), payload);
}

export function saveRate(vault, existing, payload) {
  return putRecord(vault, slotFor('rate', null, existing), payload);
}

/** The whole quotable table for one date, in one request.
 *
 *  The client never names a symbol: recording anything refreshes every
 *  price, so a per-symbol fan-out would hand the proxy a complete,
 *  repeating list of what this person holds, on the schedule they do
 *  their books (rate-lookup.md, The client never names a symbol). */
export async function fetchProposals(vault, date) {
  // The device's today can be the day after the server's, which the
  // proxy refuses as future. Its price for the server's today is the
  // same latest close.
  const serverToday = new Date().toISOString().slice(0, 10);
  try {
    const answer = await api.getRates({ date: date > serverToday ? serverToday : date, quote: vault.mainCurrency });
    return answer ? answer.rates : {};
  } catch {
    return {};
  }
}

/** Whether a recording at `date` would have anything to ask the proxy:
 *  a unit with no entry there that somebody publishes a price for at
 *  that date. */
export function needsLookup(vault, date, also = null) {
  return vault.missingUnits(date, also).some((unit) => vault.quotable(unit, date));
}

/** Decrypt a freshly read list of records the way the load does,
 *  skipping any that will not open or that a newer client wrote. An
 *  unreadable record carries no readable date, so it shapes no slot
 *  check, and it is already counted in the load's warning. */
async function decryptAll(vault, rows) {
  const decoded = [];
  for (const record of rows) {
    if (record.schemaVersion > SCHEMA_VERSION) continue;
    try {
      const payload = migrate(record.recordType, record.schemaVersion, await crypto.decryptRecord(vault.dek, record));
      decoded.push({ ...record, payload });
    } catch {
      /* counted by the load that first met it */
    }
  }
  return decoded;
}

/** The pre-create reload (record-snapshot.md, Creating and reopening
 *  are distinct acts).
 *
 *  Never against the model in memory: a session open since this
 *  morning is exactly the session whose model says the date is free. */
async function reloadCreateTypes(vault) {
  return {
    snapshot: await decryptAll(vault, await api.get('/api/records?type=snapshot')),
    rate: await decryptAll(vault, await api.get('/api/records?type=rate')),
  };
}

/** After a Conflict, the whole type again, since there is no by-id read
 *  (record-api.md, Endpoints). The model then holds what the vault
 *  holds, and nothing is retried. */
export async function reloadType(vault, type) {
  vault.replaceType(type, await decryptAll(vault, await api.get(`/api/records?type=${type}`)));
}

/** A sitting at one date: a row's create reloads before the first record
 *  it creates and never again, because after it the date belongs to this
 *  session against creates. A rate-lines save reloads on every save that
 *  creates, claimed or not (`claimDate`). `dateWasEmpty` is what the
 *  model said when the sitting began, which is what the claiming reload
 *  judges a create there against. */
export function sitting(vault, date) {
  return { date, dateWasEmpty: !vault.holdsRecording(date), claimed: false, refreshed: false, proposals: null };
}

/** Whether a holding was archived or deleted in another session, read
 *  afresh before every figure recorded for it, because a sitting can
 *  outlive an archive made elsewhere (manage-accounts.md, While
 *  archived). An archived holding takes no new figure, and a move
 *  `onto` a date only before its archive. Resolves to null, or to
 *  'archived' or 'deleted' after the model takes the vault as it now
 *  stands. */
async function holdingClosed(vault, id, onto) {
  vault.replaceType('account', await decryptAll(vault, await api.get('/api/records?type=account')));
  const fresh = vault.holdings.get(id);
  const archivedAt = fresh && fresh.payload.archivedAt;
  const closed = !fresh ? 'deleted' : archivedAt && (onto === null || onto >= archivedAt) ? 'archived' : null;
  if (!closed) return null;
  const recent = await reloadCreateTypes(vault);
  vault.replaceType('snapshot', recent.snapshot);
  vault.replaceType('rate', recent.rate);
  return closed;
}

/** Claim the date for a sitting about to create records at it, or say
 *  why it cannot. A claimed sitting reloads again only when `held`, and
 *  that reload judges the slots and nothing else: the sitting's own
 *  records are at the date, so finding it recorded refuses nothing.
 *  `snapshots` names the holdings and `rates` the units the write would
 *  create an entry for. `except` is the one record of those holdings the
 *  write may find there, the one it deletes.
 *
 *  A date another session recorded since the sitting began, or any slot
 *  already taken, refuses the whole save before a single write. The
 *  model then takes the reloaded records, so the screen can show the
 *  recording as it now stands. `held` refuses a date the reload finds
 *  holding no record, for a write that must not make the recording
 *  itself, and says `emptied` so the screen can tell it from a date
 *  another session recorded. Before any of that, every holding in
 *  `snapshots` is read afresh on every call, claimed or not, and one
 *  archived or deleted elsewhere refuses with `closed`
 *  (`holdingClosed`). `move` judges an archive against the new date of
 *  a move. */
export async function claimDate(vault, sit, { snapshots = [], rates = [], except = null, held = false, move = false }) {
  for (const id of snapshots) {
    const closed = await holdingClosed(vault, id, move ? sit.date : null);
    if (closed) return { refused: true, date: sit.date, closed };
  }
  if (sit.claimed && !held) return null;
  const fresh = await reloadCreateTypes(vault);
  const at = (list) => list.filter((record) => record.payload.date === sit.date);
  const emptied = held && at(fresh.snapshot).length === 0 && at(fresh.rate).length === 0;
  const taken =
    emptied ||
    (!sit.claimed && sit.dateWasEmpty && (at(fresh.snapshot).length > 0 || at(fresh.rate).length > 0)) ||
    at(fresh.snapshot).some((r) => snapshots.includes(r.accountId) && r.recordId !== except) ||
    at(fresh.rate).some((r) => rates.includes(r.payload.symbol));
  if (taken) {
    vault.replaceType('snapshot', fresh.snapshot);
    vault.replaceType('rate', fresh.rate);
    return emptied ? { refused: true, date: sit.date, emptied: true } : { refused: true, date: sit.date };
  }
  sit.claimed = true;
  return null;
}

/** What a rate line would write at a date with no entry for its unit,
 *  or null for nothing. A proposal left alone is written as proposed,
 *  a changed one as edited with the offer kept, and a figure typed
 *  where no proposal came as manual. A line still showing the figure
 *  carried from an earlier entry writes nothing, because an estimate
 *  does not get newer by being looked at (record-rate.md, The
 *  refresh). */
export function ratePart({ figure, proposal = null, carried = null }) {
  if (figure === null || figure === undefined) return null;
  if (proposal) {
    return decimal.parse(proposal.rate) === figure
      ? { rate: proposal.rate, rateSource: 'proposed', rateAsOf: proposal.asOf, proposedRate: null }
      : { rate: decimal.format(figure), rateSource: 'edited', rateAsOf: proposal.asOf, proposedRate: proposal.rate };
  }
  if (carried && decimal.parse(carried.payload.rate) === figure) return null;
  return { rate: decimal.format(figure), rateSource: 'manual', rateAsOf: null, proposedRate: null };
}

/** A new entry for one unit at one date, in the main currency as it
 *  stands now. */
export function rateEntry(vault, unit, date, part) {
  return { symbol: unit, date, ...part, rateTarget: vault.mainCurrency };
}

/** Ensure the recording date's prices: write where the date has no
 *  entry for a symbol and leave every entry that is there alone, so
 *  running it twice at one date is a no-op the second time.
 *
 *  `choose(unit)` says what to write for a unit, from what its rate
 *  line shows. Without it, the proposals are written as they came.
 *
 *  Issued after the quantity, on its own requests, so a price write
 *  can never fail a quantity write. What did not land is returned and
 *  named rather than swallowed. `also` is a moved entry's own unit. */
export async function refreshPrices(vault, date, proposals, choose = null, also = null) {
  const pick = choose || ((unit) => (proposals[unit] ? ratePart({ figure: decimal.parse(proposals[unit].rate), proposal: proposals[unit] }) : null));
  const written = [];
  const failed = [];
  for (const unit of vault.missingUnits(date, also)) {
    const part = pick(unit);
    // No proposal and nothing typed: nothing is written, and a previous
    // entry stays the symbol's latest. Degraded, not wrong.
    if (!part) continue;
    try {
      written.push(await saveRate(vault, null, rateEntry(vault, unit, date, part)));
    } catch {
      failed.push(unit);
    }
  }
  return { written, failed };
}

/** Saving an edited snapshot (record-snapshot.md, Editing an existing
 *  snapshot). Moved to another date it is recording the quantity there:
 *  the new date is claimed first, then the snapshot PUT, then the date's
 *  missing prices, then the DELETE of `displaced`, the holding's own
 *  record already at that date. The quantity gates the prices and the
 *  deletion goes last, so a move that fails partway has destroyed
 *  nothing, and a failed price skips nothing after it. Edited where it
 *  stands it claims nothing and prices nothing.
 *
 *  `sit` is the sitting that refreshes the new date, or null for a date
 *  whose prices are complete; the prices written are `proposals` as
 *  they came, or what `choose(unit)` says. Resolves to `claimDate`'s
 *  refusal before any write, else `{ moved, failed, undeleted }`: the
 *  saved entry, the units whose price did not land, and whether the
 *  displaced record stayed. */
export async function editSnapshot(vault, holding, existing, payload, { sit = null, displaced = null, proposals = {}, choose = null }) {
  const unit = holding.payload.unit;
  const on = payload.date;
  if (on !== existing.payload.date) {
    // The slot at the new date is one the move creates, unless it holds
    // the record the person agreed to delete: any other record of the
    // holding there refuses the move.
    const refusal = await claimDate(vault, sit || sitting(vault, on), {
      snapshots: [holding.recordId],
      except: displaced ? displaced.recordId : null,
      rates: sit ? vault.missingUnits(on, unit) : [],
      move: true,
    });
    if (refusal) return refusal;
  }
  const moved = await saveSnapshot(vault, holding.recordId, existing, payload);
  const { failed } = sit ? await refreshPrices(vault, on, proposals, choose, unit) : { failed: [] };
  let undeleted = false;
  if (displaced) {
    try {
      await deleteRecord(vault, displaced);
    } catch {
      undeleted = true;
    }
  }
  return { moved, failed, undeleted };
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

/** Confirming: the quantity the holding carried into `date`, recorded
 *  again at it. Refused for a holding with nothing to confirm, which is
 *  the request a screen that offers no Confirm would never send. */
export function confirmFigure(vault, holding, date) {
  const carried = [...vault.usableSnapshots(holding.recordId)]
    .reverse()
    .find((s) => s.payload.date < date);
  if (!carried) throw new Error('A holding with no figure before this date has nothing to confirm.');
  return saveSnapshot(vault, holding.recordId, null, { date, value: carried.payload.value, note: null });
}

/** The rate lines' own save on a reopened recording, in the fixed
 *  order: the pre-create reload if any line creates an entry, then the
 *  rate writes, then the deletions of the lines cleared. A quantity is
 *  never part of it, because each row saves on its own
 *  (record-rate.md, Saving at a date that holds a recording).
 *
 *  No step is skipped because an earlier one failed. Each record is
 *  independent, and abandoning the rest would turn one failed write
 *  into several unattempted ones.
 *
 *  Refused at a date holding no recording, before any request, and
 *  `emptied` when a failed save finds the date deleted elsewhere. */
export async function saveRateLines(vault, sit, plan) {
  // A price alone never makes a recording: at a date the model holds
  // none, typed prices wait for the first quantity. Checked here as
  // well as in the sweep, because hiding the control is not a refusal.
  if (!vault.holdsRecording(sit.date)) return { refused: true, date: sit.date, saved: [], failed: [] };
  const rates = plan.rates || [];
  const deletes = plan.deletes || [];
  const creates = rates.filter((r) => !r.existing).map((r) => r.payload.symbol);
  // A save that only changes and clears what is there claims nothing:
  // the version rule on each record is the check that catches another
  // session on exactly those records.
  const refusal = creates.length ? await claimDate(vault, sit, { rates: creates, held: true }) : null;
  if (refusal) {
    // Refused whole, before a single write. The person is looking at
    // a screen that no longer describes the vault.
    return { ...refusal, saved: [], failed: [] };
  }

  const saved = [];
  const failed = [];
  for (const change of rates) {
    try {
      await saveRate(vault, change.existing, change.payload);
      saved.push({ kind: 'rate', name: change.payload.symbol });
    } catch (error) {
      failed.push({ kind: 'rate', name: change.payload.symbol, status: error.status });
    }
  }
  // Deletions last, so a save that fails partway has destroyed nothing
  // and the person still holds every price the screen offered to
  // remove.
  for (const { entry, name } of deletes) {
    try {
      await deleteRecord(vault, entry);
      saved.push({ kind: 'deleted', name });
    } catch (error) {
      failed.push({ kind: 'deleted', name, status: error.status });
    }
  }
  if (failed.some((f) => f.status === 409)) {
    // A recording another window deleted fails every update with a
    // Conflict, so the date is read again to tell that from a price
    // changed there.
    const fresh = await reloadCreateTypes(vault).catch(() => null);
    if (fresh) {
      vault.replaceType('rate', fresh.rate);
      const held = [...fresh.snapshot, ...fresh.rate].some((r) => r.payload.date === sit.date);
      if (!held) {
        vault.replaceType('snapshot', fresh.snapshot);
        return { refused: true, date: sit.date, emptied: true, saved, failed };
      }
    }
  }
  return { refused: false, saved, failed };
}

/** Look it up on a reopened recording: write what came back for each
 *  unit in `parts` (unit to `ratePart`), each a create, with no
 *  confirmation, since filling a missing price changes none
 *  (record-rate.md, Saving at a date that holds a recording).
 *
 *  Always after a fresh read of both types, which the model then holds.
 *  A date found holding no record writes nothing, because a price alone
 *  never makes a recording. A unit another session priced meanwhile is
 *  left alone and returned as `taken`. */
export async function fillRates(vault, date, parts) {
  const fresh = await reloadCreateTypes(vault);
  vault.replaceType('snapshot', fresh.snapshot);
  vault.replaceType('rate', fresh.rate);
  if (!vault.holdsRecording(date)) return { emptied: true, saved: [], taken: [], failed: [] };
  const missing = vault.missingUnits(date);
  const saved = [];
  const taken = [];
  const failed = [];
  for (const [unit, part] of Object.entries(parts)) {
    if (!missing.includes(unit)) {
      taken.push(unit);
      continue;
    }
    try {
      await saveRate(vault, null, rateEntry(vault, unit, date, part));
      saved.push(unit);
    } catch {
      failed.push(unit);
    }
  }
  return { emptied: false, saved, taken, failed };
}

/** Every record bearing one date, quantities first and rates after,
 *  except the zero of a holding archived on it, which stays and keeps
 *  the date a recording (record-snapshot.md, Deleting a recording). A
 *  partial delete leaves a recording, not a broken one: nothing is
 *  rolled back and nothing marks the date as half deleted. */
export async function deleteRecording(vault, date) {
  const { figures, prices } = vault.recording(date);
  const remaining = [];
  const going = figures.filter((f) => !vault.isArchiveZero(f.holding, f.snapshot)).map((f) => f.snapshot);
  for (const entry of [...going, ...prices]) {
    try {
      await deleteRecord(vault, entry);
    } catch {
      remaining.push(entry);
    }
  }
  return remaining;
}

/** Archiving a holding on `date` (manage-accounts.md, Archiving,
 *  Writes), in the order that leaves a true state after every step:
 *  the zero, that date's missing prices while the holding is still
 *  active so its unit is among them, and the flag last.
 *
 *  The pre-create reload runs once, before the first create, and the
 *  model then holds what it returned. An archive that creates nothing
 *  runs none. Only this holding's own slot at `date` being taken
 *  refuses: other holdings' records there are the recording the zero
 *  joins, and a rate slot taken since is one the refresh leaves alone.
 *
 *  An archived holding is not archived again: that would write a second
 *  zero and move `archivedAt`, which makes the old zero editable.
 *
 *  Resolves to `status` 'archived', 'flagFailed', 'flagConflict',
 *  'refused', 'conflict', 'zeroFailed' or 'alreadyArchived', and for the
 *  first two the units whose price did not land. A flag that met a
 *  Conflict leaves the account record reloaded from the store. */
export async function archiveHolding(vault, holding, date) {
  if (vault.holdings.get(holding.recordId).payload.archivedAt) return { status: 'alreadyArchived' };
  const stored = () => vault.snapshotsFor(holding.recordId).find((s) => s.payload.date === date);
  let reloaded = false;
  const reload = async () => {
    if (reloaded) return;
    const fresh = await reloadCreateTypes(vault);
    reloaded = true;
    vault.replaceType('snapshot', fresh.snapshot);
    vault.replaceType('rate', fresh.rate);
  };

  const zero = stored();
  try {
    if (!zero) {
      await reload();
      if (stored()) return { status: 'refused' };
      await saveSnapshot(vault, holding.recordId, null, { date, value: '0', note: null });
    } else if (decimal.parse(zero.payload.value) !== decimal.ZERO) {
      await saveSnapshot(vault, holding.recordId, zero, { ...zero.payload, value: '0' });
    }
  } catch (failure) {
    return { status: failure.status === 409 ? 'conflict' : 'zeroFailed' };
  }

  const proposals = needsLookup(vault, date) ? await fetchProposals(vault, date) : {};
  const wanted = () => vault.missingUnits(date).filter((unit) => proposals[unit]);
  let unpriced = [];
  if (wanted().length) {
    try {
      await reload();
      unpriced = (await refreshPrices(vault, date, proposals)).failed;
    } catch {
      unpriced = wanted();
    }
  }

  try {
    const current = vault.holdings.get(holding.recordId);
    await saveHolding(vault, current, { ...current.payload, archivedAt: date });
  } catch (failure) {
    if (failure.status !== 409) return { status: 'flagFailed', unpriced };
    // Never a merge: the record another tab wrote is read back, and the
    // archive is offered again against it.
    await reloadRecord(vault, vault.holdings.get(holding.recordId)).catch(() => {});
    return { status: 'flagConflict', unpriced };
  }
  return { status: 'archived', unpriced };
}

export async function purgeHolding(vault, holding) {
  await api.del(`/api/accounts/${holding.recordId}?mode=purge`);
  applyDelete(vault, holding);
}

/** One record read afresh after a Conflict, so the screen shows what
 *  another tab wrote and the person redoes the edit against it. Gone
 *  from the store means gone from the model too. */
export async function reloadRecord(vault, entry) {
  const rows = await api.get(`/api/records?type=${entry.recordType}`);
  const row = rows.find((r) => r.recordId === entry.recordId);
  if (!row) {
    applyDelete(vault, entry);
    return null;
  }
  const fresh = {
    ...row,
    payload: migrate(row.recordType, row.schemaVersion, await crypto.decryptRecord(vault.dek, row)),
  };
  applyWrite(vault, fresh);
  return fresh;
}
