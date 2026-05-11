import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Day } from '../domain/day.js';
import type { DateString, MinuteOfDay, Project, TaskTemplate, TimeBlock } from '../domain/types.js';
import { today } from '../dates.js';
import { cn } from '../lib/utils.js';
import { ActualStrip } from './ActualStrip.js';
import { aggregateDaily } from '../domain/aggregate.js';

const PX_PER_MIN = 1;
const SNAP_MIN = 15;
const FREEFORM_DEFAULT_DURATION = 30;
const DEFAULT_LABEL = '新規ブロック';
const FALLBACK_BLOCK_COLOR = '#A39A92';
const MIN_DRAG_DURATION = 15;
const TIME_GUTTER_PX = 56;
const LANE_GAP_PX = 2;
const INITIAL_SCROLL_HOUR = 8; // 仕事時間 (9-18) の少し手前にスクロール開始

const pad2 = (n: number): string => n.toString().padStart(2, '0');
const formatMinute = (m: number): string => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const snapMinutes = (mins: number): MinuteOfDay =>
  Math.round(Math.max(0, mins) / SNAP_MIN) * SNAP_MIN;

type LaidOutBlock = TimeBlock & { readonly laneIndex: number; readonly laneCount: number };

// Group blocks into transitively-overlapping clusters, then greedily assign
// each block to the leftmost lane whose previous occupant has already ended.
// All blocks in a cluster share the same laneCount (cluster width), so the
// view can render them side-by-side at equal width.
const layoutBlocks = (blocks: readonly TimeBlock[]): readonly LaidOutBlock[] => {
  if (blocks.length === 0) return [];
  const sorted = [...blocks].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.start + b.durationMin) - (a.start + a.durationMin); // longer first
  });
  const result: LaidOutBlock[] = [];
  let cluster: TimeBlock[] = [];
  let clusterEnd = -1;
  const flush = (): void => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const lanes = new Map<string, number>();
    for (const b of cluster) {
      let lane = laneEnds.findIndex((end) => b.start >= end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = b.start + b.durationMin;
      lanes.set(b.id, lane);
    }
    const laneCount = laneEnds.length;
    for (const b of cluster) {
      result.push({ ...b, laneIndex: lanes.get(b.id)!, laneCount });
    }
    cluster = [];
    clusterEnd = -1;
  };
  for (const b of sorted) {
    if (cluster.length > 0 && b.start >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.start + b.durationMin);
  }
  flush();
  return result;
};

type DragCreateState = {
  readonly startMin: MinuteOfDay;
  readonly currentMin: MinuteOfDay;
};

type ResizeState = {
  readonly id: string;
  readonly start: MinuteOfDay;
  readonly originalDuration: number;
  readonly currentDuration: number;
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
  readonly openBlockEdit: (b: TimeBlock, opts?: { justCreated?: boolean }) => void;
};

