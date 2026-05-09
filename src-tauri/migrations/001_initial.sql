-- Slice 14-B: initial SQLite schema for taskette
-- Sync-readiness: each entity table has updated_at + deleted_at (tombstone) + revision + device_id columns

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  label TEXT NOT NULL,
  project_id TEXT,
  template_id TEXT,
  source TEXT,
  gcal_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by_device_id TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_blocks_date_active ON blocks(date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_blocks_project_id ON blocks(project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_blocks_template_id ON blocks(template_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_blocks_gcal_key ON blocks(gcal_key) WHERE gcal_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blocks_updated_at ON blocks(updated_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  monthly_budget_pm REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by_device_id TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);

CREATE TABLE IF NOT EXISTS project_budget_overrides (
  project_id TEXT NOT NULL,
  ym TEXT NOT NULL,
  hours REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by_device_id TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, ym)
);
CREATE INDEX IF NOT EXISTS idx_project_budget_overrides_updated_at ON project_budget_overrides(updated_at);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT,
  project_id TEXT,
  default_duration_min INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by_device_id TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_templates_updated_at ON templates(updated_at);

CREATE TABLE IF NOT EXISTS gcal_assignments (
  gcal_key TEXT PRIMARY KEY,
  project_id TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by_device_id TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gcal_assignments_updated_at ON gcal_assignments(updated_at);

CREATE TABLE IF NOT EXISTS gcal_summary_rules (
  summary TEXT PRIMARY KEY,
  project_id TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_by_device_id TEXT NOT NULL,
  updated_by_device_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gcal_summary_rules_updated_at ON gcal_summary_rules(updated_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
