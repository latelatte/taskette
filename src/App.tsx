import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { DateString, Project, TaskTemplate, TimeBlock } from './domain/types.js';
import { Day } from './domain/day.js';
import { PROJECT_COLOR_PALETTE } from './projects.js';
import { addDays, addMonths, daysOfWeek, elapsedRatio, formatJaDate, formatJaYearMonth, today, yearMonthOf, yearOf } from './dates.js';
import type { ViewMode } from './views/types.js';
import { DayView } from './views/DayView.js';
import { WeekView } from './views/WeekView.js';
import { MonthView } from './views/MonthView.js';
import { YearView } from './views/YearView.js';
import { loadStore, saveStore } from './storage.js';
import { aggregateMonthly } from './domain/aggregate.js';
import { effectiveBudgetPM, projectBudgetUsage } from './domain/budget.js';

const fmtH = (h: number): string => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
};

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const formatHHMM = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

const parseHHMM = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (m === null) return null;
  const h = parseInt(m[1] ?? '0', 10);
  const mm = parseInt(m[2] ?? '0', 10);
  if (h < 0 || h > 24 || mm < 0 || mm >= 60) return null;
  return h * 60 + mm;
};

type BlockEditState = {
  readonly blockId: string;
  readonly label: string;
  readonly startHHMM: string;
  readonly durationMin: string;
  readonly projectId: string;
};

type SettingsView = 'menu' | 'projects' | 'templates';

const blockWithoutProject = (b: TimeBlock): TimeBlock => ({
  id: b.id,
  label: b.label,
  start: b.start,
  durationMin: b.durationMin,
  ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
});

const blockWithoutTemplate = (b: TimeBlock): TimeBlock => ({
  id: b.id,
  label: b.label,
  start: b.start,
  durationMin: b.durationMin,
  ...(b.projectId !== undefined ? { projectId: b.projectId } : {}),
});

const templateWithoutProject = (t: TaskTemplate): TaskTemplate => ({
  id: t.id,
  label: t.label,
  defaultDurationMin: t.defaultDurationMin,
  ...(t.color !== undefined ? { color: t.color } : {}),
});

const shiftViewDate = (s: DateString, mode: ViewMode, delta: number): DateString => {
  if (mode === 'day') return addDays(s, delta);
  if (mode === 'week') return addDays(s, delta * 7);
  if (mode === 'month') return `${addMonths(s, delta).slice(0, 7)}-01`;
  return `${addMonths(s, delta * 12).slice(0, 7)}-01`;
};

