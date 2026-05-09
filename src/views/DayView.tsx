import type { DragEvent } from 'react';
import { Day } from '../domain/day.js';
import type { DateString, MinuteOfDay, Project, TaskTemplate, TimeBlock } from '../domain/types.js';
import { DailyActualStrip } from './DailyActualStrip.js';

const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const FREEFORM_DEFAULT_DURATION = 30;
const DEFAULT_LABEL = '新規ブロック';
const FALLBACK_BLOCK_COLOR = '#64748b';

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const formatMinute = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const snapMinutes = (mins: number): MinuteOfDay =>
  Math.round(Math.max(0, mins) / SNAP_MIN) * SNAP_MIN;

type DayViewProps = {
  readonly currentDate: DateString;
  readonly blocks: readonly TimeBlock[];
  readonly setBlocks: (
    a: readonly TimeBlock[] | ((p: readonly TimeBlock[]) => readonly TimeBlock[]),
  ) => void;
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly projects: readonly Project[];
  readonly projectById: ReadonlyMap<string, Project>;
  readonly templateById: ReadonlyMap<string, TaskTemplate>;
  readonly setError: (s: string | null) => void;
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
  readonly editLabel: string;
  readonly setEditLabel: (s: string) => void;
  readonly commitEdit: (id: string, rawLabel: string) => void;
  readonly beginEdit: (b: TimeBlock) => void;
  readonly handleProjectChange: (blockId: string, newProjectId: string) => void;
};

export function DayView(props: DayViewProps) {
  const {
    currentDate, blocks, setBlocks, blocksByDate, projects, projectById, templateById,
    setError, editingId, setEditingId, editLabel, setEditLabel, commitEdit, beginEdit,
    handleProjectChange,
  } = props;

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

  return (
    <>
      <DailyActualStrip blocksByDate={blocksByDate} currentDate={currentDate} projects={projects} />
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
    </>
  );
}
