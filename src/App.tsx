import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { DateString, Project, TaskTemplate, TimeBlock } from './domain/types.js';
import { SAMPLE_TEMPLATES } from './templates.js';
import { PROJECT_COLOR_PALETTE } from './projects.js';
import { addDays, addMonths, daysOfWeek, elapsedRatio, formatJaDate, formatJaYearMonth, today, yearMonthOf, yearOf } from './dates.js';
import type { ViewMode } from './views/types.js';
import { DayView } from './views/DayView.js';
import { WeekView } from './views/WeekView.js';
import { MonthView } from './views/MonthView.js';
import { YearView } from './views/YearView.js';
import { loadStore, saveStore } from './storage.js';
import { aggregateMonthly } from './domain/aggregate.js';
import { projectBudgetUsage } from './domain/budget.js';

const fmtH = (h: number): string => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? r.toString() : r.toFixed(1);
};

const blockWithoutProject = (b: TimeBlock): TimeBlock => ({
  id: b.id,
  label: b.label,
  start: b.start,
  durationMin: b.durationMin,
  ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
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
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectBudget, setNewProjectBudget] = useState('');
  const [newProjectColor, setNewProjectColor] = useState<string>(
    PROJECT_COLOR_PALETTE[0] ?? '#64748b',
  );
  const [colorPickerProjectId, setColorPickerProjectId] = useState<string | null>(null);

  useEffect(() => {
    saveStore({ blocksByDate, projects });
  }, [blocksByDate, projects]);

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
    for (const t of SAMPLE_TEMPLATES) m.set(t.id, t);
    return m;
  }, []);

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

  const commitEdit = (id: string, rawLabel: string): void => {
    const trimmed = rawLabel.trim();
    if (trimmed.length > 0) {
      setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, label: trimmed } : b)));
    }
    setEditingId(null);
  };

  const beginEdit = (block: TimeBlock): void => {
    setEditLabel(block.label);
    setEditingId(block.id);
  };

  const handleProjectChange = (blockId: string, newProjectId: string): void => {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== blockId) return b;
        if (newProjectId === '') return blockWithoutProject(b);
        return { ...b, projectId: newProjectId };
      }),
    );
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

  const handleDeleteProject = (id: string): void => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setBlocksByDate((prev) => {
      const next: Record<DateString, readonly TimeBlock[]> = {};
      for (const [date, dayBlocks] of Object.entries(prev)) {
        next[date] = dayBlocks.map((b) => (b.projectId === id ? blockWithoutProject(b) : b));
      }
      return next;
    });
  };

  const navigateToDate = (date: DateString, mode: ViewMode = viewMode): void => {
    if (editingId !== null) commitEdit(editingId, editLabel);
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
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1f2937' }}>
      <aside style={{ background: '#f3f4f6', padding: '16px', borderRight: '1px solid #e5e7eb', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '13px', margin: 0, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            案件
          </h2>
          <button
            onClick={() => setShowSettings(true)}
            title="案件設定"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#6b7280', padding: '2px 6px', borderRadius: '4px' }}
          >⚙</button>
        </div>
        <div style={{ marginBottom: '20px' }}>
          {projects.length === 0 ? (
            <div style={{ fontSize: '11px', color: '#9ca3af', padding: '4px 6px' }}>案件未登録</div>
          ) : (
            projects.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', fontSize: '12px' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              </div>
            ))
          )}
        </div>

        <h2 style={{ fontSize: '13px', margin: '0 0 8px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          テンプレート
        </h2>
        {SAMPLE_TEMPLATES.map((t) => {
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
          ・ラベルクリックで名前と案件を編集
        </p>
      </aside>

      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '16px', background: 'white' }}>
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
            editingId={editingId}
            setEditingId={setEditingId}
            editLabel={editLabel}
            setEditLabel={setEditLabel}
            commitEdit={commitEdit}
            beginEdit={beginEdit}
            handleProjectChange={handleProjectChange}
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
          onClick={() => { setShowSettings(false); setColorPickerProjectId(null); }}
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
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '15px' }}>案件設定</h2>
              <button
                onClick={() => { setShowSettings(false); setColorPickerProjectId(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280', padding: '0 4px', lineHeight: 1 }}
                aria-label="閉じる"
              >×</button>
            </div>

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
                  if (e.key === 'Enter') submitNewProject();
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
                  if (e.key === 'Enter') submitNewProject();
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
                        const u = projectBudgetUsage(p, minutes, elapsed);
                        const budgetPM = p.monthlyBudget;
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
                                {budgetPM !== undefined && (
                                  <span style={{ color: '#6b7280' }}> / {budgetPM}人月 ({Math.round(u.ratio * 100)}%)</span>
                                )}
                              </span>
                            </div>
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
    </div>
  );
}
