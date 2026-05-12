import { useMemo } from 'react';
import type { DateString, Project, TimeBlock } from '../domain/types.js';
import { aggregateMonthly } from '../domain/aggregate.js';
import {
  type BudgetStatus,
  projectBudgetUsage,
  worstBudgetStatus,
} from '../domain/budget.js';
import { elapsedRatio, monthsOfYear, today, yearMonthOf, yearOf } from '../dates.js';
import { cn } from '../lib/utils.js';

const FALLBACK_BLOCK_COLOR = '#A39A92';
const UNASSIGNED_COLOR = '#B5B0A8';

// 予算 4 段階警告 + ok / noBudget — semantic 性 (赤=危険, 橙=警告, 緑=OK) は維持しつつ
// 原色 (red-600 等) → ニュアンス系の落ち着いたトーンに refined。
const STATUS_BORDER: Record<BudgetStatus, string> = {
  over: '#B85C5C',           // dusty red (was #dc2626)
  projectedOver: '#C58054',  // soft burnt orange (was #f97316)
  underConfirmed: '#A8783D', // deep amber, refined (was #d97706)
  projectedUnder: '#C29050', // soft amber (was #f59e0b)
  ok: '#7FA384',             // sage green (was #10b981)
  noBudget: '#D1CDC6',       // warm light gray (was #d1d5db)
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
        usage: projectBudgetUsage(p, agg.byProject.get(p.id) ?? 0, elapsed, ym, todayStr),
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
    <div className="flex-1 overflow-auto p-5 bg-background">
      <div className="grid grid-cols-4 grid-rows-3 gap-3 h-full min-h-[480px]">
        {monthsData.map(({ ym, status, overCount, underCount, totalMin, segments, elapsed }, i) => {
          const isCurrentMonth = ym === todayYM;
          const isFuture = ym > todayYM;
          const totalH = totalMin / 60;
          const fullScale = segments.reduce((a, s) => a + s.min, 0) || 1;
          const borderColor = isFuture ? 'var(--border)' : STATUS_BORDER[status];

          return (
            <button
              key={ym}
              onClick={() => onMonthClick(ym)}
              className={cn(
                'bg-card border rounded-lg px-3.5 py-3 cursor-pointer flex flex-col gap-2 text-left transition-shadow hover:shadow-md',
                isFuture && 'opacity-60',
              )}
              style={{
                borderLeft: `4px solid ${borderColor}`,
                boxShadow: isCurrentMonth
                  ? '0 0 0 2px var(--ring)'
                  : 'var(--shadow-soft)',
              }}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={cn(
                    'text-[13px]',
                    isCurrentMonth ? 'font-bold text-primary' : 'font-semibold text-foreground',
                  )}
                >
                  {MONTH_NAMES_JA[i]}
                </span>
                <div className="flex gap-1">
                  {overCount > 0 && (
                    <span
                      className="text-[10px] bg-destructive/15 text-destructive rounded-full px-1.5 py-px font-semibold"
                      title={`${overCount}件の超過/予測超過`}
                    >
                      ▲{overCount}
                    </span>
                  )}
                  {underCount > 0 && (
                    <span
                      className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-px font-semibold"
                      title={`${underCount}件の不足/予測不足`}
                    >
                      ▼{underCount}
                    </span>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  'text-xl font-bold',
                  totalMin > 0 ? 'text-foreground' : 'text-muted-foreground/60',
                )}
              >
                {totalMin > 0 ? `${totalH.toFixed(1)}h` : '—'}
              </div>
              {segments.length > 0 && (
                <div className="h-1.5 bg-muted rounded-[3px] overflow-hidden flex">
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
                <div className="text-[10px] text-muted-foreground/70">
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
