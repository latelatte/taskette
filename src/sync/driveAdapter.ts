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
  type DriveSnapshot,
} from './driveClient.js';
import type {
  DriveClientDeps,
  DriveSnapshotForSync,
  DrivePutResultForSync,
} from './syncOrchestrator.js';

export type AccessTokenSource = () => Promise<string>;

const toSnapshot = (s: DriveSnapshot | null): DriveSnapshotForSync | null =>
  s === null ? null : { content: s.content, etag: s.etag, fileId: s.fileId };

export const createDriveAdapter = (getToken: AccessTokenSource): DriveClientDeps => {
  let capturedToken: string | null = null;
  return {
    getCurrent: async (): Promise<DriveSnapshotForSync | null> => {
      // Refresh the capture at every Pull. Within one CAS retry loop
      // this re-uses the same access token across getCurrent/putCurrent
      // pairs; across retries each Pull picks up whatever the auth hook
      // currently holds (refreshed transparently on 401).
      capturedToken = await getToken();
      return toSnapshot(await driveGetCurrent(capturedToken));
    },
    putCurrent: async (
      content: string,
      fileId: string | null,
      ifMatchEtag: string | null,
    ): Promise<DrivePutResultForSync> => {
      // Fallback to a fresh fetch only if the caller skipped Pull (e.g.
      // a unit test driving putCurrent directly). Production paths always
      // call getCurrent first.
      const token = capturedToken ?? (await getToken());
      const result = await drivePutCurrent(token, content, fileId, ifMatchEtag);
      return { fileId: result.fileId, etag: result.etag };
    },
  };
};
