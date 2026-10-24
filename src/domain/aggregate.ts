import type { DateString, TimeBlock } from './types.js';

export type Aggregate = {
  readonly byProject: ReadonlyMap<string, number>;
  readonly unassigned: number;
};

/** 実績だけを集計するときの打ち切り時刻。当日のブロックは経過した分だけ数える。 */
export type Cutoff = {
  readonly date: DateString;
  readonly minute: number;
};

const countedMinutes = (b: TimeBlock, date: DateString, cutoff: Cutoff | undefined): number => {
  if (cutoff === undefined || date < cutoff.date) return b.durationMin;
  if (date > cutoff.date) return 0;
  return Math.min(b.durationMin, Math.max(0, cutoff.minute - b.start));
};

const accumulate = (
  days: ReadonlyArray<readonly [DateString, readonly TimeBlock[]]>,
  cutoff?: Cutoff,
): Aggregate => {
  const byProject = new Map<string, number>();
  let unassigned = 0;
  for (const [date, blocks] of days) {
    for (const b of blocks) {
      const min = countedMinutes(b, date, cutoff);
      if (b.projectId === undefined) {
        unassigned += min;
      } else {
        byProject.set(b.projectId, (byProject.get(b.projectId) ?? 0) + min);
      }
    }
  }
  return { byProject, unassigned };
};

export const aggregateMonthly = (
  blocksByDate: Record<DateString, readonly TimeBlock[]>,
  yearMonth: string,
  cutoff?: Cutoff,
): Aggregate => {
  const prefix = `${yearMonth}-`;
  return accumulate(
    Object.entries(blocksByDate).filter(([date]) => date.startsWith(prefix)),
    cutoff,
  );
};

export const aggregateDaily = (
  blocksByDate: Record<DateString, readonly TimeBlock[]>,
  date: DateString,
): Aggregate => accumulate([[date, blocksByDate[date] ?? []]]);
