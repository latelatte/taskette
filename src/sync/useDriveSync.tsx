/**
 * Slice 22-C3: React hook glueing the sync pipeline to the UI.
 *
 * Responsibilities:
 *   - Persist user-facing sync preferences (enabled / smoke test result /
 *     granted scopes) in the SQLite settings table.
 *   - Maintain a {@link SyncManager} instance while sync is enabled and
 *     a Tauri access token is available.
 *   - Expose actions: enable / disable / runSync / runSmokeTest.
 *   - Drive a minimal auto-trigger: re-sync when the window regains
 *     visibility AND the last sync is older than 5 minutes.
 *   - Notify the caller via `onSyncCompleted` whenever a sync finishes
 *     so App state can be reloaded from SQLite — without this the React
 *     tree would keep displaying pre-merge data while the next user edit
 *     diffs against stale `cachedState` and silently overwrites remote
 *     changes (the Codex Critical from 22-C3 review).
 *
 * Browser runtime is unsupported — Drive sync requires the Rust-side
 * keyring + Drive client. `useDriveSync` returns `{ supported: false }`
 * outside Tauri so the panel can render an explanation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import type { UseGcalAuth } from '../gcal/useGcalAuth.js';
import { createSyncManager } from './syncFactory.js';
import {
  driveSmokeTest,
  SCOPE_CALENDAR_READONLY,
  SCOPE_DRIVE_APPDATA,
  type DriveSmokeReport,
} from './driveClient.js';
import type { SyncManager, SyncManagerOutcome } from './syncManager.js';
import type { SyncResult } from './syncOrchestrator.js';

const SQLITE_DB = 'sqlite:taskette.db';
const AUTO_SYNC_STALE_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_SLACK_MS = 60_000; // refresh if expiring within 1 min

const KEYS = {
  enabled: 'sync_drive_enabled',
  smokeTestPassedAt: 'sync_smoke_test_passed_at',
  grantedScopes: 'sync_granted_scopes',
} as const;

type OAuthTokens = {
  access_token: string;
  expires_at: number; // Unix epoch seconds
  granted_scopes: string[];
};

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const readSetting = async (db: Database, key: string): Promise<string | null> => {
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  return rows[0]?.value ?? null;
};

const writeSetting = async (db: Database, key: string, value: string): Promise<void> => {
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, Date.now()],
  );
};

export type DriveSyncStatus =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'no-token' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'enabling' }
  | { readonly kind: 'smoke-testing' }
  | { readonly kind: 'smoke-failed'; readonly report: DriveSmokeReport }
  /**
   * A previous sync surfaced a non-recoverable result. The persisted
   * `enabled` flag is preserved so toggle remains "On" — UI distinguishes
   * the two by reading `enabled` directly, not `status.kind`.
   */
  | { readonly kind: 'error'; readonly message: string };

export type UseDriveSyncOptions = {
  /**
   * Called after every sync attempt (success / error / cas-exhausted),
   * so the caller can refresh app state from SQLite. The sync writes to
   * the same tables the rest of the app reads — without a reload the UI
   * displays pre-merge data and the next save() diff silently reverts
   * sync's writes (see C1 in 22-C3 review).
   */
  readonly onSyncCompleted?: () => void | Promise<void>;
};

export type UseDriveSync = {
  readonly status: DriveSyncStatus;
  /**
   * Persisted "Drive sync turned on" flag. Decoupled from `status` so a
   * transient error doesn't accidentally collapse the toggle to "off".
   */
  readonly enabled: boolean;
  readonly lastSyncedAt: number | null;
  readonly lastResult: SyncResult | null;
  /** Begin or repeat the enable flow: request Drive consent → smoke test → enable. */
  readonly enable: () => Promise<void>;
  readonly disable: () => Promise<void>;
  /** One-shot manual sync. No-op (returns null) when not enabled or busy. */
  readonly runSync: () => Promise<SyncManagerOutcome | null>;
  /** Re-run the live If-Match contract test (diagnostic). */
  readonly runSmokeTest: () => Promise<DriveSmokeReport | null>;
};

type FreshToken = {
  readonly accessToken: string;
  /** ms epoch */
  readonly expiresAtMs: number;
};

