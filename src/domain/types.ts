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
  /** 開始 N 分前に通知。undefined = 通知なし、0 = 開始時。 */
  readonly notifyOffsetMin?: number;
};

export type GcalAssignment = {
  readonly projectId?: string;
  readonly hidden?: true;
  readonly summary?: string; // 非表示中復元 UI で表示するため、最後に見た summary を保持
};

export type PlaceResult =
  | { ok: true }
  | { ok: false; reason: 'overlap'; conflictingBlockId: string }
  | { ok: false; reason: 'invalid'; message: string };
