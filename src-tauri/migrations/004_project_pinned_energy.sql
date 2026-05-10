-- Slice 18-A: pinned + energy on projects
-- pinned: 1 = サイドバーに表示する稼働中案件
-- energy: low | mid | high — 自動配分エンジンのデフォルトエネルギー (focusWindow とのマッチング)

ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN energy TEXT NOT NULL DEFAULT 'mid';

-- Migration UX: pre-existing projects with a monthly budget are auto-pinned so
-- the sidebar isn't empty after upgrade. New projects (post-migration) keep
-- the column default of 0 (unpinned) per submitNewProject.
UPDATE projects SET pinned = 1 WHERE monthly_budget_pm IS NOT NULL AND deleted_at IS NULL;
