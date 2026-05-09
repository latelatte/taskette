import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Day } from '../domain/day.js';
import type { DateString, MinuteOfDay, Project, TaskTemplate, TimeBlock } from '../domain/types.js';
import { DailyActualStrip } from './DailyActualStrip.js';

const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const FREEFORM_DEFAULT_DURATION = 30;
const DEFAULT_LABEL = '新規ブロック';
const FALLBACK_BLOCK_COLOR = '#64748b';
const MIN_DRAG_DURATION = 15;

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const formatMinute = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const snapMinutes = (mins: number): MinuteOfDay =>
  Math.round(Math.max(0, mins) / SNAP_MIN) * SNAP_MIN;

type DragCreateState = {
  readonly startMin: MinuteOfDay;
  readonly currentMin: MinuteOfDay;
};

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
  readonly openBlockEdit: (b: TimeBlock) => void;
};

export function DayView(props: DayViewProps) {
  const {
    currentDate, blocks, setBlocks, blocksByDate, projects, projectById, templateById,
    setError, openBlockEdit,
  } = props;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [dragCreate, setDragCreate] = useState<DragCreateState | null>(null);

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
      openBlockEdit(newBlock);
    }
  };

  const yToMinute = (clientY: number): number => {
    const sc = scrollContainerRef.current;
    if (sc === null) return 0;
    const rect = sc.getBoundingClientRect();
    return (clientY - rect.top + sc.scrollTop) / PX_PER_MIN;
  };

  const handleSlotMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = snapMinutes(yToMinute(e.clientY));
    setDragCreate({ startMin: start, currentMin: start });
  };

  // refs to access latest applyPlace/openBlockEdit/blocks without re-running drag effect
  const applyPlaceRef = useRef(applyPlace);
  applyPlaceRef.current = applyPlace;
  const openBlockEditRef = useRef(openBlockEdit);
  openBlockEditRef.current = openBlockEdit;
  const dragCreateRef = useRef(dragCreate);
  dragCreateRef.current = dragCreate;

  const isDragging = dragCreate !== null;

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent): void => {
      const cur = snapMinutes(yToMinute(e.clientY));
      setDragCreate((prev) => (prev === null ? null : { ...prev, currentMin: cur }));
    };
    const onUp = (): void => {
      const drag = dragCreateRef.current;
      setDragCreate(null);
      if (drag === null) return;
      const a = Math.min(drag.startMin, drag.currentMin);
      const b = Math.max(drag.startMin, drag.currentMin);
      const duration = b - a;
      if (duration < MIN_DRAG_DURATION) return;
      const newBlock: TimeBlock = {
        id: crypto.randomUUID(),
        label: DEFAULT_LABEL,
        start: a,
        durationMin: duration,
      };
      if (applyPlaceRef.current(newBlock, a)) {
        openBlockEditRef.current(newBlock);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDragCreate(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
    };
  }, [isDragging]);

  const dragPreview = (() => {
    if (dragCreate === null) return null;
    const a = Math.min(dragCreate.startMin, dragCreate.currentMin);
    const b = Math.max(dragCreate.startMin, dragCreate.currentMin);
    const duration = b - a;
    if (duration < MIN_DRAG_DURATION) return null;
    const overlaps = blocks.some(
      (blk) => a < blk.start + blk.durationMin && blk.start < b,
    );
    return { a, b, duration, overlaps };
  })();

  return (
    <>
      <DailyActualStrip blocksByDate={blocksByDate} currentDate={currentDate} projects={projects} />
      <div
        ref={scrollContainerRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
          background: '#fafafa',
          userSelect: isDragging ? 'none' : 'auto',
        }}
      >
        <div style={{ position: 'relative', height: `${1440 * PX_PER_MIN}px`, marginLeft: '52px' }}>
          {Array.from({ length: 48 }).map((_, i) => {
            const minute = i * 30;
            return (
              <div
                key={`slot-${i}`}
                onDoubleClick={() => handleCreateAt(minute)}
                onMouseDown={handleSlotMouseDown}
                onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.background = 'rgba(99,102,241,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{
                  position: 'absolute',
                  top: `${minute * PX_PER_MIN}px`,
                  left: 0,
                  right: 0,
                  height: `${30 * PX_PER_MIN}px`,
                  background: 'transparent',
                  transition: 'background 80ms',
                  cursor: isDragging ? 'ns-resize' : 'pointer',
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
            return (
              <div
                key={b.id}
                draggable
                onDragStart={(e) => handleBlockDragStart(e, b.id)}
                onDoubleClick={(e) => { e.stopPropagation(); openBlockEdit(b); }}
                title="ダブルクリックで編集"
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
                  cursor: 'grab',
                }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.label}
                </div>
                {b.durationMin >= 25 && (
                  <div style={{ fontSize: '10px', opacity: 0.85, marginTop: '2px' }}>
                    {formatMinute(b.start)} – {formatMinute(b.start + b.durationMin)}
                    {proj !== undefined && <span> · {proj.name}</span>}
                  </div>
                )}
              </div>
            );
          })}

          {dragPreview !== null && (
            <div
              style={{
                position: 'absolute',
                top: `${dragPreview.a * PX_PER_MIN}px`,
                height: `${dragPreview.duration * PX_PER_MIN}px`,
                left: '6px',
                right: '14px',
                background: dragPreview.overlaps ? 'rgba(220, 38, 38, 0.18)' : 'rgba(37, 99, 235, 0.18)',
                border: `2px dashed ${dragPreview.overlaps ? '#dc2626' : '#2563eb'}`,
                borderRadius: '5px',
                padding: '4px 8px',
                color: dragPreview.overlaps ? '#991b1b' : '#1e40af',
                fontSize: '11px',
                fontWeight: 600,
                pointerEvents: 'none',
                zIndex: 5,
              }}
            >
              {formatMinute(dragPreview.a)} – {formatMinute(dragPreview.b)} ({dragPreview.duration}分)
              {dragPreview.overlaps && <span style={{ marginLeft: '6px' }}>⚠ 重なり</span>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
