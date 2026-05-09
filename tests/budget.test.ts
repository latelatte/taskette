import { describe, expect, it } from 'vitest';
import {
  effectiveBudgetPM,
  projectBudgetUsage,
  worstBudgetStatus,
  HOURS_PER_PERSON_MONTH,
  TOLERANCE_HOURS_PER_PM,
} from '../src/domain/budget.js';
import type { Project } from '../src/domain/types.js';

const proj = (monthlyBudget?: number): Project => ({
  id: 'p1',
  name: 'A',
  color: '#000',
  ...(monthlyBudget !== undefined ? { monthlyBudget } : {}),
});

const minutes = (h: number) => h * 60;

describe('projectBudgetUsage', () => {
  it('returns noBudget when project has no monthlyBudget', () => {
    const u = projectBudgetUsage(proj(), minutes(50), 0.5);
    expect(u.status).toBe('noBudget');
    expect(u.budgetH).toBe(null);
    expect(u.lowH).toBe(null);
    expect(u.highH).toBe(null);
    expect(u.actualH).toBe(50);
  });

  it('ok within tolerance band mid-month', () => {
    // budget = 1 PM = 160h, tolerance = ±20h, low=140, high=180
    // 80h actual at elapsed=0.5 → projection 160h, within band
    const u = projectBudgetUsage(proj(1), minutes(80), 0.5);
    expect(u.status).toBe('ok');
    expect(u.budgetH).toBe(HOURS_PER_PERSON_MONTH);
    expect(u.lowH).toBe(HOURS_PER_PERSON_MONTH - TOLERANCE_HOURS_PER_PM);
    expect(u.highH).toBe(HOURS_PER_PERSON_MONTH + TOLERANCE_HOURS_PER_PM);
    expect(u.projection).toBe(160);
  });

  it('over when actualH > highH', () => {
    // 1 PM, actual 200h > high 180h
    const u = projectBudgetUsage(proj(1), minutes(200), 0.9);
    expect(u.status).toBe('over');
    expect(u.barFraction).toBe(1);
  });

  it('underConfirmed when month end and actualH < lowH', () => {
    // 1 PM, actual 100h < low 140h, elapsed=1
    const u = projectBudgetUsage(proj(1), minutes(100), 1);
    expect(u.status).toBe('underConfirmed');
  });

  it('projectedOver when projection > highH but not yet over', () => {
    // 1 PM, actual 100h at elapsed=0.5 → projection 200h > high 180h
    const u = projectBudgetUsage(proj(1), minutes(100), 0.5);
    expect(u.status).toBe('projectedOver');
    expect(u.projection).toBe(200);
  });

  it('projectedUnder when projection < lowH and elapsed < 1', () => {
    // 1 PM, actual 50h at elapsed=0.5 → projection 100h < low 140h
    const u = projectBudgetUsage(proj(1), minutes(50), 0.5);
    expect(u.status).toBe('projectedUnder');
    expect(u.projection).toBe(100);
  });

  it('projection is null when elapsed below threshold (0.2)', () => {
    const u = projectBudgetUsage(proj(1), minutes(10), 0.1);
    expect(u.projection).toBe(null);
    expect(u.status).toBe('ok');
  });

  it('barFraction caps at 1', () => {
    const u = projectBudgetUsage(proj(1), minutes(500), 1);
    expect(u.barFraction).toBe(1);
  });

  it('actualPM converts hours to person-months', () => {
    const u = projectBudgetUsage(proj(1), minutes(80), 0.5);
    expect(u.actualPM).toBe(0.5);
  });

  it('lowH clamps to 0 for tiny budgets', () => {
    // 0.05 PM = 8h budget, tolerance 1h, low = 7, high = 9
    const u = projectBudgetUsage(proj(0.05), minutes(8), 0.5);
    expect(u.lowH).toBe(7);
    expect(u.highH).toBe(9);
  });

  it('over takes priority over projection-based statuses', () => {
    // already over with high projection too
    const u = projectBudgetUsage(proj(1), minutes(200), 0.5);
    expect(u.status).toBe('over');
  });

  it('underConfirmed only fires at month end (elapsed >= 1)', () => {
    // mid-month, actual very low → projectedUnder, not underConfirmed
    const u = projectBudgetUsage(proj(1), minutes(10), 0.5);
    expect(u.status).toBe('projectedUnder');
  });
});

