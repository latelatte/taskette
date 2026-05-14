/**
 * Slice 22-C1: build / extract the v0.5 Drive snapshot envelope.
 *
 * The envelope is the unit of exchange between devices. Each Push writes
 * a fresh envelope (incremented generation), each Pull reads the latest
 * one and feeds the embedded table data into row-level merge (22-A).
 *
 * `ENVELOPE_SCHEMA_VERSION` tracks the shape of `tables[*]` rows. Bumping
 * it requires a corresponding snapshotMigrator entry. SQLite migration
 * versions are tracked separately — many migrations (e.g. local-only
 * indexes, conflict_log) don't change the synced row shape.
 */

import type { DeviceMeta, SnapshotEnvelope, SyncRow } from './types.js';

export const ENVELOPE_SCHEMA_VERSION = 1;

export const SYNCED_TABLES = [
  'blocks',
  'projects',
  'project_budget_overrides',
  'templates',
  'gcal_assignments',
  'gcal_summary_rules',
] as const;

export type SyncedTableName = (typeof SYNCED_TABLES)[number];

export type TablesData = Readonly<Record<SyncedTableName, readonly SyncRow[]>>;

export type BuildEnvelopeInput = {
  readonly appVersion: string;
  readonly generation: number;
  readonly localDeviceId: string;
  readonly tables: TablesData;
  /**
   * Per-device watermarks from the prior envelope. The local device's
   * entry is rewritten with the new generation; other devices are
   * carried forward untouched. Pass `{}` for the very first publish.
   */
  readonly priorDevices?: Readonly<Record<string, DeviceMeta>>;
  /** Override the wall clock for deterministic tests. */
  readonly now?: number;
};

const sha256Hex = async (input: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    // Web Crypto missing (very old Node). Integrity check is best-effort
    // per design; returning an empty digest still produces a valid
    // envelope, just one whose `contentSha256` cannot be verified later.
    return '';
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Canonical JSON stringify with recursive key sort. Object literal key
 * order is technically deterministic in modern JS (insertion order), but
 * SQLite drivers / external snapshots / userland code can produce the
 * same logical row with different key orders. Canonicalizing guarantees
 * bit-identical `contentSha256` for semantically equal data.
 */
const canonicalJsonStringify = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]))
        .join(',') +
      '}'
    );
  }
  // undefined / function / symbol — should not appear in synced data.
  return 'null';
};

/**
 * Deterministic, sorted JSON of just the tables payload. Used as the
 * sha256 input. Never serialize the entire envelope object first because
 * non-table fields (createdAt, devices) legitimately differ between
 * equivalent snapshots.
 */
const stableStringifyTables = (tables: TablesData): string => {
  // Sort table names AND each row's canonical-stringified form to
  // collapse any insertion-order differences across devices.
  const sortedTables: Record<string, string[]> = {};
  for (const name of [...SYNCED_TABLES].sort()) {
    const rows = tables[name] ?? [];
    const canonRows = rows.map((r) => canonicalJsonStringify(r));
    canonRows.sort();
    sortedTables[name] = canonRows;
  }
  // Already canonical: keys sorted, rows are pre-stringified.
  // One last pass to wrap in an outer canonical structure.
  const keys = Object.keys(sortedTables).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':[' + sortedTables[k]!.join(',') + ']')
      .join(',') +
    '}'
  );
};

export const buildEnvelope = async (input: BuildEnvelopeInput): Promise<SnapshotEnvelope> => {
  const now = input.now ?? Date.now();
  const tablesJson = stableStringifyTables(input.tables);
  const contentSha256 = await sha256Hex(tablesJson);

  const devices: Record<string, DeviceMeta> = { ...(input.priorDevices ?? {}) };
  devices[input.localDeviceId] = {
    lastSeenGeneration: input.generation,
    lastSyncAt: now,
  };

  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    appVersion: input.appVersion,
    generation: input.generation,
    createdAt: now,
    devices,
    contentSha256,
    tables: input.tables,
  };
};

