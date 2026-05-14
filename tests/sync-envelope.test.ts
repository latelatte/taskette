import { describe, expect, it } from 'vitest';
import {
  buildEnvelope,
  ENVELOPE_SCHEMA_VERSION,
  parseEnvelope,
  serializeEnvelope,
  SYNCED_TABLES,
  type TablesData,
} from '../src/sync/envelopeSerializer.js';
import {
  decideSchemaAction,
  migrateEnvelope,
} from '../src/sync/snapshotMigrator.js';
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

describe('buildEnvelope', () => {
  it('stamps schemaVersion, generation, createdAt, devices', async () => {
    const env = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 42,
      localDeviceId: DEV_A,
      tables: { ...emptyTables(), blocks: [row({ id: 'a' })] },
      now: 5000,
    });
    expect(env.schemaVersion).toBe(ENVELOPE_SCHEMA_VERSION);
    expect(env.appVersion).toBe('0.5.0');
    expect(env.generation).toBe(42);
    expect(env.createdAt).toBe(5000);
    expect(env.devices[DEV_A]).toEqual({ lastSeenGeneration: 42, lastSyncAt: 5000 });
  });

  it('preserves prior device watermarks while updating local', async () => {
    const env = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 10,
      localDeviceId: DEV_A,
      tables: emptyTables(),
      priorDevices: {
        [DEV_B]: { lastSeenGeneration: 7, lastSyncAt: 1000 },
        [DEV_A]: { lastSeenGeneration: 9, lastSyncAt: 2000 },
      },
      now: 3000,
    });
    expect(env.devices[DEV_B]).toEqual({ lastSeenGeneration: 7, lastSyncAt: 1000 });
    expect(env.devices[DEV_A]).toEqual({ lastSeenGeneration: 10, lastSyncAt: 3000 });
  });

  it('produces an identical contentSha256 for semantically equal table data', async () => {
    const tables1: TablesData = {
      ...emptyTables(),
      blocks: [row({ id: 'a' }), row({ id: 'b', revision: 2 })],
    };
    const tables2: TablesData = {
      ...emptyTables(),
      // Order reversed — sha must still match.
      blocks: [row({ id: 'b', revision: 2 }), row({ id: 'a' })],
    };
    const e1 = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_A,
      tables: tables1,
      now: 1,
    });
    const e2 = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_A,
      tables: tables2,
      now: 1,
    });
    expect(e1.contentSha256).toBe(e2.contentSha256);
    expect(e1.contentSha256.length).toBeGreaterThan(0);
  });
});

describe('parseEnvelope', () => {
  it('round-trips through serializeEnvelope (sha256 matches)', async () => {
    const original = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 7,
      localDeviceId: DEV_A,
      tables: { ...emptyTables(), blocks: [row({ id: 'x' })] },
      now: 1000,
    });
    const parsed = await parseEnvelope(serializeEnvelope(original));
    expect(parsed.envelope.schemaVersion).toBe(original.schemaVersion);
    expect(parsed.envelope.generation).toBe(original.generation);
    expect(parsed.envelope.appVersion).toBe(original.appVersion);
    expect(parsed.envelope.devices).toEqual(original.devices);
    expect(parsed.envelope.tables.blocks).toHaveLength(1);
    expect(parsed.droppedRows).toBe(0);
    expect(parsed.sha256Matches).toBe(true);
  });

  it('rejects malformed JSON', async () => {
    await expect(parseEnvelope('not json')).rejects.toThrow(/invalid JSON/);
  });

  it('rejects when required top-level fields are missing', async () => {
    await expect(
      parseEnvelope(
        JSON.stringify({ schemaVersion: 1, appVersion: '0.5.0', generation: 1 }),
      ),
    ).rejects.toThrow(/createdAt|devices|tables/);
  });

  it('reports dropped rows but keeps valid ones in the same table', async () => {
    const env = {
      schemaVersion: 1,
      appVersion: '0.5.0',
      generation: 1,
      createdAt: 1000,
      devices: { [DEV_A]: { lastSeenGeneration: 1, lastSyncAt: 1000 } },
      contentSha256: '',
      tables: {
        blocks: [row({ id: 'good' }), { id: 'bad' }],
      },
    };
    const parsed = await parseEnvelope(JSON.stringify(env));
    const blocks = parsed.envelope.tables['blocks'] ?? [];
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as SyncRow).id).toBe('good');
    expect(parsed.droppedRows).toBe(1);
  });

  it('treats missing sync tables as empty arrays', async () => {
    const env = {
      schemaVersion: 1,
      appVersion: '0.5.0',
      generation: 1,
      createdAt: 1000,
      devices: {},
      contentSha256: '',
      tables: { blocks: [row({ id: 'a' })] },
    };
    const parsed = await parseEnvelope(JSON.stringify(env));
    for (const name of SYNCED_TABLES) {
      expect(parsed.envelope.tables[name]).toBeDefined();
    }
    expect(parsed.envelope.tables['projects']).toEqual([]);
  });

  it('flags sha256 mismatch (tampered tables vs original digest)', async () => {
    const original = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_A,
      tables: { ...emptyTables(), blocks: [row({ id: 'x' })] },
      now: 1000,
    });
    // Tamper: add an extra row but keep the original sha256.
    const tampered = {
      ...original,
      tables: { ...original.tables, blocks: [...original.tables['blocks']!, row({ id: 'y' })] },
    };
    const parsed = await parseEnvelope(JSON.stringify(tampered));
    expect(parsed.sha256Matches).toBe(false);
  });

  it('treats empty contentSha256 as "not provided" (sha256Matches=true)', async () => {
    const env = {
      schemaVersion: 1,
      appVersion: '0.5.0',
      generation: 1,
      createdAt: 1000,
      devices: {},
      contentSha256: '',
      tables: { blocks: [row({ id: 'a' })] },
    };
    const parsed = await parseEnvelope(JSON.stringify(env));
    expect(parsed.sha256Matches).toBe(true);
  });
});

describe('decideSchemaAction', () => {
  it('pass when versions match', () => {
    expect(decideSchemaAction(1, 1)).toEqual({ kind: 'pass' });
  });

  it('migrate when DB is newer than snapshot', () => {
    expect(decideSchemaAction(3, 1)).toEqual({ kind: 'migrate', from: 1, to: 3 });
  });

  it('refuse when snapshot is newer than DB (avoid silent data loss)', () => {
    const res = decideSchemaAction(1, 2);
    expect(res.kind).toBe('refuse');
    if (res.kind === 'refuse') expect(res.reason).toMatch(/upgrade this client/);
  });
});

describe('migrateEnvelope', () => {
  it('returns the same envelope when already at target', async () => {
    const env = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_A,
      tables: emptyTables(),
      now: 1,
    });
    expect(migrateEnvelope(env, ENVELOPE_SCHEMA_VERSION)).toBe(env);
  });

  it('errors when asked to downgrade', async () => {
    const env = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_A,
      tables: emptyTables(),
      now: 1,
    });
    expect(() => migrateEnvelope(env, 0)).toThrow(/cannot downgrade/);
  });

  it('errors when no migrator covers the gap', async () => {
    const env = await buildEnvelope({
      appVersion: '0.5.0',
      generation: 1,
      localDeviceId: DEV_A,
      tables: emptyTables(),
      now: 1,
    });
    // Override schemaVersion to simulate an older snapshot with no path forward.
    const older = { ...env, schemaVersion: 0 };
    expect(() => migrateEnvelope(older, ENVELOPE_SCHEMA_VERSION)).toThrow(
      /no migrator/,
    );
  });
});
