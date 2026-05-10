import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateString, GcalAssignment, TimeBlock } from '../domain/types.js';
import { addMonths, yearMonthOf } from '../dates.js';
import {
  applyGcalSyncRunToStore,
  loadGcalEventsFromStore,
  isUsingTauriBackend,
} from '../storage.js';
import { fetchCountableEvents, GcalApiError } from './api.js';
import { mergeEventsByDate, type GcalSummaryRule } from './merge.js';
import { normalizedToRecord, recordToNormalized, reconcileEvents } from './persistence.js';
import type { GcalNormalizedEvent } from './types.js';

const SYNC_TTL_MS = 5 * 60 * 1000; // 5 分以内は自動再 fetch しない
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 分間隔の background sync

export type GcalSyncStatus = 'idle' | 'syncing' | 'error';

export type UseGcalSync = {
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly status: GcalSyncStatus;
  readonly errorMessage: string | null;
  readonly errorStatus: number | null;
  readonly lastSyncedAt: number | null;
  readonly refresh: () => void;
};

const monthRangeMs = (yearMonth: string): { readonly startMs: number; readonly endMs: number } => {
  const [yStr, mStr] = yearMonth.split('-');
  const y = parseInt(yStr ?? '1970', 10);
  const m = parseInt(mStr ?? '1', 10);
  return {
    startMs: new Date(y, m - 1, 1, 0, 0, 0, 0).getTime(),
    endMs: new Date(y, m, 1, 0, 0, 0, 0).getTime(),
  };
};

