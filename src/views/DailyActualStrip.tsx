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
    <div className="flex items-center gap-3.5 border-b bg-muted/30 px-4 py-1.5 text-xs overflow-auto shrink-0">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground shrink-0 uppercase">
        実績
      </span>
      {isEmpty ? (
        <span className="text-[11px] text-muted-foreground/70">本日の登録なし</span>
      ) : (
        <>
          {projectEntries.map(({ p, min }) => (
            <span key={p.id} className="flex items-center gap-1 shrink-0">
              <span
                className="w-2 h-2 rounded-[2px]"
                style={{ background: p.color }}
              />
              <span className="text-foreground/80">
                {p.name}: {(min / 60).toFixed(1)}h
              </span>
            </span>
          ))}
          {dailyAgg.unassigned > 0 && (
            <span className="text-muted-foreground shrink-0">
              未割当: {(dailyAgg.unassigned / 60).toFixed(1)}h
            </span>
          )}
        </>
      )}
      <span className="ml-auto font-semibold text-foreground shrink-0">
        合計: {(dailyTotalMin / 60).toFixed(1)}h
      </span>
    </div>
  );
}
