import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysOfMonthGrid,
  daysOfWeek,
  monthsOfYear,
  weekStart,
  yearOf,
} from '../src/dates.js';

describe('weekStart', () => {
  it('returns the Monday for a Wednesday', () => {
    expect(weekStart('2026-05-06')).toBe('2026-05-04');
  });

  it('returns the same date for a Monday', () => {
    expect(weekStart('2026-05-04')).toBe('2026-05-04');
  });

  it('crosses month boundaries when Sunday is in previous month', () => {
    expect(weekStart('2026-06-07')).toBe('2026-06-01');
    expect(weekStart('2026-05-03')).toBe('2026-04-27');
  });

  it('handles year boundary (Jan 1 mid-week)', () => {
    expect(weekStart('2026-01-01')).toBe('2025-12-29');
  });

  it('Sunday returns previous Monday', () => {
    expect(weekStart('2026-05-10')).toBe('2026-05-04');
  });
});

describe('daysOfWeek', () => {
  it('returns 7 consecutive dates Mon..Sun', () => {
    const days = daysOfWeek('2026-05-06');
    expect(days).toEqual([
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
      '2026-05-10',
    ]);
  });
});

describe('daysOfMonthGrid', () => {
  it('always returns 42 entries', () => {
    expect(daysOfMonthGrid('2026-02').length).toBe(42);
    expect(daysOfMonthGrid('2026-05').length).toBe(42);
    expect(daysOfMonthGrid('2026-08').length).toBe(42);
  });

  it('starts on Monday', () => {
    const grid = daysOfMonthGrid('2026-05');
    const first = grid[0];
    expect(first).toBeDefined();
    expect(weekStart(first as string)).toBe(first);
  });

  it("includes month's first day", () => {
    expect(daysOfMonthGrid('2026-05').includes('2026-05-01')).toBe(true);
    expect(daysOfMonthGrid('2026-02').includes('2026-02-01')).toBe(true);
  });

  it('starts at or before the first day, ends at or after the last day', () => {
    const grid = daysOfMonthGrid('2026-05');
    expect((grid[0] as string) <= '2026-05-01').toBe(true);
    expect((grid[41] as string) >= '2026-05-31').toBe(true);
  });
});

describe('monthsOfYear', () => {
  it('returns 12 zero-padded yearMonth strings', () => {
    expect(monthsOfYear('2026')).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04',
      '2026-05', '2026-06', '2026-07', '2026-08',
      '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
  });
});

describe('addMonths', () => {
  it('adds months within the same year', () => {
    expect(addMonths('2026-03-15', 1)).toBe('2026-04-15');
    expect(addMonths('2026-03-15', 5)).toBe('2026-08-15');
  });

  it('subtracts months', () => {
    expect(addMonths('2026-03-15', -2)).toBe('2026-01-15');
  });

  it('crosses year boundary forward', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('crosses year boundary backward', () => {
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('clamps day to last day of target month (Jan 31 + 1 mo = Feb 28/29)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('does not drift on repeated calls when starting from first-of-month', () => {
    expect(addMonths('2026-01-01', 1)).toBe('2026-02-01');
    expect(addMonths(addMonths('2026-01-01', 1), 1)).toBe('2026-03-01');
  });

  it('zero is identity', () => {
    expect(addMonths('2026-05-09', 0)).toBe('2026-05-09');
  });
});

describe('yearOf', () => {
  it('extracts year', () => {
    expect(yearOf('2026-05-09')).toBe('2026');
  });
});
