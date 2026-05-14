/**
 * Slice 22-A: v0.5 multi-device sync — types only.
 *
 * The envelope is the unit of exchange on Drive (`appDataFolder/current.json`).
 * Row-level merge operates on entities that carry SyncMeta.
 */

export type DeviceId = string;

export type DeviceMeta = {
  readonly lastSeenGeneration: number;
  readonly lastSyncAt: number;
};

export type SnapshotEnvelope = {
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly generation: number;
  readonly createdAt: number;
  readonly devices: Readonly<Record<DeviceId, DeviceMeta>>;
  readonly contentSha256: string;
  readonly tables: Readonly<Record<string, readonly SyncRow[]>>;
};

/**
 * Fields every syncable row must carry. Each SQLite entity table mirrors
 * this shape (columns `revision / updated_at / updated_by_device_id /
 * deleted_at / created_at / created_by_device_id`).
 */
export type SyncMeta = {
  readonly revision: number;
  readonly updatedAt: number;
  readonly updatedByDeviceId: DeviceId;
  readonly deletedAt: number | null;
  readonly createdAt: number;
  readonly createdByDeviceId: DeviceId;
};

export type SyncRow = SyncMeta & {
  readonly [field: string]: unknown;
};
