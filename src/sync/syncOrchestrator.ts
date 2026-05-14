/**
 * Slice 22-C1: Pull → merge → Push state machine.
 *
 * Wraps the row-level merge (22-A) and Drive CRUD (22-B) into the
 * conflict-aware sync pipeline. Dependencies are injected so the
 * orchestrator can be exercised with in-memory mocks before any SQLite
 * or Drive wiring exists (see tests/sync-orchestrator.test.ts).
 *
 * Lifecycle of a single sync() call:
 *
 *   1. Read sync settings (lastSyncedAt, lastEtag, …).
 *   2. Drive GET current.json. Possible outcomes:
 *        - null               → no remote yet, fall through to Push (create).
 *        - DUPLICATE_NAME     → bail with reconciliation hint; caller (22-C2)
 *                                merges duplicates + retries.
 *        - parsed envelope    → schema-check via decideSchemaAction.
 *   3. Read local rows from every synced table.
 *   4. For each table, mergeTable(local, remote, …) producing winners and
 *      LoserEntry records.
 *   5. UPSERT merged rows back into local DB. Conditional on revision so
 *      a concurrent local edit (higher rev) is preserved — that becomes
 *      the next sync's dirty payload.
 *   6. Persist any LoserEntry rows to conflict_log.
 *   7. Build a new envelope (generation = remote+1, devices map carried
 *      forward) and Drive PATCH/PUT with If-Match against the remote's
 *      etag.
 *   8. On 412 PRECONDITION_FAILED, restart from step 2 — another device
 *      wrote in between. Capped at MAX_CAS_RETRIES iterations.
 */

import {
  mergeTable,
  type LoserEntry,
  type MergeContext,
  type RowKey,
} from './merge.js';
import {
  buildEnvelope,
  ENVELOPE_SCHEMA_VERSION,
  parseEnvelope,
  serializeEnvelope,
  SYNCED_TABLES,
  type SyncedTableName,
  type TablesData,
} from './envelopeSerializer.js';
import { decideSchemaAction, migrateEnvelope } from './snapshotMigrator.js';
import type { DeviceMeta, SyncRow } from './types.js';

const MAX_CAS_RETRIES = 3;

// Per-table primary-key extractors. Composite keys are serialized with
// `` (Start-of-Heading) as a separator — that character cannot appear
// in our keys (UUIDs / YYYY-MM / summary text) so collisions are impossible.
const TABLE_KEYS: Readonly<Record<SyncedTableName, (row: SyncRow) => RowKey>> = {
  blocks: (r) => String(r['id'] ?? ''),
  projects: (r) => String(r['id'] ?? ''),
  project_budget_overrides: (r) =>
    `${String(r['projectId'] ?? '')}${String(r['ym'] ?? '')}`,
  templates: (r) => String(r['id'] ?? ''),
  gcal_assignments: (r) => String(r['gcalKey'] ?? ''),
  gcal_summary_rules: (r) => String(r['summary'] ?? ''),
};

// ---- Injected dependencies ----

export type SyncSettingsState = {
  readonly lastSyncedAt: number;
  readonly lastEtag: string | null;
  readonly lastFileId: string | null;
  readonly lastGeneration: number;
};

export type DriveSnapshotForSync = {
  readonly content: string;
  readonly etag: string;
  readonly fileId: string;
};

export type DrivePutResultForSync = {
  readonly fileId: string;
  readonly etag: string;
};

export type DriveClientDeps = {
  /** Throws `DUPLICATE_NAME: ...` when Drive holds multiple current.json. */
  readonly getCurrent: () => Promise<DriveSnapshotForSync | null>;
  /** Throws `PRECONDITION_FAILED: ...` on 412. */
  readonly putCurrent: (
    content: string,
    fileId: string | null,
    ifMatchEtag: string | null,
  ) => Promise<DrivePutResultForSync>;
};

export type ApplyMergeResultReport = {
  /** Rows whose merge winner was written to local DB. */
  readonly appliedRows: number;
  /**
   * Rows skipped because local already had a newer revision than the
   * merge winner — that local edit happened mid-sync and is preserved
   * for the next cycle. Non-zero is normal, not an error.
   */
  readonly skippedRows: number;
  /** Conflict log inserts that took effect (dedup on conflictEventId). */
  readonly conflictsPersisted: number;
};

