import { describe, expect, it } from 'vitest';
import { SyncMutex } from '../src/sync/syncMutex.js';

const deferred = <T,>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('SyncMutex', () => {
  it('runs the first caller', async () => {
    const m = new SyncMutex();
    const result = await m.run('join', async () => 42);
    expect(result).toEqual({ kind: 'ran', value: 42 });
    expect(m.isBusy()).toBe(false);
  });

  it('drops a concurrent caller in drop mode', async () => {
    const m = new SyncMutex();
    const d = deferred<number>();
    const slow = m.run('drop', async () => d.promise);
    expect(m.isBusy()).toBe(true);
    const dropped = await m.run('drop', async () => 99);
    expect(dropped).toEqual({ kind: 'dropped' });
    d.resolve(7);
    await slow;
  });

  it('joins a concurrent caller in join mode (same value)', async () => {
    const m = new SyncMutex();
    const d = deferred<string>();
    const slow = m.run('join', async () => d.promise);
    const joined = m.run('join', async () => 'unused');
    d.resolve('shared');
    const [a, b] = await Promise.all([slow, joined]);
    expect(a).toEqual({ kind: 'ran', value: 'shared' });
    expect(b).toEqual({ kind: 'joined', value: 'shared' });
  });

  it('releases the lock even if the task throws', async () => {
    const m = new SyncMutex();
    await expect(
      m.run('join', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // microtask drain
    await Promise.resolve();
    expect(m.isBusy()).toBe(false);

    const after = await m.run('join', async () => 'ok');
    expect(after).toEqual({ kind: 'ran', value: 'ok' });
  });

  it('sequential calls each run independently', async () => {
    const m = new SyncMutex();
    const r1 = await m.run('join', async () => 1);
    // ensure microtask clearing has happened
    await Promise.resolve();
    const r2 = await m.run('join', async () => 2);
    expect(r1).toEqual({ kind: 'ran', value: 1 });
    expect(r2).toEqual({ kind: 'ran', value: 2 });
  });
});
