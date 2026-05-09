// Google Calendar API の events.list レスポンスから必要なフィールドだけを抜き出した型
export type GcalApiEventDateTime = {
  readonly dateTime?: string; // RFC3339
  readonly date?: string; // YYYY-MM-DD (終日)
  readonly timeZone?: string;
};

export type GcalApiAttendee = {
  readonly email?: string;
  readonly self?: boolean;
  readonly responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
};

export type GcalApiEvent = {
  readonly id: string;
  readonly status?: 'confirmed' | 'tentative' | 'cancelled';
  readonly summary?: string;
  readonly start?: GcalApiEventDateTime;
  readonly end?: GcalApiEventDateTime;
  readonly transparency?: 'opaque' | 'transparent';
  readonly attendees?: readonly GcalApiAttendee[];
  readonly eventType?: string;
  readonly recurringEventId?: string;
  readonly htmlLink?: string;
  readonly updated?: string;
};

export type GcalApiListResponse = {
  readonly items?: readonly GcalApiEvent[];
  readonly nextPageToken?: string;
  readonly nextSyncToken?: string;
};

// CalendarList API のエントリ
export type GcalCalendarListEntry = {
  readonly id: string;
  readonly summary?: string;
  readonly summaryOverride?: string;
  readonly backgroundColor?: string;
  readonly primary?: boolean;
  readonly accessRole?: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  readonly selected?: boolean;
  readonly deleted?: boolean;
};

export type GcalCalendarListResponse = {
  readonly items?: readonly GcalCalendarListEntry[];
  readonly nextPageToken?: string;
};

// 表示用に正規化したカレンダー情報
export type GcalCalendar = {
  readonly id: string;
  readonly displayName: string;
  readonly backgroundColor: string | undefined;
  readonly isPrimary: boolean;
};

// taskette アプリが扱う正規化済みイベント
export type GcalNormalizedEvent = {
  readonly calendarId: string;
  readonly eventId: string;
  readonly key: string; // "calendarId|eventId" 形式の一意キー (デバッグ・参照用)
  readonly assignmentKey: string; // assignments の lookup キー: 単発は eventId、繰り返しは parent recurringEventId
  readonly isRecurring: boolean;
  readonly recurringEventId: string | undefined; // 繰り返しの親 ID。永続化からの復元時に assignmentKey を再生成するために保持
  readonly summary: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly htmlLink: string | undefined;
};
