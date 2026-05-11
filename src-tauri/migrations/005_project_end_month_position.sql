-- Slice 21: end_month + position on projects
-- end_month: YYYY-MM string. NULL = ongoing. ym > end_month → project filtered out
--   from monthly summary, sidebar, and allocation proposals.
-- position: explicit display order. ORDER BY position ASC. Existing rows are
--   seeded by rowid so they keep their pre-migration order.

ALTER TABLE projects ADD COLUMN end_month TEXT;
ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

UPDATE projects SET position = rowid;
