-- Slice 21-B: end_date (YYYY-MM-DD) supersedes end_month (YYYY-MM).
-- Migrate existing end_month values to the last day of that month so the
-- "active through MM" semantic is preserved.

ALTER TABLE projects ADD COLUMN end_date TEXT;

UPDATE projects
SET end_date = date(end_month || '-01', 'start of month', '+1 month', '-1 day')
WHERE end_month IS NOT NULL;

-- end_month column kept for backward read compatibility during this slice;
-- code paths only read end_date now. Future cleanup can DROP COLUMN end_month
-- once we are confident no rolling-back to v0.1.x is required.
