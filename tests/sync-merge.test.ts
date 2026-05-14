import { describe, expect, it } from 'vitest';
import { mergeTable, pickWinner, type MergeContext } from '../src/sync/merge.js';
import type { SyncRow } from '../src/sync/types.js';

const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEV_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEV_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const row = (over: Partial<SyncRow> & { id: string }): SyncRow => ({
  revision: 1,
  updatedAt: 1000,
  updatedByDeviceId: DEV_A,
  deletedAt: null,
  createdAt: 1000,
  createdByDeviceId: DEV_A,
  ...over,
});

const ctx = (over: Partial<MergeContext> = {}): MergeContext => ({
  table: 'blocks',
  keyFn: (r) => r.id as string,
  localDeviceId: DEV_A,
  lastSyncedAt: 0,
  ...over,
});

describe('pickWinner', () => {
  it('higher revision wins regardless of updatedAt', () => {
    const a = row({ id: 'x', revision: 5, updatedAt: 100 });
    const b = row({ id: 'x', revision: 3, updatedAt: 9999 });
    expect(pickWinner(a, b)).toBe(a);
    expect(pickWinner(b, a)).toBe(a);
  });

  it('on tied revision, higher updatedAt wins', () => {
    const a = row({ id: 'x', revision: 4, updatedAt: 100 });
    const b = row({ id: 'x', revision: 4, updatedAt: 200 });
    expect(pickWinner(a, b)).toBe(b);
    expect(pickWinner(b, a)).toBe(b);
  });

  it('on tied (revision, updatedAt), tombstone wins over active', () => {
    const active = row({ id: 'x', revision: 4, updatedAt: 100, updatedByDeviceId: DEV_A });
    const tomb = row({ id: 'x', revision: 4, updatedAt: 100, updatedByDeviceId: DEV_B, deletedAt: 100 });
    expect(pickWinner(active, tomb)).toBe(tomb);
    expect(pickWinner(tomb, active)).toBe(tomb);
  });

  it('on full tie, lower deviceId (lex ASC) wins deterministically', () => {
    const a = row({ id: 'x', updatedByDeviceId: DEV_A });
    const b = row({ id: 'x', updatedByDeviceId: DEV_B });
    expect(pickWinner(a, b).updatedByDeviceId).toBe(DEV_A);
    expect(pickWinner(b, a).updatedByDeviceId).toBe(DEV_A);
  });
});

describe('mergeTable — basic semantics', () => {
  it('takes a row that exists only on one side', () => {
    const local = [row({ id: 'a' })];
    const remote: SyncRow[] = [];
    const result = mergeTable(local, remote, ctx());
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.id).toBe('a');
    expect(result.conflicts).toHaveLength(0);
  });

  it('identical rows yield no conflict', () => {
    const r = row({ id: 'a' });
    const result = mergeTable([r], [r], ctx());
    expect(result.merged).toEqual([r]);
    expect(result.conflicts).toHaveLength(0);
  });

  it('sequential edits by the same device are not a conflict', () => {
    const local = row({ id: 'a', revision: 3, updatedAt: 100, updatedByDeviceId: DEV_A });
    const remote = row({ id: 'a', revision: 5, updatedAt: 200, updatedByDeviceId: DEV_A });
    const result = mergeTable([local], [remote], ctx({ lastSyncedAt: 50 }));
    expect(result.merged).toEqual([remote]);
    expect(result.conflicts).toHaveLength(0);
  });

  it('concurrent edits by different devices since lastSyncedAt produce a conflict', () => {
    const local = row({ id: 'a', revision: 4, updatedAt: 200, updatedByDeviceId: DEV_A });
    const remote = row({ id: 'a', revision: 4, updatedAt: 300, updatedByDeviceId: DEV_B });
    const result = mergeTable([local], [remote], ctx({ lastSyncedAt: 100 }));
    expect(result.merged).toEqual([remote]);
    expect(result.conflicts).toHaveLength(1);
    const c = result.conflicts[0]!;
    expect(c.winnerDeviceId).toBe(DEV_B);
    expect(c.loserDeviceId).toBe(DEV_A);
    expect(c.loserPayload).toBe(local);
    expect(c.conflictEventId).toBe(
      JSON.stringify(['conflict', 'blocks', 'a', 4, 4, DEV_B]),
    );
  });

  it('does not record a conflict for edits that predate lastSyncedAt on both sides', () => {
    const local = row({ id: 'a', revision: 2, updatedAt: 50, updatedByDeviceId: DEV_A });
    const remote = row({ id: 'a', revision: 3, updatedAt: 60, updatedByDeviceId: DEV_B });
    const result = mergeTable([local], [remote], ctx({ lastSyncedAt: 100 }));
    expect(result.merged).toEqual([remote]);
    expect(result.conflicts).toHaveLength(0);
  });

  it('revival: higher-revision active beats earlier tombstone', () => {
    const tomb = row({ id: 'a', revision: 5, updatedAt: 100, deletedAt: 100, updatedByDeviceId: DEV_A });
    const revival = row({ id: 'a', revision: 6, updatedAt: 200, deletedAt: null, updatedByDeviceId: DEV_B });
    const result = mergeTable([tomb], [revival], ctx({ lastSyncedAt: 50 }));
    expect(result.merged[0]?.revision).toBe(6);
    expect(result.merged[0]?.deletedAt).toBeNull();
  });

  it('conflictEventId is stable across input order (dedup-safe)', () => {
    const local = row({ id: 'a', revision: 4, updatedAt: 200, updatedByDeviceId: DEV_A });
    const remote = row({ id: 'a', revision: 4, updatedAt: 300, updatedByDeviceId: DEV_B });
    const r1 = mergeTable([local], [remote], ctx({ lastSyncedAt: 100 }));
    const r2 = mergeTable([remote], [local], ctx({ lastSyncedAt: 100 }));
    expect(r1.conflicts[0]?.conflictEventId).toBe(r2.conflicts[0]?.conflictEventId);
  });

  it('conflictEventId stays stable when local/remote revisions differ across swap', () => {
    // Regression: id was previously `${localRev}|${remoteRev}` so reversing
    // the sides produced a different id and broke dedup. Now built from
    // (winnerRev, loserRev) which is order-independent.
    const a = row({ id: 'a', revision: 4, updatedAt: 200, updatedByDeviceId: DEV_A });
    const b = row({ id: 'a', revision: 5, updatedAt: 300, updatedByDeviceId: DEV_B });
    const r1 = mergeTable([a], [b], ctx({ lastSyncedAt: 100 }));
    const r2 = mergeTable([b], [a], ctx({ lastSyncedAt: 100 }));
    expect(r1.conflicts[0]?.conflictEventId).toBe(r2.conflicts[0]?.conflictEventId);
  });

  it('conflictEventId does not collide when table/rowKey contains the delimiter', () => {
    // Regression: pipe-concatenation could collide on `a|b` vs `a` + `b`.
    // JSON-encoded array is collision-free.
    const a = row({ id: 'foo|bar', revision: 4, updatedAt: 200, updatedByDeviceId: DEV_A });
    const b = row({ id: 'foo|bar', revision: 4, updatedAt: 300, updatedByDeviceId: DEV_B });
    const result = mergeTable([a], [b], ctx({ lastSyncedAt: 100 }));
    const id = result.conflicts[0]?.conflictEventId;
    expect(id).toContain('"foo|bar"');
    expect(JSON.parse(id!)).toEqual(['conflict', 'blocks', 'foo|bar', 4, 4, DEV_B]);
  });

  it('intra-side duplicate keys are LWW-collapsed (no silent overwrite)', () => {
    // Regression: previous map-based ingest let later entries overwrite
    // earlier ones unconditionally, which lost data when an envelope
    // contained the same key twice (e.g. corruption or migration bug).
    const oldRow = row({ id: 'a', revision: 1, updatedAt: 100, updatedByDeviceId: DEV_A });
    const newRow = row({ id: 'a', revision: 5, updatedAt: 500, updatedByDeviceId: DEV_A });
    // Order the higher-rev FIRST so a naive "later wins" would pick `oldRow`.
    const result = mergeTable([newRow, oldRow], [], ctx());
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.revision).toBe(5);
  });
});

