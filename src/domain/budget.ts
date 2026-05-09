import type { Project } from './types.js';

export const HOURS_PER_PERSON_MONTH = 160;
export const TOLERANCE_HOURS_PER_PM = 20;
export const PROJECTION_MIN_ELAPSED = 0.2;

export type BudgetStatus =
  | 'over'
  | 'projectedOver'
  | 'underConfirmed'
  | 'projectedUnder'
  | 'ok'
  | 'noBudget';

export type BudgetUsage = {
  readonly status: BudgetStatus;
  readonly actualH: number;
  readonly actualPM: number;
  readonly budgetH: number | null;
  readonly lowH: number | null;
  readonly highH: number | null;
  readonly toleranceH: number;
  readonly projection: number | null;
  readonly ratio: number;
  readonly barFraction: number;
};

export const effectiveBudgetPM = (
  project: Project,
  yearMonth?: string,
): number | undefined => {
  if (yearMonth !== undefined && project.monthlyBudgetOverrides !== undefined) {
    const override = project.monthlyBudgetOverrides[yearMonth];
    if (override !== undefined) return override;
  }
  return project.monthlyBudget;
};

export const projectBudgetUsage = (
  project: Project,
  actualMinutes: number,
  elapsed: number,
  yearMonth?: string,
): BudgetUsage => {
  const actualH = actualMinutes / 60;
  const actualPM = actualH / HOURS_PER_PERSON_MONTH;
  const budgetPM = effectiveBudgetPM(project, yearMonth);

  if (budgetPM === undefined) {
    return {
      status: 'noBudget',
      actualH,
      actualPM,
      budgetH: null,
      lowH: null,
      highH: null,
      toleranceH: 0,
      projection: elapsed >= PROJECTION_MIN_ELAPSED ? actualH / elapsed : null,
      ratio: 0,
      barFraction: 0,
    };
  }

  const budgetH = budgetPM * HOURS_PER_PERSON_MONTH;
  const toleranceH = budgetPM * TOLERANCE_HOURS_PER_PM;
  const lowH = Math.max(0, budgetH - toleranceH);
  const highH = budgetH + toleranceH;
  const ratio = budgetH > 0 ? actualH / budgetH : 0;
  const barFraction = highH > 0 ? Math.min(1, actualH / highH) : 0;
  const projection = elapsed >= PROJECTION_MIN_ELAPSED ? actualH / elapsed : null;

  const isOver = actualH > highH;
  const isUnderConfirmed = elapsed >= 1 && actualH < lowH;
  const isProjectedOver = !isOver && projection !== null && projection > highH;
  const isProjectedUnder =
    !isUnderConfirmed && projection !== null && projection < lowH && elapsed < 1;

  const status: BudgetStatus = isOver
    ? 'over'
    : isProjectedOver
      ? 'projectedOver'
      : isUnderConfirmed
        ? 'underConfirmed'
        : isProjectedUnder
          ? 'projectedUnder'
          : 'ok';

  return {
    status,
    actualH,
    actualPM,
    budgetH,
    lowH,
    highH,
    toleranceH,
    projection,
    ratio,
    barFraction,
  };
};

const STATUS_PRIORITY: readonly BudgetStatus[] = [
  'over',
  'projectedOver',
  'underConfirmed',
  'projectedUnder',
  'ok',
  'noBudget',
];

export const worstBudgetStatus = (statuses: readonly BudgetStatus[]): BudgetStatus => {
  let worst: BudgetStatus = 'noBudget';
  let worstIdx = STATUS_PRIORITY.length - 1;
  for (const s of statuses) {
    const idx = STATUS_PRIORITY.indexOf(s);
    if (idx < worstIdx) {
      worst = s;
      worstIdx = idx;
    }
  }
  return worst;
};
