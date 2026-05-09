import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Day } from './domain/day.js';
import type { DateString, MinuteOfDay, Project, TaskTemplate, TimeBlock } from './domain/types.js';
import { SAMPLE_TEMPLATES } from './templates.js';
import { DEFAULT_PROJECTS, PROJECT_COLOR_PALETTE } from './projects.js';
import { addDays, formatJaDate, today } from './dates.js';
import { loadStore, saveStore } from './storage.js';

const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const FREEFORM_DEFAULT_DURATION = 30;
const DEFAULT_LABEL = '新規ブロック';
const FALLBACK_BLOCK_COLOR = '#64748b';

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const formatMinute = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const snapMinutes = (mins: number): MinuteOfDay =>
  Math.round(Math.max(0, mins) / SNAP_MIN) * SNAP_MIN;

const blockWithoutProject = (b: TimeBlock): TimeBlock => ({
  id: b.id,
  label: b.label,
  start: b.start,
  durationMin: b.durationMin,
  ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
});

export function App() {
  const [currentDate, setCurrentDate] = useState<DateString>(today);
  const [blocksByDate, setBlocksByDate] = useState<Record<DateString, readonly TimeBlock[]>>(
    () => loadStore().blocksByDate,
  );
  const [projects, setProjects] = useState<readonly Project[]>(() => loadStore().projects);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState<string>(
    PROJECT_COLOR_PALETTE[0] ?? '#64748b',
  );

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

  const blockColor = (b: TimeBlock): string => {
    if (b.projectId !== undefined) {
      const p = projectById.get(b.projectId);
      if (p) return p.color;
    }
    if (b.templateId !== undefined) {
      const t = templateById.get(b.templateId);
      if (t?.color !== undefined) return t.color;
    }
    return FALLBACK_BLOCK_COLOR;
  };

  const applyPlace = (newBlock: TimeBlock, snappedForError: MinuteOfDay): boolean => {
    const day = new Day(currentDate, blocks);
    const result = day.place(newBlock);
    if (result.ok) {
      setBlocks(day.blocks);
      setError(null);
      return true;
    }
    if (result.reason === 'overlap') {
      setError(`重なっていますわ — ${formatMinute(snappedForError)} は他のブロックと衝突しています`);
    } else {
      setError(result.message);
    }
    return false;
  };

  const applyMove = (id: string, newStart: MinuteOfDay): void => {
    const day = new Day(currentDate, blocks);
    const result = day.move(id, newStart);
    if (result.ok) {
      setBlocks(day.blocks);
      setError(null);
    } else if (result.reason === 'overlap') {
      setError(`移動できませんでしたわ — ${formatMinute(newStart)} で他のブロックと衝突しています`);
    } else {
      setError(result.message);
    }
  };

  const handleTemplateDragStart = (e: DragEvent<HTMLDivElement>, templateId: string): void => {
    e.dataTransfer.setData('kind', 'template');
    e.dataTransfer.setData('templateId', templateId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleBlockDragStart = (e: DragEvent<HTMLDivElement>, blockId: string): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetMin = (e.clientY - rect.top) / PX_PER_MIN;
    e.dataTransfer.setData('kind', 'block');
    e.dataTransfer.setData('blockId', blockId);
    e.dataTransfer.setData('offsetMin', String(offsetMin));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('kind');
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const yMin = (e.clientY - rect.top + target.scrollTop) / PX_PER_MIN;

    if (kind === 'template') {
      const templateId = e.dataTransfer.getData('templateId');
      const tmpl = templateById.get(templateId);
      if (!tmpl) return;
      const snapped = snapMinutes(yMin);
      const newBlock: TimeBlock = {
        id: crypto.randomUUID(),
        label: tmpl.label,
        start: snapped,
        durationMin: tmpl.defaultDurationMin,
        templateId: tmpl.id,
        ...(tmpl.projectId !== undefined ? { projectId: tmpl.projectId } : {}),
      };
      applyPlace(newBlock, snapped);
    } else if (kind === 'block') {
      const blockId = e.dataTransfer.getData('blockId');
      const offsetStr = e.dataTransfer.getData('offsetMin');
      const offsetMin = offsetStr.length > 0 ? parseFloat(offsetStr) : 0;
      const snapped = snapMinutes(yMin - offsetMin);
      applyMove(blockId, snapped);
    }
  };

  const handleCreateAt = (minute: MinuteOfDay): void => {
    const newBlock: TimeBlock = {
      id: crypto.randomUUID(),
      label: DEFAULT_LABEL,
      start: minute,
      durationMin: FREEFORM_DEFAULT_DURATION,
    };
    if (applyPlace(newBlock, minute)) {
      beginEdit(newBlock);
    }
  };

  const handleRemove = (id: string): void => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (editingId === id) setEditingId(null);
    setError(null);
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
    setProjects((prev) => [...prev, { id: crypto.randomUUID(), name: trimmed, color: newProjectColor }]);
    setNewProjectName('');
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

  const navigateTo = (date: DateString): void => {
    if (editingId !== null) commitEdit(editingId, editLabel);
    setError(null);
    setCurrentDate(date);
  };

  const isToday = currentDate === today();

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
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => handleTemplateDragStart(e, t.id)}
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderLeft: `6px solid ${accent}`,
                padding: '8px 10px',
                marginBottom: '6px',
                borderRadius: '6px',
                cursor: 'grab',
                fontSize: '13px',
                userSelect: 'none',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
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
              onClick={() => navigateTo(addDays(currentDate, -1))}
              title="前日"
              style={{ background: 'white', border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#1f2937' }}
            >◀</button>
            <span style={{ fontSize: '13px', minWidth: '170px', textAlign: 'center', color: '#1f2937', fontWeight: isToday ? 600 : 400 }}>
              {formatJaDate(currentDate)}{isToday && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#2563eb' }}>(今日)</span>}
            </span>
            <button
              onClick={() => navigateTo(addDays(currentDate, 1))}
              title="翌日"
              style={{ background: 'white', border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#1f2937' }}
            >▶</button>
            <button
              onClick={() => navigateTo(today())}
              disabled={isToday}
              title="今日へジャンプ"
              style={{
                background: isToday ? '#f3f4f6' : 'white',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                padding: '4px 10px',
                fontSize: '12px',
                cursor: isToday ? 'not-allowed' : 'pointer',
                color: '#1f2937',
                marginLeft: '6px',
                opacity: isToday ? 0.5 : 1,
              }}
            >今日</button>
          </div>
          <div style={{ flex: 1 }} />
          {error !== null && <span style={{ color: '#dc2626', fontSize: '12px' }}>{error}</span>}
        </header>

        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#fafafa' }}
        >
          <div style={{ position: 'relative', height: `${1440 * PX_PER_MIN}px`, marginLeft: '52px' }}>
            {Array.from({ length: 48 }).map((_, i) => {
              const minute = i * 30;
              return (
                <div
                  key={`slot-${i}`}
                  onDoubleClick={() => handleCreateAt(minute)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    position: 'absolute',
                    top: `${minute * PX_PER_MIN}px`,
                    left: 0,
                    right: 0,
                    height: `${30 * PX_PER_MIN}px`,
                    background: 'transparent',
                    transition: 'background 80ms',
                  }}
                />
              );
            })}

            {Array.from({ length: 25 }).map((_, h) => (
              <div key={h} style={{
                position: 'absolute',
                top: `${h * 60 * PX_PER_MIN}px`,
                left: '-52px',
                right: 0,
                borderTop: '1px solid #e5e7eb',
                pointerEvents: 'none',
              }}>
                <span style={{ position: 'absolute', top: '-8px', left: '8px', fontSize: '11px', color: '#9ca3af', background: '#fafafa', padding: '0 2px' }}>
                  {pad2(h)}:00
                </span>
              </div>
            ))}

            {blocks.map((b) => {
              const color = blockColor(b);
              const proj = b.projectId !== undefined ? projectById.get(b.projectId) : undefined;
              const isEditing = editingId === b.id;
              return (
                <div
                  key={b.id}
                  draggable={!isEditing}
                  onDragStart={(e) => handleBlockDragStart(e, b.id)}
                  style={{
                    position: 'absolute',
                    top: `${b.start * PX_PER_MIN}px`,
                    left: '6px',
                    right: '14px',
                    height: `${b.durationMin * PX_PER_MIN}px`,
                    background: color,
                    color: 'white',
                    borderRadius: '5px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    cursor: isEditing ? 'text' : 'grab',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                    {isEditing ? (
                      <>
                        <input
                          autoFocus
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          draggable={false}
                          onBlur={(e) => {
                            const next = e.relatedTarget;
                            const blockEl = e.currentTarget.parentElement?.parentElement;
                            if (next instanceof Node && blockEl && blockEl.contains(next)) return;
                            commitEdit(b.id, editLabel);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                              setEditingId(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            background: 'rgba(255,255,255,0.18)',
                            border: '1px solid rgba(255,255,255,0.55)',
                            color: 'white',
                            fontSize: '12px',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            outline: 'none',
                          }}
                        />
                        <select
                          value={b.projectId ?? ''}
                          onChange={(e) => handleProjectChange(b.id, e.currentTarget.value)}
                          onBlur={(e) => {
                            const next = e.relatedTarget;
                            const blockEl = e.currentTarget.parentElement?.parentElement;
                            if (next instanceof Node && blockEl && blockEl.contains(next)) return;
                            commitEdit(b.id, editLabel);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          style={{
                            maxWidth: '110px',
                            background: 'rgba(255,255,255,0.18)',
                            border: '1px solid rgba(255,255,255,0.55)',
                            color: 'white',
                            fontSize: '11px',
                            padding: '1px 2px',
                            borderRadius: '3px',
                            outline: 'none',
                          }}
                        >
                          <option value="" style={{ color: '#1f2937' }}>— 未割当 —</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id} style={{ color: '#1f2937' }}>{p.name}</option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span
                        onClick={(e) => { e.stopPropagation(); beginEdit(b); }}
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'text',
                          flex: 1,
                        }}
                      >
                        {b.label}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemove(b.id); }}
                      style={{ background: 'rgba(0,0,0,0.25)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px', padding: '0 6px', lineHeight: 1.4 }}
                      aria-label="削除"
                    >×</button>
                  </div>
                  {b.durationMin >= 25 && !isEditing && (
                    <div style={{ fontSize: '10px', opacity: 0.85, marginTop: '2px' }}>
                      {formatMinute(b.start)} – {formatMinute(b.start + b.durationMin)}
                      {proj !== undefined && <span> · {proj.name}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
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
                onClick={() => setShowSettings(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#6b7280', padding: '0 4px', lineHeight: 1 }}
                aria-label="閉じる"
              >×</button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              {projects.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#9ca3af', padding: '8px 0' }}>案件が登録されておりません</div>
              ) : (
                projects.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: '13px' }}>{p.name}</span>
                    <button
                      onClick={() => handleDeleteProject(p.id)}
                      style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}
                    >削除</button>
                  </div>
                ))
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
    </div>
  );
}
