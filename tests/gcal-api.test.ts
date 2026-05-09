import { describe, expect, it } from 'vitest';
import { isCountableEvent, normalizeEvent } from '../src/gcal/api.js';
import type { GcalApiEvent } from '../src/gcal/types.js';

const baseEvent: GcalApiEvent = {
  id: 'evt-1',
  status: 'confirmed',
  summary: '会議',
  start: { dateTime: '2026-05-09T10:00:00+09:00' },
  end: { dateTime: '2026-05-09T11:00:00+09:00' },
};

describe('isCountableEvent', () => {
  it('confirmed + opaque + dateTime のイベントは含める', () => {
    expect(isCountableEvent(baseEvent)).toBe(true);
  });

  it('cancelled は除外', () => {
    expect(isCountableEvent({ ...baseEvent, status: 'cancelled' })).toBe(false);
  });

  it('transparent (自由予定) は除外', () => {
    expect(isCountableEvent({ ...baseEvent, transparency: 'transparent' })).toBe(false);
  });

  it('終日予定 (date のみ) は除外', () => {
    const allDay: GcalApiEvent = {
      id: 'evt-allday',
      status: 'confirmed',
      summary: '休暇',
      start: { date: '2026-05-09' },
      end: { date: '2026-05-10' },
    };
    expect(isCountableEvent(allDay)).toBe(false);
  });

  it('自分が declined のイベントは除外', () => {
    const declined: GcalApiEvent = {
      ...baseEvent,
      attendees: [{ email: 'me@x', self: true, responseStatus: 'declined' }],
    };
    expect(isCountableEvent(declined)).toBe(false);
  });

  it('他人が declined でも自分が accepted なら含める', () => {
    const e: GcalApiEvent = {
      ...baseEvent,
      attendees: [
        { email: 'me@x', self: true, responseStatus: 'accepted' },
        { email: 'someone@x', responseStatus: 'declined' },
      ],
    };
    expect(isCountableEvent(e)).toBe(true);
  });

  it('attendees なしでも含める (オーナー単独想定)', () => {
    expect(isCountableEvent(baseEvent)).toBe(true);
  });
});

describe('normalizeEvent', () => {
  it('正常系: key と時刻が正規化される', () => {
    const n = normalizeEvent(baseEvent, 'primary');
    expect(n).not.toBeNull();
    expect(n!.calendarId).toBe('primary');
    expect(n!.eventId).toBe('evt-1');
    expect(n!.key).toBe('primary|evt-1');
    expect(n!.assignmentKey).toBe('primary|evt-1');
    expect(n!.isRecurring).toBe(false);
    expect(n!.summary).toBe('会議');
    expect(n!.endMs).toBeGreaterThan(n!.startMs);
    expect(n!.endMs - n!.startMs).toBe(60 * 60 * 1000);
  });

  it('繰り返しイベントは assignmentKey が parent recurringEventId 形式', () => {
    const e: GcalApiEvent = { ...baseEvent, recurringEventId: 'parent-abc' };
    const n = normalizeEvent(e, 'primary');
    expect(n).not.toBeNull();
    expect(n!.isRecurring).toBe(true);
    expect(n!.assignmentKey).toBe('primary|R:parent-abc');
    expect(n!.key).toBe('primary|evt-1'); // key は eventId のまま (debug 用)
  });

  it('summary 空文字は (タイトルなし) になる', () => {
    const n = normalizeEvent({ ...baseEvent, summary: '' }, 'primary');
    expect(n?.summary).toBe('(タイトルなし)');
  });

  it('summary undefined は (タイトルなし) になる', () => {
    const e = { ...baseEvent };
    delete (e as { summary?: string }).summary;
    const n = normalizeEvent(e, 'primary');
    expect(n?.summary).toBe('(タイトルなし)');
  });

  it('start.dateTime 未指定なら null', () => {
    expect(normalizeEvent({ ...baseEvent, start: {} }, 'primary')).toBeNull();
  });

  it('end <= start なら null', () => {
    const e: GcalApiEvent = {
      ...baseEvent,
      start: { dateTime: '2026-05-09T11:00:00+09:00' },
      end: { dateTime: '2026-05-09T10:00:00+09:00' },
    };
    expect(normalizeEvent(e, 'primary')).toBeNull();
  });
});
