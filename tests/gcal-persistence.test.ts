import { describe, expect, it } from 'vitest';
import {
  normalizedToRecord,
  recordToNormalized,
  reconcileEvents,
} from '../src/gcal/persistence.js';
import type { GcalNormalizedEvent } from '../src/gcal/types.js';

const ev = (
  key: string,
  startLocal: [number, number, number, number, number],
  endLocal: [number, number, number, number, number],
  recurringEventId?: string,
  summary: string = key,
): GcalNormalizedEvent => {
  const calendarId = 'primary';
  const isRecurring = recurringEventId !== undefined;
  return {
    calendarId,
    eventId: key,
    key: `${calendarId}|${key}`,
    assignmentKey: isRecurring ? `${calendarId}|R:${recurringEventId}` : `${calendarId}|${key}`,
    isRecurring,
    recurringEventId,
    summary,
    startMs: new Date(startLocal[0], startLocal[1] - 1, startLocal[2], startLocal[3], startLocal[4], 0, 0).getTime(),
    endMs: new Date(endLocal[0], endLocal[1] - 1, endLocal[2], endLocal[3], endLocal[4], 0, 0).getTime(),
    htmlLink: undefined,
  };
};

const monthMs = (y: number, m: number): number => new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();

describe('record <-> normalized 変換', () => {
  it('単発 event は assignmentKey が eventId ベースで再生成される', () => {
    const e = ev('abc', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0]);
    const round = recordToNormalized(normalizedToRecord(e));
    expect(round.assignmentKey).toBe('primary|abc');
    expect(round.isRecurring).toBe(false);
    expect(round.recurringEventId).toBeUndefined();
    expect(round.startMs).toBe(e.startMs);
  });

  it('繰り返し event は recurringEventId 経由で assignmentKey が再生成される', () => {
    const e = ev('inst-1', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0], 'parent-1');
    const round = recordToNormalized(normalizedToRecord(e));
    expect(round.assignmentKey).toBe('primary|R:parent-1');
    expect(round.isRecurring).toBe(true);
    expect(round.recurringEventId).toBe('parent-1');
  });

  it('htmlLink は undefined ↔ null を吸収する', () => {
    const e = ev('a', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0]);
    const rec = normalizedToRecord(e);
    expect(rec.htmlLink).toBeNull();
    expect(recordToNormalized(rec).htmlLink).toBeUndefined();
  });
});

describe('reconcileEvents (window 内 reconciliation)', () => {
  const TIME_MIN = monthMs(2026, 5);
  const TIME_MAX = monthMs(2026, 6);

  it('単発リスケ: 同 eventId の startMs/endMs が新版で上書きされる', () => {
    const old14 = ev('a', [2026, 5, 11, 14, 0], [2026, 5, 11, 15, 0]);
    const new15 = ev('a', [2026, 5, 11, 15, 0], [2026, 5, 11, 16, 0]);
    const out = reconcileEvents([old14], [new15], TIME_MIN, TIME_MAX);
    expect(out.length).toBe(1);
    expect(out[0]!.startMs).toBe(new15.startMs);
  });

  it('削除イベント: window 内で fetched から消えた event は除外される', () => {
    const old = ev('a', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0]);
    const out = reconcileEvents([old], [], TIME_MIN, TIME_MAX);
    expect(out.length).toBe(0);
  });

  it('window 外 event は fetched に含まれなくても温存される', () => {
    const oldPast = ev('past', [2026, 1, 5, 10, 0], [2026, 1, 5, 11, 0]); // 1 月
    const oldFuture = ev('future', [2026, 9, 5, 10, 0], [2026, 9, 5, 11, 0]); // 9 月
    const fetchedNow = ev('now', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0]);
    const out = reconcileEvents([oldPast, oldFuture], [fetchedNow], TIME_MIN, TIME_MAX);
    expect(out.length).toBe(3);
    const ids = out.map((e) => e.eventId).sort();
    expect(ids).toEqual(['future', 'now', 'past']);
  });

  it('複数日 event の翌日スライド: 同 eventId で start/end 両方更新', () => {
    // 5/9〜5/12 の 4 日打合せ → 5/10〜5/13 へ翌日スライド
    const old = ev('multi', [2026, 5, 9, 9, 0], [2026, 5, 12, 18, 0]);
    const slid = ev('multi', [2026, 5, 10, 9, 0], [2026, 5, 13, 18, 0]);
    const out = reconcileEvents([old], [slid], TIME_MIN, TIME_MAX);
    expect(out.length).toBe(1);
    expect(out[0]!.startMs).toBe(slid.startMs);
    expect(out[0]!.endMs).toBe(slid.endMs);
  });

  it('繰り返し instance のリスケ: instance id 不変、startMs/endMs 更新', () => {
    const oldInst = ev('parent_20260511T010000Z', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0], 'parent');
    const slidInst = ev('parent_20260511T010000Z', [2026, 5, 11, 15, 0], [2026, 5, 11, 16, 0], 'parent');
    const out = reconcileEvents([oldInst], [slidInst], TIME_MIN, TIME_MAX);
    expect(out.length).toBe(1);
    expect(out[0]!.startMs).toBe(slidInst.startMs);
    expect(out[0]!.assignmentKey).toBe('primary|R:parent');
  });

  it('window 跨ぎ event は新版で置換される (片月 fetch でも全 event が新版へ)', () => {
    // 5/30 23:00 〜 6/2 02:00 の event。元の打合せが翌日にスライドして 5/31 23:00 〜 6/3 02:00 に。
    // 5月 fetch でも 6月 fetch でもこの event は API 結果に含まれる (Google API は時間範囲交差で返す)。
    // window が 5/1〜6/1 (5月のみ fetch のとき timeMin=5/1, timeMax=6/1)。
    // event は window と交差するので reconciliation 対象 → 新版に置換。
    const old = ev('cross', [2026, 5, 30, 23, 0], [2026, 6, 2, 2, 0]);
    const slid = ev('cross', [2026, 5, 31, 23, 0], [2026, 6, 3, 2, 0]);
    const out = reconcileEvents([old], [slid], TIME_MIN, TIME_MAX);
    expect(out.length).toBe(1);
    expect(out[0]!.startMs).toBe(slid.startMs);
  });
});
