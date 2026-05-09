import type { DateString, GcalAssignment, TimeBlock } from '../domain/types.js';
import type { GcalNormalizedEvent } from './types.js';

const MINUTES_PER_DAY = 1440;
const MS_PER_MIN = 60_000;

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const formatLocalDate = (d: Date): DateString =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const startOfLocalDayMs = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// 1 イベントを「日」単位に分割し、各日の TimeBlock を返す。assignment があれば projectId を付与。
// gcalKey はブロックから assignments を引くキー (単発は eventId、繰り返しは parent recurringEventId)。
export const eventToDailyBlocks = (
  e: GcalNormalizedEvent,
  assignment?: GcalAssignment,
): ReadonlyMap<DateString, TimeBlock> => {
  const result = new Map<DateString, TimeBlock>();
  if (assignment?.hidden === true) return result;
  let cursor = e.startMs;
  let safety = 0;
  while (cursor < e.endMs) {
    if (safety++ > 60) break; // 異常な multi-day を安全弁で打ち切り
    const dayStart = startOfLocalDayMs(cursor);
    const nextDayStart = dayStart + MINUTES_PER_DAY * MS_PER_MIN;
    const segStart = cursor;
    const segEnd = Math.min(e.endMs, nextDayStart);
    const startMin = Math.floor((segStart - dayStart) / MS_PER_MIN);
    const rawDurationMin = Math.max(1, Math.round((segEnd - segStart) / MS_PER_MIN));
    const durationMin = Math.min(rawDurationMin, MINUTES_PER_DAY - startMin);
    if (durationMin <= 0) break;
    const date = formatLocalDate(new Date(dayStart));
    result.set(date, {
      id: `gcal:${e.key}:${date}`,
      label: e.summary,
      start: startMin,
      durationMin,
      source: 'gcal',
      gcalKey: e.assignmentKey,
      ...(e.isRecurring ? { gcalRecurring: true as const } : {}),
      ...(assignment?.projectId !== undefined ? { projectId: assignment.projectId } : {}),
    });
    cursor = nextDayStart;
  }
  return result;
};

export type GcalSummaryRule = { readonly projectId?: string; readonly hidden?: true };

// 個別 assignment > summary rule の優先順位で 1 イベントの実効 assignment を決定
const resolveAssignment = (
  e: GcalNormalizedEvent,
  assignments?: Readonly<Record<string, GcalAssignment>>,
  summaryRules?: Readonly<Record<string, GcalSummaryRule>>,
): GcalAssignment | undefined => {
  const a = assignments?.[e.assignmentKey];
  if (a !== undefined) return a;
  const r = summaryRules?.[e.summary];
  if (r === undefined) return undefined;
  return {
    ...(r.projectId !== undefined ? { projectId: r.projectId } : {}),
    ...(r.hidden === true ? { hidden: true as const } : {}),
  };
};

export const mergeEventsByDate = (
  events: readonly GcalNormalizedEvent[],
  assignments?: Readonly<Record<string, GcalAssignment>>,
  summaryRules?: Readonly<Record<string, GcalSummaryRule>>,
): Record<DateString, readonly TimeBlock[]> => {
  const out: Record<DateString, TimeBlock[]> = {};
  for (const e of events) {
    const effective = resolveAssignment(e, assignments, summaryRules);
    const blocks = eventToDailyBlocks(e, effective);
    for (const [date, b] of blocks) {
      const arr = out[date];
      if (arr === undefined) out[date] = [b];
      else arr.push(b);
    }
  }
  // 開始時刻順
  for (const arr of Object.values(out)) arr.sort((a, b) => a.start - b.start);
  return out;
};

// 既存 native blocks と GCal 由来 blocks を 1 日分マージ。重なってもブロック側で視覚的に区別する前提で並べるだけ。
export const mergeDayBlocks = (
  native: readonly TimeBlock[],
  gcal: readonly TimeBlock[],
): readonly TimeBlock[] => {
  if (gcal.length === 0) return native;
  return [...native, ...gcal].sort((a, b) => a.start - b.start);
};