export const useDriveSync = (
  gcal: UseGcalAuth,
  appVersion: string,
  options: UseDriveSyncOptions = {},
): UseDriveSync => {
  const supported = isTauri();
  const [enabled, setEnabled] = useState<boolean>(false);
  const [status, setStatus] = useState<DriveSyncStatus>(
    supported ? { kind: 'loading' } : { kind: 'unsupported' },
  );
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const managerRef = useRef<SyncManager | null>(null);
  // Bumped on every disable() and reset of the manager lifecycle. A sync
  // that completes after disable() must not setStatus — we check that
  // our captured generation still matches at completion time.
  const runGenerationRef = useRef<number>(0);
  const freshTokenRef = useRef<FreshToken | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const requestSilentRefreshRef = useRef<() => Promise<string | null>>(gcal.requestSilentRefresh);
  const onSyncCompletedRef = useRef(options.onSyncCompleted);

  // Keep refs in sync without re-creating callbacks on every gcal re-render.
  useEffect(() => {
    accessTokenRef.current = gcal.accessToken;
  }, [gcal.accessToken]);
  useEffect(() => {
    requestSilentRefreshRef.current = gcal.requestSilentRefresh;
  }, [gcal.requestSilentRefresh]);
  useEffect(() => {
    onSyncCompletedRef.current = options.onSyncCompleted;
  }, [options.onSyncCompleted]);

  // ---- Initial settings load ----
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await Database.load(SQLITE_DB);
        const enabledRaw = await readSetting(db, KEYS.enabled);
        if (cancelled) return;
        setEnabled(enabledRaw === '1');
      } catch (e) {
        if (cancelled) return;
        setStatus({ kind: 'error', message: `load sync settings: ${(e as Error).message}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // ---- Token getter (passed to driveAdapter via SyncManager factory) ----
  // Reads via refs so the function identity stays stable; SyncManager
  // lifecycle is keyed off `appVersion`/`enabled` only.
  const getToken = useCallback(
    async (opts?: { forceRefresh?: boolean }): Promise<string> => {
      // 1. Fresh token captured during enable() takes priority while
      //    valid — it carries the new Drive scope before useGcalAuth's
      //    own state has refreshed.
      const fresh = freshTokenRef.current;
      if (
        !opts?.forceRefresh &&
        fresh !== null &&
        Date.now() < fresh.expiresAtMs - TOKEN_REFRESH_SLACK_MS
      ) {
        return fresh.accessToken;
      }
      // 2. Force-refresh path: invalidate cached fresh + call silent
      //    refresh, which returns a token with whatever scopes the
      //    keyring's refresh token currently grants (which now includes
      //    Drive after enable).
      if (opts?.forceRefresh) {
        freshTokenRef.current = null;
        const refreshed = await requestSilentRefreshRef.current();
        if (refreshed !== null) return refreshed;
        throw new Error('UNAUTHORIZED: silent refresh returned no token');
      }
      // 3. Normal path: use whatever useGcalAuth currently has.
      const cached = accessTokenRef.current;
      if (cached !== null) return cached;
      const refreshed = await requestSilentRefreshRef.current();
      if (refreshed !== null) return refreshed;
      throw new Error('UNAUTHORIZED: no Drive access token available');
    },
    [],
  );

  // ---- Manager lifecycle ----
  useEffect(() => {
    if (!supported) return;
    if (!enabled) {
      managerRef.current = null;
      return;
    }
    let cancelled = false;
    runGenerationRef.current += 1;
    const generation = runGenerationRef.current;
    (async () => {
      try {
        const manager = await createSyncManager({ getToken, appVersion });
        if (cancelled || runGenerationRef.current !== generation) return;
        managerRef.current = manager;
        setStatus(accessTokenRef.current === null ? { kind: 'no-token' } : { kind: 'idle' });
      } catch (e) {
        if (cancelled || runGenerationRef.current !== generation) return;
        setStatus({ kind: 'error', message: `manager init: ${(e as Error).message}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported, enabled, appVersion, getToken]);

  // ---- Status flip between no-token and idle as gcal state changes ----
  useEffect(() => {
    if (!supported || !enabled) return;
    setStatus((prev) => {
      if (prev.kind === 'no-token' && gcal.accessToken !== null) return { kind: 'idle' };
      if (prev.kind === 'idle' && gcal.accessToken === null) return { kind: 'no-token' };
      return prev;
    });
  }, [gcal.accessToken, enabled, supported]);

  const persistEnable = useCallback(async (value: boolean): Promise<void> => {
    const db = await Database.load(SQLITE_DB);
    await writeSetting(db, KEYS.enabled, value ? '1' : '0');
    setEnabled(value);
  }, []);

  /**
   * Map a `SyncResult` into the appropriate post-sync status. Successful
   * push or no-op variants leave the badge `idle`; recoverable failures
   * propagate so the UI surfaces them.
   */
  const statusFromResult = (r: SyncResult): DriveSyncStatus => {
    switch (r.kind) {
      case 'pushed':
        return { kind: 'idle' };
      case 'duplicate-detected':
        return { kind: 'error', message: r.message };
      case 'schema-refused':
        return { kind: 'error', message: r.reason };
      case 'corrupt-envelope':
        return {
          kind: 'error',
          message: `Drive snapshot is corrupt (dropped=${r.droppedRows}, sha=${r.sha256Matches})`,
        };
      case 'cas-exhausted':
        return {
          kind: 'error',
          message: `CAS retry exhausted after ${r.attempts} attempts`,
        };
      case 'error':
        return { kind: 'error', message: r.message };
    }
  };

  // ---- Actions ----

  const runSyncInternal = useCallback(
    async (mode: 'join' | 'drop'): Promise<SyncManagerOutcome | null> => {
      const mgr = managerRef.current;
      if (mgr === null) return null;
      const generation = runGenerationRef.current;

      // drop-mode pre-check: avoid optimistically flipping to 'syncing'
      // when we're about to be dropped by the mutex.
      if (mode === 'drop' && mgr.isBusy()) {
        return { kind: 'dropped' };
      }

      // Only show the spinner if THIS call will actually drive the sync.
      // For join mode that's always true; for drop mode we passed the
      // isBusy check above.
      setStatus({ kind: 'syncing' });
      let outcome: SyncManagerOutcome;
      try {
        outcome = await mgr.runSync(mode);
      } catch (e) {
        if (runGenerationRef.current === generation) {
          setStatus({ kind: 'error', message: `sync: ${(e as Error).message}` });
        }
        return null;
      }

      // Sync may have mutated SQLite even on error paths (applyMergeResult
      // is called before Push). Reload caller's view regardless.
      try {
        await onSyncCompletedRef.current?.();
      } catch {
        // App state reload is a UX concern, not a sync correctness one.
      }

      if (runGenerationRef.current !== generation) {
        // disable() / lifecycle reset happened while we were awaiting —
        // discard the result rather than clobbering the new status.
        return outcome;
      }

      if (outcome.kind === 'completed') {
        setLastResult(outcome.result);
        if (outcome.result.kind === 'pushed') setLastSyncedAt(Date.now());
        setStatus(statusFromResult(outcome.result));
      } else {
        // 'dropped' (rare: in-flight finished between our isBusy check
        // and runSync). Defer status back to whatever the in-flight set.
        setStatus({ kind: 'idle' });
      }
      return outcome;
    },
    [],
  );

  const runSync = useCallback((): Promise<SyncManagerOutcome | null> => runSyncInternal('join'), [
    runSyncInternal,
  ]);

  const runSmokeTest = useCallback(async (): Promise<DriveSmokeReport | null> => {
    if (!supported) return null;
    const generation = runGenerationRef.current;
    setStatus({ kind: 'smoke-testing' });
    try {
      const token = await getToken();
      const report = await driveSmokeTest(token);
      if (runGenerationRef.current !== generation) return report;
      if (report.staleGenerationRejected) {
        const db = await Database.load(SQLITE_DB);
        await writeSetting(db, KEYS.smokeTestPassedAt, String(Date.now()));
        setStatus(enabled ? { kind: 'idle' } : { kind: 'disabled' });
      } else {
        setStatus({ kind: 'smoke-failed', report });
      }
      return report;
    } catch (e) {
      if (runGenerationRef.current === generation) {
        setStatus({ kind: 'error', message: `smoke test: ${(e as Error).message}` });
      }
      return null;
    }
  }, [supported, enabled, getToken]);

  const enable = useCallback(async (): Promise<void> => {
    if (!supported) return;
    const env = import.meta.env as unknown as Record<string, string | undefined>;
    const clientId = env['VITE_GOOGLE_DESKTOP_CLIENT_ID'];
    const clientSecret = env['VITE_GOOGLE_DESKTOP_CLIENT_SECRET'];
    if (clientId === undefined || clientId.length === 0) {
      setStatus({ kind: 'error', message: 'VITE_GOOGLE_DESKTOP_CLIENT_ID is not configured' });
      return;
    }
    setStatus({ kind: 'enabling' });
    try {
      // 1. Drive scope re-consent. Google's incremental authorization
      // returns a token granting both Calendar (existing) and Drive
      // (newly added). The refresh token is rotated and saved to keyring
      // by gcal_oauth_connect.
      const tokens = await invoke<OAuthTokens>('gcal_oauth_connect', {
        clientId,
        clientSecret,
        scopes: [SCOPE_CALENDAR_READONLY, SCOPE_DRIVE_APPDATA],
      });
      if (!tokens.granted_scopes.includes(SCOPE_DRIVE_APPDATA)) {
        setStatus({
          kind: 'error',
          message:
            'Drive scope not granted by Google. Please grant `drive.appdata` on the consent screen.',
        });
        return;
      }

      // 2. Capture the fresh access token. We deliberately do NOT call
      // useGcalAuth.requestSilentRefresh here — that can return an in-
      // flight Promise started before the keyring was rotated, giving us
      // a Calendar-only token (H1 in Codex review). getToken() reads
      // freshTokenRef first while it's valid, then falls back to gcal.
      freshTokenRef.current = {
        accessToken: tokens.access_token,
        expiresAtMs: tokens.expires_at * 1000,
      };

      const db = await Database.load(SQLITE_DB);
      await writeSetting(db, KEYS.grantedScopes, JSON.stringify(tokens.granted_scopes));

      // 3. Run the live If-Match smoke test using the fresh token.
      setStatus({ kind: 'smoke-testing' });
      const report = await driveSmokeTest(tokens.access_token);
      if (!report.staleGenerationRejected) {
        setStatus({ kind: 'smoke-failed', report });
        return;
      }
      const passedAt = Date.now();
      await writeSetting(db, KEYS.smokeTestPassedAt, String(passedAt));

      // 4. Flip the persisted flag → triggers manager creation effect.
      await persistEnable(true);
    } catch (e) {
      setStatus({ kind: 'error', message: `enable Drive sync: ${(e as Error).message}` });
    }
  }, [supported, persistEnable]);

  const disable = useCallback(async (): Promise<void> => {
    if (!supported) return;
    // Generation bump invalidates any in-flight sync's post-completion
    // setStatus / setLastResult — see runGenerationRef checks above.
    runGenerationRef.current += 1;
    await persistEnable(false);
    managerRef.current = null;
    freshTokenRef.current = null;
    setStatus({ kind: 'disabled' });
  }, [supported, persistEnable]);

  // ---- Auto trigger: visibilitychange / focus ----
  useEffect(() => {
    if (!supported || !enabled) return;
    const handler = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (accessTokenRef.current === null) return;
      const since = lastSyncedAt === null ? Infinity : Date.now() - lastSyncedAt;
      if (since < AUTO_SYNC_STALE_MS) return;
      // drop mode: a manual sync still in flight takes precedence.
      void runSyncInternal('drop');
    };
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
    };
  }, [supported, enabled, lastSyncedAt, runSyncInternal]);

  // ---- Resolve loading status once enabled is known ----
  useEffect(() => {
    if (!supported) return;
    setStatus((prev) => {
      if (prev.kind !== 'loading') return prev;
      if (!enabled) return { kind: 'disabled' };
      return gcal.accessToken === null ? { kind: 'no-token' } : { kind: 'idle' };
    });
  }, [supported, enabled, gcal.accessToken]);

  return {
    status,
    enabled,
    lastSyncedAt,
    lastResult,
    enable,
    disable,
    runSync,
    runSmokeTest,
  };
};
