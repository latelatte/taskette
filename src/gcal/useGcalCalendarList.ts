import { useEffect, useState } from 'react';
import { fetchCalendarList, GcalApiError } from './api.js';
import type { GcalCalendar } from './types.js';

export type GcalCalendarListStatus = 'idle' | 'loading' | 'loaded' | 'error';

export type UseGcalCalendarList = {
  readonly calendars: readonly GcalCalendar[];
  readonly status: GcalCalendarListStatus;
  readonly errorMessage: string | null;
};

export const useGcalCalendarList = (
  accessToken: string | null,
): UseGcalCalendarList => {
  const [calendars, setCalendars] = useState<readonly GcalCalendar[]>([]);
  const [status, setStatus] = useState<GcalCalendarListStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (accessToken === null || accessToken.length === 0) {
      setCalendars([]);
      setStatus('idle');
      setErrorMessage(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setErrorMessage(null);
    void fetchCalendarList(accessToken)
      .then((list) => {
        if (cancelled) return;
        setCalendars(list);
        setStatus('loaded');
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof GcalApiError ? e.message : (e instanceof Error ? e.message : String(e));
        setErrorMessage(msg);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return { calendars, status, errorMessage };
};
