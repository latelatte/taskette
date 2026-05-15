/**
 * Slice 22-B: TypeScript wrapper for the Rust-side Drive v3 client.
 *
 * Every call requires a fresh OAuth access token with the `drive.appdata`
 * scope. The frontend obtains the token via the existing useGcalAuth flow
 * (re-consent is triggered separately when the user enables Drive sync —
 * that wiring lives in 22-C).
 *
 * Tauri `invoke` rejects with either an `Error` or a raw string depending
 * on platform/version. Known error categories are encoded as message
 * prefixes by the Rust side; use {@link isDriveErrorKind} to branch
 * safely regardless of reject value shape.
 */

import { invoke } from '@tauri-apps/api/core';

export const SCOPE_DRIVE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata';
export const SCOPE_CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.readonly';

export type DriveErrorKind =
  | 'PRECONDITION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'DUPLICATE_NAME'
  | 'HTTP_ERROR';

export type DriveSnapshot = {
  readonly content: string;
  readonly etag: string;
  readonly fileId: string;
};

export type DrivePutResult = {
  readonly fileId: string;
  readonly etag: string;
};

export type DriveHistoryEntry = {
  readonly fileId: string;
  readonly name: string;
  /** Always null for entries from {@link driveListHistory} — history files
   * are read-only backups, so CAS tokens aren't fetched in the listing. */
  readonly etag: string | null;
  readonly modifiedTime: string | null;
  readonly size: number | null;
};

export type DriveSmokeReport = {
  readonly created: boolean;
  readonly updatedWithCorrectGeneration: boolean;
  /** Stale-generation update was rejected with PRECONDITION_FAILED. The
   * field name historically said "etag/412" but the CAS contract is now
   * application-level (appProperties.taskette_gen counter). */
  readonly staleGenerationRejected: boolean;
  readonly cleanedUp: boolean;
  readonly messages: readonly string[];
};

export const isDriveErrorKind = (err: unknown, kind: DriveErrorKind): boolean => {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.startsWith(`${kind}:`);
};

/** Read current.json from appDataFolder. Returns null if it doesn't exist. */
export const driveGetCurrent = async (accessToken: string): Promise<DriveSnapshot | null> =>
  invoke<DriveSnapshot | null>('drive_get_current', { accessToken });

/**
 * Create or update current.json with optional CAS via If-Match.
 *
 * - On first publish, pass `fileId = null` and `ifMatchEtag = null` (create).
 * - To safely overwrite, pass the `fileId` + `etag` returned by the most
 *   recent {@link driveGetCurrent}. The call throws an error whose message
 *   starts with `PRECONDITION_FAILED:` if another device updated the file
 *   in between — the caller (22-C) then re-Pulls and retries.
 */
export const drivePutCurrent = async (
  accessToken: string,
  content: string,
  fileId: string | null,
  ifMatchEtag: string | null,
): Promise<DrivePutResult> =>
  invoke<DrivePutResult>('drive_put_current', {
    accessToken,
    content,
    fileId,
    ifMatchEtag,
  });

/**
 * Write a rolling-backup snapshot. History files use a separate name
 * (`history-{generation}.json`) and are never overwritten — write once,
 * then delete with {@link driveDeleteFile} when pruning past N=5.
 */
export const driveCreateHistory = async (
  accessToken: string,
  generation: number,
  content: string,
): Promise<DrivePutResult> =>
  invoke<DrivePutResult>('drive_create_history', { accessToken, generation, content });

/** List existing history-*.json entries, newest first. */
export const driveListHistory = async (
  accessToken: string,
): Promise<readonly DriveHistoryEntry[]> =>
  invoke<readonly DriveHistoryEntry[]>('drive_list_history', { accessToken });

export const driveDeleteFile = async (accessToken: string, fileId: string): Promise<void> =>
  invoke<void>('drive_delete_file', { accessToken, fileId });

/**
 * Verify the live Drive deployment still honors our soft-CAS contract
 * (generation counter via appProperties.taskette_gen). Creates a
 * throwaway file, exercises both fresh and stale generation updates,
 * then cleans up. Intended to be run before enabling Drive sync — not
 * on every sync.
 */
export const driveSmokeTest = async (accessToken: string): Promise<DriveSmokeReport> =>
  invoke<DriveSmokeReport>('drive_smoke_test', { accessToken });
