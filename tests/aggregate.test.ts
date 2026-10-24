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

describe('aggregateMonthly with cutoff', () => {
  const at = (id: string, start: number, durationMin: number, projectId?: string): TimeBlock => ({
    id,
    label: id,
    start,
    durationMin,
    ...(projectId !== undefined ? { projectId } : {}),
  });
  const data: Record<DateString, readonly TimeBlock[]> = {
    '2026-05-09': [at('past', 540, 60, 'p1')],
    // today 10:30 cutoff: 9:00-10:00 done, 10:00-11:00 half done, 13:00 not started
    '2026-05-10': [at('done', 540, 60, 'p1'), at('running', 600, 60, 'p1'), at('later', 780, 60)],
    '2026-05-11': [at('future', 540, 120, 'p1')],
  };

  it('counts past days fully, today up to the cutoff, and skips future days', () => {
    const a = aggregateMonthly(data, '2026-05', { date: '2026-05-10', minute: 630 });
    expect(a.byProject.get('p1')).toBe(60 + 60 + 30);
    expect(a.unassigned).toBe(0);
  });

  it('includes everything without a cutoff', () => {
    const a = aggregateMonthly(data, '2026-05');
    expect(a.byProject.get('p1')).toBe(60 + 60 + 60 + 120);
    expect(a.unassigned).toBe(60);
  });
});
