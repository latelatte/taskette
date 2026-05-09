export type MinuteOfDay = number;

export type DateString = string;

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
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
};

export type PlaceResult =
  | { ok: true }
  | { ok: false; reason: 'overlap'; conflictingBlockId: string }
  | { ok: false; reason: 'invalid'; message: string };
