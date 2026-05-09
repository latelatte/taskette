import type { DateString, TimeBlock } from './types.js';

export type Aggregate = {
  readonly byProject: ReadonlyMap<string, number>;
  readonly unassigned: number;
};

const accumulate = (blocks: readonly TimeBlock[]): Aggregate => {
  const byProject = new Map<string, number>();
  let unassigned = 0;
  for (const b of blocks) {
    if (b.projectId === undefined) {
      unassigned += b.durationMin;
    } else {
      byProject.set(b.projectId, (byProject.get(b.projectId) ?? 0) + b.durationMin);
    }
  }
  return { byProject, unassigned };
};

export const aggregateMonthly = (
  blocksByDate: Record<DateString, readonly TimeBlock[]>,
  yearMonth: string,
): Aggregate => {
  const prefix = `${yearMonth}-`;
  const all: TimeBlock[] = [];
  for (const [date, blocks] of Object.entries(blocksByDate)) {
    if (date.startsWith(prefix)) all.push(...blocks);
  }
  return accumulate(all);
};

export const aggregateDaily = (
  blocksByDate: Record<DateString, readonly TimeBlock[]>,
  date: DateString,
): Aggregate => accumulate(blocksByDate[date] ?? []);