export type SyncStorageDeps = {
  readonly readAllTables: () => Promise<TablesData>;
  /**
   * Atomically apply merged rows AND persist conflict losers in a single
   * SQLite transaction. Two correctness requirements the implementation
   * must satisfy (interface cannot fully enforce them in TS, but the
   * combined signature makes splitting them an obvious mistake):
   *
   * 1. **Revision-guarded UPSERT**: when local revision > merged.revision
   *    for a key, leave the existing row untouched and increment
   *    `skippedRows`. Never clobber a concurrent local edit.
   * 2. **Idempotent loser inserts**: use INSERT OR IGNORE keyed on
   *    `conflictEventId`. CAS-412 retry inside one `sync()` call will
   *    re-attempt with the same event ids; double-counting must not
   *    happen.
   *
   * Failure (DB unavailable, schema mismatch, etc.) must throw — the
   * orchestrator treats any rejection as `{ kind: 'error' }`.
   */
  readonly applyMergeResult: (input: {
    readonly merged: TablesData;
    readonly conflicts: readonly LoserEntry[];
  }) => Promise<ApplyMergeResultReport>;
};

export type SyncSettingsDeps = {
  readonly read: () => Promise<SyncSettingsState>;
  readonly write: (partial: Partial<SyncSettingsState>) => Promise<void>;
};

export type SyncOrchestratorConfig = {
  readonly appVersion: string;
  readonly localDeviceId: string;
  /** Override the wall clock for tests. */
  readonly now?: () => number;
};

export type SyncDeps = {
  readonly drive: DriveClientDeps;
  readonly storage: SyncStorageDeps;
  readonly settings: SyncSettingsDeps;
  readonly config: SyncOrchestratorConfig;
};

// ---- Result discriminated union ----

export type SyncResult =
  | {
      readonly kind: 'pushed';
      readonly newGeneration: number;
      readonly conflicts: number;
      readonly report: ApplyMergeResultReport;
    }
  | { readonly kind: 'duplicate-detected'; readonly message: string }
  | { readonly kind: 'schema-refused'; readonly reason: string }
  /**
   * Remote envelope had malformed rows (`droppedRows > 0`) or failed
   * integrity check (`sha256Matches === false`). The orchestrator
   * refuses to apply or Push — silently continuing would re-Publish an
   * envelope missing the dropped data, deleting it from remote.
   */
  | {
      readonly kind: 'corrupt-envelope';
      readonly droppedRows: number;
      readonly sha256Matches: boolean;
    }
  | { readonly kind: 'cas-exhausted'; readonly attempts: number }
  | { readonly kind: 'error'; readonly message: string };

const errorPrefix = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const colon = msg.indexOf(':');
  return colon === -1 ? '' : msg.slice(0, colon);
};

export class SyncOrchestrator {
  constructor(private readonly deps: SyncDeps) {}