export function DayView(props: DayViewProps) {
  const {
    currentDate, blocks, setBlocks, blocksByDate, projects, projectById, templateById,
    setError, openBlockEdit,
  } = props;

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [dragCreate, setDragCreate] = useState<DragCreateState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [nowMin, setNowMin] = useState<MinuteOfDay>(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  const isToday = currentDate === today();
  const laidOutBlocks = useMemo(() => layoutBlocks(blocks), [blocks]);

  // 初期スクロール位置: 通常は 8 時、今日なら現時刻の 1 時間前を表示
  useEffect(() => {
    const sc = scrollContainerRef.current;
    if (sc === null) return;
    let scrollMin = INITIAL_SCROLL_HOUR * 60;
    if (currentDate === today()) {
      const d = new Date();
      const cur = d.getHours() * 60 + d.getMinutes();
      if (cur > scrollMin + 60) {
        scrollMin = cur - 60;
      }
    }
    sc.scrollTop = scrollMin * PX_PER_MIN;
  }, [currentDate]);

  // 現時刻を毎分更新
  useEffect(() => {
    if (!isToday) return;
    const tick = (): void => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [isToday]);

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

  const applyPlace = (newBlock: TimeBlock): boolean => {
    const day = new Day(currentDate, blocks);
    const result = day.place(newBlock);
    if (result.ok) {
      setBlocks(day.blocks);
      setError(null);
      return true;
    }
    setError(result.message);
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
    } else {
      setError(result.message);
    }
  };

  const applyResize = (id: string, newDuration: number): boolean => {
    const day = new Day(currentDate, blocks);
    const result = day.resize(id, newDuration);
    if (result.ok) {
      setBlocks(day.blocks);
      setError(null);
      return true;
    }
    setError(result.message);
    return false;
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

    if (kind === 'project') {
      const projectId = e.dataTransfer.getData('projectId');
      if (projectId.length === 0 || !projectById.has(projectId)) return;
      const snapped = snapMinutes(yMin);
      const newBlock: TimeBlock = {
        id: crypto.randomUUID(),
        label: '作業',
        start: snapped,
        durationMin: 60,
        projectId,
      };
      if (applyPlace(newBlock)) {
        openBlockEdit(newBlock, { justCreated: true });
      }
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
    if (applyPlace(newBlock)) {
      openBlockEdit(newBlock, { justCreated: true });
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
  const applyResizeRef = useRef(applyResize);
  applyResizeRef.current = applyResize;
  const openBlockEditRef = useRef(openBlockEdit);
  openBlockEditRef.current = openBlockEdit;
  const dragCreateRef = useRef(dragCreate);
  dragCreateRef.current = dragCreate;
  const resizeRef = useRef(resize);
  resizeRef.current = resize;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const isDragging = dragCreate !== null;
  const isResizing = resize !== null;

  const handleResizeMouseDown = (
    e: ReactMouseEvent<HTMLDivElement>,
    block: TimeBlock,
  ): void => {
    if (block.source === 'gcal') return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setResize({
      id: block.id,
      start: block.start,
      originalDuration: block.durationMin,
      currentDuration: block.durationMin,
    });
  };

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent): void => {
      const cur = resizeRef.current;
      if (cur === null) return;
      const endMin = snapMinutes(yToMinute(e.clientY));
      const rawDuration = endMin - cur.start;
      const maxDuration = 1440 - cur.start;
      const clamped = Math.max(MIN_DRAG_DURATION, Math.min(maxDuration, rawDuration));
      setResize((prev) => (prev === null ? null : { ...prev, currentDuration: clamped }));
    };
    const onUp = (): void => {
      const cur = resizeRef.current;
      setResize(null);
      if (cur === null) return;
      if (cur.currentDuration === cur.originalDuration) return;
      applyResizeRef.current(cur.id, cur.currentDuration);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setResize(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
    };
  }, [isResizing]);

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
      if (applyPlaceRef.current(newBlock)) {
        openBlockEditRef.current(newBlock, { justCreated: true });
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
    return { a, b, duration };
  })();

  return (
    <>
      <ActualStrip
        aggregate={aggregateDaily(blocksByDate, currentDate)}
        projects={projects}
        emptyMessage="本日の登録なし"
      />
      <div
        ref={scrollContainerRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          'flex-1 overflow-auto relative bg-background',
          isDragging || isResizing ? 'select-none' : 'select-auto',
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
          {laidOutBlocks.map((b) => {
            const color = blockColor(b);
            const isGcal = b.source === 'gcal';
            const isResizingThis = resize !== null && resize.id === b.id;
            const effectiveDuration = isResizingThis ? resize.currentDuration : b.durationMin;
            const topPx = b.start * PX_PER_MIN;
            const heightPx = effectiveDuration * PX_PER_MIN;
            const timeLabel = `${formatMinute(b.start)} – ${formatMinute(b.start + effectiveDuration)}`;
            const singleLane = b.laneCount === 1;
            // Multi-lane: split the available area (between left:8 and right:16)
            // into equal columns with a small visual gap between them.
            const positionStyle = singleLane
              ? { left: '8px', right: '16px' }
              : {
                  left: `calc(8px + (100% - 24px) * ${b.laneIndex / b.laneCount})`,
                  width: `calc((100% - 24px) / ${b.laneCount} - ${LANE_GAP_PX}px)`,
                };
            return (
              <div
                key={b.id}
                draggable={!isGcal && !isResizingThis}
                onDragStart={(e) => handleBlockDragStart(e, b)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openBlockEdit(b);
                }}
                onMouseDown={(e) => { if (isGcal) e.stopPropagation(); }}
                title={isGcal ? `${b.label}\n(Google Calendar の予定 — 右クリックで案件割当)` : '右クリックで編集 / 下端ドラッグでリサイズ'}
                className={cn(
                  'absolute rounded-lg overflow-hidden text-foreground transition-[box-shadow,transform] duration-150 shadow-soft',
                  isGcal ? 'cursor-default' : 'cursor-grab hover:shadow-floaty hover:-translate-y-px',
                  isResizingThis && 'shadow-floaty',
                )}
                style={{
                  top: `${topPx}px`,
                  ...positionStyle,
                  height: `${heightPx}px`,
                  background: isGcal ? `${color}14` : `${color}26`,
                  border: isGcal ? `1.5px dashed ${color}80` : `1px solid ${color}40`,
                  borderLeft: `4px solid ${color}`,
                }}
              >
                <div
                  className={cn(
                    'h-full w-full flex flex-col min-w-0 px-2.5',
                    // 短いブロックは中央寄せで詰める / それ以外は上寄せで「ちょうどいい位置」に
                    effectiveDuration < 22 ? 'py-0 justify-center' : 'pt-1',
                  )}
                >
                  <div className="flex items-center gap-1.5 leading-tight min-w-0">
                    {isGcal && (
                      <CalendarIcon className="size-3 shrink-0" style={{ color }} />
                    )}
                    <span className="truncate font-medium text-[12.5px] flex-1 min-w-0">
                      {b.label}
                    </span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-foreground/60 font-normal">
                      {timeLabel}
                    </span>
                  </div>
                </div>

                {!isGcal && (
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, b)}
                    className={cn(
                      'absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize group',
                      'hover:bg-foreground/10',
                      isResizingThis && 'bg-foreground/15',
                    )}
                    title="ドラッグで時間を伸縮"
                  >
                    <div
                      className="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-6 h-px opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: `${color}99` }}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* Now line (今日のみ) */}
          {isToday && (
            <div
              className="absolute right-0 pointer-events-none z-20"
              style={{
                top: `${nowMin * PX_PER_MIN}px`,
                left: `-${TIME_GUTTER_PX}px`,
              }}
            >
              <div
                className="absolute inset-x-0"
                style={{
                  top: 0,
                  borderTop: '1.5px solid var(--primary)',
                  left: `${TIME_GUTTER_PX - 4}px`,
                }}
              />
              <div
                className="absolute -translate-y-1/2 rounded-md px-1.5 text-[10px] font-medium tabular-nums leading-tight py-0.5 shadow-sm"
                style={{
                  left: '6px',
                  top: 0,
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                }}
              >
                {pad2(Math.floor(nowMin / 60))}:{pad2(nowMin % 60)}
              </div>
              <div
                className="absolute size-1.5 rounded-full -translate-y-1/2"
                style={{
                  left: `${TIME_GUTTER_PX - 7}px`,
                  top: 0,
                  background: 'var(--primary)',
                }}
              />
            </div>
          )}

          {/* Drag-create preview */}
          {dragPreview !== null && (
            <div
              className={cn(
                'absolute rounded-lg px-2 py-1 text-[11px] font-semibold pointer-events-none z-10',
                'border-2 border-dashed bg-primary/12 border-primary text-primary',
              )}
              style={{
                top: `${dragPreview.a * PX_PER_MIN}px`,
                height: `${dragPreview.duration * PX_PER_MIN}px`,
                left: '8px',
                right: '16px',
              }}
            >
              {formatMinute(dragPreview.a)} – {formatMinute(dragPreview.b)} ({dragPreview.duration}分)
            </div>
          )}
        </div>
      </div>
    </>
  );
}
