-- v0.3.1: add optional start_date (YYYY-MM-DD) to projects.
-- Combined with end_date, this gives projects an explicit lifetime range
-- so the monthly summary can suppress projection warnings outside that range.
-- Existing rows remain NULL = unspecified start.

ALTER TABLE projects ADD COLUMN start_date TEXT;
