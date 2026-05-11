import type { Project } from '../domain/types.js';
import type { Aggregate } from '../domain/aggregate.js';

type Props = {
  readonly aggregate: Aggregate;
  readonly projects: readonly Project[];
  readonly emptyMessage?: string;
  readonly label?: string;
};

export function ActualStrip({ aggregate, projects, emptyMessage = '登録なし', label = '実績' }: Props) {
  const assignedMin = Array.from(aggregate.byProject.values()).reduce((a, b) => a + b, 0);
  const totalMin = assignedMin + aggregate.unassigned;
  const projectEntries = projects
    .map((p) => ({ p, min: aggregate.byProject.get(p.id) ?? 0 }))
    .filter(({ min }) => min > 0);
  const isEmpty = projectEntries.length === 0 && aggregate.unassigned === 0;
  return (
    <div className="flex items-center gap-3.5 border-b bg-muted/30 px-4 py-1.5 text-xs overflow-auto shrink-0">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground shrink-0 uppercase">
        {label}
      </span>
      {isEmpty ? (
        <span className="text-[11px] text-muted-foreground/70">{emptyMessage}</span>
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
          {aggregate.unassigned > 0 && (
            <span className="text-muted-foreground shrink-0">
              未割当: {(aggregate.unassigned / 60).toFixed(1)}h
            </span>
          )}
        </>
      )}
      <span className="ml-auto font-semibold text-foreground shrink-0">
        合計: {(totalMin / 60).toFixed(1)}h
      </span>
    </div>
  );
}
