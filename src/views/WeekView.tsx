import { useMemo } from 'react';
import type { DateString, Project, TaskTemplate, TimeBlock } from '../domain/types.js';
import { daysOfWeek, today } from '../dates.js';

const PX_PER_MIN = 0.5;
const FALLBACK_BLOCK_COLOR = '#64748b';
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;

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
    <div style={{ flex: 1, overflow: 'auto', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '52px repeat(7, 1fr)',
        position: 'sticky',
        top: 0,
        background: 'white',
        borderBottom: '1px solid #e5e7eb',
        zIndex: 1,
      }}>
        <div style={{ borderRight: '1px solid #f3f4f6' }} />
        {days.map((d, i) => {
          const isToday = d === todayStr;
          const dayNum = parseInt(d.slice(8, 10), 10);
          return (
            <button
              key={d}
              onClick={() => onDayClick(d)}
              style={{
                background: isToday ? 'rgba(37,99,235,0.06)' : 'white',
                border: 'none',
                borderRight: i < 6 ? '1px solid #f3f4f6' : 'none',
                padding: '8px 4px',
                cursor: 'pointer',
                textAlign: 'center',
                fontSize: '11px',
                color: i >= 5 ? '#9ca3af' : '#6b7280',
                fontWeight: 600,
              }}
            >
              <div>{WEEKDAY_LABELS[i]}</div>
              <div style={{
                fontSize: '14px',
                color: isToday ? '#2563eb' : (i >= 5 ? '#9ca3af' : '#1f2937'),
                fontWeight: isToday ? 700 : 500,
                marginTop: '2px',
              }}>{dayNum}</div>
            </button>
          );
        })}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '52px repeat(7, 1fr)',
        position: 'relative',
        flex: 1,
      }}>
        <div style={{ position: 'relative', height: `${1440 * PX_PER_MIN}px`, borderRight: '1px solid #f3f4f6' }}>
          {Array.from({ length: 25 }).map((_, h) => (
            <div
              key={h}
              style={{
                position: 'absolute',
                top: `${h * 60 * PX_PER_MIN - 6}px`,
                right: 6,
                fontSize: '10px',
                color: '#9ca3af',
              }}
            >{pad2(h)}:00</div>
          ))}
        </div>
        {days.map((d, i) => {
          const blocks = blocksByDate[d] ?? [];
          const isToday = d === todayStr;
          return (
            <div
              key={d}
              style={{
                position: 'relative',
                height: `${1440 * PX_PER_MIN}px`,
                borderRight: i < 6 ? '1px solid #f3f4f6' : 'none',
                background: isToday ? 'rgba(37,99,235,0.04)' : 'transparent',
              }}
            >
              {Array.from({ length: 25 }).map((_, h) => (
                <div
                  key={h}
                  style={{
                    position: 'absolute',
                    top: `${h * 60 * PX_PER_MIN}px`,
                    left: 0,
                    right: 0,
                    borderTop: '1px solid #f3f4f6',
                    pointerEvents: 'none',
                  }}
                />
              ))}
              {blocks.map((b) => (
                <div
                  key={b.id}
                  title={b.label}
                  style={{
                    position: 'absolute',
                    top: `${b.start * PX_PER_MIN}px`,
                    left: '2px',
                    right: '2px',
                    height: `${b.durationMin * PX_PER_MIN}px`,
                    background: blockColor(b),
                    color: 'white',
                    borderRadius: '3px',
                    fontSize: '10px',
                    padding: '1px 4px',
                    overflow: 'hidden',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  }}
                >{b.label}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
