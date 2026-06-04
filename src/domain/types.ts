export type MinuteOfDay = number;

export type DateString = string;

export type ProjectEnergy = 'low' | 'mid' | 'high';

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly monthlyBudget?: number;
  readonly monthlyBudgetOverrides?: Readonly<Record<string, number>>;
  readonly pinned: boolean;
  readonly energy: ProjectEnergy;
  /** YYYY-MM-DD. The first day the project is active (inclusive). undefined = no explicit start. */
  readonly startDate?: string;
  /** YYYY-MM-DD. The last day the project is active (inclusive). undefined = ongoing. */
  readonly endDate?: string;
};

/**
 * A project is active in a given YYYY-MM iff its lifetime range
 * [startDate, endDate] intersects the month. Either bound may be undefined
 * (= unbounded on that side). A project ending mid-month is still counted
 * active for the entire month (the user may log work up to the end date).
 */
export const isProjectActiveInMonth = (p: Project, ym: string): boolean => {
  if (p.endDate !== undefined && p.endDate.slice(0, 7) < ym) return false;
  if (p.startDate !== undefined && p.startDate.slice(0, 7) > ym) return false;
  return true;
};

/** Strict day-precision check. Used by allocation proposal to skip out-of-range days. */
export const isProjectActiveOnDate = (p: Project, date: string): boolean => {
  if (p.endDate !== undefined && date > p.endDate) return false;
  if (p.startDate !== undefined && date < p.startDate) return false;
  return true;
};

export type TaskTemplate = {
  readonly id: string;
  readonly label: string;
  readonly defaultDurationMin: number;
  readonly color?: string;
  readonly projectId?: string;
};

export type TimeBlock = {
  readonly id: string;
  readonly label: string;
  readonly start: MinuteOfDay;
  readonly durationMin: number;
  readonly templateId?: string;
  readonly projectId?: string;
  readonly source?: 'gcal';
  readonly gcalKey?: string; // assignments の lookup キー (単発は eventId、繰り返しは parent recurringEventId)
  readonly gcalRecurring?: true;
  /** 開始 N 分前に通知。複数指定可 (例: [1, 5])。undefined/[] = 通知なし、0 = 開始時。 */
  readonly notifyOffsetsMin?: readonly number[];
};

export type GcalAssignment = {
  readonly projectId?: string;
  readonly hidden?: true;
  readonly summary?: string; // 非表示中復元 UI で表示するため、最後に見た summary を保持
};

export type PlaceResult =
  | { ok: true }
  | { ok: false; reason: 'invalid'; message: string };
