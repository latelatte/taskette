import { useMemo } from 'react';
import type { DateString, Project, TaskTemplate, TimeBlock } from '../domain/types.js';
import { aggregateDaily } from '../domain/aggregate.js';
import { daysOfWeek, formatJaDate, today } from '../dates.js';
import { cn } from '../lib/utils.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { ActualBreakdown } from './ActualBreakdown.js';

const PX_PER_MIN = 0.5;
const FALLBACK_BLOCK_COLOR = '#A39A92';
const UNASSIGNED_COLOR = '#B5B0A8';
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;
const TIME_GUTTER_PX = 56;

const pad2 = (n: number): string => n.toString().padStart(2, '0');

type Props = {
  readonly currentDate: DateString;
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly projects: readonly Project[];
  readonly projectById: ReadonlyMap<string, Project>;
  readonly templateById?: ReadonlyMap<string, TaskTemplate>;
  readonly onDayClick: (date: DateString) => void;
};

export function WeekView({ currentDate, blocksByDate, projects, projectById, templateById, onDayClick }: Props) {
  const days = useMemo(() => daysOfWeek(currentDate), [currentDate]);
  const todayStr = today();
  const dailyActuals = useMemo(() => days.map((d) => {
    const agg = aggregateDaily(blocksByDate, d);
    const assignedMin = Array.from(agg.byProject.values()).reduce((a, b) => a + b, 0);
    const totalMin = assignedMin + agg.unassigned;
    const segments: { color: string; min: number }[] = [];
    for (const p of projects) {
      const m = agg.byProject.get(p.id) ?? 0;
      if (m > 0) segments.push({ color: p.color, min: m });
    }
    for (const [pid, m] of agg.byProject) {
      if (!projectById.has(pid) && m > 0) segments.push({ color: FALLBACK_BLOCK_COLOR, min: m });
    }
    if (agg.unassigned > 0) segments.push({ color: UNASSIGNED_COLOR, min: agg.unassigned });
    return { date: d, totalMin, segments, aggregate: agg };
  }), [days, blocksByDate, projects, projectById]);

  const blockColor = (b: TimeBlock): string => {
    if (b.projectId !== undefined) {
      const p = projectById.get(b.projectId);
      if (p) return p.color;
    }
    if (templateById && b.templateId !== undefined) {
      const t = templateById.get(b.templateId);
      if (t?.color !== undefined) return t.color;
    }
    return FALLBACK_BLOCK_COLOR;
  };

  return (
    <div className="flex-1 overflow-auto bg-background flex flex-col">
      <div className="sticky top-0 z-10 bg-card/90 backdrop-blur-sm border-b">
        <div
          className="grid"
          style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, 1fr)` }}
        >
          <div className="border-r border-border/60" />
          {days.map((d, i) => {
            const isToday = d === todayStr;
            const isWeekend = i >= 5;
            const dayNum = parseInt(d.slice(8, 10), 10);
            return (
              <button
                key={d}
                onClick={() => onDayClick(d)}
                className={cn(
                  'border-none px-1 py-2 text-center text-[11px] font-semibold cursor-pointer transition-colors',
                  i < 6 && 'border-r border-border/60',
                  isToday
                    ? 'bg-primary/8 text-primary'
                    : isWeekend
                      ? 'text-muted-foreground/70 hover:bg-accent/40'
                      : 'text-muted-foreground hover:bg-accent/40',
                )}
              >
                <div>{WEEKDAY_LABELS[i]}</div>
                <div
                  className={cn(
                    'text-sm mt-0.5 font-semibold',
                    isToday
                      ? 'text-primary'
                      : isWeekend
                        ? 'text-muted-foreground/70'
                        : 'text-foreground',
                  )}
                >
                  {dayNum}
                </div>
              </button>
            );
          })}
        </div>
        <div
          className="grid border-t border-border/60 bg-muted/30"
          style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, 1fr)` }}
        >
          <div className="border-r border-border/60 px-2 py-1 text-[10px] tracking-wider text-muted-foreground uppercase font-semibold flex items-center">
            実績
          </div>
          {dailyActuals.map(({ date, totalMin, segments, aggregate }, i) => {
            const fullScale = Math.max(8 * 60, totalMin);
            return (
              <Tooltip key={date}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      'px-1.5 py-1 flex flex-col gap-1 justify-center cursor-default hover:bg-accent/30 transition-colors',
                      i < 6 && 'border-r border-border/60',
                    )}
                  >
                    {totalMin > 0 ? (
                      <>
                        <span className="text-[11px] font-medium text-foreground/80 text-right tabular-nums">
                          {(totalMin / 60).toFixed(1)}h
                        </span>
                        <div className="h-1 bg-muted rounded-[2px] overflow-hidden flex">
                          {segments.map((s, idx) => (
                            <div
                              key={idx}
                              style={{
                                width: `${(s.min / fullScale) * 100}%`,
                                background: s.color,
                              }}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/50 text-right">—</span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <ActualBreakdown
                    title={formatJaDate(date)}
                    aggregate={aggregate}
                    projects={projects}
                    projectById={projectById}
                  />
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <div
        className="grid relative flex-1"
        style={{ gridTemplateColumns: `${TIME_GUTTER_PX}px repeat(7, 1fr)` }}
      >
        <div
          className="relative border-r border-border/60"
          style={{ height: `${1440 * PX_PER_MIN}px` }}
        >
          {Array.from({ length: 25 }).map((_, h) => (
            <div
              key={h}
              className="absolute right-1.5 text-[10px] text-muted-foreground"
              style={{ top: `${h * 60 * PX_PER_MIN - 6}px` }}
            >
              {pad2(h)}:00
            </div>
          ))}
        </div>
        {days.map((d, i) => {
          const blocks = blocksByDate[d] ?? [];
          const isToday = d === todayStr;
          return (
            <div
              key={d}
              className={cn(
                'relative',
                i < 6 && 'border-r border-border/60',
                isToday && 'bg-primary/5',
              )}
              style={{ height: `${1440 * PX_PER_MIN}px` }}
            >
              {Array.from({ length: 25 }).map((_, h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/40 pointer-events-none"
                  style={{ top: `${h * 60 * PX_PER_MIN}px` }}
                />
              ))}
              {blocks.map((b) => {
                const color = blockColor(b);
                const isGcal = b.source === 'gcal';
                return (
                  <div
                    key={b.id}
                    title={b.label}
                    className={cn(
                      'absolute rounded-md overflow-hidden text-foreground',
                      'transition-[box-shadow,transform] duration-150 shadow-soft',
                      !isGcal && 'hover:shadow-floaty hover:-translate-y-px cursor-pointer',
                    )}
                    style={{
                      top: `${b.start * PX_PER_MIN}px`,
                      left: '2px',
                      right: '2px',
                      height: `${b.durationMin * PX_PER_MIN}px`,
                      background: isGcal ? `${color}14` : `${color}26`,
                      border: isGcal ? `1.5px dashed ${color}80` : `1px solid ${color}40`,
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <div className="px-1.5 py-px text-[10px] font-medium leading-tight truncate">
                      {b.label}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
