/**
 * Slice 22-C2: SQLite implementation of {@link SyncStorageDeps}.
 *
 * Responsibilities:
 *   - `readAllTables`: SELECT every row (including tombstones) from each
 *     synced table. Tombstones must propagate across devices, so unlike
 *     `storage.ts:load()` we do NOT filter `deleted_at IS NULL`.
 *   - `applyMergeResult`: revision-guarded UPSERT per row + idempotent
 *     INSERT OR IGNORE into conflict_log. tauri-plugin-sql 2.x has no
 *     explicit transaction API, so atomicity is approximated:
 *       (1) conflict_log inserts run first — even if subsequent row
 *           writes fail, the loser audit trail is preserved.
 *       (2) Row writes use `WHERE excluded.revision >= existing.revision`
 *           so the operation is idempotent on retry. A partial failure
 *           re-converges on the next sync cycle.
 *
 * Type translation: SQLite columns are snake_case and store INTEGER for
 * booleans/timestamps. Synced rows mirror that shape (camelCase keys,
 * raw numeric/boolean-as-number values) — the merge module treats them
 * as opaque, so we don't waste cycles converting through Boolean/Date.
 */

import Database from '@tauri-apps/plugin-sql';
import type { LoserEntry } from './merge.js';
import type {
  ApplyMergeResultReport,
  SyncStorageDeps,
} from './syncOrchestrator.js';
import type { SyncedTableName, TablesData } from './envelopeSerializer.js';
import { SYNCED_TABLES } from './envelopeSerializer.js';
import type { SyncRow } from './types.js';

const SQLITE_DB = 'sqlite:taskette.db';

type ColumnSpec = {
  readonly sql: string;
  readonly ts: string;
  /** True iff the SQLite schema declares this column NOT NULL. Validation
   * rejects incoming rows that lack it (prevents sync DoS where a corrupt
   * remote envelope keeps failing apply on every cycle). */
  readonly notNull: boolean;
};

type TableSpec = {
  readonly sqlTable: string;
  readonly syncedTable: SyncedTableName;
  /** SQL column names that form the primary key (for ON CONFLICT). */
  readonly pkSql: readonly string[];
  /** All non-PK, non-sync-meta columns (payload). */
  readonly payloadCols: readonly ColumnSpec[];
  /** PK columns as ColumnSpec (must appear in pkSql in order). */
  readonly pkCols: readonly ColumnSpec[];
};

// Sync metadata columns are identical across every synced table.
// `deleted_at` is the only nullable meta column (NULL = active row).
const META_COLS: readonly ColumnSpec[] = [
  { sql: 'created_at', ts: 'createdAt', notNull: true },
  { sql: 'updated_at', ts: 'updatedAt', notNull: true },
  { sql: 'deleted_at', ts: 'deletedAt', notNull: false },
  { sql: 'created_by_device_id', ts: 'createdByDeviceId', notNull: true },
  { sql: 'updated_by_device_id', ts: 'updatedByDeviceId', notNull: true },
  { sql: 'revision', ts: 'revision', notNull: true },
];

