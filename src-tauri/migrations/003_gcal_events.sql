-- Slice 17: persisted GCal raw cache table
-- Storage of normalized GCal events for: (1) instant load on startup, (2) reconciliation across reschedules and deletions.
-- identity: (calendar_id, event_id). Day-splitting happens at projection time, not in DB.
-- reconciliation strategy: UPSERT events seen in a sync run (mark last_seen_at = run_started_at),
-- then tombstone any window-intersecting active rows whose last_seen_at < run_started_at.
-- Rows outside the fetch window are never touched, so historical events are preserved indefinitely
-- once captured (use re-visit of that month to refresh / detect deletions).

CREATE TABLE IF NOT EXISTS gcal_events (
  calendar_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  recurring_event_id TEXT,
  html_link TEXT,
  last_seen_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (calendar_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_gcal_events_active_range
  ON gcal_events(calendar_id, start_ms, end_ms)
  WHERE tombstone = 0;

CREATE INDEX IF NOT EXISTS idx_gcal_events_updated_at
  ON gcal_events(updated_at);
