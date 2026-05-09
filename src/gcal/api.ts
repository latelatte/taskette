import type {
  GcalApiEvent,
  GcalApiListResponse,
  GcalCalendar,
  GcalCalendarListResponse,
  GcalNormalizedEvent,
} from './types.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

export type FetchEventsOptions = {
  readonly accessToken: string;
  readonly calendarId: string;
  readonly timeMin: Date;
  readonly timeMax: Date;
};

export class GcalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GcalApiError';
  }
}

const buildEventsUrl = (calendarId: string, params: Record<string, string>): string => {
  const url = new URL(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
};

const isMyAttendee = (a: { self?: boolean }): boolean => a.self === true;

// 工数集計に含めるべきイベントか判定
export const isCountableEvent = (e: GcalApiEvent): boolean => {
  if (e.status === 'cancelled') return false;
  if (e.transparency === 'transparent') return false;
  if (e.start?.dateTime === undefined || e.end?.dateTime === undefined) return false; // 終日は除外
  // 自分が辞退している場合は除外
  if (Array.isArray(e.attendees)) {
    const me = e.attendees.find(isMyAttendee);
    if (me?.responseStatus === 'declined') return false;
  }
  return true;
};

// API イベントを正規化形式に変換 (countable 前提)
export const normalizeEvent = (e: GcalApiEvent, calendarId: string): GcalNormalizedEvent | null => {
  const startStr = e.start?.dateTime;
  const endStr = e.end?.dateTime;
  if (startStr === undefined || endStr === undefined) return null;
  const startMs = Date.parse(startStr);
  const endMs = Date.parse(endStr);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const isRecurring = e.recurringEventId !== undefined && e.recurringEventId.length > 0;
  // 繰り返しは親 ID で 1 件管理 → 同シリーズ全インスタンスに projectId を一括継承
  const assignmentKey = isRecurring
    ? `${calendarId}|R:${e.recurringEventId!}`
    : `${calendarId}|${e.id}`;
  return {
    calendarId,
    eventId: e.id,
    key: `${calendarId}|${e.id}`,
    assignmentKey,
    isRecurring,
    summary: e.summary !== undefined && e.summary.length > 0 ? e.summary : '(タイトルなし)',
    startMs,
    endMs,
    htmlLink: e.htmlLink,
  };
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const fetchOnce = async (url: string, accessToken: string): Promise<GcalApiListResponse> => {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new GcalApiError('認証エラー — 再接続してください', resp.status, false);
  }
  if (resp.status === 410) {
    throw new GcalApiError('同期トークンが失効しました', 410, false);
  }
  if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
    throw new GcalApiError(`リトライ可能なエラー (HTTP ${resp.status})`, resp.status, true);
  }
  if (!resp.ok) {
    throw new GcalApiError(`Gcal API エラー (HTTP ${resp.status})`, resp.status, false);
  }
  return (await resp.json()) as GcalApiListResponse;
};

const fetchWithRetry = async (
  url: string,
  accessToken: string,
  maxRetries: number = 2,
): Promise<GcalApiListResponse> => {
  let attempt = 0;
  while (true) {
    try {
      return await fetchOnce(url, accessToken);
    } catch (e) {
      if (e instanceof GcalApiError && e.retryable && attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      throw e;
    }
  }
};

export const fetchCalendarList = async (
  accessToken: string,
): Promise<readonly GcalCalendar[]> => {
  const url = `${API_BASE}/users/me/calendarList?minAccessRole=reader`;
  const data = (await fetchWithRetry(url, accessToken)) as unknown as GcalCalendarListResponse;
  if (!Array.isArray(data.items)) return [];
  return data.items
    .filter((c) => c.deleted !== true)
    .map((c) => ({
      id: c.id,
      displayName: c.summaryOverride ?? c.summary ?? c.id,
      backgroundColor: c.backgroundColor,
      isPrimary: c.primary === true,
    }));
};

export const fetchCountableEvents = async (
  opts: FetchEventsOptions,
): Promise<readonly GcalNormalizedEvent[]> => {
  const out: GcalNormalizedEvent[] = [];
  let pageToken: string | undefined;
  let safety = 0;
  do {
    if (safety++ > 20) throw new GcalApiError('ページング上限を超えました', 0, false);
    const params: Record<string, string> = {
      timeMin: opts.timeMin.toISOString(),
      timeMax: opts.timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    };
    if (pageToken !== undefined) params.pageToken = pageToken;
    const url = buildEventsUrl(opts.calendarId, params);
    const data = await fetchWithRetry(url, opts.accessToken);
    if (Array.isArray(data.items)) {
      for (const e of data.items) {
        if (!isCountableEvent(e)) continue;
        const n = normalizeEvent(e, opts.calendarId);
        if (n !== null) out.push(n);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken !== undefined);
  return out;
};
