/**
 * Slice 22-C2: assemble a production {@link SyncManager} from real Tauri
 * + SQLite adapters.
 *
 * The React wiring layer (22-C3) calls `createSyncManager(getToken)`
 * once per app session. `getToken` is the access-token getter from
 * `useGcalAuth` — it MUST already be refresh-aware (401 → silent
 * refresh) since the orchestrator does not retry on auth failure.
 *
 * `device_id` is fetched from the `settings` table on first use.
 * `storage.ts` ensures the row exists on app start (Slice 14-B), so we
 * just read it; an extra defensive `INSERT OR IGNORE` here would race
 * with that bootstrap.
 */

import Database from '@tauri-apps/plugin-sql';
import { createDriveAdapter, type AccessTokenSource } from './driveAdapter.js';
import { createSyncSettings } from './syncSettings.js';
import { createSyncStorage } from './syncStorage.js';
import { SyncManager } from './syncManager.js';

const SQLITE_DB = 'sqlite:taskette.db';

const readDeviceId = async (): Promise<string> => {
  const db = await Database.load(SQLITE_DB);
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'device_id'",
  );
  const first = rows[0];
  if (first === undefined) {
    throw new Error('sync: device_id missing from settings — storage bootstrap did not run');
  }
  return first.value;
};

export type CreateSyncManagerOptions = {
  /** Access-token source. Must transparently refresh on 401. */
  readonly getToken: AccessTokenSource;
  /** App version, baked into each published envelope. */
  readonly appVersion: string;
};

export const createSyncManager = async (
  opts: CreateSyncManagerOptions,
): Promise<SyncManager> => {
  const localDeviceId = await readDeviceId();
  return new SyncManager({
    drive: createDriveAdapter(opts.getToken),
    storage: createSyncStorage(),
    settings: createSyncSettings(),
    config: {
      appVersion: opts.appVersion,
      localDeviceId,
    },
  });
};
