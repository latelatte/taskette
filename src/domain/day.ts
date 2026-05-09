import type { DateString, MinuteOfDay, PlaceResult, TimeBlock } from './types.js';

const MINUTES_PER_DAY = 1440;

const endOf = (b: TimeBlock): MinuteOfDay => b.start + b.durationMin;

const overlaps = (a: TimeBlock, b: TimeBlock): boolean =>
  a.start < endOf(b) && b.start < endOf(a);

const fitsWithinDay = (b: TimeBlock): boolean =>
  b.start >= 0 && endOf(b) <= MINUTES_PER_DAY;

export class Day {
  readonly date: DateString;
  private _blocks: TimeBlock[];

  constructor(date: DateString, initialBlocks: readonly TimeBlock[] = []) {
    this.date = date;
    this._blocks = [];
    for (const b of initialBlocks) {
      const result = this.place(b);
      if (!result.ok) {
        throw new Error(
          `Cannot construct Day: block ${b.id} failed (${result.reason})`,
        );
      }
    }
  }

  get blocks(): readonly TimeBlock[] {
    return [...this._blocks].sort((a, b) => a.start - b.start);
  }

  place(block: TimeBlock): PlaceResult {
    if (block.durationMin <= 0) {
      return { ok: false, reason: 'invalid', message: 'durationMin must be positive' };
    }
    if (!fitsWithinDay(block)) {
      return { ok: false, reason: 'invalid', message: 'block does not fit within the day' };
    }
    for (const existing of this._blocks) {
      if (existing.id === block.id) {
        return { ok: false, reason: 'invalid', message: `id collision: ${block.id}` };
      }
      if (overlaps(existing, block)) {
        return { ok: false, reason: 'overlap', conflictingBlockId: existing.id };
      }
    }
    this._blocks.push(block);
    return { ok: true };
  }

  remove(id: string): boolean {
    const i = this._blocks.findIndex((b) => b.id === id);
    if (i === -1) return false;
    this._blocks.splice(i, 1);
    return true;
  }

  move(id: string, newStart: MinuteOfDay): PlaceResult {
    const i = this._blocks.findIndex((b) => b.id === id);
    if (i === -1) {
      return { ok: false, reason: 'invalid', message: `block not found: ${id}` };
    }
    const target = this._blocks[i]!;
    const moved: TimeBlock = { ...target, start: newStart };
    if (!fitsWithinDay(moved)) {
      return { ok: false, reason: 'invalid', message: 'block does not fit within the day' };
    }
    for (const existing of this._blocks) {
      if (existing.id === id) continue;
      if (overlaps(existing, moved)) {
        return { ok: false, reason: 'overlap', conflictingBlockId: existing.id };
      }
    }
    this._blocks[i] = moved;
    return { ok: true };
  }

  resize(id: string, newDuration: number): PlaceResult {
    const i = this._blocks.findIndex((b) => b.id === id);
    if (i === -1) {
      return { ok: false, reason: 'invalid', message: `block not found: ${id}` };
    }
    if (newDuration <= 0) {
      return { ok: false, reason: 'invalid', message: 'durationMin must be positive' };
    }
    const target = this._blocks[i]!;
    const resized: TimeBlock = { ...target, durationMin: newDuration };
    if (!fitsWithinDay(resized)) {
      return { ok: false, reason: 'invalid', message: 'block does not fit within the day' };
    }
    for (const existing of this._blocks) {
      if (existing.id === id) continue;
      if (overlaps(existing, resized)) {
        return { ok: false, reason: 'overlap', conflictingBlockId: existing.id };
      }
    }
    this._blocks[i] = resized;
    return { ok: true };
  }
}
