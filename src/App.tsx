import { useMemo, useState, type DragEvent } from 'react';
import { Day } from './domain/day.js';
import type { MinuteOfDay, TaskTemplate, TimeBlock } from './domain/types.js';
import { SAMPLE_TEMPLATES } from './templates.js';

const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const TODAY = '2026-05-09';
const FREEFORM_DEFAULT_DURATION = 30;
const DEFAULT_LABEL = '新規ブロック';

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const formatMinute = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const snapMinutes = (mins: number): MinuteOfDay =>
  Math.round(Math.max(0, mins) / SNAP_MIN) * SNAP_MIN;

export function App() {
  const [blocks, setBlocks] = useState<readonly TimeBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const templateById = useMemo(() => {
    const m = new Map<string, TaskTemplate>();
    for (const t of SAMPLE_TEMPLATES) m.set(t.id, t);
    return m;
  }, []);

  const applyPlace = (newBlock: TimeBlock, snappedForError: MinuteOfDay): boolean => {
    const day = new Day(TODAY, blocks);
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
    const day = new Day(TODAY, blocks);
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
    // dropEffect must be compatible with source's effectAllowed; templates use 'copy', so leave default.
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
      applyPlace({
        id: crypto.randomUUID(),
        label: tmpl.label,
        start: snapped,
        durationMin: tmpl.defaultDurationMin,
        templateId: tmpl.id,
      }, snapped);
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
      setEditingId(newBlock.id);
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1f2937' }}>
      <aside style={{ background: '#f3f4f6', padding: '16px', borderRight: '1px solid #e5e7eb', overflow: 'auto' }}>
        <h2 style={{ fontSize: '13px', margin: '0 0 12px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          テンプレート
        </h2>
        {SAMPLE_TEMPLATES.map((t) => (
          <div
            key={t.id}
            draggable
            onDragStart={(e) => handleTemplateDragStart(e, t.id)}
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderLeft: `6px solid ${t.color ?? '#94a3b8'}`,
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
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{t.defaultDurationMin}分</div>
          </div>
        ))}
        <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '20px', lineHeight: 1.5 }}>
          ・テンプレを D&amp;D で配置<br />
          ・空き時間ダブルクリックで自由記入<br />
          ・設置済みブロックもドラッグで移動<br />
          ・ラベルクリックで名前を編集
        </p>
      </aside>

      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
          <h1 style={{ fontSize: '15px', margin: 0, fontWeight: 600 }}>taskette — {TODAY}</h1>
          {error !== null && <span style={{ color: '#dc2626', fontSize: '12px' }}>{error}</span>}
        </header>

        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{ flex: 1, overflow: 'auto', position: 'relative', background: '#fafafa' }}
        >
          <div
            style={{ position: 'relative', height: `${1440 * PX_PER_MIN}px`, marginLeft: '52px' }}
          >
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
              const tmpl = b.templateId !== undefined ? templateById.get(b.templateId) : undefined;
              const color = tmpl?.color ?? '#64748b';
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
                      <input
                        autoFocus
                        defaultValue={b.label}
                        draggable={false}
                        onBlur={(e) => commitEdit(b.id, e.currentTarget.value)}
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
                          background: 'rgba(255,255,255,0.18)',
                          border: '1px solid rgba(255,255,255,0.55)',
                          color: 'white',
                          fontSize: '12px',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          minWidth: 0,
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <span
                        onClick={(e) => { e.stopPropagation(); setEditingId(b.id); }}
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
