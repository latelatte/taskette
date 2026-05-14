/**
 * Slice 22-C1: snapshot-format migration framework.
 *
 * `ENVELOPE_SCHEMA_VERSION` may bump independently of SQLite migrations.
 * Each bump adds a `vN -> vN+1` pure transformer here. The Drive sync
 * pipeline (22-C2) consults `decideSchemaAction` to handle the four
 * (DB version, snapshot version) compatibility combinations:
 *
 *   - DB == snapshot                        → pass through
 *   - DB > snapshot (snapshot is older)     → run forward migrators to bring it up
 *   - DB < snapshot (snapshot is newer)     → refuse: an older client cannot
 *                                             safely import a newer snapshot
 *   - app < snapshot.appVersion             → warn (informational only)
 *
 * Refusal is the safe direction: pulling a newer snapshot into an older
 * client risks data loss (the client doesn't know which fields it would
 * silently drop). The newer device should sync first.
 */

import type { SnapshotEnvelope } from './types.js';
import { ENVELOPE_SCHEMA_VERSION } from './envelopeSerializer.js';

export type SchemaAction =
  | { readonly kind: 'pass' }
  | { readonly kind: 'migrate'; readonly from: number; readonly to: number }
  | { readonly kind: 'refuse'; readonly reason: string };

export const decideSchemaAction = (
  localSchemaVersion: number,
  snapshotSchemaVersion: number,
): SchemaAction => {
  if (localSchemaVersion === snapshotSchemaVersion) return { kind: 'pass' };
  if (localSchemaVersion > snapshotSchemaVersion) {
    return { kind: 'migrate', from: snapshotSchemaVersion, to: localSchemaVersion };
  }
  return {
    kind: 'refuse',
    reason: `snapshot schemaVersion ${snapshotSchemaVersion} > local ${localSchemaVersion}; upgrade this client first`,
  };
};

type Migrator = (envelope: SnapshotEnvelope) => SnapshotEnvelope;

/**
 * Ordered v_N -> v_{N+1} transformers. Empty in v0.5 because the format
 * launches at version 1. Future row-shape changes add entries here.
 *
 * Each migrator is pure and must produce a valid envelope (it may not
 * read external state or rely on the wall clock). They run in sequence,
 * so a v1 -> v3 migration applies the v1 -> v2 then v2 -> v3 entries.
 */
const FORWARD_MIGRATORS: ReadonlyArray<{ readonly from: number; readonly to: number; readonly fn: Migrator }> = [
  // {
  //   from: 1,
  //   to: 2,
  //   fn: (envelope) => /* add new column with default */,
  // },
];

export const migrateEnvelope = (
  envelope: SnapshotEnvelope,
  targetSchemaVersion: number,
): SnapshotEnvelope => {
  if (envelope.schemaVersion === targetSchemaVersion) return envelope;
  if (envelope.schemaVersion > targetSchemaVersion) {
    throw new Error(
      `migrateEnvelope: cannot downgrade (envelope ${envelope.schemaVersion} > target ${targetSchemaVersion})`,
    );
  }
  let current = envelope;
  while (current.schemaVersion < targetSchemaVersion) {
    const step = FORWARD_MIGRATORS.find((m) => m.from === current.schemaVersion);
    if (step === undefined) {
      throw new Error(
        `migrateEnvelope: no migrator for v${current.schemaVersion} -> v${current.schemaVersion + 1}`,
      );
    }
    current = step.fn(current);
    if (current.schemaVersion !== step.to) {
      throw new Error(
        `migrateEnvelope: migrator from v${step.from} produced v${current.schemaVersion}, expected v${step.to}`,
      );
    }
  }
  return current;
};

export const CURRENT_ENVELOPE_SCHEMA_VERSION = ENVELOPE_SCHEMA_VERSION;