export function App() {
  const [currentDate, setCurrentDate] = useState<DateString>(today);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [blocksByDate, setBlocksByDate] = useState<Record<DateString, readonly TimeBlock[]>>(
    () => loadStore().blocksByDate,
  );
  const [projects, setProjects] = useState<readonly Project[]>(() => loadStore().projects);
  const [templates, setTemplates] = useState<readonly TaskTemplate[]>(() => loadStore().templates);
  const [error, setError] = useState<string | null>(null);
  const [blockEdit, setBlockEdit] = useState<BlockEditState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('menu');
  const [showSummary, setShowSummary] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectBudget, setNewProjectBudget] = useState('');
  const [newProjectColor, setNewProjectColor] = useState<string>(
    PROJECT_COLOR_PALETTE[0] ?? '#64748b',
  );
  const [colorPickerProjectId, setColorPickerProjectId] = useState<string | null>(null);
  const [newTemplateLabel, setNewTemplateLabel] = useState('');
  const [newTemplateDuration, setNewTemplateDuration] = useState('30');
  const [newTemplateProjectId, setNewTemplateProjectId] = useState<string>('');
  const [newTemplateColor, setNewTemplateColor] = useState<string>(
    PROJECT_COLOR_PALETTE[0] ?? '#64748b',
  );
  const [colorPickerTemplateId, setColorPickerTemplateId] = useState<string | null>(null);
  const [editingMonthBudgetProjectId, setEditingMonthBudgetProjectId] = useState<string | null>(null);
  const [editingMonthBudgetValue, setEditingMonthBudgetValue] = useState('');

  useEffect(() => {
    saveStore({ blocksByDate, projects, templates });
  }, [blocksByDate, projects, templates]);

  const blocks: readonly TimeBlock[] = blocksByDate[currentDate] ?? [];

  const setBlocks = (
    action: readonly TimeBlock[] | ((prev: readonly TimeBlock[]) => readonly TimeBlock[]),
  ): void => {
    setBlocksByDate((prev) => {
      const cur = prev[currentDate] ?? [];
      const updated = typeof action === 'function' ? action(cur) : action;
      return { ...prev, [currentDate]: updated };
    });
  };

  const templateById = useMemo(() => {
    const m = new Map<string, TaskTemplate>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const handleTemplateDragStart = (e: DragEvent<HTMLDivElement>, templateId: string): void => {
    e.dataTransfer.setData('kind', 'template');
    e.dataTransfer.setData('templateId', templateId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const openBlockEdit = (block: TimeBlock): void => {
    setBlockEdit({
      blockId: block.id,
      label: block.label,
      startHHMM: formatHHMM(block.start),
      durationMin: String(block.durationMin),
      projectId: block.projectId ?? '',
    });
  };

  const closeBlockEdit = (): void => {
    setBlockEdit(null);
    setError(null);
  };

  const saveBlockEdit = (): void => {
    if (blockEdit === null) return;
    const trimmedLabel = blockEdit.label.trim();
    if (trimmedLabel.length === 0) {
      setError('ラベルを入力してくださいまし');
      return;
    }
    const start = parseHHMM(blockEdit.startHHMM);
    if (start === null) {
      setError('開始時刻の形式が不正ですわ (HH:MM)');
      return;
    }
    const dur = parseInt(blockEdit.durationMin, 10);
    if (!Number.isFinite(dur) || dur <= 0) {
      setError('時間 (分) を正の整数で入力してくださいまし');
      return;
    }
    if (start + dur > 1440) {
      setError('一日の範囲を超えていますわ');
      return;
    }

    const dayBlocks = blocksByDate[currentDate] ?? [];
    const original = dayBlocks.find((b) => b.id === blockEdit.blockId);
    if (original === undefined) {
      closeBlockEdit();
      return;
    }
    const newBlock: TimeBlock = {
      id: original.id,
      label: trimmedLabel,
      start,
      durationMin: dur,
      ...(original.templateId !== undefined ? { templateId: original.templateId } : {}),
      ...(blockEdit.projectId !== '' ? { projectId: blockEdit.projectId } : {}),
    };

    const others = dayBlocks.filter((b) => b.id !== blockEdit.blockId);
    const day = new Day(currentDate, others);
    const result = day.place(newBlock);
    if (!result.ok) {
      if (result.reason === 'overlap') {
        setError('重なっていますわ — 他のブロックと衝突しています');
      } else {
        setError(result.message);
      }
      return;
    }

    setBlocks(day.blocks);
    setError(null);
    setBlockEdit(null);
  };

  const deleteBlockFromEdit = (): void => {
    if (blockEdit === null) return;
    setBlocks((prev) => prev.filter((b) => b.id !== blockEdit.blockId));
    setError(null);
    setBlockEdit(null);
  };

  const submitNewProject = (): void => {
    const trimmed = newProjectName.trim();
    if (trimmed.length === 0) return;
    const budgetStr = newProjectBudget.trim();
    const parsed = budgetStr.length > 0 ? parseFloat(budgetStr) : NaN;
    const hasBudget = Number.isFinite(parsed) && parsed >= 0;
    setProjects((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: trimmed,
        color: newProjectColor,
        ...(hasBudget ? { monthlyBudget: parsed } : {}),
      },
    ]);
    setNewProjectName('');
    setNewProjectBudget('');
  };

  const beginEditMonthBudget = (projectId: string, currentValue: number | undefined): void => {
    setEditingMonthBudgetProjectId(projectId);
    setEditingMonthBudgetValue(currentValue !== undefined ? String(currentValue) : '');
  };

  const cancelEditMonthBudget = (): void => {
    setEditingMonthBudgetProjectId(null);
    setEditingMonthBudgetValue('');
  };

  const saveMonthBudgetOverride = (projectId: string, ym: string): void => {
    const trimmed = editingMonthBudgetValue.trim();
    if (trimmed === '') return;
    const num = parseFloat(trimmed);
    if (!Number.isFinite(num) || num < 0) return;
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const existing = p.monthlyBudgetOverrides ?? {};
        return { ...p, monthlyBudgetOverrides: { ...existing, [ym]: num } };
      }),
    );
    cancelEditMonthBudget();
  };

  const clearMonthBudgetOverride = (projectId: string, ym: string): void => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        if (p.monthlyBudgetOverrides === undefined) return p;
        const next = { ...p.monthlyBudgetOverrides };
        delete next[ym];
        if (Object.keys(next).length === 0) {
          return {
            id: p.id,
            name: p.name,
            color: p.color,
            ...(p.monthlyBudget !== undefined ? { monthlyBudget: p.monthlyBudget } : {}),
          };
        }
        return { ...p, monthlyBudgetOverrides: next };
      }),
    );
    cancelEditMonthBudget();
  };

  const updateProjectBudget = (id: string, value: string): void => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const trimmed = value.trim();
        if (trimmed === '') {
          return { id: p.id, name: p.name, color: p.color };
        }
        const num = parseFloat(trimmed);
        if (!Number.isFinite(num) || num < 0) return p;
        return { ...p, monthlyBudget: num };
      }),
    );
  };

  const renameProject = (id: string, name: string): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  };

  const recolorProject = (id: string, color: string): void => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
  };

  const closeSettings = (): void => {
    setShowSettings(false);
    setColorPickerProjectId(null);
    setColorPickerTemplateId(null);
    setSettingsView('menu');
  };

  const openSettings = (): void => {
    setSettingsView('menu');
    setShowSettings(true);
  };

  const handleDeleteProject = (id: string): void => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setBlocksByDate((prev) => {
      const next: Record<DateString, readonly TimeBlock[]> = {};
      for (const [date, dayBlocks] of Object.entries(prev)) {
        next[date] = dayBlocks.map((b) => (b.projectId === id ? blockWithoutProject(b) : b));
      }
      return next;
    });
    setTemplates((prev) =>
      prev.map((t) => (t.projectId === id ? templateWithoutProject(t) : t)),
    );
  };

  const submitNewTemplate = (): void => {
    const trimmed = newTemplateLabel.trim();
    if (trimmed.length === 0) return;
    const dur = parseInt(newTemplateDuration, 10);
    if (!Number.isFinite(dur) || dur <= 0 || dur > 1440) return;
    setTemplates((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: trimmed,
        defaultDurationMin: dur,
        color: newTemplateColor,
        ...(newTemplateProjectId !== '' ? { projectId: newTemplateProjectId } : {}),
      },
    ]);
    setNewTemplateLabel('');
    setNewTemplateDuration('30');
    setNewTemplateProjectId('');
  };

  const renameTemplate = (id: string, label: string): void => {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, label: trimmed } : t)));
  };

  const updateTemplateDuration = (id: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed === '') return;
    const num = parseInt(trimmed, 10);
    if (!Number.isFinite(num) || num <= 0 || num > 1440) return;
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, defaultDurationMin: num } : t)));
  };

  const updateTemplateProject = (id: string, projectId: string): void => {
    setTemplates((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (projectId === '') return templateWithoutProject(t);
        return { ...t, projectId };
      }),
    );
  };

  const recolorTemplate = (id: string, color: string): void => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
  };

  const handleDeleteTemplate = (id: string): void => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setBlocksByDate((prev) => {
      const next: Record<DateString, readonly TimeBlock[]> = {};
      for (const [date, dayBlocks] of Object.entries(prev)) {
        next[date] = dayBlocks.map((b) => (b.templateId === id ? blockWithoutTemplate(b) : b));
      }
      return next;
    });
  };

  const navigateToDate = (date: DateString, mode: ViewMode = viewMode): void => {
    if (blockEdit !== null) closeBlockEdit();
    setError(null);
    setCurrentDate(date);
    setViewMode(mode);
  };

  const isToday = currentDate === today();

  const headerDateLabel = ((): string => {
    if (viewMode === 'day') return formatJaDate(currentDate);
    if (viewMode === 'week') {
      const days = daysOfWeek(currentDate);
      const start = days[0] as DateString;
      const end = days[6] as DateString;
      return `${formatJaDate(start)} – ${formatJaDate(end).split(' ')[0]}`;
    }
    if (viewMode === 'month') return formatJaYearMonth(yearMonthOf(currentDate));
    return `${yearOf(currentDate)}年`;
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: sidebarCollapsed ? '1fr' : '240px 1fr', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1f2937' }}>
      {!sidebarCollapsed && (
      <aside style={{ background: '#f3f4f6', padding: '16px', borderRight: '1px solid #e5e7eb', overflow: 'auto' }}>
        <h2 style={{ fontSize: '13px', margin: '0 0 8px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          テンプレート
        </h2>
        {templates.length === 0 && (
          <div style={{ fontSize: '11px', color: '#9ca3af', padding: '4px 6px' }}>テンプレート未登録</div>
        )}
        {templates.map((t) => {
          const proj = t.projectId !== undefined ? projectById.get(t.projectId) : undefined;
          const accent = proj?.color ?? t.color ?? '#94a3b8';
          const dragEnabled = viewMode === 'day';
          return (
            <div
              key={t.id}
              draggable={dragEnabled}
              onDragStart={(e) => handleTemplateDragStart(e, t.id)}
              title={dragEnabled ? undefined : '日ビューで配置できます'}
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderLeft: `6px solid ${accent}`,
                padding: '8px 10px',
                marginBottom: '6px',
                borderRadius: '6px',
                cursor: dragEnabled ? 'grab' : 'default',
                fontSize: '13px',
                userSelect: 'none',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                opacity: dragEnabled ? 1 : 0.5,
              }}
            >
              <div>{t.label}</div>
              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                {t.defaultDurationMin}分{proj !== undefined && ` · ${proj.name}`}
              </div>
            </div>
          );
        })}
        <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '20px', lineHeight: 1.5 }}>
          ・テンプレを D&amp;D で配置<br />
          ・空き時間ダブルクリックで自由記入<br />
          ・設置済みブロックもドラッグで移動<br />
          ・ブロックをダブルクリックで編集
        </p>
      </aside>
      )}

      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '16px', background: 'white' }}>
          <button
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'サイドバーを表示' : 'サイドバーを隠す'}
            aria-label="サイドバー切替"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#374151', padding: '2px 6px', lineHeight: 1 }}
          >☰</button>
          <h1 style={{ fontSize: '15px', margin: 0, fontWeight: 600 }}>taskette</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={() => navigateToDate(shiftViewDate(currentDate, viewMode, -1))}
              title="前へ"
              style={{ background: 'white', border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#1f2937' }}
            >◀</button>
            <span style={{ fontSize: '13px', minWidth: '220px', textAlign: 'center', color: '#1f2937', fontWeight: isToday && viewMode === 'day' ? 600 : 400 }}>
              {headerDateLabel}{isToday && viewMode === 'day' && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#2563eb' }}>(今日)</span>}
            </span>
            <button
              onClick={() => navigateToDate(shiftViewDate(currentDate, viewMode, 1))}
              title="次へ"
              style={{ background: 'white', border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#1f2937' }}
            >▶</button>
            <button
              onClick={() => navigateToDate(today())}
              disabled={isToday && viewMode === 'day'}
              title="今日へジャンプ"
              style={{
                background: isToday && viewMode === 'day' ? '#f3f4f6' : 'white',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '12px',
                cursor: isToday && viewMode === 'day' ? 'not-allowed' : 'pointer',
                color: '#1f2937',
                marginLeft: '6px',
                opacity: isToday && viewMode === 'day' ? 0.5 : 1,
              }}
            >今日</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginLeft: '8px' }}>
            {(['day', 'week', 'month', 'year'] as const).map((m, i) => {
              const active = viewMode === m;
              const label = m === 'day' ? '日' : m === 'week' ? '週' : m === 'month' ? '月' : '年';
              return (
                <button
                  key={m}
                  onClick={() => navigateToDate(currentDate, m)}
                  style={{
                    background: active ? '#1f2937' : 'white',
                    color: active ? 'white' : '#374151',
                    border: '1px solid #d1d5db',
                    borderLeftWidth: i === 0 ? 1 : 0,
                    padding: '4px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    borderRadius: i === 0 ? '4px 0 0 4px' : i === 3 ? '0 4px 4px 0' : '0',
                    fontWeight: active ? 600 : 400,
                  }}
                >{label}</button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          {error !== null && <span style={{ color: '#dc2626', fontSize: '12px' }}>{error}</span>}
          <button
            onClick={() => setShowSummary(true)}
            title={`${formatJaYearMonth(yearMonthOf(currentDate))}のサマリー`}
            style={{ background: 'white', border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px 10px', fontSize: '13px', cursor: 'pointer', color: '#1f2937' }}
          >📊</button>
          <button
            onClick={openSettings}
            title="設定"
            style={{ background: 'white', border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px 10px', fontSize: '13px', cursor: 'pointer', color: '#1f2937' }}
          >⚙</button>
        </header>

        {viewMode === 'day' && (
          <DayView
            currentDate={currentDate}
            blocks={blocks}
            setBlocks={setBlocks}
            blocksByDate={blocksByDate}
            projects={projects}
            projectById={projectById}
            templateById={templateById}
            setError={setError}
            openBlockEdit={openBlockEdit}
          />
        )}
        {viewMode === 'week' && (
          <WeekView
            currentDate={currentDate}
            blocksByDate={blocksByDate}
            projectById={projectById}
            onDayClick={(d) => navigateToDate(d, 'day')}
          />
        )}
        {viewMode === 'month' && (
          <MonthView
            currentDate={currentDate}
            blocksByDate={blocksByDate}
            projects={projects}
            projectById={projectById}
            onDayClick={(d) => navigateToDate(d, 'day')}
          />
        )}
        {viewMode === 'year' && (
          <YearView
            currentDate={currentDate}
            blocksByDate={blocksByDate}
            projects={projects}
            projectById={projectById}
            onMonthClick={(ym) => navigateToDate(`${ym}-01`, 'month')}
          />
        )}
      </main>

      {showSettings && (
        <div
          onClick={closeSettings}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              minWidth: '520px',
              maxWidth: '90vw',
              maxHeight: '85vh',
              overflow: 'auto',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                {settingsView !== 'menu' && (
                  <button
                    onClick={() => setSettingsView('menu')}
                    aria-label="戻る"
                    title="設定メニューへ戻る"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#6b7280', padding: '0 4px', lineHeight: 1 }}
                  >←</button>
                )}
                <h2 style={{ margin: 0, fontSize: '15px' }}>
                  {settingsView === 'menu' ? '設定' : settingsView === 'projects' ? '案件設定' : 'テンプレート設定'}
                </h2>
              </div>
              <button
                onClick={closeSettings}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280', padding: '0 4px', lineHeight: 1 }}
                aria-label="閉じる"
              >×</button>
            </div>

            {settingsView === 'menu' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { key: 'projects' as const, label: '案件設定', desc: '案件の追加・編集・削除、月予算' },
                  { key: 'templates' as const, label: 'テンプレート設定', desc: 'ドラッグ用テンプレの管理' },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setSettingsView(item.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '12px 14px',
                      background: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: '#1f2937',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{item.desc}</div>
                    </div>
                    <span style={{ color: '#9ca3af', fontSize: '14px' }}>›</span>
                  </button>
                ))}
              </div>
            )}

            {settingsView === 'projects' && (<>
            <div style={{ marginBottom: '16px' }}>
              {projects.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#9ca3af', padding: '8px 0' }}>案件が登録されておりません</div>
              ) : (
                projects.map((p) => {
                  const pickerOpen = colorPickerProjectId === p.id;
                  return (
                    <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                          onClick={() => setColorPickerProjectId(pickerOpen ? null : p.id)}
                          title="色を変更"
                          aria-label="色を変更"
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            background: p.color,
                            border: pickerOpen ? '2px solid #1f2937' : '1px solid rgba(0,0,0,0.1)',
                            flexShrink: 0,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        />
                        <input
                          value={p.name}
                          onChange={(e) => renameProject(p.id, e.currentTarget.value)}
                          placeholder="案件名"
                          style={{ flex: 1, fontSize: '13px', padding: '3px 6px', border: '1px solid #e5e7eb', borderRadius: '4px', outline: 'none', background: 'white' }}
                        />
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          value={p.monthlyBudget ?? ''}
                          onChange={(e) => updateProjectBudget(p.id, e.currentTarget.value)}
                          placeholder="人月"
                          title="月予算 (人月)"
                          style={{ width: 70, padding: '3px 6px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none' }}
                        />
                        <button
                          onClick={() => handleDeleteProject(p.id)}
                          style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}
                        >削除</button>
                      </div>
                      {pickerOpen && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', paddingLeft: '28px', flexWrap: 'wrap' }}>
                          {PROJECT_COLOR_PALETTE.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                recolorProject(p.id, c);
                                setColorPickerProjectId(null);
                              }}
                              title={c}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 4,
                                background: c,
                                border: p.color === c ? '2px solid #1f2937' : '2px solid transparent',
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '14px' }}>
              <div style={{ fontSize: '12px', color: '#374151', marginBottom: '8px', fontWeight: 600 }}>新しい案件を追加</div>
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewProject();
                }}
                placeholder="案件名"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: '13px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <input
                type="number"
                step="0.05"
                min="0"
                value={newProjectBudget}
                onChange={(e) => setNewProjectBudget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewProject();
                }}
                placeholder="月予算 (人月、任意)"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: '13px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                  marginTop: '8px',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                {PROJECT_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewProjectColor(c)}
                    title={c}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      background: c,
                      border: newProjectColor === c ? '2px solid #1f2937' : '2px solid transparent',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              <button
                onClick={submitNewProject}
                disabled={newProjectName.trim().length === 0}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  fontSize: '13px',
                  cursor: newProjectName.trim().length > 0 ? 'pointer' : 'not-allowed',
                  opacity: newProjectName.trim().length > 0 ? 1 : 0.5,
                }}
              >追加</button>
            </div>
            </>)}

            {settingsView === 'templates' && (<>
            <div style={{ marginBottom: '16px' }}>
              {templates.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#9ca3af', padding: '8px 0' }}>テンプレートが登録されておりません</div>
              ) : (
                templates.map((t) => {
                  const pickerOpen = colorPickerTemplateId === t.id;
                  const swatchColor = t.color ?? (t.projectId !== undefined ? projectById.get(t.projectId)?.color : undefined) ?? '#94a3b8';
                  return (
                    <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          onClick={() => setColorPickerTemplateId(pickerOpen ? null : t.id)}
                          title="色を変更"
                          aria-label="色を変更"
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            background: swatchColor,
                            border: pickerOpen ? '2px solid #1f2937' : '1px solid rgba(0,0,0,0.1)',
                            flexShrink: 0,
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        />
                        <input
                          value={t.label}
                          onChange={(e) => renameTemplate(t.id, e.currentTarget.value)}
                          placeholder="ラベル"
                          style={{ flex: 1, fontSize: '13px', padding: '3px 6px', border: '1px solid #e5e7eb', borderRadius: '4px', outline: 'none', background: 'white' }}
                        />
                        <input
                          type="number"
                          min="1"
                          max="1440"
                          step="5"
                          value={t.defaultDurationMin}
                          onChange={(e) => updateTemplateDuration(t.id, e.currentTarget.value)}
                          title="既定時間 (分)"
                          style={{ width: 64, padding: '3px 6px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none' }}
                        />
                        <select
                          value={t.projectId ?? ''}
                          onChange={(e) => updateTemplateProject(t.id, e.currentTarget.value)}
                          title="案件"
                          style={{ maxWidth: 120, padding: '3px 6px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none', background: 'white', color: '#1f2937' }}
                        >
                          <option value="">— 未割当 —</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleDeleteTemplate(t.id)}
                          style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}
                        >削除</button>
                      </div>
                      {pickerOpen && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', paddingLeft: '28px', flexWrap: 'wrap' }}>
                          {PROJECT_COLOR_PALETTE.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                recolorTemplate(t.id, c);
                                setColorPickerTemplateId(null);
                              }}
                              title={c}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 4,
                                background: c,
                                border: t.color === c ? '2px solid #1f2937' : '2px solid transparent',
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '14px' }}>
              <div style={{ fontSize: '12px', color: '#374151', marginBottom: '8px', fontWeight: 600 }}>新しいテンプレートを追加</div>
              <input
                value={newTemplateLabel}
                onChange={(e) => setNewTemplateLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewTemplate();
                }}
                placeholder="ラベル (例: ☕ コーヒー)"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: '13px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  step="5"
                  value={newTemplateDuration}
                  onChange={(e) => setNewTemplateDuration(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitNewTemplate();
                  }}
                  placeholder="分"
                  title="既定時間 (分)"
                  style={{
                    width: 80,
                    padding: '6px 8px',
                    fontSize: '13px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    outline: 'none',
                  }}
                />
                <select
                  value={newTemplateProjectId}
                  onChange={(e) => setNewTemplateProjectId(e.target.value)}
                  style={{ flex: 1, padding: '6px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none', background: 'white', color: '#1f2937' }}
                >
                  <option value="">— 案件未割当 —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                {PROJECT_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewTemplateColor(c)}
                    title={c}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      background: c,
                      border: newTemplateColor === c ? '2px solid #1f2937' : '2px solid transparent',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              <button
                onClick={submitNewTemplate}
                disabled={newTemplateLabel.trim().length === 0}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  fontSize: '13px',
                  cursor: newTemplateLabel.trim().length > 0 ? 'pointer' : 'not-allowed',
                  opacity: newTemplateLabel.trim().length > 0 ? 1 : 0.5,
                }}
              >追加</button>
            </div>
            </>)}
          </div>
        </div>
      )}

      {showSummary && (
        <div
          onClick={() => setShowSummary(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              minWidth: '420px',
              maxWidth: '90vw',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            {(() => {
              const ym = yearMonthOf(currentDate);
              const aggregate = aggregateMonthly(blocksByDate, ym);
              const elapsed = elapsedRatio(ym);
              const totalAssignedMin = Array.from(aggregate.byProject.values()).reduce((a, b) => a + b, 0);
              const grandTotalMin = totalAssignedMin + aggregate.unassigned;
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ margin: 0, fontSize: '15px' }}>{formatJaYearMonth(ym)}のサマリー</h2>
                    <button
                      onClick={() => setShowSummary(false)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280', padding: '0 4px', lineHeight: 1 }}
                      aria-label="閉じる"
                    >×</button>
                  </div>

                  {projects.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#9ca3af', padding: '8px 0' }}>案件が登録されておりません</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {projects.map((p) => {
                        const minutes = aggregate.byProject.get(p.id) ?? 0;
                        const u = projectBudgetUsage(p, minutes, elapsed, ym);
                        const effectivePM = effectiveBudgetPM(p, ym);
                        const hasOverride = p.monthlyBudgetOverrides?.[ym] !== undefined;
                        const isEditingThis = editingMonthBudgetProjectId === p.id;
                        const barColor = u.status === 'over'
                          ? '#dc2626'
                          : u.status === 'projectedOver'
                            ? '#f97316'
                            : (u.status === 'projectedUnder' || u.status === 'underConfirmed')
                              ? '#f59e0b'
                              : p.color;
                        return (
                          <div key={p.id}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                              <span style={{ fontSize: '13px', flex: 1 }}>{p.name}</span>
                              <span style={{ fontSize: '12px', color: '#374151' }}>
                                {u.actualPM.toFixed(2)}人月 ({u.actualH.toFixed(1)}h)
                                {effectivePM !== undefined && (
                                  <span style={{ color: '#6b7280' }}>
                                    {' / '}{effectivePM}人月 ({Math.round(u.ratio * 100)}%)
                                    {hasOverride && (
                                      <span style={{ marginLeft: '4px', color: '#2563eb', fontSize: '10px', fontWeight: 600 }}>(今月のみ)</span>
                                    )}
                                  </span>
                                )}
                              </span>
                              <button
                                onClick={() => isEditingThis ? cancelEditMonthBudget() : beginEditMonthBudget(p.id, effectivePM)}
                                title="今月の予算を変更"
                                aria-label="今月の予算を変更"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: isEditingThis ? '#2563eb' : '#9ca3af', padding: '0 4px' }}
                              >✎</button>
                            </div>
                            {isEditingThis && (
                              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', paddingLeft: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  value={editingMonthBudgetValue}
                                  onChange={(e) => setEditingMonthBudgetValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveMonthBudgetOverride(p.id, ym);
                                    else if (e.key === 'Escape') cancelEditMonthBudget();
                                  }}
                                  autoFocus
                                  placeholder="人月"
                                  style={{ width: 80, padding: '3px 6px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none' }}
                                />
                                <button
                                  onClick={() => saveMonthBudgetOverride(p.id, ym)}
                                  disabled={editingMonthBudgetValue.trim() === ''}
                                  style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: '11px', cursor: editingMonthBudgetValue.trim() === '' ? 'not-allowed' : 'pointer', opacity: editingMonthBudgetValue.trim() === '' ? 0.5 : 1 }}
                                >保存</button>
                                {hasOverride && (
                                  <button
                                    onClick={() => clearMonthBudgetOverride(p.id, ym)}
                                    title="今月のオーバーライドを解除して通常の予算に戻す"
                                    style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}
                                  >解除</button>
                                )}
                                <button
                                  onClick={cancelEditMonthBudget}
                                  style={{ background: 'white', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 4, padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}
                                >キャンセル</button>
                              </div>
                            )}
                            {u.budgetH !== null && (
                              <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                  width: `${u.barFraction * 100}%`,
                                  height: '100%',
                                  background: barColor,
                                  transition: 'width 200ms',
                                }} />
                              </div>
                            )}
                            {u.budgetH !== null && u.lowH !== null && u.highH !== null && (
                              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                                許容 {fmtH(u.lowH)}h–{fmtH(u.highH)}h（±{fmtH(u.toleranceH)}h）
                              </div>
                            )}
                            {u.status === 'over' && u.highH !== null && (
                              <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>
                                ⚠ 超過 ({(u.actualH - u.highH).toFixed(1)}h オーバー)
                              </div>
                            )}
                            {u.status === 'underConfirmed' && u.lowH !== null && (
                              <div style={{ fontSize: '11px', color: '#d97706', marginTop: '2px' }}>
                                ⚠ 不足 ({(u.lowH - u.actualH).toFixed(1)}h 不足、月末確定)
                              </div>
                            )}
                            {u.status === 'projectedOver' && u.projection !== null && (
                              <div style={{ fontSize: '11px', color: '#f97316', marginTop: '2px' }}>
                                ⚠ このままだと月末予測 {u.projection.toFixed(1)}h（許容を超過する見込み）
                              </div>
                            )}
                            {u.status === 'projectedUnder' && u.projection !== null && (
                              <div style={{ fontSize: '11px', color: '#d97706', marginTop: '2px' }}>
                                ⚠ このままだと月末予測 {u.projection.toFixed(1)}h（許容に届かない見込み）
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '18px', paddingTop: '12px', fontSize: '12px', color: '#374151' }}>
                    <div>合計実績: {(grandTotalMin / 60).toFixed(1)}h（割当: {(totalAssignedMin / 60).toFixed(1)}h, 未割当: {(aggregate.unassigned / 60).toFixed(1)}h）</div>
                    <div style={{ color: '#6b7280', marginTop: '4px' }}>
                      月の経過: {Math.round(elapsed * 100)}%
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {blockEdit !== null && (
        <div
          onClick={closeBlockEdit}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '8px',
              padding: '20px',
              minWidth: '380px',
              maxWidth: '90vw',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '15px' }}>ブロック編集</h2>
              <button
                onClick={closeBlockEdit}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280', padding: '0 4px', lineHeight: 1 }}
                aria-label="閉じる"
              >×</button>
            </div>

            <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>ラベル</label>
            <input
              autoFocus
              value={blockEdit.label}
              onChange={(e) => setBlockEdit({ ...blockEdit, label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveBlockEdit();
                else if (e.key === 'Escape') closeBlockEdit();
              }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="ラベル"
              style={{ width: '100%', padding: '6px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box', outline: 'none', marginBottom: '12px' }}
            />

            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>開始</label>
                <input
                  type="time"
                  value={blockEdit.startHHMM}
                  onChange={(e) => setBlockEdit({ ...blockEdit, startHHMM: e.target.value })}
                  step="900"
                  style={{ width: '100%', padding: '6px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>時間 (分)</label>
                <input
                  type="number"
                  min="1"
                  max="1440"
                  step="5"
                  value={blockEdit.durationMin}
                  onChange={(e) => setBlockEdit({ ...blockEdit, durationMin: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
            </div>

            <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>案件</label>
            <select
              value={blockEdit.projectId}
              onChange={(e) => setBlockEdit({ ...blockEdit, projectId: e.target.value })}
              style={{ width: '100%', padding: '6px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box', outline: 'none', background: 'white', color: '#1f2937', marginBottom: '16px' }}
            >
              <option value="">— 未割当 —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={deleteBlockFromEdit}
                style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}
              >削除</button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={closeBlockEdit}
                  style={{ background: 'white', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: '4px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}
                >キャンセル</button>
                <button
                  onClick={saveBlockEdit}
                  style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}
                >保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