export type ParsedEnvelope = {
  readonly envelope: SnapshotEnvelope;
  readonly tablesByName: TablesData;
  /**
   * Count of rows that failed sync-metadata validation and were excluded
   * from `tablesByName`. The orchestrator MUST abort the sync cycle when
   * this is > 0 — silently continuing would Push back an envelope missing
   * those rows, effectively deleting them from remote. Manual reconciliation
   * (or another device's clean Push) is the recovery path.
   */
  readonly droppedRows: number;
  /**
   * True iff the envelope's contentSha256 matched the recomputed digest
   * over `tablesByName`. False indicates either a corrupted Drive blob or
   * a producer that didn't compute the digest (legacy / external tools).
   * Orchestrator treats false as a corruption signal alongside droppedRows.
   */
  readonly sha256Matches: boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const looksLikeSyncRow = (v: unknown): v is SyncRow =>
  isRecord(v) &&
  typeof v.revision === 'number' &&
  typeof v.updatedAt === 'number' &&
  typeof v.updatedByDeviceId === 'string' &&
  (v.deletedAt === null || typeof v.deletedAt === 'number') &&
  typeof v.createdAt === 'number' &&
  typeof v.createdByDeviceId === 'string';

/**
 * Parse a raw JSON string into a typed envelope. Rejects on shape
 * violations; the caller (orchestrator) translates the error into a
 * sync-aborting condition. Unknown extra fields are preserved so that a
 * newer-format snapshot from a future client can be downgraded by the
 * migrator (or rejected with a clear message).
 *
 * Async because it recomputes `contentSha256` for integrity checking.
 */
export const parseEnvelope = async (raw: string): Promise<ParsedEnvelope> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`envelope parse: invalid JSON: ${(e as Error).message}`);
  }
  if (!isRecord(parsed)) throw new Error('envelope parse: top-level is not an object');

  const {
    schemaVersion,
    appVersion,
    generation,
    createdAt,
    devices,
    contentSha256,
    tables,
  } = parsed;

  if (typeof schemaVersion !== 'number') throw new Error('envelope parse: schemaVersion missing/invalid');
  if (typeof appVersion !== 'string') throw new Error('envelope parse: appVersion missing/invalid');
  if (typeof generation !== 'number') throw new Error('envelope parse: generation missing/invalid');
  if (typeof createdAt !== 'number') throw new Error('envelope parse: createdAt missing/invalid');
  if (!isRecord(devices)) throw new Error('envelope parse: devices missing/invalid');
  if (typeof contentSha256 !== 'string') throw new Error('envelope parse: contentSha256 missing/invalid');
  if (!isRecord(tables)) throw new Error('envelope parse: tables missing/invalid');

  const validatedDevices: Record<string, DeviceMeta> = {};
  for (const [deviceId, meta] of Object.entries(devices)) {
    if (!isRecord(meta)) continue;
    const { lastSeenGeneration, lastSyncAt } = meta;
    if (typeof lastSeenGeneration === 'number' && typeof lastSyncAt === 'number') {
      validatedDevices[deviceId] = { lastSeenGeneration, lastSyncAt };
    }
  }

  const validatedTables: Record<string, readonly SyncRow[]> = {};
  let droppedRows = 0;
  for (const name of SYNCED_TABLES) {
    const rows = tables[name];
    if (rows === undefined) {
      validatedTables[name] = [];
      continue;
    }
    if (!Array.isArray(rows)) {
      throw new Error(`envelope parse: tables.${name} is not an array`);
    }
    const validRows: SyncRow[] = [];
    for (const r of rows) {
      if (looksLikeSyncRow(r)) {
        validRows.push(r);
      } else {
        droppedRows++;
      }
    }
    validatedTables[name] = validRows;
  }

  const envelope: SnapshotEnvelope = {
    schemaVersion,
    appVersion,
    generation,
    createdAt,
    devices: validatedDevices,
    contentSha256,
    tables: validatedTables,
  };

  // Verify integrity. An empty `contentSha256` is treated as "producer
  // did not provide one" — informational rather than corrupt.
  let sha256Matches = true;
  if (contentSha256.length > 0) {
    const recomputed = await sha256Hex(stableStringifyTables(validatedTables as TablesData));
    sha256Matches = recomputed === contentSha256;
  }

  return {
    envelope,
    tablesByName: validatedTables as TablesData,
    droppedRows,
    sha256Matches,
  };
};

export const serializeEnvelope = (envelope: SnapshotEnvelope): string => JSON.stringify(envelope);
