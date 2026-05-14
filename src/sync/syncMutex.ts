/**
 * Slice 22-C1: single-flight mutex for the sync pipeline.
 *
 * Per Codex design review: Pull / merge / Push must run as one atomic
 * operation from the orchestrator's perspective. If a second trigger
 * (debounced Push, periodic Pull, manual button) arrives while a sync
 * is in flight, it must NOT start a second concurrent pipeline.
 *
 * Behavior:
 *   - First caller starts the work; getResult() returns its promise.
 *   - Concurrent callers either receive the *same* in-flight promise
 *     (when `mode: 'join'`) or are dropped silently (when `mode: 'drop'`).
 *   - Once the in-flight promise settles, the mutex returns to idle.
 *
 * The orchestrator uses `join` for explicit user actions and `drop` for
 * automated triggers — periodic Pull doesn't need to wait, but a manual
 * "Sync Now" click should see the running sync's result.
 */

export type RunMode = 'join' | 'drop';

export type DropResult = { readonly kind: 'dropped' };

export class SyncMutex {
  private inFlight: Promise<unknown> | null = null;

  /**
   * Run `task` if idle, otherwise either join the in-flight task or
   * drop the request based on `mode`. The return type encodes both
   * outcomes so callers must branch on `kind`.
   */
  async run<T>(
    mode: RunMode,
    task: () => Promise<T>,
  ): Promise<{ readonly kind: 'ran' | 'joined'; readonly value: T } | DropResult> {
    if (this.inFlight !== null) {
      if (mode === 'drop') return { kind: 'dropped' };
      const value = (await this.inFlight) as T;
      return { kind: 'joined', value };
    }
    const promise = (async () => {
      try {
        return await task();
      } finally {
        // Use a microtask: clearing inFlight inside `finally` means the
        // *very next* await on this instance sees idle, but the current
        // synchronous tick still holds the promise — preventing a re-
        // entrant `run` inside `task` from seeing stale state.
        queueMicrotask(() => {
          if (this.inFlight === promise) this.inFlight = null;
        });
      }
    })();
    this.inFlight = promise;
    const value = (await promise) as T;
    return { kind: 'ran', value };
  }

  isBusy(): boolean {
    return this.inFlight !== null;
  }
}
