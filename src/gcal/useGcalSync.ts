import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateString, GcalAssignment, TimeBlock } from '../domain/types.js';
import { addMonths, yearMonthOf } from '../dates.js';
import { fetchCountableEvents, GcalApiError } from './api.js';
import { mergeEventsByDate, type GcalSummaryRule } from './merge.js';
import type { GcalNormalizedEvent } from './types.js';

const CACHE_FRESH_MS = 5 * 60 * 1000; // この期間内なら再 fetch しない
const CACHE_PURGE_MS = 30 * 60 * 1000; // この期間を超えた未使用月は破棄

type MonthCacheEntry = {
  readonly events: readonly GcalNormalizedEvent[];
  readonly fetchedAt: number;
};

export type GcalSyncStatus = 'idle' | 'syncing' | 'error';

export type UseGcalSync = {
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly status: GcalSyncStatus;
  readonly errorMessage: string | null;
  readonly errorStatus: number | null; // HTTP ステータスコード (401/403/410/429/500…)、判定不可は null
  readonly lastSyncedAt: number | null;
  readonly refresh: () => void;
};

const monthRange = (yearMonth: string): { readonly start: Date; readonly end: Date } => {
  const [yStr, mStr] = yearMonth.split('-');
  const y = parseInt(yStr ?? '1970', 10);
  const m = parseInt(mStr ?? '1', 10);
  return {
    start: new Date(y, m - 1, 1, 0, 0, 0, 0),
    end: new Date(y, m, 1, 0, 0, 0, 0),
  };
};

export const useGcalSync = (
  accessToken: string | null,
  currentDate: DateString,
  calendarId: string | null,
  assignments: Readonly<Record<string, GcalAssignment>>,
  summaryRules: Readonly<Record<string, GcalSummaryRule>>,
  requestSilentRefresh: () => Promise<string | null>,
): UseGcalSync => {
  const [cache, setCache] = useState<Record<string, MonthCacheEntry>>({});
  const [status, setStatus] = useState<GcalSyncStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // mutable refs to access latest values inside async loop without re-creating syncNow
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const inflight = useRef<Set<string>>(new Set());

  // calendarId が変わったらキャッシュを破棄 (別カレンダーのイベントを残さない)
  useEffect(() => {
    setCache({});
    setLastSyncedAt(null);
    setErrorMessage(null);
    setErrorStatus(null);
  }, [calendarId]);

  const targetMonths = useMemo<readonly string[]>(() => {
    const cur = yearMonthOf(currentDate);
    const prev = yearMonthOf(addMonths(`${cur}-01`, -1));
    const next = yearMonthOf(addMonths(`${cur}-01`, 1));
    return [prev, cur, next];
  }, [currentDate]);

  const syncNow = useCallback(
    async (force: boolean): Promise<void> => {
      if (accessToken === null || accessToken.length === 0) return;
      if (calendarId === null || calendarId.length === 0) return;
      setStatus('syncing');
      let anyError = false;
      let currentToken = accessToken;
      const now = Date.now();

      // 401 を受けたら silent refresh を 1 度だけ試みる。共有結果で全月分をリトライ
      const fetchMonth = async (ym: string, allowRefresh: boolean): Promise<void> => {
        const { start, end } = monthRange(ym);
        try {
          const events = await fetchCountableEvents({
            accessToken: currentToken,
            calendarId,
            timeMin: start,
            timeMax: end,
          });
          setCache((prev) => ({ ...prev, [ym]: { events, fetchedAt: Date.now() } }));
          setLastSyncedAt(Date.now());
          setErrorMessage(null);
          setErrorStatus(null);
        } catch (e) {
          if (allowRefresh && e instanceof GcalApiError && e.status === 401) {
            const refreshed = await requestSilentRefresh();
            if (refreshed !== null && refreshed.length > 0) {
              currentToken = refreshed;
              await fetchMonth(ym, false);
              return;
            }
          }
          throw e;
        }
      };

      for (const ym of targetMonths) {
        const cached = cacheRef.current[ym];
        if (!force && cached !== undefined && now - cached.fetchedAt < CACHE_FRESH_MS) continue;
        if (inflight.current.has(ym)) continue;
        inflight.current.add(ym);
        try {
          await fetchMonth(ym, true);
        } catch (e) {
          anyError = true;
          const msg = e instanceof GcalApiError ? e.message : (e instanceof Error ? e.message : String(e));
          const code = e instanceof GcalApiError ? e.status : null;
          setErrorMessage(msg);
          setErrorStatus(code);
        } finally {
          inflight.current.delete(ym);
        }
      }
      setStatus(anyError ? 'error' : 'idle');
    },
    [accessToken, calendarId, targetMonths, requestSilentRefresh],
  );

  useEffect(() => {
    void syncNow(false);
  }, [syncNow]);

  // target 外で古いエントリは破棄
  useEffect(() => {
    const targetSet = new Set(targetMonths);
    setCache((prev) => {
      const now = Date.now();
      let changed = false;
      const next: Record<string, MonthCacheEntry> = {};
      for (const [ym, entry] of Object.entries(prev)) {
        if (targetSet.has(ym) || now - entry.fetchedAt < CACHE_PURGE_MS) {
          next[ym] = entry;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [targetMonths]);

  const blocksByDate = useMemo(() => {
    const allEvents: GcalNormalizedEvent[] = [];
    for (const entry of Object.values(cache)) allEvents.push(...entry.events);
    return mergeEventsByDate(allEvents, assignments, summaryRules);
  }, [cache, assignments, summaryRules]);

  const refresh = useCallback(() => {
    void syncNow(true);
  }, [syncNow]);

  return { blocksByDate, status, errorMessage, errorStatus, lastSyncedAt, refresh };
};
