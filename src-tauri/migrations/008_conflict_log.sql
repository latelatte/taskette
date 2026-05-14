-- Slice 22-A: local audit log of merge losers.
-- Not part of the sync envelope; per-device only.

CREATE TABLE IF NOT EXISTS conflict_log (
  conflict_event_id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  local_revision INTEGER NOT NULL,
  remote_revision INTEGER NOT NULL,
  winner_device_id TEXT NOT NULL,
  loser_device_id TEXT NOT NULL,
  loser_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conflict_log_created_at ON conflict_log(created_at);
CREATE INDEX IF NOT EXISTS idx_conflict_log_table_row ON conflict_log(table_name, row_key);
