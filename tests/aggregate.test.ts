import { describe, expect, it } from 'vitest';
import { aggregateDaily, aggregateMonthly } from '../src/domain/aggregate.js';
import type { DateString, TimeBlock } from '../src/domain/types.js';

const tb = (id: string, durationMin: number, projectId?: string): TimeBlock => ({
  id,
  label: id,
  start: 540,
  durationMin,
  ...(projectId !== undefined ? { projectId } : {}),
});

describe('aggregateMonthly', () => {
  const data: Record<DateString, readonly TimeBlock[]> = {
    '2026-05-01': [tb('a', 60, 'p1'), tb('b', 30, 'p2')],
    '2026-05-15': [tb('c', 90, 'p1'), tb('d', 30)],
    '2026-04-30': [tb('e', 60, 'p1')],
    '2026-06-01': [tb('f', 45, 'p2')],
  };

  it('sums per-project minutes for the given month', () => {
    const r = aggregateMonthly(data, '2026-05');
    expect(r.byProject.get('p1')).toBe(150);
    expect(r.byProject.get('p2')).toBe(30);
  });

  it('accumulates unassigned (no projectId) blocks separately', () => {
    const r = aggregateMonthly(data, '2026-05');
    expect(r.unassigned).toBe(30);
  });

  it('ignores dates outside the month', () => {
    const r = aggregateMonthly(data, '2026-04');
    expect(r.byProject.get('p1')).toBe(60);
    expect(r.byProject.has('p2')).toBe(false);
    expect(r.unassigned).toBe(0);
  });

  it('returns empty result when no data for the month', () => {
    const r = aggregateMonthly(data, '2026-07');
    expect(r.byProject.size).toBe(0);
    expect(r.unassigned).toBe(0);
  });

  it('treats date prefixes strictly (2026-05 must not match 2026-050X if such existed)', () => {
    // Using the prefix `${yearMonth}-` ensures 2026-05 only matches 2026-05-DD, not arbitrary.
    const r = aggregateMonthly({ '2026-053': [tb('x', 10, 'p1')] }, '2026-05');
    expect(r.byProject.size).toBe(0);
  });
});

describe('aggregateDaily', () => {
  const data: Record<DateString, readonly TimeBlock[]> = {
    '2026-05-09': [tb('a', 60, 'p1'), tb('b', 30, 'p2'), tb('c', 30)],
    '2026-05-10': [tb('d', 90, 'p1')],
  };

  it('sums per-project minutes for the given day only', () => {
    const r = aggregateDaily(data, '2026-05-09');
    expect(r.byProject.get('p1')).toBe(60);
    expect(r.byProject.get('p2')).toBe(30);
    expect(r.unassigned).toBe(30);
  });

  it('returns empty for a date with no blocks', () => {
    const r = aggregateDaily(data, '2026-05-11');
    expect(r.byProject.size).toBe(0);
    expect(r.unassigned).toBe(0);
  });
});
