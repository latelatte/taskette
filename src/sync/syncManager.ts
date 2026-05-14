/**
 * Slice 22-C1: public sync entrypoint.
 *
 * Wraps {@link SyncOrchestrator.sync} with a {@link SyncMutex} so that
 * 22-C2 wiring (auto trigger / debounced Push / manual button / focus
 * refresh) cannot accidentally fire parallel pipelines. Two concurrent
 * Pull→merge→Push cycles would corrupt local state — one apply could
 * race ahead of the other's merge.
 *
 * Callers should *only* invoke `runSync`; the bare orchestrator is
 * exported for tests but not intended for production wiring.
 */

import { SyncMutex, type RunMode } from './syncMutex.js';
import {
  SyncOrchestrator,
  type SyncDeps,
  type SyncResult,
} from './syncOrchestrator.js';

export type SyncManagerOutcome =
  | { readonly kind: 'completed'; readonly result: SyncResult }
  | { readonly kind: 'dropped' };

export class SyncManager {
  private readonly mutex = new SyncMutex();
  private readonly orchestrator: SyncOrchestrator;

  constructor(deps: SyncDeps) {
    this.orchestrator = new SyncOrchestrator(deps);
  }

  /**
   * Trigger one Pull→merge→Push cycle, guarded by the single-flight
   * mutex. `mode` controls behavior when a sync is already running:
   *   - `join` (default for user actions): await the in-flight result
   *   - `drop` (default for auto triggers): no-op, return `dropped`
   */
  async runSync(mode: RunMode = 'join'): Promise<SyncManagerOutcome> {
    const outcome = await this.mutex.run(mode, () => this.orchestrator.sync());
    if (outcome.kind === 'dropped') return { kind: 'dropped' };
    return { kind: 'completed', result: outcome.value };
  }

  isBusy(): boolean {
    // Note: due to `queueMicrotask` cleanup inside SyncMutex.run, isBusy()
    // can briefly read `true` for one microtask after a `runSync()`
    // returns. UI code that gates a "Sync" button on this should debounce
    // by a microtask or just check at next render.
    return this.mutex.isBusy();
  }
}
