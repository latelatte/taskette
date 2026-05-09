import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Day } from '../domain/day.js';
import type { DateString, MinuteOfDay, Project, TaskTemplate, TimeBlock } from '../domain/types.js';
import { cn } from '../lib/utils.js';
import { DailyActualStrip } from './DailyActualStrip.js';

const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const FREEFORM_DEFAULT_DURATION = 30;
const DEFAULT_LABEL = '新規ブロック';
const FALLBACK_BLOCK_COLOR = '#A39A92';
const MIN_DRAG_DURATION = 15;
const TIME_GUTTER_PX = 56;

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
    const target = blocks.find((b) => b.id === id);
    if (target?.source === 'gcal') return;
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

  const handleBlockDragStart = (e: DragEvent<HTMLDivElement>, block: TimeBlock): void => {
    if (block.source === 'gcal') {
      e.preventDefault();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetMin = (e.clientY - rect.top) / PX_PER_MIN;
    e.dataTransfer.setData('kind', 'block');
    e.dataTransfer.setData('blockId', block.id);
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
        className={cn(
          'flex-1 overflow-auto relative bg-background',
          isDragging ? 'select-none' : 'select-auto',
        )}
      >
        <div
          className="relative"
          style={{ height: `${1440 * PX_PER_MIN}px`, marginLeft: `${TIME_GUTTER_PX}px` }}
        >
          {/* 30-minute click slots */}
          {Array.from({ length: 48 }).map((_, i) => {
            const minute = i * 30;
            return (
              <div
                key={`slot-${i}`}
                onDoubleClick={() => handleCreateAt(minute)}
                onMouseDown={handleSlotMouseDown}
                className={cn(
                  'absolute inset-x-0 transition-colors duration-100',
                  isDragging
                    ? 'cursor-ns-resize'
                    : 'cursor-pointer hover:bg-accent/40',
                )}
                style={{
                  top: `${minute * PX_PER_MIN}px`,
                  height: `${30 * PX_PER_MIN}px`,
                }}
              />
            );
          })}

          {/* Hour lines + 30-minute subdivision lines */}
          {Array.from({ length: 25 }).map((_, h) => (
            <div
              key={`hour-${h}`}
              className="absolute right-0 border-t border-border pointer-events-none"
              style={{
                top: `${h * 60 * PX_PER_MIN}px`,
                left: `-${TIME_GUTTER_PX}px`,
              }}
            >
              <span
                className="absolute text-[11px] text-muted-foreground bg-background px-1 -translate-y-1/2"
                style={{ left: '8px', top: 0 }}
              >
                {pad2(h)}:00
              </span>
            </div>
          ))}
          {Array.from({ length: 24 }).map((_, h) => (
            <div
              key={`half-${h}`}
              className="absolute inset-x-0 border-t border-border/40 pointer-events-none"
              style={{ top: `${(h * 60 + 30) * PX_PER_MIN}px` }}
            />
          ))}

          {/* Blocks */}
          {blocks.map((b) => {
            const color = blockColor(b);
            const proj = b.projectId !== undefined ? projectById.get(b.projectId) : undefined;
            const isGcal = b.source === 'gcal';
            return (
              <div
                key={b.id}
                draggable={!isGcal}
                onDragStart={(e) => handleBlockDragStart(e, b)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openBlockEdit(b);
                }}
                onMouseDown={(e) => { if (isGcal) e.stopPropagation(); }}
                title={isGcal ? `${b.label}\n(Google Calendar の予定 — ダブルクリックで案件割当)` : 'ダブルクリックで編集'}
                className={cn(
                  'absolute rounded-lg overflow-hidden transition-shadow text-xs px-2 py-1',
                  isGcal
                    ? 'cursor-default text-foreground'
                    : 'cursor-grab text-white hover:shadow-md',
                )}
                style={{
                  top: `${b.start * PX_PER_MIN}px`,
                  left: '8px',
                  right: '16px',
                  height: `${b.durationMin * PX_PER_MIN}px`,
                  background: isGcal ? `${color}22` : color,
                  border: isGcal ? `1.5px dashed ${color}99` : undefined,
                  borderLeft: isGcal ? `4px solid ${color}` : undefined,
                  boxShadow: isGcal ? undefined : 'var(--shadow-soft)',
                }}
              >
                <div className="flex items-center gap-1.5 truncate leading-tight">
                  {isGcal && (
                    <CalendarIcon
                      className="size-2.5 shrink-0"
                      style={{ color }}
                    />
                  )}
                  <span className="truncate font-medium">{b.label}</span>
                </div>
                {b.durationMin >= 25 && (
                  <div
                    className={cn(
                      'text-[10px] mt-0.5 truncate',
                      isGcal ? 'text-foreground/65' : 'opacity-85',
                    )}
                  >
                    {formatMinute(b.start)} – {formatMinute(b.start + b.durationMin)}
                    {proj !== undefined && <span> · {proj.name}</span>}
                    {isGcal && proj === undefined && <span> · GCal</span>}
                  </div>
                )}
              </div>
            );
          })}

          {/* Drag-create preview */}
          {dragPreview !== null && (
            <div
              className={cn(
                'absolute rounded-lg px-2 py-1 text-[11px] font-semibold pointer-events-none z-10',
                'border-2 border-dashed',
                dragPreview.overlaps
                  ? 'bg-destructive/15 border-destructive text-destructive'
                  : 'bg-primary/12 border-primary text-primary',
              )}
              style={{
                top: `${dragPreview.a * PX_PER_MIN}px`,
                height: `${dragPreview.duration * PX_PER_MIN}px`,
                left: '8px',
                right: '16px',
              }}
            >
              {formatMinute(dragPreview.a)} – {formatMinute(dragPreview.b)} ({dragPreview.duration}分)
              {dragPreview.overlaps && <span className="ml-1.5">⚠ 重なり</span>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
