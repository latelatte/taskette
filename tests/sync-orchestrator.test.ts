import { describe, expect, it } from 'vitest';
import {
  SyncOrchestrator,
  type ApplyMergeResultReport,
  type DriveClientDeps,
  type DriveSnapshotForSync,
  type SyncDeps,
  type SyncSettingsDeps,
  type SyncSettingsState,
  type SyncStorageDeps,
} from '../src/sync/syncOrchestrator.js';
import {
  buildEnvelope,
  ENVELOPE_SCHEMA_VERSION,
  serializeEnvelope,
  SYNCED_TABLES,
  type SyncedTableName,
  type TablesData,
} from '../src/sync/envelopeSerializer.js';
import type { LoserEntry } from '../src/sync/merge.js';
import type { SyncRow } from '../src/sync/types.js';

const DEV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DEV_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const row = (over: Partial<SyncRow> & { id: string }): SyncRow => ({
  revision: 1,
  updatedAt: 1000,
  updatedByDeviceId: DEV_A,
  deletedAt: null,
  createdAt: 1000,
  createdByDeviceId: DEV_A,
  ...over,
});

const emptyTables = (): TablesData => ({
  blocks: [],
  projects: [],
  project_budget_overrides: [],
  templates: [],
  gcal_assignments: [],
  gcal_summary_rules: [],
});

// ---- Mock factories ----

const makeDriveMock = (
  initial: DriveSnapshotForSync | null,
): DriveClientDeps & {
  state: { current: DriveSnapshotForSync | null; putCalls: number };
  // Force the next put() to behave as if another device wrote in between.
  arm412Once: () => void;
  // Inject a different snapshot immediately before the next Pull.
  setRemote: (s: DriveSnapshotForSync | null) => void;
} => {
  let current = initial;
  let putCalls = 0;
  let force412 = false;
  return {
    state: {
      get current() {
        return current;
      },
      get putCalls() {
        return putCalls;
      },
    },
    arm412Once: () => {
      force412 = true;
    },
    setRemote: (s) => {
      current = s;
    },
    getCurrent: async () => current,
    putCurrent: async (content, fileId, ifMatchEtag) => {
      putCalls++;
      if (force412) {
        force412 = false;
        throw new Error('PRECONDITION_FAILED: simulated CAS miss');
      }
      // First publish: create.
      if (fileId === null) {
        current = { content, etag: `etag-${putCalls}`, fileId: `file-${putCalls}` };
        return { etag: current.etag, fileId: current.fileId };
      }
      // Update with CAS check.
      if (current === null || current.etag !== ifMatchEtag) {
        throw new Error('PRECONDITION_FAILED: stale etag');
      }
      current = { content, etag: `etag-${putCalls}`, fileId };
      return { etag: current.etag, fileId };
    },
  };
};

type StorageMock = SyncStorageDeps & {
  state: {
    tables: TablesData;
    conflictEntries: LoserEntry[];
    applyCalls: number;
  };
};

const makeStorageMock = (initial: TablesData): StorageMock => {
  let tables: TablesData = initial;
  const conflictEntries: LoserEntry[] = [];
  let applyCalls = 0;
  // Idempotent conflict log dedup: keep a Set of conflictEventIds so the
  // mock matches the real storage adapter contract (INSERT OR IGNORE).
  const seenEvents = new Set<string>();
  return {
    state: {
      get tables() {
        return tables;
      },
      get conflictEntries() {
        return conflictEntries;
      },
      get applyCalls() {
        return applyCalls;
      },
    },
    readAllTables: async () => tables,
    applyMergeResult: async ({ merged, conflicts }) => {
      applyCalls++;
      tables = merged;
      let persisted = 0;
      for (const c of conflicts) {
        if (!seenEvents.has(c.conflictEventId)) {
          seenEvents.add(c.conflictEventId);
          conflictEntries.push(c);
          persisted++;
        }
      }
      const appliedRows = Object.values(merged).reduce((sum, rows) => sum + rows.length, 0);
      const report: ApplyMergeResultReport = {
        appliedRows,
        skippedRows: 0,
        conflictsPersisted: persisted,
      };
      return report;
    },
  };
};

const makeSettingsMock = (initial: SyncSettingsState): SyncSettingsDeps & { state: { value: SyncSettingsState } } => {
  let value = { ...initial };
  return {
    state: {
      get value() {
        return value;
      },
    },
    read: async () => value,
    write: async (partial) => {
      value = { ...value, ...partial };
    },
  };
};

