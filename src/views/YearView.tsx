import { useMemo } from 'react';
import type { DateString, Project, TimeBlock } from '../domain/types.js';
import { aggregateMonthly } from '../domain/aggregate.js';
import {
  type BudgetStatus,
  projectBudgetUsage,
  worstBudgetStatus,
} from '../domain/budget.js';
import { elapsedRatio, monthsOfYear, today, yearMonthOf, yearOf } from '../dates.js';

const FALLBACK_BLOCK_COLOR = '#64748b';
const UNASSIGNED_COLOR = '#9ca3af';

const STATUS_BORDER: Record<BudgetStatus, string> = {
  over: '#dc2626',
  projectedOver: '#f97316',
  underConfirmed: '#d97706',
  projectedUnder: '#f59e0b',
  ok: '#10b981',
  noBudget: '#d1d5db',
};

const MONTH_NAMES_JA = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] as const;

type Props = {
  readonly currentDate: DateString;
  readonly blocksByDate: Record<DateString, readonly TimeBlock[]>;
  readonly projects: readonly Project[];
  readonly projectById: ReadonlyMap<string, Project>;
  readonly onMonthClick: (yearMonth: string) => void;
};

export function YearView({ currentDate, blocksByDate, projects, projectById, onMonthClick }: Props) {
  const year = yearOf(currentDate);
  const todayStr = today();
  const todayYM = yearMonthOf(todayStr);

  const monthsData = useMemo(() => {
    return monthsOfYear(year).map((ym) => {
      const agg = aggregateMonthly(blocksByDate, ym);
      const elapsed = elapsedRatio(ym, todayStr);

      const usages = projects.map((p) => ({
        project: p,
        usage: projectBudgetUsage(p, agg.byProject.get(p.id) ?? 0, elapsed),
      }));

      const budgetedUsages = usages.filter((u) => u.usage.status !== 'noBudget');
      const status = worstBudgetStatus(budgetedUsages.map((u) => u.usage.status));

      const overCount = budgetedUsages.filter(
        (u) => u.usage.status === 'over' || u.usage.status === 'projectedOver',
      ).length;
      const underCount = budgetedUsages.filter(
        (u) => u.usage.status === 'underConfirmed' || u.usage.status === 'projectedUnder',
      ).length;

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

      return { ym, status, overCount, underCount, totalMin, segments, elapsed };
    });
  }, [year, blocksByDate, projects, projectById, todayStr]);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px', background: '#fafafa' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: '12px',
        height: '100%',
        minHeight: '480px',
      }}>
        {monthsData.map(({ ym, status, overCount, underCount, totalMin, segments, elapsed }, i) => {
          const isCurrentMonth = ym === todayYM;
          const isFuture = ym > todayYM;
          const totalH = totalMin / 60;
          const fullScale = segments.reduce((a, s) => a + s.min, 0) || 1;
          const borderColor = isFuture ? '#e5e7eb' : STATUS_BORDER[status];

          return (
            <button
              key={ym}
              onClick={() => onMonthClick(ym)}
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${borderColor}`,
                borderRadius: '6px',
                padding: '12px 14px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                textAlign: 'left',
                boxShadow: isCurrentMonth ? '0 0 0 2px rgba(37,99,235,0.25)' : '0 1px 2px rgba(0,0,0,0.04)',
                opacity: isFuture ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{
                  fontSize: '13px',
                  fontWeight: isCurrentMonth ? 700 : 600,
                  color: isCurrentMonth ? '#2563eb' : '#1f2937',
                }}>{MONTH_NAMES_JA[i]}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {overCount > 0 && (
                    <span style={{
                      fontSize: '10px',
                      background: '#fee2e2',
                      color: '#dc2626',
                      borderRadius: '8px',
                      padding: '1px 6px',
                      fontWeight: 600,
                    }} title={`${overCount}件の超過/予測超過`}>▲{overCount}</span>
                  )}
                  {underCount > 0 && (
                    <span style={{
                      fontSize: '10px',
                      background: '#fef3c7',
                      color: '#d97706',
                      borderRadius: '8px',
                      padding: '1px 6px',
                      fontWeight: 600,
                    }} title={`${underCount}件の不足/予測不足`}>▼{underCount}</span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: totalMin > 0 ? '#1f2937' : '#9ca3af' }}>
                {totalMin > 0 ? `${totalH.toFixed(1)}h` : '—'}
              </div>
              {segments.length > 0 && (
                <div style={{
                  height: 6,
                  background: '#f3f4f6',
                  borderRadius: 3,
                  overflow: 'hidden',
                  display: 'flex',
                }}>
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
              )}
              {!isFuture && elapsed < 1 && elapsed > 0 && (
                <div style={{ fontSize: '10px', color: '#9ca3af' }}>
                  経過 {Math.round(elapsed * 100)}%
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
