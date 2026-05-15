/**
 * Slice 22-C2: adapter from {@link driveClient} to {@link DriveClientDeps}.
 *
 * The orchestrator's contract takes no token argument — it expects the
 * adapter to pull a fresh access token on each call. We delegate to a
 * caller-supplied getter so the adapter stays env-agnostic; the React
 * wiring layer feeds in `useGcalAuth.getToken` (which transparently
 * refreshes on 401 via the silent-refresh path).
 *
 * **Token continuity within one sync cycle**: `getCurrent` captures the
 * token and `putCurrent` reuses it. The Drive contract reads remote at
 * Pull time and writes back at Push time — if those two calls hit
 * different Google accounts (because `getToken` swapped them between
 * calls), the Push would land on the wrong Drive. v0.5 ships only
 * single-account; this defense-in-depth guards against a future
 * account-switch UI accidentally racing a sync.
 *
 * Token expiry mid-sync (rare: 1h window between Pull and Push) is
 * handled by the underlying driveClient surface — a 401 from Push
 * propagates as a generic error and the next sync re-fetches.
 *
 * **`getToken` contract**: must return access tokens for the *same*
 * Google account on every call within a single sync. Account switches
 * must invalidate any in-flight sync before reusing the adapter.
 */

import {
  driveGetCurrent,
  drivePutCurrent,
  isDriveErrorKind,
  type DriveSnapshot,
} from './driveClient.js';
import type {
  DriveClientDeps,
  DriveSnapshotForSync,
  DrivePutResultForSync,
} from './syncOrchestrator.js';

/**
 * `forceRefresh` asks the source to bypass any cached token and obtain a
 * fresh one from the underlying refresh-token flow. The adapter sets it
 * when a Drive call returns 401, which can happen if the cached token
 * expired silently between Pull and Push.
 */
export type AccessTokenSource = (opts?: { readonly forceRefresh?: boolean }) => Promise<string>;

const toSnapshot = (s: DriveSnapshot | null): DriveSnapshotForSync | null =>
  s === null ? null : { content: s.content, etag: s.etag, fileId: s.fileId };

const isUnauthorized = (e: unknown): boolean => isDriveErrorKind(e, 'UNAUTHORIZED');

export const createDriveAdapter = (getToken: AccessTokenSource): DriveClientDeps => {
  let capturedToken: string | null = null;
  return {
    getCurrent: async (): Promise<DriveSnapshotForSync | null> => {
      capturedToken = await getToken();
      try {
        return toSnapshot(await driveGetCurrent(capturedToken));
      } catch (e) {
        if (!isUnauthorized(e)) throw e;
        // Token expired silently between proactive refresh and our call.
        // Force a fresh one and retry once. A second 401 is fatal.
        capturedToken = await getToken({ forceRefresh: true });
        return toSnapshot(await driveGetCurrent(capturedToken));
      }
    },
    putCurrent: async (
      content: string,
      fileId: string | null,
      ifMatchEtag: string | null,
    ): Promise<DrivePutResultForSync> => {
      const token = capturedToken ?? (await getToken());
      try {
        const result = await drivePutCurrent(token, content, fileId, ifMatchEtag);
        return { fileId: result.fileId, etag: result.etag };
      } catch (e) {
        if (!isUnauthorized(e)) throw e;
        const fresh = await getToken({ forceRefresh: true });
        capturedToken = fresh;
        const result = await drivePutCurrent(fresh, content, fileId, ifMatchEtag);
        return { fileId: result.fileId, etag: result.etag };
      }
    },
  };
};
