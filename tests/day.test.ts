import { describe, expect, it } from 'vitest';
import { Day } from '../src/domain/day.js';
import type { TimeBlock } from '../src/domain/types.js';

const block = (over: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'start' | 'durationMin'>): TimeBlock => ({
  label: over.label ?? 'task',
  ...over,
});

describe('Day.place', () => {
  it('places a non-overlapping block', () => {
    const day = new Day('2026-05-09');
    const result = day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    expect(result).toEqual({ ok: true });
    expect(day.blocks).toHaveLength(1);
  });

  it('rejects an overlapping block and reports the conflicting id', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    const result = day.place(block({ id: 'b', start: 570, durationMin: 30 }));
    expect(result).toEqual({ ok: false, reason: 'overlap', conflictingBlockId: 'a' });
    expect(day.blocks).toHaveLength(1);
  });

  it('allows adjacent blocks (touching, not overlapping)', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    const result = day.place(block({ id: 'b', start: 600, durationMin: 30 }));
    expect(result).toEqual({ ok: true });
    expect(day.blocks).toHaveLength(2);
  });

  it('rejects zero or negative duration', () => {
    const day = new Day('2026-05-09');
    expect(day.place(block({ id: 'a', start: 540, durationMin: 0 }))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(day.place(block({ id: 'b', start: 540, durationMin: -10 }))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a block extending past the end of day', () => {
    const day = new Day('2026-05-09');
    const result = day.place(block({ id: 'a', start: 1400, durationMin: 60 }));
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a block with a duplicate id', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    const result = day.place(block({ id: 'a', start: 720, durationMin: 30 }));
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('Day.blocks', () => {
  it('returns blocks sorted by start time', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'late', start: 720, durationMin: 30 }));
    day.place(block({ id: 'early', start: 540, durationMin: 30 }));
    expect(day.blocks.map((b) => b.id)).toEqual(['early', 'late']);
  });
});

describe('Day.remove', () => {
  it('removes an existing block and returns true', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    expect(day.remove('a')).toBe(true);
    expect(day.blocks).toHaveLength(0);
  });

  it('returns false when removing a non-existent block', () => {
    const day = new Day('2026-05-09');
    expect(day.remove('ghost')).toBe(false);
  });
});

describe('Day.move', () => {
  it('moves a block to a free slot', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    expect(day.move('a', 720)).toEqual({ ok: true });
    expect(day.blocks[0]?.start).toBe(720);
  });

  it('allows moving in place (treats self as not conflicting)', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    expect(day.move('a', 540)).toEqual({ ok: true });
  });

  it('rejects a move that overlaps another block', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    day.place(block({ id: 'b', start: 720, durationMin: 30 }));
    const result = day.move('a', 700);
    expect(result).toEqual({ ok: false, reason: 'overlap', conflictingBlockId: 'b' });
  });

  it('rejects a move that pushes the block past end of day', () => {
    const day = new Day('2026-05-09');
    day.place(block({ id: 'a', start: 540, durationMin: 60 }));
    expect(day.move('a', 1400)).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('returns invalid when moving a non-existent block', () => {
    const day = new Day('2026-05-09');
    expect(day.move('ghost', 540)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('Day constructor with initial blocks', () => {
  it('accepts non-overlapping initial blocks', () => {
    const day = new Day('2026-05-09', [
      block({ id: 'a', start: 540, durationMin: 60 }),
      block({ id: 'b', start: 720, durationMin: 30 }),
    ]);
    expect(day.blocks).toHaveLength(2);
  });

  it('throws when initial blocks overlap', () => {
    expect(
      () =>
        new Day('2026-05-09', [
          block({ id: 'a', start: 540, durationMin: 60 }),
          block({ id: 'b', start: 570, durationMin: 30 }),
        ]),
    ).toThrow();
  });
});