const TABLE_SPECS: readonly TableSpec[] = [
  {
    sqlTable: 'blocks',
    syncedTable: 'blocks',
    pkSql: ['id'],
    pkCols: [{ sql: 'id', ts: 'id', notNull: true }],
    payloadCols: [
      { sql: 'date', ts: 'date', notNull: true },
      { sql: 'start_min', ts: 'startMin', notNull: true },
      { sql: 'duration_min', ts: 'durationMin', notNull: true },
      { sql: 'label', ts: 'label', notNull: true },
      { sql: 'project_id', ts: 'projectId', notNull: false },
      { sql: 'template_id', ts: 'templateId', notNull: false },
      { sql: 'source', ts: 'source', notNull: false },
      { sql: 'gcal_key', ts: 'gcalKey', notNull: false },
      { sql: 'notify_offset_min', ts: 'notifyOffsetMin', notNull: false },
    ],
  },
  {
    sqlTable: 'projects',
    syncedTable: 'projects',
    pkSql: ['id'],
    pkCols: [{ sql: 'id', ts: 'id', notNull: true }],
    payloadCols: [
      { sql: 'name', ts: 'name', notNull: true },
      { sql: 'color', ts: 'color', notNull: true },
      { sql: 'monthly_budget_pm', ts: 'monthlyBudgetPm', notNull: false },
      { sql: 'pinned', ts: 'pinned', notNull: true },
      { sql: 'energy', ts: 'energy', notNull: true },
      { sql: 'end_month', ts: 'endMonth', notNull: false },
      { sql: 'position', ts: 'position', notNull: true },
      { sql: 'end_date', ts: 'endDate', notNull: false },
      { sql: 'start_date', ts: 'startDate', notNull: false },
    ],
  },
  {
    sqlTable: 'project_budget_overrides',
    syncedTable: 'project_budget_overrides',
    pkSql: ['project_id', 'ym'],
    pkCols: [
      { sql: 'project_id', ts: 'projectId', notNull: true },
      { sql: 'ym', ts: 'ym', notNull: true },
    ],
    payloadCols: [{ sql: 'hours', ts: 'hours', notNull: true }],
  },
  {
    sqlTable: 'templates',
    syncedTable: 'templates',
    pkSql: ['id'],
    pkCols: [{ sql: 'id', ts: 'id', notNull: true }],
    payloadCols: [
      { sql: 'label', ts: 'label', notNull: true },
      { sql: 'color', ts: 'color', notNull: false },
      { sql: 'project_id', ts: 'projectId', notNull: false },
      { sql: 'default_duration_min', ts: 'defaultDurationMin', notNull: true },
    ],
  },
  {
    sqlTable: 'gcal_assignments',
    syncedTable: 'gcal_assignments',
    pkSql: ['gcal_key'],
    pkCols: [{ sql: 'gcal_key', ts: 'gcalKey', notNull: true }],
    payloadCols: [
      { sql: 'project_id', ts: 'projectId', notNull: false },
      { sql: 'hidden', ts: 'hidden', notNull: true },
      { sql: 'summary', ts: 'summary', notNull: false },
    ],
  },
  {
    sqlTable: 'gcal_summary_rules',
    syncedTable: 'gcal_summary_rules',
    pkSql: ['summary'],
    pkCols: [{ sql: 'summary', ts: 'summary', notNull: true }],
    payloadCols: [
      { sql: 'project_id', ts: 'projectId', notNull: false },
      { sql: 'hidden', ts: 'hidden', notNull: true },
    ],
  },
];

const specByTable: Readonly<Record<SyncedTableName, TableSpec>> = Object.freeze(
  Object.fromEntries(TABLE_SPECS.map((s) => [s.syncedTable, s])) as Record<
    SyncedTableName,
    TableSpec
  >,
);

const allCols = (spec: TableSpec): readonly ColumnSpec[] => [
  ...spec.pkCols,
  ...spec.payloadCols,
  ...META_COLS,
];

const readTable = async (
  db: Database,
  spec: TableSpec,
): Promise<readonly SyncRow[]> => {
  const cols = allCols(spec);
  const sqlList = cols.map((c) => c.sql).join(', ');
  const rows = await db.select<Array<Record<string, unknown>>>(
    `SELECT ${sqlList} FROM ${spec.sqlTable}`,
  );
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) out[c.ts] = row[c.sql];
    return out as SyncRow;
  });
};

/**
 * Returns a SQL fragment that is TRUE iff `excluded.*` beats `${t}.*` by
 * the same 4-tier LWW tuple that {@link import('./merge.js').pickWinner}
 * uses: (revision DESC, updated_at DESC, tombstone wins on tie,
 * updated_by_device_id ASC). Without this, an UPSERT with `>=` would
 * silently clobber a concurrent local edit that happened to land at the
 * same revision as the merge winner.
 */
const buildWinPredicate = (t: string): string =>
  // Note: in SQLite, `x IS NOT NULL` evaluates to 1 or 0, so we can
  // compare deleted-state with `>` / `=` directly.
  `excluded.revision > ${t}.revision
    OR (excluded.revision = ${t}.revision AND (
      excluded.updated_at > ${t}.updated_at
      OR (excluded.updated_at = ${t}.updated_at AND (
        ((excluded.deleted_at IS NOT NULL) > (${t}.deleted_at IS NOT NULL))
        OR (
          ((excluded.deleted_at IS NOT NULL) = (${t}.deleted_at IS NOT NULL))
          AND excluded.updated_by_device_id < ${t}.updated_by_device_id
        )
      ))
    ))`;

const buildUpsertSql = (spec: TableSpec): string => {
  const cols = allCols(spec);
  const colList = cols.map((c) => c.sql).join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const pkList = spec.pkSql.join(', ');
  const setList = cols
    .filter((c) => !spec.pkSql.includes(c.sql))
    .map((c) => `${c.sql} = excluded.${c.sql}`)
    .join(', ');
  return (
    `INSERT INTO ${spec.sqlTable} (${colList}) VALUES (${placeholders}) ` +
    `ON CONFLICT(${pkList}) DO UPDATE SET ${setList} ` +
    `WHERE ${buildWinPredicate(spec.sqlTable)}`
  );
};

