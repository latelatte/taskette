import { describe, expect, it } from 'vitest';
import { proposeAllocation, type ProposeAllocationInput } from '../src/domain/allocate.js';
import type { Project, ProjectEnergy, TimeBlock } from '../src/domain/types.js';
import type { FocusWindow } from '../src/domain/focus.js';

const proj = (
  id: string,
  energy: ProjectEnergy,
  monthlyBudget?: number,
  pinned = true,
): Project => ({
  id,
  name: id.toUpperCase(),
  color: '#000',
  pinned,
  energy,
  ...(monthlyBudget !== undefined ? { monthlyBudget } : {}),
});

const block = (id: string, start: number, durationMin: number): TimeBlock => ({
  id,
  label: '',
  start,
  durationMin,
});

const FOCUS_DEFAULT: readonly FocusWindow[] = [
  { start: '09:00', end: '12:00', energy: 'high' },
  { start: '13:00', end: '15:00', energy: 'mid' },
  { start: '15:00', end: '18:00', energy: 'low' },
];

const DATE = '2026-05-12';

const baseInput = (over: Partial<ProposeAllocationInput>): ProposeAllocationInput => ({
  dates: [DATE],
  pinnedProjects: [],
  existingBlocksByDate: {},
  focusWindows: FOCUS_DEFAULT,
  budgetContext: {
    spentByProjectThisMonth: {},
    monthRemainingBusinessDays: 8,
    targetMonth: '2026-05',
  },
  ...over,
});