const sortByKey = (rows: readonly SyncRow[]): SyncRow[] =>
  [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

describe('mergeTable — algebraic properties', () => {
  it('idempotent: merge(A, A) === A with no conflicts', () => {
    const a = [
      row({ id: 'a', revision: 2 }),
      row({ id: 'b', revision: 5, deletedAt: 999 }),
      row({ id: 'c', revision: 1, updatedByDeviceId: DEV_B }),
    ];
    const result = mergeTable(a, a, ctx({ lastSyncedAt: 0 }));
    expect(sortByKey(result.merged)).toEqual(sortByKey(a));
    expect(result.conflicts).toHaveLength(0);
  });

  it('commutative: merge(L, R).merged equals merge(R, L).merged', () => {
    const left = [
      row({ id: 'a', revision: 3, updatedAt: 200, updatedByDeviceId: DEV_A }),
      row({ id: 'b', revision: 1, updatedAt: 100, updatedByDeviceId: DEV_A }),
      row({ id: 'c', revision: 4, updatedAt: 400, deletedAt: 400, updatedByDeviceId: DEV_A }),
    ];
    const right = [
      row({ id: 'a', revision: 5, updatedAt: 300, updatedByDeviceId: DEV_B }),
      row({ id: 'b', revision: 1, updatedAt: 100, updatedByDeviceId: DEV_A }),
      row({ id: 'd', revision: 2, updatedAt: 200, updatedByDeviceId: DEV_B }),
    ];
    const lr = mergeTable(left, right, ctx());
    const rl = mergeTable(right, left, ctx({ localDeviceId: DEV_B }));
    expect(sortByKey(lr.merged)).toEqual(sortByKey(rl.merged));
  });

  it('associative: merge(merge(A, B), C) equals merge(A, merge(B, C))', () => {
    const a = [
      row({ id: 'x', revision: 1, updatedAt: 100, updatedByDeviceId: DEV_A }),
      row({ id: 'y', revision: 3, updatedAt: 300, updatedByDeviceId: DEV_A }),
    ];
    const b = [
      row({ id: 'x', revision: 4, updatedAt: 400, updatedByDeviceId: DEV_B }),
      row({ id: 'z', revision: 2, updatedAt: 200, updatedByDeviceId: DEV_B }),
    ];
    const c = [
      row({ id: 'y', revision: 5, updatedAt: 500, updatedByDeviceId: DEV_C }),
      row({ id: 'z', revision: 3, updatedAt: 300, deletedAt: 300, updatedByDeviceId: DEV_C }),
    ];
    const left = mergeTable(mergeTable(a, b, ctx()).merged, c, ctx());
    const right = mergeTable(a, mergeTable(b, c, ctx()).merged, ctx());
    expect(sortByKey(left.merged)).toEqual(sortByKey(right.merged));
  });
});
