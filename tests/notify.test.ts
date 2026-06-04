import { describe, expect, it } from 'vitest';
import {
  decodeNotifyOffsets,
  encodeNotifyOffsets,
  normalizeNotifyOffsets,
  notifyOffsetsEqual,
} from '../src/notify.js';

describe('normalizeNotifyOffsets', () => {
  it('dedupes, sorts ascending, and drops out-of-range / non-finite values', () => {
    expect(normalizeNotifyOffsets([5, 1, 5, 0])).toEqual([0, 1, 5]);
    expect(normalizeNotifyOffsets([-1, 9999, 30])).toEqual([30]);
    expect(normalizeNotifyOffsets([Number.NaN, 10, Infinity])).toEqual([10]);
    expect(normalizeNotifyOffsets([1440])).toEqual([1440]); // 24h boundary allowed
  });

  it('rounds fractional minutes', () => {
    expect(normalizeNotifyOffsets([4.6])).toEqual([5]);
  });
});

describe('decodeNotifyOffsets', () => {
  it('returns [] for null (no notification)', () => {
    expect(decodeNotifyOffsets(null)).toEqual([]);
  });

  it('handles a single integer (legacy single-value column)', () => {
    expect(decodeNotifyOffsets(5)).toEqual([5]);
    expect(decodeNotifyOffsets(0)).toEqual([0]);
  });

  it('parses a CSV string of multiple offsets', () => {
    expect(decodeNotifyOffsets('1,5,10')).toEqual([1, 5, 10]);
    expect(decodeNotifyOffsets('5, 1')).toEqual([1, 5]); // whitespace + unsorted
  });
});

describe('encodeNotifyOffsets', () => {
  it('returns null for empty / undefined (no notification)', () => {
    expect(encodeNotifyOffsets([])).toBeNull();
    expect(encodeNotifyOffsets(undefined)).toBeNull();
  });

  it('joins normalized offsets as CSV', () => {
    expect(encodeNotifyOffsets([5])).toBe('5');
    expect(encodeNotifyOffsets([5, 1, 5])).toBe('1,5');
  });

  it('round-trips through decode', () => {
    const offsets = [1, 5, 30];
    expect(decodeNotifyOffsets(encodeNotifyOffsets(offsets))).toEqual(offsets);
  });
});

describe('notifyOffsetsEqual', () => {
  it('treats undefined / [] / different orderings as equal when normalized', () => {
    expect(notifyOffsetsEqual(undefined, [])).toBe(true);
    expect(notifyOffsetsEqual([5, 1], [1, 5])).toBe(true);
    expect(notifyOffsetsEqual([1], [1, 5])).toBe(false);
  });
});