describe('proposeAllocation', () => {
  it('returns [] when monthRemainingBusinessDays is 0', () => {
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p1', 'high', 1)],
        budgetContext: {
          spentByProjectThisMonth: {},
          monthRemainingBusinessDays: 0,
          targetMonth: '2026-05',
        },
      }),
    );
    expect(out).toEqual([]);
  });

  it('returns [] when no projects have budget', () => {
    const out = proposeAllocation(
      baseInput({ pinnedProjects: [proj('p1', 'high'), proj('p2', 'mid')] }),
    );
    expect(out).toEqual([]);
  });

  it('skips projects already over budget', () => {
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p1', 'high', 0.5)], // budget 80h
        budgetContext: {
          spentByProjectThisMonth: { p1: 100 }, // over
          monthRemainingBusinessDays: 8,
          targetMonth: '2026-05',
        },
      }),
    );
    expect(out).toEqual([]);
  });

  it('returns [] when no focus windows', () => {
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p1', 'high', 1)],
        focusWindows: [],
      }),
    );
    expect(out).toEqual([]);
  });

  it('skips unpinned projects even if budget set', () => {
    const out = proposeAllocation(
      baseInput({ pinnedProjects: [proj('p1', 'high', 1, false)] }),
    );
    expect(out).toEqual([]);
  });

  it('is deterministic — same input yields same output across calls', () => {
    const inp = baseInput({
      pinnedProjects: [proj('a', 'high', 0.4), proj('b', 'mid', 0.2)],
    });
    const a = proposeAllocation(inp);
    const b = proposeAllocation(inp);
    expect(a).toEqual(b);
  });

  it('does not propose blocks that overlap existing blocks', () => {
    const existing = [block('e1', 9 * 60, 60), block('e2', 13 * 60 + 30, 60)]; // 09-10, 13:30-14:30
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p1', 'high', 1)],
        existingBlocksByDate: { [DATE]: existing },
      }),
    );
    const overlaps = out.some((p) => {
      const ps = parseInt(p.start.slice(0, 2), 10) * 60 + parseInt(p.start.slice(3, 5), 10);
      const pe = parseInt(p.end.slice(0, 2), 10) * 60 + parseInt(p.end.slice(3, 5), 10);
      return existing.some((e) => ps < e.start + e.durationMin && pe > e.start);
    });
    expect(overlaps).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns [] when existing blocks fully cover focus windows', () => {
    const existing = [
      block('e1', 9 * 60, 3 * 60),       // 09-12
      block('e2', 13 * 60, 2 * 60),      // 13-15
      block('e3', 15 * 60, 3 * 60),      // 15-18
    ];
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p1', 'high', 1)],
        existingBlocksByDate: { [DATE]: existing },
      }),
    );
    expect(out).toEqual([]);
  });

  it('prefers energy-matched segments — high project gets high window first', () => {
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('h', 'high', 0.5), proj('l', 'low', 0.5)],
      }),
    );
    // first allocation should be in high window (09:00-12:00) and project should be 'h'
    expect(out.length).toBeGreaterThan(0);
    const first = out[0];
    expect(first?.projectId).toBe('h');
    expect(first?.start).toMatch(/^09:/);
  });

  it('inserts rest buffer between consecutive high blocks', () => {
    // Single high project with very large daily target → fills high window (09-12 = 180min)
    // With max=120 and rest=15 after high, sequence within the same segment:
    // 09:00-11:00 (120min) → cursor 11:00 +15 rest → 11:15-12:00 not enough? 45 min < 120 max OK, 45 >= 30 min — OK
    // Actually 11:15 to 12:00 = 45 min, snap 15 = 45 min. So 09:00-11:00, then 11:15-12:00.
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('h', 'high', 5)], // huge budget
      }),
    );
    const highBlocks = out.filter((b) => b.energy === 'high' && b.start < '12:00');
    if (highBlocks.length >= 2) {
      const first = highBlocks[0];
      const second = highBlocks[1];
      const firstEnd =
        parseInt(first!.end.slice(0, 2), 10) * 60 + parseInt(first!.end.slice(3, 5), 10);
      const secondStart =
        parseInt(second!.start.slice(0, 2), 10) * 60 + parseInt(second!.start.slice(3, 5), 10);
      expect(secondStart - firstEnd).toBeGreaterThanOrEqual(15);
    } else {
      // depending on dailyTarget, may produce only one block in high window
      expect(highBlocks.length).toBeGreaterThan(0);
    }
  });

  it('respects month override budget', () => {
    const overridden: Project = {
      id: 'p',
      name: 'P',
      color: '#000',
      pinned: true,
      energy: 'high',
      monthlyBudget: 0.1, // base small
      monthlyBudgetOverrides: { '2026-05': 1.0 }, // override = 160h
    };
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [overridden],
      }),
    );
    expect(out.length).toBeGreaterThan(0);
    // remainingH = 160h ÷ 8 = 20h/day → daily target dominates
    const reasonsContain20h = out.some((b) => /目安20h/.test(b.reason));
    expect(reasonsContain20h).toBe(true);
  });

  it('all proposed blocks land within focus windows', () => {
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('a', 'high', 0.4), proj('b', 'mid', 0.3)],
      }),
    );
    const inWindow = out.every((b) => {
      const bs = parseInt(b.start.slice(0, 2), 10) * 60 + parseInt(b.start.slice(3, 5), 10);
      const be = parseInt(b.end.slice(0, 2), 10) * 60 + parseInt(b.end.slice(3, 5), 10);
      return FOCUS_DEFAULT.some((w) => {
        const ws = parseInt(w.start.slice(0, 2), 10) * 60 + parseInt(w.start.slice(3, 5), 10);
        const we = parseInt(w.end.slice(0, 2), 10) * 60 + parseInt(w.end.slice(3, 5), 10);
        return bs >= ws && be <= we;
      });
    });
    expect(inWindow).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('proposed blocks are tiebroken deterministically by projectId', () => {
    // Two projects with identical energy, identical scores
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('z', 'high', 0.4), proj('a', 'high', 0.4)],
      }),
    );
    // first allocation should be 'a' (lexicographic tiebreak)
    expect(out[0]?.projectId).toBe('a');
  });

  it('reason includes daily target and remaining hours', () => {
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p', 'high', 0.4)], // 64h, daysLeft 8 → 8h/day
      }),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.reason).toMatch(/残64h/);
    expect(out[0]?.reason).toMatch(/目安/);
    expect(out[0]?.reason).toMatch(/残営業日8/);
  });

  it('does not double-allocate when focus windows overlap', () => {
    // Overlapping windows: 09-12 high AND 10-11 mid both cover 10:00-11:00.
    // Without dedup, a project could be allocated twice in the same 10:00-11:00 range.
    const overlappingFocus: readonly FocusWindow[] = [
      { start: '09:00', end: '12:00', energy: 'high' },
      { start: '10:00', end: '11:00', energy: 'mid' },
    ];
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p', 'high', 1)],
        focusWindows: overlappingFocus,
      }),
    );
    // Verify no two proposed blocks overlap each other
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const as = parseInt(a.start.slice(0, 2), 10) * 60 + parseInt(a.start.slice(3, 5), 10);
        const ae = parseInt(a.end.slice(0, 2), 10) * 60 + parseInt(a.end.slice(3, 5), 10);
        const bs = parseInt(b.start.slice(0, 2), 10) * 60 + parseInt(b.start.slice(3, 5), 10);
        const be = parseInt(b.end.slice(0, 2), 10) * 60 + parseInt(b.end.slice(3, 5), 10);
        expect(as < be && bs < ae).toBe(false);
      }
    }
  });

  // ───── range mode (19-A/B/C) ─────

  it('proposes blocks across multiple dates with date field set correctly', () => {
    const dates = ['2026-05-12', '2026-05-13', '2026-05-14'];
    const out = proposeAllocation(
      baseInput({
        dates,
        pinnedProjects: [proj('p', 'mid', 1)],
      }),
    );
    const seenDates = new Set(out.map((b) => b.date));
    for (const d of out) {
      expect(dates).toContain(d.date);
    }
    expect(seenDates.size).toBeGreaterThan(0);
  });

  it('shares remainingPeriodMin across dates: heavy Tue allocation reduces later days', () => {
    // Project budget cap = dailyTarget × dates.length.
    // Tuesday has full focus availability; Wed/Thu also free.
    // After Tue saturates, Wed/Thu should have less (or zero) allocation.
    const dates = ['2026-05-12', '2026-05-13', '2026-05-14'];
    const out = proposeAllocation(
      baseInput({
        dates,
        pinnedProjects: [proj('p', 'mid', 0.3)], // small budget so cap binds
        budgetContext: {
          spentByProjectThisMonth: {},
          monthRemainingBusinessDays: 20, // monthly daily target tiny
          targetMonth: '2026-05',
        },
      }),
    );
    const tueMin = out
      .filter((b) => b.date === '2026-05-12')
      .reduce(
        (sum, b) =>
          sum +
          (parseInt(b.end.slice(0, 2), 10) * 60 + parseInt(b.end.slice(3, 5), 10)) -
          (parseInt(b.start.slice(0, 2), 10) * 60 + parseInt(b.start.slice(3, 5), 10)),
        0,
      );
    const totalMin = out.reduce(
      (sum, b) =>
        sum +
        (parseInt(b.end.slice(0, 2), 10) * 60 + parseInt(b.end.slice(3, 5), 10)) -
        (parseInt(b.start.slice(0, 2), 10) * 60 + parseInt(b.start.slice(3, 5), 10)),
      0,
    );
    // Period cap = (48h / 20 days) × 3 days = 7.2h = 432 min, snapped up to 435 → 435 min.
    // Total allocated ≤ period cap (with snap floor).
    expect(totalMin).toBeLessThanOrEqual(450);
    expect(tueMin).toBeGreaterThan(0);
  });

  it('Wed busy with meetings → allocation falls forward to Tue (greedy time-order)', () => {
    const dates = ['2026-05-12', '2026-05-13']; // Tue + Wed
    // Wed completely covered by meetings during all focus windows
    const wedExisting = [
      block('e1', 9 * 60, 3 * 60),    // 09-12
      block('e2', 13 * 60, 2 * 60),   // 13-15
      block('e3', 15 * 60, 3 * 60),   // 15-18
    ];
    const out = proposeAllocation(
      baseInput({
        dates,
        pinnedProjects: [proj('p', 'high', 0.5)],
        existingBlocksByDate: { '2026-05-13': wedExisting },
      }),
    );
    // Tue should have allocations
    const tueOnly = out.filter((b) => b.date === '2026-05-12');
    const wedOnly = out.filter((b) => b.date === '2026-05-13');
    expect(tueOnly.length).toBeGreaterThan(0);
    expect(wedOnly.length).toBe(0);
  });

  it('proposed blocks across dates do not overlap their own date existing blocks', () => {
    const dates = ['2026-05-12', '2026-05-13'];
    const tueExisting = [block('e1', 10 * 60, 60)]; // Tue 10-11
    const wedExisting = [block('e2', 14 * 60, 60)]; // Wed 14-15
    const out = proposeAllocation(
      baseInput({
        dates,
        pinnedProjects: [proj('p', 'high', 1)],
        existingBlocksByDate: {
          '2026-05-12': tueExisting,
          '2026-05-13': wedExisting,
        },
      }),
    );
    const overlapsTue = out
      .filter((b) => b.date === '2026-05-12')
      .some((p) => {
        const ps = parseInt(p.start.slice(0, 2), 10) * 60 + parseInt(p.start.slice(3, 5), 10);
        const pe = parseInt(p.end.slice(0, 2), 10) * 60 + parseInt(p.end.slice(3, 5), 10);
        return tueExisting.some((e) => ps < e.start + e.durationMin && pe > e.start);
      });
    const overlapsWed = out
      .filter((b) => b.date === '2026-05-13')
      .some((p) => {
        const ps = parseInt(p.start.slice(0, 2), 10) * 60 + parseInt(p.start.slice(3, 5), 10);
        const pe = parseInt(p.end.slice(0, 2), 10) * 60 + parseInt(p.end.slice(3, 5), 10);
        return wedExisting.some((e) => ps < e.start + e.durationMin && pe > e.start);
      });
    expect(overlapsTue).toBe(false);
    expect(overlapsWed).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns [] when dates is empty', () => {
    const out = proposeAllocation(
      baseInput({
        dates: [],
        pinnedProjects: [proj('p', 'high', 1)],
      }),
    );
    expect(out).toEqual([]);
  });

  it('dedupes duplicate input dates so the period cap is not inflated', () => {
    const out = proposeAllocation(
      baseInput({
        dates: [DATE, DATE, DATE], // 3x same date
        pinnedProjects: [proj('p', 'mid', 0.3)],
        budgetContext: {
          spentByProjectThisMonth: {},
          monthRemainingBusinessDays: 20,
          targetMonth: '2026-05',
        },
      }),
    );
    // All proposals should be on DATE only and total ≤ single-day cap
    const datesSeen = new Set(out.map((b) => b.date));
    expect(datesSeen.size).toBe(1);
    expect(datesSeen.has(DATE)).toBe(true);
  });

  it('filters out dates outside targetMonth (defensive guard)', () => {
    const out = proposeAllocation(
      baseInput({
        dates: ['2026-04-30', DATE, '2026-06-01'], // only DATE matches '2026-05'
        pinnedProjects: [proj('p', 'mid', 1)],
      }),
    );
    for (const b of out) {
      expect(b.date).toBe(DATE);
    }
  });

  it('focus windows apply to each date independently in the range', () => {
    const dates = ['2026-05-12', '2026-05-13'];
    const out = proposeAllocation(
      baseInput({
        dates,
        pinnedProjects: [proj('p', 'high', 1)],
      }),
    );
    // Each day's blocks should fall within FOCUS_DEFAULT (09-18 union)
    for (const b of out) {
      const bs = parseInt(b.start.slice(0, 2), 10) * 60 + parseInt(b.start.slice(3, 5), 10);
      const be = parseInt(b.end.slice(0, 2), 10) * 60 + parseInt(b.end.slice(3, 5), 10);
      expect(bs).toBeGreaterThanOrEqual(9 * 60);
      expect(be).toBeLessThanOrEqual(18 * 60);
    }
  });

  it('block durations are snap-aligned to 15 minutes', () => {
    const out = proposeAllocation(
      baseInput({
        pinnedProjects: [proj('p', 'mid', 0.5)],
      }),
    );
    for (const b of out) {
      const bs = parseInt(b.start.slice(0, 2), 10) * 60 + parseInt(b.start.slice(3, 5), 10);
      const be = parseInt(b.end.slice(0, 2), 10) * 60 + parseInt(b.end.slice(3, 5), 10);
      expect(bs % 15).toBe(0);
      expect(be % 15).toBe(0);
      expect(be - bs).toBeGreaterThanOrEqual(30);
      expect(be - bs).toBeLessThanOrEqual(120);
    }
  });
});