const generateRunId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const useGcalSync = (
  accessToken: string | null,
  currentDate: DateString,
  calendarId: string | null,
  assignments: Readonly<Record<string, GcalAssignment>>,
  summaryRules: Readonly<Record<string, GcalSummaryRule>>,
  requestSilentRefresh: () => Promise<string | null>,
): UseGcalSync => {
  const [events, setEvents] = useState<readonly GcalNormalizedEvent[]>([]);
  const [status, setStatus] = useState<GcalSyncStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // TTL is keyed by (calendarId, targetMonths) so changing the calendar or
  // navigating to a new month is not suppressed by a stale global timestamp.
  // lastSyncedAt (state) is still maintained for UI display.
  const lastSyncedKeyRef = useRef<string | null>(null);
  const lastSyncedAtForKeyRef = useRef<number | null>(null);
  const inflightRef = useRef<boolean>(false);

  const targetMonths = useMemo<readonly string[]>(() => {
    const cur = yearMonthOf(currentDate);
    const prev = yearMonthOf(addMonths(`${cur}-01`, -1));
    const next = yearMonthOf(addMonths(`${cur}-01`, 1));
    return [prev, cur, next];
  }, [currentDate]);

  // calendarId 変更時 / accessToken 取得時: DB から既存 events を読み込んで即時表示。
  // accessToken が null (未接続/切断中) のときは cached events を表示しない
  // (プライバシー上、切断後に予定が見え続けるのを避ける)。
  // DB のレコードは保持するので、再接続時に復元される。
  useEffect(() => {
    let cancelled = false;
    if (accessToken === null || accessToken.length === 0) {
      setEvents([]);
      return;
    }
    if (calendarId === null || calendarId.length === 0) {
      setEvents([]);
      setLastSyncedAt(null);
      setErrorMessage(null);
      setErrorStatus(null);
      return;
    }
    void (async () => {
      try {
        const records = await loadGcalEventsFromStore(calendarId);
        if (cancelled) return;
        setEvents(records.map(recordToNormalized));
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, calendarId]);

  const syncNow = useCallback(
    async (force: boolean): Promise<void> => {
      if (accessToken === null || accessToken.length === 0) return;
      if (calendarId === null || calendarId.length === 0) return;
      if (inflightRef.current) return;
      const currentKey = `${calendarId}|${targetMonths.join(',')}`;
      if (
        !force &&
        lastSyncedKeyRef.current === currentKey &&
        lastSyncedAtForKeyRef.current !== null &&
        Date.now() - lastSyncedAtForKeyRef.current < SYNC_TTL_MS
      ) {
        return;
      }

      inflightRef.current = true;
      setStatus('syncing');
      const runStartedAt = Date.now();
      const syncRunId = generateRunId();
      let currentToken = accessToken;

      // 3 ヶ月分 fetch を 1 batch 扱いにする。途中失敗したら applyGcalSyncRun は呼ばず再試行に回す。
      const allEvents: GcalNormalizedEvent[] = [];
      let aborted = false;
      let abortMessage: string | null = null;
      let abortStatus: number | null = null;

      const fetchOneMonth = async (ym: string, allowRefresh: boolean): Promise<void> => {
        const { startMs, endMs } = monthRangeMs(ym);
        try {
          const fetched = await fetchCountableEvents({
            accessToken: currentToken,
            calendarId,
            timeMin: new Date(startMs),
            timeMax: new Date(endMs),
          });
          for (const e of fetched) allEvents.push(e);
        } catch (e) {
          if (allowRefresh && e instanceof GcalApiError && e.status === 401) {
            const refreshed = await requestSilentRefresh();
            if (refreshed !== null && refreshed.length > 0) {
              currentToken = refreshed;
              await fetchOneMonth(ym, false);
              return;
            }
          }
          throw e;
        }
      };

      try {
        for (const ym of targetMonths) {
          await fetchOneMonth(ym, true);
        }
      } catch (e) {
        aborted = true;
        abortMessage = e instanceof GcalApiError ? e.message : (e instanceof Error ? e.message : String(e));
        abortStatus = e instanceof GcalApiError ? e.status : null;
      }

      if (aborted) {
        setErrorMessage(abortMessage);
        setErrorStatus(abortStatus);
        setStatus('error');
        inflightRef.current = false;
        return;
      }

      // window: 3ヶ月全体 (prev 月初 〜 next 月末)。月またがり event の片月 tombstone 事故を防ぐ。
      const firstYm = targetMonths[0];
      const lastYm = targetMonths[targetMonths.length - 1];
      if (firstYm === undefined || lastYm === undefined) {
        inflightRef.current = false;
        setStatus('idle');
        return;
      }
      const { startMs: timeMinMs } = monthRangeMs(firstYm);
      const { endMs: timeMaxMs } = monthRangeMs(lastYm);

      try {
        if (isUsingTauriBackend()) {
          await applyGcalSyncRunToStore({
            calendarId,
            syncRunId,
            runStartedAt,
            timeMinMs,
            timeMaxMs,
            events: allEvents.map(normalizedToRecord),
          });
          // DB から再 SELECT で active events を取得 (tombstone を除外、過去取り込み分も含む)
          const records = await loadGcalEventsFromStore(calendarId);
          setEvents(records.map(recordToNormalized));
        } else {
          // Browser 環境: DB なし。永続化なし、in-memory に reconciliation。
          setEvents((prev) => [...reconcileEvents(prev, allEvents, timeMinMs, timeMaxMs)]);
        }
        const now = Date.now();
        lastSyncedKeyRef.current = `${calendarId}|${targetMonths.join(',')}`;
        lastSyncedAtForKeyRef.current = now;
        setLastSyncedAt(now);
        setErrorMessage(null);
        setErrorStatus(null);
        setStatus('idle');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMessage(msg);
        setErrorStatus(null);
        setStatus('error');
      } finally {
        inflightRef.current = false;
      }
    },
    [accessToken, calendarId, targetMonths, requestSilentRefresh],
  );

  // accessToken / calendarId / targetMonths 変更時に sync (TTL 尊重)
  useEffect(() => {
    void syncNow(false);
  }, [syncNow]);

  // 15 分間隔の background sync
  useEffect(() => {
    if (accessToken === null || accessToken.length === 0) return;
    if (calendarId === null || calendarId.length === 0) return;
    const id = window.setInterval(() => {
      void syncNow(false);
    }, AUTO_SYNC_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [accessToken, calendarId, syncNow]);

  // visibility 復帰時 / online 復帰時 / focus 時に TTL 尊重で sync
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void syncNow(false);
    };
    const onOnline = (): void => {
      void syncNow(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onOnline);
    };
  }, [syncNow]);

  const blocksByDate = useMemo(
    () => mergeEventsByDate(events, assignments, summaryRules),
    [events, assignments, summaryRules],
  );

  const refresh = useCallback(() => {
    void syncNow(true);
  }, [syncNow]);

  return { blocksByDate, status, errorMessage, errorStatus, lastSyncedAt, refresh };
};
