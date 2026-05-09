import type { DateString, Project, TimeBlock } from '../domain/types.js';
import { aggregateDaily } from '../domain/aggregate.js';

type Props = {
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly currentDate: DateString;
  readonly projects: readonly Project[];
};

export function DailyActualStrip({ blocksByDate, currentDate, projects }: Props) {
  const dailyAgg = aggregateDaily(blocksByDate, currentDate);
  const dailyAssignedMin = Array.from(dailyAgg.byProject.values()).reduce((a, b) => a + b, 0);
  const dailyTotalMin = dailyAssignedMin + dailyAgg.unassigned;
  const projectEntries = projects
    .map((p) => ({ p, min: dailyAgg.byProject.get(p.id) ?? 0 }))
    .filter(({ min }) => min > 0);
  const isEmpty = projectEntries.length === 0 && dailyAgg.unassigned === 0;
  return (
    <div style={{
      padding: '6px 16px',
      borderBottom: '1px solid #e5e7eb',
      background: '#f9fafb',
      fontSize: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      overflow: 'auto',
      flexShrink: 0,
    }}>
      <span style={{ color: '#6b7280', fontSize: '11px', flexShrink: 0, fontWeight: 600 }}>実績</span>
      {isEmpty ? (
        <span style={{ color: '#9ca3af', fontSize: '11px' }}>本日の登録なし</span>
      ) : (
        <>
          {projectEntries.map(({ p, min }) => (
            <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
              <span style={{ color: '#374151' }}>{p.name}: {(min / 60).toFixed(1)}h</span>
            </span>
          ))}
          {dailyAgg.unassigned > 0 && (
            <span style={{ color: '#6b7280', flexShrink: 0 }}>未割当: {(dailyAgg.unassigned / 60).toFixed(1)}h</span>
          )}
        </>
      )}
      <span style={{ marginLeft: 'auto', color: '#1f2937', fontWeight: 600, flexShrink: 0 }}>
        合計: {(dailyTotalMin / 60).toFixed(1)}h
      </span>
    </div>
  );
}
