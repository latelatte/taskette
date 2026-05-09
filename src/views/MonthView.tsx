import { useMemo } from 'react';
import type { DateString, Project, TimeBlock } from '../domain/types.js';
import { aggregateDaily } from '../domain/aggregate.js';
import { daysOfMonthGrid, today, yearMonthOf } from '../dates.js';
import { cn } from '../lib/utils.js';

const FALLBACK_BLOCK_COLOR = '#A39A92';
const UNASSIGNED_COLOR = '#B5B0A8';
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;

type Props = {
  readonly currentDate: DateString;
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly projects: readonly Project[];
  readonly projectById: ReadonlyMap<string, Project>;
  readonly onDayClick: (date: DateString) => void;
};

export function MonthView({ currentDate, blocksByDate, projects, projectById, onDayClick }: Props) {
  const ym = yearMonthOf(currentDate);
  const todayStr = today();
  const grid = useMemo(() => daysOfMonthGrid(ym), [ym]);

  return (
    <div className="flex-1 overflow-auto flex flex-col bg-background">
      <div className="grid grid-cols-7 border-b bg-card/90 backdrop-blur-sm shrink-0">
        {WEEKDAY_LABELS.map((wd, i) => (
          <div
            key={wd}
            className={cn(
              'px-1.5 py-2 text-center text-[11px] font-semibold tracking-wide',
              i < 6 && 'border-r border-border/60',
              i >= 5 ? 'text-muted-foreground/70' : 'text-muted-foreground',
            )}
          >
            {wd}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 flex-1">
        {grid.map((date) => {
          const inMonth = yearMonthOf(date) === ym;
          const isToday = date === todayStr;
          const agg = aggregateDaily(blocksByDate, date);
          const assignedMin = Array.from(agg.byProject.values()).reduce((a, b) => a + b, 0);
          const totalMin = assignedMin + agg.unassigned;
          const totalH = totalMin / 60;
          const dayNumber = parseInt(date.slice(8, 10), 10);

          const segments: { color: string; min: number }[] = [];
          for (const p of projects) {
            const m = agg.byProject.get(p.id) ?? 0;
            if (m > 0) segments.push({ color: p.color, min: m });
          }
          for (const [pid, m] of agg.byProject) {
            if (!projectById.has(pid) && m > 0) segments.push({ color: FALLBACK_BLOCK_COLOR, min: m });
          }
          if (agg.unassigned > 0) segments.push({ color: UNASSIGNED_COLOR, min: agg.unassigned });

          const fullScale = Math.max(8 * 60, totalMin);

          return (
            <div
              key={date}
              onClick={() => onDayClick(date)}
              className={cn(
                'relative cursor-pointer flex flex-col gap-1 px-2 py-1.5 min-h-0 overflow-hidden border-r border-b border-border/60 transition-colors',
                inMonth ? 'bg-card hover:bg-accent/30' : 'bg-muted/40 hover:bg-muted/60',
              )}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={cn(
                    'inline-flex items-center justify-center text-xs',
                    isToday ? 'font-bold' : 'font-medium',
                    isToday
                      ? 'rounded-full w-5 h-5 bg-primary/12 text-primary'
                      : !inMonth
                        ? 'text-muted-foreground/70'
                        : 'text-foreground',
                  )}
                >
                  {dayNumber}
                </span>
                {totalMin > 0 && (
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      inMonth ? 'text-foreground/75' : 'text-muted-foreground/60',
                    )}
                  >
                    {totalH.toFixed(1)}h
                  </span>
                )}
              </div>
              {totalMin > 0 && (
                <div className="h-1 bg-muted rounded-[2px] overflow-hidden flex mt-auto">
                  {segments.map((s, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: `${(s.min / fullScale) * 100}%`,
                        background: s.color,
                        opacity: inMonth ? 1 : 0.4,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