const makeDeps = (over: {
  driveInitial?: DriveSnapshotForSync | null;
  storageInitial?: TablesData;
  settingsInitial?: Partial<SyncSettingsState>;
}): SyncDeps & {
  drive: ReturnType<typeof makeDriveMock>;
  storage: StorageMock;
  settings: ReturnType<typeof makeSettingsMock>;
} => {
  const drive = makeDriveMock(over.driveInitial ?? null);
  const storage = makeStorageMock(over.storageInitial ?? emptyTables());
  const settings = makeSettingsMock({
    lastSyncedAt: 0,
    lastEtag: null,
    lastFileId: null,
    lastGeneration: 0,
    ...(over.settingsInitial ?? {}),
  });
  return {
    drive,
    storage,
    settings,
    config: { appVersion: '0.5.0', localDeviceId: DEV_A, now: () => 9999 },
  };
};

// ---- Tests ----

describe('SyncOrchestrator.sync', () => {
  it('first push: creates current.json when remote is null', async () => {
    const deps = makeDeps({
      storageInitial: { ...emptyTables(), blocks: [row({ id: 'a' })] },
    });
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('pushed');
    if (result.kind === 'pushed') {
      expect(result.newGeneration).toBe(1);
      expect(result.conflicts).toBe(0);
      expect(result.report.appliedRows).toBe(1);
    }
    expect(deps.drive.state.current).not.toBeNull();
    expect(deps.settings.state.value.lastGeneration).toBe(1);
    expect(deps.settings.state.value.lastEtag).toBe('etag-1');
  });

  it('Pull + Push round trip: remote-newer row applied without conflict when local is pre-lastSyncedAt', async () => {
    const localRow = row({ id: 'a', revision: 1, updatedAt: 500, updatedByDeviceId: DEV_A });
    const remoteRow = row({ id: 'a', revision: 3, updatedAt: 2000, updatedByDeviceId: DEV_B });
    const remoteEnvelope = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 5,
      localDeviceId: DEV_B,
      tables: { ...emptyTables(), blocks: [remoteRow] },
      now: 2000,
    });
    const deps = makeDeps({
      driveInitial: {
        content: serializeEnvelope(remoteEnvelope),
        etag: 'etag-existing',
        fileId: 'file-existing',
      },
      storageInitial: { ...emptyTables(), blocks: [localRow] },
      // localRow.updatedAt (500) < lastSyncedAt (1000), so local's edit
      // is "before the anchor" — purely a remote-is-ahead scenario.
      settingsInitial: { lastSyncedAt: 1000 },
    });
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('pushed');
    if (result.kind === 'pushed') {
      expect(result.newGeneration).toBe(6);
      expect(result.conflicts).toBe(0);
    }
  });

  it('counts conflicts when both sides edit independently since lastSyncedAt', async () => {
    const localRow = row({ id: 'a', revision: 2, updatedAt: 200, updatedByDeviceId: DEV_A });
    const remoteRow = row({ id: 'a', revision: 2, updatedAt: 300, updatedByDeviceId: DEV_B });
    const remoteEnvelope = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_B,
      tables: { ...emptyTables(), blocks: [remoteRow] },
      now: 300,
    });
    const deps = makeDeps({
      driveInitial: {
        content: serializeEnvelope(remoteEnvelope),
        etag: 'etag-existing',
        fileId: 'file-existing',
      },
      storageInitial: { ...emptyTables(), blocks: [localRow] },
      settingsInitial: { lastSyncedAt: 100 },
    });
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('pushed');
    if (result.kind === 'pushed') expect(result.conflicts).toBe(1);
    expect(deps.storage.state.conflictEntries).toHaveLength(1);
    expect(deps.storage.state.conflictEntries[0]?.winnerDeviceId).toBe(DEV_B);
  });

  it('schema-refused when remote envelope is newer than local supports', async () => {
    const remoteEnvelope = await buildEnvelope({
      appVersion: '0.6.0',
      generation: 1,
      localDeviceId: DEV_B,
      tables: emptyTables(),
      now: 1,
    });
    // Force a newer schemaVersion in the serialized payload.
    const tampered = { ...remoteEnvelope, schemaVersion: ENVELOPE_SCHEMA_VERSION + 1 };
    const deps = makeDeps({
      driveInitial: {
        content: serializeEnvelope(tampered),
        etag: 'e',
        fileId: 'f',
      },
    });
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('schema-refused');
    if (result.kind === 'schema-refused') {
      expect(result.reason).toMatch(/upgrade this client/);
    }
  });

  it('duplicate-detected when getCurrent throws DUPLICATE_NAME', async () => {
    const deps = makeDeps({});
    const orchestrator = new SyncOrchestrator({
      ...deps,
      drive: {
        ...deps.drive,
        getCurrent: async () => {
          throw new Error('DUPLICATE_NAME: 2 files named current.json in appDataFolder: [a, b]');
        },
      },
    });
    const result = await orchestrator.sync();
    expect(result.kind).toBe('duplicate-detected');
    if (result.kind === 'duplicate-detected') {
      expect(result.message).toMatch(/DUPLICATE_NAME/);
    }
  });

  it('CAS 412 triggers re-Pull and a second Push attempt', async () => {
    const deps = makeDeps({
      storageInitial: { ...emptyTables(), blocks: [row({ id: 'a' })] },
    });
    // First Push will hit 412 because the mock is armed.
    deps.drive.arm412Once();
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('pushed');
    expect(deps.drive.state.putCalls).toBe(2); // first failed, second succeeded
  });

  it('gives up after MAX_CAS_RETRIES if Drive keeps returning 412', async () => {
    const deps = makeDeps({});
    const orchestrator = new SyncOrchestrator({
      ...deps,
      drive: {
        ...deps.drive,
        putCurrent: async () => {
          throw new Error('PRECONDITION_FAILED: persistent');
        },
      },
    });
    const result = await orchestrator.sync();
    expect(result.kind).toBe('cas-exhausted');
    if (result.kind === 'cas-exhausted') {
      expect(result.attempts).toBe(3);
    }
  });

  it('writes merged rows back to local storage', async () => {
    const localRow = row({ id: 'only-local' });
    const remoteRow = row({ id: 'only-remote', revision: 5, updatedByDeviceId: DEV_B });
    const remoteEnvelope = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_B,
      tables: { ...emptyTables(), blocks: [remoteRow] },
      now: 1,
    });
    const deps = makeDeps({
      driveInitial: {
        content: serializeEnvelope(remoteEnvelope),
        etag: 'e',
        fileId: 'f',
      },
      storageInitial: { ...emptyTables(), blocks: [localRow] },
    });
    await new SyncOrchestrator(deps).sync();
    const ids = (deps.storage.state.tables.blocks as readonly SyncRow[])
      .map((r) => r['id'])
      .sort();
    expect(ids).toEqual(['only-local', 'only-remote']);
  });

  it('aborts with corrupt-envelope when remote has dropped rows', async () => {
    const env = {
      schemaVersion: 1,
      appVersion: '0.5.0',
      generation: 1,
      createdAt: 1000,
      devices: { [DEV_B]: { lastSeenGeneration: 1, lastSyncAt: 1000 } },
      contentSha256: '',
      tables: { blocks: [row({ id: 'good' }), { id: 'bad-no-meta' }] },
    };
    const deps = makeDeps({
      driveInitial: { content: JSON.stringify(env), etag: 'e', fileId: 'f' },
    });
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('corrupt-envelope');
    if (result.kind === 'corrupt-envelope') expect(result.droppedRows).toBe(1);
    // Crucially: no local apply, no Push — corruption would otherwise
    // be Pushed back to remote, deleting the dropped data.
    expect(deps.storage.state.applyCalls).toBe(0);
    expect(deps.drive.state.putCalls).toBe(0);
  });

  it('aborts with corrupt-envelope on sha256 mismatch', async () => {
    const original = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_B,
      tables: { ...emptyTables(), blocks: [row({ id: 'a' })] },
      now: 1000,
    });
    // Add a row but keep the original (now-stale) sha256.
    const tampered = {
      ...original,
      tables: {
        ...original.tables,
        blocks: [...original.tables['blocks']!, row({ id: 'b' })],
      },
    };
    const deps = makeDeps({
      driveInitial: { content: serializeEnvelope(tampered), etag: 'e', fileId: 'f' },
    });
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('corrupt-envelope');
    if (result.kind === 'corrupt-envelope') expect(result.sha256Matches).toBe(false);
    expect(deps.storage.state.applyCalls).toBe(0);
  });

  it('returns error when applyMergeResult throws (no Push attempted)', async () => {
    const deps = makeDeps({});
    const orchestrator = new SyncOrchestrator({
      ...deps,
      storage: {
        ...deps.storage,
        applyMergeResult: async () => {
          throw new Error('disk full');
        },
      },
    });
    const result = await orchestrator.sync();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/disk full/);
    expect(deps.drive.state.putCalls).toBe(0);
  });

  it('returns error when settings.write throws after a successful Push', async () => {
    const deps = makeDeps({});
    const orchestrator = new SyncOrchestrator({
      ...deps,
      settings: {
        ...deps.settings,
        write: async () => {
          throw new Error('settings table locked');
        },
      },
    });
    const result = await orchestrator.sync();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toMatch(/settings write/);
    // Push itself happened — the inconsistency between Drive and local
    // settings is unfortunate but a 22-C2 concern (next sync repairs it).
    expect(deps.drive.state.putCalls).toBe(1);
  });

  it('CAS retry does not double-count the same conflict event', async () => {
    const localRow = row({ id: 'a', revision: 2, updatedAt: 200, updatedByDeviceId: DEV_A });
    const remoteRow = row({ id: 'a', revision: 2, updatedAt: 300, updatedByDeviceId: DEV_B });
    const remoteEnvelope = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_B,
      tables: { ...emptyTables(), blocks: [remoteRow] },
      now: 300,
    });
    const deps = makeDeps({
      driveInitial: {
        content: serializeEnvelope(remoteEnvelope),
        etag: 'etag-existing',
        fileId: 'file-existing',
      },
      storageInitial: { ...emptyTables(), blocks: [localRow] },
      settingsInitial: { lastSyncedAt: 100 },
    });
    deps.drive.arm412Once();
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('pushed');
    // Two attempts ran merge → two conflict entries generated, but the
    // storage mock dedupes on conflictEventId, matching the real
    // SQLite `INSERT OR IGNORE` contract documented on the interface.
    expect(deps.storage.state.conflictEntries).toHaveLength(1);
    expect(deps.storage.state.applyCalls).toBe(2);
  });

  it('published envelope reflects post-apply local state when applyMergeResult skips a row', async () => {
    // Simulate the H1 race: user edits a row to a higher revision DURING
    // the sync window. applyMergeResult's revision-guarded UPSERT skips
    // the merge winner; the orchestrator MUST re-read and publish the
    // user's edit so remote does not diverge.
    const presyncRow = row({ id: 'a', revision: 3, updatedAt: 100, updatedByDeviceId: DEV_A });
    const userEditedRow = row({
      id: 'a',
      revision: 5,
      updatedAt: 500,
      updatedByDeviceId: DEV_A,
    });
    const remoteWinner = row({
      id: 'a',
      revision: 4,
      updatedAt: 300,
      updatedByDeviceId: DEV_B,
    });
    const remoteEnvelope = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_B,
      tables: { ...emptyTables(), blocks: [remoteWinner] },
      now: 300,
    });

    const deps = makeDeps({
      driveInitial: {
        content: serializeEnvelope(remoteEnvelope),
        etag: 'etag-existing',
        fileId: 'file-existing',
      },
      storageInitial: { ...emptyTables(), blocks: [presyncRow] },
    });

    // Override the storage mock so applyMergeResult flips the table to
    // the user's during-sync state (revision-guard: incoming rev=4 loses
    // to local rev=5) and the post-apply re-read sees the user's edit.
    let readCalls = 0;
    const orchestrator = new SyncOrchestrator({
      ...deps,
      storage: {
        readAllTables: async () => {
          readCalls++;
          // First read = pre-merge snapshot, subsequent = post-apply.
          return readCalls === 1
            ? { ...emptyTables(), blocks: [presyncRow] }
            : { ...emptyTables(), blocks: [userEditedRow] };
        },
        applyMergeResult: async () => ({
          appliedRows: 0,
          skippedRows: 1,
          conflictsPersisted: 0,
        }),
      },
    });

    const result = await orchestrator.sync();
    expect(result.kind).toBe('pushed');
    expect(readCalls).toBe(2); // pre-merge + post-apply re-read

    // Decode the published envelope and confirm it carries the user's
    // edit (revision=5), not the merge winner (revision=4).
    const published = JSON.parse(deps.drive.state.current!.content) as {
      tables: { blocks: ReadonlyArray<{ revision: number }> };
    };
    expect(published.tables.blocks).toHaveLength(1);
    expect(published.tables.blocks[0]?.revision).toBe(5);
  });

  it('handles all sync tables, not just blocks', async () => {
    const deps = makeDeps({
      storageInitial: {
        blocks: [row({ id: 'b1' })],
        projects: [row({ id: 'p1' })],
        project_budget_overrides: [],
        templates: [row({ id: 't1' })],
        gcal_assignments: [],
        gcal_summary_rules: [],
      },
    });
    const result = await new SyncOrchestrator(deps).sync();
    expect(result.kind).toBe('pushed');
    expect(deps.drive.state.current).not.toBeNull();
    // Every synced table appears in the published envelope.
    const published = JSON.parse(deps.drive.state.current!.content) as {
      tables: Record<string, unknown[]>;
    };
    for (const name of SYNCED_TABLES) {
      expect(published.tables[name as SyncedTableName]).toBeDefined();
    }
  });
});
