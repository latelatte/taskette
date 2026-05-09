import { useMemo } from 'react';
import type { DateString, Project, TaskTemplate, TimeBlock } from '../domain/types.js';
import { daysOfWeek, today } from '../dates.js';
import { cn } from '../lib/utils.js';

const PX_PER_MIN = 0.5;
const FALLBACK_BLOCK_COLOR = '#A39A92';
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;
const TIME_GUTTER_PX = 56;

const pad2 = (n: number): string => n.toString().padStart(2, '0');

type Props = {
  readonly currentDate: DateString;
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly projectById: ReadonlyMap<string, Project>;
  readonly templateById?: ReadonlyMap<string, TaskTemplate>;
  readonly onDayClick: (date: DateString) => void;
};

export function WeekView({ currentDate, blocksByDate, projectById, templateById, onDayClick }: Props) {
  const days = useMemo(() => daysOfWeek(currentDate), [currentDate]);
  const todayStr = today();

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
      <div
        className="grid sticky top-0 z-10 bg-card/90 backdrop-blur-sm border-b"
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
