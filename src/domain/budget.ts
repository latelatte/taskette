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
  /** 月末予測 = 実績 + 残りの予定 (= 予定込み合計)。終了済み案件は null。 */
  readonly projection: number | null;
  readonly ratio: number;
  readonly barFraction: number;
  /** 予定込みのバー長 (barFraction と同じ highH 基準)。 */
  readonly plannedBarFraction: number;
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
  plannedMinutes: number,
  elapsed: number,
  yearMonth?: string,
  today?: string,
): BudgetUsage => {
  const actualH = actualMinutes / 60;
  const plannedH = Math.max(actualH, plannedMinutes / 60);
  const actualPM = actualH / HOURS_PER_PERSON_MONTH;
  const budgetPM = effectiveBudgetPM(project, yearMonth);

  // A finalized project (already past its endDate) gets final-tally treatment:
  // projection-based statuses make no sense once no more work will be logged.
  const isFinalized = today !== undefined
    && project.endDate !== undefined
    && project.endDate < today;
  const effectiveElapsed = isFinalized ? 1 : elapsed;
  const projection = isFinalized ? null : plannedH;

  if (budgetPM === undefined) {
    return {
      status: 'noBudget',
      actualH,
      actualPM,
      budgetH: null,
      lowH: null,
      highH: null,
      toleranceH: 0,
      projection,
      ratio: 0,
      barFraction: 0,
      plannedBarFraction: 0,
    };
  }

  const budgetH = budgetPM * HOURS_PER_PERSON_MONTH;
  const toleranceH = budgetPM * TOLERANCE_HOURS_PER_PM;
  const lowH = Math.max(0, budgetH - toleranceH);
  const highH = budgetH + toleranceH;
  const ratio = budgetH > 0 ? actualH / budgetH : 0;
  const barFraction = highH > 0 ? Math.min(1, actualH / highH) : 0;
  const plannedBarFraction = highH > 0 ? Math.min(1, plannedH / highH) : 0;

  const isOver = actualH > highH;
  const isUnderConfirmed = effectiveElapsed >= 1 && actualH < lowH;
  const isProjectedOver = !isOver && projection !== null && projection > highH;
  // 月初は残りの予定がまだ入っていないのが普通なので、不足見込みは一定経過後のみ。
  const isProjectedUnder =
    !isUnderConfirmed
    && projection !== null
    && projection < lowH
    && elapsed >= PROJECTION_MIN_ELAPSED
    && effectiveElapsed < 1;

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
    plannedBarFraction,
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
