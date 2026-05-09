import type { GcalEventRecord } from '../storage.js';
import type { GcalNormalizedEvent } from './types.js';

// in-memory 版の reconciliation: SqliteBackend.applyGcalSyncRun の SQL と同じ規則。
// fetched にあるキーは新版で置換、window (timeMin..timeMax) と交差する prev のうち
// fetched にないものは「window 内で消えた = 削除/移動済」として除外、window 外は温存。
// Browser 環境 (DB なし) の useGcalSync が in-memory cache に対して使う。
export const reconcileEvents = (
  prev: readonly GcalNormalizedEvent[],
  fetched: readonly GcalNormalizedEvent[],
  timeMinMs: number,
  timeMaxMs: number,
): readonly GcalNormalizedEvent[] => {
  const fetchedKeys = new Set(fetched.map((e) => e.key));
  const preserved = prev.filter((e) => {
    if (fetchedKeys.has(e.key)) return false; // 新版で置換
    const inWindow = e.startMs < timeMaxMs && e.endMs > timeMinMs;
    return !inWindow; // window 外は温存、window 内かつ未 fetch なら除外
  });
  return [...preserved, ...fetched];
};

// Slice 17: persisted GCal raw cache (gcal_events table) と in-memory normalized
// event の相互変換。assignmentKey は (isRecurring, recurringEventId, eventId)
// から決定的に再生成できるため DB に保存しない。

export const normalizedToRecord = (e: GcalNormalizedEvent): GcalEventRecord => ({
  calendarId: e.calendarId,
  eventId: e.eventId,
  summary: e.summary,
  startMs: e.startMs,
  endMs: e.endMs,
  isRecurring: e.isRecurring,
  recurringEventId: e.recurringEventId ?? null,
  htmlLink: e.htmlLink ?? null,
});

export const recordToNormalized = (r: GcalEventRecord): GcalNormalizedEvent => {
  const assignmentKey =
    r.isRecurring && r.recurringEventId !== null && r.recurringEventId.length > 0
      ? `${r.calendarId}|R:${r.recurringEventId}`
      : `${r.calendarId}|${r.eventId}`;
  return {
    calendarId: r.calendarId,
    eventId: r.eventId,
    key: `${r.calendarId}|${r.eventId}`,
    assignmentKey,
    isRecurring: r.isRecurring,
    recurringEventId: r.recurringEventId ?? undefined,
    summary: r.summary,
    startMs: r.startMs,
    endMs: r.endMs,
    htmlLink: r.htmlLink ?? undefined,
  };
};