// SQL is identical per spec; cache so we don't re-stringify every row.
const upsertSqlCache = new Map<string, string>();
const getUpsertSql = (spec: TableSpec): string => {
  let cached = upsertSqlCache.get(spec.sqlTable);
  if (cached === undefined) {
    cached = buildUpsertSql(spec);
    upsertSqlCache.set(spec.sqlTable, cached);
  }
  return cached;
};

/**
 * Reject rows that omit a NOT NULL column. A row produced by a buggy /
 * older / hand-crafted producer would otherwise INSERT-fail mid-batch,
 * leaving the conflict log written but the merge un-applied — and the
 * next sync would retry the same broken envelope forever.
 */
const validateRow = (spec: TableSpec, row: SyncRow): string | null => {
  for (const col of allCols(spec)) {
    if (!col.notNull) continue;
    const v = (row as Record<string, unknown>)[col.ts];
    if (v === undefined || v === null) {
      return `${spec.sqlTable}.${col.sql}: NOT NULL column is ${
        v === undefined ? 'undefined' : 'null'
      }`;
    }
  }
  return null;
};

const upsertOne = async (
  db: Database,
  spec: TableSpec,
  row: SyncRow,
): Promise<'applied' | 'skipped'> => {
  const cols = allCols(spec);
  const values: unknown[] = cols.map((c) => {
    const v = (row as Record<string, unknown>)[c.ts];
    return v === undefined ? null : v;
  });
  const result = await db.execute(getUpsertSql(spec), values);
  // tauri-plugin-sql returns rowsAffected. INSERT path always touches 1
  // row; UPDATE path returns 1 only when the WHERE win-predicate matched.
  // 0 = the existing local row beat the merge winner by LWW tuple, so
  // we preserve it (a concurrent edit during sync; will be Pushed next
  // cycle via the post-apply re-read in syncOrchestrator).
  return result.rowsAffected === 0 ? 'skipped' : 'applied';
};

const insertConflictLog = async (db: Database, loser: LoserEntry): Promise<boolean> => {
  // `conflict_event_id` is PRIMARY KEY on conflict_log (migration 008),
  // so INSERT OR IGNORE collapses retries without raising.
  const result = await db.execute(
    `INSERT OR IGNORE INTO conflict_log
     (conflict_event_id, table_name, row_key, local_revision, remote_revision,
      winner_device_id, loser_device_id, loser_payload, created_at, restored)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      loser.conflictEventId,
      loser.table,
      loser.rowKey,
      loser.localRevision,
      loser.remoteRevision,
      loser.winnerDeviceId,
      loser.loserDeviceId,
      JSON.stringify(loser.loserPayload),
      loser.createdAt,
    ],
  );
  return result.rowsAffected > 0;
};

export const createSyncStorage = (): SyncStorageDeps => {
  let cachedDb: Promise<Database> | null = null;
  const getDb = (): Promise<Database> => {
    if (cachedDb === null) cachedDb = Database.load(SQLITE_DB);
    return cachedDb;
  };

  return {
    readAllTables: async (): Promise<TablesData> => {
      const db = await getDb();
      const result: Record<SyncedTableName, readonly SyncRow[]> = {
        blocks: [],
        projects: [],
        project_budget_overrides: [],
        templates: [],
        gcal_assignments: [],
        gcal_summary_rules: [],
      };
      for (const name of SYNCED_TABLES) {
        result[name] = await readTable(db, specByTable[name]);
      }
      return result;
    },

    applyMergeResult: async ({ merged, conflicts }): Promise<ApplyMergeResultReport> => {
      const db = await getDb();

      // Pre-validate every row up front. Any NOT NULL violation aborts
      // before touching the DB so we don't end up with a half-applied
      // batch (worse: a conflict log that records a loser we never
      // actually replaced).
      for (const name of SYNCED_TABLES) {
        const spec = specByTable[name];
        const rows = merged[name] ?? [];
        for (const row of rows) {
          const err = validateRow(spec, row);
          if (err !== null) {
            throw new Error(`sync apply: row validation failed: ${err}`);
          }
        }
      }

      let conflictsPersisted = 0;
      // Conflict log first: any failure now leaves local untouched.
      for (const c of conflicts) {
        if (await insertConflictLog(db, c)) conflictsPersisted++;
      }
      let appliedRows = 0;
      let skippedRows = 0;
      for (const name of SYNCED_TABLES) {
        const spec = specByTable[name];
        const rows = merged[name] ?? [];
        for (const row of rows) {
          const outcome = await upsertOne(db, spec, row);
          if (outcome === 'applied') appliedRows++;
          else skippedRows++;
        }
      }
      return { appliedRows, skippedRows, conflictsPersisted };
    },
  };
};
