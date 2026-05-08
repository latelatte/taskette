export type MinuteOfDay = number;

export type DateString = string;

export type TaskTemplate = {
  readonly id: string;
  readonly label: string;
  readonly defaultDurationMin: number;
  readonly color?: string;
  readonly category?: string;
};

export type TimeBlock = {
  readonly id: string;
  readonly label: string;
  readonly start: MinuteOfDay;
  readonly durationMin: number;
  readonly templateId?: string;
};

export type PlaceResult =
  | { ok: true }
  | { ok: false; reason: 'overlap'; conflictingBlockId: string }
  | { ok: false; reason: 'invalid'; message: string };
