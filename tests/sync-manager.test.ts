import { describe, expect, it } from 'vitest';
import { SyncManager } from '../src/sync/syncManager.js';
import type {
  ApplyMergeResultReport,
  SyncDeps,
  SyncResult,
} from '../src/sync/syncOrchestrator.js';

const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const emptyTables = () => ({
  blocks: [],
  projects: [],
  project_budget_overrides: [],
  templates: [],
  gcal_assignments: [],
  gcal_summary_rules: [],
});

const noopReport: ApplyMergeResultReport = {
  appliedRows: 0,
  skippedRows: 0,
  conflictsPersisted: 0,
};

const makeNoopDeps = (delayMs = 0): SyncDeps => {
  let putCalls = 0;
  return {
    drive: {
      getCurrent: async () => null,
      putCurrent: async () => {
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        putCalls++;
        return { fileId: `f-${putCalls}`, etag: `e-${putCalls}` };
      },
    },
    storage: {
      readAllTables: async () => emptyTables(),
      applyMergeResult: async () => noopReport,
    },
    settings: {
      read: async () => ({
        lastSyncedAt: 0,
        lastEtag: null,
        lastFileId: null,
        lastGeneration: 0,
      }),
      write: async () => {},
    },
    config: { appVersion: '0.5.0', localDeviceId: DEV_A, now: () => 9999 },
  };
};

describe('SyncManager', () => {
  it('runSync completes and returns the orchestrator result', async () => {
    const mgr = new SyncManager(makeNoopDeps());
    const out = await mgr.runSync();
    expect(out.kind).toBe('completed');
    if (out.kind === 'completed') {
      expect(out.result.kind).toBe('pushed');
    }
  });

  it('drop mode bails when a sync is already in flight', async () => {
    const mgr = new SyncManager(makeNoopDeps(50));
    const first = mgr.runSync('join');
    // Wait one microtask so first starts.
    await Promise.resolve();
    const dropped = await mgr.runSync('drop');
    expect(dropped).toEqual({ kind: 'dropped' });
    const completed = await first;
    expect(completed.kind).toBe('completed');
  });

  it('join mode waits for the in-flight sync and shares its result', async () => {
    const mgr = new SyncManager(makeNoopDeps(20));
    const first = mgr.runSync('join');
    await Promise.resolve();
    const second = mgr.runSync('join');
    const [a, b] = await Promise.all([first, second]);
    expect(a.kind).toBe('completed');
    expect(b.kind).toBe('completed');
    if (a.kind === 'completed' && b.kind === 'completed') {
      // Same orchestrator result object reference — only one sync ran.
      const ra: SyncResult = a.result;
      const rb: SyncResult = b.result;
      expect(ra).toBe(rb);
    }
  });
});
