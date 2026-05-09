import { describe, expect, it } from 'vitest';
import { eventToDailyBlocks, mergeDayBlocks, mergeEventsByDate } from '../src/gcal/merge.js';
import type { GcalNormalizedEvent } from '../src/gcal/types.js';
import type { TimeBlock } from '../src/domain/types.js';

const makeLocalEvent = (
  key: string,
  summary: string,
  startLocal: [number, number, number, number, number],
  endLocal: [number, number, number, number, number],
  recurringEventId?: string,
): GcalNormalizedEvent => {
  const calendarId = 'primary';
  const isRecurring = recurringEventId !== undefined;
  const assignmentKey = isRecurring ? `${calendarId}|R:${recurringEventId}` : `${calendarId}|${key}`;
  return {
    calendarId,
    eventId: key,
    key: `${calendarId}|${key}`,
    assignmentKey,
    isRecurring,
    summary,
    startMs: new Date(startLocal[0], startLocal[1] - 1, startLocal[2], startLocal[3], startLocal[4], 0, 0).getTime(),
    endMs: new Date(endLocal[0], endLocal[1] - 1, endLocal[2], endLocal[3], endLocal[4], 0, 0).getTime(),
    htmlLink: undefined,
  };
};

describe('eventToDailyBlocks', () => {
  it('単一日内のイベントは1つの block を返す', () => {
    const e = makeLocalEvent('a', '会議', [2026, 5, 9, 10, 0], [2026, 5, 9, 11, 30]);
    const blocks = eventToDailyBlocks(e);
    expect(blocks.size).toBe(1);
    const b = blocks.get('2026-05-09');
    expect(b).toBeDefined();
    expect(b!.start).toBe(600);
    expect(b!.durationMin).toBe(90);
    expect(b!.source).toBe('gcal');
    expect(b!.gcalKey).toBe('primary|a');
    expect(b!.label).toBe('会議');
    expect(b!.id).toBe('gcal:primary|a:2026-05-09');
  });

  it('日跨ぎイベントは2日に分割される', () => {
    const e = makeLocalEvent('b', '徹夜作業', [2026, 5, 9, 23, 0], [2026, 5, 10, 2, 0]);
    const blocks = eventToDailyBlocks(e);
    expect(blocks.size).toBe(2);
    const day1 = blocks.get('2026-05-09');
    const day2 = blocks.get('2026-05-10');
    expect(day1?.start).toBe(23 * 60);
    expect(day1?.durationMin).toBe(60);
    expect(day2?.start).toBe(0);
    expect(day2?.durationMin).toBe(120);
  });

  it('id は日付付きで一意', () => {
    const e = makeLocalEvent('c', 'X', [2026, 5, 9, 23, 30], [2026, 5, 10, 0, 30]);
    const blocks = eventToDailyBlocks(e);
    const ids = Array.from(blocks.values()).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mergeEventsByDate', () => {
  it('同日複数イベントは start 昇順', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('late', '午後', [2026, 5, 9, 14, 0], [2026, 5, 9, 15, 0]),
      makeLocalEvent('early', '午前', [2026, 5, 9, 9, 0], [2026, 5, 9, 10, 0]),
    ];
    const out = mergeEventsByDate(evts);
    const day = out['2026-05-09'];
    expect(day).toBeDefined();
    expect(day!.length).toBe(2);
    expect(day![0]!.label).toBe('午前');
    expect(day![1]!.label).toBe('午後');
  });

  it('assignments の projectId が GCal block に反映される', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('a', 'X', [2026, 5, 9, 10, 0], [2026, 5, 9, 11, 0]),
    ];
    const out = mergeEventsByDate(evts, {
      'primary|a': { projectId: 'proj-1' },
    });
    expect(out['2026-05-09']?.[0]?.projectId).toBe('proj-1');
  });

  it('assignments の hidden=true なイベントは出力から除外される', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('a', 'X', [2026, 5, 9, 10, 0], [2026, 5, 9, 11, 0]),
      makeLocalEvent('b', 'Y', [2026, 5, 9, 12, 0], [2026, 5, 9, 13, 0]),
    ];
    const out = mergeEventsByDate(evts, {
      'primary|a': { hidden: true },
    });
    const day = out['2026-05-09'];
    expect(day?.length).toBe(1);
    expect(day?.[0]?.label).toBe('Y');
  });

  it('繰り返しイベントの projectId は parent recurringEventId キーで全インスタンスに継承される', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('inst-1', '週次定例', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0], 'parent-1'),
      makeLocalEvent('inst-2', '週次定例', [2026, 5, 18, 10, 0], [2026, 5, 18, 11, 0], 'parent-1'),
    ];
    const out = mergeEventsByDate(evts, {
      'primary|R:parent-1': { projectId: 'proj-x' },
    });
    expect(out['2026-05-11']?.[0]?.projectId).toBe('proj-x');
    expect(out['2026-05-18']?.[0]?.projectId).toBe('proj-x');
    expect(out['2026-05-11']?.[0]?.gcalRecurring).toBe(true);
    expect(out['2026-05-11']?.[0]?.gcalKey).toBe('primary|R:parent-1');
  });

  it('繰り返しイベントを 1 度 hide すると全インスタンスが消える', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('inst-1', 'X', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0], 'parent-2'),
      makeLocalEvent('inst-2', 'X', [2026, 5, 18, 10, 0], [2026, 5, 18, 11, 0], 'parent-2'),
      makeLocalEvent('single', 'Y', [2026, 5, 11, 13, 0], [2026, 5, 11, 14, 0]),
    ];
    const out = mergeEventsByDate(evts, {
      'primary|R:parent-2': { hidden: true },
    });
    expect(out['2026-05-11']?.length).toBe(1);
    expect(out['2026-05-11']?.[0]?.label).toBe('Y');
    expect(out['2026-05-18']).toBeUndefined();
  });

  it('summary rule は同名予定 (recurringEventId なし) すべてに projectId を継承する', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('a', '週次定例', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0]),
      makeLocalEvent('b', '週次定例', [2026, 5, 18, 10, 0], [2026, 5, 18, 11, 0]),
      makeLocalEvent('c', '別の予定', [2026, 5, 11, 14, 0], [2026, 5, 11, 15, 0]),
    ];
    const out = mergeEventsByDate(evts, {}, { '週次定例': { projectId: 'proj-y' } });
    expect(out['2026-05-11']?.find((b) => b.label === '週次定例')?.projectId).toBe('proj-y');
    expect(out['2026-05-18']?.[0]?.projectId).toBe('proj-y');
    expect(out['2026-05-11']?.find((b) => b.label === '別の予定')?.projectId).toBeUndefined();
  });

  it('個別 assignment は summary rule より優先される', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('a', '週次定例', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0]),
      makeLocalEvent('b', '週次定例', [2026, 5, 18, 10, 0], [2026, 5, 18, 11, 0]),
    ];
    const out = mergeEventsByDate(
      evts,
      { 'primary|a': { projectId: 'proj-special' } }, // この回だけ別案件
      { '週次定例': { projectId: 'proj-default' } },
    );
    expect(out['2026-05-11']?.[0]?.projectId).toBe('proj-special');
    expect(out['2026-05-18']?.[0]?.projectId).toBe('proj-default');
  });

  it('summary rule の hidden は同名予定すべてを除外', () => {
    const evts: GcalNormalizedEvent[] = [
      makeLocalEvent('a', '週次定例', [2026, 5, 11, 10, 0], [2026, 5, 11, 11, 0]),
      makeLocalEvent('b', '週次定例', [2026, 5, 18, 10, 0], [2026, 5, 18, 11, 0]),
      makeLocalEvent('c', '残す予定', [2026, 5, 11, 14, 0], [2026, 5, 11, 15, 0]),
    ];
    const out = mergeEventsByDate(evts, {}, { '週次定例': { hidden: true } });
    expect(out['2026-05-11']?.length).toBe(1);
    expect(out['2026-05-11']?.[0]?.label).toBe('残す予定');
    expect(out['2026-05-18']).toBeUndefined();
  });
});

describe('mergeDayBlocks', () => {
  const native: TimeBlock = {
    id: 'n1',
    label: 'native',
    start: 540,
    durationMin: 60,
  };
  const gcal: TimeBlock = {
    id: 'gcal:primary|x:2026-05-09',
    label: 'gcal',
    start: 600,
    durationMin: 60,
    source: 'gcal',
    gcalKey: 'primary|x',
  };

  it('GCal が空なら native 配列をそのまま返す (identity)', () => {
    const nativeArr: readonly TimeBlock[] = [native];
    expect(mergeDayBlocks(nativeArr, [])).toBe(nativeArr);
  });

  it('start 順にマージされる', () => {
    const out = mergeDayBlocks([native], [gcal]);
    expect(out.length).toBe(2);
    expect(out[0]!.id).toBe('n1');
    expect(out[1]!.source).toBe('gcal');
  });
});
