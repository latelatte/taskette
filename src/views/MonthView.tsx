import { useMemo } from 'react';
import type { DateString, Project, TimeBlock } from '../domain/types.js';
import { aggregateDaily } from '../domain/aggregate.js';
import { daysOfMonthGrid, today, yearMonthOf } from '../dates.js';

const FALLBACK_BLOCK_COLOR = '#64748b';
const UNASSIGNED_COLOR = '#9ca3af';
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
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        borderBottom: '1px solid #e5e7eb',
        background: 'white',
        flexShrink: 0,
      }}>
        {WEEKDAY_LABELS.map((wd, i) => (
          <div
            key={wd}
            style={{
              padding: '8px 6px',
              textAlign: 'center',
              fontSize: '11px',
              fontWeight: 600,
              color: i >= 5 ? '#9ca3af' : '#6b7280',
              borderRight: i < 6 ? '1px solid #f3f4f6' : 'none',
            }}
          >{wd}</div>
        ))}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gridTemplateRows: 'repeat(6, 1fr)',
        flex: 1,
        gap: 0,
      }}>
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
              style={{
                position: 'relative',
                background: inMonth ? 'white' : '#f9fafb',
                borderRight: '1px solid #f3f4f6',
                borderBottom: '1px solid #f3f4f6',
                padding: '6px 8px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '4px' }}>
                <span style={{
                  fontSize: '12px',
                  fontWeight: isToday ? 700 : 500,
                  color: !inMonth ? '#9ca3af' : isToday ? '#2563eb' : '#1f2937',
                  background: isToday ? 'rgba(37,99,235,0.12)' : 'transparent',
                  borderRadius: '50%',
                  width: isToday ? '20px' : 'auto',
                  height: isToday ? '20px' : 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>{dayNumber}</span>
                {totalMin > 0 && (
                  <span style={{ fontSize: '10px', color: inMonth ? '#374151' : '#9ca3af', fontWeight: 500 }}>
                    {totalH.toFixed(1)}h
                  </span>
                )}
              </div>
              {totalMin > 0 && (
                <div style={{
                  height: 4,
                  background: '#f3f4f6',
                  borderRadius: 2,
                  overflow: 'hidden',
                  display: 'flex',
                  marginTop: 'auto',
                }}>
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
