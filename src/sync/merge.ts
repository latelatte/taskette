/**
 * Slice 22-A: pure row-level LWW merge for v0.5 sync.
 *
 * Tie-breaker order (deterministic, applied top-down):
 *   1. revision DESC
 *   2. updatedAt DESC
 *   3. tombstone wins over active (delete wins — never silently revive deleted data)
 *   4. updatedByDeviceId lex ASC (lower UUID wins)
 *
 * Conflict definition (a "real" conflict that records a loser entry):
 *   - both sides hold the row (same key)
 *   - rows are not identical
 *   - both were last edited after `lastSyncedAt` (independent edits since
 *     local's last successful sync — caller passes 0 when no anchor exists)
 *   - the rows were authored by *different* devices (same author = sequential
 *     edits, not concurrent)
 *
 * Conflict event id (`${table}|${rowKey}|${localRev}|${remoteRev}|${winnerDeviceId}`)
 * is stable across retries so the loser log can dedupe.
 */

import type { DeviceId, SyncRow } from './types.js';

export type RowKey = string;

export type MergeContext = {
  readonly table: string;
  readonly keyFn: (row: SyncRow) => RowKey;
  /**
   * Caller's own device id. Not consumed by the merge itself; reserved for
   * later slices that update `envelope.devices[localDeviceId]` post-merge.
   */
  readonly localDeviceId: DeviceId;
  /** Local's view of last successful sync (ms). 0 = no prior sync. */
  readonly lastSyncedAt: number;
};

export type LoserEntry = {
  readonly conflictEventId: string;
  readonly table: string;
  readonly rowKey: RowKey;
  readonly localRevision: number;
  readonly remoteRevision: number;
  readonly winnerDeviceId: DeviceId;
  readonly loserDeviceId: DeviceId;
  readonly loserPayload: SyncRow;
  readonly createdAt: number;
};

export type MergeResult = {
  readonly merged: readonly SyncRow[];
  readonly conflicts: readonly LoserEntry[];
};

/**
 * Two rows agree on every sync-meta field. Payload columns are *not*
 * checked: the contract is that a row authored by the same device at the
 * same (revision, updatedAt, deletedAt) carries identical payload. Envelope
 * validation upstream (22-B) is responsible for catching payload divergence
 * under matching metadata.
 */
const syncMetaEqual = (a: SyncRow, b: SyncRow): boolean =>
  a.revision === b.revision &&
  a.updatedAt === b.updatedAt &&
  a.updatedByDeviceId === b.updatedByDeviceId &&
  a.deletedAt === b.deletedAt;

/**
 * Pure pairwise winner selection. Exposed for testing — production code
 * should call {@link mergeTable}.
 */
export const pickWinner = (a: SyncRow, b: SyncRow): SyncRow => {
  if (a.revision !== b.revision) return a.revision > b.revision ? a : b;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const aDeleted = a.deletedAt !== null;
  const bDeleted = b.deletedAt !== null;
  if (aDeleted !== bDeleted) return aDeleted ? a : b;
  return a.updatedByDeviceId <= b.updatedByDeviceId ? a : b;
};

const isConflict = (local: SyncRow, remote: SyncRow, lastSyncedAt: number): boolean => {
  if (syncMetaEqual(local, remote)) return false;
  // Same author across both sides means one is simply behind — sequential,
  // not concurrent. Note: this relies on device_id being globally unique;
  // a deviceId reused across two physical machines defeats this check and
  // would silently LWW one side. device_id uniqueness is enforced at
  // app bootstrap (settings.device_id UUID v4, once-per-install).
  if (local.updatedByDeviceId === remote.updatedByDeviceId) return false;
  return local.updatedAt > lastSyncedAt && remote.updatedAt > lastSyncedAt;
};

/**
 * Stable across input order. Uses winner/loser revisions (not local/remote)
 * so reversing the call sites yields the same id. JSON-encoded array avoids
 * delimiter collisions if `table` or `rowKey` contains `|`.
 */
const conflictEventId = (
  table: string,
  rowKey: RowKey,
  winnerRev: number,
  loserRev: number,
  winnerDeviceId: DeviceId,
): string => JSON.stringify(['conflict', table, rowKey, winnerRev, loserRev, winnerDeviceId]);

/**
 * Pre-merge dedup within a single side. A well-formed envelope contains
 * at most one row per primary key, but external snapshots are untrusted —
 * collapse duplicates by LWW first so the cross-side merge sees a clean
 * 1:1 map. Loser rows from intra-side dedup are *not* added to the
 * conflict log (those represent malformed input, not concurrent edits).
 */
const dedupeBySide = (
  rows: readonly SyncRow[],
  keyFn: (row: SyncRow) => RowKey,
): Map<RowKey, SyncRow> => {
  const map = new Map<RowKey, SyncRow>();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = map.get(key);
    map.set(key, existing === undefined ? row : pickWinner(existing, row));
  }
  return map;
};

/**
 * Merge two row sets for a single table. Pure: no IO, no clock reads.
 *
 * Properties (verified by tests/sync-merge.test.ts):
 *   - idempotent:    mergeTable(A, A) yields A with no conflicts
 *   - commutative:   merged set of mergeTable(L, R) equals mergeTable(R, L)
 *   - associative:   final merged state is independent of merge grouping
 *
 * `conflicts` only records true concurrent edits (per `isConflict`).
 * A row that exists only on one side is taken as-is and never counted as
 * a conflict.
 */
export const mergeTable = (
  local: readonly SyncRow[],
  remote: readonly SyncRow[],
  ctx: MergeContext,
): MergeResult => {
  const localByKey = dedupeBySide(local, ctx.keyFn);
  const remoteByKey = dedupeBySide(remote, ctx.keyFn);
  const allKeys = new Set<RowKey>([...localByKey.keys(), ...remoteByKey.keys()]);

  const merged: SyncRow[] = [];
  const conflicts: LoserEntry[] = [];

  for (const rowKey of allKeys) {
    const l = localByKey.get(rowKey);
    const r = remoteByKey.get(rowKey);

    if (l === undefined && r !== undefined) {
      merged.push(r);
      continue;
    }
    if (r === undefined && l !== undefined) {
      merged.push(l);
      continue;
    }
    if (l === undefined || r === undefined) continue; // unreachable

    const winner = pickWinner(l, r);
    merged.push(winner);

    if (isConflict(l, r, ctx.lastSyncedAt)) {
      const loser = winner === l ? r : l;
      conflicts.push({
        conflictEventId: conflictEventId(
          ctx.table,
          rowKey,
          winner.revision,
          loser.revision,
          winner.updatedByDeviceId,
        ),
        table: ctx.table,
        rowKey,
        localRevision: l.revision,
        remoteRevision: r.revision,
        winnerDeviceId: winner.updatedByDeviceId,
        loserDeviceId: loser.updatedByDeviceId,
        loserPayload: loser,
        createdAt: Math.max(l.updatedAt, r.updatedAt),
      });
    }
  }

  return { merged, conflicts };
};
