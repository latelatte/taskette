/**
 * Slice 22-C2: SQLite implementation of {@link SyncSettingsDeps}.
 *
 * Persists sync state across runs as key/value rows in the existing
 * `settings` table (migration 001). Keys are namespaced with `sync_`
 * so they don't collide with the existing `device_id` row.
 *
 * Stored keys:
 *   - sync_last_synced_at   epoch ms, integer in string form
 *   - sync_last_etag        Drive ETag of the last successfully-pushed current.json
 *   - sync_last_file_id     Drive file id of current.json
 *   - sync_last_generation  envelope generation we last published
 *
 * Reads of missing keys return defaults (lastSyncedAt=0, nulls).
 */

import Database from '@tauri-apps/plugin-sql';
import type {
  SyncSettingsDeps,
  SyncSettingsState,
} from './syncOrchestrator.js';

const SQLITE_DB = 'sqlite:taskette.db';

const KEYS = {
  lastSyncedAt: 'sync_last_synced_at',
  lastEtag: 'sync_last_etag',
  lastFileId: 'sync_last_file_id',
  lastGeneration: 'sync_last_generation',
} as const;

const readKey = async (db: Database, key: string): Promise<string | null> => {
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  const first = rows[0];
  return first === undefined ? null : first.value;
};

const writeKey = async (db: Database, key: string, value: string): Promise<void> => {
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, Date.now()],
  );
};

export const createSyncSettings = (): SyncSettingsDeps => {
  let cachedDb: Promise<Database> | null = null;
  const getDb = (): Promise<Database> => {
    if (cachedDb === null) cachedDb = Database.load(SQLITE_DB);
    return cachedDb;
  };

  return {
    read: async (): Promise<SyncSettingsState> => {
      const db = await getDb();
      const [lastSyncedAt, lastEtag, lastFileId, lastGeneration] = await Promise.all([
        readKey(db, KEYS.lastSyncedAt),
        readKey(db, KEYS.lastEtag),
        readKey(db, KEYS.lastFileId),
        readKey(db, KEYS.lastGeneration),
      ]);
      const parseInt = (raw: string | null, key: string): number => {
        if (raw === null) return 0;
        const n = Number.parseInt(raw, 10);
        if (Number.isNaN(n)) {
          // Silent fallback to 0 would mask a corrupted settings row and
          // confuse the LWW conflict anchor. Surface it via the console so
          // a developer notices on next sync run.
          console.warn(
            `sync settings: ${key}=${JSON.stringify(raw)} is not an integer; defaulting to 0`,
          );
          return 0;
        }
        return n;
      };
      return {
        lastSyncedAt: parseInt(lastSyncedAt, KEYS.lastSyncedAt),
        lastEtag,
        lastFileId,
        lastGeneration: parseInt(lastGeneration, KEYS.lastGeneration),
      };
    },

    write: async (partial): Promise<void> => {
      const db = await getDb();
      // Each execute is its own auto-commit (tauri-plugin-sql 2.x has
      // no tx API). To make partial-write recovery safe, we run them
      // sequentially and put `lastSyncedAt` LAST — it is the conflict
      // anchor consulted by the next sync, so as long as it lands only
      // after the etag/fileId/generation that pair with it, a crash
      // mid-write leaves the next sync re-pulling against the prior
      // anchor (safe) instead of trusting a partial state.
      if (partial.lastEtag !== undefined && partial.lastEtag !== null) {
        await writeKey(db, KEYS.lastEtag, partial.lastEtag);
      }
      if (partial.lastFileId !== undefined && partial.lastFileId !== null) {
        await writeKey(db, KEYS.lastFileId, partial.lastFileId);
      }
      if (partial.lastGeneration !== undefined) {
        await writeKey(db, KEYS.lastGeneration, String(partial.lastGeneration));
      }
      if (partial.lastSyncedAt !== undefined) {
        await writeKey(db, KEYS.lastSyncedAt, String(partial.lastSyncedAt));
      }
    },
  };
};