  async sync(): Promise<SyncResult> {
    let settings: SyncSettingsState;
    try {
      settings = await this.deps.settings.read();
    } catch (e) {
      return { kind: 'error', message: `settings read: ${(e as Error).message}` };
    }
    const now = this.deps.config.now ?? Date.now;
    let lastReport: ApplyMergeResultReport = {
      appliedRows: 0,
      skippedRows: 0,
      conflictsPersisted: 0,
    };

    for (let attempt = 1; attempt <= MAX_CAS_RETRIES; attempt++) {
      // ---- Pull ----
      let driveSnapshot: DriveSnapshotForSync | null;
      try {
        driveSnapshot = await this.deps.drive.getCurrent();
      } catch (e) {
        const prefix = errorPrefix(e);
        if (prefix === 'DUPLICATE_NAME') {
          return {
            kind: 'duplicate-detected',
            message: e instanceof Error ? e.message : String(e),
          };
        }
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }

      // ---- Schema + integrity gate ----
      let remoteTables: TablesData;
      let priorDevices: Readonly<Record<string, DeviceMeta>>;
      let remoteGeneration: number;
      if (driveSnapshot === null) {
        remoteTables = EMPTY_TABLES;
        priorDevices = {};
        remoteGeneration = 0;
      } else {
        let parsed;
        try {
          parsed = await parseEnvelope(driveSnapshot.content);
        } catch (e) {
          return { kind: 'error', message: `envelope parse failed: ${(e as Error).message}` };
        }
        if (parsed.droppedRows > 0 || !parsed.sha256Matches) {
          return {
            kind: 'corrupt-envelope',
            droppedRows: parsed.droppedRows,
            sha256Matches: parsed.sha256Matches,
          };
        }
        const action = decideSchemaAction(
          ENVELOPE_SCHEMA_VERSION,
          parsed.envelope.schemaVersion,
        );
        if (action.kind === 'refuse') {
          return { kind: 'schema-refused', reason: action.reason };
        }
        let upgraded;
        try {
          upgraded =
            action.kind === 'migrate'
              ? migrateEnvelope(parsed.envelope, ENVELOPE_SCHEMA_VERSION)
              : parsed.envelope;
        } catch (e) {
          return {
            kind: 'error',
            message: `envelope migration failed: ${(e as Error).message}`,
          };
        }
        remoteTables = upgraded.tables as TablesData;
        priorDevices = upgraded.devices;
        remoteGeneration = upgraded.generation;
      }

      // ---- Local snapshot + merge ----
      let localTables: TablesData;
      try {
        localTables = await this.deps.storage.readAllTables();
      } catch (e) {
        return { kind: 'error', message: `read local: ${(e as Error).message}` };
      }
      const mergedTables: Record<SyncedTableName, readonly SyncRow[]> = { ...EMPTY_TABLES };
      const allConflicts: LoserEntry[] = [];
      for (const table of SYNCED_TABLES) {
        const ctx: MergeContext = {
          table,
          keyFn: TABLE_KEYS[table],
          localDeviceId: this.deps.config.localDeviceId,
          lastSyncedAt: settings.lastSyncedAt,
        };
        const result = mergeTable(localTables[table] ?? [], remoteTables[table] ?? [], ctx);
        mergedTables[table] = result.merged;
        for (const c of result.conflicts) allConflicts.push(c);
      }

      // ---- Atomic apply (merged rows + conflict log in one transaction) ----
      // The storage adapter (22-C2) wraps both writes in a single SQLite
      // transaction; either both land or neither does. This eliminates the
      // race where a winner overwrites local but its loser entry is lost.
      try {
        lastReport = await this.deps.storage.applyMergeResult({
          merged: mergedTables as TablesData,
          conflicts: allConflicts,
        });
      } catch (e) {
        return { kind: 'error', message: `apply merge result: ${(e as Error).message}` };
      }

      // ---- Build new envelope ----
      const newGeneration = remoteGeneration + 1;
      const newEnvelope = await buildEnvelope({
        appVersion: this.deps.config.appVersion,
        generation: newGeneration,
        localDeviceId: this.deps.config.localDeviceId,
        tables: mergedTables as TablesData,
        priorDevices,
        now: now(),
      });

      // ---- Push with CAS ----
      try {
        const putResult = await this.deps.drive.putCurrent(
          serializeEnvelope(newEnvelope),
          driveSnapshot?.fileId ?? null,
          driveSnapshot?.etag ?? null,
        );
        try {
          await this.deps.settings.write({
            lastSyncedAt: now(),
            lastEtag: putResult.etag,
            lastFileId: putResult.fileId,
            lastGeneration: newGeneration,
          });
        } catch (e) {
          return { kind: 'error', message: `settings write: ${(e as Error).message}` };
        }
        return {
          kind: 'pushed',
          newGeneration,
          conflicts: allConflicts.length,
          report: lastReport,
        };
      } catch (e) {
        const prefix = errorPrefix(e);
        if (prefix === 'PRECONDITION_FAILED') {
          // Another device wrote between our Pull and Push. Re-Pull and
          // re-merge — the merge is conflict-free over the new remote.
          // conflict_log inserts are idempotent on conflictEventId so
          // re-running merge does not duplicate loser entries.
          continue;
        }
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    }
    return { kind: 'cas-exhausted', attempts: MAX_CAS_RETRIES };
  }
}

const EMPTY_TABLES: TablesData = {
  blocks: [],
  projects: [],
  project_budget_overrides: [],
  templates: [],
  gcal_assignments: [],
  gcal_summary_rules: [],
};