describe('effectiveBudgetPM', () => {
  const projWithOverride = (
    base?: number,
    overrides?: Record<string, number>,
  ): Project => ({
    id: 'p1',
    name: 'A',
    color: '#000',
    ...(base !== undefined ? { monthlyBudget: base } : {}),
    ...(overrides !== undefined ? { monthlyBudgetOverrides: overrides } : {}),
  });

  it('returns monthlyBudget when no override set', () => {
    expect(effectiveBudgetPM(projWithOverride(1.0), '2026-05')).toBe(1.0);
  });

  it('returns undefined when no budget and no override', () => {
    expect(effectiveBudgetPM(projWithOverride(), '2026-05')).toBe(undefined);
  });

  it('returns override for matching month', () => {
    expect(effectiveBudgetPM(projWithOverride(1.0, { '2026-05': 1.2 }), '2026-05')).toBe(1.2);
  });

  it('falls back to monthlyBudget when override is for a different month', () => {
    expect(effectiveBudgetPM(projWithOverride(1.0, { '2026-04': 1.5 }), '2026-05')).toBe(1.0);
  });

  it('returns override even when no base monthlyBudget', () => {
    expect(effectiveBudgetPM(projWithOverride(undefined, { '2026-05': 0.8 }), '2026-05')).toBe(0.8);
  });

  it('returns monthlyBudget when yearMonth is undefined', () => {
    expect(effectiveBudgetPM(projWithOverride(1.0, { '2026-05': 1.2 }))).toBe(1.0);
  });
});

describe('projectBudgetUsage with override', () => {
  const projWithOverride = (
    base: number,
    overrides: Record<string, number>,
  ): Project => ({
    id: 'p1',
    name: 'A',
    color: '#000',
    monthlyBudget: base,
    monthlyBudgetOverrides: overrides,
  });

  it('uses override when yearMonth matches', () => {
    // base=1PM (160h), override 2026-05 → 0.5PM (80h, low=70, high=90)
    // actual=100h at elapsed=1 → over
    const u = projectBudgetUsage(
      projWithOverride(1, { '2026-05': 0.5 }),
      minutes(100),
      1,
      '2026-05',
    );
    expect(u.budgetH).toBe(80);
    expect(u.status).toBe('over');
  });

  it('uses base monthlyBudget when yearMonth does not match', () => {
    // base=1PM (160h, high=180), override only for 2026-04
    // actual=100h at elapsed=1 → underConfirmed (low=140)
    const u = projectBudgetUsage(
      projWithOverride(1, { '2026-04': 0.5 }),
      minutes(100),
      1,
      '2026-05',
    );
    expect(u.budgetH).toBe(160);
    expect(u.status).toBe('underConfirmed');
  });
});

describe('worstBudgetStatus', () => {
  it('returns noBudget for empty input', () => {
    expect(worstBudgetStatus([])).toBe('noBudget');
  });

  it('over wins over everything', () => {
    expect(worstBudgetStatus(['ok', 'over', 'projectedUnder'])).toBe('over');
  });

  it('projectedOver wins over under-side and ok', () => {
    expect(worstBudgetStatus(['ok', 'projectedOver', 'projectedUnder'])).toBe('projectedOver');
  });

  it('underConfirmed wins over projectedUnder', () => {
    expect(worstBudgetStatus(['underConfirmed', 'projectedUnder', 'ok'])).toBe('underConfirmed');
  });

  it('all ok stays ok', () => {
    expect(worstBudgetStatus(['ok', 'ok', 'ok'])).toBe('ok');
  });

  it('mix of ok and noBudget returns ok (presence of any tracked project)', () => {
    expect(worstBudgetStatus(['noBudget', 'ok', 'noBudget'])).toBe('ok');
  });

  it('all noBudget returns noBudget', () => {
    expect(worstBudgetStatus(['noBudget', 'noBudget'])).toBe('noBudget');
  });
});
